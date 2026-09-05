begin;

-- #923 automatic execution is a one-time, owner-controlled Stage rollout.  The
-- canary and lifecycle marker are the durable activation evidence; no API role
-- can write this state.
alter table public.chips_stage_closed_human_table_retention_policy
  add column if not exists activation_go_at timestamptz,
  add column if not exists activation_confirmation text;

do $constraint$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.chips_stage_closed_human_table_retention_policy'::pg_catalog.regclass
       and conname = 'chips_stage_closed_human_retention_activation_check'
  ) then
    alter table public.chips_stage_closed_human_table_retention_policy
      add constraint chips_stage_closed_human_retention_activation_check check (
    (
      enabled is false
      and activation_go_at is null
      and activation_confirmation is null
      and activated_at is null
    )
    or (
      enabled is true
      and activation_go_at is not null
      and activation_confirmation =
        'ACTIVATE stage-ledger-closed-human-table-retention-30d-v1 CANARY '
        || canary_batch_id::text
      and activated_at is not null
      and canary_batch_id is not null
    )
      );
  end if;
end;
$constraint$;

create or replace function public.chips_guard_closed_human_retention_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'postgres'
     or new.policy_id is distinct from old.policy_id
     or new.created_at is distinct from old.created_at
     or old.enabled is true then
    raise exception using errcode = 'P9260',
      message = 'Closed-human automatic Stage activation is owner-controlled and one-time';
  end if;

  -- Preserve the established owner-only canary authorization path.  It sets
  -- chips.closed_human_go before latching exactly batch 334; every other
  -- inactive-policy update is rejected.
  if new.enabled is false then
    if coalesce(pg_catalog.current_setting('chips.closed_human_go', true), '') <> '1'
       or old.canary_batch_id is not null
       or old.canary_confirmation is not null
       or new.canary_batch_id is distinct from 334
       or new.canary_confirmation is distinct from 'GO 334'
       or new.activation_go_at is not null
       or new.activation_confirmation is not null
       or new.activated_at is not null then
      raise exception using errcode = 'P9260',
        message = 'Closed-human canary latch is owner-controlled and exact';
    end if;
    return new;
  end if;

  if coalesce(pg_catalog.current_setting('chips.closed_human_policy_activation', true), '') <> '1'
     or new.activation_go_at is null
     or new.activation_confirmation is distinct from
       ('ACTIVATE stage-ledger-closed-human-table-retention-30d-v1 CANARY ' || new.canary_batch_id::text)
     or new.activated_at is null
     or new.canary_batch_id is distinct from 334
     or new.canary_confirmation is distinct from 'GO 334' then
    raise exception using errcode = 'P9260',
      message = 'Closed-human automatic Stage activation is owner-controlled and one-time';
  end if;
  return new;
end;
$$;
alter function public.chips_guard_closed_human_retention_policy() owner to postgres;
revoke all on function public.chips_guard_closed_human_retention_policy()
  from public, anon, authenticated, service_role;
drop trigger if exists chips_stage_closed_human_retention_policy_guard
  on public.chips_stage_closed_human_table_retention_policy;
create trigger chips_stage_closed_human_retention_policy_guard
before update on public.chips_stage_closed_human_table_retention_policy
for each row execute function public.chips_guard_closed_human_retention_policy();

