const getHandId = (state) =>
  typeof state?.handId === "string" && state.handId.trim()
    ? state.handId.trim()
    : "";

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
    if (seen.has(userId)) throw new Error("showdown_invalid_seats");
    seen.add(userId);
    out.push(userId);
  }
  return out;
};

const listEligibleUserIds = ({ state, seatUserIdsInOrder }) => {
  const seatOrder = normalizeSeatOrder(seatUserIdsInOrder, state);
  if (seatOrder.length === 0) throw new Error("showdown_invalid_seats");
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
  if (!Array.isArray(state.community)) throw new Error("showdown_incomplete_community");
  if (state.community.length > 5) throw new Error("showdown_invalid_community");
  if (state.community.length !== 5) throw new Error("showdown_incomplete_community");
  return state.community.slice();
};

const copyStacks = (stacks) => {
  const source = stacks && typeof stacks === "object" && !Array.isArray(stacks) ? stacks : {};
  const out = {};
  for (const [userId, amount] of Object.entries(source)) {
    if (typeof userId !== "string" || !userId.trim()) continue;
    out[userId] = normalizeChipAmount("stack", amount);
  }
  return out;
};

const diffPayouts = (prevStacks, nextStacks) => {
  const payouts = {};
  const allUserIds = new Set([...Object.keys(prevStacks || {}), ...Object.keys(nextStacks || {})]);
  for (const userId of allUserIds) {
    const before = normalizeChipAmount("stack", prevStacks?.[userId] ?? 0);
    const after = normalizeChipAmount("stack", nextStacks?.[userId] ?? 0);
    const delta = after - before;
    if (delta < 0) throw new Error("showdown_invalid_stack_delta");
    if (delta > 0) payouts[userId] = delta;
  }
  return payouts;
};

const ensureExistingSettlementMatches = ({ state, handId }) => {
  const settlementHandId =
    typeof state?.handSettlement?.handId === "string" && state.handSettlement.handId.trim()
      ? state.handSettlement.handId.trim()
      : "";
  if (!settlementHandId || settlementHandId !== handId) {
    throw new Error("showdown_settlement_hand_mismatch");
  }
};

const finalizeSettlement = ({ state, handId, payouts, nowIso, klog }) => {
  if (state?.handSettlement) {
    ensureExistingSettlementMatches({ state, handId });
    return state;
  }
  const settledAt = typeof nowIso === "string" ? nowIso : new Date().toISOString();
  const nextState = {
    ...state,
    phase: "SETTLED",
    turnUserId: null,
    turnStartedAt: null,
    turnDeadlineAt: null,
    handSettlement: {
      handId,
      settledAt,
      payouts,
    },
  };
  if (typeof klog === "function") {
    klog("poker_hand_settled", {
      tableId: state?.tableId ?? null,
      handId,
      payouts,
    });
  }
  return nextState;
};

const materializeShowdownAndPayout = ({
  state,
  seatUserIdsInOrder,
  holeCardsByUserId,
  computeShowdown,
  awardPotsAtShowdown,
  klog,
  nowIso,
}) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return { nextState: state };

  const handId = getHandId(state);
  const showdownHandId =
    typeof state.showdown?.handId === "string" && state.showdown.handId.trim() ? state.showdown.handId.trim() : "";

  if (state.showdown) {
    if (!handId) return { nextState: state };
    if (!showdownHandId || showdownHandId !== handId) throw new Error("showdown_hand_mismatch");
    if (normalizeChipAmount("pot", state.pot) > 0) throw new Error("showdown_pot_not_zero");
    if (state.handSettlement) ensureExistingSettlementMatches({ state, handId });
    return { nextState: state };
  }

  if (!handId) throw new Error("showdown_missing_hand_id");

  const { eligibleUserIds, seatOrder } = listEligibleUserIds({ state, seatUserIdsInOrder });
  if (eligibleUserIds.length === 0) {
    if (typeof klog === "function") klog("poker_showdown_no_eligible", { handId: state.handId ?? null });
    return { nextState: state };
  }

  if (eligibleUserIds.length === 1) {
    const winnerUserId = eligibleUserIds[0];
    const potAmount = normalizeChipAmount("pot", state.pot);
    const nextStacks = { ...copyStacks(state.stacks) };
    nextStacks[winnerUserId] = normalizeChipAmount("stack", nextStacks[winnerUserId] ?? 0) + potAmount;
    const awardedAt = new Date().toISOString();
    const withShowdown = {
      ...state,
      stacks: nextStacks,
      pot: 0,
      showdown: {
        winners: [winnerUserId],
        potsAwarded: [{ amount: potAmount, winners: [winnerUserId], eligibleUserIds: [winnerUserId] }],
        potAwardedTotal: potAmount,
        potAwarded: potAmount,
        reason: "all_folded",
        awardedAt,
        handId,
      },
    };
    return {
      nextState: finalizeSettlement({
        state: withShowdown,
        handId,
        payouts: { [winnerUserId]: potAmount },
        nowIso,
        klog,
      }),
    };
  }

  if (typeof awardPotsAtShowdown !== "function") throw new Error("showdown_invalid_compute");

  const community = ensureCommunityComplete(state);
  const prevStacks = copyStacks(state.stacks);
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

  if (!awardResult?.nextState?.showdown || !Array.isArray(awardResult.nextState.showdown.winners)) {
    throw new Error("showdown_missing_result");
  }

  const nextStacks = copyStacks(awardResult.nextState.stacks);
  const payouts = diffPayouts(prevStacks, nextStacks);
  return {
    nextState: finalizeSettlement({
      state: {
        ...awardResult.nextState,
        stacks: nextStacks,
        pot: 0,
        showdown: { ...awardResult.nextState.showdown, handId },
      },
      handId,
      payouts,
      nowIso,
      klog,
    }),
  };
};

export { materializeShowdownAndPayout };
