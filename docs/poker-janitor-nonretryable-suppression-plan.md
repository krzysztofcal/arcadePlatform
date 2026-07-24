# Poker janitor non-retryable terminal failure suppression — analysis and fix plan

## Metadata

- Issue: `#752`
- Follow-up to: `#748`
- Repository: `krzysztofcal/arcadePlatform`
- Analysed `origin/main`: `09dc2c30d0b956da674fb161761b4cd36db2830d`
- Analysis date: `2026-07-24`
- Environment inspected: WS Preview / stage
- Affected table: `7af59a48-5804-4c78-b8c3-d81e5e721d6c`
- Scope: automatic poker janitor scheduling after a deterministic, non-retryable terminal-accounting failure
- Runtime code changed by this document: none

## Executive conclusion

The repeated cleanup is caused by a missing scheduler-level contract, not by a failure of the terminal accounting guard.

`executeTerminalPokerCloseInTx()` correctly rejects the historical table with `terminal_claims_mismatch`, returns `changed:false` and `retryable:false`, and performs no cash-out or close. That result propagates through the persistence adapter and `runTableJanitor()`. However, `runEvaluatedTableJanitor()` does not retain or consult it. Each later stale-seat or open-table sweep loads the same authoritative state and schedules the same cleanup again.

The existing `pendingTableJanitorEvaluationByTableId` map solves only overlap while a snapshot evaluation is in flight. Its entry is deleted as soon as the snapshot promise settles. The per-table command queue also deduplicates overlapping calls that resolve to the same cleanup primitive, but deletes its entry after that command completes. Neither mechanism suppresses a later sweep of the same unchanged state.

The minimal fix is a process-local, TTL-bounded suppression map at the automatic janitor boundary. It blocks repeated automatic terminal attempts for the same persisted state version and current janitor classification. It must not weaken the accounting invariant, change the historical table, or block an explicit admin recovery attempt.

## Evidence from WS Preview

### Read-only command

```bash
sudo journalctl -u ws-server-preview.service --since "2026-07-24 14:00:00" --until "2026-07-24 14:30:00" --no-pager
```

The filtered 30-minute sample for table `7af59a48-5804-4c78-b8c3-d81e5e721d6c` contained:

| Event | Count |
|---|---:|
| `poker_terminal_accounting_invariant_failed` | 60 |
| `ws_table_janitor_result` | 90 |
| `ws_table_janitor_evaluation_coalesced` | 30 |

Representative invariant attempts occurred at:

```text
14:00:21.229
14:00:51.304
14:01:21.232
14:01:51.304
```

The pattern continues approximately every 30 seconds, matching the stale-active-seat sweep. Approximately every 60 seconds the open-table reconciler overlaps that sweep. At those overlaps the snapshot evaluation is coalesced and both callers receive a result, while the per-table command queue prevents simultaneous execution of the same stale-seat primitive. After completion all transient dedupe state is discarded, so the following sweep starts a fresh terminal attempt.

The invariant log remains stable:

```text
tableId: 7af59a48-5804-4c78-b8c3-d81e5e721d6c
stateVersion: 159
phase: SETTLED
escrowBefore: 600
totalClaims: 585
reason: terminal_claims_mismatch
```

No evidence indicates that these retries mutate escrow, claims, ledger, table status, or poker state. The noise and repeated locked DB work are nevertheless unbounded while the process and unchanged OPEN table remain present.

## Confirmed call flow

### Automatic stale-seat path

```text
sweepStaleActiveHumanSeatsAndBroadcast()
  -> listStaleActiveHumanSeatCandidates()
  -> runEvaluatedTableJanitor(trigger: "stale_active_seat_sweep")
  -> evaluateTableForJanitor()
  -> loadPersistedTableHealthSnapshot()
  -> evaluateTableHealth()
  -> runTableJanitor()
  -> executeStaleSeatCleanupPrimitive()
  -> executeUserInactiveCleanupPrimitive()
  -> enqueueTableCommand()
  -> inactive-cleanup-adapter
  -> executeInactiveCleanup()
  -> executeTerminalPokerCloseInTx()
```

