import { createDeck, dealCommunity, dealHoleCards, shuffle } from "./poker-engine.mjs";
import { isPlainObject } from "./poker-state-utils.mjs";

// =============================================================================
// HAND LIFECYCLE CONTRACT (ENGINE ↔ UI)
//
// The poker engine resets hands AUTOMATICALLY and IMMEDIATELY after:
// - phase === "HAND_DONE"
//
// Showdown settlement is materialized separately and persisted as phase === "SETTLED".
// SETTLED transitions to the next hand through advanceIfNeeded() using existing hand-reset logic.
//
// UI MUST assume that finished-hand states are transient.
// Any delays, animations, summaries (e.g. "You won X") or countdowns
// must be handled entirely client-side.
//
// Turn timers are authoritative server-side. UI may display a shorter
// visible timer, but the engine will auto-apply actions on timeout.
//
// This behavior is intentional to prevent inactive or lagging players
// from blocking the table.
// =============================================================================

const TURN_MS = 20000;

const copyMap = (value) => ({ ...(value || {}) });

const toSafeInt = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
};

const orderSeats = (seats) =>
  (Array.isArray(seats) ? seats.slice() : []).sort((a, b) => (a?.seatNo ?? 0) - (b?.seatNo ?? 0));

const isActiveHandPhase = (phase) =>
  phase === "PREFLOP" ||
  phase === "FLOP" ||
  phase === "TURN" ||
  phase === "RIVER" ||
  phase === "SHOWDOWN" ||
  phase === "HAND_DONE";

const getSeatsForHand = (state) => {
  const seats = isActiveHandPhase(state?.phase) && Array.isArray(state?.handSeats) ? state.handSeats : state?.seats;
  return Array.isArray(seats) ? seats : [];
};

const getActiveSeats = (state) =>
  orderSeats(getSeatsForHand(state)).filter(
    (seat) =>
      seat?.userId &&
      !state.foldedByUserId?.[seat.userId] &&
      !state.leftTableByUserId?.[seat.userId] &&
      !state.sitOutByUserId?.[seat.userId]
  );

const getBettingSeats = (state) =>
  getActiveSeats(state).filter((seat) => (state.stacks?.[seat.userId] || 0) > 0);

const getNextBettingUserId = (state, fromUserId) => {
  const betting = getBettingSeats(state);
  if (betting.length === 0) return null;
  const idx = betting.findIndex((seat) => seat.userId === fromUserId);
  if (idx === -1) return betting[0].userId;
  return betting[(idx + 1) % betting.length].userId;
};

const isEligibleTurnUser = (state, userId) => {
  if (!userId) return false;
  if (state.leftTableByUserId?.[userId]) return false;
  if (state.sitOutByUserId?.[userId]) return false;
  if (state.foldedByUserId?.[userId]) return false;
  if (state.allInByUserId?.[userId]) return false;
  if ((state.stacks?.[userId] ?? 0) <= 0) return false;
  return true;
};

const getFirstBettingAfterDealer = (state) => {
  const ordered = orderSeats(getSeatsForHand(state));
  if (ordered.length === 0) return null;
  const startIndex = ordered.findIndex((seat) => seat.seatNo === state.dealerSeatNo);
  const start = startIndex >= 0 ? startIndex : 0;
  for (let offset = 1; offset <= ordered.length; offset += 1) {
    const seat = ordered[(start + offset) % ordered.length];
    if (
      seat?.userId &&
      !state.foldedByUserId?.[seat.userId] &&
      !state.leftTableByUserId?.[seat.userId] &&
      (state.stacks?.[seat.userId] || 0) > 0
    ) {
      return seat.userId;
    }
  }
  return null;
};

const buildDefaultMap = (seats, value) =>
  orderSeats(seats).reduce((acc, seat) => {
    if (seat?.userId) acc[seat.userId] = value;
    return acc;
  }, {});

const sanitizeBoolMapBySeats = (value, seats) => {
  const source = isPlainObject(value) ? value : {};
  const out = {};
  for (const seat of orderSeats(seats)) {
    if (!seat?.userId) continue;
    if (Object.prototype.hasOwnProperty.call(source, seat.userId)) {
      out[seat.userId] = Boolean(source[seat.userId]);
    }
  }
  return out;
};

const sanitizeSitOutByUserId = (value, seats) => sanitizeBoolMapBySeats(value, seats);
const sanitizeLeftTableByUserId = (value, seats) => sanitizeBoolMapBySeats(value, seats);
const sanitizePendingAutoSitOutByUserId = (value, seats) => sanitizeBoolMapBySeats(value, seats);


