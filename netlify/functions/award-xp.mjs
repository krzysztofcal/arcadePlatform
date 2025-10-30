import crypto from "node:crypto";
import { store } from "./_shared/store-upstash.mjs";

const DAILY_CAP = Number(process.env.XP_DAILY_CAP ?? 600);
const CHUNK_MS = Number(process.env.XP_CHUNK_MS ?? 30_000);
const POINTS_PER_PERIOD = Number(process.env.XP_POINTS_PER_PERIOD ?? 10);
const DRIFT_MS = Number(process.env.XP_DRIFT_MS ?? 2_000);
const MIN_VISIBILITY_S = Number(process.env.XP_MIN_VISIBILITY_S ?? 20);
const MIN_INPUTS = Number(process.env.XP_MIN_INPUTS ?? 1);
const KEY_NS = process.env.XP_KEY_NS ?? "kcswh:xp:v1";
const CORS_ALLOW = (process.env.XP_CORS_ALLOW ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const json = (statusCode, obj, origin) => ({
  statusCode,
  headers: corsHeaders(origin),
  body: JSON.stringify(obj),
});

const corsHeaders = (origin) => {
  const allow = origin && CORS_ALLOW.includes(origin) ? origin : "*";
  return {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": allow,
    "access-control-allow-headers": "content-type,authorization",
    "access-control-allow-methods": "POST,OPTIONS",
    "cache-control": "no-store",
  };
};

const dayKey = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
const keyIdem = (u, s, g, start, end) => `${KEY_NS}:idemp:${hash(`${u}|${s}|${g}|${start}|${end}`)}`;
const keyDaily = (u, day = dayKey()) => `${KEY_NS}:daily:${u}:${day}`;

export async function handler(event) {
  const origin = event.headers?.origin;
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(origin) };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "method_not_allowed" }, origin);
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "bad_json" }, origin);
  }

  const { userId, gameId, sessionId, windowStart, windowEnd, visibilitySeconds, inputEvents } = body;

  if (!userId || !gameId || !sessionId || !Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) {
    return json(400, { error: "missing_fields" }, origin);
  }

  const now = Date.now();
  const elapsed = windowEnd - windowStart;
  if (windowEnd > now + DRIFT_MS || elapsed < (CHUNK_MS - DRIFT_MS)) {
    return json(422, { ok: false, error: "invalid_window", elapsed }, origin);
  }
  if ((visibilitySeconds ?? 0) < MIN_VISIBILITY_S || (inputEvents ?? 0) < MIN_INPUTS) {
    return json(200, { ok: true, awarded: 0, reason: "insufficient-activity" }, origin);
  }

  // Atomic Lua script: idempotency + cap + increment in one op
  const today = dayKey(now);
  const dailyKey = keyDaily(userId, today);
  const idem = keyIdem(userId, sessionId, gameId, windowStart, windowEnd);

  const script = `
    local daily = KEYS[1]
    local idem = KEYS[2]
    local now = tonumber(ARGV[1])
    local chunk = tonumber(ARGV[2])
    local step = tonumber(ARGV[3])
    local cap  = tonumber(ARGV[4])
    local idemTtl = tonumber(ARGV[5])
    if redis.call('GET', idem) then
      local t = tonumber(redis.call('GET', daily) or '0')
      return {0, t, 1}
    end
    local current = tonumber(redis.call('GET', daily) or '0')
    if current >= cap then
      redis.call('SETEX', idem, idemTtl, '1')
      return {0, current, 2}
    end
    local remaining = cap - current
    local grant = step
    if grant > remaining then grant = remaining end
    local newtotal = tonumber(redis.call('INCRBY', daily, grant))
    redis.call('SETEX', idem, idemTtl, '1')
    return {grant, newtotal, 0}
  `;

  const result = await store.eval(
    script,
    [dailyKey, idem],
    [String(now), String(CHUNK_MS), String(POINTS_PER_PERIOD), String(DAILY_CAP), String(24 * 3600)]
  );

  const granted = Number(result?.[0]) || 0;
  const total = Number(result?.[1]) || 0;
  const status = Number(result?.[2]) || 0; // 0=normal,1=idempotent,2=capped

  const payload = { ok: true, awarded: granted, totalToday: total, cap: DAILY_CAP };
  if (status === 1) payload.idempotent = true;
  if (status === 2) payload.capped = true;
  return json(200, payload, origin);
}
