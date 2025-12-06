import crypto from "node:crypto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSupabaseJwt, parseJsonBody } from "./helpers/xp-test-helpers.mjs";

const mockData = new Map();

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
  eval: vi.fn(() => Promise.resolve([0, 0, 0, 0, Date.now(), 0])),
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
    store._lastPipeline = null;
  },
};

vi.mock("../netlify/functions/_shared/store-upstash.mjs", () => ({ store }));

const keyTotal = (u) => `${process.env.XP_KEY_NS}:total:${u}`;
const keyMigration = (anonId, userId) => {
  const hash = crypto.createHash("sha256").update(`${anonId}|${userId}`).digest("hex");
  return `${process.env.XP_KEY_NS}:migration:${hash}`;
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
    process.env.XP_DAILY_SECRET = "test-secret-for-daily-32chars!";
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
    const ops = store._lastPipeline?.operations || [];
    expect(ops).toEqual([
      { op: "incrby", key: keyTotal(userId), value: 100 },
      { op: "del", key: keyTotal(anonId) },
      { op: "set", key: keyMigration(anonId, userId), value: "100" },
    ]);

    const again = await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anonId, sessionId: "sess-1", delta: 0 }),
    });

    const againBody = parseJsonBody(again);
    expect(againBody.totalLifetime).toBeGreaterThanOrEqual(100);
    expect(store.pipeline).toHaveBeenCalledTimes(1);
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
    const ops = store._lastPipeline?.operations || [];
    expect(ops[0]).toEqual({ op: "incrby", key: keyTotal(userId), value: 50 });
    expect(mockData.get(keyTotal(anonId))).toBeUndefined();
    expect(mockData.get(keyTotal(userId))).toBe("250");
  });

  it("M4: subsequent awards use migrated user bucket", async () => {
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

    store.eval.mockResolvedValue([25, 25, 25, 125, Date.now(), 0]);
    const second = await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anonId, sessionId: "sess-1", delta: 25 }),
    });

    const body = parseJsonBody(second);
    expect(body.totalLifetime).toBe(125);
    const keys = store.eval.mock.calls[0][1];
    expect(keys[3]).toBe(`${process.env.XP_KEY_NS}:total:${userId}`);
  });
});
