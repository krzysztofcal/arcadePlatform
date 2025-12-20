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
begin
  with inserted_tx as (
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
    returning *
  ),
  accounts as (
    select id, system_key, status, balance
    from public.chips_accounts
    where account_type = 'SYSTEM' and system_key in ('GENESIS', 'TREASURY')
  ),
  raw_entries as (
    select it.id as transaction_id, g.id as account_id, -seed_amount as amount, jsonb_build_object('source', 'TREASURY_SEED') as metadata
    from inserted_tx it
    cross join lateral (select id from accounts where system_key = 'GENESIS' limit 1) g
    union all
    select it.id, t.id, seed_amount, jsonb_build_object('source', 'TREASURY_SEED')
    from inserted_tx it
    cross join lateral (select id from accounts where system_key = 'TREASURY' limit 1) t
  ),
  deltas as (
    select account_id, sum(amount)::bigint as delta
    from raw_entries
    group by account_id
  ),
  locked as (
    select a.id, a.balance, a.status, a.system_key
    from public.chips_accounts a
    join deltas d on d.account_id = a.id
    for update
  ),
  guard as (
    select case
      when not exists (select 1 from inserted_tx) then null
      when not exists (select 1 from accounts where system_key = 'GENESIS') then public.raise_insufficient_funds()
      when not exists (select 1 from accounts where system_key = 'TREASURY') then public.raise_insufficient_funds()
      when exists (
        select 1
        from locked l
        join deltas d on d.account_id = l.id
        where l.status <> 'active' or (l.system_key <> 'GENESIS' and (l.balance + d.delta) < 0)
      ) then public.raise_insufficient_funds()
      else 1
    end as ok
  ),
  apply_balance as (
    update public.chips_accounts a
    set balance = a.balance + d.delta,
        updated_at = timezone('utc', now())
    from deltas d
    where a.id = d.account_id
      and exists (select 1 from inserted_tx)
      and exists (select 1 from guard)
    returning 1
  )
  insert into public.chips_entries (transaction_id, account_id, amount, metadata)
  select r.transaction_id, r.account_id, r.amount, r.metadata
  from raw_entries r
  where exists (select 1 from apply_balance)
    and exists (select 1 from guard)
  returning transaction_id
  into tx_id;

  -- If we raced with another migration run, exit quietly
  if tx_id is null then
    return;
  end if;
end $$;
