# Research 2: 2a re-analysis after the OWNER plan review (read-only, main @ `5364a459`, plan @ `8d0f0c23`)

> **NOT COVERED BY THE COMPLETED PLAN REVIEW.** This file, and every 2a plan change after Codex plan review R3, has not been reviewed by Codex. R4 needs a separate OWNER approval.

## OWNER decision (2026-11-23)
- The direction is accepted.
- **D1 is rejected:** illegal anon ids must keep failing closed.
- **D2 is rejected:** `WRONGTYPE` and corruption must stay visible.
- The owner index must be proven unaffected.
- Implementation is HOLD.

## A. Owner index (`indexedScript` / `CLEAN_OWNER`): skipping no-op registrations is safe (proof)
1. Every V3 Redis write happens only in `guardedRedisEval` / `guardedUserMutation`. The search of main found no direct `set`/`setex`/`incr`/`zadd`/`del`/`eval` on XP keys outside `store-upstash.mjs`, apart from permits (`blockRedisIdentity`) and `CLEAN_OWNER` itself.
2. `guardedRedisEval` always prefixes the operation with `indexedScript` registrations. They run **in the same Lua execution as the write**, after the permit guard. A written key is therefore registered atomically with its write.
3. The owner index and the V3 namespace arrived **in the same commit**, `d689b709` (2026-10-18). There is no V3 data written before indexing. Legacy (non-V3) keys are never indexed, and `CLEAN_OWNER` refuses them (`legacy_redis_ownership_unproven`).
4. A no-op conversion writes nothing. Its registrations reference keys that either were already registered by the write that created them, or do not exist.

**Conclusion:** skipping a no-op conversion's registrations cannot remove a reference to any existing key. `CLEAN_OWNER` completeness is unchanged.
**The one effect lost:** a corrupt (non-zset) owner-index key would no longer raise `WRONGTYPE` at that `ZADD`. That is a D2 concern; see C.

## B. Why one light Redis read is not enough
- **D1:** the guarded path rejects an `anonId` that is an Auth user, deleting or retired (an SQL check under the lock), or whose permit is `BLOCKED` or the epoch is missing (Redis).
  - The `anonId` comes from the request body, so a client can send an existing user's UUID.
  - The Redis permit key is per id, not per role, so `permit:<id> = ACTIVE` cannot tell "valid anonymous id" from "somebody's account id".
  - **An SQL identity check is required.**
- **D2:** `MGET` returns `null` for a missing key and for a wrong-typed key alike. Only `GET` in Lua, plus a type-raising command on the index keys, preserves `WRONGTYPE`.

## C. Options
"Per no-op conversion" means every signed-in status read and every award where no conversion is due. Deletion is enabled and the anonId is a UUID.

