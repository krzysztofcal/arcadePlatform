import { createHmac, timingSafeEqual } from "node:crypto";
import { executeSql, klog } from "./supabase-admin.mjs";
import { store as defaultStore } from "./store-upstash.mjs";
import { ensureUserProfile } from "./user-profile.mjs";
import { createXpLeaderboardKeys, getXpLeaderboardPeriods, getXpLeaderboardWeekDayKeys } from "./xp-leaderboard.mjs";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const APPLY_TOKEN_TTL_SEC = 5 * 60;
const APPLY_TOKEN_VERSION = 1;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function maintenanceError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function normalizePositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function normalizeCounter(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function parseMaintenanceRequest(payload = {}) {
  const operation = typeof payload.operation === "string" ? payload.operation.trim() : "";
  if (!['profile_coverage', 'backfill', 'prune'].includes(operation)) throw maintenanceError("invalid_operation");
  const period = typeof payload.period === "string" ? payload.period.trim() : "all_time";
  if (operation === "prune" && !['today', 'week', 'all_time'].includes(period)) throw maintenanceError("invalid_period");
  return {
    operation,
    period,
    page: normalizePositiveInt(payload.page, 1),
    offset: Math.max(0, Math.floor(Number(payload.offset) || 0)),
    limit: normalizePositiveInt(payload.limit, DEFAULT_LIMIT, MAX_LIMIT),
    dryRun: payload.apply !== true,
    applyToken: typeof payload.applyToken === "string" ? payload.applyToken.trim() : "",
  };
}

function validateMaintenanceTarget({ identity }) {
  const target = identity?.databaseTarget;
  const projectRef = identity?.supabaseProjectRef;
  if (!projectRef || (target !== "stage" && target !== "production")) throw maintenanceError("unsafe_target", 409);
  if (target === "stage" && identity.stageProjectRefMatches !== true) throw maintenanceError("stage_ref_mismatch", 409);
  if (identity.supabaseUrlProjectRef !== projectRef || identity.databaseProjectRef !== projectRef || identity.databaseMatchesSupabaseProjectRef !== true) {
    throw maintenanceError("supabase_resource_mismatch", 409);
  }
  if (identity.serviceRoleProjectRef && identity.serviceRoleProjectRef !== projectRef) throw maintenanceError("service_role_project_mismatch", 409);
  return { databaseTarget: target, projectRef, environmentContext: identity.environmentContext || "unknown" };
}

function maintenanceRequestScope(request) {
  return {
    operation: request.operation,
    page: request.page,
    offset: request.offset,
    limit: request.limit,
    period: request.period,
  };
}

function resolveApplyTokenSecret(env = process.env) {
  const secret = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!secret) throw maintenanceError("apply_token_unavailable", 503);
  return createHmac("sha256", secret).update("xp-leaderboard-maintenance:v1").digest();
}

function signApplyTokenPayload(encodedPayload, secret) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function actorFingerprint(userId, secret) {
  return createHmac("sha256", secret).update(`actor:${String(userId || "")}`).digest("base64url").slice(0, 22);
}

function deploymentFingerprint(env, secret) {
  const deployment = env.DEPLOY_ID || env.COMMIT_REF || env.DEPLOY_PRIME_URL || env.URL || env.CONTEXT || "local";
  return createHmac("sha256", secret).update(`deploy:${deployment}`).digest("base64url").slice(0, 22);
}

function issueMaintenanceApplyToken({ request, target, adminUserId, env = process.env, nowMs = Date.now() }) {
  if (!request?.dryRun) throw maintenanceError("apply_token_requires_dry_run", 409);
  const secret = resolveApplyTokenSecret(env);
  const issuedAt = Math.floor(nowMs / 1000);
  const payload = {
    v: APPLY_TOKEN_VERSION,
    target: target.databaseTarget,
    projectRef: target.projectRef,
    scope: maintenanceRequestScope(request),
    actor: actorFingerprint(adminUserId, secret),
    deployment: deploymentFingerprint(env, secret),
    iat: issuedAt,
    exp: issuedAt + APPLY_TOKEN_TTL_SEC,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    token: `${encodedPayload}.${signApplyTokenPayload(encodedPayload, secret)}`,
    expiresAt: payload.exp * 1000,
  };
}

