# Research: verification and scope-2 security analysis (#1313)

Read-only. No Netlify, Supabase, Upstash or Production change was made.

## R1. Netlify Functions region, plan and Upstash region (verified 2026-11-22)
| Item | Result | Source |
|---|---|---|
| Functions region, Production deploy `6b01afdc` (`308806cc`) | `functions_region: "iad"` (AWS `us-east-1`, N. Virginia) for all 61 functions; `functions_region_overrides: []` | Netlify deploy API (read) |
| Netlify team plan | `type_name: "Personal"`, site plan id `nf_team_dev` | Netlify team/site API (read) |
| Region change availability | Netlify docs: region selection is available on Pro and Enterprise plans only. Site-wide setting in UI only; per-function override in `netlify.toml`. Takes effect after a redeploy; old deploys keep their region. Self-serve EU: `fra`, `dub`, `lhr`; Paris `cdg` via support | docs.netlify.com, functions optional configuration |
| DB pooler | Supabase `eu-west-3` (Paris) | #1311 diagnosis |
| Upstash region | **Not verified.** The endpoint is a site-scoped secret, not readable with the available read-only access (Netlify CLI not logged in, no team-level variable). Indirect evidence only: Production `calculate-xp` p50 is 123 ms while it makes several Upstash calls, which suggests Upstash is near `iad` | OWNER read-only check needed (Upstash console → database → region) |

Consequence for scope 4 (HOLD): moving functions to the EU without moving Upstash would make every guarded XP transaction slower. Each such transaction holds the `account-lifecycle` lock across several Upstash calls, so the lock would be held longer. The Upstash region must be known before any region decision.

