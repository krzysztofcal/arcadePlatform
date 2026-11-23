# Plan: T2 XP status dedup (#1313), simplified

## Step 0: measure first (read-only, before any code)
1. Get a HAR of one Account open on the Stage Deploy Preview of main. The OWNER exports it from a real device: DevTools → Network → filter `calculate-xp` → Save all as HAR. Count the POST bodies by `operation`, plus the `start-session` calls.
2. Repeat for `TOKEN_REFRESHED` (wait for a refresh or force one) and for sign-in (`SIGNED_IN`).
3. Cross-check with Netlify request logs (count and timing) and the Stage `log_lock_waits` in the same window.
4. Decide: if status reads dominate → implement FR-001. Otherwise → re-plan before any code.

## Change (only after Step 0 and an OWNER GO)
- `js/xpClient.js::fetchStatus`:
  - compute `key = (state.authToken || '') + '|' + ids.userId + '|' + ids.sessionId` synchronously at the start;
  - if `state.statusShared && state.statusShared.key === key`, return its promise;
  - otherwise create `{key, promise}` with the unchanged main body, and clear it in `finally` only if it is still the same entry.
- Nothing else in `xpClient.js` or `xp/core.js` changes.
- Estimated diff: about 15 lines plus tests.

## Tests (fundamental, existing `tests/xp-client-contract.test.mjs`)
- N concurrent calls with identical state → 1 POST, and all receive the same payload.
- A different award session id or cached token between calls → a second POST.
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
