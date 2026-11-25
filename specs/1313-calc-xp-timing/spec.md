# Feature Specification: `calc_xp_timing` diagnostic (#1313)

**Branch**: `1313-calc-xp-timing` · **Base**: `main` @ `5364a459` · **Status**: OWNER GO 2026-11-23 for the diagnostic and the Stage measurement.
**Purpose:** measure where the time of a signed-in `calculate-xp` request goes, before any decision on 2a/V1, the Netlify region or stopping (`specs/1313-2a-xp-conversion-fast-path/research-2.md` §F).
**Out of scope (HOLD):** 2a, 2b, T3, #1319, the Netlify region.

## Requirements
- **FR-001** `netlify/functions/calculate-xp.mjs::handler` emits at most **one** `klog("calc_xp_timing", {...})` per request, only when the raw (unrounded) elapsed time is ≥ 1000 ms and `op` is known, with:
  - `op` (`"status"` | `"award"`), `signedIn` (boolean) and `status` (the returned HTTP status code, or `null` when the handler throws before returning);
  - the phases in whole ms: `jwtMs`, `conversionMs`, `totalsMs`, `persistMs`, `awardMs`, `otherMs`, `totalMs`.
- **FR-002** Phase boundaries:
  - `jwtMs` is `verifySupabaseJwt`.
  - `conversionMs` is `convertAnonymousXp`, including its own profile persist when a conversion happens.
  - `totalsMs` is the totals read: `readTotals` inside `readCanonicalXpStatus` for status.
  - `persistMs` is the guarded snapshot and session writes: `persistProfile` inside `readCanonicalXpStatus`, the award's `persistUserProfile` and `saveSessionState`.
  - `awardMs` is `executeAtomicXpAward`.
  - `otherMs = totalMs − (sum of the rounded phases)`, never negative; when rounding pushes the phase sum above the rounded total, `totalMs` is that sum.
  - Inside `readCanonicalXpStatus`, the read and the write are measured separately by wrapping the `readTotals` and `persistProfile` callbacks that are passed in.
- **FR-003** No identifiers or user data in the log: no user id, anon id, session id, token, IP, email or XP values.
- **FR-004** Unchanged: every HTTP response (status, body, headers), XP awarding, caps, the rate limit, session validation, conversion, Account Deletion fencing, error handling and existing logs. A failure inside the timing code must never affect the request.
- **FR-005** No new dependency, environment variable or infrastructure. The pattern is the existing `profile_me_timing` (`profile-me.mjs`).

## Success Criteria
- **SC-001** Fundamental tests:
  - below the threshold no log;
  - at or above it exactly one log with only the allowed fields;
  - `otherMs` ≥ 0 and the phases plus `otherMs` equal `totalMs`;
  - a throwing request still emits at most one log and rethrows unchanged;
  - existing handler tests unchanged.
- **SC-002** Stage (Deploy Preview of this PR, a dedicated Stage test account, Playwright):
  - signed in: ≥ 10 status reads and ≥ 10 real awards through the existing game flow, counted only as responses with `granted > 0` and proven by the reported aggregate count of such responses;
  - anonymous: status reads;
  - per group (op, identity, window): the total request count and the phase-sample count. Phase medians/p90 and the dominant phase describe **only the logged (≥ 1000 ms) requests**; a group without samples is reported as "no phase samples" with total durations only.
