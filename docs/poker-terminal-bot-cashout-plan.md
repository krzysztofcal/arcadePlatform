# Poker terminal bot cash-out to proven SYSTEM source

Status: planning only for GitHub issue #706. This document does not implement code, mutate production data, remediate historical escrow, or introduce a dedicated bot bankroll.

## Goal

Close a current poker table only when every authoritative remaining claim can be paid atomically and the table escrow reaches exactly zero. Human claims continue to return to USER accounts. Each positive bot claim returns to the exact SYSTEM account proven by the bot's actual `TABLE_BUY_IN` ledger lineage, normally `TREASURY`.

The smallest safe implementation is:

1. lock and revalidate the open table, persisted poker state, seats, and table escrow in one database transaction;
2. build a complete, read-only terminal accounting plan before posting any cash-out or clearing any state;
3. read the bot's final stack only from authoritative persisted state and resolve its current identity by seat number;
4. reconstruct bot funding provenance from immutable ledger entries, using metadata only to connect bot identities and actual entries to prove the SYSTEM source and amounts;
5. fail closed without mutation when the state, claim total, or provenance is ambiguous;
6. post human `ESCROW -> USER` and bot `ESCROW -> SYSTEM` cash-outs in the same transaction;
7. require the locked escrow balance to become exactly zero before marking seats inactive, clearing state claims, and closing the table;
8. increment the persisted state version so a concurrent stale WS mutation cannot revive the closed table.

Issue #707 remains responsible for read-only inventory and historical reconciliation. Issue #710 remains an optional future bankroll design and is not a dependency.

## Scope and constraints

- Apply only to current lifecycle closure of an `OPEN` table.
- Cover WS inactive cleanup, terminal close reached from last-human cleanup, zombie/open-table janitor cleanup, and admin force-close.
- Do not scan or repair already closed historical tables.
- Do not infer a destination from `POKER_BOT_BANKROLL_SYSTEM_KEY`, the current environment, transaction metadata alone, or a deterministic bot UUID.
- Do not create `POKER_BOT_BANKROLL`, add an ENV, move balances, or add a migration.
- Never update `chips_accounts.balance` directly.
- Preserve the current per-table WS command queue and existing PostgreSQL transactions.
- Do not add new test files or test cases. Update only stale expectations or harness wiring in the existing suites when the removed ESCROW-to-USER contract makes that necessary.
- Use `klog`, never `console.log`, in implementation code.

## Confirmed current architecture

### Initial bot funding

`shared/poker-domain/bots.mjs::seedBotsForJoin()` is called from the authoritative join flow when the first human joins an eligible table.

For every inserted bot seat it:

- derives the deterministic bot UUID from table ID and seat number with `makeBotUserId()`;
- calculates `buyInChips = POKER_BOT_BUYIN_BB * bigBlind`;
- resolves `getBotConfig(env).bankrollSystemKey`, whose current fallback is `TREASURY`;
- posts one `TABLE_BUY_IN` with idempotency key `bot-seed-buyin:<tableId>:<seatNo>`;
- writes metadata containing `actor: BOT`, `reason: BOT_SEED_BUY_IN`, `botUserId`, `tableId`, `seatNo`, and `botSystemKey`;
- writes one actual negative SYSTEM entry and one equal positive `POKER_TABLE:<tableId>` ESCROW entry.

The destination for terminal cash-out must come from the negative SYSTEM `chips_entries` row joined to its `chips_accounts` row. `metadata.botSystemKey` and the current bot config are audit hints, not accounting authority.

### Replacement bot funding

`ws-server/poker/engine/poker-engine.mjs::replaceBrokeBotsForNextHand()` replaces a bot below the continuation threshold with a deterministic identity derived from table, seat, and next state version. It preserves the retiring bot's residual stack and produces a funding descriptor only for `targetStack - oldStack`.

`ws-server/poker/persistence/persisted-state-writer.mjs::writeReplacementFundings()` posts the delta in the same transaction as the poker-state CAS. Its `TABLE_BUY_IN` contains:

