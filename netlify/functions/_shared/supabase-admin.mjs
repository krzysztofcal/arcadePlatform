import crypto from "node:crypto";

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
const SQL_ENDPOINT = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/$/, "")}/sql/v1` : "";

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
  if (a.length !== b.length) return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

const extractBearerToken = (headers) => {
  const headerValue = headers?.authorization || headers?.Authorization || headers?.AUTHORIZATION;
  if (!headerValue || typeof headerValue !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match ? match[1].trim() : null;
};

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_JWT_SECRET_V2 || "";

const verifySupabaseJwt = (token) => {
  if (!token) {
    return { provided: false, valid: false, userId: null, reason: "missing_token" };
  }
  if (!SUPABASE_JWT_SECRET || SUPABASE_JWT_SECRET.length < 16) {
    return { provided: false, valid: false, userId: null, reason: "disabled_or_missing_secret" };
  }

  const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
  if (!headerSegment || !payloadSegment || !signatureSegment) {
    return { provided: true, valid: false, userId: null, reason: "malformed_token" };
  }

  const header = decodeBase64UrlJson(headerSegment);
  const payload = decodeBase64UrlJson(payloadSegment);
  if (!header || !payload) {
    return { provided: true, valid: false, userId: null, reason: "invalid_encoding" };
  }

  const alg = header.alg || "HS256";
  const hmacAlg = alg === "HS512" ? "sha512" : "sha256";
  const expectedSig = crypto
    .createHmac(hmacAlg, SUPABASE_JWT_SECRET)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest("base64url");

  if (!safeEquals(signatureSegment, expectedSig)) {
    return { provided: true, valid: false, userId: null, reason: "invalid_signature" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp && Number(payload.exp) <= nowSec) {
    return { provided: true, valid: false, userId: null, reason: "expired" };
  }

  const userId = typeof payload.sub === "string" ? payload.sub : null;
  if (!userId) {
    return { provided: true, valid: false, userId: null, reason: "missing_sub" };
  }

  return { provided: true, valid: true, userId, reason: "ok", payload };
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
