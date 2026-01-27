import { createDeck, dealCommunity, dealHoleCards, shuffle } from "./poker-engine.mjs";

const copyMap = (value) => ({ ...(value || {}) });

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
  if (phase === "RIVER" || phase === "SHOWDOWN") return 5;
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
});

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
    lastAggressorUserId: null,
  };
  return { state };
};

const getLegalActions = (state, userId) => {
  assertPlayer(state, userId);
  if (!state.turnUserId) return [];
  if (userId !== state.turnUserId) return [];
  const toCall = state.toCallByUserId?.[userId] || 0;
  const stack = state.stacks?.[userId] ?? 0;
  if (toCall > 0) {
    return [
      { type: "FOLD" },
      { type: "CALL", max: stack },
      { type: "RAISE", min: toCall + 1, max: stack + (state.betThisRoundByUserId?.[userId] || 0) },
    ];
  }
  return [
    { type: "CHECK" },
    { type: "BET", min: 1, max: stack },
  ];
};

const applyAction = (state, action) => {
  if (state.phase === "HAND_DONE" || state.phase === "SHOWDOWN") {
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
  const next = {
    ...state,
    stacks: copyMap(state.stacks),
    toCallByUserId: copyMap(state.toCallByUserId),
    betThisRoundByUserId: copyMap(state.betThisRoundByUserId),
    actedThisRoundByUserId: copyMap(state.actedThisRoundByUserId),
    foldedByUserId: copyMap(state.foldedByUserId),
    community: Array.isArray(state.community) ? state.community.slice() : [],
    deck: Array.isArray(state.deck) ? state.deck.slice() : [],
  };
  const userId = action.userId;
  const toCall = next.toCallByUserId[userId] || 0;
  const currentBet = next.betThisRoundByUserId[userId] || 0;
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
    next.toCallByUserId[userId] = 0;
  } else if (action.type === "BET") {
    if (toCall > 0) throw new Error("invalid_action");
    const amount = Number(action.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > stack) throw new Error("invalid_action");
    next.stacks[userId] = stack - amount;
    next.betThisRoundByUserId[userId] = currentBet + amount;
    next.pot += amount;
    next.lastAggressorUserId = userId;
    for (const seat of getActiveSeats(next)) {
      if (seat.userId !== userId) {
        next.toCallByUserId[seat.userId] = amount - (next.betThisRoundByUserId[seat.userId] || 0);
      }
    }
  } else if (action.type === "RAISE") {
    if (toCall <= 0) throw new Error("invalid_action");
    const amount = Number(action.amount);
    const available = stack + currentBet;
    if (!Number.isFinite(amount) || amount < toCall + 1 || amount > available) throw new Error("invalid_action");
    const pay = amount - currentBet;
    next.stacks[userId] = stack - pay;
    next.betThisRoundByUserId[userId] = amount;
    next.pot += pay;
    next.lastAggressorUserId = userId;
    for (const seat of getActiveSeats(next)) {
      if (seat.userId !== userId) {
        next.toCallByUserId[seat.userId] = amount - (next.betThisRoundByUserId[seat.userId] || 0);
      }
    }
  } else {
    throw new Error("invalid_action");
  }

  next.actedThisRoundByUserId[userId] = true;
  next.turnUserId = getNextBettingUserId(next, userId);

  const done = checkHandDone(next, events);
  return { state: done.state, events: done.events };
};

const advanceIfNeeded = (state) => {
  const events = [];
  if (state.phase === "HAND_DONE" || state.phase === "SHOWDOWN") {
    return { state, events };
  }
  const active = getActiveSeats(state);
  const betting = getBettingSeats(state);
  if (active.length <= 1) {
    const done = checkHandDone(state, events);
    return { state: done.state, events: done.events };
  }
  if (betting.length === 0) {
    const next = { ...state, phase: "SHOWDOWN", turnUserId: null };
    events.push({ type: "SHOWDOWN_STARTED", reason: "no_betting_players" });
    return { state: next, events };
  }
  if (!isBettingRoundComplete(state)) return { state, events };

  const validatedState = assertCommunityCountForPhase(state);
  const from = validatedState.phase;
  const to = nextStreet(from);
  let next = resetRoundState({ ...validatedState, phase: to, turnUserId: null });
  next = { ...next, turnUserId: getFirstBettingAfterDealer(next) };

  const n = cardsToDeal(from);
  if (n > 0) {
    const dealt = dealCommunity(next.deck || [], n);
    next = { ...next, deck: dealt.deck, community: next.community.concat(dealt.communityCards) };
    events.push({ type: "COMMUNITY_DEALT", n });
  }
  next = assertCommunityCountForPhase(next);
  events.push({ type: "STREET_ADVANCED", from, to });
  return { state: next, events };
};

export { initHandState, getLegalActions, applyAction, advanceIfNeeded, isBettingRoundComplete };
