import crypto from "node:crypto";
import { BUILD_DEPLOY_CONTEXT, BUILD_XP_REDIS_VERSION, BUILD_XP_REDIS_ENV } from "../_generated/deploy-context.mjs";

const sanitizeXpCounter = (value) => Math.max(0, Math.floor(Number(value) || 0));
const hashLedgerPart = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

const XP_ATOMIC_AWARD_SCRIPT = `
  local sessionKey = KEYS[1]
  local sessionSyncKey = KEYS[2]
  local dailyKey = KEYS[3]
  local totalKey = KEYS[4]
  local lockKey = KEYS[5]
  local leaderboardAllTimeKey = KEYS[6]
  local leaderboardDayKey = KEYS[7]
  local leaderboardWeekKey = KEYS[8]
  local leaderboardHiddenKey = KEYS[9]
  local now = tonumber(ARGV[1])
  local delta = tonumber(ARGV[2])
  local dailyCap = tonumber(ARGV[3])
  local sessionCap = tonumber(ARGV[4])
  local ts = tonumber(ARGV[5])
  local lockTtl = tonumber(ARGV[6])
  local sessionTtl = tonumber(ARGV[7])
  local leaderboardMember = ARGV[8]
  local dayExpiresAt = tonumber(ARGV[9])
  local weekExpiresAt = tonumber(ARGV[10])

  local shouldLock = lockTtl and lockTtl > 0
  if shouldLock then
    local locked = redis.call('SET', lockKey, tostring(now), 'PX', lockTtl, 'NX')
    if locked ~= 'OK' then
      local currentDaily = tonumber(redis.call('GET', dailyKey) or '0')
      local sessionTotal = tonumber(redis.call('GET', sessionKey) or '0')
      local lifetime = tonumber(redis.call('GET', totalKey) or '0')
      local lastSync = tonumber(redis.call('GET', sessionSyncKey) or '0')
      local lockedAt = tonumber(redis.call('GET', lockKey) or '0')
      local lockTtlRemaining = tonumber(redis.call('PTTL', lockKey) or -1)
      return {0, currentDaily, sessionTotal, lifetime, lastSync, 6, lockedAt, lockTtlRemaining}
    end
  end

  local function refreshSessionTtl()
    if sessionTtl and sessionTtl > 0 then
      redis.call('PEXPIRE', sessionKey, sessionTtl)
      redis.call('PEXPIRE', sessionSyncKey, sessionTtl)
    end
  end

  local function finish(grant, dailyTotal, sessionTotal, lifetime, sync, status, lockedAt, lockTtlRemaining)
    if shouldLock then redis.call('DEL', lockKey) end
    return {grant, dailyTotal, sessionTotal, lifetime, sync, status, lockedAt, lockTtlRemaining}
  end

  local sessionTotal = tonumber(redis.call('GET', sessionKey) or '0')
  local lastSync = tonumber(redis.call('GET', sessionSyncKey) or '0')
  local dailyTotal = tonumber(redis.call('GET', dailyKey) or '0')
  local lifetime = tonumber(redis.call('GET', totalKey) or '0')

  if lastSync > 0 and ts <= lastSync then return finish(0, dailyTotal, sessionTotal, lifetime, lastSync, 2) end
  local remainingDaily = dailyCap - dailyTotal
  if remainingDaily <= 0 then return finish(0, dailyTotal, sessionTotal, lifetime, lastSync, 3) end
  local remainingSession = sessionCap - sessionTotal
  if remainingSession <= 0 then return finish(0, dailyTotal, sessionTotal, lifetime, lastSync, 5) end

  local grant = delta
  local status = 0
  if grant > remainingDaily then grant = remainingDaily status = 1 end
  if grant > remainingSession then grant = remainingSession status = 4 end
  if grant <= 0 then
    if ts > lastSync then
      lastSync = ts
      redis.call('SET', sessionSyncKey, tostring(lastSync))
      refreshSessionTtl()
    end
    return finish(0, dailyTotal, sessionTotal, lifetime, lastSync, status)
  end

  dailyTotal = tonumber(redis.call('INCRBY', dailyKey, grant))
  if dayExpiresAt and dayExpiresAt > 0 then redis.call('EXPIREAT', dailyKey, dayExpiresAt) end
  sessionTotal = tonumber(redis.call('INCRBY', sessionKey, grant))
  lifetime = tonumber(redis.call('INCRBY', totalKey, grant))
  lastSync = ts
  redis.call('SET', sessionSyncKey, tostring(lastSync))
  refreshSessionTtl()
  local leaderboardVisible = not leaderboardHiddenKey or leaderboardHiddenKey == '' or redis.call('EXISTS', leaderboardHiddenKey) == 0
  if leaderboardMember and leaderboardMember ~= '' and leaderboardVisible then
    redis.call('ZADD', leaderboardAllTimeKey, lifetime, leaderboardMember)
    redis.call('ZADD', leaderboardDayKey, dailyTotal, leaderboardMember)
    redis.call('ZINCRBY', leaderboardWeekKey, grant, leaderboardMember)
    if dayExpiresAt and dayExpiresAt > 0 then redis.call('EXPIREAT', leaderboardDayKey, dayExpiresAt) end
    if weekExpiresAt and weekExpiresAt > 0 then redis.call('EXPIREAT', leaderboardWeekKey, weekExpiresAt) end
  end
  return finish(grant, dailyTotal, sessionTotal, lifetime, lastSync, status)
`;

