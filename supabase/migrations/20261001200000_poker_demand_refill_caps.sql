-- T101: Add demand-driven hourly refill caps to poker_bot_tier_policy (§32)
--
-- Adds nullable NORMAL/SLOW hourly cap columns.
--   NULL = Unlimited fresh refill liquidity for that UTC hour.
--   positive bigint = maximum total CH that may be newly MINTed per UTC hour.
--
-- Drops the old one-refill-per-pool/hour unique index and replaces it
-- with a non-unique lookup index supporting multiple demand refills per hour.
--
-- Initializes NORMAL cap to NULL (Unlimited) and SLOW cap to the current
-- slow_refill_amount_ch value (preserving current single-chunk economics).
--
-- Stage migration. Production equivalent prepared separately.
-- Forward-only: applied schema cannot be rolled back.

-- 1. Add nullable hourly cap columns
alter table public.poker_bot_tier_policy
  add column if not exists normal_hourly_refill_cap_ch bigint null,
  add column if not exists slow_hourly_refill_cap_ch bigint null;

-- 2. Constraint: caps must be NULL (Unlimited) or positive safe integer
-- Allows NULL so 'do nothing' preserves existing rows.
alter table public.poker_bot_tier_policy
  drop constraint if exists poker_bot_tier_policy_cap_values_chk;
alter table public.poker_bot_tier_policy
  add constraint poker_bot_tier_policy_cap_values_chk check (
    (normal_hourly_refill_cap_ch is null or (normal_hourly_refill_cap_ch > 0 and normal_hourly_refill_cap_ch <= 9007199254740991))
    and
    (slow_hourly_refill_cap_ch is null or (slow_hourly_refill_cap_ch > 0 and slow_hourly_refill_cap_ch <= 9007199254740991))
  );

-- 3. Seed NORMAL cap = NULL (Unlimited), SLOW cap = current slow_refill_amount_ch
-- for all existing tiers. NULL is already the default for new rows.
update public.poker_bot_tier_policy
set normal_hourly_refill_cap_ch = null,
    slow_hourly_refill_cap_ch = slow_refill_amount_ch
where slow_hourly_refill_cap_ch is null;

-- 4. Drop the old one-refill-per-pool/hour unique index.
-- §32: "The current unique index chips_transactions_poker_pool_bucket_uidx
-- (one refill per pool/hour) is incompatible with the new model and must be replaced."
drop index if exists public.chips_transactions_poker_pool_bucket_uidx;

-- 5. Add a non-unique lookup index for purpose + pool + bucket.
-- Supports bounded aggregate lookup for hourly cap accounting.
create index if not exists chips_transactions_poker_pool_refill_lookup_idx
  on public.chips_transactions (
    (metadata ->> 'bankrollSystemKey'),
    (metadata ->> 'bucket')
  )
  where metadata ->> 'purpose' = 'poker_pool_refill'
    and nullif(metadata ->> 'bankrollSystemKey', '') is not null
    and nullif(metadata ->> 'bucket', '') is not null;
