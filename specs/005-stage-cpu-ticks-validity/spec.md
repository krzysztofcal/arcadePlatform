# Feature Specification: Prevent false Stage CPU tick invalidation

**Feature Branch**: `005-stage-cpu-ticks-validity`

**Created**: 2026-09-18

**Status**: Accepted

**Input**: GitHub issue [#1007](https://github.com/krzysztofcal/arcadePlatform/issues/1007), which reports recurring false `cpu_ticks_invalid` results blocking scheduled Stage retention.

## User Scenarios & Testing

### User Story 1 - Permit valid Stage resource measurements (Priority: P1)

As the Stage retention guard, I can classify a valid monotonic CPU-counter window even when the Metrics endpoint's effective counter interval differs from the runner's wall-clock sampling interval, while still refusing unusable measurements.

**Why this priority**: A false unknown currently blocks legitimate retention before cleanup starts, while the guard must remain fail-closed for real uncertainty and pressure.

**Independent Test**: Run the fundamental resource-health test file with synthetic CPU counter maps covering shorter/longer counter intervals, stale data, resets, incomplete modes/groups, and enforced unknown/critical states.

**Acceptance Scenarios**:

1. **Given** complete monotonic CPU counters with a positive aggregate delta, **when** the counter delta represents less or more elapsed CPU time than the runner's 60-second wall window, **then** CPU and iowait ratios are calculated and the result is not `cpu_ticks_invalid`.
2. **Given** unchanged CPU counters or no positive elapsed CPU counter delta, **when** the window is measured, **then** CPU pressure remains unknown with a safe invalid-measurement reason.
3. **Given** a counter decrease, incomplete CPU modes, changed required CPU groups, non-finite/invalid values, or a runner window outside 55–75 seconds, **when** the window is measured, **then** the result remains unknown and fail-closed.
4. **Given** a genuine unknown or critical resource state, **when** the script runs with `--enforce`, **then** cleanup is blocked with a non-zero exit code.
5. **Given** a healthy or warning state, **when** the existing Stage guard runs, **then** its thresholds, cleanup decision, selectors, eligibility, batch sizes, retry behavior, Storage behavior, recovery paths, workflow schedule and Production behavior remain unchanged.

### Edge Cases

- A valid CPU counter interval may be shorter or longer than the runner's wall-clock sleep while remaining monotonic and positive.
- An unchanged/stale snapshot must not become a healthy zero-load result.
- A single CPU group with missing required mode data or a changed required group set must invalidate CPU pressure without weakening disk validation.
- Invalid wall-clock windows remain invalid even if counter deltas are otherwise usable.

## Requirements

### Functional Requirements

- **FR-001**: `measureWindow()` MUST validate CPU data from the eight documented modes and their monotonic counter deltas, not by requiring aggregate CPU ticks to match runner wall-clock seconds within a fixed ratio.
- **FR-002**: `measureWindow()` MUST accept finite, nonnegative counter deltas when the aggregate CPU delta is positive, and MUST calculate CPU and iowait ratios from those deltas.
- **FR-003**: Missing CPU series, changed required CPU groups, incomplete required modes, counter decreases, non-finite/invalid values, zero aggregate elapsed CPU time and runner windows outside 55–75 seconds MUST remain unknown/fail-closed.
- **FR-004**: `evaluateCleanupDecision()` and `exitCodeFor()` MUST continue to block genuine `unknown` and `critical` states when `--enforce` is active; healthy and warning thresholds MUST remain unchanged.
- **FR-005**: The implementation MUST be limited to `scripts/ops/stage-supabase-resource-health.mjs`, fundamental tests in `tests/stage-supabase-resource-health.test.mjs`, and the resource-health documentation. The scheduled automation workflow MUST not receive a functional change.
- **FR-006**: The change MUST NOT alter cleanup selectors, eligibility, batch sizes, retries, Storage, recovery, Production, generic configuration, dependencies or unrelated resource-health behavior.

## Key Entities

- **CPU measurement window**: Two complete Stage Metrics snapshots plus the bounded runner observation duration used to derive CPU and iowait ratios.
- **Resource health result**: The existing pressure/capacity classification and enforcement decision consumed by the Stage retention guard.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A synthetic complete monotonic CPU window with a counter interval below the runner's wall window and one above it produces finite CPU/iowait ratios instead of `cpu_ticks_invalid`.
- **SC-002**: Stale, reset, incomplete, changed-group and invalid-window fixtures remain unknown, and enforced unknown/critical fixtures return a blocking result.
- **SC-003**: The existing fundamental Stage resource-health test file passes without changes to the scheduled workflow or retention-path limits.
- **SC-004**: The final diff contains no changes to cleanup selectors, eligibility, batch sizes, retry, Storage, recovery or Production code paths.

## Assumptions

- The Metrics endpoint returns monotonic cumulative CPU counters whose effective snapshot cadence is not guaranteed to equal the runner's request cadence.
- The existing 55–75 second wall-clock bound still protects the requested two-scrape observation window.
- No new diagnostic field is needed; the existing safe `measurementReason` is sufficient.
