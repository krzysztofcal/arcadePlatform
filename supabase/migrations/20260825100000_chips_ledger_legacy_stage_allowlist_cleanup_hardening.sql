begin;

-- Forward-only hardening for the legacy_stage_allowlist_v1 proof basis.  The
-- archive remains schema v2.  Unlike the historical implementation, an
-- execute must consume the exact registry key set proven by the archive and
-- leave an immutable cleanup receipt with no remaining batch mappings.
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
    )
  );

-- The proof table is private to the NOLOGIN archive-pruner role.  RLS remains
-- enabled; these policies make the existing security-definer registration
-- path usable without exposing proof rows to application roles.
drop policy if exists chips_legacy_stage_allowlist_proofs_pruner_select
  on public.chips_legacy_stage_allowlist_proofs;
create policy chips_legacy_stage_allowlist_proofs_pruner_select
  on public.chips_legacy_stage_allowlist_proofs
  for select to chips_ledger_archive_pruner
  using (true);
drop policy if exists chips_legacy_stage_allowlist_proofs_pruner_insert
  on public.chips_legacy_stage_allowlist_proofs;
create policy chips_legacy_stage_allowlist_proofs_pruner_insert
  on public.chips_legacy_stage_allowlist_proofs
  for insert to chips_ledger_archive_pruner
  with check (true);

-- The TABLE binding trigger is deferred and observes the intermediate shape
-- while the exact, already-authorized legacy cleanup deletes entries and then
-- transactions.  Permit only those DELETE events after the destructive
-- function has rechecked the active fence and exact batch GO.  Inserts and
-- updates, and every other caller, continue through the normal fail-closed
-- binding validation.
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
  if tg_op = 'DELETE'
     and pg_catalog.current_setting('chips.legacy_stage_cleanup', true) = '1'
     and pg_catalog.current_setting('chips.bot_only_prune', true) = '1'
     and pg_catalog.current_setting('chips.bot_only_go', true) = '1' then
    return old;
  end if;

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

-- The fence-control table is intentionally not writable by the archive
-- pruner.  This owner-controlled helper gives the pruner only the lock it
-- needs to serialize the final fence check with a toggle.
create or replace function public.chips_lock_table_fence_for_legacy_cleanup()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
    from public.chips_table_fence_control control
   where control.control_id is true
   for share;
end;
$$;

alter function public.chips_lock_table_fence_for_legacy_cleanup() owner to postgres;
revoke all on function public.chips_lock_table_fence_for_legacy_cleanup() from public, anon, authenticated, service_role;
grant execute on function public.chips_lock_table_fence_for_legacy_cleanup() to chips_ledger_archive_pruner;

