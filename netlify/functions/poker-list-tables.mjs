import { baseHeaders, corsHeaders, executeSql, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { parseStakes } from "./_shared/poker-stakes.mjs";
import { shouldHideSeatRowFromReadModel } from "./_shared/poker-list-seat-visibility.mjs";

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

const buildSeatCountsByTableId = (rows) => {
  const counts = Object.create(null);
  for (const row of Array.isArray(rows) ? rows : []) {
    const tableId = typeof row?.table_id === "string" ? row.table_id : null;
    if (!tableId || shouldHideSeatRowFromReadModel(row)) continue;
    counts[tableId] = (counts[tableId] || 0) + 1;
  }
  return counts;
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
select t.id, t.stakes, t.max_players, t.status, t.created_by, t.created_at, t.updated_at, t.last_activity_at
from public.poker_tables t${statusFilter}
order by t.created_at desc
limit $1;
  `;

  try {
    const rows = await executeSql(query, [limit]);
    const tableIds = Array.isArray(rows)
      ? rows.map((row) => (typeof row?.id === "string" ? row.id : null)).filter(Boolean)
      : [];
    let seatCountsByTableId = Object.create(null);
    if (tableIds.length > 0) {
      const seatParams = tableIds.slice();
      const placeholders = seatParams.map((_, idx) => `$${idx + 1}`).join(", ");
      const seatRows = await executeSql(
        `
select s.table_id, s.user_id, ps.state
from public.poker_seats s
left join public.poker_state ps on ps.table_id = s.table_id
where s.status = 'ACTIVE'
  and s.table_id in (${placeholders});
        `,
        seatParams
      );
      seatCountsByTableId = buildSeatCountsByTableId(seatRows);
    }
    const tables = Array.isArray(rows)
      ? rows.map((row) => {
          const stakesParsed = parseStakes(row.stakes);
          return {
            id: row.id,
            stakes: stakesParsed.ok ? stakesParsed.value : null,
            maxPlayers: row.max_players,
            status: row.status,
            createdBy: row.created_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            lastActivityAt: row.last_activity_at,
            seatCount: seatCountsByTableId[row.id] ?? 0,
          };
        })
      : [];

    klog("poker_list_tables_legacy_ok", { userId: auth.userId, count: tables.length, authoritative: false });
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        ok: true,
        legacy: true,
        authoritative: false,
        discoverySource: "persisted_db_legacy",
        tables
      })
    };
  } catch (error) {
    klog("poker_list_tables_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
