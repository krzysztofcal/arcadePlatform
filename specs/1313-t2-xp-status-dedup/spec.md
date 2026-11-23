# Feature Specification: T2, fewer concurrent XP status POSTs (#1313)

**Branch**: `1313-t2-xp-status-dedup` · **Base**: `main` @ `cf8e2e8d` (includes #1318) · **Status**: OWNER GO 2026-11-23 for implementation.
**Origin**: OWNER decision. The #1317 approach (generations, stale rejection, token-cache ownership) is **not** reused.

## Problem
On Account open, up to 8 `calculate-xp` status POSTs start in the same millisecond (research.md M1). Each signed-in status read holds the `account-lifecycle:<user>` lock across Upstash calls. The reads therefore queue for 5–20 s, and `profile-me` waits behind them.

## Requirements
- **FR-001** `js/xpClient.js::fetchStatus` keeps the main flow unchanged up to and including `buildAuthHeaders`. It then joins an in-flight status request **only if** the request it is about to send is byte-identical to that request: the same `Authorization` header value (or none) and the same JSON body (`anonId`, `sessionId`, `operation`).
  - Otherwise it sends its own request, as on main.
  - The entry is removed when its request settles. No finished answer is kept.
- **FR-002** Every caller gets exactly what that identical request returned: the payload, or the same error.
- **FR-003** No change to the Auth or token lifecycle, no new generation or rejection code, no caller change and no `js/xp/core.js` change. Awards (`postWindowServerCalc`) and `start-session` are untouched.

## Why the key is the built request (research.md M2)
`fetchStatus` reads the token twice: once in `ensureAuthTokenWithRetry` and again in `buildAuthHeaders`. The POST carries the second read. A key decided earlier, from the cached token or a pending `authPromise`, cannot guarantee that the shared POST used the joiner's token after an asynchronous Auth refresh. A key equal to the final header and body guarantees by construction that the shared POST is exactly the request the joiner would have sent.

## Success Criteria
- **SC-001** On Stage, `calculate-xp` status POSTs per Account open drop to 1 per distinct request, both anonymous and signed in. Requests caused by later auth events are reported separately; each event still changes the award session id and may add at most one request.
- **SC-002** Fundamental tests pass: concurrent calls, a user or session change, token expiry or change, errors, and a retry after settlement.
