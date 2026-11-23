# Research: T2 measurement and key safety (#1313), read-only, aggregates only

## M1. Request kinds per Account open
| Source | Identity | Result |
|---|---|---|
| Playwright, Stage Deploy Preview #1318 (XP code identical to main), 3 cold opens of `/account.html`, request bodies classified in the browser | anonymous | 3 × `calculate-xp` `operation:"status"` per open, within 22–59 ms. 0 award, 0 `start-session` |
| Netlify request logs, Stage Preview #1311, 2026-11-22 18:03:43 (OWNER real device, signed in) | signed in | 8 × `calculate-xp` POST in the same millisecond, referrer `account.html`. 4 of 8 sampled: response size 832–833 B (uniform). Durations 5.3–19.6 s in steps of about 2.2 s (lock queue) |

**Conclusion:** on Account open the burst consists of status reads; that is measured anonymously and inferred for the signed-in case, since there is no game on the page and the responses have a uniform size. Signed-in opens add the auth-event refreshes (`handleAuthChange` → `refreshBadgeFromServer`), `refreshInitialStatus`, `ensureStatusBootstrap` and the topbar badge refresh. No Stage test account was available to the agent (`STAGE_TEST_USER_*` is not set), so there is no signed-in Playwright run. Adding one needs an OWNER-provided Stage test account; the agent must not use OWNER credentials.

## M2. Key safety, verified against main `cf8e2e8d`
- `fetchStatus` builds the body first (`ensureIds()`, before any await). It then calls `ensureAuthTokenWithRetry()` only for the logged-in check, and **reads the token again** in `buildAuthHeaders` → `ensureAuthTokenWithRetry()`. That second read is the token that is POSTed.
- `fetchAuthToken(false)` returns the cache only within `AUTH_CACHE_MS` (60 s). Otherwise it reads again, or joins a pending `authPromise`. An expired token string stays in `state.authToken`.
- **Conclusion:** any key decided before `buildAuthHeaders` cannot guarantee the POSTed token. That covers the naive cached-token key, and also the earlier plan rule (a fresh cache or a pending `authPromise`). An asynchronous Auth refresh between the two reads can change it. **Rejected.**
- **Adopted, and simpler:** the key is the final request: the `Authorization` header plus the JSON body. A joiner shares only a byte-identical request, so its own HTTP request would have been the same, sent a few milliseconds later. Identity, token and session are equal by construction. There is no reasoning about TTL, `authPromise` or generations.
- **Auth events:** `handleAuthChange` regenerates the award session id, so the body differs and the next call sends its own request. A token refresh changes the header, so again a separate request.

## M3. Expected result
- Signed in: the same-millisecond burst collapses to 1, plus at most 1 per auth event that arrives later.
- Anonymous: 3 → 1.
- To be verified after implementation with the same Playwright aggregate (anonymous), a signed-in run if an OWNER test account is provided, and Netlify logs for an OWNER real-device open.