### Automatic open-table path

```text
sweepOpenTableJanitorAndBroadcast()
  -> listOpenTableIdsForJanitor()
  -> runEvaluatedTableJanitor(trigger: "open_table_reconciler")
  -> the same evaluation and cleanup path
```

The zombie sweep also calls `runEvaluatedTableJanitor()` and must obey the same automatic suppression contract if it reaches the same terminal failure.

The disconnect cleanup queue is separate. It already removes a candidate when `retryable:false` is returned and must not be rewritten as part of this issue. Admin cleanup calls the shared inactive-cleanup operation through `netlify/functions/_shared/admin-ops.mjs`; it does not pass through the process-local automatic-sweep suppression and must remain available for an explicit, audited attempt.

## Exact root cause

1. `shared/poker-domain/terminal-close.mjs::invariantFailure()` deliberately returns `retryable:false`, `changed:false`, and `closed:false`.
2. `shared/poker-domain/inactive-cleanup.mjs::executeInactiveCleanup()` returns that result without changing the table.
3. `ws-server/poker/persistence/inactive-cleanup-adapter.mjs` preserves the concrete terminal failure contract.
4. `ws-server/poker/runtime/table-janitor.mjs::runTableJanitor()` returns the result to its caller.
5. `ws-server/server.mjs::runEvaluatedTableJanitor()` returns it but stores no stable failure state and performs no decision based on `retryable:false`.
6. `pendingTableJanitorEvaluationByTableId` is deleted immediately after `evaluateTableForJanitor()` completes.
7. `createTableCommandQueue()` removes its `pendingByKey` entry after the queued primitive completes.
8. The next fixed-cadence sweep therefore evaluates and executes the identical failure again.

The historical 15-chip mismatch is the data condition that triggers the guard, but it is not the cause of the retry loop. Its recovery remains governed by the runbook from #748 and is out of scope here.

## Required safety properties

- `terminal_claims_mismatch` remains fail-closed.
- Suppression never changes poker state, table status, seat state, escrow, balances, claims, ledger, settlement, or idempotency records.
- A changed state version, table status, or classification always permits a fresh automatic attempt.
- An unchanged entry expires after a short TTL and permits one fresh fail-closed attempt.
- An explicit manual/admin recovery attempt is never blocked by process-local automatic suppression.
- Conserved tables continue through the existing terminal close path.
- Concurrent automatic triggers produce no more than one terminal mutation attempt for the same table generation.
- Process restart may forget process-local suppression and perform one fresh fail-closed attempt; this is intentional and safe.
- Guest tables remain DB-free.
- Logs use `klog` only and contain no private cards, complete state, per-user claims, or secrets.

## Proposed implementation

Implement this as one narrow runtime PR. Do not combine it with historical repair, cadence changes, terminal accounting policy, schema work, or general janitor refactoring.

### 1. Build one small suppression key

File: `ws-server/server.mjs`

Methods:

- `loadPersistedTableHealthSnapshot()`
- `evaluateTableForJanitor()`
- a small new suppression-key helper next to the existing janitor maps

Change the existing `poker_state` snapshot query to select its persisted `version` alongside `state`. Build one normalized key from values already available after `evaluateTableForJanitor()`:

```text
tableId + stateVersion + tableStatus + classification + action + reasonCode + targetUserId + terminalCode + terminalReason
```

The terminal code and reason become known after the first failed attempt and are stored with the current state/classification key. On a later sweep, compare the current state version, status, and classification fields with the stored entry before returning its terminal failure.

Do not add seat hashing, escrow fingerprints, new DB queries, dependencies, or a generic fingerprint abstraction. If state version or a required classification field is unavailable, do not suppress.

This is sufficient for the current call flow:

