# Feature Specification: anonymous XP conversion once per sign-in (#1313 2a, client-only)

**Branch**: `1313-2a-conversion-once` · **Base**: `main` @ `5364a459` · **Status**: plan only; implementation needs an OWNER GO.
**Background:**
- Every signed-in `calculate-xp` request (status and award) runs `migrateAnonXpToUser` under the guarded path: `account-lifecycle` locks, an SQL identity check and Upstash permits.
- That happens even when nothing is left to convert.
- On Stage, conversion is about 54% of signed-in status time (median 1.86 s; PR #1321).
- OWNER 2026-11-25: conversion is a minor feature, and an optimization without measurement is acceptable if it does not risk Production. The OWNER chose "once per sign-in".

**Out of scope:** any server change (V1, the region, `xp-identity.mjs`, `store-upstash.mjs`, `calculate-xp.mjs`), T3, 2b, #1319.

## Requirements
- **FR-001** `js/xpClient.js` keeps sending the browser's anonymous id (`anonId` for status, `userId` for award) on signed-in requests until the first HTTP 200 signed-in response for the current account. After that it omits the id for that account.
- **FR-002** A marker records the account whose conversion attempt succeeded: `localStorage` key `kcswh:xpAnonConvertedFor` = the Supabase user id.
  - It is set only after a 200 response to a signed-in request that carried the anonymous id.
  - A non-200 response, a network error or a thrown request never sets it.
- **FR-003** Any request sent without an `Authorization` header (anonymous play, which may accrue new anonymous XP) removes the marker. The next sign-in then converts again.
- **FR-004** When the marker does not equal the current account id (another account, or no marker), the anonymous id is sent, as on main.
- **FR-005** Fail-open to the current behaviour: if `localStorage` or the user-id lookup throws, or the user id is unknown, the anonymous id is sent, exactly as on main.
- **FR-006** Unchanged: the server code and its checks (identity, permits, epoch, Account Deletion fence, caps, rate limit, sessions); every request field other than the anonymous id; T2 status sharing; the response handling; anonymous play.

## Success Criteria
- **SC-001** Fundamental tests in `tests/xp-client-contract.test.mjs` (existing file, existing harness):
  - the first signed-in status sends `anonId`, and after a 200 the next signed-in status and award omit it;
  - an anonymous request clears the marker, so the next signed-in request sends it again;
  - another account id sends it;
  - a non-200 or a throw does not set the marker;
  - a `localStorage` failure sends it.
- **SC-002** Signed-in XP behaviour is unchanged on the PR Deploy Preview (OWNER or agent check):
  - status and award succeed;
  - anonymous XP earned before sign-in is still added on the first signed-in request.
