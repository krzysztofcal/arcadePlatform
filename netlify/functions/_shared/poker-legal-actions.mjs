const ACTION_PHASES = new Set(["PREFLOP", "FLOP", "TURN", "RIVER"]);

const toSafeInt = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
};

const maxFromMap = (value) => {
  if (!value || typeof value !== "object") return 0;
  const nums = Object.values(value)
    .map((entry) => toSafeInt(entry, 0))
    .filter((entry) => entry > 0);
  if (nums.length === 0) return 0;
  return Math.max(...nums);
};

const deriveCurrentBet = (state) => {
  const currentBet = toSafeInt(state.currentBet, null);
  if (currentBet == null || currentBet < 0) {
    return maxFromMap(state.betThisRoundByUserId);
  }
  return currentBet;
};

const deriveLastRaiseSize = (state, currentBet) => {
  const lastRaiseSize = toSafeInt(state.lastRaiseSize, null);
  if (lastRaiseSize == null || lastRaiseSize <= 0) {
    return currentBet > 0 ? currentBet : 0;
  }
  return lastRaiseSize;
};

const isActivePlayer = (state, userId) => {
  if (!state || !userId) return false;
  const folded = !!(state.foldedByUserId && state.foldedByUserId[userId]);
  const allIn = !!(state.allInByUserId && state.allInByUserId[userId]);
  return !folded && !allIn;
};

const computeLegalActions = ({ statePublic, userId } = {}) => {
  const state = statePublic || {};
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null };
  }
  const phase = typeof state.phase === "string" ? state.phase : "";
  if (!ACTION_PHASES.has(phase)) {
    return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null };
  }
  if (!userId || typeof userId !== "string") {
    return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null };
  }
  const turnUserId = typeof state.turnUserId === "string" ? state.turnUserId : "";
  if (!turnUserId || turnUserId !== userId) {
    return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null };
  }
  if (!isActivePlayer(state, userId)) {
    return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null };
  }

  const stack = toSafeInt(state.stacks?.[userId], 0);
  const currentUserBet = toSafeInt(state.betThisRoundByUserId?.[userId], 0);
  const currentBet = deriveCurrentBet(state);
  const lastRaiseSize = deriveLastRaiseSize(state, currentBet);
  const toCall = Math.max(0, currentBet - currentUserBet);
  if (stack <= 0) {
    return { actions: [], toCall, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null };
  }

  if (toCall > 0) {
    const actions = ["FOLD", "CALL"];
    const maxRaiseTo = stack + currentUserBet;
    const rawMinRaiseTo = currentBet + lastRaiseSize;
    const minRaiseTo = maxRaiseTo > 0 ? Math.min(rawMinRaiseTo, maxRaiseTo) : rawMinRaiseTo;
    if (maxRaiseTo > currentBet) actions.push("RAISE");
    return {
      actions,
      toCall,
      minRaiseTo: maxRaiseTo > currentBet ? minRaiseTo : null,
      maxRaiseTo,
      maxBetAmount: null,
    };
  }

  const actions = ["CHECK"];
  if (stack > 0) actions.push("BET");
  return { actions, toCall, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: stack };
};

const buildActionConstraints = (legalInfo) => {
  if (!legalInfo) {
    return { toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null };
  }
  const toCall = Number.isFinite(legalInfo.toCall) ? legalInfo.toCall : null;
  const minRaiseTo = Number.isFinite(legalInfo.minRaiseTo) ? legalInfo.minRaiseTo : null;
  const maxRaiseTo = Number.isFinite(legalInfo.maxRaiseTo) ? legalInfo.maxRaiseTo : null;
  const maxBetAmount = Number.isFinite(legalInfo.maxBetAmount) ? legalInfo.maxBetAmount : null;
  return { toCall, minRaiseTo, maxRaiseTo, maxBetAmount };
};

export { buildActionConstraints, computeLegalActions };
