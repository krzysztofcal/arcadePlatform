begin;

-- Issue #894: account retirement is a second, independent destructive
-- operation. It is deliberately not authorized by the existing ledger-prune
-- workflow input or by the existing destructive_go columns.
alter table public.chips_ledger_archive_batches
  add column if not exists account_retirement_at timestamptz,
  add column if not exists account_retirement_account_count bigint,
  add column if not exists account_retirement_account_ids_sha256 text,
  add column if not exists account_retirement_recovery_object_path text,
  add column if not exists account_retirement_recovery_object_sha256 text,
  add column if not exists account_retirement_snapshot_sha256 text;

alter table public.chips_ledger_archive_batches
  drop constraint if exists chips_ledger_archive_batches_account_retirement_receipt_check;

alter table public.chips_ledger_archive_batches
  add constraint chips_ledger_archive_batches_account_retirement_receipt_check
  check (
    (
      pg_catalog.num_nonnulls(
        account_retirement_at,
        account_retirement_account_count,
        account_retirement_account_ids_sha256,
        account_retirement_recovery_object_path,
        account_retirement_recovery_object_sha256,
        account_retirement_snapshot_sha256
      ) = 0
      and account_retirement_at is null
      and account_retirement_account_count is null
      and account_retirement_account_ids_sha256 is null
      and account_retirement_recovery_object_path is null
      and account_retirement_recovery_object_sha256 is null
      and account_retirement_snapshot_sha256 is null
      ) or (
      pg_catalog.num_nonnulls(
        account_retirement_at,
        account_retirement_account_count,
        account_retirement_account_ids_sha256,
        account_retirement_recovery_object_path,
        account_retirement_recovery_object_sha256,
        account_retirement_snapshot_sha256
      ) = 6
      and status = 'committed'
      and archive_proof_verified_at is not null
      and pruned_at is not null
      and registry_cleaned_at is not null
      and account_retirement_at is not null
      and account_retirement_account_count between 1 and 10
      and account_retirement_account_ids_sha256 ~ '^[0-9a-f]{64}$'
      and account_retirement_recovery_object_path ~ '^account-recovery/v1/sha256/[0-9a-f]{64}\.json\.gz$'
      and account_retirement_recovery_object_sha256 ~ '^[0-9a-f]{64}$'
      and account_retirement_snapshot_sha256 ~ '^[0-9a-f]{64}$'
      and account_retirement_recovery_object_path =
        'account-recovery/v1/sha256/' || account_retirement_recovery_object_sha256 || '.json.gz'
    )
  ),
  add constraint chips_ledger_archive_batches_account_retirement_policy_check
  check (
    source_policy_id is not null and source_policy_id in (
      'stage-ledger-bot-only-retention-7d-v1',
      'legacy_stage_allowlist_v1'
    )
    or pg_catalog.num_nonnulls(
      account_retirement_at,
      account_retirement_account_count,
      account_retirement_account_ids_sha256,
      account_retirement_recovery_object_path,
      account_retirement_recovery_object_sha256,
      account_retirement_snapshot_sha256
    ) = 0
  );

create index if not exists chips_ledger_archive_batches_account_retirement_idx
  on public.chips_ledger_archive_batches (
    source_policy_id,
    status,
    registry_cleaned_at,
    account_retirement_at,
    created_at,
    batch_id
  )
  where source_policy_id in (
    'stage-ledger-bot-only-retention-7d-v1',
    'legacy_stage_allowlist_v1'
  );

-- This singleton is the independent Stage-only kill switch. It is OFF on
-- migration and can only be enabled after an exact canary receipt exists.
create table if not exists public.chips_stage_escrow_account_retention_policy (
  policy_id text primary key
    check (policy_id = 'stage-ledger-escrow-account-retention-v1'),
  enabled boolean not null default false,
  canary_batch_id bigint
    references public.chips_ledger_archive_batches(batch_id) on delete restrict,
  canary_account_ids_sha256 text,
  canary_confirmation text,
  activated_at timestamptz,
  created_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  updated_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now()),
  constraint chips_stage_escrow_account_retention_canary_check
    check (
      (
        canary_batch_id is null
        and canary_account_ids_sha256 is null
        and canary_confirmation is null
      ) or (
        canary_batch_id is not null
        and canary_account_ids_sha256 is not null
        and canary_confirmation is not null
        and canary_account_ids_sha256 ~ '^[0-9a-f]{64}$'
        and canary_confirmation = 'GO ' || canary_batch_id::text
      )
    ),
  constraint chips_stage_escrow_account_retention_activation_check
    check (
      (enabled is false and activated_at is null)
      or (enabled is true and activated_at is not null and canary_batch_id is not null)
    )
);

