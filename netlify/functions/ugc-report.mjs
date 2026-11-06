import crypto from "node:crypto";
import { atomicRateLimitIncr, xpStoreUnavailableResponse } from "./_shared/store-upstash.mjs";
import { baseHeaders, corsHeaders, extractBearerToken, verifySupabaseJwt, klog } from "./_shared/supabase-admin.mjs";
import { createReport, ugcSafetyEnabled } from "./_shared/ugc-safety.mjs";

// #1140 UGC phase B: POST {targetHandle | targetUserId, reason, context: "profile" | "table", tableId?}.
// Signed-in users only; at most UGC_REPORT_LIMIT_PER_HOUR reports per user and hour (default 10), failing closed.
const LIMIT_PER_HOUR = Math.max(1, Number(process.env.UGC_REPORT_LIMIT_PER_HOUR || 10));

function json(statusCode, headers, body) {
  return { statusCode, headers: { ...headers, "cache-control": "no-store" }, body: JSON.stringify(body) };
}

// The key carries only a hash of the user id and expires after the hour.
async function allowReport(userId) {
  const hash = crypto.createHash("sha256").update(userId).digest("hex");
  const { count } = await atomicRateLimitIncr(`kcswh:ugc:report:${hash}:${Math.floor(Date.now() / 3600000)}`, 3600);
  return count <= LIMIT_PER_HOUR;
}

function createUgcReportHandler(deps = {}) {
  const env = deps.env || process.env;
  const verifyJwt = deps.verifySupabaseJwt || verifySupabaseJwt;
  const report = deps.createReport || createReport;
  const allow = deps.allowReport || allowReport;
  return async function handler(event) {
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = corsHeaders(origin, { methods: "POST, OPTIONS" });
    if (!cors) return json(403, baseHeaders(), { error: "forbidden_origin" });
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
    if (event.httpMethod !== "POST") return json(405, cors, { error: "method_not_allowed" });
    try {
      const token = extractBearerToken(event.headers);
      if (!token) return json(401, cors, { error: "unauthorized" });
      const auth = await verifyJwt(token);
      if (!auth.valid || !auth.userId) return json(401, cors, { error: "unauthorized" });
      if (!ugcSafetyEnabled(env, event)) return json(404, cors, { error: "not_found" });
      let body;
      try {
        body = JSON.parse(event.body || "null");
      } catch {
        return json(400, cors, { error: "invalid_json" });
      }
      const unavailable = deps.allowReport ? null : xpStoreUnavailableResponse(cors);
      if (unavailable) return unavailable;
      let allowed;
      try {
        allowed = await allow(auth.userId);
      } catch (error) {
        klog("ugc_report_rate_limit_failed", { message: error?.message || "error" });
        return json(503, cors, { error: "rate_limit_unavailable" });
      }
      if (!allowed) return json(429, cors, { error: "rate_limit_exceeded" });
      const result = await report(auth.userId, body);
      klog("ugc_report_received", { status: result.status, reason: body?.reason, context: body?.context });
      return json(result.status === "reported" ? 201 : 200, cors, result);
    } catch (error) {
      if (error?.code === "account_not_active") return json(403, cors, { error: "account_not_active" });
      if (error?.status && error.status < 500) return json(error.status, cors, { error: error.code });
      klog("ugc_report_failed", { code: error?.code || "report_unavailable" });
      return json(500, cors, { error: "server_error" });
    }
  };
}

const handler = createUgcReportHandler();

export { createUgcReportHandler, handler };
