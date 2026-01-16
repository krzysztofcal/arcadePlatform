import crypto from "crypto";
import postgres from "postgres";

// Exception policy: console.* usage is allowed ONLY inside klog.
// All other logging must go through klog for consistent log capture.
const klog = (kind, data) => {
  try {
    console.log(`[klog] ${kind}`, JSON.stringify(data));
  } catch {
    console.log(`[klog] ${kind}`, data);
  }
};

function baseHeaders() {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
}

function looksLikeJsonString(value) {
  if (typeof value !== "string") return false;
  const s = value.trim();
  return (s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"));
}

function normalizeJsonDeep(value) {
  if (value == null) return value;

  if (typeof value === "string" && looksLikeJsonString(value)) {
    try {
      const parsed = JSON.parse(value.trim());
      return normalizeJsonDeep(parsed);
    } catch {
      return value;
    }
  }

  if (Array.isArray(value)) {
    return value.map(normalizeJsonDeep);
  }

  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = normalizeJsonDeep(v);
    }
    return out;
  }

  return value;
}

function normalizeRow(row) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = normalizeJsonDeep(v);
  }
  return out;
}

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_JWT_SECRET_V2 || "";
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL || "";

if (!SUPABASE_DB_URL) {
  klog("chips_db_url_missing", { hasDbUrl: false });
}
if (!SUPABASE_JWT_SECRET) {
  klog("auth_jwt_secret_missing", {});
}

const POSTGRES_OPTIONS = { max: 1, idle_timeout: 30, connect_timeout: 10, prepare: false };

const sql = SUPABASE_DB_URL ? postgres(SUPABASE_DB_URL, POSTGRES_OPTIONS) : null;

if (SUPABASE_DB_URL) {
  let dbHost = "unknown";
  try {
    dbHost = new URL(SUPABASE_DB_URL).host || "unknown";
  } catch {
    dbHost = "invalid";
  }
  klog("chips_db_client_init", { dbHost, preparedStatementsDisabled: POSTGRES_OPTIONS.prepare === false });
}

const CORS_ALLOW = (() => {
  const fromEnv = (process.env.XP_CORS_ALLOW ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const siteUrl = process.env.URL;
  if (siteUrl && !fromEnv.includes(siteUrl)) {
    fromEnv.push(siteUrl);
  }
  return fromEnv;
})();

function corsHeaders(origin) {
  const headers = baseHeaders();

  if (!origin) {
    return headers;
  }

  const isNetlifyDomain = /^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(origin);

  if (!isNetlifyDomain && CORS_ALLOW.length > 0 && !CORS_ALLOW.includes(origin)) {
    return null;
  }

  return {
    ...headers,
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  };
}

const extractBearerToken = (headers) => {
  const headerValue = headers?.authorization || headers?.Authorization || headers?.AUTHORIZATION;
  if (!headerValue || typeof headerValue !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match ? match[1].trim() : null;
};
const decodeBase64UrlJson = (segment) => {
  if (!segment) return null;
  try {
    const decoded = Buffer.from(segment, "base64url").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
};
const safeEquals = (a, b) => {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};
const buildJwtAuthResult = ({ provided, valid, userId, reason, payload }) => ({
  provided,
  valid,
  userId: userId || null,
  reason,
  user: payload || null,
});
const verifySupabaseJwt = async (token) => {
  const start = Date.now();
  if (!token) {
    klog("auth_verify_mode", { mode: "local" });
    klog("auth_verify_local_ms", { ms: Date.now() - start });
    return buildJwtAuthResult({ provided: false, valid: false, reason: "missing_token" });
  }
  if (!SUPABASE_JWT_SECRET) {
    klog("auth_verify_mode", { mode: "local" });
    klog("auth_verify_local_ms", { ms: Date.now() - start });
    return buildJwtAuthResult({ provided: true, valid: false, reason: "missing_jwt_secret" });
  }

  const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
  if (!headerSegment || !payloadSegment || !signatureSegment) {
    klog("auth_verify_mode", { mode: "local" });
    klog("auth_verify_local_ms", { ms: Date.now() - start });
    return buildJwtAuthResult({ provided: true, valid: false, reason: "malformed_token" });
  }

  const header = decodeBase64UrlJson(headerSegment);
  const payload = decodeBase64UrlJson(payloadSegment);
  if (!header || !payload) {
    klog("auth_verify_mode", { mode: "local" });
    klog("auth_verify_local_ms", { ms: Date.now() - start });
    return buildJwtAuthResult({ provided: true, valid: false, reason: "invalid_encoding" });
  }

  const alg = header.alg || "HS256";
  const hmacAlg = alg === "HS512" ? "sha512" : "sha256";
  const expectedSig = crypto.createHmac(hmacAlg, SUPABASE_JWT_SECRET)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest("base64url");
  if (!safeEquals(signatureSegment, expectedSig)) {
    klog("auth_verify_mode", { mode: "local" });
    klog("auth_verify_local_ms", { ms: Date.now() - start });
    return buildJwtAuthResult({ provided: true, valid: false, reason: "invalid_signature" });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp && Number(payload.exp) <= nowSec) {
    klog("auth_verify_mode", { mode: "local" });
    klog("auth_verify_local_ms", { ms: Date.now() - start });
    return buildJwtAuthResult({ provided: true, valid: false, reason: "expired" });
  }

  const userId = typeof payload.sub === "string" ? payload.sub : null;
  if (!userId) {
    klog("auth_verify_mode", { mode: "local" });
    klog("auth_verify_local_ms", { ms: Date.now() - start });
    return buildJwtAuthResult({ provided: true, valid: false, reason: "missing_sub" });
  }

  klog("auth_verify_mode", { mode: "local" });
  klog("auth_verify_local_ms", { ms: Date.now() - start });
  return buildJwtAuthResult({ provided: true, valid: true, userId, reason: "ok", payload });
};

async function executeSql(query, params = []) {
  if (!sql) {
    klog("chips_sql_config_missing", { hasDbUrl: !!SUPABASE_DB_URL });
    throw new Error("Supabase DB connection not configured (SUPABASE_DB_URL missing)");
  }

  try {
    const rows = await sql.unsafe(query, params);

    if (Array.isArray(rows)) {
      return rows.map(normalizeRow);
    }

    return rows;
  } catch (error) {
    klog("chips_sql_error", {
      message: error?.message || "sql_failed",
      code: error?.code,
      detail: error?.detail,
      hint: error?.hint,
      constraint: error?.constraint,
      schema: error?.schema,
      table: error?.table,
    });
    throw error;
  }
}

async function beginSql(fn) {
  if (!sql) {
    throw new Error("Supabase DB connection not configured (SUPABASE_DB_URL missing)");
  }
  return await sql.begin(fn);
}

async function closeSql() {
  if (sql && typeof sql.end === "function") {
    try {
      await sql.end({ timeout: 5 });
    } catch {
      // Fallback for postgres client versions that don't support options
      await sql.end();
    }
  }
}

export {
  baseHeaders,
  corsHeaders,
  executeSql,
  closeSql,
  extractBearerToken,
  klog,
  verifySupabaseJwt,
  beginSql,
};
