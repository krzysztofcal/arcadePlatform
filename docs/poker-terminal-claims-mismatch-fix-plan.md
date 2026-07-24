# Poker terminal claims mismatch — analysis and fix plan

## Metadata

- Issue: `#748`
- Repository: `krzysztofcal/arcadePlatform`
- Analysed `origin/main`: `c077298e1605f48c768a677e928af68e49c8f3f3`
- Analysis date: `2026-07-24`
- Environment inspected: WS Preview / stage Supabase
- Scope: stale live-hand terminal close, settled-hand rollover/bootstrap, terminal claims, historical recovery
- Runtime code changed by this document: none

## Executive conclusion

The two blocked preview tables expose two separate defects which converge on the same correct terminal guard:

1. A valid live-hand state cannot be terminally closed because terminal claims include only `state.stacks` and omit chips committed in `state.potTotal` / `state.contributionsByUserId`.
2. A join arriving while a hand is `SETTLED` can bypass the dedicated settled rollover and start a new hand through the generic bootstrap path. That bootstrap reads `coreState.publicStacks`, which is not the authoritative full-table poker balance. In the observed case it persisted 585 chips instead of the authoritative settled total of 600.

`terminal_claims_mismatch` is not the source of either defect. It correctly prevents cash-outs and table close when terminal claims do not equal escrow. It must not be weakened or bypassed.

## Evidence from WS Preview

### Commands used

All observations were read-only:

```text
sudo journalctl -u ws-server-preview.service --since '2026-07-23 21:50:30' --no-pager
sudo journalctl -u ws-server-preview.service --since '2026-07-24 00:00:00' --no-pager
```

The stage database was queried read-only for `poker_tables`, `poker_state`, `poker_seats`, `poker_actions`, `chips_accounts`, `chips_transactions`, and `chips_entries`.

### Current blocked tables

| Table | State | Stack claims | Pot | Escrow | Failure |
|---|---:|---:|---:|---:|---|
| `ec3f4897-c7bb-4d92-b63d-a38401e9a5c4` | `PREFLOP`, v30 | 590 | 10 | 600 | `terminal_claims_mismatch` |
| `7af59a48-5804-4c78-b8c3-d81e5e721d6c` | `SETTLED`, v159 | 585 | 0 | 600 | `terminal_claims_mismatch` |

Both tables are repeatedly selected by `stale_active_seat_sweep` and `open_table_reconciler`. Snapshot evaluation may be coalesced, but each janitor caller can still reach its own failed cleanup result. The accounting guard leaves the tables open and produces no cash-out, settlement, close, or ledger mutation.

## Root cause A — active pot omitted from terminal claims

### Reproduction

Affected table:

- table ID: `ec3f4897-c7bb-4d92-b63d-a38401e9a5c4`;
- hand ID: `ws_hand_ec3f4897-c7bb-4d92-b63d-a38401e9a5c4_25_6`;
- state version: 30;
- phase: `PREFLOP`;
- stack sum: 590;
- `potTotal`: 10;
- contribution sum: 10;
- escrow: 600.

The persisted state is conserved:

```text
590 stacks + 10 committed contributions = 600 escrow
```

Representative logs:

```text
[klog] ws_table_janitor_classified {"tableId":"ec3f4897-c7bb-4d92-b63d-a38401e9a5c4","classification":"stale_human_seat","action":"stale_seat_cleanup","reasonCode":"stale_human_last_seen_expired"}
[klog] poker_inactive_cleanup_stale_live_hand_closing {"tableId":"ec3f4897-c7bb-4d92-b63d-a38401e9a5c4","phase":"PREFLOP","staleReason":"table_activity_stale"}
[klog] poker_terminal_accounting_invariant_failed {"tableId":"ec3f4897-c7bb-4d92-b63d-a38401e9a5c4","reason":"terminal_claims_mismatch","stateVersion":30,"escrowBefore":600,"totalClaims":590}
```

### Confirmed call flow