-- The historical closed-human wrapper remains the only prune implementation.
-- It accepts the active policy only when this transaction carries the private
-- automatic latch; manual/canary calls retain their manual-only contract.
grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;
do $patch$
declare
  definition text;
  patched text;
  before_execute_patch text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_prune_closed_human_table_archive_batch(text,uuid[],bigint[],uuid,boolean,bigint)'::pg_catalog.regprocedure
  ) into definition;
  if definition is null then
    raise exception 'closed-human prune wrapper is required before automatic activation';
  end if;

  patched := definition;
  if pg_catalog.strpos(
    patched,
    'Closed-human policy is not in the required manual-only or active automatic state'
  ) = 0 then
    patched := pg_catalog.replace(
      patched,
      $needle$if not found
     or policy.enabled is true
     or policy.activated_at is not null then
    raise exception using errcode = 'P9235', message = 'Closed-human canary policy is not manual-only';
  end if;$needle$,
    $replacement$if not found
     or (
       (policy.enabled is true or policy.activated_at is not null)
       and coalesce(pg_catalog.current_setting('chips.closed_human_automatic', true), '') <> '1'
     )
     or (
       coalesce(pg_catalog.current_setting('chips.closed_human_automatic', true), '') = '1'
       and (policy.enabled is not true or policy.activated_at is null)
     ) then
    raise exception using errcode = 'P9235', message = 'Closed-human policy is not in the required manual-only or active automatic state';
  end if;$replacement$
    );
    if patched = definition
       or pg_catalog.strpos(
         patched,
         'Closed-human policy is not in the required manual-only or active automatic state'
       ) = 0 then
      raise exception 'Closed-human prune wrapper policy gate shape changed; refusing an implicit migration';
    end if;
  end if;

  if (
    pg_catalog.length(patched)
    - pg_catalog.length(pg_catalog.replace(
        patched,
        'policy.enabled is not true or policy.activated_at is null',
        ''
      ))
  ) < 2 * pg_catalog.length('policy.enabled is not true or policy.activated_at is null') then
    before_execute_patch := patched;
    patched := pg_catalog.replace(
      patched,
      $needle$if p_execute is true then
    if p_approved_batch_id is distinct from batch.batch_id
       or policy.canary_batch_id is distinct from batch.batch_id
       or policy.canary_confirmation is distinct from ('GO ' || batch.batch_id::text)
       or batch.destructive_go_at is null
       or batch.destructive_go_batch_id is distinct from batch.batch_id then
      raise exception using errcode = 'P9235', message = 'Exact closed-human batch GO is required before execute';
    end if;
  end if;$needle$,
      $replacement$if p_execute is true then
    if p_approved_batch_id is distinct from batch.batch_id
       or batch.destructive_go_at is null
       or batch.destructive_go_batch_id is distinct from batch.batch_id
       or (
         coalesce(pg_catalog.current_setting('chips.closed_human_automatic', true), '') <> '1'
         and (
           policy.canary_batch_id is distinct from batch.batch_id
           or policy.canary_confirmation is distinct from ('GO ' || batch.batch_id::text)
         )
       )
       or (
         coalesce(pg_catalog.current_setting('chips.closed_human_automatic', true), '') = '1'
         and (policy.enabled is not true or policy.activated_at is null)
       ) then
      raise exception using errcode = 'P9235', message = 'Exact closed-human batch GO is required before execute';
    end if;
  end if;$replacement$
    );
    if patched = before_execute_patch
       or (
         pg_catalog.length(patched)
         - pg_catalog.length(pg_catalog.replace(
             patched,
             'policy.enabled is not true or policy.activated_at is null',
             ''
           ))
       ) < 2 * pg_catalog.length('policy.enabled is not true or policy.activated_at is null') then
      raise exception 'Closed-human prune wrapper execute gate shape changed; refusing an implicit migration';
    end if;
  end if;

  if pg_catalog.strpos(
       patched,
       'Closed-human policy is not in the required manual-only or active automatic state'
     ) = 0
     or (
       pg_catalog.length(patched)
       - pg_catalog.length(pg_catalog.replace(
           patched,
           'policy.enabled is not true or policy.activated_at is null',
           ''
         ))
     ) < 2 * pg_catalog.length('policy.enabled is not true or policy.activated_at is null') then
    raise exception 'Closed-human prune wrapper execute gate shape changed; refusing an implicit migration';
  end if;
  if patched <> definition then
    execute patched;
  end if;
end;
$patch$;
reset role;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;

create or replace function public.chips_closed_human_retention_automatic_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select enabled is true
       and activation_go_at is not null
       and activated_at is not null
       and canary_batch_id = 334
       and canary_confirmation = 'GO 334'
       and activation_confirmation =
         'ACTIVATE stage-ledger-closed-human-table-retention-30d-v1 CANARY 334'
      from public.chips_stage_closed_human_table_retention_policy
     where policy_id = 'stage-ledger-closed-human-table-retention-30d-v1'
  ), false);
$$;
alter function public.chips_closed_human_retention_automatic_active() owner to postgres;
revoke all on function public.chips_closed_human_retention_automatic_active()
  from public, anon, authenticated, service_role;
grant execute on function public.chips_closed_human_retention_automatic_active()
  to postgres, chips_ledger_archive_pruner;

