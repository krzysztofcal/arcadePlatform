import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { badRequest, parseIdempotencyKey, parseJsonBody, parseOptionalText, parseUuid, runAdminTableAction } from "./_shared/admin-ops.mjs";
import { baseHeaders, corsHeaders, klog } from "./_shared/supabase-admin.mjs";

function parseForceCloseBody(body, adminUserId) {
  const payload = parseJsonBody(body);
  const tableId = parseUuid(payload.tableId, "invalid_table_id");
  const confirmAction = typeof payload.confirmAction === "string" ? payload.confirmAction.trim() : "";
  const confirmationToken = typeof payload.confirmationToken === "string" ? payload.confirmationToken.trim() : "";
  const reason = parseOptionalText(payload.reason, { maxLength: 240 });
  if (!reason) {
    throw badRequest("missing_reason", "missing_reason");
  }
  if (confirmAction !== "force_close") {
    throw badRequest("invalid_confirm_action", "invalid_confirm_action");
  }
  if (confirmationToken !== `force-close:${tableId}`) {
    throw badRequest("invalid_confirmation_token", "invalid_confirmation_token");
  }
  return {
    tableId,
    reason,
    requestedAction: "force_close",
    idempotencyKey: `admin-force-close:${adminUserId}:${tableId}:${parseIdempotencyKey(payload.idempotencyKey)}`,
  };
}

function createAdminTableForceCloseHandler(deps = {}) {
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
      const payload = parseForceCloseBody(event.body, admin.userId);
      const result = await runAction({
        adminUserId: admin.userId,
        tableId: payload.tableId,
        requestedAction: payload.requestedAction,
        idempotencyKey: payload.idempotencyKey,
        reason: payload.reason,
        env,
      });
      klog("admin_table_force_close_ok", {
        adminUserId: admin.userId,
        tableId: payload.tableId,
        idempotencyKey: payload.idempotencyKey,
        status: result?.status || null,
      });
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          ok: true,
          tableId: payload.tableId,
          idempotencyKey: payload.idempotencyKey,
          result,
        }),
      };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        return adminAuthErrorResponse(error, cors);
      }
      if (error?.status === 400 || error?.status === 404 || error?.status === 409) {
        klog("admin_table_force_close_error", { message: error?.message || "error", code: error?.code || null });
        return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code || "invalid_request" }) };
      }
      klog("admin_table_force_close_error", { message: error?.message || "error", code: error?.code || null });
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
    }
  };
}

const handler = createAdminTableForceCloseHandler();

export {
  createAdminTableForceCloseHandler,
  handler,
};
