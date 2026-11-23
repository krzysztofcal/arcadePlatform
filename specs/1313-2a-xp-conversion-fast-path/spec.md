# Feature Specification: #1313 scope 2a, skip no-op anonymous XP conversion

> **Status after the OWNER plan review (2026-11-23): D1 and D2 are rejected, so variant V0 (the MGET fast path) is WITHDRAWN.** The re-analysis and options are in [research-2.md](research-2.md). Everything after Codex plan review R3, including the R3 revisions, is **NOT COVERED BY THE COMPLETED REVIEW**. Implementation is HOLD.


**Branch**: `1313-2a-xp-conversion-fast-path` · **Base**: `main` @ `5364a459` · **Status**: plan only; OWNER GO required before implementation.
**Out of scope (HOLD):** 2b (skipping the no-op profile snapshot), T3 (`profile-me` without the lock), #1319, the Netlify region.

## Problem
Every signed-in XP status read and every award calls `migrateAnonXpToUser`. Almost always the call is a no-op: the user has already converted, or has no anonymous XP. It still opens a SQL transaction holding **two** `account-lifecycle` advisory locks, the user's and the anon id's, and makes **4 Upstash calls inside it** (research R1). Those locks are the same ones `profile-me` and every other account write queue on.

## Requirements
- **FR-001** In `netlify/functions/_shared/xp-identity.mjs::migrateAnonXpToUser`, before `guardedRedisEval`, make one unlocked `store.mget` of the user marker, the pair marker, the anon total and the user total.
  - Return without any transaction or eval **only** when the conversion script would provably write nothing: a marker is present, or the anon total is absent or a non-positive integer.
  - The result must have the same shape and values as the script's result.
- **FR-002** The fast path runs only in permit modes, only when `namespace === resolveXpNamespace()`, only when the optional leaderboard keys are null or exactly the caller's standard keys, only on an exact 4-entry array, and only on canonical safe-integer strings or `null`. Every other case uses the **unchanged** guarded path, including:
  - an anon total > 0;
  - any unparsable value;
  - a missing `mget`;
  - any `mget` error.
- **FR-003** No change to:
  - `guardedRedisEval`, `withRedisIdentityPermit`, `lockAccountLifecycle` or `assertAccountActive`;
  - the Lua scripts, keys and TTLs;
  - awards, `persistUserProfile`, Account Deletion, the WS server, the DB schema and migrations;
  - the client.
- **FR-004** No new cache, lock, table, synchronization mechanism, dependency or environment variable. Logging, if any, goes only through the existing `klog`, with no identifiers.

## Safety requirements (research R2/R4)
- The fast path never writes to Redis (I1–I3 untouched).
- A deleting or missing account is still rejected by the JWT lifecycle check (I4).
- `BLOCKED`, a missing epoch or a Redis failure still make the request fail closed through the unchanged guarded writes.
- A conversion that is actually due (anon XP > 0, no marker, positive cap) runs exactly as today. After a racing anonymous award, it runs on the next eligible request with the same anonId, unless another conversion set the user marker first (today's behaviour).

## Behaviour differences without writes (OWNER decision; plan §Change)
- **D1:** an illegal anonId (an Auth user, deleting, retired or `BLOCKED`) no longer fails a request when no conversion is due. With deletion enabled the request now continues; with deletion disabled only the conversion error log disappears.
- **D2:** a corrupted non-string marker, total or owner-index key, only when the MGET values allow a fast return: skipped instead of raising `WRONGTYPE`.

## Success Criteria
- **SC-001** Fundamental tests prove the following:
  - no transaction and no eval for the marker and zero cases;
  - the guarded path for a positive total, unparsable values and an `mget` failure;
  - exactly-once conversion with a racing anonymous award;
  - fail-closed behaviour for `BLOCKED`, a missing epoch and a deleting account.
- **SC-002** Stage, structural, comparing **the baseline and the change in the same confirmed mode**. It is reported as unverified if attribution or a same-mode pair cannot be established: per signed-in no-op status or award request:
  - deletion enabled: the anon-identity query (`... as present, ... as deleting, ... as retired`) −1 and the lifecycle lock statement −2;
  - deletion disabled with v3: the `to_regclass` probe −1 and the lock statement −2.
- **SC-003** Stage, timing: the median and p90 function duration (Netlify request detail) of signed-in `calculate-xp` status and award requests drop versus the main baseline, in the same scenario with N ≥ 10 each. It is reported as measured; causation is supported by SC-002.
