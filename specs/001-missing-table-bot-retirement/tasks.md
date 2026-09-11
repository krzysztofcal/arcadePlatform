---

description: "Actionable implementation tasks for historical missing-table bot identity retirement"
---

# Tasks: Historical Missing-Table Bot Identity Retirement

**Input**: Design documents from `specs/001-missing-table-bot-retirement/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/missing-table-bot-retirement-operator.md`, and `quickstart.md`

**Tests**: The feature specification and approved plan require only three fundamental deterministic test groups, plus a minimal static/effective-guard regression contract. Extend the existing retention test file; do not add a new test framework or broad UI/CSS/JSP/glue suite.

**Organization**: Tasks are grouped by the four user stories in `spec.md`. The shared database safety boundary is implemented once and reused by the story-specific audit, retirement, protected-class, and residual-report work.

## Phase 1: Setup (Existing Project)

**Purpose**: Verify the existing implementation inputs without introducing generic setup work.

- [ ] T001 Verify the live implementation baseline and effective guard inputs in `supabase/migrations/20260825100000_chips_ledger_legacy_stage_allowlist_cleanup_hardening.sql`, `supabase/migrations/20260904180000_chips_ledger_closed_human_canary_execute.sql`, `scripts/ops/chips-ledger-archive-prune.mjs`, and `scripts/ops/chips-ledger-stage-automation.mjs`; preserve the existing mechanisms and make no `.gitignore`, `.npmignore`, tooling/configuration, dependency, scheduler, or cleanup-setup change (plan: current mechanism baseline; Constitution I, III, V)

---

## Phase 2: Foundational (Existing Safety Boundaries)

**Purpose**: Reuse the existing database/test boundary before implementing story behavior. No new framework, registry, tombstone, scheduler, or runtime path is required.

- [ ] T002 Prepare the existing disposable database fixtures in `tests/chips/chips-ledger-bot-only-retention.test.mjs` by reusing its PostgreSQL connection, parser, hash, role, receipt, and transaction helpers; keep `CHIPS_MIGRATIONS_TEST_DB_URL` optional and add no test framework or parallel test suite (plan: existing test mechanisms; Constitution V)

**Checkpoint**: Existing mechanisms and the fundamental test harness are ready; no generic project setup has been added.

---

## Phase 3: User Story 1 - Classify Registry Identities with Evidence (Priority: P1)

**Goal**: Document the accepted 2026-09-11 classification and revalidate it against current live repository and Stage evidence through a bounded, read-only, DB-only audit.

**Independent Test**: Run `scripts/ops/chips-ledger-missing-table-bot-retirement.mjs --target stage --mode audit`; every material class has producer/type/ownership/key/version/replay/hot/archive evidence plus rows/day and bytes/day metrics, and incomplete evidence remains unknown/fail-closed without mutation.

### Implementation for User Story 1

- [ ] T003 [US1] Implement the local DB-only Stage preflight in `scripts/ops/chips-ledger-missing-table-bot-retirement.mjs` using only `SUPABASE_STAGE_DB_URL`, canonical Stage project/system identity, `createPruneStore(sql).getIdentity()`, and `chips_assert_archive_prune_stage()`; reject Production target/credential variables, do not require or read `SUPABASE_STAGE_URL` or `SUPABASE_STAGE_SERVICE_ROLE_KEY`, use `klog`, and do not expand `validateStageEnvironment()` (FR-006, FR-016, SC-008)
- [ ] T004 [US1] Implement the bounded `audit` mode in `scripts/ops/chips-ledger-missing-table-bot-retirement.mjs` over `chips_ledger_archive_batches` and immutable `archive_batch_id` registry mappings; revalidate the already-performed 2026-09-11 classification, call `chips_retire_missing_table_bot_registry_batch(..., p_execute = false)` for strict per-batch validation, report every material class and the exact missing-table whole-batch candidates, route incomplete/conflicting evidence to unknown/fail-closed, and emit aggregate `klog` metrics for key/version, transaction type, user/ownership, replay, hot/archive state, age, rows/day, bytes/day, 30-day, and one-year projections without any mutation or generic/persistent classifier (US1/AC1-3, FR-001, FR-002, FR-017, SC-001, SC-002, SC-007)
- [ ] T005 [P] [US1] Create the classification and baseline section in `docs/issue-978-idempotency-retention-audit.md`, distinguishing the accepted research counts from fresh Stage measurements and documenting the four V1 families, protected classes, fail-closed evidence rules, and no-authorization meaning of historical estimates (US1/AC1-3, FR-002, FR-003, SC-001, SC-002)

