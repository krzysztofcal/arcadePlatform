import crypto from "node:crypto";
import { store, saveUserProfile, atomicRateLimitIncr } from "./_shared/store-upstash.mjs";
import { klog } from "./_shared/supabase-admin.mjs";
import { verifySessionToken, validateServerSession, touchSession } from "./start-session.mjs";

const warsawDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
});

const warsawOffsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Warsaw",
  hour12: false,
  timeZoneName: "longOffset",
});

const XP_DAY_COOKIE = "xp_day";

const warsawParts = (ms) => {
  const parts = warsawDateFormatter.formatToParts(new Date(ms));
  const result = {};
  for (const part of parts) {
    if (part.type === "year" || part.type === "month" || part.type === "day" || part.type === "hour") {
      result[part.type] = Number(part.value);
    }
  }
  return result;
};

const parseWarsawOffsetMinutes = (ms) => {
  const parts = warsawOffsetFormatter.formatToParts(new Date(ms));
  const offsetPart = parts.find((part) => part.type === "timeZoneName");
  if (!offsetPart) return 0;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offsetPart.value);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return sign * (hours * 60 + minutes);
};

const warsawNow = (ms = Date.now()) => ({
  ...warsawParts(ms),
  ms,
});

const toWarsawEpoch = (year, month, day, hour) => {
  let guessUtc = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
  let offset = parseWarsawOffsetMinutes(guessUtc);
  let adjusted = guessUtc - offset * 60_000;
  const adjustedOffset = parseWarsawOffsetMinutes(adjusted);
  if (adjustedOffset !== offset) {
    offset = adjustedOffset;
    adjusted = Date.UTC(year, month - 1, day, hour, 0, 0, 0) - offset * 60_000;
  }
  return adjusted;
};

