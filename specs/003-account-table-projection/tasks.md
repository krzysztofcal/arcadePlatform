# Tasks: Account Poker Table Projection

**Input**: Design documents from `specs/003-account-table-projection/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, and `contracts/account-poker-projection.md`

**Tests**: Required for the two backend contract cases and the minimal WS/Account behavior described in the specification. Tests extend existing files.

## Phase 1: User Story 1 — Read my authoritative poker tables (P1)

**Goal**: Deliver the authenticated opt-in response with full backend identifiers, authoritative WS membership, and independent balance fallback.

### Tests first

- [X] T001 [P] [US1] Extend `ws-server/poker/table/table-manager.behavior.test.mjs` with a deterministic `projectUserTables(userId)` case asserting `inPoker`, table membership, sanitized fields, exclusion of unrelated/bot-only tables, and the complete `tableId`.
- [X] T002 [P] [US1] Extend `tests/public-profiles.behavior.test.mjs` with `profile-me?includePoker=1` success and WS-failure cases asserting the correct `balance`, `poker.inPoker`/`tables`, HTTP 200 fallback, and `poker: null` rather than a fabricated zero balance.
- [X] T003 [US1] Extend `ws-server/server.behavior.test.mjs` with internal projection route tests for token authorization, read-only method handling, user filtering, and the complete `tableId` in the JSON response.

### Implementation

- [X] T004 [US1] Implement `projectUserTables(userId)` in `ws-server/poker/table/table-manager.mjs` using authoritative runtime members plus `tableSnapshot`/`tableMeta`, returning only the contract's sanitized table fields and full IDs.
- [X] T005 [US1] Add the token-protected `GET /internal/account/poker?userId=...` route to `ws-server/server.mjs`, delegating to `tableManager.projectUserTables` and preserving controlled 400/401/405/503 responses.
- [X] T006 [US1] Extend `netlify/functions/_shared/poker-ws-runtime-notify.mjs` with a bounded, token-authenticated account projection GET and validation that converts transport, timeout, status, identity, or shape failures to unavailable data without exposing tokens.
- [X] T007 [US1] Extend `netlify/functions/profile-me.mjs` for exact `includePoker=1`: read the existing ledger balance independently, add the validated WS projection or `poker: null`, preserve profile-only GET/PATCH behavior, and log failures through `klog`.

**Checkpoint**: `profile-me?includePoker=1` returns the fundamental backend contract and preserves a correct balance under WS projection failure.

## Phase 2: User Story 2 — See table membership on Account (P2)

**Goal**: Render the projection in the existing Account flow while limiting abbreviation to visible UI text.

### Tests first

- [X] T008 [US2] Extend `tests/account-page.test.mjs` with the existing VM harness to assert that Account requests/rendering keep the full table ID in machine-readable data and abbreviate only the visible label, including the `poker: null` state.

### Implementation

- [X] T009 [US2] Extend `js/profile-client.js` with an opt-in `getMe` request option for `includePoker=1`, keeping user-scoped cache/in-flight behavior correct for profile-only callers.
- [X] T010 [US2] Extend `account.html` and `js/account-page.js` with a read-only poker tables panel, safe DOM rendering, unavailable/empty states, full `data-table-id` values, and an Account-only visible table-ID abbreviation helper.

**Checkpoint**: An authenticated Account page displays the available current table list or a clear unavailable state without changing poker actions or navigation authority.

## Phase 3: Verification and handoff

- [X] T011 [US1] [US2] Run the focused existing behavior tests, `npm run syntax`, `npm test`, and whitespace/self-review; confirm no private state, token, dependency, schema, configuration, or ignore-file changes were introduced.
- [ ] T012 [US1] [US2] Run the repository review/self-review against the spec, plan, tasks, and constitution, then dispatch the manual WS Preview Deploy workflow from `main` with the implementation SHA and verify successful deployment for that exact SHA before preview E2E.
- [ ] T013 [US1] [US2] Run configured preview E2E only after exact-SHA WS Preview Deploy success, inspect bounded `ws-server-preview.service` journal evidence, and record the unmerged branch/PR handoff without merging.

## Dependencies and order

- T001, T002, and T003 are independent RED tests and must fail before T004–T007 implementation work.
- T004 precedes T005; T005 and T006 are the two sides of the WS internal contract, and T007 consumes T006.
- T007 precedes T009–T010 because the Account page consumes the public response.
- T008 must be written before T009–T010 and may be run after T007's contract is defined.
- T011 follows all implementation tasks; T012 follows passing focused/full checks; T013 follows an exact-SHA successful preview deploy.

## Parallel opportunities

- T001, T002, and T003 can be authored/run in parallel because they touch separate existing test files.
- T005 and T006 can be implemented in parallel after T004's response shape is fixed; T007 then integrates them.
- T008 is independent of the WS server test once the public response contract is fixed.
