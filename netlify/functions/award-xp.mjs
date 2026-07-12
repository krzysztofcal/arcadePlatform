import { store } from "./_shared/store-upstash.mjs";
import { extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { nextWarsawResetMs, warsawDayKey } from "./_shared/time-utils.mjs";
import { getXpPolicy, migrateAnonXpToUser, resolveXpIdentity } from "./_shared/xp-identity.mjs";
import { createXpLedgerKeys, readXpTotals } from "./_shared/xp-ledger.mjs";
import { persistXpProfileSnapshot, readCanonicalXpStatus } from "./_shared/xp-status.mjs";

const XP_POLICY = getXpPolicy();
const KEY_NS = process.env.XP_KEY_NS ?? "kcswh:xp:v2";
const XP_KEYS = createXpLedgerKeys({ namespace: KEY_NS });

const corsAllowlist = () => {
  const values = (process.env.XP_CORS_ALLOW ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (process.env.URL && !values.includes(process.env.URL)) values.push(process.env.URL);
  return values;
};

function response(statusCode, payload, origin, extraHeaders = {}) {
  const allowed = corsAllowlist();
  const isPreview = origin && /^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(origin);
  if (origin && !isPreview && allowed.length > 0 && !allowed.includes(origin)) {
    return { statusCode: 403, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ error: "forbidden", message: "origin_not_allowed" }) };
  }
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-headers"] = "content-type,authorization,x-api-key";
    headers["access-control-allow-methods"] = "POST,OPTIONS";
    headers.Vary = "Origin";
  }
  return { statusCode, headers, body: JSON.stringify(payload) };
}

export async function handler(event) {
  const origin = event.headers?.origin;
  if (event.httpMethod === "OPTIONS") return response(204, {}, origin);
  if (event.httpMethod !== "POST") return response(405, { error: "method_not_allowed" }, origin);

  let body;
  try { body = event.body ? JSON.parse(event.body) : {}; }
  catch { return response(400, { error: "bad_json" }, origin); }

  const token = extractBearerToken(event.headers);
  const authContext = await verifySupabaseJwt(token);
  if (token && !authContext.valid) {
    return response(401, { error: "unauthorized", message: authContext.reason || "invalid_token" }, origin);
  }

  if (body.statusOnly !== true) {
    return response(410, {
      error: "legacy_award_retired",
      message: "Client-provided XP awards are no longer supported.",
      endpoint: "/.netlify/functions/calculate-xp",
    }, origin);
  }

  const rawAnonId = typeof body.anonId === "string" ? body.anonId : body.userId;
  const identity = resolveXpIdentity({ anonId: typeof rawAnonId === "string" ? rawAnonId.trim() : null, authContext });
  if (!identity.identityId) return response(400, { error: "missing_fields", message: "identity required" }, origin);

  const now = Date.now();
  let conversion = null;
  if (identity.supabaseUserId && identity.anonId) {
    try {
      conversion = await migrateAnonXpToUser({
        store,
        namespace: KEY_NS,
        anonId: identity.anonId,
        userId: identity.supabaseUserId,
        conversionCap: XP_POLICY.anonConversionCap,
      });
    } catch (error) {
      klog("xp_legacy_status_conversion_failed", { error: error?.message });
    }
  }

  const sessionId = typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : null;
  const dayKey = warsawDayKey(now);
  try {
    const result = await readCanonicalXpStatus({
      readTotals: () => readXpTotals({ store, keys: XP_KEYS, userId: identity.identityId, sessionId, dayKey }),
      dailyCap: XP_POLICY.dailyCap,
      deltaCap: XP_POLICY.deltaCap,
      sessionId,
      dayKey,
      nextReset: nextWarsawResetMs(now),
      supabaseUserId: identity.supabaseUserId,
      persistProfile: ({ userId, totalXp }) => persistXpProfileSnapshot({ userId, totalXp, now }),
    });
    if (conversion?.converted > 0) result.payload.conversion = { converted: conversion.converted };
    return response(200, result.payload, origin);
  } catch (error) {
    klog("xp_legacy_status_read_failed", { error: error?.message });
    return response(500, { error: "server_error" }, origin);
  }
}
