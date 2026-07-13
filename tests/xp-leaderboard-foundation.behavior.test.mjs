import assert from "node:assert/strict";
import test from "node:test";
import { __createMemoryStoreForTests, __remoteStoreForTests } from "../netlify/functions/_shared/store-upstash.mjs";
import { migrateAnonXpToUser } from "../netlify/functions/_shared/xp-identity.mjs";
import { XP_ATOMIC_AWARD_SCRIPT, createXpLedgerKeys, executeAtomicXpAward } from "../netlify/functions/_shared/xp-ledger.mjs";
import { createXpLeaderboardKeys, getXpLeaderboardPeriods } from "../netlify/functions/_shared/xp-leaderboard.mjs";

const namespace = "test:xp:leaderboard";
const ledgerKeys = createXpLedgerKeys({ namespace });
const leaderboardKeys = createXpLeaderboardKeys({ namespace });

function awardInput({ userId, sessionId, now, delta, member = userId }) {
  const periods = getXpLeaderboardPeriods(now);
  return {
    periods,
    keys: [
      ledgerKeys.session(userId, sessionId),
      ledgerKeys.sessionSync(userId, sessionId),
      ledgerKeys.daily(userId, periods.dayKey),
      ledgerKeys.total(userId),
      ledgerKeys.lock(userId, sessionId),
      leaderboardKeys.allTime(),
      leaderboardKeys.day(periods.dayKey),
      leaderboardKeys.week(periods.weekKey),
    ],
    args: [now, delta, 3000, 300, now, 0, 60_000, member || "", periods.dayExpiresAtSec, periods.weekExpiresAtSec],
  };
}

test("leaderboard periods follow the canonical Warsaw 03:00 XP day and ISO week", () => {
  const beforeMondayReset = getXpLeaderboardPeriods(Date.parse("2026-07-13T00:30:00Z"));
  const afterMondayReset = getXpLeaderboardPeriods(Date.parse("2026-07-13T01:01:00Z"));
  assert.equal(beforeMondayReset.dayKey, "2026-07-12");
  assert.equal(beforeMondayReset.weekKey, "2026-W28");
  assert.equal(afterMondayReset.dayKey, "2026-07-13");
  assert.equal(afterMondayReset.weekKey, "2026-W29");
  assert.ok(beforeMondayReset.dayExpiresAtSec < beforeMondayReset.weekExpiresAtSec);
});

test("memory sorted sets preserve Redis reverse score and member ordering", async () => {
  const store = __createMemoryStoreForTests();
  await store.zadd("ranking", 10, "alpha");
  await store.zadd("ranking", 20, "bravo");
  await store.zadd("ranking", 20, "charlie");
  assert.deepEqual(await store.zrevrangeWithScores("ranking", 0, 2), [
    { member: "charlie", score: 20 },
    { member: "bravo", score: 20 },
    { member: "alpha", score: 10 },
  ]);
  assert.equal(await store.zrevrank("ranking", "bravo"), 1);
  assert.equal(await store.zscore("ranking", "alpha"), 10);
  assert.equal(await store.zcount("ranking", 20, 20), 2);
  assert.equal(await store.zcount("ranking", "(10", "+inf"), 2);
  assert.deepEqual(await store.mget(["missing-1", "missing-2"]), [null, null]);
  assert.equal(await store.zcard("ranking"), 3);
  assert.equal(await store.zrem("ranking", "alpha"), 1);
});