- idempotency key `poker:bot-replacement-buyin:v1:<tableId>:<toStateVersion>:<seatNo>`;
- metadata `reason: BOT_REPLACEMENT_BUY_IN`;
- `oldBotUserId`, `replacementBotUserId`, `seatNo`, `oldStack`, `targetStack`, `fundingDelta`, and from/to versions;
- one actual negative SYSTEM entry and one equal positive table ESCROW entry.

The replacement transaction funds only the delta. When `oldStack > 0`, the replacement identity also inherits residual value from the prior bot identity. Provenance must therefore follow the replacement chain backward until a seed transaction or a zero-residual boundary is reached. If that value chain contains more than one SYSTEM source, the current bot claim is mixed-source and the close must stop for manual review.

### Persisted identity and stack projections

The persisted `poker_state.state` is authoritative for current identities and stacks:

- `state.seats` maps the current hand/runtime identity to `seatNo`;
- `state.stacks[userId]` stores the authoritative remaining claim;
- `poker_state.version` provides the optimistic concurrency generation.

`poker_seats` remains a lifecycle projection. After a bot replacement its row can intentionally retain the prior bot UUID while `state.seats` contains the replacement UUID. `persisted-bootstrap-adapter.mjs::mergeStateSeatsWithSeatRows()` already recognizes this condition by matching bot metadata through the same seat number.

Terminal accounting must use the same rule. It may use a locked `poker_seats` row to prove that a seat is a bot seat, but it must not use that row's stale UUID or `stack` as the final bot claim. A missing or invalid authoritative `state.stacks[currentBotUserId]` is `bot_stack_ambiguous`, not permission to fall back to `poker_seats.stack`.

### WS inactive and terminal cleanup

`ws-server/poker/runtime/table-janitor.mjs::evaluateTableHealth()` classifies stale seats, abandoned live hands, zombie tables, and inactive tables.

`ws-server/server.mjs` maps those classifications to:

- `executeDisconnectCleanupPrimitive()`;
- `executeStaleSeatCleanupPrimitive()`;
- `executeZombieCleanupPrimitive()`;
- `executeInactiveCleanupPrimitive()`.

All four paths enter `enqueueTableCommand()`, so commands are serialized in process per table. `inactive-cleanup-adapter.mjs::createInactiveCleanupExecutor()` then invokes `shared/poker-domain/inactive-cleanup.mjs::executeInactiveCleanup()` inside `beginSqlWs()`.

Current terminal behavior is incorrect:

- the target human can be cashed out before the function knows whether it is entering terminal close;
- the terminal loop explicitly skips `is_bot = true` rows;
- the state is converted to an inert state while bot stack keys remain;
- all seat stacks are then zeroed and the table is marked `CLOSED`;
- no locked escrow-zero invariant is checked.

After a successful WS cleanup, `server.mjs::syncCleanupRuntimeState()` already restores changed open tables or evicts closed tables and clears rollover/timeout/snapshot state. That orchestration should be reused unchanged.

### Admin force-close

`netlify/functions/admin-table-force-close.mjs` authenticates the administrator and calls `netlify/functions/_shared/admin-ops.mjs::runAdminTableAction()`.

`runAdminTableAction()` uses `poker_requests` for request idempotency and opens one `beginSql()` transaction. `forceCloseTableInTx()` locks the table, seats, and state, then:

- uses `stateFirstStackAmount()`, which can fall back to the seat projection;
- invokes the legacy bot helper;
- clears seats and state;
- marks the table closed.

Admin force-close does not participate in the WS process's in-memory table queue. It must therefore share the same database lock order and persisted-state version invalidation as WS terminal cleanup. PostgreSQL row locks are the cross-process serialization boundary; the WS queue remains the in-process boundary.

### Legacy bot cash-out defect

`netlify/functions/_shared/poker-bot-cashout.mjs::cashoutBotSeatIfNeeded()` currently posts:

```text
ESCROW POKER_TABLE:<tableId>  -amount
USER <bot UUID>               +amount
```

It also reads `poker_seats.stack` when no positive `expectedAmount` is supplied. Both behaviors are invalid for replacement identities and system-funded bots. The helper is reachable from admin force-close and must be replaced, not patched with a different current ENV destination.

## Accounting invariants

For a terminal-close transaction:

