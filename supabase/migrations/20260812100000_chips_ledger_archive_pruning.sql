begin;

alter table public.chips_ledger_archive_batches
  add column batch_id bigint generated always as identity,
  add column archived_transaction_ids_sha256 text,
  add column archived_entry_ids_sha256 text,
  add column archive_proof_verified_at timestamptz,
  add column pruned_at timestamptz,
  add column pruned_transaction_count bigint,
  add column pruned_entry_count bigint,
  add column pruned_transaction_ids_sha256 text,
  add column pruned_entry_ids_sha256 text,
  add constraint chips_ledger_archive_batches_batch_id_key unique (batch_id),
  add constraint chips_ledger_archive_batches_archive_proof_check check (
    (
      archived_transaction_ids_sha256 is null
      and archived_entry_ids_sha256 is null
      and archive_proof_verified_at is null
    ) or (
      status = 'committed'
      and archived_transaction_ids_sha256 ~ '^[0-9a-f]{64}$'
      and archived_entry_ids_sha256 ~ '^[0-9a-f]{64}$'
      and archive_proof_verified_at is not null
    )
  ),
  add constraint chips_ledger_archive_batches_prune_receipt_check check (
    (
      pruned_at is null
      and pruned_transaction_count is null
      and pruned_entry_count is null
      and pruned_transaction_ids_sha256 is null
      and pruned_entry_ids_sha256 is null
    ) or (
      archive_proof_verified_at is not null
      and pruned_at is not null
      and pruned_transaction_count = transaction_count
      and pruned_entry_count = entry_count
      and pruned_transaction_count > 0
      and pruned_entry_count > 0
      and pruned_transaction_ids_sha256 = archived_transaction_ids_sha256
      and pruned_entry_ids_sha256 = archived_entry_ids_sha256
    )
  );

alter table public.chips_transaction_idempotency
  add column archive_batch_id bigint,
  add constraint chips_transaction_idempotency_archive_batch_fk
    foreign key (archive_batch_id)
    references public.chips_ledger_archive_batches(batch_id)
    on delete restrict;

create index chips_transaction_idempotency_archive_batch_idx
  on public.chips_transaction_idempotency (archive_batch_id)
  where archive_batch_id is not null;

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
    or new.created_at is distinct from old.created_at then
    raise exception 'Archive batch proof fields are immutable';
  end if;

  if new.status is distinct from old.status then
    if old.status <> 'pending' or new.status <> 'committed'
      or old.committed_at is not null or new.committed_at is null then
      raise exception 'Archive batch status may only transition pending to committed';
    end if;
  elsif new.committed_at is distinct from old.committed_at then
    raise exception 'Archive batch committed_at is immutable';
  end if;

  old_proof_count := pg_catalog.num_nonnulls(
    old.archived_transaction_ids_sha256,
    old.archived_entry_ids_sha256,
    old.archive_proof_verified_at
  );
  new_proof_count := pg_catalog.num_nonnulls(
    new.archived_transaction_ids_sha256,
    new.archived_entry_ids_sha256,
    new.archive_proof_verified_at
  );
  if old_proof_count = 0 then
    if new_proof_count not in (0, 3) then
      raise exception 'Archive ID proof must transition from empty to complete';
    end if;
    if new_proof_count = 3 and new.status <> 'committed' then
      raise exception 'Archive ID proof requires a committed batch';
    end if;
  elsif new.archived_transaction_ids_sha256 is distinct from old.archived_transaction_ids_sha256
    or new.archived_entry_ids_sha256 is distinct from old.archived_entry_ids_sha256
    or new.archive_proof_verified_at is distinct from old.archive_proof_verified_at then
    raise exception 'Archive ID proof cannot be replaced or cleared';
  end if;

  old_receipt_count := pg_catalog.num_nonnulls(
    old.pruned_at,
    old.pruned_transaction_count,
    old.pruned_entry_count,
    old.pruned_transaction_ids_sha256,
    old.pruned_entry_ids_sha256
  );
  new_receipt_count := pg_catalog.num_nonnulls(
    new.pruned_at,
    new.pruned_transaction_count,
    new.pruned_entry_count,
    new.pruned_transaction_ids_sha256,
    new.pruned_entry_ids_sha256
  );
  if old_receipt_count = 0 then
    if new_receipt_count not in (0, 5) then
      raise exception 'Archive prune receipt must transition from empty to complete';
    end if;
    if new_receipt_count = 5 and new_proof_count <> 3 then
      raise exception 'Archive prune receipt requires an immutable ID proof';
    end if;
  elsif new.pruned_at is distinct from old.pruned_at
    or new.pruned_transaction_count is distinct from old.pruned_transaction_count
    or new.pruned_entry_count is distinct from old.pruned_entry_count
    or new.pruned_transaction_ids_sha256 is distinct from old.pruned_transaction_ids_sha256
    or new.pruned_entry_ids_sha256 is distinct from old.pruned_entry_ids_sha256 then
    raise exception 'Archive prune receipt cannot be replaced or cleared';
  end if;

  return new;
