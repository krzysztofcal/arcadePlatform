begin;

-- This file is the forward-only Production equivalent for #1018 (NORMAL/SLOW
-- bot quarantine and exact bot pools). It consolidates the final schema
-- contract of 20260927100000, 20260927110000, 20260929130000, 20260929163000,
-- and 20260930075513.
-- It must be applied by the reviewed operator route with:
--   set chips.production_project_ref = 'otbqfijerkieoxwpxjnm';
-- The setting is deliberately absent from application environments.

do $identity$
declare
  actual_system_identifier text;
begin
  select system_identifier::text
    into actual_system_identifier
    from pg_catalog.pg_control_system();
  if current_setting('chips.production_project_ref', true) is distinct from 'otbqfijerkieoxwpxjnm'
     or actual_system_identifier is distinct from '7575202818581710058' then
    raise exception using
      errcode = 'P8910',
      message = 'Production poker quarantine migration identity preflight failed';
  end if;
end;
$identity$;

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm', 0));

do $prerequisites$
begin
  -- Require E1 and E2 retention contracts to be present
  if to_regclass('public.chips_production_retention_control') is null
     or to_regclass('public.chips_table_fence_control') is null
     or not exists (
       select 1 from pg_catalog.pg_attribute
       where attrelid = 'public.poker_tables'::pg_catalog.regclass
         and attname = 'bot_only_proof_eligible'
         and not attisdropped
     )
     or not exists (
       select 1 from pg_catalog.pg_attribute
       where attrelid = 'public.poker_tables'::pg_catalog.regclass
         and attname = 'bot_only_retention_complete_at'
         and not attisdropped
     )
     or not exists (
       select 1 from pg_catalog.pg_attribute
       where attrelid = 'public.poker_tables'::pg_catalog.regclass
         and attname = 'human_retention_complete_at'
         and not attisdropped
     ) then
    raise exception using
      errcode = 'P8910',
      message = 'Production retention prerequisites E1/E2 are missing';
  end if;

  -- Require schema migrations history table to exist and contain E1 and E2, but not P1
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception using
      errcode = 'P8910',
      message = 'Production schema migrations table supabase_migrations.schema_migrations is missing';
  end if;

  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20260914090000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20260914091000') then
    raise exception using
      errcode = 'P8910',
      message = 'Production schema migrations prerequisite versions E1/E2 are missing';
  end if;

  if exists (select 1 from supabase_migrations.schema_migrations where version = '20260929201500') then
    raise exception using
      errcode = 'P8910',
      message = 'Production schema migration version 20260929201500 is already recorded';
  end if;

  -- Require existing POKER_BOT_BANKROLL to be present
  if not exists (
    select 1 from public.chips_accounts
    where account_type = 'SYSTEM' and system_key = 'POKER_BOT_BANKROLL'
  ) then
    raise exception using
      errcode = 'P8910',
      message = 'Required existing POKER_BOT_BANKROLL account is missing';
  end if;

  -- Reject unexpected partial or drifted #1018 schema
  if to_regclass('public.poker_access_policy') is not null
     or to_regclass('public.poker_bot_tier_policy') is not null
     or exists (
       select 1 from pg_catalog.pg_attribute
       where attrelid = 'public.chips_accounts'::pg_catalog.regclass
         and attname in (
           'poker_auto_class', 'poker_access_override', 'poker_access_revision',
           'poker_auto_slow_at', 'poker_access_updated_at', 'poker_access_updated_by'
         )
         and not attisdropped
     )
     or exists (
       select 1 from pg_catalog.pg_attribute
       where attrelid = 'public.poker_tables'::pg_catalog.regclass
         and attname = 'is_slow_only'
         and not attisdropped
     )
     or exists (
       select 1 from public.chips_accounts
       where account_type = 'SYSTEM'
         and (
           system_key like 'POKER_BOT_BANKROLL_%'
           or system_key like 'POKER_BOT_SLOW_BANKROLL_%'
         )
     ) then
    raise exception using
      errcode = 'P8910',
      message = 'Production poker quarantine schema already exists or is in an unexpected drifted state';
  end if;
end;
$prerequisites$;

alter table public.chips_accounts
  add column if not exists poker_auto_class text not null default 'NORMAL',
  add column if not exists poker_access_override text not null default 'AUTO',
  add column if not exists poker_access_revision bigint not null default 1,
  add column if not exists poker_auto_slow_at timestamptz,
  add column if not exists poker_access_updated_at timestamptz,
  add column if not exists poker_access_updated_by uuid;

alter table public.chips_accounts
  add constraint chips_accounts_poker_auto_class_chk
  check (poker_auto_class in ('NORMAL', 'SLOW'));

alter table public.chips_accounts
  add constraint chips_accounts_poker_access_override_chk
  check (poker_access_override in ('AUTO', 'FORCE_NORMAL', 'FORCE_SLOW', 'FORCE_RESTRICTED'));

alter table public.chips_accounts
  add constraint chips_accounts_poker_access_revision_chk
  check (poker_access_revision > 0);

alter table public.poker_tables
  add column if not exists is_slow_only boolean not null default false;

create or replace function public.poker_tables_slow_only_sticky()
returns trigger
language plpgsql
as $$
begin
  if old.is_slow_only is true and new.is_slow_only is not true then
    raise exception using errcode = 'P1018', message = 'is_slow_only is one-way';
  end if;
  return new;
end;
$$;