**Checkpoint**: A read-only DB-only audit can revalidate the historical classification and produce a reviewable candidate report without a delete or receipt mutation.

---

## Phase 4: User Story 2 - Retire One Proven Historical Batch Safely (Priority: P1) 🎯 MVP

**Goal**: Retire one exact, complete, Stage-only batch atomically using existing archive/prune/fence/receipt mechanisms and preserve the no-second-economic-effect boundary.

**Independent Test**: The three fundamental test groups in `tests/chips/chips-ledger-bot-only-retention.test.mjs` cover a valid whole batch, an exact retry, and the allowed terminal retired-key replay result; the valid batch receives an exact receipt and no account/ledger/economic mutation occurs.

### Tests for User Stories 2 and 3 (write before shared implementation)

- [ ] T006 [US2] Add the happy-path whole-batch test group in `tests/chips/chips-ledger-bot-only-retention.test.mjs`: a committed, fully proven and exactly pruned `format_version = 1` / `source_policy_id = 'stage-ledger-auto-retention-30d-v1'` batch returns `ready`, executes an all-or-nothing delete of its complete mapped registry set, records matching `registry_cleaned_at`, `registry_cleaned_key_count`, and `registry_cleaned_keys_sha256`, and proves a retired-key replay creates zero second transactions, entries, balance changes, or provenance changes (US2/AC1, US2/AC4, FR-004, FR-005, FR-007, FR-010, SC-003, SC-005)
- [ ] T007 [US2] Add the exact retry test group in `tests/chips/chips-ledger-bot-only-retention.test.mjs`: a complete matching receipt with no residual `archive_batch_id` mapping returns `already_retired` without mutation, while a partial receipt or mismatching batch/count/hash is rejected fail-closed (US2/AC3, FR-009, SC-004)
- [ ] T008 [US3] Add one compact table-driven fail-closed matrix in `tests/chips/chips-ledger-bot-only-retention.test.mjs` covering protected human, full-replay, and legacy/unknown identities; existing OPEN/CLOSED table; hot transaction or entry; unsupported/malformed key; mixed batch; proof/prune mismatch; and wrong Stage identity. Every case must reject the complete batch with no registry deletion or economic mutation, without creating a separate test suite (US2/AC2, US3/AC1-4, FR-008, FR-011, FR-012, FR-013, FR-014, SC-004, SC-006)
- [ ] T009 [US3] Add the minimal `effectiveArchiveGuardRegressionContract()` to `tests/chips/chips-ledger-bot-only-retention.test.mjs`, reading `supabase/migrations/20260825100000_chips_ledger_legacy_stage_allowlist_cleanup_hardening.sql`, `supabase/migrations/20260904180000_chips_ledger_closed_human_canary_execute.sql`, and `supabase/migrations/20260911100000_chips_ledger_missing_table_bot_registry_retirement.sql`; assert only that all-null, schema-v2 bot-only, and `legacy_stage_allowlist_v1` receipt branches remain, `chips.bot_only_go` and `chips.closed_human_go` remain effective, and the new migration derives/checks the latest guard instead of copying an older body. Reuse the existing disposable harness to exercise the legacy receipt and closed-human authorization/GO fixtures where available; do not assert every implementation fragment (FR-011, FR-012, FR-013, FR-014, SC-006)

