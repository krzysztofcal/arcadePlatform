# Poker terminal bot cash-out to proven SYSTEM source

Status: planning only for GitHub issue #706. This document does not implement code, change production data, remediate historical tables, or introduce a dedicated bot bankroll.

## Goal

When a current poker table reaches terminal close, return every positive bot stack from the table ESCROW to the exact SYSTEM account that funded that bot lineage, normally `TREASURY`. A successful close must be one database transaction and must leave the table escrow at exactly zero.

The smallest safe change is:

1. one small resolver for bot funding provenance;
2. one strict ESCROW-to-SYSTEM bot cash-out operation using the existing ledger;
3. one shared `executeTerminalPokerCloseInTx()` helper used only after existing code decides that a table should close;
4. two callers: terminal inactive cleanup and admin force-close;
5. removal of the old ESCROW-to-USER bot path.

This is intentionally not a general terminal-accounting framework. Nonterminal leave, disconnect, reconnect, janitor classification, settlement, autoplay, and ordinary human cash-out behavior stay unchanged.

## Required accounting invariants

- The final bot amount comes only from locked `poker_state.state.stacks`, never from `poker_seats.stack`.
- The SYSTEM destination comes from actual immutable `chips_entries` and `chips_accounts`, never from the current ENV or metadata alone.
- A replacement bot that inherited residual stack follows the prior bot lineage.
- Each positive current bot stack must resolve to exactly one SYSTEM account.
- Human and bot cash-outs, state clearing, seat clearing, state-version increment, and table close commit together or roll back together.
- Ambiguous stack, identity, provenance, or escrow totals fail closed before mutation.
- No reachable path credits a USER account for a bot UUID.
- Immediately before close, authoritative claims must equal locked table escrow; immediately after cash-outs, locked table escrow must equal zero.

## Current implementation

### Initial bot funding

`shared/poker-domain/bots.mjs::seedBotsForJoin()` funds each initial bot with one `TABLE_BUY_IN`:

```text
SYSTEM <getBotConfig(env).bankrollSystemKey>  -buyIn
ESCROW POKER_TABLE:<tableId>                  +buyIn
```

The current fallback source is `TREASURY`. The transaction uses `bot-seed-buyin:<tableId>:<seatNo>` and metadata including `actor: BOT`, `reason: BOT_SEED_BUY_IN`, `botUserId`, and `seatNo`.

The negative SYSTEM entry joined to its actual account is source authority. `metadata.botSystemKey` and current configuration are only audit hints.

### Replacement bot funding

`ws-server/poker/engine/poker-engine.mjs::replaceBrokeBotsForNextHand()` creates a replacement identity and preserves the old bot's residual stack. It requests only:

```text
fundingDelta = targetStack - oldStack
```

`ws-server/poker/persistence/persisted-state-writer.mjs::writeReplacementFundings()` posts that delta atomically with the poker-state CAS:

```text
SYSTEM <configured source at funding time>  -fundingDelta
ESCROW POKER_TABLE:<tableId>                +fundingDelta
```

Its `TABLE_BUY_IN` metadata includes `oldBotUserId`, `replacementBotUserId`, `seatNo`, `oldStack`, `targetStack`, `fundingDelta`, and state versions.

If `oldStack > 0`, part of the new bot's stack came from the prior identity. The resolver must therefore walk backward. If `oldStack === 0`, no value crossed that replacement boundary and the walk stops.

### Authoritative identity and stack

- `poker_state.state.seats` contains current runtime identities and seat numbers.
- `poker_state.state.stacks` contains current authoritative stacks.
- `poker_state.version` is the concurrency generation.
- `poker_seats` is a lifecycle projection and can retain an older bot UUID after replacement.

The terminal helper must map the current state bot identity to a locked bot seat by `seatNo`. It may use the seat row to classify the seat as a bot, but not as the final identity or amount source.

### Current terminal paths

`shared/poker-domain/inactive-cleanup.mjs::executeInactiveCleanup()` runs in `beginSqlWs()` through `ws-server/poker/persistence/inactive-cleanup-adapter.mjs`. WS calls are already serialized per table by `ws-server/server.mjs::enqueueTableCommand()`.

The current function cashes out a target human before deciding whether the table will close, skips bot rows in its terminal loop, clears seat projections, and closes without checking escrow zero.

`netlify/functions/_shared/admin-ops.mjs::forceCloseTableInTx()` runs in the existing `beginSql()` transaction and currently loops through seats. For bots it invokes `netlify/functions/_shared/poker-bot-cashout.mjs::cashoutBotSeatIfNeeded()`.

That legacy helper is incorrect because it:

- can read `poker_seats.stack`;
- credits `USER <bot UUID>`;
- does not prove the source SYSTEM account.

