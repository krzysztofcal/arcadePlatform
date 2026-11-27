# Tasks — Stage DB approval

## Phase 0 — Design

- [x] T001 Confirm baseline workflow, enforcement points, GitHub environment policy and comparable WS Preview implementation.
- [x] T002 Independent Antigravity review and disposition, then OWNER implementation GO.

## Phase 1 — Protected apply [US1]

- [x] T003 Update `.github/workflows/db-stage-apply-pr.yml` to separate inspect, apply preflight and protected apply with shared queue and immutable manifest. Enforce actor/ref/attempt at both job boundaries. Check exact policy before approval and current policy plus owner review before secrets. Add minimal Actions read, compare preflight digest and clean scratch data.
- [x] T004 Update `authorizeApply()` in `scripts/stage-db-migrate.mjs` for the pinned actors and first attempt. Preserve trusted source, confirmation, target and database invariants.
- [x] T005 Extend `tests/db-stage-workflows.guard.test.mjs` and existing executor tests for role/ref/rerun, missing or wrong reviewer/history and policy failures, job ordering and both dispatchers requiring the protected path. Run existing SQL safety regression checks, actionlint and independent code review.

## Phase 2 — Compatibility and support [US2, US3]

- [x] T006 Verify inspect remains read-only, preserves existing output and shares serialization with apply. Check sanitized pending/refused/no-op/applied states.
- [x] T007 Update `docs/ai-agent-db-migration-checklist.md` for preflight, exact manifest, review, no rerun and independent readback.
- [ ] T008 With separate OWNER scope, verify App dispatch and configure the protected environment before rollout. Verify rejection and authorized no-op without schema changes, using `quickstart.md`. Record source SHA, run IDs, approval evidence and history readback. Real migration dispatch requires its own scope.

T001 → T002 → T003/T004 → T005/T006/T007 → T008. Environment setup, merge and shared apply are OWNER gates.
