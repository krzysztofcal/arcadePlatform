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
  return {
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

export function projectRoomCoreSnapshot({ tableId, roomId, coreState, members, userId, youSeat }) {
  const state = asObject(coreState?.pokerState) || asObject(coreState?.state);
  const statePublic = state ? withoutPrivateState(state) : null;

  if (!statePublic) {
    return {
      roomId,
      hand: {
        handId: null,
        status: members.length > 0 ? "LOBBY" : "EMPTY",
        round: null
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
      private: Number.isInteger(youSeat)
        ? {
            userId,
            seat: youSeat,
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
  const legalInfo = computeSharedLegalActions({ statePublic, userId });

  const snapshot = {
    roomId: typeof statePublic.roomId === "string" ? statePublic.roomId : roomId || tableId,
    hand: {
      handId: typeof statePublic.handId === "string" && statePublic.handId.trim() ? statePublic.handId : null,
      status: typeof statePublic.phase === "string" ? statePublic.phase : null,
      round: resolveRoundFromPhase(statePublic.phase)
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
      seat: Number.isInteger(youSeat) ? youSeat : null,
      actions: Number.isInteger(youSeat) ? normalizeActions(legalInfo.actions) : []
    },
    private: resolvePrivateBranch({ state, userId, youSeat })
  };

  const showdown = normalizeShowdown(statePublic.showdown);
  if (showdown) {
    snapshot.showdown = showdown;
  }

  const handSettlement = normalizeHandSettlement(statePublic.handSettlement);
  if (handSettlement) {
    snapshot.handSettlement = handSettlement;
  }

  return snapshot;
}
