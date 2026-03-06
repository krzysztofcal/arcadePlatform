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

const ACTION_PHASES = new Set(["PREFLOP", "FLOP", "TURN", "RIVER"]);

function toSafeInt(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.trunc(num);
}

function maxFromMap(value) {
  if (!value || typeof value !== "object") {
    return 0;
  }
  const nums = Object.values(value)
    .map((entry) => toSafeInt(entry, 0))
    .filter((entry) => entry > 0);
  if (nums.length === 0) {
    return 0;
  }
  return Math.max(...nums);
}

function deriveCurrentBet(state) {
  const currentBet = toSafeInt(state.currentBet, null);
  if (currentBet == null || currentBet < 0) {
    return maxFromMap(state.betThisRoundByUserId);
  }
  return currentBet;
}

function deriveLastRaiseSize(state, currentBet) {
  const lastRaiseSize = toSafeInt(state.lastRaiseSize, null);
  if (lastRaiseSize == null || lastRaiseSize <= 0) {
    return currentBet > 0 ? currentBet : 0;
  }
  return lastRaiseSize;
}

function isActivePlayer(state, userId) {
  if (!state || !userId) {
    return false;
  }
  if (state.leftTableByUserId && state.leftTableByUserId[userId]) {
    return false;
  }
  if (state.sitOutByUserId && state.sitOutByUserId[userId]) {
    return false;
  }
  const folded = !!(state.foldedByUserId && state.foldedByUserId[userId]);
  const allIn = !!(state.allInByUserId && state.allInByUserId[userId]);
  return !folded && !allIn;
}

function computeLegalActions({ statePublic, userId } = {}) {
  const state = statePublic || {};
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return { actions: [] };
  }
  const phase = typeof state.phase === "string" ? state.phase : "";
  if (!ACTION_PHASES.has(phase)) {
    return { actions: [] };
  }
  if (!userId || typeof userId !== "string") {
    return { actions: [] };
  }
  const turnUserId = typeof state.turnUserId === "string" ? state.turnUserId : "";
  if (!turnUserId || turnUserId !== userId) {
    return { actions: [] };
  }
  if (!isActivePlayer(state, userId)) {
    return { actions: [] };
  }

  const stack = toSafeInt(state.stacks?.[userId], 0);
  const currentUserBet = toSafeInt(state.betThisRoundByUserId?.[userId], 0);
  const currentBet = deriveCurrentBet(state);
  const lastRaiseSize = deriveLastRaiseSize(state, currentBet);
  const toCall = Math.max(0, currentBet - currentUserBet);
  if (stack <= 0) {
    return { actions: [], toCall };
  }

  if (toCall > 0) {
    const actions = ["FOLD", "CALL"];
    const maxRaiseTo = stack + currentUserBet;
    if (maxRaiseTo > currentBet && lastRaiseSize >= 0) {
      actions.push("RAISE");
    }
    return { actions, toCall };
  }

  const actions = ["CHECK"];
  if (stack > 0) {
    actions.push("BET");
  }
  return { actions, toCall };
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
        seat: Number.isInteger(members[0]?.seat) ? members[0].seat : null
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
  const legalInfo = computeLegalActions({ statePublic, userId });

  return {
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
      userId: turnUserId,
      seat: turnSeat
    },
    legalActions: {
      seat: Number.isInteger(youSeat) ? youSeat : null,
      actions: Number.isInteger(youSeat) ? normalizeActions(legalInfo.actions) : []
    },
    private: resolvePrivateBranch({ state, userId, youSeat })
  };
}
