import crypto from "node:crypto";
import { store } from "./_shared/store-upstash.mjs";
import { extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { buildApiCorsPolicy, buildCorsHeaders } from "./_shared/api-cors.mjs";
import {
  createSignedXpSessionToken,
  createXpSessionFingerprint,
  resolveXpSessionSecret,
  verifySignedXpSessionToken,
} from "./_shared/xp-server-session.mjs";

// Configuration
const SESSION_TTL_SEC = Math.max(0, Number(process.env.XP_SESSION_TTL_SEC) || 604800); // 7 days default
const KEY_NS = process.env.XP_KEY_NS ?? "kcswh:xp:v2";
const DEBUG_ENABLED = process.env.XP_DEBUG === "1";
const API_CORS_POLICY = buildApiCorsPolicy();
if (API_CORS_POLICY.invalidConfiguredOriginCount > 0) {
  klog("api_cors_config_invalid", { context: API_CORS_POLICY.buildContext, invalidOriginCount: API_CORS_POLICY.invalidConfiguredOriginCount });
}

// Rate limiting for session creation
const SESSION_RATE_LIMIT_PER_IP_PER_MIN = Math.max(0, Number(process.env.XP_SESSION_RATE_LIMIT_IP) || 5);
const SESSION_RATE_LIMIT_ENABLED = process.env.XP_SESSION_RATE_LIMIT_ENABLED !== "0";

// Hash helper
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

// Key generators
const keyServerSession = (sessionId) => `${KEY_NS}:server-session:${sessionId}`;
const keySessionRateLimitIp = (ip) => `${KEY_NS}:session-ratelimit:ip:${hash(ip)}:${Math.floor(Date.now() / 60000)}`;

// CORS headers
function corsHeaders(origin) {
  return buildCorsHeaders({ origin, policy: API_CORS_POLICY, methods: "POST,OPTIONS", allowedHeaders: "content-type,authorization,x-api-key" });
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
// Verify and decode session token
export function verifySessionToken(token, secret) {
  return verifySignedXpSessionToken(token, secret);
}

// Generate client fingerprint from request headers
function generateFingerprint(headers) {
  return createXpSessionFingerprint(headers);
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
    klog("xp_session_store_failed", { outcome: "unavailable" });
    return { stored: false, unavailable: true };
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
    klog("xp_session_validation_failed", { outcome: "unavailable" });
    return { valid: false, reason: "validation_unavailable", unavailable: true };
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

  // SECURITY: Validate CORS before any side effects.
  if (origin && !corsHeaders(origin)) {
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
  const sessionConfig = resolveXpSessionSecret(process.env);
  if (!sessionConfig.valid) {
    klog("xp_session_config_invalid", { outcome: "misconfigured", reason: sessionConfig.reason });
    return json(500, { error: "server_config" }, origin);
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
  const authContext = await verifySupabaseJwt(jwtToken);
  if (jwtToken && !authContext.valid) {
    return json(401, { error: "unauthorized", message: authContext.reason || "invalid_token" }, origin);
  }
  const supabaseUserId = authContext.valid ? authContext.userId : null;
  const identityId = supabaseUserId || anonId || null;

  if (!identityId) {
    return json(400, { error: "missing_identity" }, origin);
  }

  // Generate session data
  const now = Date.now();
  const sessionId = generateSessionId();
  const fingerprint = generateFingerprint(event.headers);

  // Create signed session token
  const sessionToken = createSignedXpSessionToken({
    sessionId,
    userId: identityId, // userId field carries identityId (Supabase userId when authenticated)
    createdAt: now,
    fingerprint,
    secret: sessionConfig.secret,
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
    return json(503, { error: "session_unavailable", requiresNewSession: false }, origin, { "Retry-After": "5" });
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
