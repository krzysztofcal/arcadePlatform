import crypto from "node:crypto";
import { store } from "./_shared/store-upstash.mjs";
import {
  asNumber,
  getDailyCap,
  getDailyKey,
  getNextResetEpoch,
  getTotals,
  keyDaily,
  keyLock,
  keySession,
  keySessionSync,
  keyTotal,
} from "./lib/daily-totals.mjs";

const XP_DAY_COOKIE = "xp_day";

const DEBUG_ENABLED = process.env.XP_DEBUG === "1";

const CORS_ALLOW = (process.env.XP_CORS_ALLOW ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const RAW_LOCK_TTL = Number(process.env.XP_LOCK_TTL_MS ?? 3_000);
const LOCK_TTL_MS = Number.isFinite(RAW_LOCK_TTL) && RAW_LOCK_TTL >= 0 ? RAW_LOCK_TTL : 3_000;

const sanitizeTotal = (value) => Math.max(0, Math.floor(Number(value) || 0));

const signPayload = (payload, secret) =>
  crypto.createHmac("sha256", secret).update(payload).digest("base64url");

const safeEquals = (a, b) => {
  if (a.length !== b.length) return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

const parseCookies = (header) => {
  if (!header || typeof header !== "string") return {};
  const jar = {};
  const parts = header.split(/;\s*/);
  for (const part of parts) {
    if (!part) continue;
    const [name, ...rest] = part.split("=");
    if (!name) continue;
    jar[name.trim()] = rest.join("=");
  }
  return jar;
};

const readXpCookie = (header, secret) => {
  const cookies = parseCookies(header);
  const raw = cookies[XP_DAY_COOKIE];
  if (!raw) return { key: null, total: 0, uid: null };
  const [encodedPayload, signature] = raw.split(".");
  if (!encodedPayload || !signature) return { key: null, total: 0, uid: null };

  let payloadJson;
  try {
    payloadJson = Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    return { key: null, total: 0, uid: null };
  }

  const expectedSig = signPayload(payloadJson, secret);
  if (!safeEquals(signature, expectedSig)) {
    return { key: null, total: 0, uid: null };
  }

  try {
    const parsed = JSON.parse(payloadJson);
    const key = typeof parsed?.k === "string" ? parsed.k : null;
    const total = sanitizeTotal(parsed?.t);
    const uid = typeof parsed?.u === "string" ? parsed.u : null;
    if (!key) return { key: null, total: 0, uid: null };
    return { key, total, uid };
  } catch {
    return { key: null, total: 0, uid: null };
  }
};

const buildXpCookie = ({ key, userId, total, cap, secret, secure, now, nextReset }) => {
  const safeTotal = Math.min(
    Math.max(0, Math.floor(Number(total) || 0)),
    Math.max(0, Math.floor(Number(cap) || 0))
  );
  const payload = JSON.stringify({ k: key, u: String(userId || ""), t: safeTotal });
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const signature = signPayload(payload, secret);
  const maxAge = Math.max(0, Math.floor(Math.max(0, nextReset - now) / 1000));
  const secureAttr = secure ? "; Secure" : "";
  return `${XP_DAY_COOKIE}=${encoded}.${signature}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secureAttr}`;
};

const json = (statusCode, obj, origin, extraHeaders) => {
  const headers = { ...corsHeaders(origin) };
  if (extraHeaders && typeof extraHeaders === "object") {
    for (const [key, value] of Object.entries(extraHeaders)) {
      if (value !== undefined) headers[key] = value;
    }
  }
  return {
    statusCode,
    headers,
    body: JSON.stringify(obj),
  };
};

function corsHeaders(origin) {
  const allow = origin && CORS_ALLOW.includes(origin) ? origin : "*";
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": allow,
    "access-control-allow-headers": "content-type,authorization,x-api-key",
    "access-control-allow-methods": "POST,OPTIONS",
    "cache-control": "no-store",
  };
  if (allow !== "*") headers["Vary"] = "Origin";
  return headers;
}

function resolveCfg(env = (typeof process !== "undefined" ? process.env : {})) {
  const num = (k, d) => {
    const v = Number(env[k] ?? d);
    return Number.isFinite(v) ? v : d;
  };
  return {
    ns: env.XP_KEY_NS ?? "kcswh:xp:v2",
    dailyCap: Math.max(0, num("XP_DAILY_CAP", 3000)),
    sessionCap: Math.max(0, num("XP_SESSION_CAP", 300)),
    deltaCap: Math.max(0, num("XP_DELTA_CAP", 300)),
    sessionTtlMs: Math.max(0, num("XP_SESSION_TTL_SEC", 604800)) * 1000,
    requireActivity: env.XP_REQUIRE_ACTIVITY === "1",
    minEvents: Math.max(0, num("XP_MIN_ACTIVITY_EVENTS", 4)),
    minVisS: Math.max(0, num("XP_MIN_ACTIVITY_VIS_S", 8)),
    metadataMax: Math.max(0, num("XP_METADATA_MAX_BYTES", 2048)),
    driftMs: Math.max(0, num("XP_DRIFT_MS", 30000)),
    cookieSecure: env.XP_COOKIE_SECURE === "1",
    debug: env.XP_DEBUG === "1",
  };
}

export async function handler(event) {
  const origin = event.headers?.origin;
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(origin) };

  const secret = process.env.XP_DAILY_SECRET;
  if (!secret) {
    return json(500, { error: "server_config", message: "xp_daily_secret_missing" }, origin);
  }

  const cfg = resolveCfg();
  const DEBUG_ENABLED = cfg.debug;
  const now = Date.now();
  const dayKeyNow = getDailyKey(now);
  const nextReset = getNextResetEpoch(now);
  const cookieHeader = event.headers?.cookie ?? event.headers?.Cookie ?? "";
  const cookieState = readXpCookie(cookieHeader, secret);
  
  // AFTER (let + provisional values used for early error paths)
  let cookieKeyMatches = cookieState.key === dayKeyNow;
  let cookieTotal = cookieKeyMatches ? sanitizeTotal(cookieState.total) : 0;
  let cookieRemainingBefore = Math.max(0, cfg.dailyCap - cookieTotal);



  const queryUserId = typeof event.queryStringParameters?.userId === "string"
    ? event.queryStringParameters.userId.trim()
    : null;
  const querySessionId = typeof event.queryStringParameters?.sessionId === "string"
    ? event.queryStringParameters.sessionId.trim()
    : null;

  const applyDiagnostics = (payload, extra = {}) => {
    if (!DEBUG_ENABLED) return;
    const debug = payload.debug ?? {};
    if (debug.redisDailyTotalRaw === undefined && extra.redisDailyTotalRaw !== undefined) {
      debug.redisDailyTotalRaw = extra.redisDailyTotalRaw;
    }
    if (extra.redisDailyTotal !== undefined) {
      debug.redisDailyTotal = extra.redisDailyTotal;
    }
    debug.cookieKey = cookieState.key;
    debug.cookieTotal = cookieState.total;
    debug.cookieTotalSanitized = cookieTotal;
    debug.cookieRemainingBefore = cookieRemainingBefore;
    Object.assign(debug, extra);
    payload.debug = debug;
  };

  const buildResponse = (statusCode, payload, totalTodaySource, options = {}) => {
    const { debugExtra = {}, skipCookie = false, totals = null } = options;
    const resolvedCap = (() => {
      if (totals && Number.isFinite(totals.cap)) return Math.max(0, Math.floor(totals.cap));
      if (Number.isFinite(payload.cap)) return Math.max(0, Math.floor(payload.cap));
      return cfg.dailyCap;
    })();
    const safeTotal = Math.min(resolvedCap, Math.max(0, sanitizeTotal(totalTodaySource)));
    const remaining = Math.max(0, resolvedCap - safeTotal);
    payload.cap = resolvedCap;
    payload.dailyCap = resolvedCap;
    payload.totalToday = safeTotal;
    payload.awardedToday = safeTotal;
    payload.remaining = remaining;
    payload.remainingToday = remaining;
    payload.dayKey = totals?.dayKey || payload.dayKey || dayKeyNow;
    const resolvedReset = Number.isFinite(totals?.nextReset)
      ? totals.nextReset
      : (payload.nextReset ?? nextReset);
    payload.nextReset = resolvedReset;
    payload.nextResetEpoch = resolvedReset;
    if (payload.totalLifetime != null && Number.isFinite(payload.totalLifetime)) {
      payload.totalXp = payload.totalLifetime;
    } else if (totals && Number.isFinite(totals.lifetime)) {
      payload.totalXp = totals.lifetime;
    }
    payload.__serverHasDaily = true;
    applyDiagnostics(payload, {
      redisDailyTotalRaw: totalTodaySource,
      redisDailyTotal: safeTotal,
      remainingAfter: remaining,
      ...debugExtra,
    });
    const headers = skipCookie
      ? undefined
      : { "Set-Cookie": buildXpCookie({
          key: dayKeyNow,
          userId: options.cookieUserId ?? null,
          total: safeTotal,
          cap: resolvedCap,
          secret,
          secure: cfg.cookieSecure,
          now,
          nextReset
        }) };
    return json(statusCode, payload, origin, headers);
  };

  if (event.httpMethod !== "POST") {
    let totals = null;
    if (queryUserId) {
      totals = await getTotals({ userId: queryUserId, sessionId: querySessionId, now, keyNamespace: cfg.ns });
    }
    const totalSource = totals ? totals.current : cookieTotal;
    const payload = { error: "method_not_allowed" };
    return buildResponse(405, payload, totalSource, {
      debugExtra: { mode: "method_not_allowed" },
      skipCookie: !queryUserId,
      cookieUserId: queryUserId,
    });
  }

  let body = {};
  try {
    if (event.body) {
      body = JSON.parse(event.body);
    }
  } catch {
    let totals = null;
    if (queryUserId) {
      totals = await getTotals({ userId: queryUserId, sessionId: querySessionId, now, keyNamespace: cfg.ns });
    }
    const totalSource = totals ? totals.current : cookieTotal;
    const payload = { error: "bad_json" };
    return buildResponse(400, payload, totalSource, {
      debugExtra: { mode: "bad_json" },
      skipCookie: !queryUserId,
      cookieUserId: queryUserId,
    });
  }

  const userId = typeof body.userId === "string" ? body.userId.trim() : queryUserId;
  const sessionIdRaw = body.sessionId ?? querySessionId;
  const sessionId = typeof sessionIdRaw === "string" ? sessionIdRaw.trim() : null;

  let totalsPromise = null;
  const fetchTotals = async () => {
    if (!userId) return { current: cookieTotal, lifetime: 0, sessionTotal: 0, lastSync: 0 };
    if (!totalsPromise) {
      totalsPromise = getTotals({ userId, sessionId, now, keyNamespace: cfg.ns });
    }
    return totalsPromise;
  };

  const respond = async (statusCode, payload, options = {}) => {
    let totalSource = options.totalOverride;
    let totals = options.totals;
    let skipCookie = options.skipCookie;
    if (totals) {
      totalSource = totalSource ?? totals.current;
    }
    if (totalSource === undefined && userId) {
      totals = await fetchTotals();
      totalSource = totals.current;
    }
    if (totalSource === undefined) totalSource = cookieTotal;
    if (totals && payload.totalLifetime === undefined) payload.totalLifetime = totals.lifetime;
    if (totals && payload.sessionTotal === undefined && totals.sessionTotal !== undefined) {
      payload.sessionTotal = totals.sessionTotal;
    }
    if (totals && payload.lastSync === undefined && totals.lastSync !== undefined) {
      payload.lastSync = totals.lastSync;
    }
    if (skipCookie === undefined) skipCookie = !userId;
    return buildResponse(statusCode, payload, totalSource, {
      debugExtra: options.debugExtra ?? {},
      skipCookie,
      totals,
      cookieUserId: userId,
    });
  };

  if (!userId || (!body.statusOnly && !sessionId)) {
    const totals = userId ? await fetchTotals() : null;
    return respond(400, { error: "missing_fields" }, { totals, skipCookie: !userId });
  }

  if (body.statusOnly) {
    const totals = await fetchTotals();
    const payload = {
      ok: true,
      awarded: 0,
      granted: 0,
      cap: cfg.dailyCap,
      capDelta: cfg.deltaCap,
      totalLifetime: totals.lifetime,
      sessionTotal: totals.sessionTotal,
      lastSync: totals.lastSync,
      status: "statusOnly",
    };
    return respond(200, payload, { totals, debugExtra: { mode: "statusOnly" } });
  }

  let deltaRaw = Number(body.delta);
  if (!Number.isFinite(deltaRaw)) {
    const scoreDelta = Number(body.scoreDelta);
    const pointsPerPeriod = Number(body.pointsPerPeriod);
    if (Number.isFinite(scoreDelta)) deltaRaw = scoreDelta;
    else if (Number.isFinite(pointsPerPeriod)) deltaRaw = pointsPerPeriod;
  }
  if (!Number.isFinite(deltaRaw) || deltaRaw < 0) {
    const totals = await fetchTotals();
    return respond(422, { error: "invalid_delta" }, { totals });
  }
  const normalizedDelta = Math.floor(deltaRaw);
  if (normalizedDelta < 0) {
    const totals = await fetchTotals();
    return respond(422, { error: "invalid_delta" }, { totals });
  }
  if (normalizedDelta > cfg.deltaCap) {
    const totals = await fetchTotals();
    return respond(422, { error: "delta_out_of_range", capDelta: cfg.deltaCap }, { totals });
  }

  

  let metadata = null;
  if (body.metadata !== undefined) {
    if (!body.metadata || typeof body.metadata !== "object" || Array.isArray(body.metadata)) {
      const totals = await fetchTotals();
      return respond(400, { error: "invalid_metadata" }, { totals });
    }

    const cleaned = {};
    for (const [key, value] of Object.entries(body.metadata)) {
      if (key === "userId" || key === "sessionId" || key === "delta" || key === "ts") continue;
      cleaned[key] = value;
    }

    const serialized = JSON.stringify(cleaned);
    const bytes = Buffer.byteLength(serialized, "utf8");

    // Depth check up to 3 levels
    const MAX_DEPTH = 3;
    let depthOk = true;
    const stack = [{ value: cleaned, depth: 1 }];
    while (stack.length) {
      const { value, depth } = stack.pop();
      if (!value || typeof value !== "object") continue;
      if (depth > MAX_DEPTH) { depthOk = false; break; }
      for (const nested of Object.values(value)) {
        if (nested && typeof nested === "object") {
          stack.push({ value: nested, depth: depth + 1 });
        }
      }
    }

    // Default to using cleaned metadata…
    metadata = cleaned;

    // …but if it's too large or too deep, ignore it (do NOT block awarding).
    if ((cfg.metadataMax && bytes > cfg.metadataMax) || !depthOk) {
      metadata = null;
    }
  }

  // --- Resolve award window timestamp (supports backfill days & nested keys)
// NOTE: We intentionally read from raw body.metadata even if later we drop metadata
// for being too big/deep — the timestamp must still be honored.

const coerceTs = (v) => {
  if (v == null) return undefined;
  // Prefer repo helper if present; fallback to Number/Date.parse for ISO.
  const n = (typeof asNumber === "function") ? asNumber(v) : Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  if (typeof v === "string") {
    const d = Date.parse(v);
    if (Number.isFinite(d) && d > 0) return d;
  }
  return undefined;
};

const pick = (...cands) => {
  for (const c of cands) {
    const t = coerceTs(c);
    if (t !== undefined) return t;
  }
  return undefined;
};

let tsRaw =
  // 1) Body first
  pick(
    body?.ts,
    body?.timestamp,
    body?.windowEnd,
    body?.window?.end
  )
  // 2) Raw metadata (shallow + a few common nested spellings)
  ?? pick(
    body?.metadata?.ts,
    body?.metadata?.timestamp,
    body?.metadata?.windowEnd,
    body?.metadata?.window_end,
    body?.metadata?.windowEndEpoch,
    body?.metadata?.window?.end,
    body?.metadata?.award?.windowEnd
  )
  // 3) Fallback to now
  ?? now;

if (!(Number.isFinite(tsRaw) && tsRaw > 0)) {
  const totals = await fetchTotals();
  return respond(422, { error: "invalid_timestamp" }, { totals });
}
if (tsRaw > now + cfg.driftMs) {
  const totals = await fetchTotals();
  return respond(422, { error: "timestamp_in_future", driftMs: cfg.driftMs }, { totals });
}
const ts = Math.trunc(tsRaw);

  // shard awards by the award window's timestamp day (prevents cross-day pollution)
const awardDayKey = getDailyKey(ts);
const isTodayAward = awardDayKey === dayKeyNow;

// Clamp if anonymous OR cookie uid matches the current user.
// If cookie has no uid and a named user is present => do NOT clamp.
const cookieUserOk = (!userId) || (cookieState.uid && cookieState.uid === userId);
cookieKeyMatches = cookieState.key === dayKeyNow;
cookieTotal = (cookieKeyMatches && cookieUserOk) ? sanitizeTotal(cookieState.total) : 0;
cookieRemainingBefore = Math.max(0, cfg.dailyCap - cookieTotal);

const dailyKeyK       = keyDaily(userId, awardDayKey, cfg.ns);
const totalKeyK       = keyTotal(userId, cfg.ns);
const sessionKeyK     = keySession(userId, sessionId, cfg.ns);
const sessionSyncKeyK = keySessionSync(userId, sessionId, cfg.ns);
const lockKeyK        = keyLock(userId, sessionId, cfg.ns);

  if (cfg.requireActivity && normalizedDelta > 0) {
    const events = Number(metadata?.inputEvents ?? 0);
    const visSeconds = Number(metadata?.visibilitySeconds ?? 0);
    if (!Number.isFinite(events) || events < cfg.minEvents || !Number.isFinite(visSeconds) || visSeconds < cfg.minVisS) {
      const totals = await fetchTotals();
      const inactivePayload = {
        ok: true,
        awarded: 0,
        granted: 0,
        cap: cfg.dailyCap,
        capDelta: cfg.deltaCap,
        reason: "inactive",
        status: "inactive",
      };
      return respond(200, inactivePayload, {
        totals,
        debugExtra: {
          mode: "inactive",
          delta: normalizedDelta,
          ts,
          sessionCap: cfg.sessionCap,
          dailyCap: cfg.dailyCap,
          events,
          visSeconds,
        },
      });
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

    local shouldLock = lockTtl and lockTtl > 0
    if shouldLock then
      local locked = redis.call('SET', lockKey, tostring(now), 'PX', lockTtl, 'NX')
      if locked ~= 'OK' then
        local currentDaily = tonumber(redis.call('GET', dailyKey) or '0')
        local sessionTotal = tonumber(redis.call('GET', sessionKey) or '0')
        local lifetime = tonumber(redis.call('GET', totalKey) or '0')
        local lastSync = tonumber(redis.call('GET', sessionSyncKey) or '0')
        return {0, currentDaily, sessionTotal, lifetime, lastSync, 6}
      end
    end

    local function refreshSessionTtl()
      if sessionTtl and sessionTtl > 0 then
        redis.call('PEXPIRE', sessionKey, sessionTtl)
        redis.call('PEXPIRE', sessionSyncKey, sessionTtl)
      end
    end

    local function finish(grant, dailyTotal, sessionTotal, lifetime, sync, status)
      if shouldLock then
        redis.call('DEL', lockKey)
      end
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

  const cookieLimitedDelta = Math.min(normalizedDelta, cookieRemainingBefore);
  // only clamp by cookie for today's bucket; backfills clamp by their own bucket
  const cookieClamped = isTodayAward && cookieLimitedDelta < normalizedDelta;
  const effectiveDelta = isTodayAward ? cookieLimitedDelta : normalizedDelta;

  const res = await store.eval(
    script,
    [sessionKeyK, sessionSyncKeyK, dailyKeyK, totalKeyK, lockKeyK],
    [
      String(now),
      String(effectiveDelta),
      String(cfg.dailyCap),
      String(Math.max(0, cfg.sessionCap)),
      String(ts),
      String(LOCK_TTL_MS),
      String(cfg.sessionTtlMs),
    ]
  );

  const granted = Math.max(0, Math.floor(Number(res?.[0]) || 0));
  const redisDailyTotalRaw = Number(res?.[1]) || 0;
  const sessionTotal = Number(res?.[2]) || 0;
  const totalLifetime = Number(res?.[3]) || 0;
  const lastSync = Number(res?.[4]) || 0;
  const status = Number(res?.[5]) || 0;

  const totalTodayRedis = Math.min(cfg.dailyCap, Math.max(0, sanitizeTotal(redisDailyTotalRaw)));
  const remaining = Math.max(0, cfg.dailyCap - totalTodayRedis);

  const payload = {
    ok: true,
    awarded: granted,
    granted,
    cap: cfg.dailyCap,
    capDelta: cfg.deltaCap,
    totalLifetime,
    sessionTotal,
    lastSync,
    remaining,
    dayKey: awardDayKey, // reflect the bucket hit
    nextReset,
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
    payload.granted = 0;
  }
  if (status === 6) {
    payload.locked = true;
    payload.awarded = 0;
    payload.granted = 0;
  }

  const reason = statusReasons[status];
  if (reason) {
    payload.reason = reason;
  } else if (granted < normalizedDelta) {
    payload.reason = normalizedDelta > 0 ? "partial" : undefined;
  }

  if (cookieClamped) {
    payload.capped = true;
    if (!payload.reason || payload.reason === "partial") {
      payload.reason = granted > 0 ? "daily_cap_partial" : "daily_cap";
    }
    if (!payload.status || payload.status === "ok" || payload.status === "partial") {
      payload.status = payload.reason || (granted > 0 ? "daily_cap_partial" : "daily_cap");
    }
  }

  if (DEBUG_ENABLED && granted < normalizedDelta && (status === 1 || status === 3 || cookieClamped)) {
    console.log("daily_cap", {
      requested: normalizedDelta,
      granted,
      remaining,
      dayKey: awardDayKey,
      bucket: isTodayAward ? "today" : "backfill",
    });
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

  const debugExtra = {
    mode: "award",
    delta: normalizedDelta,
    ts,
    now,
    status,
    requested: normalizedDelta,
    sessionCap: cfg.sessionCap,
    dailyCap: cfg.dailyCap,
    lastSync,
    remainingBefore: cookieRemainingBefore,
    remainingAfter: remaining,
    redisDailyTotalRaw,
    awardDayKey,
    cookieDayKey: dayKeyNow,
  };

  if (reason) debugExtra.reason = reason;
  if (cookieClamped) debugExtra.cookieClamped = true;

  // If the award hit today's bucket, reflect that total and refresh today's cookie.
  // If it hit a different day (backfill), show today's totals and skip cookie.
  if (isTodayAward) {
    return respond(200, payload, { totalOverride: redisDailyTotalRaw, debugExtra });
  } else {
    const todaysTotals = await fetchTotals();
    debugExtra.backfill = true;
    return respond(200, payload, { totals: todaysTotals, skipCookie: true, debugExtra });
  }
}

