# Poker hole-cards normalization (state_invalid)

## Symptoms

- `poker-get-table` can return HTTP 409 `state_invalid` during action phases (typically right after `poker-start-hand`).
- The state row and `handId` exist, but the response still fails before returning hole cards.

## Diagnosis

- SQL inspection showed `public.poker_hole_cards.cards` sometimes stored or returned as a **stringified JSON array** (text type or driver string coercion).
- When `poker-get-table` loads hole cards, the action-phase state was valid but `cards` arrived as a string.

## Root cause

`loadHoleCardsByUserId()` assumed `cards` was an array. When it received a string, validation failed (`isValidTwoCards(cards)`), which surfaced as `state_invalid`.

## Fix summary

- Normalize `cards` inside `loadHoleCardsByUserId()`:
  - Arrays pass through unchanged.
  - Strings are `JSON.parse`d; only parsed arrays are accepted.
  - Unparsable strings or non-array results still fail validation.
- Validation remains strict: invalid card shapes or counts still yield `state_invalid`.

## Regression test summary

- Behavior test validates `poker-get-table` succeeds when all hole cards are stringified JSON arrays.
- Negative test validates `poker-get-table` returns `409 state_invalid` when any user’s cards are a malformed string.

## How to run the smoke test

This smoke test hits real infra and is **manual by default**. It is intentionally **not** part of default CI.
If you want CI coverage, add a workflow that only runs via `workflow_dispatch` (or an explicit flag) and requires the Supabase secrets.

1. Add env vars to `./.local/poker-test.env`:
   - `BASE`, `ORIGIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`
   - `U1_EMAIL`, `U1_PASS`, `U2_EMAIL`, `U2_PASS`
2. Load env:

   ```bash
   set -a
   . ./.local/poker-test.env
   set +a
   ```

3. Run:

   ```bash
   npm run poker:smoke
   ```

The script creates a table, seats two users, starts a hand, validates `poker-get-table`, performs one `CHECK`, and prints a UI link plus the final table ID for manual inspection.
