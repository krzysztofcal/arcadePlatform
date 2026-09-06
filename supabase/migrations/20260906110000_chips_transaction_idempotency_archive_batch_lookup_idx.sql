begin;

-- Forward-only access path for durable archive-batch registry lookups.
set local statement_timeout = '600000';
set local maintenance_work_mem = '128MB';
create index if not exists chips_transaction_idempotency_archive_batch_lookup_idx
  on public.chips_transaction_idempotency (archive_batch_id)
  where archive_batch_id is not null;

commit;
