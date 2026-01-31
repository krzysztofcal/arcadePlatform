import { advanceIfNeeded, applyAction } from "./poker-reducer.mjs";
import { awardPotsAtShowdown } from "./poker-payout.mjs";
import { materializeShowdownAndPayout } from "./poker-materialize-showdown.mjs";
import { computeShowdown } from "./poker-showdown.mjs";
import { isPlainObject } from "./poker-state-utils.mjs";
import { klog } from "./supabase-admin.mjs";

const ADVANCE_LIMIT = 4;

const isActionPhase = (phase) => phase === "PREFLOP" || phase === "FLOP" || phase === "TURN" || phase === "RIVER";

const normalizeSeatOrderFromState = (seats) => {
  if (!Array.isArray(seats)) return [];
  const ordered = seats.slice().sort((a, b) => Number(a?.seatNo ?? 0) - Number(b?.seatNo ?? 0));
  const out = [];
  const seen = new Set();
  for (const seat of ordered) {
    if (typeof seat?.userId !== "string") continue;
    const userId = seat.userId.trim();
    if (!userId) continue;
    if (seen.has(userId)) return [];
    seen.add(userId);
    out.push(userId);
  }
  return out;
};

const getTimeoutAction = (state) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  if (!state.turnUserId) return null;
  const toCall = Number(state.toCallByUserId?.[state.turnUserId] || 0);
  return { type: toCall > 0 ? "FOLD" : "CHECK", userId: state.turnUserId };
};

const maybeApplyTurnTimeout = ({ tableId, state, privateState, nowMs }) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return { applied: false, state };
  if (!isActionPhase(state.phase) || !state.turnUserId) return { applied: false, state };
  const deadline = Number(state.turnDeadlineAt);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (!Number.isFinite(deadline) || now <= deadline) return { applied: false, state };

  const action = getTimeoutAction(state);
  if (!action) return { applied: false, state };

  const turnNo = Number.isInteger(state.turnNo) ? state.turnNo : 0;
  const handId = typeof state.handId === "string" && state.handId.trim() ? state.handId.trim() : "unknown";
  const requestId = `auto:${tableId}:${handId}:${turnNo}`;
  const lastByUserId = isPlainObject(state.lastActionRequestIdByUserId) ? state.lastActionRequestIdByUserId : {};
  if (lastByUserId[action.userId] === requestId) {
    return { applied: false, state, requestId, replayed: true };
  }

  const applied = applyAction(privateState, action);
  let nextState = applied.state;
  const events = Array.isArray(applied.events) ? applied.events.slice() : [];
  let loops = 0;
  while (loops < ADVANCE_LIMIT) {
    const prevPhase = nextState.phase;
    const advanced = advanceIfNeeded(nextState);
    nextState = advanced.state;
    if (Array.isArray(advanced.events) && advanced.events.length > 0) {
      events.push(...advanced.events);
    }
    if (!Array.isArray(advanced.events) || advanced.events.length === 0) break;
    if (nextState.phase === prevPhase) break;
    loops += 1;
  }

  const seatUserIdsInOrder = normalizeSeatOrderFromState(nextState.seats);
  const currentHandId = typeof nextState.handId === "string" ? nextState.handId.trim() : "";
  const showdownHandId =
    typeof nextState.showdown?.handId === "string" && nextState.showdown.handId.trim() ? nextState.showdown.handId.trim() : "";
  const showdownAlreadyMaterialized = !!currentHandId && !!showdownHandId && showdownHandId === currentHandId;
  const eligibleUserIds = seatUserIdsInOrder.filter(
    (userId) => typeof userId === "string" && !nextState.foldedByUserId?.[userId]
  );
  const shouldMaterializeShowdown =
    seatUserIdsInOrder.length > 0 &&
    !showdownAlreadyMaterialized &&
    (eligibleUserIds.length <= 1 || nextState.phase === "SHOWDOWN");

  if (nextState.phase === "SHOWDOWN" && seatUserIdsInOrder.length === 0) {
    throw new Error("showdown_no_players");
  }

  if (shouldMaterializeShowdown) {
    try {
      const materialized = materializeShowdownAndPayout({
        state: nextState,
        seatUserIdsInOrder,
        holeCardsByUserId: nextState.holeCardsByUserId,
        computeShowdown,
        awardPotsAtShowdown,
      });
      nextState = materialized.nextState;
    } catch (error) {
      const reason = error?.message || "unknown";
      if (typeof klog === "function") {
        klog("poker_showdown_materialize_failed", {
          tableId,
          handId: typeof nextState.handId === "string" ? nextState.handId : null,
          phase: nextState.phase ?? null,
          reason,
        });
      }
      throw error;
    }
  }

  const { holeCardsByUserId: _ignoredHoleCards, deck: _ignoredDeck, ...stateBase } = nextState;
  const updatedState = {
    ...stateBase,
    communityDealt: Array.isArray(nextState.community) ? nextState.community.length : 0,
    lastActionRequestIdByUserId: {
      ...lastByUserId,
      [action.userId]: requestId,
    },
  };
  return { applied: true, state: updatedState, events, action, requestId };
};

export { getTimeoutAction, maybeApplyTurnTimeout, normalizeSeatOrderFromState };
