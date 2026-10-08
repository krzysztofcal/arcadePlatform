# Implementation Plan: #1066 terminal sit-out ownership

## Technical Context
Node ESM; shared/poker-domain/terminal-close.mjs is the common financial primitive for existing WS and Netlify terminal callers. No interfaces/schema/dependencies change.

## Constitution Check (pre/post design): PASS
Existing classification/ledger architecture reused. Financial ambiguity remains fail-closed. Tests are one fundamental critical cleanup regression in an existing harness; existing accounting/cleanup checks retained. No UI/glue suites or generic setup/config/ignore/dependency changes. The local ignored .specify/feature.json only selects this feature. Production mutation/deploy forbidden, no merge. WS Preview Deploy is required for exact runtime SHA; manual runtime verification pending.

## Design
In classifyClaims(), retain the original exact human state-seat mapping. Permit absent mapping only for SETTLED with valid state.seats and a locked persisted ACTIVE human with explicit sitOut=true, not left, absent from both state.seats and handSeats, whose seat number is unoccupied in those collections. Existing persisted/state uniqueness checks and occupiedClaimSeats remain mandatory. Cash-out amount still comes from projected authoritative stacks, followed by existing escrow total and bot provenance validation. No alternate cleanup or financial state repair.

## Files
- shared/poker-domain/terminal-close.mjs: narrow human-identity branch only.
- shared/poker-domain/inactive-cleanup.behavior.test.mjs: extend createCleanupHarness for existing bot funding queries; add one production-shaped real terminal-close regression.
- specs/1066-terminal-sitout/: requirements, design, tasks and accounting review.

## Validation
Run node --test shared/poker-domain/inactive-cleanup.behavior.test.mjs tests/poker-bot-cashout.userId-is-bot.unit.test.mjs tests/poker-inactive-cleanup.behavior.test.mjs shared/poker-domain/leave.behavior.test.mjs shared/poker-domain/human-stack-accounting.behavior.test.mjs. Run repo check:all/ci:guards/CSP/test:quick/test:unit and npm test with isolated local test fixtures, never Production credentials. Review exact diff for guard preservation, commit/push Draft PR and deploy WS Preview with main workflow + exact application SHA. Keep manual runtime acceptance pending.

## Breaking Impact
No protocol/schema/API changes. Conserved, unambiguous seated sit-out human ownership can now cash out and close, including existing shared terminal callers. Ambiguous financial ownership still rejects; automatic cleanup behavior intentionally changes for this case.
