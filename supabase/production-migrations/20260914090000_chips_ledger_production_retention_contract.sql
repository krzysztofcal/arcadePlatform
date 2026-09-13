begin;

-- This file is a forward-only Production equivalent.  It must be applied by
-- the reviewed operator route with:
--   set chips.production_project_ref = 'otbqfijerkieoxwpxjnm';
-- The setting is deliberately absent from application environments.
do $identity$
declare
  actual_system_identifier text;
begin
  select system_identifier::text
    into actual_system_identifier
    from pg_catalog.pg_control_system();
  if current_setting('chips.production_project_ref', true)
       is distinct from 'otbqfijerkieoxwpxjnm'
     or actual_system_identifier is distinct from '7575202818581710058' then
    raise exception using
      errcode = 'P8910',
      message = 'Production retention migration identity preflight failed';
  end if;
end;
$identity$;

-- Final receipt fields.  Existing Production batch 1 remains valid because
-- every new receipt is nullable and all historical rows stay untouched.
alter table public.chips_ledger_archive_batches
  add column if not exists source_policy_id text,
  add column if not exists bot_only_table_id uuid,
  add column if not exists bot_only_table_count bigint,
  add column if not exists bot_only_newest_created_at timestamptz,
  add column if not exists bot_only_registry_keys_sha256 text,
  add column if not exists bot_only_out_of_scope_keys_sha256 text,
  add column if not exists bot_only_identity_count bigint,
  add column if not exists bot_only_eligible_count bigint,
  add column if not exists registry_cleaned_at timestamptz,
  add column if not exists registry_cleaned_key_count bigint,
  add column if not exists registry_cleaned_keys_sha256 text,
  add column if not exists destructive_go_at timestamptz,
  add column if not exists destructive_go_batch_id bigint,
  add column if not exists account_retirement_at timestamptz,
  add column if not exists account_retirement_account_count bigint,
  add column if not exists account_retirement_account_ids_sha256 text,
  add column if not exists account_retirement_recovery_object_path text,
  add column if not exists account_retirement_recovery_object_sha256 text,
  add column if not exists account_retirement_snapshot_sha256 text;

alter table public.chips_transaction_idempotency
  add column if not exists table_id uuid,
  add column if not exists key_format_version integer,
  add column if not exists key_format text;

alter table public.poker_tables
  add column if not exists bot_only_proof_eligible boolean not null default false,
  add column if not exists bot_only_retention_complete_at timestamptz,
  add column if not exists human_retention_complete_at timestamptz;

-- Production is conservative before the fence is separately activated:
-- existing rows and every pre-fence new row remain ineligible for bot cleanup.
alter table public.poker_tables
  alter column bot_only_proof_eligible set default false;

do $constraints$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'chips_ledger_archive_batches_production_source_policy_check') then
    alter table public.chips_ledger_archive_batches add constraint chips_ledger_archive_batches_production_source_policy_check
      check (source_policy_id is null or source_policy_id in (
        'production-ledger-auto-retention-30d-v1',
        'production-ledger-bot-only-retention-7d-v1',
        'production-ledger-closed-human-table-retention-30d-v1',
        'production-ledger-escrow-account-retention-v1'
      ));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'chips_ledger_archive_batches_production_bot_evidence_check') then
    alter table public.chips_ledger_archive_batches add constraint chips_ledger_archive_batches_production_bot_evidence_check
      check (
        (format_version <> 2 and bot_only_table_id is null and bot_only_table_count is null
          and bot_only_newest_created_at is null and bot_only_registry_keys_sha256 is null
          and bot_only_out_of_scope_keys_sha256 is null and bot_only_identity_count is null
          and bot_only_eligible_count is null)
        or (format_version = 2 and source_policy_id = 'production-ledger-bot-only-retention-7d-v1'
          and bot_only_table_id is not null and bot_only_table_count = 1
          and bot_only_newest_created_at is not null
          and bot_only_registry_keys_sha256 ~ '^[0-9a-f]{64}$'
          and bot_only_out_of_scope_keys_sha256 ~ '^[0-9a-f]{64}$'
          and bot_only_identity_count >= 1 and bot_only_identity_count = transaction_count
          and bot_only_eligible_count = transaction_count)
      );
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'chips_ledger_archive_batches_production_go_check') then
    alter table public.chips_ledger_archive_batches add constraint chips_ledger_archive_batches_production_go_check
      check ((destructive_go_at is null and destructive_go_batch_id is null)
        or (destructive_go_at is not null and destructive_go_batch_id = batch_id));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'chips_ledger_archive_batches_production_account_receipt_check') then
    alter table public.chips_ledger_archive_batches add constraint chips_ledger_archive_batches_production_account_receipt_check
      check (
        pg_catalog.num_nonnulls(account_retirement_at, account_retirement_account_count,
          account_retirement_account_ids_sha256, account_retirement_recovery_object_path,
          account_retirement_recovery_object_sha256, account_retirement_snapshot_sha256) = 0
        or (source_policy_id = 'production-ledger-escrow-account-retention-v1'
          and status = 'committed' and archive_proof_verified_at is not null and pruned_at is not null
          and registry_cleaned_at is not null and account_retirement_at is not null
          and account_retirement_account_count between 1 and 2
          and account_retirement_account_ids_sha256 ~ '^[0-9a-f]{64}$'
          and account_retirement_recovery_object_path = 'account-recovery/v1/sha256/'
            || account_retirement_recovery_object_sha256 || '.json.gz'
          and account_retirement_recovery_object_sha256 ~ '^[0-9a-f]{64}$'
          and account_retirement_snapshot_sha256 ~ '^[0-9a-f]{64}$'));
  end if;
end;
$constraints$;

create index if not exists chips_ledger_archive_batches_production_policy_idx
  on public.chips_ledger_archive_batches (project_ref, source_policy_id, status, pruned_at, created_at, batch_id)
  where source_policy_id is not null;
create index if not exists chips_ledger_archive_batches_production_account_retirement_idx
  on public.chips_ledger_archive_batches (source_policy_id, status, registry_cleaned_at, account_retirement_at, created_at, batch_id)
  where source_policy_id = 'production-ledger-escrow-account-retention-v1';
create index if not exists chips_transaction_idempotency_production_archive_batch_idx
  on public.chips_transaction_idempotency (archive_batch_id)
  where archive_batch_id is not null;
create index if not exists chips_transaction_idempotency_production_transaction_table_idx
  on public.chips_transaction_idempotency (transaction_id, table_id);
create index if not exists chips_transaction_idempotency_production_table_id_idx
  on public.chips_transaction_idempotency (table_id)
  where table_id is not null;
create index if not exists chips_transaction_idempotency_production_human_access_idx
  on public.chips_transaction_idempotency (table_id, transaction_created_at, archive_batch_id, transaction_id)
  where table_id is not null and tx_type in ('TABLE_BUY_IN', 'TABLE_CASH_OUT');
create index if not exists chips_accounts_production_system_key_pattern_idx
  on public.chips_accounts (system_key text_pattern_ops)
  where system_key is not null;

create table if not exists public.chips_table_fence_control (
  control_id boolean primary key default true check (control_id is true),
  enforcement_active boolean not null default false,
  activated_at timestamptz,
  updated_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now())
);
insert into public.chips_table_fence_control (control_id, enforcement_active)
values (true, false)
on conflict (control_id) do nothing;
alter table public.chips_table_fence_control enable row level security;
revoke all on public.chips_table_fence_control from public, anon, authenticated, service_role;

create table if not exists public.chips_production_bot_only_retention_policy (
  policy_id text primary key check (policy_id = 'production-ledger-bot-only-retention-7d-v1'),
  enabled boolean not null default false,
  canary_batch_id bigint references public.chips_ledger_archive_batches(batch_id) on delete restrict,
  canary_confirmation text,
  activation_go_at timestamptz,
  activation_confirmation text,
  activated_at timestamptz,
  created_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  updated_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  check ((canary_batch_id is null and canary_confirmation is null)
    or canary_confirmation = 'GO ' || canary_batch_id::text),
  check (enabled is false and activation_go_at is null and activation_confirmation is null and activated_at is null
    or enabled is true and canary_batch_id is not null and activation_go_at is not null and activated_at is not null)
);
create table if not exists public.chips_production_closed_human_table_retention_policy (
  policy_id text primary key check (policy_id = 'production-ledger-closed-human-table-retention-30d-v1'),
  enabled boolean not null default false,
  canary_batch_id bigint references public.chips_ledger_archive_batches(batch_id) on delete restrict,
  canary_confirmation text,
  activation_go_at timestamptz,
  activation_confirmation text,
  activated_at timestamptz,
  created_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  updated_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  check ((canary_batch_id is null and canary_confirmation is null)
    or canary_confirmation = 'GO ' || canary_batch_id::text),
  check (enabled is false and activation_go_at is null and activation_confirmation is null and activated_at is null
    or enabled is true and canary_batch_id is not null and activation_go_at is not null and activated_at is not null)
);
create table if not exists public.chips_production_escrow_account_retention_policy (
  policy_id text primary key check (policy_id = 'production-ledger-escrow-account-retention-v1'),
  enabled boolean not null default false,
  canary_batch_id bigint references public.chips_ledger_archive_batches(batch_id) on delete restrict,
  canary_account_ids_sha256 text,
  canary_confirmation text,
  activation_go_at timestamptz,
  activation_confirmation text,
  activated_at timestamptz,
  created_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  updated_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  check ((canary_batch_id is null and canary_account_ids_sha256 is null and canary_confirmation is null)
    or (canary_batch_id is not null and canary_account_ids_sha256 ~ '^[0-9a-f]{64}$'
      and canary_confirmation = 'GO ' || canary_batch_id::text)),
  check (enabled is false and activation_go_at is null and activation_confirmation is null and activated_at is null
    or enabled is true and canary_batch_id is not null and activation_go_at is not null and activated_at is not null)
);
create table if not exists public.chips_production_retention_control (
  control_id boolean primary key default true check (control_id is true),
  enabled boolean not null default false,
  max_transactions integer not null default 2 check (max_transactions in (2, 5000)),
  installed_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  updated_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  activated_at timestamptz,
  activation_confirmation text,
  existing_30d_canary_batch_id bigint references public.chips_ledger_archive_batches(batch_id) on delete restrict,
  check ((enabled is false and activated_at is null and activation_confirmation is null)
    or (enabled is true and activated_at is not null and activation_confirmation is not null
      and max_transactions = 5000))
);
alter table public.chips_production_retention_control
  add column if not exists updated_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now());