insert into public.chips_stage_escrow_account_retention_policy (policy_id)
values ('stage-ledger-escrow-account-retention-v1')
on conflict (policy_id) do nothing;

alter table public.chips_stage_escrow_account_retention_policy enable row level security;
revoke all on table public.chips_stage_escrow_account_retention_policy
  from public, anon, authenticated, service_role;

create policy chips_stage_escrow_account_retention_pruner_select
  on public.chips_stage_escrow_account_retention_policy
  for select to chips_ledger_archive_pruner
  using (true);
grant select on public.chips_stage_escrow_account_retention_policy
  to chips_ledger_archive_pruner;

create or replace function public.chips_guard_stage_escrow_account_retention_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE'
     or old.policy_id is distinct from new.policy_id
     or current_user <> 'postgres'
     or coalesce(pg_catalog.current_setting('chips.escrow_account_retention_policy', true), '') <> '1' then
    raise exception using
      errcode = 'P8940',
      message = 'Escrow account-retention policy is owner-controlled';
  end if;
  if old.canary_batch_id is not null
     and (
       new.canary_batch_id is distinct from old.canary_batch_id
       or new.canary_account_ids_sha256 is distinct from old.canary_account_ids_sha256
       or new.canary_confirmation is distinct from old.canary_confirmation
     ) then
    raise exception using errcode = 'P8941', message = 'Escrow account-retention canary authorization is immutable';
  end if;
  if old.enabled is true and new.enabled is not true then
    raise exception using errcode = 'P8942', message = 'Escrow account-retention activation cannot be cleared';
  end if;
  if old.activated_at is not null and new.activated_at is distinct from old.activated_at then
    raise exception using errcode = 'P8942', message = 'Escrow account-retention activation time is immutable';
  end if;
  return new;
end;
$$;

alter function public.chips_guard_stage_escrow_account_retention_policy() owner to postgres;
revoke all on function public.chips_guard_stage_escrow_account_retention_policy()
  from public, anon, authenticated, service_role;
drop trigger if exists chips_stage_escrow_account_retention_policy_guard
  on public.chips_stage_escrow_account_retention_policy;
create trigger chips_stage_escrow_account_retention_policy_guard
before update or delete on public.chips_stage_escrow_account_retention_policy
for each row execute function public.chips_guard_stage_escrow_account_retention_policy();

create or replace function public.chips_escrow_account_retention_automatic_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select policy.enabled
        from public.chips_stage_escrow_account_retention_policy policy
       where policy.policy_id = 'stage-ledger-escrow-account-retention-v1'
    ),
    false
  );
$$;

alter function public.chips_escrow_account_retention_automatic_active() owner to postgres;
revoke all on function public.chips_escrow_account_retention_automatic_active()
  from public, anon, authenticated, service_role;

-- The account deletion guard is independent from the grant. Even the NOLOGIN
-- pruner cannot delete an account without reaching the validated SECURITY
-- DEFINER function below and setting its transaction-local context.
create or replace function public.chips_guard_escrow_account_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  call_stack text;
begin
  get diagnostics call_stack = pg_context;
  if old.account_type::text <> 'ESCROW' then
    return old;
  end if;
  -- This guard is scoped to the only records this feature can retire.  It
  -- requires the validated function call stack in addition to the
  -- transaction-local context.  A DELETE grant or a caller-supplied GUC is
  -- therefore not sufficient to authorize an account retirement.
  if tg_op = 'DELETE'
     and current_user = 'chips_ledger_archive_pruner'
     and coalesce(pg_catalog.current_setting('chips.escrow_account_retirement_delete', true), '') = '1'
     and coalesce(pg_catalog.current_setting('chips.escrow_account_retirement_batch_id', true), '') <> ''
     and pg_catalog.strpos(call_stack, 'chips_retire_stage_escrow_accounts') > 0 then
    return old;
  end if;
  raise exception using
    errcode = 'P8943',
    message = 'Direct chips_accounts DELETE is forbidden; use the validated Stage retirement function';
