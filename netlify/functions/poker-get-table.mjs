import { baseHeaders, corsHeaders, executeSql, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";

const parseTableId = (event) => {
  const queryValue = event.queryStringParameters?.tableId;
  if (typeof queryValue === "string" && queryValue.trim()) {
    return queryValue.trim();
  }

  const pathValue = typeof event.path === "string" ? event.path.trim() : "";
  if (!pathValue) return "";
  const parts = pathValue.split("/").filter(Boolean);
  if (parts.length === 0) return "";
  const last = parts[parts.length - 1];
  if (!last || last === "poker-get-table" || last === ".netlify" || last === "functions") return "";
  if (last === "poker-get-table" || last === "poker-get-table.mjs") return "";
  return last;
};

const isValidUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

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

  const tableId = parseTableId(event);
  if (!tableId || !isValidUuid(tableId)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "invalid_table_id" }) };
  }

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  try {
    const tableRows = await executeSql(
      "select id, stakes, max_players, status, created_by, created_at, updated_at from public.poker_tables where id = $1 limit 1;",
      [tableId]
    );
    const table = tableRows?.[0] || null;
    if (!table) {
      return { statusCode: 404, headers: cors, body: JSON.stringify({ error: "table_not_found" }) };
    }

    const seatRows = await executeSql(
      "select user_id, seat_no, status, created_at from public.poker_seats where table_id = $1 order by seat_no asc;",
      [tableId]
    );

    const stateRows = await executeSql(
      "select version, state from public.poker_state where table_id = $1 limit 1;",
      [tableId]
    );
    const stateRow = stateRows?.[0] || null;
    if (!stateRow) {
      klog("poker_state_missing", { tableId });
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
    }

    const seats = Array.isArray(seatRows)
      ? seatRows.map((seat) => ({
          userId: seat.user_id,
          seatNo: seat.seat_no,
          status: seat.status,
          createdAt: seat.created_at,
        }))
      : [];

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        ok: true,
        table,
        seats,
        state: {
          version: stateRow.version,
          state: stateRow.state,
        },
      }),
    };
  } catch (error) {
    klog("poker_get_table_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "server_error" }) };
  }
}