// V3 is opt-in at the separately authorized cutover. Legacy is never read by V3.
export function resolveXpNamespace(env = process.env, buildContext = BUILD_DEPLOY_CONTEXT,
  pin = {version:BUILD_XP_REDIS_VERSION,environment:BUILD_XP_REDIS_ENV}) {
  const version = env.XP_REDIS_VERSION;
  const namespace = env.XP_KEY_NS;
  const environment = env.XP_REDIS_ENV;
  const testing = env.XP_TEST_MODE === "1";
  const v3Intent = pin.version === "3" || version === "3" || !!environment || /:v3(?:$|:)/.test(namespace || "");
  if (!v3Intent) {
    if (version && version !== "2") throw new Error("xp_redis_version_invalid");
    if (pin.version || pin.environment) throw new Error("xp_redis_build_pin_invalid");
    if (!namespace || namespace === "kcswh:xp:v2") return "kcswh:xp:v2";
    if (testing && /^(test|e2e):[A-Za-z0-9:_-]+$/.test(namespace)) return namespace;
    throw new Error("xp_redis_environment_mismatch");
  }
  if (version !== "3" || !["stage","prod"].includes(environment) || namespace !== `kcswh:${environment}:xp:v3`) {
    throw new Error("xp_redis_environment_mismatch");
  }
  // An environment flag alone is removable. Activation requires an immutable
  // pin in the Netlify/WS/background artifact; missing runtime vars then deny.
  if (!testing && (pin.version !== "3" || pin.environment !== environment)) throw new Error("xp_redis_build_pin_invalid");
  if (pin.version && (pin.version !== "3" || pin.environment !== environment)) throw new Error("xp_redis_build_pin_invalid");
  const contexts = [buildContext,env.ARCADE_DEPLOY_TARGET,env.CONTEXT,env.NETLIFY_CONTEXT].filter(value=>value && value!=="unknown");
  if (!contexts.length && !testing) throw new Error("xp_redis_environment_unpinned");
  for (const context of contexts) {
    if (!["production","deploy-preview","branch-deploy","development","dev"].includes(context)) throw new Error("xp_redis_environment_unpinned");
    if ((context === "production" ? "prod" : "stage") !== environment) throw new Error("xp_redis_environment_mismatch");
  }
  return namespace;
}

