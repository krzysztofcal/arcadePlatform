import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { badRequest, conflict, parseJsonBody, parseUuid } from "./_shared/admin-ops.mjs";
import { baseHeaders, beginSql, corsHeaders, executeSql, klog } from "./_shared/supabase-admin.mjs";
import { notifyWsPokerAccessMutation } from "./_shared/poker-ws-runtime-notify.mjs";
import { ACCESS_OVERRIDES, hasPokerPoolSchema, normalizeAccessOverride } from "../../shared/poker-domain/bot-access.mjs";

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
    if (!await hasPokerPoolSchema(tx)) {
      const error = new Error("poker_access_schema_unavailable");
      error.code = "poker_access_schema_unavailable";
      error.status = 409;
      throw error;
    }
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
    return { access: result };
  });
}

function isConfirmedAccess(propagation, access) {
  return propagation?.ok === true
    && propagation?.skipped !== true
    && propagation?.refreshed === true
    && propagation?.failClosed === false
    && propagation?.pending === false
    && Number.isSafeInteger(access?.revision) && access.revision > 0
    && propagation.revision === access.revision
    && ACCESS_OVERRIDES.includes(access.override)
    && propagation.override === access.override;
}

function createAdminUserPokerAccessHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const loadAccess = deps.loadPokerAccess || loadPokerAccess;
  const updateAccess = deps.updatePokerAccess || updatePokerAccess;
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
      let preInvalidation = await notifyAccessMutation({
        userId,
        override: requestedOverride,
        expectedRevision,
        phase: "invalidate",
        env,
        klog
      });
      if (preInvalidation?.reason === "poker_access_mutation_pending") {
        // Recover the previous committed mutation, never release an in-flight
        // write or reuse this caller's stale optimistic revision for a new one.
        let recovery;
        try {
          recovery = await notifyAccessMutation({ userId, phase: "refresh", env, klog });
        } catch {
          recovery = null;
        }
        if (!isConfirmedAccess(recovery, recovery)) {
          return { statusCode: 409, headers: cors, body: JSON.stringify({ error: "poker_access_mutation_pending" }) };
        }
        const access = await loadAccess(userId);
        if (access.revision !== Number(expectedRevision)) {
          return { statusCode: 409, headers: cors, body: JSON.stringify({ error: "stale_revision", access }) };
        }
        // The caller already holds this revision. Reserve a fresh barrier;
        // never silently substitute a newer revision on the caller's behalf.
        preInvalidation = await notifyAccessMutation({
          userId, override: requestedOverride, expectedRevision, phase: "invalidate", env, klog
        });
        if (preInvalidation?.reason === "poker_access_mutation_pending") {
          return { statusCode: 409, headers: cors, body: JSON.stringify({ error: "poker_access_mutation_pending" }) };
        }
      }
      if (preInvalidation?.skipped === true
        || preInvalidation?.ok !== true
        || preInvalidation?.invalidated !== true
        || preInvalidation?.failClosed !== true) {
        klog("admin_poker_access_pre_invalidation_failed", {
          userId,
          reason: preInvalidation?.reason || "unconfirmed"
        });
        return {
          statusCode: 503,
          headers: cors,
          body: JSON.stringify({
            error: "poker_access_pre_invalidation_failed"
          })
        };
      }

      let result;
      try {
        result = await updateAccess({
          userId,
          override: requestedOverride,
          expectedRevision,
          actorId: admin.userId,
        });
      } catch (error) {
        // The WS fail-closed marker must not linger after a transaction that
        // definitely did not commit. If this recovery refresh is unavailable,
        // the marker remains fail-closed until a later authoritative refresh.
        try {
          await notifyAccessMutation({
            userId,
            override: requestedOverride,
            phase: "refresh",
            releasePending: true,
            expectedRevision,
            env,
            klog
          });
        } catch (refreshError) {
          klog("admin_poker_access_failure_refresh_failed", {
            userId,
            reason: refreshError?.message || "refresh_failed"
          });
        }
        throw error;
      }
      let propagation = null;
      const committedAccess = { revision: result?.access?.revision, override: requestedOverride };
      // Retry only the bounded authoritative confirmation, never the DB write.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          propagation = await notifyAccessMutation({
            userId,
            override: requestedOverride,
            revision: committedAccess.revision,
            expectedRevision,
            phase: "refresh",
            env,
            klog
          });
        } catch {
          propagation = { ok: false, reason: "confirmation_failed" };
        }
        if (isConfirmedAccess(propagation, committedAccess)) break;
      }
      if (!isConfirmedAccess(propagation, committedAccess)) {
        klog("admin_poker_access_propagation_failed", {
          userId,
          revision: result?.access?.revision ?? null,
          reason: propagation?.reason || "unconfirmed"
        });
        return {
          statusCode: 503,
          headers: cors,
          body: JSON.stringify({ error: "poker_access_propagation_failed", access: result?.access || null })
        };
      }
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ...result, propagation }) };
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
