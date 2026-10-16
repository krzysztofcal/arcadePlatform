> **Current verified status — 2026-10-16 17:45 UTC:** T017–T026 PASS in the approved four-class scope. E3 is already committed/post-commit-verified; do not apply it again. Production automation and marker-gated WS cleanup are enabled by prior owner authorization. #1119 is resolved in merged #1120 and migration `20261016120000` (SHA-256 `9d5c100c6f81273bc009a412f67b027549a1036c1a70e83e4fd0b1c5f07554bf`), committed once at16:46:15.202Z. Natural human run [38939398243](https://github.com/krzysztofcal/arcadePlatform/actions/runs/38939398243) on main `9f8b99c5489945da581a4b66cd11272b13e0ed36` passed after legal table removal, with no replay. Earlier BLOCKED/OFF/pending/withdrawn recommendations below are dated historical records, superseded by this status and the final closure review in research.md. Recommend owner-reviewed closure of #891/#992; do not close or merge automatically.

> **Current T024 handoff — 2026-10-15:** T023 is independently `post-commit-verified`; do not apply E3 again. Production timer installed OFF. Owner-only dispatch correction uses a separate Production fine-grained PAT of `krzysztofcal`, following the existing Stage identity model. No alternate account/App. Review/merge and exact root script replacement precede activation. Historical execution sections below are evidence, not permission to repeat activation.

> **Current handoff — 2026-10-14:** all four Production canary classes PASS; batch4 marker is complete. T020–T022 implementation is authorized and locally verified for Draft PR B. T023+ still require separate owner GO. Older age/failure/marker-pending sections below are historical and superseded by this handoff.

# Handoff / operational sequence (not authorization)

This document describes later execution by another agent and owner. No commands here authorize a Production write. No Production operation has been performed in planning or implementation.

## PR A implementation evidence

The implementation is on branch `agent/891-production-retention-plan`, based on main commit `f7983d78333b51a393c0e9a6d3dfe48ce1224c74`. It adds the forward-only Production equivalents and dark/off entry path required by T001–T013:

- E1: `supabase/production-migrations/20260914090000_chips_ledger_production_retention_contract.sql`, SHA-256 `0248679622a99736e92a24058a057b2a51d1af72ff8c4284f1616b9002709e2d`.
- E2: `supabase/production-migrations/20260914091000_chips_ledger_production_table_fence_activation.sql`, SHA-256 `f6d8334cf642df7c9c4ac3b633d4898254d5af09290814cdce54e253bc650cab`.
- The manifest classifies all 99 source-tree migrations as 54 Production baseline entries plus 18 `shared-safe`, 3 `stage-only`, and 24 `needs-production-equivalent`; the #1018 Stage migration and the forward-only `FORCE_RESTRICTED` extension are explicitly pending separate Production equivalents/GO. No Stage rollout history, IDs, credentials, receipts or allowlists were copied into the Production replacements.
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

Owner separately authorizes E3 application, secret/principal provisioning, GitHub variable activation and timer installation. `production-ledger` GitHub environment holds only Production credentials; VPS dedicated Actions-write dispatcher token has no DB/Storage access. Use the owner identity `krzysztofcal`, a separate Production fine-grained PAT, and `CHIPS_LEDGER_PRODUCTION_AUTOMATION_ENABLED=1` only after activation evidence.

Observe normal timer invocations: existing30d02:09 UTC daily, bot:09 hourly except02, human:24 hourly, escrow:39 hourly. Each run chooses one policy and max1 batch (escrow max2 accounts). Confirm one scheduler owner, no native Production cron, fixed main SHA checkout, Production lock and workflow concurrency, aggregate post-check. A no-candidate run confirms schedule only; attach canary evidence for deletion proof. Do not drain backlog or manually invoke broad smoke to satisfy formality.

## Disable / recovery

