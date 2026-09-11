begin;

-- Issue #978 adds one receipt state for historical schema-v1 archive batches.
-- The all-null receipt, schema-v2 bot-only receipt, legacy allowlist receipt,
-- and the later closed-human GO path remain effective states.
alter table public.chips_ledger_archive_batches
  drop constraint if exists chips_ledger_archive_batches_cleanup_receipt_check;

alter table public.chips_ledger_archive_batches
  add constraint chips_ledger_archive_batches_cleanup_receipt_check
  check (
    (
      registry_cleaned_at is null
      and registry_cleaned_key_count is null
      and registry_cleaned_keys_sha256 is null
    ) or (
      format_version = 2
      and archive_proof_verified_at is not null
      and pruned_at is not null
      and registry_cleaned_at is not null
      and registry_cleaned_key_count = transaction_count
      and registry_cleaned_key_count > 0
      and registry_cleaned_keys_sha256 ~ '^[0-9a-f]{64}$'
      and (
        (
          source_policy_id = 'stage-ledger-bot-only-retention-7d-v1'
          and bot_only_registry_keys_sha256 is not null
          and registry_cleaned_keys_sha256 = bot_only_registry_keys_sha256
        ) or source_policy_id = 'legacy_stage_allowlist_v1'
      )
    ) or (
      format_version = 1
      and source_policy_id = 'stage-ledger-auto-retention-30d-v1'
      and archive_proof_verified_at is not null
      and pruned_at is not null
      and registry_cleaned_at is not null
      and registry_cleaned_key_count = transaction_count
      and registry_cleaned_key_count > 0
      and registry_cleaned_keys_sha256 ~ '^[0-9a-f]{64}$'
    )
  );

-- Patch the current guard in place.  This deliberately derives the function
-- body after every earlier migration, including the closed-human GO patch;
-- copying an older guard would silently discard an effective safety branch.
do $guard_patch$
declare
  definition text;
  patched text;
  needle text := $needle$or (new.source_policy_id = 'legacy_stage_allowlist_v1' and new_bot_proof_count = 0)$needle$;
  replacement text := $replacement$or (new.source_policy_id = 'legacy_stage_allowlist_v1' and new_bot_proof_count = 0)
      or (
        new.format_version = 1
        and new.source_policy_id = 'stage-ledger-auto-retention-30d-v1'
        and new_bot_proof_count = 0
      )$replacement$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.chips_guard_archive_batch_mutations()'::pg_catalog.regprocedure
  ) into definition;
  if definition is null
     or pg_catalog.strpos(definition, 'legacy_stage_allowlist_v1') = 0
     or pg_catalog.strpos(definition, 'stage-ledger-bot-only-retention-7d-v1') = 0
     or pg_catalog.strpos(definition, 'chips.bot_only_go') = 0
     or pg_catalog.strpos(definition, 'chips.closed_human_go') = 0
     or pg_catalog.strpos(definition, 'registry_cleaned_keys_sha256') = 0
     or pg_catalog.strpos(definition, needle) = 0 then
    raise exception 'Issue #978 requires the complete current archive-batch guard contract';
  end if;

  patched := pg_catalog.replace(definition, needle, replacement);
  if patched = definition then
    raise exception 'Issue #978 archive-batch guard patch did not apply';
  end if;
  execute patched;

  select pg_catalog.pg_get_functiondef(
    'public.chips_guard_archive_batch_mutations()'::pg_catalog.regprocedure
  ) into patched;
  if pg_catalog.strpos(patched, 'stage-ledger-auto-retention-30d-v1') = 0
     or pg_catalog.strpos(patched, 'chips.bot_only_go') = 0
     or pg_catalog.strpos(patched, 'chips.closed_human_go') = 0 then
    raise exception 'Issue #978 archive-batch guard patch lost an effective GO contract';
  end if;
end;
$guard_patch$;

-- Reuse the existing archive-pruner role and its least-privilege table/helper
-- grants.  The new function is the only new destructive entry point.
grant chips_ledger_archive_pruner to postgres;
grant usage on schema public, extensions to chips_ledger_archive_pruner;
grant select on public.chips_ledger_archive_batches,
  public.chips_transaction_idempotency, public.chips_transactions,
  public.chips_entries, public.poker_tables, public.chips_table_fence_control
  to chips_ledger_archive_pruner;
