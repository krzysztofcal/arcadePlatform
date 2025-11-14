import { getTotals } from "./lib/daily-totals.mjs";

const CORS_ALLOW = (process.env.XP_CORS_ALLOW ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const DEBUG_ENABLED = process.env.XP_DEBUG === "1";

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

function json(statusCode, body, origin) {
  return {
    statusCode,
    headers: corsHeaders(origin),
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  if (event.httpMethod === "GET") {
    const params = event.queryStringParameters || {};
    return {
      userId: typeof params.userId === "string" ? params.userId.trim() : null,
      sessionId: typeof params.sessionId === "string" ? params.sessionId.trim() : null,
    };
  }
  if (!event.body) return { userId: null, sessionId: null };
  try {
    const parsed = JSON.parse(event.body);
    return {
      userId: typeof parsed.userId === "string" ? parsed.userId.trim() : null,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId.trim() : null,
    };
  } catch {
    return { userId: null, sessionId: null };
  }
}

export async function handler(event) {
  const origin = event.headers?.origin;
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(origin) };
  }
  if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
    return json(405, { error: "method_not_allowed" }, origin);
  }

  const { userId, sessionId } = parseBody(event);
  if (!userId) {
    return json(400, { error: "missing_user_id" }, origin);
  }

  const totals = await getTotals({ userId, sessionId, now: Date.now() });
  if (DEBUG_ENABLED) {
    console.log("status_daily_totals", { userId, sessionId, totals });
  }

  const payload = {
    ok: true,
    cap: totals.cap,
    dailyCap: totals.cap,
    totalToday: totals.totalToday,
    awardedToday: totals.totalToday,
    remaining: totals.remaining,
    remainingToday: totals.remaining,
    dayKey: totals.dayKey,
    nextReset: totals.nextReset,
    nextResetEpoch: totals.nextReset,
    totalLifetime: totals.lifetime,
    totalXp: totals.lifetime,
    sessionTotal: totals.sessionTotal,
    lastSync: totals.lastSync,
    __serverHasDaily: true,
  };

  return json(200, payload, origin);
}
