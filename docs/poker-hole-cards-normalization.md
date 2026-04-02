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

## Smoke flow status

The old `npm run poker:smoke` path is retired. Poker table runtime is WS-only, and HTTP gameplay read/write flows (`poker-get-table`, `poker-heartbeat`, legacy HTTP gameplay commands) are non-authoritative/retired (`410`).

Use WS behavior coverage (`tests/poker-ui-ws-*.behavior.test.mjs`, WS guard tests, and `ws-tests/*`) for runtime verification.
