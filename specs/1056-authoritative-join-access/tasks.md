# Tasks (dependency order)

- [x] T001 Live main/rules and isolated branch; spec/plan/tasks Constitution Check.
- [x] T002 Existing adapter + SETTLED runtime regressions; red before fix.
- [x] T003 Preserve authoritative access in normalizeSuccess only; green.
- [x] T004 Focused/required checks, full self-review and Draft PR.
- [ ] T005 Exact latest runtime SHA WS Preview deploy, SHA equality and health.
- [ ] T006 One authenticated Stage fresh SETTLED JOIN smoke and handoff evidence.

## Verification before Draft PR

Both extended assertions failed before the one-line fix (missing adapter access / missing join_refresh frame), then adapter + real-socket JOIN passed 25/25. Existing handler + access propagation passed 44/44. Syntax, check:all, ci:guards, CSP and diff whitespace passed. Real-socket tests use WS_POKER_LOG_LEVEL=DEBUG because their existing listening harness consumes the startup log; no logging/config changes are committed. File-store harness does not activate the DB-only settled access gate; it proves the existing handler cache branch via join_refresh and legal automatic PREFLOP, not the Stage-only gate. Authenticated Stage smoke remains required.

Self-review: only production change is optional preservation of trusted access after existing validation; absent access remains absent. No scheduler/retry/refresh/manager/funding/WS protocol changes. Public breaking impact: none.