```text
escrowBefore = sum(all authoritative positive human claims)
             + sum(all authoritative positive bot claims)

human claim  -> ESCROW(-) + USER(+)
bot claim    -> ESCROW(-) + proven source SYSTEM(+)

escrowAfter  = 0
```

Additional invariants:

- every positive state stack is classified exactly once as a human claim or bot claim;
- a zero stack produces no empty ledger transaction;
- every positive bot claim has one current identity, one seat, and exactly one proven SYSTEM source lineage;
- a replacement residual is followed backward only while `oldStack > 0`;
- multiple source keys in one positive bot lineage are ambiguous and cannot be guessed;
- all cash-outs, state clearing, seat clearing, table close, and admin audit either commit together or roll back together;
- an already closed table is never treated as a lifecycle cash-out opportunity;
- a committed close leaves no positive or negative table escrow balance.

The preflight equality is deliberately stricter than checking only bot totals. It also prevents force-close or stale-live cleanup from discarding a pot, an unmatched contribution, an orphan positive stack, or an already-misaccounted claim. Such a table remains open/unchanged for manual review and later #707 inventory rather than being made harder to reconcile.

## Bot funding provenance contract

### Ledger rows to read

Within the already-open close transaction, load the table escrow account and all `TABLE_BUY_IN` transactions that actually credited it. Join:

- `chips_transactions.id`, `tx_type`, `idempotency_key`, `payload_hash`, `metadata`, and `created_at`;
- `chips_entries.transaction_id`, `account_id`, `amount`, and entry metadata;
- `chips_accounts.id`, `account_type`, `system_key`, `status`, and, for the table escrow row, `balance`.

Select transactions through the actual positive entry for `account_type = 'ESCROW'` and `system_key = POKER_TABLE:<tableId>`. Do not select a transaction only because its JSON metadata names the table.

For each candidate bot funding transaction require exactly two balanced entries:

- one positive entry to this exact table ESCROW;
- one equal negative entry from an active account whose actual `account_type` is `SYSTEM` and whose non-empty `system_key` is the source.

A USER-funded `TABLE_BUY_IN` is a human buy-in and is not bot provenance. Metadata identifies which bot generation the proven SYSTEM entry introduced, but it cannot override entry account type, key, or amount.

### Recognized provenance edges

Recognize only the two current closed metadata shapes:

1. Seed edge:
   - `actor = BOT`;
   - `reason = BOT_SEED_BUY_IN`;
   - valid `botUserId` and `seatNo`;
   - actual SYSTEM debit equals the actual table ESCROW credit.
2. Replacement edge:
   - `actor = BOT`;
   - `reason = BOT_REPLACEMENT_BUY_IN`;
   - valid, distinct `oldBotUserId` and `replacementBotUserId`;
   - matching seat number and valid from/to versions;
   - `fundingDelta = targetStack - oldStack`;
   - actual SYSTEM debit and ESCROW credit both equal `fundingDelta`.

Reject duplicate introduction edges for one bot identity, cycles, seat changes inside a lineage, malformed amounts, metadata/entry amount disagreement, a funding transaction attached to another table escrow, or an unrecognized source account type.

### Resolving one current bot

For a positive current bot stack:

1. find the single seed or replacement edge that introduced `currentBotUserId` at the current `seatNo`;
2. add the actual negative SYSTEM entry's `system_key` to a source set;
3. if it is a seed edge, stop;
4. if it is a replacement edge with `oldStack === 0`, stop because no residual value crossed the identity boundary;
5. if it is a replacement edge with `oldStack > 0`, follow `oldBotUserId` at the same seat and repeat;
6. require the final source set to contain exactly one key.

The resolved key, normally `TREASURY`, becomes the SYSTEM credit destination for the entire final stack of that current bot. Different current bots may legitimately resolve to different single sources. A single bot lineage resolving to multiple sources is `bot_provenance_mixed` and leaves the whole table untouched.

Zero-stack bots require valid seat/identity classification but no provenance lookup and no ledger post because they own no remaining value.

## Authoritative terminal claim preparation

Refactor terminal closure into a read-only prepare phase followed by a mutating commit phase inside one SQL transaction.

### Lock order

Use the same order in inactive cleanup and admin force-close:

