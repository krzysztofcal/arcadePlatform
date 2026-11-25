# Plan: conversion once per sign-in (#1313 2a, client-only)

## Why it is safe for Production
- **The server is untouched.** `calculate-xp.mjs::convertAnonymousXp` already returns `null` without any lock, SQL or Redis call when `resolvedAnonId` is missing (`if (!supabaseUserId || !resolvedAnonId) return null`). The server uses `anonId` for nothing else.
- **The client can only skip the conversion; it cannot skip any check.** Every server guard stays in force for the requests that still carry the id.
- **Nothing is lost:**
  - The server converts at most once per user: `ANON_CONVERSION_SCRIPT` returns early when the permanent `userMigration` marker exists. Later attempts are already no-ops.
  - Anonymous totals have no expiry, so a delayed conversion (a race, a cleared marker) still happens on a later request.
  - Anonymous play clears the marker, so XP earned after a sign-out converts at the next sign-in.
- **Worst case is today's behaviour or a delay:** an unreadable marker sends the id. A mislabelled marker (an auth race, see Risks) at most delays one conversion.

## Change (`js/xpClient.js` only, about 15–20 lines)
- Constant `CONVERTED_KEY = "kcswh:xpAnonConvertedFor"`.
- Helper `async function anonIdForRequest(headers, anonId)`:
  - without `headers.Authorization`: remove the marker (in try/catch) and return `anonId`;
  - otherwise: read `getAuthenticatedUserId()`; return `undefined` only when the marker equals that id, else `anonId`;
  - any throw: return `anonId`.
- Helper `markConverted(userId)`: sets the marker in try/catch. It is called after `res.ok` only when the request carried the id and an `Authorization` header, with the user id read before the request.
- `fetchStatus()`: build the headers first (they already are, before the T2 key), then the body with `anonId` from the helper (the field is omitted when `undefined`). The T2 sharing key keeps using the final body, so requests with and without the id are never merged.
- `postWindowServerCalc()`: the same for the `userId` body field.
- No change to `ensureIds()`, the auth bridge, the token logic or any other file.

## Tests (fundamental, existing file `tests/xp-client-contract.test.mjs`)
Use the existing fetch/auth/localStorage stubs of that file. The cases are listed in spec SC-001. Assert the parsed request bodies (the presence or absence of `anonId`/`userId`) and the marker value. No new framework or file.

## Delivery
- Antigravity implements in its own `agy/*` worktree.
- The coordinator reviews the diff, reruns `tests/xp-client-contract.test.mjs`, `tests/xp-client.test.mjs` and `tests/xp-client-bfcache.test.mjs`, then integrates into this branch.
- A Draft PR, a Codex review (max 3 rounds), and green CI and CodeQL.
- Preview check (SC-002) by the OWNER, or by the agent with the dedicated Stage test account under the VPS runbook: a status read, then one award.
- No WS change, so WS Preview Deploy is not needed. No migration. Merge and Production are the OWNER's decision.

## Constitution Check (v1.6.0)
| Gate | Result |
|---|---|
| I Simplicity / existing mechanisms | PASS: it reuses the server's existing "no anonId → no conversion" path; one file, no new mechanism on the server |
| II Authoritative runtime | PASS: the server stays authoritative; the client only omits an optional field |
| III Fail-closed / environment separation | PASS: the server's fail-closed checks are unchanged; on the client, failures fall back to today's request |
| IV Platform / logging / style | PASS: IIFE global script, no `console.log` |
| V Fundamental tests | PASS: client contract tests only, in an existing file; no UI/CSS tests |

## Risks
- **Auth race:** the user id read by `getAuthenticatedUserId()` can differ from the token's user during an account switch. The effect is limited:
  - The marker may name the wrong account. The other account's id comparison then fails, so it sends the id; it never suppresses it for an account that has not converted.
  - The opposite case (the marker equals the read id while the token is another account) can skip that one request's conversion. The next request converts it, because anonymous totals do not expire.
- **A browser that clears `localStorage`:** it falls back to today's behaviour.
- **Other XP callers:** only `js/xpClient.js` posts to `calculate-xp` (`grep` on main). The implementation re-checks this.
- **Breaking changes:** none expected.
