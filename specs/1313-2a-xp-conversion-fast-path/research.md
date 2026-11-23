# Research: #1313 scope 2a, skip no-op anonymous XP conversion (read-only, main @ `5364a459`)

No secrets, user data or environment values were read. Code references are to main.

## R1. Current cost of `migrateAnonXpToUser` per call
Call sites, `netlify/functions/calculate-xp.mjs::handler` → `convertAnonymousXp` (around line 700):
- **every status read** (line 724);
- **every award** (line 815).

It runs whenever the request has both a JWT user and a body `anonId` that differs from the user id.

`_shared/xp-identity.mjs::migrateAnonXpToUser` calls `store-upstash.mjs::guardedRedisEval({userIds:[anonId,userId], anonymousIds:[anonId]})`. That calls `withRedisIdentityPermit`, which works as follows when `ACCOUNT_DELETION_ENABLED=1` or XP v3 is on.

The browser `anonId` is `crypto.randomUUID()`, so it passes `ACCOUNT_UUID`. **Both identities** therefore take part:
- One SQL transaction, BEGIN and COMMIT. In deletion-enabled mode it runs, for the user, `assertAccountActive` (advisory lock plus an exists query), and for the anon id a lock plus an identity query, so **2 `account-lifecycle` advisory locks**. The deletion-disabled branch does the same with schema probes. That is about 6 sequential DB round trips.
- **While both locks are held**, the Upstash REST calls run one by one: `GET epoch`, `EVAL INIT_PERMIT` × 2, then `EVAL` of the conversion script, which carries the V3 owner-index `ZADD` prefix. That is **4 HTTP calls**.

`ANON_CONVERSION_SCRIPT` makes **no write** when:
- (a) the user marker `userMigration(userId)` exists (returns `{0, userTotal, marker, 1}`);
- (b) the pair marker `migration(anonId,userId)` exists (same result);
- (c) the anon total is absent or ≤ 0 (returns `{0, userTotal, 0, 0}`).

Case (a) applies to every user after their first real conversion, and case (c) to every user who never had anonymous XP. Almost every call is therefore a no-op that still pays 2 locks, 6 DB round trips and 4 Upstash calls.

**Callers use only `converted > 0`.** `convertAnonymousXp` persists the profile only when `converted > 0`; status (line 737) and award (line 978) report `conversion` only when `converted > 0`.

## R2. Invariants (unchanged from 1313 research R4)
- **I1** Every Redis WRITE for an account identity runs inside a Lua script that atomically checks the epoch and an `ACTIVE:<epoch>` permit.
- **I2** A permit is initialized only under `account-lifecycle:<id>`, after SQL proves the identity's state (`withRedisIdentityPermit`). `BLOCKED` is never overwritten.
- **I3** Deletion `preparing` (`ws-server/poker/runtime/account-deletion.mjs`) sets `BLOCKED`, then takes the lifecycle lock as a barrier.
- **I4** `verifySupabaseJwt` → `assertAccountActive` rejects a deleting or missing account with 401 before any XP work.
- **I5** Plain Redis reads are already unguarded (`xp-ledger.mjs::readXpTotals`).
- **I6** The owner index (`xp-owner-index`, used by `CLEAN_OWNER`) must reference every key that was **written**. Extra references are harmless (store-upstash comment).

## R3. Fast path (proposal)
Before `guardedRedisEval`, make **one** `store.mget([userMigration(userId), migration(anonId,userId), anonTotal(anonId), userTotal(userId)])` with no lock:
- A user marker or a pair marker is set → return `{converted:0, userTotal:<parsed>, anonTotal:<marker>, alreadyConverted:true}`. This is exactly the script's result.
- No marker, and the anon total is absent or exactly a non-positive integer → return `{converted:0, userTotal:<parsed>, anonTotal:0, alreadyConverted:false}`. Again the script's result.
- Anything else falls through to the **unchanged** guarded path:
  - anon total > 0;
  - a non-integer or unparsable value (the Lua `tonumber` would yield nil and error);
  - `mget` missing or throwing;
  - an unexpected array shape.

## R4. Case analysis
| Case | Today | With fast path | Safe? |
|---|---|---|---|
| Concurrent award to the anon id (another, signed-out tab) | Award is atomic; conversion serializes on the locks | The fast path reads 0 just before the award, skips, and the **next** status or award converts it. That is a liveness delay, never a double or lost conversion: markers are written only by the atomic script | ✅ |
| Concurrent conversion (two tabs) | Both lock, and the second sees the marker | The fast path either sees the marker and skips, or sees no marker and runs the guarded script, which sees the marker | ✅ |
| `BLOCKED` permit (deletion running) | `INIT_PERMIT` returns 0 → fence → the request fails | The account already has a deletion request, so I4 gives 401 first. If BLOCKED were set without a request, the skip writes nothing. The status read still fails closed at the guarded `persistUserProfile` (2b is HOLD), and awards fail at the guarded `executeAtomicXpAward` | ✅ (I1–I3 untouched) |
| Account Deletion starts after the JWT check | Fence on the locked conversion | The no-op skip writes nothing; the next guarded write fences | ✅ |
| Epoch missing (V3 recovery) | Fence → status and award fail | Skipped; the status still fails at the guarded persist and the award at its guarded script | ✅ (failure class unchanged; error path differs, both 5xx) |
| Redis error | The guarded path fails | `mget` error → fall back to the guarded path, which fails as today | ✅ |
| Markers wiped (`CLEAN_OWNER` for a deleted user, flush) | — | A deleted user is rejected by I4. After a flush, no marker → normal path | ✅ |
| User change between requests | Ids come from the same request (JWT sub, body anonId) | Same ids; no cross-request state | ✅ |
| Retries | Idempotent | No writes on the fast path | ✅ |
| Non-UUID or legacy anon id; deletion disabled and non-v3 | Unguarded eval | The reads are still valid; a skip avoids one eval | ✅ |
| Owner index (I6) | The no-op eval still `ZADD`s references | Nothing is written, so no reference is needed | ✅ |

**Not changed:** the guarded path, `withRedisIdentityPermit`, `lockAccountLifecycle`, the scripts, the JWT lifecycle check, `persistUserProfile` (2b HOLD), awards, deletion, keys and TTLs.

## R5. Alternatives considered
| Alternative | Verdict |
|---|---|
| Only the user-marker check (1 GET) | It does not help users who never had anonymous XP, who are the common case. `mget` costs the same as one GET |
| Write a "nothing to convert" marker when the anon total is 0 | Rejected: a new write path, and it would block converting anon XP earned later |
| Move the Redis calls out of the locked transaction | Rejected: it changes the I2/I3 barrier semantics of Account Deletion |
| Convert only on `SIGNED_IN` (client trigger) | Rejected: client and Auth lifecycle change, and conversion would be missed when the event is missed |
| A DB column or table for conversion state, or a cache | Rejected: schema, infrastructure and staleness |
| Skip the no-op profile snapshot (2b) | Out of scope (HOLD): it changes the fail-closed behaviour of status (1313 research R6) |

## R6. Expected effect (estimate, to be measured)
For each signed-in status read and each award where the conversion is a no-op:
- removes **1 SQL transaction with 2 `account-lifecycle` locks** (about 6 DB round trips);
- removes **4 Upstash calls made under those locks**;
- adds 1 unlocked Upstash `MGET`.

The status path keeps 2 locked transactions (the JWT check, and the guarded profile snapshot with 3 Upstash calls). The measured single status read is about 3.5 s on Stage, signed in. The share attributable to the conversion transaction is **not yet measured**; plan §Measurement defines how to measure it.
