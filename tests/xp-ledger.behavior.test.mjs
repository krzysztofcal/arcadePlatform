import assert from "node:assert/strict";
import test from "node:test";
import { createXpLedgerKeys, executeAtomicXpAward, readXpTotals } from "../netlify/functions/_shared/xp-ledger.mjs";
import { buildXpStatusSnapshot, persistXpProfileSnapshot, readCanonicalXpStatus } from "../netlify/functions/_shared/xp-status.mjs";

const keys = createXpLedgerKeys({ namespace: "test:xp", lockPrefix: "test:lock:" });

test("XP ledger keys are stable and session-scoped", () => {
  assert.equal(keys.daily("user-1", "2026-07-12"), "test:xp:daily:user-1:2026-07-12");
  assert.equal(keys.total("user-1"), "test:xp:total:user-1");
  assert.match(keys.session("user-1", "session-1"), /^test:xp:session:[0-9a-f]{64}$/);
  assert.match(keys.sessionSync("user-1", "session-1"), /^test:xp:session:last:[0-9a-f]{64}$/);
  assert.match(keys.registry("user-1", "session-1"), /^test:xp:registry:[0-9a-f]{64}$/);
  assert.notEqual(keys.session("user-1", "session-1"), keys.session("user-1", "session-2"));
});

test("canonical totals reader returns normalized daily lifetime and session counters", async () => {
  const values = new Map([
    [keys.daily("user-1", "2026-07-12"), "25.9"],
    [keys.total("user-1"), "320"],
    [keys.session("user-1", "session-1"), "18"],
    [keys.sessionSync("user-1", "session-1"), "1783840000000"],
  ]);
  const snapshot = await readXpTotals({ store: { get: async (key) => values.get(key) }, keys, userId: "user-1", sessionId: "session-1", dayKey: "2026-07-12" });
  assert.deepEqual(snapshot, { current: 25, lifetime: 320, sessionTotal: 18, lastSync: 1783840000000 });
});

test("status without a session does not read or create session state", async () => {
  const reads = [];
  const snapshot = await readXpTotals({ store: { get: async (key) => { reads.push(key); return "0"; } }, keys, userId: "user-1", sessionId: null, dayKey: "2026-07-12" });
  assert.equal(reads.length, 2);
  assert.equal(reads.some((key) => key.includes(":session:")), false);
  assert.deepEqual(snapshot, { current: 0, lifetime: 0, sessionTotal: 0, lastSync: 0 });
});

test("totals error policy is explicit for authoritative and legacy adapters", async () => {
  const failingStore = { get: async () => { throw new Error("redis unavailable"); } };
  await assert.rejects(() => readXpTotals({ store: failingStore, keys, userId: "user-1", dayKey: "2026-07-12" }), /redis unavailable/);
  assert.deepEqual(
    await readXpTotals({ store: failingStore, keys, userId: "user-1", dayKey: "2026-07-12", onError: "zero" }),
    { current: 0, lifetime: 0, sessionTotal: 0, lastSync: 0 },
  );
});

test("canonical status snapshot is allowlisted and preserves a supplied compatibility session id", () => {
  assert.deepEqual(buildXpStatusSnapshot({
    totals: { current: 25, lifetime: 320, sessionTotal: 18, lastSync: 123, internalKey: "secret" },
    dailyCap: 3000,
    deltaCap: 300,
    sessionId: "legacy-session",
    dayKey: "2026-07-12",
    nextReset: 1783900800000,
  }), {
    ok: true, awarded: 0, granted: 0, cap: 3000, capDelta: 300,
    totalLifetime: 320, sessionTotal: 18, lastSync: 123, status: "statusOnly", sessionId: "legacy-session",
    totalToday: 25, remaining: 2975, dayKey: "2026-07-12", nextReset: 1783900800000,
  });
});

test("canonical status read projects totals and persists only the derived authenticated snapshot", async () => {
  let persisted = null;
  const result = await readCanonicalXpStatus({
    readTotals: async () => ({ current: 40, lifetime: 500, sessionTotal: 0, lastSync: 0 }),
    dailyCap: 3000,
    deltaCap: 300,
    dayKey: "2026-07-12",
    nextReset: 1783900800000,
    supabaseUserId: "user-1",
    persistProfile: async (value) => { persisted = value; },
  });
  assert.equal(result.payload.totalLifetime, 500);
  assert.equal(result.payload.totalToday, 40);
  assert.equal(result.payload.remaining, 2960);
  assert.equal(Object.hasOwn(result.payload, "userId"), false);
  assert.deepEqual(persisted, { userId: "user-1", totalXp: 500 });
});

test("derived profile persistence normalizes totals and fails without changing canonical status", async () => {
  let saved = null;
  assert.equal(await persistXpProfileSnapshot({ userId: "user-1", totalXp: 12.9, now: 10, save: async (value) => { saved = value; } }), true);
  assert.deepEqual(saved, { userId: "user-1", totalXp: 12, now: 10 });
  assert.equal(await persistXpProfileSnapshot({ userId: "user-1", totalXp: 12, save: async () => { throw new Error("profile unavailable"); } }), false);
});

test("atomic award executor normalizes results and preserves legacy lock retry", async () => {
  let calls = 0;
  let delayed = false;
  const result = await executeAtomicXpAward({
    store: { eval: async () => (++calls === 1 ? [0, 10, 2, 20, 100, 6, 90, 50] : [5, 15, 7, 25, 110, 0]) },
    script: "return {}", keys: ["key"], args: [1], retryLocked: true,
    retryDelay: async () => { delayed = true; },
  });
  assert.equal(calls, 2);
  assert.equal(delayed, true);
  assert.deepEqual({ granted: result.granted, dailyTotal: result.dailyTotal, sessionTotal: result.sessionTotal, lifetime: result.lifetime, lastSync: result.lastSync, status: result.status },
    { granted: 5, dailyTotal: 15, sessionTotal: 7, lifetime: 25, lastSync: 110, status: 0 });
});
