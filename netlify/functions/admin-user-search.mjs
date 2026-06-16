import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { baseHeaders, corsHeaders, executeSql } from "./_shared/supabase-admin.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function badRequest(code, message) {
  const error = new Error(message || code);
  error.status = 400;
  error.code = code;
  return error;
}

function normalizeQuery(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    throw badRequest("missing_query", "Search query is required");
  }
  if (!UUID_RE.test(value) && value.length < 2) {
    throw badRequest("query_too_short", "Search query is too short");
  }
  return value;
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function normalizeLimit(raw) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return 10;
  return Math.min(Math.max(parsed, 1), 25);
}

async function searchUsers(query, limit = 10) {
  const normalizedQuery = normalizeQuery(query);
  const userId = UUID_RE.test(normalizedQuery) ? normalizedQuery : null;
  const emailNeedle = userId ? null : `%${escapeLike(normalizedQuery)}%`;
  const exactEmail = normalizedQuery.toLowerCase();
  const rows = await executeSql(
    `
select
  u.id::text as user_id,
  u.email,
  coalesce(
    nullif(u.raw_user_meta_data->>'full_name', ''),
    nullif(u.raw_user_meta_data->>'name', ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    u.id::text
  ) as display_name,
  u.created_at,
  u.last_sign_in_at
from auth.users u
where (
  ($1::uuid is not null and u.id = $1::uuid)
  or ($2::text is not null and u.email ilike $2 escape '\\')
)
order by
  case when $1::uuid is not null and u.id = $1::uuid then 0 else 1 end,
  case when $3::text is not null and lower(coalesce(u.email, '')) = $3 then 0 else 1 end,
  u.created_at desc
limit $4;
    `,
    [userId, emailNeedle, exactEmail, limit],
  );
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    userId: row.user_id || null,
    email: row.email || null,
    displayName: row.display_name || row.email || row.user_id || "",
    createdAt: row.created_at || null,
    lastSignInAt: row.last_sign_in_at || null,
  }));
}

function createAdminUserSearchHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const runSearch = deps.searchUsers || searchUsers;
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
      await requireAdmin(event, env);
      const qs = event.queryStringParameters || {};
      const query = normalizeQuery(qs.q);
      const limit = normalizeLimit(qs.limit);
      const items = await runSearch(query, limit);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ items }) };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        return adminAuthErrorResponse(error, cors);
      }
      const status = error?.status || 500;
      const body = status === 400 ? { error: error.code || "invalid_request" } : { error: "server_error" };
      return { statusCode: status, headers: cors, body: JSON.stringify(body) };
    }
  };
}

const handler = createAdminUserSearchHandler();

export {
  createAdminUserSearchHandler,
  handler,
  normalizeQuery,
  searchUsers,
};
