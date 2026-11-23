# Plan: T2 XP status dedup (#1313), simplified

## Step 0: measurement (done, aggregates only; see research.md M1)
- Anonymous Playwright on the Stage Preview: 3 status POSTs per open, no awards.
- Signed-in Netlify logs: 8 same-millisecond POSTs with uniform status-size responses.
- No raw HAR is needed.

## Change (only after an OWNER GO). The key rule was corrected by research.md M2
In `js/xpClient.js::fetchStatus`, synchronously at the start:
1. Take `ids = ensureIds()`.
2. Determine B's token source exactly as `fetchAuthToken(false)` would:
   - `fresh` when the cached token is within `AUTH_CACHE_MS`;
   - otherwise the current non-forced `state.authPromise`, if any.
3. Join `state.statusShared` only if the anon id and the award session id are equal AND one of these holds:
   - (a) both are `fresh` with the identical token string;
   - (b) both rely on the same still-current `state.authPromise`.
4. Otherwise create a new entry `{anonId, sessionId, source, token, authPromise, promise}` with the unchanged main body, and clear it in `finally` only if it is still the same entry.

Nothing else in `xpClient.js` or `xp/core.js` changes: no Auth or token lifecycle change, no new rejection, no caller change. Estimated diff: about 25 lines plus tests.

## Tests (fundamental, existing `tests/xp-client-contract.test.mjs`)
- N concurrent calls with identical state → 1 POST, and all receive the same payload.
- A different award session id or cached token between calls → a second POST.
- **Key safety (M2):** with an expired cache whose token string is unchanged, a call made after the token read has settled does NOT join. A call made while the same non-forced `authPromise` is pending DOES join.
- A call after settlement → a new POST.
- A shared error reaches all joined callers. A later call retries.
- The file must reach its completion marker. Keep the completion guard pattern from #1317.

## Constitution Check (v1.6.0)
| Gate | Result |
|---|---|
| I Simplicity | PASS: one in-flight entry, no new API |
| III Fail-closed | PASS: no server, lock or Account Deletion change |
| IV JSP/logging | PASS: ES5/IIFE, `klog` only; `xpClient.js` has no SRI pin |
| V Tests | PASS: existing file |

## Risks
- A shared error now reaches every joined caller, where on main the duplicates might have succeeded independently. Acceptable: the next trigger retries.
- If most of the 8 POSTs are awards or start-session, T2 alone will not reach SC-001 (hence Step 0).
- Lock hold time per request is unchanged. Scope 2a remains the server-side lever (HOLD).
