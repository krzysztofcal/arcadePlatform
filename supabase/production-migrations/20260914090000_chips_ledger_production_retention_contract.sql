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
        or (source_policy_id = 'production-ledger-bot-only-retention-7d-v1'
          and format_version = 2 and status = 'committed' and archive_proof_verified_at is not null and pruned_at is not null
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
  where source_policy_id = 'production-ledger-bot-only-retention-7d-v1';
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

CREATE OR REPLACE FUNCTION public.chips_guard_archive_batch_mutations()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  old_proof_count integer;
  new_proof_count integer;
  old_receipt_count integer;
  new_receipt_count integer;
  old_bot_proof_count integer;
  new_bot_proof_count integer;
  old_cleanup_count integer;
  new_cleanup_count integer;
  proof_changed boolean;
  receipt_changed boolean;
  bot_proof_changed boolean;
  cleanup_changed boolean;
  go_changed boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'Archive batch rows are durable; DELETE is not permitted';
  end if;

  if new.object_path is distinct from old.object_path
    or new.batch_id is distinct from old.batch_id
    or new.project_ref is distinct from old.project_ref
    or new.format_version is distinct from old.format_version
    or new.cutoff is distinct from old.cutoff
    or new.cursor_start_created_at is distinct from old.cursor_start_created_at
    or new.cursor_start_id is distinct from old.cursor_start_id
    or new.cursor_end_created_at is distinct from old.cursor_end_created_at
    or new.cursor_end_id is distinct from old.cursor_end_id
    or new.first_created_at is distinct from old.first_created_at
    or new.last_created_at is distinct from old.last_created_at
    or new.transaction_count is distinct from old.transaction_count
    or new.entry_count is distinct from old.entry_count
    or new.tx_types is distinct from old.tx_types
    or new.raw_bytes is distinct from old.raw_bytes
    or new.compressed_bytes is distinct from old.compressed_bytes
    or new.raw_sha256 is distinct from old.raw_sha256
    or new.compressed_sha256 is distinct from old.compressed_sha256
    or new.credits is distinct from old.credits
    or new.debits is distinct from old.debits
    or new.net_amount is distinct from old.net_amount
    or new.created_at is distinct from old.created_at
    or new.source_policy_id is distinct from old.source_policy_id then
    raise exception 'Archive batch proof fields are immutable';
  end if;

  proof_changed := new.archived_transaction_ids_sha256 is distinct from old.archived_transaction_ids_sha256
    or new.archived_entry_ids_sha256 is distinct from old.archived_entry_ids_sha256
    or new.archive_proof_verified_at is distinct from old.archive_proof_verified_at;
  receipt_changed := new.pruned_at is distinct from old.pruned_at
    or new.pruned_transaction_count is distinct from old.pruned_transaction_count
    or new.pruned_entry_count is distinct from old.pruned_entry_count
    or new.pruned_transaction_ids_sha256 is distinct from old.pruned_transaction_ids_sha256
    or new.pruned_entry_ids_sha256 is distinct from old.pruned_entry_ids_sha256;
  bot_proof_changed := new.bot_only_table_id is distinct from old.bot_only_table_id
    or new.bot_only_table_count is distinct from old.bot_only_table_count
    or new.bot_only_newest_created_at is distinct from old.bot_only_newest_created_at
    or new.bot_only_registry_keys_sha256 is distinct from old.bot_only_registry_keys_sha256
    or new.bot_only_out_of_scope_keys_sha256 is distinct from old.bot_only_out_of_scope_keys_sha256
    or new.bot_only_identity_count is distinct from old.bot_only_identity_count
    or new.bot_only_eligible_count is distinct from old.bot_only_eligible_count;
  cleanup_changed := new.registry_cleaned_at is distinct from old.registry_cleaned_at
    or new.registry_cleaned_key_count is distinct from old.registry_cleaned_key_count
    or new.registry_cleaned_keys_sha256 is distinct from old.registry_cleaned_keys_sha256;
  go_changed := new.destructive_go_at is distinct from old.destructive_go_at
    or new.destructive_go_batch_id is distinct from old.destructive_go_batch_id;

  if proof_changed and receipt_changed then
    raise exception 'Archive proof and prune receipt require separate transitions';
  end if;
  if receipt_changed and cleanup_changed then
    raise exception 'Archive prune receipt and registry cleanup receipt require separate transitions';
  end if;
  if receipt_changed
     and new.format_version = 2
     and (
       coalesce(pg_catalog.current_setting('chips.production_bot_only_prune', true), '') <> '1'
       or new.destructive_go_at is null
       or new.destructive_go_batch_id is distinct from new.batch_id
     ) then
    raise exception using
      errcode = 'P8911',
      message = 'Schema-v2 archive batches require the exact lifecycle operator and batch GO';
  end if;
  if (proof_changed or bot_proof_changed) and current_user <> 'chips_ledger_archive_pruner' then
    raise exception 'Archive proof may only be written by the archive pruner';
  end if;
  if bot_proof_changed
     and coalesce(pg_catalog.current_setting('chips.production_bot_only_proof', true), '') <> '1' then
    raise exception 'Bot-only proof may only be written by the lifecycle proof operator';
  end if;
  if (receipt_changed or cleanup_changed) and current_user <> 'chips_ledger_archive_pruner' then
    raise exception 'Archive receipt may only be written by the archive pruner';
  end if;
  if cleanup_changed
     and coalesce(pg_catalog.current_setting('chips.production_bot_only_cleanup', true), '') <> '1' then
    raise exception 'Registry cleanup receipt may only be written by the lifecycle cleanup operator';
  end if;
  if go_changed and not (
    current_user = 'postgres'
    and (
      coalesce(pg_catalog.current_setting('chips.production_bot_only_go', true), '') = '1'
      or coalesce(pg_catalog.current_setting('chips.production_closed_human_go', true), '') = '1'
      or coalesce(pg_catalog.current_setting('chips.production_canary', true), '') = '1'
    )
  ) then
    raise exception 'Destructive GO may only be written by the exact authorization function';
  end if;

  if new.status is distinct from old.status then
    if old.status <> 'pending' or new.status <> 'committed'
      or old.committed_at is not null or new.committed_at is null then
      raise exception 'Archive batch status may only transition pending to committed';
    end if;
  elsif new.committed_at is distinct from old.committed_at then
    raise exception 'Archive batch committed_at is immutable';
  end if;

  old_proof_count := pg_catalog.num_nonnulls(old.archived_transaction_ids_sha256, old.archived_entry_ids_sha256, old.archive_proof_verified_at);
  new_proof_count := pg_catalog.num_nonnulls(new.archived_transaction_ids_sha256, new.archived_entry_ids_sha256, new.archive_proof_verified_at);
  if old_proof_count = 0 then
    if new_proof_count not in (0, 3) then raise exception 'Archive ID proof must transition from empty to complete'; end if;
    if new_proof_count = 3 and new.status <> 'committed' then raise exception 'Archive ID proof requires a committed batch'; end if;
  elsif proof_changed then
    raise exception 'Archive ID proof cannot be replaced or cleared';
  end if;

  old_receipt_count := pg_catalog.num_nonnulls(old.pruned_at, old.pruned_transaction_count, old.pruned_entry_count, old.pruned_transaction_ids_sha256, old.pruned_entry_ids_sha256);
  new_receipt_count := pg_catalog.num_nonnulls(new.pruned_at, new.pruned_transaction_count, new.pruned_entry_count, new.pruned_transaction_ids_sha256, new.pruned_entry_ids_sha256);
  if old_receipt_count = 0 then
    if new_receipt_count not in (0, 5) then raise exception 'Archive prune receipt must transition from empty to complete'; end if;
    if new_receipt_count = 5 and new_proof_count <> 3 then raise exception 'Archive prune receipt requires an immutable ID proof'; end if;
  elsif receipt_changed then
    raise exception 'Archive prune receipt cannot be replaced or cleared';
  end if;

  old_bot_proof_count := pg_catalog.num_nonnulls(old.bot_only_table_id, old.bot_only_table_count, old.bot_only_newest_created_at, old.bot_only_registry_keys_sha256, old.bot_only_out_of_scope_keys_sha256, old.bot_only_identity_count, old.bot_only_eligible_count);
  new_bot_proof_count := pg_catalog.num_nonnulls(new.bot_only_table_id, new.bot_only_table_count, new.bot_only_newest_created_at, new.bot_only_registry_keys_sha256, new.bot_only_out_of_scope_keys_sha256, new.bot_only_identity_count, new.bot_only_eligible_count);
  if old_bot_proof_count = 0 then
    if new_bot_proof_count not in (0, 7) then raise exception 'Bot-only proof must transition from empty to complete'; end if;
    if new_bot_proof_count = 7 and (new.status <> 'committed' or new.format_version <> 2) then raise exception 'Bot-only proof requires a committed schema-v2 batch'; end if;
  elsif bot_proof_changed then
    raise exception 'Bot-only proof cannot be replaced or cleared';
  end if;

  old_cleanup_count := pg_catalog.num_nonnulls(old.registry_cleaned_at, old.registry_cleaned_key_count, old.registry_cleaned_keys_sha256);
  new_cleanup_count := pg_catalog.num_nonnulls(new.registry_cleaned_at, new.registry_cleaned_key_count, new.registry_cleaned_keys_sha256);
  if old_cleanup_count = 0 then
    if new_cleanup_count not in (0, 3) then raise exception 'Registry cleanup receipt must transition from empty to complete'; end if;
    if new_cleanup_count = 3 and new_receipt_count <> 5 then raise exception 'Registry cleanup receipt requires a complete ledger prune receipt'; end if;
    if new_cleanup_count = 3 and not (
      (new.source_policy_id = 'production-ledger-bot-only-retention-7d-v1' and new_bot_proof_count = 7)
      or (
        new.format_version = 1
        and new.source_policy_id = 'production-ledger-auto-retention-30d-v1'
        and new_bot_proof_count = 0
      )
    ) then
      raise exception 'Registry cleanup receipt requires matching immutable proof basis';
    end if;
  elsif cleanup_changed then
    raise exception 'Registry cleanup receipt cannot be replaced or cleared';
  end if;

  if old.destructive_go_at is not null and go_changed then
    raise exception 'Destructive GO cannot be replaced or cleared';
  end if;
  return new;
end;
$function$;
alter function public.chips_guard_archive_batch_mutations() owner to chips_ledger_archive_pruner;
revoke all on function public.chips_guard_archive_batch_mutations() from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.chips_archive_text_ids_sha256(p_ids text[])
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  payload text;
begin
  if p_ids is null or (pg_catalog.array_ndims(p_ids) is not null and pg_catalog.array_ndims(p_ids) <> 1)
     or pg_catalog.array_position(p_ids, null) is not null then
    raise exception 'Text ID proof requires a one-dimensional non-null text array';
  end if;
  select coalesce(pg_catalog.string_agg(value || E'\n', '' order by value), '')
    into payload
    from pg_catalog.unnest(p_ids) as values(value);
  return pg_catalog.encode(extensions.digest(pg_catalog.convert_to(payload, 'UTF8'), 'sha256'), 'hex');
end;
$function$;
alter function public.chips_archive_text_ids_sha256(text[]) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_archive_text_ids_sha256(text[]) from public, anon, authenticated, service_role;
grant execute on function public.chips_archive_text_ids_sha256(text[]) to postgres, chips_ledger_archive_pruner;

create or replace function public.chips_assert_archive_prune_target(p_project_ref text, p_transaction_count bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare system_identifier text;
begin
  select controls.system_identifier::text
    into system_identifier
    from pg_catalog.pg_control_system() as controls;
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
  select controls.system_identifier::text
    into system_identifier
    from pg_catalog.pg_control_system() as controls;
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

CREATE OR REPLACE FUNCTION public.chips_prune_committed_archive_batch_internal(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_execute boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STRICT SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  transaction_ids_sha256 text;
  entry_ids_sha256 text;
  transaction_count bigint := pg_catalog.cardinality(p_transaction_ids);
  entry_count bigint := pg_catalog.cardinality(p_entry_ids);
  receipt_field_count integer;
  is_closed_human boolean;
  registry_count bigint;
  matching_mapping_count bigint;
  wrong_mapping_count bigint;
  extra_mapping_count bigint;
  hot_transaction_count bigint;
  hot_entry_count bigint;
  actual_transaction_ids uuid[];
  actual_entry_ids bigint[];
  table_ids uuid[];
  account_ids uuid[];
  invalid_marker_count bigint;
  invalid_shape_count bigint;
  identity_mismatch_count bigint;
  active_table_count bigint;
  invalid_escrow_count bigint;
  user_transaction_count bigint;
  user_entry_count bigint;
  distinct_table_count bigint;
  actual_tx_types jsonb;
  actual_credits numeric;
  actual_debits numeric;
  actual_net numeric;
  actual_first_created_at timestamptz;
  actual_last_created_at timestamptz;
  actual_cursor_end_created_at timestamptz;
  actual_cursor_end_id uuid;
  accounts_before jsonb;
  accounts_after jsonb;
  mapped_count bigint;
  deleted_entry_count bigint;
  deleted_transaction_count bigint;
  receipt_count bigint;
begin
  perform public.chips_assert_archive_prune_stage();
  if pg_catalog.current_setting('transaction_isolation') <> 'serializable' then
    raise exception 'Ledger archive pruning requires SERIALIZABLE isolation';
  end if;
  if transaction_count between 1 and 5000 is not true or entry_count < 1 then
    raise exception 'Archive prune batch size is invalid';
  end if;
  if (select pg_catalog.count(*) from pg_catalog.unnest(p_transaction_ids) as id)
      <> (select pg_catalog.count(distinct id) from pg_catalog.unnest(p_transaction_ids) as id)
    or (select pg_catalog.count(*) from pg_catalog.unnest(p_entry_ids) as id)
      <> (select pg_catalog.count(distinct id) from pg_catalog.unnest(p_entry_ids) as id) then
    raise exception 'Archive prune batch contains duplicate IDs';
  end if;

  transaction_ids_sha256 := public.chips_archive_uuid_ids_sha256(p_transaction_ids);
  entry_ids_sha256 := public.chips_archive_bigint_ids_sha256(p_entry_ids);

  select batches.*
    into batch
    from public.chips_ledger_archive_batches as batches
    where batches.object_path = p_object_path
    for update;
  if not found then raise exception 'Committed archive manifest was not found'; end if;
  if batch.status <> 'committed' or batch.project_ref is distinct from 'otbqfijerkieoxwpxjnm' then
    raise exception 'Archive manifest is not committed canonical target evidence';
  end if;
  is_closed_human := batch.source_policy_id = 'production-ledger-closed-human-table-retention-30d-v1';
  perform public.chips_assert_archive_prune_target(batch.project_ref, transaction_count);
  perform public.chips_assert_production_retention_control(
    coalesce(batch.source_policy_id, 'production-ledger-auto-retention-30d-v1'),
    transaction_count,
    p_execute
  );
  if batch.archive_proof_verified_at is null then
    if p_execute then raise exception 'Archive ID proof must be registered before execute'; end if;
    return pg_catalog.jsonb_build_object('state', 'proof_missing');
  end if;
  if batch.archived_transaction_ids_sha256 is distinct from transaction_ids_sha256
    or batch.archived_entry_ids_sha256 is distinct from entry_ids_sha256
    or batch.transaction_count is distinct from transaction_count
    or batch.entry_count is distinct from entry_count then
    raise exception 'Archive prune IDs do not match immutable archive proof';
  end if;

  receipt_field_count := pg_catalog.num_nonnulls(
    batch.pruned_at,
    batch.pruned_transaction_count,
    batch.pruned_entry_count,
    batch.pruned_transaction_ids_sha256,
    batch.pruned_entry_ids_sha256
  );
  if receipt_field_count not in (0, 5) then
    raise exception 'Archive prune receipt is partial';
  end if;

  select pg_catalog.count(*) into registry_count
    from public.chips_transaction_idempotency as registry
    where registry.transaction_id = any(p_transaction_ids);
  select pg_catalog.count(*) into matching_mapping_count
    from public.chips_transaction_idempotency as registry
    where registry.transaction_id = any(p_transaction_ids)
      and registry.archive_batch_id = batch.batch_id;
  select pg_catalog.count(*) into wrong_mapping_count
    from public.chips_transaction_idempotency as registry
    where registry.transaction_id = any(p_transaction_ids)
      and registry.archive_batch_id is not null
      and registry.archive_batch_id <> batch.batch_id;
  select pg_catalog.count(*) into extra_mapping_count
    from public.chips_transaction_idempotency as registry
    where registry.archive_batch_id = batch.batch_id
      and not (registry.transaction_id = any(p_transaction_ids));
  select pg_catalog.count(*) into hot_transaction_count
    from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids);
  select pg_catalog.count(*) into hot_entry_count
    from public.chips_entries as entries
    where entries.transaction_id = any(p_transaction_ids)
       or entries.id = any(p_entry_ids);

  if receipt_field_count = 5 then
    if batch.pruned_transaction_count is distinct from transaction_count
      or batch.pruned_entry_count is distinct from entry_count
      or batch.pruned_transaction_ids_sha256 is distinct from transaction_ids_sha256
      or batch.pruned_entry_ids_sha256 is distinct from entry_ids_sha256
      or hot_transaction_count <> 0
      or hot_entry_count <> 0
      or (
        (
          pg_catalog.num_nonnulls(batch.registry_cleaned_at,
            batch.registry_cleaned_key_count, batch.registry_cleaned_keys_sha256) = 0
          and registry_count = transaction_count
          and matching_mapping_count = transaction_count
        ) or (
          batch.project_ref = 'otbqfijerkieoxwpxjnm'
          and batch.format_version = 1
          and batch.source_policy_id = 'production-ledger-auto-retention-30d-v1'
          and batch.committed_at is not null
          and pg_catalog.num_nonnulls(batch.registry_cleaned_at,
            batch.registry_cleaned_key_count, batch.registry_cleaned_keys_sha256) = 3
          and batch.registry_cleaned_key_count = transaction_count
          and batch.registry_cleaned_keys_sha256 ~ '^[0-9a-f]{64}$'
          and registry_count = 0
          and matching_mapping_count = 0
        )
      ) is not true
      or wrong_mapping_count <> 0
      or extra_mapping_count <> 0 then
      raise exception 'Archive already-pruned state is inconsistent';
    end if;
    return pg_catalog.jsonb_build_object(
      'state', 'already_pruned',
      'transactions', transaction_count,
      'entries', entry_count
    );
  end if;

  if matching_mapping_count <> 0 or wrong_mapping_count <> 0 or extra_mapping_count <> 0 then
    raise exception 'Archive mappings exist without a complete prune receipt';
  end if;
  if hot_transaction_count <> transaction_count or hot_entry_count <> entry_count then
    raise exception 'Archive hot ledger batch is incomplete';
  end if;
  if registry_count <> transaction_count then
    raise exception 'Archive hot ledger batch has incomplete registry identity';
  end if;

  select pg_catalog.array_agg(transactions.id order by transactions.created_at, transactions.id)
    into actual_transaction_ids
    from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids);
  if actual_transaction_ids is distinct from p_transaction_ids then
    raise exception 'Archive transaction order does not match the hot ledger';
  end if;

  with wanted as (
    select ids.id, ids.ordinality
      from pg_catalog.unnest(p_transaction_ids) with ordinality as ids(id, ordinality)
  )
  select pg_catalog.array_agg(entries.id order by wanted.ordinality, entries.id)
    into actual_entry_ids
    from wanted
    join public.chips_entries as entries on entries.transaction_id = wanted.id;
  if actual_entry_ids is distinct from p_entry_ids then
    raise exception 'Archive entry order does not match the hot ledger';
  end if;

  with selected as (
    select transactions.*
      from public.chips_transactions as transactions
      where transactions.id = any(p_transaction_ids)
  ), markers as (
    select selected.id as transaction_id,
           pg_catalog.lower(nullif(pg_catalog.btrim(selected.metadata->>'tableId'), '')) as table_id
      from selected
      where nullif(pg_catalog.btrim(selected.metadata->>'tableId'), '') is not null
    union all
    select selected.id,
           case
             when pg_catalog.lower(selected.reference) like 'table:%'
               then pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2)), ''))
             when pg_catalog.lower(selected.reference) like 'poker-rebuy:%'
               then pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2)), ''))
             else null
           end
      from selected
      where pg_catalog.lower(selected.reference) like 'table:%'
         or pg_catalog.lower(selected.reference) like 'poker-rebuy:%'
    union all
    select selected.id,
           pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.substr(accounts.system_key, 13)), ''))
      from selected
      join public.chips_entries as entries on entries.transaction_id = selected.id
      join public.chips_accounts as accounts on accounts.id = entries.account_id
      where accounts.account_type = 'ESCROW'
        and pg_catalog.upper(accounts.system_key) like 'POKER_TABLE:%'
  ), marker_summary as (
    select markers.transaction_id,
           pg_catalog.array_agg(distinct markers.table_id) filter (where markers.table_id is not null) as table_ids,
           pg_catalog.bool_or(
             markers.table_id is null
             or markers.table_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           ) as invalid_marker
      from markers
      group by markers.transaction_id
  )
  select pg_catalog.count(*)
    into invalid_marker_count
    from selected
    left join marker_summary on marker_summary.transaction_id = selected.id
    where coalesce(marker_summary.invalid_marker, false)
       or pg_catalog.cardinality(coalesce(marker_summary.table_ids, array[]::text[])) <> 1;
  if invalid_marker_count <> 0 then
    raise exception 'Archive batch contains missing, invalid, or ambiguous table markers';
  end if;

  with selected as (
    select transactions.*
      from public.chips_transactions as transactions
      where transactions.id = any(p_transaction_ids)
  ), markers as (
    select selected.id as transaction_id,
           pg_catalog.lower(nullif(pg_catalog.btrim(selected.metadata->>'tableId'), '')) as table_id
      from selected
      where nullif(pg_catalog.btrim(selected.metadata->>'tableId'), '') is not null
    union all
    select selected.id,
           case
             when pg_catalog.lower(selected.reference) like 'table:%'
               then pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2)), ''))
             when pg_catalog.lower(selected.reference) like 'poker-rebuy:%'
               then pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2)), ''))
             else null
           end
      from selected
      where pg_catalog.lower(selected.reference) like 'table:%'
         or pg_catalog.lower(selected.reference) like 'poker-rebuy:%'
    union all
    select selected.id,
           pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.substr(accounts.system_key, 13)), ''))
      from selected
      join public.chips_entries as entries on entries.transaction_id = selected.id
      join public.chips_accounts as accounts on accounts.id = entries.account_id
      where accounts.account_type = 'ESCROW'
        and pg_catalog.upper(accounts.system_key) like 'POKER_TABLE:%'
  ), marker_summary as (
    select markers.transaction_id, pg_catalog.min(markers.table_id)::uuid as table_id
      from markers
      group by markers.transaction_id
  )
  select pg_catalog.array_agg(distinct marker_summary.table_id order by marker_summary.table_id)
    into table_ids
    from marker_summary;

  select pg_catalog.array_agg(distinct entries.account_id order by entries.account_id)
    into account_ids
    from public.chips_entries as entries
    where entries.transaction_id = any(p_transaction_ids);

  perform tables.id
    from public.poker_tables as tables
    where tables.id = any(table_ids)
    order by tables.id
    for update;
  perform accounts.id
    from public.chips_accounts as accounts
    where accounts.id = any(account_ids)
    order by accounts.id
    for update;
  perform registry.idempotency_key
    from public.chips_transaction_idempotency as registry
    where registry.transaction_id = any(p_transaction_ids)
    order by registry.transaction_id, registry.idempotency_key
    for update;
  perform transactions.id
    from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids)
    order by transactions.created_at, transactions.id
    for update;
  perform entries.id
    from pg_catalog.unnest(p_transaction_ids) with ordinality as wanted(id, ordinality)
    join public.chips_entries as entries on entries.transaction_id = wanted.id
    order by wanted.ordinality, entries.id
    for update of entries;

  select pg_catalog.count(*) into active_table_count
    from public.poker_tables as tables
    where tables.id = any(table_ids)
      and pg_catalog.upper(tables.status) <> 'CLOSED';
  select pg_catalog.count(*) into invalid_escrow_count
    from pg_catalog.unnest(table_ids) as table_id
    left join public.chips_accounts as accounts
      on accounts.account_type = 'ESCROW'
     and accounts.system_key = 'POKER_TABLE:' || table_id::text
    where accounts.id is null
       or accounts.status <> 'active'
       or accounts.balance <> 0;
  if active_table_count <> 0 or invalid_escrow_count <> 0 then
    raise exception 'Archive batch contains an active table or non-zero/missing escrow';
  end if;

  with selected as (
    select transactions.*
      from public.chips_transactions as transactions
      where transactions.id = any(p_transaction_ids)
  ), markers as (
    select selected.id as transaction_id,
           pg_catalog.lower(nullif(pg_catalog.btrim(selected.metadata->>'tableId'), '')) as table_id
      from selected
      where nullif(pg_catalog.btrim(selected.metadata->>'tableId'), '') is not null
    union all
    select selected.id,
           case
             when pg_catalog.lower(selected.reference) like 'table:%'
               then pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2)), ''))
             when pg_catalog.lower(selected.reference) like 'poker-rebuy:%'
               then pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2)), ''))
             else null
           end
      from selected
      where pg_catalog.lower(selected.reference) like 'table:%'
         or pg_catalog.lower(selected.reference) like 'poker-rebuy:%'
    union all
    select selected.id,
           pg_catalog.lower(nullif(pg_catalog.btrim(pg_catalog.substr(accounts.system_key, 13)), ''))
      from selected
      join public.chips_entries as entries on entries.transaction_id = selected.id
      join public.chips_accounts as accounts on accounts.id = entries.account_id
      where accounts.account_type = 'ESCROW'
        and pg_catalog.upper(accounts.system_key) like 'POKER_TABLE:%'
  ), marker_summary as (
    select markers.transaction_id, pg_catalog.min(markers.table_id) as table_id
      from markers
      group by markers.transaction_id
  ), invalid as (
    select selected.id
      from selected
      join marker_summary on marker_summary.transaction_id = selected.id
      join public.chips_entries as entries on entries.transaction_id = selected.id
      join public.chips_accounts as accounts on accounts.id = entries.account_id
      group by selected.id, selected.tx_type, selected.user_id, selected.created_at, marker_summary.table_id
      having selected.tx_type::text not in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
         or selected.created_at >= batch.cutoff
         or not (
           (
             selected.user_id is null
             and pg_catalog.count(*) = 2
             and pg_catalog.count(*) filter (where accounts.account_type = 'USER') = 0
             and pg_catalog.count(*) filter (where accounts.account_type = 'SYSTEM') = 1
             and pg_catalog.count(*) filter (where accounts.account_type = 'ESCROW') = 1
             and pg_catalog.count(*) filter (
                  where accounts.account_type = 'ESCROW'
                    and accounts.system_key = 'POKER_TABLE:' || marker_summary.table_id
                ) = 1
             and pg_catalog.bool_and(accounts.status = 'active')
             and pg_catalog.sum(entries.amount) = 0
             and (
               (selected.tx_type::text = 'TABLE_BUY_IN'
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'SYSTEM') < 0
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'ESCROW') > 0)
               or
               (selected.tx_type::text = 'TABLE_CASH_OUT'
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'ESCROW') < 0
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'SYSTEM') > 0)
             )
           )
           or
           (
             is_closed_human
             and selected.user_id is not null
             and pg_catalog.count(*) = 2
             and pg_catalog.count(*) filter (where accounts.account_type = 'USER') = 1
             and pg_catalog.count(*) filter (where accounts.account_type = 'SYSTEM') = 0
             and pg_catalog.count(*) filter (where accounts.account_type = 'ESCROW') = 1
             and pg_catalog.count(*) filter (
                  where accounts.account_type = 'ESCROW'
                    and accounts.system_key = 'POKER_TABLE:' || marker_summary.table_id
                ) = 1
             and pg_catalog.count(*) filter (
                  where accounts.account_type = 'USER'
                    and accounts.user_id = selected.user_id
                ) = 1
             and pg_catalog.bool_and(accounts.status = 'active')
             and pg_catalog.sum(entries.amount) = 0
             and (
               (selected.tx_type::text = 'TABLE_BUY_IN'
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'USER') < 0
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'ESCROW') > 0)
               or
               (selected.tx_type::text = 'TABLE_CASH_OUT'
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'ESCROW') < 0
                 and pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'USER') > 0)
             )
           )
         )
  )
  select pg_catalog.count(*) into invalid_shape_count from invalid;
  if invalid_shape_count <> 0 then
    raise exception 'Archive batch is outside the technical TABLE_BUY_IN/TABLE_CASH_OUT whitelist';
  end if;

  select pg_catalog.count(*) into identity_mismatch_count
    from public.chips_transactions as transactions
    left join public.chips_transaction_idempotency as registry
      on registry.idempotency_key = transactions.idempotency_key
     and registry.transaction_id = transactions.id
     and registry.payload_hash = transactions.payload_hash
     and registry.tx_type = transactions.tx_type
     and registry.user_id is not distinct from transactions.user_id
     and registry.transaction_created_at = transactions.created_at
    where transactions.id = any(p_transaction_ids)
      and registry.idempotency_key is null;
  if identity_mismatch_count <> 0 then
    raise exception 'Archive batch registry identity is incomplete or inconsistent';
  end if;

  select pg_catalog.count(*) into user_transaction_count
    from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids) and transactions.user_id is not null;
  select pg_catalog.count(*) into user_entry_count
    from public.chips_entries as entries
    join public.chips_accounts as accounts on accounts.id = entries.account_id
    where entries.transaction_id = any(p_transaction_ids) and accounts.account_type = 'USER';
  distinct_table_count := pg_catalog.cardinality(table_ids);

  select pg_catalog.jsonb_object_agg(types.tx_type, types.count order by types.tx_type)
    into actual_tx_types
    from (
      select transactions.tx_type::text as tx_type, pg_catalog.count(*) as count
        from public.chips_transactions as transactions
        where transactions.id = any(p_transaction_ids)
        group by transactions.tx_type::text
    ) as types;
  select
    coalesce(pg_catalog.sum(case when entries.amount > 0 then entries.amount else 0 end), 0),
    coalesce(pg_catalog.sum(case when entries.amount < 0 then -entries.amount else 0 end), 0),
    coalesce(pg_catalog.sum(entries.amount), 0)
    into actual_credits, actual_debits, actual_net
    from public.chips_entries as entries
    where entries.transaction_id = any(p_transaction_ids);
  select pg_catalog.min(transactions.created_at), pg_catalog.max(transactions.created_at)
    into actual_first_created_at, actual_last_created_at
    from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids);
  select transactions.created_at, transactions.id
    into actual_cursor_end_created_at, actual_cursor_end_id
    from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids)
    order by transactions.created_at desc, transactions.id desc
    limit 1;

  if actual_tx_types is distinct from batch.tx_types
    or actual_credits is distinct from batch.credits
    or actual_debits is distinct from batch.debits
    or actual_net is distinct from batch.net_amount
    or actual_first_created_at is distinct from batch.first_created_at
    or actual_last_created_at is distinct from batch.last_created_at
    or actual_cursor_end_created_at is distinct from batch.cursor_end_created_at
    or actual_cursor_end_id is distinct from batch.cursor_end_id
    or (not is_closed_human and (user_transaction_count <> 0 or user_entry_count <> 0)) then
    raise exception 'Archive hot ledger aggregates do not match committed evidence';
  end if;

  select pg_catalog.jsonb_object_agg(
           accounts.id::text,
           pg_catalog.jsonb_build_array(accounts.balance::text, accounts.next_entry_seq::text)
           order by accounts.id::text
         )
    into accounts_before
    from public.chips_accounts as accounts
    where accounts.id = any(account_ids);

  if not p_execute then
    return pg_catalog.jsonb_build_object(
      'state', 'ready',
      'transactions', transaction_count,
      'entries', entry_count,
      'tx_types', actual_tx_types,
      'credits', actual_credits::text,
      'debits', actual_debits::text,
      'net', actual_net::text,
      'user_transactions', user_transaction_count,
      'user_entries', user_entry_count,
      'distinct_tables', distinct_table_count
    );
  end if;

  update public.chips_transaction_idempotency as registry
     set archive_batch_id = batch.batch_id
    from public.chips_transactions as transactions
   where transactions.id = any(p_transaction_ids)
     and registry.idempotency_key = transactions.idempotency_key
     and registry.transaction_id = transactions.id
     and registry.payload_hash = transactions.payload_hash
     and registry.tx_type = transactions.tx_type
     and registry.user_id is not distinct from transactions.user_id
     and registry.transaction_created_at = transactions.created_at
     and registry.archive_batch_id is null;
  get diagnostics mapped_count = row_count;
  if mapped_count <> transaction_count then raise exception 'Archive registry mapping count mismatch'; end if;

  delete from public.chips_entries as entries
    where entries.id = any(p_entry_ids)
      and entries.transaction_id = any(p_transaction_ids);
  get diagnostics deleted_entry_count = row_count;
  if deleted_entry_count <> entry_count then raise exception 'Archive entry DELETE count mismatch'; end if;

  delete from public.chips_transactions as transactions
    where transactions.id = any(p_transaction_ids);
  get diagnostics deleted_transaction_count = row_count;
  if deleted_transaction_count <> transaction_count then raise exception 'Archive transaction DELETE count mismatch'; end if;

  select pg_catalog.jsonb_object_agg(
           accounts.id::text,
           pg_catalog.jsonb_build_array(accounts.balance::text, accounts.next_entry_seq::text)
           order by accounts.id::text
         )
    into accounts_after
    from public.chips_accounts as accounts
    where accounts.id = any(account_ids);
  if accounts_after is distinct from accounts_before then
    raise exception 'Archive pruning changed account balances or entry sequences';
  end if;
  if exists (select 1 from public.chips_transactions where id = any(p_transaction_ids))
    or exists (
      select 1 from public.chips_entries
       where transaction_id = any(p_transaction_ids) or id = any(p_entry_ids)
    ) then
    raise exception 'Archive pruning left hot ledger rows behind';
  end if;

  update public.chips_ledger_archive_batches as batches
     set pruned_at = pg_catalog.timezone('utc', pg_catalog.now()),
         pruned_transaction_count = batches.transaction_count,
         pruned_entry_count = batches.entry_count,
         pruned_transaction_ids_sha256 = batches.archived_transaction_ids_sha256,
         pruned_entry_ids_sha256 = batches.archived_entry_ids_sha256
   where batches.batch_id = batch.batch_id
     and batches.pruned_at is null;
  get diagnostics receipt_count = row_count;
  if receipt_count <> 1 then raise exception 'Archive prune receipt transition was not unique'; end if;

  return pg_catalog.jsonb_build_object(
    'state', 'pruned',
    'transactions', deleted_transaction_count,
    'entries', deleted_entry_count,
    'tx_types', actual_tx_types,
    'credits', actual_credits::text,
    'debits', actual_debits::text,
    'net', actual_net::text,
    'user_transactions', user_transaction_count,
    'user_entries', user_entry_count,
    'distinct_tables', distinct_table_count
  );
