import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { badRequest, parseIdempotencyKey, parseJsonBody, parseOptionalText, resolveJanitorConfig, runAdminTableAction } from "./_shared/admin-ops.mjs";
import { baseHeaders, corsHeaders, executeSql, klog } from "./_shared/supabase-admin.mjs";

function parseBody(body) {
  const payload = parseJsonBody(body);
  const action = typeof payload.action === "string" ? payload.action.trim() : "";
  if (!["open_table_reconciler", "stale_seat_sweep"].includes(action)) {
    throw badRequest("invalid_action", "invalid_action");
  }
  const limitRaw = payload.limit == null || payload.limit === "" ? 25 : Number.parseInt(String(payload.limit), 10);
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 50) {
    throw badRequest("invalid_limit", "invalid_limit");
  }
  return {
    action,
    limit: limitRaw,
    reason: parseOptionalText(payload.reason, { maxLength: 240 }),
    idempotencyKey: parseIdempotencyKey(payload.idempotencyKey),
  };
}

async function selectTableIdsForAction(action, limit, env = process.env) {
  if (action === "open_table_reconciler") {
    const rows = await executeSql(
      `
select id
from public.poker_tables
where status = 'OPEN'
order by updated_at asc, id asc
limit $1;
      `,
      [limit],
    );
    return (Array.isArray(rows) ? rows : []).map((row) => row.id).filter(Boolean);
  }
  const janitorConfig = resolveJanitorConfig(env);
  const staleSeatCutoffIso = new Date(
    Date.now() - Math.max(janitorConfig.activeSeatFreshMs, janitorConfig.seatedReconnectGraceMs),
  ).toISOString();
  const rows = await executeSql(
    `
select distinct s.table_id
from public.poker_seats s
join public.poker_tables t on t.id = s.table_id
where t.status = 'OPEN'
  and s.status = 'ACTIVE'
  and coalesce(s.is_bot, false) = false
  and (s.last_seen_at is null or s.last_seen_at <= $1::timestamptz)
order by s.table_id asc
limit $2;
    `,
    [staleSeatCutoffIso, limit],
  );
  return (Array.isArray(rows) ? rows : []).map((row) => row.table_id).filter(Boolean);
}

async function runOpsAction({ adminUserId, action, limit, reason, idempotencyKey, env = process.env }) {
  const tableIds = await selectTableIdsForAction(action, limit, env);
  const requestedAction = action === "stale_seat_sweep" ? "stale_seat_cleanup" : "reconcile";
  const results = [];
  for (const tableId of tableIds) {
    try {
      const result = await runAdminTableAction({
        adminUserId,
        tableId,
        requestedAction,
        idempotencyKey: `admin-ops:${adminUserId}:${action}:${idempotencyKey}:${tableId}`,
        reason: reason || action,
        env,
      });
      results.push({
        tableId,
        ok: result?.ok === true,
        changed: result?.changed === true,
        status: result?.status || null,
        effectiveAction: result?.effectiveAction || null,
        reasonCode: result?.classification?.reasonCode || null,
      });
    } catch (error) {
      results.push({
        tableId,
        ok: false,
        changed: false,
        status: error?.code || "failed",
        effectiveAction: null,
        reasonCode: null,
      });
    }
  }
  return {
    ok: true,
    action,
    processed: results.length,
    changedCount: results.filter((item) => item.changed).length,
    tableIds,
    results,
  };
}

function createAdminOpsActionsHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const runOpsActionFn = deps.runOpsAction || ((input) => runOpsAction({ ...input, env }));
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
      const payload = parseBody(event.body);
      const result = await runOpsActionFn({
        adminUserId: admin.userId,
        action: payload.action,
        limit: payload.limit,
        reason: payload.reason,
        idempotencyKey: payload.idempotencyKey,
      });
      klog("admin_ops_action_ok", {
        adminUserId: admin.userId,
        action: payload.action,
        limit: payload.limit,
        processed: result.processed,
      });
      return { statusCode: 200, headers: cors, body: JSON.stringify(result) };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        return adminAuthErrorResponse(error, cors);
      }
      if (error?.status === 400) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: error.code || "invalid_request" }) };
      }
      klog("admin_ops_action_error", { message: error?.message || "error", code: error?.code || null });
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
    }
  };
}

const handler = createAdminOpsActionsHandler();

export {
  createAdminOpsActionsHandler,
  handler,
  runOpsAction,
};
