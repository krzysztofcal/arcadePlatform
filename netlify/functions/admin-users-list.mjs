import { adminAuthErrorResponse, requireAdminUser } from "./_shared/admin-auth.mjs";
import { badRequest, buildPagination, escapeLike, parseBoolFlag, parsePageLimit, parseTimestamp, parseUuid } from "./_shared/admin-ops.mjs";
import { baseHeaders, corsHeaders, executeSql } from "./_shared/supabase-admin.mjs";

const SORT_SQL = {
  last_activity_desc: "last_activity_at desc nulls last, created_at desc",
  last_sign_in_desc: "last_sign_in_at desc nulls last, created_at desc",
  created_at_desc: "created_at desc",
  balance_desc: "balance desc, created_at desc",
};

function parseSort(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return "last_activity_desc";
  if (!Object.prototype.hasOwnProperty.call(SORT_SQL, normalized)) {
    throw badRequest("invalid_sort", "invalid_sort");
  }
  return normalized;
}

async function listUsers(filters = {}) {
  const pageInfo = parsePageLimit(filters, { defaultLimit: 20, maxLimit: 100 });
  const sort = parseSort(filters.sort);
  const search = typeof filters.q === "string" ? filters.q.trim() : "";
  const userId = filters.userId ? parseUuid(filters.userId, "invalid_user_id") : null;
  const createdFrom = parseTimestamp(filters.createdFrom, "invalid_created_from");
  const createdTo = parseTimestamp(filters.createdTo, "invalid_created_to");
  const lastSignInFrom = parseTimestamp(filters.lastSignInFrom, "invalid_last_sign_in_from");
  const lastSignInTo = parseTimestamp(filters.lastSignInTo, "invalid_last_sign_in_to");
  const lastActivityFrom = parseTimestamp(filters.lastActivityFrom, "invalid_last_activity_from");
  const lastActivityTo = parseTimestamp(filters.lastActivityTo, "invalid_last_activity_to");
  const hasBalance = parseBoolFlag(filters.hasBalance);
  const hasActiveSeat = parseBoolFlag(filters.hasActiveSeat);
  const hasActiveTable = parseBoolFlag(filters.hasActiveTable);
  const params = [];
  const nextParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [];
  if (userId) {
    where.push(`user_id = ${nextParam(userId)}`);
  }
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    const exactId = /^[0-9a-f-]{32,36}$/i.test(search) ? search : null;
    where.push(`(
      email ilike ${nextParam(pattern)} escape '\\'
      or display_name ilike ${nextParam(pattern)} escape '\\'
      or user_id ilike ${nextParam(pattern)} escape '\\'
      or (${nextParam(exactId)}::text is not null and user_id = ${nextParam(exactId)})
    )`);
  }
  if (createdFrom) where.push(`created_at >= ${nextParam(createdFrom)}::timestamptz`);
  if (createdTo) where.push(`created_at <= ${nextParam(createdTo)}::timestamptz`);
  if (lastSignInFrom) where.push(`last_sign_in_at >= ${nextParam(lastSignInFrom)}::timestamptz`);
  if (lastSignInTo) where.push(`last_sign_in_at <= ${nextParam(lastSignInTo)}::timestamptz`);
  if (lastActivityFrom) where.push(`last_activity_at >= ${nextParam(lastActivityFrom)}::timestamptz`);
  if (lastActivityTo) where.push(`last_activity_at <= ${nextParam(lastActivityTo)}::timestamptz`);
  if (hasBalance === true) where.push("balance > 0");
  if (hasBalance === false) where.push("balance <= 0");
  if (hasActiveSeat === true) where.push("active_seat_count > 0");
  if (hasActiveSeat === false) where.push("active_seat_count = 0");
  if (hasActiveTable === true) where.push("active_table_count > 0");
  if (hasActiveTable === false) where.push("active_table_count = 0");
  const whereSql = where.length ? `where ${where.join("\n  and ")}` : "";
  const query = `
with active_seats as (
  select
    s.user_id,
    count(*) filter (where s.status = 'ACTIVE') as active_seat_count,
    count(distinct s.table_id) filter (where s.status = 'ACTIVE') as active_table_count,
    max(s.last_seen_at) as last_seat_seen_at,
    max(coalesce(t.last_activity_at, t.updated_at, t.created_at)) as last_table_activity_at
  from public.poker_seats s
  left join public.poker_tables t on t.id = s.table_id
  group by s.user_id
),
poker_activity as (
  select
    pa.user_id,
    max(pa.created_at) as last_poker_action_at
  from public.poker_actions pa
  where pa.user_id is not null
  group by pa.user_id
),
user_accounts as (
  select
    a.user_id,
    a.balance
  from public.chips_accounts a
  where a.account_type = 'USER'
),
base as (
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
    u.last_sign_in_at,
    coalesce(ua.balance, 0) as balance,
    coalesce(ase.active_seat_count, 0) as active_seat_count,
    coalesce(ase.active_table_count, 0) as active_table_count,
    greatest(
      coalesce(pa.last_poker_action_at, to_timestamp(0)),
      coalesce(ase.last_seat_seen_at, to_timestamp(0)),
      coalesce(ase.last_table_activity_at, to_timestamp(0)),
      coalesce(u.last_sign_in_at, to_timestamp(0)),
      coalesce(u.created_at, to_timestamp(0))
    ) as last_activity_at
  from auth.users u
  left join user_accounts ua on ua.user_id = u.id
  left join active_seats ase on ase.user_id = u.id
  left join poker_activity pa on pa.user_id = u.id
),
filtered as (
  select * from base
  ${whereSql}
)
select
  filtered.*,
  count(*) over() as total_count
from filtered
order by ${SORT_SQL[sort]}
offset ${nextParam(pageInfo.offset)}
limit ${nextParam(pageInfo.limit)};
  `;
  const rows = await executeSql(query, params);
  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0;
  return {
    items: (Array.isArray(rows) ? rows : []).map((row) => ({
      userId: row.user_id || null,
      email: row.email || null,
      displayName: row.display_name || row.email || row.user_id || "",
      createdAt: row.created_at || null,
      lastSignInAt: row.last_sign_in_at || null,
      lastActivityAt: row.last_activity_at || null,
      balance: Number.isFinite(Number(row.balance)) ? Number(row.balance) : 0,
      activeSeatCount: Number.isInteger(Number(row.active_seat_count)) ? Number(row.active_seat_count) : 0,
      activeTableCount: Number.isInteger(Number(row.active_table_count)) ? Number(row.active_table_count) : 0,
    })),
    pagination: buildPagination({ page: pageInfo.page, limit: pageInfo.limit, total }),
  };
}

function createAdminUsersListHandler(deps = {}) {
  const env = deps.env || process.env;
  const requireAdmin = deps.requireAdminUser || requireAdminUser;
  const listUsersFn = deps.listUsers || listUsers;
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
      const payload = await listUsersFn(qs);
      return { statusCode: 200, headers: cors, body: JSON.stringify(payload) };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        return adminAuthErrorResponse(error, cors);
      }
      if (error?.status === 400) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: error.code || "invalid_request" }) };
      }
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
    }
  };
}

const handler = createAdminUsersListHandler();

export {
  createAdminUsersListHandler,
  handler,
  listUsers,
};