end;
$$;

alter function public.chips_guard_escrow_account_delete() owner to postgres;
revoke all on function public.chips_guard_escrow_account_delete()
  from public, anon, authenticated, service_role;
drop trigger if exists chips_accounts_escrow_retirement_guard on public.chips_accounts;
create trigger chips_accounts_escrow_retirement_guard
before delete on public.chips_accounts
for each row execute function public.chips_guard_escrow_account_delete();

-- The archive batch guard predates the account receipt columns. This separate
-- trigger keeps the old proof/prune/cleanup guard unchanged while making the
-- new receipt a strict empty -> complete transition.
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
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P8944', message = 'Archive account-retirement receipts are immutable';
  end if;
  changed := new.account_retirement_at is distinct from old.account_retirement_at
    or new.account_retirement_account_count is distinct from old.account_retirement_account_count
    or new.account_retirement_account_ids_sha256 is distinct from old.account_retirement_account_ids_sha256
    or new.account_retirement_recovery_object_path is distinct from old.account_retirement_recovery_object_path
    or new.account_retirement_recovery_object_sha256 is distinct from old.account_retirement_recovery_object_sha256
    or new.account_retirement_snapshot_sha256 is distinct from old.account_retirement_snapshot_sha256;
  old_count := pg_catalog.num_nonnulls(
    old.account_retirement_at,
    old.account_retirement_account_count,
    old.account_retirement_account_ids_sha256,
    old.account_retirement_recovery_object_path,
    old.account_retirement_recovery_object_sha256,
    old.account_retirement_snapshot_sha256
  );
  new_count := pg_catalog.num_nonnulls(
    new.account_retirement_at,
    new.account_retirement_account_count,
    new.account_retirement_account_ids_sha256,
    new.account_retirement_recovery_object_path,
    new.account_retirement_recovery_object_sha256,
    new.account_retirement_snapshot_sha256
  );
  if old_count = 0 then
    if new_count not in (0, 6) then
      raise exception using errcode = 'P8944', message = 'Account-retirement receipt must be empty or complete';
    end if;
    if new_count = 6 and (
      current_user <> 'chips_ledger_archive_pruner'
      or coalesce(pg_catalog.current_setting('chips.escrow_account_retirement_receipt', true), '') <> '1'
      or pg_catalog.strpos(call_stack, 'chips_retire_stage_escrow_accounts') <= 0
    ) then
      raise exception using errcode = 'P8944', message = 'Account-retirement receipt requires the archive pruner function';
    end if;
  elsif changed then
    raise exception using errcode = 'P8944', message = 'Account-retirement receipt cannot be replaced or cleared';
  end if;
  return new;
end;
$$;

alter function public.chips_guard_account_retirement_receipt() owner to postgres;
revoke all on function public.chips_guard_account_retirement_receipt()
  from public, anon, authenticated, service_role;
drop trigger if exists chips_ledger_archive_batches_account_retirement_guard
  on public.chips_ledger_archive_batches;
create trigger chips_ledger_archive_batches_account_retirement_guard
before update or delete on public.chips_ledger_archive_batches
for each row execute function public.chips_guard_account_retirement_receipt();

-- The role already owns the existing archive-prune functions. Extend only the
-- read set needed to prove that no dependent row survives account delete.
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
create policy chips_archive_pruner_accounts_delete
  on public.chips_accounts
  for delete to chips_ledger_archive_pruner
  using (
    account_type::text = 'ESCROW'
    and coalesce(pg_catalog.current_setting('chips.escrow_account_retirement_delete', true), '') = '1'
    and coalesce(pg_catalog.current_setting('chips.escrow_account_retirement_batch_id', true), '') <> ''
  );
