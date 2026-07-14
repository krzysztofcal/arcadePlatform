# Poker bot replacement escrow funding

Status: planning only for GitHub issue #705. No implementation, production data change, automatic reconciliation, terminal bot cash-out, or new test is part of this plan.

## Goal

Stop bot rollover from creating an authoritative replacement stack that is not backed by the table escrow account. Preserve the current poker rules and replacement target while funding only the increase in the table claim through the existing chips ledger.

The smallest safe implementation is:

1. prepare the next-hand state without mutating the live table;
2. use the existing persisted-state database transaction to CAS the poker state and post every required replacement `TABLE_BUY_IN`;
3. allow that transaction to commit only when both state persistence and ledger funding succeed;
4. install and broadcast the prepared runtime state only after the database transaction commits;
5. keep retrying a recoverable settled rollover at a low bounded frequency until it succeeds, the authoritative state changes, or the table is evicted.

This is limited to replacement funding. Issue #706 owns terminal bot cash-out and issue #707 owns reconciliation inventory.

## Confirmed current flow

### Engine and table manager

- `ws-server/poker/engine/poker-engine.mjs` defines `BOT_REPLACEMENT_STACK = 100` and `MIN_STACK_TO_JOIN_HAND = 2`.
- `replaceBrokeBotsForNextHand()` iterates ordered bot members after a hand reaches `SETTLED`.
- A bot with a stack below 2 receives a deterministic replacement UUID derived from table ID, seat number, and the next state version.
- The old member, seat map entry, seat details, and stack key are replaced in memory. The new stack and optional `publicStacks` value are set directly to 100.
- No ledger intent or funding evidence is returned.
- `table-manager.mjs::rolloverSettledHand()` calls that helper, builds the next hand, immediately assigns the resulting `table.coreState`, and returns the new state version.

### WS orchestration

- `ws-server/server.mjs::maybeScheduleSettledRollover()` schedules a deduplicated `settled_rollover` command.
- `createTableCommandQueue()` serializes commands per table and deduplicates the pending rollover command, but it is an in-process serialization boundary, not a database transaction.
- The command currently mutates `table.coreState` through `rolloverSettledHand()`, then calls `persistMutatedState()`, then broadcasts and starts bot autoplay.
- On persistence failure, `recoverFromPersistConflict()` reloads the persisted table. Until that recovery completes, the runtime has already held the uncommitted candidate state.

### Authoritative persistence and database boundaries

- `server.mjs::persistMutatedState()` currently reads the already-mutated state from `tableManager.persistedPokerState()` and calls `persistedStateWriter.writeMutation()`.
- `ws-server/poker/persistence/persisted-state-writer.mjs::writeViaDb()` opens one `beginSqlWs()` transaction.
- Inside that transaction, it performs an optimistic `poker_state.version` compare-and-swap, updates table activity, and writes optional hole-card/action/settlement audit data.
- A version conflict returns without changing the persisted state. The equal-state path is treated as an already-applied replay.
- `WS_PERSISTED_STATE_FILE` is a separate non-ledger file-store path and cannot provide atomic chips funding.

### Existing ledger pattern

- `shared/poker-domain/bots.mjs::seedBotsForJoin()` already posts bot funding as strict `TABLE_BUY_IN` entries:
  - configured `SYSTEM` bankroll: negative amount;
  - `ESCROW` account `POKER_TABLE:<tableId>`: equal positive amount.
- `ws-server/poker/persistence/chips-ledger.mjs::postTransaction()` accepts an existing `tx` property. When supplied, it reuses that transaction instead of opening another one.
- The helper already enforces the exact two-entry `SYSTEM(-) + ESCROW(+)` shape, balanced amounts, active accounts, non-negative balances, payload hashing, and the ledger idempotency constraint.
- The persisted-state writer and WS ledger both use PostgreSQL transaction objects exposing `tx.unsafe()`, so the helper can run within the existing `beginSqlWs()` transaction.

## Accounting decision and invariant

