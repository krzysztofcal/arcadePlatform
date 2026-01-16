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

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY_V2 || "";
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL || "";
const AUTH_ENDPOINT = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user` : "";
const AUTH_API_KEY = SUPABASE_ANON_KEY || "";

if (!SUPABASE_DB_URL) {
  klog("chips_db_url_missing", { hasDbUrl: false });
}

const sql = SUPABASE_DB_URL
  ? postgres(SUPABASE_DB_URL, { max: 1, idle_timeout: 30, connect_timeout: 10 })
  : null;

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

// SECURITY: Extract site name from Netlify URL for CORS validation
// This allows deploy previews only for our specific site, not all *.netlify.app
const NETLIFY_SITE_NAME = (() => {
  const siteUrl = process.env.URL || "";
  // Match pattern like https://my-site.netlify.app or https://deploy-preview-123--my-site.netlify.app
  const match = siteUrl.match(/(?:^https?:\/\/)?(?:[a-z0-9-]+--)?([a-z0-9-]+)\.netlify\.app/i);
  return match ? match[1].toLowerCase() : null;
})();

function corsHeaders(origin) {
  const headers = baseHeaders();

  if (!origin) {
    return headers;
  }

  // SECURITY: Only allow Netlify domains that belong to OUR site
  // This prevents other Netlify users from accessing our API
  let isOurNetlifyDomain = false;
  if (NETLIFY_SITE_NAME) {
    const netlifyPattern = new RegExp(
      `^https:\\/\\/(?:[a-z0-9-]+--)?${NETLIFY_SITE_NAME}\\.netlify\\.app$`,
      "i"
    );
    isOurNetlifyDomain = netlifyPattern.test(origin);
  }

  if (!isOurNetlifyDomain && CORS_ALLOW.length > 0 && !CORS_ALLOW.includes(origin)) {
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
const verifySupabaseJwt = async (token) => {
  // Note: Verification is performed via Supabase Auth HTTP endpoint; this adds network latency but is acceptable for now.
  if (!token) {
    return { provided: false, valid: false, userId: null, reason: "missing_token" };
  }
  if (!AUTH_ENDPOINT || !AUTH_API_KEY) {
    return { provided: true, valid: false, userId: null, reason: "missing_supabase_config" };
  }

  try {
    const response = await fetch(AUTH_ENDPOINT, {
      method: "GET",
      headers: {
        apikey: AUTH_API_KEY,
        authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return { provided: true, valid: false, userId: null, reason: response.status === 401 ? "unauthorized" : "auth_request_failed" };
    }

    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    const userId = body?.id || body?.user?.id || null;
    if (!userId) {
      return { provided: true, valid: false, userId: null, reason: "missing_user" };
    }

    return { provided: true, valid: true, userId, reason: "ok", user: body };
  } catch (error) {
    klog("supabase_auth_error", { message: error?.message || "request_failed" });
    return { provided: true, valid: false, userId: null, reason: "auth_request_failed" };
  }
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
