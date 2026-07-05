import crypto from "node:crypto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSupabaseJwt, parseJsonBody } from "./helpers/xp-test-helpers.mjs";

const mockData = new Map();

const saveUserProfileMock = vi.fn(async () => {});
const atomicRateLimitIncrMock = vi.fn((key) => {
  const current = Number(mockData.get(key) || 0) + 1;
  mockData.set(key, String(current));
  return Promise.resolve({ count: current });
});

const pipelineFactory = () => {
  const operations = [];
  const pipeline = {
    operations,
    incrby: vi.fn((key, value) => {
      operations.push({ op: "incrby", key, value });
      const current = Number(mockData.get(key) || 0);
      mockData.set(key, String(current + Number(value)));
      return pipeline;
    }),
    del: vi.fn((key) => {
      operations.push({ op: "del", key });
      mockData.delete(key);
      return pipeline;
    }),
    set: vi.fn((key, value) => {
      operations.push({ op: "set", key, value });
      mockData.set(key, value);
      return pipeline;
    }),
    exec: vi.fn(() => Promise.resolve(operations)),
  };
  return pipeline;
};

const store = {
  get: vi.fn((key) => Promise.resolve(mockData.get(key) ?? null)),
  set: vi.fn((key, value) => {
    mockData.set(key, value);
    return Promise.resolve("OK");
  }),
  setex: vi.fn((key, ttl, value) => {
    mockData.set(key, value);
    return Promise.resolve("OK");
  }),
  del: vi.fn((key) => {
    mockData.delete(key);
    return Promise.resolve(1);
  }),
  eval: vi.fn((_script, keys, args) => {
    if (keys.length === 4 && args.length === 1) {
      const [anonTotalKey, userTotalKey, markerKey, userMarkerKey] = keys;
      const cap = Math.max(0, Math.floor(Number(args[0]) || 0));
      const existingUserMarker = mockData.get(userMarkerKey);
      const currentUserTotal = Number(mockData.get(userTotalKey) || 0);
      if (existingUserMarker != null) {
        return Promise.resolve([0, currentUserTotal, Number(existingUserMarker) || 0, 1]);
      }
      const existingMarker = mockData.get(markerKey);
      if (existingMarker != null) {
        return Promise.resolve([0, currentUserTotal, Number(existingMarker) || 0, 1]);
      }
      const anonTotal = Math.max(0, Math.floor(Number(mockData.get(anonTotalKey) || 0)));
      const converted = Math.min(anonTotal, cap);
      const nextUserTotal = currentUserTotal + converted;
      if (converted > 0) {
        mockData.set(userTotalKey, String(nextUserTotal));
        mockData.delete(anonTotalKey);
      }
      mockData.set(markerKey, String(converted));
      mockData.set(userMarkerKey, String(converted));
      return Promise.resolve([converted, nextUserTotal, anonTotal, 0]);
    }
    if (keys.length === 5) {
      const [sessionKey, sessionSyncKey, dailyKey, totalKey] = keys;
      const delta = Math.max(0, Math.floor(Number(args[1]) || 0));
      const ts = Math.max(1, Math.floor(Number(args[4]) || Date.now()));
      const daily = Number(mockData.get(dailyKey) || 0) + delta;
      const session = Number(mockData.get(sessionKey) || 0) + delta;
      const lifetime = Number(mockData.get(totalKey) || 0) + delta;
      if (delta > 0) {
        mockData.set(dailyKey, String(daily));
        mockData.set(sessionKey, String(session));
        mockData.set(totalKey, String(lifetime));
      }
      mockData.set(sessionSyncKey, String(ts));
      return Promise.resolve([delta, daily, session, lifetime, ts, 0]);
    }
    return Promise.resolve([0, 0, 0, 0, Date.now(), 0]);
  }),
  pipeline: vi.fn(() => {
    const pipeline = pipelineFactory();
    store._lastPipeline = pipeline;
    return pipeline;
  }),
  _mockData: mockData,
  _reset: () => {
    mockData.clear();
    store.eval.mockClear();
    store.get.mockClear();
    store.set.mockClear();
    store.setex.mockClear();
    store.del.mockClear();
    store.pipeline.mockClear();
    saveUserProfileMock.mockClear();
    atomicRateLimitIncrMock.mockReset();
    atomicRateLimitIncrMock.mockImplementation((key) => {
      const current = Number(mockData.get(key) || 0) + 1;
      mockData.set(key, String(current));
      return Promise.resolve({ count: current });
    });
    store._lastPipeline = null;
  },
};

