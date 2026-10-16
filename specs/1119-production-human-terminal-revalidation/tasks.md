# #1119 tasks

- [x] T001 Trace P9231 through latestCompleted/dry-run/live SQL; retain exact financial evidence and historical E3 canary proof.
- [x] T002 Review findings: establish atomic DB receipt/marker contract; explain why cross-service publication is insufficient; Constitution Check fundamental tests only.
- [x] T003 Reproduce missing manual CANARY evidence before correction; extend existing fundamental orchestration tests without deleting valuable financial coverage.
- [x] T004 Replace unmerged Storage completion receipts with typed immutable DB receipts; all completion paths publish atomically; absent terminal verification remains fail-closed.
- [x] T005 Verify new Production-only migration under non-superuser postgres, actual terminal SQL-backed path, concurrent WS cleanup, immutable evidence and unchanged finances/registry.
- [x] T006 Run relevant tests/guards/CI and self-review; update existing Draft PR #1120 with exact SHA, new migration hash and breaking impact; #1118 closure recommendation remains withdrawn.
- [ ] T007 OWNER GATES: code review/merge by owner; separate exact new-migration authorization/application before changed human workflow; separate rollout/natural Production verification. Keep #891/#992/#1119 open. No manual destructive replay or E3 reapplication.

## Validation record

Previous revision: 147 suites and PostgreSQL16/17 PASS, but review found the post-commit publication gap and missing manual receipt. Those results do not validate the corrected atomic design. Current manual regression reproduced RED (missing receipt). New test/CI results are recorded on the updated Draft PR after completion. No Production operation is permitted during implementation.

Corrected design validation: focused automation suite PASS (manual non-canary completion → legal cleanup → automatic, locked insertion, receipt failure rolls marker back, missing schema stops before export/prune). Dedicated PostgreSQL17 full suite PASS: non-superuser DDL with unchanged schema/membership, actual receipt helper and terminal verifier, competing unchanged WS cleanup skips locked row, real marker rollback on rejected receipt, idempotence, forced RLS/ACL/immutability and byte-equivalent ledger/registry/batch/account state. Existing full runner 147 suites PASS; syntax226/CSP55/inventory111+9 and lifecycle/badge/XP guards PASS. Applicable exact-head CI is recorded on Draft PR #1120.