Owner-authorized emergency sequence: workflow variable0, disable Production timer, disable DB control under same Production lock. Re-read any in-flight receipt; do not assume a cancelled request rolled back. Keep all archives, manifests, retired-account snapshots and immutable receipts. Fix forward. Do not disable TABLE fence while cleanup remains possible. If restoring writer compatibility requires fence OFF, first block all cleanup and reset future-table bot eligibility default false, then separately authorize that change. Re-enable only after fresh compatibility proof. Live data restoration is separate authorized work; first reconstruct/audit in an isolated recovery environment.

## Completion language

Planning READY FOR IMPLEMENTATION means an agent can implement PR A from these decisions. It does not mean Production rollout ready or PR merge-ready. Missing user runtime verification must be reported as `implementation ready, awaiting manual runtime verification`. Production activation cannot be marked ready until fresh canaries and owner authorizations exist.

## Historical handoff — 2026-09-22

At this date human eligibility still required natural age. That waiting status is superseded by all four canary PASS results and the exact final lifecycle receipt recorded in research.md. Global control, policies and scheduler remain OFF pending separately approved PR B operations.

## T018 batch 4 recovery gate — 2026-10-14

PREPARE failed after committing batch 4's primary archive, before proof/dry-run/recovery. See research.md for exact identity/IDs/hashes and run URL. Preserve the existing batch and immutable archive; do not retry fresh selection or create a replacement batch.

After repair review/owner merge and **separate exact Production PREPARE authorization**, the existing workflow can receive `policy=closed-human-30d`, `mode=prepare`, `batch_id=4`. It verifies the original committed archive, registers absent proof, dry-runs exact IDs and creates/verifies both durable copies under the Production lock. Existing GO/partial receipts/ambiguous recovery fail closed. No CANARY/execute input is part of PREPARE.

Review exact batch/SHA/proof/recovery/dry-run evidence before a separate CANARY GO. Global/policy retention, scheduler and cap remain OFF/OFF/2; #992 cleanup override remains 0. This document does not authorize workflow dispatch or Production writes.

## Batch 4 marker-only gate after CANARY

Batch 4 has complete pruning/proof/recovery and zero selected hot rows. Retained registry mappings are correct for closed-human. Its table marker is still missing, so T018 is incomplete.

Only after review/owner merge and separate **marker-only Production GO**, dispatch existing Production workflow on the newly reviewed main with:

- policy `closed-human-30d`, mode `lifecycle-completion`, batch_id `4`;
- table_id `7f3d73e4-36c5-4b66-afe6-d1d41bea13e2`;
- cutoff `2026-09-14T18:39:21.779Z`;
- completion_confirmation `COMPLETE HUMAN RETENTION 4`;
- no CANARY `confirmation` (`GO 4`).

Require already_pruned dry-run, exact immutable proof/archive and both recovery copies, complete receipts, retained mappings, fenceON/control+policiesOFF/cap2. Invoke the existing protected marker routine only; verify persisted marker, idempotent re-check and unchanged ledger/registry/accounts/receipts. Existing marker returns already_complete without another write. Any mismatch/unknown result stops; do not repeat CANARY or repair receipts.

This fixes future automatic finalization as well: pruning success is followed by marker verification, and interrupted pruning can resume only its marker without another execute/export in that invocation. This does not enable automation, scheduler or #992 cleanup. No commands in this document authorize a Production write or PR B.

## PR B validation / operator gates (current)

Implementation is pending approval of plan.md. During T020–T022, validate only disposable fixtures and existing deterministic suites. No Stage migration apply, Production workflow dispatch, E3 apply, scheduler install/token provisioning or #992 cleanup change is part of implementation/CI/merge.

Draft handoff must contain: exact final code SHA, actual E3 SQL SHA and eighth manifest entry, pinned2/3/4 archive/proof/recovery/marker/account receipts from research, cap boundaries at every SQL/JS layer, dedicated scheduler identity/slots/switches, no-auto-apply/install evidence and test pass/skip/failure details. Current unrelated XP-anchor baseline must be documented without UI scope expansion. Keep #891 open and remove only its obsolete T018 age BLOCKED status after the reviewed handoff.