Admin force-close is outside the WS in-memory queue. Its serialization boundary remains PostgreSQL row locks plus incrementing `poker_state.version`, so a stale WS CAS cannot revive a closed state.

## Minimal design

### 1. Load compact funding rows

Add private or narrowly exported helpers in a single new module, `shared/poker-domain/terminal-close.mjs`:

- `loadBotFundingRows(tx, { tableId, escrowAccountId })`;
- `resolveBotFundingSource({ botUserId, seatNo, rows })`;
- `executeTerminalPokerCloseInTx(options)`.

`loadBotFundingRows()` selects only `TABLE_BUY_IN` transactions that actually credited the locked `POKER_TABLE:<tableId>` ESCROW account. It joins:

- transaction ID, type, idempotency key, and metadata;
- entry amount and account ID;
- actual account type and SYSTEM key.

For a recognized bot funding row require exactly:

- one positive entry to this exact table ESCROW;
- one equal negative entry from an actual SYSTEM account;
- balanced amounts;
- seed or replacement metadata matching the current formats.

Selecting through the real ESCROW credit prevents metadata from claiming provenance for another table. The resolver returns the actual `sourceAccountId`, its `sourceSystemKey`, and only the funding transaction IDs needed for audit.

### 2. Resolve one current bot iteratively

Build two maps from the compact rows:

- seed introduction by `botUserId`;
- replacement introduction by `replacementBotUserId`.

For `{ currentBotUserId, seatNo }`:

1. find exactly one introduction at the same seat;
2. add its actual SYSTEM account ID/key to a source set;
3. stop at a seed;
4. for replacement with `oldStack === 0`, stop;
5. for replacement with `oldStack > 0`, continue with `oldBotUserId`;
6. reject missing/duplicate edges, malformed amounts, seat changes, cycles, or more than one source account;
7. return the one proven SYSTEM account.

This is a bounded loop over the table's funding rows, not a reusable graph subsystem. Zero-stack bots need identity classification but no provenance query or ledger post.

### 3. Strict bot cash-out

Inside `executeTerminalPokerCloseInTx()`, post one existing `TABLE_CASH_OUT` per positive bot claim:

```text
userId = null
ESCROW POKER_TABLE:<tableId>  -amount
SYSTEM <proven source key>     +amount
```

Before posting, revalidate that the SYSTEM account resolved by the existing ledger helper is the same actual account ID found in provenance. Do not add an account-ID transfer API or a new ledger framework.

Extend `netlify/functions/_shared/chips-ledger.mjs::validateEntries()` only enough to allow this strict two-entry, system-owned `TABLE_CASH_OUT`. Preserve current account locking, non-negative balance checks, payload hashing, idempotency uniqueness, and transaction injection through `tx`.

Use this deterministic key:

```text
poker:bot-terminal-cashout:v1:<tableId>:<toStateVersion>:<seatNo>:<botUserId>
```

Amount, destination account, entries, and metadata remain bound by the existing payload hash. A retry with changed accounting data must conflict rather than create a second valid payout.

### 4. One terminal-close helper

`executeTerminalPokerCloseInTx()` receives the existing SQL transaction, table ID, ledger dependency, actor/audit context, and optional already-loaded classification context. It owns only terminal accounting and close mutation.

Within the same transaction it:

1. locks or revalidates the open table, state/version, ordered seats, and table escrow;
2. normalizes every `state.stacks` entry as a non-negative safe integer;
3. maps each current identity to exactly one locked human or bot seat;
4. builds local `humanClaims` and `botClaims` arrays;
5. resolves provenance only for positive bot claims;
6. requires `sum(humanClaims) + sum(botClaims) === escrowBefore`;
7. posts existing ESCROW-to-USER human cash-outs and strict ESCROW-to-SYSTEM bot cash-outs;
8. re-reads the locked escrow and requires `balance === 0`;
9. writes an inert state with `stacks: {}` and increments `poker_state.version` once;
10. marks all seats inactive with stack zero and marks the table closed;
11. returns a compact result for existing WS runtime sync or admin audit.

The claims arrays are local implementation details, not a new public DTO or framework. Only aggregate counts/amounts and allowlisted failure reasons are logged with `klog`.

If a force-close encounters a live pot or another liability not represented by final stacks, the claims-to-escrow equality fails. Return `manual_review` without mutation. #706 does not define a new live-hand refund or settlement policy.

### 5. Preserve nonterminal cleanup

Keep existing turn protection, freshness, grace period, connected-presence, janitor classification, reconnect, and ordinary nonterminal human cash-out behavior.

One localized ordering change is required in `executeInactiveCleanup()`:

- load enough locked seat/state information to decide whether another active human remains;
- if another human remains, execute the existing target-human cleanup;
- if no human remains and the table is eligible to close, do not cash the target separately—call `executeTerminalPokerCloseInTx()` so every remaining human and bot claim is settled atomically;
- if terminal preconditions fail, return the controlled failure without having paid or removed the target human.

