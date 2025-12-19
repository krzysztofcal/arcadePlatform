const klog = (kind, data) => {
  try {
    console.log(`[klog] ${kind}`, JSON.stringify(data));
  } catch {
    console.log(`[klog] ${kind}`, data);
  }
};

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY_V2 || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY_V2 || "";
const SQL_ENDPOINT = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/$/, "")}/sql/v1` : "";
const AUTH_ENDPOINT = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user` : "";
const AUTH_API_KEY = SUPABASE_ANON_KEY || SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.warn("[chips] Supabase service credentials missing – chips functions will error without SUPABASE_URL and SERVICE_ROLE_KEY");
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
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };

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
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
}

const extractBearerToken = (headers) => {
  const headerValue = headers?.authorization || headers?.Authorization || headers?.AUTHORIZATION;
  if (!headerValue || typeof headerValue !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match ? match[1].trim() : null;
};
const verifySupabaseJwt = async (token) => {
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
  if (!SQL_ENDPOINT || !SERVICE_ROLE_KEY) {
    throw new Error("Supabase SQL endpoint not configured");
  }

  const response = await fetch(SQL_ENDPOINT, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "tx=commit",
    },
    body: JSON.stringify({ query, params }),
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: { message: text } };
    }
  }

  if (!response.ok || payload?.error) {
    const message = payload?.error?.message || payload?.error || response.statusText;
    const details = payload?.error?.details || payload?.error?.hint;
    const error = new Error(message || "SQL API error");
    error.status = response.status;
    error.details = details;
    throw error;
  }

  if (payload && Array.isArray(payload.data)) {
    return payload.data;
  }

  return payload;
}

export {
  corsHeaders,
  executeSql,
  extractBearerToken,
  klog,
  verifySupabaseJwt,
};
