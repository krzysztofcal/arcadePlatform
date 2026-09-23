# Tasks: Stage recovery durability after ambiguous Storage writes

**Input**: Design documents from `/specs/007-stage-storage-recovery-resilience/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/bot-only-recovery-repair.md`, and `quickstart.md`

**Tests**: Fundamental deterministic tests are required and must be written
before the corresponding implementation.

## Phase 1: Setup

**Purpose**: Establish the repository-only baseline and protect scope.

- [x] T001 Confirm the existing Node.js/npm test and syntax scripts, lockfile, and constitution in `package.json`, `package-lock.json`, `.specify/memory/constitution.md`, and `agents.md`; record that no dependency, migration, Production, or automatic-Stage scope is permitted.
- [x] T002 Run the current focused suites `tests/chips/chips-ledger-archive-storage.test.mjs`, `tests/chips/chips-ledger-stage-automation.test.mjs`, `tests/chips/chips-ledger-stage-automation.observability.behavior.test.mjs`, and `tests/chips/chips-ledger-stage-automation.workflow.guard.test.mjs`; preserve the baseline results before implementation.

## Phase 2: Foundational

**Purpose**: Establish traceable safety predicates before user-story changes.

- [x] T003 Map the existing call boundaries in `scripts/ops/chips-ledger-archive-store.mjs` (`storageRequest`, `readPrivateObjectIfExists`, `uploadOrVerifyPrivateObject`) and `scripts/ops/chips-ledger-stage-automation.mjs` (`inspectDurableRecoveryState`, `persistDurableRecovery`, `runAutomaticBotOnlyStageAutomation`, `writeAggregateSummary`) against `specs/007-stage-storage-recovery-resilience/data-model.md`; do not add a migration or a new dependency.

## Phase 3: User Story 1 - Reconcile ambiguous recovery uploads (Priority: P1) 🎯 MVP

**Goal**: A create-only recovery POST that may have succeeded is reconciled by
one verified private read, never by a blind second POST.

**Independent Test**: Storage fakes that store bytes then return 504 or a
transient network error produce one POST plus a matching verified GET; absent,
unavailable, or different content produces a fail-closed state and no second
POST.

### Tests for User Story 1

- [x] T004 [P] [US1] Add failing fundamental cases in `tests/chips/chips-ledger-archive-storage.test.mjs` for HTTP 504-after-write and network-error-after-write, asserting one `POST`, `x-upsert:false`, matching MIME/size/bytes/SHA-256, and no blind second POST; add absent/mismatched reconciliation assertions for `write_not_visible`/fail-closed behavior.

### Implementation for User Story 1

- [x] T005 [US1] Update `uploadOrVerifyPrivateObject` in `scripts/ops/chips-ledger-archive-store.mjs` to classify POST 504 and transient network exceptions as ambiguous, use bounded `readPrivateObjectIfExists` reconciliation, accept only exact MIME/size/bytes/SHA-256 matches, and attach `write_not_visible`, `unavailable`, or `mismatch` state without issuing another POST; preserve fail-fast behavior for other upload statuses.
- [x] T006 [US1] Preserve `storageRequest` in `scripts/ops/chips-ledger-archive-store.mjs` as one-attempt for writes and retain ordinary 400/409 create-only race behavior; run the focused archive-storage test and syntax check before moving to repair changes.

**Checkpoint**: Shared recovery uploads reconcile ambiguous outcomes safely while
all non-conclusive states remain blocked.

## Phase 4: User Story 2 - Repair a provably safe partial pair (Priority: P2)

**Goal**: One generic exact-batch owner-gated repair creates only a missing
recovery manifest after all Stage, DB, proof, dry-run, and archive checks.

**Independent Test**: An arbitrary positive bot-only batch fixture with a matching
primary/recovery archive and absent manifest reaches `recovery_repaired`;
complete state reaches `recovery_already_repaired`; all other states make no
Storage or cleanup mutation.

### Tests for User Story 2