1. `ws-server/server.mjs::runEvaluatedTableJanitor()` classifies the human seat as stale.
2. `ws-server/poker/runtime/table-janitor.mjs::runTableJanitor()` routes `stale_seat_cleanup`.
3. `ws-server/poker/persistence/inactive-cleanup-adapter.mjs` calls `shared/poker-domain/inactive-cleanup.mjs::executeInactiveCleanup()`.
4. `executeInactiveCleanup()` identifies an expired live hand and, with no remaining connected human, calls `executeTerminalPokerCloseInTx()`.
5. `shared/poker-domain/terminal-close.mjs::classifyClaims()` builds claims only from positive values in `state.stacks`.
6. `executeTerminalPokerCloseInTx()` compares 590 claims with 600 escrow and correctly returns `terminal_claims_mismatch`.

### Exact cause

The terminal close contract assumes that all escrow is already represented in stacks. That assumption is valid for a fully settled state, but false for an action-phase state. During a live hand, committed blinds and bets have already been deducted from stacks and are represented by `potTotal` and `contributionsByUserId`.

This is not:

- stale persisted state;
- an incorrect escrow balance;
- missing buy-in funding;
- a bad seat-row stack;
- a test-harness-only condition;
- a failed showdown.

## Root cause B — join bootstrap corrupts a settled state

### Timeline

Affected table:

- table ID: `7af59a48-5804-4c78-b8c3-d81e5e721d6c`;
- valid settled hand: `ws_hand_7af59a48-5804-4c78-b8c3-d81e5e721d6c_60_6`;
- valid settlement version: 85;
- corrupting bootstrap persisted as version 86;
- first corrupt hand: `ws_hand_7af59a48-5804-4c78-b8c3-d81e5e721d6c_85_6`;
- final observed state: version 159, `SETTLED`.

The audit trail proves that the first three hands settled with full conservation:

| Settled hand | Stack sum before payout | Payout | Settled total |
|---|---:|---:|---:|
| `_1_6` | 540 | 60 | 600 |
| `_37_6` | 575 | 25 | 600 |
| `_60_6` | 565 | 35 | 600 |

The next hand and all later hands operate on 585:

| Settled hand | Stack sum before payout | Payout | Settled total |
|---|---:|---:|---:|
| `_85_6` | 568 | 17 | 585 |
| `_108_6` | 373 | 212 | 585 |
| `_139_6` | 575 | 10 | 585 |

At version 85 the authoritative settled stacks were:

| User | Settled stack |
|---|---:|
| `fe9449cf-23fe-5047-971f-ab5d61b02800` | 78 |
| `7339c05e-5068-4ad1-a449-5f7b3bb8f2e0` | 85 |
| `5f6b991e-9270-52d2-9ab1-9cc3300a0699` | 163 |
| `09a48683-d872-5ba7-9b19-107573719101` | 78 |
| `0465a398-bb2b-57ff-9fde-2e95cf85cd81` | 78 |
| `e8b0cdcb-3a18-5f41-bccc-2f1d200b6e17` | 118 |
| **Total** | **600** |

Immediately after settlement:

```text
[klog] ws_settled_rollover_scheduled {"tableId":"7af59a48-5804-4c78-b8c3-d81e5e721d6c","delayMs":3761,"mode":"reveal"}
[klog] ws_join_authoritative_start {"tableId":"7af59a48-5804-4c78-b8c3-d81e5e721d6c","userId":"7339c05e-5068-4ad1-a449-5f7b3bb8f2e0"}
[klog] ws_join_restore_start {"tableId":"7af59a48-5804-4c78-b8c3-d81e5e721d6c"}
[klog] ws_state_persist_start {"tableId":"7af59a48-5804-4c78-b8c3-d81e5e721d6c","expectedVersion":85,"mutationKind":"bootstrap"}
```

The corrupt hand started from these effective bootstrap inputs:

```text
human 85 + five bots at 100 each = 585
```