function verifyMaintenanceApplyToken({ token, request, target, adminUserId, env = process.env, nowMs = Date.now() }) {
  if (!token) throw maintenanceError("apply_token_required", 409);
  const secret = resolveApplyTokenSecret(env);
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw maintenanceError("invalid_apply_token", 409);
  const expectedSignature = Buffer.from(signApplyTokenPayload(parts[0], secret));
  const suppliedSignature = Buffer.from(parts[1]);
  if (expectedSignature.length !== suppliedSignature.length || !timingSafeEqual(expectedSignature, suppliedSignature)) {
    throw maintenanceError("invalid_apply_token", 409);
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    throw maintenanceError("invalid_apply_token", 409);
  }
  const nowSec = Math.floor(nowMs / 1000);
  if (payload?.v !== APPLY_TOKEN_VERSION || !Number.isInteger(payload.exp) || !Number.isInteger(payload.iat)) {
    throw maintenanceError("invalid_apply_token", 409);
  }
  if (payload.exp <= nowSec || payload.iat > nowSec + 30) throw maintenanceError("apply_token_expired", 409);
  if (payload.target !== target.databaseTarget || payload.projectRef !== target.projectRef) {
    throw maintenanceError("apply_token_target_mismatch", 409);
  }
  if (payload.actor !== actorFingerprint(adminUserId, secret)) throw maintenanceError("apply_token_actor_mismatch", 409);
  if (payload.deployment !== deploymentFingerprint(env, secret)) throw maintenanceError("apply_token_deploy_mismatch", 409);
  if (JSON.stringify(payload.scope) !== JSON.stringify(maintenanceRequestScope(request))) {
    throw maintenanceError("apply_token_scope_mismatch", 409);
  }
  return payload;
}

async function listAuthUsersPage({ page, limit, env = process.env, fetchFn = fetch }) {
  const baseUrl = String(env.SUPABASE_URL || env.SUPABASE_URL_V2 || "").replace(/\/$/, "");
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!/^https:\/\/[^/]+\.supabase\.co$/i.test(baseUrl) || !serviceRoleKey) throw maintenanceError("supabase_admin_unconfigured", 503);
  const response = await fetchFn(`${baseUrl}/auth/v1/admin/users?page=${page}&per_page=${limit}`, {
    headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
    cache: "no-store",
  });
  if (!response?.ok) throw maintenanceError("supabase_admin_failed", 503);
  const payload = await response.json();
  const users = Array.isArray(payload) ? payload : payload?.users;
  if (!Array.isArray(users)) throw maintenanceError("supabase_admin_invalid_response", 503);
  return users.map((user) => user?.id).filter((id) => typeof id === "string" && id.length > 0);
}

async function readExistingProfileIds(userIds, runSql = executeSql) {
  const validIds = userIds.filter((userId) => UUID_RE.test(userId));
  if (!validIds.length) return new Set();
  const rows = await runSql(
    `select user_id::text from public.user_profiles where user_id = any($1::uuid[]);`,
    [validIds],
  );
  return new Set((rows || []).map((row) => row.user_id));
}

async function readEligibleProfileIds(userIds, runSql = executeSql) {
  const validIds = userIds.filter((userId) => UUID_RE.test(userId));
  if (!validIds.length) return new Set();
  const rows = await runSql(
    `select user_id::text from public.user_profiles
     where user_id = any($1::uuid[]) and leaderboard_visible = true;`,
    [validIds],
  );
  return new Set((rows || []).map((row) => row.user_id));
}

async function runProfileCoverage(request, deps = {}) {
  const listUsers = deps.listAuthUsersPage || listAuthUsersPage;
  const readExisting = deps.readExistingProfileIds || readExistingProfileIds;
  const ensureProfile = deps.ensureUserProfile || ensureUserProfile;
  const userIds = await listUsers({ page: request.page, limit: request.limit, env: deps.env, fetchFn: deps.fetchFn });
  const existing = await readExisting(userIds, deps.executeSql);
  const missing = userIds.filter((userId) => !existing.has(userId));
  let created = 0;
  let failed = 0;
  if (!request.dryRun) {
    for (const userId of missing) {
      try {
        await ensureProfile(userId);
        created += 1;
      } catch {
        failed += 1;
      }
    }
  }
  return {
    operation: request.operation,
    dryRun: request.dryRun,
    page: request.page,
    limit: request.limit,
    processed: userIds.length,
    existing: existing.size,
    missing: missing.length,
    created,
    failed,
    hasMore: userIds.length === request.limit,
    nextPage: userIds.length === request.limit ? request.page + 1 : null,
  };
}

async function listProfilesPage({ page, limit, runSql = executeSql }) {
  const rows = await runSql(
    `select user_id::text
     from public.user_profiles
     where leaderboard_visible = true
     order by user_id
     offset $1 limit $2;`,
    [(page - 1) * limit, limit],
  );
  return (rows || []).map((row) => row.user_id).filter(Boolean);
}

async function readCanonicalProjection({ store, namespace, userId, periods, weekDayKeys }) {
  const totalKey = `${namespace}:total:${userId}`;
  const dayKey = `${namespace}:daily:${userId}:${periods.dayKey}`;
  const weekKeys = weekDayKeys.map((key) => `${namespace}:daily:${userId}:${key}`);
  const values = await Promise.all([store.get(totalKey), store.get(dayKey), ...weekKeys.map((key) => store.get(key))]);
  return {
    allTime: normalizeCounter(values[0]),
    today: normalizeCounter(values[1]),
    week: values.slice(2).reduce((sum, value) => sum + normalizeCounter(value), 0),
  };
}

async function setProjectionScore({ store, key, member, score, dryRun }) {
  const current = normalizeCounter(await store.zscore(key, member));
  if (current === score) return "unchanged";
  if (!dryRun) {
    if (score > 0) await store.zadd(key, score, member);
    else await store.zrem(key, member);
  }
  return score > 0 ? "updated" : "removed";
}

