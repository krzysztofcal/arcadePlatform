# Research: T2 measurement and key safety (#1313), read-only, aggregates only

## M1. Request kinds per Account open
| Source | Identity | Result |
|---|---|---|
| Playwright, Stage Deploy Preview #1318 (XP code identical to main), 3 cold opens of `/account.html`, request bodies classified in the browser | anonymous | 3 × `calculate-xp` `operation:"status"` per open, within 22–59 ms. 0 award, 0 `start-session` |
| Netlify request logs, Stage Preview #1311, 2026-11-22 18:03:43 (OWNER real device, signed in) | signed in | 8 × `calculate-xp` POST in the same millisecond, referrer `account.html`. 4 of 8 sampled: response size 832–833 B (uniform). Durations 5.3–19.6 s in steps of about 2.2 s (lock queue) |

**Conclusion:** on Account open the burst consists of status reads; that is measured anonymously and inferred for the signed-in case, since there is no game on the page and the responses have a uniform size. Signed-in opens add the auth-event refreshes (`handleAuthChange` → `refreshBadgeFromServer`), `refreshInitialStatus`, `ensureStatusBootstrap` and the topbar badge refresh. No Stage test account was available to the agent (`STAGE_TEST_USER_*` is not set), so there is no signed-in Playwright run. Adding one needs an OWNER-provided Stage test account; the agent must not use OWNER credentials.

## M2. Is a key built from `state.authToken` safe? **No, not as planned.**
`js/xpClient.js` on main:
- `fetchAuthToken(false)` returns the cached token only while `now - authCheckedAt < AUTH_CACHE_MS` (60 s).
- When the cache has expired, it starts a new read, or joins the in-flight `state.authPromise`.
- An expired token string **stays** in `state.authToken`.

**Failure case for the naive key:**
1. Call A starts with a cached token T1. The cache has expired, so A re-reads the token.
2. Supabase refreshes the session asynchronously, or switches account, before the XP listener (`handleAuthChange`) runs.
3. Call B starts with the same `state.authToken` T1, so it has the same key and joins A.
4. On main, B would have read the token itself and could have received the new session's token. Joining A can hand B the older session's answer. The naive key therefore can merge requests of different sessions.

**Safe rule:** join only when, on main, B would provably use the same token source as A, and `ensureIds()` gives the same anon id and award session id.
- **(a) Fresh cache:** at B's start the cache is fresh (`authToken` set and within the TTL), and A took exactly that fresh cached token.
- **(b) Shared token read:** A's token phase is still the current non-forced `state.authPromise`, and B would join it on main (cache empty or expired). The entry records that promise; B joins only while `state.authPromise === entry.authPromise`.
- Otherwise B starts its own request, as on main.

**Effect of auth events:** `handleAuthChange` (`TOKEN_REFRESHED`, `SIGNED_IN`, `INITIAL_SESSION`) sets `authToken = null` and `authCheckedAt = 0`, and regenerates the award session id. Every later call therefore has a new key, so there is at most one new status read per event.

**Residual risk:** a session switch before the XP listener runs, with the cache still fresh, sends the old token. That already happens on main and is neither improved nor worsened by T2.

## M3. Expected result
- Signed in: the same-millisecond burst collapses to 1, plus at most 1 per auth event that arrives later.
- Anonymous: 3 → 1.
- To be verified after implementation with the same Playwright aggregate (anonymous), a signed-in run if an OWNER test account is provided, and Netlify logs for an OWNER real-device open.
