import { baseHeaders, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
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

function createProfileMeHandler(deps = {}) {
  const verifyJwt = deps.verifySupabaseJwt || verifySupabaseJwt;
  const ensureProfile = deps.ensureUserProfile || ensureUserProfile;
  const updateProfile = deps.updateUserProfile || updateUserProfile;
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
        : await updateProfile(auth.userId, parseBody(event.body));
      return json(200, cors, ownerProfile(profile));
    } catch (error) {
      const status = Number(error?.status) || 500;
      const publicCodes = new Set(["invalid_json", "invalid_handle", "handle_taken", "reserved_handle", "handle_locked", "invalid_display_name", "bio_too_long"]);
      const code = publicCodes.has(error?.code) ? error.code : "server_error";
      klog("profile_me_failed", { userId: auth.userId, code, status });
      return json(status, cors, { error: code });
    }
  };
}

const handler = createProfileMeHandler();

export { createProfileMeHandler, handler };
