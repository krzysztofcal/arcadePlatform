import { computeSharedLegalActions } from "../shared/poker-primitives.mjs";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function withoutPrivateState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return state;
  }
  const { holeCardsByUserId, deck, handSeed, ...rest } = state;
  return rest;
}


function normalizeCards(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((card) => typeof card === "string");
}

function normalizeActions(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((action) => typeof action === "string");
}

function normalizeSeatRows(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((seat) => seat && typeof seat.userId === "string" && Number.isInteger(seat.seatNo))
    .map((seat) => {
      const normalized = {
        userId: seat.userId,
        seatNo: seat.seatNo,
        status: typeof seat.status === "string" ? seat.status : "ACTIVE"
      };
      if (seat.isBot === true) normalized.isBot = true;
      if (typeof seat.botProfile === "string" && seat.botProfile) normalized.botProfile = seat.botProfile;
      if (seat.leaveAfterHand === true) normalized.leaveAfterHand = true;
      return normalized;
    });
}

function normalizeSeatDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const entries = Object.entries(value)
    .filter(([userId]) => typeof userId === "string" && userId)
    .map(([userId, details]) => [userId, {
      isBot: details?.isBot === true,
      botProfile: typeof details?.botProfile === "string" ? details.botProfile : null,
      leaveAfterHand: details?.leaveAfterHand === true
    }]);
  return Object.fromEntries(entries);
}

function normalizeStacks(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const entries = Object.entries(value).filter(([userId, amount]) => typeof userId === "string" && userId && Number.isFinite(Number(amount)));
  return Object.fromEntries(entries.map(([userId, amount]) => [userId, Number(amount)]));
}

function normalizeNumericUserMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const entries = Object.entries(value).filter(([userId, amount]) => typeof userId === "string" && userId && Number.isFinite(Number(amount)));
  return Object.fromEntries(entries.map(([userId, amount]) => [userId, Number(amount)]));
}

function normalizeLastBettingRoundActionByUserId(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const allowed = new Set(["fold", "check", "call", "raise", "all_in"]);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([userId, action]) => typeof userId === "string" && userId && typeof action === "string" && allowed.has(action))
  );
}

function normalizeMemberSeatRows(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((member) => member && typeof member.userId === "string" && Number.isInteger(member.seat))
    .map((member) => ({ userId: member.userId, seatNo: member.seat, status: "ACTIVE" }));
}

function resolvePublicSeats({ statePublic, members, coreState }) {
  const stateSeats = normalizeSeatRows(statePublic?.seats);
  const seatDetailsByUserId = normalizeSeatDetails(coreState?.seatDetailsByUserId);
  const foldedByUserId = asObject(statePublic?.foldedByUserId) || {};
  const leftTableByUserId = asObject(statePublic?.leftTableByUserId) || {};
  const baseSeats = stateSeats.length > 0 ? stateSeats : normalizeMemberSeatRows(members);
  return baseSeats.filter((seat) => leftTableByUserId[seat.userId] !== true).map((seat) => {
    const details = seatDetailsByUserId[seat.userId] || null;
    const merged = { ...seat };
    if (foldedByUserId[seat.userId] === true) {
      merged.status = "FOLDED";
    }
    if (!details) return merged;
    if (details.isBot) merged.isBot = true;
    if (details.botProfile) merged.botProfile = details.botProfile;
    if (details.leaveAfterHand) merged.leaveAfterHand = true;
    return merged;
  });
}

function resolvePublicStacks({ statePublic, coreState, seats }) {
  const stateStacks = normalizeStacks(statePublic?.stacks);
  const fallbackStacks = Object.keys(stateStacks).length > 0 ? stateStacks : normalizeStacks(coreState?.publicStacks);
  if (Object.keys(fallbackStacks).length <= 0) {
    return {};
  }
  if (!Array.isArray(seats) || seats.length <= 0) {
    return fallbackStacks;
  }
  const allowedUserIds = new Set(seats.map((seat) => seat.userId));
  return Object.fromEntries(Object.entries(fallbackStacks).filter(([userId]) => allowedUserIds.has(userId)));
}

function resolvePotTotal(statePublic) {
  if (Number.isFinite(statePublic?.potTotal)) {
    return statePublic.potTotal;
  }
  if (Number.isFinite(statePublic?.pot)) {
    return statePublic.pot;
  }
  return 0;
}

function resolveSidePots(statePublic) {
  return Array.isArray(statePublic?.sidePots) ? statePublic.sidePots : [];
}

function resolveRoundFromPhase(phase) {
  if (typeof phase !== "string") {
    return null;
  }
  if (phase === "PREFLOP" || phase === "FLOP" || phase === "TURN" || phase === "RIVER") {
    return phase;
  }
  return null;
}

