-- The registry trigger is installed by 20260811170000. Fill any transaction
-- rows that could have been committed between that migration's backfill
-- snapshot and trigger creation, then verify the complete parity contract.
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
from public.chips_transactions t
where not exists (
  select 1
  from public.chips_transaction_idempotency r
  where r.idempotency_key = t.idempotency_key
)
on conflict (idempotency_key) do nothing;

-- Rows captured by the trigger during the same rollout can be identity
-- complete but still lack the immutable replay snapshot. Complete them once.
update public.chips_transaction_idempotency r
set
  replay_transaction = to_jsonb(t),
  replay_entries = (
    select coalesce(jsonb_agg(to_jsonb(e) order by e.entry_seq), '[]'::jsonb)
    from public.chips_entries e
    where e.transaction_id = t.id
  ),
  replay_completed_at = t.created_at
from public.chips_transactions t
where r.transaction_id = t.id
  and t.tx_type::text in ('BUY_IN', 'CASH_OUT', 'WELCOME_BONUS', 'PROMO_BONUS', 'ADMIN_ADJUST')
  and r.replay_transaction is null
  and r.replay_entries is null
  and r.replay_completed_at is null;

do $$
declare
  mismatch_count bigint;
  orphan_count bigint;
  incomplete_transaction_count bigint;
  incomplete_count bigint;
begin
  select count(*)
    into mismatch_count
    from public.chips_transactions t
    left join public.chips_transaction_idempotency r
      on r.idempotency_key = t.idempotency_key
   where r.idempotency_key is null
      or r.transaction_id is distinct from t.id
      or r.payload_hash is distinct from t.payload_hash
      or r.tx_type is distinct from t.tx_type
      or r.user_id is distinct from t.user_id
      or r.transaction_created_at is distinct from t.created_at;

  if mismatch_count <> 0 then
    raise exception 'chips idempotency gap backfill found % transaction identity mismatches', mismatch_count;
  end if;

  select count(*)
    into orphan_count
    from public.chips_transaction_idempotency r
    left join public.chips_transactions t on t.id = r.transaction_id
   where t.id is null;

  if orphan_count <> 0 then
    raise exception 'chips idempotency gap backfill found % orphan registry rows', orphan_count;
  end if;

  select count(*)
    into incomplete_transaction_count
    from (
      select t.id
      from public.chips_transactions t
      left join public.chips_entries e on e.transaction_id = t.id
     where t.tx_type::text in ('BUY_IN', 'CASH_OUT', 'WELCOME_BONUS', 'PROMO_BONUS', 'ADMIN_ADJUST')
     group by t.id
     having count(e.id) = 0 or coalesce(sum(e.amount), 0) <> 0
    ) incomplete;

  if incomplete_transaction_count <> 0 then
    raise exception 'chips idempotency gap backfill found % incomplete full-replay transactions', incomplete_transaction_count;
  end if;

  select count(*)
    into incomplete_count
    from public.chips_transactions t
    join public.chips_transaction_idempotency r
      on r.idempotency_key = t.idempotency_key
   where t.tx_type::text in ('BUY_IN', 'CASH_OUT', 'WELCOME_BONUS', 'PROMO_BONUS', 'ADMIN_ADJUST')
     and (
       r.replay_transaction is null
       or r.replay_entries is null
       or r.replay_completed_at is null
     );

  if incomplete_count <> 0 then
    raise exception 'chips idempotency gap backfill found % incomplete full-replay rows', incomplete_count;
  end if;
end;
$$;
