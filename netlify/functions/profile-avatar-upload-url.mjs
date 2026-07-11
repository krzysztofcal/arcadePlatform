import { baseHeaders, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { createPendingUpload } from "./_shared/profile-avatar.mjs";

const json = (statusCode, headers, body) => ({ statusCode, headers, body: JSON.stringify(body) });
const profileCors = (origin) => {
  const headers = corsHeaders(origin);
  return headers ? { ...headers, "access-control-allow-methods": "POST, OPTIONS" } : null;
};

function parseBody(raw) {
  try {
    const value = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    const error = new Error("invalid_request");
    error.code = "invalid_request";
    error.status = 400;
    throw error;
  }
}

function createAvatarUploadUrlHandler(deps = {}) {
  const verifyJwt = deps.verifySupabaseJwt || verifySupabaseJwt;
  const createUpload = deps.createPendingUpload || createPendingUpload;
  return async function handler(event) {
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = profileCors(origin);
    if (!cors) return json(403, baseHeaders(), { error: "forbidden_origin" });
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
    if (event.httpMethod !== "POST") return json(405, cors, { error: "method_not_allowed" });
    const auth = await verifyJwt(extractBearerToken(event.headers));
    if (!auth.valid || !auth.userId) return json(401, cors, { error: "unauthorized" });
    try {
      return json(200, cors, await createUpload(auth.userId, parseBody(event.body), deps));
    } catch (error) {
      const publicCodes = new Set(["invalid_request", "unsupported_avatar_type", "avatar_too_large", "storage_unavailable"]);
      const code = publicCodes.has(error?.code) ? error.code : "server_error";
      const status = Number(error?.status) || 500;
      klog("profile_avatar_upload_url_failed", { userId: auth.userId, code, status });
      return json(status, cors, { error: code });
    }
  };
}

const handler = createAvatarUploadUrlHandler();
export { createAvatarUploadUrlHandler, handler };
