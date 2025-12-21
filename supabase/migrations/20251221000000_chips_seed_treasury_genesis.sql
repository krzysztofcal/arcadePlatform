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
  treasury_id uuid;
  treasury_status text;
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

  select id, status
  into genesis_id, genesis_status
  from public.chips_accounts
  where account_type = 'SYSTEM' and system_key = 'GENESIS'
  for update;

  select id, status
  into treasury_id, treasury_status
  from public.chips_accounts
  where account_type = 'SYSTEM' and system_key = 'TREASURY'
  for update;

  if genesis_id is null or treasury_id is null then
    raise exception 'system_account_missing' using errcode = 'P0001';
  end if;

  if genesis_status <> 'active' or treasury_status <> 'active' then
    raise exception 'system_account_inactive' using errcode = 'P0001';
  end if;

  if seed_amount is null or seed_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;

  with raw_entries as (
    select tx_id as transaction_id, genesis_id as account_id, (-seed_amount)::bigint as amount,
           jsonb_build_object('source', 'TREASURY_SEED') as metadata
    union all
    select tx_id, treasury_id, (seed_amount)::bigint, jsonb_build_object('source', 'TREASURY_SEED')
  ),
  deltas as (
    select account_id, sum(amount)::bigint as delta
    from raw_entries
    group by account_id
  ),
  apply_balance as (
    update public.chips_accounts a
    set balance = a.balance + d.delta,
        updated_at = now_ts
    from deltas d
    where a.id = d.account_id
    returning a.id
  ),
  inserted_entries as (
    insert into public.chips_entries (transaction_id, account_id, amount, metadata)
    select r.transaction_id, r.account_id, r.amount, r.metadata
    from raw_entries r
    join apply_balance ab on ab.id = r.account_id
    returning 1
  )
  select count(*) into entries_count from inserted_entries;

  if entries_count <> 2 then
    raise exception 'seed_entries_invariant_failed' using errcode = 'P0001';
  end if;
end $$;