- [x] T007 [US2] Add failing cases in `tests/chips/chips-ledger-stage-automation.test.mjs` for a non-9923 positive batch using the generic repair: partial archive-present/manifest-absent repair, 504/network reconciliation, complete idempotent resume, archive mismatch/unavailable/manifest-only/both-missing rejection, Stage fence rejection, and assertions that no `--execute`, destructive GO, DB DML, archive overwrite, or delete occurs.
- [x] T008 [P] [US2] Add/update workflow/CLI guard expectations in `tests/chips/chips-ledger-stage-automation.workflow.guard.test.mjs` for positive exact batch IDs, matching `REPAIR <batch_id>`, owner/main gates, empty execute/automatic gates, and absence of a 9923-only allowlist; keep schedule and batch-limit assertions unchanged.

### Implementation for User Story 2

- [x] T009 [US2] Replace `BOT_ONLY_BATCH_9923_RECOVERY_REPAIR`, `assertKnownBatch9923RecoveryBatch`, `assertBotOnly9923ArchiveCopies`, `uploadOrReconcileBotOnly9923Manifest`, and `runBotOnlyBatch9923RecoveryRepair` in `scripts/ops/chips-ledger-stage-automation.mjs` with generic exact-row/path validation and `runBotOnlyExactRecoveryRepair({ batchId })`; preserve the existing batch-15 corrected-manifest path as a separate legacy contract.
- [x] T010 [US2] In `runBotOnlyExactRecoveryRepair`, enforce Stage identity, active TABLE fence, advisory lock, exact committed/active manifest, complete immutable proof, ready dry-run, unpruned/un-cleaned/no-GO lifecycle, and primary/recovery byte/SHA equality immediately before the only missing-manifest `x-upsert:false` write; re-inspect both recovery objects as `complete` afterward and return `recovery_repaired` or `recovery_already_repaired`.
- [x] T011 [US2] Update the CLI dispatch in `scripts/ops/chips-ledger-stage-automation.mjs` to validate one positive bot-only batch ID and invoke the generic repair while retaining the existing supported policies; ensure no manual execute flag, Production credential, migration, or automatic policy enablement is introduced.
- [x] T012 [US2] Run the focused generic repair tests and `node --check scripts/ops/chips-ledger-stage-automation.mjs`; confirm every fail-closed fixture performs zero writes before the approved manifest POST.

**Checkpoint**: The repair is reusable and owner-gated, but no workflow is
dispatched and automatic cleanup still refuses pre-existing partial recovery.

## Phase 5: User Story 3 - Diagnose and hand off safely (Priority: P3)

**Goal**: Existing Job Summary output names the blocked batch, recovery
objects/state, and safe next action while normal automation remains unchanged.

**Independent Test**: Recovery failures render the new fields in stdout and
`GITHUB_STEP_SUMMARY`; a complete pair remains an idempotent success, and
workflow guards show no schedule or automatic eligibility change.

### Tests for User Story 3

- [x] T013 [US3] Add failing summary assertions in `tests/chips/chips-ledger-stage-automation.observability.behavior.test.mjs` for `recovery_state`, per-object `present/object_path/mime/size/sha256`, blocked batch ID, and `required_action`, while preserving exact unrelated summary keys and secret redaction.

### Implementation for User Story 3

- [x] T014 [US3] Extend `aggregatePayload`, `aggregateBatchPayload`, `aggregateAutomaticBatchPayload`, and recovery error context in `scripts/ops/chips-ledger-stage-automation.mjs` so recovery failures include state, missing/present object evidence, and read-only/owner-gated required action without changing unrelated report shapes.
- [x] T015 [US3] Update `.github/workflows/chips-ledger-stage-scheduled-automation.yml` descriptions and shell checks to accept a positive exact `bot_only_recovery_batch_id` with `REPAIR <same id>`, retaining canonical owner/main/Stage/fence and empty execute/automatic gates; do not change cron, concurrency, batch limits, cleanup mode, or Production behavior.
- [x] T016 [US3] Update `docs/chips-ledger-stage-automation.md` with the read-only audit inventory/growth/limits/error evidence and limitations, ambiguous-write cause, generic repair state contract, no-cleanup/no-DB/no-overwrite guarantees, owner GO requirements, and post-repair normal-run handoff.

**Checkpoint**: Operators can diagnose safely through the existing summary and
docs; live Stage repair still requires a separate owner GO.

