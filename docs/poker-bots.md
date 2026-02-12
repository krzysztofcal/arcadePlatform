# Poker Bots v1

## 1. Overview

Poker bots are planned to keep tables playable and to improve Quick Seat follow-up flow once a human opens a table.

Current status in this repo:
- Quick Seat does not auto-seat the user.
- Bots are not implemented yet.
- This document defines the v1 contract before runtime rollout.

Bots use real chips economy via chips ledger from day 1.

## 2. Core Rules (v1)

- Bots participate under the same table rules as humans: blinds, turns, win/loss.
- No rebuy in v1.
- Max 2 bots per table.
- Bots are created only after at least one human is seated.

## 3. Bot cannot block human join

To keep human seating priority, two protections apply.

1. Prevention rule
   - A bot must never take a seat that would effectively block remaining human capacity.
   - In practice, do not seat bots into the last available slot when that slot should remain open for a human join path.

2. Intervention rule
   - If a human attempts to join a full table and at least one seat is bot-occupied, mark one bot seat with a `leave_after_hand` flag (stored on the seat record).
   - This flag is evaluated after the current hand settles. The bot is then cash-outed and the seat becomes available.
   - After hand end, free the seat for the waiting human path.

## 4. Economy & Chips Ledger

Bots use house bankroll funds, but all chip movement still goes through the same ledger model used by poker seats.

Each bot may have a deterministic system ledger account key
(for example derived from `{tableId, seatNo}`).

Bots are not Supabase-auth users. They operate through system ledger accounts
so all chip movement remains auditable.

- Bot buy-in is a real ledger transfer:
  - `TABLE_BUY_IN`: bot system account -> table escrow
- Bot cash-out is a real ledger transfer:
  - `TABLE_CASH_OUT`: table escrow -> bot system account

Escrow concept (high level):
- Table escrow is the temporary ledger location that holds active table chips during play.
- On seat exit, chips leave escrow back to the actor account (human user account or bot bankroll account).

## 5. Bot Identity

Each seated bot is deterministic and reproducible.

- `botUserId`: deterministic value derived from `{tableId, seatNo}`.
- `botProfile`: deterministic profile value (default comes from env), stored on the seat snapshot for auditability.
- Optional: deterministic bot ledger account key may be derived from the same identity input.

## 6. Bot Decision Policy (extensible)

Bots must execute through a policy interface so policy logic can be replaced without schema changes.

v1 policy priority (choose first legal action):
1. `CHECK`
2. `CALL`
3. `FOLD`
4. minimum legal `BET`/`RAISE`

This is intentionally trivial and deterministic-friendly; smarter policies can be swapped later.

## 7. Audit / Debugging

Every bot action record must include:

- `actor: "BOT"`
- `botUserId`
- `botProfile`
- `tableId`
- `seatNo`
- `policyVersion`
- `reason` (example: `"CHECK available"`)
- optional deterministic RNG fields (seed/roll) when randomness is used

Logging for bot actions should follow existing klog conventions.

## 8. Operational Safety

Operational guardrails for v1:

- Hard cap per request/poll cycle (example env hook: max bot actions per poll).
- Bankroll threshold checks: if bankroll is below threshold, stop seating new bots.
- Loop safety: enforce bounded action passes and timeout-safe exits to avoid infinite loops.

These controls are runtime safety rails and should fail closed (skip bot action rather than stall table flow).

## 9. Roadmap Hooks (future)

Planned profile expansion:
- `TRIVIAL`
- `TIGHT`
- `LOOSE`
- `AI_PROXY`

AI bots can be introduced by swapping policy implementation behind the same interface. No DB redesign is required for that migration path.