end;
$$;

create trigger chips_ledger_archive_batches_guard
before update or delete on public.chips_ledger_archive_batches
for each row execute function public.chips_guard_archive_batch_mutations();

create or replace function public.chips_guard_idempotency_mutations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Idempotency registry rows are durable; DELETE is not permitted';
  end if;

  if new.idempotency_key is distinct from old.idempotency_key
    or new.transaction_id is distinct from old.transaction_id
    or new.payload_hash is distinct from old.payload_hash
    or new.tx_type is distinct from old.tx_type
    or new.user_id is distinct from old.user_id
    or new.transaction_created_at is distinct from old.transaction_created_at
    or new.created_at is distinct from old.created_at then
    raise exception 'Idempotency registry identity is immutable';
  end if;

  if old.replay_transaction is not null
    or old.replay_entries is not null
    or old.replay_completed_at is not null then
    if new.replay_transaction is distinct from old.replay_transaction
      or new.replay_entries is distinct from old.replay_entries
      or new.replay_completed_at is distinct from old.replay_completed_at then
      raise exception 'Completed idempotency replay cannot be replaced or cleared';
    end if;
  elsif not (
    new.replay_transaction is null
    and new.replay_entries is null
    and new.replay_completed_at is null
  ) and not (
    new.replay_transaction is not null
    and new.replay_entries is not null
    and new.replay_completed_at is not null
  ) then
    raise exception 'Idempotency replay must transition from empty to complete';
  end if;

  if old.archive_batch_id is not null
    and new.archive_batch_id is distinct from old.archive_batch_id then
    raise exception 'Idempotency archive mapping cannot be replaced or cleared';
  end if;

  return new;
end;
$$;

create or replace function public.chips_reject_ledger_mutations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_user = 'chips_ledger_archive_pruner' then
    return old;
  end if;
  raise exception 'Ledger rows are append-only; % is not permitted on %', tg_op, tg_table_name;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'chips_ledger_archive_pruner') then
    create role chips_ledger_archive_pruner nologin noinherit;
  end if;
  if exists (
    select 1
      from pg_catalog.pg_roles
      where rolname = 'chips_ledger_archive_pruner'
        and (
          rolsuper or rolcreatedb or rolcreaterole or rolreplication
          or rolbypassrls or rolcanlogin or rolinherit
        )
  ) then
    raise exception 'chips_ledger_archive_pruner has unsafe role attributes';
  end if;
end;
$$;

grant usage on schema public, extensions to chips_ledger_archive_pruner;
grant execute on function extensions.digest(bytea, text) to chips_ledger_archive_pruner;

grant select on table
  public.chips_ledger_archive_batches,
  public.chips_transaction_idempotency,
  public.chips_accounts,
  public.chips_transactions,
  public.chips_entries,
  public.poker_tables
to chips_ledger_archive_pruner;

grant update (
  archived_transaction_ids_sha256,
  archived_entry_ids_sha256,
  archive_proof_verified_at,
  pruned_at,
  pruned_transaction_count,
  pruned_entry_count,
  pruned_transaction_ids_sha256,
  pruned_entry_ids_sha256
) on public.chips_ledger_archive_batches to chips_ledger_archive_pruner;
grant update (archive_batch_id) on public.chips_transaction_idempotency to chips_ledger_archive_pruner;
grant update (id) on public.chips_accounts to chips_ledger_archive_pruner;
grant update (id) on public.chips_transactions to chips_ledger_archive_pruner;
grant update (id) on public.chips_entries to chips_ledger_archive_pruner;
grant update (id) on public.poker_tables to chips_ledger_archive_pruner;
grant delete on public.chips_transactions, public.chips_entries to chips_ledger_archive_pruner;