const mergeSeatUniverse = (...seatLists) => {
  const byUserId = new Map();
  for (const list of seatLists) {
    for (const seat of orderSeats(list)) {
      if (!seat?.userId) continue;
      if (!byUserId.has(seat.userId)) {
        byUserId.set(seat.userId, seat);
      }
    }
  }
  return orderSeats([...byUserId.values()]);
};

const computeEligibleUserIds = ({ orderedSeats, stacks, sitOutByUserId, leftTableByUserId }) =>
  orderedSeats
    .filter((seat) => seat?.userId)
    .map((seat) => seat.userId)
    .filter(
      (userId) =>
        (stacks?.[userId] ?? 0) > 0 && !sitOutByUserId?.[userId] && !leftTableByUserId?.[userId]
    );

const rotateDealerSeatNoEligible = ({ orderedSeats, currentDealerSeatNo, stacks, sitOutByUserId, leftTableByUserId }) => {
  if (orderedSeats.length === 0) return Number.isInteger(currentDealerSeatNo) ? currentDealerSeatNo : 0;
  const startIndex = orderedSeats.findIndex((seat) => seat.seatNo === currentDealerSeatNo);
  const start = startIndex >= 0 ? startIndex : 0;
  for (let offset = 1; offset <= orderedSeats.length; offset += 1) {
    const seat = orderedSeats[(start + offset) % orderedSeats.length];
    if (!seat?.userId) continue;
    if ((stacks?.[seat.userId] ?? 0) <= 0) continue;
    if (sitOutByUserId?.[seat.userId]) continue;
    if (leftTableByUserId?.[seat.userId]) continue;
    return seat.seatNo;
  }
  return orderedSeats[0]?.seatNo ?? currentDealerSeatNo ?? 0;
};