The first-action audit confirms bot stacks of 100, the human stack of 85, and normal blind deductions. No ledger transaction funded or withdrew the 15-chip difference. Escrow therefore remained 600.

### Confirmed call flow

1. The hand settles at v85 and `maybeScheduleSettledRollover()` schedules the dedicated rollover after the reveal delay.
2. A reconnecting client sends `join` during that delay.
3. `ws-server/poker/handlers/join.mjs::handleJoinCommand()` attaches the user and unconditionally calls `tableManager.bootstrapHand()`.
4. `tableManager.bootstrapHand()` uses `asLiveHandState()`, which recognizes only `PREFLOP`, `FLOP`, `TURN`, and `RIVER`.
5. `SETTLED` is therefore treated as if no hand exists.
6. `bootstrapCoreStateHand()` starts a fresh hand using `coreState.publicStacks`.
7. `publicStacks` is a public/runtime projection, not authoritative full-table settled poker state. Normal rollover projects human stacks but does not make it an authoritative replacement for all bot stacks.
8. The generic bootstrap persists v86 before the scheduled settled rollover executes.

### Exact cause

This is an incorrect stack projection caused by a lifecycle race between generic join bootstrap and the dedicated settled rollover. The settlement reducer did not lose the 15 chips: the preceding settlement audit proves a total of 600. The corrupting write occurred in `mutationKind:"bootstrap"` after settlement.

The final v159 showdown also settled its own 10-chip pot correctly. It merely preserved the already-corrupt total of 585.

## Required safety properties

Every implementation must preserve all of the following:

- WS/persisted poker state is authoritative for poker stacks; `poker_seats.stack` and `publicStacks` are projections.
- Escrow and terminal claims must match exactly before any cash-out.
- `terminal_claims_mismatch` remains fail-closed.
- A live hand must have a deterministic terminal disposition before close.
- No private cards or complete state may be logged.
- No cash-out, settlement, table close, or ledger movement may occur twice.
- Durable request and ledger idempotency must remain intact.
- A reconnect during `SETTLED` must not start a competing hand.
- A process restart must not change the selected terminal policy.
- Guest tables remain DB-free.
- Logging uses `klog` only.

## Proposed implementation sequence

The work should be split by failure mode. Do not combine prevention, terminal accounting, and historical recovery in one PR.

### PR A — prevent generic bootstrap from replacing a settled state

#### Goal

Make `SETTLED` ownership explicit: only the existing settled-rollover path may create the next hand.

#### Files and methods

- `ws-server/poker/engine/poker-engine.mjs`
  - `bootstrapCoreStateHand()`
  - `buildNextHandStateFromSettled()`
- `ws-server/poker/table/table-manager.mjs`
  - `bootstrapHand()`
  - `prepareSettledHandRollover()`
  - `commitSettledHandRollover()`
- `ws-server/poker/handlers/join.mjs`
  - `handleJoinCommand()`
- `ws-server/poker/handlers/start-hand.mjs`
  - `handleStartHandCommand()`
- `ws-server/server.mjs`
  - existing `maybeScheduleSettledRollover()`
  - existing handler dependency wiring

#### Minimal change

1. Make `bootstrapHand()` return an explicit unchanged result such as `settlement_pending` when `coreState.pokerState.phase === "SETTLED"`.
2. Do not call `bootstrapCoreStateHand()` for `SETTLED`.
3. Preserve join success and the settled snapshot; schedule the existing settled rollover rather than creating another hand.
4. Make explicit start-hand requests return a stable `settlement_pending` rejection until rollover completes.
5. Keep guest behavior aligned, but do not introduce persistence or a second rollover implementation.
6. Before adding a conservation check around `buildNextHandStateFromSettled()`, locate the existing rollover, persistence, and replacement-funding validation. Add a transition check only if no equivalent validation exists and it can reuse existing safe arithmetic and funding receipt logic without duplicating accounting rules. Otherwise keep PR A limited to the `SETTLED` lifecycle guard and establish conservation through existing suites and WS Preview smoke evidence.

#### Must not change

