import { evaluateHand, compareScores } from "./poker-hand-eval.mjs";

// TODO(poker-tests): add Vitest coverage for engine transitions once Vitest is available.

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
        .map((row) => ({
          userId: row?.user_id || row?.userId || null,
          seatNo: Number.isInteger(row?.seat_no) ? row.seat_no : row?.seatNo,
          status: row?.status || "ACTIVE",
          stack: Number.isFinite(Number(row?.stack)) ? Number(row.stack) : null,
        }))
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
  const toCall = Math.max(0, (state.streetBet || 0) - (seat.betThisStreet || 0));
  const actions = ["FOLD"];
  if (toCall === 0) actions.push("CHECK");
  if (toCall > 0 && seat.stack >= toCall) actions.push("CALL");
  if ((state.streetBet || 0) === 0 && seat.stack > 0) actions.push("BET");
  if ((state.streetBet || 0) > 0 && seat.stack > toCall) actions.push("RAISE");
  return actions;
};

const advanceActor = (publicSeats, currentActorSeat) => {
  const seatNos = getSeatNos(publicSeats);
  if (!seatNos.length) return null;
  let nextSeat = nextSeatFrom(seatNos, currentActorSeat);
  let safety = 0;
  while (safety < seatNos.length) {
    const seat = publicSeats.find((s) => s.seatNo === nextSeat);
    if (seat && !seat.hasFolded && seat.stack > 0 && !seat.isAllIn) return seat.seatNo;
    nextSeat = nextSeatFrom(seatNos, nextSeat);
    safety += 1;
  }
  return null;
};

const streetComplete = (publicSeats, streetBet) =>
  publicSeats.every((seat) => seat.hasFolded || seat.isAllIn || (seat.betThisStreet || 0) >= streetBet);

const resetStreetBets = (publicSeats) => {
  const bets = {};
  for (const seat of publicSeats) bets[seat.userId] = 0;
  return bets;
};

const dealBoard = (deck, count) => deck.splice(0, count);

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
  const deck = shuffleDeck(buildDeck(), seed);
  const hole = {};
  const bets = {};
  const folded = {};
  const allIn = {};
  for (const seat of activeSeats) {
    hole[seat.userId] = [deck.shift(), deck.shift()];
    bets[seat.userId] = 0;
    folded[seat.userId] = false;
    allIn[seat.userId] = false;
  }
  const sbAmount = Math.max(1, Number(stakes?.sb) || 1);
  const bbAmount = Math.max(sbAmount * 2, Number(stakes?.bb) || sbAmount * 2);
  const sbStack = stacks?.[activeSeats.find((s) => s.seatNo === sbSeat)?.userId] || 0;
  const bbStack = stacks?.[activeSeats.find((s) => s.seatNo === bbSeat)?.userId] || 0;
  if (sbStack <= sbAmount || bbStack <= bbAmount) {
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
    if (stacksCopy[seat.userId] <= 0) allIn[seat.userId] = true;
    return pay;
  };
  const sbPaid = postBlind(sbSeat, sbAmount);
  const bbPaid = postBlind(bbSeat, bbAmount);
  const potTotal = sbPaid + bbPaid;
  const publicSeats = buildPublicSeats(activeSeats, stacksCopy, bets, folded, allIn);
  const actorSeatResolved = advanceActor(publicSeats, actorSeat);
  const actionSeat = actorSeatResolved != null ? actorSeatResolved : actorSeat;
  const actorUser = publicSeats.find((s) => s.seatNo === actionSeat);
  const streetBet = bbPaid;
  return {
    ok: true,
    state: {
      tableId,
      handId,
      handNo,
      phase: "PREFLOP",
      dealerSeat,
      sbSeat,
      bbSeat,
      actorSeat: actionSeat,
      deckSeed: seed,
      deck,
      board: [],
      hole,
      public: { seats: publicSeats },
      stacks: stacksCopy,
      potTotal,
      sidePots: null,
      streetBet,
      minRaiseTo: streetBet + bbAmount,
      actionRequiredFromUserId: actorUser ? actorUser.userId : null,
      allowedActions: actorUser ? buildAllowedActions(actorUser, { streetBet }) : [],
      lastMoveAt: nowIso(),
      updatedAt: nowIso(),
    },
  };
};

