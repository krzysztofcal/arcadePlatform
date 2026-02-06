import { createDeck, dealCommunity, dealHoleCards, shuffle } from "./poker-engine.mjs";

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

const getActiveSeats = (state) =>
  orderSeats(state.seats).filter((seat) => seat?.userId && !state.foldedByUserId?.[seat.userId]);

const getBettingSeats = (state) =>
  getActiveSeats(state).filter((seat) => (state.stacks?.[seat.userId] || 0) > 0);

const getNextBettingUserId = (state, fromUserId) => {
  const betting = getBettingSeats(state);
  if (betting.length === 0) return null;
  const idx = betting.findIndex((seat) => seat.userId === fromUserId);
  if (idx === -1) return betting[0].userId;
  return betting[(idx + 1) % betting.length].userId;
};

const getFirstBettingAfterDealer = (state) => {
  const ordered = orderSeats(state.seats);
  if (ordered.length === 0) return null;
  const startIndex = ordered.findIndex((seat) => seat.seatNo === state.dealerSeatNo);
  const start = startIndex >= 0 ? startIndex : 0;
  for (let offset = 1; offset <= ordered.length; offset += 1) {
    const seat = ordered[(start + offset) % ordered.length];
    if (seat?.userId && !state.foldedByUserId?.[seat.userId] && (state.stacks?.[seat.userId] || 0) > 0) {
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
  const seats = Array.isArray(state.seats) ? state.seats : [];
  return orderSeats(seats).reduce((acc, seat) => {
    if (!seat?.userId) return acc;
    const userId = seat.userId;
    const stack = state.stacks?.[userId] ?? 0;
    acc[userId] = !state.foldedByUserId?.[userId] && stack === 0;
    return acc;
  }, {});
};

const assertPlayer = (state, userId) => {
  if (!state.seats.some((seat) => seat.userId === userId)) {
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
  toCallByUserId: buildDefaultMap(state.seats, 0),
  betThisRoundByUserId: buildDefaultMap(state.seats, 0),
  actedThisRoundByUserId: buildDefaultMap(state.seats, false),
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
  const playerIds = orderedSeats.map((seat) => seat.userId).filter(Boolean);
  const dealt = dealHoleCards(deck, playerIds);
  const dealerSeatNo = orderedSeats[0]?.seatNo ?? 0;
  const foldedByUserId = buildDefaultMap(orderedSeats, false);
  const allInByUserId = buildDefaultMap(orderedSeats, false);
  const contributionsByUserId = buildDefaultMap(orderedSeats, 0);
  const turnUserId = getFirstBettingAfterDealer({
    seats: orderedSeats,
    dealerSeatNo,
    stacks: copyMap(stacks),
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
  };
  const now = Date.now();
  const nextState = stampTurnTimer({ ...state, allInByUserId: deriveAllInByUserId(state), turnNo: 1 }, now);
  return { state: nextState };
};

const resetToNextHand = (state, options = {}) => {
  const orderedSeats = orderSeats(state.seats);
  const seats = Array.isArray(state.seats) ? state.seats.slice() : [];
  const stacks = copyMap(state.stacks);
  const seatedUserIds = orderedSeats.map((seat) => seat.userId).filter(Boolean);
  if (seatedUserIds.length === 0) {
    return {
      state: stampTurnTimer(state, Date.now()),
      events: [{ type: "HAND_RESET_SKIPPED", reason: "not_enough_players" }],
    };
  }
  const fundedUserIds = seatedUserIds.filter((userId) => (stacks?.[userId] ?? 0) > 0);
  if (fundedUserIds.length < 2) {
    return {
      state: stampTurnTimer(state, Date.now()),
      events: [{ type: "HAND_RESET_SKIPPED", reason: "not_enough_players" }],
    };
  }
  const dealerSeatNo = rotateDealerSeatNo(state);
  const foldedByUserId = buildDefaultMap(seats, false);
  const turnUserId = getFirstBettingAfterDealer({
    seats: orderedSeats,
    dealerSeatNo,
    stacks,
    foldedByUserId,
  });
  if (!turnUserId) {
    return {
      state: stampTurnTimer(state, Date.now()),
      events: [{ type: "HAND_RESET_SKIPPED", reason: "not_enough_players" }],
    };
  }
  const handId = makeHandId();
  const handSeed = makeHandId();
  const rng = typeof options.rng === "function" ? options.rng : Math.random;
  const deck = shuffle(createDeck(), rng);
  const dealt = dealHoleCards(deck, seatedUserIds);
  const baseTurnNo = Number.isInteger(state.turnNo) ? state.turnNo : 0;
  const nextState = {
    tableId: state.tableId,
    phase: "PREFLOP",
    seats,
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
  };
  const userId = action.userId;
  if (!isAutoAction && ["CALL", "BET", "CHECK", "FOLD", "RAISE"].includes(action.type)) {
    next.missedTurnsByUserId[userId] = 0;
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
  next = { ...next, turnUserId: getFirstBettingAfterDealer(next), turnNo: baseTurnNo + 1 };

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

export { TURN_MS, computeNextDealerSeatNo, initHandState, getLegalActions, applyAction, advanceIfNeeded, isBettingRoundComplete };
