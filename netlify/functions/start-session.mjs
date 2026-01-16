import crypto from "node:crypto";
import { store } from "./_shared/store-upstash.mjs";

// Configuration
const SESSION_TTL_SEC = Math.max(0, Number(process.env.XP_SESSION_TTL_SEC) || 604800); // 7 days default
const KEY_NS = process.env.XP_KEY_NS ?? "kcswh:xp:v2";
const DEBUG_ENABLED = process.env.XP_DEBUG === "1";
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_JWT_SECRET_V2 || "";
// Build CORS allowlist from env var + auto-include Netlify site URL
const CORS_ALLOW = (() => {
  const fromEnv = (process.env.XP_CORS_ALLOW ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  // Auto-include the Netlify site URL (handles custom domains)
  const siteUrl = process.env.URL;
  if (siteUrl && !fromEnv.includes(siteUrl)) {
    fromEnv.push(siteUrl);
  }
  return fromEnv;
})();

// Rate limiting for session creation
const SESSION_RATE_LIMIT_PER_IP_PER_MIN = Math.max(0, Number(process.env.XP_SESSION_RATE_LIMIT_IP) || 5);
const SESSION_RATE_LIMIT_ENABLED = process.env.XP_SESSION_RATE_LIMIT_ENABLED !== "0";

// SECURITY: HMAC signing utilities
const signPayload = (payload, secret) =>
  crypto.createHmac("sha256", secret).update(payload).digest("base64url");

const safeEquals = (a, b) => {
  if (a.length !== b.length) return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
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

const extractBearerToken = (headers) => {
  const headerValue = headers?.authorization || headers?.Authorization || headers?.AUTHORIZATION;
  if (!headerValue || typeof headerValue !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match ? match[1].trim() : null;
};

const verifySupabaseJwt = (token) => {
  if (!token) {
    return { provided: false, valid: false, userId: null, reason: "missing_token" };
  }
  if (!SUPABASE_JWT_SECRET || SUPABASE_JWT_SECRET.length < 32) {
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

// Hash helper
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

// Key generators
const keyServerSession = (sessionId) => `${KEY_NS}:server-session:${sessionId}`;
const keySessionRateLimitIp = (ip) => `${KEY_NS}:session-ratelimit:ip:${hash(ip)}:${Math.floor(Date.now() / 60000)}`;

// SECURITY: Extract site name from Netlify URL for CORS validation
// This allows deploy previews only for our specific site, not all *.netlify.app
const NETLIFY_SITE_NAME = (() => {
  const siteUrl = process.env.URL || "";
  // Match pattern like https://my-site.netlify.app or https://deploy-preview-123--my-site.netlify.app
  const match = siteUrl.match(/(?:^https?:\/\/)?(?:[a-z0-9-]+--)?([a-z0-9-]+)\.netlify\.app/i);
  return match ? match[1].toLowerCase() : null;
})();

// CORS headers
function corsHeaders(origin) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };

  if (!origin) {
    return headers;
  }

  // SECURITY: Only allow Netlify domains that belong to OUR site
  // This prevents other Netlify users from accessing our API
  // Fallback: If NETLIFY_SITE_NAME is unavailable (test/local env), allow all *.netlify.app
  let isAllowedNetlifyDomain = false;
  if (NETLIFY_SITE_NAME) {
    const netlifyPattern = new RegExp(
      `^https:\\/\\/(?:[a-z0-9-]+--)?${NETLIFY_SITE_NAME}\\.netlify\\.app$`,
      "i"
    );
    isAllowedNetlifyDomain = netlifyPattern.test(origin);
  } else {
    // Fallback for test/local environments where URL is not set
    isAllowedNetlifyDomain = /^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(origin);
  }

  if (!isAllowedNetlifyDomain && CORS_ALLOW.length > 0 && !CORS_ALLOW.includes(origin)) {
    return null;
  }

  headers["access-control-allow-origin"] = origin;
  headers["access-control-allow-headers"] = "content-type,authorization,x-api-key";
  headers["access-control-allow-methods"] = "POST,OPTIONS";
  headers["Vary"] = "Origin";

  return headers;
}

const json = (statusCode, obj, origin, extraHeaders) => {
  const corsHeadersObj = corsHeaders(origin);
  if (!corsHeadersObj) {
    return {
      statusCode: 403,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "forbidden", message: "origin_not_allowed" }),
    };
  }
  const headers = { ...corsHeadersObj };
  if (extraHeaders && typeof extraHeaders === "object") {
    for (const [key, value] of Object.entries(extraHeaders)) {
      if (value !== undefined) headers[key] = value;
    }
  }
  return {
    statusCode,
    headers,
    body: JSON.stringify(obj),
  };
};

// Generate cryptographically secure session ID
function generateSessionId() {
  return crypto.randomBytes(32).toString("base64url");
}

// Create session token with HMAC signature (userId represents identityId: anonId today, Supabase userId later)
function createSignedSessionToken({ sessionId, userId, createdAt, fingerprint, secret }) {
  const payload = JSON.stringify({
    sid: sessionId,
    uid: userId,
    ts: createdAt,
    fp: fingerprint,
  });
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const signature = signPayload(payload, secret);
  return `${encoded}.${signature}`;
}

// Verify and decode session token
export function verifySessionToken(token, secret) {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "missing_token" };
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return { valid: false, reason: "malformed_token" };
  }

  let payloadJson;
  try {
    payloadJson = Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    return { valid: false, reason: "invalid_encoding" };
  }

  const expectedSig = signPayload(payloadJson, secret);
  if (!safeEquals(signature, expectedSig)) {
    return { valid: false, reason: "invalid_signature" };
  }

  try {
    const parsed = JSON.parse(payloadJson);
    return {
      valid: true,
      sessionId: parsed.sid,
      userId: parsed.uid,
      createdAt: parsed.ts,
      fingerprint: parsed.fp,
    };
  } catch {
    return { valid: false, reason: "invalid_payload" };
  }
}

