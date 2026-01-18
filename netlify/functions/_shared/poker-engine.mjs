import { evaluateHand, compareScores } from "./poker-hand-eval.mjs";

// TODO(poker-tests): add engine tests once Vitest is available:
// - initHand sets actionRequiredFromUserId and non-empty allowedActions for the actor.
// - settlement keeps potTotal intact after SETTLED.
// - contenders predicate excludes stack <= 0 consistently for early-win and showdown.

const PHASES = ["WAITING", "PREFLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN", "SETTLED"];

const nowIso = () => new Date().toISOString();

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const normalizeState = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value;
  return {};
};

const normalizeSeatRows = (rows) =>
  Array.isArray(rows)
    ? rows
        .map((row) => {
          const seatNoRaw = row?.seat_no ?? row?.seatNo;
          const seatNo = Number(seatNoRaw);
          const stackRaw = Number(row?.stack);
          return {
            userId: row?.user_id || row?.userId || null,
            seatNo: Number.isInteger(seatNo) && seatNo >= 0 ? seatNo : null,
            status: row?.status || "ACTIVE",
            stack: Number.isFinite(stackRaw) ? stackRaw : 0,
          };
        })
        .filter((row) => row.userId && Number.isInteger(row.seatNo))
    : [];

const buildDeck = () => {
  const suits = ["c", "d", "h", "s"];
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  const deck = [];
  for (const r of ranks) {
    for (const s of suits) {
      deck.push(`${r}${s}`);
    }
  }
  return deck;
};

const mulberry32 = (seed) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffleDeck = (deck, seed) => {
  const rand = mulberry32(seed);
  const copy = deck.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
};

const getDeckForHand = (deckSeed) => {
  const seed = Number.isFinite(Number(deckSeed)) ? Number(deckSeed) : 0;
  return shuffleDeck(buildDeck(), seed);
};

const nextSeatFrom = (seatNos, current) => {
  if (!seatNos.length) return null;
  const idx = seatNos.indexOf(current);
  if (idx < 0) return seatNos[0];
  return seatNos[(idx + 1) % seatNos.length];
};

const buildPublicSeats = (seats, stacks, bets, folded, allIn, statuses) =>
  seats.map((seat) => ({
    userId: seat.userId,
    seatNo: seat.seatNo,
    status: statuses?.[seat.userId] || seat.status || "ACTIVE",
    stack: Number.isFinite(stacks?.[seat.userId]) ? stacks[seat.userId] : 0,
    betThisStreet: Number.isFinite(bets?.[seat.userId]) ? bets[seat.userId] : 0,
    hasFolded: !!folded?.[seat.userId],
    isAllIn: !!allIn?.[seat.userId],
  }));

const getSeatNos = (publicSeats) => publicSeats.map((seat) => seat.seatNo).sort((a, b) => a - b);

const buildAllowedActions = (seat, state) => {
  if (!seat || seat.hasFolded || seat.isAllIn || seat.stack <= 0) return [];
  if (state.actionRequiredFromUserId !== seat.userId) return [];
  const streetBet = Math.max(0, Number(state.streetBet) || 0);
  const betThisStreet = Math.max(0, Number(seat.betThisStreet) || 0);
  const toCall = Math.max(0, streetBet - betThisStreet);
  const minRaiseTo = Number.isFinite(state.minRaiseTo) ? state.minRaiseTo : 0;
  const bbAmount = Math.max(1, Number(state.bbAmount) || 0);
  const raiseClosed = !!state.raiseClosed;
  const actions = ["FOLD"];
  if (toCall === 0) actions.push("CHECK");
  if (toCall > 0 && seat.stack > 0) actions.push("CALL");
  if (streetBet === 0 && seat.stack > 0) actions.push("BET");
  if (!raiseClosed && streetBet > 0 && minRaiseTo > streetBet) {
    const maxToBet = betThisStreet + seat.stack;
    if (maxToBet > streetBet) actions.push("RAISE");
  }
  return actions;
};

