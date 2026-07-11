import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSupabaseJwt, mockStoreEvalReturn, parseJsonBody } from "./helpers/xp-test-helpers.mjs";

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

const saveUserProfileMock = vi.fn(async () => {});
const atomicRateLimitIncrMock = vi.fn((key) => {
  const current = Number(mockData.get(key) || 0) + 1;
  mockData.set(key, String(current));
  return Promise.resolve({ count: current });
});

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
  incrBy: vi.fn((key, value) => {
    const current = Number(mockData.get(key) || 0);
    const next = current + Number(value);
    mockData.set(key, String(next));
    return Promise.resolve(next);
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
    store.incrBy.mockClear();
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

async function loadAwardXp() {
  const mod = await import("../netlify/functions/award-xp.mjs");
  return { handler: mod.handler };
}

async function loadCalculateXp() {
  const mod = await import("../netlify/functions/calculate-xp.mjs");
  return { handler: mod.handler };
}

async function loadStartSession() {
  const mod = await import("../netlify/functions/start-session.mjs");
  return { handler: mod.handler };
}

describe("JWT verification and identity selection", () => {
  beforeEach(() => {
    vi.resetModules();
    store._reset();
    process.env.SUPABASE_JWT_SECRET = "test_supabase_jwt_secret_12345678901234567890";
    process.env.SUPABASE_URL = "https://stage-test.supabase.co";
    process.env.SUPABASE_ANON_KEY = "test-anon-key";
    process.env.XP_KEY_NS = "test:xp:v2";
    process.env.XP_DEBUG = "1";
    process.env.XP_REQUIRE_SERVER_SESSION = "0";
    process.env.XP_DAILY_SECRET = "test-secret-for-daily-32chars-long";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("A1: No Authorization header uses anonymous identity", async () => {
    const { handler } = await loadAwardXp();
    await mockStoreEvalReturn([10, 10, 10, 10, Date.now(), 0]);

    const response = await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ anonId: "anon-123", sessionId: "sess-1", delta: 10 }),
    });

    const body = parseJsonBody(response);
    expect(response.statusCode).toBe(200);
    expect(body.debug.authProvided).toBe(false);
    expect(body.debug.authValid).toBe(false);
    expect(body.debug.authReason).toBe("missing_token");
    const keys = store.eval.mock.calls[0][1];
    expect(keys[3]).toBe(`${process.env.XP_KEY_NS}:total:anon-123`);
  });

  it("A2: Invalid JWT is rejected instead of falling back to anonymous identity", async () => {
    const { handler } = await loadAwardXp();
    await mockStoreEvalReturn([5, 5, 5, 5, Date.now(), 0]);

    const response = await handler({
      httpMethod: "POST",
      headers: {
        Authorization: "Bearer invalid.token.string",
      },
      body: JSON.stringify({ anonId: "anon-123", sessionId: "sess-1", delta: 10 }),
    });

    const body = parseJsonBody(response);
    expect(response.statusCode).toBe(401);
    expect(body.error).toBe("unauthorized");
    expect(store.eval).not.toHaveBeenCalled();
  });

  it("A3: Valid JWT overrides client-provided identities", async () => {
    const { handler } = await loadAwardXp();
    await mockStoreEvalReturn([20, 20, 20, 20, Date.now(), 0]);
    const token = createSupabaseJwt({
      sub: "user-777",
      secret: process.env.SUPABASE_JWT_SECRET,
    });

    const response = await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        anonId: "anon-123",
        userId: "evil-client-user",
        sessionId: "sess-1",
        delta: 20,
      }),
    });

    const body = parseJsonBody(response);
    expect(response.statusCode).toBe(200);
    expect(body.totalLifetime).toBe(20);
    expect(body.debug.authValid).toBe(true);
    expect(body.debug.authReason).toBe("ok");
    const awardCall = store.eval.mock.calls.find((call) => call[1]?.length === 5);
    const keys = awardCall[1];
    expect(keys[3]).toBe(`${process.env.XP_KEY_NS}:total:user-777`);
    expect(saveUserProfileMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-777", totalXp: 20 }));
  });

  it("A4: calculate-xp uses JWT sub for identity", async () => {
    const { handler } = await loadCalculateXp();
    await mockStoreEvalReturn([15, 15, 15, 15, Date.now(), 0]);
    const token = createSupabaseJwt({ sub: "user-abc", secret: process.env.SUPABASE_JWT_SECRET });
    const now = Date.now();

    const response = await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        userId: "anon-body-id",
        sessionId: "sess-xyz",
        gameId: "tetris",
        windowStart: now - 10000,
        windowEnd: now,
        inputEvents: 10,
        visibilitySeconds: 10,
        scoreDelta: 100,
      }),
    });

    const body = parseJsonBody(response);
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    const migrationCall = store.eval.mock.calls.find((call) => call[2]?.length === 1);
    const awardCall = store.eval.mock.calls.find((call) => call[2]?.length === 6);
    expect(migrationCall[1][1]).toBe(`${process.env.XP_KEY_NS}:total:user-abc`);
    expect(awardCall[1][3]).toBe(`${process.env.XP_KEY_NS}:total:user-abc`);
  });

  it("A4b: calculate-xp resolves Supabase ES256 tokens through shared remote auth", async () => {
    const userId = "user-es256";
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const token = `${encode({ alg: "ES256", typ: "JWT" })}.${encode({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      expect(url).toBe("https://stage-test.supabase.co/auth/v1/user");
      return { ok: true, json: async () => ({ id: userId }) };
    }));
    const { handler } = await loadCalculateXp();
    await mockStoreEvalReturn([12, 12, 12, 12, Date.now(), 0]);
    const now = Date.now();

    const response = await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        userId: "anon-es256",
        sessionId: "sess-es256",
        gameId: "tetris",
        windowStart: now - 10000,
        windowEnd: now,
        inputEvents: 10,
        visibilitySeconds: 10,
        scoreDelta: 100,
      }),
    });

    expect(response.statusCode).toBe(200);
    const awardCall = store.eval.mock.calls.find((call) => call[2]?.length === 6);
    expect(awardCall[1][3]).toBe(`${process.env.XP_KEY_NS}:total:${userId}`);
    expect(saveUserProfileMock).toHaveBeenCalledWith(expect.objectContaining({ userId, totalXp: 12 }));
  });

  it("A5: calculate-xp rejects an invalid JWT instead of awarding anon XP", async () => {
    const { handler } = await loadCalculateXp();
    await mockStoreEvalReturn([8, 8, 8, 8, Date.now(), 0]);
    const now = Date.now();

    const response = await handler({
      httpMethod: "POST",
      headers: { Authorization: "Bearer bad.token" },
      body: JSON.stringify({
        userId: "anon-xyz",
        sessionId: "sess-xyz",
        gameId: "tetris",
        windowStart: now - 10000,
        windowEnd: now,
        inputEvents: 5,
        visibilitySeconds: 5,
        scoreDelta: 50,
      }),
    });

    const body = parseJsonBody(response);
    expect(response.statusCode).toBe(401);
    expect(body.error).toBe("unauthorized");
    expect(store.eval).not.toHaveBeenCalled();
  });

  it("A6: start-session prefers JWT identity and rejects missing identity", async () => {
    const { handler } = await loadStartSession();
    const token = createSupabaseJwt({ sub: "user-start-1", secret: process.env.SUPABASE_JWT_SECRET });

    const response = await handler({
      httpMethod: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "user-agent": "Vitest/1.0",
      },
      body: JSON.stringify({ anonId: "anon-client" }),
      queryStringParameters: {},
    });

    const body = parseJsonBody(response);
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.sessionId).toBeTruthy();
    expect(body.sessionToken).toBeTruthy();
    const stored = store._mockData.get(`${process.env.XP_KEY_NS}:server-session:${body.sessionId}`);
    const parsed = JSON.parse(stored);
    expect(parsed.userId).toBe("user-start-1");

    const missingIdentity = await handler({
      httpMethod: "POST",
      headers: { "user-agent": "Vitest/1.0" },
      body: JSON.stringify({}),
      queryStringParameters: {},
    });

    const missingBody = parseJsonBody(missingIdentity);
    expect(missingIdentity.statusCode).toBe(400);
    expect(missingBody.error).toBe("missing_identity");
  });
});