- authoritative join/rebuy and persisted stack synchronization write poker state and advance its version;
- refreshed persisted presence or active WS presence changes the current classification;
- terminal close changes table status;
- the #748 historical recovery is version-checked and invokes manual terminal close, which bypasses this map;
- ordinary ledger funding is coupled to authoritative table operations rather than being an invisible automatic repair of this blocked generation.

A direct out-of-band seat or escrow edit that preserves state version, status, and classification could therefore wait until TTL expiry before the next automatic attempt. It cannot cause an incorrect ledger mutation because suppression performs no mutation and terminal close remains fail-closed. The approved manual recovery path remains immediately available.

### 2. Add one bounded process-local suppression registry

File: `ws-server/server.mjs`

Add one map next to `pendingTableJanitorEvaluationByTableId`, keyed by `tableId`. Each value contains only:

```text
stateVersion, tableStatus, classification, action, reasonCode, targetUserId, code, reason, expiresAt
```

Name it explicitly for terminal janitor failures, for example `suppressedNonRetryableTerminalJanitorFailuresByTableId`. Do not reuse the bot timeout map and do not create a general cache framework.

Store an entry only when all of these are true:

- the caller is an automatic janitor trigger;
- `result.ok === false`;
- `result.changed === false`;
- `result.closed === false`;
- `result.retryable === false`;
- `result.code === "terminal_accounting_invariant_failed"`;
- `result.reason` is a non-empty concrete reason;
- state version and the current classification key are complete.

Do not suppress generic `retryable:false` results such as `seat_missing`, `already_closed`, or a missing primitive. The scope is the deterministic terminal-accounting failure contract.

Give each entry a simple fixed TTL of 10 minutes. After expiry, delete it and permit one fresh fail-closed attempt even if the state and classification are unchanged. Let the narrow expiry predicate accept `nowMs`, supplied by `Date.now()` in production, so the existing suite can test expiry deterministically without timers or overrides. Keep the registry bounded using the existing simple map/set patterns: configure a small fixed maximum in code, evict the oldest entry when capacity is reached, and permit one fresh attempt after eviction. Do not add an environment variable, timer, hashing helper, or reusable cache abstraction. Expired entries can be removed lazily when the map is checked and during the existing automatic sweeps.

### 3. Check suppression after snapshot evaluation and before mutation

File: `ws-server/server.mjs`

Method: `runEvaluatedTableJanitor()`

After awaiting the shared `evaluateTableForJanitor()` result:

1. Use the freshly computed `evaluateTableHealth()` classification returned by the shared current snapshot evaluation; do not reuse the classification stored with suppression.
2. Confirm that state version, table status, classification, action, reason code, and target user still match the stored entry.
3. Confirm that the stored entry has not expired.
4. Suppress only if the complete key matches and the stored terminal code/reason are still present.
5. Return an explicit unchanged result such as:

```text
ok: false
changed: false
closed: false
retryable: false
suppressed: true
code: terminal_accounting_invariant_failed
reason: <stored concrete reason>
status: same_state_terminal_failure_suppressed
```

6. Do not call `runTableJanitor()` or any cleanup primitive for the suppressed attempt.
7. If the key differs or TTL expired, delete the stale entry before running the normal janitor path.
8. If the table is missing or persisted status is no longer `OPEN`, delete its entry.
9. After a normal result, store only a qualifying non-retryable terminal failure. A successful changed/closed result or changed state version, table status, or classification must leave no stale suppression record.

The automatic-trigger allow-list must be explicit:

- `stale_active_seat_sweep`;
- `zombie_table_sweep`;
- `open_table_reconciler`.

Do not broaden it to manual/admin calls, disconnect cleanup, join/leave, settlement rollover, or future unknown triggers.

### 4. Preserve concurrency semantics

Files:

- `ws-server/server.mjs`
- `ws-server/poker/runtime/table-command-queue.mjs` (inspection only; no change expected)

Keep `pendingTableJanitorEvaluationByTableId` and the per-table command queue. They already ensure that overlapping callers share the snapshot and that identical primitive keys share the in-flight command. Suppression is checked using the shared current state/classification key before a new mutation is scheduled.

