import crypto from "node:crypto";
import { store } from "./_shared/store-upstash.mjs";

const asNumber = (raw, fallback) => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const DAILY_CAP = asNumber(process.env.XP_DAILY_CAP, 600);          // set to 3000 in Netlify
const DEFAULT_CHUNK_MS = asNumber(process.env.XP_CHUNK_MS, 10_000); // 10s default
const DEFAULT_POINTS_PER_PERIOD = asNumber(process.env.XP_POINTS_PER_PERIOD, 10);
const XP_USE_SCORE = process.env.XP_USE_SCORE === "1";
const XP_SCORE_TO_XP = asNumber(process.env.XP_SCORE_TO_XP, 1);
const XP_MAX_XP_PER_WINDOW = asNumber(process.env.XP_MAX_XP_PER_WINDOW, DEFAULT_POINTS_PER_PERIOD);
const SCORE_DELTA_CEILING = asNumber(process.env.XP_SCORE_DELTA_CEILING, 10_000);
const XP_SCORE_RATE_LIMIT_PER_MIN = asNumber(process.env.XP_SCORE_RATE_LIMIT_PER_MIN, SCORE_DELTA_CEILING);
const XP_SCORE_BURST_MAX = asNumber(process.env.XP_SCORE_BURST_MAX, XP_SCORE_RATE_LIMIT_PER_MIN);
const XP_SCORE_MIN_EVENTS = Math.max(0, asNumber(process.env.XP_SCORE_MIN_EVENTS, 4));
const XP_SCORE_MIN_VIS_S = Math.max(0, asNumber(process.env.XP_SCORE_MIN_VIS_S, 8));
const XP_SCORE_DEBUG_TRACE = process.env.XP_SCORE_DEBUG_TRACE === "1";
const DEBUG_ENABLED = process.env.XP_DEBUG === "1";
const SCORE_RATE_TTL_SEC = 90;
const DRIFT_MS = asNumber(process.env.XP_DRIFT_MS, 2_000);
const BASE_MIN_VISIBILITY_S = asNumber(process.env.XP_MIN_VISIBILITY_S, 6);
const BASE_MIN_INPUTS = asNumber(process.env.XP_MIN_INPUTS, 1);
const KEY_NS = process.env.XP_KEY_NS ?? "kcswh:xp:v1";
const CORS_ALLOW = (process.env.XP_CORS_ALLOW ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const LAST_OK_TTL_SEC = 2 * 24 * 3600;  // keep lastOk ~2 days
const IDEM_TTL_SEC = 24 * 3600;
const LOCK_TTL_MS = Number(process.env.XP_LOCK_TTL_MS ?? 3_000);

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
const keyIdem  = (u, s, g, start, end) => `${KEY_NS}:idemp:${hash(`${u}|${s}|${g}|${start}|${end}`)}`;
const keyDaily = (u, day = dayKey()) => `${KEY_NS}:daily:${u}:${day}`;
const keyLast  = (u, g) => `${KEY_NS}:lastok:${u}:${g}`; // NEW: last accepted end timestamp
const keyLock  = (u, g) => `${KEY_NS}:lock:${u}:${g}`;
const keyTotal = (u) => `${KEY_NS}:total:${u}`;
const keyScoreRate = (u, t = Date.now()) => {
  const d = new Date(t);
  const bucket = [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
    String(d.getUTCHours()).padStart(2, "0"),
    String(d.getUTCMinutes()).padStart(2, "0"),
  ].join("");
  return `${KEY_NS}:scorerl:${u}:${bucket}`;
};

async function getScoreRateUsage(userId, t = Date.now()) {
  const key = keyScoreRate(userId, t);
  try {
    const raw = await store.get(key);
    const current = Number(raw ?? "0");
    return { key, current: Number.isFinite(current) ? current : 0 };
  } catch {
    return { key, current: 0 };
  }
}

async function getDailyAndLifetime(dailyKey, totalKey) {
  try {
    const [currentStr, lifetimeStr] = await Promise.all([
      store.get(dailyKey),
      store.get(totalKey),
    ]);
    const current = Number(currentStr ?? "0") || 0;
    const lifetime = Number(lifetimeStr ?? "0") || 0;
    return { current, lifetime };
  } catch {
    return { current: 0, lifetime: 0 };
  }
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export async function handler(event) {
  const origin = event.headers?.origin;
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(origin) };
  if (event.httpMethod !== "POST")   return json(405, { error: "method_not_allowed" }, origin);

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "bad_json" }, origin); }

  const {
    userId,
    gameId,
    sessionId,
    windowStart,
    windowEnd,
    visibilitySeconds,
    inputEvents,
  } = body;

  const requestedScoreDelta = Number(body.scoreDelta);
  const scoreDeltaRaw = Number.isFinite(requestedScoreDelta)
    ? clamp(requestedScoreDelta, 0, SCORE_DELTA_CEILING)
    : undefined;
  const useScoreMode = XP_USE_SCORE && Number.isFinite(scoreDeltaRaw) && scoreDeltaRaw > 0;
  let scoreDeltaAccepted = useScoreMode ? scoreDeltaRaw : undefined;
  const rawScoreXp = useScoreMode
    ? Math.round(clamp(scoreDeltaRaw * XP_SCORE_TO_XP, 0, XP_MAX_XP_PER_WINDOW))
    : undefined;
  let scoreXp = rawScoreXp;
  const debugScoreDelta = Number.isFinite(scoreDeltaRaw) ? scoreDeltaRaw : null;
  if (!userId || (!body.statusOnly && !sessionId)) {
    return json(400, { error: "missing_fields" }, origin);
  }


  

  // EARLY statusOnly (no window validation)
  if (body.statusOnly) {
    const today = dayKey();
    const dailyKeyK = keyDaily(userId, today);
    const totalKeyK = keyTotal(userId);
    const { current, lifetime } = await getDailyAndLifetime(dailyKeyK, totalKeyK);
    const payload = { ok: true, awarded: 0, totalToday: current, cap: DAILY_CAP, totalLifetime: lifetime };
    if (DEBUG_ENABLED || XP_SCORE_DEBUG_TRACE) {
      payload.debug = {
        mode: "statusOnly",
        scoreDelta: debugScoreDelta,
      };
      if (useScoreMode) {
        payload.debug.scoreDeltaRaw = debugScoreDelta;
        payload.debug.scoreDeltaAccepted = scoreDeltaAccepted ?? null;
        payload.debug.scoreRateMinute = null;
        payload.debug.scoreRateLimit = XP_SCORE_RATE_LIMIT_PER_MIN;
        payload.debug.scoreBurstMax = XP_SCORE_BURST_MAX;
      }
    }
    return json(200, payload, origin);
  }

  // Task 1: block XP when user is idle
  if (!body.statusOnly) {
    if (useScoreMode) {
      const minScoreEvents = XP_SCORE_MIN_EVENTS;
      const minScoreVisibility = XP_SCORE_MIN_VIS_S;
      if ((visibilitySeconds ?? 0) < minScoreVisibility || (inputEvents ?? 0) < minScoreEvents) {
        const payload = { ok: true, awarded: 0, reason: "insufficient-activity" };
        if (DEBUG_ENABLED || XP_SCORE_DEBUG_TRACE) {
          const debugMode = "score";
          payload.debug = {
            mode: debugMode,
            visibilitySeconds,
            inputEvents,
            minScoreEvents,
            minScoreVisibility,
            scoreDelta: debugScoreDelta,
            scoreDeltaRaw: Number.isFinite(scoreDeltaRaw) ? scoreDeltaRaw : null,
            scoreDeltaAccepted: 0,
            scoreRateMinute: null,
            scoreRateLimit: XP_SCORE_RATE_LIMIT_PER_MIN,
            scoreBurstMax: XP_SCORE_BURST_MAX,
            reason: "insufficient-activity",
          };
        }
        return json(200, payload, origin);
      }
    }

    // Use clamped chunk to derive a reasonable input threshold
    const _raw = Number(body.chunkMs);
    const _chunk = Number.isFinite(_raw) ? Math.min(Math.max(_raw, 5000), DEFAULT_CHUNK_MS) : DEFAULT_CHUNK_MS;
    const _minInputsGate = Math.max(2, Math.ceil(_chunk / 4000));
    if (!(Number.isFinite(visibilitySeconds) && visibilitySeconds > 1 &&
          Number.isFinite(inputEvents) && inputEvents >= _minInputsGate)) {
      const payload = { ok: true, awarded: 0, reason: "insufficient-activity" };
      if (DEBUG_ENABLED || XP_SCORE_DEBUG_TRACE) {
        const debugMode = useScoreMode ? "score" : "time";
        payload.debug = {
          chunkMs: _chunk,
          minInputsGate: _minInputsGate,
          visibilitySeconds,
          inputEvents,
          reason: "insufficient-activity",
          scoreDelta: debugScoreDelta,
          mode: debugMode,
        };
        if (useScoreMode) {
          payload.debug.scoreXp = rawScoreXp;
          payload.debug.scoreDeltaRaw = debugScoreDelta;
          payload.debug.scoreDeltaAccepted = scoreDeltaAccepted ?? null;
          payload.debug.scoreRateMinute = null;
          payload.debug.scoreRateLimit = XP_SCORE_RATE_LIMIT_PER_MIN;
          payload.debug.scoreBurstMax = XP_SCORE_BURST_MAX;
        }
      }
      return json(200, payload, origin);
    }
  }


  if (!gameId || !Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) {
    return json(400, { error: "missing_fields" }, origin);
  }

  const requestedChunkMs = Number(body.chunkMs);
  const chunkMs = Number.isFinite(requestedChunkMs)
    ? clamp(requestedChunkMs, 5_000, DEFAULT_CHUNK_MS)
    : DEFAULT_CHUNK_MS;
  const requestedStep = Number(body.pointsPerPeriod);
  const pointsPerPeriod = Number.isFinite(requestedStep)
    ? clamp(requestedStep, 1, DEFAULT_POINTS_PER_PERIOD)
    : DEFAULT_POINTS_PER_PERIOD;
  const minVisibility = Math.max(BASE_MIN_VISIBILITY_S, Math.round((chunkMs / 1000) * 0.6));
  const minInputs = Math.max(BASE_MIN_INPUTS, Math.ceil(chunkMs / 4000));
  let grantStep = pointsPerPeriod;

  // Basic window validity (defensive)
  const now = Date.now();
  const elapsed = windowEnd - windowStart;
  if (windowEnd > now + DRIFT_MS || elapsed < (chunkMs - DRIFT_MS)) {
    return json(422, { ok: false, error: "invalid_window", elapsed }, origin);
  }
  if ((visibilitySeconds ?? 0) < minVisibility || (inputEvents ?? 0) < minInputs) {
    return json(200, { ok: true, awarded: 0, reason: "insufficient-activity" }, origin);
  }

  // Keys
  const today     = dayKey(now);
  const dailyKeyK = keyDaily(userId, today);
  const lastKeyK  = keyLast(userId, gameId);
  const idemK     = keyIdem(userId, sessionId, gameId, windowStart, windowEnd);
  const lockKeyK  = keyLock(userId, gameId);
  const totalKeyK = keyTotal(userId);

  let scoreRateMinute = null;
  let scoreRateKeyK;
  const scoreRateLimit = Number.isFinite(XP_SCORE_RATE_LIMIT_PER_MIN) ? XP_SCORE_RATE_LIMIT_PER_MIN : SCORE_DELTA_CEILING;
  const scoreBurstMax = Number.isFinite(XP_SCORE_BURST_MAX) ? XP_SCORE_BURST_MAX : SCORE_DELTA_CEILING;
  let reservedScoreDelta = 0;
  let reservedScoreKey = null;

  if (useScoreMode) {
    const usage = await getScoreRateUsage(userId, now);
    scoreRateMinute = Number.isFinite(usage.current) ? usage.current : 0;
    scoreRateKeyK = usage.key;

    const remainingRate = scoreRateLimit - scoreRateMinute;
    const remainingBurst = scoreBurstMax - scoreRateMinute;
    const allowanceRaw = Math.min(remainingRate, remainingBurst);
    const effectiveAllowance = Math.max(0, Number.isFinite(allowanceRaw) ? allowanceRaw : 0);
    const proposed = Number.isFinite(scoreDeltaAccepted)
      ? Math.max(0, scoreDeltaAccepted)
      : Math.max(0, Number(scoreDeltaRaw ?? 0));

    if (effectiveAllowance <= 0) {
      scoreDeltaAccepted = 0;
      scoreXp = 0;
      const { current, lifetime } = await getDailyAndLifetime(dailyKeyK, totalKeyK);
      const payload = {
        ok: true,
        awarded: 0,
        totalToday: current,
        cap: DAILY_CAP,
        totalLifetime: lifetime,
        reason: "score_rate_limit",
      };
      if (DEBUG_ENABLED || XP_SCORE_DEBUG_TRACE) {
        payload.debug = {
          mode: "score",
          scoreDelta: debugScoreDelta,
          scoreDeltaRaw: debugScoreDelta,
          scoreDeltaAccepted: 0,
          scoreRateMinute,
          scoreRateLimit: scoreRateLimit,
          scoreBurstMax: scoreBurstMax,
          reason: "score_rate_limit",
        };
      }
      return json(200, payload, origin);
    }

    const safeAccepted = Math.min(proposed, effectiveAllowance);
    const boundedAccepted = Number.isFinite(safeAccepted) ? safeAccepted : 0;
    const normalizedAccepted = Math.max(0, Math.floor(boundedAccepted));
    scoreDeltaAccepted = normalizedAccepted;
    const safeXp = clamp(normalizedAccepted * XP_SCORE_TO_XP, 0, XP_MAX_XP_PER_WINDOW);
    scoreXp = Math.round(safeXp);
    grantStep = Number.isFinite(scoreXp) ? Math.max(0, scoreXp) : 0;

    if (normalizedAccepted <= 0 || grantStep <= 0) {
      const { current, lifetime } = await getDailyAndLifetime(dailyKeyK, totalKeyK);
      const reason = "no_score";
      const payload = {
        ok: true,
        awarded: 0,
        totalToday: current,
        cap: DAILY_CAP,
        totalLifetime: lifetime,
        reason,
      };
      if (DEBUG_ENABLED || XP_SCORE_DEBUG_TRACE) {
        payload.debug = {
          mode: "score",
          scoreDelta: debugScoreDelta,
          scoreDeltaRaw: debugScoreDelta,
          scoreDeltaAccepted: normalizedAccepted,
          scoreRateMinute,
          scoreRateLimit,
          scoreBurstMax,
          reason,
        };
      }
      return json(200, payload, origin);
    }

    if (scoreRateKeyK) {
      const minuteCap = Math.max(0, Math.min(scoreRateLimit, scoreBurstMax));
      const reserveDelta = normalizedAccepted;
      let reserveSucceeded = false;
      try {
        const newMinuteTotalRaw = await store.incrBy(scoreRateKeyK, reserveDelta);
        reserveSucceeded = true;
        const newMinuteTotal = Number(newMinuteTotalRaw ?? "0");
        const previousMinute = Number.isFinite(newMinuteTotal) ? newMinuteTotal - reserveDelta : 0;
        if (previousMinute <= 0 && typeof store.expire === "function") {
          try {
            await store.expire(scoreRateKeyK, SCORE_RATE_TTL_SEC);
          } catch (_) {
            // ignore ttl persistence issues
          }
        }
        reservedScoreDelta = reserveDelta;
        reservedScoreKey = scoreRateKeyK;
        scoreRateMinute = Number.isFinite(newMinuteTotal) ? newMinuteTotal : scoreRateMinute;
        if (Number.isFinite(newMinuteTotal) && newMinuteTotal > minuteCap) {
          try {
            await store.decrBy(scoreRateKeyK, reserveDelta);
          } catch (_) {
            // best effort rollback
          }
          reservedScoreDelta = 0;
          reservedScoreKey = null;
          scoreRateMinute = previousMinute;
          const { current, lifetime } = await getDailyAndLifetime(dailyKeyK, totalKeyK);
          const reason = "score_rate_limit";
          const payload = {
            ok: true,
            awarded: 0,
            totalToday: current,
            cap: DAILY_CAP,
            totalLifetime: lifetime,
            reason,
          };
          if (DEBUG_ENABLED || XP_SCORE_DEBUG_TRACE) {
            payload.debug = {
              mode: "score",
              scoreDelta: debugScoreDelta,
              scoreDeltaRaw: debugScoreDelta,
              scoreDeltaAccepted: normalizedAccepted,
              scoreRateMinute: previousMinute,
              scoreRateLimit,
              scoreBurstMax,
              reason,
            };
          }
          return json(200, payload, origin);
        }
      } catch (_) {
        if (reserveSucceeded && reserveDelta > 0) {
          try {
            await store.decrBy(scoreRateKeyK, reserveDelta);
          } catch (_) {
            // ignore secondary rollback errors
          }
        }
        reservedScoreDelta = 0;
        reservedScoreKey = null;
        const { current, lifetime } = await getDailyAndLifetime(dailyKeyK, totalKeyK);
        const reason = "score_rate_limit";
        const payload = {
          ok: true,
          awarded: 0,
          totalToday: current,
          cap: DAILY_CAP,
          totalLifetime: lifetime,
          reason,
        };
        if (DEBUG_ENABLED || XP_SCORE_DEBUG_TRACE) {
          payload.debug = {
            mode: "score",
            scoreDelta: debugScoreDelta,
            scoreDeltaRaw: debugScoreDelta,
            scoreDeltaAccepted: normalizedAccepted,
            scoreRateMinute,
            scoreRateLimit,
            scoreBurstMax,
            reason,
          };
        }
        return json(200, payload, origin);
      }
    }
  }

  // Atomic script: idempotency → cap → spacing (≥ CHUNK_MS since lastOk) → INCRBY → set lastOk(end) → set idem
  const script = `
    local daily = KEYS[1]
    local lastk = KEYS[2]
    local idem  = KEYS[3]
    local lockk = KEYS[4]
    local total = KEYS[5]
    local now     = tonumber(ARGV[1])
    local chunk   = tonumber(ARGV[2])
    local step    = tonumber(ARGV[3])
    local cap     = tonumber(ARGV[4])
    local idemTtl = tonumber(ARGV[5])
    local endTs   = tonumber(ARGV[6])
    local lastTtl = tonumber(ARGV[7])
    local lockTtl = tonumber(ARGV[8])

    -- Acquire lock with NX so only one invocation enters the critical section.
    local locked = redis.call('SET', lockk, tostring(now), 'PX', lockTtl, 'NX')
    local function getLifetime()
      return tonumber(redis.call('GET', total) or '0')
    end

    if locked ~= 'OK' then
      local current = tonumber(redis.call('GET', daily) or '0')
      return {0, current, 4, getLifetime()}  -- someone else holds the lock
    end

    local function release()
      redis.call('DEL', lockk)
    end

    -- Idempotent?
    if redis.call('GET', idem) then
      local t = tonumber(redis.call('GET', daily) or '0')
      local lifetime = getLifetime()
      release()
      return {0, t, 1, lifetime}    -- idempotent
    end

    local current = tonumber(redis.call('GET', daily) or '0')
    if current >= cap then
      redis.call('SETEX', idem, idemTtl, '1')
      local lifetime = getLifetime()
      release()
      return {0, current, 2, lifetime}  -- capped
    end

    local lastOk = tonumber(redis.call('GET', lastk) or '0')
    if (endTs - lastOk) < chunk then
      -- too soon since last accepted window end
      local lifetime = getLifetime()
      release()
      return {0, current, 3, lifetime}
    end

    local remaining = cap - current
    local grant = step
    if grant > remaining then grant = remaining end

    local newtotal = tonumber(redis.call('INCRBY', daily, grant))
    local lifetime = tonumber(redis.call('INCRBY', total, grant))
    redis.call('SETEX', lastk, lastTtl, tostring(endTs))
    redis.call('SETEX', idem, idemTtl, '1')
    release()
    return {grant, newtotal, 0, lifetime} -- ok
  `;

  const res = await store.eval(
    script,
    [dailyKeyK, lastKeyK, idemK, lockKeyK, totalKeyK],
    [
      String(now),
      String(chunkMs),
      String(grantStep),
      String(DAILY_CAP),
      String(IDEM_TTL_SEC),
      String(windowEnd),
      String(LAST_OK_TTL_SEC),
      String(LOCK_TTL_MS),
    ]
  );

  const granted = Number(res?.[0]) || 0;
  const total   = Number(res?.[1]) || 0;
  const status  = Number(res?.[2]) || 0; // 0=ok,1=idempotent,2=capped,3=too_soon,4=locked
  const lifetime = Number(res?.[3]) || 0;

  if (useScoreMode && reservedScoreDelta > 0 && reservedScoreKey) {
    if (status !== 0 || granted <= 0) {
      try {
        const newMinuteRaw = await store.decrBy(reservedScoreKey, reservedScoreDelta);
        const newMinute = Number(newMinuteRaw ?? "0");
        scoreRateMinute = Number.isFinite(newMinute) ? newMinute : scoreRateMinute;
      } catch (_) {
        // ignore rollback failures
      }
      reservedScoreDelta = 0;
      reservedScoreKey = null;
    }
  }

  const payload = { ok: true, awarded: granted, totalToday: total, cap: DAILY_CAP, totalLifetime: lifetime };
  if (DEBUG_ENABLED || XP_SCORE_DEBUG_TRACE) {
    const debugMode = useScoreMode ? "score" : "time";
    payload.debug = {
      now,
      chunkMs,
      pointsPerPeriod,
      grantStep,
      minVisibility,
      minInputs,
      visibilitySeconds,
      inputEvents,
      status,
      scoreDelta: debugScoreDelta,
      mode: debugMode,
    };
    if (useScoreMode) {
      payload.debug.scoreXp = scoreXp;
      payload.debug.scoreDeltaRaw = debugScoreDelta;
      payload.debug.scoreDeltaAccepted = scoreDeltaAccepted ?? null;
      payload.debug.scoreRateMinute = scoreRateMinute;
      payload.debug.scoreRateLimit = scoreRateLimit;
      payload.debug.scoreBurstMax = scoreBurstMax;
    }
  }
  const statusReasons = {
    1: "idempotent",
    2: "capped",
    3: "too_soon",
    4: "locked",
  };

  if (status === 1) payload.idempotent = true;
  if (status === 2) payload.capped = true;
  if (status === 3) {
    payload.tooSoon = true;
    payload.awarded = 0;
  }
  if (status === 4) payload.locked = true;

  if (status !== 0) {
    const reason = statusReasons[status];
    if (reason) {
      payload.reason = reason;
      if (payload.debug) payload.debug.reason = reason;
    }
  }

  return json(200, payload, origin);
}