export const isXpV3 = (namespace) => /^kcswh:(stage|prod):xp:v3$/.test(namespace);
export function xpOwnerPrefix(namespace, userId, anonymous = false) {
  if (!isXpV3(namespace)) throw new Error("xp_v3_namespace_required");
  if (anonymous) {
    if (typeof userId !== "string" || !userId.length) throw new Error("xp_identity_required");
    return `${namespace}:anon:${hashLedgerPart(userId)}:`;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) throw new Error("xp_uuid_required");
  return `${namespace}:user:${userId.toLowerCase()}:`;
}
function createXpLedgerKeys({ namespace = resolveXpNamespace(), lockPrefix = `${namespace}:lock:`, anonymous = false } = {}) {
  const v3 = isXpV3(namespace);
  const own = (id, suffix) => xpOwnerPrefix(namespace, id, anonymous) + suffix;
  const sessionHash = (userId, sessionId) => hashLedgerPart(`${userId}|${sessionId}`);
  return Object.freeze({
    daily: (id, day) => v3 ? own(id, `daily:${day}`) : `${namespace}:daily:${id}:${day}`,
    total: (id) => v3 ? own(id, "total") : `${namespace}:total:${id}`,
    session: (id, sid) => v3 ? own(id, `session:${hashLedgerPart(sid)}`) : `${namespace}:session:${sessionHash(id, sid)}`,
    sessionSync: (id, sid) => v3 ? own(id, `sync:${hashLedgerPart(sid)}`) : `${namespace}:session:last:${sessionHash(id, sid)}`,
    sessionState: (id, sid) => v3 ? own(id, `state:${hashLedgerPart(sid)}`) : `${namespace}:session:state:${sessionHash(id, sid)}`,
    lock: (id, sid) => v3 ? own(id, `lock:${hashLedgerPart(sid)}`) : `${lockPrefix}${sessionHash(id, sid)}`,
    registry: (id, sid) => v3 ? own(id, `registry:${hashLedgerPart(sid)}`) : `${namespace}:registry:${sessionHash(id, sid)}`,
    serverSession: (id, sid) => v3 ? own(id, `server-session:${hashLedgerPart(sid)}`) : `${namespace}:server-session:${sid}`,
    profile: (id) => v3 ? own(id, "profile") : `kcswh:xp:user:${id}`,
    hidden: (id) => v3 ? own(id, "hidden") : `${namespace}:leaderboard:v1:hidden:${id}`,
    rateLimit: (id, minute) => v3 ? own(id, `ratelimit:${minute}`) : `${namespace}:ratelimit:user:${id}:${minute}`,
    migration: (anon, id) => v3 ? own(id, `conversion:${hashLedgerPart(anon)}`) : `${namespace}:migration:${hashLedgerPart(`${anon}|${id}`)}`,
    userMigration: (id) => v3 ? own(id, "conversion-once") : `${namespace}:migration:user:${hashLedgerPart(id)}`,
  });
}

async function readXpTotals({ store, keys, userId, sessionId, dayKey, onError = "throw" }) {
  if (!userId) return { current: 0, lifetime: 0, sessionTotal: 0, lastSync: 0 };
  if (!store || typeof store.get !== "function" || !keys || !dayKey) throw new TypeError("invalid_xp_totals_dependencies");
  const hasSession = typeof sessionId === "string" && sessionId.length > 0;
  try {
    const reads = [store.get(keys.daily(userId, dayKey)), store.get(keys.total(userId))];
    if (hasSession) reads.push(store.get(keys.session(userId, sessionId)), store.get(keys.sessionSync(userId, sessionId)));
    const values = await Promise.all(reads);
    return {
      current: sanitizeXpCounter(values[0]),
      lifetime: sanitizeXpCounter(values[1]),
      sessionTotal: hasSession ? sanitizeXpCounter(values[2]) : 0,
      lastSync: hasSession ? sanitizeXpCounter(values[3]) : 0,
    };
  } catch (error) {
    if (error?.code === "xp_store_unavailable") throw error;
    if (onError === "zero") return { current: 0, lifetime: 0, sessionTotal: 0, lastSync: 0 };
    throw error;
  }
}

async function executeAtomicXpAward({ store, userId, anonymous = false, beginSql, script = XP_ATOMIC_AWARD_SCRIPT, keys, args, retryLocked = false, retryDelay, onEvalError }) {
  if (!store || typeof store.eval !== "function" || typeof script !== "string" || !Array.isArray(keys) || !Array.isArray(args)) {
    throw new TypeError("invalid_xp_award_dependencies");
  }
  const { guardedRedisEval } = await import("./store-upstash.mjs");
  const run = async () => {
    try {
      if (process.env.ACCOUNT_DELETION_ENABLED === '1' && !userId) throw new Error('xp_award_identity_required');
      return await guardedRedisEval({ store, userIds: [userId], anonymousIds: anonymous ? [userId] : [], script, keys, args: args.map(String), beginSql });
    }
    catch (error) { if (typeof onEvalError === "function") onEvalError(error); throw error; }
  };
  let result = await run();
  let status = Number(result?.[5]) || 0;
  if (status === 6 && retryLocked) {
    if (typeof retryDelay === "function") await retryDelay();
    result = await run();
    status = Number(result?.[5]) || 0;
  }
  const lockTtl = Number(result?.[7]);
  return {
    granted: sanitizeXpCounter(result?.[0]),
    dailyTotal: sanitizeXpCounter(result?.[1]),
    sessionTotal: sanitizeXpCounter(result?.[2]),
    lifetime: sanitizeXpCounter(result?.[3]),
    lastSync: sanitizeXpCounter(result?.[4]),
    status,
    lockedAt: sanitizeXpCounter(result?.[6]),
    lockTtlRemainingMs: Number.isFinite(lockTtl) ? lockTtl : null,
    raw: result,
  };
}

export { XP_ATOMIC_AWARD_SCRIPT, createXpLedgerKeys, executeAtomicXpAward, readXpTotals, sanitizeXpCounter };