T023 apply checklist (separate owner GO): fresh canonical target/history/catalog/runtime evidence, private primary+both recovery and escrow snapshot GET/byte/SHA/MIME checks, exact unchanged canary GO/proof/prune/registry/marker/retirement, source inventory current, fenceON/policiesOFF/globalOFF/cap2, GitHub/local switches0 and cleanup0 freshly confirmed by operator if direct access is denied. Bind preflight digest/observed time (<=15min), reviewed code/E3 file SHA and exact activation confirmation. Apply only E3 in one transaction under Production lock; compare accounting/receipts/history afterward. No directory db push/history repair.

T024 checklist (separate owner GO): protected Production credentials remain only in Actions; separate Production Actions-only fine-grained PAT belonging to `krzysztofcal` stays in root-protected external dispatcher configuration, with isolated gh auth and no DB/Storage/WS credentials. Review/install exact script/unit hashes only on the sole approved VPS. Enable local/GitHub switches and timer only after E3 PASS. Verify Stage scheduler unchanged and no native cron. E3/merge never installs anything.

T025 observation: normal UTC slots (daily02:09 existing; other hourly:09 bot; hourly:24 human; hourly:39 escrow), one class/batch per run including proven resume. Verify exact workflow/application SHA, target, bound, private recovery, receipts, human marker, registry semantics, accounts/conservation. No-candidate proves scheduler delivery, not destructive validation. Skip active/off slots rather than catch up. Unknown commit/dispatch outcome: read receipt/run state, do not repeat blindly.

Disable procedure remains independently owner-controlled: local/GitHub switches0, stop timer, review in-flight receipt, existing DB disable function under shared lock. Preserve all archives/registry/markers; do not undo pruning. Reactivation requires fresh review/GO. WS cleanup stays0 until separate #992 audit/authorization; PR B does not authorize it.

Escrow dependency: preserve the existing missing-table predicate. Bot pruning alone leaves the table with its completion marker; while #992 cleanup=0, escrow can correctly return no-candidate for those new tables. Record this backlog/dependency during T025; do not broaden retirement or enable WS cleanup to force a result.

## PR B code handoff — 2026-10-15

E3 SHA-256 `88e622855c79b467fe03f063dc4c19e39394745e4ef5fc14ab2a7afede719460`; final code SHA and CI links are on the Draft PR. Apply only the exact reviewed file after separate owner approval, never a directory glob or Stage migration command. Before application the operator must obtain a new private Storage/DB/runtime attestation; the historical PASS matrix is not a fresh Storage availability check.

Owner supplies session settings `chips.production_project_ref`, `chips.production_activation_confirmation`, `chips.production_preflight_sha256`, `chips.production_preflight_at`. Confirmation must be `ACTIVATE PRODUCTION RETENTION otbqfijerkieoxwpxjnm <preflight-sha256>`; digest is64 lowercase hex and observed time is no older than15min/no future. The existing archive/recovery helpers verify private primary/both durable objects and escrow snapshot, exact bytes/MIME/SHA/receipt/identity, immediately before apply. SQL revalidates DB only; changed/unavailable Storage or identity/hash/receipt drift means STOP and a new reviewed attestation. SQL checks freshness again after locked DB checks.

The scheduler service defaults toOFF even when its optional environment file is absent. Later provisioning is root-owned `/etc/arcadeplatform/production-retention-dispatch.env`, mode0600, containing only the explicit switch and dedicated Actions-only `GH_TOKEN`; never DB/Storage/WS secrets. Use owner `krzysztofcal` with a separate Production fine-grained PAT scoped only to this repository, Actions read/write and Metadata read, protected `production-ledger` environment and fixed github.com origin. Install only the three reviewed script/unit files under their prescribed paths after T024 GO; no bootstrap/Infra install hook exists. Enabling local/GitHub switches or starting the timer requires that separate authorization. No live provisioning is performed by this PR.