1. `poker_tables` row `FOR UPDATE`;
2. `poker_state` row with `version, state` `FOR UPDATE`;
3. all `poker_seats` rows ordered by seat `FOR UPDATE`;
4. `chips_accounts` table escrow row `FOR UPDATE`;
5. provenance ledger reads and destination account validation;
6. ledger posting, which reuses these locks and acquires destination account locks through the existing helper.

This avoids the current inconsistent state/seat/table lock order and provides cross-process serialization with the Netlify admin action.

### Build the roster

- Normalize `state.stacks` as non-negative safe integers; never coerce invalid values to zero.
- Index locked seat rows by `seat_no` and direct human `user_id`.
- Map current bot identities from `state.seats` to a locked bot seat row at the same seat number. Direct identity match is allowed; replacement identity over an older bot row is also allowed.
- Use `requireAuthoritativeHumanStack()` for human claims. Do not use `stateFirstStackAmount()` in terminal accounting.
- Require every positive `state.stacks` key to belong to exactly one current locked seat classification. An orphan positive key fails closed.
- Preserve current nonterminal single-human cleanup behavior: if another active human remains, cash out only the target human through the existing authoritative USER path.
- If removing the target would leave no active human, do not post that individual cash-out first. Include the target and every remaining human and bot in one terminal plan.

### Preflight before mutation

The terminal prepare result contains:

```text
tableId
fromStateVersion
toStateVersion = fromStateVersion + 1
humanCashouts[]: userId, seatNo, amount
botCashouts[]: botUserId, seatNo, amount, sourceSystemKey, provenanceTransactionIds
escrowSystemKey
escrowBefore
totalHumanClaims
totalBotClaims
```

Before the first `postTransaction()` call require:

- table status is still `OPEN`;
- the state row and escrow account exist and have expected types;
- no connected-human or grace/protected-hand safeguard applicable to the ordinary cleanup path has been bypassed;
- all destination accounts are active and provenance is unambiguous;
- `totalHumanClaims + totalBotClaims === escrowBefore`;
- there is no unallocated positive pot/contribution/orphan claim hidden outside those stacks.

For admin force-close, a live hand with pot or contributions will normally fail the claim equality. #706 must not invent a refund or settlement policy merely to make force-close proceed. Return manual review with no mutation. A future issue may define a separately reviewed live-hand force-close policy.

## Atomic cash-out and close

After successful preflight, remain in the same transaction and:

1. post each positive human claim with the current strict `TABLE_CASH_OUT` ESCROW-to-USER shape;
2. post each positive bot claim with a new strict `TABLE_CASH_OUT` ESCROW-to-SYSTEM shape;
3. re-read the already locked table escrow account and require `balance = 0`;
4. write the inert poker state with `stacks: {}`, cleared pot/turn/hand fields, and increment `poker_state.version` from `fromStateVersion` to `toStateVersion`;
5. set every seat `INACTIVE` with `stack = 0`;
6. set the table `CLOSED` and update activity timestamps;
7. write the existing admin audit when the caller is admin force-close;
8. return a closed result that lets existing WS cleanup orchestration evict or restore runtime state.

Any exception, zero-balance mismatch, ledger failure, duplicate payload mismatch, or state/version mismatch must escape the mandatory section so PostgreSQL rolls back every ledger row and lifecycle mutation.

The state version increment is mandatory. If a WS state writer was waiting behind the close transaction, its old expected version will fail after close instead of overwriting the inert closed state. If the WS mutation commits first, the closer wakes, reads the newer locked state, and recomputes its terminal plan before posting cash-outs.

## Ledger cash-out shape and idempotency

### Strict SYSTEM cash-out shape

Extend the existing shared ledger validation narrowly for a system-owned `TABLE_CASH_OUT`:

```text
userId = null
txType = TABLE_CASH_OUT
entries = exactly two
  ESCROW POKER_TABLE:<tableId>  -amount
  SYSTEM <provenSourceKey>       +amount
sum(entries) = 0
```

The actual accounts loaded for these logical entry kinds must match `ESCROW` and `SYSTEM`; a reused `system_key` with an unexpected account type fails closed. Do not generalize other transaction types to permit account-only transfers.

