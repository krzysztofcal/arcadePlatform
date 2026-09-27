import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { badRequest, conflict, parseJsonBody, parseUuid } from "./_shared/admin-ops.mjs";
import { baseHeaders, beginSql, corsHeaders, executeSql, klog } from "./_shared/supabase-admin.mjs";
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

async function updatePokerAccess({ userId, override, expectedRevision, actorId, runTransaction = beginSql } = {}) {
  const normalizedOverride = parseOverride(override);
  if (!Number.isSafeInteger(Number(expectedRevision)) || Number(expectedRevision) <= 0) {
    throw badRequest("invalid_expected_revision", "invalid_expected_revision");
  }
  return runTransaction(async (tx) => {
    const rows = await tx.unsafe(`
select user_id, poker_auto_class, poker_access_override, poker_access_revision,
       poker_auto_slow_at, poker_access_updated_at, poker_access_updated_by
from public.chips_accounts
where user_id = $1::uuid and account_type = 'USER'
for update;
`, [userId]);
    if (!rows?.[0]) throw badRequest("user_not_found", "user_not_found");
    if (Number(rows[0].poker_access_revision) !== Number(expectedRevision)) {
      throw conflict("stale_revision", "stale_revision");
    }
    const updated = await tx.unsafe(`
update public.chips_accounts
set poker_access_override = $2,
    poker_access_revision = poker_access_revision + 1,
    poker_access_updated_at = timezone('utc', now()),
    poker_access_updated_by = $3::uuid
where user_id = $1::uuid and account_type = 'USER'
returning user_id, poker_auto_class, poker_access_override, poker_access_revision,
          poker_auto_slow_at, poker_access_updated_at, poker_access_updated_by;
`, [userId, normalizedOverride, actorId]);
    const result = normalizeAccessRow(updated?.[0]);
    klog("admin_poker_access_updated", { userId, actorId, override: normalizedOverride, revision: result?.revision });
    return { access: result, propagationMs: 30_000 };
  });
}

function createAdminUserPokerAccessHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const loadAccess = deps.loadPokerAccess || loadPokerAccess;
  const updateAccess = deps.updatePokerAccess || updatePokerAccess;
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
      const result = await updateAccess({
        userId,
        override: body.override,
        expectedRevision: body.expectedRevision ?? body.expected_revision,
        actorId: admin.userId,
      });
      return { statusCode: 200, headers: cors, body: JSON.stringify(result) };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) return adminAuthErrorResponse(error, cors);
      if (error?.status === 400 || error?.status === 409) return { statusCode: error.status, headers: cors, body: JSON.stringify({ error: error.code || "invalid_request" }) };
      klog("admin_poker_access_failed", { code: error?.code || "server_error" });
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
    }
  };
}

const handler = createAdminUserPokerAccessHandler();

export { createAdminUserPokerAccessHandler, handler, loadPokerAccess, updatePokerAccess };