## Phase 6: Polish, analysis, tests, and review

**Purpose**: Verify implementation, artifacts, safety boundaries, and draft PR
readiness.

- [x] T017 Run `speckit-analyze` across `spec.md`, `plan.md`, and `tasks.md`; resolve every critical consistency, coverage, constitution, and placeholder finding in the Spec Kit artifacts.
- [x] T018 Run `node --check` on `scripts/ops/chips-ledger-archive-store.mjs` and `scripts/ops/chips-ledger-stage-automation.mjs`, `npm run syntax`, a whitespace/diff integrity check, and the complete focused suite; keep test commands and results in the final report.
- [x] T019 Run `npm test` and classify any unrelated environment failure separately; verify `package.json`, `package-lock.json`, `supabase/migrations/`, and unrelated workspace paths are unchanged.
- [x] T020 Perform an independent read-only review of `scripts/ops/chips-ledger-archive-store.mjs`, `scripts/ops/chips-ledger-stage-automation.mjs`, `.github/workflows/chips-ledger-stage-scheduled-automation.yml`, `tests/chips/`, and `docs/chips-ledger-stage-automation.md` against the constitution, issue acceptance scenarios, fail-closed ordering, one-POST rule, `x-upsert:false`, Stage/Production boundaries, schedule/eligibility preservation, and no destructive cleanup; resolve valid findings. Independent review: PASS, 0 findings.
- [x] T021 Prepare a reviewed draft PR for issue #1014 containing the audit and safety evidence from `specs/007-stage-storage-recovery-resilience/`, changed functions/files from `scripts/ops/`, `.github/workflows/chips-ledger-stage-scheduled-automation.yml`, `tests/chips/`, and `docs/chips-ledger-stage-automation.md`, test/review results, breaking-change assessment, and explicit note that no Stage operation was dispatched; leave it unmerged and report CI status. Draft PR #1015 is open and unmerged; repository CI/Tests/catalog pass, unrelated WS PR Checks fail on two runtime tests.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No implementation dependency; establishes baseline.
- **Foundational (Phase 2)**: Depends on the repository baseline and design
  artifacts; blocks implementation until safety predicates are mapped.
- **User Story 1 (Phase 3)**: Depends on the foundational map; is the MVP and
  must be implemented/tests-first.
- **User Story 2 (Phase 4)**: Depends on the shared ambiguous-write contract
  from US1; tests precede the generic repair implementation.
- **User Story 3 (Phase 5)**: Depends on recovery state fields from US1/US2;
  summary and workflow tests precede their implementation.
- **Polish (Phase 6)**: Depends on all story checkpoints and implementation.

### User Story Dependencies

- **US1** can be validated independently after Phase 2.
- **US2** depends on US1's no-blind-POST contract but does not depend on live
  Stage state.
- **US3** consumes US1/US2 recovery evidence and preserves unrelated reporting.

### Parallel Opportunities

- T004 and T008 touch different test files and can be prepared in parallel
  after T003, but implementation remains sequential within each story.
- T013 can be prepared while the US2 implementation is being reviewed because
  it touches the observability test file only.
- T016 documentation can be updated independently after the final result shape
  is fixed; T017/T018 can run in parallel after code changes, though T019 is
  the broad-suite gate.
- No task involving Stage, Storage mutation, manual execute, or Production is
  parallelized or included.

## Implementation Strategy

### MVP First

1. Complete T001–T003.
2. Complete T004–T006 and verify one-POST reconciliation.
3. Continue to T007–T012 because the owner-gated repair safety gate is required
   before the issue is reviewable.

### Incremental Delivery

1. Shared ambiguous-write reconciliation (US1) preserves fail-closed behavior.
2. Generic exact repair (US2) removes the incident-specific code without
   enabling unattended repair.
3. Summary/workflow/docs (US3) make the handoff auditable.
4. Run Spec Kit analysis, focused/full tests, independent review, and draft PR.

## Notes

- Every task has a checkbox, sequential ID, and concrete repository path.
- Tests must be written and observed failing before their implementation task.
- Spec Kit artifacts contain no Git command instructions.
- No task dispatches a workflow or changes Stage/Production state.
