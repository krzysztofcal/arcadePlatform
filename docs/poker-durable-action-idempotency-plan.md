# Poker WS durable action idempotency — implementation plan

Issue: [#377](https://github.com/krzysztofcal/arcadePlatform/issues/377)

Status: planning only. This document does not implement runtime, database, protocol, or client changes.

## 1. Goal and scope

Guarantee that one accepted human `ACT` command on a persistent poker table can produce at most one authoritative state transition, even when the response is lost and the same command is submitted after table eviction, authoritative restore, WS restart, or a race between WS workers.

The first implementation PR is deliberately server-only. It adds durable replay for accepted persistent human actions and preserves all current behavior for guest tables, bots, timeouts, rejected actions, and the browser client.

### In scope

- Store accepted persistent human `ACT` outcomes in `public.poker_requests`.
- Detect same-key/same-payload replay and same-key/different-payload conflict.
- Commit the durable result atomically with the `public.poker_state` compare-and-swap update.
- Restore speculative runtime state for a worker that loses the durable-request race.
- Keep the existing in-memory action cache unchanged for flows that still use it.

### Out of scope

- Automatic client retry after timeout or reconnect.
- Client, JSP, HTML, CSS, localization, or CSP changes.
- Durable idempotency for join, rebuy, leave, start-hand, bot, or timeout commands.
- Retention jobs, opportunistic cleanup, new timestamps, new indexes, or monitoring for `poker_requests`.
- Changes to poker rules, ledger, settlement, bot policy, or the WS frame schema.
- Making `poker_actions` audit writes mandatory.

## 2. Current architecture and gap

### Browser and protocol

- `poker/poker-v2.js::handleAction()` builds `{ handId, action, amount? }` and calls `sendCommand("sendAct", payload)`.
- `poker/poker-ws-client.js::sendCommand()` creates a `requestId`, stores a pending Promise in memory, and rejects it after timeout or socket close.
- The client does not automatically retransmit `act`; this remains unchanged.

### WS action flow

- `ws-server/poker/handlers/act.mjs::handleActCommand()` validates the command and calls `tableManager.applyAction()`.
- `ws-server/poker/table/table-manager.mjs::applyAction()` currently reads and writes `table.actionResultsByRequestId` using `userId + requestId`.
- The manager mutates runtime state before `ws-server/server.mjs::persistMutatedState()` calls `persisted-state-writer.mjs::writeMutation()`.
- `writeViaDb()` performs a version CAS on `public.poker_state`, persists required projections, and attempts action audit writes.
- Broadcast, settled rollover, and bot autoplay run only after persistence reports success.

### Residual gap

`actionResultsByRequestId` is process memory. `restoreTableFromPersisted()` clears it, eviction deletes it, and a WS restart loses it. A previously accepted request can therefore be evaluated again against a later state. The cache also has no payload-hash conflict contract.

### Existing durable table

`public.poker_requests` already provides:

- `table_id`, `user_id`, `request_id`, and `kind`;
- `result_json` and `created_at`;
- uniqueness on `(table_id, kind, request_id, user_id)`;
- `poker_requests_created_at_idx`;
- `ON DELETE CASCADE` from `public.poker_tables`.

It lacks only the payload hash required to distinguish replay from conflicting reuse. No retention work is justified in this PR.

## 3. Target contract

For one scoped identity `(tableId, kind="ACT", requestId, userId)`:

- no record means the handler may attempt a fresh action;
- the same normalized payload returns the previously committed result;
- a different normalized payload returns `idempotency_conflict`;
- an invalid durable record fails closed;
- the state CAS and final durable result commit together or both roll back;
- only a writer outcome of `committed` triggers gameplay side effects;
- `durable_replay`, `idempotency_conflict`, `invalid`, and `failure` never trigger gameplay side effects.

The durable result allowlist is:

```text
status
reason
handId
stateVersion
```

No snapshot, cards, session data, token, raw frame, or arbitrary reducer object is stored.

## 4. Task 1 — normalize and hash the action payload

### Files

- Add `ws-server/poker/idempotency/action-command.mjs`.
- Add a small colocated behavior/unit test using the existing Node test runner.

### Functions

- `normalizeActionCommand({ tableId, userId, handId, action, amount })`
- `hashActionCommand(normalizedCommand)`
- Optionally `projectDurableActionResult(result)` if it is used as the single allowlist boundary for `result_json`; otherwise keep this four-field projection local to the handler/writer.

### Normalized payload

The payload hash contains:

```text
kind = ACT
tableId
userId
handId
action
amount
```

`requestId` is deliberately excluded. It identifies the idempotency record and is already part of the unique key; it is not command payload.

Normalization rules:

- trim table, user, and hand identifiers;
- uppercase the action;
- require the currently supported human actions;
- use an integer amount only for `BET` and `RAISE`;
- normalize amount to `null` for `FOLD`, `CHECK`, and `CALL`;
- use stable field order and `node:crypto` SHA-256;
- do not include frame timestamps.

No new package is required.

## 5. Task 2 — minimal schema migration

### File

- Add one timestamped migration under `supabase/migrations/`, named for poker action request payload hashing.

### Change

```sql
alter table public.poker_requests
add column if not exists payload_hash text;
```

The column remains nullable so existing request kinds and historical rows remain compatible. Runtime code requires a non-empty hash for newly created `kind = 'ACT'` records.

Do not add:

- `completed_at` or `expires_at`;
- indexes;
- retention or deletion logic;
- changes to the current unique index.

## 6. Task 3 — durable request API and explicit outcomes

### Files and methods

- Extend `ws-server/poker/persistence/persisted-state-writer.mjs`.
- Wire the capability through `ws-server/server.mjs` into `handleActCommand()`.

### Read capability

Expose a DB-backed function such as:

```text
readDurableActionRequest({ tableId, userId, requestId, payloadHash })
```

It performs one point lookup by the existing unique key and returns exactly one outcome:

- `missing` — no row;
- `durable_replay` — matching hash and valid allowlisted `result_json`;
- `idempotency_conflict` — row exists with a different hash;
- `invalid` — malformed/missing hash, missing result, or invalid result shape;
- `failure` — DB/capability error.

`result_json = null` is not a separately exposed domain state. During a new writer transaction it is only a private reservation step and is invisible until commit. A visible ACT row without a final result is invalid and fails closed.

### Capability boundary

The handler must not infer durable support from `tableId` alone. `server.mjs` supplies an explicit capability, for example:

- `durableActionRequestsEnabled`, plus read/write functions; or
- presence of the read capability and writer support.

Rules:

- production persistent DB table without durable capability: fail closed before reducer mutation;
- guest table: use the existing in-memory flow;
- persisted file store, fixtures, or missing DB: never claim durable support; persistent human ACT fails closed when the durable contract is required;
- bots and timeout actions retain their existing flow.

## 7. Task 4 — handler and table-manager integration

### Table manager

Extend `ws-server/poker/table/table-manager.mjs::applyAction()` with one simple option, for example:

```text
useActionReplayCache: false
```

When false, `applyAction()` skips both the read and write of `actionResultsByRequestId`. It otherwise uses the current reducer unchanged.

Do not change the cache representation or add speculative-cache finalization. Guest tables, timeout actions, and all other current in-memory users keep the existing cache behavior.

### Handler

Update `ws-server/poker/handlers/act.mjs::handleActCommand()`:

1. Perform current frame validation.
2. Determine durable capability explicitly.
3. For persistent human ACT, normalize the payload and compute its hash without `requestId`.
4. Execute the point lookup before `tableManager.applyAction()`.
5. Return stored result for `durable_replay` without reducer or persistence.
6. Return `idempotency_conflict` or controlled invalid/failure result without reducer.
7. For `missing`, call `applyAction(..., useActionReplayCache: false)`.
8. For an accepted reducer result, pass a closed `durableActionRequest` object to persistence.
9. Run broadcast, rollover, and bot scheduling only when persistence returns `outcome: "committed"`.

Rejected domain actions remain non-durable. Protocol errors, illegal actions, hand mismatch, not-seated results, CAS conflicts, DB failures, and rollbacks do not reserve a lasting request identity.

## 8. Task 5 — atomic reserve, CAS, and finalization

### Signatures

Extend:

- `ws-server/server.mjs::persistMutatedState()`;
- `persisted-state-writer.mjs::writeMutation()`;
- `persisted-state-writer.mjs::writeViaDb()`.

Add the optional closed property:

```text
durableActionRequest:
  userId
  requestId
  payloadHash
  result
```

### Transaction flow

Within the existing `beginSql()` transaction:

1. Attempt to insert the scoped ACT row with `payload_hash` and temporary `result_json = null`.
2. If inserted, perform the existing `poker_state.version` CAS.
3. On CAS success, perform existing required state projections and ledger-related work for that mutation.
4. Preserve the current best-effort action-audit behavior: `poker_actions` failure is logged with `klog` and does not become a new rollback condition.
5. Finalize the ACT row with the allowlisted `result_json` using all identity fields and `payload_hash` in the `WHERE` clause.
6. Require exactly one updated row; otherwise throw and roll back.
7. Commit the state and durable ACT together.

The final update must be scoped by:

```text
table_id
kind = ACT
request_id
user_id
payload_hash
```

If CAS or another already-required persistence step fails, the reservation disappears with transaction rollback.

### Durable ACT must bypass the equal-state fallback

`persisted-state-writer.mjs::writeViaDb()` currently handles a failed CAS by loading the authoritative row and comparing it with `nextState`. For existing mutation kinds, equal state may return `alreadyApplied: true` to tolerate an ambiguous persistence result.

That fallback is not proof that a particular ACT request caused the state transition. For a mutation carrying `durableActionRequest`, it must therefore be disabled locally:

- only a successful CAS performed after this transaction reserved a new ACT row may return `committed`;
- a failed CAS must roll back the newly reserved ACT row and return `failure`/state conflict;
- equal authoritative state must not convert that failure into `committed` or `durable_replay`;
- `durable_replay` may come only from an ACT row that already existed, has the same payload hash, and contains a valid final `result_json`;
- the existing equal-state/`alreadyApplied` behavior remains unchanged for mutation kinds without `durableActionRequest`.

This is a conditional branch in the existing writer, not a global removal or refactor of the fallback.

### Writer outcomes

`writeMutation()` must return an explicit `outcome` rather than making every successful return look like a fresh commit:

- `committed` — this invocation committed the new state and durable result;
- `durable_replay` — an existing matching request won the race;
- `idempotency_conflict` — the scoped key exists with another payload;
- `invalid` — durable evidence is malformed;
- `failure` — CAS, configuration, or persistence failed.

Only `committed` may be treated as permission for gameplay side effects.

## 9. Task 6 — race loser and authoritative restore

Two workers may both observe `missing` before either transaction commits. The unique key and transaction serialize the winner:

- winner reserves ACT, performs CAS, finalizes result, and returns `committed`;
- loser observes the committed row and returns `durable_replay` or `idempotency_conflict` without CAS.

The loser may already have applied a speculative reducer mutation locally. In that post-reducer race path, `handleActCommand()` must:

1. call `restoreTableFromPersisted(tableId)` directly;
2. avoid `recoverFromPersistConflict()`, because it broadcasts after successful restore;
3. perform no gameplay broadcast, bot scheduling, rollover, ledger action, or second audit;
4. return the stored result only after restore succeeds.

If restore fails:

- do not return `accepted`, even if durable evidence says accepted;
- send a controlled error/resync-required response;
- leave all gameplay side effects disabled;
- do not present speculative local runtime as authoritative.

## 10. Verification

Use existing Node and WS test patterns; do not create a new framework.

### Hash/normalization

- Same normalized payload produces the same hash.
- Changing hand, action, or amount changes the hash.
- Changing only `requestId` does not change the hash.
- Non-amount actions normalize amount to `null`.
- Invalid amounts/actions fail validation.

### Handler and manager

- Pre-lookup replay bypasses reducer and persistence.
- Payload conflict returns `idempotency_conflict`.
- Persistent human ACT calls `applyAction()` with runtime replay cache disabled.
- Guest and timeout flows retain current cache behavior.
- Only `committed` triggers broadcast, bots, and rollover.
- Race replay/conflict restores without broadcast or side effects.
- Restore failure is fail-closed and never returns accepted.

### Writer/transaction integration

- ACT reservation, state CAS, and final result commit atomically.
- CAS failure or rollback leaves no durable success row.
- For durable ACT, a failed CAS followed by equal authoritative state still returns failure and rolls back the reservation.
- Equal-state fallback remains available for existing non-durable mutation kinds.
- Durable replay is returned only from a pre-existing, valid ACT row, never inferred from state equality.
- Final result update must affect exactly one matching row.
- Same key/hash after a new writer instance returns durable replay.
- Same key with another hash returns conflict.
- Two concurrent transactions produce one committed mutation and one replay/conflict outcome.
- Normal successful flow writes at most one action audit.
- An injected audit failure retains existing best-effort semantics: committed state and ACT remain valid.

### Restore wiring

- After table restore, the handler reads the DB result and bypasses reducer.
- This wiring test complements rather than duplicates the writer-restart durability test.

No client test is added or modified because client code and retry behavior are unchanged. The full existing suite still runs in CI.

## 11. Deployment and manual verification

### Stage

1. Apply the additive migration to stage.
2. Deploy WS Preview; Netlify Deploy Preview is not required for this server-only change.
3. Submit a valid human action with a captured request ID.
4. Repeat the same ID and payload; verify the original accepted outcome and no second state transition/audit/side effects.
5. Restart WS Preview or evict/restore the table and repeat again.
6. Submit the same ID with a different action or amount; verify `idempotency_conflict`.
7. Exercise a normal guest table and bot/timeout flow to confirm unchanged behavior.

### Production

1. Apply the migration before deploying the new WS code.
2. Deploy production WS.
3. Smoke one fresh action and controlled replay without enabling browser auto-retry.
4. Monitor `klog` persistence, restore, conflict, and invalid-record events.

Rollback to the previous WS version is safe because the schema change is additive. Do not roll back the nullable column during an application rollback.

## 12. Acceptance criteria

- A committed persistent human action replays after reconnect, restore, eviction, and WS restart without another mutation.
- Same scoped key with a different payload returns `idempotency_conflict`.
- State CAS and durable ACT result are atomic.
- A failed durable ACT CAS cannot become `committed` or `durable_replay` through the writer's equal-state/`alreadyApplied` fallback.
- A two-worker race produces one state commit.
- Race loser restores authoritative state without gameplay broadcast or side effects.
- Only `outcome: "committed"` triggers broadcast, bot scheduling, and rollover.
- Persistent DB tables fail closed when durable capability is unavailable.
- Guest, bot, timeout, ledger, settlement, and client retry behavior remain unchanged.

## 13. Breaking impact

The sole intentional behavioral change is that a previously accepted `requestId` reused with a different normalized payload returns `idempotency_conflict` instead of being re-evaluated or receiving an unrelated cached result.

Operational impact:

- an additive database migration must precede the WS deployment;
- persistent human actions require the durable DB capability;
- file-store or misconfigured persistent runtime cannot silently claim the durable guarantee.

No breaking change applies to poker rules, WS frame shape, guest tables, timeout actions, bots, client retry, ledger, settlement, JSP, CSS, or CSP.

## 14. Future follow-up

After the durable server contract is deployed and production-verified, a separate issue/PR may preserve one pending action request across response loss and perform a controlled browser retry. Retention or cleanup of `poker_requests` should be considered only if measured table growth becomes an operational problem.