Automatic WS cleanup uses `createdBy: null`, matching the server-internal replacement-funding convention and the nullable schema. Admin force-close uses the authenticated `adminUserId`. Metadata records `actor: BOT`, `reason: BOT_TERMINAL_CASH_OUT`, table ID, current bot ID, seat number, state versions, source SYSTEM key, and provenance transaction IDs.

### Deterministic key

Use one transaction per positive current bot claim:

```text
poker:bot-terminal-cashout:v1:<tableId>:<toStateVersion>:<seatNo>:<botUserId>
```

- `tableId` scopes the table;
- `toStateVersion` identifies the single terminal-close generation;
- `seatNo` distinguishes claims at the table;
- `botUserId` binds the current replacement identity.

Do not include amount or SYSTEM key in the key. The existing ledger payload hash binds the amount, destination, metadata, and entries to the logical operation. Reusing the same close generation with a different amount or source must conflict rather than create a second valid transaction.

Normal inactive cleanup and admin force-close use this same bot key contract. The caller or admin request ID may be audit metadata, but it must not create a second key for the same logical terminal claim.

## Fail-closed and manual-review behavior

Return a controlled result such as:

```text
ok: false
code: manual_review
reason: <closed allowlisted reason>
retryable: false
changed: false
closed: false
```

before any mutation for structural cases:

- `bot_stack_ambiguous`;
- `bot_identity_ambiguous`;
- `bot_provenance_missing`;
- `bot_provenance_mixed`;
- `bot_provenance_conflict`;
- `terminal_positive_stack_orphaned`;
- `terminal_claims_mismatch`;
- `terminal_live_liability_unresolved`;
- `escrow_account_missing_or_invalid`;
- `source_system_missing_or_inactive`;
- malformed state, seat, amount, or ledger evidence.

Database/network failures and serialization conflicts remain retryable and use the existing janitor/cleanup retry behavior. Do not classify malformed immutable evidence as transient, and do not continuously hot-loop it.

An already `CLOSED` table returns `already_closed` without posting anything. This deliberately leaves historical residuals for #707 rather than turning #706 into remediation.

Log only allowlisted reason, table ID, state version, counts, and aggregate amounts with `klog`. Do not log cards, tokens, emails, raw SQL, or entire ledger payloads.

## Removal of the ESCROW-to-USER bot path

- Remove the `cashoutBotSeatIfNeeded()` implementation and its export.
- Remove `ensureBotSeatInactiveForCashout()` as a prerequisite to bot payout; terminal planning owns lifecycle ordering and pays before seat clearing.
- Replace admin force-close callers with the prepared batch SYSTEM-cash-out path.
- Keep human cash-out code explicitly restricted to locked rows classified as `is_bot !== true` and authoritative human identities.
- Do not pass a bot UUID as `postTransaction.userId` and do not create/get a USER account for a bot.
- Verify by repository search that no reachable poker path constructs `TABLE_CASH_OUT` with a USER credit for a locked bot seat.

The generic ledger remains capable of valid human USER cash-outs. The safety boundary is the removal of all bot callers plus strict bot/system helper inputs; no schema-level assumption that every UUID is an auth user is introduced.

## Exact affected files and methods

### Mandatory runtime and accounting changes

- `netlify/functions/_shared/poker-bot-cashout.mjs`
  - replace `ensureBotSeatInactiveForCashout()` and `cashoutBotSeatIfNeeded()`;
  - add `loadBotFundingEvidence(tx, { tableId })`;
  - add pure `resolveBotFundingSource({ botUserId, seatNo, evidence })` with bounded cycle detection;
  - add `prepareTerminalBotCashouts(tx, { tableId, state, stateVersion, seatRows })`;
  - add `postTerminalBotCashouts(tx, { tableId, toStateVersion, botCashouts, createdBy, requestId })`;
  - add locked escrow read/zero assertion helpers reused by both callers;
  - use actual joined ledger entries as source authority.
- `netlify/functions/_shared/chips-ledger.mjs`
  - extend `validateEntries()` only for strict account-only `TABLE_CASH_OUT` with one ESCROW debit and one SYSTEM credit;
  - validate that loaded account rows match the logical SYSTEM/ESCROW kinds;
  - preserve payload hashing, the global idempotency constraint, account locking, non-negative balance guard, and existing transaction reuse through `tx`;
  - leave human and replacement `TABLE_BUY_IN` behavior unchanged.