create policy chips_archive_pruner_manifest_select
  on public.chips_ledger_archive_batches
  for select to chips_ledger_archive_pruner
  using (true);
create policy chips_archive_pruner_manifest_update
  on public.chips_ledger_archive_batches
  for update to chips_ledger_archive_pruner
  using (true) with check (true);

create policy chips_archive_pruner_registry_select
  on public.chips_transaction_idempotency
  for select to chips_ledger_archive_pruner
  using (true);
create policy chips_archive_pruner_registry_update
  on public.chips_transaction_idempotency
  for update to chips_ledger_archive_pruner
  using (true) with check (true);

create policy chips_archive_pruner_accounts_select
  on public.chips_accounts
  for select to chips_ledger_archive_pruner
  using (true);
create policy chips_archive_pruner_accounts_lock
  on public.chips_accounts
  for update to chips_ledger_archive_pruner
  using (true) with check (false);

create policy chips_archive_pruner_transactions_select
  on public.chips_transactions
  for select to chips_ledger_archive_pruner
  using (true);
create policy chips_archive_pruner_transactions_lock
  on public.chips_transactions
  for update to chips_ledger_archive_pruner
  using (true) with check (false);
create policy chips_archive_pruner_transactions_delete
  on public.chips_transactions
  for delete to chips_ledger_archive_pruner
  using (true);

create policy chips_archive_pruner_entries_select
  on public.chips_entries
  for select to chips_ledger_archive_pruner
  using (true);
create policy chips_archive_pruner_entries_lock
  on public.chips_entries
  for update to chips_ledger_archive_pruner
  using (true) with check (false);
create policy chips_archive_pruner_entries_delete
  on public.chips_entries
  for delete to chips_ledger_archive_pruner
  using (true);

create policy chips_archive_pruner_tables_select
  on public.poker_tables
  for select to chips_ledger_archive_pruner
  using (true);
create policy chips_archive_pruner_tables_lock
  on public.poker_tables
  for update to chips_ledger_archive_pruner
  using (true) with check (false);

create or replace function public.chips_archive_uuid_ids_sha256(p_ids uuid[])
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  payload text;
begin
  if pg_catalog.cardinality(p_ids) = 0
    or pg_catalog.array_ndims(p_ids) <> 1
    or pg_catalog.array_position(p_ids, null) is not null then
    raise exception 'Transaction ID proof requires a non-empty one-dimensional UUID array';
  end if;
  select pg_catalog.string_agg(p_ids[position]::text || E'\n', '' order by position)
    into payload
    from pg_catalog.generate_subscripts(p_ids, 1) as positions(position);
  return pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(payload, 'UTF8'), 'sha256'),
    'hex'
  );
end;
$$;

create or replace function public.chips_archive_bigint_ids_sha256(p_ids bigint[])
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  payload text;
begin
  if pg_catalog.cardinality(p_ids) = 0
    or pg_catalog.array_ndims(p_ids) <> 1
    or pg_catalog.array_position(p_ids, null) is not null
    or exists (select 1 from pg_catalog.unnest(p_ids) as value where value <= 0) then
    raise exception 'Entry ID proof requires a non-empty one-dimensional positive bigint array';
  end if;
  select pg_catalog.string_agg(p_ids[position]::text || E'\n', '' order by position)
    into payload
    from pg_catalog.generate_subscripts(p_ids, 1) as positions(position);
  return pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(payload, 'UTF8'), 'sha256'),
    'hex'
  );
end;
$$;

create or replace function public.chips_assert_archive_prune_stage()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  system_identifier text;
begin
  select control.system_identifier::text
    into system_identifier
    from pg_catalog.pg_control_system() as control;
  if system_identifier = '7575202818581710058' then
    raise exception 'Ledger archive pruning is forbidden on Production';
  end if;
  if system_identifier <> '7656985631720456337' then
    raise exception 'Ledger archive pruning is restricted to canonical Stage';
  end if;
  return system_identifier;
end;
$$;

