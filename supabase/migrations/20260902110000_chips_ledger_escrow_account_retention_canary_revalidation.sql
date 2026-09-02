begin;

-- Forward-only review fix for Issue #894.  The original canary function
-- accepted a syntactically valid account-ID hash and stored it immutably.
-- Recompute the exact current account set inside the same SERIALIZABLE
-- transaction before the policy row can be changed.  The application still
-- performs the read-only archive and Storage recovery verification first;
-- this database check closes the TOCTOU window for the account set itself.
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
  proof public.chips_legacy_stage_allowlist_proofs%rowtype;
  policy public.chips_stage_escrow_account_retention_policy%rowtype;
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
     or batch.source_policy_id is null
     or batch.source_policy_id not in (
       'stage-ledger-bot-only-retention-7d-v1',
       'legacy_stage_allowlist_v1'
     )
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
    raise exception using errcode = 'P8972', message = 'Canary batch is not a complete, unretired Stage archive batch';
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
      raise exception using errcode = 'P8972', message = 'Bot-only canary proof is incomplete';
    end if;
    table_ids := array[batch.bot_only_table_id];
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
       or proof.query_sha256 !~ '^[0-9a-f]{64}$'
       or proof.source_run is distinct from batch.legacy_source_run
       or proof.query_sha256 is distinct from batch.legacy_query_sha256 then
      raise exception using errcode = 'P8972', message = 'Legacy canary proof is incomplete or changed';
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
        raise exception using errcode = 'P8972', message = 'Legacy canary run/plan binding is incomplete';
      end if;
    elsif batch.legacy_run_id is not null or batch.legacy_plan_sha256 is not null then
      raise exception using errcode = 'P8972', message = 'Legacy batch 13 must not have a later run binding';
    end if;
    table_ids := proof.batch_table_ids;
  end if;

  table_count := pg_catalog.cardinality(table_ids);
  select pg_catalog.array_agg(ids.id order by ids.id)
    into sorted_table_ids
    from pg_catalog.unnest(table_ids) as ids(id);
  if table_count is null
     or table_count < 1
     or table_count > 10
     or pg_catalog.array_position(table_ids, null) is not null
     or table_ids is distinct from sorted_table_ids
     or (
       select count(*) from pg_catalog.unnest(table_ids) as ids(id)
     ) <> (
       select count(distinct id) from pg_catalog.unnest(table_ids) as ids(id)
     )
     or (batch.source_policy_id = 'stage-ledger-bot-only-retention-7d-v1' and table_count <> 1)
     or (batch.source_policy_id = 'legacy_stage_allowlist_v1'
       and batch.legacy_batch_table_count is distinct from table_count) then
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
      detail = 'The supplied account-ID hash cannot be authorized for the current Stage candidate',
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
    from public.chips_stage_escrow_account_retention_policy policies
   where policies.policy_id = 'stage-ledger-escrow-account-retention-v1'
   for update;
  if not found or policy.enabled or policy.canary_batch_id is not null then
    raise exception using errcode = 'P8973', message = 'Escrow account-retirement canary is already authorized or active';
  end if;
  perform pg_catalog.set_config('chips.escrow_account_retention_policy', '1', true);
  update public.chips_stage_escrow_account_retention_policy policies
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
$$;

alter function public.chips_authorize_stage_escrow_account_retirement_canary(bigint, text, text)
  owner to postgres;
revoke all on function public.chips_authorize_stage_escrow_account_retirement_canary(bigint, text, text)
  from public, anon, authenticated, service_role, chips_ledger_archive_pruner;
grant execute on function public.chips_authorize_stage_escrow_account_retirement_canary(bigint, text, text)
  to postgres;

commit;
