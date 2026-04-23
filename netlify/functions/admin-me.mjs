import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { baseHeaders, corsHeaders } from "./_shared/supabase-admin.mjs";

function createAdminMeHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  return async function handler(event) {
    if (env.CHIPS_ENABLED !== "1") {
      return { statusCode: 404, headers: baseHeaders(), body: JSON.stringify({ error: "not_found" }) };
    }

    const origin = event.headers?.origin || event.headers?.Origin;
    const cors = corsHeaders(origin);
    if (!cors) {
      return { statusCode: 403, headers: baseHeaders(), body: JSON.stringify({ error: "forbidden_origin" }) };
    }
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: cors, body: "" };
    }
    if (event.httpMethod !== "GET") {
      return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
    }

    try {
      const admin = await requireAdmin(event, env);
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({ ok: true, isAdmin: true, userId: admin.userId }),
      };
    } catch (error) {
      return adminAuthErrorResponse(error, cors);
    }
  };
}

const handler = createAdminMeHandler();

export {
  createAdminMeHandler,
  handler,
};
