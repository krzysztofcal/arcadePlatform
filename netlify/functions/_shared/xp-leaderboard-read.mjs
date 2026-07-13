import { executeSql } from "./supabase-admin.mjs";
import { store as defaultStore } from "./store-upstash.mjs";
import { publicProfile } from "./user-profile.mjs";
import { computeXpLevel } from "./xp-level.mjs";
import { createXpLeaderboardKeys, getXpLeaderboardPeriods } from "./xp-leaderboard.mjs";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const MAX_PAGE = 20;
const PERIODS = new Set(["today", "week", "all_time"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function leaderboardError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function parsePositiveInteger(value, fallback, max, code) {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(String(value))) throw leaderboardError(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw leaderboardError(code);
  return parsed;
}

function parseLeaderboardQuery(query = {}, { me = false } = {}) {
  const allowed = me ? new Set(["period"]) : new Set(["period", "page", "limit"]);
  if (Object.keys(query || {}).some((key) => !allowed.has(key))) throw leaderboardError("invalid_request");
  const period = typeof query?.period === "string" && query.period ? query.period.trim().toLowerCase() : "all_time";
  if (!PERIODS.has(period)) throw leaderboardError("invalid_period");
  return {
    period,
    page: me ? 1 : parsePositiveInteger(query?.page, 1, MAX_PAGE, "invalid_page"),
    limit: me ? 1 : parsePositiveInteger(query?.limit, DEFAULT_LIMIT, MAX_LIMIT, "invalid_limit"),
  };
}

function resolveLeaderboardPeriod({ period, namespace, nowMs }) {
  const periods = getXpLeaderboardPeriods(nowMs);
  const keys = createXpLeaderboardKeys({ namespace });
  if (period === "today") {
    return { key: keys.day(periods.dayKey), periodKey: periods.dayKey, nextResetAt: periods.nextDayResetAt };
  }
  if (period === "week") {
    return { key: keys.week(periods.weekKey), periodKey: periods.weekKey, nextResetAt: periods.nextWeekResetAt };
  }
  return { key: keys.allTime(), periodKey: "all_time", nextResetAt: null };
}

function normalizeScore(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function normalizeProfileRow(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    handle: row.handle,
    displayName: row.display_name,
    bio: "",
    avatarKey: row.avatar_key || null,
    avatarVariant: row.avatar_variant,
    handleCustomizedAt: null,
  };
}

async function readLeaderboardProfiles(userIds, runSql = executeSql) {
  const validIds = [...new Set(userIds.filter((userId) => UUID_RE.test(userId)))];
  if (!validIds.length) return new Map();
  const rows = await runSql(
    `select user_id::text, handle, display_name, avatar_key, avatar_variant
     from public.user_profiles
     where user_id = any($1::uuid[]) and leaderboard_visible = true;`,
    [validIds],
  );
  return new Map((rows || []).map((row) => {
    const profile = normalizeProfileRow(row);
    return [profile.userId, profile];
  }));
}

function projectLeaderboardProfile(profile, { rank, xp, lifetimeXp }) {
  const projected = publicProfile(profile);
  return {
    rank,
    handle: projected.handle,
    displayName: projected.displayName,
    avatar: projected.avatar,
    xp,
    level: computeXpLevel(lifetimeXp),
    profileUrl: `/u/${encodeURIComponent(projected.handle)}`,
  };
}

async function readLifetimeXp(store, namespace, candidates, period) {
  if (period === "all_time") return candidates.map((candidate) => candidate.score);
  const values = await store.mget(candidates.map((candidate) => `${namespace}:total:${candidate.member}`));
  return values.map((value, index) => {
    if (value == null && candidates[index].score > 0) throw leaderboardError("leaderboard_projection_inconsistent", 503);
    const parsed = Number(value);
    if (value != null && !Number.isFinite(parsed)) throw leaderboardError("leaderboard_projection_inconsistent", 503);
    return normalizeScore(value);
  });
}

async function competitionRanks(store, key, scores) {
  const distinct = [...new Set(scores)];
  const entries = await Promise.all(distinct.map(async (score) => [score, 1 + await store.zcount(key, `(${score}`, "+inf")]));
  return new Map(entries);
}

async function readLeaderboardPage(options, deps = {}) {
  const store = deps.store || defaultStore;
  const namespace = deps.namespace || process.env.XP_KEY_NS || "kcswh:xp:v2";
  const nowMs = Number.isFinite(deps.nowMs) ? deps.nowMs : Date.now();
  const readProfiles = deps.readProfiles || readLeaderboardProfiles;
  const { period, page, limit } = options;
  const periodState = resolveLeaderboardPeriod({ period, namespace, nowMs });
  const offset = (page - 1) * limit;
  const redisStartedAt = Date.now();
  const [rawRows, total] = await Promise.all([
    store.zrevrangeWithScores(periodState.key, offset, offset + limit - 1),
    store.zcard(periodState.key),
  ]);
  const candidates = rawRows.map((row) => ({ member: String(row.member), score: normalizeScore(row.score) }));
  const validCandidates = candidates.filter((candidate) => UUID_RE.test(candidate.member) && candidate.score > 0);
  const ranks = await competitionRanks(store, periodState.key, candidates.map((row) => row.score));
  const lifetimeValues = await readLifetimeXp(store, namespace, validCandidates, period);
  const redisMs = Date.now() - redisStartedAt;
  const profilesStartedAt = Date.now();
  const profiles = await readProfiles(validCandidates.map((row) => row.member), deps.executeSql);
  const rows = [];
  for (let index = 0; index < validCandidates.length; index += 1) {
    const candidate = validCandidates[index];
    const profile = profiles.get(candidate.member);
    if (!profile) continue;
    rows.push(projectLeaderboardProfile(profile, {
      rank: ranks.get(candidate.score),
      xp: candidate.score,
      lifetimeXp: lifetimeValues[index],
    }));
  }
  return {
    response: {
      period,
      periodKey: periodState.periodKey,
      nextResetAt: periodState.nextResetAt,
      generatedAt: nowMs,
      page,
      limit,
      hasMore: offset + candidates.length < total,
      rows,
    },
    diagnostics: {
      rawRows: candidates.length,
      publicRows: rows.length,
      missingProfiles: validCandidates.length - rows.length,
      invalidMembers: candidates.length - validCandidates.length,
      redisMs,
      profileMs: Date.now() - profilesStartedAt,
    },
  };
}

async function readLeaderboardMe(options, userId, deps = {}) {
  const store = deps.store || defaultStore;
  const namespace = deps.namespace || process.env.XP_KEY_NS || "kcswh:xp:v2";
  const nowMs = Number.isFinite(deps.nowMs) ? deps.nowMs : Date.now();
  const readProfiles = deps.readProfiles || readLeaderboardProfiles;
  const periodState = resolveLeaderboardPeriod({ period: options.period, namespace, nowMs });
  const rawScore = await store.zscore(periodState.key, userId);
  const score = rawScore == null ? 0 : normalizeScore(rawScore);
  let me = null;
  let missingProfiles = 0;
  if (score > 0) {
    const [profiles, greaterCount, lifetimeXp] = await Promise.all([
      readProfiles([userId], deps.executeSql),
      store.zcount(periodState.key, `(${score}`, "+inf"),
      readLifetimeXp(store, namespace, [{ member: userId, score }], options.period).then((values) => values[0]),
    ]);
    const profile = profiles.get(userId);
    if (profile) me = projectLeaderboardProfile(profile, { rank: greaterCount + 1, xp: score, lifetimeXp });
    else missingProfiles = 1;
  }
  return {
    response: {
      period: options.period,
      periodKey: periodState.periodKey,
      nextResetAt: periodState.nextResetAt,
      generatedAt: nowMs,
      me,
    },
    diagnostics: { missingProfiles },
  };
}

export {
  leaderboardError,
  parseLeaderboardQuery,
  readLeaderboardMe,
  readLeaderboardPage,
  readLeaderboardProfiles,
  resolveLeaderboardPeriod,
};
