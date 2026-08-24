begin;

-- Issue #890 is a forward-only, Stage-only exception.  It keeps archive
-- objects at schema v2; legacy_stage_allowlist_v1 is a proof basis.
alter table public.chips_ledger_archive_batches
  drop constraint if exists chips_ledger_archive_batches_source_policy_check,
  drop constraint if exists chips_ledger_archive_batches_bot_only_policy_check,
  drop constraint if exists chips_ledger_archive_batches_bot_only_evidence_check;

alter table public.chips_ledger_archive_batches
  add column if not exists legacy_allowlist_sha256 text,
  add column if not exists legacy_batch_table_ids_sha256 text,
  add column if not exists legacy_master_table_ids uuid[],
  add column if not exists legacy_master_table_count bigint,
  add column if not exists legacy_batch_number bigint,
  add column if not exists legacy_batch_table_count bigint,
  add column if not exists legacy_source_run text,
  add column if not exists legacy_query_sha256 text,
  add column if not exists legacy_stage_system_identifier text;

alter table public.chips_ledger_archive_batches
  add constraint chips_ledger_archive_batches_source_policy_check
  check (
    source_policy_id is null
    or source_policy_id in (
      'stage-ledger-auto-retention-30d-v1',
      'stage-ledger-bot-only-retention-7d-v1',
      'legacy_stage_allowlist_v1'
    )
  ),
  add constraint chips_ledger_archive_batches_bot_only_policy_check
  check (
    format_version <> 2
    or source_policy_id in (
      'stage-ledger-bot-only-retention-7d-v1',
      'legacy_stage_allowlist_v1'
    )
  ),
  add constraint chips_ledger_archive_batches_bot_only_evidence_check
  check (
    (
      format_version <> 2
      and bot_only_table_id is null
      and bot_only_table_count is null
      and bot_only_newest_created_at is null
      and bot_only_registry_keys_sha256 is null
      and bot_only_out_of_scope_keys_sha256 is null
      and bot_only_identity_count is null
      and bot_only_eligible_count is null
    ) or (
      format_version = 2
      and source_policy_id = 'stage-ledger-bot-only-retention-7d-v1'
      and bot_only_table_id is not null
      and bot_only_table_count = 1
      and bot_only_newest_created_at is not null
      and bot_only_registry_keys_sha256 ~ '^[0-9a-f]{64}$'
      and bot_only_out_of_scope_keys_sha256 ~ '^[0-9a-f]{64}$'
      and bot_only_identity_count >= 1
      and bot_only_identity_count = transaction_count
      and bot_only_eligible_count = transaction_count
    ) or (
      format_version = 2
      and source_policy_id = 'legacy_stage_allowlist_v1'
      and bot_only_table_id is null
      and bot_only_table_count is null
      and bot_only_newest_created_at is null
      and bot_only_registry_keys_sha256 is null
      and bot_only_out_of_scope_keys_sha256 is null
      and bot_only_identity_count is null
      and bot_only_eligible_count is null
    )
  );

alter table public.chips_ledger_archive_batches
  add constraint chips_ledger_archive_batches_legacy_allowlist_check
  check (
    (
      source_policy_id is distinct from 'legacy_stage_allowlist_v1'
      and legacy_allowlist_sha256 is null
      and legacy_batch_table_ids_sha256 is null
      and legacy_master_table_ids is null
      and legacy_master_table_count is null
      and legacy_batch_number is null
      and legacy_batch_table_count is null
      and legacy_source_run is null
      and legacy_query_sha256 is null
      and legacy_stage_system_identifier is null
    ) or (
      format_version = 2
      and project_ref = 'krydukthwdvccggbyjfw'
      and legacy_allowlist_sha256 ~ '^[0-9a-f]{64}$'
      and legacy_batch_table_ids_sha256 ~ '^[0-9a-f]{64}$'
      and legacy_master_table_ids is not null
      and pg_catalog.cardinality(legacy_master_table_ids) = 974
      and legacy_master_table_count = 974
      and legacy_batch_number between 1 and 98
      and legacy_batch_table_count between 1 and 10
      and legacy_source_run = '32753223679'
      and legacy_query_sha256 ~ '^[0-9a-f]{64}$'
      and legacy_stage_system_identifier = '7656985631720456337'
    )
  );