function resolveTurnTimerField(value) {
  return Number.isFinite(value) ? value : null;
}

function resolveTurnTimer({ statePublic, turnUserId }) {
  const liveRound = resolveRoundFromPhase(statePublic?.phase);
  const hasTurnUser = typeof turnUserId === "string" && turnUserId.trim().length > 0;
  if (!liveRound || !hasTurnUser) {
    return { startedAt: null, deadlineAt: null };
  }
  return {
    startedAt: resolveTurnTimerField(statePublic?.turnStartedAt),
    deadlineAt: resolveTurnTimerField(statePublic?.turnDeadlineAt)
  };
}


function resolveTurnIdentity({ statePublic, turnUserId, turnSeat }) {
  const liveRound = resolveRoundFromPhase(statePublic?.phase);
  const hasTurnUser = typeof turnUserId === "string" && turnUserId.trim().length > 0;
  if (!liveRound || !hasTurnUser) {
    return { userId: null, seat: null };
  }
  return { userId: turnUserId, seat: turnSeat };
}

function normalizeShowdown(showdown) {
  if (!showdown || typeof showdown !== "object" || Array.isArray(showdown)) {
    return null;
  }
  const normalized = {
    winners: Array.isArray(showdown.winners) ? showdown.winners.filter((userId) => typeof userId === "string") : [],
    potsAwarded: Array.isArray(showdown.potsAwarded) ? showdown.potsAwarded : [],
    potAwardedTotal: Number.isFinite(showdown.potAwardedTotal)
      ? showdown.potAwardedTotal
      : Number.isFinite(showdown.potAwarded)
        ? showdown.potAwarded
        : 0,
    reason: typeof showdown.reason === "string" ? showdown.reason : null,
    handId: typeof showdown.handId === "string" ? showdown.handId : null
  };
  if (Array.isArray(showdown.revealedShowdownParticipants)) {
    normalized.revealedShowdownParticipants = showdown.revealedShowdownParticipants
      .filter((entry) => entry && typeof entry.userId === "string")
      .map((entry) => ({
        userId: entry.userId,
        holeCards: normalizeCards(entry.holeCards)
      }))
      .filter((entry) => entry.holeCards.length === 2);
  }
  return normalized;
}

function normalizeHandSettlement(handSettlement) {
  if (!handSettlement || typeof handSettlement !== "object" || Array.isArray(handSettlement)) {
    return null;
  }
  return {
    handId: typeof handSettlement.handId === "string" ? handSettlement.handId : null,
    settledAt: typeof handSettlement.settledAt === "string" ? handSettlement.settledAt : null,
    payouts: handSettlement.payouts && typeof handSettlement.payouts === "object" && !Array.isArray(handSettlement.payouts)
      ? handSettlement.payouts
      : {}
  };
}

function resolvePrivateBranch({ state, userId, youSeat }) {
  if (!Number.isInteger(youSeat)) {
    return null;
  }

  const holeCards = normalizeCards(state?.holeCardsByUserId?.[userId]);
  return {
    userId,
    seat: youSeat,
    holeCards
  };
}

function hasLeftTable(statePublic, userId) {
  if (typeof userId !== "string" || !userId) {
    return false;
  }
  const leftTableByUserId = asObject(statePublic?.leftTableByUserId) || {};
  return leftTableByUserId[userId] === true;
}

function resolveRevealedShowdownParticipants({ statePublic, state }) {
  if (statePublic?.phase !== "SETTLED") {
    return [];
  }
  if (statePublic?.showdown?.reason !== "computed") {
    return [];
  }
  const potsAwarded = Array.isArray(statePublic?.showdown?.potsAwarded) ? statePublic.showdown.potsAwarded : [];
  const comparedUserIds = [];
  const comparedUserIdSet = new Set();
  potsAwarded.forEach((pot) => {
    if (!pot || typeof pot !== "object" || !Array.isArray(pot.eligibleUserIds)) return;
    pot.eligibleUserIds.forEach((userId) => {
      if (typeof userId !== "string" || !userId || comparedUserIdSet.has(userId)) return;
      comparedUserIdSet.add(userId);
      comparedUserIds.push(userId);
    });
  });
  if (comparedUserIds.length === 0) {
    const winners = Array.isArray(statePublic?.showdown?.winners)
      ? statePublic.showdown.winners.filter((value) => typeof value === "string" && value)
      : [];
    winners.forEach((userId) => {
      if (comparedUserIdSet.has(userId)) return;
      comparedUserIdSet.add(userId);
      comparedUserIds.push(userId);
    });
  }
  if (comparedUserIds.length === 0) {
    return [];
  }
  const holeCardsByUserId = asObject(state?.holeCardsByUserId) || {};
  return comparedUserIds
    .map((userId) => ({
      userId,
      holeCards: normalizeCards(holeCardsByUserId[userId])
    }))
    .filter((entry) => entry.holeCards.length === 2);
}