end;
$function$;
alter function public.chips_prune_committed_archive_batch_internal(text, uuid[], bigint[], boolean) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_prune_committed_archive_batch_internal(text, uuid[], bigint[], boolean) from public, anon, authenticated, service_role;
grant execute on function public.chips_prune_committed_archive_batch_internal(text, uuid[], bigint[], boolean) to postgres, chips_ledger_archive_pruner;

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

CREATE OR REPLACE FUNCTION public.chips_assert_bot_only_archive_proof_lifecycle_gate(p_table_id uuid, p_batch_id bigint, p_cutoff timestamp with time zone, p_transaction_ids uuid[], p_registry_keys text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  table_row record;
  escrow_count bigint;
  unknown_registry_count bigint;
  unknown_hot_count bigint;
  human_registry_count bigint;
  young_registry_count bigint;
  incomplete_old_count bigint;
  newest_created_at timestamptz;
begin
  if not public.chips_table_fence_is_active() then
    raise exception using errcode = 'P8913', message = 'Bot-only lifecycle gate requires the active TABLE fence';
  end if;
  if p_batch_id is null or not exists (
    select 1
      from public.chips_ledger_archive_batches batches
     where batches.batch_id = p_batch_id
       and batches.status = 'committed'
       and batches.project_ref = 'otbqfijerkieoxwpxjnm'
       and batches.format_version = 2
       and batches.source_policy_id = 'production-ledger-bot-only-retention-7d-v1'
       and batches.cutoff = p_cutoff
  ) then
    raise exception using errcode = 'P8913', message = 'Bot-only lifecycle gate requires the exact committed schema-v2 batch';
  end if;
  if p_transaction_ids is null or pg_catalog.cardinality(p_transaction_ids) < 1 then
    raise exception using errcode = 'P8913', message = 'Bot-only lifecycle gate requires exact transaction evidence';
  end if;
  perform public.chips_assert_archive_prune_target('otbqfijerkieoxwpxjnm', pg_catalog.cardinality(p_transaction_ids));
  perform public.chips_assert_production_retention_control(
    'production-ledger-bot-only-retention-7d-v1',
    pg_catalog.cardinality(p_transaction_ids),
    false
  );

  select tables.id, tables.status, tables.has_human_participant, tables.bot_only_proof_eligible, tables.bot_only_retention_complete_at
    into table_row
    from public.poker_tables tables
   where tables.id = p_table_id
   for update;
  if not found then raise exception using errcode = 'P8913', message = 'Bot-only table is missing'; end if;
  if pg_catalog.upper(table_row.status::text) <> 'CLOSED' then raise exception using errcode = 'P8913', message = 'Bot-only table is not CLOSED'; end if;
  if table_row.has_human_participant is true then raise exception using errcode = 'P8913', message = 'Human-participant table is outside bot-only retention'; end if;
  if table_row.bot_only_proof_eligible is not true then raise exception using errcode = 'P8913', message = 'Historical bot-only proof is uncertain'; end if;

  select count(*) into escrow_count
    from public.chips_accounts accounts
   where accounts.account_type::text = 'ESCROW'
     and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
     and accounts.status::text = 'active'
     and accounts.balance = 0;
  if escrow_count <> 1 then raise exception using errcode = 'P8913', message = 'Bot-only table escrow is not active and zero'; end if;

  -- Keep the target evidence predicates equivalent to the historical gate,
  -- but start from the exact proof IDs and target markers.  No global
  -- registry_rows/table_transactions materialization is used here.  The
  -- result remains fail-closed for key, metadata, reference, and ESCROW
  -- evidence that can bind an unknown identity to this exact table.



  with candidate_transaction_ids as (
    -- Exact archive IDs use the chips_transactions primary-key path.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.id = any(coalesce(p_transaction_ids, array[]::uuid[]))
       and transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)

    union

    -- The regex remains the authoritative key validator.  LIKE is only a
    -- selective prefilter for the existing lower(idempotency_key) trigram
    -- access path.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(coalesce(transactions.idempotency_key, '')) like any (array[
         'join-buyin:' || p_table_id::text || ':%',
         'bot-seed-buyin:' || p_table_id::text || ':%',
         'managed-bot-seed-buyin:' || p_table_id::text || ':%'
       ])
       and transactions.idempotency_key ~* ('^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(coalesce(transactions.idempotency_key, '')) like any (array[
         'poker:leave:' || p_table_id::text || ':%',
         'poker:inactive_cleanup:' || p_table_id::text || ':%'
       ])
       and transactions.idempotency_key ~* ('^poker:(leave|inactive_cleanup):' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(coalesce(transactions.idempotency_key, '')) like any (array[
         'poker:rebuy:v1:' || p_table_id::text || ':%',
         'poker:deferred-leave:v1:' || p_table_id::text || ':%',
         'poker:bot-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:human-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:bot-replacement-buyin:v1:' || p_table_id::text || ':%',
         'poker:managed-bot-top-up:v1:' || p_table_id::text || ':%'
       ])
       and transactions.idempotency_key ~* ('^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    -- Metadata LIKE is only a candidate prefilter.  The historical JSON
    -- object checks remain the authoritative validator below it.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(coalesce(transactions.metadata::text, '')) like '%' || p_table_id::text || '%'
       and transactions.metadata is not null
       and pg_catalog.jsonb_typeof(transactions.metadata) = 'object'
       and transactions.metadata ? 'tableId'
       and nullif(pg_catalog.btrim(transactions.metadata->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       and pg_catalog.lower(pg_catalog.btrim(transactions.metadata->>'tableId')) = p_table_id::text

    union

    -- Keep safe validation for string-encoded JSON; the metadata trigram
    -- prefilter cannot widen this exact evidence branch.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(coalesce(transactions.metadata::text, '')) like '%' || p_table_id::text || '%'
       and transactions.metadata is not null
       and pg_catalog.jsonb_typeof(transactions.metadata) = 'string'
       and pg_catalog.pg_input_is_valid(transactions.metadata #>> '{}', 'jsonb'::text)
       and pg_catalog.jsonb_typeof((transactions.metadata #>> '{}')::jsonb) = 'object'
       and ((transactions.metadata #>> '{}')::jsonb) ? 'tableId'
       and nullif(pg_catalog.btrim(((transactions.metadata #>> '{}')::jsonb)->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       and pg_catalog.lower(pg_catalog.btrim(((transactions.metadata #>> '{}')::jsonb)->>'tableId')) = p_table_id::text

    union

    -- The old case-insensitive reference grammar remains the authoritative
    -- check after the existing lower(reference) trigram prefilter.
    select transactions.id
      from public.chips_transactions transactions
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and pg_catalog.lower(coalesce(transactions.reference, '')) like any (array[
         'table:' || p_table_id::text || '%',
         'poker-rebuy:' || p_table_id::text || '%',
         'bot_seed_buy_in:' || p_table_id::text || '%',
         'bot_replacement_buy_in:' || p_table_id::text || '%',
         'managed_bot_top_up:' || p_table_id::text || '%'
       ])
       and transactions.reference ~* ('^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):' || p_table_id::text || '(:.*)?$')

    union

    -- Registry table binding remains an independent exact evidence branch.
    select registry.transaction_id
      from public.chips_transaction_idempotency registry
     where registry.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and registry.table_id = p_table_id

    union

    -- Registry NULL-table key branches are intentionally unchanged here;
    -- escrow registry chunking is a separate follow-up.
    select registry.transaction_id
      from public.chips_transaction_idempotency registry
     where registry.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and registry.table_id is null
       and pg_catalog.lower(registry.idempotency_key) like any (array[
         'join-buyin:' || p_table_id::text || ':%',
         'bot-seed-buyin:' || p_table_id::text || ':%',
         'managed-bot-seed-buyin:' || p_table_id::text || ':%',
         'poker:leave:' || p_table_id::text || ':%',
         'poker:inactive_cleanup:' || p_table_id::text || ':%',
         'poker:rebuy:v1:' || p_table_id::text || ':%',
         'poker:deferred-leave:v1:' || p_table_id::text || ':%',
         'poker:bot-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:human-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:bot-replacement-buyin:v1:' || p_table_id::text || ':%',
         'poker:managed-bot-top-up:v1:' || p_table_id::text || ':%'
       ])
       and registry.idempotency_key ~* ('^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    select registry.transaction_id
      from public.chips_transaction_idempotency registry
     where registry.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and registry.table_id is null
       and pg_catalog.lower(registry.idempotency_key) like any (array[
         'poker:leave:' || p_table_id::text || ':%',
         'poker:inactive_cleanup:' || p_table_id::text || ':%'
       ])
       and registry.idempotency_key ~* ('^poker:(leave|inactive_cleanup):' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    select registry.transaction_id
      from public.chips_transaction_idempotency registry
     where registry.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
       and registry.table_id is null
       and pg_catalog.lower(registry.idempotency_key) like any (array[
         'poker:rebuy:v1:' || p_table_id::text || ':%',
         'poker:deferred-leave:v1:' || p_table_id::text || ':%',
         'poker:bot-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:human-terminal-cashout:v1:' || p_table_id::text || ':%',
         'poker:bot-replacement-buyin:v1:' || p_table_id::text || ':%',
         'poker:managed-bot-top-up:v1:' || p_table_id::text || ':%'
       ])
       and registry.idempotency_key ~* ('^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:' || p_table_id::text || ':[^:]+(:[^:]+)*$')

    union

    -- ESCROW entry evidence resolves the exact system account first and
    -- reaches transaction IDs through the existing entries access path.
    select entries.transaction_id
      from public.chips_entries entries
      join public.chips_accounts accounts on accounts.id = entries.account_id
     where accounts.account_type::text = 'ESCROW'
       and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
  ), target_transactions as (
    -- Only this final join reads transaction payload columns, and it is by
    -- the primary key over the deduplicated candidate ID set.
    select transactions.id,
           transactions.idempotency_key,
           transactions.reference,
           normalized.normalized_metadata,
           case
             when transactions.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(transactions.idempotency_key, ':', 2)))
             when transactions.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(transactions.idempotency_key, ':', 3)))
             when transactions.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(transactions.idempotency_key, ':', 4)))
             else null
           end as key_table_id
      from candidate_transaction_ids candidates
      join public.chips_transactions transactions on transactions.id = candidates.id
      cross join lateral (
        select case
                 when transactions.metadata is not null
                   and pg_catalog.jsonb_typeof(transactions.metadata) = 'object'
                   then transactions.metadata
                 when transactions.metadata is not null
                   and pg_catalog.jsonb_typeof(transactions.metadata) = 'string'
                   and pg_catalog.pg_input_is_valid(transactions.metadata #>> '{}', 'jsonb'::text)
                   then (transactions.metadata #>> '{}')::jsonb
                 else null::jsonb
               end as normalized_metadata
      ) normalized
     where transactions.tx_type in ('TABLE_BUY_IN'::public.chips_tx_type, 'TABLE_CASH_OUT'::public.chips_tx_type)
  ), target_transaction_evidence as (
    select target.id as transaction_id, target.key_table_id as table_id
      from target_transactions target
     where target.key_table_id is not null

    union all

    select target.id,
           pg_catalog.lower(pg_catalog.btrim(target.normalized_metadata->>'tableId'))
      from target_transactions target
     where target.normalized_metadata is not null
       and pg_catalog.jsonb_typeof(target.normalized_metadata) = 'object'
       and target.normalized_metadata ? 'tableId'
       and nullif(pg_catalog.btrim(target.normalized_metadata->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'

    union all

    select target.id,
           pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(target.reference, ':', 2)))
      from target_transactions target
     where target.reference ~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(:.*)?$'

    union all

    select target.id,
           case
             when registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 2)))
             when registry.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 3)))
             when registry.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 4)))
             else null
           end
      from target_transactions target
      join public.chips_transaction_idempotency registry on registry.transaction_id = target.id
       and registry.table_id is null
     where registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin|poker:(leave|inactive_cleanup)|poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1):'

    union all

    select target.id, p_table_id::text
      from target_transactions target
      join public.chips_entries entries on entries.transaction_id = target.id
      join public.chips_accounts accounts on accounts.id = entries.account_id
     where accounts.account_type::text = 'ESCROW'
       and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
  ), unknown_registry_rows as (
    select registry.idempotency_key, registry.transaction_id
      from public.chips_transaction_idempotency registry
     where registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
       and registry.table_id is null
       and (
         registry.transaction_id = any(coalesce(p_transaction_ids, array[]::uuid[]))
         or registry.idempotency_key ~* ('^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):' || p_table_id::text || ':[^:]+(:[^:]+)*$')
         or registry.idempotency_key ~* ('^poker:(leave|inactive_cleanup):' || p_table_id::text || ':[^:]+(:[^:]+)*$')
         or registry.idempotency_key ~* ('^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:' || p_table_id::text || ':[^:]+(:[^:]+)*$')
         or exists (
           select 1
             from target_transaction_evidence evidence
            where evidence.transaction_id = registry.transaction_id
              and evidence.table_id = p_table_id::text
         )
         or exists (
           select 1
             from public.chips_entries entries
             join public.chips_accounts accounts on accounts.id = entries.account_id
            where entries.transaction_id = registry.transaction_id
              and accounts.account_type::text = 'ESCROW'
              and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
         )
       )
  ), unknown_registry_identity_evidence as (
    select unknown.idempotency_key as identity_key,
           case
             when unknown.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(unknown.idempotency_key, ':', 2)))
             when unknown.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(unknown.idempotency_key, ':', 3)))
             when unknown.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(unknown.idempotency_key, ':', 4)))
             else null
           end as table_id
      from unknown_registry_rows unknown

    union all

    select unknown.idempotency_key, evidence.table_id
      from unknown_registry_rows unknown
      join target_transaction_evidence evidence on evidence.transaction_id = unknown.transaction_id

    union all

    select distinct unknown.idempotency_key, p_table_id::text
      from unknown_registry_rows unknown
      join public.chips_entries entries on entries.transaction_id = unknown.transaction_id
      join public.chips_accounts accounts on accounts.id = entries.account_id
     where accounts.account_type::text = 'ESCROW'
       and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
  ), hot_identity_rows as (
    select distinct target.id as transaction_id
      from target_transactions target
     where not exists (
             select 1
               from public.chips_transaction_idempotency registry
              where registry.transaction_id = target.id
                and registry.table_id is not null
           )
        or exists (
             select 1
               from public.chips_transaction_idempotency registry
              where registry.transaction_id = target.id
                and registry.table_id is null
           )
  ), hot_identity_evidence as (
    select hot.transaction_id, evidence.table_id
      from hot_identity_rows hot
      join target_transaction_evidence evidence on evidence.transaction_id = hot.transaction_id

    union all

    select distinct hot.transaction_id,
           case
             when registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 2)))
             when registry.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 3)))
             when registry.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
               then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 4)))
             else null
           end
      from hot_identity_rows hot
      join public.chips_transaction_idempotency registry on registry.transaction_id = hot.transaction_id
       and registry.table_id is null
     where registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin|poker:(leave|inactive_cleanup)|poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1):'

    union all

    select distinct hot.transaction_id, p_table_id::text
      from hot_identity_rows hot
      join public.chips_entries entries on entries.transaction_id = hot.transaction_id
      join public.chips_accounts accounts on accounts.id = entries.account_id
     where accounts.account_type::text = 'ESCROW'
       and accounts.system_key = 'POKER_TABLE:' || p_table_id::text
  )
  select
    (
      select count(distinct unknown.identity_key)::bigint
        from unknown_registry_identity_evidence unknown
       where unknown.table_id = p_table_id::text
    ),
    (
      select count(distinct hot.transaction_id)::bigint
        from hot_identity_evidence hot
       where hot.table_id = p_table_id::text
    )
    into unknown_registry_count, unknown_hot_count;

  if unknown_registry_count <> 0 or unknown_hot_count <> 0 then
    raise exception using errcode = 'P8914', message = 'Unknown TABLE identity blocks bot-only lifecycle completion';
  end if;

  select count(*) into human_registry_count
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id
     and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.user_id is not null;
  if human_registry_count <> 0 then raise exception using errcode = 'P8914', message = 'USER TABLE identity blocks bot-only lifecycle completion'; end if;

  select count(*) into young_registry_count
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id
     and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.user_id is null
     and registry.transaction_created_at >= p_cutoff;
  if young_registry_count <> 0 then raise exception using errcode = 'P8915', message = 'Young TABLE identity blocks bot-only lifecycle completion'; end if;

  select count(*) into incomplete_old_count
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id
     and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.user_id is null
     and registry.transaction_created_at < p_cutoff
     and not (
       registry.idempotency_key = any(coalesce(p_registry_keys, array[]::text[]))
       or exists (
         select 1
           from public.chips_ledger_archive_batches batches
          where batches.batch_id = registry.archive_batch_id
            and batches.format_version = 2
            and batches.source_policy_id = 'production-ledger-bot-only-retention-7d-v1'
            and batches.pruned_at is not null
            and batches.registry_cleaned_at is not null
       )
     );
  if incomplete_old_count <> 0 then raise exception using errcode = 'P8916', message = 'Old TABLE identity is not fully archived, pruned, and cleaned'; end if;

  select max(value) into newest_created_at
    from (
      select max(registry.transaction_created_at) as value
        from public.chips_transaction_idempotency registry
       where registry.table_id = p_table_id
      union all
      select max(batches.bot_only_newest_created_at)
        from public.chips_ledger_archive_batches batches
       where batches.bot_only_table_id = p_table_id
         and batches.format_version = 2
         and batches.source_policy_id = 'production-ledger-bot-only-retention-7d-v1'
         and batches.registry_cleaned_at is not null
    ) known;
  if newest_created_at is null or newest_created_at >= p_cutoff then
    raise exception using errcode = 'P8915', message = 'Newest known TABLE identity is not older than the bot-only cutoff';
  end if;

  return pg_catalog.jsonb_build_object(
    'state', 'table_complete',
    'table_id', p_table_id,
    'newest_created_at', newest_created_at,
    'unknown_registry', unknown_registry_count,
    'unknown_hot', unknown_hot_count,
    'protected_registry', human_registry_count
  );
