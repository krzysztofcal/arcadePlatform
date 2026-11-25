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
**`netlify/functions/calculate-xp.mjs`** (about 2 lines): add `anonConversionChecked: true` to the status payload (next to the existing `result.payload.conversion`) and to the award payload when `conversion` is not `null`.

**`js/xpClient.js`** (about 25–30 lines):
- `CONVERTED_KEY = "kcswh:xpAnonConvertedFor"`; `state.anonGeneration = 0`.
- `tokenSub(headers)`: base64url-decode the payload of `headers.Authorization` (`Bearer x.y.z`) and return `sub`, or `null` on any error. This is only a label; the server still verifies the token.
- `anonIdFor(headers, anonId)`, used after `buildAuthHeaders(...)` and before the body is built:
  - no `Authorization`: increment `state.anonGeneration`, remove the marker in try/catch, return `{ id: anonId, sub: null }`;
  - otherwise: `sub = tokenSub(headers)`; if `sub` and the marker equals `sub`, return `{ id: undefined, sub }`; else return `{ id: anonId, sub }`;
  - any throw: return `{ id: anonId, sub: null }`.
- `noteConversion(sent, generation, payload)`: write the marker = `sent.sub` only when `sent.id && sent.sub && generation === state.anonGeneration && payload && payload.anonConversionChecked === true`, in try/catch.
- `fetchStatus()`:
  - the headers already come first;
  - the body uses `sent.id` (the field is omitted when `undefined`);
  - the T2 key keeps the final `Authorization` and body;
  - `noteConversion` runs inside the shared promise after `res.status === 200` and `JSON.parse`, so it runs once per network request.
- `postWindowServerCalc()`:
  - the headers are built before the body (move the existing `buildAuthHeaders` call up if it is built later);
  - `userId: sent.id`;
  - `noteConversion` after a 200 and a successful parse.
- No change to `ensureIds()`, the auth bridge, the token refresh or any other file. The implementation re-checks with `grep` that no other client code posts to `calculate-xp`.

## Tests (fundamental, existing files)
- `tests/xp-client-contract.test.mjs`: the cases in spec SC-001 (client), with the file's existing fetch, auth and localStorage stubs and fake JWTs with different `sub` values. Assert the request bodies and the marker.
- The server field goes in an existing `calculate-xp` test that already runs status with and without conversion (`tests/rate-limit.key-derivation.behavior.test.mjs` or `tests/xp-v3-cutover.behavior.test.mjs`). If no existing harness reaches the signed-in conversion path in-process, assert presence/absence via the existing anonymous-status case, and state that limit.

## Delivery
- Antigravity implements in its own `agy/*` worktree.
- The coordinator reviews the diff, reruns `tests/xp-client-contract.test.mjs`, `tests/xp-client.test.mjs`, `tests/xp-client-bfcache.test.mjs` and the touched server test, then integrates.
- A Draft PR, a Codex code review (max 3 rounds), and green CI and CodeQL.
- Preview check SC-002 by the OWNER, or by the agent with the dedicated Stage test account under the VPS runbook.
- No WS change and no migration. Merge and Production are the OWNER's decision.

## Constitution Check (v1.6.0)
| Gate | Result |
|---|---|
| I Simplicity / existing mechanisms | PASS: it reuses the existing "no anonId → no conversion" path; one additive response field; one client marker |
| II Authoritative runtime | PASS: the server decides and confirms; the client omits an optional field only after server confirmation |
| III Fail-closed / environment separation | PASS: no server check is weakened; client uncertainty falls back to main's request |
| IV Platform / logging / style | PASS: IIFE global script, no `console.log` |
| V Fundamental tests | PASS: client contract tests plus one server assertion, in existing files |

## Risks
- **The token `sub` decode is unverified client-side.** It is used only to label the marker. A wrong label can only make the client send the id again, or skip it for an account whose own token the server already confirmed.
- **Same-account sign-out/sign-in without anonymous play keeps the marker.** This is intended: without an anonymous request no new anonymous XP exists, so there is nothing to convert.
- **Another browser profile or a cleared `localStorage`** falls back to main's behaviour.
- **Breaking changes:** none. The added response field is ignored by older clients.