- Replacement funding reuses the same existing `SYSTEM` source as current bot seeding. `shared/poker-domain/bots.mjs::getBotConfig()` already resolves `bankrollSystemKey` with the deployed fallback `TREASURY`; #705 leaves that parser, fallback, account, and environment configuration unchanged.
- The expected source for #705 is therefore the existing `TREASURY` account. No dedicated account, initial allocation, balance migration, new replenishment procedure, or environment change is part of this fix.
- A replacement transfers the old bot's remaining claim to the deterministic new bot identity and funds only the increase to the existing target of 100.
- No replacement cash-out is performed in this issue.
- No direct `chips_accounts.balance` patch is permitted.

For each replacement:

```text
oldStack       = integer current settled stack, allowed range 0..1
targetStack    = BOT_REPLACEMENT_STACK, currently 100
fundingDelta   = targetStack - oldStack
ledger entries = SYSTEM(TREASURY, -fundingDelta)
                 ESCROW(POKER_TABLE:<tableId>, +fundingDelta)
```

The old residual remains backed by the escrow already present. The new ledger transfer backs exactly the additional claim. After the next hand posts blinds, the same value is represented by replacement stack plus pot; no further ledger transaction is needed.

Invalid, fractional, negative, non-finite, or unexpectedly large old stacks fail closed. The engine must not replace such a bot or calculate a guessed delta.

## Prepared rollover contract

The persistent WS path must stop mutating `table.coreState` before database success.

### Engine result

Extend `replaceBrokeBotsForNextHand()` with an additive `replacementFundings` array. Each entry contains only deterministic domain evidence:

```text
seatNo
oldBotUserId
replacementBotUserId
oldStack
targetStack
fundingDelta
settledHandId
fromStateVersion
toStateVersion
```

The engine does not read environment variables, open SQL, select a bankroll account, or post ledger transactions. It continues to produce the replacement state and now also explains the exact increase that requires funding.

Multiple broke bots produce one entry per seat, sorted by `seatNo`. A validation error returns an unchanged candidate plus a controlled failure reason; partial replacement plans are forbidden.

### Table-manager methods

Add two focused methods to `createTableManager()`:

- `prepareSettledHandRollover({ tableId, nowMs })`
  - performs the current eligibility, replacement, next-dealer, next-hand, hole-card, blind, and deadline calculations;
  - returns `expectedVersion`, `stateVersion`, `nextCoreState`, `handId`, and `replacementFundings`;
  - does not assign `table.coreState`, touch activity, broadcast, or schedule autoplay.
- `commitSettledHandRollover({ tableId, expectedVersion, nextCoreState, replacementFundings, persistenceReceipt, nowMs })`
  - rechecks that the current runtime table is still on the expected settled version;
  - requires `nextCoreState.version === expectedVersion + 1` and `persistenceReceipt.newVersion` to match;
  - accepts the closed `replacementFundings` array returned by prepare plus a persistence receipt returned by the writer;
  - refuses any candidate with non-empty `replacementFundings` unless the receipt confirms the same table ID, expected version, committed version, and successful atomic funding transaction;
  - installs the prepared state and touches activity only after that validation succeeds.

Retain `rolloverSettledHand()` only as an economy-free compatibility wrapper. A table manager constructed without a persistence bootstrap loader may use it for existing in-memory behavior. In the production manager it may commit directly when `replacementFundings.length === 0`; when replacements require funding, the caller must pass `economyMode: "none"`, and omission or any other value returns `replacement_funding_required` without mutating runtime. `server.mjs` may pass that opt-out only after its existing `isGuestTableId(tableId)` check. Persistent tables always use the explicit prepare/persist/commit path.

The wrapper must never manufacture a successful persistence receipt. The normal `commitSettledHandRollover()` path rejects a funding intent without the real writer result, so a future or overlooked caller cannot accidentally create a funded-looking replacement by invoking prepare plus commit locally. This guard is part of the table-manager contract, not only a convention in `server.mjs`.

Do not store a pending plan on the table object. The prepared object remains local to the already serialized table command.

## Atomic persistence design

### `server.mjs::persistMutatedState()`

Extend the existing optional argument contract with:

```text
nextStateOverride
privateStateForHoleCardsOverride
replacementFundings
botFundingSystemKey
systemActorUserId
deferRuntimeVersionUpdate
```

