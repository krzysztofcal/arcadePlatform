import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { baseHeaders, corsHeaders, klog } from "./_shared/supabase-admin.mjs";
import { ugcSafetyEnabled } from "./_shared/ugc-safety.mjs";
import { decideReport, listReports, unrestrictProfile } from "./_shared/ugc-moderation.mjs";

// #1140 UGC phase C, allowlisted admins only (ADMIN_USER_IDS):
// GET ?status=pending|resolved|dismissed&after=<id>&limit=<n> -> { pendingCount, reports, next }
// POST { reportId, decision: "resolved" | "dismissed", action?: "none" | "hide_avatar" | "restrict_profile" }
// POST { userId, action: "unrestrict_profile" } (correction without a report)
function json(statusCode, headers, body) {
  return { statusCode, headers: { ...headers, "cache-control": "no-store" }, body: JSON.stringify(body) };
}

function createAdminUgcReportsHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const list = deps.listReports || listReports;
  const decide = deps.decideReport || decideReport;
  const unrestrict = deps.unrestrictProfile || unrestrictProfile;
  return async function handler(event) {
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = corsHeaders(origin, { methods: "GET, POST, OPTIONS" });
    if (!cors) return json(403, baseHeaders(), { error: "forbidden_origin" });
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return json(405, cors, { error: "method_not_allowed" });
    let admin;
    try {
      admin = await requireAdmin(event, env);
    } catch (error) {
      return adminAuthErrorResponse(error, { ...cors, "cache-control": "no-store" });
    }
    if (!ugcSafetyEnabled(env)) return json(404, cors, { error: "not_found" });
    try {
      if (event.httpMethod === "GET") return json(200, cors, await list(admin.userId, event.queryStringParameters || {}));
      let body;
      try {
        body = JSON.parse(event.body || "null");
      } catch {
        return json(400, cors, { error: "invalid_json" });
      }
      if (body && body.action === "unrestrict_profile") {
        if (Object.keys(body).some((key) => key !== "action" && key !== "userId")) return json(400, cors, { error: "invalid_decision" });
        const result = await unrestrict(admin.userId, body.userId);
        klog("ugc_moderation_unrestrict", { admin: admin.userId });
        return json(200, cors, result);
      }
      const result = await decide(admin.userId, body);
      klog("ugc_moderation_decision", { admin: admin.userId, status: result.status, action: result.action });
      return json(200, cors, result);
    } catch (error) {
      if (error?.status && error.status < 500) return json(error.status, cors, { error: error.code });
      klog("ugc_moderation_failed", { code: error?.code || "moderation_unavailable" });
      return json(500, cors, { error: "server_error" });
    }
  };
}

const handler = createAdminUgcReportsHandler();

export { createAdminUgcReportsHandler, handler };
