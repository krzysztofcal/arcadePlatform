# Handoff / operational sequence (not authorization)

This document describes later execution by another agent and owner. No commands here authorize a Production write. No Production operation has been performed in planning or implementation.

## PR A implementation evidence

The implementation is on branch `agent/891-production-retention-plan`, based on main commit `f7983d78333b51a393c0e9a6d3dfe48ce1224c74`. It adds the forward-only Production equivalents and dark/off entry path required by T001–T013:

- E1: `supabase/production-migrations/20260914090000_chips_ledger_production_retention_contract.sql`, SHA-256 `0248679622a99736e92a24058a057b2a51d1af72ff8c4284f1616b9002709e2d`.
- E2: `supabase/production-migrations/20260914091000_chips_ledger_production_table_fence_activation.sql`, SHA-256 `f6d8334cf642df7c9c4ac3b633d4898254d5af09290814cdce54e253bc650cab`.
- The manifest still classifies all 97 main migrations as 54 Production baseline entries plus 18 `shared-safe`, 3 `stage-only`, and 22 `needs-production-equivalent`; no Stage rollout history, IDs, credentials, receipts or allowlists were copied into the Production replacements.
- E1 defaults Production retention and all three Production policy rows to OFF with cap 2 and leaves the TABLE fence OFF. E2 is shipped as a separately owner-gated file and was not applied.
- The Production workflow is `workflow_dispatch` only, has no scheduler trigger, uses only Production credential names, and cannot run automatic mode while the Production switch is absent or `0`. PR B activation, cap 5000, scheduler files and canaries are not included.

The disposable PostgreSQL fixture applies the first 54 migrations plus E1 with only test-local identity substitution, verifies the missing `bot_only_retention_complete_at` contract and OFF/cap2 defaults, rejects an invalid E2 confirmation, and validates a separately confirmed E2 activation. The TABLE metadata fence suite then exercises the current Netlify and WS `postTransaction` adapters against that disposable schema with the fence active. These checks do not connect to Stage or Production.

T014 verification passed with the WS server runtime dependencies installed as prescribed by the existing CI workflow (`npm ci --prefix ws-server --omit=dev`): `npm test`, `npm run syntax`, `npm run ci:guards`, `npm run check:all`, `npm run check:csp-inline`, `node scripts/check-db-migrations.mjs`, `git diff --check`, the disposable `chips.migration.test.mjs`, the active-fence `chips-ledger-table-metadata-fence.test.mjs`, archive/export/storage/prune suites, Stage automation/escrow suites and the existing workflow guard. The repository-wide test runner reports only its pre-existing opt-in skips for tests without their dedicated database environment; the PR A disposable contract tests were run with `CHIPS_MIGRATIONS_TEST_DB_URL` set and passed.

The existing Stage migration workflow remains unchanged and applies only `supabase/migrations/**`; `supabase/production-migrations/**` is validated by `scripts/check-db-migrations.mjs` but is not automatically applied to Stage. Shared JavaScript extraction is covered by the existing Stage automation/escrow suites. No WS Preview Deploy or authenticated/browser smoke is part of this implementation handoff because no `ws-server/**`, shared runtime dependency, or browser protocol artifact changed and the owner will perform runtime verification.

Current handoff state: **implementation ready, awaiting owner/runtime verification**. T015–T019 require explicit owner authorization after review and merge, and T020+ are PR B.

## Implementation PR A

1. Refresh live main/issue891 and read spec/research/plan/inventory/data-model/tasks. Preserve current Stage behavior. Reconcile every new migration beyond baseline; an unclassified addition blocks SQL preparation.
2. Build E1 and dark workflow/shared internals per tasks. Run existing fundamental suites on disposable PostgreSQL, including a separate first54+E1 Production fixture. A test skipped because DB env is unset is not contract PASS. Validate syntax, repo guards and whitespace; compare diff with permitted file list.
3. Hand owner PR A, exact implementation SHA, equivalent SQL hashes, catalog/ACL/RLS evidence and explicit Stage/Production effects. Do not merge. Owner can run focused runtime smoke; no broad agent authenticated smoke required.

## Separately authorized Production milestones

