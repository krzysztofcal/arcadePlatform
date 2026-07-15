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

## Persisted seat fields used by bot flows

Seat snapshots include bot-specific fields that are persisted and returned by table APIs:

- `is_bot`: marks bot vs human seat.
- `bot_profile`: bot profile label (default from `POKER_BOT_PROFILE_DEFAULT`, e.g. `TRIVIAL`).
- `leave_after_hand`: flag to let a bot leave after the current hand so human join capacity can be restored.

## Funds safety alignment

Bots follow the same funds safety model as human seats:

- buy-in uses `TABLE_BUY_IN` into table escrow,
- a broke bot replacement preserves the old residual stack and funds only `100 - oldStack` from the currently configured bot `SYSTEM` source (default `TREASURY`) into the table `ESCROW`,
- replacement funding and the poker-state CAS commit in one database transaction before the replacement becomes visible in WS runtime,
- replacement retries reuse a deterministic table/version/seat idempotency key and cannot create a second ledger credit after restore,
- cash-out uses `TABLE_CASH_OUT` out of escrow,
- terminal cash-out resolves the actual SYSTEM destination from immutable funding entries, including residual replacement lineage,
- terminal cleanup requires authoritative claims to equal locked escrow and verifies escrow reaches zero before the close commits.

Historical escrow reconciliation remains separate lifecycle work under #707; terminal close does not remediate older closed tables.

## Scope and TBDs

This document reflects current implemented runtime behavior in this repository. Any future policy/profile expansion should be documented only after code/tests land.
