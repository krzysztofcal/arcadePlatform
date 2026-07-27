import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { parseIdempotencyKey, parseJsonBody, parseOptionalText, parseUuid } from "./_shared/admin-ops.mjs";
import { baseHeaders, corsHeaders, klog } from "./_shared/supabase-admin.mjs";
import { buildStageIdentity } from "./admin-stage-identity.mjs";

const WS_PREVIEW_ORIGIN = "https://ws-preview.kcswh.pl";
const CONFIRMATION = "REPAIR BOT CLAIMS AND CLOSE";
const EXPOSED_RECOVERY_ERRORS = new Set([
  "active_table_presence",
  "foreign_human_history",
  "other_request_pending",
  "participant_identity_unknown",
  "preview_only",
  "recovery_input_changed",
  "request_pending",
  "state_version_changed",
]);

function jsonResponse(statusCode, headers, body) {
  return {
    statusCode,
    headers: { ...headers, "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

function recoveryError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function exactKeys(payload, expected) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const keys = Object.keys(payload).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}

function parseBody(body, adminUserId) {
  const payload = parseJsonBody(body);
  const mode = typeof payload.mode === "string" ? payload.mode.trim() : "";
  if (mode === "preflight" && exactKeys(payload, ["mode", "tableId"])) {
    return {
      mode,
      tableId: parseUuid(payload.tableId, "invalid_table_id"),
      adminUserId,
    };
  }
  if (mode !== "execute" || !exactKeys(payload, [
    "confirmation",
    "expectedInputHash",
    "expectedStateVersion",
    "idempotencyKey",
    "mode",
    "reason",
    "tableId",
  ])) {
    throw recoveryError("invalid_request");
  }
  const expectedStateVersion = Number(payload.expectedStateVersion);
  if (!Number.isSafeInteger(expectedStateVersion) || expectedStateVersion < 0) {
    throw recoveryError("invalid_state_version");
  }
  const expectedInputHash = typeof payload.expectedInputHash === "string"
    ? payload.expectedInputHash.trim()
    : "";
  if (!/^[a-f0-9]{64}$/i.test(expectedInputHash)) throw recoveryError("invalid_input_hash");
  if (String(payload.confirmation || "").trim() !== CONFIRMATION) {
    throw recoveryError("invalid_confirmation");
  }
  const clientKey = parseIdempotencyKey(payload.idempotencyKey);
  if (clientKey.length > 64) throw recoveryError("invalid_idempotency_key");
  const reason = parseOptionalText(payload.reason, { maxLength: 240 });
  if (reason.length < 3) throw recoveryError("missing_reason");
  const tableId = parseUuid(payload.tableId, "invalid_table_id");
  return {
    mode,
    tableId,
    adminUserId,
    expectedStateVersion,
    expectedInputHash,
    requestId: `admin-recovery:${tableId}:${clientKey}`,
    reason,
  };
}

function resolvePreviewBaseUrl(env) {
  const raw = typeof env?.POKER_WS_INTERNAL_BASE_URL === "string"
    ? env.POKER_WS_INTERNAL_BASE_URL.trim()
    : "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.origin !== WS_PREVIEW_ORIGIN
      || (url.pathname !== "/" && url.pathname !== "")
      || url.username
      || url.password
      || url.search
      || url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isValidRecoveryResponse(value, mode) {
  if (!value || typeof value !== "object" || value.environment !== "ws-preview") return false;
  if (typeof value.ok !== "boolean" || typeof value.eligible !== "boolean") return false;
  if (value.bots != null && !Array.isArray(value.bots)) return false;
  if (value.eligible === true) {
    if (!Number.isSafeInteger(value.stateVersion) || !/^[a-f0-9]{64}$/i.test(String(value.inputHash || ""))) {
      return false;
    }
  }
  if (
    mode === "execute"
    && (typeof value.changed !== "boolean" || typeof value.closed !== "boolean")
  ) {
    return false;
  }
  return true;
}

async function proxyRecovery({ payload, env, fetchImpl }) {
  const baseUrl = resolvePreviewBaseUrl(env);
  const token = typeof env?.POKER_WS_INTERNAL_TOKEN === "string"
    ? env.POKER_WS_INTERNAL_TOKEN.trim()
    : "";
  if (!baseUrl || !token || typeof fetchImpl !== "function") {
    throw recoveryError("ws_preview_unavailable", 503);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  if (typeof timer?.unref === "function") timer.unref();
  try {
    const response = await fetchImpl(`${baseUrl}/internal/admin/bot-claims-recovery`, {
      method: "POST",
      cache: "no-store",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let body = null;
    try {
      body = await response.json();
    } catch {}
    if (!response.ok) {
      const upstreamCode = typeof body?.error === "string" ? body.error : "ws_preview_unavailable";
      throw recoveryError(
        EXPOSED_RECOVERY_ERRORS.has(upstreamCode) ? upstreamCode : "ws_preview_unavailable",
        response.status,
      );
    }
    if (!isValidRecoveryResponse(body, payload.mode)) {
      throw recoveryError("ws_preview_invalid_response", 502);
    }
    if (
      payload.mode === "execute"
      && (body.ok !== true || body.changed !== true || body.closed !== true)
    ) {
      const outcomeCode = typeof body.reason === "string" ? body.reason : "";
      throw recoveryError(
        EXPOSED_RECOVERY_ERRORS.has(outcomeCode) ? outcomeCode : "recovery_not_completed",
        409,
      );
    }
    return body;
  } catch (error) {
    if (error?.name === "AbortError") throw recoveryError("ws_preview_timeout", 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function createAdminTableBotClaimsRecoveryHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const buildIdentity = deps.buildStageIdentity || (() => buildStageIdentity(env));
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  return async function handler(event) {
    if (env.CHIPS_ENABLED !== "1") return jsonResponse(404, baseHeaders(), { error: "not_found" });
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = corsHeaders(origin);
    if (!cors) return jsonResponse(403, baseHeaders(), { error: "forbidden_origin" });
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { ...cors, "cache-control": "no-store" }, body: "" };
    if (event.httpMethod !== "POST") return jsonResponse(405, cors, { error: "method_not_allowed" });

    try {
      const admin = await requireAdmin(event, env);
      const identity = buildIdentity();
      if (
        identity?.environmentContext !== "deploy-preview"
        || identity?.databaseTarget !== "stage"
        || identity?.stageProjectRefMatches !== true
        || identity?.databaseMatchesSupabaseProjectRef !== true
        || identity?.serviceRoleStageProjectRefMatches !== true
      ) {
        return jsonResponse(403, cors, { error: "preview_only" });
      }
      const payload = parseBody(event.body, admin.userId);
      const result = await proxyRecovery({ payload, env, fetchImpl });
      klog("admin_bot_claims_recovery_outcome", {
        adminUserId: admin.userId,
        tableId: payload.tableId,
        mode: payload.mode,
        ok: result.ok === true,
        eligible: result.eligible === true,
        closed: result.closed === true,
        reason: result.reason || null,
        stateVersion: result.stateVersion ?? null,
        finalStateVersion: result.finalStateVersion ?? null,
        delta: result.delta ?? null,
      });
      return jsonResponse(200, cors, result);
    } catch (error) {
      if (error?.status === 401 || (error?.status === 403 && error?.code === "admin_required")) {
        const response = adminAuthErrorResponse(error, cors);
        return { ...response, headers: { ...response.headers, "cache-control": "no-store" } };
      }
      const status = Number(error?.status) || 500;
      const code = error?.code || "server_error";
      klog("admin_bot_claims_recovery_failed", { status, code });
      return jsonResponse(status, cors, { error: code });
    }
  };
}

const handler = createAdminTableBotClaimsRecoveryHandler();

export {
  CONFIRMATION,
  createAdminTableBotClaimsRecoveryHandler,
  handler,
  isValidRecoveryResponse,
  parseBody,
  proxyRecovery,
  resolvePreviewBaseUrl,
};
