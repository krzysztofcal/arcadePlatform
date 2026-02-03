const ACTION_PHASES = new Set(["PREFLOP", "FLOP", "TURN", "RIVER"]);

const toSafeInt = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
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
  const toCall = toSafeInt(state.toCallByUserId?.[userId], 0);
  const currentBet = toSafeInt(state.betThisRoundByUserId?.[userId], 0);
  if (stack <= 0) {
    return { actions: [], toCall, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null };
  }

  if (toCall > 0) {
    const actions = ["FOLD", "CALL"];
    // MVP placeholder: real min-raise requires tracking last raise size.
    const minRaiseTo = toCall + 1;
    const maxRaiseTo = stack + currentBet;
    if (maxRaiseTo >= minRaiseTo) actions.push("RAISE");
    return {
      actions,
      toCall,
      minRaiseTo: maxRaiseTo >= minRaiseTo ? minRaiseTo : null,
      maxRaiseTo,
      maxBetAmount: null,
    };
  }

  const actions = ["CHECK"];
  if (stack > 0) actions.push("BET");
  return { actions, toCall, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: stack };
};

export { computeLegalActions };
