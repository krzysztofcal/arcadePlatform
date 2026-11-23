# Plan: T2 XP status dedup (#1313), simplified

## Step 0: measurement (done, aggregates only; see research.md M1)
- Anonymous Playwright on the Stage Preview: 3 status POSTs per open, no awards.
- Signed-in Netlify logs: 8 same-millisecond POSTs with uniform status-size responses.
- No raw HAR is needed.

## Change (OWNER GO 2026-11-23). The key is the built request (research.md M2)
`js/xpClient.js::fetchStatus`, after `const headers = await buildAuthHeaders(...)`:
1. `key = (headers.Authorization || '') + '\n' + JSON.stringify(body)`.
2. If `state.statusShared && state.statusShared.key === key`, return its promise.
3. Otherwise run the unchanged main POST and parse as an entry `{key, promise}`, and clear it in `finally` only if it is still the same entry.

`updateCapFromPayload` runs once inside the shared request; it is idempotent for the same payload. Nothing else changes. Estimated diff: about 12 lines of JS.

## Tests (fundamental, existing `tests/xp-client-contract.test.mjs`)
- N concurrent calls with identical state → 1 POST, and all receive the same payload.
- A different award session id or cached token between calls → a second POST.
- **Key safety (M2):** a joiner whose built `Authorization` differs (token refreshed or user changed between reads) sends its own POST. A joiner whose header and body are identical shares the request.
- **Token expiry:** after the cache TTL the next call re-reads the token. If the header is the same it shares; if not it sends its own POST.
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
