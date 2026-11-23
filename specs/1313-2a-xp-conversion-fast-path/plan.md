# Plan: #1313 2a, skip no-op anonymous XP conversion

## Change (one function)
In `netlify/functions/_shared/xp-identity.mjs::migrateAnonXpToUser`, after the existing `anonId === userId` early return and before `guardedRedisEval`:
1. Build the 4 keys exactly as the guarded call does:
   - `userMarker = createXpLedgerKeys({namespace}).userMigration(userId)`;
   - `pairMarker = .migration(anonId, userId)`;
   - `anonTotal = createXpLedgerKeys({namespace, anonymous:true}).total(anonId)`;
   - `userTotal = createXpLedgerKeys({namespace}).total(userId)`.
2. If `typeof store.mget === "function"`, run `values = await store.mget([...])` inside `try`. On any throw or a non-array result of the wrong length, skip to the guarded path.
3. If `values[0] != null || values[1] != null`, return `{converted:0, userTotal:int(values[3]), anonTotal:int(values[0] ?? values[1]), alreadyConverted:true}`.
   - This mirrors the script: the user marker is checked first, then the pair marker.
   - `int(v)` = `Math.max(0, Math.floor(Number(v) || 0))`, the same normalization as the existing return.
4. If `values[2] == null`, or `values[2]` is a canonical integer string with `Number(values[2]) <= 0`, return `{converted:0, userTotal:int(values[3]), anonTotal:0, alreadyConverted:false}`.
5. Otherwise continue to the unchanged `guardedRedisEval` call.

Estimated diff: about +20 lines in `xp-identity.mjs`, no deletions elsewhere. No other file changes except tests.

## Fundamental tests (existing files only)
- **`tests/xp-redis-v3.behavior.test.mjs`** (V3 fixture with `beginSql` and permits; already in CI `core`). For each case, use counting `beginSql` and `store.eval` spies.
  - (a) A user marker is present → `converted:0`, `alreadyConverted:true`, 0 transactions, 0 evals.
  - (b) A pair marker is present → the same.
  - (c) No marker and no anon total → 0 transactions, 0 evals.
  - (d) An anon total of 7 → the guarded path, converted exactly once; a second call takes the fast path.
  - (e) An anon total of `"abc"` → the guarded path (same error as today).
  - (f) `mget` throws → the guarded path.
  - (g) Race: the fast path reads 0, then an anonymous award writes 7 → the next call converts 7, exactly once.
  - (h) The permit is `BLOCKED` and the epoch is missing → the fast path skips. The **guarded write that follows** still rejects with `account_redis_fenced`: use the existing `put`/award helper.
- **`tests/xp-leaderboard-foundation.behavior.test.mjs`:** the existing idempotency and hidden-leaderboard tests must pass unchanged. The second call now takes the fast path and returns `alreadyConverted:true`.
- Existing deletion and XP suites run unchanged: `account-deletion-redis.behavior`, `xp-ledger.behavior`, `calculate-xp` (node) and `account-deletion.e2e`.

## Constitution Check (v1.6.0)
| Gate | Result |
|---|---|
| I Simplicity | PASS: one guarded early return in one function; no new mechanism |
| II Runtime boundaries | PASS: no WS or Poker change |
| III Fail-closed | PASS: the fast path never writes; every write stays guarded; uncertainty falls back to the guarded path |
| IV Logging/JSP | PASS: server ESM, `klog` only if any; no browser code |
| V Tests | PASS: fundamental tests in existing files |

## Measurement (after a separate GO and a Draft PR; Stage only)
1. **Baseline:** a Deploy Preview of main, signed in, using the OWNER device or a Stage test account provided by the OWNER. Take N ≥ 10 Account opens and N ≥ 5 short game sessions (awards).
2. **After:** the same on the PR Deploy Preview.
3. Netlify request detail: the function duration (`operations[].duration_ns`) of `calculate-xp`, separately for status and award. Report the median and p90.
4. Stage `pg_stat_statements` deltas (snapshot before and after each run, no reset):
   - calls of the anon-identity query;
   - calls of `pg_advisory_xact_lock(hashtextextended($1,$2))`;
   - total and mean exec time of the lock statement.

   Divide by the `calculate-xp` invocation count from Netlify.
5. Stage `log_lock_waits` count and maximum in the same windows.
6. Aggregates only; no tokens, user ids or HAR.

## Risks and compatibility
- **Liveness:** a racing anonymous award may convert one request later. Exactly-once is unchanged.
- **Error path:** with a missing epoch, a status read fails at the persist step instead of the conversion step. It is still 5xx, and the client handling is unchanged.
- **Breaking changes:** none expected. No API, response, schema or client change.
- **Production:** behaviour depends on `ACCOUNT_DELETION_ENABLED` / XP v3, as today. Both branches are covered by the fallback.