Breaking/financial impact: E3 increases only activated automatic transaction capacity to5000 and enables destructive retention under proven policies. Old manual APIs remain max2; API roles remain denied. Shared modules require Stage regression evidence. Disable-only stays available under lock and clears control activation fields; reapply cannot reactivate. Saldo/sequence/conservation are invariant; recovery is private evidence, not an automatic hot-ledger restore. WS cleanup remains0 and escrow may correctly have no candidate until separately authorized #992 cleanup.

T023 correction: the previous E3 apply failed/rolled back (09:33UTC,2026-10-15); do not retry its hash/attestation/GO. Before later approval, verify postgres is the expected non-superuser owner with namespace CREATE grant authority; pruner USAGE=true,CREATE=false; managed grantor/options unchanged and no existing postgres-granted pruner edge. Corrected E3 temporarily grants CREATE and explicit INHERIT/SET, revokes only its own grants before activation/COMMIT, and leaves provider-managed membership unchanged. Any unexpected role/schema privilege fails closed. After apply require USAGE=true/CREATE=false and the exact original managed grantor/ADMIN/INHERIT/SET matrix alongside financial reconciliation.

The previous local apply runner/attestation were pinned to the failed E3 hash. They are not approval or a ready invocation for this corrected artifact. After owner merge, separately review/re-pin execution tooling, then collect fresh evidence and authorize the new exact E3/runner/attestation hashes.

### Disposable cluster consent for the non-superuser fixture

The migration suite changes cluster-global roles, so loopback and a `_test` database name do **not** authorize it. Provision a dedicated one-time PostgreSQL16/17 cluster that no other database/application uses; discard it after the run. Only then explicitly set `CHIPS_MIGRATIONS_DISPOSABLE_CLUSTER_CONFIRMATION=I_CONFIRM_THIS_CLUSTER_IS_DEDICATED_AND_DISPOSABLE` and pin `CHIPS_MIGRATIONS_EXPECTED_SYSTEM_IDENTIFIER` to that cluster's `pg_control_system().system_identifier`. Keep `CHIPS_MIGRATIONS_TEST_DB_URL` on that disposable loopback cluster. Never set these on an ordinary shared local PostgreSQL instance. The consent is an operator attestation, not an isolation claim inferred from a URL.

Without both exact consent and matching identity, the suite stops before any migration/CREATE/ALTER ROLE, and checks the boundary again before the non-superuser role fixture. An existing MD5 password on postgres is rejected before rename. The existing CI step opts in only for its freshly provisioned job-owned postgres16 service and derives the identity from that service; no opt-in is exported to other jobs/services. Financial/non-superuser/rollback scenarios are unchanged.

### Historical T023 live-ledger guard handoff (completed)

The delta guard was implemented, independently reviewed and used for the single committed E3 operation. The separate post-commit finalization closed its evidence after correcting local metadata expectations. Historical activation attestations/GO are not reusable; do not rerun E3. Financial evidence and the absent original S4 are preserved as recorded in research/tasks.

After separately authorized implementation, validate only offline/dedicated disposable PG16/17: recognized variable-cardinality bot cycles PASS; old financial mutation/deletion, inconsistent balance/sequence, missing registry, protected canary change and unknown operation FAIL; two-connection commits before/during/after E3, a transaction begun before baseline but committed later, and rollback must follow the S0/S1→S2→S3→S4 snapshot contract. Assert whole atomic visibility, adjacent/cumulative validation and no new writer blocking. Preserve the existing full-file single-transaction E3 submission and non-superuser ACL restoration without Production access.

After tooling review, obtain new WS cleanup0 config/process/PID/UTC and GitHub switch0/UTC evidence. Complete the new read-only preflight; expiry remains earliest critical evidence+15min. Separate exact-digest apply authorization must bind the reviewed new snapshot/delta semantics and helper/runner hashes; no write-blocking window is proposed. Postcommit reconciliation admits only exactly explained gameplay deltas and unchanged historical/protected evidence through its final snapshot. A drift first observed after submission is FAIL/uncertain (read-only diagnosis, no retry), not a guarantee apply was prevented. No scheduler/token/T024/T025/#992 action follows automatically.

