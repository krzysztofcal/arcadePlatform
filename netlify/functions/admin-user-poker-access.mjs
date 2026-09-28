import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { badRequest, parseJsonBody, parseUuid } from "./_shared/admin-ops.mjs";
import { baseHeaders, corsHeaders, executeSql, klog } from "./_shared/supabase-admin.mjs";
import { notifyWsPokerAccessMutation } from "./_shared/poker-ws-runtime-notify.mjs";
import { ACCESS_OVERRIDES, normalizeAccessOverride } from "../../shared/poker-domain/bot-access.mjs";

function normalizeAccessRow(row) {
  if (!row) return null;
  const automaticClass = String(row.poker_auto_class || "NORMAL").toUpperCase();
  const override = String(row.poker_access_override || "AUTO").toUpperCase();
  const effectiveClass = override === "FORCE_NORMAL"
    ? "NORMAL"
    : override === "FORCE_SLOW"
      ? "SLOW"
      : override === "FORCE_RESTRICTED"
        ? "RESTRICTED"
      : automaticClass;
  return {
    userId: row.user_id || null,
    automaticClass,
    override,
    effectiveClass,
    revision: Number(row.poker_access_revision || 0),
    automaticSlowAt: row.poker_auto_slow_at || null,
    updatedAt: row.poker_access_updated_at || null,
    updatedBy: row.poker_access_updated_by || null,
  };
}

function parseOverride(value) {
  const normalized = normalizeAccessOverride(value);
  if (!normalized || !ACCESS_OVERRIDES.includes(normalized)) throw badRequest("invalid_override", "invalid_override");
  return normalized;
}

async function loadPokerAccess(userId, runSql = executeSql) {
  const rows = await runSql(`
select user_id, poker_auto_class, poker_access_override, poker_access_revision,
       poker_auto_slow_at, poker_access_updated_at, poker_access_updated_by
from public.chips_accounts
where user_id = $1::uuid and account_type = 'USER'
limit 1;
`, [userId]);
  if (!rows?.[0]) throw badRequest("user_not_found", "user_not_found");
  return normalizeAccessRow(rows[0]);
}

function createAdminUserPokerAccessHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const loadAccess = deps.loadPokerAccess || loadPokerAccess;
  const notifyAccessMutation = deps.notifyWsPokerAccessMutation || notifyWsPokerAccessMutation;
  return async function handler(event) {
    if (env.CHIPS_ENABLED !== "1") return { statusCode: 404, headers: baseHeaders(), body: JSON.stringify({ error: "not_found" }) };
    const cors = corsHeaders(event.headers?.origin || event.headers?.Origin);
    if (!cors) return { statusCode: 403, headers: baseHeaders(), body: JSON.stringify({ error: "forbidden_origin" }) };
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
    try {
      const admin = await requireAdmin(event, env);
      if (event.httpMethod === "GET") {
        const userId = parseUuid(event.queryStringParameters?.userId, "invalid_user_id");
        return { statusCode: 200, headers: cors, body: JSON.stringify(await loadAccess(userId)) };
      }
      if (event.httpMethod !== "PATCH" && event.httpMethod !== "POST") {
        return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
      }
      const body = parseJsonBody(event.body);
      const userId = parseUuid(body.userId, "invalid_user_id");
      const requestedOverride = parseOverride(body.override);
      const expectedRevision = body.expectedRevision ?? body.expected_revision;
      if (!Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) <= 0
        || Number(expectedRevision) >= Number.MAX_SAFE_INTEGER) {
        throw badRequest("invalid_expected_revision", "invalid_expected_revision");
      }
      const result = await notifyAccessMutation({
        userId,
        override: requestedOverride,
        expectedRevision: Number(expectedRevision),
        actorId: admin.userId,
        env,
        klog
      });
      if (result?.ok !== true) {
        const code = result?.reason || "access_mutation_failed";
        const statusCode = result?.status || (code === "stale_revision" || code === "poker_access_mutation_in_progress" ? 409 : 503);
        klog("admin_poker_access_mutation_failed", { userId, code, status: statusCode });
        return {
          statusCode,
          headers: cors,
          body: JSON.stringify({ error: code, reason: code })
        };
      }
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify(result)
      };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) return adminAuthErrorResponse(error, cors);
      if (error?.status === 400 || error?.status === 409) return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code || "invalid_request" }) };
      klog("admin_poker_access_failed", { code: error?.code || "server_error" });
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
    }
  };
}

const handler = createAdminUserPokerAccessHandler();

export { createAdminUserPokerAccessHandler, handler, loadPokerAccess };
