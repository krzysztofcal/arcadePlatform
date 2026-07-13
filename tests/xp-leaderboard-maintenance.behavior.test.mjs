import assert from "node:assert/strict";
import test from "node:test";
import { __createMemoryStoreForTests } from "../netlify/functions/_shared/store-upstash.mjs";
import { createAdminXpLeaderboardMaintenanceHandler } from "../netlify/functions/admin-xp-leaderboard-maintenance.mjs";
import {
  listAuthUsersPage,
  parseMaintenanceRequest,
  runBackfill,
  runProfileCoverage,
  runPrune,
  validateMaintenanceTarget,
} from "../netlify/functions/_shared/xp-leaderboard-maintenance.mjs";
import { createXpLeaderboardKeys, getXpLeaderboardPeriods, getXpLeaderboardWeekDayKeys } from "../netlify/functions/_shared/xp-leaderboard.mjs";

const USER_1 = "00000000-0000-4000-8000-000000000001";
const USER_2 = "00000000-0000-4000-8000-000000000002";
const NAMESPACE = "test:xp:maintenance";

test("maintenance requests default to bounded dry-run and reject unsafe operations", () => {
  assert.deepEqual(parseMaintenanceRequest({ operation: "backfill", limit: 500 }), {
    operation: "backfill", period: "all_time", page: 1, offset: 0, limit: 50, dryRun: true, confirmation: "",
  });
  assert.throws(() => parseMaintenanceRequest({ operation: "unknown" }), /invalid_operation/);
  assert.throws(() => parseMaintenanceRequest({ operation: "prune", period: "old-week" }), /invalid_period/);
});

test("apply requires an exact detected target confirmation", () => {
  const identity = {
    databaseTarget: "stage",
    supabaseProjectRef: "stage-ref",
    supabaseUrlProjectRef: "stage-ref",
    databaseProjectRef: "stage-ref",
    databaseMatchesSupabaseProjectRef: true,
    stageProjectRefMatches: true,
    serviceRoleProjectRef: "stage-ref",
    environmentContext: "deploy-preview",
  };
  assert.equal(validateMaintenanceTarget({ identity, request: { dryRun: true } }).databaseTarget, "stage");
  assert.throws(() => validateMaintenanceTarget({ identity, request: { dryRun: false, confirmation: "" } }), /confirmation_required/);
  assert.equal(validateMaintenanceTarget({
    identity,
    request: { dryRun: false, confirmation: "apply:stage:stage-ref" },
  }).projectRef, "stage-ref");
  assert.throws(() => validateMaintenanceTarget({
    identity: { ...identity, serviceRoleProjectRef: "other-ref" },
    request: { dryRun: true },
  }), /service_role_project_mismatch/);
});

test("profile coverage discovery uses bounded Supabase Admin pagination and keeps only IDs", async () => {
  let request = null;
  const ids = await listAuthUsersPage({
    page: 2,
    limit: 25,
    env: { SUPABASE_URL: "https://stage-ref.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-secret" },
    fetchFn: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ users: [{ id: USER_1, email: "private@example.com" }] }) };
    },
  });
  assert.deepEqual(ids, [USER_1]);
  assert.equal(request.url, "https://stage-ref.supabase.co/auth/v1/admin/users?page=2&per_page=25");
  assert.equal(request.options.headers.apikey, "service-secret");
  assert.equal(JSON.stringify(ids).includes("private@example.com"), false);
});

test("profile coverage is read-only in dry-run and creates only missing profiles on apply", async () => {
  const created = [];
  const deps = {
    listAuthUsersPage: async () => [USER_1, USER_2],
    readExistingProfileIds: async () => new Set([USER_1]),
    ensureUserProfile: async (userId) => { created.push(userId); },
  };
  const dryRun = await runProfileCoverage(parseMaintenanceRequest({ operation: "profile_coverage" }), deps);
  assert.deepEqual({ processed: dryRun.processed, existing: dryRun.existing, missing: dryRun.missing, created: dryRun.created },
    { processed: 2, existing: 1, missing: 1, created: 0 });
  assert.deepEqual(created, []);
  const apply = await runProfileCoverage(parseMaintenanceRequest({
    operation: "profile_coverage", apply: true, confirmation: "unused-by-service",
  }), deps);
  assert.equal(apply.created, 1);
  assert.deepEqual(created, [USER_2]);
});

