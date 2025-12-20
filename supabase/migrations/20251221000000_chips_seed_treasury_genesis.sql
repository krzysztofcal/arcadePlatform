-- Bootstrap the chips treasury with an idempotent genesis transaction.
-- Uses a fixed idempotency key so repeated migrations do not mint twice.

create extension if not exists "pgcrypto";

-- Ensure required system accounts exist
insert into public.chips_accounts (account_type, system_key, status, balance, next_entry_seq)
select 'SYSTEM', 'GENESIS', 'active', 0, 1
where not exists (
  select 1 from public.chips_accounts where system_key = 'GENESIS'
);

insert into public.chips_accounts (account_type, system_key, status, balance, next_entry_seq)
select 'SYSTEM', 'TREASURY', 'active', 0, 1
where not exists (
  select 1 from public.chips_accounts where system_key = 'TREASURY'
);

do $$
declare
  seed_amount bigint := 1000000; -- adjust as needed for production bankroll
  seed_key text := 'seed:treasury:v1';
  treas_id uuid;
  genesis_id uuid;
  existing_tx uuid;
  payload_hash text;
begin
  select id into treas_id from public.chips_accounts where system_key = 'TREASURY' limit 1;
  select id into genesis_id from public.chips_accounts where system_key = 'GENESIS' limit 1;
  select id into existing_tx from public.chips_transactions where idempotency_key = seed_key limit 1;

  if existing_tx is not null then
    return;
  end if;

  if treas_id is null or genesis_id is null then
    raise exception 'Missing system accounts for treasury seed';
  end if;

  -- Ensure the GENESIS account can cover the transfer (no negative balances allowed)
  update public.chips_accounts
  set balance = seed_amount,
      updated_at = timezone('utc', now())
  where id = genesis_id and balance < seed_amount;

  -- Lock rows to keep balance/apply consistent during seed transaction
  perform 1 from public.chips_accounts where id in (treas_id, genesis_id) for update;

  payload_hash := encode(digest(seed_key || ':' || seed_amount::text, 'sha256'), 'hex');

  insert into public.chips_transactions (
    reference,
    description,
    metadata,
    idempotency_key,
    payload_hash,
    tx_type,
    created_by
  ) values (
    'TREASURY_SEED',
    'Initial treasury funding',
    jsonb_build_object('source', 'GENESIS'),
    seed_key,
    payload_hash,
    'MINT',
    null
  ) returning id into existing_tx;

  -- Apply balances
  update public.chips_accounts
  set balance = balance - seed_amount,
      updated_at = timezone('utc', now())
  where id = genesis_id;

  update public.chips_accounts
  set balance = balance + seed_amount,
      updated_at = timezone('utc', now())
  where id = treas_id;

  -- Ledger entries (balanced, append-only)
  insert into public.chips_entries (transaction_id, account_id, amount, metadata)
  values
    (existing_tx, genesis_id, -seed_amount, jsonb_build_object('source', 'TREASURY_SEED')),
    (existing_tx, treas_id, seed_amount, jsonb_build_object('source', 'TREASURY_SEED'));
end $$;