- `shared/poker-domain/inactive-cleanup-deps.mjs`
  - export the new terminal bot accounting functions beside `postTransaction` for the WS adapter.
- `ws-server/poker/persistence/inactive-cleanup-adapter.mjs::createInactiveCleanupExecutor()`
  - inject the new prepare/post/escrow helpers into `executeInactiveCleanup()`;
  - preserve `beginSqlWs()` and controlled adapter error mapping.
- `shared/poker-domain/inactive-cleanup.mjs::executeInactiveCleanup()`
  - normalize lock order to table, state, seats, escrow;
  - split nonterminal single-human cleanup from terminal all-claims cleanup before posting anything;
  - use `requireAuthoritativeHumanStack()` for human claims;
  - prepare and validate all bot provenance and escrow equality before mutation;
  - post every claim, assert escrow zero, increment state version, clear state/seats, and close atomically;
  - return nonretryable manual-review results without committing partial human cash-outs.
- `netlify/functions/_shared/admin-ops.mjs`
  - remove legacy bot-cashout imports and `stateFirstStackAmount()` use from `forceCloseTableInTx()`;
  - reuse the same terminal preparation and posting helpers;
  - keep `runAdminTableAction()` and `poker_requests` request idempotency;
  - increment state version on close and write the existing admin action only after the escrow-zero invariant passes;
  - return controlled 409/manual-review behavior for unresolved live liabilities or provenance.

### Existing verification assets, no new tests

- `tests/poker-bot-cashout.*.unit.test.mjs`
  - these existing files currently load the legacy helper and one explicitly asserts ESCROW-to-USER;
  - update or consolidate their existing assertions in place so they no longer preserve the forbidden contract;
  - do not add new test files or additional scenarios beyond adapting the existing coverage to the new exports and SYSTEM destination.
- `shared/poker-domain/inactive-cleanup.behavior.test.mjs`
  - update its existing harness SQL shapes and current terminal-close expectations for cleared bot stacks, version increment, and injected accounting helpers;
  - do not add a new test case.
- `tests/poker-inactive-cleanup.behavior.test.mjs`
  - update existing stale-live/terminal expectations so ambiguous pot-bearing close fails closed rather than preserving bot value in a closed state;
  - do not add a new test case.
- `ws-server/poker/persistence/inactive-cleanup-adapter.behavior.test.mjs`
  - adjust existing dependency-injection expectations only if required.
- existing admin function/ops tests
  - update current mocks only where changed imports or result codes require it; do not introduce Playwright or a new suite.
- `scripts/test-all.mjs`
  - keep the existing registered suites; only remove a stale registration if an existing legacy test file is consolidated rather than replaced.

### Documentation

- `docs/poker-deployment.md`
  - document terminal bot provenance, expected zero escrow after a new table closes, manual-review behavior, and the WS Preview smoke query checklist.

### Explicitly unchanged

- `ws-server/poker/engine/poker-engine.mjs`: replacement amount and identity rules remain unchanged.
- `ws-server/poker/persistence/persisted-state-writer.mjs`: replacement funding remains unchanged; its ledger metadata is consumed as provenance evidence.
- `ws-server/poker/persistence/chips-ledger.mjs`: remains the narrow replacement `TABLE_BUY_IN` client and is not generalized to cash-out.
- `shared/poker-domain/bots.mjs`: initial funding continues to use the current configured source, normally `TREASURY`.
- `ws-server/server.mjs`: current table command queue and `syncCleanupRuntimeState()` are reused; no new WS command or payload is required.
- poker engine rules, settlement, autoplay, client UI, DB schema, CSP, JavaScript/JSP pages, and CSS.

## Implementation phases

### Phase 1 — ledger evidence and strict cash-out primitive

- refactor the legacy bot helper into read-only evidence loading, lineage resolution, terminal plan preparation, and strict SYSTEM cash-out posting;
- extend the shared ledger only for the exact ESCROW-to-SYSTEM `TABLE_CASH_OUT` shape;
- remove the reachable ESCROW-to-USER bot helper and adapt its existing tests in place.

### Phase 2 — atomic inactive terminal close

