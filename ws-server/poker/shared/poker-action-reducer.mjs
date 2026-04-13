import { computeSharedLegalActions } from "./poker-primitives.mjs";
import { materializeShowdownAndPayout } from "./settlement/poker-materialize-showdown.mjs";
import { awardPotsAtShowdown } from "./settlement/poker-payout.mjs";
import { computeShowdown } from "./settlement/poker-showdown.mjs";

const SUPPORTED_ACTIONS = new Set(["FOLD", "CHECK", "CALL", "BET", "RAISE"]);
const NEXT_PHASE = {
  PREFLOP: "FLOP",
  FLOP: "TURN",
  TURN: "RIVER"
};

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
    lastBettingRoundActionByUserId: { ...(state.lastBettingRoundActionByUserId || {}) },
    foldedByUserId: { ...(state.foldedByUserId || {}) },
    contributionsByUserId: { ...(state.contributionsByUserId || {}) },
    sidePots: Array.isArray(state.sidePots) ? state.sidePots.slice() : [],
    community: Array.isArray(state.community) ? state.community.slice() : [],
    deck: Array.isArray(state.deck) ? state.deck.slice() : []
  };
}

function cardCodeToCard(cardCode) {
  if (typeof cardCode !== "string") {
    return null;
  }
  const code = cardCode.trim().toUpperCase();
  if (!/^(10|[2-9TJQKA])[CDHS]$/.test(code)) {
    return null;
  }
  const suit = code.slice(-1);
  const rankCode = code.slice(0, -1);
  const rank = rankCode === "A"
    ? 14
    : rankCode === "K"
      ? 13
      : rankCode === "Q"
        ? 12
        : rankCode === "J"
          ? 11
          : rankCode === "T"
            ? 10
            : Number(rankCode);
  if (!Number.isInteger(rank) || rank < 2 || rank > 14) {
    return null;
  }
  return { r: rank, s: suit };
}

function toShowdownHoleCardsByUserId(holeCardsByUserId) {
  const entries = Object.entries(holeCardsByUserId || {});
  const normalized = {};
  for (const [userId, cards] of entries) {
    if (typeof userId !== "string") {
      continue;
    }
    if (!Array.isArray(cards)) {
      continue;
    }
    const parsed = cards.map(cardCodeToCard);
    if (parsed.length === 2 && parsed.every(Boolean)) {
      normalized[userId] = parsed;
    }
  }
  return normalized;
}

function seatUserIdsInOrder(state) {
  return orderedSeats(state).map((seat) => seat.userId);
}

function eligibleUserIdsForSettlement(state) {
  return seatUserIdsInOrder(state).filter((userId) => !state.foldedByUserId?.[userId]);
}

function settleHandState(state, nowIso) {
  const handId = typeof state.handId === "string" ? state.handId : "";
  if (!handId) {
    return state;
  }

  const materialized = materializeShowdownAndPayout({
    state: {
      ...state,
      pot: Number(state.potTotal ?? state.pot ?? 0),
      community: (state.community || []).map(cardCodeToCard).filter(Boolean)
    },
    seatUserIdsInOrder: seatUserIdsInOrder(state),
    holeCardsByUserId: toShowdownHoleCardsByUserId(state.holeCardsByUserId),
    computeShowdown,
    awardPotsAtShowdown,
    nowIso
  });

  if (!materialized?.nextState || materialized.nextState === state) {
    return state;
  }

  return {
    ...state,
    ...materialized.nextState,
    phase: "SETTLED",
    turnUserId: null,
    turnStartedAt: null,
    turnDeadlineAt: null,
    community: Array.isArray(state.community) ? state.community.slice() : [],
    holeCardsByUserId: { ...(state.holeCardsByUserId || {}) },
    deck: Array.isArray(state.deck) ? state.deck.slice() : [],
    potTotal: Number(materialized.nextState.pot ?? state.potTotal ?? 0),
    sidePots: []
  };
}

function shouldSettleByFold(state) {
  return eligibleUserIdsForSettlement(state).length <= 1;
}

function shouldSettleAtShowdown(state) {
  return state.phase === "RIVER" && isBettingClosed(state);
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

  const allMatched = active.every((seat) => Number(state.toCallByUserId?.[seat.userId] ?? 0) === 0);
  if (!allMatched) {
    return false;
  }
  if (Number(state.currentBet ?? 0) > 0) {
    return true;
  }
  return active.every((seat) => state.actedThisRoundByUserId?.[seat.userId] === true);
}