create table public.chips_legacy_stage_allowlist_proofs (
  batch_id bigint primary key
    references public.chips_ledger_archive_batches(batch_id) on delete restrict,
  object_path text not null unique,
  project_ref text not null check (project_ref = 'krydukthwdvccggbyjfw'),
  source_policy_id text not null check (source_policy_id = 'legacy_stage_allowlist_v1'),
  cutoff timestamptz not null,
  source_run text not null check (source_run = '32753223679'),
  query_sha256 text not null check (query_sha256 ~ '^[0-9a-f]{64}$'),
  postgres_system_identifier text not null check (postgres_system_identifier = '7656985631720456337'),
  master_table_count bigint not null check (master_table_count = 974),
  master_table_ids uuid[] not null check (pg_catalog.cardinality(master_table_ids) = 974),
  master_table_ids_sha256 text not null check (master_table_ids_sha256 ~ '^[0-9a-f]{64}$'),
  batch_number bigint not null check (batch_number between 1 and 98),
  batch_table_count bigint not null check (batch_table_count between 1 and 10),
  batch_table_ids uuid[] not null check (pg_catalog.cardinality(batch_table_ids) = batch_table_count),
  batch_table_ids_sha256 text not null check (batch_table_ids_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.timezone('utc', pg_catalog.now())
);

alter table public.chips_legacy_stage_allowlist_proofs enable row level security;
revoke all on table public.chips_legacy_stage_allowlist_proofs from public, anon, authenticated, service_role;

create or replace function public.chips_guard_legacy_stage_allowlist_proof_mutations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P8930', message = 'Legacy Stage allowlist proof rows are immutable';
end;
$$;

create or replace function public.chips_register_legacy_stage_allowlist_proof(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_batch_table_ids uuid[],
  p_master_table_ids uuid[],
  p_allowlist_sha256 text,
  p_batch_table_ids_sha256 text,
  p_master_table_count bigint,
  p_batch_number bigint,
  p_source_run text,
  p_query_sha256 text,
  p_stage_system_identifier text,
  p_cutoff timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  proof public.chips_legacy_stage_allowlist_proofs%rowtype;
  proof_result jsonb;
  inserted_count bigint;
begin
  proof_result := public.chips_assert_legacy_stage_allowlist_batch(
    p_object_path, p_transaction_ids, p_entry_ids, p_batch_table_ids, p_master_table_ids,
    p_allowlist_sha256, p_batch_table_ids_sha256, p_master_table_count, p_batch_number,
    p_source_run, p_query_sha256, p_stage_system_identifier, p_cutoff
  );
  select batches.* into batch
    from public.chips_ledger_archive_batches batches
   where batches.object_path = p_object_path
   for update;
  if not found then
    raise exception using errcode = 'P8930', message = 'Legacy Stage archive batch disappeared';
  end if;

  perform public.chips_register_archive_id_proof(
    p_object_path, p_transaction_ids, p_entry_ids, batch.project_ref, batch.format_version,
    batch.cutoff, batch.cursor_start_created_at, batch.cursor_start_id,
    batch.cursor_end_created_at, batch.cursor_end_id, batch.first_created_at, batch.last_created_at,
    batch.tx_types, batch.raw_bytes, batch.compressed_bytes, batch.raw_sha256, batch.compressed_sha256,
    batch.credits, batch.debits, batch.net_amount
  );

  insert into public.chips_legacy_stage_allowlist_proofs (
    batch_id, object_path, project_ref, source_policy_id, cutoff, source_run, query_sha256,
    postgres_system_identifier, master_table_count, master_table_ids, master_table_ids_sha256,
    batch_number, batch_table_count, batch_table_ids, batch_table_ids_sha256
  ) values (
    batch.batch_id, batch.object_path, batch.project_ref, 'legacy_stage_allowlist_v1', batch.cutoff,
    p_source_run, p_query_sha256, p_stage_system_identifier, p_master_table_count, p_master_table_ids,
    p_allowlist_sha256, p_batch_number, pg_catalog.cardinality(p_batch_table_ids), p_batch_table_ids,
    p_batch_table_ids_sha256
  ) on conflict (batch_id) do nothing;
  get diagnostics inserted_count = row_count;

  select proofs.* into proof
    from public.chips_legacy_stage_allowlist_proofs proofs
   where proofs.batch_id = batch.batch_id;
  if not found
     or proof.object_path is distinct from batch.object_path
     or proof.master_table_ids is distinct from p_master_table_ids
     or proof.master_table_ids_sha256 is distinct from p_allowlist_sha256
     or proof.batch_table_ids is distinct from p_batch_table_ids
     or proof.batch_table_ids_sha256 is distinct from p_batch_table_ids_sha256
     or proof.source_run is distinct from p_source_run
     or proof.query_sha256 is distinct from p_query_sha256
     or proof.postgres_system_identifier is distinct from p_stage_system_identifier then
    raise exception using errcode = 'P8931', message = 'Existing legacy Stage allowlist proof differs from requested batch';
  end if;
  return proof_result || pg_catalog.jsonb_build_object(
    'state', case when inserted_count = 1 then 'proof_registered' else 'proof_exists' end,
    'batch_id', batch.batch_id,
    'master_table_count', p_master_table_count
  );
end;
$$;

-- The normal wrapper cannot route a legacy policy into the normal schema-v2
-- path.  The dedicated exact-batch function below is the only legacy pruner.
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
begin
  if exists (
    select 1 from public.chips_ledger_archive_batches batches
     where batches.object_path = p_object_path
       and batches.source_policy_id = 'legacy_stage_allowlist_v1'
  ) then
    raise exception using errcode = 'P8932', message = 'Legacy Stage allowlist requires its exact-batch pruner';
  end if;
  return public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, p_execute);
end;
$$;

create or replace function public.chips_authorize_legacy_stage_allowlist_batch(
  p_batch_id bigint,
  p_confirmation text,
  p_allowlist_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
begin
  if p_confirmation is distinct from ('GO ' || p_batch_id::text)
     or p_allowlist_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P8933', message = 'Exact legacy Stage batch GO confirmation is required';
  end if;
  perform public.chips_assert_archive_prune_stage();
  select batches.* into batch
    from public.chips_ledger_archive_batches batches
   where batches.batch_id = p_batch_id
   for update;
  if not found
     or batch.status <> 'committed'
     or batch.format_version <> 2
     or batch.source_policy_id <> 'legacy_stage_allowlist_v1'
     or batch.project_ref <> 'krydukthwdvccggbyjfw'
     or batch.archive_proof_verified_at is null
     or batch.pruned_at is not null
     or batch.legacy_allowlist_sha256 is distinct from p_allowlist_sha256
     or not exists (
       select 1 from public.chips_legacy_stage_allowlist_proofs proofs
        where proofs.batch_id = batch.batch_id
          and proofs.master_table_ids_sha256 = p_allowlist_sha256
     ) then
    raise exception using errcode = 'P8933', message = 'Only one exact committed legacy Stage batch may be authorized';
  end if;
  perform pg_catalog.set_config('chips.bot_only_go', '1', true);
  update public.chips_ledger_archive_batches batches
     set destructive_go_at = pg_catalog.timezone('utc', pg_catalog.now()),
         destructive_go_batch_id = batch.batch_id
   where batches.batch_id = batch.batch_id
     and batches.destructive_go_at is null;
  return pg_catalog.jsonb_build_object('state', 'authorized', 'batch_id', batch.batch_id);
end;
$$;

create or replace function public.chips_prune_legacy_stage_allowlist_batch(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_batch_table_ids uuid[],
  p_allowlist_sha256 text,
  p_batch_table_ids_sha256 text,
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
  result jsonb;
begin
  if p_execute is null then
    raise exception using errcode = 'P8934', message = 'Legacy Stage execute flag must not be NULL';
  end if;
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
       or batch.pruned_entry_ids_sha256 is distinct from public.chips_archive_bigint_ids_sha256(p_entry_ids) then
      raise exception using errcode = 'P8934', message = 'Existing legacy Stage prune receipt differs';
    end if;
    return pg_catalog.jsonb_build_object('state', 'already_pruned', 'batch_id', batch.batch_id);
  end if;

  perform public.chips_assert_legacy_stage_allowlist_batch(
    p_object_path, p_transaction_ids, p_entry_ids, p_batch_table_ids, proof.master_table_ids,
    p_allowlist_sha256, p_batch_table_ids_sha256, proof.master_table_count, proof.batch_number,
    proof.source_run, proof.query_sha256, proof.postgres_system_identifier, batch.cutoff
  );
  if not p_execute then
    result := public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, false);
    return result || pg_catalog.jsonb_build_object('state', 'ready', 'mode', 'prepare-only', 'batch_id', batch.batch_id);
  end if;
  if p_approved_batch_id is distinct from batch.batch_id
     or batch.destructive_go_batch_id is distinct from batch.batch_id
     or batch.destructive_go_at is null then
    raise exception using errcode = 'P8935', message = 'Exact legacy Stage batch GO is required before execution';
  end if;
  perform pg_catalog.set_config('chips.bot_only_prune', '1', true);
  result := public.chips_prune_committed_archive_batch_internal(p_object_path, p_transaction_ids, p_entry_ids, true);
  return result || pg_catalog.jsonb_build_object('state', 'pruned', 'mode', 'execute', 'batch_id', batch.batch_id);
end;
$$;

create trigger chips_legacy_stage_allowlist_proofs_guard
before update or delete on public.chips_legacy_stage_allowlist_proofs
for each row execute function public.chips_guard_legacy_stage_allowlist_proof_mutations();

create or replace function public.chips_guard_legacy_stage_allowlist_batch_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.legacy_allowlist_sha256 is distinct from old.legacy_allowlist_sha256
     or new.legacy_batch_table_ids_sha256 is distinct from old.legacy_batch_table_ids_sha256
     or new.legacy_master_table_ids is distinct from old.legacy_master_table_ids
     or new.legacy_master_table_count is distinct from old.legacy_master_table_count
     or new.legacy_batch_number is distinct from old.legacy_batch_number
     or new.legacy_batch_table_count is distinct from old.legacy_batch_table_count
     or new.legacy_source_run is distinct from old.legacy_source_run
     or new.legacy_query_sha256 is distinct from old.legacy_query_sha256
     or new.legacy_stage_system_identifier is distinct from old.legacy_stage_system_identifier then
    raise exception using errcode = 'P8930', message = 'Legacy Stage allowlist fields are immutable';
  end if;
  return new;
end;
$$;

create trigger chips_ledger_archive_batches_legacy_fields_guard
before update on public.chips_ledger_archive_batches
for each row execute function public.chips_guard_legacy_stage_allowlist_batch_fields();

grant chips_ledger_archive_pruner to postgres;
grant usage on schema public, extensions to chips_ledger_archive_pruner;
grant select, insert on table public.chips_legacy_stage_allowlist_proofs to chips_ledger_archive_pruner;
grant create on schema public to chips_ledger_archive_pruner;
set role chips_ledger_archive_pruner;

-- Revalidates only the frozen batch table IDs.  It is called before proof and
-- again before dry-run/execute, so any drift in these ten tables is a no-op.
create or replace function public.chips_assert_legacy_stage_allowlist_batch(
  p_object_path text,
  p_transaction_ids uuid[],
  p_entry_ids bigint[],
  p_batch_table_ids uuid[],
  p_master_table_ids uuid[],
  p_allowlist_sha256 text,
  p_batch_table_ids_sha256 text,
  p_master_table_count bigint,
  p_batch_number bigint,
  p_source_run text,
  p_query_sha256 text,
  p_stage_system_identifier text,
  p_cutoff timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.chips_ledger_archive_batches%rowtype;
  actual_transaction_ids uuid[];
  actual_entry_ids bigint[];
  actual_table_ids uuid[];
  transaction_count bigint;
  entry_count bigint;
  invalid_registry_count bigint;
  invalid_marker_count bigint;
  invalid_shape_count bigint;
  newest_created_at timestamptz;
begin
  perform public.chips_assert_archive_prune_stage();
  if p_object_path is null
     or p_transaction_ids is null
     or p_entry_ids is null
     or p_batch_table_ids is null
     or p_master_table_ids is null
     or p_cutoff is null
     or p_master_table_count is distinct from 974
     or p_source_run is distinct from '32753223679'
     or p_query_sha256 is distinct from '9bd27ff7a2749a879707e823982f708e6abf86beffcdf8f97c5deac05f00ca09'
     or p_stage_system_identifier is distinct from '7656985631720456337'
     or p_allowlist_sha256 !~ '^[0-9a-f]{64}$'
     or p_batch_table_ids_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P8930', message = 'Legacy Stage allowlist proof arguments are invalid';
  end if;

  transaction_count := pg_catalog.cardinality(p_transaction_ids);
  entry_count := pg_catalog.cardinality(p_entry_ids);
  if transaction_count not between 1 and 5000
     or entry_count < 1
     or pg_catalog.cardinality(p_batch_table_ids) not between 1 and 10
     or p_batch_table_ids is distinct from (
       select pg_catalog.array_agg(ids.id order by ids.id)
         from pg_catalog.unnest(p_batch_table_ids) as ids(id)
     )
     or p_master_table_ids is distinct from (
       select pg_catalog.array_agg(ids.id order by ids.id)
         from pg_catalog.unnest(p_master_table_ids) as ids(id)
     )
     or pg_catalog.cardinality(p_master_table_ids) <> 974 then
    raise exception using errcode = 'P8930', message = 'Legacy Stage allowlist arrays are not canonical or bounded';
  end if;
  if (select count(*) from pg_catalog.unnest(p_transaction_ids) as ids(id))
       <> (select count(distinct id) from pg_catalog.unnest(p_transaction_ids) as ids(id))
     or (select count(*) from pg_catalog.unnest(p_entry_ids) as ids(id))
       <> (select count(distinct id) from pg_catalog.unnest(p_entry_ids) as ids(id))
     or (select count(*) from pg_catalog.unnest(p_batch_table_ids) as ids(id))
       <> (select count(distinct id) from pg_catalog.unnest(p_batch_table_ids) as ids(id))
     or (select count(*) from pg_catalog.unnest(p_master_table_ids) as ids(id))
       <> (select count(distinct id) from pg_catalog.unnest(p_master_table_ids) as ids(id))
     or exists (
       select 1 from pg_catalog.unnest(p_batch_table_ids) as ids(id)
        where not (ids.id = any(p_master_table_ids))
     ) then
    raise exception using errcode = 'P8930', message = 'Legacy Stage allowlist contains duplicate or out-of-master identities';
  end if;
  if public.chips_archive_uuid_ids_sha256(p_master_table_ids) <> p_allowlist_sha256
     or public.chips_archive_uuid_ids_sha256(p_batch_table_ids) <> p_batch_table_ids_sha256 then
    raise exception using errcode = 'P8930', message = 'Legacy Stage allowlist identity hash does not match';
  end if;

  select batches.* into batch
    from public.chips_ledger_archive_batches batches
   where batches.object_path = p_object_path
   for update;
  if not found
     or batch.status <> 'committed'
     or batch.project_ref <> 'krydukthwdvccggbyjfw'
     or batch.format_version <> 2
     or batch.source_policy_id <> 'legacy_stage_allowlist_v1'
     or batch.cutoff is distinct from p_cutoff
     or batch.legacy_allowlist_sha256 is distinct from p_allowlist_sha256
     or batch.legacy_batch_table_ids_sha256 is distinct from p_batch_table_ids_sha256
     or batch.legacy_master_table_ids is distinct from p_master_table_ids
     or batch.legacy_master_table_count is distinct from p_master_table_count
     or batch.legacy_batch_number is distinct from p_batch_number
     or batch.legacy_batch_table_count is distinct from pg_catalog.cardinality(p_batch_table_ids)
     or batch.legacy_source_run is distinct from p_source_run
     or batch.legacy_query_sha256 is distinct from p_query_sha256
     or batch.legacy_stage_system_identifier is distinct from p_stage_system_identifier
     or batch.object_path <> ('v1/sha256/' || batch.compressed_sha256 || '.jsonl.gz') then
    raise exception using errcode = 'P8930', message = 'Legacy Stage allowlist manifest is not exact';
  end if;

  select pg_catalog.array_agg(transactions.id order by transactions.created_at, transactions.id)
    into actual_transaction_ids
    from public.chips_transactions transactions
   where transactions.id = any(p_transaction_ids);
  if actual_transaction_ids is distinct from p_transaction_ids then
    raise exception using errcode = 'P8930', message = 'Legacy Stage transaction set changed';
  end if;

  with wanted as (
    select ids.id, ids.ordinality
      from pg_catalog.unnest(p_transaction_ids) with ordinality as ids(id, ordinality)
  )
  select pg_catalog.array_agg(entries.id order by wanted.ordinality, entries.id)
    into actual_entry_ids
    from wanted
    join public.chips_entries entries on entries.transaction_id = wanted.id;
  if actual_entry_ids is distinct from p_entry_ids then
    raise exception using errcode = 'P8930', message = 'Legacy Stage entry set changed';
  end if;

  with selected as materialized (
    select transactions.*
      from public.chips_transactions transactions
     where transactions.id = any(p_transaction_ids)
  ), registry as materialized (
    select registry.*, selected.id as selected_id
      from public.chips_transaction_idempotency registry
      join selected on selected.id = registry.transaction_id
  )
  select count(*) into invalid_registry_count
    from registry
   where registry.tx_type::text not in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
      or registry.table_id is null
      or registry.user_id is not null
      or registry.archive_batch_id is not null
      or registry.payload_hash is distinct from (select selected.payload_hash from selected where selected.id = registry.selected_id)
      or registry.idempotency_key is distinct from (select selected.idempotency_key from selected where selected.id = registry.selected_id)
      or registry.transaction_created_at is distinct from (select selected.created_at from selected where selected.id = registry.selected_id)
      or registry.tx_type is distinct from (select selected.tx_type from selected where selected.id = registry.selected_id)
      or registry.user_id is distinct from (select selected.user_id from selected where selected.id = registry.selected_id);
  if invalid_registry_count <> 0
     or (select count(*) from public.chips_transaction_idempotency registry where registry.transaction_id = any(p_transaction_ids)) <> transaction_count then
    raise exception using errcode = 'P8930', message = 'Legacy Stage registry identity set is incomplete or changed';
  end if;

  select pg_catalog.array_agg(distinct registry.table_id order by registry.table_id)
    into actual_table_ids
    from public.chips_transaction_idempotency registry
   where registry.transaction_id = any(p_transaction_ids);
  if actual_table_ids is distinct from p_batch_table_ids then
    raise exception using errcode = 'P8930', message = 'Legacy Stage batch table set changed';
  end if;
  if (select count(*)
        from public.chips_transaction_idempotency registry
       where registry.table_id = any(p_batch_table_ids)
         and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')) <> transaction_count
     or exists (
       select 1
         from public.chips_transaction_idempotency registry
        where registry.table_id = any(p_batch_table_ids)
          and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
          and not (registry.transaction_id = any(p_transaction_ids))
     ) then
    raise exception using errcode = 'P8930', message = 'Legacy Stage table identity set changed';
  end if;

  select count(*) into invalid_marker_count
    from (
      with selected as materialized (
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
         where transactions.id = any(p_transaction_ids)
      )
      select selected.id
        from selected
        join public.chips_transaction_idempotency registry
          on registry.transaction_id = selected.id
       where pg_catalog.jsonb_typeof(selected.normalized_metadata) is distinct from 'object'
          or (
            selected.normalized_metadata ? 'tableId'
            and (
              pg_catalog.lower(pg_catalog.btrim(selected.normalized_metadata->>'tableId')) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              or pg_catalog.lower(pg_catalog.btrim(selected.normalized_metadata->>'tableId')) <> registry.table_id::text
            )
          )
          or (
            selected.reference is not null
            and (
              selected.reference !~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):'
              or pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2))) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              or pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(selected.reference, ':', 2))) <> registry.table_id::text
            )
          )
    ) invalid;
  if invalid_marker_count <> 0 then
    raise exception using errcode = 'P8902', message = 'Legacy Stage allowlist marker proof is invalid';
  end if;

  select count(*) into invalid_shape_count
    from (
      with selected as (
        select transactions.*
          from public.chips_transactions transactions
         where transactions.id = any(p_transaction_ids)
      ), registry as (
        select registry.*
          from public.chips_transaction_idempotency registry
         where registry.transaction_id = any(p_transaction_ids)
      ), shapes as (
        select selected.id,
               selected.tx_type::text as tx_type,
               selected.user_id,
               registry.table_id,
               count(entries.id)::bigint as entry_count,
               count(*) filter (where accounts.account_type::text = 'USER')::bigint as user_entry_count,
               count(*) filter (where accounts.account_type::text = 'SYSTEM')::bigint as system_entry_count,
               count(*) filter (where accounts.account_type::text = 'ESCROW')::bigint as escrow_entry_count,
               count(*) filter (where accounts.account_type::text = 'ESCROW'
                                  and accounts.system_key = 'POKER_TABLE:' || registry.table_id::text)::bigint as matching_escrow_count,
               count(*) filter (where accounts.status::text = 'active')::bigint as active_entry_count,
               coalesce(sum(entries.amount), 0)::numeric as net_amount,
               coalesce(sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM'), 0)::numeric as system_amount,
               coalesce(sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW'), 0)::numeric as escrow_amount
          from selected
          join registry on registry.transaction_id = selected.id
          left join public.chips_entries entries on entries.transaction_id = selected.id
          left join public.chips_accounts accounts on accounts.id = entries.account_id
         group by selected.id, selected.tx_type, selected.user_id, registry.table_id
      )
      select shapes.id
        from shapes
       where shapes.user_id is not null
          or shapes.entry_count <> 2
          or shapes.user_entry_count <> 0
          or shapes.system_entry_count <> 1
          or shapes.escrow_entry_count <> 1
          or shapes.matching_escrow_count <> 1
          or shapes.active_entry_count <> 2
          or shapes.net_amount <> 0
          or (shapes.tx_type = 'TABLE_BUY_IN' and (shapes.system_amount >= 0 or shapes.escrow_amount <= 0))
          or (shapes.tx_type = 'TABLE_CASH_OUT' and (shapes.escrow_amount >= 0 or shapes.system_amount <= 0))
    ) invalid;
  if invalid_shape_count <> 0 then
    raise exception using errcode = 'P8930', message = 'Legacy Stage allowlist entry shape is incomplete';
  end if;

  select max(registry.transaction_created_at)
    into newest_created_at
    from public.chips_transaction_idempotency registry
   where registry.transaction_id = any(p_transaction_ids);
  if newest_created_at is null or newest_created_at >= p_cutoff then
    raise exception using errcode = 'P8930', message = 'Legacy Stage allowlist cutoff proof is invalid';
  end if;

  if exists (
    select 1 from public.poker_tables tables
     where tables.id = any(p_batch_table_ids)
       and (tables.status::text <> 'CLOSED' or tables.has_human_participant is not false or tables.bot_only_proof_eligible is true)
  ) or (select count(*) from public.poker_tables tables where tables.id = any(p_batch_table_ids)) <> pg_catalog.cardinality(p_batch_table_ids) then
    raise exception using errcode = 'P8930', message = 'Legacy Stage allowlist table lifecycle proof is invalid';
  end if;
  if exists (
    select 1 from public.chips_accounts accounts
     where accounts.account_type::text = 'ESCROW'
       and accounts.system_key = any(select 'POKER_TABLE:' || ids.id::text from pg_catalog.unnest(p_batch_table_ids) as ids(id))
     group by accounts.system_key
    having count(*) <> 1 or bool_and(accounts.status::text = 'active') is not true or bool_and(accounts.balance = 0) is not true
  ) or (select count(*) from public.chips_accounts accounts
          where accounts.account_type::text = 'ESCROW'
            and accounts.system_key = any(select 'POKER_TABLE:' || ids.id::text from pg_catalog.unnest(p_batch_table_ids) as ids(id))) <> pg_catalog.cardinality(p_batch_table_ids) then
    raise exception using errcode = 'P8930', message = 'Legacy Stage allowlist escrow proof is invalid';
  end if;

  return pg_catalog.jsonb_build_object(
    'state', 'legacy_allowlist_complete',
    'table_count', pg_catalog.cardinality(p_batch_table_ids),
    'transaction_count', transaction_count,
    'entry_count', entry_count,
    'newest_created_at', newest_created_at,
    'allowlist_sha256', p_allowlist_sha256,
    'batch_table_ids_sha256', p_batch_table_ids_sha256
  );
end;
$$;

reset role;

alter function public.chips_assert_legacy_stage_allowlist_batch(
  text, uuid[], bigint[], uuid[], uuid[], text, text, bigint, bigint, text, text, text, timestamptz
) owner to chips_ledger_archive_pruner;
alter function public.chips_register_legacy_stage_allowlist_proof(
  text, uuid[], bigint[], uuid[], uuid[], text, text, bigint, bigint, text, text, text, timestamptz
) owner to chips_ledger_archive_pruner;
alter function public.chips_prune_legacy_stage_allowlist_batch(
  text, uuid[], bigint[], uuid[], text, text, boolean, bigint
) owner to chips_ledger_archive_pruner;
alter function public.chips_authorize_legacy_stage_allowlist_batch(bigint, text, text) owner to postgres;
alter function public.chips_prune_committed_archive_batch(text, uuid[], bigint[], boolean)
  owner to chips_ledger_archive_pruner;

revoke all on function public.chips_assert_legacy_stage_allowlist_batch(
  text, uuid[], bigint[], uuid[], uuid[], text, text, bigint, bigint, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.chips_register_legacy_stage_allowlist_proof(
  text, uuid[], bigint[], uuid[], uuid[], text, text, bigint, bigint, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.chips_prune_legacy_stage_allowlist_batch(
  text, uuid[], bigint[], uuid[], text, text, boolean, bigint
) from public, anon, authenticated, service_role;
revoke all on function public.chips_authorize_legacy_stage_allowlist_batch(bigint, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.chips_prune_committed_archive_batch(text, uuid[], bigint[], boolean)
  from public, anon, authenticated, service_role;

grant execute on function public.chips_assert_legacy_stage_allowlist_batch(
  text, uuid[], bigint[], uuid[], uuid[], text, text, bigint, bigint, text, text, text, timestamptz
) to chips_ledger_archive_pruner;
grant execute on function public.chips_register_legacy_stage_allowlist_proof(
  text, uuid[], bigint[], uuid[], uuid[], text, text, bigint, bigint, text, text, text, timestamptz
) to postgres;
grant execute on function public.chips_prune_legacy_stage_allowlist_batch(
  text, uuid[], bigint[], uuid[], text, text, boolean, bigint
) to postgres;
grant execute on function public.chips_authorize_legacy_stage_allowlist_batch(bigint, text, text)
  to postgres;
grant execute on function public.chips_prune_committed_archive_batch(text, uuid[], bigint[], boolean)
  to postgres;

reset role;
revoke create on schema public from chips_ledger_archive_pruner;
revoke chips_ledger_archive_pruner from postgres;

commit;
