-- Create and seed the bounded bankroll used only by 500 CH poker bots.
-- This is a one-time, idempotent SYSTEM allocation from GENESIS.

insert into public.chips_accounts (account_type, system_key, status, balance, next_entry_seq)
select 'SYSTEM', 'POKER_BOT_BANKROLL', 'active', 0, 1
where not exists (
  select 1 from public.chips_accounts
  where account_type = 'SYSTEM' and system_key = 'POKER_BOT_BANKROLL'
);

do $$
declare
  seed_amount bigint := 1000000;
  seed_key text := 'seed:poker-bot-bankroll:v1';
  tx_id uuid;
  genesis_id uuid;
  genesis_status text;
  bankroll_id uuid;
  bankroll_status text;
  applied_count int := 0;
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
    'POKER_BOT_BANKROLL_SEED',
    'Initial bounded bankroll for 500 CH poker bots',
    jsonb_build_object('source', 'GENESIS', 'purpose', 'POKER_BOT_BANKROLL_SEED', 'amount', seed_amount),
    seed_key,
    encode(extensions.digest((seed_key || ':' || seed_amount::text)::text, 'sha256'), 'hex'),
    'MINT',
    null
  )
  on conflict (idempotency_key) do nothing
  returning id into tx_id;

  if tx_id is null then
    return;
  end if;

  select id, status
    into genesis_id, genesis_status
    from public.chips_accounts
    where account_type = 'SYSTEM' and system_key = 'GENESIS'
    for update;

  select id, status
    into bankroll_id, bankroll_status
    from public.chips_accounts
    where account_type = 'SYSTEM' and system_key = 'POKER_BOT_BANKROLL'
    for update;

  if genesis_id is null or bankroll_id is null then
    raise exception 'system_account_missing' using errcode = 'P0001';
  end if;
  if genesis_status <> 'active' or bankroll_status <> 'active' then
    raise exception 'system_account_inactive' using errcode = 'P0001';
  end if;

  with raw_entries as (
    select tx_id as transaction_id, genesis_id as account_id, (-seed_amount)::bigint as amount,
           jsonb_build_object('source', 'GENESIS', 'purpose', 'POKER_BOT_BANKROLL_SEED') as metadata
    union all
    select tx_id, bankroll_id, (seed_amount)::bigint,
           jsonb_build_object('source', 'GENESIS', 'purpose', 'POKER_BOT_BANKROLL_SEED')
  ),
  deltas as (
    select account_id, sum(amount)::bigint as delta
    from raw_entries
    group by account_id
  ),
  locked as (
    select a.id
    from public.chips_accounts a
    join deltas d on d.account_id = a.id
    for update
  ),
  apply_balance as (
    update public.chips_accounts a
      set balance = a.balance + d.delta,
          updated_at = now_ts
      from deltas d
      where a.id = d.account_id
        and exists (select 1 from locked l where l.id = a.id)
      returning a.id
  )
  select count(*) into applied_count from apply_balance;

  if applied_count <> 2 then
    raise exception 'seed_balance_invariant_failed' using errcode = 'P0001';
  end if;

  with raw_entries as (
    select tx_id as transaction_id, genesis_id as account_id, (-seed_amount)::bigint as amount,
           jsonb_build_object('source', 'GENESIS', 'purpose', 'POKER_BOT_BANKROLL_SEED') as metadata
    union all
    select tx_id, bankroll_id, (seed_amount)::bigint,
           jsonb_build_object('source', 'GENESIS', 'purpose', 'POKER_BOT_BANKROLL_SEED')
  ),
  inserted_entries as (
    insert into public.chips_entries (transaction_id, account_id, amount, metadata)
    select transaction_id, account_id, amount, metadata
    from raw_entries
    returning 1
  )
  select count(*) into entries_count from inserted_entries;

  if entries_count <> 2 then
    raise exception 'seed_entries_invariant_failed' using errcode = 'P0001';
  end if;
end $$;
