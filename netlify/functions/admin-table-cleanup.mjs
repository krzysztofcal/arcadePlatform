import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { parseIdempotencyKey, parseJsonBody, parseOptionalText, parseUuid, runAdminTableAction } from "./_shared/admin-ops.mjs";
import { baseHeaders, corsHeaders, klog } from "./_shared/supabase-admin.mjs";

function parseBody(body, adminUserId) {
  const payload = parseJsonBody(body);
  const tableId = parseUuid(payload.tableId, "invalid_table_id");
  const action = typeof payload.action === "string" ? payload.action.trim() : "";
  const clientKey = parseIdempotencyKey(payload.idempotencyKey);
  return {
    tableId,
    requestedAction: action,
    reason: parseOptionalText(payload.reason, { maxLength: 240 }),
    idempotencyKey: `admin-table:${adminUserId}:${tableId}:${action}:${clientKey}`,
  };
}

function createAdminTableCleanupHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const runAction = deps.runAdminTableAction || runAdminTableAction;
  return async function handler(event) {
    if (env.CHIPS_ENABLED !== "1") {
      return { statusCode: 404, headers: baseHeaders(), body: JSON.stringify({ error: "not_found" }) };
    }
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = corsHeaders(origin);
    if (!cors) {
      return { statusCode: 403, headers: baseHeaders(), body: JSON.stringify({ error: "forbidden_origin" }) };
    }
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: cors, body: "" };
    }
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
    }
    try {
      const admin = await requireAdmin(event, env);
      const payload = parseBody(event.body, admin.userId);
      const result = await runAction({
        adminUserId: admin.userId,
        tableId: payload.tableId,
        requestedAction: payload.requestedAction,
        idempotencyKey: payload.idempotencyKey,
        reason: payload.reason,
        env,
      });
      klog("admin_table_cleanup_ok", {
        adminUserId: admin.userId,
        tableId: payload.tableId,
        requestedAction: payload.requestedAction,
        idempotencyKey: payload.idempotencyKey,
        status: result?.status || null,
      });
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          ok: true,
          tableId: payload.tableId,
          requestedAction: payload.requestedAction,
          idempotencyKey: payload.idempotencyKey,
          result,
        }),
      };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        return adminAuthErrorResponse(error, cors);
      }
      if (error?.status === 400 || error?.status === 404 || error?.status === 409) {
        klog("admin_table_cleanup_error", { message: error?.message || "error", code: error?.code || null });
        return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code || "invalid_request" }) };
      }
      klog("admin_table_cleanup_error", { message: error?.message || "error", code: error?.code || null });
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
    }
  };
}

const handler = createAdminTableCleanupHandler();

export {
  createAdminTableCleanupHandler,
  handler,
};
