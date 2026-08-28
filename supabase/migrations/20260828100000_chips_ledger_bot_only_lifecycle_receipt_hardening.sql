begin;

-- The previously applied bot-only cleanup functions remain immutable.  This
-- forward-only replacement makes the lifecycle receipt an atomic postcondition
-- of the first destructive cleanup and validates it on already-cleaned replay.
grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

create or replace function public.chips_prune_and_cleanup_bot_only_archive_batch(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_registry_keys text[],
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
  if not found or batch.project_ref <> 'krydukthwdvccggbyjfw' or batch.format_version <> 2 or batch.source_policy_id <> 'stage-ledger-bot-only-retention-7d-v1' then
    raise exception using errcode = 'P8921', message = 'Bot-only cleanup requires a canonical Stage schema-v2 batch';
  end if;
  perform public.chips_assert_archive_prune_target(batch.project_ref, pg_catalog.cardinality(p_transaction_ids));
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

  perform public.chips_assert_bot_only_table_lifecycle_gate(batch.bot_only_table_id, batch.batch_id, batch.cutoff, p_registry_keys);
  if not p_execute then
    prune_result := public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, false);
    return prune_result || pg_catalog.jsonb_build_object('cleanup', 'prepare_only', 'table_id', batch.bot_only_table_id);
  end if;
  if p_approved_batch_id is distinct from batch.batch_id or batch.destructive_go_batch_id is distinct from batch.batch_id or batch.destructive_go_at is null then
    raise exception using errcode = 'P8923', message = 'Exact bot-only batch GO is required before destructive cleanup';
  end if;

  perform pg_catalog.set_config('chips.bot_only_prune', '1', true);
  prune_result := public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, true);
  perform public.chips_assert_bot_only_table_lifecycle_gate(batch.bot_only_table_id, batch.batch_id, batch.cutoff, p_registry_keys);
  select count(*) into deleted_registry_count
    from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id
     and registry.idempotency_key = any(p_registry_keys);
  if deleted_registry_count <> pg_catalog.cardinality(p_registry_keys) then raise exception using errcode = 'P8924', message = 'Bot-only registry cleanup set is incomplete'; end if;

  perform pg_catalog.set_config('chips.bot_registry_cleanup', '1', true);
  delete from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id
     and registry.idempotency_key = any(p_registry_keys);
  get diagnostics deleted_registry_count = row_count;
  if deleted_registry_count <> pg_catalog.cardinality(p_registry_keys) then raise exception using errcode = 'P8924', message = 'Bot-only registry DELETE count mismatch'; end if;

  perform pg_catalog.set_config('chips.bot_cleanup_receipt', '1', true);
  update public.chips_ledger_archive_batches batches
     set registry_cleaned_at = pg_catalog.timezone('utc', pg_catalog.now()),
         registry_cleaned_key_count = pg_catalog.cardinality(p_registry_keys),
         registry_cleaned_keys_sha256 = registry_keys_sha256
   where batches.batch_id = batch.batch_id
     and batches.registry_cleaned_at is null;
  if not found then raise exception using errcode = 'P8924', message = 'Bot-only cleanup receipt transition was not unique'; end if;

  perform pg_catalog.set_config('chips.bot_only_lifecycle', '1', true);
  update public.poker_tables tables
     set bot_only_retention_complete_at = coalesce(tables.bot_only_retention_complete_at, pg_catalog.timezone('utc', pg_catalog.now()))
   where tables.id = batch.bot_only_table_id
     and tables.bot_only_retention_complete_at is null;

  -- The table may be removed by legal closed-table cleanup.  When the row is
  -- still present, however, the first cleanup must leave a non-empty marker;
  -- otherwise this exception rolls back prune, registry delete, and receipts.
  select tables.bot_only_retention_complete_at
    into lifecycle_marker
    from public.poker_tables tables
   where tables.id = batch.bot_only_table_id;
  if found and lifecycle_marker is null then
    raise exception using errcode = 'P8925', message = 'Bot-only lifecycle completion marker was not persisted';
  end if;

  return prune_result || pg_catalog.jsonb_build_object('state', 'cleaned', 'registry_keys', deleted_registry_count, 'table_id', batch.bot_only_table_id);
end;
$$;

reset role;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;

commit;