P2 validation detail: the accepted terminal pair is `metadata.reason=BOT_TERMINAL_CASH_OUT` AND `metadata.closeReason=WS_INACTIVE_TABLE_CLOSE`; swapped, missing or unknown values fail. The accepted CONTINUOUS_BOT seed combines key `managed-bot-seed-buyin:<tableId>:<seatNo>`, reference `BOT_SEED_BUY_IN:<tableId>:<seatNo>` and `metadata.reason=BOT_SEED_BUY_IN`, with matching funding/registry/table/bot identities. Include a seed observed after hand/phase progression or legal closure with INACTIVE seat: current ACTIVE/initial-stack state is not required, but complete positive funding and identity lineage remains mandatory. These are extensions to the existing fundamental legal-cycle case, not new suites or financial allowances.

### T024 owner-PAT provisioning and OFF script update

After owner merge, verify exact new main/script SHA. Operator root replaces only the installed script, rejecting any unexpected old bytes or active/enabled Production timer; keep existing service/timer bytes unchanged. Never run the dispatcher as an installation check.

Owner creates a new fine-grained PAT in GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens. Resource owner `krzysztofcal`; only selected repository `arcadePlatform`; Actions read/write and Metadata read; no Contents/Administration/Secrets/Variables permissions. Choose expiration and track rotation. Store only in root-owned0600 `/etc/arcadeplatform/production-retention-dispatch.env` with the Production switch0 until the final coordinated enablement. Do not paste the token in chat/logs/CLI arguments; use a hidden operator prompt. Remove unused actor configuration if it was created.

The existing service passes explicit GH_TOKEN and isolated private gh config; dispatcher GET /user must return `krzysztofcal`. Production credentials stay in protected Actions environment. Confirm token identity/scope, owner workflow, root installation, fresh cleanup0 evidence, switches0, no active runs and Stage unchanged before enabling switches/timer. Token/account creation and dispatch/DB/Storage operations are not performed by this correction.

## Current operations — 2026-10-16

Production timer is now enabled with owner-specific dedicated PAT and local/repository switches1; all four normal UTC classes observed. T023–T026 evidence is in research.md. Earlier OFF/pending instructions are historical gates, not current state. Do not rerun E3 or old installation/enable helpers. No manual dispatch/catch-up is needed.

Disable/incident: owner sets repository and local Production switches0 and stops/disables Production timer; inspect in-flight Actions and durable receipts before any retry. DB disable uses existing shared-lock procedure only under its own authorized operational scope. Never erase receipts/recovery, undo pruning or disable TABLE fence as a shortcut. Stage remains separate. PAT rotation requires owner provisioning before expiration; token values never enter documentation.

#992 was separately owner-authorized and enabled2026-10-16T06:43:17Z: override removed, config/process UNSET, default7d, first natural sweep11marked tables, post-enable financial/Storage verification PASS (research.md). Do not rerun the one-time enable helper or manually force cleanup. Missing-table escrow eligibility may progress naturally under existing guards. Keep local private evidence; address low VPS disk capacity separately. Long-term total ledger growth remains broader #889 scope; observation does not justify a capacity forecast.

## Current owner handoff — closure review, not activation

No more E3 apply, migration, restart, dispatch or cleanup is needed to satisfy this handoff. Production and Stage timers remain active/enabled; WS PID3778803 remains active with the previously owner-enabled UNSET/default7d cleanup. Keep current bounds/kill switches and preserve all receipts/archive/recovery. An uncertain future run requires reading its existing receipts before any separately authorized retry; never replay an old canary. Review the final research evidence/limitations, approve documentation PR #1118, then separately decide issue closure. As of17:45UTC VPS root has8.2GiB available (78% used), inode use22%; this replaces the historical297MiB observation without deleting that incident record. No long-term capacity guarantee.
