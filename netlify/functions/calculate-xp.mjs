/**
 * Server-Side XP Calculation Endpoint
 *
 * This endpoint calculates XP on the server based on game events,
 * eliminating the need to trust client-calculated XP values.
 *
 * Game events → Server calculates XP → Awards to user
 *
 * Security improvements:
 * - XP calculation happens server-side (no manipulation)
 * - Session state (combo, momentum) tracked in Redis
 * - Activity validation required
 * - All existing caps still enforced
 */

import crypto from "node:crypto";
import { store, atomicRateLimitIncr } from "./_shared/store-upstash.mjs";
import { klog } from "./_shared/supabase-admin.mjs";
import { verifySessionToken, validateServerSession, touchSession } from "./start-session.mjs";
import { nextWarsawResetMs, warsawDayKey } from "./_shared/time-utils.mjs";

// ============================================================================
// Configuration Constants
// ============================================================================

const asNumber = (raw, fallback) => {
  if (raw == null) return fallback;
  const sanitized = typeof raw === "string" ? raw.replace(/_/g, "") : raw;
  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// XP Calculation Constants (mirroring client-side values)
const BASELINE_XP_PER_SECOND = asNumber(process.env.XP_BASELINE_XP_PER_SECOND, 10);
const MAX_XP_PER_SECOND = asNumber(process.env.XP_MAX_XP_PER_SECOND, 24);
const ACTIVITY_EXPONENT = asNumber(process.env.XP_ACTIVITY_EXPONENT, 1.5);
const TICK_MS = asNumber(process.env.XP_TICK_MS, 1000);

// Combo Constants
const COMBO_CAP = 20;
const COMBO_SUSTAIN_MS = 5000;
const COMBO_COOLDOWN_MS = 3000;

// Caps
const DAILY_CAP = Math.max(0, asNumber(process.env.XP_DAILY_CAP, 3000));
const SESSION_CAP = asNumber(process.env.XP_SESSION_CAP, 300);
const DELTA_CAP = asNumber(process.env.XP_DELTA_CAP, 300);

// Activity Requirements
const MIN_ACTIVITY_EVENTS = Math.max(0, asNumber(process.env.XP_MIN_ACTIVITY_EVENTS, 4));
const MIN_ACTIVITY_VIS_S = Math.max(0, asNumber(process.env.XP_MIN_ACTIVITY_VIS_S, 8));
const REQUIRE_ACTIVITY = process.env.XP_REQUIRE_ACTIVITY === "1"; // Require activity only when explicitly enabled

// Session & Security
const SESSION_TTL_SEC = Math.max(0, asNumber(process.env.XP_SESSION_TTL_SEC, 604800));
const SESSION_TTL_MS = SESSION_TTL_SEC > 0 ? SESSION_TTL_SEC * 1000 : 0;
const KEY_NS = process.env.XP_KEY_NS ?? "kcswh:xp:v2";
const DRIFT_MS = Math.max(0, asNumber(process.env.XP_DRIFT_MS, 30_000));
const DEBUG_ENABLED = process.env.XP_DEBUG === "1";
const SESSION_SECRET = process.env.XP_SESSION_SECRET || process.env.XP_DAILY_SECRET || "";
const REQUIRE_SERVER_SESSION = process.env.XP_REQUIRE_SERVER_SESSION === "1";
const SERVER_SESSION_WARN_MODE = process.env.XP_SERVER_SESSION_WARN_MODE === "1";

// Rate Limiting
const RATE_LIMIT_PER_USER_PER_MIN = Math.max(0, asNumber(process.env.XP_RATE_LIMIT_USER_PER_MIN, 30));
const RATE_LIMIT_PER_IP_PER_MIN = Math.max(0, asNumber(process.env.XP_RATE_LIMIT_IP_PER_MIN, 60));
const RATE_LIMIT_ENABLED = process.env.XP_RATE_LIMIT_ENABLED !== "0";

// Supabase JWT verification
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_JWT_SECRET_V2 || "";

// CORS
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

// Game-specific XP rules
const GAME_XP_RULES = {
  // Default rules for unknown games
  default: {
    baseXpPerSecond: BASELINE_XP_PER_SECOND,
    scoreToXpRatio: 0.01,  // 100 score = 1 XP
    maxScoreXpPerWindow: 50,
  },
  // Tetris: line clears are valuable
  tetris: {
    baseXpPerSecond: BASELINE_XP_PER_SECOND,
    scoreToXpRatio: 0.005, // 200 score = 1 XP (tetris scores are high)
    maxScoreXpPerWindow: 100,
    events: {
      line_clear: (lines) => lines * 5,      // 5 XP per line
      tetris: () => 40,                       // 40 XP for tetris (4 lines)
      level_up: (level) => level * 10,        // 10 XP per level
    }
  },
  // 2048: tile merges
  "2048": {
    baseXpPerSecond: BASELINE_XP_PER_SECOND,
    scoreToXpRatio: 0.02,  // 50 score = 1 XP
    maxScoreXpPerWindow: 80,
    events: {
      tile_merge: (value) => Math.floor(Math.log2(value)),  // Higher tiles = more XP
      milestone: (score) => Math.floor(score / 1000) * 5,   // 5 XP per 1000 points
    }
  },
  // Pacman: eating and power-ups
  pacman: {
    baseXpPerSecond: BASELINE_XP_PER_SECOND,
    scoreToXpRatio: 0.01,
    maxScoreXpPerWindow: 60,
    events: {
      ghost_eaten: () => 10,
      power_pellet: () => 5,
      level_complete: (level) => level * 15,
    }
  },
  // T-Rex runner: distance-based
  "t-rex": {
    baseXpPerSecond: BASELINE_XP_PER_SECOND,
    scoreToXpRatio: 0.02,
    maxScoreXpPerWindow: 50,
    events: {
      milestone: (distance) => Math.floor(distance / 100) * 2,
    }
  },
  // Catch Cats: each cat caught = 1 score point
  cats: {
    baseXpPerSecond: BASELINE_XP_PER_SECOND,
    scoreToXpRatio: 1.0,   // 1 cat = 1 XP (score 1:1 with XP)
    maxScoreXpPerWindow: 30, // Cap per window (prevents farming)
    events: {
      cat_caught: () => 1,           // 1 XP per cat
      streak: (count) => count >= 5 ? 5 : 0, // 5 XP bonus for 5+ streak
      level_up: (level) => level * 2,  // 2 XP per level
    }
  },
  // Alias for catch-cats slug variations
  "catch-cats": {
    baseXpPerSecond: BASELINE_XP_PER_SECOND,
    scoreToXpRatio: 1.0,
    maxScoreXpPerWindow: 30,
    events: {
      cat_caught: () => 1,
      streak: (count) => count >= 5 ? 5 : 0,
      level_up: (level) => level * 2,
    }
  },
  "game_cats": {
    baseXpPerSecond: BASELINE_XP_PER_SECOND,
    scoreToXpRatio: 1.0,
    maxScoreXpPerWindow: 30,
    events: {
      cat_caught: () => 1,
      streak: (count) => count >= 5 ? 5 : 0,
      level_up: (level) => level * 2,
    }
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

const safeEquals = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
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
  const match = /^Bearer\s+(.+)$/.exec(headerValue.trim());
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
    return { provided: true, valid: false, userId: null, reason: "no_sub" };
  }

  return { provided: true, valid: true, userId, reason: "ok", payload };
};

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

/**
 * Generate fingerprint from request headers for session validation
 */
function generateFingerprint(headers) {
  if (!headers) return "";
  const ua = headers["user-agent"] || "";
  const lang = headers["accept-language"] || "";
  const enc = headers["accept-encoding"] || "";
  return hash(`${ua}|${lang}|${enc}`).slice(0, 16);
}

const getDailyKey = (ms = Date.now()) => warsawDayKey(ms);

const getNextResetEpoch = (ms = Date.now()) => nextWarsawResetMs(ms);

// Redis Keys
const keyDaily = (u, day = getDailyKey()) => `${KEY_NS}:daily:${u}:${day}`;
const keyTotal = (u) => `${KEY_NS}:total:${u}`;
const keySession = (u, s) => `${KEY_NS}:session:${hash(`${u}|${s}`)}`;
const keySessionSync = (u, s) => `${KEY_NS}:session:last:${hash(`${u}|${s}`)}`;
const keySessionState = (u, s) => `${KEY_NS}:session:state:${hash(`${u}|${s}`)}`;
const keyRateLimitUser = (userId) => `${KEY_NS}:ratelimit:user:${userId}:${Math.floor(Date.now() / 60000)}`;
const keyRateLimitIp = (ip) => `${KEY_NS}:ratelimit:ip:${hash(ip)}:${Math.floor(Date.now() / 60000)}`;

async function getTotals({ userId, sessionId, now }) {
  if (!userId) {
    return { current: 0, lifetime: 0, sessionTotal: 0, lastSync: 0 };
  }

  const dayKeyNow = getDailyKey(now || Date.now());
  const todayKey = keyDaily(userId, dayKeyNow);
  const totalKeyK = keyTotal(userId);
  const sessionKeyK = keySession(userId, sessionId || "");
  const sessionSyncKeyK = keySessionSync(userId, sessionId || "");

  const [dailyRaw, totalRaw, sessionRaw, syncRaw] = await Promise.all([
    store.get(todayKey),
    store.get(totalKeyK),
    store.get(sessionKeyK),
    store.get(sessionSyncKeyK),
  ]);

  const current = Math.max(0, Math.floor(Number(dailyRaw) || 0));
  const lifetime = Math.max(0, Math.floor(Number(totalRaw) || 0));
  const sessionTotal = Math.max(0, Math.floor(Number(sessionRaw) || 0));
  const lastSync = Math.max(0, Math.floor(Number(syncRaw) || 0));

  return { current, lifetime, sessionTotal, lastSync };
}

// ============================================================================
// Combo System (Server-Side)
// ============================================================================

function computeComboStepThreshold(multiplier) {
  const stage = Math.max(1, Math.floor(Number(multiplier) || 1));
  if (stage >= COMBO_CAP) return 1;
  const base = 1 + Math.floor((stage - 1) / 3);
  return Math.max(1, Math.min(5, base));
}

function createComboState() {
  return {
    mode: 'build',
    multiplier: 1,
    points: 0,
    stepThreshold: computeComboStepThreshold(1),
    sustainLeftMs: 0,
    cooldownLeftMs: 0,
    lastUpdateMs: Date.now(),
  };
}

function normalizeCombo(raw) {
  const combo = raw && typeof raw === 'object' ? raw : createComboState();

  if (combo.mode !== 'sustain' && combo.mode !== 'cooldown') {
    combo.mode = 'build';
  }
  combo.multiplier = Math.max(1, Math.min(COMBO_CAP, Math.floor(Number(combo.multiplier) || 1)));
  combo.stepThreshold = computeComboStepThreshold(combo.multiplier);
  combo.points = Math.max(0, Math.min(combo.stepThreshold, Number(combo.points) || 0));
  combo.sustainLeftMs = Math.max(0, Math.min(COMBO_SUSTAIN_MS, Number(combo.sustainLeftMs) || 0));
  combo.cooldownLeftMs = Math.max(0, Math.min(COMBO_COOLDOWN_MS, Number(combo.cooldownLeftMs) || 0));
  combo.lastUpdateMs = Number(combo.lastUpdateMs) || Date.now();

  if (combo.multiplier >= COMBO_CAP) {
    combo.multiplier = COMBO_CAP;
    combo.points = 0;
    if (combo.mode === 'build') {
      combo.mode = combo.sustainLeftMs > 0 ? 'sustain' : 'cooldown';
    }
  }

  if (combo.mode === 'sustain') {
    combo.multiplier = COMBO_CAP;
    if (combo.sustainLeftMs <= 0) {
      combo.mode = 'cooldown';
      combo.cooldownLeftMs = Math.max(combo.cooldownLeftMs, COMBO_COOLDOWN_MS);
      combo.sustainLeftMs = 0;
    }
    combo.points = 0;
  }

  if (combo.mode === 'cooldown') {
    combo.multiplier = 1;
    combo.points = 0;
    combo.sustainLeftMs = 0;
    if (combo.cooldownLeftMs <= 0) {
      combo.mode = 'build';
    }
  }

  if (combo.mode === 'build') {
    combo.sustainLeftMs = 0;
    combo.cooldownLeftMs = 0;
    combo.stepThreshold = computeComboStepThreshold(combo.multiplier);
    combo.points = Math.max(0, Math.min(combo.stepThreshold, combo.points));
  }

  return combo;
}

function advanceCombo(rawCombo, deltaMs, activityRatio, isActive) {
  const combo = normalizeCombo(rawCombo);
  const elapsed = Math.max(0, Number(deltaMs) || 0);
  const ratio = Math.max(0, Math.min(1, Number(activityRatio) || 0));

  if (combo.mode === 'cooldown') {
    if (elapsed > 0) {
      combo.cooldownLeftMs = Math.max(0, combo.cooldownLeftMs - elapsed);
      if (combo.cooldownLeftMs <= 0) {
        combo.mode = 'build';
        combo.multiplier = 1;
        combo.points = 0;
      }
    }
    combo.lastUpdateMs = Date.now();
    return normalizeCombo(combo);
  }

  if (combo.mode === 'sustain') {
    if (elapsed > 0) {
      combo.sustainLeftMs = Math.max(0, combo.sustainLeftMs - elapsed);
      if (combo.sustainLeftMs <= 0) {
        combo.mode = 'cooldown';
        combo.cooldownLeftMs = COMBO_COOLDOWN_MS;
        combo.multiplier = 1;
        combo.points = 0;
      }
    }
    combo.lastUpdateMs = Date.now();
    return normalizeCombo(combo);
  }

  // Build mode
  if (!isActive) {
    combo.points = Math.max(0, combo.points * 0.5);
    combo.lastUpdateMs = Date.now();
    return normalizeCombo(combo);
  }

  if (ratio <= 0) {
    combo.points = 0;
    combo.multiplier = 1;
    combo.lastUpdateMs = Date.now();
    return normalizeCombo(combo);
  }

  const scaledGain = ratio * (elapsed > 0 ? Math.max(1, elapsed / TICK_MS) : 1);
  if (Number.isFinite(scaledGain) && scaledGain > 0) {
    combo.points = Math.max(0, combo.points + scaledGain);
  }

  while (combo.multiplier < COMBO_CAP && combo.points >= combo.stepThreshold) {
    combo.points -= combo.stepThreshold;
    combo.multiplier += 1;
    combo.stepThreshold = computeComboStepThreshold(combo.multiplier);
  }

  if (combo.multiplier >= COMBO_CAP) {
    combo.multiplier = COMBO_CAP;
    combo.mode = 'sustain';
    combo.sustainLeftMs = COMBO_SUSTAIN_MS;
    combo.points = 0;
  }

  combo.lastUpdateMs = Date.now();
  return normalizeCombo(combo);
}

function getComboMultiplier(combo) {
  if (!combo || combo.mode === 'cooldown') return 1;
  // XP bonus: 3% per combo stage above 1, capped at 75%
  const stage = Math.max(1, combo.multiplier);
  const bonus = Math.min(0.75, (stage - 1) * 0.03);
  return 1 + bonus;
}

// ============================================================================
// Server-Side XP Calculation
// ============================================================================

/**
 * Calculate XP based on game events and activity
 *
 * @param {Object} params
 * @param {string} params.gameId - Game identifier
 * @param {number} params.windowMs - Time window in ms
 * @param {number} params.inputEvents - Number of input events
 * @param {number} params.visibilitySeconds - Seconds tab was visible
 * @param {number} params.scoreDelta - Score change in this window
 * @param {Object} params.combo - Current combo state
 * @param {number} params.boostMultiplier - Active boost multiplier
 * @param {Object[]} params.gameEvents - Specific game events
 */
function calculateXP({
  gameId,
  windowMs,
  inputEvents,
  visibilitySeconds,
  scoreDelta = 0,
  combo,
  boostMultiplier = 1,
  gameEvents = [],
}) {
  const rules = GAME_XP_RULES[gameId?.toLowerCase()] || GAME_XP_RULES.default;

  // Calculate activity ratio (0-1)
  const windowSeconds = Math.max(1, windowMs / 1000);
  const expectedEvents = windowSeconds * 2; // ~2 events per second expected
  const activityRatio = Math.min(1, inputEvents / expectedEvents);

  // 1. Base XP from time played with activity
  const baseXp = rules.baseXpPerSecond * windowSeconds * Math.pow(activityRatio, ACTIVITY_EXPONENT);

  // 2. Score-based XP (capped per window)
  const scoreXp = Math.min(
    rules.maxScoreXpPerWindow,
    Math.floor(scoreDelta * rules.scoreToXpRatio)
  );

  // 3. Event-based XP (if game supports specific events)
  let eventXp = 0;
  if (rules.events && gameEvents.length > 0) {
    for (const event of gameEvents) {
      const eventHandler = rules.events[event.type];
      if (eventHandler && typeof eventHandler === 'function') {
        try {
          eventXp += Math.max(0, eventHandler(event.value) || 0);
        } catch (e) {
          // Skip invalid events
        }
      }
    }
  }

  // 4. Combine and apply multipliers
  let totalXp = baseXp + scoreXp + eventXp;

  // Apply combo multiplier
  const comboMultiplier = getComboMultiplier(combo);
  totalXp *= comboMultiplier;

  // Apply boost multiplier
  totalXp *= Math.max(1, boostMultiplier);

  // Cap per-second rate
  const maxForWindow = MAX_XP_PER_SECOND * windowSeconds;
  totalXp = Math.min(totalXp, maxForWindow);

  // Floor to integer
  const finalXp = Math.max(0, Math.floor(totalXp));

  return {
    calculated: finalXp,
    breakdown: {
      baseXp: Math.floor(baseXp),
      scoreXp,
      eventXp,
      activityRatio: Math.round(activityRatio * 100) / 100,
      comboMultiplier: Math.round(comboMultiplier * 100) / 100,
      boostMultiplier,
    }
  };
}

// ============================================================================
// Session State Management
// ============================================================================

async function getSessionState(userId, sessionId) {
  const key = keySessionState(userId, sessionId);
  try {
    const data = await store.get(key);
    if (!data) {
      return {
        combo: createComboState(),
        momentum: 0,
        boostMultiplier: 1,
        boostExpiresAt: 0,
        lastWindowEnd: 0,
      };
    }
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return {
      combo: normalizeCombo(parsed.combo),
      momentum: Number(parsed.momentum) || 0,
      boostMultiplier: Number(parsed.boostMultiplier) || 1,
      boostExpiresAt: Number(parsed.boostExpiresAt) || 0,
      lastWindowEnd: Number(parsed.lastWindowEnd) || 0,
    };
  } catch (err) {
    if (DEBUG_ENABLED) {
      klog("calc_session_state_get_failed", { userId, sessionId, error: err?.message });
    }
    return {
      combo: createComboState(),
      momentum: 0,
      boostMultiplier: 1,
      boostExpiresAt: 0,
      lastWindowEnd: 0,
    };
  }
}

async function saveSessionState(userId, sessionId, state) {
  const key = keySessionState(userId, sessionId);
  const ttlSeconds = SESSION_TTL_SEC > 0 ? SESSION_TTL_SEC : 604800;
  try {
    await store.setex(key, ttlSeconds, JSON.stringify(state));
    return true;
  } catch (err) {
    if (DEBUG_ENABLED) {
      klog("calc_session_state_save_failed", { userId, sessionId, error: err?.message });
    }
    return false;
  }
}

// ============================================================================
// Rate Limiting
// ============================================================================

async function checkRateLimit({ userId, ip }) {
  if (!RATE_LIMIT_ENABLED) return { allowed: true };

  const checks = [];

  // Check userId rate limit (atomic increment + TTL via Lua script)
  if (userId && RATE_LIMIT_PER_USER_PER_MIN > 0) {
    const userKey = keyRateLimitUser(userId);
    checks.push(
      atomicRateLimitIncr(userKey, 60)
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
      atomicRateLimitIncr(ipKey, 60)
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

// ============================================================================
// CORS Handling
// ============================================================================

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

  headers["access-control-allow-origin"] = origin;
  headers["access-control-allow-headers"] = "content-type,authorization,x-api-key";
  headers["access-control-allow-methods"] = "POST,OPTIONS";
  headers["Vary"] = "Origin";

  return headers;
}

function json(statusCode, obj, origin, extraHeaders) {
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
}

// ============================================================================
// Main Handler
// ============================================================================

export async function handler(event) {
  const origin = event.headers?.origin;
  const now = Date.now();

  // CORS validation before any side effects
  const isNetlifyDomain = origin ? /^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(origin) : false;
  if (origin && !isNetlifyDomain && CORS_ALLOW.length > 0 && !CORS_ALLOW.includes(origin)) {
    return {
      statusCode: 403,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      body: JSON.stringify({ error: "forbidden", message: "origin_not_allowed" }),
    };
  }

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

  if (event.httpMethod !== "POST") {
    return json(405, { error: "method_not_allowed" }, origin);
  }

  klog("calc_env_debug", {
    XP_REQUIRE_ACTIVITY: process.env.XP_REQUIRE_ACTIVITY,
    requireActivity: REQUIRE_ACTIVITY,
  });

  // Parse body
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
    : (typeof body.userId === "string" ? body.userId : null);
  const anonId = bodyAnonIdRaw ? bodyAnonIdRaw.trim() : null;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : null;

  const jwtToken = extractBearerToken(event.headers);
  const authContext = verifySupabaseJwt(jwtToken);
  const supabaseUserId = authContext.valid ? authContext.userId : null;
  const identityId = supabaseUserId || anonId || null;

  klog("calc_identity_debug", {
    anonId,
    supabaseUserId,
    identityId,
  });

  if (!identityId || !sessionId) {
    return json(400, { error: "missing_fields", message: "identity and sessionId required" }, origin);
  }

  const userId = identityId;

  // Rate limiting
  const clientIp = event.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()
    || event.headers?.["x-real-ip"]
    || "unknown";

  const rateLimitResult = await checkRateLimit({ userId, ip: clientIp });
  if (!rateLimitResult.allowed) {
    return json(429, {
      error: "rate_limit_exceeded",
      message: `Too many requests from ${rateLimitResult.type}`,
      retryAfter: 60,
    }, origin, { "Retry-After": "60" });
  }

  // SECURITY: Server-side session token validation
  const sessionToken = body.sessionToken || event.headers?.["x-session-token"];
  if (REQUIRE_SERVER_SESSION || SERVER_SESSION_WARN_MODE) {
    const fingerprint = generateFingerprint(event.headers);
    let sessionValid = false;
    let sessionError = null;

    if (!sessionToken) {
      sessionError = "missing_session_token";
    } else if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
      // If no secret configured or too short, skip validation but warn
      klog("calc_session_secret_missing_or_short", {});
      sessionValid = true;
    } else {
      // Verify HMAC signature on token
      const tokenResult = verifySessionToken(sessionToken, SESSION_SECRET);
      if (!tokenResult.valid) {
        sessionError = `token_${tokenResult.reason}`;
      } else if (tokenResult.userId !== userId) {
        sessionError = "token_user_mismatch";
      } else if (tokenResult.fingerprint !== fingerprint) {
        sessionError = "token_fingerprint_mismatch";
      } else {
        // Verify session exists in Redis and matches
          const serverValidation = await validateServerSession({
            sessionId: tokenResult.sessionId,
            userId,
            fingerprint,
          });
        if (!serverValidation.valid) {
          sessionError = `session_${serverValidation.reason}`;
          if (serverValidation.suspicious) {
            klog("calc_session_validation_suspicious", {
              userId,
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
      if (REQUIRE_SERVER_SESSION) {
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
      } else if (SERVER_SESSION_WARN_MODE) {
        // Warn mode: log but don't block
        klog("calc_session_validation_warn_mode_failed", {
          userId,
          sessionError,
          hasToken: !!sessionToken,
          ip: clientIp,
        });
      }
    }
  }

  // Extract game event data
  const gameId = typeof body.gameId === "string" ? body.gameId.trim() : "default";
  const windowStart = Number(body.windowStart) || 0;
  const windowEnd = Number(body.windowEnd) || now;
  const windowMs = Math.max(0, Math.min(30000, windowEnd - windowStart)); // Cap at 30s
  const inputEvents = Math.max(0, Math.floor(Number(body.inputEvents) || 0));
  const visibilitySeconds = Math.max(0, Number(body.visibilitySeconds) || 0);
  const scoreDelta = Math.max(0, Math.floor(Number(body.scoreDelta) || 0));
  const gameEvents = Array.isArray(body.gameEvents) ? body.gameEvents.slice(0, 50) : []; // Limit events
  // SECURITY: Client-reported boost is parsed but NOT trusted for XP calculation
  // This is kept for logging/debugging purposes only
  const clientBoost = Math.max(1, Math.min(5, Number(body.boostMultiplier) || 1));

  // Timestamp validation
  if (windowEnd > now + DRIFT_MS) {
    return json(422, { error: "timestamp_in_future", driftMs: DRIFT_MS }, origin);
  }

  // Activity validation
  if (REQUIRE_ACTIVITY) {
    if (inputEvents < MIN_ACTIVITY_EVENTS || visibilitySeconds < MIN_ACTIVITY_VIS_S) {
      return json(200, {
        ok: true,
        awarded: 0,
        calculated: 0,
        reason: "inactive",
        message: `Requires at least ${MIN_ACTIVITY_EVENTS} input events and ${MIN_ACTIVITY_VIS_S}s visibility`,
      }, origin);
    }
  }

  klog("calc_award_attempt", {
    identityId: userId,
    supabaseUserId,
    anonId,
    gameId: body.gameId || null,
    scoreDelta: body.scoreDelta ?? body.delta ?? null,
    hasSessionToken: !!(body.sessionToken || event.headers?.["x-session-token"]),
  });

  // Get or create session state
  const sessionState = await getSessionState(userId, sessionId);

  // Check for stale/duplicate requests
  if (sessionState.lastWindowEnd > 0 && windowEnd <= sessionState.lastWindowEnd) {
    return json(200, {
      ok: true,
      awarded: 0,
      calculated: 0,
      reason: "stale",
      message: "Window already processed",
    }, origin);
  }

  // Calculate time since last update for combo advancement
  const timeSinceLastUpdate = sessionState.combo.lastUpdateMs
    ? Math.max(0, now - sessionState.combo.lastUpdateMs)
    : 0;

  // Determine if player is active
  const activityRatio = windowMs > 0
    ? Math.min(1, inputEvents / (windowMs / 500))
    : 0;
  const isActive = activityRatio > 0.2;

  // Advance combo based on time elapsed and activity
  const updatedCombo = advanceCombo(
    sessionState.combo,
    timeSinceLastUpdate,
    activityRatio,
    isActive
  );

  // Check if boost is still active
  const activeBoost = sessionState.boostExpiresAt > now
    ? sessionState.boostMultiplier
    : 1;

  // SECURITY: Only use server-tracked boost, do NOT trust client-reported boost
  // Previously this used Math.max(activeBoost, clientBoost) which let clients
  // claim any boost multiplier up to 5x even without server-side validation
  const effectiveBoost = activeBoost;

  // Calculate XP server-side
  const calculation = calculateXP({
    gameId,
    windowMs,
    inputEvents,
    visibilitySeconds,
    scoreDelta,
    combo: updatedCombo,
    boostMultiplier: effectiveBoost,
    gameEvents,
  });

  // Cap the calculated XP
  const cappedDelta = Math.min(calculation.calculated, DELTA_CAP);

  // Get daily key and next reset
  const dayKeyNow = getDailyKey(now);
  const nextReset = getNextResetEpoch(now);

  // Redis keys
  const todayKey = keyDaily(userId, dayKeyNow);
  const totalKeyK = keyTotal(userId);
  const sessionKeyK = keySession(userId, sessionId);
  const sessionSyncKeyK = keySessionSync(userId, sessionId);

  // Award XP atomically with caps
  const script = `
    local sessionKey = KEYS[1]
    local sessionSyncKey = KEYS[2]
    local dailyKey = KEYS[3]
    local totalKey = KEYS[4]
    local now = tonumber(ARGV[1])
    local delta = tonumber(ARGV[2])
    local dailyCap = tonumber(ARGV[3])
    local sessionCap = tonumber(ARGV[4])
    local ts = tonumber(ARGV[5])
    local sessionTtl = tonumber(ARGV[6])

    local function refreshSessionTtl()
      if sessionTtl and sessionTtl > 0 then
        redis.call('PEXPIRE', sessionKey, sessionTtl)
        redis.call('PEXPIRE', sessionSyncKey, sessionTtl)
      end
    end

    local sessionTotal = tonumber(redis.call('GET', sessionKey) or '0')
    local lastSync = tonumber(redis.call('GET', sessionSyncKey) or '0')
    local dailyTotal = tonumber(redis.call('GET', dailyKey) or '0')
    local lifetime = tonumber(redis.call('GET', totalKey) or '0')

    if lastSync > 0 and ts <= lastSync then
      return {0, dailyTotal, sessionTotal, lifetime, lastSync, 2}
    end

    local remainingDaily = dailyCap - dailyTotal
    if remainingDaily <= 0 then
      return {0, dailyTotal, sessionTotal, lifetime, lastSync, 3}
    end

    local remainingSession = sessionCap - sessionTotal
    if remainingSession <= 0 then
      return {0, dailyTotal, sessionTotal, lifetime, lastSync, 5}
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
      return {0, dailyTotal, sessionTotal, lifetime, lastSync, status}
    end

    dailyTotal = tonumber(redis.call('INCRBY', dailyKey, grant))
    sessionTotal = tonumber(redis.call('INCRBY', sessionKey, grant))
    lifetime = tonumber(redis.call('INCRBY', totalKey, grant))
    lastSync = ts
    redis.call('SET', sessionSyncKey, tostring(lastSync))
    refreshSessionTtl()
    return {grant, dailyTotal, sessionTotal, lifetime, lastSync, status}
  `;

  let res;
  try {
    if (cappedDelta > 0) {
      klog("calc_award_redis_eval_start", {
        userId,
        sessionId,
        dayKeyNow,
        keys: { todayKey, totalKeyK, sessionKeyK, sessionSyncKeyK },
        cappedDelta,
      });
    }

    res = await store.eval(
      script,
      [sessionKeyK, sessionSyncKeyK, todayKey, totalKeyK],
      [
        String(now),
        String(cappedDelta),
        String(DAILY_CAP),
        String(Math.max(0, SESSION_CAP)),
        String(windowEnd),
        String(SESSION_TTL_MS),
      ]
    );
  } catch (err) {
    klog("calc_redis_eval_failed", {
      userId,
      sessionId,
      error: err?.message,
    });
    throw err;
  }

  const granted = Math.max(0, Math.floor(Number(res?.[0]) || 0));
  const redisDailyTotal = Number(res?.[1]) || 0;
  const sessionTotal = Number(res?.[2]) || 0;
  const totalLifetime = Number(res?.[3]) || 0;
  const lastSync = Number(res?.[4]) || 0;
  const status = Number(res?.[5]) || 0;

  const remaining = Math.max(0, DAILY_CAP - redisDailyTotal);

  if (granted > 0) {
    klog("calc_award_debug_totals", {
      identityId: userId,
      supabaseUserId,
      anonId,
      sessionId,
      awarded: granted,
      redisDailyTotal,
      totalLifetime,
      keys: { todayKey, totalKeyK, sessionKeyK, sessionSyncKeyK },
    });

    klog("calc_award_result", {
      identityId: userId,
      supabaseUserId,
      anonId,
      granted,
      totalLifetime,
      totalToday: redisDailyTotal,
      status,
      raw: res,
    });
  }

  // Update session state
  sessionState.combo = updatedCombo;
  sessionState.lastWindowEnd = windowEnd;
  await saveSessionState(userId, sessionId, sessionState);

  // Build response
  const payload = {
    ok: true,
    awarded: granted,
    calculated: calculation.calculated,
    capped: cappedDelta < calculation.calculated,
    cap: DAILY_CAP,
    capDelta: DELTA_CAP,
    totalToday: Math.min(DAILY_CAP, redisDailyTotal),
    totalLifetime,
    sessionTotal,
    remaining,
    dayKey: dayKeyNow,
    nextReset,
    combo: {
      multiplier: updatedCombo.multiplier,
      mode: updatedCombo.mode,
      progress: updatedCombo.points / Math.max(1, updatedCombo.stepThreshold),
    },
  };

  // Add status reasons
  const statusReasons = {
    1: "daily_cap_partial",
    2: "stale",
    3: "daily_cap",
    4: "session_cap_partial",
    5: "session_cap",
  };

  if (status > 0) {
    payload.reason = statusReasons[status];
    if (status === 2) payload.stale = true;
    if (status === 1 || status === 3) payload.dailyCapped = true;
    if (status === 4 || status === 5) payload.sessionCapped = true;
  }

  // Debug info
  if (DEBUG_ENABLED) {
    payload.debug = {
      calculation: calculation.breakdown,
      windowMs,
      inputEvents,
      visibilitySeconds,
      scoreDelta,
      gameEventsCount: gameEvents.length,
      effectiveBoost,
      status,
    };
  }

  return json(200, payload, origin);
}

// ============================================================================
// Boost Management (called from other endpoints)
// ============================================================================

export async function applyBoost(userId, sessionId, multiplier, durationMs) {
  if (!userId || !sessionId) return false;

  const sessionState = await getSessionState(userId, sessionId);
  sessionState.boostMultiplier = Math.max(1, Math.min(5, multiplier));
  sessionState.boostExpiresAt = Date.now() + Math.max(0, durationMs);

  return saveSessionState(userId, sessionId, sessionState);
}

// Export game rules for reference
export { GAME_XP_RULES };
