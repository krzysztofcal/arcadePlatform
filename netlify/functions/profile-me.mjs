import { baseHeaders, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { getUserBalance } from "./_shared/chips-ledger.mjs";
import { loadWsAccountPokerProjection, normalizeAccountPokerProjection } from "./_shared/poker-ws-runtime-notify.mjs";
import { ensureUserProfile, ownerProfile, updateUserProfile } from "./_shared/user-profile.mjs";

function json(statusCode, headers, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function profileCors(origin) {
  const headers = corsHeaders(origin);
  return headers ? { ...headers, "access-control-allow-methods": "GET, PATCH, OPTIONS" } : null;
}

function parseBody(raw) {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_json");
    return value;
  } catch {
    const error = new Error("invalid_json");
    error.code = "invalid_json";
    error.status = 400;
    throw error;
  }
}

function validatePatch(payload) {
  const allowed = new Set(["displayName", "bio", "handle", "leaderboardVisible"]);
  const keys = Object.keys(payload);
  if (keys.length === 0 || keys.some((key) => !allowed.has(key))) {
    const error = new Error("invalid_request");
    error.code = "invalid_request";
    error.status = 400;
    throw error;
  }
  return payload;
}

function wantsPokerProjection(event) {
  if (event?.queryStringParameters?.includePoker === "1") return true;
  if (event?.queryStringParameters?.includePoker != null || !event?.rawQueryString) return false;
  return new URLSearchParams(event.rawQueryString).get("includePoker") === "1";
}

function normalizeBalanceSnapshot(snapshot) {
  const rawBalance = snapshot?.balance;
  const balance = typeof rawBalance === "number"
    ? rawBalance
    : typeof rawBalance === "string" && rawBalance.trim()
      ? Number(rawBalance)
      : Number.NaN;
  if (!Number.isSafeInteger(balance)) {
    const error = new Error("invalid_balance");
    error.code = "invalid_balance";
    throw error;
  }
  return balance;
}

function createProfileMeHandler(deps = {}) {
  const verifyJwt = deps.verifySupabaseJwt || verifySupabaseJwt;
  const ensureProfile = deps.ensureUserProfile || ensureUserProfile;
  const updateProfile = deps.updateUserProfile || updateUserProfile;
  const readBalance = deps.getUserBalance || getUserBalance;
  const log = deps.klog || klog;
  const loadPoker = deps.loadPokerProjection || ((userId) => loadWsAccountPokerProjection({
    userId,
    env: deps.env || process.env,
    fetchImpl: deps.fetchImpl || globalThis.fetch,
    klog: log
  }));
  return async function handler(event) {
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = profileCors(origin);
    if (!cors) return json(403, baseHeaders(), { error: "forbidden_origin" });
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
    if (event.httpMethod !== "GET" && event.httpMethod !== "PATCH") return json(405, cors, { error: "method_not_allowed" });

    const auth = await verifyJwt(extractBearerToken(event.headers));
    if (!auth.valid || !auth.userId) return json(401, cors, { error: "unauthorized" });

    try {
      const profile = event.httpMethod === "GET"
        ? await ensureProfile(auth.userId)
        : await updateProfile(auth.userId, validatePatch(parseBody(event.body)));
      if (event.httpMethod !== "GET" || !wantsPokerProjection(event)) {
        return json(200, cors, ownerProfile(profile));
      }

      const [balanceResult, pokerResult] = await Promise.allSettled([
        readBalance(auth.userId),
        loadPoker(auth.userId)
      ]);
      if (balanceResult.status !== "fulfilled") {
        throw balanceResult.reason;
      }

      let poker = null;
      if (pokerResult.status === "fulfilled" && pokerResult.value !== null && pokerResult.value !== undefined) {
        poker = normalizeAccountPokerProjection({ ok: true, userId: auth.userId, poker: pokerResult.value }, auth.userId);
        if (!poker) {
          log("profile_me_poker_projection_unavailable", { userId: auth.userId, reason: "invalid_projection" });
        }
      } else if (pokerResult.status !== "fulfilled") {
        log("profile_me_poker_projection_unavailable", {
          userId: auth.userId,
          reason: pokerResult.reason?.name === "AbortError" ? "timeout" : "request_failed"
        });
      }

      return json(200, cors, {
        ...ownerProfile(profile),
        balance: normalizeBalanceSnapshot(balanceResult.value),
        poker
      });
    } catch (error) {
      const status = Number(error?.status) || 500;
      const publicCodes = new Set(["invalid_json", "invalid_request", "invalid_handle", "handle_taken", "reserved_handle", "handle_locked", "invalid_display_name", "bio_too_long", "invalid_leaderboard_visibility"]);
      const code = publicCodes.has(error?.code) ? error.code : "server_error";
      klog("profile_me_failed", { userId: auth.userId, code, status });
      return json(status, cors, { error: code });
    }
  };
}

const handler = createProfileMeHandler();

export { createProfileMeHandler, handler };
