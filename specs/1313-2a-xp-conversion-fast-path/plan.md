# Plan: #1313 2a, skip no-op anonymous XP conversion

## Change (one function), revised after Codex plan review R1
In `netlify/functions/_shared/xp-identity.mjs::migrateAnonXpToUser`, after the **complete** existing early return (`!anonId || !userId || anonId === userId`) and before `guardedRedisEval`:
0. **Gate (R1/F7, R2-F1):**
   - Same mode as `withRedisIdentityPermit`: `process.env.ACCOUNT_DELETION_ENABLED === "1" || isXpV3(namespace)`.
   - **And** `namespace === resolveXpNamespace()` (imported from `xp-ledger.mjs`; a throw counts as a mismatch). On a mismatch, use the guarded path, which keeps the `indexedScript` namespace fence.
   - Deployed environments always resolve to v3 (`xp_redis_v3_required`), so legacy mode occurs only in tests.
0b. **Optional leaderboard keys (R3-F1):**
   - Take the fast path only if `leaderboardAllTimeKey` is null or equals `createXpLeaderboardKeys({namespace}).allTime()`.
   - And `leaderboardHiddenKey` is null or equals `createXpLedgerKeys({namespace}).hidden(userId)`. These are the exact values `calculate-xp` passes today.
   - Any other value takes the guarded path, so the `indexedScript` key fence still applies.
1. Build the 4 keys exactly as the guarded call does: `userMigration(userId)`, `migration(anonId,userId)`, the anon `total(anonId)` and the user `total(userId)`.
2. `store.mget` must exist. Call it in `try`. The result must be an **array of exactly 4** entries (R1/F4); on any throw or other shape, use the guarded path.
3. **Canonical values only (R1/F3, R2-F2):** every entry must be `null`, or a string matching `/^(0|-?[1-9][0-9]*)$/` whose `Number` value passes `Number.isSafeInteger`. That rules out `-0`, leading zeros, whitespace, newlines and values beyond 2^53. Anything else goes to the guarded path.
4. If entry 0 or entry 1 is non-null → return `{converted:0, userTotal:max0(e3), anonTotal:max0(e0 ?? e1), alreadyConverted:true}`. This follows the script's order: the user marker first.
5. Else, if entry 2 is null or `Number(e2) <= 0` → return `{converted:0, userTotal:max0(e3), anonTotal:0, alreadyConverted:false}`.
6. Else → the unchanged `guardedRedisEval`.

Here `max0(v) = Math.max(0, Math.floor(Number(v) || 0))`, the existing normalization of the return. Estimated diff: about +30 lines in `xp-identity.mjs` only, including the import of `resolveXpNamespace`.

**Known behaviour differences (no write involved), for an OWNER decision.** They are mode-dependent (R2-F5):
- **D1 (R1/F1):** an `anonId` that the guarded path would reject (an existing Auth user, deleting, retired or `BLOCKED`), when no conversion is due.
  - Deletion enabled: today the request fails; afterwards the conversion is skipped and the request continues.
  - Deletion disabled with v3: today `convertAnonymousXp` already catches the error, returns `null`, logs `calc_anon_migration_failed` and the request continues; afterwards only that log line disappears. The fast path writes nothing, and the `anonId` has no other effect: status and award operate on the JWT user, and their writes stay guarded by the JWT user's permit. When a conversion is due, the guarded path still rejects it as today.