test("backfill converges canonical totals and removes stale zero projections", async () => {
  const store = __createMemoryStoreForTests();
  const now = Date.now();
  const periods = getXpLeaderboardPeriods(now);
  const weekDays = getXpLeaderboardWeekDayKeys(now);
  const keys = createXpLeaderboardKeys({ namespace: NAMESPACE });
  await store.set(`${NAMESPACE}:total:${USER_1}`, "120");
  await store.set(`${NAMESPACE}:daily:${USER_1}:${periods.dayKey}`, "20");
  for (const dayKey of weekDays) await store.set(`${NAMESPACE}:daily:${USER_1}:${dayKey}`, "5");
  await store.zadd(keys.allTime(), 10, USER_1);
  await store.zadd(keys.allTime(), 99, USER_2);
  await store.zadd(keys.day(periods.dayKey), 99, USER_2);
  await store.zadd(keys.week(periods.weekKey), 99, USER_2);
  const deps = { store, namespace: NAMESPACE, now, listProfilesPage: async () => [USER_1, USER_2] };

  const dryRun = await runBackfill(parseMaintenanceRequest({ operation: "backfill" }), deps);
  assert.equal(dryRun.updated > 0, true);
  assert.equal(await store.zscore(keys.allTime(), USER_1), 10);

  const applied = await runBackfill(parseMaintenanceRequest({ operation: "backfill", apply: true }), deps);
  assert.equal(applied.failed, 0);
  assert.equal(await store.zscore(keys.allTime(), USER_1), 120);
  assert.equal(await store.zscore(keys.day(periods.dayKey), USER_1), 5);
  assert.equal(await store.zscore(keys.week(periods.weekKey), USER_1), weekDays.length * 5);
  assert.equal(await store.zscore(keys.allTime(), USER_2), null);
  assert.equal(await store.zscore(keys.day(periods.dayKey), USER_2), null);
  assert.equal(await store.zscore(keys.week(periods.weekKey), USER_2), null);

  const rerun = await runBackfill(parseMaintenanceRequest({ operation: "backfill", apply: true }), deps);
  assert.equal(rerun.updated, 0);
  assert.equal(rerun.removed, 0);
  assert.equal(rerun.unchanged, 6);
});

test("prune removes missing profiles without skipping the shifted raw offset", async () => {
  const store = __createMemoryStoreForTests();
  const keys = createXpLeaderboardKeys({ namespace: NAMESPACE });
  await store.zadd(keys.allTime(), 20, USER_1);
  await store.zadd(keys.allTime(), 10, USER_2);
  const request = parseMaintenanceRequest({ operation: "prune", period: "all_time", apply: true, limit: 2 });
  const first = await runPrune(request, {
    store,
    namespace: NAMESPACE,
    readExistingProfileIds: async () => new Set([USER_1]),
  });
  assert.equal(first.removed, 1);
  assert.equal(first.nextOffset, 0);
  assert.equal(await store.zscore(keys.allTime(), USER_2), null);
  const second = await runPrune({ ...request, offset: first.nextOffset }, {
    store,
    namespace: NAMESPACE,
    readExistingProfileIds: async () => new Set([USER_1]),
  });
  assert.equal(second.removed, 0);
  assert.equal(second.hasMore, false);
});

test("admin endpoint is authenticated and keeps target validation ahead of maintenance", async () => {
  let maintenanceCalls = 0;
  const identity = {
    databaseTarget: "stage",
    supabaseProjectRef: "stage-ref",
    supabaseUrlProjectRef: "stage-ref",
    databaseProjectRef: "stage-ref",
    databaseMatchesSupabaseProjectRef: true,
    stageProjectRefMatches: true,
    serviceRoleProjectRef: "stage-ref",
    environmentContext: "deploy-preview",
  };
  const handler = createAdminXpLeaderboardMaintenanceHandler({
    env: {},
    requireAdminUser: async () => ({ userId: USER_1 }),
    buildStageIdentity: () => identity,
    runLeaderboardMaintenance: async (request) => { maintenanceCalls += 1; return { operation: request.operation, dryRun: request.dryRun }; },
  });
  const rejected = await handler({
    httpMethod: "POST", headers: {}, body: JSON.stringify({ operation: "backfill", apply: true }),
  });
  assert.equal(rejected.statusCode, 409);
  assert.equal(JSON.parse(rejected.body).error, "confirmation_required");
  assert.equal(maintenanceCalls, 0);
  const accepted = await handler({
    httpMethod: "POST",
    headers: {},
    body: JSON.stringify({ operation: "backfill", apply: true, confirmation: "apply:stage:stage-ref" }),
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(maintenanceCalls, 1);
});
