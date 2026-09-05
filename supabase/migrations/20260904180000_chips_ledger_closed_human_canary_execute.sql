begin;

-- Reuse the existing archive-batch GO columns and guard them with a separate
-- closed-human session latch.  Bot-only authorization remains unchanged.
do $patch$
declare
  definition text;
  patched text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_guard_archive_batch_mutations()'::pg_catalog.regprocedure
  ) into definition;
  patched := pg_catalog.replace(
    definition,
    $needle$coalesce(pg_catalog.current_setting('chips.bot_only_go', true), '') = '1'$needle$,
    $replacement$(
      coalesce(pg_catalog.current_setting('chips.bot_only_go', true), '') = '1'
      or coalesce(pg_catalog.current_setting('chips.closed_human_go', true), '') = '1'
    )$replacement$
  );
  if patched = definition
     or pg_catalog.strpos(patched, 'chips.closed_human_go') = 0 then
    raise exception 'Archive batch GO guard shape changed; refusing an implicit migration';
  end if;
  execute patched;
end;
$patch$;

-- The only human GO writer is an owner-only, exact-policy authorization gate.
-- It persists the existing destructive_go receipt and the policy canary latch
-- while leaving automatic activation disabled.
create or replace function public.chips_authorize_closed_human_table_retention_canary(
  p_batch_id bigint,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  policy public.chips_stage_closed_human_table_retention_policy%rowtype;
  go_count integer;
  canary_count integer;
begin
  if p_batch_id is null
     or p_batch_id < 1
     or p_confirmation is distinct from ('GO ' || p_batch_id::text) then
    raise exception using errcode = 'P9234', message = 'Exact closed-human batch GO confirmation is required';
  end if;

  select batches.*
    into batch
    from public.chips_ledger_archive_batches as batches
   where batches.batch_id = p_batch_id
   for update;
  if not found
     or batch.status is distinct from 'committed'
     or batch.committed_at is null
     or batch.project_ref is distinct from 'krydukthwdvccggbyjfw'
     or batch.format_version is distinct from 1
     or batch.source_policy_id is distinct from 'stage-ledger-closed-human-table-retention-30d-v1'
     or batch.cutoff is null
     or coalesce(batch.raw_sha256, '') !~ '^[0-9a-f]{64}$'
     or coalesce(batch.compressed_sha256, '') !~ '^[0-9a-f]{64}$'
     or batch.object_path is distinct from ('v1/sha256/' || batch.compressed_sha256 || '.jsonl.gz')
     or batch.transaction_count is null
     or batch.transaction_count < 1
     or batch.transaction_count > 5000
     or batch.entry_count is null
     or batch.entry_count < 1
     or batch.archive_proof_verified_at is null
     or coalesce(batch.archived_transaction_ids_sha256, '') !~ '^[0-9a-f]{64}$'
     or coalesce(batch.archived_entry_ids_sha256, '') !~ '^[0-9a-f]{64}$'
     or pg_catalog.num_nonnulls(
       batch.pruned_at,
       batch.pruned_transaction_count,
       batch.pruned_entry_count,
       batch.pruned_transaction_ids_sha256,
       batch.pruned_entry_ids_sha256
     ) <> 0
     or pg_catalog.num_nonnulls(
       batch.registry_cleaned_at,
       batch.registry_cleaned_key_count,
       batch.registry_cleaned_keys_sha256
     ) <> 0 then
    raise exception using errcode = 'P9234', message = 'Only one exact committed Stage closed-human batch may be authorized';
  end if;

  go_count := pg_catalog.num_nonnulls(batch.destructive_go_at, batch.destructive_go_batch_id);
  if go_count not in (0, 2)
     or (go_count = 2 and batch.destructive_go_batch_id is distinct from batch.batch_id) then
    raise exception using errcode = 'P9234', message = 'Closed-human destructive GO is partial or foreign';
  end if;

  select policies.*
    into policy
    from public.chips_stage_closed_human_table_retention_policy as policies
   where policies.policy_id = 'stage-ledger-closed-human-table-retention-30d-v1';
  if not found
     or policy.enabled is true
     or policy.activated_at is not null then
    raise exception using errcode = 'P9234', message = 'Closed-human canary policy is not in manual-only state';
  end if;

  canary_count := pg_catalog.num_nonnulls(policy.canary_batch_id, policy.canary_confirmation);
  if canary_count not in (0, 2)
     or (canary_count = 2 and (
       policy.canary_batch_id is distinct from batch.batch_id
       or policy.canary_confirmation is distinct from p_confirmation
     )) then
    raise exception using errcode = 'P9234', message = 'A different closed-human canary is already latched';
  end if;

  perform public.chips_assert_archive_prune_target(batch.project_ref, batch.transaction_count);

  if go_count = 0 then
    perform pg_catalog.set_config('chips.closed_human_go', '1', true);
    update public.chips_ledger_archive_batches as batches
       set destructive_go_at = pg_catalog.timezone('utc', pg_catalog.now()),
           destructive_go_batch_id = batch.batch_id
     where batches.batch_id = batch.batch_id
       and batches.destructive_go_at is null
       and batches.destructive_go_batch_id is null;
    if not found then
      raise exception using errcode = 'P9234', message = 'Closed-human destructive GO transition was not unique';
    end if;
  end if;

  if canary_count = 0 then
    update public.chips_stage_closed_human_table_retention_policy as policies
       set canary_batch_id = batch.batch_id,
           canary_confirmation = p_confirmation,
           updated_at = pg_catalog.timezone('utc', pg_catalog.now())
     where policies.policy_id = 'stage-ledger-closed-human-table-retention-30d-v1'
       and policies.canary_batch_id is null
       and policies.canary_confirmation is null;
    if not found then
      raise exception using errcode = 'P9234', message = 'Closed-human canary policy latch was not unique';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'state', 'authorized',
    'batch_id', batch.batch_id,
    'object_path', batch.object_path,
    'source_policy_id', batch.source_policy_id,
    'confirmation', p_confirmation
  );
