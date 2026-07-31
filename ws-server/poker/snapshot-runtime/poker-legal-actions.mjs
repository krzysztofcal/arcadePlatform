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

const deriveBigBlind = (state) => {
  const bigBlind = toSafeInt(state?.bigBlind, 0);
  return bigBlind > 0 ? bigBlind : 1;
};

// A player who already acted this round may RAISE only when facing at least a
// full raise (toCall >= lastRaiseSize). Players who have not acted yet always
// retain their option. Cumulative short all-ins are handled because toCall
// grows while lastRaiseSize is only updated on full bets/raises.
const canRaise = (state, userId, toCall, lastRaiseSize) =>
  !state?.actedThisRoundByUserId?.[userId] || toCall >= lastRaiseSize;

const isActivePlayer = (state, userId) => {
  if (!state || !userId) return false;
  if (state.leftTableByUserId && state.leftTableByUserId[userId]) return false;
  if (state.sitOutByUserId && state.sitOutByUserId[userId]) return false;
  const folded = !!(state.foldedByUserId && state.foldedByUserId[userId]);
  const allIn = !!(state.allInByUserId && state.allInByUserId[userId]);
  return !folded && !allIn;
};

const computeLegalActions = ({ statePublic, userId } = {}) => {
  const state = statePublic || {};
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
  }
  const phase = typeof state.phase === "string" ? state.phase : "";
  if (!ACTION_PHASES.has(phase)) {
    return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
  }
  if (!userId || typeof userId !== "string") {
    return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
  }
  const turnUserId = typeof state.turnUserId === "string" ? state.turnUserId : "";
  if (!turnUserId) {
    return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
  }
  if (!isActivePlayer(state, userId)) {
    return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
  }

  const stack = toSafeInt(state.stacks?.[userId], 0);
  const currentUserBet = toSafeInt(state.betThisRoundByUserId?.[userId], 0);
  const currentBet = deriveCurrentBet(state);
  const lastRaiseSize = deriveLastRaiseSize(state, currentBet);
  const toCall = Math.max(0, currentBet - currentUserBet);
  if (stack <= 0) {
    return { actions: [], toCall, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
  }
  if (turnUserId !== userId) {
    return { actions: ["FOLD"], toCall, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
  }

  if (toCall > 0) {
    const actions = ["FOLD", "CALL"];
    const maxRaiseTo = stack + currentUserBet;
    const rawMinRaiseTo = currentBet + lastRaiseSize;
    const minRaiseTo = maxRaiseTo > 0 ? Math.min(rawMinRaiseTo, maxRaiseTo) : rawMinRaiseTo;
    const mayRaise = canRaise(state, userId, toCall, lastRaiseSize) && maxRaiseTo > currentBet;
    if (mayRaise) actions.push("RAISE");
    return {
      actions,
      toCall,
      minRaiseTo: mayRaise ? minRaiseTo : null,
      maxRaiseTo,
      maxBetAmount: null,
      minBetAmount: null,
    };
  }

  const actions = ["FOLD", "CHECK"];
  if (stack > 0) actions.push("BET");
  const minBetAmount = Math.min(deriveBigBlind(state), stack);
  return { actions, toCall, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: stack, minBetAmount };
};

const buildActionConstraints = (legalInfo) => {
  if (!legalInfo) {
    return { toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null, minBetAmount: null };
  }
  const toCall = Number.isFinite(legalInfo.toCall) ? legalInfo.toCall : null;
  const minRaiseTo = Number.isFinite(legalInfo.minRaiseTo) ? legalInfo.minRaiseTo : null;
  const maxRaiseTo = Number.isFinite(legalInfo.maxRaiseTo) ? legalInfo.maxRaiseTo : null;
  const maxBetAmount = Number.isFinite(legalInfo.maxBetAmount) ? legalInfo.maxBetAmount : null;
  const minBetAmount = Number.isFinite(legalInfo.minBetAmount) ? legalInfo.minBetAmount : null;
  return { toCall, minRaiseTo, maxRaiseTo, maxBetAmount, minBetAmount };
};

export { buildActionConstraints, computeLegalActions };
