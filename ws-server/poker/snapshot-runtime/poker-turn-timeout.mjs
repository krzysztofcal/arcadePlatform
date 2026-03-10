import { advanceIfNeeded, applyAction } from "./poker-reducer.mjs";
import { computeLegalActions } from "./poker-legal-actions.mjs";
import { awardPotsAtShowdown } from "./poker-payout.mjs";
import { materializeShowdownAndPayout } from "./poker-materialize-showdown.mjs";
import { computeShowdown } from "./poker-showdown.mjs";
import { applyInactivityPolicy } from "./poker-inactivity-policy.mjs";
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

const stripPrivate = (state) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return { publicState: state, privateHoleCards: null };
  }
  const { holeCardsByUserId, deck, ...publicState } = state;
  return { publicState, privateHoleCards: holeCardsByUserId || null };
};

const assertShowdownConsistency = (state) => {
  const handId = typeof state?.handId === "string" ? state.handId.trim() : "";
  const showdownHandId =
    typeof state?.showdown?.handId === "string" && state.showdown.handId.trim() ? state.showdown.handId.trim() : "";
  const showdownAlreadyMaterialized = !!handId && !!showdownHandId && showdownHandId === handId;
  if (showdownAlreadyMaterialized) {
    const potValue = Number(state.pot ?? 0);
    if (!Number.isFinite(potValue) || potValue < 0 || Math.floor(potValue) !== potValue) {
      throw new Error("showdown_invalid_pot");
    }
    if (potValue > 0) {
      throw new Error("showdown_pot_not_zero");
    }
  }
  if ((state.phase === "SHOWDOWN" || state.phase === "SETTLED") && Number(state.pot ?? 0) > 0) {
    throw new Error("showdown_pot_not_zero");
  }
};

const materializeIfNeededPublic = (state, privateHoleCards) => {
  if (!isPlainObject(state)) return state;
  const stripped = stripPrivate(state);
  const publicState = stripped.publicState;
  const seatUserIdsInOrder = normalizeSeatOrderFromState(publicState.seats);
  const handId = typeof publicState.handId === "string" ? publicState.handId.trim() : "";
  const showdownHandId =
    typeof publicState.showdown?.handId === "string" && publicState.showdown.handId.trim()
      ? publicState.showdown.handId.trim()
      : "";
  const showdownAlreadyMaterialized = !!handId && !!showdownHandId && showdownHandId === handId;
  const eligibleUserIds = seatUserIdsInOrder.filter(
    (userId) =>
      typeof userId === "string" &&
      !publicState.foldedByUserId?.[userId] &&
      !publicState.leftTableByUserId?.[userId] &&
      !publicState.sitOutByUserId?.[userId]
  );
  const shouldMaterializeShowdown =
    seatUserIdsInOrder.length > 0 &&
    !showdownAlreadyMaterialized &&
    (eligibleUserIds.length <= 1 || publicState.phase === "SHOWDOWN" || publicState.phase === "HAND_DONE");

  if (publicState.phase === "SHOWDOWN" && seatUserIdsInOrder.length === 0) {
    throw new Error("showdown_no_players");
  }

  let next = publicState;
  if (shouldMaterializeShowdown) {
    const materialized = materializeShowdownAndPayout({
      state: publicState,
      seatUserIdsInOrder,
      holeCardsByUserId: privateHoleCards,
      computeShowdown,
      awardPotsAtShowdown,
    });
    next = materialized.nextState;
  }

  assertShowdownConsistency(next);
  return next;
};

const maybeApplyTurnTimeout = ({ tableId, state, privateState, nowMs }) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return { applied: false, state };
  if (!isActionPhase(state.phase) || !state.turnUserId) return { applied: false, state };
  const deadline = Number(state.turnDeadlineAt);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (!Number.isFinite(deadline) || now < deadline) return { applied: false, state };

  const action = getTimeoutAction(state);
  if (!action) return { applied: false, state };

  const turnNo = Number.isInteger(state.turnNo) ? state.turnNo : 0;
  const handId = typeof state.handId === "string" && state.handId.trim() ? state.handId.trim() : "unknown";
  const requestId = `auto:${tableId}:${handId}:${turnNo}`;
  const lastByUserId = isPlainObject(state.lastActionRequestIdByUserId) ? state.lastActionRequestIdByUserId : {};
  if (lastByUserId[action.userId] === requestId) {
    return { applied: false, state, requestId, replayed: true };
  }

  const actionWithRequestId = { ...action, requestId };
  const applied = applyAction(privateState, actionWithRequestId);
  const stripped = stripPrivate(applied.state);
  let nextPublic = stripped.publicState;
  const privateHoleCards = stripped.privateHoleCards;
  let events = Array.isArray(applied.events) ? applied.events.slice() : [];

  let loops = 0;
  while (loops < ADVANCE_LIMIT) {
    const prevPhase = nextPublic.phase;
    const advanced = advanceIfNeeded(nextPublic);
    nextPublic = advanced.state;
    if (Array.isArray(advanced.events) && advanced.events.length > 0) {
      events.push(...advanced.events);
    }
    if (!Array.isArray(advanced.events) || advanced.events.length === 0) break;
    if (nextPublic.phase === prevPhase) break;
    loops += 1;
  }

  nextPublic = materializeIfNeededPublic(nextPublic, privateHoleCards);

  const handEnded = nextPublic.phase === "SETTLED" || nextPublic.phase === "SHOWDOWN";
  if (handEnded && !events.some((event) => event?.type === "HAND_RESET")) {
    events.push({ type: "HAND_RESET", reason: "timeout", handId, tableId });
  }

  const finalStripped = stripPrivate(nextPublic);
  const updatedState = {
    ...finalStripped.publicState,
    communityDealt: Array.isArray(nextPublic.community) ? nextPublic.community.length : 0,
    lastActionRequestIdByUserId: {
      ...lastByUserId,
      [action.userId]: requestId,
    },
  };
  const policyResult = applyInactivityPolicy(updatedState, events);
  const finalState = policyResult.state;
  return {
    applied: true,
    state: finalState,
    events: policyResult.events,
    action,
    requestId,
  };
};

export { getTimeoutAction, getTimeoutDefaultAction, maybeApplyTurnTimeout, normalizeSeatOrderFromState };
