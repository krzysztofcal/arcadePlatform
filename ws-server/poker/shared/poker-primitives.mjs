import crypto from "node:crypto";

const SUITS = ["S", "H", "D", "C"];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const ACTION_PHASES = new Set(["PREFLOP", "FLOP", "TURN", "RIVER"]);

const RANK_TO_CODE = {
  14: "A",
  13: "K",
  12: "Q",
  11: "J",
  10: "T",
  9: "9",
  8: "8",
  7: "7",
  6: "6",
  5: "5",
  4: "4",
  3: "3",
  2: "2"
};

function createDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      deck.push({ r, s });
    }
  }
  return deck;
}

function asSeed(seed) {
  return typeof seed === "string" && seed.trim() ? seed.trim() : "ws-default-seed";
}

function deriveDeck(seed) {
  const deck = createDeck();
  const digest = crypto.createHash("sha256").update(asSeed(seed)).digest();
  let state = digest.readUInt32BE(0) ^ digest.readUInt32BE(4) ^ digest.readUInt32BE(8) ^ digest.readUInt32BE(12);
  if (state === 0) {
    state = 0x9e3779b9;
  }

  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };

  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }

  return deck;
}

function dealHoleCards(deck, playerIds) {
  const totalNeeded = playerIds.length * 2;
  if (deck.length < totalNeeded) {
    throw new Error("not_enough_cards");
  }

  const holeCardsByUserId = {};
  let idx = 0;
  for (const id of playerIds) {
    holeCardsByUserId[id] = [];
  }
  for (let round = 0; round < 2; round += 1) {
    for (const id of playerIds) {
      holeCardsByUserId[id].push(deck[idx]);
      idx += 1;
    }
  }
  return {
    deck: deck.slice(idx),
    holeCardsByUserId
  };
}

function asCardCode(card) {
  if (typeof card === "string") {
    return card;
  }
  if (!card || typeof card !== "object" || Array.isArray(card)) {
    return null;
  }
  const rank = RANK_TO_CODE[card.r];
  const suit = typeof card.s === "string" ? card.s.trim().toUpperCase() : "";
  if (!rank || !suit) {
    return null;
  }
  return `${rank}${suit}`;
}

function toCardCodes(cards) {
  if (!Array.isArray(cards)) {
    return [];
  }
  return cards.map(asCardCode).filter((card) => typeof card === "string" && card.length > 0);
}

function toHoleCardCodeMap(holeCardsByUserId) {
  if (!holeCardsByUserId || typeof holeCardsByUserId !== "object" || Array.isArray(holeCardsByUserId)) {
    return {};
  }

  const normalized = {};
  for (const [userId, cards] of Object.entries(holeCardsByUserId)) {
    normalized[userId] = toCardCodes(cards);
  }
  return normalized;
}

function toSafeInt(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.trunc(num);
}

function maxFromMap(value) {
  if (!value || typeof value !== "object") return 0;
  const nums = Object.values(value)
    .map((entry) => toSafeInt(entry, 0))
    .filter((entry) => entry > 0);
  if (nums.length === 0) return 0;
  return Math.max(...nums);
}

function deriveCurrentBet(state) {
  const currentBet = toSafeInt(state.currentBet, null);
  if (currentBet == null || currentBet < 0) return maxFromMap(state.betThisRoundByUserId);
  return currentBet;
}

function deriveLastRaiseSize(state, currentBet) {
  const lastRaiseSize = toSafeInt(state.lastRaiseSize, null);
  if (lastRaiseSize == null || lastRaiseSize <= 0) return currentBet > 0 ? currentBet : 0;
  return lastRaiseSize;
}

function isActivePlayer(state, userId) {
  if (!state || !userId) return false;
  if (state.leftTableByUserId && state.leftTableByUserId[userId]) return false;
  if (state.sitOutByUserId && state.sitOutByUserId[userId]) return false;
  const folded = !!(state.foldedByUserId && state.foldedByUserId[userId]);
  const allIn = !!(state.allInByUserId && state.allInByUserId[userId]);
  return !folded && !allIn;
}

function isSeatedPlayer(state, userId) {
  if (!state || !userId) {
    return false;
  }
  const phase = typeof state?.phase === "string" ? state.phase : "";
  const seats = ACTION_PHASES.has(phase) && Array.isArray(state?.handSeats) && state.handSeats.length > 0
    ? state.handSeats
    : state?.seats;
  if (Array.isArray(seats)) {
    return seats.some((seat) => seat && seat.userId === userId);
  }
  return !!(state.stacks && typeof state.stacks === "object" && Object.prototype.hasOwnProperty.call(state.stacks, userId));
}

function computeSharedLegalActions({ statePublic, userId } = {}) {
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
  if (!isSeatedPlayer(state, userId) || !isActivePlayer(state, userId)) {
    return { actions: [], toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null };
  }
  const turnUserId = typeof state.turnUserId === "string" ? state.turnUserId : "";
  if (!turnUserId) {
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
  if (turnUserId !== userId) {
    return { actions: ["FOLD"], toCall, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null };
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
      maxBetAmount: null
    };
  }

  const actions = ["FOLD", "CHECK"];
  if (stack > 0) actions.push("BET");
  return { actions, toCall, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: stack };
}

export {
  asCardCode,
  computeSharedLegalActions,
  createDeck,
  dealHoleCards,
  deriveDeck,
  toCardCodes,
  toHoleCardCodeMap
};
