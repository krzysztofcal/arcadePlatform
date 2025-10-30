import crypto from "node:crypto";
import { store } from "./_shared/store-upstash.mjs";

const DAILY_CAP = Number(process.env.XP_DAILY_CAP ?? 600);          // set to 3000 in Netlify
const CHUNK_MS = Number(process.env.XP_CHUNK_MS ?? 30_000);         // 30s
const POINTS_PER_PERIOD = Number(process.env.XP_POINTS_PER_PERIOD ?? 10);
const DRIFT_MS = Number(process.env.XP_DRIFT_MS ?? 2_000);
const MIN_VISIBILITY_S = Number(process.env.XP_MIN_VISIBILITY_S ?? 20);
const MIN_INPUTS = Number(process.env.XP_MIN_INPUTS ?? 1);
const KEY_NS = process.env.XP_KEY_NS ?? "kcswh:xp:v1";
const CORS_ALLOW = (process.env.XP_CORS_ALLOW ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const LAST_OK_TTL_SEC = 2 * 24 * 3600;  // keep lastOk ~2 days
const IDEM_TTL_SEC = 24 * 3600;

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

  if (!userId || !gameId || !sessionId || !Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) {
    return json(400, { error: "missing_fields" }, origin);
  }

  // Basic window validity (defensive)
  const now = Date.now();
  const elapsed = windowEnd - windowStart;
  if (windowEnd > now + DRIFT_MS || elapsed < (CHUNK_MS - DRIFT_MS)) {
    return json(422, { ok: false, error: "invalid_window", elapsed }, origin);
  }
  if ((visibilitySeconds ?? 0) < MIN_VISIBILITY_S || (inputEvents ?? 0) < MIN_INPUTS) {
    return json(200, { ok: true, awarded: 0, reason: "insufficient-activity" }, origin);
  }

  // Keys
  const today     = dayKey(now);
  const dailyKeyK = keyDaily(userId, today);
  const lastKeyK  = keyLast(userId, gameId);
  const idemK     = keyIdem(userId, sessionId, gameId, windowStart, windowEnd);

  // Atomic script: idempotency → cap → spacing (≥ CHUNK_MS since lastOk) → INCRBY → set lastOk(end) → set idem
  const script = `
    local daily = KEYS[1]
    local lastk = KEYS[2]
    local idem  = KEYS[3]
    local now     = tonumber(ARGV[1])
    local chunk   = tonumber(ARGV[2])
    local step    = tonumber(ARGV[3])
    local cap     = tonumber(ARGV[4])
    local idemTtl = tonumber(ARGV[5])
    local endTs   = tonumber(ARGV[6])
    local lastTtl = tonumber(ARGV[7])

    -- Idempotent?
    if redis.call('GET', idem) then
      local t = tonumber(redis.call('GET', daily) or '0')
      return {0, t, 1}    -- idempotent
    end

    local current = tonumber(redis.call('GET', daily) or '0')
    if current >= cap then
      redis.call('SETEX', idem, idemTtl, '1')
      return {0, current, 2}  -- capped
    end

    local lastOk = tonumber(redis.call('GET', lastk) or '0')
    if (endTs - lastOk) < chunk then
      -- too soon since last accepted window end
      return {0, current, 3}
    end

    local remaining = cap - current
    local grant = step
    if grant > remaining then grant = remaining end

    local newtotal = tonumber(redis.call('INCRBY', daily, grant))
    redis.call('SETEX', lastk, lastTtl, tostring(endTs))
    redis.call('SETEX', idem, idemTtl, '1')
    return {grant, newtotal, 0} -- ok
  `;

  const res = await store.eval(
    script,
    [dailyKeyK, lastKeyK, idemK],
    [
      String(now),
      String(CHUNK_MS),
      String(POINTS_PER_PERIOD),
      String(DAILY_CAP),
      String(IDEM_TTL_SEC),
      String(windowEnd),
      String(LAST_OK_TTL_SEC),
    ]
  );

  const granted = Number(res?.[0]) || 0;
  const total   = Number(res?.[1]) || 0;
  const status  = Number(res?.[2]) || 0; // 0=ok,1=idempotent,2=capped,3=too_soon

  const payload = { ok: true, awarded: granted, totalToday: total, cap: DAILY_CAP };
  if (status === 1) payload.idempotent = true;
  if (status === 2) payload.capped = true;
  if (status === 3) payload.tooSoon = true;

  return json(200, payload, origin);
}
