-- Bootstrap the chips treasury with an idempotent genesis transaction.
-- Invariant-safe: applies balances via the same guarded ledger shape as runtime posting
-- and never edits balances directly.

create extension if not exists "pgcrypto";

-- Ensure required system accounts exist with the correct type and status
insert into public.chips_accounts (account_type, system_key, status, balance, next_entry_seq)
select 'SYSTEM', 'GENESIS', 'active', 0, 1
where not exists (
  select 1 from public.chips_accounts where account_type = 'SYSTEM' and system_key = 'GENESIS'
);

insert into public.chips_accounts (account_type, system_key, status, balance, next_entry_seq)
select 'SYSTEM', 'TREASURY', 'active', 0, 1
where not exists (
  select 1 from public.chips_accounts where account_type = 'SYSTEM' and system_key = 'TREASURY'
);

do $$
declare
  seed_amount bigint := 1000000; -- adjust as needed for production bankroll
  seed_key text := 'seed:treasury:v1';
  tx_id uuid;
  genesis_id uuid;
  genesis_status text;
  genesis_balance bigint;
  treasury_id uuid;
  treasury_status text;
  treasury_balance bigint;
  entries_count int := 0;
  now_ts timestamptz := timezone('utc', now());
begin
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
    encode(digest(seed_key || ':' || seed_amount::text, 'sha256'), 'hex'),
    'MINT',
    null
  )
  on conflict (idempotency_key) do nothing
  returning id
  into tx_id;

  if tx_id is null then
    return;
  end if;

  select id, status, balance into genesis_id, genesis_status, genesis_balance
  from public.chips_accounts
  where account_type = 'SYSTEM' and system_key = 'GENESIS'
  for update;

  select id, status, balance into treasury_id, treasury_status, treasury_balance
  from public.chips_accounts
  where account_type = 'SYSTEM' and system_key = 'TREASURY'
  for update;

  if genesis_id is null or treasury_id is null then
    raise exception 'system_account_missing' using errcode = 'P0001';
  end if;

  if genesis_status <> 'active' or treasury_status <> 'active' then
    raise exception 'system_account_inactive' using errcode = 'P0001';
  end if;

  if treasury_balance + seed_amount < 0 then
    raise exception 'insufficient_funds' using errcode = 'P0001';
  end if;

  update public.chips_accounts
  set balance = balance - seed_amount,
      updated_at = now_ts
  where id = genesis_id;

  update public.chips_accounts
  set balance = balance + seed_amount,
      updated_at = now_ts
  where id = treasury_id;

  with inserted_entries as (
    insert into public.chips_entries (transaction_id, account_id, amount, metadata)
    values
      (tx_id, genesis_id, -seed_amount, jsonb_build_object('source', 'TREASURY_SEED')),
      (tx_id, treasury_id, seed_amount, jsonb_build_object('source', 'TREASURY_SEED'))
    returning 1
  )
  select count(*) into entries_count from inserted_entries;

  if entries_count <> 2 then
    raise exception 'seed_entries_invariant_failed' using errcode = 'P0001';
  end if;
end $$;
