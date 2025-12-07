import crypto from "node:crypto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSupabaseJwt, parseJsonBody } from "./helpers/xp-test-helpers.mjs";

const mockData = new Map();
const mockUserProfiles = new Map();
const mockAnonProfiles = new Map();

const saveUserProfileMock = vi.fn(async ({ userId, totalXp, hasConvertedAnonXp }) => {
  if (!userId) return null;
  const profile = {
    userId,
    totalXp: Number(totalXp) || 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasConvertedAnonXp: hasConvertedAnonXp === true,
  };
  mockUserProfiles.set(userId, profile);
  return profile;
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
    store.pipeline.mockClear();
    saveUserProfileMock.mockClear();
    store._lastPipeline = null;
  },
};

vi.mock("../netlify/functions/_shared/store-upstash.mjs", () => ({
  store,
  saveUserProfile: saveUserProfileMock,
  getUserProfile: vi.fn(async (userId) => mockUserProfiles.get(userId) || null),
  getAnonProfile: vi.fn(async (anonId) => {
    const profile = mockAnonProfiles.get(anonId);
    if (!profile) return null;
    const totalAnonXp = Number(profile.totalAnonXp) || 0;
    let anonActiveDays = Number(profile.anonActiveDays) || 0;
    if (totalAnonXp > 0 && anonActiveDays <= 0) {
      anonActiveDays = 1;
    }
    return { ...profile, totalAnonXp, anonActiveDays };
  }),
  saveAnonProfile: vi.fn(async (profile) => {
    if (!profile || !profile.anonId) return null;
    mockAnonProfiles.set(profile.anonId, profile);
    return profile;
  }),
  initAnonProfile: vi.fn((anonId, now, dayKey) => ({
    anonId,
    totalAnonXp: 0,
    anonActiveDays: 1,
    lastActivityTs: now,
    createdAt: new Date(now).toISOString(),
    convertedToUserId: null,
    lastActiveDayKey: dayKey,
  })),
}));