// Generate client fingerprint from request headers
function generateFingerprint(headers, ip) {
  const userAgent = headers?.["user-agent"] || "";
  const acceptLanguage = headers?.["accept-language"] || "";
  const acceptEncoding = headers?.["accept-encoding"] || "";

  // Create a fingerprint from stable browser characteristics
  // Note: IP is NOT included to allow for network changes (mobile, VPN, etc.)
  // Instead, we use browser characteristics that are more stable
  const fingerprintData = `${userAgent}|${acceptLanguage}|${acceptEncoding}`;
  return hash(fingerprintData).substring(0, 16);
}

// Rate limiting for session creation
async function checkSessionRateLimit(ip) {
  if (!SESSION_RATE_LIMIT_ENABLED || !ip) {
    return { allowed: true };
  }

  const key = keySessionRateLimitIp(ip);
  try {
    const count = await store.incrBy(key, 1);
    if (count === 1) {
      await store.expire(key, 60);
    }

    if (count > SESSION_RATE_LIMIT_PER_IP_PER_MIN) {
      return {
        allowed: false,
        count,
        limit: SESSION_RATE_LIMIT_PER_IP_PER_MIN,
      };
    }
    return { allowed: true, count };
  } catch {
    return { allowed: true }; // Fail open on Redis errors
  }
}

// Store session metadata in Redis
async function storeSession({ sessionId, userId, createdAt, fingerprint, ip }) {
  const key = keyServerSession(sessionId);
  const sessionData = JSON.stringify({
    userId,
    createdAt,
    fingerprint,
    ipHash: hash(ip || "unknown").substring(0, 16), // Store hashed IP for audit, not validation
    lastActivity: createdAt,
  });

  try {
    await store.setex(key, SESSION_TTL_SEC, sessionData);
    return { stored: true };
  } catch (err) {
    console.error("[start-session] Failed to store session:", err);
    return { stored: false, error: err.message };
  }
}

// Validate session exists and matches (userId is the identityId stored in the token)
export async function validateServerSession({ sessionId, userId, fingerprint }) {
  const key = keyServerSession(sessionId);

  try {
    const raw = await store.get(key);
    if (!raw) {
      return { valid: false, reason: "session_not_found" };
    }

    const data = JSON.parse(raw);

    // Verify userId matches
    if (data.userId !== userId) {
      return { valid: false, reason: "user_mismatch" };
    }

    // Verify fingerprint matches (anti-hijacking)
    if (data.fingerprint !== fingerprint) {
      return { valid: false, reason: "fingerprint_mismatch", suspicious: true };
    }

    // Session is valid
    return {
      valid: true,
      createdAt: data.createdAt,
      lastActivity: data.lastActivity,
    };
  } catch (err) {
    console.error("[start-session] Failed to validate session:", err);
    return { valid: false, reason: "validation_error" };
  }
}

// Update session last activity
export async function touchSession(sessionId) {
  const key = keyServerSession(sessionId);

  try {
    const raw = await store.get(key);
    if (!raw) return { updated: false };

    const data = JSON.parse(raw);
    data.lastActivity = Date.now();

    await store.setex(key, SESSION_TTL_SEC, JSON.stringify(data));
    return { updated: true };
  } catch {
    return { updated: false };
  }
}