Ordinary action, timeout, join, and start-hand callers omit these properties and keep their current behavior. Settled rollover passes the prepared poker state, private hole-card state, and `botFundingSystemKey` resolved from the unchanged shared `bankrollSystemKey` configuration because the live table has not yet been mutated.

For this prepared path, `deferRuntimeVersionUpdate` prevents `persistMutatedState()` from changing `table.persistedStateVersion` before the prepared `coreState` is installed. After `commitSettledHandRollover()` succeeds, `server.mjs` applies the returned persisted version. If the runtime commit validation unexpectedly fails after the database commit, the server immediately restores the now-funded, now-advanced state from persistence instead of retrying the old rollover.

The successful writer result used as the commit receipt includes the table ID, expected version, new version, `replacementFundingCommitted: true`, and one closed `fundedReplacements` entry per prepared descriptor: `seatNo`, `idempotencyKey`, `fundingDelta`, returned transaction ID, and returned ledger `payload_hash`. The manager compares seat, key, and delta with the prepared input; a plain numeric `persistedVersion` is insufficient for a candidate containing funding intents. Reuse the transaction row already returned by `postTransaction()` rather than introducing another proof store or query.

For a guest table, retain the current economy-free in-memory rollover and do not create a funding intent. For a non-guest table, non-empty replacement funding is mandatory before commit.

### `persisted-state-writer.mjs`

Extend `writeMutation()` and `writeViaDb()` with the optional, closed `replacementFundings` input. Reuse `postTransaction()` from `ws-server/poker/persistence/chips-ledger.mjs`; do not create a new ledger client or transaction framework.

Within the existing `beginSqlWs()` callback, use this order:

1. validate the prepared funding descriptors, bankroll key, system actor UUID, and target escrow key;
2. execute the current optimistic `poker_state` update for `expectedVersion`;
3. if the CAS did not update a row, return conflict/equal-state handling without posting any ledger entry;
4. if the CAS succeeded, post every replacement `TABLE_BUY_IN` using the same `tx`;
5. only after all mandatory funding calls succeed, continue the existing activity and best-effort audit writes;
6. return from the callback and allow `beginSqlWs()` to commit.

Although the state `UPDATE` statement executes before the ledger calls, the state is not committed or externally visible until the enclosing transaction commits. A funding exception must escape the mandatory section so PostgreSQL rolls back the state CAS and every funding entry together. It must not be handled like the existing best-effort hole-card or audit writes.

If several bots are replaced in one rollover, all per-seat ledger transactions and the state CAS share the same database transaction. One failure rolls back the entire rollover; partial funded replacement sets are forbidden.

The file-store branch must reject non-empty replacement funding with `ledger_unavailable` before writing the candidate state. Guest tables remain the explicit no-ledger exception.

## Ledger payload and idempotency

Use one `TABLE_BUY_IN` transaction per replacement seat. Reuse the bot seed entry shape and add replacement-specific metadata.

Deterministic idempotency key:

```text
poker:bot-replacement-buyin:v1:<tableId>:<toStateVersion>:<seatNo>
```

Required key components:

- `tableId`: scopes the logical table;
- `toStateVersion`: identifies the single authoritative rollover generation;
- `seatNo`: distinguishes multiple replacements in the same rollover.

Do not include the funding amount in the key. The existing payload hash must reject reuse of the same logical key with a different amount or account.

This deliberately satisfies the issue requirement that the amount be bound to idempotency without putting the amount in the key itself. The key names one logical table/version/seat replacement; `fundingDelta` is mandatory payload and is covered by the ledger payload hash. Recomputing a different amount for the same logical replacement therefore produces an idempotency mismatch instead of a second valid transaction. Literal inclusion of the amount in the key would weaken this protection by allowing two differently calculated deltas for the same generation to appear as separate operations.

The replacement UUID is deterministically derived from table, seat, and version, so it is redundant in the key. The old bot UUID and settled hand ID are useful audit evidence but are not required for uniqueness. Include both identities, `settledHandId`, from/to versions, old/target stack, delta, source `SYSTEM` key, and reason `BOT_REPLACEMENT_BUY_IN` in transaction metadata and reference.

