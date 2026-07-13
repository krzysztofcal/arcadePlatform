import assert from "node:assert/strict";
import test from "node:test";
import { __createMemoryStoreForTests } from "../netlify/functions/_shared/store-upstash.mjs";
import { createAdminXpLeaderboardMaintenanceHandler } from "../netlify/functions/admin-xp-leaderboard-maintenance.mjs";
import {
  issueMaintenanceApplyToken,
  listAuthUsersPage,
  parseMaintenanceRequest,
  runBackfill,
  runProfileCoverage,
  runPrune,
  validateMaintenanceTarget,
  verifyMaintenanceApplyToken,
} from "../netlify/functions/_shared/xp-leaderboard-maintenance.mjs";
import { createXpLeaderboardKeys, getXpLeaderboardPeriods, getXpLeaderboardWeekDayKeys } from "../netlify/functions/_shared/xp-leaderboard.mjs";

const USER_1 = "00000000-0000-4000-8000-000000000001";
const USER_2 = "00000000-0000-4000-8000-000000000002";
const NAMESPACE = "test:xp:maintenance";
const NOW = Date.UTC(2026, 6, 13, 5, 0, 0);
const TOKEN_ENV = { SUPABASE_SERVICE_ROLE_KEY: "test-service-role-secret-at-least-32-chars", DEPLOY_ID: "deploy-stage-a" };
const STAGE_TARGET = { databaseTarget: "stage", projectRef: "stage-ref", environmentContext: "deploy-preview" };
const STAGE_IDENTITY = {
  databaseTarget: "stage",
  supabaseProjectRef: "stage-ref",
  supabaseUrlProjectRef: "stage-ref",
  databaseProjectRef: "stage-ref",
  databaseMatchesSupabaseProjectRef: true,
  stageProjectRefMatches: true,
  serviceRoleProjectRef: "stage-ref",
  environmentContext: "deploy-preview",
};

test("maintenance requests default to bounded dry-run and reject unsafe operations", () => {
  assert.deepEqual(parseMaintenanceRequest({ operation: "backfill", limit: 500 }), {
    operation: "backfill", period: "all_time", page: 1, offset: 0, limit: 50, dryRun: true, applyToken: "",
  });
  assert.throws(() => parseMaintenanceRequest({ operation: "unknown" }), /invalid_operation/);
  assert.throws(() => parseMaintenanceRequest({ operation: "prune", period: "old-week" }), /invalid_period/);
});

test("maintenance target validation rejects inconsistent server resources", () => {
  assert.equal(validateMaintenanceTarget({ identity: STAGE_IDENTITY }).databaseTarget, "stage");
  assert.throws(() => validateMaintenanceTarget({
    identity: { ...STAGE_IDENTITY, serviceRoleProjectRef: "other-ref" },
  }), /service_role_project_mismatch/);
});