| | Current (guarded) | V0 (MGET, plan `8d0f0c23`) | **V1: verified probe** | V2: fold permit init into the guarded script | V3: Netlify Functions region near the DB |
|---|---|---|---|---|---|
| SQL | 1 transaction, about 6 sequential round trips | 0 | **1 lockless query** (the same 3-field anon query) | unchanged | unchanged count, each round trip much faster |
| `account-lifecycle` locks | 2 | 0 | **0** | 2 | 2 |
| Upstash calls | 4 sequential, under the locks | 1 `MGET` | **1 read-only `EVAL`** | 1 under the locks (−3) | unchanged |
| D1 (illegal anonId fails closed) | ✅ | ❌ | ✅ (SQL identity, plus Redis epoch and both permits `ACTIVE:<epoch>`; an absent permit → guarded path) | ✅ | ✅ |
| D2 (`WRONGTYPE` visible) | ✅ | ❌ | ✅ (`GET` in the script's order, `ZCARD` on both index keys) | ✅ | ✅ |
| Owner index | — | ✅ (A) | ✅ (A) | ✅ | ✅ |
| Scope | — | conversion only | conversion only; **deletion-enabled mode only** (the other mode keeps the guarded path) | every guarded write (conversion, profile snapshot, awards, leaderboard maintenance) | everything |
| Code | — | about 30 lines | **about 60–80 lines** in 2 security-critical files: the probe script, its memory-store emulation, extracting the shared anon SQL, the orchestration | about 25 / −15 lines in the core fence (`withRedisIdentityPermit` / `guardedRedisEval`) plus the memory emulation | none; a Netlify setting (plan), the Upstash region and the Candidate/Publish path |
| Main risk | — | rejected by the OWNER | duplicated validation logic (a second reader of the identity and permit rules) that can drift; the AGENTS.md anti-pattern "duplicate logic paths" | widest blast radius, in the Account Deletion fence | Production config; a far Upstash would get slower |

## D. Where the time goes (measured vs inferred)
- **Measured:**
  - signed-in Stage status, function duration 3.25–3.40 s, in windows without a logged lock wait over 1 s;
  - warm Stage `profile-me`, about 0.47 s for about 7 DB round trips;
  - anonymous Stage status (Redis reads only), 0.47–1.15 s;
  - Production anonymous `calculate-xp` p50 0.12 s.
- **Inferred:**
  - DB round trip ≈ 65–90 ms (functions in `iad`, DB in `eu-west-3`). The signed-in status makes about 14 of them, ≈ 0.9–1.3 s.
  - The remaining ≈ 2 s on Stage is about 9 sequential Upstash calls: the reads, then 7 under the locks.
  - **The Stage Upstash looks much slower than the Production one** (0.5–1.1 s vs 0.12 s for the same read-only anonymous path).
  - Therefore Stage timings overstate the Upstash share. On Production the DB round trips and the lock hold probably dominate.
- **Consequence:**
  - V1's certain structural saving is −5 DB round trips (≈ 0.3–0.45 s inferred) and −2 lock acquisitions per no-op status or award.
  - V2's saving is mostly Upstash latency: large on Stage, probably small on Production.
  - None of the time splits is measured on Production.

## E. Assessment
- V0 is **withdrawn**, because D1 and D2 are rejected.
- V1 is the only variant that removes locks while keeping D1, D2 and the owner index. Its runtime cost is far below the current path, but its code cost is moderate and it duplicates security validation. Its value on Production is inferred, not measured.
- After T2 (#1320), concurrency is already lower: Stage lock waits over 1 s went from 36 (max 13.8 s) to 11 (max 4.9 s). The residual queue benefit of V1 is smaller than when 2a was proposed.

## F. Recommendation (one, for an OWNER GO)
**Do not implement 2a now. Instead, GO for one small, behaviour-free diagnostic PR that measures where `calculate-xp` time goes. Then decide V1 / V3 / nothing on Production-representative data.**

Why:
- The only safe variant, V1, needs about 60–80 lines in security-critical code and duplicates the identity and permit validation.
- Its Production benefit (about 5 DB round trips and 2 locks per no-op request) is inferred, not measured.
- Stage timings are distorted by a much slower Stage Upstash (D).
- T2 has already cut the lock queue.

**The diagnostic PR (plan only; separate GO):**
- `netlify/functions/calculate-xp.mjs::handler`: one bounded aggregate `klog("calc_xp_timing", {op, jwtMs, conversionMs, totalsMs, persistMs, awardMs, totalMs})`.
  - Only for requests of ≥ 1000 ms. No identifiers.
  - The same pattern as the existing `profile_me_timing` in `profile-me.mjs`.
- About 15 lines. No behaviour change. A fundamental test that the log carries no identifiers and fires only above the threshold, in an existing calculate-xp test file.
- Measure on the Stage Preview. After an OWNER-decided publication, also on Production (Netlify function logs, aggregates only).

**Decision rule after the measurement:**
- `conversionMs` is a large share on Production (≥ 25 % of `totalMs`) → V1. It needs its own SpecKit and Codex review, and the lockless SQL must reuse the extracted existing query, not a copy.
- The DB round-trip phases dominate across `jwt`/`conversion`/`persist` → evaluate V3 together with the Upstash region (Production and Stage), before any code.
- Neither → close 2a.

V2 (folding the permit init) is not recommended: it widens the blast radius into the Account Deletion fence for a saving that is mostly Stage-only.
