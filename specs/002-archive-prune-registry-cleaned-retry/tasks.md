# Tasks: Archive prune registry-cleaned retry

## Phase 1: Setup

- [x] T001 Verify live main and incident evidence; record in `specs/002-archive-prune-registry-cleaned-retry/research.md` (FR-004).

## Phase 2: Foundation

- [x] T002 Trace effective pruner and #980 receipt guards; define `specs/002-archive-prune-registry-cleaned-retry/contracts/prune-retry.md` (FR-001–003).

## Phase 3: US1 — Safe completed retention retry (P1)

Goal: accept only authorized terminal cleanup; reject incomplete evidence.
Independent test: existing serializable rollback probe, valid retirement plus negative savepoints.

- [x] T003 [US1] Extend `tests/chips/chips.migration.test.mjs` with actual #980 cleanup then both retry modes, missing/partial/count/hash evidence and residual mappings; reproduce failure before migration (FR-001–003, SC-001–002).
- [x] T004 [US1] Add one forward migration in `supabase/migrations/` named `chips_archive_prune_registry_cleaned_retry`, patching only the current complete-receipt registry predicate; require all three fields, equal positive count, lowercase 64-hex digest, canonical Stage/v1 policy and zero registry mappings (FR-001–004).

## Phase 4: Validation and handoff

- [x] T005 Run existing migration/pruning/bot-retention/automation tests; compare effective function and review/simplify entire diff; record results in `specs/002-archive-prune-registry-cleaned-retry/quickstart.md` (FR-003–005, SC-003).
- [x] T006 Prepare draft PR linked to #981 with root cause, trust boundary, tests, breaking impact and operational Stage verification status in `specs/002-archive-prune-registry-cleaned-retry/quickstart.md` (FR-005).

## Dependencies and strategy

T001 → T002 → T003 → T004 → T005 → T006. US1 is the complete minimal deliverable. No parallel implementation tasks: the regression and fix are sequential. Existing independent test commands may run together after T004. No setup/configuration cleanup authorized. Stage operational acceptance is tracked separately from implementation completion; no claim of recovery without the exact existing-30d path.
