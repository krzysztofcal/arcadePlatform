import crypto from "node:crypto";
import { store } from "./_shared/store-upstash.mjs";

const DAILY_CAP = Number(process.env.XP_DAILY_CAP ?? 600);          // set to 3000 in Netlify
const DEFAULT_CHUNK_MS = Number(process.env.XP_CHUNK_MS ?? 10_000); // 10s default
const DEFAULT_POINTS_PER_PERIOD = Number(process.env.XP_POINTS_PER_PERIOD ?? 20);
const DRIFT_MS = Number(process.env.XP_DRIFT_MS ?? 2_000);
const BASE_MIN_VISIBILITY_S = Number(process.env.XP_MIN_VISIBILITY_S ?? 6);
const BASE_MIN_INPUTS = Number(process.env.XP_MIN_INPUTS ?? 1);
const KEY_NS = process.env.XP_KEY_NS ?? "kcswh:xp:v1";
const EVENT_GAP_MS = Number(process.env.XP_EVENT_GAP_MS ?? 500);
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

  if (!userId || !sessionId) {
    return json(400, { error: "missing_fields" }, origin);
  }

  if (body.statusOnly) {
    const todayKeyK = keyDaily(userId, dayKey());
    const totalKeyK = keyTotal(userId);
    const [todayRaw, totalRaw] = await Promise.all([
      store.get(todayKeyK),
      store.get(totalKeyK),
    ]);
    const payload = {
      ok: true,
      totalToday: Number(todayRaw) || 0,
      cap: DAILY_CAP,
      totalLifetime: Number(totalRaw) || 0,
    };
    return json(200, payload, origin);
  }

  if (!gameId || !Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) {
    return json(400, { error: "missing_fields" }, origin);
  }

  const requestedChunkMs = Number(body.chunkMs);
  const chunkMs = Number.isFinite(requestedChunkMs)
    ? clamp(requestedChunkMs, 5_000, DEFAULT_CHUNK_MS)
    : DEFAULT_CHUNK_MS;
  const requestedStep = Number(body.pointsPerPeriod);
  const fallbackStep = Number.isFinite(requestedStep)
    ? clamp(requestedStep, 0, DEFAULT_POINTS_PER_PERIOD)
    : DEFAULT_POINTS_PER_PERIOD;
  const minVisibility = Math.max(BASE_MIN_VISIBILITY_S, Math.round((chunkMs / 1000) * 0.6));
  const minInputs = Math.max(BASE_MIN_INPUTS, 1);

  // Basic window validity (defensive)
  const now = Date.now();
  const elapsed = windowEnd - windowStart;
  if (windowEnd > now + DRIFT_MS || elapsed < (chunkMs - DRIFT_MS)) {
    return json(422, { ok: false, error: "invalid_window", elapsed }, origin);
  }
  const visibleSeconds = Number(visibilitySeconds ?? 0);
  const inputsCount = Number(inputEvents ?? 0);
  if (visibleSeconds < minVisibility || inputsCount < minInputs) {
    return json(200, { ok: true, awarded: 0, reason: "insufficient-activity" }, origin);
  }

  const hasEarnedField = Object.prototype.hasOwnProperty.call(body, "earnedXp");
  const rawEarned = Number(body.earnedXp);
  const requestedEarned = hasEarnedField && Number.isFinite(rawEarned)
    ? Math.max(0, Math.floor(rawEarned))
    : null;
  const gapMs = EVENT_GAP_MS > 0 ? EVENT_GAP_MS : 1;
  const maxByGap = requestedEarned != null
    ? Math.floor((Math.max(0, visibleSeconds) * 1000) / gapMs)
    : null;
  const grantFromActivity = (requestedEarned != null && maxByGap != null)
    ? Math.min(requestedEarned, maxByGap)
    : null;
  const pointsPerPeriod = grantFromActivity != null
    ? clamp(grantFromActivity, 0, DEFAULT_POINTS_PER_PERIOD)
    : fallbackStep;

  // Keys
  const today     = dayKey(now);
  const dailyKeyK = keyDaily(userId, today);
  const lastKeyK  = keyLast(userId, gameId);
  const idemK     = keyIdem(userId, sessionId, gameId, windowStart, windowEnd);
  const lockKeyK  = keyLock(userId, gameId);
  const totalKeyK = keyTotal(userId);

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
      String(pointsPerPeriod),
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

  const payload = { ok: true, awarded: granted, totalToday: total, cap: DAILY_CAP, totalLifetime: lifetime };
  if (status === 1) payload.idempotent = true;
  if (status === 2) payload.capped = true;
  if (status === 3) payload.tooSoon = true;
  if (status === 4) payload.locked = true;

  return json(200, payload, origin);
}