export function projectRoomCoreSnapshot({ tableId, roomId, coreState, members, userId, youSeat }) {
  const state = asObject(coreState?.pokerState) || asObject(coreState?.state);
  const statePublic = state ? withoutPrivateState(state) : null;
  const publicSeats = resolvePublicSeats({ statePublic, members, coreState });
  const publicStacks = resolvePublicStacks({ statePublic, coreState, seats: publicSeats });
  const effectiveYouSeat = hasLeftTable(statePublic, userId) ? null : youSeat;

  if (!statePublic) {
    return {
      roomId,
      seats: publicSeats,
      stacks: publicStacks,
      hand: {
        handId: null,
        status: members.length > 0 ? "LOBBY" : "EMPTY",
        round: null,
        dealerSeatNo: null
      },
      board: {
        cards: []
      },
      pot: {
        total: 0,
        sidePots: []
      },
      turn: {
        userId: members[0]?.userId ?? null,
        seat: Number.isInteger(members[0]?.seat) ? members[0].seat : null,
        startedAt: null,
        deadlineAt: null
      },
      legalActions: {
        seat: null,
        actions: []
      },
      betThisRoundByUserId: {},
      committedByUserId: {},
      private: Number.isInteger(effectiveYouSeat)
        ? {
            userId,
            seat: effectiveYouSeat,
            holeCards: []
          }
        : null
    };
  }

  const turnUserId = typeof statePublic.turnUserId === "string" ? statePublic.turnUserId : null;
  const seatByUserId = asObject(coreState?.seats) || {};
  const turnSeat = Number.isInteger(seatByUserId[turnUserId]) ? seatByUserId[turnUserId] : null;
  const turnIdentity = resolveTurnIdentity({ statePublic, turnUserId, turnSeat });
  const turnTimer = resolveTurnTimer({ statePublic, turnUserId: turnIdentity.userId });
  const legalInfo = Number.isInteger(effectiveYouSeat)
    ? computeSharedLegalActions({ statePublic, userId })
    : { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null };

  const snapshot = {
    roomId: typeof statePublic.roomId === "string" ? statePublic.roomId : roomId || tableId,
    seats: publicSeats,
    stacks: publicStacks,
    hand: {
      handId: typeof statePublic.handId === "string" && statePublic.handId.trim() ? statePublic.handId : null,
      status: typeof statePublic.phase === "string" ? statePublic.phase : null,
      round: resolveRoundFromPhase(statePublic.phase),
      dealerSeatNo: Number.isInteger(statePublic.dealerSeatNo) ? statePublic.dealerSeatNo : null
    },
    board: {
      cards: normalizeCards(statePublic.community)
    },
    pot: {
      total: resolvePotTotal(statePublic),
      sidePots: resolveSidePots(statePublic)
    },
    turn: {
      userId: turnIdentity.userId,
      seat: turnIdentity.seat,
      startedAt: turnTimer.startedAt,
      deadlineAt: turnTimer.deadlineAt
    },
    legalActions: {
      seat: Number.isInteger(effectiveYouSeat) ? effectiveYouSeat : null,
      actions: Number.isInteger(effectiveYouSeat) ? normalizeActions(legalInfo.actions) : []
    },
    actionConstraints: {
      toCall: Number.isFinite(legalInfo.toCall) ? legalInfo.toCall : null,
      minRaiseTo: Number.isFinite(legalInfo.minRaiseTo) ? legalInfo.minRaiseTo : null,
      maxRaiseTo: Number.isFinite(legalInfo.maxRaiseTo) ? legalInfo.maxRaiseTo : null,
      maxBetAmount: Number.isFinite(legalInfo.maxBetAmount) ? legalInfo.maxBetAmount : null
    },
    betThisRoundByUserId: normalizeNumericUserMap(statePublic.betThisRoundByUserId),
    committedByUserId: normalizeNumericUserMap(statePublic.betThisRoundByUserId),
    lastBettingRoundActionByUserId: normalizeLastBettingRoundActionByUserId(statePublic.lastBettingRoundActionByUserId),
    private: resolvePrivateBranch({ state, userId, youSeat: effectiveYouSeat })
  };

  const showdown = normalizeShowdown(statePublic.showdown);
  if (showdown) {
    const revealedShowdownParticipants = resolveRevealedShowdownParticipants({ statePublic, state });
    if (revealedShowdownParticipants.length > 0) {
      showdown.revealedShowdownParticipants = revealedShowdownParticipants;
    }
    snapshot.showdown = showdown;
  }

  const handSettlement = normalizeHandSettlement(statePublic.handSettlement);
  if (handSettlement) {
    snapshot.handSettlement = handSettlement;
  }

  return snapshot;
}