end;
$$;
alter function public.chips_authorize_closed_human_table_retention_canary(bigint, text) owner to postgres;
revoke all on function public.chips_authorize_closed_human_table_retention_canary(bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.chips_authorize_closed_human_table_retention_canary(bigint, text)
  to postgres;

-- This wrapper is the only closed-human execute entry point.  It revalidates
-- the lifecycle gate in the same SERIALIZABLE transaction as the existing
-- immutable whitelist prune and never completes the human lifecycle marker.
grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

create or replace function public.chips_prune_closed_human_table_archive_batch(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_table_id uuid,
  p_execute boolean default false,
  p_approved_batch_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  policy public.chips_stage_closed_human_table_retention_policy%rowtype;
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
     or batch.project_ref is distinct from 'krydukthwdvccggbyjfw'
     or batch.format_version is distinct from 1
     or batch.source_policy_id is distinct from 'stage-ledger-closed-human-table-retention-30d-v1'
     or batch.batch_id is null
     or batch.status is distinct from 'committed'
     or batch.committed_at is null
     or batch.cutoff is null
     or coalesce(batch.raw_sha256, '') !~ '^[0-9a-f]{64}$'
     or coalesce(batch.compressed_sha256, '') !~ '^[0-9a-f]{64}$'
     or batch.object_path is distinct from ('v1/sha256/' || batch.compressed_sha256 || '.jsonl.gz')
     or batch.transaction_count is null
     or batch.entry_count is null then
    raise exception using errcode = 'P9235', message = 'Closed-human prune requires one canonical Stage batch';
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
    from public.chips_stage_closed_human_table_retention_policy as policies
   where policies.policy_id = 'stage-ledger-closed-human-table-retention-30d-v1';
  if not found
     or policy.enabled is true
     or policy.activated_at is not null then
    raise exception using errcode = 'P9235', message = 'Closed-human canary policy is not manual-only';
  end if;

  if p_execute is true then
    if p_approved_batch_id is distinct from batch.batch_id
       or policy.canary_batch_id is distinct from batch.batch_id
       or policy.canary_confirmation is distinct from ('GO ' || batch.batch_id::text)
       or batch.destructive_go_at is null
       or batch.destructive_go_batch_id is distinct from batch.batch_id then
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

  perform pg_catalog.set_config('chips.closed_human_prune', '1', true);
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
$$;

-- Keep the established public wrapper for generic 30-day and bot-only paths,
-- but make a closed-human execute attempt fail closed unless it uses the exact
-- policy-specific wrapper above.
create or replace function public.chips_prune_committed_archive_batch(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_execute boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_project_ref text;
  source_policy_id text;
begin
  if p_execute is null then
    raise exception 'Ledger archive pruning execute flag must not be NULL';
  end if;

  select batches.project_ref, batches.source_policy_id
    into target_project_ref, source_policy_id
    from public.chips_ledger_archive_batches as batches
   where batches.object_path = p_object_path
   for update;
  if not found then
    raise exception 'Committed archive manifest was not found';
  end if;

  perform public.chips_assert_archive_prune_target(
    target_project_ref,
    pg_catalog.cardinality(p_transaction_ids)
  );
  if p_execute is true
     and source_policy_id = 'stage-ledger-closed-human-table-retention-30d-v1' then
    raise exception using errcode = 'P9235', message = 'Closed-human execute requires the exact policy gate';
  end if;

  return public.chips_prune_committed_archive_batch_internal(
    p_object_path,
    p_transaction_ids,
    p_entry_ids,
    p_execute is true
  );
end;
$$;

reset role;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;

revoke all on function public.chips_prune_closed_human_table_archive_batch(
  text, uuid[], bigint[], uuid, boolean, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.chips_prune_closed_human_table_archive_batch(
  text, uuid[], bigint[], uuid, boolean, bigint
) to postgres;
revoke all on function public.chips_prune_committed_archive_batch(
  text, uuid[], bigint[], boolean
) from public, anon, authenticated, service_role;
grant execute on function public.chips_prune_committed_archive_batch(
  text, uuid[], bigint[], boolean
) to postgres;

commit;