async function runBackfill(request, deps = {}) {
  const store = deps.store || defaultStore;
  const namespace = deps.namespace || process.env.XP_KEY_NS || "kcswh:xp:v2";
  const now = Number.isFinite(deps.now) ? deps.now : Date.now();
  const periods = getXpLeaderboardPeriods(now);
  const weekDayKeys = getXpLeaderboardWeekDayKeys(now);
  const leaderboardKeys = createXpLeaderboardKeys({ namespace });
  const profileIds = await (deps.listProfilesPage || listProfilesPage)({ page: request.page, limit: request.limit, runSql: deps.executeSql });
  const counts = { processed: 0, updated: 0, removed: 0, unchanged: 0, failed: 0 };
  for (const userId of profileIds) {
    try {
      const canonical = await readCanonicalProjection({ store, namespace, userId, periods, weekDayKeys });
      const results = await Promise.all([
        setProjectionScore({ store, key: leaderboardKeys.allTime(), member: userId, score: canonical.allTime, dryRun: request.dryRun }),
        setProjectionScore({ store, key: leaderboardKeys.day(periods.dayKey), member: userId, score: canonical.today, dryRun: request.dryRun }),
        setProjectionScore({ store, key: leaderboardKeys.week(periods.weekKey), member: userId, score: canonical.week, dryRun: request.dryRun }),
      ]);
      counts.processed += 1;
      for (const result of results) counts[result] += 1;
    } catch {
      counts.failed += 1;
    }
  }
  if (!request.dryRun && counts.processed > 0) {
    await Promise.all([
      store.expire(leaderboardKeys.day(periods.dayKey), Math.max(1, periods.dayExpiresAtSec - Math.floor(now / 1000))),
      store.expire(leaderboardKeys.week(periods.weekKey), Math.max(1, periods.weekExpiresAtSec - Math.floor(now / 1000))),
    ]);
  }
  return {
    operation: request.operation,
    dryRun: request.dryRun,
    page: request.page,
    limit: request.limit,
    periodKeys: { today: periods.dayKey, week: periods.weekKey },
    ...counts,
    hasMore: profileIds.length === request.limit,
    nextPage: profileIds.length === request.limit ? request.page + 1 : null,
  };
}

function selectLeaderboardKey({ period, namespace, now }) {
  const periods = getXpLeaderboardPeriods(now);
  const keys = createXpLeaderboardKeys({ namespace });
  if (period === "today") return keys.day(periods.dayKey);
  if (period === "week") return keys.week(periods.weekKey);
  return keys.allTime();
}

async function runPrune(request, deps = {}) {
  const store = deps.store || defaultStore;
  const namespace = deps.namespace || process.env.XP_KEY_NS || "kcswh:xp:v2";
  const now = Number.isFinite(deps.now) ? deps.now : Date.now();
  const key = selectLeaderboardKey({ period: request.period, namespace, now });
  const candidates = await store.zrevrangeWithScores(key, request.offset, request.offset + request.limit - 1);
  const readExisting = deps.readEligibleProfileIds || deps.readExistingProfileIds || readEligibleProfileIds;
  const existing = await readExisting(candidates.map((row) => row.member), deps.executeSql);
  const missing = candidates.filter((row) => !existing.has(row.member));
  if (!request.dryRun) {
    for (const row of missing) await store.zrem(key, row.member);
  }
  const nextOffset = candidates.length === request.limit
    ? (request.dryRun || missing.length === 0 ? request.offset + request.limit : request.offset)
    : null;
  return {
    operation: request.operation,
    period: request.period,
    dryRun: request.dryRun,
    offset: request.offset,
    limit: request.limit,
    processed: candidates.length,
    missing: missing.length,
    removed: request.dryRun ? 0 : missing.length,
    hasMore: nextOffset !== null,
    nextOffset,
  };
}

async function runLeaderboardMaintenance(request, deps = {}) {
  let result;
  if (request.operation === "profile_coverage") result = await runProfileCoverage(request, deps);
  else if (request.operation === "backfill") result = await runBackfill(request, deps);
  else result = await runPrune(request, deps);
  klog("xp_leaderboard_maintenance", {
    operation: result.operation,
    period: result.period || null,
    dryRun: result.dryRun,
    processed: result.processed,
    missing: result.missing || 0,
    updated: result.updated || 0,
    removed: result.removed || 0,
    failed: result.failed || 0,
    hasMore: result.hasMore,
  });
  return result;
}

export {
  issueMaintenanceApplyToken,
  listAuthUsersPage,
  listProfilesPage,
  maintenanceRequestScope,
  maintenanceError,
  parseMaintenanceRequest,
  readCanonicalProjection,
  readEligibleProfileIds,
  readExistingProfileIds,
  runBackfill,
  runLeaderboardMaintenance,
  runProfileCoverage,
  runPrune,
  validateMaintenanceTarget,
  verifyMaintenanceApplyToken,
};