test("signed apply token is bound to operation, page, target, actor, and expiry", () => {
  const dryRun = parseMaintenanceRequest({ operation: "profile_coverage", page: 1, limit: 25 });
  const issued = issueMaintenanceApplyToken({
    request: dryRun, target: STAGE_TARGET, adminUserId: USER_1, env: TOKEN_ENV, nowMs: NOW,
  });
  const matchingApply = parseMaintenanceRequest({
    operation: "profile_coverage", page: 1, limit: 25, apply: true, applyToken: issued.token,
  });
  assert.equal(verifyMaintenanceApplyToken({
    token: issued.token, request: matchingApply, target: STAGE_TARGET, adminUserId: USER_1, env: TOKEN_ENV, nowMs: NOW,
  }).scope.page, 1);
  assert.throws(() => verifyMaintenanceApplyToken({
    token: issued.token,
    request: parseMaintenanceRequest({ operation: "backfill", page: 1, limit: 25, apply: true }),
    target: STAGE_TARGET,
    adminUserId: USER_1,
    env: TOKEN_ENV,
    nowMs: NOW,
  }), /apply_token_scope_mismatch/);
  assert.throws(() => verifyMaintenanceApplyToken({
    token: issued.token,
    request: parseMaintenanceRequest({ operation: "profile_coverage", page: 2, limit: 25, apply: true }),
    target: STAGE_TARGET,
    adminUserId: USER_1,
    env: TOKEN_ENV,
    nowMs: NOW,
  }), /apply_token_scope_mismatch/);
  assert.throws(() => verifyMaintenanceApplyToken({
    token: issued.token,
    request: matchingApply,
    target: { databaseTarget: "production", projectRef: "prod-ref" },
    adminUserId: USER_1,
    env: TOKEN_ENV,
    nowMs: NOW,
  }), /apply_token_target_mismatch/);
  assert.throws(() => verifyMaintenanceApplyToken({
    token: issued.token, request: matchingApply, target: STAGE_TARGET, adminUserId: USER_2, env: TOKEN_ENV, nowMs: NOW,
  }), /apply_token_actor_mismatch/);
  assert.throws(() => verifyMaintenanceApplyToken({
    token: issued.token,
    request: matchingApply,
    target: STAGE_TARGET,
    adminUserId: USER_1,
    env: { ...TOKEN_ENV, DEPLOY_ID: "deploy-stage-b" },
    nowMs: NOW,
  }), /apply_token_deploy_mismatch/);
  assert.throws(() => verifyMaintenanceApplyToken({
    token: issued.token, request: matchingApply, target: STAGE_TARGET, adminUserId: USER_1, env: TOKEN_ENV, nowMs: NOW + (5 * 60 * 1000),
  }), /apply_token_expired/);
  assert.throws(() => verifyMaintenanceApplyToken({
    token: `${issued.token.slice(0, -1)}x`, request: matchingApply, target: STAGE_TARGET, adminUserId: USER_1, env: TOKEN_ENV, nowMs: NOW,
  }), /invalid_apply_token/);
});

test("prune apply token is bound to period and raw offset", () => {
  const dryRun = parseMaintenanceRequest({ operation: "prune", period: "all_time", offset: 0, limit: 25 });
  const issued = issueMaintenanceApplyToken({
    request: dryRun, target: STAGE_TARGET, adminUserId: USER_1, env: TOKEN_ENV, nowMs: NOW,
  });
  for (const mismatch of [
    { operation: "prune", period: "week", offset: 0, limit: 25, apply: true },
    { operation: "prune", period: "all_time", offset: 25, limit: 25, apply: true },
  ]) {
    assert.throws(() => verifyMaintenanceApplyToken({
      token: issued.token,
      request: parseMaintenanceRequest(mismatch),
      target: STAGE_TARGET,
      adminUserId: USER_1,
      env: TOKEN_ENV,
      nowMs: NOW,
    }), /apply_token_scope_mismatch/);
  }
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
    operation: "profile_coverage", apply: true,
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
  const handler = createAdminXpLeaderboardMaintenanceHandler({
    env: TOKEN_ENV,
    requireAdminUser: async () => ({ userId: USER_1 }),
    buildStageIdentity: () => STAGE_IDENTITY,
    runLeaderboardMaintenance: async (request) => { maintenanceCalls += 1; return { operation: request.operation, dryRun: request.dryRun }; },
    now: () => NOW,
  });
  const rejected = await handler({
    httpMethod: "POST", headers: {}, body: JSON.stringify({ operation: "backfill", apply: true }),
  });
  assert.equal(rejected.statusCode, 409);
  assert.equal(JSON.parse(rejected.body).error, "apply_token_required");
  assert.equal(maintenanceCalls, 0);
  const dryRun = await handler({
    httpMethod: "POST", headers: {}, body: JSON.stringify({ operation: "backfill", page: 2, limit: 25 }),
  });
  assert.equal(dryRun.statusCode, 200);
  const dryRunPayload = JSON.parse(dryRun.body);
  assert.equal(typeof dryRunPayload.applyToken, "string");
  assert.equal(dryRunPayload.applyTokenExpiresAt, NOW + (5 * 60 * 1000));
  assert.equal(maintenanceCalls, 1);
  const accepted = await handler({
    httpMethod: "POST",
    headers: {},
    body: JSON.stringify({ operation: "backfill", page: 2, limit: 25, apply: true, applyToken: dryRunPayload.applyToken }),
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(maintenanceCalls, 2);
});