end;
$function$;
alter function public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid, bigint, timestamptz, uuid[], text[]) owner to postgres;
revoke all on function public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid, bigint, timestamptz, uuid[], text[]) from public, anon, authenticated, service_role;
grant execute on function public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid, bigint, timestamptz, uuid[], text[]) to postgres, chips_ledger_archive_pruner;

CREATE OR REPLACE FUNCTION public.chips_register_bot_only_archive_proof(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_table_id uuid, p_registry_keys text[], p_out_of_scope_keys_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  actual_transaction_ids uuid[];
  actual_entry_ids bigint[];
  actual_registry_keys text[];
  sorted_registry_keys text[];
  out_of_scope_keys text[];
  transaction_ids_sha256 text;
  entry_ids_sha256 text;
  registry_keys_sha256 text;
  out_of_scope_keys_sha256 text;
  expected_transaction_count bigint;
  expected_entry_count bigint;
  actual_table_count bigint;
  actual_identity_count bigint;
  actual_eligible_count bigint;
  invalid_registry_binding_count bigint;
  newest_created_at timestamptz;
  table_row record;
  invalid_shape_count bigint;
  updated_count bigint;
begin
  perform public.chips_assert_production_retention_control(
    'production-ledger-bot-only-retention-7d-v1',
    pg_catalog.cardinality(p_transaction_ids),
    false
  );
  perform public.chips_assert_archive_prune_target('otbqfijerkieoxwpxjnm', pg_catalog.cardinality(p_transaction_ids));
  if p_transaction_ids is null or p_entry_ids is null or p_registry_keys is null
     or pg_catalog.cardinality(p_transaction_ids) < 1
     or pg_catalog.cardinality(p_transaction_ids) > 5000
     or pg_catalog.cardinality(p_entry_ids) < 1
     or pg_catalog.cardinality(p_registry_keys) <> pg_catalog.cardinality(p_transaction_ids) then
    raise exception using errcode = 'P8917', message = 'Bot-only proof batch arrays are invalid';
  end if;
  if (select count(*) from pg_catalog.unnest(p_transaction_ids) as values(value)) <> (select count(distinct value) from pg_catalog.unnest(p_transaction_ids) as values(value))
     or (select count(*) from pg_catalog.unnest(p_entry_ids) as values(value)) <> (select count(distinct value) from pg_catalog.unnest(p_entry_ids) as values(value))
     or (select count(*) from pg_catalog.unnest(p_registry_keys) as values(value)) <> (select count(distinct value) from pg_catalog.unnest(p_registry_keys) as values(value)) then
    raise exception using errcode = 'P8917', message = 'Bot-only proof batch arrays contain duplicates';
  end if;

  transaction_ids_sha256 := public.chips_archive_uuid_ids_sha256(p_transaction_ids);
  entry_ids_sha256 := public.chips_archive_bigint_ids_sha256(p_entry_ids);

  select batches.* into batch
    from public.chips_ledger_archive_batches batches
   where batches.object_path = p_object_path
   for update;
  if not found then raise exception using errcode = 'P8917', message = 'Committed bot-only archive manifest was not found'; end if;
  if batch.status <> 'committed'
     or batch.project_ref <> 'otbqfijerkieoxwpxjnm'
     or batch.format_version <> 2
     or batch.source_policy_id <> 'production-ledger-bot-only-retention-7d-v1' then
    raise exception using errcode = 'P8917', message = 'Bot-only proof requires a committed canonical Production schema-v2 batch';
  end if;
  if batch.object_path <> ('v1/sha256/' || batch.compressed_sha256 || '.jsonl.gz') then
    raise exception using errcode = 'P8917', message = 'Bot-only object path does not match compressed SHA-256';
  end if;
  if batch.transaction_count <> pg_catalog.cardinality(p_transaction_ids)
     or batch.entry_count <> pg_catalog.cardinality(p_entry_ids) then
    raise exception using errcode = 'P8917', message = 'Bot-only proof counts do not match the manifest';
  end if;

  select pg_catalog.array_agg(transactions.id order by transactions.created_at, transactions.id)
    into actual_transaction_ids
    from public.chips_transactions transactions
   where transactions.id = any(p_transaction_ids);
  if actual_transaction_ids is distinct from p_transaction_ids then raise exception using errcode = 'P8917', message = 'Bot-only transaction order does not match the hot ledger'; end if;

  with wanted as (
    select ids.id, ids.ordinality from pg_catalog.unnest(p_transaction_ids) with ordinality ids(id, ordinality)
  )
  select pg_catalog.array_agg(entries.id order by wanted.ordinality, entries.id)
    into actual_entry_ids
    from wanted join public.chips_entries entries on entries.transaction_id = wanted.id;
  if actual_entry_ids is distinct from p_entry_ids then raise exception using errcode = 'P8917', message = 'Bot-only entry order does not match the hot ledger'; end if;

  select tables.id, tables.status, tables.has_human_participant, tables.bot_only_proof_eligible
    into table_row
    from public.poker_tables tables
   where tables.id = p_table_id
   for update;
  if not found or pg_catalog.upper(coalesce(table_row.status::text, '')) <> 'CLOSED' or table_row.has_human_participant is true or table_row.bot_only_proof_eligible is not true then
    raise exception using errcode = 'P8918', message = 'Bot-only proof requires an authoritative closed bot-only table';
  end if;

  select count(*) into actual_table_count
    from (
      select distinct (public.chips_parse_table_idempotency_key(transactions.idempotency_key)->>'table_id')::uuid as table_id
        from public.chips_transactions transactions
       where transactions.id = any(p_transaction_ids)
    ) tables;
  if actual_table_count <> 1 or exists (
    select 1
      from public.chips_transactions transactions
     where transactions.id = any(p_transaction_ids)
       and (public.chips_parse_table_idempotency_key(transactions.idempotency_key)->>'table_id')::uuid <> p_table_id
  ) then
    raise exception using errcode = 'P8918', message = 'Bot-only proof has more than one table identity';
  end if;

  select count(*) into invalid_shape_count
    from (
      select transactions.id
        from public.chips_transactions transactions
        join public.chips_entries entries on entries.transaction_id = transactions.id
        join public.chips_accounts accounts on accounts.id = entries.account_id
       where transactions.id = any(p_transaction_ids)
       group by transactions.id, transactions.tx_type, transactions.user_id, transactions.created_at,
                transactions.metadata, transactions.reference
      having transactions.tx_type::text not in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
          or transactions.user_id is not null
          or transactions.created_at >= batch.cutoff
          or (
            transactions.metadata ? 'tableId'
            and (
              nullif(pg_catalog.btrim(transactions.metadata->>'tableId'), '') is null
              or nullif(pg_catalog.btrim(transactions.metadata->>'tableId'), '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              or pg_catalog.lower(pg_catalog.btrim(transactions.metadata->>'tableId')) <> p_table_id::text
            )
          )
          or (
            transactions.reference is not null
            and public.chips_parse_table_reference(transactions.reference) <> p_table_id
          )
          or count(*) <> 2
          or count(*) filter (where accounts.account_type::text = 'USER') <> 0
          or count(*) filter (where accounts.account_type::text = 'SYSTEM') <> 1
          or count(*) filter (where accounts.account_type::text = 'ESCROW') <> 1
          or count(*) filter (where accounts.account_type::text = 'ESCROW' and accounts.system_key = 'POKER_TABLE:' || p_table_id::text) <> 1
          or not bool_and(accounts.status::text = 'active')
          or sum(entries.amount) <> 0
          or (transactions.tx_type::text = 'TABLE_BUY_IN' and (sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM') >= 0 or sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW') <= 0))
          or (transactions.tx_type::text = 'TABLE_CASH_OUT' and (sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW') >= 0 or sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM') <= 0))
    ) invalid;
  if invalid_shape_count <> 0 then raise exception using errcode = 'P8918', message = 'Bot-only proof is outside the technical TABLE whitelist'; end if;

  select pg_catalog.array_agg(registry.idempotency_key order by registry.idempotency_key)
    into actual_registry_keys
    from public.chips_transaction_idempotency registry
   where registry.transaction_id = any(p_transaction_ids)
     and registry.table_id = p_table_id
     and registry.archive_batch_id is null;
  select pg_catalog.array_agg(value order by value)
    into sorted_registry_keys
    from pg_catalog.unnest(p_registry_keys) as values(value);
  if actual_registry_keys is distinct from sorted_registry_keys then raise exception using errcode = 'P8919', message = 'Bot-only registry key proof does not match the hot registry'; end if;
  select count(*)
    into invalid_registry_binding_count
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id
     and (
       registry.key_format_version is distinct from 1
       or registry.key_format is distinct from (
         public.chips_parse_table_idempotency_key(registry.idempotency_key)->>'format'
       )
     );
  if invalid_registry_binding_count <> 0 then
    raise exception using errcode = 'P8919', message = 'Bot-only registry format does not match the server-verifiable key';
  end if;
  registry_keys_sha256 := public.chips_archive_text_ids_sha256(sorted_registry_keys);

  select pg_catalog.array_agg(registry.idempotency_key order by registry.idempotency_key)
    into out_of_scope_keys
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id
     and not (registry.idempotency_key = any(sorted_registry_keys));
  out_of_scope_keys := coalesce(out_of_scope_keys, array[]::text[]);
  out_of_scope_keys_sha256 := public.chips_archive_text_ids_sha256(out_of_scope_keys);
  if p_out_of_scope_keys_sha256 is distinct from out_of_scope_keys_sha256 then
    raise exception using errcode = 'P8919', message = 'Bot-only out-of-scope registry proof does not match the hot registry';
  end if;
  select count(*) into actual_identity_count
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id;
  actual_eligible_count := pg_catalog.cardinality(p_transaction_ids);
  if actual_identity_count <> actual_eligible_count then
    raise exception using errcode = 'P8919', message = 'Bot-only registry identity count does not match the complete eligible set';
  end if;
  select max(registry.transaction_created_at) into newest_created_at
    from public.chips_transaction_idempotency registry
   where registry.table_id = p_table_id;
  if newest_created_at is null or newest_created_at >= batch.cutoff then raise exception using errcode = 'P8915', message = 'Bot-only proof newest identity has not crossed the seven-day cutoff'; end if;

  perform public.chips_assert_bot_only_archive_proof_lifecycle_gate(p_table_id, batch.batch_id, batch.cutoff, p_transaction_ids, sorted_registry_keys);

  if batch.archive_proof_verified_at is not null then
    if batch.archived_transaction_ids_sha256 is distinct from transaction_ids_sha256
       or batch.archived_entry_ids_sha256 is distinct from entry_ids_sha256
       or batch.bot_only_table_id is distinct from p_table_id
       or batch.bot_only_registry_keys_sha256 is distinct from registry_keys_sha256 then
      raise exception using errcode = 'P8920', message = 'Existing bot-only proof differs from the requested evidence';
    end if;
    return pg_catalog.jsonb_build_object('state', 'proof_exists', 'transactions', batch.transaction_count, 'entries', batch.entry_count);
  end if;

  perform pg_catalog.set_config('chips.production_bot_only_proof', '1', true);
  update public.chips_ledger_archive_batches batches
     set archived_transaction_ids_sha256 = transaction_ids_sha256,
         archived_entry_ids_sha256 = entry_ids_sha256,
         archive_proof_verified_at = pg_catalog.timezone('utc', pg_catalog.now()),
         bot_only_table_id = p_table_id,
         bot_only_table_count = 1,
         bot_only_newest_created_at = newest_created_at,
         bot_only_registry_keys_sha256 = registry_keys_sha256,
         bot_only_out_of_scope_keys_sha256 = out_of_scope_keys_sha256,
         bot_only_identity_count = actual_identity_count,
         bot_only_eligible_count = actual_eligible_count
   where batches.batch_id = batch.batch_id
     and batches.archive_proof_verified_at is null;
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then raise exception using errcode = 'P8920', message = 'Bot-only proof transition was not unique'; end if;
  return pg_catalog.jsonb_build_object('state', 'proof_registered', 'transactions', batch.transaction_count, 'entries', batch.entry_count, 'table_id', p_table_id, 'registry_keys_sha256', registry_keys_sha256);