const getFirstBettingAfterDealerEligible = ({
  orderedSeats,
  dealerSeatNo,
  stacks,
  sitOutByUserId,
  leftTableByUserId,
  foldedByUserId,
}) => {
  if (orderedSeats.length === 0) return null;
  const startIndex = orderedSeats.findIndex((seat) => seat.seatNo === dealerSeatNo);
  const start = startIndex >= 0 ? startIndex : 0;
  for (let offset = 1; offset <= orderedSeats.length; offset += 1) {
    const seat = orderedSeats[(start + offset) % orderedSeats.length];
    if (!seat?.userId) continue;
    if ((stacks?.[seat.userId] ?? 0) <= 0) continue;
    if (sitOutByUserId?.[seat.userId]) continue;
    if (leftTableByUserId?.[seat.userId]) continue;
    if (foldedByUserId?.[seat.userId]) continue;
    return seat.userId;
  }
  return null;
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

const makeHandId = () => {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const now = Date.now();
  const rand = Math.random().toString(16).slice(2, 10);
  return `${now}-${rand}`;
};

const computeNextDealerSeatNo = (seats, prevDealerSeatNo) => {
  const ordered = orderSeats(seats);
  const seatsWithUsers = ordered.filter((seat) => seat?.userId);
  if (seatsWithUsers.length === 0) {
    return Number.isInteger(prevDealerSeatNo) ? prevDealerSeatNo : 0;
  }
  const currentIndex = ordered.findIndex((seat) => seat?.seatNo === prevDealerSeatNo);
  if (currentIndex === -1) {
    return seatsWithUsers[0]?.seatNo ?? prevDealerSeatNo ?? 0;
  }
  for (let offset = 1; offset <= ordered.length; offset += 1) {
    const seat = ordered[(currentIndex + offset) % ordered.length];
    if (seat?.userId) return seat.seatNo;
  }
  return seatsWithUsers[0]?.seatNo ?? prevDealerSeatNo ?? 0;
};

const rotateDealerSeatNo = (state) => computeNextDealerSeatNo(state.seats, state.dealerSeatNo);

const deriveAllInByUserId = (state) => {
  const seats = getSeatsForHand(state);
  return orderSeats(seats).reduce((acc, seat) => {
    if (!seat?.userId) return acc;
    const userId = seat.userId;
    const stack = state.stacks?.[userId] ?? 0;
    acc[userId] = !state.foldedByUserId?.[userId] && stack === 0;
    return acc;
  }, {});
};

const assertPlayer = (state, userId) => {
  const seats = getSeatsForHand(state);
  if (!seats.some((seat) => seat.userId === userId)) {
    throw new Error("invalid_player");
  }
  if (state.foldedByUserId?.[userId]) {
    throw new Error("invalid_player");
  }
};

const nextStreet = (phase) => {
  if (phase === "PREFLOP") return "FLOP";
  if (phase === "FLOP") return "TURN";
  if (phase === "TURN") return "RIVER";
  if (phase === "RIVER") return "SHOWDOWN";
  return phase;
};

const cardsToDeal = (phase) => {
  if (phase === "PREFLOP") return 3;
  if (phase === "FLOP") return 1;
  if (phase === "TURN") return 1;
  return 0;
};

const expectedCommunityCountForPhase = (phase) => {
  if (phase === "PREFLOP") return 0;
  if (phase === "FLOP") return 3;
  if (phase === "TURN") return 4;
  if (phase === "RIVER" || phase === "SHOWDOWN" || phase === "SETTLED") return 5;
  return null;
};

const assertCommunityCountForPhase = (state) => {
  const expected = expectedCommunityCountForPhase(state.phase);
  if (expected === null) return state;
  const hasCommunity = Array.isArray(state.community);
  const community = hasCommunity ? state.community : [];
  if (community.length !== expected) {
    throw new Error("invalid_state");
  }
  if (state.communityDealt !== expected || !hasCommunity) {
    return { ...state, community, communityDealt: expected };
  }
  return state;
};

const resetRoundState = (state) => ({
  ...state,
  toCallByUserId: buildDefaultMap(getSeatsForHand(state), 0),
  betThisRoundByUserId: buildDefaultMap(getSeatsForHand(state), 0),
  actedThisRoundByUserId: buildDefaultMap(getSeatsForHand(state), false),
  currentBet: 0,
  lastRaiseSize: null,
});

const stampTurnTimer = (state, nowMs) => {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const hasTurn = typeof state.turnUserId === "string" && state.turnUserId.trim();
  if (!hasTurn) {
    return { ...state, turnStartedAt: null, turnDeadlineAt: null };
  }
  const turnNo = Number.isInteger(state.turnNo) ? state.turnNo : 1;
  return { ...state, turnNo, turnStartedAt: now, turnDeadlineAt: now + TURN_MS };
};

const isBettingRoundComplete = (state) => {
  const eligible = getBettingSeats(state);
  if (eligible.length === 0) return true;
  for (const seat of eligible) {
    const userId = seat.userId;
    if (!state.actedThisRoundByUserId?.[userId]) return false;
    if ((state.toCallByUserId?.[userId] || 0) !== 0) return false;
  }
  return true;
};

const ensureEvents = (events, entry) => {
  events.push(entry);
  return events;
};

const checkHandDone = (state, events) => {
  const active = getActiveSeats(state);
  if (active.length === 1) {
    return {
      state: { ...state, phase: "HAND_DONE", turnUserId: null },
      events: ensureEvents(events, { type: "HAND_DONE", reason: "fold", winnerUserId: active[0].userId }),
    };
  }
  return { state, events };
};

const initHandState = ({ tableId, seats, stacks, rng }) => {
  const orderedSeats = orderSeats(seats);
  const deck = shuffle(createDeck(), rng || Math.random);
  const sitOutByUserId = {};
  const leftTableByUserId = {};
  const eligibleUserIds = computeEligibleUserIds({
    orderedSeats,
    stacks: copyMap(stacks),
    sitOutByUserId,
    leftTableByUserId,
  });
  const dealt = dealHoleCards(deck, eligibleUserIds);
  const dealerSeatNo = orderedSeats[0]?.seatNo ?? 0;
  const foldedByUserId = buildDefaultMap(orderedSeats, false);
  const allInByUserId = buildDefaultMap(orderedSeats, false);
  const contributionsByUserId = buildDefaultMap(orderedSeats, 0);
  const turnUserId = getFirstBettingAfterDealerEligible({
    orderedSeats,
    dealerSeatNo,
    stacks: copyMap(stacks),
    sitOutByUserId,
    leftTableByUserId,
    foldedByUserId,
  });
  const state = {
    tableId,
    phase: "PREFLOP",
    seats: orderedSeats,
    stacks: copyMap(stacks),
    pot: 0,
    community: [],
    communityDealt: 0,
    dealerSeatNo,
    turnUserId,
    holeCardsByUserId: dealt.holeCardsByUserId,
    deck: dealt.deck,
    toCallByUserId: buildDefaultMap(orderedSeats, 0),
    betThisRoundByUserId: buildDefaultMap(orderedSeats, 0),
    actedThisRoundByUserId: buildDefaultMap(orderedSeats, false),
    foldedByUserId,
    allInByUserId,
    contributionsByUserId,
    lastAggressorUserId: null,
    currentBet: 0,
    lastRaiseSize: null,
    missedTurnsByUserId: {},
    sitOutByUserId,
    pendingAutoSitOutByUserId: {},
    leftTableByUserId,
  };
  const now = Date.now();
  const nextState = stampTurnTimer({ ...state, allInByUserId: deriveAllInByUserId(state), turnNo: 1 }, now);
  return { state: nextState };
};

const resetToNextHand = (state, options = {}) => {
  const orderedSeats = orderSeats(state.seats);
  const seats = Array.isArray(state.seats) ? state.seats.slice() : [];
  const stacks = copyMap(state.stacks);
  const sitOutByUserId = sanitizeSitOutByUserId(state.sitOutByUserId, seats);
  const pendingAutoSitOutByUserId = sanitizePendingAutoSitOutByUserId(state.pendingAutoSitOutByUserId, seats);
  const nextSitOutByUserId = { ...sitOutByUserId };
  for (const [userId, pending] of Object.entries(pendingAutoSitOutByUserId)) {
    if (!pending) continue;
    nextSitOutByUserId[userId] = true;
  }
  const nextPendingAutoSitOutByUserId = {};
  const leftTableByUserId = sanitizeLeftTableByUserId(state.leftTableByUserId, seats);
  const seatedUserIds = orderedSeats.map((seat) => seat.userId).filter(Boolean);
  if (seatedUserIds.length === 0) {
    return {
      state: stampTurnTimer(
        {
          ...state,
          handSeats: null,
          sitOutByUserId: nextSitOutByUserId,
          pendingAutoSitOutByUserId: nextPendingAutoSitOutByUserId,
          missedTurnsByUserId: {},
        },
        Date.now()
      ),
      events: [{ type: "HAND_RESET_SKIPPED", reason: "not_enough_players" }],
    };
  }
  const eligibleUserIds = computeEligibleUserIds({
    orderedSeats: orderSeats(seats),
    stacks,
    sitOutByUserId: nextSitOutByUserId,
    leftTableByUserId,
  });
  if (eligibleUserIds.length < 2) {
    return {
      state: stampTurnTimer(
        {
          ...state,
          handSeats: null,
          sitOutByUserId: nextSitOutByUserId,
          pendingAutoSitOutByUserId: nextPendingAutoSitOutByUserId,
          missedTurnsByUserId: {},
        },
        Date.now()
      ),
      events: [{ type: "HAND_RESET_SKIPPED", reason: "not_enough_players" }],
    };
  }
  const dealerSeatNo = rotateDealerSeatNoEligible({
    orderedSeats,
    currentDealerSeatNo: state.dealerSeatNo,
    stacks,
    sitOutByUserId: nextSitOutByUserId,
    leftTableByUserId,
  });
  const foldedByUserId = buildDefaultMap(seats, false);
  const turnUserId = getFirstBettingAfterDealerEligible({
    orderedSeats,
    dealerSeatNo,
    stacks,
    sitOutByUserId: nextSitOutByUserId,
    leftTableByUserId,
    foldedByUserId,
  });
  if (!turnUserId) {
    return {
      state: stampTurnTimer(
        {
          ...state,
          handSeats: null,
          sitOutByUserId: nextSitOutByUserId,
          pendingAutoSitOutByUserId: nextPendingAutoSitOutByUserId,
          missedTurnsByUserId: {},
        },
        Date.now()
      ),
      events: [{ type: "HAND_RESET_SKIPPED", reason: "not_enough_players" }],
    };
  }
  const handId = makeHandId();
  const handSeed = makeHandId();
  const rng = typeof options.rng === "function" ? options.rng : Math.random;
  const deck = shuffle(createDeck(), rng);
  const dealt = dealHoleCards(deck, eligibleUserIds);
  const baseTurnNo = Number.isInteger(state.turnNo) ? state.turnNo : 0;
  const nextState = {
    tableId: state.tableId,
    phase: "PREFLOP",
    seats,
    handSeats: null,
    stacks,
    pot: 0,
    community: [],
    communityDealt: 0,
    dealerSeatNo,
    turnUserId,
    turnNo: baseTurnNo + 1,
    handId,
    handSeed,
    holeCardsByUserId: dealt.holeCardsByUserId,
    deck: dealt.deck,
    toCallByUserId: buildDefaultMap(seats, 0),
    betThisRoundByUserId: buildDefaultMap(seats, 0),
    actedThisRoundByUserId: buildDefaultMap(seats, false),
    foldedByUserId,
    contributionsByUserId: buildDefaultMap(seats, 0),
    lastAggressorUserId: null,
    lastActionRequestIdByUserId: {},
    showdown: null,
    sidePots: null,
    currentBet: 0,
    lastRaiseSize: null,
    missedTurnsByUserId: {},
    sitOutByUserId: nextSitOutByUserId,
    pendingAutoSitOutByUserId: nextPendingAutoSitOutByUserId,
    leftTableByUserId,
  };
  const nextWithAllIn = { ...nextState, allInByUserId: deriveAllInByUserId(nextState) };
  const stamped = stampTurnTimer(nextWithAllIn, Date.now());
  return {
    state: stamped,
    events: [{ type: "HAND_RESET", fromPhase: state.phase, toPhase: "PREFLOP", dealerSeatNo }],
  };
};

const getLegalActions = (state, userId) => {
  assertPlayer(state, userId);
  if (state?.leftTableByUserId?.[userId]) {
    throw new Error("invalid_player");
  }
  if (!state.turnUserId) return [];
  if (userId !== state.turnUserId) return [];
  const stack = state.stacks?.[userId] ?? 0;
  const currentBet = deriveCurrentBet(state);
  const lastRaiseSize = deriveLastRaiseSize(state, currentBet);
  const currentUserBet = state.betThisRoundByUserId?.[userId] || 0;
  const toCall = Math.max(0, currentBet - currentUserBet);
  if (stack === 0) return [];
  if (toCall > 0) {
    const actions = [
      { type: "FOLD" },
      { type: "CALL", max: stack },
    ];

    const raiseMax = stack + currentUserBet;
    const raiseMin = Math.min(currentBet + lastRaiseSize, raiseMax);

    // Only include RAISE if it is actually possible.
    if (raiseMax > currentBet) {
      actions.push({ type: "RAISE", min: raiseMin, max: raiseMax });
    }

    return actions;
  }
  return [
    { type: "CHECK" },
    { type: "BET", min: 1, max: stack },
  ];
};

const applyAction = (state, action) => {
  if (state.phase === "HAND_DONE" || state.phase === "SHOWDOWN" || state.phase === "SETTLED") {
    throw new Error("invalid_action");
  }
  if (!state.turnUserId) {
    throw new Error("invalid_action");
  }
  if (action?.userId !== state.turnUserId) {
    throw new Error("invalid_action");
  }
  assertPlayer(state, action.userId);
  const events = [{ type: "ACTION_APPLIED", action }];
  const safeSeats = Array.isArray(state.seats) ? state.seats : [];
  const missedTurnsByUserId =
    state.missedTurnsByUserId && typeof state.missedTurnsByUserId === "object" && !Array.isArray(state.missedTurnsByUserId)
      ? { ...state.missedTurnsByUserId }
      : {};
  const requestId = typeof action?.requestId === "string" ? action.requestId : "";
  const isAutoAction = requestId.startsWith("auto:");
  const sitOutByUserId = sanitizeSitOutByUserId(state.sitOutByUserId, safeSeats);
  const leftTableByUserId = sanitizeLeftTableByUserId(state.leftTableByUserId, safeSeats);
  const pendingAutoSitOutByUserId = sanitizePendingAutoSitOutByUserId(state.pendingAutoSitOutByUserId, safeSeats);
  const next = {
    ...state,
    stacks: copyMap(state.stacks),
    toCallByUserId: copyMap(state.toCallByUserId),
    betThisRoundByUserId: copyMap(state.betThisRoundByUserId),
    actedThisRoundByUserId: copyMap(state.actedThisRoundByUserId),
    foldedByUserId: copyMap(state.foldedByUserId),
    allInByUserId: copyMap(state.allInByUserId || buildDefaultMap(safeSeats, false)),
    contributionsByUserId: copyMap(state.contributionsByUserId || buildDefaultMap(safeSeats, 0)),
    community: Array.isArray(state.community) ? state.community.slice() : [],
    deck: Array.isArray(state.deck) ? state.deck.slice() : [],
    missedTurnsByUserId,
    sitOutByUserId,
    pendingAutoSitOutByUserId,
    leftTableByUserId,
  };
  const userId = action.userId;
  if (isAutoAction && ["CHECK", "FOLD"].includes(action.type)) {
    const previousMissed = toSafeInt(next.missedTurnsByUserId[userId], 0);
    next.missedTurnsByUserId[userId] = Math.max(0, previousMissed) + 1;
  } else if (["CALL", "BET", "CHECK", "RAISE"].includes(action.type)) {
    next.missedTurnsByUserId[userId] = 0;
    next.sitOutByUserId[userId] = false;
    if (next.pendingAutoSitOutByUserId) {
      delete next.pendingAutoSitOutByUserId[userId];
    }
  }
  const roundCurrentBet = deriveCurrentBet(next);
  const roundLastRaiseSize = deriveLastRaiseSize(next, roundCurrentBet);
  const currentBet = next.betThisRoundByUserId[userId] || 0;
  const toCall = Math.max(0, roundCurrentBet - currentBet);
  const stack = next.stacks[userId] ?? 0;

  if (action.type === "FOLD") {
    next.foldedByUserId[userId] = true;
  } else if (action.type === "CHECK") {
    if (toCall > 0) throw new Error("invalid_action");
  } else if (action.type === "CALL") {
    if (toCall === 0) throw new Error("invalid_action");
    const pay = Math.min(toCall, stack);
    next.stacks[userId] = stack - pay;
    next.betThisRoundByUserId[userId] = currentBet + pay;
    next.pot += pay;
    next.contributionsByUserId[userId] = (next.contributionsByUserId[userId] || 0) + pay;
    next.toCallByUserId[userId] = 0;
  } else if (action.type === "BET") {
    if (toCall > 0) throw new Error("invalid_action");
    const amount = Number(action.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > stack) throw new Error("invalid_action");
    next.stacks[userId] = stack - amount;
    next.betThisRoundByUserId[userId] = currentBet + amount;
    next.pot += amount;
    next.contributionsByUserId[userId] = (next.contributionsByUserId[userId] || 0) + amount;
    next.currentBet = amount;
    next.lastRaiseSize = amount;
    next.lastAggressorUserId = userId;
    for (const seat of getActiveSeats(next)) {
      if (seat.userId !== userId) {
        next.toCallByUserId[seat.userId] = amount - (next.betThisRoundByUserId[seat.userId] || 0);
      }
    }
    next.toCallByUserId[userId] = 0;
  } else if (action.type === "RAISE") {
    if (toCall <= 0) throw new Error("invalid_action");
    const amount = Number(action.amount);
    const available = stack + currentBet;
    const rawMinRaiseTo = roundCurrentBet + roundLastRaiseSize;
    if (!Number.isFinite(amount) || amount <= roundCurrentBet || amount > available) throw new Error("invalid_action");
    const pay = amount - currentBet;
    const raiseSize = amount - roundCurrentBet;
    const isAllIn = pay >= stack;
    if (amount < rawMinRaiseTo && !isAllIn) throw new Error("invalid_action");
    next.stacks[userId] = stack - pay;
    next.betThisRoundByUserId[userId] = amount;
    next.pot += pay;
    next.contributionsByUserId[userId] = (next.contributionsByUserId[userId] || 0) + pay;
    next.currentBet = amount;
    if (raiseSize >= roundLastRaiseSize) {
      next.lastRaiseSize = raiseSize;
    } else if (next.lastRaiseSize == null) {
      next.lastRaiseSize = roundLastRaiseSize;
    }
    next.lastAggressorUserId = userId;
    for (const seat of getActiveSeats(next)) {
      if (seat.userId !== userId) {
        next.toCallByUserId[seat.userId] = amount - (next.betThisRoundByUserId[seat.userId] || 0);
      }
    }
    next.toCallByUserId[userId] = 0;
  } else {
    throw new Error("invalid_action");
  }

  next.allInByUserId = deriveAllInByUserId(next);
  next.actedThisRoundByUserId[userId] = true;
  next.turnUserId = getNextBettingUserId(next, userId);

  const done = checkHandDone(next, events);
  const now = Date.now();
  const baseTurnNo = Number.isInteger(state.turnNo) ? state.turnNo : 0;
  let updated = { ...done.state, turnNo: baseTurnNo };
  if (updated.turnUserId) {
    updated = stampTurnTimer({ ...updated, turnNo: baseTurnNo + 1 }, now);
  } else {
    updated = stampTurnTimer(updated, now);
  }
  // IMPORTANT: If the action ended the hand (fold winner), keep HAND_DONE observable.
  // advanceIfNeeded() would immediately reset to next hand, which breaks reducer expectations/tests.
  if (updated.phase === "HAND_DONE") {
    return { state: updated, events: done.events };
  }

  // If this action ends betting (e.g. everyone is all-in and no one can act),
  // auto-advance streets/showdown immediately so callers don't have to.
  if (!updated.turnUserId || getBettingSeats(updated).length === 0 || isBettingRoundComplete(updated)) {
    const advanced = advanceIfNeeded(updated);
    return {
      state: advanced.state,
      events: done.events.concat(advanced.events || []),
    };
  }

  return { state: updated, events: done.events };
};

const applyLeaveTable = (state, { userId, requestId } = {}) => {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new Error("invalid_player");
  }
  const safeSeats = Array.isArray(state.seats) ? state.seats : [];
  const seatsForHand = getSeatsForHand(state);
  const sanitizeSeats = mergeSeatUniverse(seatsForHand, safeSeats);
  const userInHandSeats = seatsForHand.some((seat) => seat?.userId === userId);
  const userInTableSeats = safeSeats.some((seat) => seat?.userId === userId);
  const stackMap = copyMap(state.stacks);
  const hasStackEntry = Object.prototype.hasOwnProperty.call(stackMap, userId);
  const alreadyLeft = !!state.leftTableByUserId?.[userId];
  if (!userInHandSeats && !userInTableSeats && !alreadyLeft) {
    throw new Error("invalid_player");
  }
  if (alreadyLeft && !userInHandSeats && !userInTableSeats && !hasStackEntry) {
    return { state, events: [] };
  }
  const sitOutByUserId = sanitizeSitOutByUserId(state.sitOutByUserId, sanitizeSeats);
  const leftTableByUserId = sanitizeLeftTableByUserId(state.leftTableByUserId, sanitizeSeats);
  const pendingAutoSitOutByUserId = sanitizePendingAutoSitOutByUserId(state.pendingAutoSitOutByUserId, sanitizeSeats);
  const missedTurnsByUserId =
    state.missedTurnsByUserId && typeof state.missedTurnsByUserId === "object" && !Array.isArray(state.missedTurnsByUserId)
      ? { ...state.missedTurnsByUserId }
      : {};
  const next = {
    ...state,
    seats: safeSeats.filter((seat) => seat?.userId !== userId),
    stacks: stackMap,
    toCallByUserId: copyMap(state.toCallByUserId),
    betThisRoundByUserId: copyMap(state.betThisRoundByUserId),
    actedThisRoundByUserId: copyMap(state.actedThisRoundByUserId),
    foldedByUserId: copyMap(state.foldedByUserId),
    allInByUserId: copyMap(state.allInByUserId || buildDefaultMap(sanitizeSeats, false)),
    contributionsByUserId: copyMap(state.contributionsByUserId || buildDefaultMap(sanitizeSeats, 0)),
    community: Array.isArray(state.community) ? state.community.slice() : [],
    deck: Array.isArray(state.deck) ? state.deck.slice() : [],
    missedTurnsByUserId,
    sitOutByUserId,
    pendingAutoSitOutByUserId,
    leftTableByUserId,
  };
  const wasParticipatingInHand =
    !next.foldedByUserId[userId] &&
    !next.leftTableByUserId[userId] &&
    !next.sitOutByUserId[userId] &&
    !next.pendingAutoSitOutByUserId?.[userId];

  next.leftTableByUserId[userId] = true;
  delete next.stacks[userId];
  next.sitOutByUserId[userId] = false;
  if (wasParticipatingInHand) {
    next.foldedByUserId[userId] = true;
    next.actedThisRoundByUserId[userId] = true;
  }
  next.missedTurnsByUserId[userId] = 0;
  if (next.pendingAutoSitOutByUserId) {
    delete next.pendingAutoSitOutByUserId[userId];
  }

  const events = [
    {
      type: "PLAYER_LEFT_TABLE",
      userId,
      reason: "manual",
      requestId: typeof requestId === "string" ? requestId : undefined,
    },
  ];

  const baseTurnNo = Number.isInteger(state.turnNo) ? state.turnNo : 0;
  const now = Date.now();
  let updated = next;
  if (state.turnUserId === userId) {
    const nextUserId = getNextBettingUserId(next, userId);
    if (nextUserId) {
      updated = stampTurnTimer({ ...next, turnUserId: nextUserId, turnNo: baseTurnNo + 1 }, now);
      events.push({ type: "TURN_SKIPPED_BY_LEAVE", fromUserId: userId, toUserId: nextUserId });
    } else {
      updated = stampTurnTimer({ ...next, turnUserId: null, turnNo: baseTurnNo }, now);
    }
  } else if (next.turnUserId && !isEligibleTurnUser(next, next.turnUserId)) {
    const fromUserId = next.turnUserId;
    const nextUserId = getNextBettingUserId(next, fromUserId);
    if (nextUserId) {
      updated = stampTurnTimer({ ...next, turnUserId: nextUserId, turnNo: baseTurnNo + 1 }, now);
    } else {
      updated = stampTurnTimer({ ...next, turnUserId: null, turnNo: baseTurnNo }, now);
    }
    events.push({ type: "TURN_FIXED_AFTER_LEAVE", fromUserId, toUserId: nextUserId });
  }

  const done = checkHandDone(updated, events);
  updated = done.state;
  if (updated.phase === "HAND_DONE") {
    return { state: stampTurnTimer(updated, now), events: done.events };
  }

  if (!updated.turnUserId || getBettingSeats(updated).length === 0 || isBettingRoundComplete(updated)) {
    const advanced = advanceIfNeeded(updated);
    return {
      state: advanced.state,
      events: done.events.concat(advanced.events || []),
    };
  }

  return { state: updated, events: done.events };
};

