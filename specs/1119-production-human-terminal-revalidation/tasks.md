# #1119 tasks

- [x] T001 Read current issue/main/instructions, trace P9231 through latestCompleted/dry-run/SQL guard; identify absent durable lifecycle evidence for non-canary history.
- [x] T002 Document safety contract and narrow E3-canary legacy evidence, new immutable completion receipt, unchanged manual/Stage/SQL boundaries; Constitution Check fundamental tests only.
- [x] T003 Extend existing Production lifecycle tests; observe regression before implementation.
- [x] T004 Implement completed read-only evidence verifier and strict lifecycle receipt publication/verification in existing Production module.
- [x] T005 Prove legal cleanup permits next candidate and incomplete/ambiguous evidence fails closed; preserve existing manual/other-policy regressions.
- [x] T006 Run appropriate existing suites/guards and CI, self-review/simplify, document breaking/financial impact and correct #1118 recommendation; open Draft PR.
- [ ] T007 OWNER GATE: review/merge by owner; separate Production authorization and natural post-fix closed-human observation with financial/recovery proof. No task implementation authorizes Production mutation or dispatch. Keep #891/#992/#1119 open.

## Implementation validation

- Existing automation regression was RED with P9231 before the fix; focused suite now PASS, including receipt corruption/missing recovery/history/GO/hot rows, legacy activation evidence, incomplete live lifecycle and publication interruption. The next real exporter selector is reached without replaying the old archive. Existing CANARY/new pruning and other policy tests remain intact.
- Existing full test runner: 147 suites PASS. PostgreSQL 17 dedicated disposable cluster: full chips migration suite PASS, including actual marker completion and unchanged WS cleanup, incomplete-table protection and unchanged batch/registry/account state. Minimal Supabase auth/storage bootstrap matches existing CI.
- Syntax: 226 files PASS; CSP: 55 documents PASS; lifecycle/badge/XP guards PASS; migration inventory: 111 files / 8 Production replacements PASS; diff whitespace PASS. GitHub checks are recorded on the Draft PR rather than assumed from local results.
- No Production read/write, dispatch, retry, migration application, configuration change, merge or deployment. E3 SHA remains byte-identical.
