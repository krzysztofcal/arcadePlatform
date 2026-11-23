# Plan: #1313 2a, skip no-op anonymous XP conversion

## Change (one function), revised after Codex plan review R1
In `netlify/functions/_shared/xp-identity.mjs::migrateAnonXpToUser`, after the existing `anonId === userId` early return and before `guardedRedisEval`:
0. **Gate (R1/F7):** only when the guarded path would lock, i.e. `process.env.ACCOUNT_DELETION_ENABLED === "1" || isXpV3(namespace)`. In legacy mode (one unlocked eval) nothing changes.
1. Build the 4 keys exactly as the guarded call does: `userMigration(userId)`, `migration(anonId,userId)`, the anon `total(anonId)` and the user `total(userId)`.
2. `store.mget` must exist. Call it in `try`. The result must be an **array of exactly 4** entries (R1/F4); on any throw or other shape, use the guarded path.
3. **Canonical values only (R1/F3):** every entry must be `null` or a string matching `/^-?\d+$/`, which is what `SET`/`INCRBY` write. Anything else goes to the guarded path.
4. If entry 0 or entry 1 is non-null → return `{converted:0, userTotal:max0(e3), anonTotal:max0(e0 ?? e1), alreadyConverted:true}`. This follows the script's order: the user marker first.
5. Else, if entry 2 is null or `Number(e2) <= 0` → return `{converted:0, userTotal:max0(e3), anonTotal:0, alreadyConverted:false}`.
6. Else → the unchanged `guardedRedisEval`.

Here `max0(v) = Math.max(0, Math.floor(Number(v) || 0))`, the existing normalization of the return. Estimated diff: about +25 lines in `xp-identity.mjs` only.

**Known behaviour differences (no write involved), for an OWNER decision:**
- **D1 (R1/F1):** a request with an `anonId` that the guarded path would reject (an existing Auth user, deleting, retired or `BLOCKED`) no longer fails when no conversion is due. The fast path writes nothing, and the `anonId` has no other effect: status and award operate on the JWT user, and their writes stay guarded by the JWT user's permit. When a conversion is due, the guarded path still rejects it as today.
- **D2 (R1/F2):** if a marker or total key has a non-string type (data corruption only; these keys are only ever `SET`/`INCRBY` strings), `MGET` reads `null` where Lua `GET` would raise `WRONGTYPE`. The fast path then skips (no write) instead of failing.

## Fundamental tests (existing files only)
**`tests/xp-redis-v3.behavior.test.mjs`** (V3 fixture with permits; in CI `core`). Use counting spies on `beginSql`, `store.eval` and `store.mget`.
- (a) A user marker → `alreadyConverted:true` with the full 4-field result; 0 transactions, 0 evals.
- (b) A pair marker → the same. (b2) Both markers → the user marker's value wins, as in the script.
- (c) No marker and no anon total → `{0, userTotal, 0, false}`; 0 transactions.
- (d) An anon total of `"7"` → the guarded path, converted once; the second call takes the fast path.
- (e) Non-canonical values → the guarded path: `"abc"` in the anon total, `"0b10"` in a marker, `"0b10"` in the user total, `"-0.5"` in the anon total.
- (f) `mget` missing, throwing, returning `[]` or returning 3 entries → the guarded path.
- (g) Races:
  - (g1) the fast path reads 0, an anonymous award writes 7, the next call converts it exactly once;
  - (g2) the user marker is set by a second anonId's conversion in between → no conversion from the first anonId. That is today's behaviour too; the user marker blocks later conversions;
  - (g3) two parallel conversion attempts with a positive total → exactly one converts.
- (h) Separate cases on the real status and award handler paths, or the closest existing harness:
  - (h1) the user permit is `BLOCKED` → the guarded write fences (`account_redis_fenced`);
  - (h2) the epoch is missing → it fences;
  - (h3) a deleting account → JWT 401 before any XP work (existing behaviour);
  - (h4) D1: an anonId that is an Auth user with zero total → no write and no permit init for that id; with a positive total → it fences as today.
- The legacy mode gate: with `ACCOUNT_DELETION_ENABLED` off and non-v3 → no `mget` call.

**`tests/xp-leaderboard-foundation.behavior.test.mjs`:** the existing idempotency and hidden-leaderboard tests pass unchanged.
**Existing suites unchanged:** `account-deletion-redis.behavior`, `xp-ledger.behavior`, `account-deletion.e2e`, plus the node `calculate-xp` tests where runnable.

## Constitution Check (v1.6.0)
| Gate | Result |
|---|---|
| I Simplicity | PASS: one guarded early return in one function; no new mechanism |
| II Runtime boundaries | PASS: no WS or Poker change |
| III Fail-closed | PASS: the fast path never writes; every write stays guarded; uncertainty falls back to the guarded path |
| IV Logging/JSP | PASS: server ESM, `klog` only if any; no browser code |
| V Tests | PASS: fundamental tests in existing files |

## Measurement (after a separate GO and a Draft PR; Stage only), revised for R1/F6
1. **Mode check:** on both deploys, identify the active branch from `pg_stat_statements` query texts:
   - deletion enabled → the 3-alias anon query (`as present, ... as deleting, ... as retired`);
   - deletion disabled with v3 → the `to_regclass` schema probe.

   Use the identifier of the matching query.
2. **Controlled windows,** each signed in on the OWNER device or a Stage test account the OWNER provides:
   - Status window: ≥ 10 Account opens, nothing else.
   - Award window: ≥ 10 award requests from short game sessions.
   - Keep the marker and anon-XP state comparable between before and after: the same account, already converted, anon total 0.
3. For each window, snapshot `pg_stat_statements` before and after (no reset) and take the per-query call deltas. Divide by the `calculate-xp` invocations of that window (Netlify logs).
   - Expected per no-op request: the mode query −1 and the lock statement −2.
   - Stage is shared, so report other traffic in the window; if it cannot be separated, report the deltas as estimates.
4. Function duration (Netlify request detail `operations[].duration_ns`) for each window: median and p90, before vs after.
5. Stage `log_lock_waits`: count and maximum for each window.
6. Aggregates only; no tokens, user ids or HAR.

## Risks and compatibility
- **Liveness:** a racing anonymous award is converted by a later status or award request with the same anonId, unless another anonId's conversion set the user marker first (today's behaviour). Exactly-once is unchanged.
- **D1/D2:** no-write behaviour differences, listed under §Change; they need an OWNER decision.
- **Error path:** with a missing epoch, a status read fails at the persist step instead of the conversion step. It is still 5xx, and the client handling is unchanged.
- **Breaking changes:** none expected. No API, response, schema or client change.
- **Production:** behaviour depends on `ACCOUNT_DELETION_ENABLED` / XP v3, as today. Both branches are covered by the fallback.
