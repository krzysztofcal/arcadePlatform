# Stage CPU tick validity Implementation Plan

**Branch**: `005-stage-cpu-ticks-validity` | **Date**: 2026-09-18 | **Spec**: [spec.md](spec.md)

## Summary

Remove only the false CPU plausibility assumption in `measureWindow()`: the
runner's 55–75 second wall-clock window remains required, but cumulative CPU
counter ratios are validated from finite monotonic deltas and a positive
aggregate delta rather than from equality with runner seconds. Existing
unknown/critical enforcement and all retention boundaries remain unchanged.

## Technical Context

**Language/Version**: Node.js ESM, Node 20 in GitHub Actions (Node 22 used for local validation)

**Primary Dependencies**: Existing `postgres` dependency for the imported monitor module; no new dependencies

**Storage**: Read-only Supabase/PostgreSQL access already used by the monitor; no storage or schema change

**Testing**: Node built-in `node:test` and `node --test tests/stage-supabase-resource-health.test.mjs`

**Target Platform**: Linux GitHub Actions runner and the existing Stage resource-health CLI

**Project Type**: Internal Node.js operations monitor/CLI

**Performance Goals**: Preserve the existing two Metrics GETs, 60-second wait and five-minute guard timeout

**Constraints**: Minimal change in `measureWindow()`; retain fail-closed behavior for unusable CPU data, unknown/critical enforcement, disk handling, and all retention/workflow boundaries

**Scale/Scope**: One CPU validation predicate, one existing fundamental test file, one documentation section; no workflow functional change

## Constitution Check

*GATE: Must pass before research and after design.*

- **I. Simplicity and Existing Mechanisms**: PASS — one predicate in the existing function; no abstraction, dependency or refactor.
- **III. Fail-Closed Safety and Environment Separation**: PASS — zero/non-finite/reset/incomplete/changed/invalid data remains unknown; `--enforce` is untouched; no Production path changes.
- **V. Fundamental Tests and Concrete Plans**: PASS — existing deterministic test file is extended only for the critical regression and safety cases; paths and function names are explicit.
- **Scope guard**: PASS — cleanup selectors, eligibility, batch sizes, retries, Storage, recovery, Production and workflow behavior are explicitly excluded.

## Project Structure

### Feature documentation

```text
specs/005-stage-cpu-ticks-validity/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
└── tasks.md
```

### Source touch-points

```text
scripts/ops/stage-supabase-resource-health.mjs  # measureWindow() CPU validation
tests/stage-supabase-resource-health.test.mjs   # fundamental regression/safety tests
docs/stage-supabase-resource-health.md          # CPU-series contract
.github/workflows/chips-ledger-stage-scheduled-automation.yml  # inspected; no functional edit
```

**Structure Decision**: Extend the existing monitor module and its existing
fundamental test file. The workflow remains the consumer of the unchanged
`--enforce` contract, so no workflow edit is part of this feature.

## Implementation Plan

1. **Regression tests** — in `tests/stage-supabase-resource-health.test.mjs`,
   construct complete monotonic CPU snapshots with aggregate deltas below and
   above the 60-second runner window. Assert ratios are finite and the reason is
   not `cpu_ticks_invalid`; keep stale, reset, incomplete-mode, changed-group
   and `--enforce` safety assertions.
2. **Minimal implementation** — in
   `scripts/ops/stage-supabase-resource-health.mjs::measureWindow()`, retain
   the 55–75 second wall-clock guard, required eight-mode/group checks, decrease
   detection and disk path. Replace only the per-CPU `seconds * 0.8..1.2`
   plausibility comparison with finite, positive aggregate counter-delta
   validation; retain the final finite/positive total guard.
3. **Documentation** — in `docs/stage-supabase-resource-health.md`, state that
   55–75 seconds bounds the requested runner observation window, while CPU and
   iowait ratios use the Metrics counter deltas and do not require endpoint
   cadence to equal runner wall time. Document stale/no-positive-delta behavior.
4. **Validation and review** — run the focused test, the repository test
   command, syntax checks applicable to the touched JavaScript, inspect the full
   diff and verify the workflow has no functional diff. Prepare a draft PR
   linked to #1007 without merging it.

## Required Invariants

- CPU ratios continue to use all eight documented CPU modes; guest counters are not added separately.
- `windowSeconds` must remain within 55–75 seconds.
- Missing series, changed required groups, incomplete modes, counter decrease, non-finite/invalid values and zero elapsed counter time remain unknown.
- `evaluateCleanupDecision()` and `exitCodeFor()` are not changed; unknown and critical still block `--enforce`.
- Disk counter handling remains independent and unchanged.
- No change is made to the scheduled automation workflow, cleanup selectors, eligibility, batch sizes, retries, Storage, recovery, Production or dependencies.

## Complexity Tracking

No violations. The accepted design reuses the current function, status reason,
test file and documentation; it adds no new public API or abstraction.

## Post-Design Constitution Check

PASS. The design changes only the false wall-time coupling identified by #1007,
keeps the safety boundary fail-closed, and is limited to the named source,
tests, documentation and Spec Kit artifacts.
