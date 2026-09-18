# Research: Stage CPU tick validity

## Decision: decouple CPU ratios from runner wall time

`measureWindow()` should continue to require a bounded runner observation
window, but it must derive CPU and iowait percentages from the cumulative
counter deltas themselves. The effective interval represented by the two
Metrics endpoint snapshots is not guaranteed to equal the GitHub runner's
sleep/request interval; treating those values as identical caused the false
`cpu_ticks_invalid` result reported by issue #1007.

## Evidence

- Issue #1007 records recurring enforced `unknown` results with healthy disk
  capacity and `measurementReason=cpu_ticks_invalid` before any cleanup path.
- The current predicate rejects each CPU group unless its aggregate delta is
  between 80% and 120% of the measured runner window.
- The existing ratio calculation already uses the eight monotonic CPU modes;
  the wall-clock comparison is an additional assumption, not part of the
  ratio formula.
- Existing tests already cover stale snapshots, counter resets, incomplete
  modes, changed CPU groups and enforcement exit behavior.

## Safety decision

Keep all structural and fail-closed checks. Each CPU group must have finite,
nonnegative mode deltas and a positive aggregate delta; an unchanged snapshot
therefore remains `cpu_ticks_invalid`. The final aggregate total must also
remain finite and positive. The existing 55–75 second runner-window check is
unchanged.

## Alternatives considered

- **Widen the 80–120% tolerance**: rejected because it retains an arbitrary
  coupling to wall time and only moves the false-negative boundary.
- **Retry or cache a failed measurement**: rejected by #1007 and the existing
  fail-closed contract; it could turn unknown into an unsafe allow.
- **Change `--enforce` or the workflow gate**: rejected because genuine
  unknown/critical states must continue blocking retention.
- **Add raw or high-cardinality diagnostics**: rejected as unnecessary for this
  fix and contrary to the existing safe logging contract.
