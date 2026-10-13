# Tasks #1098

- [x] T001 Trace/reproduce timeout rollover, Leave and terminal-close; verify fresh deadline and UI projection gap.
- [x] T002 Fundamental engine regressions first, then mode-specific policy and irreversible durable intent.
- [x] T003 Safe queued authoritative Leave/retry, deferred settlement and mode lifecycle; extend critical accounting tests.
- [x] T004 Private pending/confirmed notification, sticky browser redirect and reconnect/JOIN protection.
- [x] T005 Run focused tests and repository checks; independent subagent ledger/escrow/race review and fix findings.
- [x] T006 Draft PR, required CI results, exact-SHA WS Preview instructions and manual smoke checklist. Deployment and runtime smoke remain gated by separate GO.

Draft PR: https://github.com/krzysztofcal/arcadePlatform/pull/1099. Exact final SHA and CI rollup are reported with the PR handoff. Required WS Preview deployment/manual runtime smoke remain pending separate GO, outside this implementation authorization.

## Owner blocked-review follow-up
- [x] T007 P1 read-only snapshot: reproduce alternate timeout mutation in both modes, remove it and verify unchanged persisted state/audit.
- [x] T008 P2 JOIN code: preserve inactivity rejection and verify adapter-to-WS response/no seating.
- [x] T009 P2 identity: reset account-owned inactivity on logout/change, preserve same-account reconnect/countdown.
- [x] T010 P2 reconcile: exclude resolved/history and already-deferred claims from Leave queue work; preserve durable marker, finalizer and retry.
- [x] T011 Reverify fundamental Online/SP accounting/reconnect/close, independent review, final CI and Draft PR handoff (no deployment).

## Additional reconnect/post-settlement verification
- [x] T012 Audit transport/bootstrap/auth versus authoritative timeout paths; fundamental Online/SP pre-threshold count preservation.
- [x] T013 Reproduce real bootstrap/projection completed ghost; narrowly remove historical detached seats and preserve pending/live claims; no repeated Leave/cash-out.
- [x] T014 Verify real adapters/projections, economic/lifecycle invariants and required CI; update Draft PR evidence and SHA, no deploy/merge.