-- The existing guard is retained, with one narrow addition: a legacy proof
-- may write the same three-field receipt after its five-field prune receipt.
create or replace function public.chips_guard_archive_batch_mutations()
returns trigger
language plpgsql
set search_path = ''
as $$
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
       coalesce(pg_catalog.current_setting('chips.bot_only_prune', true), '') <> '1'
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
     and coalesce(pg_catalog.current_setting('chips.bot_only_proof', true), '') <> '1' then
    raise exception 'Bot-only proof may only be written by the lifecycle proof operator';
  end if;
  if (receipt_changed or cleanup_changed) and current_user <> 'chips_ledger_archive_pruner' then
    raise exception 'Archive receipt may only be written by the archive pruner';
  end if;
  if cleanup_changed
     and coalesce(pg_catalog.current_setting('chips.bot_cleanup_receipt', true), '') <> '1' then
    raise exception 'Registry cleanup receipt may only be written by the lifecycle cleanup operator';
  end if;
  if go_changed and not (
    current_user = 'postgres'
    and coalesce(pg_catalog.current_setting('chips.bot_only_go', true), '') = '1'
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
      (new.source_policy_id = 'stage-ledger-bot-only-retention-7d-v1' and new_bot_proof_count = 7)
      or (new.source_policy_id = 'legacy_stage_allowlist_v1' and new_bot_proof_count = 0)
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
$$;

-- The old eight-argument function was not safe for a legacy execute because it
-- had no immutable registry-key input.  Replace it instead of leaving a
-- callable destructive overload behind.
drop function public.chips_prune_legacy_stage_allowlist_batch(
  text, uuid[], bigint[], uuid[], text, text, boolean, bigint
);

grant chips_ledger_archive_pruner to postgres;
grant usage on schema public, extensions to chips_ledger_archive_pruner;
grant select on public.chips_ledger_archive_batches, public.chips_legacy_stage_allowlist_proofs,
  public.chips_transaction_idempotency, public.chips_transactions, public.chips_entries,
  public.chips_accounts, public.poker_tables, public.chips_table_fence_control
  to chips_ledger_archive_pruner;
grant delete on public.chips_transaction_idempotency, public.chips_transactions, public.chips_entries
  to chips_ledger_archive_pruner;
grant execute on function public.chips_table_fence_is_active() to chips_ledger_archive_pruner;
grant create on schema public to chips_ledger_archive_pruner;

set role chips_ledger_archive_pruner;

create function public.chips_prune_legacy_stage_allowlist_batch(
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
  result jsonb;
begin
  if p_execute is null
     or p_transaction_ids is null
     or p_entry_ids is null
     or p_registry_keys is null
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
    if batch.pruned_transaction_count is distinct from batch.transaction_count
       or batch.pruned_entry_count is distinct from batch.entry_count
       or batch.pruned_transaction_ids_sha256 is distinct from public.chips_archive_uuid_ids_sha256(p_transaction_ids)
       or batch.pruned_entry_ids_sha256 is distinct from public.chips_archive_bigint_ids_sha256(p_entry_ids)
       or batch.registry_cleaned_at is null
       or batch.registry_cleaned_key_count is distinct from pg_catalog.cardinality(p_registry_keys)
       or batch.registry_cleaned_keys_sha256 is distinct from registry_keys_sha256 then
      raise exception using errcode = 'P8934', message = 'Existing legacy Stage cleanup receipt differs';
    end if;
    select count(*) into remaining_registry_count
      from public.chips_transaction_idempotency registry
     where registry.archive_batch_id = batch.batch_id;
    if remaining_registry_count <> 0 then
      raise exception using errcode = 'P8938', message = 'Existing legacy Stage cleanup left registry mappings';
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
  -- function call remains the authoritative check; the table lock avoids an
  -- RLS-dependent row lock and prevents a concurrent owner-controlled toggle
  -- from racing that check.
  perform public.chips_lock_table_fence_for_legacy_cleanup();
  if not coalesce(public.chips_table_fence_is_active(), false) then
    raise exception using errcode = 'P8937', message = 'Active TABLE fence is required before legacy destructive cleanup';
  end if;
  if p_approved_batch_id is distinct from batch.batch_id
     or batch.destructive_go_batch_id is distinct from batch.batch_id
     or batch.destructive_go_at is null then
    raise exception using errcode = 'P8935', message = 'Exact legacy Stage batch GO is required before execution';
  end if;

  -- Authorization is durable state and may have happened on a different
  -- connection.  Re-establish the per-call proof only after validating that
  -- exact persisted GO and batch identity above.
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

  select count(*) into remaining_registry_count
    from public.chips_transaction_idempotency registry
   where registry.archive_batch_id = batch.batch_id;
  if remaining_registry_count <> 0 then
    raise exception using errcode = 'P8938', message = 'Legacy Stage cleanup receipt is not backed by an empty registry';
  end if;
  return result || pg_catalog.jsonb_build_object(
    'state', 'pruned',
    'mode', 'execute',
    'batch_id', batch.batch_id,
    'registry_keys', deleted_registry_count,
    'registry_keys_sha256', registry_keys_sha256,
    'remaining_registry_count', remaining_registry_count
  );
end;
$$;

reset role;

alter function public.chips_prune_legacy_stage_allowlist_batch(
  text, uuid[], bigint[], uuid[], text, text, text[], boolean, bigint
) owner to chips_ledger_archive_pruner;
revoke all on function public.chips_prune_legacy_stage_allowlist_batch(
  text, uuid[], bigint[], uuid[], text, text, text[], boolean, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.chips_prune_legacy_stage_allowlist_batch(
  text, uuid[], bigint[], uuid[], text, text, text[], boolean, bigint
) to postgres;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;

commit;