create policy chips_archive_pruner_snapshot_select
  on public.chips_account_snapshot
  for select to chips_ledger_archive_pruner
  using (true);

grant execute on function public.chips_escrow_account_retention_automatic_active()
  to postgres, chips_ledger_archive_pruner;

grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

-- A single function is used for both read-only prepare (REPEATABLE READ,
-- READ ONLY) and destructive execute (SERIALIZABLE). The read-only branch
-- contains no row locks, DML, or calls to mutating functions.
create function public.chips_retire_stage_escrow_accounts(
  p_batch_id bigint,
  p_account_ids uuid[],
  p_recovery_object_path text,
  p_recovery_object_sha256 text,
  p_account_snapshot_sha256 text,
  p_execute boolean default false,
  p_confirmation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  proof public.chips_legacy_stage_allowlist_proofs%rowtype;
  policy public.chips_stage_escrow_account_retention_policy%rowtype;
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
  stage_system_identifier text;
begin
  if p_execute is null then
    raise exception using errcode = 'P8945', message = 'Escrow account retirement execute flag must not be NULL';
  end if;
  if p_batch_id is null
     or p_account_ids is null
     or pg_catalog.cardinality(p_account_ids) not between 1 and 10
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

  stage_system_identifier := public.chips_assert_archive_prune_stage();
  if stage_system_identifier is distinct from '7656985631720456337' then
    raise exception using
      errcode = 'P8976',
      message = 'Escrow account retirement is restricted to canonical Stage';
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
       and locks.classid::bigint = ((pg_catalog.hashtextextended('chips-ledger-stage-automation-v1:krydukthwdvccggbyjfw', 0) >> 32) & 4294967295)
       and locks.objid::bigint = (pg_catalog.hashtextextended('chips-ledger-stage-automation-v1:krydukthwdvccggbyjfw', 0) & 4294967295)
  ) then
    raise exception using
      errcode = 'P8977',
      message = 'Stage automation advisory lock is required before escrow account retirement';
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
     or batch.project_ref is distinct from 'krydukthwdvccggbyjfw'
     or batch.format_version is distinct from 2
     or batch.source_policy_id not in (
       'stage-ledger-bot-only-retention-7d-v1',
       'legacy_stage_allowlist_v1'
     ) then
    raise exception using errcode = 'P8948', message = 'Escrow account retirement requires a committed canonical Stage schema-v2 batch';
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

  if batch.source_policy_id = 'stage-ledger-bot-only-retention-7d-v1' then
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
  else
    select proofs.*
      into proof
      from public.chips_legacy_stage_allowlist_proofs proofs
     where proofs.batch_id = batch.batch_id;
    if not found
       or proof.object_path is distinct from batch.object_path
       or proof.project_ref is distinct from batch.project_ref
       or proof.source_policy_id is distinct from batch.source_policy_id
       or proof.cutoff is distinct from batch.cutoff
       or proof.postgres_system_identifier is distinct from '7656985631720456337'
       or proof.master_table_ids is null
       or proof.batch_table_ids is null
       or pg_catalog.array_position(proof.master_table_ids, null) is not null
       or pg_catalog.array_position(proof.batch_table_ids, null) is not null
       or proof.master_table_count is distinct from 974
       or pg_catalog.cardinality(proof.master_table_ids) is distinct from 974
       or pg_catalog.cardinality(proof.batch_table_ids) not between 1 and 10
       or proof.master_table_ids_sha256 is null
       or proof.master_table_ids_sha256 !~ '^[0-9a-f]{64}$'
       or proof.batch_table_ids_sha256 is null
       or proof.batch_table_ids_sha256 !~ '^[0-9a-f]{64}$'
       or batch.legacy_master_table_count is distinct from 974
       or batch.legacy_allowlist_sha256 is null
       or batch.legacy_allowlist_sha256 !~ '^[0-9a-f]{64}$'
       or batch.legacy_batch_table_ids_sha256 is null
       or batch.legacy_batch_table_ids_sha256 !~ '^[0-9a-f]{64}$'
       or proof.master_table_ids is distinct from (
         select pg_catalog.array_agg(ids.id order by ids.id)
           from pg_catalog.unnest(proof.master_table_ids) as ids(id)
       )
       or (
         select count(*) from pg_catalog.unnest(proof.master_table_ids) as ids(id)
       ) <> (
         select count(distinct id) from pg_catalog.unnest(proof.master_table_ids) as ids(id)
       )
       or proof.master_table_ids is distinct from batch.legacy_master_table_ids
       or proof.master_table_ids_sha256 is distinct from batch.legacy_allowlist_sha256
       or public.chips_archive_uuid_ids_sha256(proof.master_table_ids) is distinct from proof.master_table_ids_sha256
       or proof.batch_table_ids is distinct from (
         select pg_catalog.array_agg(ids.id order by ids.id)
           from pg_catalog.unnest(proof.batch_table_ids) as ids(id)
       )
       or (
         select count(*) from pg_catalog.unnest(proof.batch_table_ids) as ids(id)
       ) <> (
         select count(distinct id) from pg_catalog.unnest(proof.batch_table_ids) as ids(id)
       )
       or exists (
         select 1
           from pg_catalog.unnest(proof.batch_table_ids) as ids(id)
          where not (ids.id = any(proof.master_table_ids))
       )
       or proof.batch_table_count is distinct from batch.legacy_batch_table_count
       or proof.batch_table_count is null
       or proof.batch_table_ids_sha256 is distinct from batch.legacy_batch_table_ids_sha256
       or public.chips_archive_uuid_ids_sha256(proof.batch_table_ids) is distinct from proof.batch_table_ids_sha256
       or batch.legacy_batch_table_count is distinct from pg_catalog.cardinality(proof.batch_table_ids)
       or batch.legacy_batch_number is null
       or batch.legacy_batch_number is distinct from proof.batch_number
       or proof.source_run is null
       or pg_catalog.btrim(proof.source_run) = ''
       or proof.query_sha256 is null
       or proof.query_sha256 !~ '^[0-9a-f]{64}$' then
      raise exception using errcode = 'P8951', message = 'Legacy account retirement proof is incomplete or changed';
    end if;
    if proof.source_run is distinct from batch.legacy_source_run
       or proof.query_sha256 is distinct from batch.legacy_query_sha256 then
      raise exception using errcode = 'P8951', message = 'Legacy account retirement proof source binding is incomplete or changed';
    end if;
    if batch.batch_id <> 13 then
      if batch.legacy_run_id is null or batch.legacy_plan_sha256 is null
         or not exists (
           select 1
             from public.chips_legacy_stage_allowlist_runs runs
            where runs.run_id = batch.legacy_run_id
              and runs.plan_sha256 = batch.legacy_plan_sha256
              and runs.status = 'authorized'
              and runs.project_ref = batch.project_ref
              and runs.source_policy_id = batch.source_policy_id
              and runs.stage_system_identifier = '7656985631720456337'
         ) then
        raise exception using errcode = 'P8952', message = 'Legacy account retirement run/plan binding is incomplete';
      end if;
    elsif batch.legacy_run_id is not null or batch.legacy_plan_sha256 is not null then
      raise exception using errcode = 'P8952', message = 'Legacy batch 13 must not have a later run binding';
    end if;
    table_ids := proof.batch_table_ids;
    lifecycle_state := 'legacy';
  end if;

  table_count := pg_catalog.cardinality(table_ids);
  if table_count is null or table_count < 1 or table_count > 10 then
    raise exception using errcode = 'P8953', message = 'Archive batch table count is outside the account-retirement limit';
  end if;
  if batch.source_policy_id = 'stage-ledger-bot-only-retention-7d-v1' and table_count <> 1 then
    raise exception using errcode = 'P8953', message = 'Bot-only archive batch must contain one table';
  end if;
  if batch.source_policy_id = 'legacy_stage_allowlist_v1'
     and batch.legacy_batch_table_count is distinct from table_count then
    raise exception using errcode = 'P8953', message = 'Legacy archive table count differs from its proof';
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
       and triggers.tgname <> 'chips_accounts_escrow_retirement_guard'
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
  select count(*) into transaction_count
    from public.chips_transactions transactions
   where exists (
     select 1
       from pg_catalog.unnest(table_ids) as wanted(table_id)
      where pg_catalog.strpos(pg_catalog.lower(coalesce(transactions.reference, '')), wanted.table_id::text) > 0
         or pg_catalog.strpos(pg_catalog.lower(transactions.idempotency_key), wanted.table_id::text) > 0
         or pg_catalog.strpos(pg_catalog.lower(transactions.metadata::text), wanted.table_id::text) > 0
   );
  if transaction_count <> 0 then
    raise exception using errcode = 'P8965', message = 'Residual table transaction identity blocks account retirement';
  end if;

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
    from public.chips_stage_escrow_account_retention_policy policies
   where policies.policy_id = 'stage-ledger-escrow-account-retention-v1';
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
  perform public.chips_lock_table_fence_for_legacy_cleanup();
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
       and triggers.tgname <> 'chips_accounts_escrow_retirement_guard'
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
  select count(*) into transaction_count
    from public.chips_transactions transactions
   where exists (
     select 1
       from pg_catalog.unnest(table_ids) as wanted(table_id)
      where pg_catalog.strpos(pg_catalog.lower(coalesce(transactions.reference, '')), wanted.table_id::text) > 0
         or pg_catalog.strpos(pg_catalog.lower(transactions.idempotency_key), wanted.table_id::text) > 0
         or pg_catalog.strpos(pg_catalog.lower(transactions.metadata::text), wanted.table_id::text) > 0
   );
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

  perform pg_catalog.set_config('chips.escrow_account_retirement_delete', '1', true);
  perform pg_catalog.set_config('chips.escrow_account_retirement_batch_id', batch.batch_id::text, true);
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
$$;

