import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { normalizeJsonState, withoutPrivateState } from "./_shared/poker-state-utils.mjs";
import { isValidTwoCards } from "./_shared/poker-cards-utils.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";

const isActionPhase = (phase) => phase === "PREFLOP" || phase === "FLOP" || phase === "TURN" || phase === "RIVER";
const makeError = (status, code) => {
  const err = new Error(code);
  err.status = status;
  err.code = code;
  return err;
};

const isMissingTableError = (error) => {
  if (!error) return false;
  const message = String(error.message || "").toLowerCase();
  return (error.code === "42P01" || message.includes("does not exist")) && message.includes("poker_hole_cards");
};

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
  const mergeHeaders = (next) => ({ ...baseHeaders(), ...(next || {}) });
  if (!cors) {
    return {
      statusCode: 403,
      headers: baseHeaders(),
      body: JSON.stringify({ error: "forbidden_origin" }),
    };
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

  // Table info is public; myHoleCards only returned when authenticated + seated ACTIVE + action phase.
  const token = extractBearerToken(event.headers);
  let authUserId = null;
  if (token) {
    try {
      const auth = await verifySupabaseJwt(token);
      if (!auth?.valid || !auth?.userId) {
        return { statusCode: 401, headers: mergeHeaders(cors), body: JSON.stringify({ error: "unauthorized" }) };
      }
      authUserId = auth.userId;
    } catch {
      return { statusCode: 401, headers: mergeHeaders(cors), body: JSON.stringify({ error: "unauthorized" }) };
    }
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
        klog("poker_state_missing", { tableId });
        throw new Error("poker_state_missing");
      }

      const normalizedState = normalizeJsonState(stateRow.state);
      const handId = typeof normalizedState.handId === "string" ? normalizedState.handId.trim() : "";
      const isSeatedActive =
        authUserId &&
        Array.isArray(seatRows) &&
        seatRows.some((seat) => seat.user_id === authUserId && seat.status === "ACTIVE");
      let myHoleCards = [];
      if (authUserId && isSeatedActive && isActionPhase(normalizedState.phase)) {
        if (!handId) {
          klog("poker_state_corrupt", { tableId, phase: normalizedState.phase, reason: "missing_hand_id" });
          throw makeError(409, "state_invalid");
        }
        let holeRows;
        try {
          holeRows = await tx.unsafe(
            "select cards from public.poker_hole_cards where table_id = $1 and hand_id = $2 and user_id = $3 limit 1;",
            [tableId, handId, authUserId]
          );
        } catch (error) {
          if (isMissingTableError(error)) {
            klog("poker_schema_not_ready", { table: "poker_hole_cards", tableId, phase: normalizedState.phase });
            throw makeError(409, "state_invalid");
          }
          throw error;
        }
        const holeCards = holeRows?.[0]?.cards;
        if (isValidTwoCards(holeCards)) {
          myHoleCards = holeCards;
        } else {
          klog("poker_state_corrupt", { tableId, phase: normalizedState.phase, reason: "invalid_hole_cards_shape" });
          throw makeError(409, "state_invalid");
        }
      }
      if (!isActionPhase(normalizedState.phase)) myHoleCards = [];

      const seats = Array.isArray(seatRows)
        ? seatRows.map((seat) => ({
            userId: seat.user_id,
            seatNo: seat.seat_no,
            status: seat.status,
            lastSeenAt: seat.last_seen_at,
            joinedAt: seat.joined_at,
          }))
        : [];

      return { table, seats, stateRow, normalizedState, myHoleCards };
    });

    if (result?.error === "table_not_found") {
      return { statusCode: 404, headers: mergeHeaders(cors), body: JSON.stringify({ error: "table_not_found" }) };
    }

    const table = result.table;
    const seats = result.seats;
    const stateRow = result.stateRow;
    const publicState = withoutPrivateState(result.normalizedState);

    const tablePayload = {
      id: table.id,
      stakes: table.stakes,
      maxPlayers: table.max_players,
      status: table.status,
      createdBy: table.created_by,
      createdAt: table.created_at,
      updatedAt: table.updated_at,
      lastActivityAt: table.last_activity_at,
    };

    return {
      statusCode: 200,
      headers: mergeHeaders(cors),
      body: JSON.stringify({
        ok: true,
        table: tablePayload,
        seats,
        state: {
          version: stateRow.version,
          state: publicState,
        },
        myHoleCards: result.myHoleCards || [],
      }),
    };
  } catch (error) {
    if (error?.status && error?.code) {
      return { statusCode: error.status, headers: mergeHeaders(cors), body: JSON.stringify({ error: error.code }) };
    }
    klog("poker_get_table_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: mergeHeaders(cors), body: JSON.stringify({ error: "server_error" }) };
  }
}
