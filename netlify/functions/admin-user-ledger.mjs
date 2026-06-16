import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { listUserLedger } from "./_shared/chips-ledger.mjs";
import { baseHeaders, corsHeaders, klog } from "./_shared/supabase-admin.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEDGER_VERSION = process.env.COMMIT_REF || process.env.BUILD_ID || process.env.DEPLOY_ID || new Date().toISOString();

function withLedgerVersion(headers) {
  return { ...headers, "x-chips-ledger-version": LEDGER_VERSION };
}

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

function normalizeCursor(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value || null;
}

function normalizeLimit(raw) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return 25;
  return Math.min(Math.max(parsed, 1), 100);
}

function createAdminUserLedgerHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const fetchLedger = deps.listUserLedger || listUserLedger;
  return async function handler(event) {
    if (env.CHIPS_ENABLED !== "1") {
      return { statusCode: 404, headers: withLedgerVersion(baseHeaders()), body: JSON.stringify({ error: "not_found" }) };
    }

    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = corsHeaders(origin);
    if (!cors) {
      return { statusCode: 403, headers: withLedgerVersion(baseHeaders()), body: JSON.stringify({ error: "forbidden_origin" }) };
    }
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: withLedgerVersion(cors), body: "" };
    }
    if (event.httpMethod !== "GET") {
      return { statusCode: 405, headers: withLedgerVersion(cors), body: JSON.stringify({ error: "method_not_allowed" }) };
    }

    try {
      await requireAdmin(event, env);
      const qs = event.queryStringParameters || {};
      const userId = readUserId(event);
      const limit = normalizeLimit(qs.limit);
      const cursor = normalizeCursor(qs.cursor);
      const ledger = await fetchLedger(userId, { cursor, limit });
      const items = Array.isArray(ledger.items) ? ledger.items : ledger.entries || [];
      return {
        statusCode: 200,
        headers: withLedgerVersion(cors),
        body: JSON.stringify({
          userId,
          items,
          entries: items,
          nextCursor: ledger.nextCursor || null,
        }),
      };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        return adminAuthErrorResponse(error, withLedgerVersion(cors));
      }
      if (error?.status === 400) {
        return { statusCode: 400, headers: withLedgerVersion(cors), body: JSON.stringify({ error: error.code || "invalid_request" }) };
      }
      const status = error?.status || 500;
      const code = error?.code || "server_error";
      klog("admin_user_ledger_error", { message: error?.message || "error", code });
      return { statusCode: status, headers: withLedgerVersion(cors), body: JSON.stringify({ error: code }) };
    }
  };
}

const handler = createAdminUserLedgerHandler();

export {
  createAdminUserLedgerHandler,
  handler,
};
