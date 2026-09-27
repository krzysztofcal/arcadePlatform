-- #1018 NORMAL/SLOW access, table markers, exact bot pools and bounded refill identity.
-- This migration is additive and forward-only.  It is intentionally not applied by
-- local implementation or test commands; publishing it invokes DB Stage Apply PR.

alter table public.chips_accounts
  add column if not exists poker_auto_class text not null default 'NORMAL',
  add column if not exists poker_access_override text not null default 'AUTO',
  add column if not exists poker_access_revision bigint not null default 1,
  add column if not exists poker_auto_slow_at timestamptz,
  add column if not exists poker_access_updated_at timestamptz,
  add column if not exists poker_access_updated_by uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chips_accounts_poker_auto_class_chk') then
    alter table public.chips_accounts
      add constraint chips_accounts_poker_auto_class_chk
      check (poker_auto_class in ('NORMAL', 'SLOW'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chips_accounts_poker_access_override_chk') then
    alter table public.chips_accounts
      add constraint chips_accounts_poker_access_override_chk
      check (poker_access_override in ('AUTO', 'FORCE_NORMAL', 'FORCE_SLOW'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chips_accounts_poker_access_revision_chk') then
    alter table public.chips_accounts
      add constraint chips_accounts_poker_access_revision_chk
      check (poker_access_revision > 0);
  end if;
end $$;

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

create table if not exists public.poker_access_policy (
  id smallint primary key default 1,
  slow_threshold_ch bigint not null default 1000000000,
  revision bigint not null default 1,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid,
  constraint poker_access_policy_singleton_chk check (id = 1),
  constraint poker_access_policy_threshold_chk check (slow_threshold_ch > 0 and slow_threshold_ch <= 9007199254740991),
  constraint poker_access_policy_revision_chk check (revision > 0)
);

insert into public.poker_access_policy (id, slow_threshold_ch, revision)
values (1, 1000000000, 1)
on conflict (id) do nothing;

create table if not exists public.poker_bot_tier_policy (
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
  (500, false, 5000, 10000, 2000, 5000)
on conflict (buy_in) do nothing;

-- Provisioning only creates missing exact pools.  Existing account IDs, balances
-- and ledger provenance (including POKER_BOT_BANKROLL) are never changed.
insert into public.chips_accounts (account_type, system_key, status, balance)
values
  ('SYSTEM', 'POKER_BOT_BANKROLL_100', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_100', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_500', 'active', 0)
on conflict (system_key) do nothing;

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