const advanceActor = (publicSeats, currentActorSeat) => {
  const seatNos = getSeatNos(publicSeats);
  if (!seatNos.length) return null;
  let nextSeat = nextSeatFrom(seatNos, currentActorSeat);
  let safety = 0;
  while (safety < seatNos.length) {
    const seat = publicSeats.find((s) => s.seatNo === nextSeat);
    if (seat && canAct(seat)) return seat.seatNo;
    nextSeat = nextSeatFrom(seatNos, nextSeat);
    safety += 1;
  }
  return null;
};

const resetStreetBets = (publicSeats) => {
  const bets = {};
  for (const seat of publicSeats) bets[seat.userId] = 0;
  return bets;
};

const resolveClosingSeat = (publicSeats, preferredSeat) => {
  const activeSeatNos = publicSeats.filter((seat) => canAct(seat)).map((seat) => seat.seatNo);
  if (activeSeatNos.includes(preferredSeat)) return preferredSeat;
  if (!activeSeatNos.length) return null;
  const seatNos = getSeatNos(publicSeats);
  const startIndex = seatNos.indexOf(preferredSeat);
  if (startIndex >= 0) {
    for (let i = 1; i <= seatNos.length; i += 1) {
      const idx = (startIndex - i + seatNos.length) % seatNos.length;
      const candidate = seatNos[idx];
      if (activeSeatNos.includes(candidate)) return candidate;
    }
  }
  return activeSeatNos.length ? activeSeatNos[activeSeatNos.length - 1] : preferredSeat;
};

const isInHand = (seat) => !!(seat && !seat.hasFolded && seat.status === "ACTIVE" && seat.userId);

const canAct = (seat) => !!(seat && !seat.hasFolded && !seat.isAllIn && seat.stack > 0);

const initActedThisStreet = (publicSeats) => {
  const acted = {};
  publicSeats.forEach((seat) => {
    if (isInHand(seat)) {
      acted[seat.seatNo] = !!seat.isAllIn;
    }
  });
  return acted;
};

const markAllAwaitingResponse = (publicSeats, aggressorSeatNo) => {
  const acted = {};
  publicSeats.forEach((seat) => {
    if (isInHand(seat)) {
      acted[seat.seatNo] = seat.seatNo === aggressorSeatNo || seat.isAllIn;
    }
  });
  return acted;
};

const allSettled = (publicSeats, streetBet) =>
  publicSeats.every((seat) => !isInHand(seat) || seat.isAllIn || (seat.betThisStreet || 0) >= streetBet);

const allActed = (publicSeats, actedThisStreet) =>
  publicSeats.every((seat) => !isInHand(seat) || seat.isAllIn || actedThisStreet?.[seat.seatNo]);

const startStreetState = ({ state, publicSeats, streetNo, actorSeat, closingSeat, bbAmount }) => {
  const nextSeats = publicSeats.map((seat) => ({ ...seat, betThisStreet: 0 }));
  state.streetBet = 0;
  state.minRaiseTo = bbAmount;
  state.lastFullRaiseSize = bbAmount;
  state.raiseClosed = false;
  state.streetNo = streetNo;
  state.bbAmount = bbAmount;
  state.public = { ...(state.public || {}), seats: nextSeats };
  state.lastAggressorSeat = null;
  state.closingSeat = resolveClosingSeat(nextSeats, closingSeat);
  state.actedThisStreet = initActedThisStreet(nextSeats);
  state.actorSeat = actorSeat;
  const actor = nextSeats.find((seat) => seat.seatNo === actorSeat);
  state.actionRequiredFromUserId = actor ? actor.userId : null;
  state.allowedActions = actor ? buildAllowedActions(actor, state) : [];
  return nextSeats;
};

