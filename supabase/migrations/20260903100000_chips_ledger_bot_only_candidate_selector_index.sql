begin;

-- Bot-only candidate selector first narrows candidate tables from poker_tables +
-- ESCROW state, then reads only registry rows for those tables plus unknown
-- table_id rows.  Without a table_id/tx_type index the optimizer must fall back
-- to a full chips_transaction_idempotency scan on every selector replay.
create index if not exists chips_transaction_idempotency_candidate_selector_idx
  on public.chips_transaction_idempotency (table_id, tx_type, transaction_created_at);

commit;
