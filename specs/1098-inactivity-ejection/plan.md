# Implementation Plan #1098

## Technical context
Existing Node ESM WS authority, shared poker-domain transaction executors, plain JSP-compatible browser JS. Source spec.md and issue #1098 binding clarifications.

## Constitution Check: PASS
Only existing critical deterministic tests are extended. No UI/CSS/JSP suites, new frameworks, dependency/config/ignore changes or migrations. Financial ambiguity fails closed; no environment writes or deploy. Owner implementation GO already supplied; deployment requires separate GO.

## Implementation
1. Reproduce existing two-timeout sit-out with engine-timeout.behavior.test.mjs and read-model regression; inspect Leave, deferred settlement and terminal-close invariants.
2. Extend netlify/functions/_shared/poker-inactivity-policy.mjs and ws-server/poker/engine/poker-engine.mjs timeout policy with trusted mode. Persist inactivityEjectionByUserId; block human actions after intent, preserve tombstone across buildNextHandStateFromSettled. table-manager.mjs rejects unknown UUID mode.
3. Reuse authoritative-leave-adapter.mjs and shared/poker-domain/leave.mjs with trusted inactivity option verified against persisted intent. Close last human STANDARD irrespective of connected ejected socket; preserve CONTINUOUS_BOT. Retry via existing sweeps and settled rollover through handlers/leave.mjs::reconcileInactivityEjectionsCommand, invoked only after timeout persistence. Keep retained live claims until finalizer. Register ws_inactivity_ejection_pending in existing ws-server/poker/observability/poker-log-policy.mjs as WARN/recovery (mandatory WS log policy guard).
4. Extend room-core-snapshot.mjs and state-snapshot.mjs private branch for EJECTION_PENDING/REMOVED and reason. Retain pending avatar until accounting resolution. shared/poker-domain/join.mjs rejects tombstoned users before debit. poker/poker-v2.js locks preactions/auto-JOIN and reuses sticky 5s redirect. netlify/functions/poker-progression.mjs returns per-user authoritative intent/completion for reload even on CLOSED tables and filters terminal users from lobby Resume; existing endpoint tests verify pending versus confirmed.
5. Extend existing fundamental timeout, Leave/accounting, reconnect snapshot tests; run focused tests then required repository/CI checks. Independently review ledger/escrow and race conditions.
6. Publish Draft PR with final SHA and prepare exact-SHA WS Preview command/checklist, without executing deployment. Keep manual runtime verification pending.

## Breaking impacts
Online sit-out after two misses becomes terminal cash-out/seat release; Single Player threshold becomes three then closes. Additive private protocol status/reason. No schema or economic-rule change. Rejoining the same terminally exited table is denied; other tables remain available. Missing nonnumeric deadlines fail closed (fixes Number(null)=0); standard 20s remains unchanged.
