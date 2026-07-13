import assert from "node:assert/strict";
import test from "node:test";
import { __createMemoryStoreForTests } from "../netlify/functions/_shared/store-upstash.mjs";
import { createXpLeaderboardHandler } from "../netlify/functions/xp-leaderboard.mjs";
import { createXpLeaderboardMeHandler } from "../netlify/functions/xp-leaderboard-me.mjs";
import { computeXpLevel } from "../netlify/functions/_shared/xp-level.mjs";
import { createXpLeaderboardKeys, getXpLeaderboardPeriods } from "../netlify/functions/_shared/xp-leaderboard.mjs";
import {
  parseLeaderboardQuery,
  readLeaderboardMe,
  readLeaderboardPage,
  readLeaderboardProfiles,
} from "../netlify/functions/_shared/xp-leaderboard-read.mjs";
import { configuredRateLimit, leaderboardEnabled } from "../netlify/functions/_shared/xp-leaderboard-http.mjs";

const USER_A = "00000000-0000-4000-8000-000000000001";
const USER_B = "00000000-0000-4000-8000-000000000002";
const USER_C = "00000000-0000-4000-8000-000000000003";
const USER_D = "00000000-0000-4000-8000-000000000004";
const NAMESPACE = "test:xp:leaderboard:api";
const NOW = Date.parse("2026-07-13T12:00:00Z");

function profile(userId, name) {
  const slug = name.toLowerCase().replaceAll(" ", "-");
  return {
    userId,
    handle: `${slug}-123456`,
    displayName: name,
    bio: "must remain private",
    avatarKey: "internal-avatar-key.webp",
    avatarVariant: "fox-blue",
    handleCustomizedAt: null,
  };
}

const PROFILE_MAP = new Map([
  [USER_A, profile(USER_A, "Alpha Ace")],
  [USER_B, profile(USER_B, "Beta Bolt")],
  [USER_C, profile(USER_C, "Cosmic Comet")],
]);

function readProfiles(userIds) {
  return Promise.resolve(new Map(userIds.filter((userId) => PROFILE_MAP.has(userId)).map((userId) => [userId, PROFILE_MAP.get(userId)])));
}

function event(query = {}, headers = {}) {
  return { httpMethod: "GET", headers, queryStringParameters: query };
}

function body(response) {
  return JSON.parse(response.body);
}

async function seededStore() {
  const store = __createMemoryStoreForTests();
  const keys = createXpLeaderboardKeys({ namespace: NAMESPACE });
  for (const [userId, score] of [[USER_A, 300], [USER_B, 200], [USER_C, 200], [USER_D, 150]]) {
    await store.zadd(keys.allTime(), score, userId);
    await store.set(`${NAMESPACE}:total:${userId}`, score);
  }
  return store;
}

test("leaderboard query validation is bounded and endpoint-specific", () => {
  assert.deepEqual(parseLeaderboardQuery({}), { period: "all_time", page: 1, limit: 25 });
  assert.deepEqual(parseLeaderboardQuery({ period: "week", page: "2", limit: "50" }), { period: "week", page: 2, limit: 50 });
  assert.throws(() => parseLeaderboardQuery({ period: "monthly" }), { code: "invalid_period" });
  assert.throws(() => parseLeaderboardQuery({ page: "0" }), { code: "invalid_page" });
  assert.throws(() => parseLeaderboardQuery({ limit: "51" }), { code: "invalid_limit" });
  assert.throws(() => parseLeaderboardQuery({ member: USER_A }), { code: "invalid_request" });
  assert.throws(() => parseLeaderboardQuery({ page: "1" }, { me: true }), { code: "invalid_request" });
});

test("leaderboard profile reads fail closed for owner opt-outs", async () => {
  let sql = "";
  const result = await readLeaderboardProfiles([USER_A], async (query) => { sql = query; return []; });
  assert.match(sql, /leaderboard_visible\s*=\s*true/i);
  assert.equal(result.size, 0);
});