const keyTotal = (u) => `${process.env.XP_KEY_NS}:total:${u}`;
const keyMigration = (anonId, userId) => {
  const hash = crypto.createHash("sha256").update(`${anonId}|${userId}`).digest("hex");
  return `${process.env.XP_KEY_NS}:migration:${hash}`;
};
const keyDaily = (u, day) => `${process.env.XP_KEY_NS}:daily:${u}:${day}`;

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
    process.env.XP_ANON_CONVERSION_ENABLED = "1";
    process.env.XP_ANON_CONVERSION_MAX_CAP = "100000";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-05T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("M1: converts anon profile once with caps", async () => {
    const anonId = "anon-111";
    const userId = "user-123";
    const token = createSupabaseJwt({
      sub: userId,
      secret: process.env.SUPABASE_JWT_SECRET,
      payload: { email_confirmed_at: new Date().toISOString() },
    });
    const { handler } = await loadAwardXp();

    mockAnonProfiles.set(anonId, {
      anonId,
      totalAnonXp: 5000,
      anonActiveDays: 2,
      lastActivityTs: Date.now(),
      createdAt: new Date().toISOString(),
      convertedToUserId: null,
      lastActiveDayKey: "2024-05-01",
    });
    mockData.set(keyTotal(anonId), "5000");
    mockData.set(keyTotal(userId), "0");
    mockData.set(keyDaily(anonId, "2024-06-05"), "5000");

    const first = await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anonId, sessionId: "sess-1", delta: 0 }),
    });

    const body = parseJsonBody(first);
    expect(first.statusCode).toBe(200);
    expect(body.conversion.converted).toBe(true);
    expect(body.conversion.amount).toBe(5000);
    const ops = store._lastPipeline?.operations || [];
    expect(ops).toEqual([
      { op: "incrby", key: keyTotal(userId), value: 5000 },
      { op: "del", key: keyTotal(anonId) },
      { op: "del", key: keyDaily(anonId, "2024-06-05") },
      { op: "set", key: keyMigration(anonId, userId), value: "5000" },
    ]);
    const anonProfile = mockAnonProfiles.get(anonId);
    expect(anonProfile.totalAnonXp).toBe(0);
    expect(anonProfile.anonActiveDays).toBe(0);
    expect(anonProfile.convertedToUserId).toBe(userId);
    const savedUser = mockUserProfiles.get(userId);
    expect(savedUser.hasConvertedAnonXp).toBe(true);

    const again = await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anonId, sessionId: "sess-1", delta: 0 }),
    });
    const againBody = parseJsonBody(again);
    expect(againBody.conversion.converted).toBe(false);
    expect(againBody.conversion.amount).toBe(0);
    expect(store.pipeline).toHaveBeenCalledTimes(1);
  });

  it("M1b: converts anon profile with XP but zero active days", async () => {
    const anonId = "anon-day1";
    const userId = "user-day1";
    const token = createSupabaseJwt({
      sub: userId,
      secret: process.env.SUPABASE_JWT_SECRET,
      payload: { email_confirmed_at: new Date().toISOString() },
    });
    const { handler } = await loadAwardXp();

    mockAnonProfiles.set(anonId, {
      anonId,
      totalAnonXp: 50,
      anonActiveDays: 0,
      lastActivityTs: Date.now(),
      createdAt: new Date().toISOString(),
      convertedToUserId: null,
      lastActiveDayKey: "2024-05-01",
    });
    mockData.set(keyTotal(anonId), "50");
    mockData.set(keyTotal(userId), "0");
    mockData.set(keyDaily(anonId, "2024-06-05"), "50");

    const response = await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anonId, sessionId: "sess-1", delta: 0 }),
    });

    const body = parseJsonBody(response);
    expect(body.conversion.converted).toBe(true);
    expect(body.conversion.amount).toBe(50);
    const ops = store._lastPipeline?.operations || [];
    expect(ops[0]).toEqual({ op: "incrby", key: keyTotal(userId), value: 50 });
    const anonProfile = mockAnonProfiles.get(anonId);
    expect(anonProfile.totalAnonXp).toBe(0);
    expect(anonProfile.convertedToUserId).toBe(userId);
    const userProfile = mockUserProfiles.get(userId);
    expect(userProfile.hasConvertedAnonXp).toBe(true);
  });

  it("M2: skips conversion when email not verified", async () => {
    const anonId = "anon-unverified";
    const userId = "user-456";
    const token = createSupabaseJwt({ sub: userId, secret: process.env.SUPABASE_JWT_SECRET });
    const { handler } = await loadAwardXp();
    mockAnonProfiles.set(anonId, {
      anonId,
      totalAnonXp: 4000,
      anonActiveDays: 1,
      lastActivityTs: Date.now(),
      createdAt: new Date().toISOString(),
      convertedToUserId: null,
    });

    const response = await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anonId, sessionId: "sess-1", delta: 0 }),
    });

    const body = parseJsonBody(response);
    expect(body.conversion.converted).toBe(false);
    expect(body.conversion.amount).toBe(0);
    expect(store.pipeline).not.toHaveBeenCalled();
    expect(mockAnonProfiles.get(anonId).convertedToUserId).toBeNull();
  });

  it("M3: enforces daily cap multiplier", async () => {
    const anonId = "anon-cap";
    const userId = "user-cap";
    const token = createSupabaseJwt({
      sub: userId,
      secret: process.env.SUPABASE_JWT_SECRET,
      payload: { email_confirmed_at: new Date().toISOString() },
    });
    const { handler } = await loadAwardXp();
    process.env.XP_DAILY_CAP = "3000";
    mockAnonProfiles.set(anonId, {
      anonId,
      totalAnonXp: 10000,
      anonActiveDays: 1,
      lastActivityTs: Date.now(),
      createdAt: new Date().toISOString(),
      convertedToUserId: null,
    });

    const response = await handler({
      httpMethod: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anonId, sessionId: "sess-1", delta: 0 }),
    });

    const body = parseJsonBody(response);
    expect(body.conversion.converted).toBe(true);
    expect(body.conversion.amount).toBe(3000);
    const ops = store._lastPipeline?.operations || [];
    expect(ops[0]).toEqual({ op: "incrby", key: keyTotal(userId), value: 3000 });
  });
});