grant delete on public.chips_transaction_idempotency to chips_ledger_archive_pruner;
grant execute on function public.chips_assert_archive_prune_stage() to chips_ledger_archive_pruner;
grant execute on function public.chips_table_fence_is_active() to chips_ledger_archive_pruner;
grant execute on function public.chips_lock_table_fence_for_legacy_cleanup() to chips_ledger_archive_pruner;
grant execute on function public.chips_parse_table_idempotency_key(text) to chips_ledger_archive_pruner;
grant execute on function public.chips_archive_text_ids_sha256(text[]) to chips_ledger_archive_pruner;
grant create on schema public to chips_ledger_archive_pruner;

set role chips_ledger_archive_pruner;

create function public.chips_retire_missing_table_bot_registry_batch(
  p_batch_id bigint,
  p_registry_key_count bigint,
  p_registry_keys_sha256 text,
  p_execute boolean default false,
  p_confirmation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $retire$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  registry_row record;
  parsed jsonb;
  stage_identity text;
  parsed_table_id uuid;
  registry_keys text[] := array[]::text[];
  transaction_ids uuid[] := array[]::uuid[];
  table_ids uuid[] := array[]::uuid[];
  registry_count bigint;
  hot_transaction_count bigint;
  hot_entry_count bigint;
  registry_keys_sha256 text;
  cleanup_receipt_count integer;
  deleted_registry_count bigint;
begin
  if p_batch_id is null or p_batch_id < 1 then
    raise exception using errcode = 'P8940', message = 'Missing-table retirement batch id is invalid';
  end if;
  if p_registry_key_count is null or p_registry_key_count < 1 or p_registry_key_count > 5000 then
    raise exception using errcode = 'P8940', message = 'Missing-table retirement registry count is invalid';
  end if;
  if p_registry_keys_sha256 is null or p_registry_keys_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P8940', message = 'Missing-table retirement registry hash is invalid';
  end if;
  if p_execute is null then
    raise exception using errcode = 'P8940', message = 'Missing-table retirement execute flag must not be NULL';
  end if;
  if not p_execute and p_confirmation is not null then
    raise exception using errcode = 'P8943', message = 'Prepare-only retirement cannot carry a GO confirmation';
  end if;
  if p_execute and p_confirmation is distinct from ('GO ' || p_batch_id::text) then
    raise exception using errcode = 'P8943', message = 'Exact missing-table retirement GO confirmation is required';
  end if;
  if p_execute and pg_catalog.current_setting('transaction_isolation') <> 'serializable' then
    raise exception using errcode = 'P8943', message = 'Missing-table retirement requires SERIALIZABLE isolation';
  end if;

  stage_identity := public.chips_assert_archive_prune_stage();
  if stage_identity is distinct from '7656985631720456337' then
    raise exception using errcode = 'P8940', message = 'Missing-table retirement is restricted to canonical Stage';
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
  if not found then
    raise exception using errcode = 'P8940', message = 'Missing-table retirement batch was not found';
  end if;

  if batch.project_ref is distinct from 'krydukthwdvccggbyjfw'
     or batch.format_version is distinct from 1
     or batch.source_policy_id is distinct from 'stage-ledger-auto-retention-30d-v1'
     or batch.status is distinct from 'committed'
     or batch.committed_at is null
     or batch.transaction_count < 1
     or batch.transaction_count > 5000
     or batch.entry_count < 1
     or pg_catalog.num_nonnulls(
          batch.archived_transaction_ids_sha256,
          batch.archived_entry_ids_sha256,
          batch.archive_proof_verified_at
        ) <> 3
     or batch.archived_transaction_ids_sha256 !~ '^[0-9a-f]{64}$'
     or batch.archived_entry_ids_sha256 !~ '^[0-9a-f]{64}$'
     or pg_catalog.num_nonnulls(
          batch.pruned_at,
          batch.pruned_transaction_count,
          batch.pruned_entry_count,
          batch.pruned_transaction_ids_sha256,
          batch.pruned_entry_ids_sha256
        ) <> 5
     or batch.pruned_transaction_count is distinct from batch.transaction_count
     or batch.pruned_entry_count is distinct from batch.entry_count
     or batch.pruned_transaction_ids_sha256 is distinct from batch.archived_transaction_ids_sha256
     or batch.pruned_entry_ids_sha256 is distinct from batch.archived_entry_ids_sha256 then
    raise exception using errcode = 'P8940', message = 'Missing-table retirement archive proof or prune receipt is incomplete';
  end if;

  cleanup_receipt_count := pg_catalog.num_nonnulls(
    batch.registry_cleaned_at,
    batch.registry_cleaned_key_count,
    batch.registry_cleaned_keys_sha256
  );
  if cleanup_receipt_count not in (0, 3) then
    raise exception using errcode = 'P8942', message = 'Missing-table retirement cleanup receipt is partial';
  end if;
  if cleanup_receipt_count = 3 then
    if batch.registry_cleaned_key_count is distinct from batch.transaction_count
       or batch.registry_cleaned_key_count < 1
       or batch.registry_cleaned_keys_sha256 !~ '^[0-9a-f]{64}$' then
      raise exception using errcode = 'P8942', message = 'Missing-table retirement cleanup receipt is invalid';
    end if;
    select count(*)
      into registry_count
      from public.chips_transaction_idempotency registry
     where registry.archive_batch_id = batch.batch_id;
    if registry_count <> 0 then
      raise exception using errcode = 'P8942', message = 'Retired missing-table batch still has registry mappings';
    end if;
    if p_registry_key_count is distinct from batch.registry_cleaned_key_count
       or p_registry_keys_sha256 is distinct from batch.registry_cleaned_keys_sha256 then
      raise exception using errcode = 'P8942', message = 'Existing missing-table retirement receipt differs from retry';
    end if;
    return pg_catalog.jsonb_build_object(
      'state', 'already_retired',
      'batch_id', batch.batch_id,
      'registry_key_count', batch.registry_cleaned_key_count,
      'registry_keys_sha256', batch.registry_cleaned_keys_sha256
    );
  end if;

  select count(*)
    into registry_count
    from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id;
  if registry_count <> batch.transaction_count
     or registry_count <> p_registry_key_count then
    raise exception using errcode = 'P8941', message = 'Missing-table retirement registry count does not match the archive batch';
  end if;

  -- Derive the complete sorted set from the immutable batch mapping.  A
  -- caller cannot provide a subset, and every row is checked against the
  -- authoritative parser and stored table identity.
  for registry_row in
    select registry.*
      from public.chips_transaction_idempotency registry
     where registry.archive_batch_id = batch.batch_id
     order by registry.idempotency_key
  loop
    if registry_row.user_id is not null
       or registry_row.tx_type::text not in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
       or registry_row.key_format_version is distinct from 1
       or registry_row.key_format is null
       or registry_row.key_format not in (
         'managed-bot-seed-buyin',
         'bot-seed-buyin',
         'poker:bot-replacement-buyin:v1',
         'poker:bot-terminal-cashout:v1'
       )
       or registry_row.table_id is null
       or registry_row.replay_transaction is not null
       or registry_row.replay_entries is not null
       or registry_row.replay_completed_at is not null then
      raise exception using errcode = 'P8941', message = 'Missing-table retirement found a protected or unsupported TABLE identity';
    end if;

    parsed := public.chips_parse_table_idempotency_key(registry_row.idempotency_key);
    if (parsed->>'version')::integer is distinct from 1
       or parsed->>'format' is distinct from registry_row.key_format then
      raise exception using errcode = 'P8941', message = 'Missing-table retirement key parser evidence is inconsistent';
    end if;
    parsed_table_id := (parsed->>'table_id')::uuid;
    if parsed_table_id is distinct from registry_row.table_id then
      raise exception using errcode = 'P8941', message = 'Missing-table retirement parsed table identity differs from stored table_id';
    end if;
    if registry_row.transaction_id = any(transaction_ids) then
      raise exception using errcode = 'P8941', message = 'Missing-table retirement transaction identities are not one-to-one';
    end if;
    transaction_ids := pg_catalog.array_append(transaction_ids, registry_row.transaction_id);
    registry_keys := pg_catalog.array_append(registry_keys, registry_row.idempotency_key);
    if not (parsed_table_id = any(table_ids)) then
      table_ids := pg_catalog.array_append(table_ids, parsed_table_id);
    end if;
  end loop;

  if pg_catalog.cardinality(registry_keys) <> registry_count
     or pg_catalog.cardinality(transaction_ids) <> registry_count
     or pg_catalog.cardinality(table_ids) < 1 then
    raise exception using errcode = 'P8941', message = 'Missing-table retirement exact identity set is incomplete';
  end if;
  registry_keys_sha256 := public.chips_archive_text_ids_sha256(registry_keys);
  if registry_keys_sha256 is distinct from p_registry_keys_sha256 then
    raise exception using errcode = 'P8941', message = 'Missing-table retirement exact identity hash differs from the audit';
  end if;

  select count(*)
    into hot_transaction_count
    from public.chips_transactions transactions
   where transactions.id = any(transaction_ids);
  select count(*)
    into hot_entry_count
    from public.chips_entries entries
   where entries.transaction_id = any(transaction_ids);
  if hot_transaction_count <> 0 or hot_entry_count <> 0 then
    raise exception using errcode = 'P8941', message = 'Missing-table retirement found hot transactions or entries';
  end if;

  if exists (
    select 1
      from public.poker_tables tables
     where tables.id = any(table_ids)
  ) then
    raise exception using errcode = 'P8941', message = 'Missing-table retirement found an authoritative poker_tables row';
  end if;

  -- The existing SECURITY DEFINER helper reads
  -- chips_table_fence_control.enforcement_active as its owner.  A direct read
  -- here would be RLS-sensitive for the archive-pruner role and could turn an
  -- enforced fence into a false fail-closed result.
  if not coalesce(public.chips_table_fence_is_active(), false) then
    raise exception using errcode = 'P8944', message = 'Active and enforced TABLE transaction fence is required';
  end if;

  if not p_execute then
    return pg_catalog.jsonb_build_object(
      'state', 'ready',
      'mode', 'prepare-only',
      'batch_id', batch.batch_id,
      'registry_count', registry_count,
      'registry_key_count', registry_count,
      'transaction_count', batch.transaction_count,
      'entry_count', batch.entry_count,
      'registry_keys_sha256', registry_keys_sha256,
      'table_count', pg_catalog.cardinality(table_ids),
      'hot_transaction_count', hot_transaction_count,
      'hot_entry_count', hot_entry_count
    );
  end if;

  -- Serialize the final fence check with the owner-controlled fence toggle.
  -- No archive-prune function is called: this operation only retires registry
  -- rows after proof and prune have already completed.
  perform public.chips_lock_table_fence_for_legacy_cleanup();
  stage_identity := public.chips_assert_archive_prune_stage();
  if stage_identity is distinct from '7656985631720456337'
     or not coalesce(public.chips_table_fence_is_active(), false) then
    raise exception using errcode = 'P8944', message = 'Stage identity or active TABLE fence changed before retirement';
  end if;

  perform pg_catalog.set_config('chips.bot_registry_cleanup', '1', true);
  delete from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id;
  get diagnostics deleted_registry_count = row_count;
  if deleted_registry_count <> registry_count then
    raise exception using errcode = 'P8942', message = 'Missing-table retirement DELETE count mismatch';
  end if;

  perform pg_catalog.set_config('chips.bot_cleanup_receipt', '1', true);
  update public.chips_ledger_archive_batches batches
     set registry_cleaned_at = pg_catalog.timezone('utc', pg_catalog.now()),
         registry_cleaned_key_count = registry_count,
         registry_cleaned_keys_sha256 = registry_keys_sha256
   where batches.batch_id = batch.batch_id
     and batches.registry_cleaned_at is null;
  if not found then
    raise exception using errcode = 'P8942', message = 'Missing-table retirement receipt transition was not unique';
  end if;

  select count(*)
    into hot_transaction_count
    from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id;
  if hot_transaction_count <> 0 then
    raise exception using errcode = 'P8942', message = 'Missing-table retirement left registry mappings';
  end if;

  return pg_catalog.jsonb_build_object(
    'state', 'retired',
    'mode', 'execute',
    'batch_id', batch.batch_id,
    'registry_key_count', deleted_registry_count,
    'registry_keys_sha256', registry_keys_sha256,
    'remaining_registry_count', hot_transaction_count
  );
end;
$retire$;

reset role;

alter function public.chips_retire_missing_table_bot_registry_batch(
  bigint, bigint, text, boolean, text
) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_retire_missing_table_bot_registry_batch(
  bigint, bigint, text, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.chips_retire_missing_table_bot_registry_batch(
  bigint, bigint, text, boolean, text
) to postgres;

revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;

commit;
