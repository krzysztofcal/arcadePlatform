import crypto from "node:crypto";
import { store } from "./_shared/store-upstash.mjs";

const asNumber = (raw, fallback) => {
  if (raw == null) return fallback;
  const sanitized = typeof raw === "string" ? raw.replace(/_/g, "") : raw;
  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const DAILY_CAP = asNumber(process.env.XP_DAILY_CAP, 600);
const SESSION_CAP = asNumber(process.env.XP_SESSION_CAP, 300);
const DELTA_CAP = asNumber(process.env.XP_DELTA_CAP, 300);
const SESSION_TTL_SEC = Math.max(0, asNumber(process.env.XP_SESSION_TTL_SEC, 604800));
const SESSION_TTL_MS = SESSION_TTL_SEC > 0 ? SESSION_TTL_SEC * 1000 : 0;
const REQUIRE_ACTIVITY = process.env.XP_REQUIRE_ACTIVITY === "1";
const MIN_ACTIVITY_EVENTS = Math.max(0, asNumber(process.env.XP_MIN_ACTIVITY_EVENTS, 4));
const MIN_ACTIVITY_VIS_S = Math.max(0, asNumber(process.env.XP_MIN_ACTIVITY_VIS_S, 8));
const METADATA_MAX_BYTES = Math.max(0, asNumber(process.env.XP_METADATA_MAX_BYTES, 2048));
const DEBUG_ENABLED = process.env.XP_DEBUG === "1";
const KEY_NS = process.env.XP_KEY_NS ?? "kcswh:xp:v2";
const DRIFT_MS = Math.max(0, asNumber(process.env.XP_DRIFT_MS, 30_000));
const CORS_ALLOW = (process.env.XP_CORS_ALLOW ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const RAW_LOCK_TTL = Number(process.env.XP_LOCK_TTL_MS ?? 3_000);
const LOCK_TTL_MS = Number.isFinite(RAW_LOCK_TTL) && RAW_LOCK_TTL > 0 ? RAW_LOCK_TTL : 3_000;

const json = (statusCode, obj, origin) => ({
  statusCode,
  headers: corsHeaders(origin),
  body: JSON.stringify(obj),
});

function corsHeaders(origin) {
  const allow = origin && CORS_ALLOW.includes(origin) ? origin : "*";
  return {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": allow,
    "access-control-allow-headers": "content-type,authorization,x-api-key",
    "access-control-allow-methods": "POST,OPTIONS",
    "cache-control": "no-store",
  };
}

const dayKey = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
const keyDaily = (u, day = dayKey()) => `${KEY_NS}:daily:${u}:${day}`;
const keyTotal = (u) => `${KEY_NS}:total:${u}`;
const keySession = (u, s) => `${KEY_NS}:session:${hash(`${u}|${s}`)}`;
const keySessionSync = (u, s) => `${KEY_NS}:session:last:${hash(`${u}|${s}`)}`;
const keyLock = (u, s) => `${KEY_NS}:lock:${hash(`${u}|${s}`)}`;

async function getTotals({ userId, sessionId, now = Date.now() }) {
  const todayKey = keyDaily(userId, dayKey(now));
  const totalKeyK = keyTotal(userId);
  const sessionKeyK = sessionId ? keySession(userId, sessionId) : null;
  const sessionSyncKeyK = sessionId ? keySessionSync(userId, sessionId) : null;
  try {
    const reads = [store.get(todayKey), store.get(totalKeyK)];
    if (sessionKeyK) reads.push(store.get(sessionKeyK));
    if (sessionSyncKeyK) reads.push(store.get(sessionSyncKeyK));
    const values = await Promise.all(reads);
    const current = Number(values[0] ?? "0") || 0;
    const lifetime = Number(values[1] ?? "0") || 0;
    const sessionTotal = sessionKeyK ? (Number(values[2] ?? "0") || 0) : 0;
    const lastSync = sessionSyncKeyK ? (Number(values[sessionKeyK ? 3 : 2] ?? "0") || 0) : 0;
    return { current, lifetime, sessionTotal, lastSync };
  } catch {
    return { current: 0, lifetime: 0, sessionTotal: 0, lastSync: 0 };
  }
}

export async function handler(event) {
  const origin = event.headers?.origin;
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(origin) };
  if (event.httpMethod !== "POST")   return json(405, { error: "method_not_allowed" }, origin);

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "bad_json" }, origin); }

  const userId = typeof body.userId === "string" ? body.userId.trim() : null;
  const sessionIdRaw = body.sessionId;
  const sessionId = typeof sessionIdRaw === "string" ? sessionIdRaw.trim() : null;

  if (!userId || (!body.statusOnly && !sessionId)) {
    return json(400, { error: "missing_fields" }, origin);
  }
  if (body.statusOnly) {
    const { current, lifetime, sessionTotal, lastSync } = await getTotals({ userId, sessionId, now: Date.now() });
    const payload = {
      ok: true,
      awarded: 0,
      totalToday: current,
      cap: DAILY_CAP,
      capDelta: DELTA_CAP,
      totalLifetime: lifetime,
      sessionTotal,
      lastSync,
      status: "statusOnly",
    };
    if (DEBUG_ENABLED) {
      payload.debug = { mode: "statusOnly" };
    }
    return json(200, payload, origin);
  }

  let deltaRaw = Number(body.delta);
  if (!Number.isFinite(deltaRaw)) {
    const scoreDelta = Number(body.scoreDelta);
    const pointsPerPeriod = Number(body.pointsPerPeriod);
    if (Number.isFinite(scoreDelta)) deltaRaw = scoreDelta;
    else if (Number.isFinite(pointsPerPeriod)) deltaRaw = pointsPerPeriod;
  }
  if (!Number.isFinite(deltaRaw) || deltaRaw < 0) {
    return json(422, { error: "invalid_delta" }, origin);
  }
  const normalizedDelta = Math.floor(deltaRaw);
  if (normalizedDelta < 0) {
    return json(422, { error: "invalid_delta" }, origin);
  }
  if (normalizedDelta > DELTA_CAP) {
    return json(422, { error: "delta_out_of_range", cap: DELTA_CAP, capDelta: DELTA_CAP }, origin);
  }

  const now = Date.now();
  const tsRaw = Number(body.ts ?? body.timestamp ?? body.windowEnd ?? now);
  if (!Number.isFinite(tsRaw) || tsRaw <= 0) {
    return json(422, { error: "invalid_timestamp" }, origin);
  }
  if (tsRaw > now + DRIFT_MS) {
    return json(422, { error: "timestamp_in_future", driftMs: DRIFT_MS }, origin);
  }
  const ts = Math.trunc(tsRaw);

  let metadata = null;
  if (body.metadata !== undefined) {
    if (!body.metadata || typeof body.metadata !== "object" || Array.isArray(body.metadata)) {
      return json(400, { error: "invalid_metadata" }, origin);
    }
    const cleaned = {};
    for (const [key, value] of Object.entries(body.metadata)) {
      if (key === "userId" || key === "sessionId" || key === "delta" || key === "ts") continue;
      cleaned[key] = value;
    }

    const serialized = JSON.stringify(cleaned);
    const bytes = Buffer.byteLength(serialized, "utf8");
    const depthOk = (() => {
      const MAX_DEPTH = 3;
      const stack = [{ value: cleaned, depth: 1 }];
      while (stack.length) {
        const { value, depth } = stack.pop();
        if (!value || typeof value !== "object") continue;
        if (depth > MAX_DEPTH) return false;
        for (const nested of Object.values(value)) {
          if (nested && typeof nested === "object") {
            stack.push({ value: nested, depth: depth + 1 });
          }
        }
      }
      return true;
    })();

    if (METADATA_MAX_BYTES && bytes > METADATA_MAX_BYTES) {
      return json(413, { error: "metadata_too_large", limit: METADATA_MAX_BYTES }, origin);
    }
    if (!depthOk) {
      return json(413, { error: "metadata_too_large", limit: METADATA_MAX_BYTES, reason: "depth" }, origin);
    }
    metadata = cleaned;
  }

  const todayKey = keyDaily(userId, dayKey(now));
  const totalKeyK = keyTotal(userId);
  const sessionKeyK = keySession(userId, sessionId);
  const sessionSyncKeyK = keySessionSync(userId, sessionId);
  const lockKeyK = keyLock(userId, sessionId);

  if (REQUIRE_ACTIVITY && normalizedDelta > 0) {
    const events = Number(metadata?.inputEvents ?? 0);
    const visSeconds = Number(metadata?.visibilitySeconds ?? 0);
    if (!Number.isFinite(events) || events < MIN_ACTIVITY_EVENTS || !Number.isFinite(visSeconds) || visSeconds < MIN_ACTIVITY_VIS_S) {
      const { current, lifetime, sessionTotal, lastSync } = await getTotals({ userId, sessionId, now });
      const inactivePayload = {
        ok: true,
        awarded: 0,
        totalToday: current,
        totalLifetime: lifetime,
        sessionTotal,
        lastSync,
        cap: DAILY_CAP,
        capDelta: DELTA_CAP,
        reason: "inactive",
        status: "inactive",
      };
      if (DEBUG_ENABLED) {
        inactivePayload.debug = {
          mode: "inactive",
          delta: normalizedDelta,
          ts,
          sessionCap: SESSION_CAP,
          dailyCap: DAILY_CAP,
          lastSync,
        };
      }
      return json(200, inactivePayload, origin);
    }
  }

  const script = `
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

    local locked = redis.call('SET', lockKey, tostring(now), 'PX', lockTtl, 'NX')
    if locked ~= 'OK' then
      local currentDaily = tonumber(redis.call('GET', dailyKey) or '0')
      local sessionTotal = tonumber(redis.call('GET', sessionKey) or '0')
      local lifetime = tonumber(redis.call('GET', totalKey) or '0')
      local lastSync = tonumber(redis.call('GET', sessionSyncKey) or '0')
      return {0, currentDaily, sessionTotal, lifetime, lastSync, 6}
    end

    local function refreshSessionTtl()
      if sessionTtl and sessionTtl > 0 then
        redis.call('PEXPIRE', sessionKey, sessionTtl)
        redis.call('PEXPIRE', sessionSyncKey, sessionTtl)
      end
    end

    local function finish(grant, dailyTotal, sessionTotal, lifetime, sync, status)
      redis.call('DEL', lockKey)
      return {grant, dailyTotal, sessionTotal, lifetime, sync, status}
    end

    local sessionTotal = tonumber(redis.call('GET', sessionKey) or '0')
    local lastSync = tonumber(redis.call('GET', sessionSyncKey) or '0')
    local dailyTotal = tonumber(redis.call('GET', dailyKey) or '0')
    local lifetime = tonumber(redis.call('GET', totalKey) or '0')

    if lastSync > 0 and ts <= lastSync then
      return finish(0, dailyTotal, sessionTotal, lifetime, lastSync, 2)
    end

    local remainingDaily = dailyCap - dailyTotal
    if remainingDaily <= 0 then
      return finish(0, dailyTotal, sessionTotal, lifetime, lastSync, 3)
    end

    local remainingSession = sessionCap - sessionTotal
    if remainingSession <= 0 then
      return finish(0, dailyTotal, sessionTotal, lifetime, lastSync, 5)
    end

    local grant = delta
    local status = 0
    if grant > remainingDaily then
      grant = remainingDaily
      status = 1
    end
    if grant > remainingSession then
      grant = remainingSession
      status = 4
    end

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

  const res = await store.eval(
    script,
    [sessionKeyK, sessionSyncKeyK, todayKey, totalKeyK, lockKeyK],
    [
      String(now),
      String(normalizedDelta),
      String(DAILY_CAP),
      String(Math.max(0, SESSION_CAP)),
      String(ts),
      String(LOCK_TTL_MS),
      String(SESSION_TTL_MS),
    ]
  );

  const granted = Number(res?.[0]) || 0;
  const totalToday = Number(res?.[1]) || 0;
  const sessionTotal = Number(res?.[2]) || 0;
  const totalLifetime = Number(res?.[3]) || 0;
  const lastSync = Number(res?.[4]) || 0;
  const status = Number(res?.[5]) || 0;

  const payload = {
    ok: true,
    awarded: granted,
    totalToday,
    cap: DAILY_CAP,
    capDelta: DELTA_CAP,
    totalLifetime,
    sessionTotal,
    lastSync,
  };

  const statusReasons = {
    1: "daily_cap_partial",
    2: "stale",
    3: "daily_cap",
    4: "session_cap_partial",
    5: "session_cap",
    6: "locked",
  };

  if (status === 1 || status === 3) {
    payload.capped = true;
  }
  if (status === 4 || status === 5) {
    payload.sessionCapped = true;
  }
  if (status === 2) {
    payload.stale = true;
    payload.awarded = 0;
  }
  if (status === 6) {
    payload.locked = true;
    payload.awarded = 0;
  }

  const reason = statusReasons[status];
  if (reason) {
    payload.reason = reason;
  } else if (granted < normalizedDelta) {
    payload.reason = normalizedDelta > 0 ? "partial" : undefined;
  }

  if (!payload.status) {
    if (status === 0 && normalizedDelta === granted) {
      payload.status = "ok";
    } else if (status === 1 || status === 4 || (status === 0 && granted < normalizedDelta)) {
      payload.status = "partial";
    } else if (reason) {
      payload.status = reason;
    }
  }

  if (DEBUG_ENABLED) {
      payload.debug = {
        delta: normalizedDelta,
        ts,
        now,
        status,
        requested: normalizedDelta,
        sessionCap: SESSION_CAP,
        dailyCap: DAILY_CAP,
        lastSync,
      };
    if (reason) payload.debug.reason = reason;
  }

  return json(200, payload, origin);
}