function nextPhase(phase) {
  return typeof phase === "string" ? (NEXT_PHASE[phase] ?? null) : null;
}

function revealCommunityCards(state, count) {
  const normalized = Number.isInteger(count) && count > 0 ? count : 0;
  if (normalized === 0) {
    return;
  }
  const deck = Array.isArray(state.deck) ? state.deck : [];
  const community = Array.isArray(state.community) ? state.community : [];
  const dealt = deck.slice(0, normalized);
  state.community = community.concat(dealt);
  state.deck = deck.slice(dealt.length);
  state.communityDealt = Number(state.communityDealt ?? community.length) + dealt.length;
}

function resetRoundState(state) {
  state.currentBet = 0;
  for (const seat of orderedSeats(state)) {
    const userId = seat.userId;
    state.betThisRoundByUserId[userId] = 0;
    state.toCallByUserId[userId] = 0;
    state.actedThisRoundByUserId[userId] = false;
    state.lastBettingRoundActionByUserId[userId] = null;
  }
}

function resolveLastBettingRoundAction({ action, stackAfterAction }) {
  if (action === "FOLD") {
    return "fold";
  }
  if (action === "CHECK") {
    return "check";
  }
  if (stackAfterAction <= 0) {
    return "all_in";
  }
  if (action === "CALL") {
    return "call";
  }
  if (action === "BET" || action === "RAISE") {
    return "raise";
  }
  return null;
}

function resolveStreetTurnUserId(state) {
  const seats = orderedSeats(state);
  if (seats.length === 0) {
    return null;
  }
  const dealerSeatNo = Number(state.dealerSeatNo ?? 0);
  const dealerIndex = seats.findIndex((seat) => seat.seatNo === dealerSeatNo);
  const startIndex = dealerIndex === -1 ? 0 : (dealerIndex + 1) % seats.length;
  for (let offset = 0; offset < seats.length; offset += 1) {
    const seat = seats[(startIndex + offset) % seats.length];
    if (isSelectableActor(state, seat.userId)) {
      return seat.userId;
    }
  }
  return null;
}

function advanceStreetIfClosed(state) {
  if (!isBettingClosed(state)) {
    return false;
  }
  const phase = nextPhase(state.phase);
  if (!phase) {
    state.turnUserId = null;
    return true;
  }

  state.phase = phase;
  if (phase === "FLOP") {
    revealCommunityCards(state, 3);
  } else {
    revealCommunityCards(state, 1);
  }
  resetRoundState(state);
  state.turnUserId = resolveStreetTurnUserId(state);
  return true;
}

export function applyAction({ pokerState, userId, action, amount, nowIso = "1970-01-01T00:00:00.000Z" }) {
  if (!pokerState || typeof pokerState !== "object" || Array.isArray(pokerState)) {
    return { ok: false, reason: "invalid_state" };
  }
  if (typeof pokerState.phase !== "string" || !["PREFLOP", "FLOP", "TURN", "RIVER"].includes(pokerState.phase)) {
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
  const wasOutOfTurnFold = normalizedAction === "FOLD" && nextState.turnUserId !== userId;
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
  nextState.lastBettingRoundActionByUserId[userId] = resolveLastBettingRoundAction({
    action: normalizedAction,
    stackAfterAction: Number(nextState.stacks?.[userId] ?? 0)
  });

  recomputeToCall(nextState);

  if (shouldSettleByFold(nextState)) {
    return {
      ok: true,
      action: normalizedAction,
      state: settleHandState(nextState, nowIso)
    };
  }

  if (shouldSettleAtShowdown(nextState)) {
    return {
      ok: true,
      action: normalizedAction,
      state: settleHandState(nextState, nowIso)
    };
  }

  const closedRound = advanceStreetIfClosed(nextState);
  if (wasOutOfTurnFold) {
    nextState.turnUserId = pokerState.turnUserId;
  } else if (!closedRound) {
    nextState.turnUserId = resolveNextTurnUserId(nextState, userId);
  }

  return {
    ok: true,
    action: normalizedAction,
    state: nextState
  };
}

export function applyPreflopAction(params) {
  return applyAction(params);
}
