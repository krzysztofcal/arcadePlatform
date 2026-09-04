begin;

-- #923 closed-human selector now narrows to authoritative CLOSED human tables
-- first (only 5 on Stage) and reads chips_transaction_idempotency for those
-- table_ids.  This index supports that exact access path: candidate table_id
-- join + TABLE_BUY_IN/TABLE_CASH_OUT filter.  The previous bot-only candidate
-- selector index is intentionally not reused; this is a different, highly
-- selective access pattern.
set local statement_timeout = '600000';
set local maintenance_work_mem = '128MB';
create index if not exists chips_transaction_idempotency_closed_human_access_idx
  on public.chips_transaction_idempotency (table_id, tx_type, transaction_created_at);

commit;