const settleHand = (state, stacks) => {
  const publicSeats = state.public?.seats || [];
  const active = publicSeats.filter((seat) => !seat.hasFolded);
  if (active.length === 1) {
    const winner = active[0];
    stacks[winner.userId] = (stacks[winner.userId] || 0) + (state.potTotal || 0);
    return { winners: [winner.userId], stacks, revealed: {} };
  }
  const board = state.board || [];
  let bestScore = null;
  let winners = [];
  for (const seat of active) {
    const hole = state.hole?.[seat.userId] || [];
    const score = evaluateHand([...board, ...hole]);
    if (!score) continue;
    if (!bestScore || compareScores(score.score, bestScore.score) > 0) {
      bestScore = score;
      winners = [seat.userId];
    } else if (compareScores(score.score, bestScore.score) === 0) {
      winners.push(seat.userId);
    }
  }
  const share = winners.length ? Math.floor((state.potTotal || 0) / winners.length) : 0;
  const remainder = winners.length ? (state.potTotal || 0) - share * winners.length : 0;
  winners.forEach((userId, idx) => {
    stacks[userId] = (stacks[userId] || 0) + share + (idx === 0 ? remainder : 0);
  });
  const revealed = {};
  winners.forEach((userId) => {
    revealed[userId] = state.hole?.[userId] || [];
  });
  return { winners, stacks, revealed };
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
  deck: null,
  board: [],
  hole: null,
  public: state.public,
  potTotal: 0,
  sidePots: null,
  streetBet: 0,
  minRaiseTo: 0,
  actionRequiredFromUserId: null,
  allowedActions: [],
  lastMoveAt: nowIso(),
  updatedAt: nowIso(),
};

const toPublicState = (state, currentUserId) => {
  if (!state || !isPlainObject(state)) return {};
  const publicState = { ...state };
  delete publicState.deck;
  delete publicState.hole;
  if (currentUserId && state?.hole?.[currentUserId]) {
    publicState.hole = { [currentUserId]: state.hole[currentUserId] };
  }
  return publicState;
};