export async function handler(event) {
  const origin = event.headers?.origin;

  // SECURITY: Validate CORS before any side effects
  // Only allow Netlify domains belonging to OUR site (not all *.netlify.app)
  // Fallback: If NETLIFY_SITE_NAME is unavailable (test/local env), allow all *.netlify.app
  let isAllowedNetlifyDomain = false;
  if (origin) {
    if (NETLIFY_SITE_NAME) {
      const netlifyPattern = new RegExp(
        `^https:\\/\\/(?:[a-z0-9-]+--)?${NETLIFY_SITE_NAME}\\.netlify\\.app$`,
        "i"
      );
      isAllowedNetlifyDomain = netlifyPattern.test(origin);
    } else {
      // Fallback for test/local environments where URL is not set
      isAllowedNetlifyDomain = /^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(origin);
    }
  }
  if (origin && !isAllowedNetlifyDomain && CORS_ALLOW.length > 0 && !CORS_ALLOW.includes(origin)) {
    return {
      statusCode: 403,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
      body: JSON.stringify({ error: "forbidden", message: "origin_not_allowed" }),
    };
  }

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    const corsHeadersObj = corsHeaders(origin);
    if (!corsHeadersObj) {
      return {
        statusCode: 403,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ error: "forbidden", message: "origin_not_allowed" }),
      };
    }
    return { statusCode: 204, headers: corsHeadersObj };
  }

  // Only accept POST requests
  if (event.httpMethod !== "POST") {
    return json(405, { error: "method_not_allowed" }, origin);
  }

  // Validate secret is configured and has sufficient entropy
  const secret = process.env.XP_DAILY_SECRET;
  if (!secret) {
    return json(500, { error: "server_config", message: "secret_not_configured" }, origin);
  }
  if (secret.length < 32) {
    return json(500, { error: "server_config", message: "secret_too_short" }, origin);
  }

  // Get client IP
  const clientIp = event.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()
    || event.headers?.["x-real-ip"]
    || "unknown";

  // Rate limiting
  const rateLimitResult = await checkSessionRateLimit(clientIp);
  if (!rateLimitResult.allowed) {
    const payload = {
      error: "rate_limit_exceeded",
      message: "Too many session creation requests",
      retryAfter: 60,
    };
    if (DEBUG_ENABLED) {
      payload.debug = {
        count: rateLimitResult.count,
        limit: rateLimitResult.limit,
      };
    }
    return json(429, payload, origin, { "Retry-After": "60" });
  }

  const queryAnonIdRaw = typeof event.queryStringParameters?.anonId === "string"
    ? event.queryStringParameters.anonId
    : typeof event.queryStringParameters?.userId === "string"
      ? event.queryStringParameters.userId
      : null;

  // Parse request body
  let body = {};
  try {
    if (event.body) {
      body = JSON.parse(event.body);
    }
  } catch {
    return json(400, { error: "bad_json" }, origin);
  }

  const bodyAnonIdRaw = typeof body.anonId === "string"
    ? body.anonId
    : typeof body.userId === "string"
      ? body.userId
      : null;
  const anonIdRaw = bodyAnonIdRaw ?? queryAnonIdRaw;
  const anonId = typeof anonIdRaw === "string" ? anonIdRaw.trim() : null;

  const jwtToken = extractBearerToken(event.headers);
  const authContext = verifySupabaseJwt(jwtToken);
  const supabaseUserId = authContext.valid ? authContext.userId : null;
  const identityId = supabaseUserId || anonId || null;

  if (!identityId) {
    return json(400, { error: "missing_identity" }, origin);
  }

  // Generate session data
  const now = Date.now();
  const sessionId = generateSessionId();
  const fingerprint = generateFingerprint(event.headers, clientIp);

  // Create signed session token
  const sessionToken = createSignedSessionToken({
    sessionId,
    userId: identityId, // userId field carries identityId (Supabase userId when authenticated)
    createdAt: now,
    fingerprint,
    secret,
  });

  // Store session in Redis
  const storeResult = await storeSession({
    sessionId,
    userId: identityId,
    createdAt: now,
    fingerprint,
    ip: clientIp,
  });

  if (!storeResult.stored) {
    return json(500, { error: "session_storage_failed" }, origin);
  }

  // Build response
  const response = {
    ok: true,
    sessionId,
    sessionToken,
    expiresIn: SESSION_TTL_SEC,
    createdAt: now,
  };

  if (DEBUG_ENABLED) {
    response.debug = {
      fingerprint,
      ipHash: hash(clientIp).substring(0, 8),
    };
  }

  return json(200, response, origin);
}
