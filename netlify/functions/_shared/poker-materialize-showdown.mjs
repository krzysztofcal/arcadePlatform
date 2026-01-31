const getHandId = (state) => (typeof state?.handId === "string" && state.handId.trim() ? state.handId.trim() : "");

const normalizeChipAmount = (name, value) => {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0 || Math.floor(amount) !== amount) {
    throw new Error(`showdown_invalid_${name}`);
  }
  return amount;
};

const normalizeSeatOrder = (seatUserIdsInOrder, state) => {
  if (Array.isArray(seatUserIdsInOrder) && seatUserIdsInOrder.length > 0) {
    const seen = new Set();
    const out = [];
    for (const raw of seatUserIdsInOrder) {
      if (typeof raw !== "string") throw new Error("showdown_invalid_seats");
      const userId = raw.trim();
      if (!userId || seen.has(userId)) throw new Error("showdown_invalid_seats");
      seen.add(userId);
      out.push(userId);
    }
    return out;
  }
  if (!Array.isArray(state?.seats)) return [];
  const ordered = state.seats.slice().sort((a, b) => Number(a?.seatNo ?? 0) - Number(b?.seatNo ?? 0));
  const out = [];
  const seen = new Set();
  for (const seat of ordered) {
    if (typeof seat?.userId !== "string") continue;
    const userId = seat.userId.trim();
    if (!userId) continue;
    if (seen.has(userId)) {
      throw new Error("showdown_invalid_seats");
    }
    seen.add(userId);
    out.push(userId);
  }
  return out;
};

const listEligibleUserIds = ({ state, seatUserIdsInOrder }) => {
  const seatOrder = normalizeSeatOrder(seatUserIdsInOrder, state);
  if (seatOrder.length === 0) {
    throw new Error("showdown_invalid_seats");
  }
  const stacks = state.stacks || {};
  const eligible = [];
  for (const userId of seatOrder) {
    if (state.foldedByUserId?.[userId]) continue;
    if (!Object.prototype.hasOwnProperty.call(stacks, userId)) continue;
    normalizeChipAmount("stack", stacks[userId]);
    eligible.push(userId);
  }
  return { eligibleUserIds: eligible, seatOrder };
};

const ensureCommunityComplete = (state) => {
  if (!Array.isArray(state.community)) {
    throw new Error("showdown_incomplete_community");
  }
  if (state.community.length > 5) {
    throw new Error("showdown_invalid_community");
  }
  if (state.community.length !== 5) {
    throw new Error("showdown_incomplete_community");
  }
  return state.community.slice();
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

  const handId = getHandId(state);
  const showdownHandId =
    typeof state.showdown?.handId === "string" && state.showdown.handId.trim() ? state.showdown.handId.trim() : "";

  if (state.showdown) {
    if (!handId) {
      return { nextState: state };
    }
    if (!showdownHandId || showdownHandId !== handId) {
      throw new Error("showdown_hand_mismatch");
    }
    if (normalizeChipAmount("pot", state.pot) > 0) {
      throw new Error("showdown_pot_not_zero");
    }
    return { nextState: state };
  }

  if (!handId) {
    throw new Error("showdown_missing_hand_id");
  }

  const { eligibleUserIds, seatOrder } = listEligibleUserIds({ state, seatUserIdsInOrder });
  if (eligibleUserIds.length === 0) {
    if (typeof klog === "function") {
      klog("poker_showdown_no_eligible", { handId: state.handId ?? null });
    }
    return { nextState: state };
  }

  if (eligibleUserIds.length === 1) {
    const winnerUserId = eligibleUserIds[0];
    const potAmount = normalizeChipAmount("pot", state.pot);
    const nextStacks = { ...state.stacks };
    nextStacks[winnerUserId] = normalizeChipAmount("stack", nextStacks[winnerUserId]) + potAmount;
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
  const community = ensureCommunityComplete(state);
  const awardResult = awardPotsAtShowdown({
    state: {
      ...state,
      community,
      communityDealt: community.length,
      holeCardsByUserId,
    },
    seatUserIdsInOrder: seatOrder,
    computeShowdown,
  });
  if (!awardResult.nextState.showdown || !Array.isArray(awardResult.nextState.showdown.winners)) {
    throw new Error("showdown_missing_result");
  }
  const nextShowdown = { ...awardResult.nextState.showdown, handId };
  return {
    nextState: {
      ...awardResult.nextState,
      pot: 0,
      showdown: nextShowdown,
    },
  };
};

export { materializeShowdownAndPayout };