Use the existing `POKER_SYSTEM_ACTOR_USER_ID` as `createdBy`. Missing or invalid system actor configuration fails closed before the state CAS. Do not choose a connected human as the accounting actor.

## Failure, retry, and restore behavior

### Before database commit

For missing/inactive bankroll, insufficient bankroll balance, invalid delta, invalid actor, account mismatch, ledger validation failure, or state CAS conflict:

- the database transaction rolls back;
- no replacement state, ledger transaction, account delta, broadcast, or autoplay is committed;
- the runtime keeps or restores the prior `SETTLED` state;
- `recoverFromPersistConflict()` reloads authoritative persistence before any further snapshot;
- `klog` records a controlled reason, replacement count, total requested delta, and state version. Do not log cards, emails, tokens, or raw SQL errors; do not use `console.log`.

### Retry

Add settled-rollover retry metadata beside the existing rollover timer map in `server.mjs`. Reuse one timer and the existing table command queue per table:

- define fixed module constants `FAST_SETTLED_ROLLOVER_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000]` and `SLOW_SETTLED_ROLLOVER_RETRY_MS = 60_000`; do not add another ENV;
- use the fast schedule once for the initial failures;
- after the fast retry budget is exhausted, switch to one slow retry every 60 seconds;
- continue the slow retry without a total-attempt limit until the rollover succeeds, authoritative state is no longer the same `SETTLED` generation, or the table is evicted/closed;
- clear the attempt count and slow-recovery mode on success, state change, eviction, and shutdown;
- never allow both the reveal timer and recovery timer to exist for the same table.

The slow retry interval is a frequency cap, not a terminal retry limit. It prevents a hot loop while guaranteeing that a temporary bankroll, database, or configuration outage cannot strand an otherwise active table forever.

Identify the retry generation as `<tableId>:<stateVersion>:<handId>`. Store that key with `mode`, `attempt`, `dueAt`, and `timer` in `settledRolloverTimerByTableId`. A changed generation replaces and resets the schedule; a matching generation deduplicates it.

Before every retry after a persistence/funding failure, restore or confirm the authoritative persisted state and recompute the plan from that state. The same table, version, and seat produce the same replacement identity and idempotency key. A restored table already past that generation cancels the retry rather than replaying it.

- If the previous transaction rolled back, no ledger key exists and the retry may post normally.
- If PostgreSQL committed but the WS process stopped before runtime commit, restart/restore loads the already-advanced poker state, so the old rollover is not planned again.
- If stale runtime state encounters an existing key, treat the duplicate as a restore signal. Do not post another funding entry and do not accept a mismatched payload.
- A persist conflict occurs before ledger posting, so it cannot create a funded-but-uncommitted replacement.

Do not catch a PostgreSQL idempotency violation inside the same aborted transaction and then attempt to continue that transaction. Let the writer return failure, restore authoritative state outside the transaction, and rely on the atomic state-plus-ledger commit to distinguish an already-committed rollover from a rolled-back attempt.

On WS process bootstrap or authoritative table restore, an active table restored in `SETTLED` must call `maybeScheduleSettledRollover(tableId)`. This recreates recovery after process restart even though in-memory timer metadata was lost. Persistent failures remain visible through rate-limited `klog` and leave the hand safely settled instead of inventing chips, but they do not permanently disable future recovery attempts.

## Exact affected files

### Runtime and persistence

- `ws-server/poker/engine/poker-engine.mjs`
  - keep `BOT_REPLACEMENT_STACK` at 100;
  - extend `replaceBrokeBotsForNextHand()` with validated delta calculation and `replacementFundings` evidence;
  - preserve deterministic replacement identity and seat ordering.
- `ws-server/poker/table/table-manager.mjs`
  - add `prepareSettledHandRollover()` and `commitSettledHandRollover()`;
  - retain `rolloverSettledHand()` only as the guarded economy-free compatibility wrapper;
  - reject direct commit of non-empty replacement funding without a matching successful persistence receipt;
  - expose the two new methods from the manager object;
  - do not add persisted or table-level pending-funding properties.
