import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";

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
    const result = await beginSql(async (tx) => {
      const tableRows = await tx.unsafe(
        "select id, stakes, max_players, status, created_by, created_at, updated_at, last_activity_at from public.poker_tables where id = $1 limit 1;",
        [tableId]
      );
      const table = tableRows?.[0] || null;
      if (!table) {
        return { error: "table_not_found" };
      }

      const seatRows = await tx.unsafe(
        "select user_id, seat_no, status, last_seen_at, joined_at from public.poker_seats where table_id = $1 order by seat_no asc;",
        [tableId]
      );

      const stateRows = await tx.unsafe(
        "select version, state from public.poker_state where table_id = $1 limit 1;",
        [tableId]
      );
      const stateRow = stateRows?.[0] || null;
      if (!stateRow) {
        throw new Error("poker_state_missing");
      }

      const seats = Array.isArray(seatRows)
        ? seatRows.map((seat) => ({
            userId: seat.user_id,
            seatNo: seat.seat_no,
            status: seat.status,
            lastSeenAt: seat.last_seen_at,
            joinedAt: seat.joined_at,
          }))
        : [];

      return { table, seats, stateRow };
    });

    if (result?.error === "table_not_found") {
      return { statusCode: 404, headers: cors, body: JSON.stringify({ error: "table_not_found" }) };
    }

    const table = result.table;
    const seats = result.seats;
    const stateRow = result.stateRow;

    const tablePayload = {
      id: table.id,
      stakes: table.stakes,
      maxPlayers: table.max_players,
      max_players: table.max_players,
      status: table.status,
      createdBy: table.created_by,
      createdAt: table.created_at,
      updatedAt: table.updated_at,
      lastActivityAt: table.last_activity_at,
      last_activity_at: table.last_activity_at,
    };

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        ok: true,
        table: tablePayload,
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
