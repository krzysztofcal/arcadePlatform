# Plan: `calc_xp_timing` (#1313)

## Change
`netlify/functions/calculate-xp.mjs`:
- A small exported helper, `createXpTiming(clock = () => performance.now())`, started on creation:
  - `async measure(phase, fn)`: adds the elapsed time to that phase even if `fn` throws, then rethrows;
  - `set(patch)`: merges `{ op, signedIn, status }`;
  - `payload()`: **one** clock read decides the threshold on the raw time and builds the fields; returns `null` when below 1000 ms or `op` is unknown.
- `handler(event)` is a thin wrapper around the unchanged body (`handleCalculateXp`). In `finally`, inside its own `try/catch`, it sets `status` (`null` if nothing was returned) and emits `klog("calc_xp_timing", payload)` when the payload is not `null`.
- The body wraps only the awaits listed in spec FR-002 with `timing.measure(...)` and passes wrapped `readTotals`/`persistProfile` callbacks.

## Tests (fundamental, existing node test file `tests/rate-limit.key-derivation.behavior.test.mjs`)
- `createXpTiming` with a fake clock: raw 999.6 ms → `null`, exactly 1000 ms → payload; unknown op → `null`; rounded phases reaching 1000 ms with raw below → `null`; phase sum above the rounded total → `totalMs` = sum, `otherMs` = 0; `measure` records time on success and on throw and rethrows.
- `handler` with a stubbed `performance.now`: a fast request emits nothing and its whole response (status, headers, body with a fixed `Date.now`) equals the expected object; a slow request emits exactly the expected payload; a throwing request rethrows the same error and emits the payload with `status: null`.

## Measurement automation (agent-run, Stage only)
- **Credentials:** a dedicated Stage test account provided by the OWNER, stored in `/home/copilot/.arcade-stage-test/stage-test-user.env` (mode 600, outside all repositories and agent config directories). The script reads it literally, with no shell sourcing, and it is never printed, logged or committed. No Preview-account runbook exists in the repository (`AGENTS.md`, `skills.md`, `docs/` searched); the OWNER-defined account and handover are the procedure and are re-read before each signed-in run.
- **Stage guard (R1/F5):** before signing in, the script aborts unless the Preview's served public Supabase config host equals the expected Stage host. Sign-in proof (R2/F3): before the run, read the aggregate `max(auth.users.last_sign_in_at)` on Stage; after the run, count Stage sign-ins newer than that value. The measurement is rejected unless exactly the run's sign-in is new and falls inside its login window. Aggregates only, no account identifiers.
- **Script:** outside the repository (a run artifact on the Volume). Playwright against `deploy-preview-<PR>--playkcswh.netlify.app` (a Stage Supabase/Redis build).
  - Signs in through the existing Account sign-in form.
  - **Signed-in context:** ≥ 10 status reads (Account / index opens) and ≥ 10 awards (real 2048 gameplay windows with normal input; no cap or session bypass).
  - **Anonymous context (R1/F6):** status reads only, in a fresh context.
- **Data:** Netlify request logs plus the function log lines `calc_xp_timing` for those windows. Aggregates only. Per group: total request count, phase-sample count, and median/p90 per phase over the logged requests only. Requests below 1000 ms have no phase log; a group without samples is reported as "no phase samples".

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
