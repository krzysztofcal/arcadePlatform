# Tasks: Prevent false Stage CPU tick invalidation

**Input**: Design documents from `/specs/005-stage-cpu-ticks-validity/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`

**Tests**: Fundamental deterministic tests are required by issue #1007 and the repository constitution. No broad or speculative suites are in scope.

## Phase 1: Setup

**Purpose**: Establish the accepted #1007 scope and active Spec Kit artifacts.

- [x] T001 Confirm the #1007 scope, accepted safety invariants and feature artifacts in `specs/005-stage-cpu-ticks-validity/` (FR-001–FR-006).

## Phase 2: Foundational

**Purpose**: Trace the existing monitor/enforcement boundary before changing the predicate.

- [x] T002 Verify `measureWindow()` in `scripts/ops/stage-supabase-resource-health.mjs`, enforcement in `evaluateCleanupDecision()`/`exitCodeFor()`, and the unchanged guard invocation in `.github/workflows/chips-ledger-stage-scheduled-automation.yml` (FR-003–FR-006).

## Phase 3: User Story 1 — Permit valid Stage resource measurements (P1) 🎯 MVP

**Goal**: Accept valid positive monotonic CPU-counter ratios independent of Metrics endpoint cadence while preserving fail-closed health enforcement.

**Independent Test**: Run `node --test tests/stage-supabase-resource-health.test.mjs`; shorter/longer CPU intervals pass, stale/reset/incomplete/changed data stays unknown, and `--enforce` still blocks unknown/critical.

### Tests for User Story 1

- [x] T003 [US1] Add the failing interval-mismatch regression and retain fundamental stale/reset/incomplete/changed/enforcement assertions in `tests/stage-supabase-resource-health.test.mjs` (FR-001–FR-004, SC-001–SC-002).
- [x] T004 [US1] Run `node --test tests/stage-supabase-resource-health.test.mjs` and record the expected RED failure caused by the existing wall-time tick bound (SC-001).

### Implementation for User Story 1

- [x] T005 [US1] Replace only the `seconds * 0.8..1.2` CPU plausibility comparison in `scripts/ops/stage-supabase-resource-health.mjs::measureWindow()` with finite/positive aggregate counter-delta validation, preserving the existing 55–75 second check and all fail-closed guards (FR-001–FR-004).
- [x] T006 [US1] Run `node --test tests/stage-supabase-resource-health.test.mjs` and verify valid interval mismatch is accepted while real unknown/critical states remain blocking (FR-003–FR-004, SC-001–SC-003).

## Phase 4: Documentation and handoff

**Purpose**: Document the corrected CPU-series contract and validate the minimal diff.

- [x] T007 Update `docs/stage-supabase-resource-health.md` to distinguish the 55–75 second runner observation bound from the Metrics counter interval and document stale/no-positive-delta behavior (FR-005, SC-003).
- [x] T008 Run `npm test`, `npm run syntax`, review the full diff and confirm `.github/workflows/chips-ledger-stage-scheduled-automation.yml` is unchanged; prepare a draft PR linked to #1007 without merging (FR-005–FR-006, SC-003–SC-004).

## Dependencies & Execution Order

T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008.

Tests T003–T004 must be completed before T005. No parallel implementation tasks
are defined because the source and test file are coupled; documentation follows
the behavior change. The workflow is an inspected invariant, not a deliverable
edit.

## Implementation Strategy

Deliver the P1 story as the complete MVP: establish the regression, make the
single predicate change, run focused and repository validation, update the
contract documentation and hand off a draft PR. Do not add diagnostics,
retries, caching, workflow edits or any retention-path changes.