- reveal delay;
- autoplay;
- reconnect grace;
- table presence;
- bot replacement funding;
- human stack projection receipt;
- settlement rules;
- ledger logic.

#### Verification using existing coverage

Reuse the existing behavior-test infrastructure and add one focused regression case to `ws-server/server.behavior.test.mjs`. The case must drive a join while the restored table is `SETTLED` and assert all three parts of the repaired contract:

- generic bootstrap is not invoked;
- no persistence call uses `mutationKind: "bootstrap"`;
- the existing settled-rollover path creates exactly one next hand.

Do not create a new test file or framework. If the server harness cannot directly expose whether `bootstrapHand()` returned `settlement_pending`, add only the narrow boundary assertion to the existing `ws-server/poker/table/table-manager.behavior.test.mjs`; do not duplicate the end-to-end scenario in handler, manager, and server suites.

Run the existing engine rollover, table-manager, join/start-hand, persistence, and server suites. The exact-SHA WS Preview smoke must additionally prove that join remains accepted, the settled snapshot survives reconnect/restart, no `mutationKind: "bootstrap"` is persisted during `SETTLED`, and exactly one rollover occurs.

#### Rollback

Revert the lifecycle guard. No schema or data rollback is required.

### PR B — terminally cancel a stale live hand by refunding committed contributions

#### Goal

Define a deterministic, restart-safe terminal policy for stale action-phase hands without requiring private-card recovery or speculative showdown.

#### Policy

When a stale live hand must be terminally closed, cancel the hand and refund each participant's own committed contribution into that participant's terminal claim:

```text
terminal claim = authoritative stack + authoritative contribution
```

This is not a poker settlement and does not select a winner. It is a terminal cancellation used only when the whole table is being closed.

#### Files and methods

- `shared/poker-domain/terminal-close.mjs`
  - `classifyClaims()`
  - `executeTerminalPokerCloseInTx()`
  - add one narrowly scoped pure helper for phase-aware terminal claim projection
- `shared/poker-domain/inactive-cleanup.mjs`
  - preserve the existing routing into terminal close
- existing WS mirror/import path under `ws-server/shared/poker-domain/`
  - do not create a second implementation

#### Validation before refund projection

For action phases:

- `stacks` and `contributionsByUserId` must be valid non-negative integer maps;
- build the claimant set from the union of identifiers in `stacks` and `contributionsByUserId`, rather than iterating only over `stacks`;
- after an identifier enters that union, treat its missing stack or contribution as zero;
- include `stack + contribution` even when stack is zero, including an all-in participant;
- every positive contribution or projected claim must map unambiguously through state seats and locked seat rows to one human or bot beneficiary; reject an unresolvable identity;
- derive one canonical pot total from the present field; when both `pot` and `potTotal` exist, normalize and require them to be equal rather than silently preferring either value;
- `sum(contributionsByUserId)` must equal the validated canonical pot total;
- `sum(stacks) + canonical pot total` must equal escrow;
- side-pot data, if present, must not contradict total contributions;
- no existing settlement for another hand may be accepted;
- use the existing `addSafe()` mechanism for every per-user `stack + contribution` calculation and for aggregate totals.

For `SETTLED` and other non-live terminal states:

- require zero unresolved `potTotal` / `pot` before using stack-only claims;
- treat a retained `contributionsByUserId` map as historical hand metadata and do not add it to claims after settlement;
- do not use the refund projection to conceal an already-corrupt settled state.

#### Terminal mutation

Reuse the existing terminal-close transaction:

- build phase-aware human and bot claims before posting any movement;
- include folded participants because this is cancellation of the whole hand, not poker settlement;
- use the existing human and bot cash-out functions and idempotency keys;
- retain proven bot funding-source resolution;
- require final escrow balance zero;
- write the inert `HAND_DONE` state and close the table atomically;
- emit a single `klog` identifying terminal cancellation policy and aggregate amounts, without cards or full state.

#### Must not change

