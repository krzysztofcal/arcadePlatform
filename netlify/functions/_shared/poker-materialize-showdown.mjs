import { deriveCommunityCards } from "./poker-deal-deterministic.mjs";

const listEligibleUserIds = ({ state, seatUserIdsInOrder }) =>
  seatUserIdsInOrder.filter((userId) => typeof userId === "string" && !state.foldedByUserId?.[userId]);

const normalizePotAmount = (value) => {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("showdown_invalid_pot");
  }
  return Math.floor(amount);
};

const normalizeStack = (value) => {
  const stack = Number(value ?? 0);
  if (!Number.isFinite(stack)) {
    throw new Error("showdown_invalid_stack");
  }
  return stack;
};

const ensureCommunity = ({ state, seatUserIdsInOrder }) => {
  let community = Array.isArray(state.community) ? state.community.slice() : [];
  if (community.length > 5) {
    throw new Error("showdown_invalid_community");
  }
  if (community.length < 5) {
    if (!state.handSeed) {
      throw new Error("showdown_community_derive_failed");
    }
    community = deriveCommunityCards({
      handSeed: state.handSeed,
      seatUserIdsInOrder,
      communityDealt: 5,
    });
  }
  return community;
};

const materializeShowdownAndPayout = ({
  state,
  seatUserIdsInOrder,
  holeCardsByUserId,
  computeShowdown,
  awardPotsAtShowdown,
  klog,
}) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return { nextState: state };
  if (!Array.isArray(seatUserIdsInOrder) || seatUserIdsInOrder.length === 0) return { nextState: state };

  const eligibleUserIds = listEligibleUserIds({ state, seatUserIdsInOrder });
  if (eligibleUserIds.length === 0) {
    if (typeof klog === "function") {
      klog("poker_showdown_no_eligible", { handId: state.handId ?? null });
    }
    return { nextState: state };
  }

  const handId = typeof state.handId === "string" ? state.handId : "";

  if (eligibleUserIds.length === 1) {
    const winnerUserId = eligibleUserIds[0];
    const potAmount = normalizePotAmount(state.pot);
    const nextStacks = { ...state.stacks };
    nextStacks[winnerUserId] = normalizeStack(nextStacks[winnerUserId]) + potAmount;
    const awardedAt = new Date().toISOString();
    const showdown = {
      winners: [winnerUserId],
      potsAwarded: [
        {
          amount: potAmount,
          winners: [winnerUserId],
          eligibleUserIds: [winnerUserId],
        },
      ],
      potAwardedTotal: potAmount,
      potAwarded: potAmount,
      reason: "all_folded",
      awardedAt,
      handId,
    };
    return {
      nextState: {
        ...state,
        stacks: nextStacks,
        pot: 0,
        showdown,
      },
    };
  }

  if (typeof awardPotsAtShowdown !== "function") {
    throw new Error("showdown_invalid_compute");
  }
  const community = ensureCommunity({ state, seatUserIdsInOrder });
  const awardResult = awardPotsAtShowdown({
    state: {
      ...state,
      community,
      communityDealt: community.length,
      holeCardsByUserId,
    },
    seatUserIdsInOrder,
    computeShowdown,
  });
  const nextShowdown = awardResult.nextState.showdown
    ? { ...awardResult.nextState.showdown, handId }
    : { winners: [], reason: "computed", handId };
  return {
    nextState: {
      ...awardResult.nextState,
      pot: 0,
      showdown: nextShowdown,
    },
  };
};

export { materializeShowdownAndPayout };
