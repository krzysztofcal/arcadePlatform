-- Stage 2A: remove confirmed redundant ledger indexes.
-- Keep the named UNIQUE constraint as the sole idempotency enforcement.
drop index if exists public.chips_transactions_idempotency_idx;
drop index if exists public.chips_transactions_idempotency_key_uidx;

-- chips_transactions.sequence is retained for compatibility, but its legacy
-- UNIQUE constraint has no runtime/query consumer.
alter table if exists public.chips_transactions
  drop constraint if exists chips_transactions_sequence_key;

-- Covers a standalone index with the legacy name if a deployed schema has one.
drop index if exists public.chips_transactions_sequence_key;