### Implementation for User Story 2

- [ ] T010 [US2] Create exactly one additive migration at `supabase/migrations/20260911100000_chips_ledger_missing_table_bot_registry_retirement.sql` that preserves the current `chips_ledger_archive_batches_cleanup_receipt_check` states: all `registry_cleaned_*` fields null; the `format_version = 2`, `source_policy_id = 'stage-ledger-bot-only-retention-7d-v1'` receipt with complete proof/prune evidence and matching `bot_only_registry_keys_sha256`; and the `format_version = 2`, `source_policy_id = 'legacy_stage_allowlist_v1'` receipt with its existing proof/prune/count/hash conditions. Add only the `format_version = 1` plus exact `source_policy_id = 'stage-ledger-auto-retention-30d-v1'` branch. Obtain `chips_guard_archive_batch_mutations()` through `pg_get_functiondef(...)` after all prior migrations, require legacy, `chips.bot_only_go`, and `chips.closed_human_go` anchors, abort on shape drift, and preserve write-once fields, separate transitions, the legacy `chips.legacy_stage_cleanup`/proof latches, schema-v2 bot-only GO, and closed-human GO; do not copy an older guard body or alter `chips_guard_idempotency_mutations()` (FR-004, FR-005, FR-008, FR-014, FR-015, FR-016)
- [ ] T011 [US2] Define `public.chips_retire_missing_table_bot_registry_batch(p_batch_id bigint, p_registry_key_count bigint, p_registry_keys_sha256 text, p_execute boolean default false, p_confirmation text default null)` in `supabase/migrations/20260911100000_chips_ledger_missing_table_bot_registry_retirement.sql` as `SECURITY DEFINER` with `set search_path = ''`, owner `chips_ledger_archive_pruner`, `REVOKE EXECUTE ... FROM public, anon, authenticated, service_role`, and `GRANT EXECUTE ... TO postgres` only. Enforce the data-model constraints verbatim: `project_ref` “Must equal `krydukthwdvccggbyjfw`”; `format_version` “Must be `1`”; `source_policy_id` “Must equal exactly `stage-ledger-auto-retention-30d-v1`”; `status` “Must be committed with a non-null commit timestamp”; prune counts “must equal these values and be positive”; all archive proof and all five prune receipt fields must be complete/exact; each registry row must have `tx_type` exactly `TABLE_BUY_IN` or `TABLE_CASH_OUT`, `user_id` null, `archive_batch_id` equal to the selected batch, non-null `table_id`, and `key_format_version` exactly `1`; each key must be one of `managed-bot-seed-buyin`, `bot-seed-buyin`, `poker:bot-replacement-buyin:v1`, or `poker:bot-terminal-cashout:v1`, parse successfully, and have parsed `tableId` equal to stored `table_id`; require both `chips_table_fence_is_active()` and `chips_table_fence_control.enforcement_active`, absent `poker_tables`, no hot transactions/entries, `registry_count = transaction_count`, and one exact sorted identity-set count/hash computed by `chips_archive_text_ids_sha256(text[])`; execute only the whole batch with exact `GO <batch_id>`, receipt latches, affected-row verification, and atomic receipt write; return `ready`, `retired`, or exact `already_retired`, otherwise roll back fail-closed without economic mutation (FR-004 through FR-010, SC-003 through SC-005)
- [ ] T012 [US2] Add explicit `audit`/`execute` integration to `scripts/ops/chips-ledger-missing-table-bot-retirement.mjs` using the database function from `supabase/migrations/20260911100000_chips_ledger_missing_table_bot_registry_retirement.sql`; pass only the audited batch ID/count/hash and exact `GO <batch_id>`, use serializable execution and existing timeout/lock patterns, emit structured `klog`, and never call archive-prune mutation functions, Storage, REST, or any client-supplied key subset (FR-006, FR-007, FR-008, FR-009, FR-016)
- [ ] T013 [US2] Document the audit, explicit exact-batch GO, Stage canary, atomic execute, receipt verification, exact retry, and breaking retired-key replay semantics in `docs/issue-978-idempotency-retention-audit.md`; include abort criteria for every missing, conflicting, stale, hot, present-table, parser, proof, prune, count/hash, fence, and target predicate and state that human/full-replay/legacy/unknown identities and normal #890 CLOSED bot-only cleanup remain owned and retained (US2/AC1-4, FR-005, FR-006, FR-008, FR-010, FR-011, FR-012, FR-013, FR-014, FR-016)

