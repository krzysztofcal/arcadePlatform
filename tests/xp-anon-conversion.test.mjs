import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

let store;
let keyNs;
let keyTotal;
let keyDaily;
let saveAnonProfile;
let saveUserProfile;
let getAnonProfile;
let getUserProfile;
let attemptAnonToUserConversion;
let calculateAllowedAnonConversion;
let originalConsoleLog;
let klogEvents;

function buildKeyTotal(id) {
  return `${keyNs}:total:${id}`;
}

function buildKeyDaily(id, day) {
  return `${keyNs}:daily:${id}:${day}`;
}

async function loadModules() {
  const storeModule = await import("../netlify/functions/_shared/store-upstash.mjs");
  ({ store, saveAnonProfile, saveUserProfile, getAnonProfile, getUserProfile } = storeModule);
  const awardModule = await import("../netlify/functions/award-xp.mjs");
  attemptAnonToUserConversion = awardModule.attemptAnonToUserConversion;
  calculateAllowedAnonConversion = awardModule.calculateAllowedAnonConversion;
  keyNs = process.env.XP_KEY_NS || "xp:v2";
  keyTotal = buildKeyTotal;
  keyDaily = buildKeyDaily;
}

async function resetKeys(...ids) {
  if (!store) return;
  const deletions = ids.flatMap((id) => [
    buildKeyTotal(id),
    buildKeyDaily(id, "2024-06-05"),
    `kcswh:xp:user:${id}`,
    `kcswh:xp:anon:${id}`,
    `${process.env.XP_KEY_NS}:conversion:user:${id}`,
  ]);
  await Promise.all(deletions.map((k) => store.del?.(k)));
}

beforeEach(async () => {
  process.env.SUPABASE_JWT_SECRET = "test_supabase_jwt_secret_12345678901234567890";
  process.env.XP_KEY_NS = "test:xp";
  process.env.XP_DEBUG = "1";
  process.env.XP_REQUIRE_SERVER_SESSION = "0";
  process.env.XP_DAILY_SECRET = "test-secret-for-daily-32chars!";
  process.env.XP_ANON_CONVERSION_ENABLED = "1";
  process.env.XP_ANON_CONVERSION_MAX_CAP = "100000";
  process.env.XP_DAILY_CAP = "3000";
  klogEvents = [];
  originalConsoleLog = console.log;
  console.log = (...args) => {
    const message = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    if (message.includes("[klog]")) {
      klogEvents.push(message);
    }
  };
  await loadModules();
  store.eval = async () => 1;
});

afterEach(async () => {
  await resetKeys("anon-111", "user-123", "anon-1", "user-1", "user-2", "anon-2", "anon-lock", "user-lock");
  console.log = originalConsoleLog;
});

describe("calculateAllowedAnonConversion", () => {
  it("caps by daily cap when XP below cap", () => {
    const result = calculateAllowedAnonConversion(1000, 1);
    assert.strictEqual(result, 1000);
  });

  it("caps by daily cap when XP exceeds", () => {
    const result = calculateAllowedAnonConversion(10000, 1);
    assert.strictEqual(result, 3000);
  });

  it("caps by max total", () => {
    const result = calculateAllowedAnonConversion(200000, 100);
    assert.strictEqual(result, 100000);
  });

  it("returns 0 when xp or days missing", () => {
    assert.strictEqual(calculateAllowedAnonConversion(0, 1), 0);
    assert.strictEqual(calculateAllowedAnonConversion(10, 0), 0);
  });
});

