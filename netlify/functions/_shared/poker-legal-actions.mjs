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

const computeLegalActions = ({ statePublic, privateState, userId } = {}) => {
  const state = statePublic || privateState || {};
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return { actions: [], toCall: null, minRaise: null, maxBet: null };
  }
  const phase = typeof state.phase === "string" ? state.phase : "";
  if (!ACTION_PHASES.has(phase)) {
    return { actions: [], toCall: null, minRaise: null, maxBet: null };
  }
  if (!userId || typeof userId !== "string") {
    return { actions: [], toCall: null, minRaise: null, maxBet: null };
  }
  const turnUserId = typeof state.turnUserId === "string" ? state.turnUserId : "";
  if (!turnUserId || turnUserId !== userId) {
    return { actions: [], toCall: null, minRaise: null, maxBet: null };
  }
  if (!isActivePlayer(state, userId)) {
    return { actions: [], toCall: null, minRaise: null, maxBet: null };
  }

  const stack = toSafeInt(state.stacks?.[userId], 0);
  const toCall = toSafeInt(state.toCallByUserId?.[userId], 0);
  const currentBet = toSafeInt(state.betThisRoundByUserId?.[userId], 0);
  if (stack <= 0) {
    return { actions: [], toCall, minRaise: null, maxBet: null };
  }

  if (toCall > 0) {
    const actions = ["FOLD", "CALL"];
    const minRaise = toCall + 1;
    const maxBet = stack + currentBet;
    if (maxBet >= minRaise) actions.push("RAISE");
    return { actions, toCall, minRaise: maxBet >= minRaise ? minRaise : null, maxBet };
  }

  const actions = ["CHECK"];
  if (stack > 0) actions.push("BET");
  return { actions, toCall, minRaise: null, maxBet: stack };
};

export { computeLegalActions };
