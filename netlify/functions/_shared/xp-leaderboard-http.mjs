import crypto from "node:crypto";
import { atomicRateLimitIncr } from "./store-upstash.mjs";
import { baseHeaders, corsHeaders, klog } from "./supabase-admin.mjs";

function leaderboardCors(origin) {
  const headers = corsHeaders(origin);
  return headers ? { ...headers, "access-control-allow-methods": "GET, OPTIONS", Vary: "Origin" } : null;
}

function leaderboardEnabled(env, event = {}) {
  if (Object.prototype.hasOwnProperty.call(env, "XP_LEADERBOARD_ENABLED")) return env.XP_LEADERBOARD_ENABLED === "1";
  if (env.CONTEXT === "deploy-preview" || env.NETLIFY_CONTEXT === "deploy-preview") return true;
  const host = String(event.headers?.host || event.headers?.Host || "").split(":")[0];
  return /^deploy-preview-[a-z0-9-]+\.netlify\.app$/i.test(host);
}

function clientIp(event) {
  return event.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || event.headers?.["x-real-ip"] || "unknown";
}

function configuredRateLimit(value, fallback = 60) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

async function allowLeaderboardRead(event, { scope = "public", limit = 60, increment = atomicRateLimitIncr } = {}) {
  if (limit <= 0) return true;
  try {
    const ipHash = crypto.createHash("sha256").update(clientIp(event)).digest("hex");
    const key = `kcswh:xp:leaderboard:ratelimit:${scope}:${ipHash}:${Math.floor(Date.now() / 60000)}`;
    const { count } = await increment(key, 60);
    return count <= limit;
  } catch (error) {
    klog("xp_leaderboard_rate_limit_failed", { scope, message: error?.message || "error" });
    return true;
  }
}

function json(statusCode, headers, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function errorResponse(error, cors) {
  const status = Number(error?.status) || 503;
  if (status === 400) return json(400, { ...cors, "cache-control": "no-store" }, { error: error?.code || "invalid_request" });
  return json(503, { ...cors, "cache-control": "no-store" }, { error: "leaderboard_unavailable" });
}

export { allowLeaderboardRead, baseHeaders, configuredRateLimit, errorResponse, json, leaderboardCors, leaderboardEnabled };