- `ws-server/server.mjs`
  - resolve the existing bot funding source through the unchanged shared `getBotConfig(process.env)` parser and resolve the existing system actor once at startup;
  - change `maybeScheduleSettledRollover()` to prepare, atomically persist/fund, commit runtime, then broadcast/autoplay;
  - extend `persistMutatedState()` only with optional prepared-state/funding inputs;
  - add the fixed fast/slow delay constants and extend each `settledRolloverTimerByTableId` record with `mode`, `attempt`, `generationKey`, `dueAt`, and `timer` rather than adding a parallel scheduler;
  - add `scheduleSettledRolloverRetry()` for fast backoff followed by one 60-second recovery timer per table;
  - reschedule restored active `SETTLED` tables during bootstrap/restore;
  - clear retries on success, authoritative state change, shutdown, and eviction.
- `ws-server/poker/persistence/persisted-state-writer.mjs`
  - accept and validate optional replacement funding descriptors;
  - call the existing WS ledger helper inside the current DB transaction after a successful state CAS;
  - make funding failure transaction-fatal;
  - return the closed persistence/funding receipt consumed by the table-manager commit guard;
  - reject replacement funding on the file-store path.
- `ws-server/poker/persistence/chips-ledger.mjs`
  - reuse unchanged if repository verification during implementation confirms its `tx` path and strict `TABLE_BUY_IN` contract remain as analyzed;
  - do not broaden it to cash-out, reconciliation, or a generic transaction framework.
- `ws-server/shared/poker-domain/bots.mjs`
  - additively re-export the existing `getBotConfig` so `server.mjs` reuses the current funding-source parser rather than duplicating environment parsing.
- `docs/poker-deployment.md`
  - document the WS preview requirement, failure monitoring, and that #705 adds no account, migration, environment value, or replenishment workflow.
- `docs/poker-bots.md`
  - document the replacement delta invariant, continued use of the current `TREASURY` source, and that terminal return remains owned by #706.

### Explicitly unchanged

- `shared/poker-domain/inactive-cleanup.mjs` and `netlify/functions/_shared/poker-bot-cashout.mjs`: #706 scope; terminal behavior is not changed here.
- Reconciliation modules or admin mutation endpoints: #707 and future remediation scope.
- `shared/poker-domain/bots.mjs::getBotConfig()` and `netlify/functions/_shared/poker-bots.mjs::getBotConfig()`: their `TREASURY` fallback and all existing ENV behavior remain unchanged.
- Chips account provisioning, balances, and migrations: no database or production-data change is required.
- `poker_seats` schema and rows: replacement identity continues to be represented in persisted poker state and restored through the existing seat-number mapping.
- Poker action reducer, payout rules, snapshots, WS protocol, bot policy/autoplay decision logic, browser/JSP/HTML/CSS, and CSP.
- No script is added, so no CSP SHA is required. No CSS is changed; the one-selector-per-line rule is unaffected.

## Deferred optional economy control

GitHub issue #710 owns the optional future evaluation of a dedicated poker bot bankroll. It may consider account isolation, allocation policy, limits, alerts, replenishment, live-table cutover, and provenance after #705 is deployed and verified.

#710 is not a dependency or production-readiness gate for this fix. #705 must not create that account, move balances, change the current funding ENV, or require owner top-ups. The atomic delta funding contract remains valid if a later issue deliberately changes the configured `SYSTEM` source.

## Implementation phases

### Phase 1 — existing source verification

- verify that current initial bot seeding resolves the shared `bankrollSystemKey` to the deployed `TREASURY` source and posts the established `SYSTEM(-) + ESCROW(+)` shape;
- add only the WS re-export needed to consume the same parser in `server.mjs`;
- make no migration, account, balance, ENV, or production-data change.

### Phase 2 — pure replacement funding evidence

- extend the engine result with validated per-seat delta descriptors;
- split table-manager rollover into prepare and receipt-guarded commit;
- restrict the compatibility wrapper to existing in-memory mode, explicitly confirmed guest mode, or candidates without funding intents;
- keep all calculations synchronous and side-effect-free until commit.

