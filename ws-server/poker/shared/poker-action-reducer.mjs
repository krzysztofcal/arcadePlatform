import { computeSharedLegalActions } from "./poker-primitives.mjs";

const SUPPORTED_ACTIONS = new Set(["FOLD", "CHECK", "CALL", "BET", "RAISE"]);

function toInt(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.trunc(value);
}

function normalizeAction(action) {
  if (typeof action !== "string") {
    return null;
  }
  const normalized = action.trim().toUpperCase();
  if (!SUPPORTED_ACTIONS.has(normalized)) {
    return null;
  }
  return normalized;
}

function asStateCopy(state) {
  return {
    ...state,
    stacks: { ...(state.stacks || {}) },
    toCallByUserId: { ...(state.toCallByUserId || {}) },
    betThisRoundByUserId: { ...(state.betThisRoundByUserId || {}) },
    actedThisRoundByUserId: { ...(state.actedThisRoundByUserId || {}) },
    foldedByUserId: { ...(state.foldedByUserId || {}) },
    contributionsByUserId: { ...(state.contributionsByUserId || {}) }
  };
}

function orderedSeats(state) {
  return (Array.isArray(state.seats) ? state.seats : [])
    .filter((seat) => typeof seat?.userId === "string" && Number.isInteger(seat?.seatNo))
    .slice()
    .sort((a, b) => a.seatNo - b.seatNo || a.userId.localeCompare(b.userId));
}

function isSelectableActor(state, userId) {
  if (state.foldedByUserId?.[userId]) {
    return false;
  }
  const stack = Number(state.stacks?.[userId] ?? 0);
  return stack > 0;
}

function resolveNextTurnUserId(state, currentUserId) {
  const seats = orderedSeats(state);
  if (seats.length === 0) {
    return null;
  }

  const activeUserIds = seats.map((seat) => seat.userId).filter((userId) => isSelectableActor(state, userId));
  if (activeUserIds.length <= 1) {
    return null;
  }

  const currentIndex = seats.findIndex((seat) => seat.userId === currentUserId);
  if (currentIndex === -1) {
    return activeUserIds[0];
  }

  for (let offset = 1; offset <= seats.length; offset += 1) {
    const nextSeat = seats[(currentIndex + offset) % seats.length];
    if (isSelectableActor(state, nextSeat.userId)) {
      return nextSeat.userId;
    }
  }

  return null;
}

function recomputeToCall(state) {
  const currentBet = Number(state.currentBet ?? 0);
  for (const seat of orderedSeats(state)) {
    const userId = seat.userId;
    const userBet = Number(state.betThisRoundByUserId?.[userId] ?? 0);
    state.toCallByUserId[userId] = Math.max(0, currentBet - userBet);
  }
}

function isBettingClosed(state) {
  const seats = orderedSeats(state);
  const active = seats.filter((seat) => isSelectableActor(state, seat.userId));
  if (active.length <= 1) {
    return true;
  }

  return active.every((seat) => Number(state.toCallByUserId?.[seat.userId] ?? 0) === 0);
}

export function applyPreflopAction({ pokerState, userId, action, amount }) {
  if (!pokerState || typeof pokerState !== "object" || Array.isArray(pokerState)) {
    return { ok: false, reason: "invalid_state" };
  }
  if (pokerState.phase !== "PREFLOP") {
    return { ok: false, reason: "unsupported_phase" };
  }
  if (typeof userId !== "string" || userId.trim() === "") {
    return { ok: false, reason: "invalid_actor" };
  }

  const normalizedAction = normalizeAction(action);
  if (!normalizedAction) {
    return { ok: false, reason: "unsupported_action" };
  }

  const legalInfo = computeSharedLegalActions({ statePublic: pokerState, userId });
  if (!legalInfo.actions.includes(normalizedAction)) {
    return { ok: false, reason: "illegal_action" };
  }

  const nextState = asStateCopy(pokerState);
  const stack = Number(nextState.stacks?.[userId] ?? 0);
  const currentUserBet = Number(nextState.betThisRoundByUserId?.[userId] ?? 0);
  const toCall = Math.max(0, Number(legalInfo.toCall ?? 0));
  let contribution = 0;

  if (normalizedAction === "FOLD") {
    nextState.foldedByUserId[userId] = true;
    nextState.actedThisRoundByUserId[userId] = true;
  } else if (normalizedAction === "CHECK") {
    nextState.actedThisRoundByUserId[userId] = true;
  } else if (normalizedAction === "CALL") {
    contribution = Math.max(0, Math.min(stack, toCall));
    nextState.stacks[userId] = stack - contribution;
    nextState.betThisRoundByUserId[userId] = currentUserBet + contribution;
    nextState.contributionsByUserId[userId] = Number(nextState.contributionsByUserId[userId] ?? 0) + contribution;
    nextState.potTotal = Number(nextState.potTotal ?? 0) + contribution;
    nextState.actedThisRoundByUserId[userId] = true;
  } else if (normalizedAction === "BET") {
    const betAmount = toInt(amount);
    if (!Number.isInteger(betAmount) || betAmount < 1 || betAmount > stack) {
      return { ok: false, reason: "invalid_amount" };
    }

    contribution = betAmount;
    const nextBet = currentUserBet + contribution;
    nextState.stacks[userId] = stack - contribution;
    nextState.betThisRoundByUserId[userId] = nextBet;
    nextState.currentBet = Math.max(Number(nextState.currentBet ?? 0), nextBet);
    nextState.lastRaiseSize = contribution;
    nextState.contributionsByUserId[userId] = Number(nextState.contributionsByUserId[userId] ?? 0) + contribution;
    nextState.potTotal = Number(nextState.potTotal ?? 0) + contribution;
    nextState.actedThisRoundByUserId[userId] = true;
  } else if (normalizedAction === "RAISE") {
    const raiseTo = toInt(amount);
    const minRaiseTo = Number(legalInfo.minRaiseTo ?? 0);
    const maxRaiseTo = Number(legalInfo.maxRaiseTo ?? 0);
    if (!Number.isInteger(raiseTo) || raiseTo < minRaiseTo || raiseTo > maxRaiseTo || raiseTo <= currentUserBet) {
      return { ok: false, reason: "invalid_amount" };
    }

    contribution = raiseTo - currentUserBet;
    nextState.stacks[userId] = stack - contribution;
    nextState.betThisRoundByUserId[userId] = raiseTo;
    const previousCurrentBet = Number(nextState.currentBet ?? 0);
    nextState.currentBet = Math.max(previousCurrentBet, raiseTo);
    nextState.lastRaiseSize = Math.max(1, raiseTo - previousCurrentBet);
    nextState.contributionsByUserId[userId] = Number(nextState.contributionsByUserId[userId] ?? 0) + contribution;
    nextState.potTotal = Number(nextState.potTotal ?? 0) + contribution;
    nextState.actedThisRoundByUserId[userId] = true;
  }

  recomputeToCall(nextState);
  if (normalizedAction === "CALL" && toCall > 0 && isBettingClosed(nextState)) {
    nextState.turnUserId = null;
  } else {
    nextState.turnUserId = resolveNextTurnUserId(nextState, userId);
  }

  return {
    ok: true,
    action: normalizedAction,
    state: nextState
  };
}
