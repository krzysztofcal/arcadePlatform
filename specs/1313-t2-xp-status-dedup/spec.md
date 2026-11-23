# Feature Specification: T2, fewer concurrent XP status POSTs (#1313), PLAN ONLY

**Branch**: `1313-t2-xp-status-plan` · **Created**: 2026-11-23 · **Base**: `main` @ `e663883e` · **Status**: plan; no implementation without an OWNER GO.
**Origin**: OWNER decision 2026-11-23. The #1317 approach (generations, stale rejection, token-cache ownership) was not accepted after R6, so it is NOT reused here.

## Problem (evidence in `specs/1313-profile-me-latency/research.md` R2–R3, branch `1313-profile-me-latency`)
On Account open, up to 8 `calculate-xp` POSTs start in the same millisecond (Stage 18:03:43, Production 09:36:55). Each logged-in status read holds the `account-lifecycle:<user>` lock across Upstash calls, so they queue (5–20 s) and `profile-me` waits behind them. The breakdown of those 8 by `operation` (status / award / other) is **not yet measured**.

## Principle
Reduce duplicate requests **without changing what any caller observes**, compared with main.
- No change to the Auth or token lifecycle (`fetchAuthToken`, `ensureAuthTokenWithRetry`, `handleAuthChange`, `clearServerSession`).
- No new rejection codes, generations or caller checks.
- No finished-answer cache.

## Requirements
- **FR-001** `js/xpClient.js::fetchStatus` shares one in-flight request between calls whose **synchronous inputs at call start** are identical: `state.authToken` (string or null), the anon id and the award session id (`ensureIds()`). The key is computed before the first `await`.
  - A call with a different key starts its own request.
  - The entry is removed when its request settles. A call after that always starts a new request.
- **FR-002** Every caller gets exactly what one main request would have returned (payload or error). No caller code changes.
- **FR-003** Only if the measurement shows that the 8 POSTs are not mostly status reads: a separate follow-up decision. Awards and start-session are out of scope for T2.

## Why this is safe relative to main
- A joined caller would, on main, have sent the same body with the same cached token, or performed the same token read at the same moment. Sharing removes duplicates only.
- `handleAuthChange` resets `authToken` and regenerates the award session id, so any call after an auth event has a different key and its own request, as on main.
- Answers of an earlier identity are applied exactly as on main (main has no staleness protection). T2 neither improves nor worsens that; any such protection is a separate decision.

## Success Criteria
- **SC-001** `calculate-xp` status POSTs started in the same 100 ms window on Account open drop to 1 per distinct key.
- **SC-002** The measurement repeated per auth event (`INITIAL_SESSION`, `SIGNED_IN`, `TOKEN_REFRESHED`) reports the remaining POSTs per event. Each event still yields at most one new status read, because it changes the award session id.
