import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { isHoleCardsTableMissing, loadHoleCardsByUserId } from "./_shared/poker-hole-cards-store.mjs";
import { normalizeJsonState, withoutPrivateState } from "./_shared/poker-state-utils.mjs";
import { isValidUuid } from "./_shared/poker-utils.mjs";

const isActionPhase = (phase) => phase === "PREFLOP" || phase === "FLOP" || phase === "TURN" || phase === "RIVER";

const normalizeSeatUserIds = (seats) => {
  if (!Array.isArray(seats)) return [];
  return seats.map((seat) => seat?.userId).filter((userId) => typeof userId === "string" && userId.trim());
};

const hasSameUserIds = (left, right) => {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  if (leftSet.size !== left.length) return false;
  for (const id of right) {
    if (!leftSet.has(id)) return false;
  }
  return true;
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

  const token = extractBearerToken(event.headers);
  const auth = await verifySupabaseJwt(token);
  if (!auth.valid || !auth.userId) {
    return {
      statusCode: 401,
      headers: mergeHeaders(cors),
      body: JSON.stringify({ error: "unauthorized", reason: auth.reason }),
    };
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
      const activeSeatRows = await tx.unsafe(
        "select user_id, seat_no from public.poker_seats where table_id = $1 and status = 'ACTIVE' order by seat_no asc;",
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

      const seats = Array.isArray(seatRows)
        ? seatRows.map((seat) => ({
            userId: seat.user_id,
            seatNo: seat.seat_no,
            status: seat.status,
            lastSeenAt: seat.last_seen_at,
            joinedAt: seat.joined_at,
          }))
        : [];

      const currentState = normalizeJsonState(stateRow.state);
      let myHoleCards = [];
      if (isActionPhase(currentState.phase)) {
        if (typeof currentState.handId !== "string" || !currentState.handId.trim()) {
          throw new Error("state_invalid");
        }
        const dbActiveUserIds = Array.isArray(activeSeatRows)
          ? activeSeatRows.map((row) => row?.user_id).filter(Boolean)
          : [];
        const seatRowsActiveUserIds = Array.isArray(seatRows)
          ? seatRows
              .filter((row) => row?.status === "ACTIVE")
              .map((row) => row?.user_id)
              .filter(Boolean)
          : [];
        const stateSeatUserIds = normalizeSeatUserIds(currentState.seats);
        if (stateSeatUserIds.length <= 0) {
          throw new Error("state_invalid");
        }
        if (!stateSeatUserIds.includes(auth.userId)) {
          throw new Error("state_invalid");
        }
        let candidateActiveUserIds = dbActiveUserIds.length ? dbActiveUserIds : seatRowsActiveUserIds;
        if (candidateActiveUserIds.length <= 0) {
          candidateActiveUserIds = stateSeatUserIds;
        }
        if (!hasSameUserIds(candidateActiveUserIds, stateSeatUserIds)) {
          klog("poker_get_table_active_mismatch", {
            tableId,
            dbActiveCount: dbActiveUserIds.length,
            seatRowsActiveCount: seatRowsActiveUserIds.length,
            candidateActiveCount: candidateActiveUserIds.length,
            stateCount: stateSeatUserIds.length,
          });
        }
        let effectiveUserIdsForHoleCards = stateSeatUserIds;
        if (candidateActiveUserIds.length) {
          const overlap = candidateActiveUserIds.filter((userId) => stateSeatUserIds.includes(userId));
          if (overlap.length) {
            effectiveUserIdsForHoleCards = overlap.includes(auth.userId) ? overlap : [...overlap, auth.userId];
          }
        }
        try {
          const holeCards = await loadHoleCardsByUserId(tx, {
            tableId,
            handId: currentState.handId,
            activeUserIds: effectiveUserIdsForHoleCards,
          });
          myHoleCards = holeCards.holeCardsByUserId[auth.userId] || [];
        } catch (error) {
          if (error?.message === "state_invalid") {
            klog("poker_get_table_hole_cards_invalid", {
              tableId,
              handId: currentState.handId,
              userId: auth.userId,
              effectiveCount: effectiveUserIdsForHoleCards.length,
            });
            throw new Error("state_invalid");
          }
          if (isHoleCardsTableMissing(error)) {
            klog("poker_get_table_hole_cards_invalid", {
              tableId,
              handId: currentState.handId,
              userId: auth.userId,
              effectiveCount: effectiveUserIdsForHoleCards.length,
            });
            throw new Error("state_invalid");
          }
          throw error;
        }
      }

      return { table, seats, stateRow, currentState, myHoleCards };
    });

    if (result?.error === "table_not_found") {
      return { statusCode: 404, headers: mergeHeaders(cors), body: JSON.stringify({ error: "table_not_found" }) };
    }

    const table = result.table;
    const seats = result.seats;
    const stateRow = result.stateRow;
    const publicState = withoutPrivateState(result.currentState);

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
    if (error?.message === "state_invalid" || isHoleCardsTableMissing(error)) {
      return { statusCode: 409, headers: mergeHeaders(cors), body: JSON.stringify({ error: "state_invalid" }) };
    }
    klog("poker_get_table_error", { message: error?.message || "unknown_error" });
    return { statusCode: 500, headers: mergeHeaders(cors), body: JSON.stringify({ error: "server_error" }) };
  }
}
