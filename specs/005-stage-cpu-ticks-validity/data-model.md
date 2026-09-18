# Data Model: Stage CPU tick validity

This feature has no persisted entities, schema changes or new external data
contract. It changes validation of the existing in-memory measurement result.

## CPU measurement window

- `windowSeconds`: measured runner observation duration; valid only from 55 to
  75 seconds.
- `cpuPercent`: derived from the sum of all mode deltas, excluding idle and
  iowait; `null` when required CPU data is unusable.
- `iowaitPercent`: derived from iowait deltas over the same positive total;
  `null` when CPU data is unusable.
- `measurementReason`: existing safe reason such as `cpu_ticks_invalid`,
  `counter_reset`, `cpu_modes_incomplete`, `series_set_changed` or
  `window_out_of_range`.

## Validation transitions

1. Out-of-range runner duration → `window_out_of_range` and unknown CPU.
2. Missing/changed required CPU groups or incomplete modes → the existing
   structural reason and unknown CPU.
3. Decreasing, non-finite or zero aggregate counter deltas → the existing
   invalid/reset reason and unknown CPU.
4. Complete monotonic positive deltas → finite CPU/iowait ratios, independent
   of whether the counter interval matches `windowSeconds`.

Disk observations remain a separate existing collection and are not changed by
this feature.
