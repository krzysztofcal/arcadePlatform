import crypto from "node:crypto";

const sanitizeXpCounter = (value) => Math.max(0, Math.floor(Number(value) || 0));
const hashLedgerPart = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

const XP_ATOMIC_AWARD_SCRIPT = `
  local sessionKey = KEYS[1]
  local sessionSyncKey = KEYS[2]
  local dailyKey = KEYS[3]
  local totalKey = KEYS[4]
  local lockKey = KEYS[5]
  local now = tonumber(ARGV[1])
  local delta = tonumber(ARGV[2])
  local dailyCap = tonumber(ARGV[3])
  local sessionCap = tonumber(ARGV[4])
  local ts = tonumber(ARGV[5])
  local lockTtl = tonumber(ARGV[6])
  local sessionTtl = tonumber(ARGV[7])

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
  sessionTotal = tonumber(redis.call('INCRBY', sessionKey, grant))
  lifetime = tonumber(redis.call('INCRBY', totalKey, grant))
  lastSync = ts
  redis.call('SET', sessionSyncKey, tostring(lastSync))
  refreshSessionTtl()
  return finish(grant, dailyTotal, sessionTotal, lifetime, lastSync, status)
`;

function createXpLedgerKeys({ namespace = "kcswh:xp:v2", lockPrefix = `${namespace}:lock:` } = {}) {
  const sessionHash = (userId, sessionId) => hashLedgerPart(`${userId}|${sessionId}`);
  return Object.freeze({
    daily: (userId, dayKey) => `${namespace}:daily:${userId}:${dayKey}`,
    total: (userId) => `${namespace}:total:${userId}`,
    session: (userId, sessionId) => `${namespace}:session:${sessionHash(userId, sessionId)}`,
    sessionSync: (userId, sessionId) => `${namespace}:session:last:${sessionHash(userId, sessionId)}`,
    sessionState: (userId, sessionId) => `${namespace}:session:state:${sessionHash(userId, sessionId)}`,
    lock: (userId, sessionId) => `${lockPrefix}${sessionHash(userId, sessionId)}`,
    registry: (userId, sessionId) => `${namespace}:registry:${sessionHash(userId, sessionId)}`,
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
    if (onError === "zero") return { current: 0, lifetime: 0, sessionTotal: 0, lastSync: 0 };
    throw error;
  }
}

async function executeAtomicXpAward({ store, script = XP_ATOMIC_AWARD_SCRIPT, keys, args, retryLocked = false, retryDelay, onEvalError }) {
  if (!store || typeof store.eval !== "function" || typeof script !== "string" || !Array.isArray(keys) || !Array.isArray(args)) {
    throw new TypeError("invalid_xp_award_dependencies");
  }
  const run = async () => {
    try { return await store.eval(script, keys, args.map(String)); }
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
