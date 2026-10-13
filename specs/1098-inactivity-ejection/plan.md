# Implementation Plan #1098

## Technical context
Existing Node ESM WS authority, shared poker-domain transaction executors, plain JSP-compatible browser JS. Source spec.md and issue #1098 binding clarifications.

## Constitution Check: PASS
Only existing critical deterministic tests are extended. No UI/CSS/JSP suites, new frameworks, dependency/config/ignore changes or migrations. Financial ambiguity fails closed; no environment writes or deploy. Owner implementation GO already supplied; deployment requires separate GO.

## Implementation
1. Reproduce existing two-timeout sit-out with engine-timeout.behavior.test.mjs and read-model regression; inspect Leave, deferred settlement and terminal-close invariants.
2. Extend netlify/functions/_shared/poker-inactivity-policy.mjs and ws-server/poker/engine/poker-engine.mjs timeout policy with trusted mode. Persist inactivityEjectionByUserId; block human actions after intent, preserve tombstone across buildNextHandStateFromSettled. table-manager.mjs rejects unknown UUID mode.
3. Reuse authoritative-leave-adapter.mjs and shared/poker-domain/leave.mjs with trusted inactivity option verified against persisted intent. Close last human STANDARD irrespective of connected ejected socket; preserve CONTINUOUS_BOT. Retry via existing sweeps and settled rollover through handlers/leave.mjs::reconcileInactivityEjectionsCommand, invoked only after timeout persistence. Keep retained live claims until finalizer. Register ws_inactivity_ejection_pending in existing ws-server/poker/observability/poker-log-policy.mjs as WARN/recovery (mandatory WS log policy guard).
4. Extend room-core-snapshot.mjs and state-snapshot.mjs private branch for EJECTION_PENDING/REMOVED and reason. Retain pending avatar until accounting resolution. shared/poker-domain/join.mjs rejects tombstoned users before debit and preserves pre-threshold counts on funded Resume (transport is not a human decision). poker/poker-v2.js locks preactions/auto-JOIN and reuses sticky 5s redirect. netlify/functions/poker-progression.mjs returns per-user authoritative intent/completion for reload even on CLOSED tables and filters terminal users from lobby Resume; existing endpoint tests verify pending versus confirmed.
5. Extend existing fundamental timeout, Leave/accounting, reconnect snapshot tests; run focused tests then required repository/CI checks. Independently review ledger/escrow and race conditions.
6. Publish Draft PR with final SHA and prepare exact-SHA WS Preview command/checklist, without executing deployment. Keep manual runtime verification pending.

## Breaking impacts
Online sit-out after two misses becomes terminal cash-out/seat release; Single Player threshold becomes three then closes. Additive private protocol status/reason. No schema or economic-rule change. Rejoining the same terminally exited table is denied; other tables remain available. Missing nonnumeric deadlines fail closed (fixes Number(null)=0); standard 20s remains unchanged.

## Owner review correction plan
1. `ws-server/poker/table/table-snapshot.mjs::loadSnapshotInTx`: remove timeout derivation/CAS/audit mutation and mutation-only imports/helper; keep projection/hole-card reads. Replace obsolete HTTP timeout-parity test in `table-snapshot.behavior.test.mjs` with Online/SP expired-deadline read-only regressions (unchanged version/count/intent, zero writes). Update the existing ws-tests/ws-server-package-runtime-deps.guard.test.mjs snapshot import expectations to remove obsolete card-identity/state-write dependencies and require absence of snapshot timeout mutation. Remove the now-orphaned ws_table_snapshot_timeout_apply_skipped entry from existing poker-log-policy.mjs to satisfy event coverage guard.
2. `authoritative-join-adapter.mjs`: preserve `removed_for_inactivity` as expected rejection. Existing adapter and JOIN handler tests cover the actual adapter-to-WS result chain.
3. `poker/poker-v2.js`: clear inactivity exit/countdown only at logout or changed identity before technical teardown; retain same-account recovery. Extend existing fundamental auth/reconnect behavioral test with no presentation/layout assertions.
4. `handlers/leave.mjs`: select pending inactivity Leave entries using existing retained seat/stack plus deferred-left semantics. Use selection in timeout sweep and reconciliation so completed historical tombstones and already-deferred hand claims generate no empty queue work. Existing settled finalizer/retry remains authoritative for deferred claims. Extend existing Leave/recovery tests.
5. Run focused Online/SP financial/reconnect suites, full required CI and independent subagent review. Update Draft PR description and exact-SHA instructions; do not deploy.

Constitution recheck: only fundamental read-only/persistence, rejection/auth isolation, lifecycle/recovery tests in existing files. No UI/CSS/JSP/layout suite or framework; unchanged economic rules, blinds and timer.