## R2. Lock evidence (Stage, read-only)
- `pg_stat_statements` (since 2026-10-27): `select pg_advisory_xact_lock(hashtextextended($1,$2))` has 4937 calls, mean 2077 ms, max 38.5 s. The profile queries themselves take 0.03–0.44 ms.
- Postgres `log_lock_waits` (deadlock_timeout 1 s), 2026-11-22 18:03–18:05 (Preview #1311 test session): waits on `account-lifecycle:<test account>` from 1.1 s to 13.8 s, in a serial queue of about 2.2 s per holder. Earlier windows (2026-11-21 19:05, 22:38; 2026-11-22 00:41) show 10–15 s waits on other accounts.
- The holder pattern matches `calculate-xp`. On the same Account open, 8 `calculate-xp` POSTs started in the same millisecond and finished after 5.3, 7.6, 9.8, 12.0, 14.3, 16.5, 18.8 and 19.6 s.
- Production (Netlify): 8 concurrent `calculate-xp` at 09:36:55 (all 499 after about 13 s). At 09:37:08, 3 more `calculate-xp` took 18–19 s, while the base `profile-me` spent 15.9 s inside the function.

## R3. What a logged-in XP status read locks today
`netlify/functions/calculate-xp.mjs` with `operation:"status"`:
1. `verifySupabaseJwt` → `assertAccountActive` in its own transaction (lock `[user]`, DB only).
2. `convertAnonymousXp` → `xp-identity.mjs::migrateAnonXpToUser` → `store-upstash.mjs::guardedRedisEval` → `withRedisIdentityPermit([anonId,userId])`. One transaction holds the locks of both identities across Upstash `GET epoch`, `EVAL INIT_PERMIT` per id and `EVAL` of the conversion script.
3. `readCanonicalXpStatus` → plain unguarded Redis GETs (`xp-ledger.mjs::readXpTotals`).
4. `persistUserProfile` → `store-upstash.mjs::saveUserProfile` → `guardedUserMutation('set')`. Another transaction holds lock `[user]` across Upstash calls, even when `totalXp` is unchanged.

So each status read takes three lifecycle-locked transactions, two of them with Upstash calls inside. Most of the time steps 2 and 4 change nothing.

## R4. Invariants that must hold (Account Deletion V3)
- **I1** Every Redis write for an account identity runs inside a Lua script that atomically checks `epoch` and the `ACTIVE:<epoch>` permit (`guardedRedisEval` / `guardedUserMutation`).
- **I2** A permit is initialized only under `account-lifecycle:<id>`, after SQL proves the account exists and is not being deleted (`withRedisIdentityPermit`). `BLOCKED` is never overwritten (`INIT_PERMIT`).
- **I3** Deletion `preparing` (`ws-server/poker/runtime/account-deletion.mjs`) first sets `BLOCKED`, then takes the lifecycle lock as a barrier. After that, no guarded write for the identity can succeed.
- **I4** A deleting or missing account gets 401 from `verifySupabaseJwt` before any XP work.
- **I5** Plain Redis reads are already unguarded (`readXpTotals`). A read is not a fenced operation.

## R5. Candidate change (scope 2a): skip a no-op conversion. NOT implemented; separate GO
In `migrateAnonXpToUser`, before `guardedRedisEval`, make plain reads of `userMigration(userId)` and `migration(anonId,userId)`, then of the anon `total(anonId)`:
- If a marker exists, the script would return `converted=0` → return `alreadyConverted:true` with no transaction.
- If there is no marker and the anon total is ≤ 0 or absent, the script would return `converted=0` → return with no transaction.
- In any other case, including any read error or unexpected value, take the existing guarded path unchanged (fail closed on uncertainty).

**Why it is safe**
- The fast path performs **no write**, so I1–I3 are untouched. Every path that writes still goes through the guarded script.
- **Concurrent anon award vs skip:** an award to the anon id that lands after the plain read is converted on the next status read. This is a liveness delay only, never a double or lost conversion: the script and its markers stay the only authority, and the script is atomic.
- **Concurrent conversion vs skip:** two conversions still serialize in the guarded script, and the markers make the second one a no-op, as today.
- **Account Deletion during a status read:** I4 rejects deleting accounts first. If deletion starts after the JWT check, the fast path writes nothing. The guarded `persistUserProfile` (kept) then fails closed on `BLOCKED`, as today, so the status read still fails closed.
- **Redis epoch missing (V3 recovery):** today `convertAnonymousXp` throws. With 2a the status read still fails closed, through the guarded `persistUserProfile`. This holds only while 2b is not adopted.

**Expected effect:** one of the three locked transactions disappears from most status reads, and with it several Upstash calls under the lock.

## R6. Candidate change (scope 2b): skip a no-op profile snapshot. Needs an explicit decision
Skip `guardedUserMutation('set')` in `saveUserProfile` when the existing snapshot already has the same `totalXp`.
- Trade-off 1: `updatedAt` is no longer refreshed on reads.
- Trade-off 2: with both 2a and 2b, a status read for an account whose Redis identity is `BLOCKED`, or during epoch recovery, would return read-only totals (200) instead of failing. This changes the observable fail-closed behaviour.
- Recommendation: not now. Adopt it only with explicit OWNER acceptance of these two trade-offs.

## R7. Proof required before the GO for 2a (fundamental, deterministic tests with fakes)
1. A user marker exists → no `beginSql` and no `eval`.
2. The anon total is 0 or absent, with no marker → no `beginSql` and no `eval`.
3. The anon total is > 0 → the existing guarded path runs, with the same keys and arguments.
4. A plain read throws or returns an unexpected value → the guarded path runs.
5. An anon award lands between the check and the skip → the next call converts it exactly once.
6. A `BLOCKED` permit → no Redis write succeeds through any status path, and the status read fails closed.
7. Epoch missing → the status read fails closed (through the persist guard).
8. A deleting account → 401 before XP work (existing behaviour, regression check).
These go into `tests/xp-redis-v3.behavior.test.mjs` / `tests/calculate-xp.test.mjs` with the existing fakes. No live Redis or DB.