When two automatic callers overlap on the first failing operation, they may both observe the same shared terminal result, but only one primitive execution is allowed. Both may attempt to record the identical map value; that write must be idempotent. Later matching calls before TTL expiry must not reach the primitive.

Do not serialize all tables globally and do not change trigger-dependent classification, routing, broadcasts, or successful caller results.

### 5. Use bounded observability

Files:

- `ws-server/server.mjs`
- reuse the existing `klogSafe()` pattern

For the first terminal attempt, retain the existing detailed invariant and janitor result logs. When suppression is first activated for a key, emit one terminal event containing only:

```text
tableId, stateVersion, status, handId, phase, code, reason
```

Do not emit one detailed log per suppressed sweep. Maintain aggregate process-local counters by trigger and reason and flush them at a bounded interval using the existing bot-autoplay observability style as a pattern, without coupling the two features. A shutdown flush is optional only if it can reuse existing controlled shutdown handling; do not add signal machinery solely for this issue.

Keep this observability minimal: one activation log and one simple periodic counter are sufficient; do not build a separate observability subsystem. The activation log and summary must not include the classification target, raw seat fields, account identifiers, user IDs, cards, full state, escrow maps, or per-user claims.

## Minimal regression tests

Do not add a framework or a new broad suite.

### `ws-server/server.behavior.test.mjs`

Extend the existing server harness with focused cases:

1. The first automatic sweep for a fixed OPEN state/classification key reaches the cleanup adapter and returns `terminal_accounting_invariant_failed`, `terminal_claims_mismatch`, `retryable:false`.
2. A second automatic sweep with the same state version, status, and classification before TTL expiry does not invoke the adapter again and returns the explicit suppressed result.
3. Changing state version invalidates suppression and permits one fresh attempt when the current classification still requires cleanup.
4. Changing table status, classification/action/reason code, or target user invalidates the old entry and follows the newly evaluated route without returning stale suppression.
5. TTL expiry permits one fresh attempt for an otherwise unchanged key and installs a new TTL only if the same qualifying failure returns.
6. A missing state version or classification component does not suppress.
7. Overlapping stale-seat and open-table triggers for one unchanged operation cause exactly one adapter/terminal attempt.
8. A normal conserved cleanup still invokes the adapter, closes once, and is not suppressed.

Use the existing injectable inactive-cleanup adapter and persisted-state fixture patterns. Do not reproduce ledger internals in the server test.

### `ws-server/poker/runtime/table-janitor.behavior.test.mjs`

Only if a small pure suppression predicate is placed in this existing module, add direct boundary assertions that:

- only the exact terminal-accounting/non-retryable/unchanged result qualifies;
- successful, changed, retryable, or unrelated failures do not qualify.

If the predicate remains local to `server.mjs`, keep this coverage in `server.behavior.test.mjs` instead of exporting implementation detail solely for testing.

Run the existing inactive cleanup suite, which exercises the terminal-close dependency, unchanged to prove fail-closed and conserved close behavior:

```bash
node --test shared/poker-domain/inactive-cleanup.behavior.test.mjs
```

```bash
node --test ws-server/poker/persistence/inactive-cleanup-adapter.behavior.test.mjs
```

```bash
node --test ws-server/poker/runtime/table-janitor.behavior.test.mjs
```

```bash
node --test ws-server/server.behavior.test.mjs
```

## WS Preview verification

Every WS-affecting implementation PR requires a manual `WS Preview Deploy` for the exact PR SHA.

