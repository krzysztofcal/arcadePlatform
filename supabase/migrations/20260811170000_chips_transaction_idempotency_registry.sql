create table public.chips_transaction_idempotency (
  idempotency_key text primary key,
  transaction_id uuid not null,
  payload_hash text not null,
  tx_type public.chips_tx_type not null,
  user_id uuid,
  transaction_created_at timestamptz not null,
  replay_transaction jsonb,
  replay_entries jsonb,
  replay_completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint chips_transaction_idempotency_key_check
    check (length(trim(idempotency_key)) > 0),
  constraint chips_transaction_idempotency_payload_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint chips_transaction_idempotency_replay_types_check
    check (
      (replay_transaction is null or jsonb_typeof(replay_transaction) = 'object')
      and (replay_entries is null or jsonb_typeof(replay_entries) = 'array')
    ),
  constraint chips_transaction_idempotency_replay_state_check
    check (
      (replay_transaction is null and replay_entries is null and replay_completed_at is null)
      or (
        replay_transaction is not null
        and replay_entries is not null
        and replay_completed_at is not null
      )
    )
);

do $$
declare
  incomplete_count bigint;
begin
  select count(*)
    into incomplete_count
    from (
      select t.id
      from public.chips_transactions t
      left join public.chips_entries e on e.transaction_id = t.id
      where t.tx_type::text in ('BUY_IN', 'CASH_OUT', 'WELCOME_BONUS', 'PROMO_BONUS', 'ADMIN_ADJUST')
      group by t.id
      having count(e.id) = 0 or coalesce(sum(e.amount), 0) <> 0
    ) incomplete;

  if incomplete_count <> 0 then
    raise exception 'chips idempotency backfill found % incomplete full-replay transactions', incomplete_count;
  end if;
end;
$$;

insert into public.chips_transaction_idempotency (
  idempotency_key,
  transaction_id,
  payload_hash,
  tx_type,
  user_id,
  transaction_created_at,
  replay_transaction,
  replay_entries,
  replay_completed_at
)
select
  t.idempotency_key,
  t.id,
  t.payload_hash,
  t.tx_type,
  t.user_id,
  t.created_at,
  case when t.tx_type::text in ('BUY_IN', 'CASH_OUT', 'WELCOME_BONUS', 'PROMO_BONUS', 'ADMIN_ADJUST')
    then to_jsonb(t) end,
  case when t.tx_type::text in ('BUY_IN', 'CASH_OUT', 'WELCOME_BONUS', 'PROMO_BONUS', 'ADMIN_ADJUST')
    then (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.entry_seq), '[]'::jsonb)
      from public.chips_entries e
      where e.transaction_id = t.id
    ) end,
  case when t.tx_type::text in ('BUY_IN', 'CASH_OUT', 'WELCOME_BONUS', 'PROMO_BONUS', 'ADMIN_ADJUST')
    then t.created_at end
from public.chips_transactions t;

create or replace function public.chips_capture_transaction_idempotency()
returns trigger
language plpgsql
as $$
begin
  insert into public.chips_transaction_idempotency (
    idempotency_key,
    transaction_id,
    payload_hash,
    tx_type,
    user_id,
    transaction_created_at
  ) values (
    new.idempotency_key,
    new.id,
    new.payload_hash,
    new.tx_type,
    new.user_id,
    new.created_at
  );
  return new;
end;
$$;

create trigger chips_transactions_capture_idempotency
after insert on public.chips_transactions
for each row execute function public.chips_capture_transaction_idempotency();

create or replace function public.chips_guard_idempotency_mutations()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Idempotency registry rows are durable; DELETE is not permitted';
  end if;

  if new.idempotency_key is distinct from old.idempotency_key
    or new.transaction_id is distinct from old.transaction_id
    or new.payload_hash is distinct from old.payload_hash
    or new.tx_type is distinct from old.tx_type
    or new.user_id is distinct from old.user_id
    or new.transaction_created_at is distinct from old.transaction_created_at
    or new.created_at is distinct from old.created_at then
    raise exception 'Idempotency registry identity is immutable';
  end if;

  if old.replay_transaction is not null
    or old.replay_entries is not null
    or old.replay_completed_at is not null then
    if new.replay_transaction is distinct from old.replay_transaction
      or new.replay_entries is distinct from old.replay_entries
      or new.replay_completed_at is distinct from old.replay_completed_at then
      raise exception 'Completed idempotency replay cannot be replaced or cleared';
    end if;
  elsif not (
    new.replay_transaction is null
    and new.replay_entries is null
    and new.replay_completed_at is null
  ) and not (
    new.replay_transaction is not null
    and new.replay_entries is not null
    and new.replay_completed_at is not null
  ) then
    raise exception 'Idempotency replay must transition from empty to complete';
  end if;

  return new;
end;
$$;

create trigger chips_transaction_idempotency_guard
before update or delete on public.chips_transaction_idempotency
for each row execute function public.chips_guard_idempotency_mutations();

alter table public.chips_transaction_idempotency enable row level security;

revoke all on table public.chips_transaction_idempotency from anon, authenticated;