- `terminal_claims_mismatch`;
- normal showdown or settlement;
- regular leave during a live hand;
- partial-table cleanup with another active human;
- seat-row stack authority;
- bot funding provenance.

#### Verification using existing coverage

Reuse `shared/poker-domain/inactive-cleanup.behavior.test.mjs` and its existing stale-live-hand harness. Add only these two focused regression cases:

1. A stale live hand projects terminal claims as `stack + own contribution`, including an all-in participant present only through a positive contribution with stack `0`, and the conserved claims close the table once.
2. An inconsistent snapshot, such as contributions not matching the canonical pot or total claims not matching escrow, remains fail-closed before any cash-out, ledger movement, or table close.

Do not create a direct-test-only copy of `classifyClaims()`, a new framework, or a broad matrix of phases, side pots, identities, and malformed fixtures. Run the existing terminal-close path through the inactive-cleanup harness, then run the existing inactive-cleanup, bot-cashout, ledger, and persistence-conflict suites.

The exact-SHA WS Preview smoke must still prove the non-zero-pot cancellation, contribution refund, zero escrow, exactly one close, no duplicate ledger effects, and aggregate-only logging without per-user claim maps, private cards, or full state.

#### Rollback

Revert the phase-aware claim projection. The existing fail-closed behavior returns immediately; no schema rollback is required.

### Runbook C — historical-state recovery, only after PR A and PR B

#### Goal

Resolve already affected tables without teaching runtime code to guess missing ownership. This is not a normal runtime PR by default.

#### Rules

- Do not automatically add `escrow - stackClaims` to an arbitrary player or system account.
- Do not weaken terminal close to drain a residual into treasury.
- Do not use current `poker_seats.stack` as authority.
- Do not create a general repair framework.
- Start with a documented, manually approved runbook. Add a one-off tool only if direct manual execution would be less safe; restrict it to explicit table IDs, a read-only preflight/dry run, and per-table approval.
- Do not add a daemon path, generic recovery endpoint, or automatic balancing behavior.

#### Recovery classes

1. Valid live state such as `ec3f…`: after PR B, allow the normal janitor to execute the verified terminal-cancellation policy.
2. Corrupt settled state such as `7af…`: keep fail-closed until an explicit recovery decision is approved.

For a corrupt settled state, perform a read-only preflight using:

- the last known conserved settlement audit;
- subsequent accepted action audits in version order;
- deterministic hand IDs/seeds;
- persisted hole-card availability where replay requires it;
- escrow and ledger history;
- seat/bot identity and funding provenance.

Only if a deterministic replay reproduces every accepted action and settlement may a one-off recovery operation replace the corrupt state with the replayed conserved state and then invoke normal terminal close. Otherwise the table remains blocked for manual accounting review.

For WS Preview test data, explicit deletion or reset after preserving the evidence may be preferable to production-style replay. Record it as test-environment cleanup; do not build a complex replay path solely for Preview and do not turn it into application behavior.

## Verification strategy

### Existing automated suites

Keep using the existing suites and add only the focused PR A and PR B regression cases identified above:

- `ws-server/poker/engine/engine-rollover.behavior.test.mjs`;
- `ws-server/poker/table/table-manager.behavior.test.mjs`;
- `ws-server/poker/handlers/join.behavior.test.mjs`;
- existing start-hand behavior tests;
- `shared/poker-domain/inactive-cleanup.behavior.test.mjs`;
- existing terminal-close / bot-cashout tests;
- persistence conflict and restart/recovery suites;
- server behavior tests.

Do not add new test files, frameworks, generalized fixture layers, or broad coverage unrelated to the two confirmed defects. The existing-suite results, the minimal regression cases, and exact-SHA smoke evidence must establish:

- `sum(stacks) + potTotal` is conserved by actions and rollover;
- confirmed replacement funding is the only rollover-time increase;
- terminal claims equal escrow before the first ledger write;
- escrow becomes exactly zero after terminal close;
- one cash-out per claim;
- one close;
- no duplicate ledger movement;
- a failed attempt leaves state, seats, table, and escrow unchanged.