**Checkpoint**: One exact Stage batch can be audited and, after explicit owner GO, retired atomically with an immutable matching receipt and no second economic effect.

---

## Phase 5: User Story 3 - Preserve Identities with Different Replay Contracts (Priority: P1)

**Goal**: Keep human TABLE, full-replay, legacy/unknown, and normal #890 CLOSED bot-only identities on their existing paths while the new V1 branch remains narrow.

**Independent Test**: The compact fail-closed matrix rejects every protected class and the minimal effective-guard regression contract confirms the legacy receipt and closed-human/bot-only GO behavior after the additive migration is applied in the disposable database.

### Tests and shared implementation coverage

The protected-class matrix and effective-guard regression contract are written before the shared migration/operator tasks T010-T011 in Phase 4. They are the complete implementation test coverage for this story; no second protected-identity implementation path is introduced.

**Checkpoint**: Protected identities remain retained, the legacy cleanup receipt remains valid, and closed-human GO remains an alternative to bot-only GO without broadening V1.

---

## Phase 6: User Story 4 - Measure the Residual Registry Horizon (Priority: P2)

**Goal**: Provide a measurable before/after view of residual registry growth without claiming a full database plateau.

**Independent Test**: Compare the audit report before and after the canary; each identity class has rows/day and bytes/day plus 30-day and one-year projections, and any indefinite class names its blocking contract.

### Implementation for User Story 4

- [ ] T014 [P] [US4] Extend the read-only report in `scripts/ops/chips-ledger-missing-table-bot-retirement.mjs` to calculate residual hot registry rows/day, bytes/day, 30-day capacity, and one-year capacity by identity class before and after a canary, while separating the historical estimate from current measurements and leaving unsupported/unknown classes fail-closed (US4/AC1-3, FR-001, FR-002, FR-017, SC-001, SC-002, SC-007)
- [ ] T015 [US4] Add the post-action residual-horizon and target-evidence section to `docs/issue-978-idempotency-retention-audit.md`, naming any indefinite growth class and its blocking contract and recording Stage-only evidence with no Production enablement or mutation claim (US4/AC1-3, FR-016, FR-017, SC-007, SC-008)

---

## Phase 7: Polish & Cross-Cutting Validation

**Purpose**: Validate the completed feature against the approved artifacts while preserving the narrow scope.