1. Record the workflow run URL, exact requested SHA, completion time, and the matching `ws_artifact_start` SHA.
2. Confirm local and public `/healthz`.
3. Observe the known historical table or a safe fixture with the same non-retryable contract through at least two stale-seat intervals and two open-table intervals.
4. Confirm one initial `poker_terminal_accounting_invariant_failed` for its state/classification key.
5. Confirm no later terminal-close attempt or repeated detailed result for that key before TTL expiry.
6. Confirm the bounded suppression summary counts later automatic selections.
7. Confirm a manual admin attempt remains possible and still fails closed.
8. Change a safe preview fixture's presence/classification and confirm that the stale suppression is not returned.
9. Change the fixture's authoritative state version and confirm one fresh automatic attempt.
10. Verify TTL expiry with an injectable clock in automated coverage; do not wait 10 minutes or add a Preview-only runtime override solely for smoke testing.
11. Close a conserved stale table through the normal path and confirm exactly one close, correct cash-outs, escrow zero, and no duplicate ledger idempotency keys.
12. Confirm no unexpected `ws_table_janitor_*failed`, persistence conflict, duplicate settlement, duplicate close, or runtime error.

Do not repair or add chips to the historical table as part of this verification.

Representative one-line log query:

```bash
sudo journalctl -u ws-server-preview.service --since "<deploy time>" --no-pager | grep -E "ws_artifact_start|poker_terminal_accounting_invariant_failed|ws_table_janitor_result|ws_table_janitor_.*suppressed|ws_table_janitor_.*summary|ws_table_janitor_.*failed"
```

## Rollback

Revert the runtime commit and redeploy the previous known-good SHA. The registry is process-local, so rollback requires no schema, data, or cache migration. After restart, the old behavior resumes and the terminal guard remains fail-closed.

## Risks and breaking impact

- **Intended breaking diagnostic impact:** automatic janitor callers no longer execute or emit a full detailed result on every unchanged non-retryable terminal failure.
- **Delayed automatic retry after an out-of-band edit:** a direct seat or escrow change which preserves state version, status, and classification is not detected immediately. In the current application flows, join/rebuy/persistence advances state version, presence changes classification, close changes status, and approved historical recovery invokes the manual path. Any unsupported out-of-band edit is therefore delayed only until the 10-minute TTL; it is not converted into a mutation or accounting success.
- **Manual recovery risk:** a broad hook could block operator action. Mitigation: use an explicit automatic-trigger allow-list at the WS scheduler boundary; admin operations bypass it.
- **Memory growth risk:** historical table IDs could remain in a long-lived writer process. Mitigation: one bounded map, deletion on missing/closed/changed state, and oldest-entry eviction.
- **Concurrent trigger risk:** two first attempts could race before suppression is recorded. Mitigation: retain shared evaluation and per-table command dedupe; add an overlap regression case.
- **False success risk:** reporting suppression as `ok:true` could make callers believe cleanup completed. Mitigation: return `ok:false`, `changed:false`, `closed:false`, `suppressed:true`, and preserve the terminal code/reason.
- **Accounting risk:** none of the invariant, claim, settlement, cash-out, or ledger code is changed. Any proposal requiring such a change belongs outside this issue.

## Out of scope

- repairing, deleting, resetting, or closing the historical table;
- changing `terminal_claims_mismatch` or terminal claim calculation;
- adding missing chips or bypassing escrow conservation;
- changing stale-seat, zombie, or open-table sweep cadence;
- changing reconnect, persistence recovery, settlement, ledger, or terminal close behavior;
- caching live poker state;
- schema changes;
- a general retry, suppression, cache, or observability framework;
- browser JavaScript, JSP, CSS, and CSP changes.

## Notes

- This concerns critical realtime poker cleanup and accounting. The implementation must remain small and fail closed.
- WS/runtime remains authoritative for loaded live tables; persisted DB state is the authoritative comparison source for an unloaded historical table generation.
- Reuse `runEvaluatedTableJanitor()`, `pendingTableJanitorEvaluationByTableId`, `createTableCommandQueue()`, the existing adapter, and `klogSafe()`.
- Do not create a parallel janitor or terminal-close path.
- Log only through `klog`; never use `console.log`.
- Never log private cards, complete state, secrets, or per-user claim maps.
- JSP, CSS, and CSP are not applicable because no browser code is planned.
- The implementation PR must explicitly document the intended breaking impact on repeated automatic janitor diagnostics.