### WS Preview

Every PR touching `ws-server/**` requires manual **WS Preview Deploy** for its exact SHA.

PR A smoke:

1. Finish a hand and reconnect during the reveal window.
2. Confirm no `mutationKind:"bootstrap"` occurs while phase is `SETTLED`.
3. Confirm exactly one `settled_rollover`.
4. Confirm conservation remains equal to escrow across at least two subsequent hands.
5. Restart WS during `SETTLED` and repeat.

PR B smoke:

1. Create a table through the existing endpoint and fund it normally.
2. Stop in an action phase with a non-zero pot.
3. Remove connected presence and allow stale cleanup.
4. Confirm terminal cancellation refunds contributions and closes once.
5. Confirm escrow zero, table closed, seats inactive, and no duplicate ledger keys.
6. Confirm no `ws_table_janitor_*failed` for the table.

### Log commands

Use one-line commands and `grep`:

```text
sudo journalctl -u ws-server-preview.service -f | grep -E 'ws_state_persist_start|ws_settled_rollover_|poker_terminal_|ws_table_janitor_'
sudo journalctl -u ws-server.service -f | grep -E 'ws_state_persist_start|ws_settled_rollover_|poker_terminal_|ws_table_janitor_'
```

## Rollout order

1. Merge PR A first to stop creation of new corrupt settled states.
2. Verify PR A on Preview through reconnect and restart during `SETTLED`.
3. Merge PR B only after the existing suites pass and exact-SHA smoke evidence validates the refund policy and conservation invariants.
4. Verify PR B against a newly created non-zero-pot stale hand on Preview.
5. Inspect stage and production for existing mismatches before enabling any recovery.
6. Execute Runbook C only for explicitly approved table IDs.

## Risks and breaking impact

### PR A

- Breaking impact: explicit start-hand during `SETTLED` will return `settlement_pending` instead of starting a competing hand.
- A missing rollover schedule could leave a table settled. Mitigation: reuse and explicitly invoke `maybeScheduleSettledRollover()`.
- An overly broad guard could block legitimate initial bootstrap. Restrict it to explicit lifecycle phases.

### PR B

- Breaking impact: stale terminal cleanup of a live hand becomes a cancellation/refund, not a showdown.
- A wrong contribution map could misattribute chips. Require exact map, identity, pot, and escrow equality.
- All-in and side-pot states require strict total validation.
- Any uncertainty remains fail-closed.

### Historical recovery

- Breaking impact: an approved recovery may directly change historical persisted state and ledger data.
- Replaying from incomplete audit/private data could create a false ownership assignment.
- A one-off state write can conflict with a running janitor.
- Recovery must be isolated, version-checked, transactional, and approved per table.
- No historical recovery should run concurrently with normal table mutation.

## Out of scope

- changing normal poker winners or payout rules;
- weakening terminal conservation;
- caching live poker state;
- changing reconnect or stale thresholds;
- changing janitor cadence or coalescing;
- changing ledger schema;
- broad poker-engine refactoring;
- automatic generic repair of arbitrary corrupt states;
- modifying PR #747.

## Notes

- This is critical realtime poker and ledger logic. Keep changes small and independently reviewable.
- Reuse existing reducer, rollover, persistence, terminal-close, and idempotency paths.
- Do not create a duplicate autoplay, rollover, settlement, or cash-out implementation.
- WS remains the runtime authority; persisted poker state is recovery authority; DB projections are secondary.
- Use `klog` only. Never log private cards, complete state, tokens, connection strings, or secrets.
- No browser JavaScript, JSP, CSS, or CSP change is expected. If future scope introduces browser script, preserve JSP compatibility and update the CSP SHA as required.
- Add only the minimal regression cases specified for PR A and PR B, inside the named existing behavior-test files. Do not expand this into broad coverage or introduce a test framework. Continue to run the existing suites and exact-SHA WS Preview smoke tests.
