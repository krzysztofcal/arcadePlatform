import { baseHeaders, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { finalizeAvatar } from "./_shared/profile-avatar.mjs";
import { ownerProfile } from "./_shared/user-profile.mjs";

const json = (statusCode, headers, body) => ({ statusCode, headers, body: JSON.stringify(body) });
const profileCors = (origin) => {
  const headers = corsHeaders(origin);
  return headers ? { ...headers, "access-control-allow-methods": "POST, OPTIONS" } : null;
};

function createAvatarFinalizeHandler(deps = {}) {
  const verifyJwt = deps.verifySupabaseJwt || verifySupabaseJwt;
  const finalize = deps.finalizeAvatar || finalizeAvatar;
  return async function handler(event) {
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = profileCors(origin);
    if (!cors) return json(403, baseHeaders(), { error: "forbidden_origin" });
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
    if (event.httpMethod !== "POST") return json(405, cors, { error: "method_not_allowed" });
    const auth = await verifyJwt(extractBearerToken(event.headers));
    if (!auth.valid || !auth.userId) return json(401, cors, { error: "unauthorized" });
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}
    try {
      const profile = await finalize(auth.userId, body?.uploadId, deps);
      return json(200, cors, ownerProfile(profile));
    } catch (error) {
      const publicCodes = new Set(["invalid_upload", "upload_expired", "invalid_avatar_file", "avatar_dimensions_too_large", "storage_unavailable"]);
      const code = publicCodes.has(error?.code) ? error.code : "server_error";
      const status = Number(error?.status) || 500;
      klog("profile_avatar_finalize_failed", { userId: auth.userId, code, status });
      return json(status, cors, { error: code });
    }
  };
}

const handler = createAvatarFinalizeHandler();
export { createAvatarFinalizeHandler, handler };