create or replace function public.chips_register_archive_id_proof(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_project_ref text,
  p_format_version integer,
  p_cutoff timestamptz,
  p_cursor_start_created_at timestamptz,
  p_cursor_start_id uuid,
  p_cursor_end_created_at timestamptz,
  p_cursor_end_id uuid,
  p_first_created_at timestamptz,
  p_last_created_at timestamptz,
  p_tx_types jsonb,
  p_raw_bytes bigint,
  p_compressed_bytes bigint,
  p_raw_sha256 text,
  p_compressed_sha256 text,
  p_credits numeric,
  p_debits numeric,
  p_net_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  transaction_ids_sha256 text;
  entry_ids_sha256 text;
  tx_type_count bigint;
  updated_count bigint;
begin
  perform public.chips_assert_archive_prune_stage();
  if pg_catalog.cardinality(p_transaction_ids) between 1 and 5000 is not true
    or pg_catalog.cardinality(p_entry_ids) < 1 then
    raise exception 'Archive ID proof batch size is invalid';
  end if;
  if (select pg_catalog.count(*) from pg_catalog.unnest(p_transaction_ids) as id)
      <> (select pg_catalog.count(distinct id) from pg_catalog.unnest(p_transaction_ids) as id)
    or (select pg_catalog.count(*) from pg_catalog.unnest(p_entry_ids) as id)
      <> (select pg_catalog.count(distinct id) from pg_catalog.unnest(p_entry_ids) as id) then
    raise exception 'Archive ID proof contains duplicate IDs';
  end if;

  transaction_ids_sha256 := public.chips_archive_uuid_ids_sha256(p_transaction_ids);
  entry_ids_sha256 := public.chips_archive_bigint_ids_sha256(p_entry_ids);

  select coalesce(pg_catalog.sum(value::bigint), 0)
    into tx_type_count
    from pg_catalog.jsonb_each_text(p_tx_types) as types(key, value);
  if tx_type_count <> pg_catalog.cardinality(p_transaction_ids) then
    raise exception 'Archive ID proof tx_type counts do not match transaction IDs';
  end if;

  select batches.*
    into batch
    from public.chips_ledger_archive_batches as batches
    where batches.object_path = p_object_path
    for update;
  if not found then raise exception 'Committed archive manifest was not found'; end if;
  if batch.status <> 'committed' or batch.project_ref <> 'krydukthwdvccggbyjfw' then
    raise exception 'Archive manifest is not committed canonical Stage evidence';
  end if;
  if batch.object_path <> ('v1/sha256/' || p_compressed_sha256 || '.jsonl.gz') then
    raise exception 'Archive object path does not match compressed SHA-256';
  end if;
  if batch.project_ref is distinct from p_project_ref
    or batch.format_version is distinct from p_format_version
    or batch.cutoff is distinct from p_cutoff
    or batch.cursor_start_created_at is distinct from p_cursor_start_created_at
    or batch.cursor_start_id is distinct from p_cursor_start_id
    or batch.cursor_end_created_at is distinct from p_cursor_end_created_at
    or batch.cursor_end_id is distinct from p_cursor_end_id
    or batch.first_created_at is distinct from p_first_created_at
    or batch.last_created_at is distinct from p_last_created_at
    or batch.transaction_count is distinct from pg_catalog.cardinality(p_transaction_ids)::bigint
    or batch.entry_count is distinct from pg_catalog.cardinality(p_entry_ids)::bigint
    or batch.tx_types is distinct from p_tx_types
    or batch.raw_bytes is distinct from p_raw_bytes
    or batch.compressed_bytes is distinct from p_compressed_bytes
    or batch.raw_sha256 is distinct from p_raw_sha256
    or batch.compressed_sha256 is distinct from p_compressed_sha256
    or batch.credits is distinct from p_credits
    or batch.debits is distinct from p_debits
    or batch.net_amount is distinct from p_net_amount then
    raise exception 'Archive ID proof does not match committed manifest evidence';
  end if;

  if batch.archive_proof_verified_at is not null then
    if batch.archived_transaction_ids_sha256 is distinct from transaction_ids_sha256
      or batch.archived_entry_ids_sha256 is distinct from entry_ids_sha256 then
      raise exception 'Committed archive already has a different immutable ID proof';
    end if;
    return pg_catalog.jsonb_build_object(
      'state', 'proof_exists',
      'transactions', batch.transaction_count,
      'entries', batch.entry_count,
      'transaction_ids_sha256', transaction_ids_sha256,
      'entry_ids_sha256', entry_ids_sha256
    );
  end if;

  update public.chips_ledger_archive_batches as batches
     set archived_transaction_ids_sha256 = transaction_ids_sha256,
         archived_entry_ids_sha256 = entry_ids_sha256,
         archive_proof_verified_at = pg_catalog.timezone('utc', pg_catalog.now())
   where batches.batch_id = batch.batch_id
     and batches.archive_proof_verified_at is null;
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then raise exception 'Archive ID proof transition was not unique'; end if;

  return pg_catalog.jsonb_build_object(
    'state', 'proof_registered',
    'transactions', batch.transaction_count,
    'entries', batch.entry_count,
    'transaction_ids_sha256', transaction_ids_sha256,
    'entry_ids_sha256', entry_ids_sha256
  );
end;
$$;

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
  batch public.chips_ledger_archive_batches%rowtype;
  transaction_ids_sha256 text;
  entry_ids_sha256 text;
  transaction_count bigint := pg_catalog.cardinality(p_transaction_ids);
  entry_count bigint := pg_catalog.cardinality(p_entry_ids);
  receipt_field_count integer;
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
  if batch.status <> 'committed' or batch.project_ref <> 'krydukthwdvccggbyjfw' then
    raise exception 'Archive manifest is not committed canonical Stage evidence';
  end if;
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
      or registry_count <> transaction_count
      or matching_mapping_count <> transaction_count
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
         or selected.user_id is not null
         or selected.created_at >= batch.cutoff
         or pg_catalog.count(*) <> 2
         or pg_catalog.count(*) filter (where accounts.account_type = 'USER') <> 0
         or pg_catalog.count(*) filter (where accounts.account_type = 'SYSTEM') <> 1
         or pg_catalog.count(*) filter (where accounts.account_type = 'ESCROW') <> 1
         or pg_catalog.count(*) filter (
              where accounts.account_type = 'ESCROW'
                and accounts.system_key = 'POKER_TABLE:' || marker_summary.table_id
            ) <> 1
         or not pg_catalog.bool_and(accounts.status = 'active')
         or pg_catalog.sum(entries.amount) <> 0
         or (
           selected.tx_type::text = 'TABLE_BUY_IN'
           and (
             pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'SYSTEM') >= 0
             or pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'ESCROW') <= 0
           )
         )
         or (
           selected.tx_type::text = 'TABLE_CASH_OUT'
           and (
             pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'ESCROW') >= 0
             or pg_catalog.sum(entries.amount) filter (where accounts.account_type = 'SYSTEM') <= 0
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
    or user_transaction_count <> 0
    or user_entry_count <> 0 then
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
$$;

grant chips_ledger_archive_pruner to postgres;
grant create on schema public to chips_ledger_archive_pruner;

alter function public.chips_archive_uuid_ids_sha256(uuid[]) owner to chips_ledger_archive_pruner;
alter function public.chips_archive_bigint_ids_sha256(bigint[]) owner to chips_ledger_archive_pruner;
alter function public.chips_register_archive_id_proof(
  text, uuid[], bigint[], text, integer, timestamptz, timestamptz, uuid,
  timestamptz, uuid, timestamptz, timestamptz, jsonb, bigint, bigint,
  text, text, numeric, numeric, numeric
) owner to chips_ledger_archive_pruner;
alter function public.chips_prune_committed_archive_batch(text, uuid[], bigint[], boolean)
  owner to chips_ledger_archive_pruner;

revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;

revoke all on function public.chips_archive_uuid_ids_sha256(uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.chips_archive_bigint_ids_sha256(bigint[]) from public, anon, authenticated, service_role;
revoke all on function public.chips_assert_archive_prune_stage() from public, anon, authenticated, service_role;
revoke all on function public.chips_register_archive_id_proof(
  text, uuid[], bigint[], text, integer, timestamptz, timestamptz, uuid,
  timestamptz, uuid, timestamptz, timestamptz, jsonb, bigint, bigint,
  text, text, numeric, numeric, numeric
) from public, anon, authenticated, service_role;
revoke all on function public.chips_prune_committed_archive_batch(text, uuid[], bigint[], boolean)
  from public, anon, authenticated, service_role;

grant execute on function public.chips_assert_archive_prune_stage()
  to chips_ledger_archive_pruner;
grant execute on function public.chips_register_archive_id_proof(
  text, uuid[], bigint[], text, integer, timestamptz, timestamptz, uuid,
  timestamptz, uuid, timestamptz, timestamptz, jsonb, bigint, bigint,
  text, text, numeric, numeric, numeric
) to postgres;
grant execute on function public.chips_prune_committed_archive_batch(text, uuid[], bigint[], boolean)
  to postgres;

commit;
