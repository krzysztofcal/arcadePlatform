import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

let migrateAnonToAccount;
let attemptAnonToUserConversion;
let store;
let keyNs;

const usedIds = new Set();

function keyTotal(id) {
  return `${keyNs}:total:${id}`;
}

function keyDaily(id, day) {
  return `${keyNs}:daily:${id}:${day}`;
}

async function loadModules() {
  const storeModule = await import("../netlify/functions/_shared/store-upstash.mjs");
  store = storeModule.store;
  const awardModule = await import("../netlify/functions/award-xp.mjs");
  migrateAnonToAccount = awardModule.migrateAnonToAccount;
  attemptAnonToUserConversion = awardModule.attemptAnonToUserConversion;
  keyNs = process.env.XP_KEY_NS || "xp:v2";
}

async function resetAll() {
  if (!store) return;
  const deletions = [];
  usedIds.forEach((id) => {
    deletions.push(keyTotal(id), keyDaily(id, "2024-06-05"), `kcswh:xp:user:${id}`, `kcswh:xp:anon:${id}`);
  });
  await Promise.all(deletions.map((k) => store.del?.(k)));
  usedIds.clear();
}

beforeEach(async () => {
  process.env.SUPABASE_JWT_SECRET = "test_supabase_jwt_secret_12345678901234567890";
  process.env.XP_KEY_NS = "test:xp:migration";
  process.env.XP_DEBUG = "1";
  process.env.XP_REQUIRE_SERVER_SESSION = "0";
  process.env.XP_DAILY_SECRET = "test-secret-for-daily-32chars!";
  process.env.XP_ANON_CONVERSION_ENABLED = "1";
  process.env.XP_ANON_CONVERSION_MAX_CAP = "100000";
  process.env.XP_DAILY_CAP = "3000";
  await loadModules();
  store.eval = async () => 1;
});

afterEach(async () => {
  await resetAll();
});

describe("anon to user migration", () => {
  it("converts anon profile once with caps", async () => {
    const anonId = "anon-111";
    const userId = "user-123";
    usedIds.add(anonId);
    usedIds.add(userId);

    await store.set(keyTotal(anonId), "5000");
    await store.set(keyTotal(userId), "0");
    await store.set(keyDaily(anonId, "2024-06-05"), "5000");
    await store.set(`kcswh:xp:anon:${anonId}`, JSON.stringify({
      anonId,
      totalAnonXp: 5000,
      anonActiveDays: 2,
      lastActivityTs: Date.now(),
      createdAt: new Date().toISOString(),
      convertedToUserId: null,
      lastActiveDayKey: "2024-05-01",
    }));

    const first = await attemptAnonToUserConversion({
      userId,
      anonId,
      authContext: { emailVerified: true },
      storeClient: store,
    });

    assert.strictEqual(first.converted, true);
    assert.strictEqual(first.amount, 5000);

    const second = await attemptAnonToUserConversion({
      userId,
      anonId,
      authContext: { emailVerified: true },
      storeClient: store,
    });
    assert.strictEqual(second.converted, false);
    assert.strictEqual(second.amount, 0);
  });

  it("applies cap to migrated amount and leaves anon remainder", async () => {
    const anonId = "anon-cap";
    const userId = "user-cap";
    usedIds.add(anonId);
    usedIds.add(userId);

    await store.set(keyTotal(anonId), "8000");
    await store.set(keyTotal(userId), "0");
    await store.set(`kcswh:xp:anon:${anonId}`, JSON.stringify({
      anonId,
      totalAnonXp: 8000,
      anonActiveDays: 1,
      lastActivityTs: Date.now(),
      createdAt: new Date().toISOString(),
      convertedToUserId: null,
      lastActiveDayKey: "2024-05-02",
    }));

    const result = await attemptAnonToUserConversion({
      userId,
      anonId,
      authContext: { emailVerified: true },
      storeClient: store,
    });

    assert.strictEqual(result.converted, true);
    assert.strictEqual(result.amount, 3000);
    assert.strictEqual(await store.get(keyTotal(userId)), "3000");
    assert.strictEqual(await store.get(keyTotal(anonId)), "5000");
  });

  it("skips conversion when account already has XP", async () => {
    const anonId = "anon-444";
    const userId = "user-444";
    usedIds.add(anonId);
    usedIds.add(userId);
    await store.set(keyTotal(anonId), "50");
    await store.set(keyTotal(userId), "100");
    await store.set(`kcswh:xp:anon:${anonId}`, JSON.stringify({
      anonId,
      totalAnonXp: 50,
      anonActiveDays: 1,
      lastActivityTs: Date.now(),
      createdAt: new Date().toISOString(),
      convertedToUserId: null,
    }));

    const result = await attemptAnonToUserConversion({
      userId,
      anonId,
      authContext: { emailVerified: true },
      storeClient: store,
    });

    assert.strictEqual(result.converted, false);
    assert.strictEqual(result.amount, 0);
    assert.strictEqual(await store.get(keyTotal(userId)), "100");
  });

  it("uses server totals for migration", async () => {
    const anonId = "anon-server";
    const userId = "user-server";
    usedIds.add(anonId);
    usedIds.add(userId);
    await store.set(keyTotal(anonId), "80");
    await store.set(keyTotal(userId), "0");
    await store.set(`kcswh:xp:anon:${anonId}`, JSON.stringify({
      anonId,
      totalAnonXp: 10,
      anonActiveDays: 1,
      lastActivityTs: Date.now(),
      createdAt: new Date().toISOString(),
      convertedToUserId: null,
    }));

    const migrated = await migrateAnonToAccount({
      storeClient: store,
      anonId,
      accountId: userId,
      now: Date.now(),
    });

    assert.strictEqual(migrated.migrated, 80);
    assert.strictEqual(await store.get(keyTotal(userId)), "80");
    assert.strictEqual(await store.get(keyTotal(anonId)), null);
  });
});