**Apply E1 only**: Owner authorizes target/ref/system, exact file/hash/SHA and compatible runtime evidence. Operator uses session PostgreSQL connection and psql ON_ERROR_STOP for that file; no directory glob/db push/reset/repair. Check real pg_control_system before DDL, hold Production lock, preserve baseline accounting/receipt hashes. Verify own migration history, missing lifecycle-column error resolves, fence OFF, automation OFF/cap2 and no data deleted.

**Activate fence with E2**: Owner separately authorizes after disposable current-producer tests and deployed writer compatibility. Capture exact Netlify/WS revisions and source diff/digests, TABLE buy-in/cash-out/retry expectations, live writer list. Apply E2 only with exact confirmation; keep cleanup OFF. Owner exercises human/bot transaction and leave/settlement path; inspect bounded WS journald for TABLE errors. Failed/uncertain compatibility blocks canary. Existing tables remain bot-ineligible; newly created fenced tables can become candidates only after required age/terminal proof.

**Fresh prepare/canary**: Read-only diagnostic picks candidates; no candidate is not PASS. Owner separately authorizes archive/Storage/proof preparation, then exact execute after reviewing batch IDs, table/account IDs, tx/entry counts, hashes, cutoff, recovery objects and dry-run. Automatic switch and policy activation remain OFF. Max2 tx per archive; bot/human whole-table rules unchanged. Existing30d fresh archive can use old eligible data, never old Production batch1. Separate bot/human archives needed; escrow can reuse fresh bot canary with account snapshot and its own exact GO. Wait naturally7/30 days if needed; no backdating, synthetic financial fixtures, table splitting or cap bypass.

For each canary retain private full recovery artifacts and aggregate public evidence: project/system pair; implementation SHA; fresh batch/table/ID/hash/cutoff binding; bucket privacy/MIME/hash/byte checks; second archive and manifest downloads verified; exact dry-run and delete counts; no retained account balance/sequence changes; sum/tx conservation; provenance/escrow invariants; complete prune/registry/lifecycle/account receipt as applicable; replay rejected or already_pruned with verified evidence. Unknown result: stop, re-read same receipt, never blind retry/new batch.

## PR B and scheduling

Only after all four classes PASS, author E3 with actual fresh Production receipt IDs/hashes and update inventory manifest. Run boundary tests proving2→5000 transition only for activated policy and owner authorization. Add dedicated Production dispatcher/timer artifacts, without changing live Stage scheduler or auto-installing via Infra VPS. Submit PR B; do not merge.

Owner separately authorizes E3 application, secret/principal provisioning, GitHub variable activation and timer installation. `production-ledger` GitHub environment holds only Production credentials; VPS dedicated Actions-write dispatcher token has no DB/Storage access. Use `CHIPS_LEDGER_PRODUCTION_DISPATCH_ACTOR` and `CHIPS_LEDGER_PRODUCTION_AUTOMATION_ENABLED=1` only after activation evidence.

Observe normal timer invocations: existing30d02:09 UTC daily, bot:09 hourly except02, human:24 hourly, escrow:39 hourly. Each run chooses one policy and max1 batch (escrow max2 accounts). Confirm one scheduler owner, no native Production cron, fixed main SHA checkout, Production lock and workflow concurrency, aggregate post-check. A no-candidate run confirms schedule only; attach canary evidence for deletion proof. Do not drain backlog or manually invoke broad smoke to satisfy formality.

## Disable / recovery

Owner-authorized emergency sequence: workflow variable0, disable Production timer, disable DB control under same Production lock. Re-read any in-flight receipt; do not assume a cancelled request rolled back. Keep all archives, manifests, retired-account snapshots and immutable receipts. Fix forward. Do not disable TABLE fence while cleanup remains possible. If restoring writer compatibility requires fence OFF, first block all cleanup and reset future-table bot eligibility default false, then separately authorize that change. Re-enable only after fresh compatibility proof. Live data restoration is separate authorized work; first reconstruct/audit in an isolated recovery environment.

## Completion language

Planning READY FOR IMPLEMENTATION means an agent can implement PR A from these decisions. It does not mean Production rollout ready or PR merge-ready. Missing user runtime verification must be reported as `implementation ready, awaiting manual runtime verification`. Production activation cannot be marked ready until fresh canaries and owner authorizations exist.
