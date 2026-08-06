import { randomUUID } from "node:crypto";
import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { baseHeaders, corsHeaders, klog } from "./_shared/supabase-admin.mjs";
import { buildStageIdentity } from "./admin-stage-identity.mjs";

const WS_ORIGINS = Object.freeze({
  preview: "https://ws-preview.kcswh.pl",
  production: "https://ws.kcswh.pl",
});
const DEFAULT_TIMEOUT_MS = 12_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPOSED_ERRORS = new Set([
  "invalid_request",
  "invalid_enabled",
  "invalid_desired_table_count",
  "invalid_desired_table_count_step",
  "invalid_table_id",
  "table_not_found",
  "not_managed_table",
  "already_closed",
  "already_due",
  "retirement_request_failed",
  "cleanup_failed",
]);

function jsonResponse(statusCode, headers, body) {
  return {
    statusCode,
    headers: { ...headers, "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

function controlError(code, status = 400, details = null) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  if (details && typeof details === "object") error.details = details;
  return error;
}

function projectMaintenanceFailure(value) {
  if (!value || typeof value !== "object") return {};
  const allowedPhases = ["orphan_hole_cards", "hole_cards", "ordinary_actions", "hand_settled"];
  const failedPhases = Array.isArray(value.failedPhases)
    ? allowedPhases.filter((phase) => value.failedPhases.includes(phase))
    : [];
  const result = {};
  if (typeof value.operation === "string") result.operation = value.operation;
  if (typeof value.result === "string") result.result = value.result;
  if (Number.isSafeInteger(value.orphanHoleCardsDeleted) && value.orphanHoleCardsDeleted >= 0) {
    result.orphanHoleCardsDeleted = value.orphanHoleCardsDeleted;
  }
  if (Number.isSafeInteger(value.holeCardsDeleted) && value.holeCardsDeleted >= 0) {
    result.holeCardsDeleted = value.holeCardsDeleted;
  }
  if (Number.isSafeInteger(value.phase1Deleted) && value.phase1Deleted >= 0) {
    result.phase1Deleted = value.phase1Deleted;
  }
  if (Number.isSafeInteger(value.phase2Deleted) && value.phase2Deleted >= 0) {
    result.phase2Deleted = value.phase2Deleted;
  }
  if (typeof value.errorCode === "string") result.errorCode = value.errorCode;
  if (failedPhases.length > 0) result.failedPhases = failedPhases;
  return result;
}

function parseJsonObject(body) {
  try {
    const value = body ? JSON.parse(body) : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw controlError("invalid_json");
  }
}

function exactKeys(value, expected) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function parseBody(body, { maxDesiredTableCount = 2 } = {}) {
  const value = parseJsonObject(body);
  const operation = typeof value.operation === "string" ? value.operation.trim().toLowerCase() : "";
  if (operation === "set_desired_state" && exactKeys(value, ["operation", "enabled", "desiredTableCount"])) {
    if (typeof value.enabled !== "boolean" || !Number.isInteger(value.desiredTableCount)
      || value.desiredTableCount < 0 || value.desiredTableCount > maxDesiredTableCount) {
      throw controlError("invalid_desired_table_count");
    }
    return { operation, enabled: value.enabled, desiredTableCount: value.desiredTableCount };
  }
  if (operation === "request_rotation" && exactKeys(value, ["operation", "tableId"])) {
    if (!UUID_RE.test(String(value.tableId || "").trim())) throw controlError("invalid_table_id");
    return { operation, tableId: String(value.tableId).trim() };
  }
  if ((operation === "reconcile" || operation === "cleanup") && exactKeys(value, ["operation"])) {
    return { operation };
  }
  throw controlError("invalid_request");
}

function resolveTarget(identity) {
  if (
    identity?.environmentContext === "deploy-preview"
    && identity?.databaseTarget === "stage"
    && identity?.stageProjectRefMatches === true
    && identity?.databaseMatchesSupabaseProjectRef === true
    && identity?.serviceRoleStageProjectRefMatches === true
  ) return "preview";
  if (
    identity?.environmentContext === "production"
    && identity?.databaseTarget === "production"
    && typeof identity?.expectedProductionProjectRef === "string"
    && identity.expectedProductionProjectRef.length > 0
    && identity?.supabaseUrlProductionProjectRefMatches === true
    && identity?.databaseProductionProjectRefMatches === true
    && identity?.serviceRoleProductionProjectRefMatches === true
    && identity?.databaseMatchesSupabaseProjectRef === true
  ) return "production";
  return null;
}

function resolveBaseUrl(env, target) {
  const raw = typeof env?.POKER_WS_INTERNAL_BASE_URL === "string"
    ? env.POKER_WS_INTERNAL_BASE_URL.trim()
    : "";
  if (!raw || !WS_ORIGINS[target]) return null;
  try {
    const url = new URL(raw);
    if (
      url.origin !== WS_ORIGINS[target]
      || (url.pathname !== "/" && url.pathname !== "")
      || url.username || url.password || url.search || url.hash
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function proxyMaintenance({ method, payload, adminUserId, target, env, fetchImpl }) {
  const baseUrl = resolveBaseUrl(env, target);
  const token = typeof env?.POKER_WS_INTERNAL_TOKEN === "string" ? env.POKER_WS_INTERNAL_TOKEN.trim() : "";
  if (!baseUrl || !token || typeof fetchImpl !== "function") throw controlError("ws_maintenance_unavailable", 503);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  timer?.unref?.();
  try {
    const options = {
      method,
      cache: "no-store",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      signal: controller.signal,
    };
    if (method === "POST") {
      options.body = JSON.stringify({
        ...payload,
        actorUserId: adminUserId,
        requestId: randomUUID(),
      });
    }
    const response = await fetchImpl(`${baseUrl}/internal/admin/poker-maintenance`, options);
    let body = {};
    try {
      body = await response.json();
    } catch {}
    if (body && body.environment != null && body.environment !== target) {
      throw controlError("ws_maintenance_environment_mismatch", 502);
    }
    if (!response.ok) {
      const upstream = typeof body?.error === "string"
        ? body.error
        : body?.operation === "cleanup" && body?.ok === false
          ? "cleanup_failed"
          : "ws_maintenance_unavailable";
      const exposed = EXPOSED_ERRORS.has(upstream);
      throw controlError(
        exposed ? upstream : "ws_maintenance_unavailable",
        exposed ? response.status : 502,
        exposed ? projectMaintenanceFailure(body) : null
      );
    }
    if (!body || body.environment !== target) {
      throw controlError("ws_maintenance_environment_mismatch", 502);
    }
    return body;
  } catch (error) {
    if (error?.name === "AbortError") throw controlError("ws_maintenance_timeout", 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function createAdminPokerMaintenanceHandler(deps = {}) {
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
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
      return jsonResponse(405, cors, { error: "method_not_allowed" });
    }
    try {
      const admin = await requireAdmin(event, env);
      const target = resolveTarget(buildIdentity());
      if (!target) return jsonResponse(403, cors, { error: "environment_not_allowed" });
      const payload = event.httpMethod === "POST"
        ? parseBody(event.body, { maxDesiredTableCount: target === "preview" ? 100 : 2 })
        : null;
      const result = await proxyMaintenance({
        method: event.httpMethod,
        payload,
        adminUserId: admin.userId,
        target,
        env,
        fetchImpl,
      });
      if (event.httpMethod === "POST") {
        klog("admin_poker_maintenance_action", {
          adminUserId: admin.userId,
          environment: target,
          operation: payload?.operation || null,
          ok: result?.ok === true,
        });
      }
      return jsonResponse(200, cors, result);
    } catch (error) {
      if (error?.status === 401 || (error?.status === 403 && error?.code === "admin_required")) {
        return adminAuthErrorResponse(error, cors);
      }
      const status = Number(error?.status) || 500;
      const code = error?.code || "server_error";
      klog("admin_poker_maintenance_failed", { status, code });
      return jsonResponse(status, cors, { ...(error?.details || {}), error: code });
    }
  };
}

const handler = createAdminPokerMaintenanceHandler();

export {
  createAdminPokerMaintenanceHandler,
  handler,
  parseBody,
  proxyMaintenance,
  resolveTarget,
};
