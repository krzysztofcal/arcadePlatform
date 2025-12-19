-- Enforce idempotency keys are unique to prevent duplicate transactions under race conditions.
create unique index if not exists chips_transactions_idempotency_key_uidx
on public.chips_transactions (idempotency_key);
