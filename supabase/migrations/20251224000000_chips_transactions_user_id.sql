-- Add user_id to chips_transactions for idempotency ownership checks.
alter table public.chips_transactions
  add column if not exists user_id uuid;

create index if not exists chips_transactions_user_id_idx
  on public.chips_transactions(user_id);