const initHand = ({ tableId, seats, stacks, stakes, prevState }) => {
  const activeSeats = seats.filter((seat) => seat.status === "ACTIVE" && (stacks?.[seat.userId] || 0) > 0);
  if (activeSeats.length < 2) return { ok: false, error: "not_enough_players" };
  const seatNos = activeSeats.map((s) => s.seatNo).sort((a, b) => a - b);
  const prevDealer = Number.isInteger(prevState?.dealerSeat) ? prevState.dealerSeat : null;
  const dealerSeat = prevDealer != null ? nextSeatFrom(seatNos, prevDealer) : seatNos[0];
  const sbSeat = nextSeatFrom(seatNos, dealerSeat);
  const bbSeat = nextSeatFrom(seatNos, sbSeat);
  const actorSeat = nextSeatFrom(seatNos, bbSeat);
  const handNo = Number.isFinite(prevState?.handNo) ? prevState.handNo + 1 : 1;
  const handId = `hand_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const seed = Math.floor(Math.random() * 1e9);
  const deck = getDeckForHand(seed);
  const holeCards = {};
  const bets = {};
  const folded = {};
  const orderedSeats = activeSeats.slice().sort((a, b) => a.seatNo - b.seatNo);
  let deckIndex = 0;
  for (const seat of orderedSeats) {
    holeCards[seat.userId] = [deck[deckIndex], deck[deckIndex + 1]];
    deckIndex += 2;
    bets[seat.userId] = 0;
    folded[seat.userId] = false;
  }
  const sbAmount = Math.max(1, Number(stakes?.sb) || 1);
  const bbAmount = Math.max(sbAmount * 2, Number(stakes?.bb) || sbAmount * 2);
  const sbStack = stacks?.[activeSeats.find((s) => s.seatNo === sbSeat)?.userId] || 0;
  const bbStack = stacks?.[activeSeats.find((s) => s.seatNo === bbSeat)?.userId] || 0;
  if (sbStack < sbAmount || bbStack < bbAmount) {
    return { ok: false, error: "insufficient_blind_stack" };
  }
  const stacksCopy = { ...stacks };
  const postBlind = (seatNo, amount) => {
    const seat = activeSeats.find((s) => s.seatNo === seatNo);
    if (!seat) return 0;
    const stack = Number.isFinite(stacksCopy[seat.userId]) ? stacksCopy[seat.userId] : 0;
    const pay = Math.min(stack, amount);
    stacksCopy[seat.userId] = stack - pay;
    bets[seat.userId] = (bets[seat.userId] || 0) + pay;
    return pay;
  };
  const contrib = activeSeats.reduce((acc, seat) => {
    acc[seat.userId] = 0;
    return acc;
  }, {});
  const sbPaid = postBlind(sbSeat, sbAmount);
  const bbPaid = postBlind(bbSeat, bbAmount);
  const allIn = {};
  const recordBlind = (seatNo, paid) => {
    const seat = activeSeats.find((s) => s.seatNo === seatNo);
    if (!seat) return;
    contrib[seat.userId] = (contrib[seat.userId] || 0) + paid;
    if ((stacksCopy[seat.userId] || 0) <= 0) allIn[seat.userId] = true;
  };
  recordBlind(sbSeat, sbPaid);
  recordBlind(bbSeat, bbPaid);
  const potTotal = sbPaid + bbPaid;
  const publicSeats = buildPublicSeats(activeSeats, stacksCopy, bets, folded, allIn, {});
  const actorSeatResolved = advanceActor(publicSeats, actorSeat);
  const actionSeat = actorSeatResolved != null ? actorSeatResolved : actorSeat;
  const actorUser = publicSeats.find((s) => s.seatNo === actionSeat);
  const streetBet = bbPaid;
  const actedThisStreet = initActedThisStreet(publicSeats);
  const state = {
    tableId,
    handId,
    handNo,
    phase: "PREFLOP",
    streetNo: 0,
    dealerSeat,
    sbSeat,
    bbSeat,
    actorSeat: actionSeat,
    closingSeat: resolveClosingSeat(publicSeats, bbSeat),
    lastAggressorSeat: bbSeat,
    actedThisStreet,
    deckSeed: seed,
    deckIndex,
    board: [],
    public: { seats: publicSeats },
    stacks: stacksCopy,
    potTotal,
    sidePots: null,
    streetBet,
    minRaiseTo: streetBet + bbAmount,
    lastFullRaiseSize: bbAmount,
    raiseClosed: false,
    sbAmount,
    bbAmount,
    contrib,
    actionRequiredFromUserId: actorUser ? actorUser.userId : null,
    allowedActions: [],
    lastMoveAt: nowIso(),
    updatedAt: nowIso(),
  };
  if (actorUser) {
    state.allowedActions = buildAllowedActions(actorUser, state);
  }
  return {
    ok: true,
    state,
    holeCards,
  };
};

const buildSidePots = (contrib, publicSeats) => {
  const totals = publicSeats
    .map((seat) => ({
      userId: seat.userId,
      contrib: Number.isFinite(contrib?.[seat.userId]) ? contrib[seat.userId] : 0,
      hasFolded: !!seat.hasFolded,
    }))
    .filter((seat) => seat.contrib > 0);
  if (!totals.length) return [];
  const levels = [...new Set(totals.map((seat) => seat.contrib))].sort((a, b) => a - b);
  let prev = 0;
  const pots = [];
  for (const level of levels) {
    const participants = totals.filter((seat) => seat.contrib >= level);
    const layerSize = level - prev;
    if (layerSize <= 0) continue;
    const amount = layerSize * participants.length;
    const eligibleUserIds = participants.filter((seat) => !seat.hasFolded).map((seat) => seat.userId);
    pots.push({ amount, eligibleUserIds });
    prev = level;
  }
  return pots;
};

const settleHand = (state, stacks, holeCards) => {
  const publicSeats = state.public?.seats || [];
  const active = publicSeats.filter((seat) => isInHand(seat));
  if (active.length === 1) {
    const winner = active[0];
    stacks[winner.userId] = (stacks[winner.userId] || 0) + (state.potTotal || 0);
    return { winners: [winner.userId], stacks, revealed: {}, sidePots: [] };
  }
  const board = state.board || [];
  const sidePots = buildSidePots(state.contrib, publicSeats);
  const revealed = {};
  const winners = new Set();
  for (const pot of sidePots) {
    if (!pot.eligibleUserIds?.length) continue;
    let bestScore = null;
    let potWinners = [];
    for (const userId of pot.eligibleUserIds) {
      const hole = holeCards?.[userId] || [];
      const score = evaluateHand([...board, ...hole]);
      if (!score) continue;
      if (!bestScore || compareScores(score.score, bestScore.score) > 0) {
        bestScore = score;
        potWinners = [userId];
      } else if (compareScores(score.score, bestScore.score) === 0) {
        potWinners.push(userId);
      }
    }
    const share = potWinners.length ? Math.floor(pot.amount / potWinners.length) : 0;
    const remainder = potWinners.length ? pot.amount - share * potWinners.length : 0;
    potWinners.forEach((userId, idx) => {
      stacks[userId] = (stacks[userId] || 0) + share + (idx === 0 ? remainder : 0);
      winners.add(userId);
      revealed[userId] = holeCards?.[userId] || [];
    });
  }
  return { winners: [...winners], stacks, revealed, sidePots };
};

const cleanStateForNextHand = (state) => ({
  tableId: state.tableId,
  handId: null,
  handNo: state.handNo || 0,
  phase: "WAITING",
  dealerSeat: state.dealerSeat,
  sbSeat: null,
  bbSeat: null,
  actorSeat: null,
  deckSeed: null,
  deckIndex: 0,
  board: [],
  public: state.public,
  potTotal: 0,
  sidePots: null,
  streetBet: 0,
  minRaiseTo: 0,
  sbAmount: 0,
  bbAmount: 0,
  lastFullRaiseSize: 0,
  raiseClosed: false,
  contrib: {},
  actionRequiredFromUserId: null,
  allowedActions: [],
  lastMoveAt: nowIso(),
  updatedAt: nowIso(),
});

const toPublicState = (state, currentUserId) => {
  // TODO(poker-compat): currentUserId is reserved for per-user filtering.
  if (!state || !isPlainObject(state)) return {};
  const publicState = { ...state };
  delete publicState.deck;
  delete publicState.hole;
  delete publicState.actedThisStreet;
  delete publicState.closingSeat;
  delete publicState.lastAggressorSeat;
  delete publicState.deckSeed;
  delete publicState.deckIndex;
  delete publicState.contrib;
  delete publicState.lastFullRaiseSize;
  delete publicState.raiseClosed;
  return publicState;
};

const applyAction = ({ currentState, actionType, amount, userId, stakes, holeCards }) => {
  const state = normalizeState(currentState);
  // Clone public seats so applyAction can safely mutate in-place.
  let publicSeats = Array.isArray(state.public?.seats) ? state.public.seats.map((s) => ({ ...s })) : [];
  // TODO(poker-compat): remove legacy state.seats fallback after one release.
  if (!publicSeats.length && Array.isArray(state.seats)) {
    const stacks = state.stacks || {};
    publicSeats = state.seats.map((seat) => ({
      userId: seat.userId,
      seatNo: seat.seatNo,
      status: "ACTIVE",
      stack: Number.isFinite(stacks?.[seat.userId]) ? stacks[seat.userId] : 0,
      betThisStreet: 0,
      hasFolded: false,
      isAllIn: false,
    }));
  }
  if (!state.public) state.public = { seats: publicSeats };
  if (!state.actedThisStreet || typeof state.actedThisStreet !== "object") {
    state.actedThisStreet = initActedThisStreet(publicSeats);
  }
  const bbAmount = Number.isFinite(state.bbAmount) ? state.bbAmount : Math.max(1, Number(stakes?.bb) || 2);
  if (!Number.isFinite(state.bbAmount)) state.bbAmount = bbAmount;
  if (!Number.isFinite(state.lastFullRaiseSize)) state.lastFullRaiseSize = bbAmount;
  if (state.raiseClosed == null) state.raiseClosed = false;
  if (state.lastAggressorSeat == null) state.lastAggressorSeat = null;
  if (state.closingSeat == null) {
    const defaultClosing = state.phase === "PREFLOP" ? state.bbSeat : state.dealerSeat;
    state.closingSeat = resolveClosingSeat(publicSeats, defaultClosing);
  }
  if (!Number.isFinite(state.streetNo)) {
    state.streetNo = state.phase === "PREFLOP" ? 0 : state.phase === "FLOP" ? 1 : state.phase === "TURN" ? 2 : state.phase === "RIVER" ? 3 : null;
  }
  const actorSeat = publicSeats.find((seat) => seat.userId === userId);
  if (!actorSeat) return { ok: false, error: "not_seated" };
  const actedSeatNo = actorSeat.seatNo;
  if (state.actionRequiredFromUserId !== userId) return { ok: false, error: "not_your_turn" };
  if (actorSeat.hasFolded || actorSeat.isAllIn || actorSeat.stack <= 0) {
    return { ok: false, error: "cannot_act" };
  }
  if (state.phase === "WAITING" || state.phase === "INIT" || state.phase === "SETTLED") {
    return { ok: false, error: "hand_not_active" };
  }
  if (!PHASES.includes(state.phase)) return { ok: false, error: "invalid_phase" };
  if (!state.contrib) return { ok: false, error: "state_invalid" };

  const streetBet = Number.isFinite(state.streetBet) ? state.streetBet : 0;
  const betThisStreet = Number.isFinite(actorSeat.betThisStreet) ? actorSeat.betThisStreet : 0;
  const stack = Number.isFinite(actorSeat.stack) ? actorSeat.stack : 0;
  const toCall = Math.max(0, streetBet - betThisStreet);
  const normalizedAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;

  if (actionType === "CHECK") {
    if (toCall !== 0) return { ok: false, error: "cannot_check" };
    state.actedThisStreet[actorSeat.seatNo] = true;
  } else if (actionType === "CALL") {
    if (toCall <= 0) return { ok: false, error: "cannot_call" };
    const pay = Math.min(stack, toCall);
    if (pay <= 0) return { ok: false, error: "insufficient_stack" };
    actorSeat.stack -= pay;
    actorSeat.betThisStreet += pay;
    state.potTotal += pay;
    state.contrib[actorSeat.userId] = (state.contrib[actorSeat.userId] || 0) + pay;
    if (pay < toCall) actorSeat.isAllIn = true;
    state.actedThisStreet[actorSeat.seatNo] = true;
  } else if (actionType === "BET") {
    if (streetBet > 0) return { ok: false, error: "cannot_bet" };
    if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) return { ok: false, error: "invalid_bet" };
    if (normalizedAmount < bbAmount) return { ok: false, error: "bet_too_small" };
    const toPay = normalizedAmount - betThisStreet;
    if (toPay <= 0) return { ok: false, error: "invalid_bet" };
    const prevStreetBet = state.streetBet;
    const pay = Math.min(stack, toPay);
    if (pay <= 0) return { ok: false, error: "insufficient_stack" };
    actorSeat.stack -= pay;
    actorSeat.betThisStreet += pay;
    state.potTotal += pay;
    state.contrib[actorSeat.userId] = (state.contrib[actorSeat.userId] || 0) + pay;
    if (pay < toPay) actorSeat.isAllIn = true;
    if (actorSeat.betThisStreet > prevStreetBet) {
      state.streetBet = actorSeat.betThisStreet;
      const raiseSize = state.streetBet - prevStreetBet;
      state.lastAggressorSeat = actorSeat.seatNo;
      state.actedThisStreet = markAllAwaitingResponse(publicSeats, actorSeat.seatNo);
      if (raiseSize >= state.lastFullRaiseSize) {
        state.lastFullRaiseSize = raiseSize;
        state.minRaiseTo = state.streetBet + state.lastFullRaiseSize;
        state.raiseClosed = false;
      } else {
        state.raiseClosed = true;
      }
    }
  } else if (actionType === "RAISE") {
    if (streetBet <= 0) return { ok: false, error: "cannot_raise" };
    if (!Number.isInteger(normalizedAmount) || normalizedAmount <= streetBet) return { ok: false, error: "invalid_raise" };
    const toPay = normalizedAmount - betThisStreet;
    if (toPay <= 0) return { ok: false, error: "invalid_raise" };
    const prevStreetBet = state.streetBet;
    const pay = Math.min(stack, toPay);
    if (pay <= 0) return { ok: false, error: "insufficient_stack" };
    actorSeat.stack -= pay;
    actorSeat.betThisStreet += pay;
    state.potTotal += pay;
    state.contrib[actorSeat.userId] = (state.contrib[actorSeat.userId] || 0) + pay;
    if (pay < toPay) actorSeat.isAllIn = true;
    if (actorSeat.betThisStreet > prevStreetBet) {
      state.streetBet = actorSeat.betThisStreet;
      const raiseSize = state.streetBet - prevStreetBet;
      state.lastAggressorSeat = actorSeat.seatNo;
      state.actedThisStreet = markAllAwaitingResponse(publicSeats, actorSeat.seatNo);
      if (raiseSize >= state.lastFullRaiseSize) {
        state.lastFullRaiseSize = raiseSize;
        state.minRaiseTo = state.streetBet + state.lastFullRaiseSize;
        state.raiseClosed = false;
      } else {
        state.raiseClosed = true;
      }
    } else {
      state.actedThisStreet[actorSeat.seatNo] = true;
    }
  } else if (actionType === "FOLD") {
    actorSeat.hasFolded = true;
    state.actedThisStreet[actorSeat.seatNo] = true;
  } else {
    return { ok: false, error: "invalid_action" };
  }

  const closingSeatBeforeRepair = state.closingSeat;
  if (!canAct(publicSeats.find((seat) => seat.seatNo === state.closingSeat))) {
    state.closingSeat = resolveClosingSeat(publicSeats, state.closingSeat);
  }

  const remaining = publicSeats.filter((seat) => isInHand(seat));
  if (remaining.length === 1) {
    state.phase = "SETTLED";
    const stacks = {};
    publicSeats.forEach((seat) => { stacks[seat.userId] = seat.stack; });
    const result = settleHand(state, stacks, holeCards);
    state.sidePots = result.sidePots;
    publicSeats.forEach((seat) => { seat.stack = stacks[seat.userId]; });
    state.public = { ...(state.public || {}), seats: publicSeats };
    state.stacks = publicSeats.reduce((acc, seat) => {
      acc[seat.userId] = seat.stack;
      return acc;
    }, {});
    state.actionRequiredFromUserId = null;
    state.allowedActions = [];
    state.lastMoveAt = nowIso();
    state.updatedAt = nowIso();
    state.settled = { winners: result.winners, revealed: result.revealed };
    return { ok: true, state };
  }

  const settled = allSettled(publicSeats, state.streetBet || 0);
  const acted = allActed(publicSeats, state.actedThisStreet);
  const nextSeat = advanceActor(publicSeats, state.actorSeat);
  const anyoneCanAct = publicSeats.some((seat) => isInHand(seat) && canAct(seat));
  const closingRequirementSatisfied =
    !anyoneCanAct || closingSeatBeforeRepair == null || actedSeatNo === closingSeatBeforeRepair;
  const shouldClose = settled && acted && closingRequirementSatisfied;

  if (shouldClose) {
    const deck = getDeckForHand(state.deckSeed);
    if (state.phase === "PREFLOP") {
      const startIndex = Number.isFinite(state.deckIndex) ? state.deckIndex : 0;
      state.board = [...(state.board || []), ...deck.slice(startIndex, startIndex + 3)];
      state.deckIndex = startIndex + 3;
      state.phase = "FLOP";
    } else if (state.phase === "FLOP") {
      const startIndex = Number.isFinite(state.deckIndex) ? state.deckIndex : 0;
      state.board = [...(state.board || []), ...deck.slice(startIndex, startIndex + 1)];
      state.deckIndex = startIndex + 1;
      state.phase = "TURN";
    } else if (state.phase === "TURN") {
      const startIndex = Number.isFinite(state.deckIndex) ? state.deckIndex : 0;
      state.board = [...(state.board || []), ...deck.slice(startIndex, startIndex + 1)];
      state.deckIndex = startIndex + 1;
      state.phase = "RIVER";
    } else if (state.phase === "RIVER") {
      state.phase = "SHOWDOWN";
    }
    if (state.phase === "SHOWDOWN") {
      const stacks = {};
      publicSeats.forEach((seat) => { stacks[seat.userId] = seat.stack; });
      const result = settleHand(state, stacks, holeCards);
      state.sidePots = result.sidePots;
      publicSeats.forEach((seat) => { seat.stack = stacks[seat.userId]; });
      state.public = { ...(state.public || {}), seats: publicSeats };
      state.stacks = publicSeats.reduce((acc, seat) => {
        acc[seat.userId] = seat.stack;
        return acc;
      }, {});
      state.phase = "SETTLED";
      state.actionRequiredFromUserId = null;
      state.allowedActions = [];
      state.settled = { winners: result.winners, revealed: result.revealed };
      state.lastMoveAt = nowIso();
      state.updatedAt = nowIso();
      return { ok: true, state };
    }
    const dealerSeat = state.dealerSeat;
    const nextActorSeat = advanceActor(publicSeats, dealerSeat);
    const closingSeat = resolveClosingSeat(publicSeats, dealerSeat);
    const nextSeats = startStreetState({
      state,
      publicSeats,
      streetNo: state.phase === "FLOP" ? 1 : state.phase === "TURN" ? 2 : 3,
      actorSeat: nextActorSeat,
      closingSeat: closingSeat || dealerSeat,
      bbAmount,
    });
    publicSeats = nextSeats;
    state.lastMoveAt = nowIso();
    state.updatedAt = nowIso();
    return { ok: true, state };
  }

  state.actorSeat = nextSeat;
  const nextActor = publicSeats.find((seat) => seat.seatNo === nextSeat);
  state.actionRequiredFromUserId = nextActor ? nextActor.userId : null;
  state.allowedActions = nextActor ? buildAllowedActions(nextActor, state) : [];
  state.lastMoveAt = nowIso();
  state.updatedAt = nowIso();
  state.public = { ...(state.public || {}), seats: publicSeats };
  state.stacks = publicSeats.reduce((acc, seat) => {
    acc[seat.userId] = seat.stack;
    return acc;
  }, {});
  return { ok: true, state };
};

export {
  normalizeState,
  normalizeSeatRows,
  toPublicState,
  getDeckForHand,
  initHand,
  applyAction,
  buildSidePots,
};
