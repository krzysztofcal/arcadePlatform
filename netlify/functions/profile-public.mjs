import crypto from "node:crypto";
import { atomicRateLimitIncr, getUserProfile } from "./_shared/store-upstash.mjs";
import { baseHeaders, corsHeaders, klog } from "./_shared/supabase-admin.mjs";
import { findPublicProfile, publicProfile } from "./_shared/user-profile.mjs";
import { computeXpLevel } from "./_shared/xp-level.mjs";

const RATE_LIMIT_PER_MIN = Math.max(0, Number(process.env.PROFILE_PUBLIC_RATE_LIMIT_IP_PER_MIN || 60));

function json(statusCode, headers, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function profileCors(origin) {
  const headers = corsHeaders(origin);
  return headers ? { ...headers, "access-control-allow-methods": "GET, OPTIONS" } : null;
}

function publicProfilesEnabled(env, event = {}) {
  if (Object.prototype.hasOwnProperty.call(env, "PUBLIC_PROFILES_ENABLED")) {
    return env.PUBLIC_PROFILES_ENABLED === "1";
  }
  if (env.CONTEXT === "deploy-preview" || env.NETLIFY_CONTEXT === "deploy-preview") return true;
  const host = event.headers?.host || event.headers?.Host || "";
  return /^deploy-preview-[a-z0-9-]+\.netlify\.app$/i.test(String(host).split(":")[0]);
}

function clientIp(event) {
  return event.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || event.headers?.["x-real-ip"] || "unknown";
}

async function allowPublicRead(event) {
  if (RATE_LIMIT_PER_MIN === 0) return true;
  try {
    const ipHash = crypto.createHash("sha256").update(clientIp(event)).digest("hex");
    const key = `kcswh:profile:public:${ipHash}:${Math.floor(Date.now() / 60000)}`;
    const { count } = await atomicRateLimitIncr(key, 60);
    return count <= RATE_LIMIT_PER_MIN;
  } catch (error) {
    klog("profile_public_rate_limit_failed", { message: error?.message || "error" });
    return true;
  }
}

function createProfilePublicHandler(deps = {}) {
  const env = deps.env || process.env;
  const findProfile = deps.findPublicProfile || findPublicProfile;
  const allowRead = deps.allowPublicRead || allowPublicRead;
  const getPublicXp = deps.getUserProfile || getUserProfile;
  return async function handler(event) {
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = profileCors(origin);
    if (!cors) return json(403, baseHeaders(), { error: "forbidden_origin" });
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
    if (event.httpMethod !== "GET") return json(405, cors, { error: "method_not_allowed" });
    if (!publicProfilesEnabled(env, event)) return json(404, cors, { error: "not_found" });
    if (!await allowRead(event)) return json(429, cors, { error: "rate_limit_exceeded" });

    try {
      const profile = await findProfile(event.queryStringParameters?.handle);
      if (!profile) return json(404, cors, { error: "not_found" });
      const xpProfile = await getPublicXp(profile.userId);
      const xp = Math.max(0, Math.floor(Number(xpProfile?.totalXp) || 0));
      return json(200, { ...cors, "cache-control": "public, max-age=30", Vary: "Origin" }, publicProfile(profile, {
        xp,
        level: computeXpLevel(xp),
      }));
    } catch (error) {
      klog("profile_public_failed", { message: error?.message || "error" });
      return json(500, cors, { error: "server_error" });
    }
  };
}

const handler = createProfilePublicHandler();

export { createProfilePublicHandler, handler, publicProfilesEnabled };
