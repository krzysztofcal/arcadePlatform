import { buildSidePots } from "./poker-side-pots.mjs";
import { isPlainObject } from "./poker-state-utils.mjs";

const normalizePotAmount = (value) => {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("showdown_invalid_pot");
  }
  return Math.floor(amount);
};

const normalizeSidePots = (sidePots) => {
  if (!Array.isArray(sidePots) || sidePots.length === 0) return null;
  return sidePots.map((pot) => {
    if (!isPlainObject(pot) || !Array.isArray(pot.eligibleUserIds)) {
      throw new Error("showdown_invalid_side_pots");
    }
    return {
      amount: normalizePotAmount(pot.amount),
      eligibleUserIds: pot.eligibleUserIds.slice(),
    };
  });
};

const listShowdownUserIds = (state, seatUserIdsInOrder) => {
  return seatUserIdsInOrder.filter((userId) => typeof userId === "string" && !state.foldedByUserId?.[userId]);
};

const ensureHoleCardsPresent = ({ holeCardsByUserId, userId }) => {
  const holeCards = holeCardsByUserId?.[userId];
  if (!Array.isArray(holeCards) || holeCards.length !== 2) {
    throw new Error("showdown_missing_hole_cards");
  }
  return holeCards;
};

const awardPotsAtShowdown = ({ state, seatUserIdsInOrder, computeShowdown, nowIso }) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("showdown_invalid_state");
  }
  if (!Array.isArray(seatUserIdsInOrder) || seatUserIdsInOrder.length === 0) {
    throw new Error("showdown_no_players");
  }
  if (typeof computeShowdown !== "function") {
    throw new Error("showdown_invalid_compute");
  }

  const showdownUserIds = listShowdownUserIds(state, seatUserIdsInOrder);
  if (showdownUserIds.length === 0) {
    throw new Error("showdown_no_players");
  }

  const community = Array.isArray(state.community) ? state.community.slice() : [];
  if (community.length !== 5) {
    throw new Error("showdown_invalid_community");
  }

  const holeCardsByUserId = state.holeCardsByUserId || {};
  const showdownUserIdSet = new Set(showdownUserIds);
  for (const userId of showdownUserIds) {
    ensureHoleCardsPresent({ holeCardsByUserId, userId });
  }

  let pots = normalizeSidePots(state.sidePots);
  if (!pots && isPlainObject(state.contributionsByUserId)) {
    pots = buildSidePots({ contributionsByUserId: state.contributionsByUserId, eligibleUserIds: showdownUserIds })
      .map((pot) => ({ amount: normalizePotAmount(pot.amount), eligibleUserIds: pot.eligibleUserIds.slice() }));
    if (pots.length === 0) {
      pots = null;
    }
  }
  if (!pots) {
    pots = [{ amount: normalizePotAmount(state.pot ?? 0), eligibleUserIds: showdownUserIds.slice() }];
  }

  const nextStacks = { ...state.stacks };
  const potsAwarded = [];
  const winnersUnion = new Set();
  let potAwardedTotal = 0;

  for (const pot of pots) {
    const amount = normalizePotAmount(pot.amount);
    const eligibleSet = new Set(Array.isArray(pot.eligibleUserIds) ? pot.eligibleUserIds : []);
    const eligible = seatUserIdsInOrder.filter((userId) => showdownUserIdSet.has(userId) && eligibleSet.has(userId));
    if (eligible.length === 0) continue;

    const players = eligible.map((userId) => ({ userId, holeCards: ensureHoleCardsPresent({ holeCardsByUserId, userId }) }));
    const result = computeShowdown({ community, players });
    const winners = Array.isArray(result?.winners) ? result.winners : [];
    if (winners.length === 0) {
      throw new Error("showdown_no_winners");
    }
    const winnersValid = winners.every((userId) => eligibleSet.has(userId));
    if (!winnersValid) {
      throw new Error("showdown_winners_invalid");
    }
    const winnersInSeatOrder = seatUserIdsInOrder.filter((userId) => winners.includes(userId));
    if (winnersInSeatOrder.length === 0) {
      throw new Error("showdown_winners_invalid");
    }

    const share = Math.floor(amount / winnersInSeatOrder.length);
    let remainder = amount - share * winnersInSeatOrder.length;
    for (const userId of winnersInSeatOrder) {
      const baseStack = Number(nextStacks[userId] ?? 0);
      if (!Number.isFinite(baseStack)) {
        throw new Error("showdown_invalid_stack");
      }
      const bonus = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder -= 1;
      nextStacks[userId] = baseStack + share + bonus;
      winnersUnion.add(userId);
    }

    potAwardedTotal += amount;
    potsAwarded.push({ amount, winners: winnersInSeatOrder, eligibleUserIds: eligible });
  }

  const showdownWinners = seatUserIdsInOrder.filter((userId) => winnersUnion.has(userId));
  const awardedAt = typeof nowIso === "string" ? nowIso : new Date().toISOString();
  const showdown = {
    winners: showdownWinners,
    potsAwarded,
    potAwardedTotal,
    potAwarded: potAwardedTotal,
    reason: "computed",
    awardedAt,
  };

  return {
    nextState: {
      ...state,
      stacks: nextStacks,
      pot: 0,
      showdown,
    },
    payout: {
      winners: showdownWinners,
      potsAwarded,
      potAwardedTotal,
    },
  };
};

export { awardPotsAtShowdown };
