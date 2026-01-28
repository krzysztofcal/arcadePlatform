import { deriveCommunityCards } from "./poker-deal-deterministic.mjs";
import { advanceIfNeeded, applyAction } from "./poker-reducer.mjs";
import { computeShowdown } from "./poker-showdown.mjs";
import { isPlainObject } from "./poker-state-utils.mjs";

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

const allEqualNumbers = (values) => {
  if (!Array.isArray(values) || values.length === 0) return true;
  const first = values[0];
  if (!Number.isFinite(first)) return false;
  for (let i = 1; i < values.length; i += 1) {
    if (!Number.isFinite(values[i]) || values[i] !== first) return false;
  }
  return true;
};

const getTimeoutAction = (state) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  if (!state.turnUserId) return null;
  const toCall = Number(state.toCallByUserId?.[state.turnUserId] || 0);
  return { type: toCall > 0 ? "FOLD" : "CHECK", userId: state.turnUserId };
};

const ensureShowdown = ({ state, seatUserIdsInOrder }) => {
  if (state.phase !== "SHOWDOWN" || state.showdown) return state;
  const showdownUserIds = seatUserIdsInOrder.filter(
    (userId) => typeof userId === "string" && !state.foldedByUserId?.[userId]
  );
  if (showdownUserIds.length === 0) {
    throw new Error("showdown_no_players");
  }

  let showdownCommunity = Array.isArray(state.community) ? state.community.slice() : [];
  if (showdownCommunity.length > 5) {
    throw new Error("showdown_invalid_community");
  }
  if (showdownCommunity.length < 5) {
    showdownCommunity = deriveCommunityCards({
      handSeed: state.handSeed,
      seatUserIdsInOrder,
      communityDealt: 5,
    });
  }

  const players = showdownUserIds.map((userId) => {
    const holeCards = state.holeCardsByUserId?.[userId];
    if (!Array.isArray(holeCards) || holeCards.length !== 2) {
      throw new Error("showdown_missing_hole_cards");
    }
    return { userId, holeCards };
  });

  const showdownResult = computeShowdown({ community: showdownCommunity, players });
  const winners = Array.isArray(showdownResult?.winners) ? showdownResult.winners : [];
  if (winners.length === 0) {
    throw new Error("showdown_no_winners");
  }
  const winnersInSeatOrder = seatUserIdsInOrder.filter((userId) => winners.includes(userId));
  if (winnersInSeatOrder.length === 0) {
    throw new Error("showdown_winners_invalid");
  }

  const hasSidePots = Array.isArray(state.sidePots) && state.sidePots.length > 0;
  const contributions = state.contributionsByUserId;
  const hasUnequalContrib =
    isPlainObject(contributions) &&
    showdownUserIds.length > 1 &&
    !allEqualNumbers(showdownUserIds.map((userId) => Number(contributions[userId])));
  if (hasSidePots || hasUnequalContrib) {
    throw new Error("showdown_side_pots_unsupported");
  }

  const potValue = Number(state.pot ?? 0);
  if (!Number.isFinite(potValue) || potValue < 0) {
    throw new Error("showdown_invalid_pot");
  }
  const nextStacks = { ...state.stacks };
  if (potValue > 0) {
    const share = Math.floor(potValue / winnersInSeatOrder.length);
    let remainder = potValue - share * winnersInSeatOrder.length;
    for (const userId of winnersInSeatOrder) {
      const baseStack = Number(nextStacks[userId] ?? 0);
      if (!Number.isFinite(baseStack)) {
        throw new Error("showdown_invalid_stack");
      }
      const bonus = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder -= 1;
      nextStacks[userId] = baseStack + share + bonus;
    }
  }

  return {
    ...state,
    community: showdownCommunity,
    communityDealt: showdownCommunity.length,
    stacks: potValue > 0 ? nextStacks : state.stacks,
    pot: 0,
    showdown: {
      winners: winnersInSeatOrder,
      reason: "computed",
      potAwarded: potValue,
      awardedAt: new Date().toISOString(),
    },
  };
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

  if (nextState.phase === "SHOWDOWN" && !nextState.showdown) {
    const seatUserIdsInOrder = normalizeSeatOrderFromState(nextState.seats);
    if (seatUserIdsInOrder.length === 0) {
      throw new Error("showdown_no_players");
    }
    nextState = ensureShowdown({ state: nextState, seatUserIdsInOrder });
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