This prevents a partial human cash-out before bot provenance or escrow validation fails, without redesigning nonterminal cleanup semantics.

### 6. Wire the two terminal callers

- `shared/poker-domain/inactive-cleanup.mjs::executeInactiveCleanup()` calls the helper only in its existing terminal branch.
- `netlify/functions/_shared/admin-ops.mjs::forceCloseTableInTx()` calls the same helper instead of maintaining a seat-by-seat close implementation.
- `ws-server/poker/persistence/inactive-cleanup-adapter.mjs` and `shared/poker-domain/inactive-cleanup-deps.mjs` continue to supply the existing `postTransaction` dependency.
- `ws-server/server.mjs::syncCleanupRuntimeState()` remains unchanged and consumes the compact closed result.

The two entry points do not need identical outer orchestration. They only share the accounting-critical transactional helper.

## Fail-closed contract

Before any cash-out or lifecycle mutation, return a controlled nonretryable `manual_review` result for:

- missing/invalid authoritative state stack;
- current bot identity not mappable by seat number;
- missing, duplicate, malformed, cyclic, or mixed-source provenance;
- orphan positive stack;
- invalid/missing escrow or source SYSTEM account;
- authoritative claims not equal to locked escrow;
- unresolved live pot/contribution on force-close.

An already closed table returns `already_closed` and performs no remediation. Database/network/serialization failures remain retryable through existing caller behavior.

No large result model is needed. A compact shape is sufficient:

```text
ok: false
code: manual_review
reason: <allowlisted reason>
changed: false
closed: false
retryable: false
```

Log table ID, state version, reason, claim counts, aggregate amounts, and latency. Do not log cards, emails, tokens, raw SQL, or full ledger payloads.

## Exact files and functions

### Add

- `shared/poker-domain/terminal-close.mjs`
  - `loadBotFundingRows()`;
  - pure `resolveBotFundingSource()`;
  - `executeTerminalPokerCloseInTx()`;
  - private human/bot claim normalization, strict bot posting, escrow-zero assertion, and inert-state construction.

### Change

- `netlify/functions/_shared/chips-ledger.mjs`
  - narrowly extend `validateEntries()` for exactly one ESCROW debit plus one SYSTEM credit on a system-owned `TABLE_CASH_OUT`;
  - revalidate the proven source account ID/key without changing other transaction shapes.
- `shared/poker-domain/inactive-cleanup.mjs::executeInactiveCleanup()`
  - preserve current guard and nonterminal behavior;
  - defer the target-human mutation until terminal versus nonterminal is known;
  - delegate only terminal close to `executeTerminalPokerCloseInTx()`.
- `netlify/functions/_shared/admin-ops.mjs::forceCloseTableInTx()`
  - remove the seat-by-seat close and `stateFirstStackAmount()` fallback from force-close;
  - delegate terminal accounting and close;
  - retain authentication, `poker_requests`, classification, and admin audit orchestration.
- `shared/poker-domain/inactive-cleanup-deps.mjs`
  - keep exporting the existing ledger dependency required by the terminal helper.
- `ws-server/poker/persistence/inactive-cleanup-adapter.mjs`
  - adjust dependency wiring only if the helper signature requires it; keep `beginSqlWs()` unchanged.
- `netlify/functions/_shared/poker-bot-cashout.mjs`
  - remove the ESCROW-to-USER implementation and its seat-stack fallback;
  - delete the file if no caller remains, otherwise leave only a compatibility export that cannot accept a bot USER destination.
- `docs/poker-deployment.md`
  - document new-table terminal smoke verification and `manual_review` handling.

### Existing verification files only

- `tests/poker-bot-cashout.*.unit.test.mjs`;
- `shared/poker-domain/inactive-cleanup.behavior.test.mjs`;
- `tests/poker-inactive-cleanup.behavior.test.mjs`;
- `ws-server/poker/persistence/inactive-cleanup-adapter.behavior.test.mjs`;
- existing admin ops/function tests.

Update only stale imports, mocks, and expectations required by the removed USER-credit contract. Do not add new test files or new test cases.

### Explicitly unchanged

- initial funding in `shared/poker-domain/bots.mjs`;
- replacement rules in `ws-server/poker/engine/poker-engine.mjs`;
- replacement persistence in `ws-server/poker/persistence/persisted-state-writer.mjs`;
- janitor classification and per-table WS queue;
- settlement, autoplay, reconnect, WS protocol, poker UI, DB schema, ENV, CSP, JSP, JavaScript, and CSS;
- historical reconciliation, owned by #707;
- optional dedicated bankroll, owned by #710.

## Implementation tasks

### Task 1 — provenance and strict ledger operation