const applyAction = ({ currentState, actionType, amount, userId, stakes }) => {
  const state = normalizeState(currentState);
  let publicSeats = Array.isArray(state.public?.seats) ? state.public.seats.map((s) => ({ ...s })) : [];
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
  const actorSeat = publicSeats.find((seat) => seat.userId === userId);
  if (!actorSeat) return { ok: false, error: "not_seated" };
  if (state.actionRequiredFromUserId !== userId) return { ok: false, error: "not_your_turn" };
  if (!PHASES.includes(state.phase)) return { ok: false, error: "invalid_phase" };
  if (state.phase === "WAITING" || state.phase === "SETTLED") return { ok: false, error: "hand_not_active" };

  const streetBet = Number.isFinite(state.streetBet) ? state.streetBet : 0;
  const betThisStreet = Number.isFinite(actorSeat.betThisStreet) ? actorSeat.betThisStreet : 0;
  const stack = Number.isFinite(actorSeat.stack) ? actorSeat.stack : 0;
  const toCall = Math.max(0, streetBet - betThisStreet);
  const normalizedAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;

  if (actionType === "CHECK") {
    if (toCall !== 0) return { ok: false, error: "cannot_check" };
  } else if (actionType === "CALL") {
    if (toCall <= 0) return { ok: false, error: "cannot_call" };
    if (stack <= toCall) return { ok: false, error: "insufficient_stack" };
    actorSeat.stack -= toCall;
    actorSeat.betThisStreet += toCall;
    state.potTotal += toCall;
    if (actorSeat.stack === 0) actorSeat.isAllIn = true;
  } else if (actionType === "BET") {
    if (streetBet > 0) return { ok: false, error: "cannot_bet" };
    if (normalizedAmount <= 0) return { ok: false, error: "invalid_bet" };
    if (normalizedAmount >= stack) return { ok: false, error: "insufficient_stack" };
    actorSeat.stack -= normalizedAmount;
    actorSeat.betThisStreet += normalizedAmount;
    state.potTotal += normalizedAmount;
    state.streetBet = actorSeat.betThisStreet;
    state.minRaiseTo = actorSeat.betThisStreet + Math.max(1, Number(stakes?.bb) || 2);
    if (actorSeat.stack === 0) actorSeat.isAllIn = true;
  } else if (actionType === "RAISE") {
    if (streetBet <= 0) return { ok: false, error: "cannot_raise" };
    if (normalizedAmount <= streetBet) return { ok: false, error: "invalid_raise" };
    if (normalizedAmount < (state.minRaiseTo || 0)) return { ok: false, error: "raise_too_small" };
    const raiseBy = normalizedAmount - betThisStreet;
    if (raiseBy >= stack) return { ok: false, error: "insufficient_stack" };
    actorSeat.stack -= raiseBy;
    actorSeat.betThisStreet += raiseBy;
    state.potTotal += raiseBy;
    state.streetBet = actorSeat.betThisStreet;
    state.minRaiseTo = actorSeat.betThisStreet + Math.max(1, Number(stakes?.bb) || 2);
    if (actorSeat.stack === 0) actorSeat.isAllIn = true;
  } else if (actionType === "FOLD") {
    actorSeat.hasFolded = true;
  } else {
    return { ok: false, error: "invalid_action" };
  }

  const remaining = publicSeats.filter((seat) => !seat.hasFolded && seat.stack >= 0);
  if (remaining.length === 1) {
    state.phase = "SETTLED";
    const stacks = {};
    publicSeats.forEach((seat) => { stacks[seat.userId] = seat.stack; });
    const result = settleHand(state, stacks);
    publicSeats.forEach((seat) => { seat.stack = stacks[seat.userId]; });
    state.public.seats = publicSeats;
    state.stacks = publicSeats.reduce((acc, seat) => {
      acc[seat.userId] = seat.stack;
      return acc;
    }, {});
    state.potTotal = 0;
    state.actionRequiredFromUserId = null;
    state.allowedActions = [];
    state.lastMoveAt = nowIso();
    state.updatedAt = nowIso();
    state.settled = { winners: result.winners, revealed: result.revealed };
    return { ok: true, state };
  }

  const streetDone = streetComplete(publicSeats, state.streetBet || 0);
  if (streetDone) {
    const deck = Array.isArray(state.deck) ? state.deck : [];
    if (state.phase === "PREFLOP") {
      state.board = [...(state.board || []), ...dealBoard(deck, 3)];
      state.phase = "FLOP";
    } else if (state.phase === "FLOP") {
      state.board = [...(state.board || []), ...dealBoard(deck, 1)];
      state.phase = "TURN";
    } else if (state.phase === "TURN") {
      state.board = [...(state.board || []), ...dealBoard(deck, 1)];
      state.phase = "RIVER";
    } else if (state.phase === "RIVER") {
      state.phase = "SHOWDOWN";
    }
    if (state.phase === "SHOWDOWN") {
      const stacks = {};
      publicSeats.forEach((seat) => { stacks[seat.userId] = seat.stack; });
      const result = settleHand(state, stacks);
      publicSeats.forEach((seat) => { seat.stack = stacks[seat.userId]; });
    state.public.seats = publicSeats;
    state.stacks = publicSeats.reduce((acc, seat) => {
      acc[seat.userId] = seat.stack;
      return acc;
    }, {});
    state.phase = "SETTLED";
      state.potTotal = 0;
      state.actionRequiredFromUserId = null;
      state.allowedActions = [];
      state.settled = { winners: result.winners, revealed: result.revealed };
      state.lastMoveAt = nowIso();
      state.updatedAt = nowIso();
      return { ok: true, state };
    }
    const resetBets = resetStreetBets(publicSeats);
    publicSeats.forEach((seat) => { seat.betThisStreet = resetBets[seat.userId]; });
    state.streetBet = 0;
    state.minRaiseTo = Math.max(1, Number(stakes?.bb) || 2);
    const dealerSeat = state.dealerSeat;
    const nextActorSeat = advanceActor(publicSeats, dealerSeat);
    state.actorSeat = nextActorSeat;
    const actor = publicSeats.find((seat) => seat.seatNo === nextActorSeat);
    state.actionRequiredFromUserId = actor ? actor.userId : null;
    state.allowedActions = actor ? buildAllowedActions(actor, state) : [];
    state.lastMoveAt = nowIso();
    state.updatedAt = nowIso();
    return { ok: true, state };
  }

  const nextSeat = advanceActor(publicSeats, state.actorSeat);
  state.actorSeat = nextSeat;
  const nextActor = publicSeats.find((seat) => seat.seatNo === nextSeat);
  state.actionRequiredFromUserId = nextActor ? nextActor.userId : null;
  state.allowedActions = nextActor ? buildAllowedActions(nextActor, state) : [];
  state.lastMoveAt = nowIso();
  state.updatedAt = nowIso();
  state.public.seats = publicSeats;
  state.stacks = publicSeats.reduce((acc, seat) => {
    acc[seat.userId] = seat.stack;
    return acc;
  }, {});
  return { ok: true, state };
};

const ensureAutoStart = ({ state, tableId, seats, stacks, stakes }) => {
  const phase = state.phase || "WAITING";
  if (phase !== "WAITING" && phase !== "INIT") return { ok: true, state };
  const activeSeats = seats.filter((seat) => seat.status === "ACTIVE" && (stacks?.[seat.userId] || 0) > 0);
  if (activeSeats.length < 2) return { ok: true, state };
  return initHand({ tableId, seats, stacks, stakes, prevState: state });
};

export {
  normalizeState,
  normalizeSeatRows,
  toPublicState,
  initHand,
  applyAction,
  ensureAutoStart,
};
