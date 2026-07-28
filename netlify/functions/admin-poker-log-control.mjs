import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { baseHeaders, corsHeaders, klog } from "./_shared/supabase-admin.mjs";
import { buildStageIdentity } from "./admin-stage-identity.mjs";

const WS_ORIGINS = Object.freeze({
  preview: "https://ws-preview.kcswh.pl",
  production: "https://ws.kcswh.pl",
});
const CATEGORIES = Object.freeze([
  "runtime", "transport", "session", "table_lifecycle", "gameplay", "autoplay",
  "persistence", "recovery", "janitor", "settlement", "accounting", "ledger",
  "http", "admin", "deployment",
]);
const EXPOSED_ERRORS = new Set([
  "invalid_category", "invalid_request", "invalid_scope", "invalid_table_id",
  "invalid_ttl", "table_override_capacity",
]);
const DEFAULT_TIMEOUT_MS = 4_000;

function jsonResponse(statusCode, headers, body) {
  return {
    statusCode,
    headers: { ...headers, "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

function controlError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
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

function parseBody(body) {
  const value = parseJsonObject(body);
  const operation = typeof value.operation === "string" ? value.operation.trim().toLowerCase() : "";
  const scope = typeof value.scope === "string" ? value.scope.trim().toLowerCase() : "";
  const category = value.category == null ? null : String(value.category).trim().toLowerCase();
  const tableId = value.tableId == null ? null : String(value.tableId).trim();
  const validIdentity = (
    (scope === "global" && category === null && tableId === null)
    || (scope === "category" && CATEGORIES.includes(category) && tableId === null)
    || (scope === "table" && category === null && typeof tableId === "string" && tableId.length > 0)
  );
  if (!validIdentity) throw controlError("invalid_request");
  if (operation === "enable" && exactKeys(value, ["operation", "scope", "category", "tableId", "ttlMs"])) {
    if (!Number.isSafeInteger(value.ttlMs)) throw controlError("invalid_ttl");
    return { operation, scope, category, tableId, ttlMs: value.ttlMs };
  }
  if (operation === "disable" && exactKeys(value, ["operation", "scope", "category", "tableId"])) {
    return { operation, scope, category, tableId };
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
  if (identity?.environmentContext === "production" && identity?.databaseTarget === "production") {
    return "production";
  }
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

function resolveTimeoutMs(env) {
  const parsed = Number(env?.POKER_WS_INTERNAL_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 250 && parsed <= 10_000
    ? Math.trunc(parsed)
    : DEFAULT_TIMEOUT_MS;
}

function validOverride(value) {
  if (!value || !["global", "category", "table"].includes(value.scope)) return false;
  if (typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))) return false;
  if (value.scope === "category") return CATEGORIES.includes(value.category) && value.tableId == null;
  if (value.scope === "table") return typeof value.tableId === "string" && value.tableId.length > 0 && value.category == null;
  return value.category == null && value.tableId == null;
}

function normalizeSnapshot(value, target) {
  if (!value || typeof value !== "object" || !["DEBUG", "INFO", "WARN", "ERROR"].includes(value.defaultLevel)) {
    throw controlError("ws_log_control_invalid_response", 502);
  }
  const serverNowMs = Date.parse(value.serverNow);
  const ttl = value.ttl;
  const validTtl = ttl
    && Number.isSafeInteger(ttl.minMs)
    && Number.isSafeInteger(ttl.defaultMs)
    && Number.isSafeInteger(ttl.maxMs)
    && ttl.minMs > 0
    && ttl.minMs <= ttl.defaultMs
    && ttl.defaultMs <= ttl.maxMs
    && Array.isArray(ttl.presetsMs)
    && ttl.presetsMs.every((item) => Number.isSafeInteger(item) && item >= ttl.minMs && item <= ttl.maxMs);
  if (!Number.isFinite(serverNowMs) || !validTtl || !Array.isArray(value.overrides) || !value.overrides.every(validOverride)) {
    throw controlError("ws_log_control_invalid_response", 502);
  }
  return {
    environment: target,
    defaultLevel: value.defaultLevel,
    serverNow: value.serverNow,
    ttl: {
      minMs: ttl.minMs,
      defaultMs: ttl.defaultMs,
      maxMs: ttl.maxMs,
      presetsMs: ttl.presetsMs,
    },
    categories: [...CATEGORIES],
    overrides: value.overrides.map((item) => ({
      scope: item.scope,
      ...(item.category ? { category: item.category } : {}),
      ...(item.tableId ? { tableId: item.tableId } : {}),
      expiresAt: item.expiresAt,
    })),
  };
}

async function proxyControl({ method, payload, adminUserId, target, env, fetchImpl }) {
  const baseUrl = resolveBaseUrl(env, target);
  const token = typeof env?.POKER_WS_INTERNAL_TOKEN === "string" ? env.POKER_WS_INTERNAL_TOKEN.trim() : "";
  if (!baseUrl || !token || typeof fetchImpl !== "function") {
    throw controlError("ws_log_control_unavailable", 503);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), resolveTimeoutMs(env));
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
    if (method === "POST") options.body = JSON.stringify({ ...payload, adminUserId });
    const response = await fetchImpl(`${baseUrl}/internal/admin/poker-log-control`, options);
    let body = {};
    try {
      body = await response.json();
    } catch {}
    if (!response.ok) {
      const upstream = typeof body?.error === "string" ? body.error : "";
      const exposed = EXPOSED_ERRORS.has(upstream);
      throw controlError(exposed ? upstream : "ws_log_control_unavailable", exposed ? response.status : 502);
    }
    return normalizeSnapshot(body, target);
  } catch (error) {
    if (error?.name === "AbortError") throw controlError("ws_log_control_timeout", 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function createAdminPokerLogControlHandler(deps = {}) {
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
      const payload = event.httpMethod === "POST" ? parseBody(event.body) : null;
      const result = await proxyControl({
        method: event.httpMethod,
        payload,
        adminUserId: admin.userId,
        target,
        env,
        fetchImpl,
      });
      klog("admin_poker_log_control_outcome", {
        adminUserId: admin.userId,
        environment: target,
        operation: payload?.operation || "read",
        scope: payload?.scope || null,
        ok: true,
      });
      return jsonResponse(200, cors, result);
    } catch (error) {
      if (error?.status === 401 || (error?.status === 403 && error?.code === "admin_required")) {
        const response = adminAuthErrorResponse(error, cors);
        return { ...response, headers: { ...response.headers, "cache-control": "no-store" } };
      }
      const status = Number(error?.status) || 500;
      const code = error?.code || "server_error";
      klog("admin_poker_log_control_failed", { status, code });
      return jsonResponse(status, cors, { error: code });
    }
  };
}

const handler = createAdminPokerLogControlHandler();

export {
  CATEGORIES,
  createAdminPokerLogControlHandler,
  handler,
  normalizeSnapshot,
  parseBody,
  proxyControl,
  resolveTarget,
};