describe("attemptAnonToUserConversion", () => {
  it("converts anon profile once with caps", async () => {
    const anonId = "anon-111";
    const userId = "user-123";
    await saveAnonProfile({
      anonId,
      totalAnonXp: 5000,
      anonActiveDays: 2,
      lastActivityTs: Date.now(),
      createdAt: new Date().toISOString(),
      convertedToUserId: null,
      lastActiveDayKey: "2024-05-01",
    });
    await store.set(keyTotal(anonId), "5000");
    await store.set(keyTotal(userId), "0");
    await store.set(keyDaily(anonId, "2024-06-05"), "5000");

    const first = await attemptAnonToUserConversion({
      userId,
      anonId,
      authContext: { emailVerified: true, payload: { email_confirmed_at: new Date().toISOString() } },
      storeClient: store,
    });

    assert.strictEqual(first.converted, true);
    assert.strictEqual(first.amount, 5000);
    assert.strictEqual((await getUserProfile(userId))?.hasConvertedAnonXp, true);
    assert.strictEqual((await getAnonProfile(anonId))?.convertedToUserId, userId);
    assert.strictEqual((await getAnonProfile(anonId))?.totalAnonXp, 0);

    const second = await attemptAnonToUserConversion({
      userId,
      anonId,
      authContext: { emailVerified: true },
      storeClient: store,
    });
    assert.strictEqual(second.converted, false);
    assert.strictEqual(second.amount, 0);
  });

  it("caps conversion amount using anon active days and leaves remaining anon total", async () => {
    const anonId = "anon-partial";
    const userId = "user-partial";
    await saveAnonProfile({
      anonId,
      totalAnonXp: 8000,
      anonActiveDays: 1,
      lastActivityTs: Date.now(),
      createdAt: new Date().toISOString(),
      convertedToUserId: null,
      lastActiveDayKey: "2024-05-02",
    });
    await store.set(keyTotal(anonId), "8000");
    await store.set(keyTotal(userId), "0");

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

  it("converts even when email is not verified", async () => {
    const anonId = "anon-1";
    const userId = "user-1";
    await saveAnonProfile({
      anonId,
      totalAnonXp: 150,
      anonActiveDays: 1,
      lastActivityTs: Date.now(),
      createdAt: new Date().toISOString(),
      convertedToUserId: null,
    });
    await store.set(keyTotal(anonId), "150");

    const result = await attemptAnonToUserConversion({
      userId,
      anonId,
      authContext: { emailVerified: false },
      storeClient: store,
    });

    assert.strictEqual(result.converted, true);
    assert.strictEqual(result.amount, 150);
  });

  it("skips when user already converted", async () => {
    await saveUserProfile({ userId: "user-2", totalXp: 100, hasConvertedAnonXp: true, anonConversionCompleted: true });
    const result = await attemptAnonToUserConversion({
      userId: "user-2",
      anonId: "anon-2",
      authContext: { emailVerified: true },
      storeClient: store,
    });
    assert.strictEqual(result.converted, false);
  });

  it("enforces lock allowing only first caller", async () => {
    let lockCalls = 0;
    const lockStore = {
      ...store,
      eval: async () => {
        lockCalls += 1;
        return lockCalls === 1 ? 1 : 0;
      },
    };

    await saveAnonProfile({
      anonId: "anon-lock",
      totalAnonXp: 100,
      anonActiveDays: 1,
      lastActivityTs: Date.now(),
      createdAt: new Date().toISOString(),
      convertedToUserId: null,
    });
    await store.set(keyTotal("anon-lock"), "100");
    await store.set(keyTotal("user-lock"), "0");

    const first = await attemptAnonToUserConversion({
      userId: "user-lock",
      anonId: "anon-lock",
      authContext: { emailVerified: true },
      storeClient: lockStore,
    });

    assert.strictEqual(first.converted, true);
    assert.strictEqual(first.amount, 100);

    const second = await attemptAnonToUserConversion({
      userId: "user-lock",
      anonId: "anon-lock",
      authContext: { emailVerified: true },
      storeClient: lockStore,
    });

    assert.strictEqual(second.converted, false);
    assert.strictEqual(second.amount, 0);
  });

  it("respects profile guard and logs skip", async () => {
    await saveUserProfile({
      userId: "user-guard",
      totalXp: 25,
      anonConversionCompleted: true,
      convertedFromAnonId: "anon-guard-prev",
    });
    const result = await attemptAnonToUserConversion({
      userId: "user-guard",
      anonId: "anon-guard",
      authContext: {},
      storeClient: store,
    });
    assert.strictEqual(result.converted, false);
    assert.strictEqual(result.reason, "already_converted");
    assert.ok(klogEvents.find((m) => m.includes("xp_migration_skip_already_converted") && m.includes("profile_flag")));
  });

  it("respects redis guard and logs skip", async () => {
    const userId = "user-guard-redis";
    const guardKey = `${process.env.XP_KEY_NS}:conversion:user:${userId}`;
    await store.set(guardKey, "1");
    const res = await attemptAnonToUserConversion({ userId, anonId: "anon-guard-redis", storeClient: store });
    assert.strictEqual(res.converted, false);
    assert.strictEqual(res.reason, "already_converted");
    assert.ok(klogEvents.find((m) => m.includes("xp_migration_skip_already_converted") && m.includes("redis_guard")));
  });

  it("logs success, sets guards, and updates profile on migration", async () => {
    const anonId = "anon-success";
    const userId = "user-success";
    await saveAnonProfile({
      anonId,
      totalAnonXp: 120,
      anonActiveDays: 1,
      lastActivityTs: Date.now(),
      createdAt: new Date().toISOString(),
      convertedToUserId: null,
    });
    await store.set(keyTotal(anonId), "120");
    await store.set(keyTotal(userId), "0");

    const res = await attemptAnonToUserConversion({ userId, anonId, storeClient: store });
    assert.strictEqual(res.converted, true);
    const guardKey = `${process.env.XP_KEY_NS}:conversion:user:${userId}`;
    assert.strictEqual(await store.get(guardKey), "1");
    const profile = await getUserProfile(userId);
    assert.strictEqual(profile.anonConversionCompleted, true);
    assert.strictEqual(profile.convertedFromAnonId, anonId);
    assert.ok(profile.anonConversionAt);
    assert.ok(klogEvents.find((m) => m.includes("xp_migration_success")));
  });

  it("skips when no anon totals exist", async () => {
    const res = await attemptAnonToUserConversion({ userId: "user-none", anonId: "anon-none", storeClient: store });
    assert.strictEqual(res.converted, false);
    assert.strictEqual(res.reason, "no_anon_totals");
    assert.ok(klogEvents.find((m) => m.includes("xp_migration_skip_no_anon_totals")));
  });

  it("skips when ids are missing or same", async () => {
    const res = await attemptAnonToUserConversion({ userId: null, anonId: null, storeClient: store });
    assert.strictEqual(res.converted, false);
    assert.strictEqual(res.reason, "ineligible");
    assert.ok(klogEvents.find((m) => m.includes("xp_migration_skip_ineligible")));
  });
});