- reorder locks and decide nonterminal versus terminal behavior before any human cash-out;
- build the complete authoritative claim plan;
- fail closed on unresolved state, provenance, live liabilities, or escrow mismatch;
- post all claims, require escrow zero, increment version, and close in one transaction;
- preserve existing WS queueing, retries, runtime restore, and closed-table eviction.

### Phase 3 — admin force-close alignment

- replace the legacy bot loop with the same prepared terminal plan;
- keep admin authentication, confirmation, `poker_requests`, and audit behavior;
- use database locks and state-version invalidation as the cross-process serialization boundary;
- reject unsafe live-hand closes without mutation instead of inventing a settlement policy.

### Phase 4 — existing-suite and runtime verification

- run the current registered suites after adapting only stale expectations/harnesses;
- deploy matching Netlify Preview and WS Preview builds;
- smoke-test only newly created tables and inspect actual ledger entries and balances;
- update deployment documentation;
- do not touch historical closed residuals.

## Verification using existing tests

No new automated test file or case is planned. Run the existing coverage that already exercises the touched contracts:

```text
npm test
npm run check:all
npm run ci:guards
node shared/poker-domain/inactive-cleanup.behavior.test.mjs
node tests/poker-inactive-cleanup.behavior.test.mjs
node ws-server/poker/persistence/inactive-cleanup-adapter.behavior.test.mjs
node tests/chips-ledger.test.mjs
node tests/chips-ledger.escrow-only.null-user.unit.test.mjs
existing tests/poker-bot-cashout.*.unit.test.mjs files after in-place contract updates
```

Review the full diff to confirm:

- no new test files/cases were added;
- no bot path emits a USER credit;
- no destination is derived from current bankroll ENV;
- no balance is patched directly;
- all terminal mutations remain inside one transaction.

## Manual WS Preview smoke verification

Both a Netlify Deploy Preview and matching WS Preview Deploy are required for the future implementation because the change spans Netlify admin/shared accounting code and the authoritative WS cleanup adapter. No migration or new ENV is required.

Use a newly created stage table; do not reuse a historical residual table.

1. Record the new table ID, escrow account balance, state version, current state seats/stacks, and bot seed `TABLE_BUY_IN` transactions.
2. Confirm each seed transaction has one actual negative SYSTEM entry, normally `TREASURY`, and one equal table ESCROW credit.
3. Play until at least one bot replacement occurs, then confirm the replacement `TABLE_BUY_IN` metadata and actual delta entries connect old and replacement identities.
4. Leave the table and allow ordinary WS inactive cleanup to close it.
5. Confirm each positive human claim produced ESCROW-to-USER and each positive bot claim produced ESCROW-to-the-proven-SYSTEM; no USER account/entry was created for a bot UUID.
6. Confirm the sum of terminal debits equals the pre-close escrow balance and the final `POKER_TABLE:<tableId>` escrow balance is exactly zero.
7. Confirm seats are inactive with zero projection, state is inert with `stacks: {}`, state version advanced once, table is closed, and the WS runtime/lobby evicted it.
8. Trigger the same cleanup again and confirm no additional ledger transaction or balance change occurs.
9. Create a second new, settled/non-live table and invoke admin force-close. Confirm the same provenance, idempotency, atomic close, and zero-escrow results.
10. Attempt admin force-close while a pot or other liability prevents `sum(stacks) === escrow`. Confirm a controlled manual-review response and no ledger, state, seat, or table mutation.

Capture transaction IDs, idempotency keys, entry amounts/account types, source system keys, state versions, and aggregate `klog` outcomes. Do not modify balances manually to manufacture a mixed-source case.

## Deployment and rollback

### Deployment

1. Merge no migration and add no ENV.
2. Deploy the Netlify preview and matching WS Preview artifact.
3. Complete the new-table normal-close and admin-close smoke scenarios.
4. Verify stage escrow zero and absence of bot USER credits with read-only ledger queries.
5. Deploy Netlify/shared functions and WS server from the same commit to production.
6. Monitor terminal close successes, manual-review reasons, rollback/retry failures, and positive escrow on newly closed tables.

### Rollback