drop trigger if exists poker_tables_slow_only_sticky_trg on public.poker_tables;
create trigger poker_tables_slow_only_sticky_trg
before update of is_slow_only on public.poker_tables
for each row execute function public.poker_tables_slow_only_sticky();

create table public.poker_access_policy (
  id smallint primary key default 1,
  slow_threshold_ch bigint not null default 1000000000,
  slow_hysteresis_bps integer not null default 500,
  slow_recovery_threshold_ch bigint not null default 950000000,
  revision bigint not null default 1,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid,
  constraint poker_access_policy_singleton_chk check (id = 1),
  constraint poker_access_policy_threshold_chk check (slow_threshold_ch > 0 and slow_threshold_ch <= 9007199254740991),
  constraint poker_access_policy_hysteresis_bps_chk check (slow_hysteresis_bps >= 100 and slow_hysteresis_bps <= 5000),
  constraint poker_access_policy_recovery_threshold_chk check (slow_recovery_threshold_ch > 0 and slow_recovery_threshold_ch <= 9007199254740991),
  constraint poker_access_policy_threshold_order_chk check (slow_recovery_threshold_ch < slow_threshold_ch),
  constraint poker_access_policy_recovery_derivation_chk check (
    slow_recovery_threshold_ch = floor((slow_threshold_ch::numeric * (10000 - slow_hysteresis_bps)::numeric) / 10000)::bigint
  ),
  constraint poker_access_policy_revision_chk check (revision > 0)
);

insert into public.poker_access_policy (
  id,
  slow_threshold_ch,
  slow_hysteresis_bps,
  slow_recovery_threshold_ch,
  revision
)
values (1, 1000000000, 500, 950000000, 1);

create table public.poker_bot_tier_policy (
  buy_in bigint primary key,
  enabled boolean not null default false,
  normal_refill_threshold_ch bigint not null,
  normal_refill_amount_ch bigint not null,
  slow_refill_threshold_ch bigint not null,
  slow_refill_amount_ch bigint not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid,
  constraint poker_bot_tier_policy_buy_in_chk check (buy_in > 0 and buy_in <= 9007199254740991),
  constraint poker_bot_tier_policy_positive_values_chk check (
    normal_refill_threshold_ch > 0
    and normal_refill_amount_ch > 0
    and slow_refill_threshold_ch > 0
    and slow_refill_amount_ch > 0
    and revision > 0
  )
);

insert into public.poker_bot_tier_policy (
  buy_in, enabled, normal_refill_threshold_ch, normal_refill_amount_ch,
  slow_refill_threshold_ch, slow_refill_amount_ch
)
values
  (100, false, 2000, 5000, 1000, 2000),
  (500, false, 5000, 10000, 2000, 5000),
  (1000, false, 10000, 20000, 4000, 10000),
  (5000, false, 50000, 100000, 20000, 50000),
  (10000, false, 100000, 200000, 40000, 100000),
  (50000, false, 500000, 1000000, 200000, 500000),
  (100000, false, 1000000, 2000000, 400000, 1000000),
  (500000, false, 5000000, 10000000, 2000000, 5000000),
  (1000000, false, 10000000, 20000000, 4000000, 10000000),
  (5000000, false, 50000000, 100000000, 20000000, 50000000),
  (10000000, false, 100000000, 200000000, 40000000, 100000000);

-- Provision only the 21 missing exact pools at balance 0.
-- Existing POKER_BOT_BANKROLL is preserved without modification.
insert into public.chips_accounts (account_type, system_key, status, balance)
values
  ('SYSTEM', 'POKER_BOT_BANKROLL_100', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_100', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_500', 'active', 0),
  ('SYSTEM', 'POKER_BOT_BANKROLL_1000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_1000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_BANKROLL_5000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_5000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_BANKROLL_10000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_10000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_BANKROLL_50000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_50000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_BANKROLL_100000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_100000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_BANKROLL_500000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_500000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_BANKROLL_1000000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_1000000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_BANKROLL_5000000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_5000000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_BANKROLL_10000000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_10000000', 'active', 0);

create index if not exists poker_seats_user_id_active_human_idx
  on public.poker_seats (user_id, table_id)
  where status = 'ACTIVE' and coalesce(is_bot, false) = false and coalesce(stack, 0) > 0;

create index if not exists poker_tables_created_by_pending_standard_idx
  on public.poker_tables (created_by, id)
  where status = 'OPEN'
    and lifecycle_kind = 'STANDARD'
    and has_human_participant = false;

create index if not exists chips_transactions_poker_table_id_idx
  on public.chips_transactions ((metadata ->> 'tableId'))
  where metadata ? 'tableId'
    and nullif(metadata ->> 'tableId', '') is not null;

create unique index if not exists chips_transactions_poker_pool_bucket_uidx
  on public.chips_transactions (
    (metadata ->> 'bankrollSystemKey'),
    (metadata ->> 'bucket')
  )
  where metadata ->> 'purpose' = 'poker_pool_refill'
    and nullif(metadata ->> 'bankrollSystemKey', '') is not null
    and nullif(metadata ->> 'bucket', '') is not null;

alter table public.poker_access_policy enable row level security;
alter table public.poker_bot_tier_policy enable row level security;
revoke all on table public.poker_access_policy, public.poker_bot_tier_policy from anon, authenticated;

insert into supabase_migrations.schema_migrations (version)
values ('20260929201500');

commit;
