import { baseHeaders, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { removeAvatar } from "./_shared/profile-avatar.mjs";
import { ownerProfile } from "./_shared/user-profile.mjs";

const json = (statusCode, headers, body) => ({ statusCode, headers, body: JSON.stringify(body) });
const profileCors = (origin) => {
  const headers = corsHeaders(origin);
  return headers ? { ...headers, "access-control-allow-methods": "DELETE, OPTIONS" } : null;
};

function createAvatarRemoveHandler(deps = {}) {
  const verifyJwt = deps.verifySupabaseJwt || verifySupabaseJwt;
  const remove = deps.removeAvatar || removeAvatar;
  return async function handler(event) {
    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = profileCors(origin);
    if (!cors) return json(403, baseHeaders(), { error: "forbidden_origin" });
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
    if (event.httpMethod !== "DELETE") return json(405, cors, { error: "method_not_allowed" });
    const auth = await verifyJwt(extractBearerToken(event.headers));
    if (!auth.valid || !auth.userId) return json(401, cors, { error: "unauthorized" });
    try {
      return json(200, cors, ownerProfile(await remove(auth.userId, deps)));
    } catch (error) {
      klog("profile_avatar_remove_failed", { userId: auth.userId, code: error?.code || "server_error" });
      return json(Number(error?.status) || 500, cors, { error: "server_error" });
    }
  };
}

const handler = createAvatarRemoveHandler();
export { createAvatarRemoveHandler, handler };
