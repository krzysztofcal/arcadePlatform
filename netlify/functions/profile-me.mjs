import { baseHeaders, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { getUserBalance } from "./_shared/chips-ledger.mjs";
import { loadWsAccountPokerProjection, normalizeAccountPokerProjection } from "./_shared/poker-ws-runtime-notify.mjs";
import { ensureUserProfile, ownerProfile, updateUserProfile } from "./_shared/user-profile.mjs";
import { attachPublishedPhotos } from "./_shared/profile-photo-publication.mjs";

// Aggregate durations only (no user or account data), and only for slow requests.
const PROFILE_ME_SLOW_MS = 1000;

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
  const allowed = new Set(["avatarVariant", "expectedRevision", "leaderboardVisible"]);
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
  const attachPhotos = deps.attachPublishedPhotos || attachPublishedPhotos;
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

    // #1309: a GET checks the account lifecycle once, inside ensureUserProfile's own transaction, instead of a
    // second transaction in the JWT check. The check and its 401 answer are unchanged; PATCH keeps both.
    const read = event.httpMethod === "GET";
    const startedAt = Date.now();
    const auth = await verifyJwt(extractBearerToken(event.headers), { allowDeleting: read });
    if (!auth.valid || !auth.userId) return json(401, cors, { error: "unauthorized" });
    const authMs = Date.now() - startedAt;
    const withPoker = read && wantsPokerProjection(event);
    const timing = (profileMs) => {
      const totalMs = Date.now() - startedAt;
      if (totalMs >= PROFILE_ME_SLOW_MS) log("profile_me_timing", { method: event.httpMethod, poker: withPoker, authMs, profileMs, totalMs });
    };

    try {
      let profile;
      try {
        [profile] = await attachPhotos([read
          ? await ensureProfile(auth.userId)
          : await updateProfile(auth.userId, validatePatch(parseBody(event.body)))]);
      } catch (error) {
        if (read && error?.code === "account_not_active") return json(401, cors, { error: "unauthorized" });
        throw error;
      }
      const profileMs = Date.now() - startedAt - authMs;
      if (!withPoker) {
        timing(profileMs);
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

      timing(profileMs);
      return json(200, cors, {
        ...ownerProfile(profile),
        balance: normalizeBalanceSnapshot(balanceResult.value),
        poker
      });
    } catch (error) {
      const status = Number(error?.status) || 500;
      const publicCodes = new Set(["invalid_json", "invalid_request", "invalid_leaderboard_visibility", "profile_field_read_only", "invalid_avatar_choice", "stale_avatar_revision", "terms_required", "avatar_variants_not_active"]);
      const code = publicCodes.has(error?.code) ? error.code : "server_error";
      klog("profile_me_failed", { userId: auth.userId, code, status });
      return json(status, cors, { error: code });
    }
  };
}

const handler = createProfileMeHandler();

export { createProfileMeHandler, handler };