### Phase 3 — atomic ledger plus persistence

- extend the existing writer input with the prepared state and funding descriptors;
- execute state CAS and all `TABLE_BUY_IN` posts in the same `beginSqlWs()` transaction;
- update `server.mjs` to commit runtime state only after database success;
- add fast restore/backoff followed by persistent slow recovery and existing-style `klog` events;
- ensure bootstrap and authoritative restore reschedule an active settled generation.

### Phase 4 — staged verification and rollout

- run the existing repository checks unchanged; do not add or modify tests;
- manually verify the cases below against WS preview and the stage ledger;
- deploy production only after the stage invariant and retry behavior are confirmed.

## Manual verification

No new automated test or test framework is planned.

1. Confirm an initial bot seed continues to debit the existing `TREASURY` account and credit table escrow; #705 must not change that transaction.
2. Settle a hand with one bot at stack 1. Confirm one replacement `TABLE_BUY_IN` for 99 and a target replacement claim of 100 before blind posting.
3. Repeat with stack 0 and confirm a delta of 100.
4. Settle a hand with two broke bots and confirm two per-seat transactions plus one state transition commit atomically.
5. Verify the idempotency keys use the same table/version/seat on retry and no duplicate ledger entry appears.
6. Cause a controlled ledger failure in the isolated stage flow long enough to exhaust fast retries. Confirm the state remains `SETTLED`, escrow is unchanged, no candidate snapshot/autoplay is emitted, retry switches to one 60-second timer, and recovery succeeds after the dependency is restored without any user action. This verifies failure behavior; it does not introduce a new manual bankroll replenishment process.
7. Force a state-version conflict. Confirm the CAS fails before ledger posting and the persisted state is restored.
8. Restart the WS service while a table is waiting in slow recovery. Confirm bootstrap restores the settled table, recreates the retry, and advances after the dependency recovers. Then restart immediately after a successful replacement commit and confirm the new hand is restored without duplicate funding.
9. Verify a table with no broke bot performs no ledger operation and follows the current rollover behavior.
10. In the production-configured manager, attempt direct wrapper/commit use for a persistent replacement candidate without a funding receipt. Confirm it returns `replacement_funding_required` or `replacement_funding_unconfirmed` and leaves runtime unchanged.
11. Verify a guest table explicitly selected by `isGuestTableId()` remains economy-free and continues in memory.
12. Verify inactive cleanup behavior is unchanged and any terminal bot residual remains for #706 rather than being moved by this implementation.
13. Inspect `klog` output for controlled status/reason/count/delta/retry-mode fields and absence of cards, auth data, and raw sensitive errors.

## Deployment and rollback

### Deployment

1. Read-only verify that WS preview resolves the existing bot funding source to `TREASURY` and that the existing system actor configuration is valid; do not change account balances or ENV for #705.
2. Run a **WS Preview Deploy** because `ws-server` runtime and persistence code change; an ordinary Netlify deploy preview alone is insufficient.
3. Complete the manual stage scenarios, including failure, retry, restart, and ledger inspection.
4. Deploy the WS service without a migration, ENV cutover, table drain, or bankroll allocation step.
5. Monitor replacement success/failure, retry counts, `TREASURY` debit and escrow-credit deltas, persistence conflicts, and settled-hand age.

### Rollback

- Reverting to the old WS code reintroduces the P0 unfunded-replacement defect. Before any code rollback, stop new bot tables and drain/close active bot tables or temporarily disable poker traffic.
- Do not reverse valid replacement `TABLE_BUY_IN` transactions during an application rollback; they back already committed table claims.
- If the new path fails, the safe runtime state is the prior settled hand. Restore service after the existing ledger dependency recovers instead of manually advancing state or patching balances.

## Breaking and operational impact

