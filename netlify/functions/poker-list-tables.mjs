import { baseHeaders, corsHeaders, executeSql, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";

const parseLimit = (value) => {
  if (value == null || value === "") return { ok: true, value: 20 };
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return { ok: false, value: null };
  const clamped = Math.min(50, Math.max(1, num));
  return { ok: true, value: clamped };
};

const parseStatus = (value) => {
  if (value == null || value === "") return { ok: true, value: "OPEN" };
  const normalized = String(value).trim().toUpperCase();
  if (normalized !== "OPEN" && normalized !== "ALL") return { ok: false, value: null };
  return { ok: true, value: normalized };
};

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin);
  if (!cors) {
    return {
      statusCode: 403,
      headers: baseHeaders(),
      body: JSON.stringify({ error: "forbidden_origin" }),
    };
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  const queryParams = event.queryStringParameters || {};
  const limitParsed = parseLimit(queryParams.limit);
  if (!limitParsed.ok) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_limit" }) };
  }
  const statusParsed = parseStatus(queryParams.status);
  if (!statusParsed.ok) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_status" }) };
  }
  const limit = limitParsed.value;
  const status = statusParsed.value;

  const statusFilter = status === "OPEN" ? " where t.status = 'OPEN'" : "";
  const query = `
select t.id, t.stakes, t.max_players, t.status, t.created_by, t.created_at, t.updated_at,
       coalesce(s.seat_count, 0) as seat_count
from public.poker_tables t
left join (
  select table_id, count(*)::int as seat_count
  from public.poker_seats
  group by table_id
) s on s.table_id = t.id${statusFilter}
order by t.created_at desc
limit $1;
  `;

  try {
    const rows = await executeSql(query, [limit]);
    const tables = Array.isArray(rows)
      ? rows.map((row) => ({
          id: row.id,
          stakes: row.stakes,
          maxPlayers: row.max_players,
          status: row.status,
          createdBy: row.created_by,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          seatCount: row.seat_count ?? 0,
        }))
      : [];

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, tables }) };
  } catch (error) {
    klog("poker_list_tables_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
