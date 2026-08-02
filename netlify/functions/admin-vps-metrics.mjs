import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { baseHeaders, corsHeaders, klog } from "./_shared/supabase-admin.mjs";
import { buildStageIdentity } from "./admin-stage-identity.mjs";

const WS_ORIGINS = Object.freeze({
  preview: "https://ws-preview.kcswh.pl",
  production: "https://ws.kcswh.pl",
});
const WS_ENVIRONMENTS = Object.freeze({
  preview: "preview",
  production: "production",
});
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

function resolveWsEnvironment(target) {
  return Object.prototype.hasOwnProperty.call(WS_ENVIRONMENTS, target)
    ? WS_ENVIRONMENTS[target]
    : null;
}

function resolveTarget(identity) {
  if (
    identity?.environmentContext === "deploy-preview"
    && identity?.databaseTarget === "stage"
    && identity?.stageProjectRefMatches === true
    && identity?.databaseMatchesSupabaseProjectRef === true
    && identity?.serviceRoleStageProjectRefMatches === true
  ) return WS_ENVIRONMENTS.preview;
  if (
    identity?.environmentContext === "production"
    && identity?.databaseTarget === "production"
    && typeof identity?.expectedProductionProjectRef === "string"
    && identity.expectedProductionProjectRef.length > 0
    && identity?.supabaseUrlProductionProjectRefMatches === true
    && identity?.databaseProductionProjectRefMatches === true
    && identity?.serviceRoleProductionProjectRefMatches === true
    && identity?.databaseMatchesSupabaseProjectRef === true
  ) return WS_ENVIRONMENTS.production;
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

function projectFields(source, fields) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  return fields.reduce((result, field) => {
    result[field] = Object.prototype.hasOwnProperty.call(source, field) && source[field] !== undefined
      ? source[field]
      : null;
    return result;
  }, {});
}

function normalizeMetricsSnapshot(value, target) {
  const expectedEnvironment = resolveWsEnvironment(target);
  if (!expectedEnvironment || !value || typeof value !== "object" || value.environment !== expectedEnvironment) {
    throw controlError("ws_vps_metrics_environment_mismatch", 502);
  }
  if (typeof value.measuredAt !== "string" || !Number.isFinite(Date.parse(value.measuredAt))) {
    throw controlError("ws_vps_metrics_invalid_response", 502);
  }
  const rootFilesystem = projectFields(value.rootFilesystem, [
    "totalBytes", "usedBytes", "availableBytes", "usedPercent"
  ]);
  if (rootFilesystem) {
    rootFilesystem.inodes = projectFields(value.rootFilesystem.inodes, [
      "total", "used", "available", "usedPercent"
    ]);
  }
  const runtime = projectFields(value.runtime, [
    "wsCpuPercent", "wsRssBytes", "wsUptimeSeconds", "hostAvailableRamBytes",
    "hostLogicalCpuCount", "ioWaitPercent"
  ]);
  if (runtime) {
    runtime.loadAverage = projectFields(value.runtime.loadAverage, ["one", "five", "fifteen"]);
  }
  const cleanup = projectFields(value.cleanup, []);
  if (cleanup) {
    cleanup.backlog = projectFields(value.cleanup.backlog, [
      "ordinaryActionRows", "handSettledRows", "cappedAtBatchSize", "measuredAt"
    ]);
    cleanup.lastRun = projectFields(value.cleanup.lastRun, [
      "finishedAt", "durationMs", "deletedRows", "result"
    ]);
  }
  return {
    environment: expectedEnvironment,
    measuredAt: value.measuredAt,
    rootFilesystem,
    logs: projectFields(value.logs, ["varLogBytes", "journaldBytes"]),
    runtime,
    continuousTables: projectFields(value.continuousTables, ["active", "desired", "enabled"]),
    cleanup,
  };
}

async function proxyVpsMetrics({ target, env, fetchImpl }) {
  const baseUrl = resolveBaseUrl(env, target);
  const token = typeof env?.POKER_WS_INTERNAL_TOKEN === "string" ? env.POKER_WS_INTERNAL_TOKEN.trim() : "";
  if (!baseUrl || !token || typeof fetchImpl !== "function") {
    throw controlError("ws_vps_metrics_unavailable", 503);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), resolveTimeoutMs(env));
  timer?.unref?.();
  try {
    const response = await fetchImpl(`${baseUrl}/internal/admin/vps-metrics`, {
      method: "GET",
      cache: "no-store",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      signal: controller.signal,
    });
    let body = {};
    try {
      body = await response.json();
    } catch {}
    if (!response.ok) throw controlError("ws_vps_metrics_unavailable", 502);
    return normalizeMetricsSnapshot(body, target);
  } catch (error) {
    if (error?.name === "AbortError") throw controlError("ws_vps_metrics_timeout", 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function createAdminVpsMetricsHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const buildIdentity = deps.buildStageIdentity || (() => buildStageIdentity(env));
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  return async function handler(event) {
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = corsHeaders(origin);
    if (!cors) return jsonResponse(403, baseHeaders(), { error: "forbidden_origin" });
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: { ...cors, "cache-control": "no-store" }, body: "" };
    }
    if (event.httpMethod !== "GET") return jsonResponse(405, cors, { error: "method_not_allowed" });
    try {
      await requireAdmin(event, env);
      const target = resolveTarget(buildIdentity());
      if (!target) return jsonResponse(403, cors, { error: "environment_not_allowed" });
      const result = await proxyVpsMetrics({ target, env, fetchImpl });
      return jsonResponse(200, cors, result);
    } catch (error) {
      if (error?.status === 401 || (error?.status === 403 && error?.code === "admin_required")) {
        return adminAuthErrorResponse(error, cors);
      }
      const status = Number(error?.status) || 500;
      const code = error?.code || "server_error";
      klog("admin_vps_metrics_failed", { status, code });
      return jsonResponse(status, cors, { error: code });
    }
  };
}

const handler = createAdminVpsMetricsHandler();

export {
  createAdminVpsMetricsHandler,
  handler,
  normalizeMetricsSnapshot,
  proxyVpsMetrics,
  resolveBaseUrl,
  resolveTarget,
  resolveWsEnvironment,
};
