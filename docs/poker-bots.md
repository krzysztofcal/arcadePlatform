# Poker Bots runtime notes

## Current status

Poker bots are implemented in the current runtime.

- Runtime modules:
  - `netlify/functions/_shared/poker-bots.mjs`
  - `shared/poker-domain/bots.mjs` (neutral join/bot-seed helper used by WS authoritative join flows)
  - `shared/poker-domain/terminal-close.mjs` (terminal human/bot accounting and proven SYSTEM-source cash-out)
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
- Contextual reactions:
  - Reactions observe only freshly committed joins, actions, settlements, targeted congratulations, and existing turn timestamps. They are fire-and-forget UX and cannot change legal actions, turn deadlines, timeout handling, settlement, stacks, pots, seats, autoplay, persistence, or table lifecycle.
  - The runtime may emit `you_are_bluffing` after a post-flop raise (60%), `not_this_time` after the speaking bot's accepted fold (70%), `i_was_bluffing` after a bot wins by normal folds (75%), `nice_bluff` after another player wins by normal folds (75% fallback), `nice_hand` for a shown winning three-of-a-kind or better (90%), `wow` for a bot payout of at least 20 big blinds (100%), and either `well_played` or `congrats` after another win (one 80% roll). Accepted bot `BET` and `ALL_IN` actions use a 60% base chance for their existing reaction pool.
  - One aggregate `lucky` classifier may target a winner (70%) when authoritative shown-hand rank vectors are unusually close, the same category is decided by a kicker, or a read-only turn-board comparison shows that the river changed the winner. Multiple matching signals still cause only one probability roll.
  - A bot may answer a successfully broadcast targeted `nice_hand` with `thanks` (80%), answer a successfully broadcast human `hello` once with `hello` (60%, without reaction chains), greet a newly joined human with `hello` or `good_luck` (100%), or emit `hurry_up` after observing 80% of an unchanged human turn window (80%).
  - During an active hand, `you_are_bluffing` and ambient table talk require a bot that is still participating and has not folded, left, or sat out both when selected and after presentation jitter. `not_this_time` remains allowed as the immediate response to the bot's own accepted fold.
  - Once per hand, one 50% ambient roll may select an eligible bot and one neutral table-talk message. Ambient state is process-local and cleared with table runtime resources.
  - Admin → Ops exposes process-local `enabled` and 1–100% frequency controls for WS Preview. Frequency scales every base probability; disabling reactions also suppresses pending bot broadcasts without changing gameplay.
  - `you_are_bluffing`, `i_was_bluffing`, `lucky`, `congrats`, `not_this_time`, and all `ambient_*` messages are bot-only keys. Humans retain the existing reaction menu, including `nice_bluff`, `cheers`, `gg`, and `hurry_up`.
  - Contextual reactions use an independent four-second sender cooldown and at most one pending reaction timer per bot. Different bots at one table may react concurrently. Reactions retain bounded 300–1200 ms presentation jitter; observer or timer failure is logged and otherwise ignored.
- Cash-out / terminal close:
  - Bot chip movements use the same ledger primitives as seat flows: `TABLE_BUY_IN` into table escrow and `TABLE_CASH_OUT` from escrow.
  - Terminal inactive cleanup and admin force-close share one transactional close helper.
  - Positive final bot stacks return to the exact SYSTEM account proven by seed/replacement ledger lineage; no bot UUID is credited through a USER account.
  - Missing or mixed provenance and claims/escrow mismatches fail closed as `terminal_accounting_invariant_failed` without accounting or lifecycle mutation.
  - A successful terminal close cashes out all authoritative claims, verifies escrow is zero, clears state/seats, and closes the table in one database transaction.

## Browser presentation identity

- `poker/poker-v2.js` deterministically maps each occupied bot seat to one local presentation catalog entry. A table-ID hash rotates the catalog and unique `seatNo` values select distinct entries within that rotation.
- Each entry atomically pairs an owner-approved display name, explicit `male` or `female` presentation metadata, and the matching same-gender WebP asset.
- Presentation gender is local validation metadata only. It is not displayed, logged, persisted, or added to the WS contract.
- Bot names and avatars are not derived from `bot_profile`; betting policy and presentation identity remain independent.
- The assignment is stateless and collision-free within the supported table capacity: reconnects, late observers, and authoritative restores derive the same result, while removing another bot does not rename remaining seats.
- Images load from `/poker/assets/avatars/bots/` under the existing same-origin CSP policy. A failed image keeps the selected bot name and falls back to initials derived from that name.
- Human public-profile avatars, guests, snapshots, poker persistence, and server runtime remain unchanged.
- Authenticated Poker V2 users can locally hide reaction bubbles, reaction history, or bot reactions. These browser-only preferences are best-effort, user-scoped, and do not alter server reaction generation or gameplay; guest sessions always use in-memory defaults.

## Persisted seat fields used by bot flows

Seat snapshots include bot-specific fields that are persisted and returned by table APIs:

- `is_bot`: marks bot vs human seat.
- `bot_profile`: bot profile label (default from `POKER_BOT_PROFILE_DEFAULT`, e.g. `TRIVIAL`).
- `leave_after_hand`: flag to let a bot leave after the current hand so human join capacity can be restored.

## Funds safety alignment

Bots follow the same funds safety model as human seats:

- buy-in uses `TABLE_BUY_IN` into table escrow,
- 100 CH bot seed/replacement funding uses the currently configured legacy bot `SYSTEM` source (default `TREASURY`), while 500 CH funding uses the fixed `POKER_BOT_BANKROLL` SYSTEM account,
- a broke bot replacement preserves the old residual stack and funds only the delta to the table buy-in into table `ESCROW`,
- 500 CH bot funding is bounded by the one-time `1,000,000 CH` `POKER_BOT_BANKROLL` allocation; exhaustion never falls back to `TREASURY` or mints more chips,
- replacement funding and the poker-state CAS commit in one database transaction before the replacement becomes visible in WS runtime,
- replacement retries reuse a deterministic table/version/seat idempotency key and cannot create a second ledger credit after restore,
- cash-out uses `TABLE_CASH_OUT` out of escrow,
- terminal cash-out resolves the actual SYSTEM destination from immutable funding entries, including residual replacement lineage,
- terminal cleanup requires authoritative claims to equal locked escrow and verifies escrow reaches zero before the close commits.

Historical escrow reconciliation remains separate lifecycle work under #707; terminal close does not remediate older closed tables.

## Scope and TBDs

This document reflects current implemented runtime behavior in this repository. Any future policy/profile expansion should be documented only after code/tests land.