reset role;
alter function public.chips_retire_stage_escrow_accounts(
  bigint, uuid[], text, text, text, boolean, text
) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_retire_stage_escrow_accounts(
  bigint, uuid[], text, text, text, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.chips_retire_stage_escrow_accounts(
  bigint, uuid[], text, text, text, boolean, text
) to postgres, chips_ledger_archive_pruner;

reset role;

-- Owner-only canary authorization.  This is deliberately separate from the
-- existing ledger-prune GO: the account ID set is independently hashed and
-- the account-retirement kill switch remains disabled until this exact
-- canary has produced a complete receipt.
create or replace function public.chips_authorize_stage_escrow_account_retirement_canary(
  p_batch_id bigint,
  p_account_ids_sha256 text,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  policy public.chips_stage_escrow_account_retention_policy%rowtype;
  stage_system_identifier text;
begin
  stage_system_identifier := public.chips_assert_archive_prune_stage();
  if stage_system_identifier is distinct from '7656985631720456337' then
    raise exception using
      errcode = 'P8976',
      message = 'Escrow account-retirement canary is restricted to canonical Stage';
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
     or batch.project_ref is distinct from 'krydukthwdvccggbyjfw'
     or batch.format_version is distinct from 2
     or batch.source_policy_id not in (
       'stage-ledger-bot-only-retention-7d-v1',
       'legacy_stage_allowlist_v1'
     )
     or batch.archive_proof_verified_at is null
     or batch.pruned_at is null
     or batch.registry_cleaned_at is null
     or batch.destructive_go_at is null
     or batch.destructive_go_batch_id is distinct from batch.batch_id
     or batch.account_retirement_at is not null then
    raise exception using errcode = 'P8972', message = 'Canary batch is not a complete, unretired Stage archive batch';
  end if;
  select policies.* into policy
    from public.chips_stage_escrow_account_retention_policy policies
   where policies.policy_id = 'stage-ledger-escrow-account-retention-v1'
   for update;
  if not found or policy.enabled or policy.canary_batch_id is not null then
    raise exception using errcode = 'P8973', message = 'Escrow account-retirement canary is already authorized or active';
  end if;
  perform pg_catalog.set_config('chips.escrow_account_retention_policy', '1', true);
  update public.chips_stage_escrow_account_retention_policy policies
     set canary_batch_id = batch.batch_id,
         canary_account_ids_sha256 = p_account_ids_sha256,
         canary_confirmation = p_confirmation,
         updated_at = pg_catalog.timezone('utc', pg_catalog.now())
   where policies.policy_id = policy.policy_id;
  return pg_catalog.jsonb_build_object(
    'state', 'canary_authorized',
    'batch_id', batch.batch_id,
    'account_ids_sha256', p_account_ids_sha256,
    'confirmation', p_confirmation
  );
end;
$$;

alter function public.chips_authorize_stage_escrow_account_retirement_canary(bigint, text, text)
  owner to postgres;
revoke all on function public.chips_authorize_stage_escrow_account_retirement_canary(bigint, text, text)
  from public, anon, authenticated, service_role, chips_ledger_archive_pruner;
grant execute on function public.chips_authorize_stage_escrow_account_retirement_canary(bigint, text, text)
  to postgres;

-- Owner-only activation after the exact canary receipt is visible.  The
-- activation string binds the owner action to both the batch and account set;
-- it cannot be cleared or replaced by application roles.
create or replace function public.chips_activate_stage_escrow_account_retention(
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  policy public.chips_stage_escrow_account_retention_policy%rowtype;
  batch public.chips_ledger_archive_batches%rowtype;
  expected text;
  stage_system_identifier text;
begin
  stage_system_identifier := public.chips_assert_archive_prune_stage();
  if stage_system_identifier is distinct from '7656985631720456337' then
    raise exception using
      errcode = 'P8976',
      message = 'Escrow account-retention activation is restricted to canonical Stage';
  end if;
  select policies.* into policy
    from public.chips_stage_escrow_account_retention_policy policies
   where policies.policy_id = 'stage-ledger-escrow-account-retention-v1'
   for update;
  if not found or policy.canary_batch_id is null or policy.enabled then
    raise exception using errcode = 'P8974', message = 'Escrow account-retirement canary is not ready for activation';
  end if;
  expected := 'ACTIVATE stage-ledger-escrow-account-retention-v1 CANARY '
    || policy.canary_batch_id::text || ' ' || policy.canary_account_ids_sha256;
  if p_confirmation is distinct from expected then
    raise exception using errcode = 'P8974', message = 'Exact escrow account-retirement activation confirmation is required';
  end if;
  select batches.* into batch
    from public.chips_ledger_archive_batches batches
   where batches.batch_id = policy.canary_batch_id
   for update;
  if not found
     or batch.account_retirement_at is null
     or batch.account_retirement_account_ids_sha256 is distinct from policy.canary_account_ids_sha256
     or batch.account_retirement_account_count is null
     or batch.account_retirement_recovery_object_path is null
     or batch.account_retirement_recovery_object_sha256 is null
     or batch.account_retirement_snapshot_sha256 is null then
    raise exception using errcode = 'P8975', message = 'Complete canary account-retirement receipt is required before activation';
  end if;
  perform pg_catalog.set_config('chips.escrow_account_retention_policy', '1', true);
  update public.chips_stage_escrow_account_retention_policy policies
     set enabled = true,
         activated_at = coalesce(policies.activated_at, pg_catalog.timezone('utc', pg_catalog.now())),
         updated_at = pg_catalog.timezone('utc', pg_catalog.now())
   where policies.policy_id = policy.policy_id;
  return pg_catalog.jsonb_build_object(
    'state', 'active',
    'canary_batch_id', policy.canary_batch_id,
    'canary_account_ids_sha256', policy.canary_account_ids_sha256,
    'activated_at', pg_catalog.timezone('utc', pg_catalog.now())
  );
end;
$$;

alter function public.chips_activate_stage_escrow_account_retention(text)
  owner to postgres;
revoke all on function public.chips_activate_stage_escrow_account_retention(text)
  from public, anon, authenticated, service_role, chips_ledger_archive_pruner;
grant execute on function public.chips_activate_stage_escrow_account_retention(text)
  to postgres;

revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;

commit;