test("public pages use competition ranks and never over-fetch a missing profile", async () => {
  const store = await seededStore();
  const first = await readLeaderboardPage({ period: "all_time", page: 1, limit: 2 }, {
    store, namespace: NAMESPACE, nowMs: NOW, readProfiles,
  });
  const second = await readLeaderboardPage({ period: "all_time", page: 2, limit: 2 }, {
    store, namespace: NAMESPACE, nowMs: NOW, readProfiles,
  });
  assert.deepEqual(first.response.rows.map(({ rank, handle, xp }) => ({ rank, handle, xp })), [
    { rank: 1, handle: "alpha-ace-123456", xp: 300 },
    { rank: 2, handle: "cosmic-comet-123456", xp: 200 },
  ]);
  assert.deepEqual(second.response.rows.map(({ rank, handle, xp }) => ({ rank, handle, xp })), [
    { rank: 2, handle: "beta-bolt-123456", xp: 200 },
  ]);
  assert.equal(first.response.hasMore, true);
  assert.equal(second.response.hasMore, false);
  assert.equal(second.diagnostics.missingProfiles, 1);
  assert.equal(new Set([...first.response.rows, ...second.response.rows].map((row) => row.handle)).size, 3);
  const serialized = JSON.stringify([first.response, second.response]);
  for (const forbidden of [USER_A, USER_B, USER_C, "must remain private", "internal-avatar-key", "userId", "avatarKey"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("public and authenticated ranks ignore stale members without an eligible profile", async () => {
  const store = await seededStore();
  const keys = createXpLeaderboardKeys({ namespace: NAMESPACE });
  for (const [userId, score] of [[USER_D, 4000], [USER_A, 3699], [USER_B, 500], [USER_C, 96]]) {
    await store.zadd(keys.allTime(), score, userId);
    await store.set(`${NAMESPACE}:total:${userId}`, score);
  }
  const readOnlyVisibleProfiles = (userIds) => Promise.resolve(new Map(
    userIds
      .filter((userId) => userId === USER_A || userId === USER_C)
      .map((userId) => [userId, PROFILE_MAP.get(userId)]),
  ));

  const complete = await readLeaderboardPage({ period: "all_time", page: 1, limit: 25 }, {
    store, namespace: NAMESPACE, nowMs: NOW, readProfiles: readOnlyVisibleProfiles,
  });
  const first = await readLeaderboardPage({ period: "all_time", page: 1, limit: 2 }, {
    store, namespace: NAMESPACE, nowMs: NOW, readProfiles: readOnlyVisibleProfiles,
  });
  const second = await readLeaderboardPage({ period: "all_time", page: 2, limit: 2 }, {
    store, namespace: NAMESPACE, nowMs: NOW, readProfiles: readOnlyVisibleProfiles,
  });
  const own = await readLeaderboardMe({ period: "all_time" }, USER_A, {
    store, namespace: NAMESPACE, nowMs: NOW, readProfiles: readOnlyVisibleProfiles,
  });

  assert.deepEqual(complete.response.rows.map(({ rank, handle }) => ({ rank, handle })), [
    { rank: 1, handle: "alpha-ace-123456" },
    { rank: 2, handle: "cosmic-comet-123456" },
  ]);
  assert.equal(complete.diagnostics.missingProfiles, 2);
  assert.deepEqual(first.response.rows.map(({ rank, handle }) => ({ rank, handle })), [
    { rank: 1, handle: "alpha-ace-123456" },
  ]);
  assert.deepEqual(second.response.rows.map(({ rank, handle }) => ({ rank, handle })), [
    { rank: 2, handle: "cosmic-comet-123456" },
  ]);
  assert.equal(first.response.hasMore, true);
  assert.equal(second.response.hasMore, false);
  assert.equal(first.diagnostics.missingProfiles, 1);
  assert.equal(second.diagnostics.missingProfiles, 1);
  assert.equal(own.response.me.rank, 1);
  assert.equal(own.diagnostics.missingProfiles, 1);
});

test("period XP uses the period index while level uses batched canonical lifetime XP", async () => {
  const store = await seededStore();
  const periods = getXpLeaderboardPeriods(NOW);
  const keys = createXpLeaderboardKeys({ namespace: NAMESPACE });
  await store.zadd(keys.day(periods.dayKey), 25, USER_B);
  await store.zadd(keys.day(periods.dayKey), 10, USER_A);
  let mgetCalls = 0;
  const originalMget = store.mget;
  store.mget = async (requestedKeys) => {
    mgetCalls += 1;
    assert.deepEqual(requestedKeys, [`${NAMESPACE}:total:${USER_B}`, `${NAMESPACE}:total:${USER_A}`]);
    return originalMget(requestedKeys);
  };
  const result = await readLeaderboardPage({ period: "today", page: 1, limit: 25 }, {
    store, namespace: NAMESPACE, nowMs: NOW, readProfiles,
  });
  assert.equal(mgetCalls, 1);
  assert.deepEqual(result.response.rows.map(({ handle, xp, level }) => ({ handle, xp, level })), [
    { handle: "beta-bolt-123456", xp: 25, level: computeXpLevel(200) },
    { handle: "alpha-ace-123456", xp: 10, level: computeXpLevel(300) },
  ]);
  assert.equal(result.response.periodKey, periods.dayKey);
  assert.equal(result.response.nextResetAt, periods.nextDayResetAt);
});

test("missing or corrupt lifetime XP fails instead of fabricating level one", async () => {
  const store = __createMemoryStoreForTests();
  const periods = getXpLeaderboardPeriods(NOW);
  const keys = createXpLeaderboardKeys({ namespace: NAMESPACE });
  await store.zadd(keys.day(periods.dayKey), 10, USER_A);
  await assert.rejects(() => readLeaderboardPage({ period: "today", page: 1, limit: 25 }, {
    store, namespace: NAMESPACE, nowMs: NOW, readProfiles,
  }), { code: "leaderboard_projection_inconsistent", status: 503 });
  await store.set(`${NAMESPACE}:total:${USER_A}`, "not-a-number");
  await assert.rejects(() => readLeaderboardPage({ period: "today", page: 1, limit: 25 }, {
    store, namespace: NAMESPACE, nowMs: NOW, readProfiles,
  }), { code: "leaderboard_projection_inconsistent", status: 503 });
});

test("Redis range, lifetime MGET, and profile SQL failures stay non-cacheable 503", async () => {
  const periods = getXpLeaderboardPeriods(NOW);
  const keys = createXpLeaderboardKeys({ namespace: NAMESPACE });
  const scenarios = [];

  const rangeStore = await seededStore();
  rangeStore.zrevrangeWithScores = async () => { throw new Error("redis range unavailable"); };
  scenarios.push({ store: rangeStore, period: "all_time", readProfiles });

  const lifetimeStore = await seededStore();
  await lifetimeStore.zadd(keys.day(periods.dayKey), 10, USER_A);
  lifetimeStore.mget = async () => { throw new Error("redis mget unavailable"); };
  scenarios.push({ store: lifetimeStore, period: "today", readProfiles });

  const profileStore = await seededStore();
  scenarios.push({
    store: profileStore,
    period: "all_time",
    readProfiles: async () => { throw new Error("profile sql unavailable"); },
  });

  for (const scenario of scenarios) {
    const handler = createXpLeaderboardHandler({
      leaderboardEnabled: () => true,
      allowLeaderboardRead: async () => true,
      readLeaderboardPage: (options) => readLeaderboardPage(options, {
        store: scenario.store,
        namespace: NAMESPACE,
        nowMs: NOW,
        readProfiles: scenario.readProfiles,
      }),
    });
    const response = await handler(event({ period: scenario.period }));
    assert.equal(response.statusCode, 503);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(body(response), { error: "leaderboard_unavailable" });
  }
});

test("authenticated me uses the same public projection and competition rank", async () => {
  const store = await seededStore();
  const result = await readLeaderboardMe({ period: "all_time" }, USER_B, {
    store, namespace: NAMESPACE, nowMs: NOW, readProfiles,
  });
  assert.deepEqual(result.response.me, {
    rank: 2,
    handle: "beta-bolt-123456",
    displayName: "Beta Bolt",
    avatar: { type: "default", variant: "fox-blue" },
    xp: 200,
    level: computeXpLevel(200),
    profileUrl: "/u/beta-bolt-123456",
  });
  assert.equal((await readLeaderboardMe({ period: "all_time" }, "00000000-0000-4000-8000-000000000099", {
    store, namespace: NAMESPACE, nowMs: NOW, readProfiles,
  })).response.me, null);
});

test("public handler stays fresh across visibility changes, is gated, rate-limited, and returns controlled failures", async () => {
  const publicPayload = { period: "all_time", rows: [] };
  const handler = createXpLeaderboardHandler({
    leaderboardEnabled: () => true,
    allowLeaderboardRead: async () => true,
    readLeaderboardPage: async () => ({ response: publicPayload, diagnostics: { publicRows: 0, missingProfiles: 0, redisMs: 1, profileMs: 1 } }),
  });
  const success = await handler(event());
  assert.equal(success.statusCode, 200);
  assert.equal(success.headers["cache-control"], "no-store");
  assert.deepEqual(body(success), publicPayload);

  const disabled = await createXpLeaderboardHandler({ leaderboardEnabled: () => false })(event());
  assert.equal(disabled.statusCode, 404);
  assert.equal(disabled.headers["cache-control"], "no-store");

  const limited = await createXpLeaderboardHandler({ leaderboardEnabled: () => true, allowLeaderboardRead: async () => false })(event());
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers["cache-control"], "no-store");

  const invalid = await handler(event({ page: "0" }));
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(body(invalid), { error: "invalid_page" });
  assert.equal(invalid.headers["cache-control"], "no-store");

  const failed = await createXpLeaderboardHandler({
    leaderboardEnabled: () => true,
    allowLeaderboardRead: async () => true,
    readLeaderboardPage: async () => { throw new Error("redis down"); },
  })(event());
  assert.equal(failed.statusCode, 503);
  assert.deepEqual(body(failed), { error: "leaderboard_unavailable" });
  assert.equal(failed.headers["cache-control"], "no-store");
});

test("me handler authenticates before reads and is always private", async () => {
  let reads = 0;
  const create = (auth, allow = true) => createXpLeaderboardMeHandler({
    leaderboardEnabled: () => true,
    verifySupabaseJwt: async () => auth,
    allowLeaderboardRead: async () => allow,
    readLeaderboardMe: async () => {
      reads += 1;
      return { response: { period: "all_time", me: null }, diagnostics: { missingProfiles: 0 } };
    },
  });
  const unauthorized = await create({ valid: false })(event({}, { authorization: "Bearer invalid" }));
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(reads, 0);
  const success = await create({ valid: true, userId: USER_A })(event({}, { authorization: "Bearer valid" }));
  assert.equal(success.statusCode, 200);
  assert.equal(success.headers["cache-control"], "private, no-store");
  assert.equal(reads, 1);
  const limited = await create({ valid: true, userId: USER_A }, false)(event({}, { authorization: "Bearer valid" }));
  assert.equal(limited.statusCode, 429);
  assert.equal(reads, 1);
});

test("leaderboard rollout defaults to previews and requires an explicit production flag", () => {
  assert.equal(leaderboardEnabled({ CONTEXT: "deploy-preview" }, { headers: {} }), true);
  assert.equal(leaderboardEnabled({}, { headers: { host: "deploy-preview-691--playkcswh.netlify.app" } }), true);
  assert.equal(leaderboardEnabled({ CONTEXT: "production" }, { headers: { host: "play.kcswh.pl" } }), false);
  assert.equal(leaderboardEnabled({ CONTEXT: "production", XP_LEADERBOARD_ENABLED: "1" }, { headers: {} }), true);
  assert.equal(leaderboardEnabled({ CONTEXT: "deploy-preview", XP_LEADERBOARD_ENABLED: "0" }, { headers: {} }), false);
  assert.equal(configuredRateLimit("25"), 25);
  assert.equal(configuredRateLimit("invalid"), 60);
  assert.equal(configuredRateLimit("-1"), 60);
});