test("remote sorted-set adapter emits bounded Redis commands and normalizes scores", async () => {
  const originalFetch = globalThis.fetch;
  const commands = [];
  globalThis.fetch = async (url) => {
    const command = ["ZADD", "ZINCRBY", "ZREVRANGE", "ZREVRANK", "ZSCORE", "ZCOUNT", "ZCARD", "ZREM", "MGET"]
      .find((candidate) => String(url).includes(`/${candidate}/`));
    commands.push(command);
    return {
      ok: true,
      json: async () => ({ result: command === "ZREVRANGE" ? ["user-2", "20", "user-1", "10"] : (command === "MGET" ? ["1", null] : 1) }),
    };
  };
  try {
    await __remoteStoreForTests.zadd("ranking", 10, "user-1");
    await __remoteStoreForTests.zincrBy("ranking", 5, "user-1");
    assert.deepEqual(await __remoteStoreForTests.zrevrangeWithScores("ranking", 0, 1), [
      { member: "user-2", score: 20 },
      { member: "user-1", score: 10 },
    ]);
    await __remoteStoreForTests.zrevrank("ranking", "user-1");
    await __remoteStoreForTests.zscore("ranking", "user-1");
    await __remoteStoreForTests.zcount("ranking", 1, "+inf");
    await __remoteStoreForTests.zcard("ranking");
    await __remoteStoreForTests.zrem("ranking", "user-1");
    assert.deepEqual(await __remoteStoreForTests.mget(["xp-1", "xp-2"]), ["1", null]);
    assert.deepEqual(commands, ["ZADD", "ZINCRBY", "ZREVRANGE", "ZREVRANK", "ZSCORE", "ZCOUNT", "ZCARD", "ZREM", "MGET"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("authenticated award atomically updates canonical totals and all leaderboard periods", async () => {
  const store = __createMemoryStoreForTests();
  const now = Date.now();
  const input = awardInput({ userId: "user-1", sessionId: "session-1", now, delta: 40 });
  const result = await executeAtomicXpAward({ store, script: XP_ATOMIC_AWARD_SCRIPT, keys: input.keys, args: input.args });
  assert.equal(result.granted, 40);
  assert.equal(await store.zscore(leaderboardKeys.allTime(), "user-1"), 40);
  assert.equal(await store.zscore(leaderboardKeys.day(input.periods.dayKey), "user-1"), 40);
  assert.equal(await store.zscore(leaderboardKeys.week(input.periods.weekKey), "user-1"), 40);
  assert.ok(await store.ttl(leaderboardKeys.day(input.periods.dayKey)) > 0);
  assert.ok(await store.ttl(leaderboardKeys.week(input.periods.weekKey)) > 0);
  assert.equal(await store.ttl(leaderboardKeys.allTime()), -1);

  const duplicate = await executeAtomicXpAward({ store, script: XP_ATOMIC_AWARD_SCRIPT, keys: input.keys, args: input.args });
  assert.equal(duplicate.granted, 0);
  assert.equal(duplicate.status, 2);
  assert.equal(await store.zscore(leaderboardKeys.allTime(), "user-1"), 40);
  assert.equal(await store.zscore(leaderboardKeys.week(input.periods.weekKey), "user-1"), 40);
});

test("zero grants and guest awards do not create leaderboard members", async () => {
  const store = __createMemoryStoreForTests();
  const now = Date.parse("2026-07-12T12:00:00Z");
  const zero = awardInput({ userId: "user-zero", sessionId: "session-zero", now, delta: 0 });
  await executeAtomicXpAward({ store, script: XP_ATOMIC_AWARD_SCRIPT, keys: zero.keys, args: zero.args });
  const guest = awardInput({ userId: "anon-1", sessionId: "session-guest", now: now + 1, delta: 25, member: "" });
  await executeAtomicXpAward({ store, script: XP_ATOMIC_AWARD_SCRIPT, keys: guest.keys, args: guest.args });
  assert.equal(await store.zcard(leaderboardKeys.allTime()), 0);
  assert.equal(await store.zcard(leaderboardKeys.day(zero.periods.dayKey)), 0);
  assert.equal(await store.zcard(leaderboardKeys.week(zero.periods.weekKey)), 0);
});

test("anonymous conversion synchronizes all-time only and remains idempotent", async () => {
  const store = __createMemoryStoreForTests();
  await store.set(ledgerKeys.total("anon-1"), "75");
  const first = await migrateAnonXpToUser({
    store,
    namespace,
    anonId: "anon-1",
    userId: "user-1",
    conversionCap: 1000,
    leaderboardAllTimeKey: leaderboardKeys.allTime(),
  });
  const second = await migrateAnonXpToUser({
    store,
    namespace,
    anonId: "anon-1",
    userId: "user-1",
    conversionCap: 1000,
    leaderboardAllTimeKey: leaderboardKeys.allTime(),
  });
  assert.equal(first.converted, 75);
  assert.equal(second.converted, 0);
  assert.equal(second.alreadyConverted, true);
  assert.equal(await store.zscore(leaderboardKeys.allTime(), "user-1"), 75);
  assert.equal(await store.zcard(leaderboardKeys.day("2026-07-12")), 0);
});
