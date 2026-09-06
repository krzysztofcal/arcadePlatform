begin;

-- Forward-only access path for the scoped bot-only proof lifecycle gate.
-- Both NULL and non-NULL table identities are evidence-bearing branches.
set local statement_timeout = '600000';
set local maintenance_work_mem = '128MB';

create index if not exists chips_transaction_idempotency_transaction_id_table_id_idx
  on public.chips_transaction_idempotency (transaction_id, table_id);

commit;