-- Activation reuses the exact existing canary wrapper in read-only mode.  The
-- database repeats the durable batch/table/receipt/lifecycle checks in the
-- same transaction immediately before changing the singleton policy row.
create or replace function public.chips_activate_closed_human_table_retention_policy(
  p_canary_batch_id bigint,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  canary public.chips_ledger_archive_batches%rowtype;
  policy public.chips_stage_closed_human_table_retention_policy%rowtype;
  transaction_ids uuid[];
  entry_ids bigint[];
  registry_count bigint;
  distinct_table_count bigint;
  null_table_count bigint;
  receipt_count integer;
  cleanup_count integer;
  table_count bigint;
  dry_result jsonb;
begin
  if p_canary_batch_id is distinct from 334
     or p_confirmation is distinct from
       'ACTIVATE stage-ledger-closed-human-table-retention-30d-v1 CANARY 334' then
    raise exception using errcode = 'P9261', message = 'Exact closed-human automatic activation confirmation is required';
  end if;

  select policies.*
    into policy
    from public.chips_stage_closed_human_table_retention_policy as policies
   where policies.policy_id = 'stage-ledger-closed-human-table-retention-30d-v1'
   for update;
  if not found then
    raise exception using errcode = 'P9262', message = 'Closed-human automatic policy row is missing';
  end if;
  if policy.canary_batch_id is distinct from 334
     or policy.canary_confirmation is distinct from 'GO 334' then
    raise exception using errcode = 'P9262', message = 'Automatic Stage policy requires the exact successful closed-human canary 334';
  end if;

  select batches.*
    into canary
    from public.chips_ledger_archive_batches as batches
   where batches.batch_id = 334
   for update;
  if not found
     or canary.project_ref is distinct from 'krydukthwdvccggbyjfw'
     or canary.format_version is distinct from 1
     or canary.source_policy_id is distinct from 'stage-ledger-closed-human-table-retention-30d-v1'
     or canary.status is distinct from 'committed'
     or canary.committed_at is null
     or canary.object_path is distinct from ('v1/sha256/' || canary.compressed_sha256 || '.jsonl.gz')
     or coalesce(canary.raw_sha256, '') !~ '^[0-9a-f]{64}$'
     or coalesce(canary.compressed_sha256, '') !~ '^[0-9a-f]{64}$'
     or canary.transaction_count is null
     or canary.transaction_count < 1
     or canary.transaction_count > 5000
     or canary.entry_count is null
     or canary.entry_count < 1
     or canary.archive_proof_verified_at is null
     or coalesce(canary.archived_transaction_ids_sha256, '') !~ '^[0-9a-f]{64}$'
     or coalesce(canary.archived_entry_ids_sha256, '') !~ '^[0-9a-f]{64}$'
     or pg_catalog.num_nonnulls(
       canary.pruned_at,
       canary.pruned_transaction_count,
       canary.pruned_entry_count,
       canary.pruned_transaction_ids_sha256,
       canary.pruned_entry_ids_sha256
     ) <> 5
     or canary.pruned_transaction_count is distinct from canary.transaction_count
     or canary.pruned_entry_count is distinct from canary.entry_count
     or canary.pruned_transaction_ids_sha256 is distinct from canary.archived_transaction_ids_sha256
     or canary.pruned_entry_ids_sha256 is distinct from canary.archived_entry_ids_sha256
     or pg_catalog.num_nonnulls(
       canary.registry_cleaned_at,
       canary.registry_cleaned_key_count,
       canary.registry_cleaned_keys_sha256
     ) <> 0
     or canary.destructive_go_at is null
     or canary.destructive_go_batch_id is distinct from 334 then
    raise exception using errcode = 'P9263', message = 'Automatic Stage policy requires a complete exact closed-human canary 334';
  end if;

  select pg_catalog.array_agg(registry.transaction_id order by transactions.created_at, transactions.id),
         pg_catalog.count(*),
         pg_catalog.count(distinct registry.table_id),
         pg_catalog.count(*) filter (where registry.table_id is null)
    into transaction_ids, registry_count, distinct_table_count, null_table_count
    from public.chips_transaction_idempotency as registry
    join public.chips_transactions as transactions on transactions.id = registry.transaction_id
   where registry.archive_batch_id = 334;
  if registry_count <> canary.transaction_count
     or distinct_table_count <> 1
     or null_table_count <> 0
     or not exists (
       select 1
         from public.chips_transaction_idempotency as registry
        where registry.archive_batch_id = 334
          and registry.table_id = 'ec3f4897-c7bb-4d92-b63d-a38401e9a5c4'::uuid
     ) then
    raise exception using errcode = 'P9264', message = 'Automatic Stage canary registry binding is not exact';
  end if;

  select pg_catalog.array_agg(entries.id order by wanted.ordinality, entries.id)
    into entry_ids
    from pg_catalog.unnest(transaction_ids) with ordinality as wanted(id, ordinality)
    join public.chips_entries as entries on entries.transaction_id = wanted.id;
  if pg_catalog.cardinality(entry_ids) <> canary.entry_count then
    raise exception using errcode = 'P9264', message = 'Automatic Stage canary entry binding is not exact';
  end if;

  select pg_catalog.count(*)
    into table_count
    from public.poker_tables as tables
   where tables.id = 'ec3f4897-c7bb-4d92-b63d-a38401e9a5c4'::uuid
     and tables.has_human_participant is true
     and pg_catalog.upper(tables.status::text) = 'CLOSED'
     and tables.human_retention_complete_at is not null;
  if table_count <> 1 then
    raise exception using errcode = 'P9265', message = 'Automatic Stage policy requires the canary human lifecycle marker';
  end if;

  perform public.chips_assert_closed_human_table_lifecycle_gate(
    'ec3f4897-c7bb-4d92-b63d-a38401e9a5c4'::uuid,
    canary.cutoff,
    canary.batch_id
  );

  if policy.enabled is true then
    if policy.activation_go_at is null
       or policy.activated_at is null
       or policy.activation_confirmation is distinct from p_confirmation then
      raise exception using errcode = 'P9266', message = 'Closed-human automatic policy has an invalid active state';
    end if;
    return pg_catalog.jsonb_build_object(
      'state', 'already_active',
      'policy_id', policy.policy_id,
      'canary_batch_id', 334,
      'activation_confirmation', p_confirmation
    );
  end if;
  if policy.enabled is not false
     or policy.activation_go_at is not null
     or policy.activation_confirmation is not null
     or policy.activated_at is not null then
    raise exception using errcode = 'P9266', message = 'Closed-human automatic policy is not in the one-time inactive state';
  end if;

  dry_result := public.chips_prune_closed_human_table_archive_batch(
    canary.object_path,
    transaction_ids,
    entry_ids,
    'ec3f4897-c7bb-4d92-b63d-a38401e9a5c4'::uuid,
    false,
    null
  );
  if dry_result->>'state' is distinct from 'already_pruned'
     or dry_result->>'table_id' is distinct from 'ec3f4897-c7bb-4d92-b63d-a38401e9a5c4' then
    raise exception using errcode = 'P9267', message = 'Automatic Stage policy activation requires a complete canary dry-run';
  end if;

  perform pg_catalog.set_config('chips.closed_human_policy_activation', '1', true);
  update public.chips_stage_closed_human_table_retention_policy as policies
     set enabled = true,
         activation_go_at = pg_catalog.timezone('utc', pg_catalog.now()),
         activation_confirmation = p_confirmation,
         activated_at = pg_catalog.timezone('utc', pg_catalog.now()),
         updated_at = pg_catalog.timezone('utc', pg_catalog.now())
   where policies.policy_id = 'stage-ledger-closed-human-table-retention-30d-v1'
     and policies.enabled is false
     and policies.activation_go_at is null
     and policies.activation_confirmation is null
     and policies.activated_at is null;
  if not found then
    raise exception using errcode = 'P9268', message = 'Closed-human automatic policy activation transition was not unique';
  end if;

  return pg_catalog.jsonb_build_object(
    'state', 'active',
    'policy_id', policy.policy_id,
    'canary_batch_id', 334,
    'activation_confirmation', p_confirmation
  );
end;
$$;
alter function public.chips_activate_closed_human_table_retention_policy(bigint, text)
  owner to postgres;
revoke all on function public.chips_activate_closed_human_table_retention_policy(bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.chips_activate_closed_human_table_retention_policy(bigint, text)
  to postgres;

-- This is only a thin automatic authorization adapter.  The existing
-- closed-human wrapper still performs the immutable whitelist, proof, exact
-- IDs, conservation, balance, registry and lifecycle checks and is the only
-- function that performs the destructive prune.
create or replace function public.chips_auto_prune_closed_human_table_archive_batch(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_table_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  policy public.chips_stage_closed_human_table_retention_policy%rowtype;
  registry_count bigint;
  distinct_table_count bigint;
  null_table_count bigint;
  receipt_count integer;
  go_count integer;
  result jsonb;
begin
  if not public.chips_closed_human_retention_automatic_active() then
    raise exception using errcode = 'P9269', message = 'Automatic closed-human Stage retention is not active';
  end if;
  if p_object_path is null
     or p_transaction_ids is null
     or p_entry_ids is null
     or p_table_id is null
     or pg_catalog.cardinality(p_transaction_ids) < 1
     or pg_catalog.cardinality(p_entry_ids) < 1 then
    raise exception using errcode = 'P9270', message = 'Automatic closed-human exact archive binding is required';
  end if;

  select policies.*
    into policy
    from public.chips_stage_closed_human_table_retention_policy as policies
   where policies.policy_id = 'stage-ledger-closed-human-table-retention-30d-v1';
  if not found
     or policy.enabled is not true
     or policy.canary_batch_id is distinct from 334
     or policy.canary_confirmation is distinct from 'GO 334'
     or policy.activation_confirmation is distinct from
       'ACTIVATE stage-ledger-closed-human-table-retention-30d-v1 CANARY 334' then
    raise exception using errcode = 'P9270', message = 'Automatic closed-human Stage policy binding is invalid';
  end if;

  select batches.*
    into batch
    from public.chips_ledger_archive_batches as batches
   where batches.object_path = p_object_path
   for update;
  if not found
     or batch.project_ref is distinct from 'krydukthwdvccggbyjfw'
     or batch.format_version is distinct from 1
     or batch.source_policy_id is distinct from 'stage-ledger-closed-human-table-retention-30d-v1'
     or batch.status is distinct from 'committed'
     or batch.committed_at is null
     or batch.object_path is distinct from ('v1/sha256/' || batch.compressed_sha256 || '.jsonl.gz')
     or batch.batch_id is null
     or batch.transaction_count is null
     or batch.entry_count is null
     or pg_catalog.cardinality(p_transaction_ids) <> batch.transaction_count
     or pg_catalog.cardinality(p_entry_ids) <> batch.entry_count then
    raise exception using errcode = 'P9271', message = 'Automatic closed-human target is not one canonical Stage batch';
  end if;
  perform public.chips_assert_archive_prune_target(batch.project_ref, batch.transaction_count);

  receipt_count := pg_catalog.num_nonnulls(
    batch.pruned_at,
    batch.pruned_transaction_count,
    batch.pruned_entry_count,
    batch.pruned_transaction_ids_sha256,
    batch.pruned_entry_ids_sha256
  );
  if receipt_count not in (0, 5) then
    raise exception using errcode = 'P9272', message = 'Automatic closed-human prune receipt is partial';
  end if;
  go_count := pg_catalog.num_nonnulls(batch.destructive_go_at, batch.destructive_go_batch_id);
  if go_count not in (0, 2)
     or (go_count = 2 and batch.destructive_go_batch_id is distinct from batch.batch_id)
     or (receipt_count = 5 and go_count <> 2) then
    raise exception using errcode = 'P9272', message = 'Automatic closed-human batch GO is partial or foreign';
  end if;

  select pg_catalog.count(*),
         pg_catalog.count(distinct registry.table_id),
         pg_catalog.count(*) filter (where registry.table_id is null)
    into registry_count, distinct_table_count, null_table_count
    from public.chips_transaction_idempotency as registry
   where registry.transaction_id = any(p_transaction_ids)
     and registry.archive_batch_id = batch.batch_id;
  if registry_count <> batch.transaction_count
     or distinct_table_count <> 1
     or null_table_count <> 0
     or not exists (
       select 1
         from public.chips_transaction_idempotency as registry
        where registry.transaction_id = any(p_transaction_ids)
          and registry.archive_batch_id = batch.batch_id
          and registry.table_id = p_table_id
     ) then
    raise exception using errcode = 'P9273', message = 'Automatic closed-human target registry binding is not exact';
  end if;

  perform public.chips_assert_closed_human_table_lifecycle_gate(
    p_table_id, batch.cutoff, batch.batch_id
  );

  if go_count = 0 then
    perform pg_catalog.set_config('chips.closed_human_go', '1', true);
    update public.chips_ledger_archive_batches as batches
       set destructive_go_at = pg_catalog.timezone('utc', pg_catalog.now()),
           destructive_go_batch_id = batch.batch_id
     where batches.batch_id = batch.batch_id
       and batches.destructive_go_at is null
       and batches.destructive_go_batch_id is null;
    if not found then
      raise exception using errcode = 'P9274', message = 'Automatic closed-human batch GO transition was not unique';
    end if;
  end if;

  perform pg_catalog.set_config('chips.closed_human_automatic', '1', true);
  result := public.chips_prune_closed_human_table_archive_batch(
    p_object_path,
    p_transaction_ids,
    p_entry_ids,
    p_table_id,
    true,
    batch.batch_id
  );
  return result || pg_catalog.jsonb_build_object(
    'automatic_policy', 'stage-ledger-closed-human-table-retention-30d-v1',
    'batch_id', batch.batch_id,
    'table_id', p_table_id
  );
end;
$$;
alter function public.chips_auto_prune_closed_human_table_archive_batch(text, uuid[], bigint[], uuid)
  owner to postgres;
revoke all on function public.chips_auto_prune_closed_human_table_archive_batch(text, uuid[], bigint[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.chips_auto_prune_closed_human_table_archive_batch(text, uuid[], bigint[], uuid)
  to postgres, chips_ledger_archive_pruner;

commit;
