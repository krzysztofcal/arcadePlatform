# Feature Specification: anonymous XP conversion once per sign-in (#1313 2a)

**Branch**: `1313-2a-conversion-once` · **Base**: `main` @ `5364a459` · **Status**: plan only. Implementation needs an OWNER GO, which must explicitly cover the one additive server response field (FR-001); the OWNER's earlier scope said "no server change".
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
- **FR-002 (client)** `js/xpClient.js` sends the browser's anonymous id (`anonId` for status, `userId` for award) on a signed-in request unless the marker is valid for **that request's token**.
  - Marker: `localStorage` key `kcswh:xpAnonConvertedFor` = JSON `{ sub, act }`. `sub` is decoded from the exact bearer token in that request's `Authorization` header. `act` is the shared anonymous-activity token captured when that request started.
  - The marker is valid only when `sub` matches the token and `act` equals the current activity token.
- **FR-003** The marker is set only when all of these hold:
  - the request carried both the anonymous id and that token;
  - the response is `status === 200`;
  - the body parsed successfully and contains `anonConversionChecked === true`;
  - the shared anonymous-activity token is unchanged between this request's start and the write.
- **FR-004** Shared anonymous-activity token: `localStorage` key `kcswh:xpAnonActivity`, shared by all tabs.
  - Every **award** request sent without an `Authorization` header (the only request that can add anonymous XP; anonymous status reads keep the marker) writes a **new unique random value** (not a read-modify-write increment) **before** sending and **again when it settles** (success, error or throw, in `finally`). Any write changes the value, so concurrent writers in different tabs cannot restore an old value.
  - An anonymous award that starts before, or finishes after, a signed-in conversion check therefore invalidates any marker written in between, in every tab.
  - Only anonymous requests can accrue anonymous XP.
- **FR-005** Fail-open to main's behaviour:
  - If `localStorage` throws, or the token `sub` cannot be decoded, the anonymous id is sent and the marker is not written.
  - If an anonymous-activity write fails, the tab also tries to remove the marker and sets a tab-local `state.anonStorageFailed = true`; from then on that tab always sends the anonymous id.
  - Limitation (for OWNER acceptance): another tab with a working `localStorage` cannot learn about that failure. In practice `localStorage` failures are origin-wide, so they affect every tab alike.
- **FR-006** Omitting the anonymous id skips only the migration-specific work: the `isValidXpAnonId` format check and the guarded migration (its SQL identity, epoch and permit checks, and its error propagation). Everything else is unchanged and still runs: JWT verification, the identity from the token, rate limiting, session validation, caps, the guarded award and profile writes with their Account Deletion fences, T2 status sharing, and anonymous play.

## Success Criteria
- **SC-001** Fundamental tests (existing files, existing harnesses):
  - client (`tests/xp-client-contract.test.mjs`):
    - the first signed-in status sends `anonId`; after a 200 with `anonConversionChecked` the next status and award for the same token `sub` omit it;
    - a 200 without the field, another 2xx, a non-2xx, a body parse error or a throw does not set the marker;
    - an anonymous request clears the marker;
    - a delayed signed-in response that completes after an anonymous request does not set it;
    - an anonymous award that starts before a signed-in status and settles after it invalidates the marker that status wrote (single tab, and a second simulated tab sharing `localStorage`);
    - two simulated tabs where an anonymous award settles before a delayed signed-in response is handled: no valid marker;
    - both activity writes fail during anonymous activity, and the next signed-in request in that tab still sends the id;
    - a token for another `sub` sends the id;
    - a `localStorage` failure sends it;
    - concurrent status calls share one request only with an identical `Authorization` and body.
  - server: in an existing test file, using the existing fixture-JWT subprocess pattern of `tests/xp-v3-cutover.behavior.test.mjs`. The field is present on a signed-in status **and** a signed-in award that carry `anonId`, and absent without `anonId` and when conversion fails. If that harness cannot reach these paths, SC-001 is not met until the OWNER agrees on another verification. **OWNER 2026-11-25 agreed:** the harness cannot reach the signed-in conversion path (it needs a DB), so the server field is verified on the PR Deploy Preview instead. A fresh browser (new `anonId`, zero anonymous XP) signs in with the dedicated Stage test account and does status reads only. The first signed-in status must send `anonId` and receive `anonConversionChecked: true`; every later signed-in status must omit `anonId`; no response without `anonId` may carry the field. No XP is mutated.
- **SC-002** Preview check, by the OWNER. If the agent runs it, it does so only on the pinned Stage project, under the VPS runbook, and after a separate OWNER GO that covers these XP mutations:
  - signed-in status and award succeed;
  - anonymous XP earned before sign-in is still added on the first signed-in request. Precondition: a Stage account with **no prior successful conversion** (no `userMigration` marker) and a **confirmed positive anonymous balance** before the first signed-in request. If the precondition cannot be met under the GO, the transfer check is reported as **not performed**, not as passed.