vi.mock("../netlify/functions/_shared/store-upstash.mjs", () => ({
  store,
  saveUserProfile: saveUserProfileMock,
  atomicRateLimitIncr: atomicRateLimitIncrMock,
}));

const keyTotal = (u) => `${process.env.XP_KEY_NS}:total:${u}`;
const keyMigration = (anonId, userId) => {
  const hash = crypto.createHash("sha256").update(`${anonId}|${userId}`).digest("hex");
  return `${process.env.XP_KEY_NS}:migration:${hash}`;
};
const keyUserMigration = (userId) => {
  const hash = crypto.createHash("sha256").update(userId).digest("hex");
  return `${process.env.XP_KEY_NS}:migration:user:${hash}`;
};

async function loadAwardXp() {
  const mod = await import("../netlify/functions/award-xp.mjs");
  return { handler: mod.handler };
}

describe("anon to user migration", () => {
  beforeEach(() => {
    vi.resetModules();
    store._reset();
    process.env.SUPABASE_JWT_SECRET = "test_supabase_jwt_secret_12345678901234567890";
    process.env.XP_KEY_NS = "test:xp:v2";
    process.env.XP_DEBUG = "1";
    process.env.XP_REQUIRE_SERVER_SESSION = "0";
    process.env.XP_DAILY_SECRET = "test-secret-for-daily-32chars-long";
    process.env.XP_ANON_CONVERSION_MAX_XP = "100000";
  });

  it("M1: migrates anon totals exactly once", async () => {
    const anonId = "anon-111";
    const userId = "user-123";
    const token = createSupabaseJwt({ sub: userId, secret: process.env.SUPABASE_JWT_SECRET });
    const { handler } = await loadAwardXp();

    mockData.set(keyTotal(anonId), "100");
    mockData.set(keyTotal(userId), "0");

    const first = await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anonId, sessionId: "sess-1", delta: 0 }),
    });

    const body = parseJsonBody(first);
    expect(first.statusCode).toBe(200);
    expect(body.totalLifetime).toBeGreaterThanOrEqual(100);
    expect(store.pipeline).not.toHaveBeenCalled();
    expect(mockData.get(keyTotal(userId))).toBe("100");
    expect(mockData.get(keyTotal(anonId))).toBeUndefined();
    expect(mockData.get(keyMigration(anonId, userId))).toBe("100");
    expect(mockData.get(keyUserMigration(userId))).toBe("100");

    const again = await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anonId, sessionId: "sess-1", delta: 0 }),
    });

    const againBody = parseJsonBody(again);
    expect(againBody.totalLifetime).toBeGreaterThanOrEqual(100);
    expect(store.pipeline).not.toHaveBeenCalled();
    expect(mockData.get(keyTotal(userId))).toBe("100");
    expect(saveUserProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId, totalXp: expect.any(Number) })
    );
  });

  it("M2: skips migration when anon bucket empty", async () => {
    const anonId = "anon-empty";
    const userId = "user-123";
    const token = createSupabaseJwt({ sub: userId, secret: process.env.SUPABASE_JWT_SECRET });
    const { handler } = await loadAwardXp();

    const response = await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anonId, sessionId: "sess-1", delta: 0 }),
    });

    const body = parseJsonBody(response);
    expect(response.statusCode).toBe(200);
    expect(body.totalLifetime).toBeGreaterThanOrEqual(0);
    expect(store.pipeline).not.toHaveBeenCalled();
    expect(mockData.get(keyMigration(anonId, userId))).toBe("0");
  });

  it("M3: merges anon XP into existing user total", async () => {
    const anonId = "anon-merge";
    const userId = "user-merge";
    const token = createSupabaseJwt({ sub: userId, secret: process.env.SUPABASE_JWT_SECRET });
    const { handler } = await loadAwardXp();

    mockData.set(keyTotal(anonId), "50");
    mockData.set(keyTotal(userId), "200");

    const response = await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anonId, sessionId: "sess-1", delta: 0 }),
    });

    const body = parseJsonBody(response);
    expect(response.statusCode).toBe(200);
    expect(body.totalLifetime).toBeGreaterThanOrEqual(250);
    expect(store.pipeline).not.toHaveBeenCalled();
    expect(mockData.get(keyTotal(anonId))).toBeUndefined();
    expect(mockData.get(keyTotal(userId))).toBe("250");
  });

  it("M4: caps converted anon XP", async () => {
    const anonId = "anon-cap";
    const userId = "user-cap";
    const token = createSupabaseJwt({ sub: userId, secret: process.env.SUPABASE_JWT_SECRET });
    process.env.XP_ANON_CONVERSION_MAX_XP = "75";
    const { handler } = await loadAwardXp();

    mockData.set(keyTotal(anonId), "200");
    mockData.set(keyTotal(userId), "10");

    const response = await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anonId, sessionId: "sess-1", delta: 0 }),
    });

    const body = parseJsonBody(response);
    expect(response.statusCode).toBe(200);
    expect(body.debug.anonMigration).toMatchObject({ converted: 75, anonTotal: 200, cap: 75 });
    expect(mockData.get(keyTotal(userId))).toBe("85");
    expect(mockData.get(keyMigration(anonId, userId))).toBe("75");
    expect(mockData.get(keyUserMigration(userId))).toBe("75");
  });

  it("M5: blocks a second anon conversion for the same account", async () => {
    const userId = "user-single-conversion";
    const token = createSupabaseJwt({ sub: userId, secret: process.env.SUPABASE_JWT_SECRET });
    const { handler } = await loadAwardXp();

    mockData.set(keyTotal("anon-a"), "100");
    mockData.set(keyTotal("anon-b"), "80");
    mockData.set(keyTotal(userId), "0");

    const first = await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anonId: "anon-a", sessionId: "sess-1", delta: 0 }),
    });
    expect(first.statusCode).toBe(200);
    expect(mockData.get(keyTotal(userId))).toBe("100");
    expect(mockData.get(keyUserMigration(userId))).toBe("100");

    const second = await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anonId: "anon-b", sessionId: "sess-2", delta: 0 }),
    });

    const body = parseJsonBody(second);
    expect(second.statusCode).toBe(200);
    expect(body.debug.anonMigration).toMatchObject({ converted: 0, alreadyConverted: true });
    expect(mockData.get(keyTotal(userId))).toBe("100");
    expect(mockData.get(keyTotal("anon-b"))).toBe("80");
    expect(mockData.get(keyMigration("anon-b", userId))).toBeUndefined();
  });

  it("M6: subsequent awards use migrated user bucket", async () => {
    const anonId = "anon-followup";
    const userId = "user-followup";
    const token = createSupabaseJwt({ sub: userId, secret: process.env.SUPABASE_JWT_SECRET });
    const { handler } = await loadAwardXp();

    mockData.set(keyTotal(anonId), "100");
    mockData.set(keyTotal(userId), "0");

    await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anonId, sessionId: "sess-1", delta: 0 }),
    });

    const second = await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anonId, sessionId: "sess-1", delta: 25 }),
    });

    const body = parseJsonBody(second);
    expect(body.totalLifetime).toBe(125);
    const awardCall = store.eval.mock.calls.find((call) => call[1]?.length === 5 && Number(call[2]?.[1]) === 25);
    const keys = awardCall[1];
    expect(keys[3]).toBe(`${process.env.XP_KEY_NS}:total:${userId}`);
  });
});
