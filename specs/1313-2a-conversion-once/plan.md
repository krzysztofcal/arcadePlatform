# Plan: conversion once per sign-in (#1313 2a)

## Why it is safe for Production
- **The server's conversion and its checks are untouched.** The server change is one additive response field, set from the existing `convertAnonymousXp()` result.
  - Without `anonId`, `convertAnonymousXp` already returns `null` before any lock, SQL or Redis call.
  - What the client skips is listed in spec FR-006: only migration-specific checks. They protect the migration itself, and they are not needed when no migration is attempted.
- **No conversion is lost:**
  - The marker is written only after the server explicitly confirms that the conversion ran (`anonConversionChecked`), for the exact token account, with no anonymous activity since.
  - Anonymous XP can only grow through anonymous requests, and those clear the marker first.
  - The server converts at most once per user anyway: `ANON_CONVERSION_SCRIPT` returns early on the permanent `userMigration` marker.
  - Anonymous totals do not expire.
- **Every uncertain case falls back to main's request**, which sends the id.

## Change
**`netlify/functions/calculate-xp.mjs`** (about 2 lines; **requires explicit OWNER approval**, see spec Status): add `anonConversionChecked: true` to the status payload (next to the existing `result.payload.conversion`) and to the award payload, in both cases **only when `conversion` is not `null`** (`if (conversion)`).

**`js/xpClient.js`** (planned 25–30 lines; delivered about 180 lines without whitespace, including the error handling and the unload path):
- `CONVERTED_KEY = "kcswh:xpAnonConvertedFor"`, `ACTIVITY_KEY = "kcswh:xpAnonActivity"`; `bumpActivity()` writes a new `randomId()` value and `readActivity()` reads it, both in try/catch. `readActivity()` returns `null` **only when localStorage throws**. If the key is absent, it writes a new `randomId()` and returns that value. A fresh browser can then set a marker. `bumpActivity()` failure: try `removeItem(CONVERTED_KEY)` and set `state.anonStorageFailed = true`.
- `tokenSub(headers)`: base64url-decode the payload of `headers.Authorization` (`Bearer x.y.z`) and return `sub`, or `null` on any error. This is only a label; the server still verifies the token.
- `anonIdFor(headers, anonId)`, used after `buildAuthHeaders(...)` and before the body is built:
  - no `Authorization`: `bumpActivity()`, then remove the marker (`removeItem(CONVERTED_KEY)` in try/catch), then return `{ id: anonId, sub: null, anon: true }`.
  - otherwise: `sub = tokenSub(headers)`, `act = readActivity()`. If `!state.anonStorageFailed` and `sub` and `act !== null` and the marker is `{ sub, act }`, return `{ id: undefined, sub, act }`; else return `{ id: anonId, sub, act }`.
  - any throw: return `{ id: anonId, sub: null }`.
- `noteConversion(sent, payload)`: write the marker `{ sub: sent.sub, act: sent.act }` only when `sent.id && sent.sub && sent.act !== null && readActivity() === sent.act && payload && payload.anonConversionChecked === true`, in try/catch.
- `fetchStatus()`:
  - on main the body is built **before** `buildAuthHeaders`. Move `ensureAuthTokenWithRetry()`/`buildAuthHeaders(...)` above the body, then call `anonIdFor(headers, userId)` and build the body from it;
  - the body uses `sent.id` (the field is omitted when `undefined`);
  - the T2 key keeps the final `Authorization` and body;
  - `noteConversion` runs inside the shared promise after `res.status === 200` and `JSON.parse`, so it runs once per network request;
  - wrap the network request in `try … finally`, so that when `sent.anon` the `finally` calls `bumpActivity()` once on settle.
- `postWindowServerCalc()`:
  - the headers are built before the body (move the existing `buildAuthHeaders` call up if it is built later);
  - `userId: sent.id`;
  - `noteConversion` after a 200 and a successful parse;
  - wrap the whole request, **including the existing retry loop and every early return or throw**, in one `try … finally`. When `sent.anon`, that `finally` calls `bumpActivity()` once, after the last attempt settles.
- No change to `ensureIds()`, the auth bridge, the token refresh or any other file. The implementation re-checks with `grep` that no other client code posts to `calculate-xp`.

## Tests (fundamental, existing files)
- `tests/xp-client-contract.test.mjs`: the cases in spec SC-001 (client), with the file's existing fetch, auth and localStorage stubs and fake JWTs with different `sub` values. Assert the request bodies and the marker.
- Server field: the in-process harness cannot reach the signed-in conversion path (it needs a DB). As agreed by the OWNER (spec SC-001), it is verified on the PR Deploy Preview: a fresh browser, status reads only. There is no in-process server assertion.

## Delivery
- Antigravity implements in its own `agy/*` worktree.
- The coordinator reviews the diff, reruns `tests/xp-client-contract.test.mjs`, `tests/xp-client.test.mjs`, `tests/xp-client-bfcache.test.mjs` and the touched server test, then integrates.
- A Draft PR, a Codex code review (max 3 rounds), and green CI and CodeQL.
- Preview check SC-002 by the OWNER. The agent runs the XP-mutating steps only on the pinned Stage project, after a separate OWNER GO.
- No WS change and no migration. Merge and Production are the OWNER's decision.

## Constitution Check (v1.6.0)
| Gate | Result |
|---|---|
| I Simplicity / existing mechanisms | PASS: it reuses the existing "no anonId → no conversion" path; one additive response field; one client marker |
| II Authoritative runtime | PASS: the server decides and confirms; the client omits an optional field only after server confirmation |
| III Fail-closed / environment separation | PASS: no server check is weakened; client uncertainty falls back to main's request |
| IV Platform / logging / style | PASS: IIFE global script, no `console.log` |
| V Fundamental tests | PASS: client contract tests in an existing file; the server field is verified on the Preview (OWNER-agreed), with no in-process server assertion |

## Risks
- **The token `sub` decode is unverified client-side.** It is used only to label the marker. A wrong label can only make the client send the id again, or skip it for an account whose own token the server already confirmed.
- **Same-account sign-out/sign-in without anonymous play keeps the marker.** This is intended: without an anonymous request no new anonymous XP exists, so there is nothing to convert.
- **Another browser profile or a cleared `localStorage`** falls back to main's behaviour.
- **Cross-tab storage failure:** see spec FR-005 (OWNER acceptance).
- **Unload sends and closed tabs (code review):** a beacon carries no `Authorization`, so it is treated as an anonymous award: it always sends the anonymous id. Every anonymous award (fetch, keepalive or beacon) runs `noteAnonAward()`: a new activity token, the marker removed, and `kcswh:xpAnonPendingUntil = now + 15 s`. No marker is written before that time, so a lost `finally` (page unload or closed tab) cannot strand XP. Anonymous status reads do not touch the marker.
- **Residual race:** a tab closed mid-way through an anonymous award never runs its settle write. If the server applies that award after a concurrent signed-in check, and a marker is written with the post-start activity token, that XP waits until the next anonymous request clears the marker. It is not deleted, because anonymous totals do not expire. This is accepted for a minor feature.
- **Breaking changes:** none. The added response field is ignored by older clients.
