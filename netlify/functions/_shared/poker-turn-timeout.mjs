import { advanceIfNeeded, applyAction } from "./poker-reducer.mjs";
import { computeLegalActions } from "./poker-legal-actions.mjs";
import { awardPotsAtShowdown } from "./poker-payout.mjs";
import { materializeShowdownAndPayout } from "./poker-materialize-showdown.mjs";
import { computeShowdown } from "./poker-showdown.mjs";
import { isPlainObject, withoutPrivateState } from "./poker-state-utils.mjs";

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

const getTimeoutDefaultAction = (state) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const turnUserId = typeof state.turnUserId === "string" && state.turnUserId.trim() ? state.turnUserId : null;
  if (!turnUserId) return null;
  const publicState = withoutPrivateState(state);
  let legal;
  try {
    legal = computeLegalActions({ statePublic: publicState, userId: turnUserId });
  } catch (error) {
    return null;
  }
  const actions = Array.isArray(legal?.actions) ? legal.actions : [];
  if (actions.includes("CHECK")) return { type: "CHECK", userId: turnUserId };
  if (actions.includes("FOLD")) return { type: "FOLD", userId: turnUserId };
  return null;
};

const getTimeoutAction = (state) => getTimeoutDefaultAction(state);

const maybeApplyTurnTimeout = ({ tableId, state, privateState, nowMs }) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return { applied: false, state };
  if (!isActionPhase(state.phase) || !state.turnUserId) return { applied: false, state };
  const deadline = Number(state.turnDeadlineAt);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (!Number.isFinite(deadline) || now <= deadline) return { applied: false, state };

  const action = getTimeoutDefaultAction(state);
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
    const materialized = materializeShowdownAndPayout({
      state: nextState,
      seatUserIdsInOrder,
      holeCardsByUserId: nextState.holeCardsByUserId,
      computeShowdown,
      awardPotsAtShowdown,
    });
    nextState = materialized.nextState;
  }

  const handEnded = nextState.phase === "SETTLED" || nextState.phase === "SHOWDOWN";
  if (handEnded && !events.some((event) => event?.type === "HAND_RESET")) {
    events.push({ type: "HAND_RESET", reason: "timeout", handId, tableId });
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

export { getTimeoutAction, getTimeoutDefaultAction, maybeApplyTurnTimeout, normalizeSeatOrderFromState };
