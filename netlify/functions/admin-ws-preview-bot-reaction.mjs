import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { baseHeaders, corsHeaders, klog } from "./_shared/supabase-admin.mjs";
import { buildStageIdentity } from "./admin-stage-identity.mjs";

const WS_PREVIEW_ORIGIN = "https://ws-preview.kcswh.pl";
const DEFAULT_TIMEOUT_MS = 4_000;

function jsonResponse(statusCode, headers, body) {
  return {
    statusCode,
    headers: { ...headers, "cache-control": "no-store" },
    body: JSON.stringify(body)
  };
}

function parseBody(body) {
  let payload;
  try {
    payload = body ? JSON.parse(body) : {};
  } catch (_error) {
    const error = new Error("invalid_json");
    error.code = "invalid_json";
    error.status = 400;
    throw error;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    const error = new Error("invalid_request");
    error.code = "invalid_request";
    error.status = 400;
    throw error;
  }
  const mode = typeof payload.mode === "string" ? payload.mode.trim() : "";
  const keys = Object.keys(payload).sort();
  if (mode === "default" && keys.length === 1 && keys[0] === "mode") return { mode };
  if (mode === "override") {
    const expectedKeys = ["maxMs", "minMs", "mode"];
    if (keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])) {
      return { mode, minMs: payload.minMs, maxMs: payload.maxMs };
    }
  }
  const error = new Error("invalid_request");
  error.code = "invalid_request";
  error.status = 400;
  throw error;
}

function resolvePreviewBaseUrl(env) {
  const raw = typeof env?.POKER_WS_INTERNAL_BASE_URL === "string" ? env.POKER_WS_INTERNAL_BASE_URL.trim() : "";
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
  } catch (_error) {
    return null;
  }
}

function resolveTimeoutMs(env) {
  const parsed = Number(env?.POKER_WS_INTERNAL_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed < 250 || parsed > 10_000) return DEFAULT_TIMEOUT_MS;
  return Math.trunc(parsed);
}

function isValidBotReactionSnapshot(value) {
  if (!value || typeof value !== "object" || value.ok !== true || value.environment !== "ws-preview") return false;
  if (value.mode !== "default" && value.mode !== "override") return false;
  const minMs = Number(value.active?.minMs);
  const maxMs = Number(value.active?.maxMs);
  return Number.isInteger(minMs) && Number.isInteger(maxMs) && minMs >= 100 && maxMs <= 10_000 && minMs <= maxMs;
}

async function proxyBotReaction({ method, payload, adminUserId, env, fetchImpl }) {
  const baseUrl = resolvePreviewBaseUrl(env);
  const token = typeof env?.POKER_WS_INTERNAL_TOKEN === "string" ? env.POKER_WS_INTERNAL_TOKEN.trim() : "";
  if (!baseUrl || !token || typeof fetchImpl !== "function") {
    const error = new Error("ws_preview_unavailable");
    error.code = "ws_preview_unavailable";
    error.status = 503;
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), resolveTimeoutMs(env));
  if (typeof timer?.unref === "function") timer.unref();
  try {
    const options = {
      method,
      cache: "no-store",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      signal: controller.signal
    };
    if (method === "POST") {
      options.body = JSON.stringify({ ...payload, updatedBy: adminUserId });
    }
    const response = await fetchImpl(`${baseUrl}/internal/admin/bot-reaction`, options);
    let responseBody = {};
    try {
      responseBody = await response.json();
    } catch (_error) {}
    if (!response.ok) {
      const upstreamCode = typeof responseBody?.error === "string" ? responseBody.error : "ws_preview_unavailable";
      const exposedCodes = new Set(["invalid_request", "invalid_range", "preview_only"]);
      const error = new Error(exposedCodes.has(upstreamCode) ? upstreamCode : "ws_preview_unavailable");
      error.code = exposedCodes.has(upstreamCode) ? upstreamCode : "ws_preview_unavailable";
      error.status = upstreamCode === "preview_only" ? 403 : response.status === 400 ? 400 : 502;
      throw error;
    }
    if (!isValidBotReactionSnapshot(responseBody)) {
      const error = new Error("ws_preview_unavailable");
      error.code = "ws_preview_unavailable";
      error.status = 502;
      throw error;
    }
    return responseBody;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("ws_preview_timeout");
      timeoutError.code = "ws_preview_timeout";
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function createAdminWsPreviewBotReactionHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const buildIdentity = deps.buildStageIdentity || (() => buildStageIdentity(env));
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  return async function handler(event) {
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = corsHeaders(origin);
    if (!cors) return jsonResponse(403, baseHeaders(), { error: "forbidden_origin" });
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { ...cors, "cache-control": "no-store" }, body: "" };
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
      return jsonResponse(405, cors, { error: "method_not_allowed" });
    }
    try {
      const admin = await requireAdmin(event, env);
      const identity = buildIdentity();
      if (
        identity?.environmentContext !== "deploy-preview"
        || identity?.databaseTarget !== "stage"
        || identity?.stageProjectRefMatches !== true
        || identity?.databaseMatchesSupabaseProjectRef !== true
      ) {
        return jsonResponse(403, cors, { error: "preview_only" });
      }
      const payload = event.httpMethod === "POST" ? parseBody(event.body) : null;
      const result = await proxyBotReaction({
        method: event.httpMethod,
        payload,
        adminUserId: admin.userId,
        env,
        fetchImpl
      });
      klog("admin_ws_preview_bot_reaction_ok", {
        adminUserId: admin.userId,
        method: event.httpMethod,
        mode: result?.mode || null,
        minMs: result?.active?.minMs ?? null,
        maxMs: result?.active?.maxMs ?? null
      });
      return jsonResponse(200, cors, result);
    } catch (error) {
      if (error?.status === 401 || (error?.status === 403 && error?.code === "admin_required")) {
        const response = adminAuthErrorResponse(error, cors);
        return { ...response, headers: { ...response.headers, "cache-control": "no-store" } };
      }
      const status = Number(error?.status) || 500;
      const code = error?.code || "server_error";
      klog("admin_ws_preview_bot_reaction_failed", { status, code });
      return jsonResponse(status, cors, { error: code });
    }
  };
}

const handler = createAdminWsPreviewBotReactionHandler();

export {
  createAdminWsPreviewBotReactionHandler,
  handler,
  isValidBotReactionSnapshot,
  parseBody,
  proxyBotReaction,
  resolvePreviewBaseUrl
};