| Area | Impact |
| --- | --- |
| Poker gameplay | Intentional fail-closed change: a next hand with a replacement bot no longer starts when funding is unavailable. The table stays settled and retries instead of inventing chips. |
| Bot replacement | Replacement identity, seat, target stack, dealer progression, cards, and autoplay policy remain the same after a successful commit. |
| Initial bot funding | No change. Initial bot seeding and replacement deltas use the current configured source, expected to remain `TREASURY`. |
| Runtime API | Conditionally breaking: new prepare/commit methods are additive, but a production persistence-backed caller can no longer use `rolloverSettledHand()` to commit a funded replacement. Guest/in-memory callers remain supported through the guarded economy-free path; every persistent caller must migrate to writer receipt plus commit. |
| Persistence | `writeMutation()` receives optional additive inputs. Normal action/start/timeout callers remain unchanged. Mandatory replacement funding now participates in the state transaction. |
| Ledger | Adds one `TABLE_BUY_IN` transaction per replacement seat. No transaction enum, balance semantics, or cash-out behavior changes. |
| Restore/retry | A failed replacement may keep a table in `SETTLED` longer. Fast retries transition to a 60-second recovery cadence and survive process restart through restored-state scheduling; operational monitoring is required. |
| Inactive cleanup | No code change. More correctly backed bot value may remain in escrow until #706 implements terminal return. |
| Reconciliation | No implementation. Replacement ledger metadata creates cleaner future evidence for #707. |
| Database | No migration, new account, schema change, or production-data mutation. |
| ENV/secrets | No new or changed value. The implementation consumes the current bot funding parser and existing system actor configuration. |
| WS/browser contract | None. No snapshot field, message type, JSP, JavaScript browser compatibility, HTML, CSS, or CSP change. |
| Tests | No new or modified tests. Existing checks are run unchanged, followed by the manual stage verification above. |

The most important breaking risk is the intentional fail-closed gameplay behavior: if the existing `TREASURY` ledger transfer is unavailable, replacement rollover remains in `SETTLED` and retries instead of inventing chips. There is no new account-provisioning, funding, or ENV release gate.

## Acceptance criteria

- Every replacement descriptor uses an integer old stack of 0 or 1, target 100, and exact positive delta `target - old`.
- The existing `TREASURY` source is debited by exactly the sum of replacement deltas and table escrow is credited by the same amount.
- State CAS and all replacement ledger posts commit or roll back together.
- The live runtime, snapshots, and bot autoplay do not observe the replacement state before database success.
- Multiple replacements in one rollover are atomic and independently auditable by deterministic per-seat keys.
- State conflicts create no ledger entry; ledger failures create no state transition.
- Retry and restart cannot fund the same table/version/seat twice.
- Exhausting fast retries cannot permanently strand an active settled table; slow recovery continues until success, state change, or eviction.
- A persistence-backed replacement candidate with a funding intent cannot be committed through the compatibility wrapper or without a matching writer receipt.
- `fundingDelta` is bound to the idempotency operation by the existing payload hash; a changed amount for the same table/version/seat is rejected rather than assigned a second key.
- Initial bot funding remains unchanged and continues to use the current `TREASURY` source.
- Guest tables remain outside the chips economy.
- Inactive cleanup, terminal cash-out, and reconciliation remain unchanged and explicitly deferred to #706/#707.
- Existing checks pass without adding or changing tests.
- WS preview manual verification passes before production rollout.

## Definition of Done

- No new account, allocation, migration, ENV change, or manual replenishment workflow is introduced.
- Engine replacement returns closed, validated funding evidence without performing I/O.
- Persistent rollover follows prepare → atomic persist/fund → runtime commit.
- Existing `TABLE_BUY_IN` validation and transaction helpers are reused; no new framework or generic ledger abstraction is introduced.
- Failure is fail-closed, logged with `klog`, restored, retried quickly with bounded backoff, then retried at a bounded slow frequency until a terminal lifecycle condition.
- The implementation contains no #706 cash-out behavior, #707 inventory, automatic remediation, frontend, CSS, JSP, or CSP work.

## Plan verdict

The smallest safe implementation is an additive prepared-rollover contract plus one mandatory funding step inside the existing persisted-state transaction. It keeps calculation in the engine, transaction authority in persistence, and broadcasts/autoplay in the current server orchestration. It avoids a new service or framework, reuses the established bot `TABLE_BUY_IN` shape, and closes both dangerous partial-failure directions: no state can commit without funding, and no funding can commit when the state CAS fails.
