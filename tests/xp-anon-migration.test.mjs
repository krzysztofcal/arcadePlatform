import { describe, it, expect, beforeEach, vi } from "vitest";

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
    decrby: vi.fn((key, value) => {
      operations.push({ op: "decrby", key, value });
      const current = Number(mockData.get(key) || 0);
      mockData.set(key, String(current - Number(value)));
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
  del: vi.fn((key) => {
    mockData.delete(key);
    return Promise.resolve(1);
  }),
  eval: vi.fn(() => Promise.resolve(1)),
  pipeline: vi.fn(() => {
    const pipeline = pipelineFactory();
    store._lastPipeline = pipeline;
    return pipeline;
  }),
  _reset: () => {
    mockData.clear();
    store.get.mockClear();
    store.set.mockClear();
    store.del.mockClear();
    store.eval.mockClear();
    store.pipeline.mockClear();
    store._lastPipeline = null;
  },
};

vi.mock("../netlify/functions/_shared/store-upstash.mjs", () => ({
  store,
  saveUserProfile: vi.fn(),
  getUserProfile: vi.fn(),
  getAnonProfile: vi.fn(),
  saveAnonProfile: vi.fn(),
  initAnonProfile: vi.fn(),
}));

const keyTotal = (u) => `${process.env.XP_KEY_NS}:total:${u}`;
const keyDaily = (u, day) => `${process.env.XP_KEY_NS}:daily:${u}:${day}`;

async function loadModule() {
  const mod = await import("../netlify/functions/award-xp.mjs");
  return { migrateAnonToAccount: mod.migrateAnonToAccount, getTotalsForIdentity: mod.getTotalsForIdentity };
}

describe("migrateAnonToAccount", () => {
  beforeEach(() => {
    vi.resetModules();
    store._reset();
    process.env.XP_KEY_NS = "test:xp:v2";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-05T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves full anon lifetime to account when present", async () => {
    const { migrateAnonToAccount, getTotalsForIdentity } = await loadModule();
    const anonId = "anon-migrate";
    const userId = "user-migrate";
    mockData.set(keyTotal(anonId), "80");
    mockData.set(keyTotal(userId), "0");
    mockData.set(keyDaily(anonId, "2024-06-05"), "80");

    const result = await migrateAnonToAccount({ storeClient: store, anonId, accountId: userId, now: Date.now(), allowedAmount: 80 });

    expect(result).toEqual({
      migrated: 80,
      anonBefore: 80,
      accountBefore: 0,
      accountAfter: 80,
      reason: "migrated",
    });
    const anonTotals = await getTotalsForIdentity({ userId: anonId, now: Date.now(), storeClient: store });
    const userTotals = await getTotalsForIdentity({ userId: userId, now: Date.now(), storeClient: store });
    expect(anonTotals?.lifetime).toBe(0);
    expect(userTotals?.lifetime).toBe(80);
    const ops = store._lastPipeline?.operations || [];
    expect(ops).toEqual([
      { op: "incrby", key: keyTotal(userId), value: 80 },
      { op: "del", key: keyTotal(anonId) },
      { op: "del", key: keyDaily(anonId, "2024-06-05") },
      { op: "set", key: expect.stringContaining(anonId), value: "80" },
    ]);
  });

  it("uses allowed amount and leaves remaining anon lifetime when capped", async () => {
    const { migrateAnonToAccount, getTotalsForIdentity } = await loadModule();
    const anonId = "anon-partial";
    const userId = "user-partial";
    mockData.set(keyTotal(anonId), "8000");
    mockData.set(keyTotal(userId), "0");

    const result = await migrateAnonToAccount({
      storeClient: store,
      anonId,
      accountId: userId,
      allowedAmount: 3000,
      now: Date.now(),
    });

    expect(result).toEqual({
      migrated: 3000,
      anonBefore: 8000,
      accountBefore: 0,
      accountAfter: 3000,
      reason: "migrated",
    });

    const anonTotals = await getTotalsForIdentity({ userId: anonId, now: Date.now(), storeClient: store });
    const userTotals = await getTotalsForIdentity({ userId: userId, now: Date.now(), storeClient: store });
    expect(anonTotals?.lifetime).toBe(5000);
    expect(userTotals?.lifetime).toBe(3000);

    const ops = store._lastPipeline?.operations || [];
    expect(ops).toEqual([
      { op: "incrby", key: keyTotal(userId), value: 3000 },
      { op: "decrby", key: keyTotal(anonId), value: 3000 },
      { op: "set", key: expect.stringContaining(anonId), value: "3000" },
    ]);
  });

  it("skips migration when account already has XP", async () => {
    const { migrateAnonToAccount } = await loadModule();
    const anonId = "anon-plus";
    const userId = "user-plus";
    mockData.set(keyTotal(anonId), "50");
    mockData.set(keyTotal(userId), "100");

    const result = await migrateAnonToAccount({ storeClient: store, anonId, accountId: userId, now: Date.now() });

    expect(result.migrated).toBe(0);
    expect(result.accountAfter).toBe(100);
    expect(result.reason).toBe("account_has_xp");
    expect(Number(mockData.get(keyTotal(userId)))).toBe(100);
  });

  it("is idempotent when called twice", async () => {
    const { migrateAnonToAccount } = await loadModule();
    const anonId = "anon-idem";
    const userId = "user-idem";
    mockData.set(keyTotal(anonId), "80");
    mockData.set(keyTotal(userId), "0");

    const first = await migrateAnonToAccount({ storeClient: store, anonId, accountId: userId, now: Date.now() });
    expect(first.migrated).toBe(80);
    mockData.set(keyTotal(anonId), "0");

    const second = await migrateAnonToAccount({ storeClient: store, anonId, accountId: userId, now: Date.now() });
    expect(second.migrated).toBe(0);
    expect(Number(mockData.get(keyTotal(userId)))).toBe(80);
  });

  it("no-ops when anon has zero XP", async () => {
    const { migrateAnonToAccount } = await loadModule();
    const anonId = "anon-zero";
    const userId = "user-zero";
    mockData.set(keyTotal(anonId), "0");
    mockData.set(keyTotal(userId), "30");

    const result = await migrateAnonToAccount({ storeClient: store, anonId, accountId: userId, now: Date.now() });

    expect(result.migrated).toBe(0);
    expect(result.accountAfter).toBe(30);
    expect(Number(mockData.get(keyTotal(userId)))).toBe(30);
  });
});
