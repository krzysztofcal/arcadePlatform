# Plan: `calc_xp_timing` (#1313)

## Change
`netlify/functions/calculate-xp.mjs`:
- A small exported pure helper, `createXpTiming(clock = Date.now)`:
  - `start()`;
  - `async measure(phase, fn)`: it adds the elapsed ms to that phase even if `fn` throws, then rethrows;
  - `set(op, signedIn, status)`;
  - `fields()`: the integer phases plus `otherMs` and `totalMs`;
  - `shouldLog()`: `totalMs >= 1000` and op known.
- `handler(event)` becomes a thin wrapper that calls the unchanged body (renamed `handleCalculateXp`) inside `try`. In `finally`, inside its own `try/catch`, it emits `klog("calc_xp_timing", timing.fields())` when `shouldLog()`.
- The body wraps only the existing awaits listed in spec FR-002 with `timing.measure(...)`, passes the wrapped `readTotals`/`persistProfile` callbacks, and records `op`/`signedIn` once known and `status` from the returned response.
- Estimated diff: about +40 / −2 lines in one file.

## Tests (fundamental, existing node test file)
`tests/rate-limit.key-derivation.behavior.test.mjs` already imports the handler with node:test. Use it, or the closest existing node test that imports `calculate-xp.mjs`:
- `createXpTiming` with a fake clock:
  - below 1000 ms → `shouldLog()` false;
  - at 1000 ms or more → true;
  - `fields()` keys are exactly the allowed list;
  - the phase sum plus `otherMs` equals `totalMs`;
  - `measure` records time and rethrows on throw.
- `handler`: one existing-style status request still returns the same status and body. No new mocks of the business logic.

## Measurement automation (agent-run, Stage only)
- **Credentials:** a dedicated Stage test account in `/home/copilot/.arcade-stage-test/stage-test-user.env` (mode 600, outside all repositories, loaded only into the Playwright process environment). Never printed, logged or committed.
- **Script:** outside the repository (a run artifact on the Volume). Playwright against `deploy-preview-<PR>--playkcswh.netlify.app` (a Stage Supabase/Redis build).
  - Signs in through the existing Account sign-in form.
  - **≥ 10 status reads:** Account / index opens.
  - **≥ 10 awards:** real gameplay windows in an existing XP game, using normal input. No cap or session bypass.
  - Anonymous runs in a fresh context.
- **Data:** Netlify request logs plus the function log lines `calc_xp_timing` for those windows. Aggregates only: median and p90 per phase, op and identity. Requests below 1000 ms have no phase log; they are reported by total duration only.

## Constitution Check (v1.6.0)
| Gate | Result |
|---|---|
| I Simplicity | PASS: one helper, one log, the existing pattern |
| III Fail-closed | PASS: no behaviour change; the timing code cannot throw into the request |
| IV Logging | PASS: `klog` only, no identifiers |
| V Tests | PASS: fundamental, existing file |

## Risks
- Log volume: at most one line per slow request.
- The measurement covers Stage only. Stage Upstash appears slower than Production (2a research-2 §D), so the results are labelled Stage. Production numbers need an OWNER-decided publication.
- **Breaking changes:** none expected.