- [ ] T016 Run the existing critical validation commands `node scripts/syntax-check.mjs`, `node tests/chips/chips-ledger-bot-only-retention.test.mjs`, and `npm test`, and validate the scenarios in `specs/001-missing-table-bot-retirement/quickstart.md`; use `CHIPS_MIGRATIONS_TEST_DB_URL` only for the disposable database contract and perform no Stage or Production mutation (plan: validation; Constitution III, V)
- [ ] T017 Perform the final scope and safety review across `supabase/migrations/20260911100000_chips_ledger_missing_table_bot_registry_retirement.sql`, `scripts/ops/chips-ledger-missing-table-bot-retirement.mjs`, `tests/chips/chips-ledger-bot-only-retention.test.mjs`, and `docs/issue-978-idempotency-retention-audit.md`; confirm exactly one additive migration, one DB-only manual operator, three behavioral test groups plus the minimal guard regression, no runtime/WS/browser/Storage/workflow/Production change, no generic setup cleanup, and no scheduler/tombstone/classification framework (FR-015, FR-016, SC-008, Constitution I, III, V)

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 must confirm the effective live mechanisms before any feature file is changed; no project initialization or generic ignore/config work is required.
- **Foundational (Phase 2)**: T002 reuses the existing test/database boundary and blocks the story-specific implementation work.
- **User Story 1 (Phase 3)**: T003 and T004 depend on T001/T002; T005 can run in parallel with T003 because it edits only `docs/issue-978-idempotency-retention-audit.md`.
- **User Story 2 (Phase 4)**: T006-T009 are written before T010-T012; T010 is the only migration task, T011 is the only database operator definition in that migration, and T012 depends on T003 and T011. T013 follows the execute contract.
- **User Story 3 (Phase 5)**: Its pre-implementation tests are T008-T009 in the shared P1 test block; T010-T011 preserve the shared migration/operator contract, and this phase adds no duplicate implementation path.
- **User Story 4 (Phase 6)**: T014 depends on the audit shape from T003/T004; T015 follows the resulting report and remains documentation-only.
- **Polish (Phase 7)**: T016 and T017 run after all desired story work and must not perform Stage/Production actions.

### User Story Dependencies

- **User Story 1 (P1)**: Independent after T002; it supplies the current audit evidence used by the exact-batch flow.
- **User Story 2 (P1)**: Depends on the shared mechanisms in T001/T002 and the audit/preflight shape from T003/T004; its tests precede the migration/operator tasks.
- **User Story 3 (P1)**: Shares T010/T011 but has independent protected-class and effective-guard regression checks in T008/T009.
- **User Story 4 (P2)**: Depends on the audit output and canary report shape from User Stories 1 and 2; it does not authorize a mutation.

### Within Each User Story

- Run the tests specified by the plan before the corresponding implementation tasks.
- Keep all edits to `tests/chips/chips-ledger-bot-only-retention.test.mjs` sequential because the three behavioral groups and the regression contract share one existing file.
- Keep the single migration's receipt constraint, effective guard patch, and DB function sequential because they share `supabase/migrations/20260911100000_chips_ledger_missing_table_bot_registry_retirement.sql`.
- Treat every missing, ambiguous, conflicting, hot, protected, mixed, or wrong-target condition as a whole-batch fail-closed result.

### Parallel Opportunities

- T003 and T005 can run in parallel after T001/T002 because they edit different files.
- T014 can run in parallel with the documentation-only T015 after the audit output shape is agreed; both remain read-only/reporting work.
- The three behavioral test groups are deliberately sequential because they extend the same existing test file; they are not marked `[P]`.

## Implementation Strategy

### MVP First (User Stories 1 and 2)

1. Complete T001-T002 using existing mechanisms only.
2. Complete the DB-only audit/preflight in T003-T005.
3. Write T006-T009, then implement exactly one additive migration and one DB-only operator in T010-T012.
4. Complete the exact GO, receipt, retry, and retired-key replay documentation in T013.
5. Stop for independent review after the first exact Stage canary; no automatic drain or Production rollout is part of MVP.

### Incremental Delivery

1. Deliver the read-only classification and residual report.
2. Deliver one reviewed exact-batch retirement with receipt/replay evidence.
3. Validate protected identity and effective guard preservation.
4. Reconcile residual growth and capacity projections.

## Notes

- `[P]` means different files with no dependency on incomplete work.
- `[US1]` through `[US4]` map tasks to the user stories in `spec.md`.
- The only behavioral tests are Group 1 happy path/replay, Group 2 compact fail-closed matrix, and Group 3 exact retry; T009 is a minimal static/effective-guard regression contract, not a fourth suite.
- `tasks.md` contains no Git commands and no implementation code; it only names concrete paths, functions, properties, constraints, and validation commands.
- No task authorizes `$speckit-implement`, `$speckit-converge`, Stage mutation, Production mutation, PR merge, or generic setup cleanup.
