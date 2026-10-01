-- #1018 §28: Canonical poker bot tier catalog expansion (>500 buy-in tiers).
-- Forward-only migration adding disabled tier policies and zero-balance exact pools.
-- Zero MINT, zero ledger mutation, all new tiers start disabled.

insert into public.poker_bot_tier_policy (
  buy_in, enabled, normal_refill_threshold_ch, normal_refill_amount_ch,
  slow_refill_threshold_ch, slow_refill_amount_ch
)
values
  (1000, false, 10000, 20000, 4000, 10000),
  (5000, false, 50000, 100000, 20000, 50000),
  (10000, false, 100000, 200000, 40000, 100000),
  (50000, false, 500000, 1000000, 200000, 500000),
  (100000, false, 1000000, 2000000, 400000, 1000000),
  (500000, false, 5000000, 10000000, 2000000, 5000000),
  (1000000, false, 10000000, 20000000, 4000000, 10000000),
  (5000000, false, 50000000, 100000000, 20000000, 50000000),
  (10000000, false, 100000000, 200000000, 40000000, 100000000)
on conflict (buy_in) do nothing;

insert into public.chips_accounts (account_type, system_key, status, balance)
values
  ('SYSTEM', 'POKER_BOT_BANKROLL_1000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_1000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_BANKROLL_5000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_5000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_BANKROLL_10000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_10000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_BANKROLL_50000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_50000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_BANKROLL_100000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_100000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_BANKROLL_500000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_500000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_BANKROLL_1000000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_1000000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_BANKROLL_5000000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_5000000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_BANKROLL_10000000', 'active', 0),
  ('SYSTEM', 'POKER_BOT_SLOW_BANKROLL_10000000', 'active', 0)
on conflict do nothing;
