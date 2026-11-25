# Feature Specification: anonymous XP conversion once per sign-in (#1313 2a)

**Branch**: `1313-2a-conversion-once` · **Base**: `main` @ `5364a459` · **Status**: plan only; implementation needs an OWNER GO.
**Background:**
- Every signed-in `calculate-xp` request (status and award) runs `migrateAnonXpToUser` under the guarded path: `account-lifecycle` locks, an SQL identity check and Upstash permits.
- That happens even when nothing is left to convert.
- On Stage, conversion is about 54% of signed-in status time (median 1.86 s; PR #1321).
- OWNER 2026-11-25: conversion is a minor feature, and an optimization without measurement is acceptable if it does not risk Production. The OWNER chose "once per sign-in".

**Out of scope:** any change to conversion, identity, permit, lock or award logic (V1, the region, `xp-identity.mjs`, `store-upstash.mjs`); T3, 2b, #1319.

## Requirements
- **FR-001 (server, additive only)** `netlify/functions/calculate-xp.mjs`: when `convertAnonymousXp()` ran and returned a result without throwing, the 200 response (status and award) also carries `anonConversionChecked: true`.
  - That covers converted, already converted, and nothing to convert.
  - The field is absent when conversion did not run (no `anonId`, anonymous request) or failed (`null`).
  - No other server change.
- **FR-002 (client)** `js/xpClient.js` sends the browser's anonymous id (`anonId` for status, `userId` for award) on a signed-in request unless the marker matches the account of **that request's token**.
  - Marker: `localStorage` key `kcswh:xpAnonConvertedFor` = the `sub` claim decoded from the exact bearer token placed in that request's `Authorization` header.
- **FR-003** The marker is set only when all of these hold:
  - the request carried both the anonymous id and that token;
  - the response is `status === 200`;
  - the body parsed successfully and contains `anonConversionChecked === true`;
  - no anonymous request started after this request started (anonymous generation counter unchanged).
- **FR-004** Every request sent without an `Authorization` header removes the marker and increments the anonymous generation, before it is sent. Only anonymous requests can accrue anonymous XP.
- **FR-005** Fail-open to main's behaviour: if `localStorage` throws, or the token `sub` cannot be decoded, the anonymous id is sent and the marker is not written.
- **FR-006** Omitting the anonymous id skips only the migration-specific work: the `isValidXpAnonId` format check and the guarded migration (its SQL identity, epoch and permit checks, and its error propagation). Everything else is unchanged and still runs: JWT verification, the identity from the token, rate limiting, session validation, caps, the guarded award and profile writes with their Account Deletion fences, T2 status sharing, and anonymous play.

## Success Criteria
- **SC-001** Fundamental tests (existing files, existing harnesses):
  - client (`tests/xp-client-contract.test.mjs`):
    - the first signed-in status sends `anonId`; after a 200 with `anonConversionChecked` the next status and award for the same token `sub` omit it;
    - a 200 without the field, another 2xx, a non-2xx, a body parse error or a throw does not set the marker;
    - an anonymous request clears the marker;
    - a delayed signed-in response that completes after an anonymous request does not set it;
    - a token for another `sub` sends the id;
    - a `localStorage` failure sends it;
    - concurrent status calls share one request only with an identical `Authorization` and body.
  - server (an existing `calculate-xp` test file): `anonConversionChecked` is present only when conversion ran without error.
- **SC-002** Preview check:
  - signed-in status and award succeed;
  - anonymous XP earned before sign-in is still added on the first signed-in request.
