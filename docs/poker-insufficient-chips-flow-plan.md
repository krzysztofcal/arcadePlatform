# Poker insufficient chips flow — implementation plan

Status: accepted for implementation in the same PR.

Issue: #722

## Goal

Keep a signed-in player in the poker lobby when their confirmed CH balance is below the buy-in required by the current cash-table flow. Cover both create-table and quick-seat without weakening the authoritative `USER -> ESCROW` validation performed by Poker WS.

## Current root cause

- `poker-create-table.mjs` creates an empty table and its escrow account without checking whether the creator can fund a seat.
- `poker-quick-seat.mjs` recommends or creates a table without checking whether a new seat can be funded.
- The actual debit occurs later in the authoritative WS join. An insufficient player has therefore already navigated into the table UI before receiving `insufficient_funds`.
- Rejoining an already funded seat must not require another 100 CH in the USER account.

## Scope and decisions

- Add `shared/poker-domain/table-economy.mjs` containing only `DEFAULT_CASH_TABLE_BUY_IN_CHIPS = 100`.
- The constant names the default of the current cash-table flow. It is not a global poker rule and does not model tournament entry fees or starting stacks.
- Add a generic `readPokerBuyInEligibility(tx, { userId, requiredBuyIn })` helper. It must not contain a default amount.
- Keep `createPokerTableWithState()` unchanged.
- Keep current quick-seat matchmaking. Do not globally search for an old seat at a different table or different stakes.
- Keep the authoritative WS join and ledger debit unchanged as the final concurrency-safe guard.
- Do not add a database migration, ENV, feature flag, or new protocol field.

## Task 1 — cash-flow constant and generic eligibility helper

Files:

- `shared/poker-domain/table-economy.mjs`
- `netlify/functions/_shared/poker-buy-in-eligibility.mjs`

Properties and functions:

- `DEFAULT_CASH_TABLE_BUY_IN_CHIPS = 100`
- `readPokerBuyInEligibility(tx, { userId, requiredBuyIn })`

Eligibility rules:

- `requiredBuyIn` must be a positive safe integer.
- Read the player's `chips_accounts` row with `account_type = 'USER'`.
- A missing USER account is a valid zero balance.
- Return `{ eligible, balance, requiredBuyIn }` without creating or locking an account.
- A SQL failure or malformed, negative, fractional, or unsafe stored balance is an integrity failure and must become `500 server_error`, not a false insufficient-balance response.

## Task 2 — create-table guard

File:

- `netlify/functions/poker-create-table.mjs`

Changes:

1. Pass `DEFAULT_CASH_TABLE_BUY_IN_CHIPS` to the generic eligibility helper inside the existing transaction.
2. Return a discriminated transaction result:
   - `{ kind: 'created', tableId }`; or
   - `{ kind: 'insufficient_chips', balance, requiredBuyIn }`.
3. Invoke `createPokerTableWithState()` only for an eligible player.
4. Map insufficient funds to HTTP `409` with `{ error, balance, requiredBuyIn }`.
5. Only a created result may construct the escrow key, log success, or call `notifyWsLobbyMaterialize()`.
6. Do not represent insufficient funds with an exception that the existing catch would turn into `500`.

## Task 3 — quick-seat guard

File:

- `netlify/functions/poker-quick-seat.mjs`

Changes:

- Preserve the existing candidate order and advisory lock.
- `recommendSeatAtTable()` must first check for the current user's seat in the selected table. An existing funded seat remains reconnectable even when the USER balance is zero.
- Before recommending a new seat, call the eligibility helper with `DEFAULT_CASH_TABLE_BUY_IN_CHIPS`.
- Before the fallback create path, perform the same eligibility check.
- Use explicit results:
  - `{ kind: 'recommended', tableId, seatNo }`;
  - `{ kind: 'insufficient_chips', balance, requiredBuyIn }`;
  - `{ kind: 'unavailable' }`.
- Every caller must immediately propagate `insufficient_chips`. It must never be treated as `null`, followed by another candidate, or followed by fallback table creation.
- Rejection must not update table activity or call WS materialization.

## Task 4 — lobby UX and room fallback

Files:

- `poker/index.html`
- `poker/poker.js`
- `poker/poker-v2.js`
- `js/i18n.js`

Changes:

- Expose the current lobby cash-flow amount as page/form configuration rather than a global poker invariant.
- Immediately before create-table, call the existing `ChipsClient.fetchBalance()`.
- For create-table, block the API call and navigation only for a fresh, valid response below the configured amount.
- If the balance lookup fails, continue to the guarded endpoint; a transient read error must not falsely block an eligible player.
- Quick-seat must reach its guarded endpoint because only the backend can distinguish a new buy-in from an already funded seat in the selected table. The endpoint still keeps an insufficient new player in the lobby and returns controlled UI data.
- Existing loading state prevents parallel clicks.
- Preserve structured API error properties (`balance`, `requiredBuyIn`) and render a localized message using the backend value.
- Keep the table-list `Open` action available because it is observer navigation, not a buy-in.
- Map the existing WS `insufficient_funds` rejection to a controlled message. It is already non-retryable, so do not alter auto-join retry logic.

## API contract

Both Netlify endpoints return:

```json
{
  "error": "insufficient_chips",
  "requiredBuyIn": 100,
  "balance": 99
}
```

with HTTP `409`.

## Verification

Extend existing suites only:

- `tests/poker-create-table.stakes.test.mjs`
- `tests/poker-quick-seat.behavior.test.mjs`
- `tests/poker-ui.behavior.test.mjs` where the existing lobby harness is sufficient
- `tests/poker-v2-live.behavior.test.mjs` only if its current harness covers the controlled WS copy without new infrastructure

Critical cases:

- create at 99 is rejected without table/state/escrow writes or WS notification;
- create at 100 succeeds;
- a missing USER account is reported as balance 0;
- quick-seat at 99 does not continue to another candidate or fallback create;
- quick-seat at 100 succeeds;
- an existing seat in the selected table works with USER balance 0;
- a SQL/integrity failure returns 500;
- a confirmed insufficient lobby balance suppresses create-table API and navigation;
- a quick-seat `409` remains in the lobby and renders the structured backend error;
- a failed lobby balance lookup falls through to the guarded backend.

Manual Netlify Deploy Preview smoke:

1. Test create and Play now with 0 and 99 CH: remain in lobby with controlled copy.
2. Test both paths with 100 CH: proceed normally.
3. Reconnect an already funded seat while the USER balance is zero.
4. Confirm `Open` still permits observing a table.
5. Confirm authoritative WS join still rejects a balance race safely.

## Deployment and dependency graph

- Netlify Deploy Preview is required.
- The new file under `shared/**` may trigger WS checks or deployment through path filters.
- Before handoff, verify that `table-economy.mjs` is imported only by the two Netlify endpoints and is not present in the WS runtime import graph or a shared barrel loaded by WS.
- If that remains true, a manual WS Preview Deploy is not required even if a path-based WS workflow runs automatically.
- If implementation introduces a WS import, WS Preview Deploy becomes required and must be declared in the PR.

## Breaking impact

Intended behavior change:

- create-table and quick-seat can now return `409 insufficient_chips` before navigation;
- an insufficient player no longer creates an empty table;
- the lobby blocks a confirmed invalid flow early.

Unchanged:

- current matchmaking and stakes selection;
- reconnect to an already funded seat;
- authoritative join, ledger, poker rules, settlement, and protocol;
- database schema, ENV, CSP, and CSS;
- future ability to add persisted per-table economy when a second buy-in or game format exists.
