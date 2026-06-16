import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { getUserBalance } from "./_shared/chips-ledger.mjs";
import { baseHeaders, corsHeaders, klog } from "./_shared/supabase-admin.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readUserId(event) {
  const qs = event.queryStringParameters || {};
  const userId = typeof qs.userId === "string" ? qs.userId.trim() : "";
  if (!UUID_RE.test(userId)) {
    const error = new Error("invalid_user_id");
    error.status = 400;
    error.code = "invalid_user_id";
    throw error;
  }
  return userId;
}

function createAdminUserBalanceHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const fetchBalance = deps.getUserBalance || getUserBalance;
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
      const userId = readUserId(event);
      const balance = await fetchBalance(userId);
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          userId,
          accountId: balance.accountId,
          balance: balance.balance,
          nextEntrySeq: balance.nextEntrySeq,
          status: balance.status,
        }),
      };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        return adminAuthErrorResponse(error, cors);
      }
      if (error?.status === 400) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: error.code || "invalid_request" }) };
      }
      klog("admin_user_balance_error", { message: error?.message || "error" });
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
    }
  };
}

const handler = createAdminUserBalanceHandler();

export {
  createAdminUserBalanceHandler,
  handler,
};
