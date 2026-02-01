import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { normalizeJsonState } from "./_shared/poker-state-utils.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";

const parseTableId = (event) => {
  const value = event.queryStringParameters?.tableId;
  return typeof value === "string" ? value.trim() : "";
};

const parseHandId = (event) => {
  const value = event.queryStringParameters?.handId;
  return typeof value === "string" ? value.trim() : "";
};

const normalizeJson = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
};

const redactDeterminism = (meta) => {
  const obj = normalizeJson(meta);
  if (!obj) return null;
  if (!Object.prototype.hasOwnProperty.call(obj, "determinism")) return obj;
  const { determinism: _determinism, ...rest } = obj;
  const keys = Object.keys(rest);
  return keys.length ? rest : null;
};

const allowDeterminismExport = () => process.env.POKER_DEBUG_EXPORT === "true";

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const cors = corsHeaders(origin);
  const mergeHeaders = (next) => ({ ...baseHeaders(), ...(next || {}) });
  if (!cors) {
    return { statusCode: 403, headers: baseHeaders(), body: JSON.stringify({ error: "forbidden_origin" }) };
  }
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: mergeHeaders(cors), body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: mergeHeaders(cors), body: JSON.stringify({ error: "method_not_allowed" }) };
  }

  const tableId = parseTableId(event);
  if (!tableId || !isValidUuid(tableId)) {
    return { statusCode: 400, headers: mergeHeaders(cors), body: JSON.stringify({ error: "invalid_table_id" }) };
  }
  const requestedHandId = parseHandId(event);

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return { statusCode: 401, headers: mergeHeaders(cors), body: JSON.stringify({ error: "unauthorized", reason: auth.reason }) };
  }

  try {
    const result = await beginSql(async (tx) => {
      const seatRows = await tx.unsafe(
        "select user_id, seat_no from public.poker_seats where table_id = $1 and status = 'ACTIVE' order by seat_no asc;",
        [tableId]
      );
      const isSeated = Array.isArray(seatRows) && seatRows.some((seat) => seat?.user_id === auth.userId);
      if (!isSeated) {
        return { error: "not_allowed" };
      }

      const tableRows = await tx.unsafe(
        "select id, stakes, max_players from public.poker_tables where id = $1 limit 1;",
        [tableId]
      );
      const table = tableRows?.[0] || null;
      if (!table) {
        return { error: "table_not_found" };
      }

      const stateRows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 limit 1;", [
        tableId,
      ]);
      const stateRow = stateRows?.[0] || null;
      if (!stateRow) {
        return { error: "state_not_found" };
      }
      const normalizedState = normalizeJsonState(stateRow.state);
      const resolvedHandId = requestedHandId || (typeof normalizedState?.handId === "string" ? normalizedState.handId.trim() : "");
      if (!resolvedHandId) {
        return { error: "hand_not_found" };
      }

      const actionRows = await tx.unsafe(
        "select id, created_at, version, user_id, action_type, amount, request_id, hand_id, phase_from, phase_to, meta from public.poker_actions where table_id = $1 and hand_id = $2 order by version asc nulls last, created_at asc, id asc;",
        [tableId, resolvedHandId]
      );
      return {
        table,
        state: normalizedState,
        stateVersion: Number(stateRow.version) || 0,
        handId: resolvedHandId,
        seats: Array.isArray(seatRows) ? seatRows : [],
        actions: Array.isArray(actionRows) ? actionRows : [],
      };
    });

    if (result.error) {
      const status = result.error === "not_allowed" ? 403 : 404;
      return { statusCode: status, headers: mergeHeaders(cors), body: JSON.stringify({ error: result.error }) };
    }

    const includeDeterminism = allowDeterminismExport();
    const actions = result.actions.map((row) => {
      const meta = includeDeterminism ? normalizeJson(row.meta) : redactDeterminism(row.meta);
      return {
        createdAt: row.created_at,
        version: row.version,
        type: row.action_type,
        amount: row.amount,
        userId: row.user_id,
        requestId: row.request_id,
        handId: row.hand_id,
        phaseFrom: row.phase_from,
        phaseTo: row.phase_to,
        meta: meta || null,
      };
    });

    const payload = {
      schema: "poker-hand-history@1",
      exportedAt: new Date().toISOString(),
      tableId,
      handId: result.handId,
      stateVersion: result.stateVersion,
      table: {
        stakes: result.table?.stakes ?? null,
        maxPlayers: result.table?.max_players ?? null,
      },
      seats: result.seats.map((seat) => ({ seatNo: seat.seat_no, userId: seat.user_id })),
      actions,
    };

    return { statusCode: 200, headers: mergeHeaders(cors), body: JSON.stringify(payload) };
  } catch (error) {
    klog("poker_export_log_error", { tableId, userId: auth.userId, message: error?.message || "server_error" });
    return { statusCode: 500, headers: mergeHeaders(cors), body: JSON.stringify({ error: "server_error" }) };
  }
}