function advanceIfNeeded(state) {
  const events = [];
// Hand reset is automatic and immediate.
// UI must not rely on a stable "finished hand" state.
  if (state.phase === "HAND_DONE") {
    return resetToNextHand(state);
  }
  if (state.phase === "SHOWDOWN" && state.showdown) {
    return resetToNextHand(state);
  }
  if (state.phase === "SETTLED") {
    return resetToNextHand(state);
  }
  const active = getActiveSeats(state);
  const betting = getBettingSeats(state);
  if (active.length <= 1) {
    const done = checkHandDone(state, events);
    return { state: stampTurnTimer(done.state, Date.now()), events: done.events };
  }
  if (betting.length === 0) {
    const next = stampTurnTimer({ ...state, phase: "SHOWDOWN", turnUserId: null }, Date.now());
    events.push({ type: "SHOWDOWN_STARTED", reason: "no_betting_players" });
    return { state: next, events };
  }
  if (!isBettingRoundComplete(state)) return { state, events };

  if (active.some((seat) => (state.stacks?.[seat.userId] || 0) === 0)) {
    const validatedState = assertCommunityCountForPhase(state);
    const baseTurnNo = Number.isInteger(state.turnNo) ? state.turnNo : 0;
    let next = resetRoundState({ ...validatedState, turnUserId: null });
    let turnNo = baseTurnNo;
    while (next.phase !== "SHOWDOWN") {
      const from = next.phase;
      const to = nextStreet(from);
      next = resetRoundState({ ...next, phase: to, turnUserId: null });
      const n = cardsToDeal(from);
      if (n > 0) {
        const dealt = dealCommunity(next.deck || [], n);
        next = { ...next, deck: dealt.deck, community: next.community.concat(dealt.communityCards) };
        events.push({ type: "COMMUNITY_DEALT", n });
      }
      next = assertCommunityCountForPhase(next);
      turnNo += 1;
      next = resetRoundState({ ...next, turnUserId: null, turnNo });
      events.push({ type: "STREET_ADVANCED", from, to });
      if (to === "SHOWDOWN") break;
    }
    const stamped = stampTurnTimer({ ...next, turnUserId: null }, Date.now());
    return { state: stamped, events };
  }

  const validatedState = assertCommunityCountForPhase(state);
  const from = validatedState.phase;
  const to = nextStreet(from);
  const baseTurnNo = Number.isInteger(state.turnNo) ? state.turnNo : 0;
  let next = resetRoundState({ ...validatedState, phase: to, turnUserId: null });
  const orderedSeats = orderSeats(getSeatsForHand(next));
  const sitOutByUserId = sanitizeSitOutByUserId(next.sitOutByUserId, orderedSeats);
  const leftTableByUserId = sanitizeLeftTableByUserId(next.leftTableByUserId, orderedSeats);
  const turnUserId = getFirstBettingAfterDealerEligible({
    orderedSeats,
    dealerSeatNo: next.dealerSeatNo,
    stacks: next.stacks,
    sitOutByUserId,
    leftTableByUserId,
    foldedByUserId: next.foldedByUserId,
  });
  next = { ...next, sitOutByUserId, leftTableByUserId, turnUserId, turnNo: baseTurnNo + 1 };

  const n = cardsToDeal(from);
  if (n > 0) {
    const dealt = dealCommunity(next.deck || [], n);
    next = { ...next, deck: dealt.deck, community: next.community.concat(dealt.communityCards) };
    events.push({ type: "COMMUNITY_DEALT", n });
  }
  next = assertCommunityCountForPhase(next);
  events.push({ type: "STREET_ADVANCED", from, to });
  return { state: stampTurnTimer(next, Date.now()), events };
}

export {
  TURN_MS,
  computeNextDealerSeatNo,
  initHandState,
  getLegalActions,
  applyAction,
  applyLeaveTable,
  advanceIfNeeded,
  resetToNextHand as __testOnly_resetToNextHand,
  isBettingRoundComplete,
};
