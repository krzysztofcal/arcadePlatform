import { BUILD_DEPLOY_CONTEXT, BUILD_DEPLOY_ORIGIN } from "../_generated/deploy-context.mjs";

const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function normalizeCorsOrigin(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const isLocalHttp = url.protocol === "http:" && LOCAL_HTTP_HOSTS.has(url.hostname);
    if (url.protocol !== "https:" && !isLocalHttp) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function buildApiCorsPolicy({
  configuredOrigins = process.env.XP_CORS_ALLOW,
  buildContext = BUILD_DEPLOY_CONTEXT,
  buildDeployOrigin = BUILD_DEPLOY_ORIGIN,
} = {}) {
  const origins = new Set();
  let invalidConfiguredOriginCount = 0;
  const configured = String(configuredOrigins || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  for (const entry of configured) {
    const normalized = normalizeCorsOrigin(entry);
    if (normalized) origins.add(normalized);
    else invalidConfiguredOriginCount += 1;
  }
  if (["production", "deploy-preview", "branch-deploy"].includes(buildContext)) {
    const normalizedDeployOrigin = normalizeCorsOrigin(buildDeployOrigin);
    if (normalizedDeployOrigin) origins.add(normalizedDeployOrigin);
  }
  return Object.freeze({
    origins: Object.freeze([...origins]),
    invalidConfiguredOriginCount,
    buildContext,
  });
}

export function isOriginAllowed({ origin, policy }) {
  if (!origin) return true;
  const normalized = normalizeCorsOrigin(origin);
  return Boolean(normalized) && Array.isArray(policy?.origins) && policy.origins.includes(normalized);
}

function appendVaryOrigin(headers) {
  const varyKey = Object.keys(headers).find((key) => key.toLowerCase() === "vary") || "Vary";
  const values = String(headers[varyKey] || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!values.some((value) => value.toLowerCase() === "origin")) values.push("Origin");
  headers[varyKey] = values.join(", ");
}

export function buildCorsHeaders({
  origin,
  policy,
  methods = "POST,OPTIONS",
  allowedHeaders = "content-type,authorization,x-api-key",
  credentials = false,
  baseHeaders = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
} = {}) {
  const headers = { ...baseHeaders };
  if (!origin) return headers;
  if (!isOriginAllowed({ origin, policy })) return null;
  headers["access-control-allow-origin"] = normalizeCorsOrigin(origin);
  headers["access-control-allow-headers"] = allowedHeaders;
  headers["access-control-allow-methods"] = methods;
  if (credentials) headers["access-control-allow-credentials"] = "true";
  appendVaryOrigin(headers);
  return headers;
}
