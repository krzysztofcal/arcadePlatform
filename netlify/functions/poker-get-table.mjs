import { baseHeaders, beginSql, corsHeaders, extractBearerToken, klog, verifySupabaseJwt } from "./_shared/supabase-admin.mjs";
import { deriveCommunityCards, deriveRemainingDeck } from "./_shared/poker-deal-deterministic.mjs";
import { isHoleCardsTableMissing, loadHoleCardsByUserId } from "./_shared/poker-hole-cards-store.mjs";
import { isStateStorageValid, normalizeJsonState, withoutPrivateState } from "./_shared/poker-state-utils.mjs";
import { maybeApplyTurnTimeout, normalizeSeatOrderFromState } from "./_shared/poker-turn-timeout.mjs";
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

const buildHandSnapshot = (publicState) => ({
  handId: typeof publicState?.handId === "string" ? publicState.handId : null,
  phase: typeof publicState?.phase === "string" ? publicState.phase : null,
  dealerSeatNo: Number.isFinite(publicState?.dealerSeatNo) ? publicState.dealerSeatNo : null,
  turnUserId: typeof publicState?.turnUserId === "string" ? publicState.turnUserId : null,
  turnNo: Number.isInteger(publicState?.turnNo) ? publicState.turnNo : null,
  turnStartedAt: Number.isFinite(publicState?.turnStartedAt) ? publicState.turnStartedAt : null,
  turnDeadlineAt: Number.isFinite(publicState?.turnDeadlineAt) ? publicState.turnDeadlineAt : null,
});

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

const normalizeRank = (value) => {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  if (upper === "T") return 10;
  if (upper === "J") return 11;
  if (upper === "Q") return 12;
  if (upper === "K") return 13;
  if (upper === "A") return 14;
  const num = Number(upper);
  return Number.isInteger(num) ? num : null;
};

const cardKey = (card) => {
  const rank = normalizeRank(card?.r);
  const suit = typeof card?.s === "string" ? card.s.toUpperCase() : "";
  if (!rank || !suit) return "";
  return `${rank}-${suit}`;
};

const cardsSameSet = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  const leftKeys = left.map(cardKey);
  if (leftKeys.some((key) => !key)) return false;
  leftKeys.sort();
  const rightKeys = right.map(cardKey);
  if (rightKeys.some((key) => !key)) return false;
  rightKeys.sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let i = 0; i < leftKeys.length; i += 1) {
    if (leftKeys[i] !== rightKeys[i]) return false;
  }
  return true;
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
      let stateVersion = stateRow.version;

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
      let updatedState = currentState;
      if (isActionPhase(currentState.phase)) {
        if (typeof currentState.handId !== "string" || !currentState.handId.trim()) {
          throw new Error("state_invalid");
        }
        if (typeof currentState.handSeed !== "string" || !currentState.handSeed.trim()) {
          throw new Error("state_invalid");
        }
        const nowMs = Date.now();
        const shouldApplyTimeout = Number.isFinite(Number(currentState.turnDeadlineAt)) && nowMs > currentState.turnDeadlineAt;
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
        if (!shouldApplyTimeout && candidateActiveUserIds.length) {
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
          if (shouldApplyTimeout) {
            const seatUserIdsInOrder = normalizeSeatOrderFromState(currentState.seats);
            if (seatUserIdsInOrder.length <= 0) {
              throw new Error("state_invalid");
            }
            const derivedCommunity = deriveCommunityCards({
              handSeed: currentState.handSeed,
              seatUserIdsInOrder,
              communityDealt: currentState.communityDealt,
            });
            if (!cardsSameSet(currentState.community, derivedCommunity)) {
              throw new Error("state_invalid");
            }
            const derivedDeck = deriveRemainingDeck({
              handSeed: currentState.handSeed,
              seatUserIdsInOrder,
              communityDealt: currentState.communityDealt,
            });
            const privateState = {
              ...currentState,
              community: derivedCommunity,
              deck: derivedDeck,
              holeCardsByUserId: holeCards.holeCardsByUserId,
            };
            const timeoutResult = maybeApplyTurnTimeout({
              tableId,
              state: currentState,
              privateState,
              nowMs,
            });
            if (timeoutResult.applied) {
              if (
                !isStateStorageValid(timeoutResult.state, {
                  requireHandSeed: true,
                  requireCommunityDealt: true,
                  requireNoDeck: true,
                })
              ) {
                throw new Error("state_invalid");
              }
              const updateRows = await tx.unsafe(
                "update public.poker_state set version = version + 1, state = $2::jsonb, updated_at = now() where table_id = $1 returning version;",
                [tableId, JSON.stringify(timeoutResult.state)]
              );
              const newVersion = Number(updateRows?.[0]?.version);
              if (!Number.isFinite(newVersion)) {
                throw new Error("state_invalid");
              }
              stateVersion = newVersion;
              await tx.unsafe(
                "insert into public.poker_actions (table_id, version, user_id, action_type, amount) values ($1, $2, $3, $4, $5);",
                [tableId, newVersion, timeoutResult.action.userId, timeoutResult.action.type, timeoutResult.action.amount ?? null]
              );
              updatedState = timeoutResult.state;
            }
          }
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

      return { table, seats, stateVersion, currentState: updatedState, myHoleCards };
    });

    if (result?.error === "table_not_found") {
      return { statusCode: 404, headers: mergeHeaders(cors), body: JSON.stringify({ error: "table_not_found" }) };
    }

    const table = result.table;
    const seats = result.seats;
    const stateVersion = result.stateVersion;
    const publicState = withoutPrivateState(result.currentState);
    const hand = buildHandSnapshot(publicState);

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
          version: stateVersion,
          state: publicState,
        },
        hand,
        myHoleCards: result.myHoleCards || [],
        events: [],
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
