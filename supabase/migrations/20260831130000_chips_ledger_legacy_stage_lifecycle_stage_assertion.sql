begin;

-- Forward-only hardening for the already_pruned legacy marker repair path.
-- The original lifecycle-completion migration is already applied and remains
-- immutable; this replacement adds the physical canonical-Stage assertion
-- immediately before the repair contexts and marker update.
grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

create or replace function public.chips_prune_legacy_stage_allowlist_batch(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_batch_table_ids uuid[],
  p_allowlist_sha256 text,
  p_batch_table_ids_sha256 text,
  p_registry_keys text[],
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
  proof public.chips_legacy_stage_allowlist_proofs%rowtype;
  expected_registry_keys text[];
  actual_registry_keys text[];
  registry_keys_sha256 text;
  remaining_registry_count bigint;
  deleted_registry_count bigint;
  hot_transaction_count bigint;
  hot_entry_count bigint;
  existing_table_count bigint;
  unmarked_table_count bigint;
  marked_table_count bigint;
  updated_table_count bigint;
  result jsonb;
begin
  if p_execute is null
     or p_transaction_ids is null
     or p_entry_ids is null
     or p_registry_keys is null
     or p_batch_table_ids is null
     or pg_catalog.cardinality(p_batch_table_ids) not between 1 and 10
     or (select count(*) from pg_catalog.unnest(p_batch_table_ids) as ids(id))
        <> (select count(distinct id) from pg_catalog.unnest(p_batch_table_ids) as ids(id))
     or p_batch_table_ids is distinct from (
       select pg_catalog.array_agg(ids.id order by ids.id)
         from pg_catalog.unnest(p_batch_table_ids) as ids(id)
     )
     or pg_catalog.cardinality(p_registry_keys) < 1
     or pg_catalog.cardinality(p_registry_keys) <> pg_catalog.cardinality(p_transaction_ids)
     or (select count(*) from pg_catalog.unnest(p_registry_keys) as ids(id))
        <> (select count(distinct id) from pg_catalog.unnest(p_registry_keys) as ids(id))
     or p_registry_keys is distinct from (
       select pg_catalog.array_agg(ids.id order by ids.id)
         from pg_catalog.unnest(p_registry_keys) as ids(id)
     ) then
    raise exception using errcode = 'P8938', message = 'Legacy Stage registry key proof is invalid';
  end if;

  registry_keys_sha256 := public.chips_archive_text_ids_sha256(p_registry_keys);
  select batches.* into batch
    from public.chips_ledger_archive_batches batches
   where batches.object_path = p_object_path
   for update;
  if not found
     or batch.source_policy_id <> 'legacy_stage_allowlist_v1'
     or batch.format_version <> 2
     or batch.project_ref <> 'krydukthwdvccggbyjfw'
     or batch.legacy_allowlist_sha256 is distinct from p_allowlist_sha256
     or batch.legacy_batch_table_ids_sha256 is distinct from p_batch_table_ids_sha256 then
    raise exception using errcode = 'P8934', message = 'Legacy Stage prune target is not exact';
  end if;

  select proofs.* into proof
    from public.chips_legacy_stage_allowlist_proofs proofs
   where proofs.batch_id = batch.batch_id;
  if not found
     or proof.master_table_ids_sha256 is distinct from p_allowlist_sha256
     or proof.batch_table_ids_sha256 is distinct from p_batch_table_ids_sha256
     or proof.batch_table_ids is distinct from p_batch_table_ids then
    raise exception using errcode = 'P8934', message = 'Legacy Stage prune proof is missing or differs';
  end if;

  if batch.pruned_at is not null then
    if pg_catalog.num_nonnulls(
         batch.archived_transaction_ids_sha256,
         batch.archived_entry_ids_sha256,
         batch.archive_proof_verified_at
       ) <> 3
       or batch.archived_transaction_ids_sha256 is distinct from public.chips_archive_uuid_ids_sha256(p_transaction_ids)
       or batch.archived_entry_ids_sha256 is distinct from public.chips_archive_bigint_ids_sha256(p_entry_ids)
       or batch.pruned_transaction_count is distinct from batch.transaction_count
       or batch.pruned_entry_count is distinct from batch.entry_count
       or batch.transaction_count <> pg_catalog.cardinality(p_transaction_ids)
       or batch.entry_count <> pg_catalog.cardinality(p_entry_ids)
       or batch.pruned_transaction_ids_sha256 is distinct from public.chips_archive_uuid_ids_sha256(p_transaction_ids)
       or batch.pruned_entry_ids_sha256 is distinct from public.chips_archive_bigint_ids_sha256(p_entry_ids)
       or batch.pruned_transaction_ids_sha256 is distinct from batch.archived_transaction_ids_sha256
       or batch.pruned_entry_ids_sha256 is distinct from batch.archived_entry_ids_sha256
       or batch.registry_cleaned_at is null
       or batch.registry_cleaned_key_count is distinct from pg_catalog.cardinality(p_registry_keys)
       or batch.registry_cleaned_keys_sha256 is distinct from registry_keys_sha256 then
      raise exception using errcode = 'P8934', message = 'Existing legacy Stage cleanup receipt differs';
    end if;

    select count(*) into remaining_registry_count
      from public.chips_transaction_idempotency registry
     where registry.archive_batch_id = batch.batch_id
        or registry.table_id = any(p_batch_table_ids)
        or registry.idempotency_key = any(p_registry_keys);
    with transaction_metadata as materialized (
      select transactions.*,
             case
               when transactions.metadata is not null
                 and pg_catalog.jsonb_typeof(transactions.metadata) = 'object'
                 then transactions.metadata
               when transactions.metadata is not null
                 and pg_catalog.jsonb_typeof(transactions.metadata) = 'string'
                 and pg_catalog.pg_input_is_valid(transactions.metadata #>> '{}', 'jsonb'::text)
                 then (transactions.metadata #>> '{}')::jsonb
               else null::jsonb
             end as normalized_metadata
        from public.chips_transactions transactions
    )
    select count(*) into hot_transaction_count
      from transaction_metadata transactions
     where transactions.id = any(p_transaction_ids)
        or (
          transactions.normalized_metadata ? 'tableId'
          and pg_catalog.lower(pg_catalog.btrim(transactions.normalized_metadata->>'tableId')) = any(
            select pg_catalog.lower(ids.id::text)
              from pg_catalog.unnest(p_batch_table_ids) as ids(id)
          )
        )
        or (
          transactions.reference ~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(:.*)?$'
          and pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(transactions.reference, ':', 2))) = any(
            select pg_catalog.lower(ids.id::text)
              from pg_catalog.unnest(p_batch_table_ids) as ids(id)
          )
        )
        or exists (
          select 1
            from public.chips_transaction_idempotency registry
           where registry.transaction_id = transactions.id
             and (
               registry.table_id = any(p_batch_table_ids)
               or (
                 registry.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
                 and pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 2))) = any(
                   select pg_catalog.lower(ids.id::text)
                     from pg_catalog.unnest(p_batch_table_ids) as ids(id)
                 )
               )
               or (
                 registry.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
                 and pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 3))) = any(
                   select pg_catalog.lower(ids.id::text)
                     from pg_catalog.unnest(p_batch_table_ids) as ids(id)
                 )
               )
               or (
                 registry.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
                 and pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(registry.idempotency_key, ':', 4))) = any(
                   select pg_catalog.lower(ids.id::text)
                     from pg_catalog.unnest(p_batch_table_ids) as ids(id)
                 )
               )
             )
        )
        or exists (
          select 1
            from public.chips_entries entries
            join public.chips_accounts accounts on accounts.id = entries.account_id
           where entries.transaction_id = transactions.id
             and accounts.account_type::text = 'ESCROW'
             and accounts.system_key = any(
               select 'POKER_TABLE:' || ids.id::text
                 from pg_catalog.unnest(p_batch_table_ids) as ids(id)
             )
        );
    select count(*) into hot_entry_count
      from public.chips_entries entries
     where entries.transaction_id = any(p_transaction_ids)
        or entries.id = any(p_entry_ids)
        or exists (
          select 1
            from public.chips_accounts accounts
           where accounts.id = entries.account_id
             and accounts.account_type::text = 'ESCROW'
             and accounts.system_key = any(
               select 'POKER_TABLE:' || ids.id::text
                 from pg_catalog.unnest(p_batch_table_ids) as ids(id)
             )
        );
    if remaining_registry_count <> 0 or hot_transaction_count <> 0 or hot_entry_count <> 0 then
      raise exception using errcode = 'P8938', message = 'Existing legacy Stage cleanup left hot ledger or registry rows';
    end if;

    if p_execute then
      select count(*) filter (where tables.bot_only_retention_complete_at is null),
             count(*)
        into unmarked_table_count, existing_table_count
        from public.poker_tables tables
       where tables.id = any(p_batch_table_ids);
      if unmarked_table_count > 0 then
        if p_approved_batch_id is distinct from batch.batch_id
           or batch.destructive_go_batch_id is distinct from batch.batch_id
           or batch.destructive_go_at is null then
          raise exception using errcode = 'P8935', message = 'Exact legacy Stage batch GO is required before lifecycle repair';
        end if;
        perform public.chips_lock_table_fence_for_legacy_cleanup();
        if not coalesce(public.chips_table_fence_is_active(), false) then
          raise exception using errcode = 'P8937', message = 'Active TABLE fence is required before legacy lifecycle repair';
        end if;
        perform public.chips_assert_archive_prune_stage();
        perform pg_catalog.set_config('chips.bot_only_go', '1', true);
        perform pg_catalog.set_config('chips.legacy_stage_cleanup', '1', true);
        perform pg_catalog.set_config('chips.bot_only_prune', '1', true);
        perform pg_catalog.set_config('chips.bot_registry_cleanup', '1', true);
        perform pg_catalog.set_config('chips.bot_cleanup_receipt', '1', true);
        perform pg_catalog.set_config('chips.bot_only_lifecycle', '1', true);
        perform pg_catalog.set_config('chips.legacy_registry_keys_sha256', registry_keys_sha256, true);
        update public.poker_tables tables
           set bot_only_retention_complete_at = coalesce(
             tables.bot_only_retention_complete_at,
             pg_catalog.timezone('utc', pg_catalog.now())
           )
         where tables.id = any(p_batch_table_ids)
           and tables.bot_only_retention_complete_at is null;
        get diagnostics updated_table_count = row_count;
        if updated_table_count <> unmarked_table_count then
          raise exception using errcode = 'P8938', message = 'Legacy Stage lifecycle repair transition was not exact';
        end if;
        select count(*) filter (where tables.bot_only_retention_complete_at is null),
               count(*) filter (where tables.bot_only_retention_complete_at is not null),
               count(*)
          into unmarked_table_count, marked_table_count, existing_table_count
          from public.poker_tables tables
         where tables.id = any(p_batch_table_ids);
        if unmarked_table_count <> 0 or marked_table_count <> existing_table_count then
          raise exception using errcode = 'P8938', message = 'Legacy Stage lifecycle repair marker verification failed';
        end if;
      end if;
    end if;
    return pg_catalog.jsonb_build_object(
      'state', 'already_pruned',
      'mode', 'execute',
      'batch_id', batch.batch_id,
      'registry_keys', pg_catalog.cardinality(p_registry_keys),
      'registry_keys_sha256', registry_keys_sha256,
      'remaining_registry_count', remaining_registry_count
    );
  end if;

  perform public.chips_assert_legacy_stage_allowlist_batch(
    p_object_path, p_transaction_ids, p_entry_ids, p_batch_table_ids, proof.master_table_ids,
    p_allowlist_sha256, p_batch_table_ids_sha256, proof.master_table_count, proof.batch_number,
    proof.source_run, proof.query_sha256, proof.postgres_system_identifier, batch.cutoff
  );

  select count(*) into existing_table_count
    from public.poker_tables tables
   where tables.id = any(p_batch_table_ids);
  select count(*) into marked_table_count
    from public.poker_tables tables
   where tables.id = any(p_batch_table_ids)
     and tables.bot_only_retention_complete_at is not null;
  if existing_table_count <> pg_catalog.cardinality(p_batch_table_ids)
     or marked_table_count <> 0 then
    raise exception using errcode = 'P8938', message = 'Legacy Stage lifecycle table scope is not fresh';
  end if;

  select pg_catalog.array_agg(registry.idempotency_key order by registry.idempotency_key)
    into expected_registry_keys
    from public.chips_transaction_idempotency registry
   where registry.transaction_id = any(p_transaction_ids);
  if expected_registry_keys is distinct from p_registry_keys then
    raise exception using errcode = 'P8938', message = 'Legacy Stage registry key set differs from immutable proof';
  end if;

  if not p_execute then
    result := public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, false);
    return result || pg_catalog.jsonb_build_object(
      'state', 'ready',
      'mode', 'prepare-only',
      'batch_id', batch.batch_id,
      'registry_keys', pg_catalog.cardinality(p_registry_keys),
      'registry_keys_sha256', registry_keys_sha256,
      'remaining_registry_count', pg_catalog.cardinality(p_registry_keys)
    );
  end if;

  -- Serialize a fence toggle with the destructive section.  The explicit
  -- function call remains authoritative; the lock closes the race with the
  -- owner-controlled fence toggle.
  perform public.chips_lock_table_fence_for_legacy_cleanup();
  if not coalesce(public.chips_table_fence_is_active(), false) then
    raise exception using errcode = 'P8937', message = 'Active TABLE fence is required before legacy destructive cleanup';
  end if;
  if p_approved_batch_id is distinct from batch.batch_id
     or batch.destructive_go_batch_id is distinct from batch.batch_id
     or batch.destructive_go_at is null then
    raise exception using errcode = 'P8935', message = 'Exact legacy Stage batch GO is required before execution';
  end if;

  -- Re-establish the per-call proof contexts only after exact persisted GO and
  -- the active fence have been checked.
  perform pg_catalog.set_config('chips.bot_only_go', '1', true);
  perform pg_catalog.set_config('chips.legacy_stage_cleanup', '1', true);
  perform pg_catalog.set_config('chips.bot_only_prune', '1', true);
  result := public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, true);

  select pg_catalog.array_agg(registry.idempotency_key order by registry.idempotency_key)
    into actual_registry_keys
    from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id;
  if actual_registry_keys is distinct from p_registry_keys then
    raise exception using errcode = 'P8938', message = 'Legacy Stage mapped registry set differs from immutable proof';
  end if;

  perform pg_catalog.set_config('chips.bot_registry_cleanup', '1', true);
  delete from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id
     and registry.idempotency_key = any(p_registry_keys);
  get diagnostics deleted_registry_count = row_count;
  if deleted_registry_count <> pg_catalog.cardinality(p_registry_keys) then
    raise exception using errcode = 'P8938', message = 'Legacy Stage registry DELETE count mismatch';
  end if;

  select count(*) into remaining_registry_count
    from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id;
  if remaining_registry_count <> 0 then
    raise exception using errcode = 'P8938', message = 'Legacy Stage cleanup left registry mappings';
  end if;

  perform pg_catalog.set_config('chips.bot_cleanup_receipt', '1', true);
  update public.chips_ledger_archive_batches batches
     set registry_cleaned_at = pg_catalog.timezone('utc', pg_catalog.now()),
         registry_cleaned_key_count = pg_catalog.cardinality(p_registry_keys),
         registry_cleaned_keys_sha256 = registry_keys_sha256
   where batches.batch_id = batch.batch_id
     and batches.registry_cleaned_at is null;
  if not found then
    raise exception using errcode = 'P8938', message = 'Legacy Stage cleanup receipt transition was not unique';
  end if;

  -- The marker transition is the final lifecycle proof.  It is deliberately
  -- after the complete registry receipt and remains atomic with all deletes.
  perform pg_catalog.set_config('chips.bot_only_lifecycle', '1', true);
  perform pg_catalog.set_config('chips.legacy_registry_keys_sha256', registry_keys_sha256, true);
  update public.poker_tables tables
     set bot_only_retention_complete_at = coalesce(
       tables.bot_only_retention_complete_at,
       pg_catalog.timezone('utc', pg_catalog.now())
     )
   where tables.id = any(p_batch_table_ids)
     and tables.bot_only_retention_complete_at is null;
  get diagnostics updated_table_count = row_count;
  if updated_table_count <> pg_catalog.cardinality(p_batch_table_ids) then
    raise exception using errcode = 'P8938', message = 'Legacy Stage lifecycle marker transition was not exact';
  end if;

  select count(*) filter (where tables.bot_only_retention_complete_at is not null),
         count(*)
    into marked_table_count, existing_table_count
    from public.poker_tables tables
   where tables.id = any(p_batch_table_ids);
  if existing_table_count <> pg_catalog.cardinality(p_batch_table_ids)
     or marked_table_count <> pg_catalog.cardinality(p_batch_table_ids) then
    raise exception using errcode = 'P8938', message = 'Legacy Stage lifecycle marker verification failed';
  end if;

  return result || pg_catalog.jsonb_build_object(
    'state', 'pruned',
    'mode', 'execute',
    'batch_id', batch.batch_id,
    'registry_keys', deleted_registry_count,
    'registry_keys_sha256', registry_keys_sha256,
    'remaining_registry_count', remaining_registry_count,
    'lifecycle_table_count', marked_table_count
  );
end;
$$;

reset role;

revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;

commit;

