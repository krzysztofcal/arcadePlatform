---

description: "Task list for the exact Stage bot-only recovery repair"
---

# Tasks: Stage Bot-Only Recovery Repair for Batch 9923

**Input**: Design documents from `/specs/006-stage-bot-only-recovery-repair/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, and `contracts/bot-only-recovery-repair.md`

**Tests**: Fundamental deterministic tests are required by the specification and must be written before production changes.

## Phase 1: Setup

**Purpose**: Confirm the existing repository baseline and feature boundary without changing runtime configuration.

- [X] T001 Run the baseline `node tests/chips/chips-ledger-stage-automation.test.mjs` in `tests/chips/chips-ledger-stage-automation.test.mjs` and record the passing baseline before implementation.
- [X] T002 Verify the planned change has no files under `supabase/migrations/**`, no dependency change, no Production target, and no schedule/eligibility edit in `.github/workflows/chips-ledger-stage-scheduled-automation.yml`.

---

## Phase 2: Foundational Safety Contracts

**Purpose**: Establish the exact target and state-machine contracts before user-story implementation.

- [X] T003 Validate the exact batch `9923` target, committed object path/SHA, Stage project, bot-only policy, unpruned lifecycle, and absent destructive GO in `specs/006-stage-bot-only-recovery-repair/data-model.md`.
- [X] T004 Document the manual input and CLI contract for exact batch `9923` in `specs/006-stage-bot-only-recovery-repair/contracts/bot-only-recovery-repair.md` and keep the existing batch `15` contract separate.

**Checkpoint**: The target is an immutable allowlist, and no arbitrary bot-only batch can enter the new repair path.

---

## Phase 3: User Story 1 — Repair the Exact Partial Recovery Pair (Priority: P1) 🎯 MVP

**Goal**: Repair only the missing recovery manifest for batch `9923` after verifying both archive copies and immutable proof.

**Independent Test**: A deterministic fixture with the exact row, primary archive, matching recovery archive, and missing manifest creates one manifest and verifies a complete recovery pair without any destructive call.

### Tests for User Story 1 — write first, then verify RED

- [X] T005 [US1] Add a deterministic successful-repair test in `tests/chips/chips-ledger-stage-automation.test.mjs` that supplies exact batch `9923`, a primary archive, an identical existing recovery archive, and no manifest; assert the only POST is the manifest path with `x-upsert:false`, the recovery archive bytes are unchanged, both objects verify complete, and no SQL/prune/execute/GO operation occurs.
- [X] T006 [US1] Add a deterministic ambiguous-504 test in `tests/chips/chips-ledger-stage-automation.test.mjs` where the manifest POST returns HTTP 504 but a subsequent GET returns matching bytes; assert the repair accepts the verified existing object without a second POST and reports complete recovery.
- [X] T007 Run the focused Stage automation test after T005–T006 and confirm the new tests fail for the missing `9923` repair entry point or missing 504 reconciliation, not because of a fixture error.

### Implementation for User Story 1

- [X] T008 [US1] Implement `runBotOnlyBatch9923RecoveryRepair(...)` in `scripts/ops/chips-ledger-stage-automation.mjs` using the existing Stage environment validation, advisory lock, exact-row reload, active-manifest comparison, dry-run evidence, private archive download, and full recovery inspection helpers; keep `runBotOnlyRecoveryRepair(...)` batch `15` behavior unchanged.
- [X] T009 [US1] Implement the `9923` partial-state flow in `scripts/ops/chips-ledger-stage-automation.mjs` so it accepts only a present and byte/SHA-verified recovery archive plus an absent manifest, creates only the canonical manifest, rechecks the lock, and verifies both objects complete without prune, cleanup, GO, or DB mutation.
- [X] T010 [US1] Implement exact `9923` CLI dispatch in `scripts/ops/chips-ledger-stage-automation.mjs` while retaining the existing `--batch-id 15` dispatch and rejecting all other bot-only repair IDs.
- [X] T011 [US1] Add scoped ambiguous-upload reconciliation in `scripts/ops/chips-ledger-stage-automation.mjs`: after an HTTP 504 from the missing-manifest create-only request, privately reread the manifest and accept only an exact MIME/size/byte/SHA match; if absent or mismatched, fail closed without a second POST.
- [X] T012 Run `node tests/chips/chips-ledger-stage-automation.test.mjs` and confirm T005–T006 pass while the existing batch `15` repair tests remain green.

**Checkpoint**: The exact incident state is repaired in deterministic tests, while batch `15` and all destructive lifecycle paths remain unchanged.

---

## Phase 4: User Story 2 — Preserve the Fail-Closed Lifecycle (Priority: P2)

**Goal**: Keep every mismatched, unsupported, or uncertain recovery state blocked with zero destructive work.

**Independent Test**: Corrupt or remove the surviving recovery archive, present an unsupported partial pair, or leave a 504 result unverifiable; each case stops before any manifest POST, prune, cleanup, GO, or SQL mutation.

### Tests for User Story 2 — write first, then verify RED

- [X] T013 [US2] Add a deterministic mismatch test in `tests/chips/chips-ledger-stage-automation.test.mjs` that changes one existing recovery-archive byte or SHA and asserts failure before the manifest upload, with the archive unchanged and no destructive calls.
- [X] T014 [US2] Add a deterministic unsupported-partial test in `tests/chips/chips-ledger-stage-automation.test.mjs` for a missing archive/present manifest or both-missing state; assert fail-closed behavior with zero Storage POST, prune, cleanup, GO, or database mutation.
- [X] T015 [US2] Add the no-object-after-504 assertion to `tests/chips/chips-ledger-stage-automation.test.mjs`: when a manifest POST returns HTTP 504 and the follow-up GET remains absent, the repair fails without retrying the POST or performing destructive work.
- [X] T016 Run the focused Stage automation test after T013–T015 and confirm these tests fail until the exact state validation and timeout reconciliation are implemented.

### Implementation for User Story 2

- [X] T017 [US2] Enforce fail-closed rejection and zero-write ordering in `scripts/ops/chips-ledger-stage-automation.mjs` for archive mismatch, absent archive, present/mismatched manifest, both-missing, unavailable, lock loss, proof mismatch, and unverifiable 504 outcomes.
- [X] T018 [US2] Run `node tests/chips/chips-ledger-stage-automation.test.mjs` and confirm the mismatch, unsupported-partial, 504-absent, existing batch `15`, and existing destructive-gate regression cases all pass.

**Checkpoint**: No uncertain recovery state can authorize cleanup or overwrite an existing Storage object.

---

## Phase 5: User Story 3 — Owner-Gated Handoff to Normal Automation (Priority: P3)

**Goal**: Expose one controlled owner/main workflow entry point and document the post-repair handoff without changing the schedule or automatic paths.

**Independent Test**: Workflow inspection shows the new mode is owner/main gated, exact-input gated, Stage-fence protected, and not part of schedule or automatic execution.

### Implementation for User Story 3

- [X] T019 [US3] Add `bot-only-7d-recovery-repair`, exact batch input `9923`, exact `REPAIR 9923` confirmation, owner/main checks, and Stage read-only fence coverage in `.github/workflows/chips-ledger-stage-scheduled-automation.yml` without changing cron, concurrency, automatic steps, or Production behavior.
- [X] T020 [P] [US3] Update `docs/chips-ledger-stage-automation.md` with the incident cause, exact `9923` repair mode, archive immutability, create-only manifest behavior, 504 reconciliation, verification sequence, required owner confirmation, and normal-automation handoff.
- [X] T021 [P] [US3] Ensure `specs/006-stage-bot-only-recovery-repair/quickstart.md` and `specs/006-stage-bot-only-recovery-repair/contracts/bot-only-recovery-repair.md` match the final CLI and workflow inputs, including the separate Stage GO requirement.

**Checkpoint**: The PR provides an auditable manual repair path but does not dispatch or mutate Stage.

---

## Phase 6: Polish and Verification

**Purpose**: Validate all artifacts, review the diff, and prepare a draft PR without merging or running Stage.

- [X] T022 Run `node --check scripts/ops/chips-ledger-stage-automation.mjs` and `node --check scripts/ops/chips-ledger-archive-store.mjs` if touched, then run the workflow/YAML syntax validation available in the repository.
- [X] T023 Run `npm test`, `npm run syntax`, and the focused `node tests/chips/chips-ledger-stage-automation.test.mjs`; record exact results and any unrelated failures.
- [X] T024 Run Spec Kit consistency analysis across `spec.md`, `plan.md`, and `tasks.md`, then correct any missing traceability or unchecked placeholder before review.
- [X] T025 Review the final diff for batch `15` behavior preservation, Stage-only gates, fail-closed ordering, `x-upsert:false`, no archive overwrite/delete, no migrations, no schedule/eligibility changes, and no Production references; prepare the draft PR description with cause, scope, tests, and breaking-change assessment.
- [X] T026 Perform an independent code review of the complete branch, resolve valid findings, and leave the PR explicitly draft and unmerged; record that Stage runtime repair and normal-automation verification are awaiting a separate owner GO.

### Verification record

- T022: `node --check scripts/ops/chips-ledger-stage-automation.mjs`, `npm run syntax` (218 files), `git diff --check`, and repository YAML parsing passed. `chips-ledger-archive-store.mjs` was not modified.
- T023: focused Stage automation tests and workflow guard passed. `npm test` ran to completion with one unrelated failure in `tests/admin-poker-maintenance.behavior.test.mjs` because `ws-server/server.mjs` cannot import the undeclared package `ws`; 7/8 subtests in that file passed. No dependency was added for this unrelated failure.
- T024: Spec Kit analysis found no critical consistency, coverage, constitution, or placeholder issue across `spec.md`, `plan.md`, and `tasks.md`.
- T025: Manual diff review and independent review confirmed batch `15`, Stage-only, fail-closed, create-only, no-overwrite/delete, no-migration, schedule, eligibility, and Production boundaries. The independent reviewer found and the implementation corrected a stale CLI usage line that omitted batch `9923`.
- T026: Independent read-only review completed with no medium/high findings after the usage correction. Draft PR [#1013](https://github.com/krzysztofcal/arcadePlatform/pull/1013) is open and unmerged; Stage repair and post-repair normal-automation verification remain blocked on a separate owner GO.

## Dependencies and Execution Order

### Phase Dependencies

- **Phase 1** establishes the clean baseline and scope; it has no implementation dependency.
- **Phase 2** establishes the exact allowlist and operator contract before code changes.
- **Phase 3** depends on Phases 1–2 and is the MVP; all tests T005–T007 precede production implementation T008–T011.
- **Phase 4** depends on the repair boundary from Phase 3; its tests T013–T016 precede the final fail-closed implementation T017.
- **Phase 5** depends on the final CLI/function contract from Phases 3–4.
- **Phase 6** depends on all implementation and documentation work.

### Parallel Opportunities

- T020 and T021 can run in parallel after the final CLI/workflow contract is known; they touch different documentation files.
- T022 and artifact inspection can run in parallel after implementation, but T023 is the final suite gate.
- Tasks touching `tests/chips/chips-ledger-stage-automation.test.mjs` remain sequential because they share one deterministic fixture file.

### MVP Scope

The MVP is User Story 1: exact batch `9923` repair with byte/SHA verification, create-only missing-manifest creation, and 504 reconciliation. User Story 2 is a required safety gate before the PR can be considered reviewable; User Story 3 supplies the owner-gated operational entry point and documentation.