end;
$function$;
alter function public.chips_register_bot_only_archive_proof(text, uuid[], bigint[], uuid, text[], text) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_register_bot_only_archive_proof(text, uuid[], bigint[], uuid, text[], text) from public, anon, authenticated, service_role;
grant execute on function public.chips_register_bot_only_archive_proof(text, uuid[], bigint[], uuid, text[], text) to postgres, chips_ledger_archive_pruner;

CREATE OR REPLACE FUNCTION public.chips_prune_and_cleanup_bot_only_archive_batch(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_registry_keys text[], p_table_id uuid, p_execute boolean DEFAULT false, p_approved_batch_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  registry_keys_sha256 text;
  prune_result jsonb;
  deleted_registry_count bigint;
  lifecycle_marker timestamptz;
begin
  if p_execute is null then raise exception using errcode = 'P8921', message = 'Bot-only execute flag must not be NULL'; end if;
  if p_registry_keys is null
     or pg_catalog.cardinality(p_registry_keys) < 1
     or pg_catalog.cardinality(p_registry_keys) <> pg_catalog.cardinality(p_transaction_ids) then
    raise exception using errcode = 'P8921', message = 'Bot-only cleanup registry key set is invalid';
  end if;
  select batches.* into batch
    from public.chips_ledger_archive_batches batches
   where batches.object_path = p_object_path
   for update;
  if not found or batch.project_ref <> 'otbqfijerkieoxwpxjnm' or batch.format_version <> 2 or batch.source_policy_id <> 'production-ledger-bot-only-retention-7d-v1' then
    raise exception using errcode = 'P8921', message = 'Bot-only cleanup requires a canonical Production schema-v2 batch';
  end if;
  perform public.chips_assert_archive_prune_target(batch.project_ref, pg_catalog.cardinality(p_transaction_ids));
  perform public.chips_assert_production_retention_control(
    batch.source_policy_id,
    pg_catalog.cardinality(p_transaction_ids),
    p_execute
  );
  if batch.bot_only_table_id is distinct from p_table_id
     or batch.transaction_count <> pg_catalog.cardinality(p_transaction_ids)
     or batch.entry_count <> pg_catalog.cardinality(p_entry_ids)
     or batch.archive_proof_verified_at is null
     or batch.archived_transaction_ids_sha256 <> public.chips_archive_uuid_ids_sha256(p_transaction_ids)
     or batch.archived_entry_ids_sha256 <> public.chips_archive_bigint_ids_sha256(p_entry_ids) then
    raise exception using errcode = 'P8921', message = 'Bot-only cleanup arguments do not match immutable proof';
  end if;
  registry_keys_sha256 := public.chips_archive_text_ids_sha256(p_registry_keys);
  if registry_keys_sha256 <> batch.bot_only_registry_keys_sha256 then raise exception using errcode = 'P8921', message = 'Bot-only cleanup keys do not match immutable proof'; end if;

  if batch.registry_cleaned_at is not null then
    if batch.registry_cleaned_key_count <> pg_catalog.cardinality(p_registry_keys)
       or batch.registry_cleaned_keys_sha256 <> registry_keys_sha256 then
      raise exception using errcode = 'P8922', message = 'Existing bot-only cleanup receipt differs from the retry';
    end if;
    -- Closed-table cleanup may legally have removed the table after the
    -- receipt was written.  If it is still present, an empty marker is an
    -- anomaly and must never be silently accepted on replay.
    select tables.bot_only_retention_complete_at
      into lifecycle_marker
      from public.poker_tables tables
     where tables.id = batch.bot_only_table_id;
    if found and lifecycle_marker is null then
      raise exception using errcode = 'P8925', message = 'Existing bot-only cleanup receipt has an empty TABLE lifecycle marker';
    end if;
    return pg_catalog.jsonb_build_object('state', 'already_cleaned', 'transactions', batch.transaction_count, 'registry_keys', batch.registry_cleaned_key_count);
  end if;

  perform public.chips_assert_bot_only_archive_proof_lifecycle_gate(batch.bot_only_table_id, batch.batch_id, batch.cutoff, p_transaction_ids, p_registry_keys);
  if not p_execute then
    prune_result := public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, false);
    return prune_result || pg_catalog.jsonb_build_object('cleanup', 'prepare_only', 'table_id', batch.bot_only_table_id);
  end if;
  if p_approved_batch_id is distinct from batch.batch_id or batch.destructive_go_batch_id is distinct from batch.batch_id or batch.destructive_go_at is null then
    raise exception using errcode = 'P8923', message = 'Exact bot-only batch GO is required before destructive cleanup';
  end if;

  perform pg_catalog.set_config('chips.production_bot_only_prune', '1', true);
  prune_result := public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, true);
  perform public.chips_assert_bot_only_archive_proof_lifecycle_gate(batch.bot_only_table_id, batch.batch_id, batch.cutoff, p_transaction_ids, p_registry_keys);
  select count(*) into deleted_registry_count
    from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id
     and registry.idempotency_key = any(p_registry_keys);
  if deleted_registry_count <> pg_catalog.cardinality(p_registry_keys) then raise exception using errcode = 'P8924', message = 'Bot-only registry cleanup set is incomplete'; end if;

  perform pg_catalog.set_config('chips.production_bot_registry_cleanup', '1', true);
  delete from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id
     and registry.idempotency_key = any(p_registry_keys);
  get diagnostics deleted_registry_count = row_count;
  if deleted_registry_count <> pg_catalog.cardinality(p_registry_keys) then raise exception using errcode = 'P8924', message = 'Bot-only registry DELETE count mismatch'; end if;

  perform pg_catalog.set_config('chips.production_bot_only_cleanup', '1', true);
  update public.chips_ledger_archive_batches batches
     set registry_cleaned_at = pg_catalog.timezone('utc', pg_catalog.now()),
         registry_cleaned_key_count = pg_catalog.cardinality(p_registry_keys),
         registry_cleaned_keys_sha256 = registry_keys_sha256
   where batches.batch_id = batch.batch_id
     and batches.registry_cleaned_at is null;
  if not found then raise exception using errcode = 'P8924', message = 'Bot-only cleanup receipt transition was not unique'; end if;

  perform pg_catalog.set_config('chips.production_table_lifecycle', '1', true);
  update public.poker_tables tables
     set bot_only_retention_complete_at = coalesce(tables.bot_only_retention_complete_at, pg_catalog.timezone('utc', pg_catalog.now()))
   where tables.id = batch.bot_only_table_id
     and tables.bot_only_retention_complete_at is null;

  -- The first cleanup is atomic with the lifecycle update: the TABLE row and
  -- its non-empty marker must both be visible here.  Missing rows are legal
  -- only in the already-cleaned branch above, after a prior commit.
  select tables.bot_only_retention_complete_at
    into lifecycle_marker
    from public.poker_tables tables
   where tables.id = batch.bot_only_table_id;
  if not found or lifecycle_marker is null then
    raise exception using errcode = 'P8925', message = 'Bot-only lifecycle completion marker was not persisted';
  end if;

  return prune_result || pg_catalog.jsonb_build_object('state', 'cleaned', 'registry_keys', deleted_registry_count, 'table_id', batch.bot_only_table_id);
