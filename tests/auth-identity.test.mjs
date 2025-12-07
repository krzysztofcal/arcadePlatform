import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSupabaseJwt, mockStoreEvalReturn, parseJsonBody } from "./helpers/xp-test-helpers.mjs";

const mockData = new Map();
const mockUserProfiles = new Map();
const mockAnonProfiles = new Map();

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

const saveUserProfileMock = vi.fn(async ({ userId, totalXp }) => {
  if (!userId) return null;
  const profile = {
    userId,
    totalXp: Number(totalXp) || 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasConvertedAnonXp: false,
  };
  mockUserProfiles.set(userId, profile);
  return profile;
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
    mockUserProfiles.clear();
    mockAnonProfiles.clear();
    store.eval.mockClear();
    store.get.mockClear();
    store.set.mockClear();
    store.setex.mockClear();
    store.del.mockClear();
    store.incrBy.mockClear();
    store.pipeline.mockClear();
    saveUserProfileMock.mockClear();
    store._lastPipeline = null;
  },
};

vi.mock("../netlify/functions/_shared/store-upstash.mjs", () => ({
  store,
  saveUserProfile: saveUserProfileMock,
  getUserProfile: vi.fn(async (userId) => mockUserProfiles.get(userId) || null),
  getAnonProfile: vi.fn(async (anonId) => mockAnonProfiles.get(anonId) || null),
  saveAnonProfile: vi.fn(async (profile) => {
    if (!profile || !profile.anonId) return null;
    mockAnonProfiles.set(profile.anonId, profile);
    return profile;
  }),
  initAnonProfile: vi.fn((anonId, now, dayKey) => ({
    anonId,
    totalAnonXp: 0,
    anonActiveDays: 0,
    lastActivityTs: now,
    createdAt: new Date(now).toISOString(),
    convertedToUserId: null,
    lastActiveDayKey: dayKey,
  })),
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
    process.env.XP_KEY_NS = "test:xp:v2";
    process.env.XP_DEBUG = "1";
    process.env.XP_REQUIRE_SERVER_SESSION = "0";
    process.env.XP_DAILY_SECRET = "test-secret-for-daily-32chars!";
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

  it("A2: Invalid JWT falls back to anonymous identity", async () => {
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
    expect(response.statusCode).toBe(200);
    expect(body.debug.authProvided).toBe(true);
    expect(body.debug.authValid).toBe(false);
    expect(["malformed_token", "invalid_signature"].includes(body.debug.authReason)).toBe(true);
    const keys = store.eval.mock.calls[0][1];
    expect(keys[3]).toBe(`${process.env.XP_KEY_NS}:total:anon-123`);
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
    const keys = store.eval.mock.calls[0][1];
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
    const keys = store.eval.mock.calls[0][1];
    expect(keys[3]).toBe(`${process.env.XP_KEY_NS}:total:user-abc`);
  });

  it("A5: calculate-xp falls back to anon when JWT invalid", async () => {
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
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    const keys = store.eval.mock.calls[0][1];
    expect(keys[3]).toBe(`${process.env.XP_KEY_NS}:total:anon-xyz`);
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
