-- #1119: separate owner-reviewed apply only. No backfill, activation or pruning.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
do $identity$
begin
  if current_user <> 'postgres'
    or current_setting('chips.production_project_ref', true) is distinct from 'otbqfijerkieoxwpxjnm'
    or (select system_identifier::text from pg_catalog.pg_control_system()) is distinct from '7575202818581710058'
    or current_setting('chips.production_lifecycle_receipts_confirmation', true) is distinct from
      'INSTALL PRODUCTION HUMAN LIFECYCLE RECEIPTS otbqfijerkieoxwpxjnm' then
    raise exception 'Production lifecycle receipts require exact owner confirmation and canonical identity';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('chips-ledger-production-automation-v1:otbqfijerkieoxwpxjnm',0)) then
    raise exception 'Production retention advisory lock is busy';
  end if;
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20260914092000')
    or exists(select 1 from supabase_migrations.schema_migrations where version='20261016120000') then
    raise exception 'Lifecycle receipts require E3 applied and their own migration absent';
  end if;
end;
$identity$;

-- No FK to poker_tables: this proof must survive its authorized WS deletion.
create table public.chips_production_human_lifecycle_receipts (
  batch_id bigint primary key references public.chips_ledger_archive_batches(batch_id),
  table_id uuid not null,
  cutoff timestamptz not null,
  marker_at timestamptz not null,
  compressed_sha256 text not null check (compressed_sha256 ~ '^[0-9a-f]{64}$'),
  transaction_ids_sha256 text not null check (transaction_ids_sha256 ~ '^[0-9a-f]{64}$'),
  entry_ids_sha256 text not null check (entry_ids_sha256 ~ '^[0-9a-f]{64}$')
);
alter table public.chips_production_human_lifecycle_receipts owner to postgres;
alter table public.chips_production_human_lifecycle_receipts enable row level security;
alter table public.chips_production_human_lifecycle_receipts force row level security;
revoke all on public.chips_production_human_lifecycle_receipts from public, anon, authenticated, service_role, chips_ledger_archive_pruner;
create policy chips_human_completion_owner_read on public.chips_production_human_lifecycle_receipts for select to postgres using (true);
create policy chips_human_completion_owner_insert on public.chips_production_human_lifecycle_receipts for insert to postgres with check (true);

create function public.chips_guard_production_human_lifecycle_receipt()
returns trigger language plpgsql security invoker set search_path = '' as $guard$
declare batch public.chips_ledger_archive_batches%rowtype; marker timestamptz;
begin
  if tg_op <> 'INSERT' then raise exception 'Production human lifecycle receipts are immutable'; end if;
  if current_user <> 'postgres'
    or (select system_identifier::text from pg_catalog.pg_control_system()) is distinct from '7575202818581710058' then
    raise exception 'Production human lifecycle receipt owner/identity mismatch';
  end if;
  select * into batch from public.chips_ledger_archive_batches where batch_id=new.batch_id for update;
  if not found or batch.project_ref is distinct from 'otbqfijerkieoxwpxjnm'
    or batch.source_policy_id is distinct from 'production-ledger-closed-human-table-retention-30d-v1'
    or batch.status is distinct from 'committed' or batch.committed_at is null or batch.format_version is distinct from 1
    or batch.transaction_count not between 1 and 5000 or batch.entry_count <> batch.transaction_count*2
    or batch.destructive_go_at is null or batch.destructive_go_batch_id is distinct from batch.batch_id
    or batch.archive_proof_verified_at is null or batch.pruned_at is null
    or batch.pruned_transaction_count is distinct from batch.transaction_count
    or batch.pruned_entry_count is distinct from batch.entry_count
    or batch.pruned_transaction_ids_sha256 is distinct from batch.archived_transaction_ids_sha256
    or batch.pruned_entry_ids_sha256 is distinct from batch.archived_entry_ids_sha256
    or batch.registry_cleaned_at is not null or batch.registry_cleaned_key_count is not null or batch.registry_cleaned_keys_sha256 is not null
    or new.cutoff is distinct from batch.cutoff or new.compressed_sha256 is distinct from batch.compressed_sha256
    or new.transaction_ids_sha256 is distinct from batch.archived_transaction_ids_sha256
    or new.entry_ids_sha256 is distinct from batch.archived_entry_ids_sha256 then
    raise exception 'Production human lifecycle receipt batch/proof/GO/prune mismatch';
  end if;
  select human_retention_complete_at into marker from public.poker_tables where id=new.table_id for update;
  if not found or marker is null or new.marker_at is distinct from marker or marker < batch.pruned_at or marker > clock_timestamp() then
    raise exception 'Production human lifecycle receipt requires its exact live marker';
  end if;
  perform public.chips_assert_closed_human_table_lifecycle_gate(new.table_id,new.cutoff,null);
  if (select count(*) from public.chips_transaction_idempotency where archive_batch_id=new.batch_id) <> batch.transaction_count
    or exists(select 1 from public.chips_transaction_idempotency where archive_batch_id=new.batch_id and table_id is distinct from new.table_id) then
    raise exception 'Production human lifecycle receipt retained binding mismatch';
  end if;
  if exists(select 1 from public.chips_transactions t join public.chips_transaction_idempotency r on r.transaction_id=t.id where r.archive_batch_id=new.batch_id)
    or exists(select 1 from public.chips_entries e join public.chips_transaction_idempotency r on r.transaction_id=e.transaction_id where r.archive_batch_id=new.batch_id) then
    raise exception 'Production human lifecycle receipt requires zero hot batch rows';
  end if;
  return new;
end;
$guard$;
alter function public.chips_guard_production_human_lifecycle_receipt() owner to postgres;
revoke all on function public.chips_guard_production_human_lifecycle_receipt() from public, anon, authenticated, service_role, chips_ledger_archive_pruner;
create trigger chips_production_human_lifecycle_receipt_guard before insert or update or delete
  on public.chips_production_human_lifecycle_receipts for each row execute function public.chips_guard_production_human_lifecycle_receipt();
create trigger chips_production_human_lifecycle_receipt_no_truncate before truncate
  on public.chips_production_human_lifecycle_receipts for each statement execute function public.chips_guard_production_human_lifecycle_receipt();

insert into supabase_migrations.schema_migrations(version) values ('20261016120000');
commit;