- A code rollback reintroduces skipped bot cash-out and possibly the legacy bot USER destination. Before rollback, stop new bot-table creation or disable terminal cleanup for affected tables rather than knowingly creating new residuals.
- Do not reverse valid ESCROW-to-SYSTEM cash-outs; they settle committed table claims.
- Tables that failed closed remain open/unchanged and may retry after a transient dependency recovery.
- Already closed historical residuals remain untouched and move to #707 inventory, not manual production SQL.

## Breaking and operational impact

| Area | Impact |
|---|---|
| Poker economics | Intentional correction: terminal bot value returns to its proven SYSTEM owner and new clean closes converge to zero escrow. |
| Inactive cleanup | Last-human cleanup becomes all-or-nothing. Structural ambiguity no longer permits partial human cash-out followed by destructive close. |
| Admin force-close | Intentional fail-closed change: a live/ambiguous table may return manual review instead of being forcibly zeroed with unresolved liabilities. |
| Concurrency | State version advances on terminal close; stale WS writes conflict and restore instead of reviving closed state. |
| Ledger | Adds strict account-only `TABLE_CASH_OUT` support for ESCROW debit plus SYSTEM credit. Existing USER cash-out and bot `TABLE_BUY_IN` semantics remain unchanged. |
| Existing bot cash-out tests | Stale assertions that expect a bot USER credit must be updated in place; no new tests are added. |
| Historical data | No remediation. Existing closed residuals remain for #707. |
| DB/ENV | No migration, new account, new secret, or new/changed ENV. `POKER_BOT_BANKROLL_SYSTEM_KEY` is not consulted for destination. |
| WS protocol/UI | No payload, command, browser UI, CSP, JSP, JS, or CSS change. |

The main product-visible breaking behavior is safer failure: cleanup or force-close can refuse an ambiguous table rather than deleting accounting evidence. Operational tooling must surface the allowlisted manual-review reason so the table can be inventoried later.

## Acceptance criteria

- Initial and replacement funding provenance is reconstructed from actual immutable ledger entries.
- A current replacement bot is mapped by authoritative state identity and seat number, not stale `poker_seats.user_id`.
- Final bot amount comes only from authoritative `poker_state.state.stacks`.
- Every positive bot claim resolves to exactly one SYSTEM source or the entire close fails without mutation.
- Normal current funding resolves to `TREASURY` only because the ledger proves it, not because code assumes it.
- Bot cash-out posts exactly balanced ESCROW debit and proven SYSTEM credit entries.
- No reachable terminal path credits a bot USER account.
- Human and bot cash-outs, state version/state clearing, seat clearing, table close, and admin audit are atomic.
- Last-human cleanup does not post an individual cash-out before terminal preflight succeeds.
- `escrowBefore` equals all authoritative claims before posting and `escrowAfter` is exactly zero before close commits.
- State version increments on close and stale concurrent WS persistence cannot overwrite the closed state.
- Structural ambiguity produces controlled nonretryable manual review with zero mutation.
- Already closed tables and historical residuals are not remediated.
- Existing tests/checks pass after only necessary in-place expectation/harness updates.
- A newly created WS Preview table passes normal-close and admin-force-close ledger smoke verification.

## Definition of Done

- The legacy ESCROW-to-USER bot helper is unreachable or removed.
- Both terminal close callers use one provenance and SYSTEM cash-out contract.
- No direct balance update, migration, new ENV, dedicated bankroll, historical scan, or remediation exists in the implementation.
- Netlify Preview and WS Preview use the same commit.
- New-table terminal close leaves zero escrow and no bot USER credit.
- Ambiguous tables preserve state and ledger evidence for #707.
- Deployment documentation describes smoke verification and manual-review handling.

## Plan verdict

The smallest safe #706 implementation is not a destination-string replacement in the old helper. Replacement identities and delta funding make the current seat projection and current ENV insufficient evidence. The close must first derive current bot identities and stacks from locked authoritative state, trace their immutable seed/replacement ledger lineage to one actual SYSTEM source, and validate the entire table claim against locked escrow. Only then can one SQL transaction post every cash-out, prove escrow zero, increment the state version, and close the table. This reuses the existing ledger, WS queue, inactive cleanup transaction, admin request idempotency, and runtime sync without creating a new accounting framework or performing historical remediation.