// Warsaw reset occurs at 03:00 local time. Date math in this zone automatically
// normalizes DST gaps/overlaps so the key always shifts after the local reset.
const getDailyKey = (ms = Date.now()) => {
  let effectiveMs = ms;
  let { year, month, day, hour } = warsawParts(effectiveMs);
  if (hour < 3) {
    effectiveMs -= 3 * 60 * 60 * 1000;
    ({ year, month, day } = warsawParts(effectiveMs));
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const getNextResetEpoch = (ms = Date.now()) => {
  const current = warsawNow(ms);
  let targetYear = current.year;
  let targetMonth = current.month;
  let targetDay = current.day;
  if (current.hour >= 3) {
    const tomorrow = warsawParts(ms + 24 * 60 * 60 * 1000);
    targetYear = tomorrow.year;
    targetMonth = tomorrow.month;
    targetDay = tomorrow.day;
  }
  return toWarsawEpoch(targetYear, targetMonth, targetDay, 3);
};

const asNumber = (raw, fallback) => {
  if (raw == null) return fallback;
  const sanitized = typeof raw === "string" ? raw.replace(/_/g, "") : raw;
  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const DAILY_CAP = Math.max(0, asNumber(process.env.XP_DAILY_CAP, 3000));
const SESSION_CAP = asNumber(process.env.XP_SESSION_CAP, 300);
const DELTA_CAP = asNumber(process.env.XP_DELTA_CAP, 300);
const SESSION_TTL_SEC = Math.max(0, asNumber(process.env.XP_SESSION_TTL_SEC, 604800));
const SESSION_TTL_MS = SESSION_TTL_SEC > 0 ? SESSION_TTL_SEC * 1000 : 0;
const REQUIRE_ACTIVITY = process.env.XP_REQUIRE_ACTIVITY === "1";
const MIN_ACTIVITY_EVENTS = Math.max(0, asNumber(process.env.XP_MIN_ACTIVITY_EVENTS, 4));
const MIN_ACTIVITY_VIS_S = Math.max(0, asNumber(process.env.XP_MIN_ACTIVITY_VIS_S, 8));
const METADATA_MAX_BYTES = Math.max(0, asNumber(process.env.XP_METADATA_MAX_BYTES, 2048));
const DEBUG_ENABLED = process.env.XP_DEBUG === "1";
const KEY_NS = process.env.XP_KEY_NS ?? "kcswh:xp:v2";
const LOCK_KEY_PREFIX = `${KEY_NS}:lock:`;
const DRIFT_MS = Math.max(0, asNumber(process.env.XP_DRIFT_MS, 30_000));
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

const RAW_LOCK_TTL = Number(process.env.XP_LOCK_TTL_MS ?? 3_000);
const LOCK_TTL_MS = Number.isFinite(RAW_LOCK_TTL) && RAW_LOCK_TTL >= 0 ? RAW_LOCK_TTL : 3_000;
klog("xp_lock_config", {
  lockTtlMs: LOCK_TTL_MS,
  rawLockTtl: RAW_LOCK_TTL,
  lockPrefix: LOCK_KEY_PREFIX,
});

// SECURITY: Rate limiting configuration
const RATE_LIMIT_PER_USER_PER_MIN = Math.max(0, asNumber(process.env.XP_RATE_LIMIT_USER_PER_MIN, 30));
const RATE_LIMIT_PER_IP_PER_MIN = Math.max(0, asNumber(process.env.XP_RATE_LIMIT_IP_PER_MIN, 60));
const RATE_LIMIT_ENABLED = process.env.XP_RATE_LIMIT_ENABLED !== "0"; // Default enabled

// SECURITY: Server-side session token configuration
// These are read at runtime to support dynamic configuration changes
// When enabled, XP awards require a valid server-signed session token
const getRequireServerSession = () => process.env.XP_REQUIRE_SERVER_SESSION === "1";
// Warn mode logs validation failures but doesn't block requests (for gradual rollout)
const getServerSessionWarnMode = () => process.env.XP_SERVER_SESSION_WARN_MODE === "1";

const sanitizeTotal = (value) => Math.max(0, Math.floor(Number(value) || 0));

const sleep = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

const signPayload = (payload, secret) =>
  crypto.createHmac("sha256", secret).update(payload).digest("base64url");

const safeEquals = (a, b) => {
  if (a.length !== b.length) return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_JWT_SECRET_V2;
if (!SUPABASE_JWT_SECRET) {
  klog("xp_auth_jwt_secret_missing", {});
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

const extractBearerToken = (headers) => {
  const headerValue = headers?.authorization || headers?.Authorization || headers?.AUTHORIZATION;
  if (!headerValue || typeof headerValue !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match ? match[1].trim() : null;
};

const verifySupabaseJwt = (token) => {
  if (!token) return { provided: false, valid: false, reason: "missing_token" };
  if (!SUPABASE_JWT_SECRET) {
    return { provided: false, valid: false, reason: "auth_disabled" };
  }
  const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
  if (!headerSegment || !payloadSegment || !signatureSegment) {
    return { provided: true, valid: false, reason: "malformed_token" };
  }
  const header = decodeBase64UrlJson(headerSegment);
  const payload = decodeBase64UrlJson(payloadSegment);
  if (!header || !payload) {
    return { provided: true, valid: false, reason: "invalid_encoding" };
  }
  const alg = header.alg || "HS256";
  const hmacAlg = alg === "HS512" ? "sha512" : "sha256";
  const expectedSig = crypto.createHmac(hmacAlg, SUPABASE_JWT_SECRET)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest("base64url");
  if (!safeEquals(signatureSegment, expectedSig)) {
    return { provided: true, valid: false, reason: "invalid_signature" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp && Number(payload.exp) <= nowSec) {
    return { provided: true, valid: false, reason: "expired" };
  }
  const userId = typeof payload.sub === "string" ? payload.sub : null;
  if (!userId) {
    return { provided: true, valid: false, reason: "missing_sub" };
  }
  return { provided: true, valid: true, userId, payload };
};

async function persistUserProfile({ userId, totalXp, now }) {
  if (!userId) return;
  try {
    await saveUserProfile({ userId, totalXp, now });
  } catch (err) {
    klog("xp_save_user_profile_failed", { userId, error: err?.message });
  }
}

const parseCookies = (header) => {
  if (!header || typeof header !== "string") return {};
  const jar = {};
  const parts = header.split(/;\s*/);
  for (const part of parts) {
    if (!part) continue;
    const [name, ...rest] = part.split("=");
    if (!name) continue;
    jar[name.trim()] = rest.join("=");
  }
  return jar;
};

const readXpCookie = (header, secret) => {
  const cookies = parseCookies(header);
  const raw = cookies[XP_DAY_COOKIE];
  if (!raw) return { key: null, total: 0 };
  const [encodedPayload, signature] = raw.split(".");
  if (!encodedPayload || !signature) return { key: null, total: 0 };
  let payloadJson;
  try {
    payloadJson = Buffer.from(encodedPayload, "base64url").toString("utf8");
  } catch {
    return { key: null, total: 0 };
  }
  const expectedSig = signPayload(payloadJson, secret);
  if (!safeEquals(signature, expectedSig)) {
    return { key: null, total: 0 };
  }
  try {
    const parsed = JSON.parse(payloadJson);
    const key = typeof parsed?.k === "string" ? parsed.k : null;
    const total = sanitizeTotal(parsed?.t);
    if (!key) return { key: null, total: 0 };
    return { key, total };
  } catch {
    return { key: null, total: 0 };
  }
};

const buildXpCookie = ({ key, total, secret, now, nextReset }) => {
  const safeTotal = Math.min(DAILY_CAP, Math.max(0, sanitizeTotal(total)));
  const payload = JSON.stringify({ k: key, t: safeTotal });
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const signature = signPayload(payload, secret);
  const maxAgeMs = Math.max(0, nextReset - now);
  const maxAge = Math.max(0, Math.floor(maxAgeMs / 1000));

  // Default to Secure in production, allow opt-out for local dev
  const isProduction = process.env.CONTEXT === "production" || process.env.NODE_ENV === "production";
  const secureFlag = process.env.XP_COOKIE_SECURE !== "0"; // Opt-out instead of opt-in
  const secureAttr = (secureFlag || isProduction) ? "; Secure" : "";

  return `${XP_DAY_COOKIE}=${encoded}.${signature}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secureAttr}`;
};

const json = (statusCode, obj, origin, extraHeaders) => {
  const corsHeadersObj = corsHeaders(origin);
  if (!corsHeadersObj) {
    // SECURITY: Reject requests from non-whitelisted origins
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

function corsHeaders(origin) {
  // SECURITY: CORS validation for cross-origin requests
  // Note: Origin header is only present for cross-origin requests
  // Same-origin and local requests don't have Origin header - allow those

  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };

  // If there's no Origin header, it's same-origin/local - allow it
  if (!origin) {
    return headers;
  }

  // Automatically allow Netlify deploy preview and production domains
  // Pattern: https://*.netlify.app (including deploy-preview-*, branch-*, etc.)
  const isNetlifyDomain = /^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(origin);

  // If there IS an Origin header, enforce whitelist (unless it's a Netlify domain)
  if (!isNetlifyDomain && CORS_ALLOW.length > 0 && !CORS_ALLOW.includes(origin)) {
    return null; // Signal rejection for non-whitelisted origins
  }

  // Origin is whitelisted (or no whitelist configured) - add CORS headers
  headers["access-control-allow-origin"] = origin;
  headers["access-control-allow-headers"] = "content-type,authorization,x-api-key";
  headers["access-control-allow-methods"] = "POST,OPTIONS";
  headers["Vary"] = "Origin";

  return headers;
}

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

// Generate client fingerprint from request headers (must match start-session.mjs)
function generateFingerprint(headers) {
  const userAgent = headers?.["user-agent"] || "";
  const acceptLanguage = headers?.["accept-language"] || "";
  const acceptEncoding = headers?.["accept-encoding"] || "";
  const fingerprintData = `${userAgent}|${acceptLanguage}|${acceptEncoding}`;
  return hash(fingerprintData).substring(0, 16);
}

// NOTE: userId represents the XP storage identity:
// Supabase userId for logged-in users, or anonId for anonymous users.
const keyDaily = (u, day = getDailyKey()) => `${KEY_NS}:daily:${u}:${day}`;
const keyTotal = (u) => `${KEY_NS}:total:${u}`;
const keySession = (u, s) => `${KEY_NS}:session:${hash(`${u}|${s}`)}`;
const keySessionSync = (u, s) => `${KEY_NS}:session:last:${hash(`${u}|${s}`)}`;
const keyLock = (u, s) => `${LOCK_KEY_PREFIX}${hash(`${u}|${s}`)}`;
const rateLimitWindowKey = () => Math.floor(Date.now() / 60000);
const RATE_LIMIT_WINDOW_TTL_SEC = 70;
const keyRateLimitUser = (userId) => `${KEY_NS}:ratelimit:user:${userId}:${rateLimitWindowKey()}`;
const keyRateLimitIp = (ip) => `${KEY_NS}:ratelimit:ip:${hash(ip)}:${rateLimitWindowKey()}`;
const keySessionRegistry = (userId, sessionId) => `${KEY_NS}:registry:${hash(`${userId}|${sessionId}`)}`;
const keyMigration = (anonId, userId) => `${KEY_NS}:migration:${hash(`${anonId}|${userId}`)}`;

// SECURITY: Session registration
async function registerSession({ userId, sessionId }) {
  if (!userId || !sessionId) return { registered: false };
  const key = keySessionRegistry(userId, sessionId);
  try {
    // Register session with 7 day TTL (same as session data)
    const ttlSeconds = SESSION_TTL_SEC > 0 ? SESSION_TTL_SEC : 604800;
    await store.setex(key, ttlSeconds, Date.now().toString());
    return { registered: true };
  } catch (err) {
    klog("xp_session_registration_failed", { userId, sessionId, error: err?.message });
    return { registered: false };
  }
}

async function isSessionRegistered({ userId, sessionId }) {
  if (!userId || !sessionId) return false;
  const key = keySessionRegistry(userId, sessionId);
  try {
    const value = await store.get(key);
    return value !== null;
  } catch {
    return false; // Fail open - don't block on Redis errors
  }
}

// SECURITY: Rate limiting check
async function checkRateLimit({ userId, ip }) {
  // userId represents the XP identity (Supabase userId or anonId) for per-identity throttling.
  if (!RATE_LIMIT_ENABLED) return { allowed: true };

  const checks = [];

  // Check userId rate limit (atomic increment + TTL via Lua script)
  if (userId && RATE_LIMIT_PER_USER_PER_MIN > 0) {
    const userKey = keyRateLimitUser(userId);
    checks.push(
      atomicRateLimitIncr(userKey, RATE_LIMIT_WINDOW_TTL_SEC)
        .then(({ count }) => ({
          type: 'user',
          count,
          limit: RATE_LIMIT_PER_USER_PER_MIN,
          exceeded: count > RATE_LIMIT_PER_USER_PER_MIN,
        }))
        .catch((err) => {
          klog("xp_rate_limit_atomic_failed", { keyType: "user", userId, error: err?.message });
          return { type: 'user', count: 0, limit: RATE_LIMIT_PER_USER_PER_MIN, exceeded: false };
        })
    );
  }

  // Check IP rate limit (atomic increment + TTL via Lua script)
  if (ip && RATE_LIMIT_PER_IP_PER_MIN > 0) {
    const ipKey = keyRateLimitIp(ip);
    checks.push(
      atomicRateLimitIncr(ipKey, RATE_LIMIT_WINDOW_TTL_SEC)
        .then(({ count }) => ({
          type: 'ip',
          count,
          limit: RATE_LIMIT_PER_IP_PER_MIN,
          exceeded: count > RATE_LIMIT_PER_IP_PER_MIN,
        }))
        .catch((err) => {
          klog("xp_rate_limit_atomic_failed", { keyType: "ip", error: err?.message });
          return { type: 'ip', count: 0, limit: RATE_LIMIT_PER_IP_PER_MIN, exceeded: false };
        })
    );
  }

  if (checks.length === 0) {
    return { allowed: true };
  }

  const results = await Promise.all(checks);
  const exceeded = results.find(r => r.exceeded);

  if (exceeded) {
    return {
      allowed: false,
      type: exceeded.type,
      count: exceeded.count,
      limit: exceeded.limit,
    };
  }

  return { allowed: true, checks: results };
}

async function getTotals({ userId, sessionId, now = Date.now() }) {
  // userId represents the XP identity (Supabase userId or anonId) for XP aggregation keys.
  const todayKey = keyDaily(userId, getDailyKey(now));
  const totalKeyK = keyTotal(userId);
  const sessionKeyK = sessionId ? keySession(userId, sessionId) : null;
  const sessionSyncKeyK = sessionId ? keySessionSync(userId, sessionId) : null;
  try {
    const reads = [store.get(todayKey), store.get(totalKeyK)];
    if (sessionKeyK) reads.push(store.get(sessionKeyK));
    if (sessionSyncKeyK) reads.push(store.get(sessionSyncKeyK));
    const values = await Promise.all(reads);
    const current = Number(values[0] ?? "0") || 0;
    const lifetime = Number(values[1] ?? "0") || 0;
    const sessionTotal = sessionKeyK ? (Number(values[2] ?? "0") || 0) : 0;
    const lastSync = sessionSyncKeyK ? (Number(values[sessionKeyK ? 3 : 2] ?? "0") || 0) : 0;
    const totals = { current, lifetime, sessionTotal, lastSync };
    klog("award_getTotals_debug", {
      xpIdentityUserId: userId,
      sessionId,
      now,
      totals,
      keys: {
        todayKey,
        totalKey: totalKeyK,
      },
    });
    return totals;
  } catch {
    return { current: 0, lifetime: 0, sessionTotal: 0, lastSync: 0 };
  }
}

export async function handler(event) {
  const origin = event.headers?.origin;

  // SECURITY: Validate CORS BEFORE any side effects (rate limiting, session registration, XP awarding)
  // Check if this is a cross-origin request (has Origin header) from a non-whitelisted origin
  // Automatically allow Netlify domains (*.netlify.app)
  const isNetlifyDomain = origin ? /^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(origin) : false;
  if (origin && !isNetlifyDomain && CORS_ALLOW.length > 0 && !CORS_ALLOW.includes(origin)) {
    // Reject immediately before any mutations
    return {
      statusCode: 403,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
      body: JSON.stringify({ error: "forbidden", message: "origin_not_allowed" }),
    };
  }

  if (event.httpMethod === "OPTIONS") {
    const corsHeadersObj = corsHeaders(origin);
    // This should never be null now due to check above, but keep for safety
    if (!corsHeadersObj) {
      return {
        statusCode: 403,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ error: "forbidden", message: "origin_not_allowed" }),
      };
    }
    return { statusCode: 204, headers: corsHeadersObj };
  }

  const secret = process.env.XP_DAILY_SECRET;
  if (!secret) {
    return json(500, { error: "server_config", message: "xp_daily_secret_missing" }, origin);
  }
  if (secret.length < 32) {
    return json(500, { error: "server_config", message: "xp_daily_secret_too_short" }, origin);
  }

  const now = Date.now();
  const dayKeyNow = getDailyKey(now);
  const nextReset = getNextResetEpoch(now);
  const cookieHeader = event.headers?.cookie ?? event.headers?.Cookie ?? "";
  const cookieState = readXpCookie(cookieHeader, secret);
  const cookieKeyMatches = cookieState.key === dayKeyNow;
  const cookieTotal = cookieKeyMatches ? sanitizeTotal(cookieState.total) : 0;
  const cookieRemainingBefore = Math.max(0, DAILY_CAP - cookieTotal);

  const querySessionId = typeof event.queryStringParameters?.sessionId === "string"
    ? event.queryStringParameters.sessionId.trim()
    : null;

  const queryAnonIdRaw = typeof event.queryStringParameters?.anonId === "string"
    ? event.queryStringParameters.anonId
    : typeof event.queryStringParameters?.userId === "string"
      ? event.queryStringParameters.userId
      : null;

  let anonIdRaw = queryAnonIdRaw;
  let anonId = typeof anonIdRaw === "string" ? anonIdRaw.trim() : null;

  const jwtToken = extractBearerToken(event.headers);
  const authContext = verifySupabaseJwt(jwtToken);
  const supabaseUserId = authContext.valid ? authContext.userId : null;
  let xpIdentity = supabaseUserId || anonId || null;

  const applyDiagnostics = (payload, extra = {}) => {
    if (!DEBUG_ENABLED) return;
    const debug = payload.debug ?? {};
    if (debug.redisDailyTotalRaw === undefined && extra.redisDailyTotalRaw !== undefined) {
      debug.redisDailyTotalRaw = extra.redisDailyTotalRaw;
    }
    if (extra.redisDailyTotal !== undefined) {
      debug.redisDailyTotal = extra.redisDailyTotal;
    }
    debug.cookieKey = cookieState.key;
    debug.cookieTotal = cookieState.total;
    debug.cookieTotalSanitized = cookieTotal;
    debug.cookieRemainingBefore = cookieRemainingBefore;
    debug.authProvided = authContext.provided;
    debug.authValid = authContext.valid;
    debug.authReason = authContext.reason;
    // NOTE: Do not include raw anonId/xpIdentity in debug to avoid reflecting user input in responses (XSS safety).
    Object.assign(debug, extra);
    payload.debug = debug;
  };

  const buildResponse = (statusCode, payload, totalTodaySource, options = {}) => {
    const { debugExtra = {}, skipCookie = false } = options;
    const safeTotal = Math.min(DAILY_CAP, Math.max(0, sanitizeTotal(totalTodaySource)));
    const remaining = Math.max(0, DAILY_CAP - safeTotal);
    payload.totalToday = safeTotal;
    payload.remaining = remaining;
    payload.dayKey ??= dayKeyNow;
    payload.nextReset ??= nextReset;
    applyDiagnostics(payload, { redisDailyTotalRaw: totalTodaySource, redisDailyTotal: safeTotal, ...debugExtra });
    const headers = skipCookie
      ? undefined
      : { "Set-Cookie": buildXpCookie({ key: dayKeyNow, total: safeTotal, secret, now, nextReset }) };
    return json(statusCode, payload, origin, headers);
  };

  if (event.httpMethod !== "POST") {
    let totals = null;
    if (xpIdentity) {
      totals = await getTotals({ userId: xpIdentity, sessionId: querySessionId, now });
    }
    const totalSource = totals ? totals.current : cookieTotal;
    const payload = { error: "method_not_allowed" };
    return buildResponse(405, payload, totalSource, {
      debugExtra: { mode: "method_not_allowed" },
      skipCookie: !xpIdentity,
    });
  }

  let body = {};
  try {
    if (event.body) {
      body = JSON.parse(event.body);
    }
  } catch {
    let totals = null;
    if (xpIdentity) {
      totals = await getTotals({ userId: xpIdentity, sessionId: querySessionId, now });
    }
    const totalSource = totals ? totals.current : cookieTotal;
    const payload = { error: "bad_json" };
    return buildResponse(400, payload, totalSource, {
      debugExtra: { mode: "bad_json" },
      skipCookie: !xpIdentity,
    });
  }

  const bodyAnonIdRaw = typeof body.anonId === "string"
    ? body.anonId
    : typeof body.userId === "string"
      ? body.userId
      : null;
  if (bodyAnonIdRaw) {
    anonIdRaw = bodyAnonIdRaw;
    anonId = typeof anonIdRaw === "string" ? anonIdRaw.trim() : null;
  }

  xpIdentity = supabaseUserId || anonId || null;

  klog("auth_debug", {
    provided: authContext.provided,
    valid: authContext.valid,
    reason: authContext.reason,
    identityId: xpIdentity,
    xpIdentity: xpIdentity,
    supabaseUserId,
    anonId,
  });

  // If we have a Supabase user and a prior anon id, migrate anon totals once into the
  // authenticated bucket so status reads and new awards share the same keys.
  if (supabaseUserId && anonId && anonId !== supabaseUserId) {
    const markerKey = keyMigration(anonId, supabaseUserId);
    try {
      const already = await store.get(markerKey);
      if (!already) {
        const anonTotals = await getTotals({ userId: anonId, sessionId: querySessionId, now });
        if (anonTotals && anonTotals.lifetime > 0) {
          const anonTotalKey = keyTotal(anonId);
          const userTotalKey = keyTotal(supabaseUserId);
          const pipe = store.pipeline();
          pipe.incrby(userTotalKey, anonTotals.lifetime);
          pipe.del(anonTotalKey);
          pipe.set(markerKey, String(anonTotals.lifetime));
          await pipe.exec();
          klog("xp_migrated_anon_to_account", {
            from: anonId,
            to: supabaseUserId,
            amount: anonTotals.lifetime,
          });
        } else {
          await store.set(markerKey, "0");
        }
      }
    } catch (err) {
      klog("xp_migration_failed", { from: anonId, to: supabaseUserId, error: err?.message });
    }
  }

  const sessionIdRaw = body.sessionId ?? querySessionId;
  let sessionId = typeof sessionIdRaw === "string" ? sessionIdRaw.trim() : null;

  // SECURITY: Rate limiting check
  const clientIp = event.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()
    || event.headers?.["x-real-ip"]
    || "unknown";

  const isStatusOnly = body.statusOnly === true;
  const rateLimitResult = isStatusOnly ? { allowed: true } : await checkRateLimit({ userId: xpIdentity, ip: clientIp });
  if (!rateLimitResult.allowed) {
    const retryAfter = rateLimitResult.retryAfter ?? 60;
    const payload = {
      error: "rate_limit_exceeded",
      message: `Too many requests from ${rateLimitResult.type}`,
      retryAfter,
    };
    if (DEBUG_ENABLED) {
      payload.debug = {
        rateLimitType: rateLimitResult.type,
        count: rateLimitResult.count,
        limit: rateLimitResult.limit,
      };
    }
    return json(429, payload, origin, { "Retry-After": String(retryAfter) });
  }

  // SECURITY: Server-side session token validation
  const sessionToken = body.sessionToken || event.headers?.["x-session-token"];
  let parsedSessionToken = null;
  if (sessionToken) {
    parsedSessionToken = verifySessionToken(sessionToken, secret);
  }
  const requireServerSession = getRequireServerSession();
  const serverSessionWarnMode = getServerSessionWarnMode();
  if (requireServerSession || serverSessionWarnMode) {
    if (!body.statusOnly) {
      const fingerprint = generateFingerprint(event.headers);
      let sessionValid = false;
      let sessionError = null;

      if (!sessionToken) {
        sessionError = "missing_session_token";
      } else {
        // Verify HMAC signature on token
        const tokenResult = parsedSessionToken ?? verifySessionToken(sessionToken, secret);
        parsedSessionToken = tokenResult;
        if (!tokenResult.valid) {
          sessionError = `token_${tokenResult.reason}`;
        } else if (tokenResult.userId !== xpIdentity) {
          sessionError = "token_user_mismatch";
        } else if (tokenResult.fingerprint !== fingerprint) {
          sessionError = "token_fingerprint_mismatch";
        } else {
          // Verify session exists in Redis and matches
          const serverValidation = await validateServerSession({
            sessionId: tokenResult.sessionId,
            userId: xpIdentity,
            fingerprint,
          });
          if (!serverValidation.valid) {
            sessionError = `session_${serverValidation.reason}`;
            if (serverValidation.suspicious) {
              klog("xp_session_validation_suspicious", {
                userId: xpIdentity,
                fingerprint,
                ip: clientIp,
                reason: serverValidation.reason,
              });
            }
          } else {
            sessionValid = true;
            // Update session last activity
            touchSession(tokenResult.sessionId).catch(() => {});
          }
        }
      }

      if (!sessionValid) {
        if (requireServerSession) {
          // Enforce mode: reject request
          const payload = {
            error: "invalid_session",
            message: sessionError || "session_validation_failed",
            requiresNewSession: true,
          };
          if (DEBUG_ENABLED) {
            payload.debug = {
              sessionError,
              hasToken: !!sessionToken,
              fingerprint,
            };
          }
          return json(401, payload, origin);
        } else if (serverSessionWarnMode) {
          // Warn mode: log but don't block
          klog("xp_session_validation_warn_mode_failed", {
            userId: xpIdentity,
            sessionError,
            hasToken: !!sessionToken,
            ip: clientIp,
          });
        }
      }
    }
  }

  if (parsedSessionToken?.valid && parsedSessionToken.userId === xpIdentity) {
    sessionId = parsedSessionToken.sessionId;
  }

  let totalsPromise = null;
  const fetchTotals = async () => {
    if (!xpIdentity) return { current: cookieTotal, lifetime: 0, sessionTotal: 0, lastSync: 0 };
    if (!totalsPromise) {
      totalsPromise = getTotals({ userId: xpIdentity, sessionId, now });
    }
    return totalsPromise;
  };

  const respond = async (statusCode, payload, options = {}) => {
    let totalSource = options.totalOverride;
    let totals = options.totals;
    let skipCookie = options.skipCookie;
    if (totals) {
      totalSource = totalSource ?? totals.current;
    }
    if (totalSource === undefined && xpIdentity) {
      totals = await fetchTotals();
      totalSource = totals.current;
    }
    if (totalSource === undefined) totalSource = cookieTotal;
    if (totals && payload.totalLifetime === undefined) payload.totalLifetime = totals.lifetime;
    if (totals && payload.sessionTotal === undefined && totals.sessionTotal !== undefined) {
      payload.sessionTotal = totals.sessionTotal;
    }
    if (totals && payload.lastSync === undefined && totals.lastSync !== undefined) {
      payload.lastSync = totals.lastSync;
    }
    const responseSessionToken = options.sessionToken ?? sessionToken;
    if (responseSessionToken) {
      payload.sessionToken = responseSessionToken;
    }
    // Default: keep cookie tracking unless explicitly disabled.
    if (skipCookie === undefined) skipCookie = false;
    return buildResponse(statusCode, payload, totalSource, {
      debugExtra: options.debugExtra ?? {},
      skipCookie,
    });
  };

  if (!xpIdentity || (!body.statusOnly && !sessionId)) {
    const totals = xpIdentity ? await fetchTotals() : null;
    return respond(400, { error: "missing_fields" }, { totals, skipCookie: !xpIdentity });
  }

  if (body.statusOnly) {
    // SECURITY: Auto-register session when status is requested (session start)
    const sessId = sessionId || crypto.randomUUID();
    sessionId = sessId;
    await registerSession({ userId: xpIdentity, sessionId: sessId });
    if (parsedSessionToken?.valid) {
      touchSession(parsedSessionToken.sessionId).catch(() => {});
    }

    const totals = await fetchTotals();
    klog('xp_statusOnly_debug', {
      xpIdentity,
      userId: supabaseUserId,
      anonId,
      supabaseUserId,
      totals,
    });
    if (supabaseUserId) {
      await persistUserProfile({ userId: supabaseUserId, totalXp: totals.lifetime, now });
    }
    const payload = {
      ok: true,
      awarded: 0,
      granted: 0,
      cap: DAILY_CAP,
      capDelta: DELTA_CAP,
      totalLifetime: totals.lifetime,
      sessionTotal: totals.sessionTotal,
      lastSync: totals.lastSync,
      status: "statusOnly",
      sessionId: sessId,
    };
    return respond(200, payload, { totals, debugExtra: { mode: "statusOnly" } });
  }

  let deltaRaw = Number(body.delta);
  if (!Number.isFinite(deltaRaw)) {
    const scoreDelta = Number(body.scoreDelta);
    const pointsPerPeriod = Number(body.pointsPerPeriod);
    if (Number.isFinite(scoreDelta)) deltaRaw = scoreDelta;
    else if (Number.isFinite(pointsPerPeriod)) deltaRaw = pointsPerPeriod;
  }
  if (!Number.isFinite(deltaRaw) || deltaRaw < 0) {
    const totals = await fetchTotals();
    return respond(422, { error: "invalid_delta" }, { totals });
  }
  const normalizedDelta = Math.floor(deltaRaw);
  if (normalizedDelta < 0) {
    const totals = await fetchTotals();
    return respond(422, { error: "invalid_delta" }, { totals });
  }
  if (normalizedDelta > DELTA_CAP) {
    const totals = await fetchTotals();
    return respond(422, { error: "delta_out_of_range", cap: DELTA_CAP, capDelta: DELTA_CAP }, { totals });
  }

  // SECURITY: Session validation - register session if delta=0 (session start), validate if delta>0
  if (normalizedDelta === 0) {
    // Auto-register session on first request (delta=0 is session initialization)
    await registerSession({ userId: xpIdentity, sessionId });
  } else if (normalizedDelta > 0) {
    // Validate session is registered before accepting XP deltas
    const registered = await isSessionRegistered({ userId: xpIdentity, sessionId });
    if (!registered) {
      // Auto-register on first XP-bearing request for backward compatibility
      // In a future version, this could be enforced by rejecting unregistered sessions
      await registerSession({ userId: xpIdentity, sessionId });
      if (DEBUG_ENABLED) {
        klog("xp_auto_registered_session", { userId: xpIdentity, sessionId: sessionId.substring(0, 8) });
      }
    }
  }

  const tsRaw = Number(body.ts ?? body.timestamp ?? body.windowEnd ?? now);
  if (!Number.isFinite(tsRaw) || tsRaw <= 0) {
    const totals = await fetchTotals();
    return respond(422, { error: "invalid_timestamp" }, { totals });
  }
  if (tsRaw > now + DRIFT_MS) {
    const totals = await fetchTotals();
    return respond(422, { error: "timestamp_in_future", driftMs: DRIFT_MS }, { totals });
  }
  const ts = Math.trunc(tsRaw);

  let metadata = null;
  if (body.metadata !== undefined) {
    if (!body.metadata || typeof body.metadata !== "object" || Array.isArray(body.metadata)) {
      const totals = await fetchTotals();
      return respond(400, { error: "invalid_metadata" }, { totals });
    }
    const cleaned = {};
    for (const [key, value] of Object.entries(body.metadata)) {
      if (key === "userId" || key === "anonId" || key === "sessionId" || key === "delta" || key === "ts") continue;
      cleaned[key] = value;
    }

    const serialized = JSON.stringify(cleaned);
    const bytes = Buffer.byteLength(serialized, "utf8");
    const depthOk = (() => {
      const MAX_DEPTH = 3;
      const stack = [{ value: cleaned, depth: 1 }];
      while (stack.length) {
        const { value, depth } = stack.pop();
        if (!value || typeof value !== "object") continue;
        if (depth > MAX_DEPTH) return false;
        for (const nested of Object.values(value)) {
          if (nested && typeof nested === "object") {
            stack.push({ value: nested, depth: depth + 1 });
          }
        }
      }
      return true;
    })();

    if (METADATA_MAX_BYTES && bytes > METADATA_MAX_BYTES) {
      const totals = await fetchTotals();
      return respond(413, { error: "metadata_too_large", limit: METADATA_MAX_BYTES }, { totals });
    }
    if (!depthOk) {
      const totals = await fetchTotals();
      return respond(413, { error: "metadata_too_large", limit: METADATA_MAX_BYTES, reason: "depth" }, { totals });
    }
    metadata = cleaned;
  }

  const todayKey = keyDaily(xpIdentity, dayKeyNow);
  const totalKeyK = keyTotal(xpIdentity);
  const sessionKeyK = keySession(xpIdentity, sessionId);
  const sessionSyncKeyK = keySessionSync(xpIdentity, sessionId);
  const lockKeyK = keyLock(xpIdentity, sessionId);

  if (REQUIRE_ACTIVITY && normalizedDelta > 0) {
    const events = Number(metadata?.inputEvents ?? 0);
    const visSeconds = Number(metadata?.visibilitySeconds ?? 0);
    if (!Number.isFinite(events) || events < MIN_ACTIVITY_EVENTS || !Number.isFinite(visSeconds) || visSeconds < MIN_ACTIVITY_VIS_S) {
      const totals = await fetchTotals();
      const inactivePayload = {
        ok: true,
        awarded: 0,
        granted: 0,
        cap: DAILY_CAP,
        capDelta: DELTA_CAP,
        reason: "inactive",
        status: "inactive",
      };
      return respond(200, inactivePayload, {
        totals,
        debugExtra: {
          mode: "inactive",
          delta: normalizedDelta,
          ts,
          sessionCap: SESSION_CAP,
          dailyCap: DAILY_CAP,
          events,
          visSeconds,
        },
      });
    }
  }

  klog("award_identity", {
    anonymous: !supabaseUserId,
    supabaseUserId,
    xpIdentity,
  });

  klog('award_attempt', {
    xpIdentity,
    supabaseUserId,
    anonId,
    sessionId,
    hasSessionToken: !!sessionToken,
  });

  const script = `
    local sessionKey = KEYS[1]
    local sessionSyncKey = KEYS[2]
    local dailyKey = KEYS[3]
    local totalKey = KEYS[4]
    local lockKey = KEYS[5]
    local now = tonumber(ARGV[1])
    local delta = tonumber(ARGV[2])
    local dailyCap = tonumber(ARGV[3])
    local sessionCap = tonumber(ARGV[4])
    local ts = tonumber(ARGV[5])
    local lockTtl = tonumber(ARGV[6])
    local sessionTtl = tonumber(ARGV[7])

    local shouldLock = lockTtl and lockTtl > 0
    if shouldLock then
      local locked = redis.call('SET', lockKey, tostring(now), 'PX', lockTtl, 'NX')
      if locked ~= 'OK' then
        local currentDaily = tonumber(redis.call('GET', dailyKey) or '0')
        local sessionTotal = tonumber(redis.call('GET', sessionKey) or '0')
        local lifetime = tonumber(redis.call('GET', totalKey) or '0')
        local lastSync = tonumber(redis.call('GET', sessionSyncKey) or '0')
        local lockedAt = tonumber(redis.call('GET', lockKey) or '0')
        local lockTtlRemaining = tonumber(redis.call('PTTL', lockKey) or -1)
        return {0, currentDaily, sessionTotal, lifetime, lastSync, 6, lockedAt, lockTtlRemaining}
      end
    end

    local function refreshSessionTtl()
      if sessionTtl and sessionTtl > 0 then
        redis.call('PEXPIRE', sessionKey, sessionTtl)
        redis.call('PEXPIRE', sessionSyncKey, sessionTtl)
      end
    end

    local function finish(grant, dailyTotal, sessionTotal, lifetime, sync, status, lockedAt, lockTtlRemaining)
      if shouldLock then
        redis.call('DEL', lockKey)
      end
      return {grant, dailyTotal, sessionTotal, lifetime, sync, status, lockedAt, lockTtlRemaining}
    end

    local sessionTotal = tonumber(redis.call('GET', sessionKey) or '0')
    local lastSync = tonumber(redis.call('GET', sessionSyncKey) or '0')
    local dailyTotal = tonumber(redis.call('GET', dailyKey) or '0')
    local lifetime = tonumber(redis.call('GET', totalKey) or '0')

    if lastSync > 0 and ts <= lastSync then
      return finish(0, dailyTotal, sessionTotal, lifetime, lastSync, 2)
    end

    local remainingDaily = dailyCap - dailyTotal
    if remainingDaily <= 0 then
      return finish(0, dailyTotal, sessionTotal, lifetime, lastSync, 3)
    end

    local remainingSession = sessionCap - sessionTotal
    if remainingSession <= 0 then
      return finish(0, dailyTotal, sessionTotal, lifetime, lastSync, 5)
    end

    local grant = delta
    local status = 0
    if grant > remainingDaily then
      grant = remainingDaily
      status = 1
    end
    if grant > remainingSession then
      grant = remainingSession
      status = 4
    end

    if grant <= 0 then
      if ts > lastSync then
        lastSync = ts
        redis.call('SET', sessionSyncKey, tostring(lastSync))
        refreshSessionTtl()
      end
      return finish(0, dailyTotal, sessionTotal, lifetime, lastSync, status)
    end

    dailyTotal = tonumber(redis.call('INCRBY', dailyKey, grant))
    sessionTotal = tonumber(redis.call('INCRBY', sessionKey, grant))
    lifetime = tonumber(redis.call('INCRBY', totalKey, grant))
    lastSync = ts
    redis.call('SET', sessionSyncKey, tostring(lastSync))
    refreshSessionTtl()
    return finish(grant, dailyTotal, sessionTotal, lifetime, lastSync, status)
  `;

  const effectiveDelta = supabaseUserId
    ? normalizedDelta
    : Math.min(normalizedDelta, cookieRemainingBefore);
  const cookieClamped = !supabaseUserId && effectiveDelta < normalizedDelta;

  klog("award_cookie_delta_adjust", {
    anonId,
    supabaseUserId,
    normalizedDelta,
    cookieRemainingBefore,
    effectiveDelta,
  });

  const runAwardScript = () => store.eval(
    script,
    [sessionKeyK, sessionSyncKeyK, todayKey, totalKeyK, lockKeyK],
    [
      String(now),
      String(effectiveDelta),
      String(DAILY_CAP),
      String(Math.max(0, SESSION_CAP)),
      String(ts),
      String(LOCK_TTL_MS),
      String(SESSION_TTL_MS),
    ]
  );

  let res = await runAwardScript();
  let status = Number(res?.[5]) || 0;
  if (status === 6) {
    await sleep(100 + Math.floor(Math.random() * 150));
    res = await runAwardScript();
    status = Number(res?.[5]) || 0;
  }

  const granted = Math.max(0, Math.floor(Number(res?.[0]) || 0));
  const redisDailyTotalRaw = Number(res?.[1]) || 0;
  const sessionTotal = Number(res?.[2]) || 0;
  const totalLifetime = Number(res?.[3]) || 0;
  const lastSync = Number(res?.[4]) || 0;
  const lockedAt = Number(res?.[6]) || 0;
  const lockTtlRemainingRaw = Number(res?.[7]);
  const lockTtlRemainingMs = Number.isFinite(lockTtlRemainingRaw) ? lockTtlRemainingRaw : null;

  klog('award_result', {
    xpIdentity,
    supabaseUserId,
    anonId,
    status,
    granted,
    totalLifetime,
  });

  const totalTodayRedis = Math.min(DAILY_CAP, Math.max(0, sanitizeTotal(redisDailyTotalRaw)));
  const remaining = Math.max(0, DAILY_CAP - totalTodayRedis);

  const payload = {
    ok: true,
    awarded: granted,
    granted,
    cap: DAILY_CAP,
    capDelta: DELTA_CAP,
    totalLifetime,
    sessionTotal,
    lastSync,
    remaining,
    dayKey: dayKeyNow,
    nextReset,
  };

  const statusReasons = {
    1: "daily_cap_partial",
    2: "stale",
    3: "daily_cap",
    4: "session_cap_partial",
    5: "session_cap",
    6: "locked",
  };

  if (status === 1 || status === 3) {
    payload.capped = true;
  }
  if (status === 4 || status === 5) {
    payload.sessionCapped = true;
  }
  if (status === 2) {
    payload.stale = true;
    payload.awarded = 0;
    payload.granted = 0;
  }
  if (status === 6) {
    payload.locked = true;
    payload.awarded = 0;
    payload.granted = 0;
  }

  const reason = statusReasons[status];
  if (reason) {
    payload.reason = reason;
  } else if (granted < normalizedDelta) {
    payload.reason = normalizedDelta > 0 ? "partial" : undefined;
  }

  if (cookieClamped) {
    payload.capped = true;
    if (!payload.reason || payload.reason === "partial") {
      payload.reason = granted > 0 ? "daily_cap_partial" : "daily_cap";
    }
    if (!payload.status || payload.status === "ok" || payload.status === "partial") {
      payload.status = payload.reason || (granted > 0 ? "daily_cap_partial" : "daily_cap");
    }
  }

  if (DEBUG_ENABLED && granted < normalizedDelta && (status === 1 || status === 3 || cookieClamped)) {
    klog("xp_daily_cap_hit", {
      requested: normalizedDelta,
      granted,
      remaining,
      dayKey: dayKeyNow,
    });
  }

  if (!payload.status) {
    if (status === 0 && normalizedDelta === granted) {
      payload.status = "ok";
    } else if (status === 1 || status === 4 || (status === 0 && granted < normalizedDelta)) {
      payload.status = "partial";
    } else if (reason) {
      payload.status = reason;
    }
  }

  const debugExtra = {
    mode: "award",
    delta: normalizedDelta,
    ts,
    now,
    status,
    requested: normalizedDelta,
    sessionCap: SESSION_CAP,
    dailyCap: DAILY_CAP,
    lastSync,
    remainingBefore: cookieRemainingBefore,
    remainingAfter: remaining,
    redisDailyTotalRaw,
  };
  if (reason) debugExtra.reason = reason;
  if (cookieClamped) debugExtra.cookieClamped = true;

  if (status === 6) {
    const lockAgeMs = lockedAt > 0 ? Math.max(0, now - lockedAt) : null;
    const lockInfo = {
      key: lockKeyK,
      ttlMs: LOCK_TTL_MS,
    };
    if (lockAgeMs !== null) lockInfo.ageMs = lockAgeMs;
    if (lockTtlRemainingMs !== null) lockInfo.remainingMs = lockTtlRemainingMs;
    payload.lock = lockInfo;
    debugExtra.lockKey = lockKeyK;
    debugExtra.lockTtlMs = LOCK_TTL_MS;
    debugExtra.lockAgeMs = lockAgeMs;
    debugExtra.lockTtlRemainingMs = lockTtlRemainingMs;
    if (DEBUG_ENABLED) {
      klog("xp_lock_contention", {
        lockKey: lockKeyK,
        lockAgeMs,
        lockTtlMs: LOCK_TTL_MS,
        lockTtlRemainingMs,
        status,
      });
    }
  }

  if (supabaseUserId) {
    await persistUserProfile({ userId: supabaseUserId, totalXp: totalLifetime, now });
  }

  return respond(200, payload, { totalOverride: redisDailyTotalRaw, debugExtra });
}
