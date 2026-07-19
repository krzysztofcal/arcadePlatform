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
import { extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { validateServerSession, touchSession } from "./start-session.mjs";
import { nextWarsawResetMs, warsawDayKey } from "./_shared/time-utils.mjs";
import { getXpPolicy, isValidXpAnonId, migrateAnonXpToUser, resolveXpIdentity } from "./_shared/xp-identity.mjs";
import { normalizeXpAwardInput, XP_AWARD_MAX_BODY_BYTES } from "./_shared/xp-award-input.mjs";
import { createXpLedgerKeys, executeAtomicXpAward, readXpTotals } from "./_shared/xp-ledger.mjs";
import { createXpLeaderboardKeys, getXpLeaderboardPeriods } from "./_shared/xp-leaderboard.mjs";
import { persistXpProfileSnapshot, readCanonicalXpStatus } from "./_shared/xp-status.mjs";
import { buildApiCorsPolicy, buildCorsHeaders } from "./_shared/api-cors.mjs";
import {
  createXpSessionFingerprint,
  resolveXpSessionSecret,
  verifySignedXpSessionToken,
} from "./_shared/xp-server-session.mjs";

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
const XP_POLICY = getXpPolicy();
const DAILY_CAP = XP_POLICY.dailyCap;
const SESSION_CAP = XP_POLICY.sessionCap;
const DELTA_CAP = XP_POLICY.deltaCap;

// Activity Requirements
const MIN_ACTIVITY_EVENTS = Math.max(0, asNumber(process.env.XP_MIN_ACTIVITY_EVENTS, 4));
const MIN_ACTIVITY_VIS_S = Math.max(0, asNumber(process.env.XP_MIN_ACTIVITY_VIS_S, 8));
const REQUIRE_ACTIVITY = process.env.XP_REQUIRE_ACTIVITY === "1"; // Require activity only when explicitly enabled

// Session & Security
const SESSION_TTL_SEC = XP_POLICY.sessionTtlSec;
const SESSION_TTL_MS = XP_POLICY.sessionTtlMs;
const KEY_NS = process.env.XP_KEY_NS ?? "kcswh:xp:v2";
const DRIFT_MS = Math.max(0, asNumber(process.env.XP_DRIFT_MS, 30_000));
const DEBUG_ENABLED = process.env.XP_DEBUG === "1";
const SESSION_CONFIG = resolveXpSessionSecret(process.env);
const REQUIRE_SERVER_SESSION = process.env.XP_REQUIRE_SERVER_SESSION === "1";
const SERVER_SESSION_WARN_MODE = process.env.XP_SERVER_SESSION_WARN_MODE === "1";

// Rate Limiting
const RATE_LIMIT_PER_USER_PER_MIN = Math.max(0, asNumber(process.env.XP_RATE_LIMIT_USER_PER_MIN, 30));
const RATE_LIMIT_PER_IP_PER_MIN = Math.max(0, asNumber(process.env.XP_RATE_LIMIT_IP_PER_MIN, 60));
const RATE_LIMIT_ENABLED = process.env.XP_RATE_LIMIT_ENABLED !== "0";

async function persistUserProfile({ userId, totalXp, now }) {
  return persistXpProfileSnapshot({ userId, totalXp, now, logKind: "calc_save_user_profile_failed" });
}

const API_CORS_POLICY = buildApiCorsPolicy();
if (API_CORS_POLICY.invalidConfiguredOriginCount > 0) {
  klog("api_cors_config_invalid", { context: API_CORS_POLICY.buildContext, invalidOriginCount: API_CORS_POLICY.invalidConfiguredOriginCount });
}

const BLOCK_STACKER_EVENT_ALIASES = Object.freeze({
  tetris: "four_line_clear",
  quad_clear: "four_line_clear",
});

const normalizeGameEventType = (type) => {
  const normalized = typeof type === "string" ? type.trim().toLowerCase() : "";
  return BLOCK_STACKER_EVENT_ALIASES[normalized] || normalized;
};

const BLOCK_STACKER_XP_RULES = {
  baseXpPerSecond: BASELINE_XP_PER_SECOND,
  scoreToXpRatio: 0.005, // 200 score = 1 XP (Block Stacker scores are high)
  maxScoreXpPerWindow: 100,
  events: {
    line_clear: (lines) => lines * 5,           // 5 XP per cleared line
    four_line_clear: () => 40,                  // 40 XP for clearing 4 lines at once
    level_up: (level) => level * 10,            // 10 XP per level
  }
};

// Game-specific XP rules
const DEFAULT_XP_RULES = {
  baseXpPerSecond: BASELINE_XP_PER_SECOND,
  scoreToXpRatio: 0.01,
  maxScoreXpPerWindow: 50,
};

const GAME_XP_RULES = {
  // Block Stacker keeps the legacy tetris gameId for compatibility.
  tetris: BLOCK_STACKER_XP_RULES,
  "block-stacker": BLOCK_STACKER_XP_RULES,
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

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

const publicSessionReason = (reason) => {
  if (reason === "missing_session_token") return "missing";
  if (reason === "session_not_found") return "expired";
  if (reason === "token_user_mismatch" || reason === "token_fingerprint_mismatch"
    || reason === "user_mismatch" || reason === "fingerprint_mismatch") return "mismatch";
  return "invalid";
};

async function validateXpAwardSession({ sessionToken, userId, headers }) {
  if (!SESSION_CONFIG.valid) return { kind: "misconfigured", reason: SESSION_CONFIG.reason };
  if (!sessionToken) return { kind: "invalid", reason: "missing_session_token" };

  const fingerprint = createXpSessionFingerprint(headers);
  const tokenResult = verifySignedXpSessionToken(sessionToken, SESSION_CONFIG.secret);
  if (!tokenResult.valid) return { kind: "invalid", reason: `token_${tokenResult.reason}` };
  if (tokenResult.userId !== userId) return { kind: "invalid", reason: "token_user_mismatch" };
  if (tokenResult.fingerprint !== fingerprint) return { kind: "invalid", reason: "token_fingerprint_mismatch" };

  const serverValidation = await validateServerSession({
    sessionId: tokenResult.sessionId,
    userId,
    fingerprint,
  });
  if (serverValidation.unavailable === true) return { kind: "unavailable", reason: "session_store_unavailable" };
  if (!serverValidation.valid) return { kind: "invalid", reason: serverValidation.reason || "session_invalid" };
  return { kind: "valid", serverSessionId: tokenResult.sessionId };
}

const getDailyKey = (ms = Date.now()) => warsawDayKey(ms);

const getNextResetEpoch = (ms = Date.now()) => nextWarsawResetMs(ms);

// Redis Keys
const XP_LEDGER_KEYS = createXpLedgerKeys({ namespace: KEY_NS });
const XP_LEADERBOARD_KEYS = createXpLeaderboardKeys({ namespace: KEY_NS });
const keyDaily = (u, day = getDailyKey()) => XP_LEDGER_KEYS.daily(u, day);
const keyTotal = XP_LEDGER_KEYS.total;
const keySession = XP_LEDGER_KEYS.session;
const keySessionSync = XP_LEDGER_KEYS.sessionSync;
const keySessionState = XP_LEDGER_KEYS.sessionState;
const keyRateLimitUser = (userId) => `${KEY_NS}:ratelimit:user:${userId}:${Math.floor(Date.now() / 60000)}`;
const keyRateLimitIp = (ip) => `${KEY_NS}:ratelimit:ip:${hash(ip)}:${Math.floor(Date.now() / 60000)}`;

async function getTotals({ userId, sessionId, now }) {
  return readXpTotals({ store, keys: XP_LEDGER_KEYS, userId, sessionId, dayKey: getDailyKey(now || Date.now()) });
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
  const rules = GAME_XP_RULES[gameId] || DEFAULT_XP_RULES;

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
      const eventHandler = rules.events[normalizeGameEventType(event.type)];
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
      klog("calc_session_state_get_failed", { error: err?.message });
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
      klog("calc_session_state_save_failed", { error: err?.message });
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
          klog("xp_rate_limit_atomic_failed", { keyType: "user", error: err?.message });
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
  return buildCorsHeaders({ origin, policy: API_CORS_POLICY, methods: "POST,OPTIONS", allowedHeaders: "content-type,authorization,x-api-key" });
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
  if (origin && !corsHeaders(origin)) {
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

  if (Buffer.byteLength(event.body || "", "utf8") > XP_AWARD_MAX_BODY_BYTES) {
    return json(413, { error: "payload_too_large" }, origin);
  }

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
  const operation = body.operation === "status" || body.statusOnly === true ? "status" : (body.operation || "award");
  if (operation !== "award" && operation !== "status") {
    return json(400, { error: "invalid_operation" }, origin);
  }
  const jwtToken = extractBearerToken(event.headers);
  const authContext = await verifySupabaseJwt(jwtToken);
  if (jwtToken && !authContext.valid) {
    return json(401, { error: "unauthorized", message: authContext.reason || "invalid_token" }, origin);
  }
  if (anonId && !isValidXpAnonId(anonId)) {
    return json(400, { error: "invalid_identity" }, origin);
  }
  const { supabaseUserId, identityId, anonId: resolvedAnonId } = resolveXpIdentity({ anonId, authContext });

  if (!identityId) {
    return json(400, { error: "missing_fields", message: "identity required" }, origin);
  }

  const userId = identityId;

  const convertAnonymousXp = async () => {
    if (!supabaseUserId || !resolvedAnonId) return null;
    try {
      const result = await migrateAnonXpToUser({
        store,
        namespace: KEY_NS,
        anonId: resolvedAnonId,
        userId: supabaseUserId,
        conversionCap: XP_POLICY.anonConversionCap,
        leaderboardAllTimeKey: XP_LEADERBOARD_KEYS.allTime(),
        leaderboardHiddenKey: XP_LEADERBOARD_KEYS.hidden(supabaseUserId),
      });
      if (result.converted > 0) {
        await persistUserProfile({ userId: supabaseUserId, totalXp: result.userTotal, now });
      }
      return result;
    } catch (err) {
      klog("calc_anon_migration_failed", { error: err?.message });
      return null;
    }
  };

  if (operation === "status") {
    const conversion = await convertAnonymousXp();
    const dayKey = getDailyKey(now);
    try {
      const result = await readCanonicalXpStatus({
        readTotals: () => getTotals({ userId, sessionId, now }),
        dailyCap: DAILY_CAP,
        deltaCap: DELTA_CAP,
        sessionId,
        dayKey,
        nextReset: getNextResetEpoch(now),
        supabaseUserId,
        persistProfile: ({ userId: profileUserId, totalXp }) => persistUserProfile({ userId: profileUserId, totalXp, now }),
      });
      if (conversion?.converted > 0) result.payload.conversion = { converted: conversion.converted };
      return json(200, result.payload, origin);
    } catch (err) {
      klog("calc_status_read_failed", { error: err?.message });
      return json(500, { error: "server_error" }, origin);
    }
  }

  if (!sessionId) {
    return json(400, { error: "missing_fields", message: "sessionId required" }, origin);
  }

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
  let validatedServerSessionId = null;
  if (REQUIRE_SERVER_SESSION || SERVER_SESSION_WARN_MODE) {
    const validation = await validateXpAwardSession({ sessionToken, userId, headers: event.headers });
    if (validation.kind === "misconfigured") {
      klog("calc_session_config_invalid", { outcome: "misconfigured", reason: validation.reason });
      return json(500, { error: "server_config" }, origin);
    }
    if (validation.kind === "unavailable") {
      klog("calc_session_validation_unavailable", {
        outcome: "unavailable",
        identityType: supabaseUserId ? "authenticated" : "anonymous",
        hasToken: !!sessionToken,
      });
      return json(503, { error: "session_unavailable", requiresNewSession: false }, origin, { "Retry-After": "5" });
    }
    if (validation.kind === "invalid") {
      if (REQUIRE_SERVER_SESSION) {
        klog("calc_session_validation_rejected", {
          outcome: "invalid",
          reason: validation.reason,
          identityType: supabaseUserId ? "authenticated" : "anonymous",
          hasToken: !!sessionToken,
        });
        return json(401, {
          error: "invalid_session",
          reason: publicSessionReason(validation.reason),
          requiresNewSession: true,
        }, origin);
      }
      klog("calc_session_validation_warn_mode_failed", {
        outcome: "warn",
        reason: validation.reason,
        hasToken: !!sessionToken,
        identityType: supabaseUserId ? "authenticated" : "anonymous",
      });
    } else if (validation.kind === "valid") {
      validatedServerSessionId = validation.serverSessionId;
    }
  }

  const normalizedInput = normalizeXpAwardInput(body);
  if (!normalizedInput.ok) {
    klog("calc_award_payload_rejected", { error: normalizedInput.error, field: normalizedInput.field });
    return json(422, {
      error: normalizedInput.error,
      ...(normalizedInput.field ? { field: normalizedInput.field } : {}),
    }, origin);
  }

  if (validatedServerSessionId) touchSession(validatedServerSessionId).catch(() => {});
  const conversion = await convertAnonymousXp();

  const {
    gameId,
    windowStart,
    windowEnd,
    windowMs,
    inputEvents,
    visibilitySeconds,
    scoreDelta,
    gameEvents,
  } = normalizedInput.value;
  const clientBoost = Math.max(1, Math.min(5, Number(body.boostMultiplier) || 1)); // Diagnostic only; not trusted for awards

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
  const leaderboardPeriods = getXpLeaderboardPeriods(now);

  // Redis keys
  const todayKey = keyDaily(userId, dayKeyNow);
  const totalKeyK = keyTotal(userId);
  const sessionKeyK = keySession(userId, sessionId);
  const sessionSyncKeyK = keySessionSync(userId, sessionId);
  const lockKeyK = XP_LEDGER_KEYS.lock(userId, sessionId);
  const leaderboardAllTimeKey = XP_LEADERBOARD_KEYS.allTime();
  const leaderboardDayKey = XP_LEADERBOARD_KEYS.day(leaderboardPeriods.dayKey);
  const leaderboardWeekKey = XP_LEADERBOARD_KEYS.week(leaderboardPeriods.weekKey);

  // Award XP atomically with caps
  const awardResult = await executeAtomicXpAward({
    store,
    keys: [
      sessionKeyK,
      sessionSyncKeyK,
      todayKey,
      totalKeyK,
      lockKeyK,
      leaderboardAllTimeKey,
      leaderboardDayKey,
      leaderboardWeekKey,
      XP_LEADERBOARD_KEYS.hidden(supabaseUserId || userId),
    ],
    args: [
      now,
      cappedDelta,
      DAILY_CAP,
      Math.max(0, SESSION_CAP),
      windowEnd,
      0,
      SESSION_TTL_MS,
      supabaseUserId || "",
      leaderboardPeriods.dayExpiresAtSec,
      leaderboardPeriods.weekExpiresAtSec,
    ],
    onEvalError: (err) => klog("calc_redis_eval_failed", { error: err?.message }),
  });
  const granted = awardResult.granted;
  const redisDailyTotal = awardResult.dailyTotal;
  const sessionTotal = awardResult.sessionTotal;
  const totalLifetime = awardResult.lifetime;
  const lastSync = awardResult.lastSync;
  const status = awardResult.status;

  const remaining = Math.max(0, DAILY_CAP - redisDailyTotal);

  if (supabaseUserId) {
    await persistUserProfile({ userId: supabaseUserId, totalXp: totalLifetime, now });
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
    sessionCapped: SESSION_CAP > 0 && sessionTotal >= SESSION_CAP,
    remaining,
    dayKey: dayKeyNow,
    nextReset,
    conversion: conversion?.converted > 0 ? { converted: conversion.converted } : undefined,
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
      clientBoost,
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
