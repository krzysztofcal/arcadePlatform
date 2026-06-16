import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { createTableMeta, evaluatePersistedTableSnapshot, loadPersistedTableSnapshot, notFound, parseUuid } from "./_shared/admin-ops.mjs";
import { baseHeaders, corsHeaders } from "./_shared/supabase-admin.mjs";

async function evaluateTable(tableId, env = process.env) {
  const snapshot = await loadPersistedTableSnapshot(tableId);
  if (!snapshot?.table) {
    throw notFound("table_not_found", "table_not_found");
  }
  return {
    table: createTableMeta(snapshot),
    janitor: evaluatePersistedTableSnapshot(snapshot, env),
  };
}

function createAdminTableEvaluateHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const evaluateTableFn = deps.evaluateTable || ((tableId) => evaluateTable(tableId, env));
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
    if (event.httpMethod !== "GET") {
      return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
    }
    try {
      await requireAdmin(event, env);
      const qs = event.queryStringParameters || {};
      const payload = await evaluateTableFn(parseUuid(qs.tableId, "invalid_table_id"));
      return { statusCode: 200, headers: cors, body: JSON.stringify(payload) };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        return adminAuthErrorResponse(error, cors);
      }
      if (error?.status === 400 || error?.status === 404) {
        return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code || "invalid_request" }) };
      }
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
    }
  };
}

const handler = createAdminTableEvaluateHandler();

export {
  createAdminTableEvaluateHandler,
  evaluateTable,
  handler,
};