- add the compact ledger-row loader and iterative resolver;
- extend only the strict system-owned `TABLE_CASH_OUT` validation;
- remove the old bot USER cash-out path.

### Task 2 — terminal helper

- build authoritative claims from locked state;
- resolve positive bot claims;
- validate claims against escrow;
- post all claims, assert zero escrow, increment state version, and close atomically.

### Task 3 — two callers

- delegate the terminal branch of inactive cleanup;
- delegate admin force-close;
- preserve all nonterminal and outer orchestration behavior.

### Task 4 — existing verification and documentation

- adapt only existing stale expectations/harness wiring;
- run the existing registered suites;
- perform Netlify Preview plus matching WS Preview smoke on new tables;
- document runtime verification.

## Verification

Do not add tests. Run the existing suites that already exercise the touched contracts:

```text
npm test
npm run check:all
npm run ci:guards
node shared/poker-domain/inactive-cleanup.behavior.test.mjs
node tests/poker-inactive-cleanup.behavior.test.mjs
node ws-server/poker/persistence/inactive-cleanup-adapter.behavior.test.mjs
node tests/chips-ledger.test.mjs
existing tests/poker-bot-cashout.*.unit.test.mjs after in-place contract updates
```

Repository review must confirm that no reachable poker `TABLE_CASH_OUT` credits USER for a locked bot seat and no destination is taken from the current bankroll ENV.

## Runtime smoke

The future implementation requires both Netlify Deploy Preview and matching WS Preview Deploy because shared Netlify accounting and authoritative WS cleanup change. No migration or ENV change is required.

Use only newly created stage tables:

1. Create a table and record the escrow balance plus actual bot seed SYSTEM debits.
2. Play until one bot replacement occurs and record its delta funding entry.
3. Leave and allow terminal inactive cleanup to close the table.
4. Verify humans received USER cash-outs and each bot returned to the SYSTEM account proven by its seed/replacement lineage.
5. Verify no USER account or entry was created for a bot UUID.
6. Verify terminal cash-outs equal the pre-close escrow, final escrow is exactly zero, state stacks are empty, seats are inactive, table is closed, and state version advanced.
7. Run cleanup again and verify no second ledger transaction or balance change.
8. On a second new settled table, run admin force-close and verify the same result.
9. On a table with unresolved live liabilities, verify `manual_review` and no ledger/state/seat/table mutation.

## Deployment and rollback

- Merge no migration and add no ENV.
- Deploy Netlify and WS from the same commit.
- Smoke-test new stage tables before production.
- Monitor successful closes, `manual_review` reasons, retryable failures, and positive escrow on newly closed tables.
- Do not repair historical closed residuals as part of rollout.
- Do not reverse already committed valid SYSTEM cash-outs on rollback.
- If rollback would restore the bot USER path, disable affected terminal cleanup or new bot-table creation until a safe version is redeployed.

## Breaking impact

| Area | Impact |
|---|---|
| Poker accounting | Intentional correction: bot terminal value returns to the proven SYSTEM owner. |
| Terminal inactive cleanup | Becomes atomic across the last human and remaining bots; ambiguity preserves the table instead of partially closing it. |
| Admin force-close | Can return `manual_review` for live or ambiguous liabilities instead of deleting evidence. |
| Nonterminal cleanup | No intended behavior change. |
| Concurrency | Terminal close increments state version so stale WS persistence conflicts. |
| Historical data | No remediation; #707 remains responsible. |
| DB/ENV/protocol/UI | No migration, ENV, WS payload, browser, CSP, JSP, JS, or CSS change. |

## Acceptance criteria

- Current bot identity and final amount come from locked authoritative state.
- Provenance comes from actual ledger entries and follows residual replacement lineage.
- Every positive bot claim resolves to exactly one actual SYSTEM account or close fails without mutation.
- Human and bot cash-outs plus terminal lifecycle mutation are one transaction.
- No bot UUID receives a USER credit.
- Successful close leaves escrow exactly zero and advances state version.
- Nonterminal cleanup behavior remains unchanged.
- Ambiguous/live-liability cases return controlled `manual_review` without mutation.
- Existing tests/checks pass with only necessary in-place updates.
- A new-table WS Preview smoke verifies replacement provenance, idempotency, and zero escrow.

## Plan verdict

The review's simplification is valid. #706 does not need a generic terminal-accounting framework or a redesign of janitor and nonterminal cleanup. It does require more than replacing a destination with current `TREASURY`: replacement bots can inherit value funded under an earlier identity or source.

The minimal safe implementation is one iterative provenance resolver plus one shared transactional terminal-close helper. The helper is entered only from the existing terminal inactive-cleanup branch and admin force-close, uses authoritative state and actual ledger entries, performs strict SYSTEM cash-out, and commits only after proving escrow reaches zero.
