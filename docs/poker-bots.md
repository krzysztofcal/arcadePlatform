# Poker Bots runtime notes

## Current status

Poker bots are implemented in the current runtime.

- Runtime modules:
  - `netlify/functions/_shared/poker-bots.mjs`
  - `netlify/functions/_shared/poker-bot-cashout.mjs`
  - `shared/poker-domain/bots.mjs` (neutral join/bot-seed helper used by WS authoritative join flows)
- Runtime integration points:
  - `shared/poker-domain/join.mjs` (neutral authoritative join + bot seed core shared by the WS gameplay runtime and any temporary legacy/admin adapters)
  - `ws-server/server.mjs` (active WS gameplay, timeout, autoplay, and disconnect cleanup lifecycle owner)
- Behavior coverage is maintained in WS runtime behavior suites and guard tests.

## Runtime behavior summary

- Seating (seeding):
  - Bot seeding is guarded by `POKER_BOTS_ENABLED` and runtime config in `getBotConfig`.
  - Seeding requires at least one active human at the table.
  - Max bots per table is enforced by `POKER_BOTS_MAX_PER_TABLE` (default `2`) and seat-capacity logic keeps at least one seat available for humans.
- Autoplay:
  - Bots act automatically when it is a bot turn, using runtime helpers (`isBotTurn`, `chooseBotActionTrivial`) and bounded action limits (`POKER_BOTS_MAX_ACTIONS_PER_REQUEST` / poll limits).
  - Browser gameplay writes stay WS-authoritative for join, leave, start-hand, and act.
  - Legacy HTTP gameplay handlers (`poker-join`, `poker-start-hand`, `poker-act`, `poker-leave`, `poker-sweep`) are retired and return `410`.
  - Behavior is server-side in WS runtime (authoritative state transitions; no client bot script).
- Cash-out / sweep:
  - Bot chip movements use the same ledger primitives as seat flows: `TABLE_BUY_IN` into table escrow and `TABLE_CASH_OUT` from escrow.
  - Sweep/timeout and close flows may force bot seat inactive and cash out via bot cash-out helper logic.
- Bot cash-out/eviction actions require `POKER_SYSTEM_ACTOR_USER_ID` to be configured as a valid UUID; if missing/invalid, leave-after-hand and other bot cash-out paths fail closed (skip) for actor safety.

## Persisted seat fields used by bot flows

Seat snapshots include bot-specific fields that are persisted and returned by table APIs:

- `is_bot`: marks bot vs human seat.
- `bot_profile`: bot profile label (default from `POKER_BOT_PROFILE_DEFAULT`, e.g. `TRIVIAL`).
- `leave_after_hand`: flag to let a bot leave after the current hand so human join capacity can be restored.

## Funds safety alignment

Bots follow the same funds safety model as human seats:

- buy-in uses `TABLE_BUY_IN` into table escrow,
- cash-out uses `TABLE_CASH_OUT` out of escrow,
- timeout/cleanup paths are responsible for returning chips from escrow and avoiding stranded balances.

## Scope and TBDs

This document reflects current implemented runtime behavior in this repository. Any future policy/profile expansion should be documented only after code/tests land.