- **D2 (R1/F2, R2-F4):** a non-string-typed marker or total key (data corruption only). `MGET` reads `null` there.
  - The outcome changes **only** when the `MGET` values then allow a fast return. Example: a corrupt user-total key plus a marker gives a fast return with `userTotal:0`, where today Lua raises `WRONGTYPE`.
  - If the values lead to the guarded path (for example a positive anon total), Lua still raises `WRONGTYPE` as today.
  - **(R3-F2)** It also covers a non-string-typed **owner-index** key (`xp-owner-index` ZADD prefix), again data corruption only. Today even a no-op conversion raises `WRONGTYPE` at that `ZADD`; the fast return skips it. Both modes are tested.
  - The request outcome by mode follows D1.

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
- (h) Separate cases on the real status and award handler paths, or the closest existing harness. **h1 and h2 only** first assert with spies that the conversion took the fast path (0 conversion transactions, 0 conversion evals), then assert the rejection by the later guarded write (R2-F4). h3–h6 assert the calls and the result of their own scenario (R3-F3):
  - (h1) the user permit is `BLOCKED` → the guarded write fences (`account_redis_fenced`);
  - (h2) the epoch is missing → it fences;
  - (h3) a deleting account → JWT 401 before any XP work (existing behaviour);
  - (h4) D1: an anonId that is an Auth user, with zero total → no write and no permit init for that id. With a positive total → the guarded conversion fences.
    - Assert the conversion result and the handler response separately, in both modes: deletion enabled → today a failure; deletion disabled → today `null` plus the request continuing.
  - (h5) D2: a non-string user-total key plus a marker → a fast return (documented difference). A non-string key plus a positive anon total → the guarded path still raises `WRONGTYPE`.
  - (h6) A namespace mismatch → no `mget`; the guarded path (namespace fence).
  - (h7) The correct namespace but a leaderboard key from another v3 namespace → no fast return; the guarded path rejects it as today.
  - (h8) D2 owner index: a non-string owner-index key, valid MGET values → a fast return (documented); with a positive anon total → `WRONGTYPE` as today.
  - (e2) Non-canonical strings: `-0`, `007`, `"5\n"`, `"9007199254740993"` → the guarded path.
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
1. **Mode check (R2-F3):** before the measurement, confirm each deploy's mode independently:
   - the OWNER confirms `ACCOUNT_DELETION_ENABLED` for that deploy context (the value, not secrets);
   - or a controlled pre-window shows the mode query growing only with that deploy's requests.

   **SC-002 indicator by mode:**
   - deletion enabled → the 3-alias anon query (`as present, ... as deleting, ... as retired`);
   - deletion disabled with v3 → the `to_regclass` schema probe.

   In both modes: the lock statement (`pg_advisory_xact_lock(hashtextextended($1,$2))`).

   **The baseline and the change must run in the same confirmed mode (R3-F4).** Without a comparable pair, SC-002 is unverified.
2. **Controlled windows,** each signed in on the OWNER device or a Stage test account the OWNER provides:
   - Status window: ≥ 10 Account opens, nothing else.
   - Award window: ≥ 10 award requests from short game sessions.
   - Keep the marker and anon-XP state comparable between before and after: the same account, already converted, anon total 0.
3. For each window, snapshot `pg_stat_statements` before and after (no reset) and take the per-query call deltas. Divide by the `calculate-xp` invocations of that window (Netlify logs).
   - Expected per no-op request: the mode query −1 and the lock statement −2 (deletion enabled; the user check plus the anon lock). Deletion disabled with v3: the lock statement −2.
   - Use **isolated windows**: no other Stage preview or WS activity, confirmed from Netlify logs and the WS Preview being idle.
   - If the attribution cannot be established, **SC-002 is reported as unverified**, not as an estimate.
4. Function duration (Netlify request detail `operations[].duration_ns`) for each window: median and p90, before vs after.
5. Stage `log_lock_waits`: count and maximum for each window.
6. Aggregates only; no tokens, user ids or HAR.

**Review note:** the R3 revisions (§Change 0b, D2 owner index, the (h) wording, same-mode measurement) were made after the final, third plan-review round and have **not** been re-reviewed. They are part of the implementation PR review.

## Risks and compatibility
- **Liveness (R2-F6):** a racing anonymous award is converted by the next *eligible* request: the same anonId, a positive `conversionCap`, and no user marker set meanwhile by another anonId's conversion (today's behaviour). Exactly-once is unchanged.
- **D1/D2:** no-write behaviour differences, listed under §Change; they need an OWNER decision.
- **Error path:** with a missing epoch, a status read fails at the persist step instead of the conversion step. It is still 5xx, and the client handling is unchanged.
- **Breaking changes:** none expected. No API, response, schema or client change.
- **Production:** behaviour depends on `ACCOUNT_DELETION_ENABLED` / XP v3, as today. Both branches are covered by the fallback.
