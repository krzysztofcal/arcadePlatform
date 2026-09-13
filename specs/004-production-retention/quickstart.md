# Handoff / operational sequence (not authorization)

This document describes later execution by another agent and owner. No commands here authorize a Production write. No Production operation has been performed in planning.

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