end;
$function$;
alter function public.chips_prune_and_cleanup_bot_only_archive_batch(text, uuid[], bigint[], text[], uuid, boolean, bigint) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_prune_and_cleanup_bot_only_archive_batch(text, uuid[], bigint[], text[], uuid, boolean, bigint) from public, anon, authenticated, service_role;
grant execute on function public.chips_prune_and_cleanup_bot_only_archive_batch(text, uuid[], bigint[], text[], uuid, boolean, bigint) to postgres, chips_ledger_archive_pruner;

CREATE OR REPLACE FUNCTION public.chips_assert_closed_human_table_lifecycle_gate(p_table_id uuid, p_cutoff timestamp with time zone, p_current_batch_id bigint DEFAULT NULL::bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  bad_count bigint;
begin
  if p_table_id is null or p_cutoff is null then
    raise exception using errcode = 'P9230', message = 'Human retention gate arguments are required';
  end if;
  if not exists (
    select 1 from public.poker_tables t
     join public.chips_accounts a on a.account_type::text = 'ESCROW'
       and a.system_key = 'POKER_TABLE:' || t.id::text and a.status::text = 'active' and a.balance = 0
     join public.poker_state s on s.table_id = t.id and jsonb_typeof(s.state) = 'object'
       and s.state ->> 'phase' = 'HAND_DONE' and s.state ->> 'handId' = ''
    where t.id = p_table_id and upper(t.status::text) = 'CLOSED' and t.has_human_participant is true
      and not exists (select 1 from public.poker_requests r where r.table_id = t.id and r.result_json is null)
  ) then raise exception using errcode = 'P9231', message = 'Human table terminal lifecycle is incomplete'; end if;

  select count(*) into bad_count
    from public.chips_transaction_idempotency r
    left join public.chips_ledger_archive_batches b on b.batch_id = r.archive_batch_id
   where r.table_id = p_table_id and r.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and (r.transaction_created_at >= p_cutoff
       or (r.archive_batch_id is null and p_current_batch_id is null)
       or (r.archive_batch_id is not null and not (
         b.status = 'committed' and b.archive_proof_verified_at is not null and b.pruned_at is not null
         and b.pruned_transaction_count = b.transaction_count and b.pruned_entry_count = b.entry_count
         and b.pruned_transaction_ids_sha256 = b.archived_transaction_ids_sha256
         and b.pruned_entry_ids_sha256 = b.archived_entry_ids_sha256
         and b.source_policy_id in ('production-ledger-auto-retention-30d-v1', 'production-ledger-closed-human-table-retention-30d-v1')
       )));
  if bad_count <> 0 then raise exception using errcode = 'P9232', message = 'Human TABLE identity set is incomplete, young, or incompatible'; end if;
end;
$function$;
alter function public.chips_assert_closed_human_table_lifecycle_gate(uuid, timestamptz, bigint) owner to postgres;
revoke all on function public.chips_assert_closed_human_table_lifecycle_gate(uuid, timestamptz, bigint) from public, anon, authenticated, service_role;
grant execute on function public.chips_assert_closed_human_table_lifecycle_gate(uuid, timestamptz, bigint) to postgres, chips_ledger_archive_pruner;

CREATE OR REPLACE FUNCTION public.chips_prune_closed_human_table_archive_batch(p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_table_id uuid, p_execute boolean DEFAULT false, p_approved_batch_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  policy public.chips_production_closed_human_table_retention_policy%rowtype;
  prune_result jsonb;
  receipt_count integer;
  registry_count bigint;
  distinct_table_count bigint;
  null_table_count bigint;
begin
  if p_execute is null then
    raise exception using errcode = 'P9235', message = 'Closed-human execute flag must not be NULL';
  end if;
  if p_table_id is null then
    raise exception using errcode = 'P9235', message = 'Closed-human table identity is required';
  end if;
  if p_object_path is null
     or p_transaction_ids is null
     or p_entry_ids is null
     or pg_catalog.cardinality(p_transaction_ids) < 1
     or pg_catalog.cardinality(p_entry_ids) < 1 then
    raise exception using errcode = 'P9235', message = 'Closed-human exact archive IDs are required';
  end if;
  if p_execute is true and p_approved_batch_id is null then
    raise exception using errcode = 'P9235', message = 'Exact closed-human approved batch is required';
  end if;
  if p_execute is false and p_approved_batch_id is not null then
    raise exception using errcode = 'P9235', message = 'Closed-human approved batch is execute-only';
  end if;

  select batches.*
    into batch
    from public.chips_ledger_archive_batches as batches
   where batches.object_path = p_object_path
   for update;
  if not found
     or batch.project_ref is distinct from 'otbqfijerkieoxwpxjnm'
     or batch.format_version is distinct from 1
     or batch.source_policy_id is distinct from 'production-ledger-closed-human-table-retention-30d-v1'
     or batch.batch_id is null
     or batch.status is distinct from 'committed'
     or batch.committed_at is null
     or batch.cutoff is null
     or coalesce(batch.raw_sha256, '') !~ '^[0-9a-f]{64}$'
     or coalesce(batch.compressed_sha256, '') !~ '^[0-9a-f]{64}$'
     or batch.object_path is distinct from ('v1/sha256/' || batch.compressed_sha256 || '.jsonl.gz')
     or batch.transaction_count is null
     or batch.entry_count is null then
    raise exception using errcode = 'P9235', message = 'Closed-human prune requires one canonical Production batch';
  end if;
  perform public.chips_assert_archive_prune_target(batch.project_ref, pg_catalog.cardinality(p_transaction_ids));

  receipt_count := pg_catalog.num_nonnulls(
    batch.pruned_at,
    batch.pruned_transaction_count,
    batch.pruned_entry_count,
    batch.pruned_transaction_ids_sha256,
    batch.pruned_entry_ids_sha256
  );
  if receipt_count not in (0, 5) then
    raise exception using errcode = 'P9235', message = 'Closed-human prune receipt is partial';
  end if;

  select policies.*
    into policy
    from public.chips_production_closed_human_table_retention_policy as policies
   where policies.policy_id = 'production-ledger-closed-human-table-retention-30d-v1';
  if not found
     or (
       (policy.enabled is true or policy.activated_at is not null)
       and coalesce(pg_catalog.current_setting('chips.production_closed_human_automatic', true), '') <> '1'
     )
     or (
       coalesce(pg_catalog.current_setting('chips.production_closed_human_automatic', true), '') = '1'
       and (policy.enabled is not true or policy.activated_at is null)
     ) then
    raise exception using errcode = 'P9235', message = 'Closed-human policy is not in the required manual-only or active automatic state';
  end if;

  if p_execute is true then
    if p_approved_batch_id is distinct from batch.batch_id
       or batch.destructive_go_at is null
       or batch.destructive_go_batch_id is distinct from batch.batch_id
       or (
         coalesce(pg_catalog.current_setting('chips.production_closed_human_automatic', true), '') <> '1'
         and (
           policy.canary_batch_id is distinct from batch.batch_id
           or policy.canary_confirmation is distinct from ('GO ' || batch.batch_id::text)
         )
       )
       or (
         coalesce(pg_catalog.current_setting('chips.production_closed_human_automatic', true), '') = '1'
         and (policy.enabled is not true or policy.activated_at is null)
       ) then
      raise exception using errcode = 'P9235', message = 'Exact closed-human batch GO is required before execute';
    end if;
  end if;

  -- The existing immutable whitelist is the source of truth for exact IDs,
  -- USER/SYSTEM/ESCROW shapes, counts, conservation, mappings and balances.
  -- Run it read-only first so lifecycle validation sees the same exact batch.
  prune_result := public.chips_prune_committed_archive_batch_internal(
    p_object_path, p_transaction_ids, p_entry_ids, false
  );
  if prune_result->>'state' not in ('ready', 'already_pruned') then
    raise exception using errcode = 'P9235', message = 'Closed-human exact dry-run is not ready';
  end if;
  if (prune_result->>'distinct_tables')::bigint <> 1 then
    raise exception using errcode = 'P9235', message = 'Closed-human batch must bind to exactly one table';
  end if;

  select count(*), count(distinct registry.table_id), count(*) filter (where registry.table_id is null)
    into registry_count, distinct_table_count, null_table_count
    from public.chips_transaction_idempotency as registry
   where registry.transaction_id = any(p_transaction_ids);
  if registry_count <> pg_catalog.cardinality(p_transaction_ids)
     or distinct_table_count <> 1
     or null_table_count <> 0
     or not exists (
       select 1
         from public.chips_transaction_idempotency as registry
        where registry.transaction_id = any(p_transaction_ids)
          and registry.table_id = p_table_id
     ) then
    raise exception using errcode = 'P9235', message = 'Closed-human archive table binding is not exact';
  end if;

  perform public.chips_assert_closed_human_table_lifecycle_gate(
    p_table_id, batch.cutoff, batch.batch_id
  );
  if p_execute is false or prune_result->>'state' = 'already_pruned' then
    return prune_result || pg_catalog.jsonb_build_object(
      'policy_id', batch.source_policy_id,
      'table_id', p_table_id
    );
  end if;

  perform pg_catalog.set_config('chips.production_closed_human_prune', '1', true);
  prune_result := public.chips_prune_committed_archive_batch_internal(
    p_object_path, p_transaction_ids, p_entry_ids, true
  );
  perform public.chips_assert_closed_human_table_lifecycle_gate(
    p_table_id, batch.cutoff, batch.batch_id
  );
  return prune_result || pg_catalog.jsonb_build_object(
    'policy_id', batch.source_policy_id,
    'table_id', p_table_id
  );
end;
$function$;
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

create or replace function public.chips_guard_account_retirement_receipt()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_count integer;
  new_count integer;
  changed boolean;
  call_stack text;
begin
  get diagnostics call_stack = pg_context;
  old_count := pg_catalog.num_nonnulls(old.account_retirement_at, old.account_retirement_account_count, old.account_retirement_account_ids_sha256, old.account_retirement_recovery_object_path, old.account_retirement_recovery_object_sha256, old.account_retirement_snapshot_sha256);
  new_count := pg_catalog.num_nonnulls(new.account_retirement_at, new.account_retirement_account_count, new.account_retirement_account_ids_sha256, new.account_retirement_recovery_object_path, new.account_retirement_recovery_object_sha256, new.account_retirement_snapshot_sha256);
  changed := new.account_retirement_at is distinct from old.account_retirement_at
    or new.account_retirement_account_count is distinct from old.account_retirement_account_count
    or new.account_retirement_account_ids_sha256 is distinct from old.account_retirement_account_ids_sha256
    or new.account_retirement_recovery_object_path is distinct from old.account_retirement_recovery_object_path
    or new.account_retirement_recovery_object_sha256 is distinct from old.account_retirement_recovery_object_sha256
    or new.account_retirement_snapshot_sha256 is distinct from old.account_retirement_snapshot_sha256;
  if old_count = 0 then
    if new_count not in (0, 6) then
      raise exception using errcode = 'P8944', message = 'Account-retirement receipt must be empty or complete';
    end if;
    if new_count = 6 then
      if current_user <> 'chips_ledger_archive_pruner'
         or coalesce(pg_catalog.current_setting('chips.escrow_account_retirement_receipt', true), '') <> '1'
         or pg_catalog.strpos(call_stack, 'chips_retire_production_escrow_accounts') <= 0 then
        raise exception using errcode = 'P8944', message = 'Account-retirement receipt requires the Production archive pruner function';
      end if;
    end if;
  elsif changed then
    raise exception using errcode = 'P8944', message = 'Account-retirement receipt cannot be replaced or cleared';
  end if;
  return new;
end;
$$;
alter function public.chips_guard_account_retirement_receipt() owner to postgres;
revoke all on function public.chips_guard_account_retirement_receipt() from public, anon, authenticated, service_role;
drop trigger if exists chips_ledger_archive_batches_production_account_retirement_guard on public.chips_ledger_archive_batches;
create trigger chips_ledger_archive_batches_production_account_retirement_guard
before update or delete on public.chips_ledger_archive_batches
for each row execute function public.chips_guard_account_retirement_receipt();

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
grant delete on public.chips_accounts to chips_ledger_archive_pruner;
grant update (
  account_retirement_at,
  account_retirement_account_count,
  account_retirement_account_ids_sha256,
  account_retirement_recovery_object_path,
  account_retirement_recovery_object_sha256,
  account_retirement_snapshot_sha256
) on public.chips_ledger_archive_batches to chips_ledger_archive_pruner;
create policy chips_production_accounts_delete
  on public.chips_accounts
  for delete to chips_ledger_archive_pruner
  using (
    account_type::text = 'ESCROW'
    and coalesce(pg_catalog.current_setting('chips.production_escrow_delete', true), '') = '1'
    and coalesce(pg_catalog.current_setting('chips.production_escrow_batch_id', true), '') <> ''
  );

create or replace function public.chips_guard_escrow_account_delete()
returns trigger language plpgsql set search_path = '' as $$
declare
  call_stack text;
begin
  get diagnostics call_stack = pg_context;
  if old.account_type::text <> 'ESCROW' then
    return old;
  end if;
  if tg_op = 'DELETE'
     and current_user = 'chips_ledger_archive_pruner'
     and coalesce(pg_catalog.current_setting('chips.production_escrow_delete', true), '') = '1'
     and coalesce(pg_catalog.current_setting('chips.production_escrow_batch_id', true), '') <> ''
     and pg_catalog.strpos(call_stack, 'chips_retire_production_escrow_accounts') > 0 then
    return old;
  end if;
  raise exception using errcode = 'P8943', message = 'Direct chips_accounts DELETE is forbidden; use the validated Production retirement function';
end;
$$;
alter function public.chips_guard_escrow_account_delete() owner to postgres;
revoke all on function public.chips_guard_escrow_account_delete() from public, anon, authenticated, service_role;
drop trigger if exists chips_accounts_production_escrow_retirement_guard on public.chips_accounts;
create trigger chips_accounts_production_escrow_retirement_guard before delete on public.chips_accounts for each row execute function public.chips_guard_escrow_account_delete();

CREATE OR REPLACE FUNCTION public.chips_retire_production_escrow_accounts(p_batch_id bigint, p_account_ids uuid[], p_recovery_object_path text, p_recovery_object_sha256 text, p_account_snapshot_sha256 text, p_execute boolean DEFAULT false, p_confirmation text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  policy public.chips_production_escrow_account_retention_policy%rowtype;
  table_ids uuid[];
  sorted_account_ids uuid[];
  locked_account_ids uuid[];
  account_count bigint;
  table_count bigint;
  bad_table_count bigint;
  bad_account_count bigint;
  hot_entry_count bigint;
  snapshot_count bigint;
  registry_count bigint;
  transaction_count bigint;
  receipt_count integer;
  account_ids_sha256 text;
  lifecycle_state text;
  affected_count bigint;
  production_system_identifier text;
begin
  if p_execute is null then
    raise exception using errcode = 'P8945', message = 'Escrow account retirement execute flag must not be NULL';
  end if;
  if p_batch_id is null
     or p_account_ids is null
     or pg_catalog.cardinality(p_account_ids) not between 1 and 2
     or pg_catalog.array_ndims(p_account_ids) <> 1
     or pg_catalog.array_position(p_account_ids, null) is not null then
    raise exception using errcode = 'P8945', message = 'Escrow account retirement set is invalid';
  end if;
  if (
    select count(*) from pg_catalog.unnest(p_account_ids) as ids(id)
  ) <> (
    select count(distinct id) from pg_catalog.unnest(p_account_ids) as ids(id)
  ) then
    raise exception using errcode = 'P8945', message = 'Escrow account retirement set contains duplicate IDs';
  end if;
  select pg_catalog.array_agg(ids.id order by ids.id)
    into sorted_account_ids
    from pg_catalog.unnest(p_account_ids) as ids(id);
  if sorted_account_ids is distinct from p_account_ids then
    raise exception using errcode = 'P8945', message = 'Escrow account retirement IDs must be sorted';
  end if;
  account_ids_sha256 := public.chips_archive_uuid_ids_sha256(p_account_ids);

  if p_recovery_object_path is null
     or p_recovery_object_sha256 is null
     or p_account_snapshot_sha256 is null
     or p_recovery_object_sha256 !~ '^[0-9a-f]{64}$'
     or p_account_snapshot_sha256 !~ '^[0-9a-f]{64}$'
     or p_recovery_object_path <> 'account-recovery/v1/sha256/' || p_recovery_object_sha256 || '.json.gz' then
    raise exception using errcode = 'P8946', message = 'Escrow account recovery binding is invalid';
  end if;

  production_system_identifier := public.chips_assert_archive_prune_stage();
  if production_system_identifier is distinct from '7575202818581710058' then
    raise exception using
      errcode = 'P8976',
      message = 'Escrow account retirement is restricted to canonical Production';
  end if;
  if not p_execute
     and (
       pg_catalog.current_setting('transaction_isolation') not in ('repeatable read', 'serializable')
       or pg_catalog.current_setting('transaction_read_only') <> 'on'
     ) then
    raise exception using errcode = 'P8947', message = 'Escrow account prepare requires a read-only stable snapshot';
  end if;
  if p_execute and pg_catalog.current_setting('transaction_isolation') <> 'serializable' then
    raise exception using errcode = 'P8947', message = 'Escrow account execute requires SERIALIZABLE isolation';
  end if;
  -- Keep the database entry point fail-closed even when it is called directly
  -- by the NOLOGIN owner role.  The application acquires this same key on its
  -- one reserved session before it can reach execute.
  if p_execute and not exists (
    select 1
      from pg_catalog.pg_locks locks
     where locks.locktype = 'advisory'
       and locks.pid = pg_catalog.pg_backend_pid()
       and locks.granted
       and locks.mode = 'ExclusiveLock'
       and locks.classid::bigint = ((pg_catalog.hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm', 0) >> 32) & 4294967295)
       and locks.objid::bigint = (pg_catalog.hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm', 0) & 4294967295)
  ) then
    raise exception using
      errcode = 'P8977',
      message = 'Production automation advisory lock is required before escrow account retirement';
  end if;

  if p_execute then
    select batches.*
      into batch
      from public.chips_ledger_archive_batches batches
     where batches.batch_id = p_batch_id
     for update;
  else
    select batches.*
      into batch
      from public.chips_ledger_archive_batches batches
     where batches.batch_id = p_batch_id;
  end if;
  if not found
     or batch.status is distinct from 'committed'
     or batch.project_ref is distinct from 'otbqfijerkieoxwpxjnm'
     or batch.format_version is distinct from 2
     or batch.source_policy_id is distinct from 'production-ledger-bot-only-retention-7d-v1' then
    raise exception using errcode = 'P8948', message = 'Escrow account retirement requires a committed canonical Production schema-v2 batch';
  end if;
  if batch.object_path is null
     or batch.compressed_sha256 is null
     or batch.raw_sha256 is null
     or batch.compressed_sha256 !~ '^[0-9a-f]{64}$'
     or batch.raw_sha256 !~ '^[0-9a-f]{64}$'
     or batch.object_path is distinct from 'v1/sha256/' || batch.compressed_sha256 || '.jsonl.gz' then
    raise exception using errcode = 'P8948', message = 'Escrow account retirement requires a content-addressed archive manifest';
  end if;
  if batch.archive_proof_verified_at is null
     or pg_catalog.num_nonnulls(
       batch.archived_transaction_ids_sha256,
       batch.archived_entry_ids_sha256,
       batch.archive_proof_verified_at
     ) <> 3
     or pg_catalog.num_nonnulls(
       batch.pruned_at,
       batch.pruned_transaction_count,
       batch.pruned_entry_count,
       batch.pruned_transaction_ids_sha256,
       batch.pruned_entry_ids_sha256
     ) <> 5
     or pg_catalog.num_nonnulls(
       batch.registry_cleaned_at,
       batch.registry_cleaned_key_count,
       batch.registry_cleaned_keys_sha256
     ) <> 3
     or batch.pruned_transaction_count is distinct from batch.transaction_count
     or batch.pruned_entry_count is distinct from batch.entry_count
     or batch.pruned_transaction_ids_sha256 is distinct from batch.archived_transaction_ids_sha256
     or batch.pruned_entry_ids_sha256 is distinct from batch.archived_entry_ids_sha256
     or batch.registry_cleaned_key_count is distinct from batch.transaction_count
     or batch.destructive_go_at is null
     or batch.destructive_go_batch_id is distinct from batch.batch_id then
    raise exception using errcode = 'P8949', message = 'Archive proof, prune receipt, registry receipt, or ledger GO is incomplete';
  end if;

    if pg_catalog.num_nonnulls(
      batch.bot_only_table_id,
      batch.bot_only_table_count,
      batch.bot_only_newest_created_at,
      batch.bot_only_registry_keys_sha256,
      batch.bot_only_out_of_scope_keys_sha256,
      batch.bot_only_identity_count,
      batch.bot_only_eligible_count
    ) <> 7
      or batch.bot_only_table_count is distinct from 1
      or batch.bot_only_identity_count is distinct from batch.transaction_count
      or batch.bot_only_eligible_count is distinct from batch.transaction_count then
      raise exception using errcode = 'P8950', message = 'Bot-only account retirement proof is incomplete';
    end if;
    table_ids := array[batch.bot_only_table_id];
    lifecycle_state := 'bot-only';
  table_count := pg_catalog.cardinality(table_ids);
  if table_count is null or table_count < 1 or table_count > 2 then
    raise exception using errcode = 'P8953', message = 'Archive batch table count is outside the account-retirement limit';
  end if;
  if table_count <> 1 then
    raise exception using errcode = 'P8953', message = 'Bot-only archive batch must contain one table';
  end if;

  if pg_catalog.cardinality(p_account_ids) <> table_count then
    raise exception using errcode = 'P8954', message = 'Account count must match the exact archive table set';
  end if;
  if exists (
    select 1
      from public.poker_tables tables
     where tables.id = any(table_ids)
  ) then
    raise exception using errcode = 'P8955', message = 'A corresponding poker table still exists';
  end if;

  -- This catalog assertion makes an unknown future FK a blocker instead of
  -- silently relying on an unreviewed cascade or dependency.
  if exists (
    select 1
      from pg_catalog.pg_constraint constraints
     where constraints.contype = 'f'
       and constraints.confrelid = 'public.chips_accounts'::pg_catalog.regclass
       and constraints.conrelid not in (
         'public.chips_entries'::pg_catalog.regclass,
         'public.chips_account_snapshot'::pg_catalog.regclass
       )
  ) then
    raise exception using errcode = 'P8956', message = 'Unknown foreign key dependency blocks account retirement';
  end if;
  if exists (
    select 1
      from pg_catalog.pg_trigger triggers
     where triggers.tgrelid = 'public.chips_accounts'::pg_catalog.regclass
       and not triggers.tgisinternal
       and (triggers.tgtype::integer & 8) <> 0
       and triggers.tgname not in ('chips_accounts_escrow_retirement_guard', 'chips_accounts_production_escrow_retirement_guard')
  ) then
    raise exception using errcode = 'P8956', message = 'Unknown DELETE trigger dependency blocks account retirement';
  end if;

  receipt_count := pg_catalog.num_nonnulls(
    batch.account_retirement_at,
    batch.account_retirement_account_count,
    batch.account_retirement_account_ids_sha256,
    batch.account_retirement_recovery_object_path,
    batch.account_retirement_recovery_object_sha256,
    batch.account_retirement_snapshot_sha256
  );
  if receipt_count not in (0, 6) then
    raise exception using errcode = 'P8957', message = 'Account-retirement receipt is partial';
  end if;
  if receipt_count = 6 then
    if batch.account_retirement_account_count is distinct from pg_catalog.cardinality(p_account_ids)
       or batch.account_retirement_account_ids_sha256 is distinct from account_ids_sha256
       or batch.account_retirement_recovery_object_path is distinct from p_recovery_object_path
       or batch.account_retirement_recovery_object_sha256 is distinct from p_recovery_object_sha256
       or batch.account_retirement_snapshot_sha256 is distinct from p_account_snapshot_sha256 then
      raise exception using errcode = 'P8958', message = 'Existing account-retirement receipt differs from the verified recovery';
    end if;
    if exists (select 1 from public.chips_accounts accounts where accounts.id = any(p_account_ids)) then
      raise exception using errcode = 'P8958', message = 'Account-retirement receipt exists while an account remains';
    end if;
    if exists (select 1 from public.chips_entries entries where entries.account_id = any(p_account_ids))
       or exists (select 1 from public.chips_account_snapshot snapshots where snapshots.account_id = any(p_account_ids)) then
      raise exception using errcode = 'P8958', message = 'Already-retired account still has dependent ledger state';
    end if;
    if exists (
      select 1 from public.chips_transaction_idempotency registry
       where registry.archive_batch_id = batch.batch_id
          or registry.table_id = any(table_ids)
    ) then
      raise exception using errcode = 'P8958', message = 'Already-retired batch still has registry mappings';
    end if;
    return pg_catalog.jsonb_build_object(
      'state', 'already_retired',
      'batch_id', batch.batch_id,
      'account_count', batch.account_retirement_account_count,
      'account_ids_sha256', account_ids_sha256,
      'recovery_object_path', batch.account_retirement_recovery_object_path,
      'recovery_object_sha256', batch.account_retirement_recovery_object_sha256,
      'account_snapshot_sha256', batch.account_retirement_snapshot_sha256,
      'lifecycle', lifecycle_state
    );
  end if;

  select count(*)
    into account_count
    from public.chips_accounts accounts
   where accounts.id = any(p_account_ids);
  if account_count <> pg_catalog.cardinality(p_account_ids) then
    raise exception using errcode = 'P8959', message = 'Exact ESCROW account set is missing';
  end if;
  select count(*)
    into bad_account_count
    from public.chips_accounts accounts
   where accounts.id = any(p_account_ids)
     and (
       accounts.account_type::text is distinct from 'ESCROW'
       or accounts.user_id is not null
       or accounts.status::text is distinct from 'active'
       or accounts.balance is distinct from 0
       or accounts.system_key is null
       or accounts.system_key !~ '^POKER_TABLE:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     );
  if bad_account_count <> 0 then
    raise exception using errcode = 'P8960', message = 'Account is not an active zero-balance canonical ESCROW';
  end if;
  select count(*)
    into bad_table_count
    from pg_catalog.unnest(table_ids) as wanted(table_id)
   where (
     select count(*)
       from public.chips_accounts accounts
      where accounts.account_type::text = 'ESCROW'
        and accounts.system_key is not distinct from 'POKER_TABLE:' || wanted.table_id::text
   ) <> 1
   or not exists (
     select 1
       from public.chips_accounts accounts
      where accounts.id = any(p_account_ids)
        and accounts.system_key = 'POKER_TABLE:' || wanted.table_id::text
   );
  if bad_table_count <> 0 then
    raise exception using errcode = 'P8961', message = 'Table-to-ESCROW account binding is not exactly one-to-one';
  end if;
  select count(*) into hot_entry_count
    from public.chips_entries entries
   where entries.account_id = any(p_account_ids);
  if hot_entry_count <> 0 then
    raise exception using errcode = 'P8962', message = 'Hot chips_entries block account retirement';
  end if;
  select count(*) into snapshot_count
    from public.chips_account_snapshot snapshots
   where snapshots.account_id = any(p_account_ids);
  if snapshot_count <> 0 then
    raise exception using errcode = 'P8963', message = 'chips_account_snapshot blocks account retirement';
  end if;
  select count(*) into registry_count
    from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id
      or registry.table_id = any(table_ids)
      or exists (
        select 1
          from pg_catalog.unnest(table_ids) as wanted(table_id)
         where pg_catalog.strpos(pg_catalog.lower(registry.idempotency_key), wanted.table_id::text) > 0
      );
  if registry_count <> 0 then
    raise exception using errcode = 'P8964', message = 'Residual idempotency/table mapping blocks account retirement';
  end if;

  with wanted as materialized (
    -- table_ids was already derived and validated by the existing exact
    -- archive/proof binding.  Keep that canonical set as the sole scope.
    select ids.table_id
      from pg_catalog.unnest(table_ids) as ids(table_id)
  ), candidate_transaction_ids as materialized (
    -- Each branch is an independent parameterized LIKE lookup.  The three
    -- expression GIN indexes make the field scans selective; UNION removes
    -- overlap before the exact primary-key validation below.
    select candidates.id
      from wanted
      cross join lateral (
        select transactions.id
          from public.chips_transactions transactions
         where pg_catalog.lower(coalesce(transactions.reference, ''))
               like '%' || wanted.table_id::text || '%'
      ) as candidates

    union

    select candidates.id
      from wanted
      cross join lateral (
        select transactions.id
          from public.chips_transactions transactions
         where pg_catalog.lower(coalesce(transactions.idempotency_key, ''))
               like '%' || wanted.table_id::text || '%'
      ) as candidates

    union

    select candidates.id
      from wanted
      cross join lateral (
        select transactions.id
          from public.chips_transactions transactions
         where pg_catalog.lower(coalesce(transactions.metadata::text, ''))
               like '%' || wanted.table_id::text || '%'
      ) as candidates
  ), target_transactions as (
    -- Rejoin by the transaction primary key, then repeat the historical
    -- strpos predicates exactly.  LIKE is only a candidate prefilter and
    -- cannot widen the accepted evidence or alter fail-closed behavior.
    select transactions.id
      from candidate_transaction_ids candidates
      join public.chips_transactions transactions
        on transactions.id = candidates.id
     where exists (
       select 1
         from wanted
        where pg_catalog.strpos(pg_catalog.lower(coalesce(transactions.reference, '')), wanted.table_id::text) > 0
           or pg_catalog.strpos(pg_catalog.lower(transactions.idempotency_key), wanted.table_id::text) > 0
           or pg_catalog.strpos(pg_catalog.lower(transactions.metadata::text), wanted.table_id::text) > 0
     )
  )
  select count(*) into transaction_count
    from target_transactions;

  if transaction_count <> 0 then
    raise exception using errcode = 'P8965', message = 'Residual table transaction identity blocks account retirement';
  end if;

  perform public.chips_assert_production_retention_control(
    'production-ledger-escrow-account-retention-v1',
    pg_catalog.cardinality(p_account_ids),
    p_execute
  );

  if not p_execute then
    return pg_catalog.jsonb_build_object(
      'state', 'eligible',
      'mode', 'prepare-only',
      'batch_id', batch.batch_id,
      'account_count', pg_catalog.cardinality(p_account_ids),
      'account_ids_sha256', account_ids_sha256,
      'recovery_object_path', p_recovery_object_path,
      'recovery_object_sha256', p_recovery_object_sha256,
      'account_snapshot_sha256', p_account_snapshot_sha256,
      'lifecycle', lifecycle_state,
      'read_only', true
    );
  end if;

  select policies.*
    into policy
    from public.chips_production_escrow_account_retention_policy policies
   where policies.policy_id = 'production-ledger-escrow-account-retention-v1';
  if not found then
    raise exception using errcode = 'P8966', message = 'Escrow account-retention kill switch row is missing';
  end if;
  if policy.enabled is not true then
    if policy.canary_batch_id is distinct from batch.batch_id
       or policy.canary_account_ids_sha256 is distinct from account_ids_sha256
       or p_confirmation is distinct from 'GO ' || batch.batch_id::text then
      raise exception using errcode = 'P8967', message = 'Exact account-retirement canary GO is required';
    end if;
  elsif p_confirmation is distinct from 'GO ' || batch.batch_id::text then
    raise exception using errcode = 'P8967', message = 'Exact account-retirement GO is required';
  end if;
  if not public.chips_table_fence_is_active() then
    raise exception using errcode = 'P8968', message = 'Active TABLE fence is required before account retirement';
  end if;
  perform public.chips_lock_table_fence_for_retention();
  if not public.chips_table_fence_is_active() then
    raise exception using errcode = 'P8968', message = 'TABLE fence changed before account retirement';
  end if;

  -- SKIP LOCKED is fail-closed here: an incomplete lock set raises 55P03 and
  -- the caller may retry the whole execute transaction after revalidation.
  select pg_catalog.array_agg(locked.id order by locked.id)
    into locked_account_ids
    from (
      select accounts.id
        from public.chips_accounts accounts
       where accounts.id = any(p_account_ids)
       order by accounts.id
       for update skip locked
    ) as locked;
  if locked_account_ids is distinct from p_account_ids then
    raise exception using
      errcode = '55P03',
      message = 'Could not lock the exact escrow account set',
      detail = 'An account was concurrently changed or locked',
      hint = 'Retry only after complete read-only revalidation';
  end if;

  -- Repeat all mutable-state assertions after the deterministic locks. This
  -- is intentionally redundant with the pre-lock read set.
  if not public.chips_table_fence_is_active() then
    raise exception using errcode = 'P8969', message = 'TABLE fence changed after account locks';
  end if;
  if exists (
    select 1
      from pg_catalog.pg_constraint constraints
     where constraints.contype = 'f'
       and constraints.confrelid = 'public.chips_accounts'::pg_catalog.regclass
       and constraints.conrelid not in (
         'public.chips_entries'::pg_catalog.regclass,
         'public.chips_account_snapshot'::pg_catalog.regclass
       )
  ) or exists (
    select 1
      from pg_catalog.pg_trigger triggers
     where triggers.tgrelid = 'public.chips_accounts'::pg_catalog.regclass
       and not triggers.tgisinternal
       and (triggers.tgtype::integer & 8) <> 0
       and triggers.tgname not in ('chips_accounts_escrow_retirement_guard', 'chips_accounts_production_escrow_retirement_guard')
  ) then
    raise exception using errcode = 'P8969', message = 'Account dependency catalog changed after account locks';
  end if;
  select count(*) into account_count
    from public.chips_accounts accounts
   where accounts.id = any(p_account_ids);
  select count(*) into bad_account_count
    from public.chips_accounts accounts
   where accounts.id = any(p_account_ids)
     and (
       accounts.account_type::text is distinct from 'ESCROW'
       or accounts.user_id is not null
       or accounts.status::text is distinct from 'active'
       or accounts.balance is distinct from 0
       or accounts.system_key is null
       or accounts.system_key !~ '^POKER_TABLE:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     );
  select count(*) into bad_table_count
    from pg_catalog.unnest(table_ids) as wanted(table_id)
   where (
     select count(*)
       from public.chips_accounts accounts
      where accounts.account_type::text = 'ESCROW'
        and accounts.system_key is not distinct from 'POKER_TABLE:' || wanted.table_id::text
   ) <> 1
   or not exists (
     select 1
       from public.chips_accounts accounts
      where accounts.id = any(p_account_ids)
        and accounts.system_key = 'POKER_TABLE:' || wanted.table_id::text
   );
  select count(*) into hot_entry_count
    from public.chips_entries entries
   where entries.account_id = any(p_account_ids);
  select count(*) into snapshot_count
    from public.chips_account_snapshot snapshots
   where snapshots.account_id = any(p_account_ids);
  select count(*) into registry_count
    from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id
      or registry.table_id = any(table_ids)
      or exists (
        select 1
          from pg_catalog.unnest(table_ids) as wanted(table_id)
         where pg_catalog.strpos(pg_catalog.lower(registry.idempotency_key), wanted.table_id::text) > 0
      );

  with wanted as materialized (
    -- table_ids was already derived and validated by the existing exact
    -- archive/proof binding.  Keep that canonical set as the sole scope.
    select ids.table_id
      from pg_catalog.unnest(table_ids) as ids(table_id)
  ), candidate_transaction_ids as materialized (
    -- Each branch is an independent parameterized LIKE lookup.  The three
    -- expression GIN indexes make the field scans selective; UNION removes
    -- overlap before the exact primary-key validation below.
    select candidates.id
      from wanted
      cross join lateral (
        select transactions.id
          from public.chips_transactions transactions
         where pg_catalog.lower(coalesce(transactions.reference, ''))
               like '%' || wanted.table_id::text || '%'
      ) as candidates

    union

    select candidates.id
      from wanted
      cross join lateral (
        select transactions.id
          from public.chips_transactions transactions
         where pg_catalog.lower(coalesce(transactions.idempotency_key, ''))
               like '%' || wanted.table_id::text || '%'
      ) as candidates

    union

    select candidates.id
      from wanted
      cross join lateral (
        select transactions.id
          from public.chips_transactions transactions
         where pg_catalog.lower(coalesce(transactions.metadata::text, ''))
               like '%' || wanted.table_id::text || '%'
      ) as candidates
  ), target_transactions as (
    -- Rejoin by the transaction primary key, then repeat the historical
    -- strpos predicates exactly.  LIKE is only a candidate prefilter and
    -- cannot widen the accepted evidence or alter fail-closed behavior.
    select transactions.id
      from candidate_transaction_ids candidates
      join public.chips_transactions transactions
        on transactions.id = candidates.id
     where exists (
       select 1
         from wanted
        where pg_catalog.strpos(pg_catalog.lower(coalesce(transactions.reference, '')), wanted.table_id::text) > 0
           or pg_catalog.strpos(pg_catalog.lower(transactions.idempotency_key), wanted.table_id::text) > 0
           or pg_catalog.strpos(pg_catalog.lower(transactions.metadata::text), wanted.table_id::text) > 0
     )
  )
  select count(*) into transaction_count
    from target_transactions;

  if account_count <> pg_catalog.cardinality(p_account_ids)
     or bad_account_count <> 0
     or bad_table_count <> 0
     or exists (select 1 from public.poker_tables tables where tables.id = any(table_ids))
     or hot_entry_count <> 0
     or snapshot_count <> 0
     or registry_count <> 0
     or transaction_count <> 0 then
    raise exception using errcode = 'P8969', message = 'Mutable account or table state changed after account locks';
  end if;

  perform pg_catalog.set_config('chips.production_escrow_delete', '1', true);
  perform pg_catalog.set_config('chips.production_escrow_batch_id', batch.batch_id::text, true);
  delete from public.chips_accounts accounts
   where accounts.id = any(p_account_ids);
  get diagnostics affected_count = row_count;
  if affected_count <> pg_catalog.cardinality(p_account_ids)
     or exists (select 1 from public.chips_accounts accounts where accounts.id = any(p_account_ids)) then
    raise exception using errcode = 'P8970', message = 'Escrow account DELETE count mismatch';
  end if;

  perform pg_catalog.set_config('chips.escrow_account_retirement_receipt', '1', true);
  update public.chips_ledger_archive_batches batches
     set account_retirement_at = pg_catalog.timezone('utc', pg_catalog.now()),
         account_retirement_account_count = pg_catalog.cardinality(p_account_ids),
         account_retirement_account_ids_sha256 = account_ids_sha256,
         account_retirement_recovery_object_path = p_recovery_object_path,
         account_retirement_recovery_object_sha256 = p_recovery_object_sha256,
         account_retirement_snapshot_sha256 = p_account_snapshot_sha256
   where batches.batch_id = batch.batch_id
     and batches.account_retirement_at is null;
  get diagnostics affected_count = row_count;
  if affected_count <> 1 then
    raise exception using errcode = 'P8971', message = 'Account-retirement receipt transition was not unique';
  end if;
  return pg_catalog.jsonb_build_object(
    'state', 'retired',
    'batch_id', batch.batch_id,
    'account_count', pg_catalog.cardinality(p_account_ids),
    'account_ids_sha256', account_ids_sha256,
    'recovery_object_path', p_recovery_object_path,
    'recovery_object_sha256', p_recovery_object_sha256,
    'account_snapshot_sha256', p_account_snapshot_sha256,
    'lifecycle', lifecycle_state
  );
end;
$function$;
alter function public.chips_retire_production_escrow_accounts(bigint, uuid[], text, text, text, boolean, text) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_retire_production_escrow_accounts(bigint, uuid[], text, text, text, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.chips_retire_production_escrow_accounts(bigint, uuid[], text, text, text, boolean, text) to postgres, chips_ledger_archive_pruner;

CREATE OR REPLACE FUNCTION public.chips_authorize_production_escrow_account_retirement_canary(p_batch_id bigint, p_account_ids_sha256 text, p_confirmation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  policy public.chips_production_escrow_account_retention_policy%rowtype;
  table_ids uuid[];
  sorted_table_ids uuid[];
  current_account_ids uuid[];
  table_count bigint;
  bad_table_count bigint;
  hot_entry_count bigint;
  snapshot_count bigint;
  registry_count bigint;
  transaction_count bigint;
  current_account_ids_sha256 text;
  production_system_identifier text;
begin
  production_system_identifier := public.chips_assert_archive_prune_stage();
  if production_system_identifier is distinct from '7575202818581710058' then
    raise exception using
      errcode = 'P8976',
      message = 'Escrow account-retirement canary is restricted to canonical Production';
  end if;
  if p_batch_id is null
     or p_account_ids_sha256 is null
     or p_account_ids_sha256 !~ '^[0-9a-f]{64}$'
     or p_confirmation is distinct from 'GO ' || p_batch_id::text then
    raise exception using errcode = 'P8972', message = 'Exact escrow account-retirement canary authorization is invalid';
  end if;

  select batches.* into batch
    from public.chips_ledger_archive_batches batches
   where batches.batch_id = p_batch_id
   for update;
  if not found
     or batch.status is distinct from 'committed'
     or batch.project_ref is distinct from 'otbqfijerkieoxwpxjnm'
     or batch.format_version is distinct from 2
     or batch.source_policy_id is null
     or batch.source_policy_id is distinct from 'production-ledger-bot-only-retention-7d-v1'
     or batch.object_path is null
     or batch.compressed_sha256 is null
     or batch.raw_sha256 is null
     or batch.compressed_sha256 !~ '^[0-9a-f]{64}$'
     or batch.raw_sha256 !~ '^[0-9a-f]{64}$'
     or batch.object_path is distinct from 'v1/sha256/' || batch.compressed_sha256 || '.jsonl.gz'
     or batch.archive_proof_verified_at is null
     or pg_catalog.num_nonnulls(
       batch.archived_transaction_ids_sha256,
       batch.archived_entry_ids_sha256,
       batch.archive_proof_verified_at
     ) <> 3
     or pg_catalog.num_nonnulls(
       batch.pruned_at,
       batch.pruned_transaction_count,
       batch.pruned_entry_count,
       batch.pruned_transaction_ids_sha256,
       batch.pruned_entry_ids_sha256
     ) <> 5
     or pg_catalog.num_nonnulls(
       batch.registry_cleaned_at,
       batch.registry_cleaned_key_count,
       batch.registry_cleaned_keys_sha256
     ) <> 3
     or batch.pruned_transaction_count is distinct from batch.transaction_count
     or batch.pruned_entry_count is distinct from batch.entry_count
     or batch.pruned_transaction_ids_sha256 is distinct from batch.archived_transaction_ids_sha256
     or batch.pruned_entry_ids_sha256 is distinct from batch.archived_entry_ids_sha256
     or batch.registry_cleaned_key_count is distinct from batch.transaction_count
     or batch.registry_cleaned_keys_sha256 is null
     or batch.registry_cleaned_keys_sha256 !~ '^[0-9a-f]{64}$'
     or batch.destructive_go_at is null
     or batch.destructive_go_batch_id is distinct from batch.batch_id
     or pg_catalog.num_nonnulls(
       batch.account_retirement_at,
       batch.account_retirement_account_count,
       batch.account_retirement_account_ids_sha256,
       batch.account_retirement_recovery_object_path,
       batch.account_retirement_recovery_object_sha256,
       batch.account_retirement_snapshot_sha256
     ) <> 0 then
    raise exception using errcode = 'P8972', message = 'Canary batch is not a complete, unretired Production archive batch';
  end if;

    if pg_catalog.num_nonnulls(
      batch.bot_only_table_id,
      batch.bot_only_table_count,
      batch.bot_only_newest_created_at,
      batch.bot_only_registry_keys_sha256,
      batch.bot_only_out_of_scope_keys_sha256,
      batch.bot_only_identity_count,
      batch.bot_only_eligible_count
    ) <> 7
      or batch.bot_only_table_count is distinct from 1
      or batch.bot_only_identity_count is distinct from batch.transaction_count
      or batch.bot_only_eligible_count is distinct from batch.transaction_count then
      raise exception using errcode = 'P8972', message = 'Bot-only canary proof is incomplete';
    end if;
    table_ids := array[batch.bot_only_table_id];
  table_count := pg_catalog.cardinality(table_ids);
  select pg_catalog.array_agg(ids.id order by ids.id)
    into sorted_table_ids
    from pg_catalog.unnest(table_ids) as ids(id);
  if table_count is null
     or table_count < 1
     or table_count > 2
     or pg_catalog.array_position(table_ids, null) is not null
     or table_ids is distinct from sorted_table_ids
     or (
       select count(*) from pg_catalog.unnest(table_ids) as ids(id)
     ) <> (
       select count(distinct id) from pg_catalog.unnest(table_ids) as ids(id)
     )
     or table_count <> 1 then
    raise exception using errcode = 'P8972', message = 'Canary table set is incomplete or not canonical';
  end if;
  if exists (
    select 1 from public.poker_tables tables where tables.id = any(table_ids)
  ) then
    raise exception using errcode = 'P8972', message = 'Canary batch still has a corresponding poker table';
  end if;

  -- The immutable policy row may only bind to the exact current active,
  -- zero-balance ESCROW set, one account for every archive table.
  select count(*)
    into bad_table_count
    from pg_catalog.unnest(table_ids) as wanted(table_id)
   where (
     select count(*)
       from public.chips_accounts accounts
      where accounts.system_key = 'POKER_TABLE:' || wanted.table_id::text
   ) <> 1
   or not exists (
     select 1
       from public.chips_accounts accounts
      where accounts.system_key = 'POKER_TABLE:' || wanted.table_id::text
        and accounts.account_type::text = 'ESCROW'
        and accounts.user_id is null
        and accounts.status::text = 'active'
        and accounts.balance = 0
   );
  if bad_table_count <> 0 then
    raise exception using
      errcode = 'P8979',
      message = 'Current canary account set is not exactly one active zero-balance ESCROW per table',
      detail = 'The supplied account-ID hash cannot be authorized for the current Production candidate',
      hint = 'Repeat read-only prepare and use its exact account ID SHA-256';
  end if;

  select pg_catalog.array_agg(accounts.id order by accounts.id)
    into current_account_ids
    from public.chips_accounts accounts
   where exists (
     select 1
       from pg_catalog.unnest(table_ids) as wanted(table_id)
      where accounts.system_key = 'POKER_TABLE:' || wanted.table_id::text
   )
     and accounts.account_type::text = 'ESCROW'
     and accounts.user_id is null
     and accounts.status::text = 'active'
     and accounts.balance = 0;
  if pg_catalog.cardinality(current_account_ids) is distinct from table_count then
    raise exception using errcode = 'P8979', message = 'Current canary account set is incomplete';
  end if;
  current_account_ids_sha256 := public.chips_archive_uuid_ids_sha256(current_account_ids);
  if p_account_ids_sha256 is distinct from current_account_ids_sha256 then
    raise exception using
      errcode = 'P8979',
      message = 'Canary account ID SHA-256 does not match current candidate',
      detail = 'The supplied hash does not match the current active zero-balance canonical ESCROW set',
      hint = 'Repeat read-only prepare and use its exact account ID SHA-256';
  end if;

  select count(*) into hot_entry_count
    from public.chips_entries entries
   where entries.account_id = any(current_account_ids);
  select count(*) into snapshot_count
    from public.chips_account_snapshot snapshots
   where snapshots.account_id = any(current_account_ids);
  select count(*) into registry_count
    from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id
      or registry.table_id = any(table_ids)
      or exists (
        select 1
          from pg_catalog.unnest(table_ids) as wanted(table_id)
         where pg_catalog.strpos(pg_catalog.lower(registry.idempotency_key), wanted.table_id::text) > 0
      );
  select count(*) into transaction_count
    from public.chips_transactions transactions
   where exists (
     select 1
       from pg_catalog.unnest(table_ids) as wanted(table_id)
      where pg_catalog.strpos(pg_catalog.lower(coalesce(transactions.reference, '')), wanted.table_id::text) > 0
         or pg_catalog.strpos(pg_catalog.lower(transactions.idempotency_key), wanted.table_id::text) > 0
         or pg_catalog.strpos(pg_catalog.lower(transactions.metadata::text), wanted.table_id::text) > 0
   );
  if hot_entry_count <> 0
     or snapshot_count <> 0
     or registry_count <> 0
     or transaction_count <> 0 then
    raise exception using
      errcode = 'P8979',
      message = 'Current canary candidate has mutable ledger dependencies',
      detail = 'Entries, snapshots, registry mappings, or table transaction identities remain',
      hint = 'Repeat read-only audit and prepare only after all dependencies are absent';
  end if;

  select policies.*
    into policy
    from public.chips_production_escrow_account_retention_policy policies
   where policies.policy_id = 'production-ledger-escrow-account-retention-v1'
   for update;
  if not found or policy.enabled or policy.canary_batch_id is not null then
    raise exception using errcode = 'P8973', message = 'Escrow account-retirement canary is already authorized or active';
  end if;
  perform pg_catalog.set_config('chips.escrow_account_retention_policy', '1', true);
  update public.chips_production_escrow_account_retention_policy policies
     set canary_batch_id = batch.batch_id,
         canary_account_ids_sha256 = current_account_ids_sha256,
         canary_confirmation = p_confirmation,
         updated_at = pg_catalog.timezone('utc', pg_catalog.now())
   where policies.policy_id = policy.policy_id;
  return pg_catalog.jsonb_build_object(
    'state', 'canary_authorized',
    'batch_id', batch.batch_id,
    'account_ids_sha256', current_account_ids_sha256,
    'confirmation', p_confirmation
  );
end;
$function$;
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