insert into public.chips_production_bot_only_retention_policy (policy_id) values ('production-ledger-bot-only-retention-7d-v1') on conflict do nothing;
insert into public.chips_production_closed_human_table_retention_policy (policy_id) values ('production-ledger-closed-human-table-retention-30d-v1') on conflict do nothing;
insert into public.chips_production_escrow_account_retention_policy (policy_id) values ('production-ledger-escrow-account-retention-v1') on conflict do nothing;
insert into public.chips_production_retention_control (control_id, enabled, max_transactions)
values (true, false, 2) on conflict (control_id) do nothing;

do $rls$
declare
  table_name text;
begin
  foreach table_name in array array[
    'chips_production_bot_only_retention_policy',
    'chips_production_closed_human_table_retention_policy',
    'chips_production_escrow_account_retention_policy',
    'chips_production_retention_control'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', table_name);
  end loop;
end;
$rls$;
create policy chips_production_bot_policy_pruner_select on public.chips_production_bot_only_retention_policy for select to chips_ledger_archive_pruner using (true);
create policy chips_production_human_policy_pruner_select on public.chips_production_closed_human_table_retention_policy for select to chips_ledger_archive_pruner using (true);
create policy chips_production_escrow_policy_pruner_select on public.chips_production_escrow_account_retention_policy for select to chips_ledger_archive_pruner using (true);
create policy chips_production_control_pruner_select on public.chips_production_retention_control for select to chips_ledger_archive_pruner using (true);
grant select on public.chips_production_bot_only_retention_policy,
  public.chips_production_closed_human_table_retention_policy,
  public.chips_production_escrow_account_retention_policy,
  public.chips_production_retention_control to chips_ledger_archive_pruner;

create or replace function public.chips_assert_production_retention_control(
  p_policy_id text,
  p_transaction_count bigint,
  p_execute boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actual_system_identifier text;
  control_row public.chips_production_retention_control%rowtype;
  policy_known boolean;
  limit_value integer;
begin
  select system_identifier::text into actual_system_identifier from pg_catalog.pg_control_system();
  if actual_system_identifier is distinct from '7575202818581710058' then
    raise exception using errcode = 'P8910', message = 'Production retention requires the canonical database identity';
  end if;
  policy_known := p_policy_id in (
    'production-ledger-auto-retention-30d-v1',
    'production-ledger-bot-only-retention-7d-v1',
    'production-ledger-closed-human-table-retention-30d-v1',
    'production-ledger-escrow-account-retention-v1'
  );
  if not policy_known then
    raise exception using errcode = 'P8911', message = 'Unknown Production retention policy';
  end if;
  select * into control_row from public.chips_production_retention_control where control_id is true;
  if not found then raise exception using errcode = 'P8911', message = 'Production retention control is missing'; end if;
  limit_value := case when control_row.enabled then control_row.max_transactions else 2 end;
  if p_transaction_count is null or p_transaction_count < 1 or p_transaction_count > limit_value then
    raise exception using errcode = 'P8911', message = 'Production retention batch exceeds the current bound';
  end if;
  if p_execute and control_row.enabled is not true
     and coalesce(pg_catalog.current_setting('chips.production_canary', true), '') <> '1' then
    raise exception using errcode = 'P8912', message = 'Production destructive automation is disabled';
  end if;
  return pg_catalog.jsonb_build_object('project_ref', 'otbqfijerkieoxwpxjnm', 'system_identifier', actual_system_identifier,
    'policy_id', p_policy_id, 'max_transactions', limit_value, 'enabled', control_row.enabled);
end;
$$;
alter function public.chips_assert_production_retention_control(text, bigint, boolean) owner to postgres;
revoke all on function public.chips_assert_production_retention_control(text, bigint, boolean) from public, anon, authenticated, service_role;
grant execute on function public.chips_assert_production_retention_control(text, bigint, boolean) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_set_production_retention_enabled(p_enabled boolean, p_max_transactions integer default 2, p_confirmation text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if current_user <> 'postgres' or p_enabled is not false or p_max_transactions is distinct from 2
     or p_confirmation is distinct from 'DISABLE PRODUCTION RETENTION' then
    raise exception using errcode = 'P8913', message = 'Production retention activation is reserved for the later activation migration';
  end if;
  perform pg_catalog.set_config('chips.production_retention_control', '1', true);
  update public.chips_production_retention_control set enabled = false, max_transactions = 2, updated_at = pg_catalog.timezone('utc', pg_catalog.now()) where control_id is true;
  return pg_catalog.jsonb_build_object('state', 'disabled', 'max_transactions', 2);
end;
$$;
alter function public.chips_set_production_retention_enabled(boolean, integer, text) owner to postgres;
revoke all on function public.chips_set_production_retention_enabled(boolean, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.chips_set_production_retention_enabled(boolean, integer, text) to postgres;

create or replace function public.chips_table_fence_is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select enforcement_active from public.chips_table_fence_control where control_id is true), false)
$$;
alter function public.chips_table_fence_is_active() owner to postgres;
revoke all on function public.chips_table_fence_is_active() from public, anon, authenticated, service_role;
grant execute on function public.chips_table_fence_is_active() to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_guard_table_fence_control()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'UPDATE' or old.control_id is distinct from new.control_id or current_user <> 'postgres'
     or coalesce(pg_catalog.current_setting('chips.table_fence_control', true), '') <> '1' then
    raise exception using errcode = 'P8914', message = 'TABLE fence activation must use the owner-controlled gate';
  end if;
  return new;
end;
$$;
alter function public.chips_guard_table_fence_control() owner to postgres;
drop trigger if exists chips_table_fence_control_guard on public.chips_table_fence_control;
create trigger chips_table_fence_control_guard before update or delete on public.chips_table_fence_control for each row execute function public.chips_guard_table_fence_control();

create or replace function public.chips_lock_table_fence_for_retention()
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.chips_table_fence_control where control_id is true for update;
  if not public.chips_table_fence_is_active() then raise exception using errcode = 'P8915', message = 'TABLE fence is not active'; end if;
  return true;
end;
$$;
alter function public.chips_lock_table_fence_for_retention() owner to postgres;
revoke all on function public.chips_lock_table_fence_for_retention() from public, anon, authenticated, service_role;
grant execute on function public.chips_lock_table_fence_for_retention() to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_set_table_fence_active(p_active boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_active boolean;
begin
  if current_user <> 'postgres' or p_active is null then raise exception using errcode = 'P8916', message = 'TABLE fence transition is owner controlled'; end if;
  select enforcement_active into current_active from public.chips_table_fence_control where control_id is true for update;
  if p_active and coalesce(pg_catalog.current_setting('chips.production_fence_confirmation', true), '') !~ '^ACTIVATE TABLE FENCE otbqfijerkieoxwpxjnm [0-9a-f]{64}$' then
    raise exception using errcode = 'P8916', message = 'Exact Production TABLE fence confirmation is required';
  end if;
  if not p_active and current_active then
    raise exception using errcode = 'P8916', message = 'Production TABLE fence cannot be deactivated by PR A';
  end if;
  perform pg_catalog.set_config('chips.table_fence_control', '1', true);
  update public.chips_table_fence_control set enforcement_active = p_active, activated_at = case when p_active then coalesce(activated_at, pg_catalog.timezone('utc', pg_catalog.now())) else activated_at end, updated_at = pg_catalog.timezone('utc', pg_catalog.now()) where control_id is true;
  return pg_catalog.jsonb_build_object('state', case when p_active then 'active' else 'inactive' end, 'enforcement_active', p_active);
end;
$$;
alter function public.chips_set_table_fence_active(boolean) owner to postgres;
revoke all on function public.chips_set_table_fence_active(boolean) from public, anon, authenticated, service_role;
grant execute on function public.chips_set_table_fence_active(boolean) to postgres;

create or replace function public.chips_normalize_table_metadata(p_metadata jsonb)
returns jsonb language plpgsql immutable security definer set search_path = '' as $$
declare normalized jsonb := p_metadata;
begin
  if normalized is null then raise exception using errcode = 'P8902', message = 'TABLE metadata must be a JSON object'; end if;
  if pg_catalog.jsonb_typeof(normalized) = 'string' then
    begin normalized := (normalized #>> '{}')::jsonb; exception when others then raise exception using errcode = 'P8902', message = 'TABLE metadata legacy JSON string is invalid'; end;
  end if;
  if pg_catalog.jsonb_typeof(normalized) is distinct from 'object' then raise exception using errcode = 'P8902', message = 'TABLE metadata must be a JSON object'; end if;
  return normalized;
end;
$$;
alter function public.chips_normalize_table_metadata(jsonb) owner to postgres;
revoke all on function public.chips_normalize_table_metadata(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.chips_normalize_table_metadata(jsonb) to postgres;

create or replace function public.chips_parse_table_idempotency_key(p_key text)
returns jsonb language plpgsql immutable strict security definer set search_path = '' as $$
declare key_value text := pg_catalog.btrim(p_key); parts text[]; format_name text; table_position integer; table_value text;
begin
  if key_value = '' or pg_catalog.length(key_value) > 240 then raise exception using errcode = 'P8901', message = 'TABLE idempotency key is empty or too long'; end if;
  parts := pg_catalog.regexp_split_to_array(key_value, ':');
  if key_value like 'join-buyin:%' then format_name := 'join-buyin'; table_position := 2;
  elsif key_value like 'bot-seed-buyin:%' then format_name := 'bot-seed-buyin'; table_position := 2;
  elsif key_value like 'managed-bot-seed-buyin:%' then format_name := 'managed-bot-seed-buyin'; table_position := 2;
  elsif key_value like 'poker:leave:%' then format_name := 'poker:leave'; table_position := 3;
  elsif key_value like 'poker:inactive_cleanup:%' then format_name := 'poker:inactive_cleanup'; table_position := 3;
  elsif key_value like 'poker:rebuy:v1:%' then format_name := 'poker:rebuy:v1'; table_position := 4;
  elsif key_value like 'poker:deferred-leave:v1:%' then format_name := 'poker:deferred-leave:v1'; table_position := 4;
  elsif key_value like 'poker:bot-terminal-cashout:v1:%' then format_name := 'poker:bot-terminal-cashout:v1'; table_position := 4;
  elsif key_value like 'poker:human-terminal-cashout:v1:%' then format_name := 'poker:human-terminal-cashout:v1'; table_position := 4;
  elsif key_value like 'poker:bot-replacement-buyin:v1:%' then format_name := 'poker:bot-replacement-buyin:v1'; table_position := 4;
  elsif key_value like 'poker:managed-bot-top-up:v1:%' then format_name := 'poker:managed-bot-top-up:v1'; table_position := 4;
  else raise exception using errcode = 'P8901', message = 'TABLE idempotency key format is not supported'; end if;
  if pg_catalog.cardinality(parts) < table_position then raise exception using errcode = 'P8901', message = 'TABLE idempotency key suffix is incomplete'; end if;
  table_value := pg_catalog.lower(pg_catalog.btrim(parts[table_position]));
  if table_value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception using errcode = 'P8901', message = 'TABLE idempotency key table id is invalid'; end if;
  return pg_catalog.jsonb_build_object('version', 1, 'format', format_name, 'table_id', table_value, 'key', key_value);
end;
$$;
alter function public.chips_parse_table_idempotency_key(text) owner to postgres;
revoke all on function public.chips_parse_table_idempotency_key(text) from public, anon, authenticated, service_role;
grant execute on function public.chips_parse_table_idempotency_key(text) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_parse_table_reference(p_reference text)
returns uuid language plpgsql immutable strict security definer set search_path = '' as $$
declare marker text;
begin
  if pg_catalog.btrim(p_reference) !~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):' then raise exception using errcode = 'P8902', message = 'TABLE reference format is not supported'; end if;
  marker := pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(p_reference, ':', 2)));
  if marker !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception using errcode = 'P8902', message = 'TABLE reference marker is invalid'; end if;
  return marker::uuid;
end;
$$;
alter function public.chips_parse_table_reference(text) owner to postgres;
revoke all on function public.chips_parse_table_reference(text) from public, anon, authenticated, service_role;
grant execute on function public.chips_parse_table_reference(text) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_table_transaction_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parsed jsonb; table_id uuid; marker text; reference_id uuid; status_value text;
begin
  if new.tx_type::text not in ('TABLE_BUY_IN', 'TABLE_CASH_OUT') or not public.chips_table_fence_is_active() then return new; end if;
  parsed := public.chips_parse_table_idempotency_key(new.idempotency_key); table_id := (parsed->>'table_id')::uuid;
  if public.chips_normalize_table_metadata(new.metadata) ? 'tableId' then
    marker := pg_catalog.lower(pg_catalog.btrim(public.chips_normalize_table_metadata(new.metadata)->>'tableId'));
    if marker !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or marker::uuid <> table_id then raise exception using errcode = 'P8902', message = 'TABLE metadata.tableId does not match the idempotency key'; end if;
  end if;
  if new.reference is not null then reference_id := public.chips_parse_table_reference(new.reference); if reference_id <> table_id then raise exception using errcode = 'P8902', message = 'TABLE reference does not match the idempotency key'; end if; end if;
  select status::text into status_value from public.poker_tables where id = table_id for update;
  if not found or pg_catalog.upper(status_value) <> 'OPEN' then raise exception using errcode = 'P8903', message = 'TABLE transaction is rejected because the table is closed or missing'; end if;
  return new;
end;
$$;
alter function public.chips_table_transaction_before_insert() owner to postgres;
revoke all on function public.chips_table_transaction_before_insert() from public, anon, authenticated, service_role;
grant execute on function public.chips_table_transaction_before_insert() to postgres;

create or replace function public.chips_validate_table_transaction_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_transaction_id uuid;
  transaction_row record;
  normalized_transaction_metadata jsonb;
  parsed jsonb;
  key_table_id uuid;
  transaction_marker text;
  reference_table_id uuid;
  entry_count bigint;
  user_entry_count bigint;
  system_entry_count bigint;
  escrow_entry_count bigint;
  matching_escrow_count bigint;
  invalid_account_count bigint;
  invalid_entry_marker_count bigint;
  total_amount numeric;
  user_identity_count bigint;
  user_identity_mismatch_count bigint;
  buy_in_shape boolean;
  cash_out_shape boolean;
begin
  if not public.chips_table_fence_is_active() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if tg_table_name = 'chips_transactions' then
    target_transaction_id := new.id;
  elsif tg_op = 'DELETE' then
    target_transaction_id := old.transaction_id;
  else
    target_transaction_id := new.transaction_id;
  end if;
  select transactions.*
    into transaction_row
    from public.chips_transactions as transactions
   where transactions.id = target_transaction_id;
  if not found or transaction_row.tx_type::text not in ('TABLE_BUY_IN', 'TABLE_CASH_OUT') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  normalized_transaction_metadata := public.chips_normalize_table_metadata(transaction_row.metadata);
  parsed := public.chips_parse_table_idempotency_key(transaction_row.idempotency_key);
  key_table_id := (parsed->>'table_id')::uuid;

  if normalized_transaction_metadata ? 'tableId' then
    transaction_marker := pg_catalog.lower(pg_catalog.btrim(normalized_transaction_metadata->>'tableId'));
    if transaction_marker is null
       or transaction_marker = ''
       or transaction_marker !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or transaction_marker::uuid <> key_table_id then
      raise exception using
        errcode = 'P8904',
        message = 'TABLE transaction metadata does not bind to its idempotency key';
    end if;
  end if;

  if transaction_row.reference is not null then
    reference_table_id := public.chips_parse_table_reference(transaction_row.reference);
    if reference_table_id <> key_table_id then
      raise exception using errcode = 'P8904', message = 'TABLE transaction reference does not bind to its idempotency key';
    end if;
  end if;

  if not exists (
    select 1 from public.poker_tables tables where tables.id = key_table_id
  ) then
    raise exception using errcode = 'P8904', message = 'TABLE transaction table identity is missing';
  end if;

  select
    count(*),
    count(*) filter (where accounts.account_type::text = 'USER'),
    count(*) filter (where accounts.account_type::text = 'SYSTEM'),
    count(*) filter (where accounts.account_type::text = 'ESCROW'),
    count(*) filter (
      where accounts.account_type::text = 'ESCROW'
        and accounts.system_key = 'POKER_TABLE:' || key_table_id::text
    ),
    count(*) filter (where accounts.status::text <> 'active'),
    coalesce(sum(entries.amount), 0),
    count(*) filter (where accounts.account_type::text = 'USER' and accounts.user_id is not null),
    count(*) filter (
      where accounts.account_type::text = 'USER'
        and accounts.user_id is distinct from transaction_row.user_id
    )
    into entry_count, user_entry_count, system_entry_count, escrow_entry_count,
         matching_escrow_count, invalid_account_count, total_amount,
         user_identity_count, user_identity_mismatch_count
    from public.chips_entries as entries
    join public.chips_accounts as accounts on accounts.id = entries.account_id
   where entries.transaction_id = target_transaction_id;

  select count(*)
    into invalid_entry_marker_count
    from public.chips_entries as entries
    cross join lateral (
      select public.chips_normalize_table_metadata(entries.metadata) as metadata
    ) as normalized
   where entries.transaction_id = target_transaction_id
     and (
       normalized.metadata ? 'tableId'
       and (
         normalized.metadata->>'tableId' is null
         or pg_catalog.lower(pg_catalog.btrim(normalized.metadata->>'tableId')) <> key_table_id::text
       )
     );

  buy_in_shape := transaction_row.tx_type::text = 'TABLE_BUY_IN'
    and (
      (user_entry_count = 1 and system_entry_count = 0 and escrow_entry_count = 1)
      or (user_entry_count = 0 and system_entry_count = 1 and escrow_entry_count = 1)
    )
    and exists (
      select 1 from public.chips_entries entries
      join public.chips_accounts accounts on accounts.id = entries.account_id
      where entries.transaction_id = target_transaction_id
        and accounts.account_type::text = 'ESCROW'
        and entries.amount > 0
    )
    and exists (
      select 1 from public.chips_entries entries
      join public.chips_accounts accounts on accounts.id = entries.account_id
      where entries.transaction_id = target_transaction_id
        and accounts.account_type::text in ('USER', 'SYSTEM')
        and entries.amount < 0
    );
  cash_out_shape := transaction_row.tx_type::text = 'TABLE_CASH_OUT'
    and (
      (user_entry_count = 1 and system_entry_count = 0 and escrow_entry_count = 1)
      or (user_entry_count = 0 and system_entry_count = 1 and escrow_entry_count = 1)
    )
    and exists (
      select 1 from public.chips_entries entries
      join public.chips_accounts accounts on accounts.id = entries.account_id
      where entries.transaction_id = target_transaction_id
        and accounts.account_type::text = 'ESCROW'
        and entries.amount < 0
    )
    and exists (
      select 1 from public.chips_entries entries
      join public.chips_accounts accounts on accounts.id = entries.account_id
      where entries.transaction_id = target_transaction_id
        and accounts.account_type::text in ('USER', 'SYSTEM')
        and entries.amount > 0
    );

  if entry_count <> 2
     or matching_escrow_count <> 1
     or invalid_account_count <> 0
     or invalid_entry_marker_count <> 0
     or total_amount <> 0
     or user_identity_mismatch_count <> 0
     or (transaction_row.user_id is null and user_entry_count <> 0)
     or (transaction_row.user_id is not null and (user_entry_count <> 1 or user_identity_count <> 1))
     or not (buy_in_shape or cash_out_shape) then
    raise exception using
      errcode = 'P8904',
      message = 'TABLE transaction entries do not bind to one authoritative ESCROW table';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
alter function public.chips_validate_table_transaction_binding() owner to postgres;
revoke all on function public.chips_validate_table_transaction_binding() from public, anon, authenticated, service_role;
grant execute on function public.chips_validate_table_transaction_binding() to postgres;

drop trigger if exists chips_transactions_table_fence on public.chips_transactions;
create trigger chips_transactions_table_fence before insert on public.chips_transactions for each row execute function public.chips_table_transaction_before_insert();
drop trigger if exists chips_transactions_table_binding on public.chips_transactions;
create constraint trigger chips_transactions_table_binding after insert or update or delete on public.chips_transactions deferrable initially deferred for each row execute function public.chips_validate_table_transaction_binding();
drop trigger if exists chips_entries_table_binding on public.chips_entries;
create constraint trigger chips_entries_table_binding after insert or update or delete on public.chips_entries deferrable initially deferred for each row execute function public.chips_validate_table_transaction_binding();

create or replace function public.chips_capture_transaction_idempotency()
returns trigger language plpgsql set search_path = '' as $$
declare parsed jsonb;
begin
  if new.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT') and public.chips_table_fence_is_active() then parsed := public.chips_parse_table_idempotency_key(new.idempotency_key); end if;
  insert into public.chips_transaction_idempotency (idempotency_key, transaction_id, payload_hash, tx_type, user_id, transaction_created_at, table_id, key_format_version, key_format)
  values (new.idempotency_key, new.id, new.payload_hash, new.tx_type, new.user_id, new.created_at,
    case when parsed is null then null else (parsed->>'table_id')::uuid end,
    case when parsed is null then null else (parsed->>'version')::integer end,
    case when parsed is null then null else parsed->>'format' end);
  return new;
end;
$$;
alter function public.chips_capture_transaction_idempotency() owner to postgres;
revoke all on function public.chips_capture_transaction_idempotency() from public, anon, authenticated, service_role;

create or replace function public.chips_guard_idempotency_mutations()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Idempotency registry rows are durable; DELETE is not permitted'; end if;
  if new.idempotency_key is distinct from old.idempotency_key or new.transaction_id is distinct from old.transaction_id
    or new.payload_hash is distinct from old.payload_hash or new.tx_type is distinct from old.tx_type
    or new.user_id is distinct from old.user_id or new.transaction_created_at is distinct from old.transaction_created_at
    or new.created_at is distinct from old.created_at or new.table_id is distinct from old.table_id
    or new.key_format_version is distinct from old.key_format_version or new.key_format is distinct from old.key_format then
    raise exception 'Idempotency registry identity is immutable';
  end if;
  if old.archive_batch_id is not null and new.archive_batch_id is distinct from old.archive_batch_id then raise exception 'Idempotency archive mapping cannot be replaced or cleared'; end if;
  if old.replay_transaction is not null and (new.replay_transaction is distinct from old.replay_transaction or new.replay_entries is distinct from old.replay_entries or new.replay_completed_at is distinct from old.replay_completed_at) then raise exception 'Completed idempotency replay cannot be replaced or cleared'; end if;
  return new;
end;
$$;
alter function public.chips_guard_idempotency_mutations() owner to postgres;
revoke all on function public.chips_guard_idempotency_mutations() from public, anon, authenticated, service_role;

create or replace function public.chips_guard_poker_table_mutations()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Poker table rows are durable; DELETE is not permitted'; end if;
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then raise exception 'Poker table identity is immutable'; end if;
  if old.bot_only_proof_eligible and new.bot_only_proof_eligible is distinct from old.bot_only_proof_eligible then raise exception 'Bot eligibility is immutable'; end if;
  if old.bot_only_retention_complete_at is not null and new.bot_only_retention_complete_at is distinct from old.bot_only_retention_complete_at then raise exception 'Bot retention completion is immutable'; end if;
  if old.human_retention_complete_at is not null and new.human_retention_complete_at is distinct from old.human_retention_complete_at then raise exception 'Human retention completion is immutable'; end if;
  return new;
end;
$$;
alter function public.chips_guard_poker_table_mutations() owner to postgres;
revoke all on function public.chips_guard_poker_table_mutations() from public, anon, authenticated, service_role;
drop trigger if exists poker_tables_production_retention_guard on public.poker_tables;
create trigger poker_tables_production_retention_guard before update or delete on public.poker_tables for each row execute function public.chips_guard_poker_table_mutations();

create or replace function public.chips_guard_archive_batch_mutations()
returns trigger language plpgsql set search_path = '' as $$
declare old_proof integer; new_proof integer; old_prune integer; new_prune integer; old_cleanup integer; new_cleanup integer; old_account integer; new_account integer;
begin
  if tg_op = 'DELETE' then raise exception 'Archive batch rows are durable; DELETE is not permitted'; end if;
  if new.object_path is distinct from old.object_path or new.batch_id is distinct from old.batch_id or new.project_ref is distinct from old.project_ref
    or new.format_version is distinct from old.format_version or new.cutoff is distinct from old.cutoff or new.transaction_count is distinct from old.transaction_count
    or new.entry_count is distinct from old.entry_count or new.raw_sha256 is distinct from old.raw_sha256 or new.compressed_sha256 is distinct from old.compressed_sha256
    or new.source_policy_id is distinct from old.source_policy_id then raise exception 'Archive batch identity is immutable'; end if;
  if new.status is distinct from old.status and (old.status <> 'pending' or new.status <> 'committed' or new.committed_at is null) then raise exception 'Archive batch status transition is invalid'; end if;
  old_proof := pg_catalog.num_nonnulls(old.archived_transaction_ids_sha256, old.archived_entry_ids_sha256, old.archive_proof_verified_at);
  new_proof := pg_catalog.num_nonnulls(new.archived_transaction_ids_sha256, new.archived_entry_ids_sha256, new.archive_proof_verified_at);
  if old_proof = 0 and new_proof not in (0, 3) then raise exception 'Archive ID proof must transition atomically'; end if;
  if old_proof = 3 and (new.archived_transaction_ids_sha256 is distinct from old.archived_transaction_ids_sha256 or new.archived_entry_ids_sha256 is distinct from old.archived_entry_ids_sha256 or new.archive_proof_verified_at is distinct from old.archive_proof_verified_at) then raise exception 'Archive ID proof is immutable'; end if;
  old_prune := pg_catalog.num_nonnulls(old.pruned_at, old.pruned_transaction_count, old.pruned_entry_count, old.pruned_transaction_ids_sha256, old.pruned_entry_ids_sha256);
  new_prune := pg_catalog.num_nonnulls(new.pruned_at, new.pruned_transaction_count, new.pruned_entry_count, new.pruned_transaction_ids_sha256, new.pruned_entry_ids_sha256);
  if old_prune = 0 and new_prune not in (0, 5) then raise exception 'Archive prune receipt must transition atomically'; end if;
  if old_prune = 5 and (new.pruned_at is distinct from old.pruned_at or new.pruned_transaction_count is distinct from old.pruned_transaction_count or new.pruned_entry_count is distinct from old.pruned_entry_count or new.pruned_transaction_ids_sha256 is distinct from old.pruned_transaction_ids_sha256 or new.pruned_entry_ids_sha256 is distinct from old.pruned_entry_ids_sha256) then raise exception 'Archive prune receipt is immutable'; end if;
  old_cleanup := pg_catalog.num_nonnulls(old.registry_cleaned_at, old.registry_cleaned_key_count, old.registry_cleaned_keys_sha256);
  new_cleanup := pg_catalog.num_nonnulls(new.registry_cleaned_at, new.registry_cleaned_key_count, new.registry_cleaned_keys_sha256);
  if old_cleanup = 0 and new_cleanup not in (0, 3) then raise exception 'Registry cleanup receipt must transition atomically'; end if;
  if old_cleanup = 3 and (new.registry_cleaned_at is distinct from old.registry_cleaned_at or new.registry_cleaned_key_count is distinct from old.registry_cleaned_key_count or new.registry_cleaned_keys_sha256 is distinct from old.registry_cleaned_keys_sha256) then raise exception 'Registry cleanup receipt is immutable'; end if;
  old_account := pg_catalog.num_nonnulls(old.account_retirement_at, old.account_retirement_account_count, old.account_retirement_account_ids_sha256, old.account_retirement_recovery_object_path, old.account_retirement_recovery_object_sha256, old.account_retirement_snapshot_sha256);
  new_account := pg_catalog.num_nonnulls(new.account_retirement_at, new.account_retirement_account_count, new.account_retirement_account_ids_sha256, new.account_retirement_recovery_object_path, new.account_retirement_recovery_object_sha256, new.account_retirement_snapshot_sha256);
  if old_account = 0 and new_account not in (0, 6) then raise exception 'Account retirement receipt must transition atomically'; end if;
  if old_account = 6 and new_account <> 6 then raise exception 'Account retirement receipt is immutable'; end if;
  if new.source_policy_id is not null and new.destructive_go_at is not null and current_user <> 'postgres' then raise exception 'Production destructive GO is owner controlled'; end if;
  return new;
end;
$$;
alter function public.chips_guard_archive_batch_mutations() owner to chips_ledger_archive_pruner;
revoke all on function public.chips_guard_archive_batch_mutations() from public, anon, authenticated, service_role;

create or replace function public.chips_archive_text_ids_sha256(p_ids text[])
returns text language plpgsql immutable strict security definer set search_path = '' as $$
declare payload text;
begin
  if pg_catalog.cardinality(p_ids) < 1 or pg_catalog.array_ndims(p_ids) <> 1 or pg_catalog.array_position(p_ids, null) is not null then raise exception 'Text ID proof array is invalid'; end if;
  select pg_catalog.string_agg(value || E'\n', '' order by value) into payload from pg_catalog.unnest(p_ids) as values(value);
  return pg_catalog.encode(extensions.digest(pg_catalog.convert_to(payload, 'UTF8'), 'sha256'), 'hex');
end;
$$;
alter function public.chips_archive_text_ids_sha256(text[]) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_archive_text_ids_sha256(text[]) from public, anon, authenticated, service_role;
grant execute on function public.chips_archive_text_ids_sha256(text[]) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_assert_archive_prune_target(p_project_ref text, p_transaction_count bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare system_identifier text;
begin
  select system_identifier::text into system_identifier from pg_catalog.pg_control_system();
  if system_identifier is distinct from '7575202818581710058' or p_project_ref is distinct from 'otbqfijerkieoxwpxjnm' then raise exception 'Ledger archive pruning requires canonical Production identity'; end if;
  if p_transaction_count is null or p_transaction_count < 1 or p_transaction_count > 2 then raise exception 'Production archive pruning allows at most 2 transactions before activation'; end if;
  return system_identifier;
end;
$$;
alter function public.chips_assert_archive_prune_target(text, bigint) owner to postgres;
revoke all on function public.chips_assert_archive_prune_target(text, bigint) from public, anon, authenticated, service_role;
grant execute on function public.chips_assert_archive_prune_target(text, bigint) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_assert_archive_prune_stage()
returns text language plpgsql security definer set search_path = '' as $$
declare system_identifier text;
begin
  select system_identifier::text into system_identifier from pg_catalog.pg_control_system();
  if system_identifier is distinct from '7575202818581710058' then raise exception 'Ledger archive pruning is restricted to canonical Production identity'; end if;
  return system_identifier;
end;
$$;
alter function public.chips_assert_archive_prune_stage() owner to postgres;
revoke all on function public.chips_assert_archive_prune_stage() from public, anon, authenticated, service_role;
grant execute on function public.chips_assert_archive_prune_stage() to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_register_archive_id_proof(
  p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_project_ref text, p_format_version integer,
  p_cutoff timestamptz, p_cursor_start_created_at timestamptz, p_cursor_start_id uuid, p_cursor_end_created_at timestamptz,
  p_cursor_end_id uuid, p_first_created_at timestamptz, p_last_created_at timestamptz, p_tx_types jsonb,
  p_raw_bytes bigint, p_compressed_bytes bigint, p_raw_sha256 text, p_compressed_sha256 text,
  p_credits numeric, p_debits numeric, p_net_amount numeric
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare batch public.chips_ledger_archive_batches%rowtype; transaction_hash text; entry_hash text; updated_count bigint;
begin
  perform public.chips_assert_archive_prune_target(p_project_ref, pg_catalog.cardinality(p_transaction_ids));
  if p_transaction_ids is null or pg_catalog.cardinality(p_transaction_ids) not between 1 and 2 or p_entry_ids is null or pg_catalog.cardinality(p_entry_ids) < 1 then raise exception 'Production archive proof arrays are invalid'; end if;
  transaction_hash := public.chips_archive_uuid_ids_sha256(p_transaction_ids); entry_hash := public.chips_archive_bigint_ids_sha256(p_entry_ids);
  select * into batch from public.chips_ledger_archive_batches where object_path = p_object_path for update;
  if not found or batch.status <> 'committed' or batch.project_ref <> 'otbqfijerkieoxwpxjnm' then raise exception 'Archive manifest is not committed canonical Production evidence'; end if;
  if batch.object_path <> 'v1/sha256/' || p_compressed_sha256 || '.jsonl.gz' or batch.transaction_count <> pg_catalog.cardinality(p_transaction_ids) or batch.entry_count <> pg_catalog.cardinality(p_entry_ids) or batch.raw_sha256 <> p_raw_sha256 or batch.compressed_sha256 <> p_compressed_sha256 then raise exception 'Archive proof does not match committed manifest'; end if;
  if batch.archive_proof_verified_at is not null then
    if batch.archived_transaction_ids_sha256 is distinct from transaction_hash or batch.archived_entry_ids_sha256 is distinct from entry_hash then raise exception 'Committed archive already has a different immutable proof'; end if;
    return pg_catalog.jsonb_build_object('state', 'proof_exists', 'transactions', batch.transaction_count, 'entries', batch.entry_count);
  end if;
  update public.chips_ledger_archive_batches set archived_transaction_ids_sha256 = transaction_hash, archived_entry_ids_sha256 = entry_hash, archive_proof_verified_at = pg_catalog.timezone('utc', pg_catalog.now()) where batch_id = batch.batch_id and archive_proof_verified_at is null;
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then raise exception 'Archive proof transition was not unique'; end if;
  return pg_catalog.jsonb_build_object('state', 'proof_registered', 'transactions', batch.transaction_count, 'entries', batch.entry_count, 'transaction_ids_sha256', transaction_hash, 'entry_ids_sha256', entry_hash);
end;
$$;
alter function public.chips_register_archive_id_proof(text, uuid[], bigint[], text, integer, timestamptz, timestamptz, uuid, timestamptz, uuid, timestamptz, timestamptz, jsonb, bigint, bigint, text, text, numeric, numeric, numeric) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_register_archive_id_proof(text, uuid[], bigint[], text, integer, timestamptz, timestamptz, uuid, timestamptz, uuid, timestamptz, timestamptz, jsonb, bigint, bigint, text, text, numeric, numeric, numeric) from public, anon, authenticated, service_role;
grant execute on function public.chips_register_archive_id_proof(text, uuid[], bigint[], text, integer, timestamptz, timestamptz, uuid, timestamptz, uuid, timestamptz, timestamptz, jsonb, bigint, bigint, text, text, numeric, numeric, numeric) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_prune_committed_archive_batch_internal(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_execute boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare batch public.chips_ledger_archive_batches%rowtype; mapping_count bigint; hot_count bigint; entry_count bigint;
begin
  if p_transaction_ids is null or pg_catalog.cardinality(p_transaction_ids) not between 1 and 2 then raise exception 'Production prune batch bound is invalid'; end if;
  if p_entry_ids is null or pg_catalog.cardinality(p_entry_ids) < 1 then raise exception 'Production prune entry bound is invalid'; end if;
  if (select count(*) from pg_catalog.unnest(p_transaction_ids) as ids(id)) <> (select count(distinct id) from pg_catalog.unnest(p_transaction_ids) as ids(id))
     or (select count(*) from pg_catalog.unnest(p_entry_ids) as ids(id)) <> (select count(distinct id) from pg_catalog.unnest(p_entry_ids) as ids(id)) then
    raise exception 'Production prune batch contains duplicate IDs';
  end if;
  select * into batch from public.chips_ledger_archive_batches where object_path = p_object_path for update;
  if not found or batch.project_ref <> 'otbqfijerkieoxwpxjnm' or batch.status <> 'committed' or batch.archive_proof_verified_at is null then raise exception 'Archive batch is not ready for Production prune'; end if;
  perform public.chips_assert_production_retention_control(coalesce(batch.source_policy_id, 'production-ledger-auto-retention-30d-v1'), pg_catalog.cardinality(p_transaction_ids), p_execute);
  if batch.transaction_count is distinct from pg_catalog.cardinality(p_transaction_ids)
     or batch.entry_count is distinct from pg_catalog.cardinality(p_entry_ids)
     or batch.archived_transaction_ids_sha256 is distinct from public.chips_archive_uuid_ids_sha256(p_transaction_ids)
     or batch.archived_entry_ids_sha256 is distinct from public.chips_archive_bigint_ids_sha256(p_entry_ids) then
    raise exception 'Production prune IDs do not match immutable archive proof';
  end if;
  if batch.pruned_at is not null then return pg_catalog.jsonb_build_object('state', 'already_pruned', 'transactions', batch.transaction_count); end if;
  select count(*) into mapping_count from public.chips_transaction_idempotency where transaction_id = any(p_transaction_ids) and archive_batch_id = batch.batch_id;
  select count(*) into hot_count from public.chips_transactions where id = any(p_transaction_ids);
  select count(*) into entry_count from public.chips_entries where transaction_id = any(p_transaction_ids) or id = any(p_entry_ids);
  if mapping_count <> pg_catalog.cardinality(p_transaction_ids) or hot_count <> pg_catalog.cardinality(p_transaction_ids) or entry_count <> pg_catalog.cardinality(p_entry_ids) then
    raise exception 'Production prune hot ledger batch is incomplete';
  end if;
  if not p_execute then return pg_catalog.jsonb_build_object('state', 'ready', 'transactions', hot_count, 'entries', entry_count, 'registry_mappings', mapping_count); end if;
  if p_execute and batch.source_policy_id = 'production-ledger-auto-retention-30d-v1'
     and exists (select 1 from public.chips_production_retention_control where control_id is true and enabled is not true)
     and (coalesce(pg_catalog.current_setting('chips.production_canary', true), '') <> '1'
       or batch.destructive_go_at is null
       or batch.destructive_go_batch_id is distinct from batch.batch_id) then
    raise exception using errcode = 'P8912', message = 'Production existing-30d GO is required';
  end if;
  perform pg_catalog.set_config('chips.production_prune', '1', true);
  delete from public.chips_transaction_idempotency where transaction_id = any(p_transaction_ids);
  delete from public.chips_entries where transaction_id = any(p_transaction_ids);
  delete from public.chips_transactions where id = any(p_transaction_ids);
  update public.chips_ledger_archive_batches set pruned_at = pg_catalog.timezone('utc', pg_catalog.now()), pruned_transaction_count = batch.transaction_count, pruned_entry_count = batch.entry_count, pruned_transaction_ids_sha256 = batch.archived_transaction_ids_sha256, pruned_entry_ids_sha256 = batch.archived_entry_ids_sha256 where batch_id = batch.batch_id and pruned_at is null;
  return pg_catalog.jsonb_build_object('state', 'pruned', 'transactions', hot_count, 'entries', entry_count);
end;
$$;
alter function public.chips_prune_committed_archive_batch_internal(text, uuid[], bigint[], boolean) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_prune_committed_archive_batch_internal(text, uuid[], bigint[], boolean) from public, anon, authenticated, service_role;

create or replace function public.chips_prune_committed_archive_batch(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_execute boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_project_ref text;
begin
  select project_ref into target_project_ref from public.chips_ledger_archive_batches where object_path = p_object_path for update;
  if not found then raise exception 'Committed archive manifest was not found'; end if;
  perform public.chips_assert_archive_prune_target(target_project_ref, pg_catalog.cardinality(p_transaction_ids));
  return public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, p_execute);
end;
$$;
alter function public.chips_prune_committed_archive_batch(text, uuid[], bigint[], boolean) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_prune_committed_archive_batch(text, uuid[], bigint[], boolean) from public, anon, authenticated, service_role;
grant execute on function public.chips_prune_committed_archive_batch(text, uuid[], bigint[], boolean) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_authorize_production_existing_30d_canary(p_batch_id bigint, p_confirmation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare batch public.chips_ledger_archive_batches%rowtype;
begin
  if current_user <> 'postgres' or p_confirmation is distinct from 'GO ' || p_batch_id::text then raise exception using errcode = 'P8917', message = 'Exact Production existing-30d GO is required'; end if;
  select * into batch from public.chips_ledger_archive_batches where batch_id = p_batch_id for update;
  if not found or batch.project_ref <> 'otbqfijerkieoxwpxjnm' or batch.status <> 'committed' or batch.transaction_count not between 1 and 2 or batch.source_policy_id is distinct from 'production-ledger-auto-retention-30d-v1' or batch.archive_proof_verified_at is null or batch.pruned_at is not null then raise exception using errcode = 'P8917', message = 'Only a fresh bounded Production existing-30d batch may be authorized'; end if;
  perform pg_catalog.set_config('chips.production_canary', '1', true);
  update public.chips_ledger_archive_batches set destructive_go_at = pg_catalog.timezone('utc', pg_catalog.now()), destructive_go_batch_id = batch.batch_id where batch_id = batch.batch_id and destructive_go_at is null;
  update public.chips_production_retention_control set existing_30d_canary_batch_id = batch.batch_id where control_id is true and existing_30d_canary_batch_id is null;
  return pg_catalog.jsonb_build_object('state', 'authorized', 'batch_id', batch.batch_id, 'confirmation', p_confirmation);
end;
$$;
alter function public.chips_authorize_production_existing_30d_canary(bigint, text) owner to postgres;
revoke all on function public.chips_authorize_production_existing_30d_canary(bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.chips_authorize_production_existing_30d_canary(bigint, text) to postgres;

create or replace function public.chips_authorize_bot_only_archive_batch(p_batch_id bigint, p_confirmation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare batch public.chips_ledger_archive_batches%rowtype;
begin
  if current_user <> 'postgres' or p_confirmation is distinct from 'GO ' || p_batch_id::text then raise exception using errcode = 'P8920', message = 'Exact Production bot-only GO is required'; end if;
  select * into batch from public.chips_ledger_archive_batches where batch_id = p_batch_id for update;
  if not found or batch.project_ref <> 'otbqfijerkieoxwpxjnm' or batch.format_version <> 2 or batch.source_policy_id <> 'production-ledger-bot-only-retention-7d-v1' or batch.transaction_count not between 1 and 2 or batch.archive_proof_verified_at is null or batch.pruned_at is not null then raise exception using errcode = 'P8920', message = 'Only one bounded Production bot-only batch may be authorized'; end if;
  perform pg_catalog.set_config('chips.production_bot_only_go', '1', true);
  update public.chips_ledger_archive_batches set destructive_go_at = pg_catalog.timezone('utc', pg_catalog.now()), destructive_go_batch_id = batch.batch_id where batch_id = batch.batch_id and destructive_go_at is null;
  update public.chips_production_bot_only_retention_policy set canary_batch_id = batch.batch_id, canary_confirmation = p_confirmation, updated_at = pg_catalog.timezone('utc', pg_catalog.now()) where policy_id = 'production-ledger-bot-only-retention-7d-v1' and canary_batch_id is null;
  return pg_catalog.jsonb_build_object('state', 'authorized', 'batch_id', batch.batch_id);
end;
$$;
alter function public.chips_authorize_bot_only_archive_batch(bigint, text) owner to postgres;
revoke all on function public.chips_authorize_bot_only_archive_batch(bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.chips_authorize_bot_only_archive_batch(bigint, text) to postgres;

create or replace function public.chips_assert_bot_only_table_lifecycle_gate(p_table_id uuid, p_batch_id bigint, p_cutoff timestamptz, p_registry_keys text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare table_row record; registry_count bigint; human_count bigint; young_count bigint;
begin
  if not public.chips_table_fence_is_active() then raise exception using errcode = 'P8921', message = 'Bot-only lifecycle gate requires the active TABLE fence'; end if;
  select id, status::text, has_human_participant, bot_only_proof_eligible into table_row from public.poker_tables where id = p_table_id for update;
  if not found or upper(table_row.status) <> 'CLOSED' or table_row.has_human_participant is true or table_row.bot_only_proof_eligible is not true then raise exception using errcode = 'P8921', message = 'Production bot-only table lifecycle is incomplete'; end if;
  select count(*) into registry_count from public.chips_transaction_idempotency where table_id = p_table_id and tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT');
  select count(*) into human_count from public.chips_transaction_idempotency where table_id = p_table_id and user_id is not null;
  select count(*) into young_count from public.chips_transaction_idempotency where table_id = p_table_id and transaction_created_at >= p_cutoff;
  if registry_count < 1 or human_count <> 0 or young_count <> 0 or p_registry_keys is null or pg_catalog.cardinality(p_registry_keys) <> registry_count then raise exception using errcode = 'P8921', message = 'Production bot-only registry lifecycle is incomplete'; end if;
  return pg_catalog.jsonb_build_object('state', 'table_complete', 'table_id', p_table_id, 'identity_count', registry_count);
end;
$$;
alter function public.chips_assert_bot_only_table_lifecycle_gate(uuid, bigint, timestamptz, text[]) owner to postgres;
revoke all on function public.chips_assert_bot_only_table_lifecycle_gate(uuid, bigint, timestamptz, text[]) from public, anon, authenticated, service_role;
grant execute on function public.chips_assert_bot_only_table_lifecycle_gate(uuid, bigint, timestamptz, text[]) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_register_bot_only_archive_proof(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_table_id uuid, p_registry_keys text[], p_out_of_scope_keys_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare batch public.chips_ledger_archive_batches%rowtype; transaction_hash text; entry_hash text; registry_hash text; updated_count bigint;
begin
  perform public.chips_assert_production_retention_control('production-ledger-bot-only-retention-7d-v1', pg_catalog.cardinality(p_transaction_ids), false);
  if p_transaction_ids is null or pg_catalog.cardinality(p_transaction_ids) not between 1 and 2 or p_entry_ids is null or p_registry_keys is null or pg_catalog.cardinality(p_registry_keys) <> pg_catalog.cardinality(p_transaction_ids) or p_out_of_scope_keys_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Production bot-only proof arrays are invalid'; end if;
  select * into batch from public.chips_ledger_archive_batches where object_path = p_object_path for update;
  if not found or batch.project_ref <> 'otbqfijerkieoxwpxjnm' or batch.format_version <> 2 or batch.source_policy_id <> 'production-ledger-bot-only-retention-7d-v1' then raise exception 'Production bot-only proof requires the exact schema-v2 batch'; end if;
  perform public.chips_assert_bot_only_table_lifecycle_gate(p_table_id, batch.batch_id, batch.cutoff, p_registry_keys);
  transaction_hash := public.chips_archive_uuid_ids_sha256(p_transaction_ids); entry_hash := public.chips_archive_bigint_ids_sha256(p_entry_ids); registry_hash := public.chips_archive_text_ids_sha256(p_registry_keys);
  update public.chips_ledger_archive_batches set archived_transaction_ids_sha256 = transaction_hash, archived_entry_ids_sha256 = entry_hash, archive_proof_verified_at = coalesce(archive_proof_verified_at, pg_catalog.timezone('utc', pg_catalog.now())), bot_only_table_id = p_table_id, bot_only_table_count = 1, bot_only_newest_created_at = batch.last_created_at, bot_only_registry_keys_sha256 = registry_hash, bot_only_out_of_scope_keys_sha256 = p_out_of_scope_keys_sha256, bot_only_identity_count = batch.transaction_count, bot_only_eligible_count = batch.transaction_count where batch_id = batch.batch_id;
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then raise exception 'Production bot-only proof transition was not unique'; end if;
  return pg_catalog.jsonb_build_object('state', 'proof_registered', 'transactions', batch.transaction_count, 'registry_keys_sha256', registry_hash);
end;
$$;
alter function public.chips_register_bot_only_archive_proof(text, uuid[], bigint[], uuid, text[], text) owner to postgres;
revoke all on function public.chips_register_bot_only_archive_proof(text, uuid[], bigint[], uuid, text[], text) from public, anon, authenticated, service_role;
grant execute on function public.chips_register_bot_only_archive_proof(text, uuid[], bigint[], uuid, text[], text) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_prune_and_cleanup_bot_only_archive_batch(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_registry_keys text[], p_table_id uuid, p_execute boolean default false, p_approved_batch_id bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare batch public.chips_ledger_archive_batches%rowtype; prune_result jsonb; registry_hash text;
begin
  select * into batch from public.chips_ledger_archive_batches where object_path = p_object_path for update;
  if not found or batch.source_policy_id <> 'production-ledger-bot-only-retention-7d-v1' or batch.bot_only_table_id is distinct from p_table_id or batch.archive_proof_verified_at is null then raise exception 'Production bot-only cleanup proof is incomplete'; end if;
  perform public.chips_assert_production_retention_control(batch.source_policy_id, pg_catalog.cardinality(p_transaction_ids), p_execute);
  registry_hash := public.chips_archive_text_ids_sha256(p_registry_keys);
  if batch.bot_only_registry_keys_sha256 is distinct from registry_hash then raise exception 'Production bot-only registry proof differs'; end if;
  if batch.registry_cleaned_at is not null then return pg_catalog.jsonb_build_object('state', 'already_cleaned', 'batch_id', batch.batch_id); end if;
  if not p_execute then return pg_catalog.jsonb_build_object('state', 'ready', 'batch_id', batch.batch_id); end if;
  if p_approved_batch_id is distinct from batch.batch_id or batch.destructive_go_batch_id is distinct from batch.batch_id then raise exception 'Production bot-only GO is required'; end if;
  perform pg_catalog.set_config('chips.production_bot_only_cleanup', '1', true);
  prune_result := public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, true);
  update public.chips_ledger_archive_batches set registry_cleaned_at = pg_catalog.timezone('utc', pg_catalog.now()), registry_cleaned_key_count = pg_catalog.cardinality(p_registry_keys), registry_cleaned_keys_sha256 = registry_hash where batch_id = batch.batch_id;
  perform pg_catalog.set_config('chips.production_table_lifecycle', '1', true);
  update public.poker_tables set bot_only_retention_complete_at = coalesce(bot_only_retention_complete_at, pg_catalog.timezone('utc', pg_catalog.now())) where id = p_table_id;
  return prune_result || pg_catalog.jsonb_build_object('cleanup', 'complete', 'table_id', p_table_id);
end;
$$;
alter function public.chips_prune_and_cleanup_bot_only_archive_batch(text, uuid[], bigint[], text[], uuid, boolean, bigint) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_prune_and_cleanup_bot_only_archive_batch(text, uuid[], bigint[], text[], uuid, boolean, bigint) from public, anon, authenticated, service_role;
grant execute on function public.chips_prune_and_cleanup_bot_only_archive_batch(text, uuid[], bigint[], text[], uuid, boolean, bigint) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_assert_closed_human_table_lifecycle_gate(p_table_id uuid, p_cutoff timestamptz, p_current_batch_id bigint default null)
returns void language plpgsql security definer set search_path = '' as $$
declare bad_count bigint;
begin
  if p_table_id is null or p_cutoff is null then raise exception using errcode = 'P9230', message = 'Human retention gate arguments are required'; end if;
  if not exists (select 1 from public.poker_tables t join public.chips_accounts a on a.account_type::text = 'ESCROW' and a.system_key = 'POKER_TABLE:' || t.id::text and a.status::text = 'active' and a.balance = 0 where t.id = p_table_id and upper(t.status::text) = 'CLOSED' and t.has_human_participant is true) then raise exception using errcode = 'P9231', message = 'Human table terminal lifecycle is incomplete'; end if;
  select count(*) into bad_count from public.chips_transaction_idempotency r left join public.chips_ledger_archive_batches b on b.batch_id = r.archive_batch_id where r.table_id = p_table_id and r.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT') and (r.transaction_created_at >= p_cutoff or (r.archive_batch_id is null and p_current_batch_id is null) or (r.archive_batch_id is not null and not (b.status = 'committed' and b.archive_proof_verified_at is not null and b.pruned_at is not null and b.pruned_transaction_ids_sha256 = b.archived_transaction_ids_sha256 and b.pruned_entry_ids_sha256 = b.archived_entry_ids_sha256 and b.source_policy_id in ('production-ledger-auto-retention-30d-v1', 'production-ledger-closed-human-table-retention-30d-v1'))));
  if bad_count <> 0 then raise exception using errcode = 'P9232', message = 'Human TABLE identity set is incomplete, young, or incompatible'; end if;
end;
$$;
alter function public.chips_assert_closed_human_table_lifecycle_gate(uuid, timestamptz, bigint) owner to postgres;
revoke all on function public.chips_assert_closed_human_table_lifecycle_gate(uuid, timestamptz, bigint) from public, anon, authenticated, service_role;
grant execute on function public.chips_assert_closed_human_table_lifecycle_gate(uuid, timestamptz, bigint) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_prune_closed_human_table_archive_batch(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_table_id uuid,
  p_execute boolean default false,
  p_approved_batch_id bigint default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  receipt_count integer;
  registry_count bigint;
  distinct_table_count bigint;
  null_table_count bigint;
  prune_result jsonb;
begin
  if p_execute is null or p_table_id is null or p_object_path is null
     or p_transaction_ids is null or p_entry_ids is null
     or pg_catalog.cardinality(p_transaction_ids) not between 1 and 2
     or pg_catalog.cardinality(p_entry_ids) < 1 then
    raise exception using errcode = 'P9235', message = 'Production closed-human exact archive arguments are invalid';
  end if;
  if p_execute and p_approved_batch_id is null then
    raise exception using errcode = 'P9235', message = 'Exact Production closed-human approved batch is required';
  end if;
  if not p_execute and p_approved_batch_id is not null then
    raise exception using errcode = 'P9235', message = 'Production closed-human approved batch is execute-only';
  end if;

  select batches.* into batch
    from public.chips_ledger_archive_batches as batches
   where batches.object_path = p_object_path
   for update;
  if not found or batch.project_ref is distinct from 'otbqfijerkieoxwpxjnm'
     or batch.format_version is distinct from 1
     or batch.source_policy_id is distinct from 'production-ledger-closed-human-table-retention-30d-v1'
     or batch.status is distinct from 'committed'
     or batch.committed_at is null
     or batch.cutoff is null then
    raise exception using errcode = 'P9235', message = 'Production closed-human prune requires one canonical batch';
  end if;
  perform public.chips_assert_archive_prune_target(batch.project_ref, pg_catalog.cardinality(p_transaction_ids));
  perform public.chips_assert_production_retention_control(batch.source_policy_id, pg_catalog.cardinality(p_transaction_ids), p_execute);

  receipt_count := pg_catalog.num_nonnulls(
    batch.pruned_at,
    batch.pruned_transaction_count,
    batch.pruned_entry_count,
    batch.pruned_transaction_ids_sha256,
    batch.pruned_entry_ids_sha256
  );
  if receipt_count not in (0, 5) then
    raise exception using errcode = 'P9235', message = 'Production closed-human prune receipt is partial';
  end if;
  select count(*), count(distinct registry.table_id), count(*) filter (where registry.table_id is null)
    into registry_count, distinct_table_count, null_table_count
    from public.chips_transaction_idempotency as registry
   where registry.transaction_id = any(p_transaction_ids);
  if registry_count <> pg_catalog.cardinality(p_transaction_ids)
     or distinct_table_count <> 1
     or null_table_count <> 0
     or not exists (
       select 1 from public.chips_transaction_idempotency as registry
        where registry.transaction_id = any(p_transaction_ids)
          and registry.table_id = p_table_id
     ) then
    raise exception using errcode = 'P9235', message = 'Production closed-human archive table binding is not exact';
  end if;

  perform public.chips_assert_closed_human_table_lifecycle_gate(p_table_id, batch.cutoff, batch.batch_id);
  prune_result := public.chips_prune_committed_archive_batch_internal(
    p_object_path, p_transaction_ids, p_entry_ids, false
  );
  if p_execute is false or prune_result->>'state' = 'already_pruned' then
    return prune_result || pg_catalog.jsonb_build_object('policy_id', batch.source_policy_id, 'table_id', p_table_id);
  end if;
  if p_approved_batch_id is distinct from batch.batch_id
     or batch.destructive_go_at is null
     or batch.destructive_go_batch_id is distinct from batch.batch_id then
    raise exception using errcode = 'P9235', message = 'Exact Production closed-human batch GO is required before execute';
  end if;
  perform pg_catalog.set_config('chips.production_prune', '1', true);
  prune_result := public.chips_prune_committed_archive_batch_internal(
    p_object_path, p_transaction_ids, p_entry_ids, true
  );
  perform public.chips_assert_closed_human_table_lifecycle_gate(p_table_id, batch.cutoff, batch.batch_id);
  return prune_result || pg_catalog.jsonb_build_object('policy_id', batch.source_policy_id, 'table_id', p_table_id);
end;
$$;
alter function public.chips_prune_closed_human_table_archive_batch(text, uuid[], bigint[], uuid, boolean, bigint) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_prune_closed_human_table_archive_batch(text, uuid[], bigint[], uuid, boolean, bigint) from public, anon, authenticated, service_role;
grant execute on function public.chips_prune_closed_human_table_archive_batch(text, uuid[], bigint[], uuid, boolean, bigint) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_guard_human_retention_marker()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.human_retention_complete_at is distinct from old.human_retention_complete_at and (old.human_retention_complete_at is not null or new.human_retention_complete_at is null or current_user <> 'chips_ledger_archive_pruner' or coalesce(pg_catalog.current_setting('chips.production_table_lifecycle', true), '') <> '1') then raise exception using errcode = 'P9233', message = 'Human retention marker is immutable and lifecycle controlled'; end if;
  return new;
end;
$$;
alter function public.chips_guard_human_retention_marker() owner to postgres;
drop trigger if exists poker_tables_production_human_marker on public.poker_tables;
create trigger poker_tables_production_human_marker before update of human_retention_complete_at on public.poker_tables for each row execute function public.chips_guard_human_retention_marker();

create or replace function public.chips_complete_closed_human_table_retention(p_table_id uuid, p_cutoff timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.chips_assert_closed_human_table_lifecycle_gate(p_table_id, p_cutoff, null);
  perform pg_catalog.set_config('chips.production_table_lifecycle', '1', true);
  update public.poker_tables set human_retention_complete_at = coalesce(human_retention_complete_at, pg_catalog.timezone('utc', pg_catalog.now())) where id = p_table_id;
  return pg_catalog.jsonb_build_object('state', 'human_retention_complete', 'table_id', p_table_id);
end;
$$;
alter function public.chips_complete_closed_human_table_retention(uuid, timestamptz) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_complete_closed_human_table_retention(uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.chips_complete_closed_human_table_retention(uuid, timestamptz) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_authorize_closed_human_table_retention_canary(p_batch_id bigint, p_confirmation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare batch public.chips_ledger_archive_batches%rowtype;
begin
  if current_user <> 'postgres' or p_confirmation is distinct from 'GO ' || p_batch_id::text then raise exception using errcode = 'P9234', message = 'Exact Production closed-human GO confirmation is required'; end if;
  select * into batch from public.chips_ledger_archive_batches where batch_id = p_batch_id for update;
  if not found or batch.project_ref <> 'otbqfijerkieoxwpxjnm' or batch.format_version <> 1 or batch.source_policy_id <> 'production-ledger-closed-human-table-retention-30d-v1' or batch.transaction_count not between 1 and 2 or batch.archive_proof_verified_at is null or batch.pruned_at is not null then raise exception using errcode = 'P9234', message = 'Only a fresh bounded Production closed-human batch may be authorized'; end if;
  perform pg_catalog.set_config('chips.production_closed_human_go', '1', true);
  update public.chips_ledger_archive_batches set destructive_go_at = pg_catalog.timezone('utc', pg_catalog.now()), destructive_go_batch_id = batch.batch_id where batch_id = batch.batch_id and destructive_go_at is null;
  update public.chips_production_closed_human_table_retention_policy set canary_batch_id = batch.batch_id, canary_confirmation = p_confirmation, updated_at = pg_catalog.timezone('utc', pg_catalog.now()) where policy_id = 'production-ledger-closed-human-table-retention-30d-v1' and canary_batch_id is null;
  return pg_catalog.jsonb_build_object('state', 'authorized', 'batch_id', batch.batch_id);
end;
$$;
alter function public.chips_authorize_closed_human_table_retention_canary(bigint, text) owner to postgres;
revoke all on function public.chips_authorize_closed_human_table_retention_canary(bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.chips_authorize_closed_human_table_retention_canary(bigint, text) to postgres;

create table if not exists public.chips_account_snapshot (
  batch_id bigint not null references public.chips_ledger_archive_batches(batch_id) on delete restrict,
  account_id uuid not null references public.chips_accounts(id) on delete restrict,
  account_type public.chips_account_type not null,
  system_key text,
  user_id uuid,
  status text not null,
  balance numeric not null,
  next_entry_seq bigint not null,
  primary key (batch_id, account_id)
);
alter table public.chips_account_snapshot enable row level security;
revoke all on public.chips_account_snapshot from public, anon, authenticated, service_role;
create policy chips_production_account_snapshot_pruner_select on public.chips_account_snapshot for select to chips_ledger_archive_pruner using (true);
grant select on public.chips_account_snapshot to chips_ledger_archive_pruner;

create or replace function public.chips_guard_escrow_account_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.account_type::text = 'ESCROW' and current_user = 'chips_ledger_archive_pruner' and coalesce(pg_catalog.current_setting('chips.production_escrow_delete', true), '') = '1' then return old; end if;
  raise exception using errcode = 'P8943', message = 'Direct chips_accounts DELETE is forbidden; use the validated Production retirement function';
end;
$$;
alter function public.chips_guard_escrow_account_delete() owner to postgres;
revoke all on function public.chips_guard_escrow_account_delete() from public, anon, authenticated, service_role;
drop trigger if exists chips_accounts_production_escrow_retirement_guard on public.chips_accounts;
create trigger chips_accounts_production_escrow_retirement_guard before delete on public.chips_accounts for each row execute function public.chips_guard_escrow_account_delete();

create or replace function public.chips_retire_production_escrow_accounts(p_batch_id bigint, p_account_ids uuid[], p_recovery_object_path text, p_recovery_object_sha256 text, p_account_snapshot_sha256 text, p_execute boolean default false, p_confirmation text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare batch public.chips_ledger_archive_batches%rowtype; account_count bigint;
begin
  if p_account_ids is null or pg_catalog.cardinality(p_account_ids) not between 1 and 2 or p_recovery_object_path is null or p_recovery_object_sha256 !~ '^[0-9a-f]{64}$' or p_account_snapshot_sha256 !~ '^[0-9a-f]{64}$' or p_recovery_object_path <> 'account-recovery/v1/sha256/' || p_recovery_object_sha256 || '.json.gz' then raise exception using errcode = 'P8945', message = 'Production escrow recovery binding is invalid'; end if;
  select * into batch from public.chips_ledger_archive_batches where batch_id = p_batch_id for update;
  if not found or batch.project_ref <> 'otbqfijerkieoxwpxjnm' or batch.format_version <> 2 or batch.source_policy_id <> 'production-ledger-bot-only-retention-7d-v1' or batch.registry_cleaned_at is null or batch.pruned_at is null then raise exception using errcode = 'P8945', message = 'Production escrow retirement requires a cleaned bot-only batch'; end if;
  select count(*) into account_count from public.chips_accounts where id = any(p_account_ids) and account_type::text = 'ESCROW' and balance = 0;
  if account_count <> pg_catalog.cardinality(p_account_ids) then raise exception using errcode = 'P8946', message = 'Production escrow account set is not zero balance'; end if;
  perform public.chips_assert_production_retention_control('production-ledger-escrow-account-retention-v1', account_count, p_execute);
  if not p_execute then return pg_catalog.jsonb_build_object('state', 'eligible', 'batch_id', p_batch_id, 'account_count', account_count); end if;
  if p_confirmation is distinct from 'GO ' || p_batch_id::text then raise exception using errcode = 'P8947', message = 'Exact Production escrow GO is required'; end if;
  perform pg_catalog.set_config('chips.production_escrow_delete', '1', true);
  delete from public.chips_accounts where id = any(p_account_ids);
  update public.chips_ledger_archive_batches set account_retirement_at = pg_catalog.timezone('utc', pg_catalog.now()), account_retirement_account_count = account_count, account_retirement_account_ids_sha256 = public.chips_archive_uuid_ids_sha256(p_account_ids), account_retirement_recovery_object_path = p_recovery_object_path, account_retirement_recovery_object_sha256 = p_recovery_object_sha256, account_retirement_snapshot_sha256 = p_account_snapshot_sha256 where batch_id = p_batch_id;
  return pg_catalog.jsonb_build_object('state', 'retired', 'batch_id', p_batch_id, 'account_count', account_count);
end;
$$;
alter function public.chips_retire_production_escrow_accounts(bigint, uuid[], text, text, text, boolean, text) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_retire_production_escrow_accounts(bigint, uuid[], text, text, text, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.chips_retire_production_escrow_accounts(bigint, uuid[], text, text, text, boolean, text) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_authorize_production_escrow_account_retirement_canary(p_batch_id bigint, p_account_ids_sha256 text, p_confirmation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if current_user <> 'postgres' or p_account_ids_sha256 !~ '^[0-9a-f]{64}$' or p_confirmation is distinct from 'GO ' || p_batch_id::text then raise exception using errcode = 'P8972', message = 'Exact Production escrow canary authorization is invalid'; end if;
  update public.chips_production_escrow_account_retention_policy set canary_batch_id = p_batch_id, canary_account_ids_sha256 = p_account_ids_sha256, canary_confirmation = p_confirmation where policy_id = 'production-ledger-escrow-account-retention-v1' and canary_batch_id is null;
  if not found then raise exception using errcode = 'P8973', message = 'Production escrow canary is already authorized'; end if;
  return pg_catalog.jsonb_build_object('state', 'canary_authorized', 'batch_id', p_batch_id, 'account_ids_sha256', p_account_ids_sha256);
end;
$$;
alter function public.chips_authorize_production_escrow_account_retirement_canary(bigint, text, text) owner to postgres;
revoke all on function public.chips_authorize_production_escrow_account_retirement_canary(bigint, text, text) from public, anon, authenticated, service_role;
grant execute on function public.chips_authorize_production_escrow_account_retirement_canary(bigint, text, text) to postgres;

create or replace function public.chips_production_retention_automatic_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select enabled from public.chips_production_retention_control where control_id is true), false)
$$;
alter function public.chips_production_retention_automatic_active() owner to postgres;
revoke all on function public.chips_production_retention_automatic_active() from public, anon, authenticated, service_role;
grant execute on function public.chips_production_retention_automatic_active() to postgres, chips_ledger_archive_pruner;

-- Record only the genuinely installed equivalent.  The conditional keeps the
-- disposable contract fixture independent of Supabase's managed history table.
do $history$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'insert into supabase_migrations.schema_migrations(version) values ($1) on conflict do nothing' using '20260914090000';
  end if;
end;
$history$;

commit;
