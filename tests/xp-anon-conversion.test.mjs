import { describe, it, expect, beforeEach, vi } from "vitest";

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

async function loadModule() {
  const mod = await import("../netlify/functions/award-xp.mjs");
  return {
    calculateAllowedAnonConversion: mod.calculateAllowedAnonConversion,
    attemptAnonToUserConversion: mod.attemptAnonToUserConversion,
  };
}

describe("calculateAllowedAnonConversion", () => {
  it("returns eligible XP under daily cap", async () => {
    const { calculateAllowedAnonConversion } = await loadModule();
    expect(calculateAllowedAnonConversion(1000, 1)).toBe(1000);
  });

  it("caps by daily multiplier", async () => {
    const { calculateAllowedAnonConversion } = await loadModule();
    expect(calculateAllowedAnonConversion(10000, 1)).toBe(3000);
  });

  it("caps by global max", async () => {
    const { calculateAllowedAnonConversion } = await loadModule();
    expect(calculateAllowedAnonConversion(200000, 100)).toBe(100000);
  });

  it("returns zero when xp or days missing", async () => {
    const { calculateAllowedAnonConversion } = await loadModule();
    expect(calculateAllowedAnonConversion(0, 5)).toBe(0);
    expect(calculateAllowedAnonConversion(1000, 0)).toBe(0);
  });
});

describe("attemptAnonToUserConversion", () => {
  beforeEach(() => {
    vi.resetModules();
    store._reset();
    process.env.XP_KEY_NS = "test:xp:v2";
    process.env.XP_DAILY_CAP = "3000";
    process.env.XP_ANON_CONVERSION_ENABLED = "1";
    process.env.XP_ANON_CONVERSION_MAX_CAP = "100000";
  });

  it("converts anon profile when verified", async () => {
    const { attemptAnonToUserConversion } = await loadModule();
    mockAnonProfiles.set("anon-1", {
      anonId: "anon-1",
      totalAnonXp: 6000,
      anonActiveDays: 2,
      convertedToUserId: null,
      lastActivityTs: Date.now(),
      createdAt: new Date().toISOString(),
    });
    const result = await attemptAnonToUserConversion({
      userId: "user-1",
      anonId: "anon-1",
      authContext: { emailVerified: true },
      storeClient: store,
    });
    expect(result.converted).toBe(true);
    expect(result.amount).toBe(6000);
    const user = mockUserProfiles.get("user-1");
    expect(user.hasConvertedAnonXp).toBe(true);
    const anon = mockAnonProfiles.get("anon-1");
    expect(anon.totalAnonXp).toBe(0);
    expect(anon.anonActiveDays).toBe(0);
    expect(anon.convertedToUserId).toBe("user-1");
  });

  it("skips when email unverified", async () => {
    const { attemptAnonToUserConversion } = await loadModule();
    mockAnonProfiles.set("anon-2", {
      anonId: "anon-2",
      totalAnonXp: 4000,
      anonActiveDays: 1,
      convertedToUserId: null,
    });
    const result = await attemptAnonToUserConversion({
      userId: "user-2",
      anonId: "anon-2",
      authContext: { emailVerified: false },
      storeClient: store,
    });
    expect(result.converted).toBe(false);
    expect(store.pipeline).not.toHaveBeenCalled();
  });

  it("skips if already converted", async () => {
    const { attemptAnonToUserConversion } = await loadModule();
    mockUserProfiles.set("user-3", {
      userId: "user-3",
      totalXp: 100,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      hasConvertedAnonXp: true,
    });
    const result = await attemptAnonToUserConversion({
      userId: "user-3",
      anonId: "anon-3",
      authContext: { emailVerified: true },
      storeClient: store,
    });
    expect(result.converted).toBe(false);
  });

  it("applies caps based on active days", async () => {
    const { attemptAnonToUserConversion } = await loadModule();
    mockAnonProfiles.set("anon-4", {
      anonId: "anon-4",
      totalAnonXp: 10000,
      anonActiveDays: 1,
      convertedToUserId: null,
    });
    const result = await attemptAnonToUserConversion({
      userId: "user-4",
      anonId: "anon-4",
      authContext: { emailVerified: true },
      storeClient: store,
    });
    expect(result.converted).toBe(true);
    expect(result.amount).toBe(3000);
  });
});
