const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const SUITS = ["S", "H", "D", "C"];
const RANK_SET = new Set(RANKS);
const RANK_NUM_SET = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
const SUIT_SET = new Set(SUITS);

const rankKey = (rank) => {
  if (typeof rank === "string") return RANK_SET.has(rank) ? rank : "";
  if (typeof rank !== "number" || !Number.isFinite(rank)) return "";
  if (rank >= 2 && rank <= 9) return String(rank);
  if (rank === 10) return "T";
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  if (rank === 14) return "A";
  return "";
};

const isValidCard = (card) => {
  if (!isPlainObject(card)) return false;
  if (typeof card.s !== "string") return false;
  if (!SUIT_SET.has(card.s)) return false;
  if (typeof card.r === "string") return RANK_SET.has(card.r);
  if (typeof card.r === "number") return RANK_NUM_SET.has(card.r);
  return false;
};

const cardKey = (card) => {
  const r = rankKey(card.r);
  if (!r) return "";
  return `${r}${card.s}`;
};

const validateCardsArray = (cards, options = {}) => {
  if (!Array.isArray(cards)) return { ok: false, keys: [] };
  if (Number.isInteger(options.maxLen) && cards.length > options.maxLen) return { ok: false, keys: [] };
  if (Number.isInteger(options.exactLen) && cards.length !== options.exactLen) return { ok: false, keys: [] };
  const keys = [];
  for (const card of cards) {
    if (!isValidCard(card)) return { ok: false, keys: [] };
    const key = cardKey(card);
    if (!key) return { ok: false, keys: [] };
    keys.push(key);
  }
  return { ok: true, keys };
};

const validateNoDuplicates = (keys) => new Set(keys).size === keys.length;

const normalizeJsonState = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (isPlainObject(value)) return value;
  return {};
};

const withoutPrivateState = (state) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return state;
  const { holeCardsByUserId, deck, ...rest } = state;
  return rest;
};

const isStateStorageValid = (state, options = {}) => {
  if (!isPlainObject(state)) return false;
  const seats = Array.isArray(state.seats) ? state.seats : [];
  const seatUserIds = new Set(
    seats.map((seat) => (typeof seat?.userId === "string" && seat.userId.trim() ? seat.userId : null)).filter(Boolean)
  );
  const requirePrivate = options.requirePrivate === true;
  const requireHoleCards = options.requireHoleCards === true;
  const requireNoDeck = options.requireNoDeck === true;
  const requireHandSeed = options.requireHandSeed === true;
  const requireCommunityDealt = options.requireCommunityDealt === true;
  const deck = state.deck;
  const holeCardsByUserId = state.holeCardsByUserId;
  const community = state.community;
  const holeCardKeys = [];
  let deckKeys = [];
  let communityKeys = [];

  if (requireHandSeed) {
    if (typeof state.handSeed !== "string" || !state.handSeed.trim()) return false;
  }
  if (requireCommunityDealt) {
    if (!Number.isInteger(state.communityDealt) || state.communityDealt < 0 || state.communityDealt > 5) return false;
    if (!Array.isArray(community) || community.length !== state.communityDealt) return false;
  }
  if (requireNoDeck && deck != null) return false;

  if (community != null) {
    const communityCheck = validateCardsArray(community, { maxLen: 5 });
    if (!communityCheck.ok) return false;
    communityKeys = communityCheck.keys;
    if (!validateNoDuplicates(communityKeys)) return false;
  }
  if (seatUserIds.size === 0 && holeCardsByUserId && Object.keys(holeCardsByUserId).length > 0) return false;

  if (requirePrivate) {
    const deckCheck = validateCardsArray(deck, { maxLen: 52 });
    if (!deckCheck.ok) return false;
    deckKeys = deckCheck.keys;
    if (!validateNoDuplicates(deckKeys)) return false;

    if (!isPlainObject(holeCardsByUserId)) return false;
    const userIds = Object.keys(holeCardsByUserId);
    if (userIds.length > seatUserIds.size) return false;
    for (const userId of userIds) {
      if (typeof userId !== "string" || !userId.trim() || !seatUserIds.has(userId)) return false;
      const cardsCheck = validateCardsArray(holeCardsByUserId[userId], { exactLen: 2 });
      if (!cardsCheck.ok) return false;
      holeCardKeys.push(...cardsCheck.keys);
    }
    if (!validateNoDuplicates(holeCardKeys)) return false;
  } else if (requireHoleCards) {
    if (!isPlainObject(holeCardsByUserId)) return false;
    const userIds = Object.keys(holeCardsByUserId);
    if (userIds.length > seatUserIds.size) return false;
    for (const userId of userIds) {
      if (typeof userId !== "string" || !userId.trim() || !seatUserIds.has(userId)) return false;
      const cardsCheck = validateCardsArray(holeCardsByUserId[userId], { exactLen: 2 });
      if (!cardsCheck.ok) return false;
      holeCardKeys.push(...cardsCheck.keys);
    }
    if (!validateNoDuplicates(holeCardKeys)) return false;
  } else {
    if (deck != null) {
      const deckCheck = validateCardsArray(deck, { maxLen: 52 });
      if (!deckCheck.ok) return false;
      deckKeys = deckCheck.keys;
      if (!validateNoDuplicates(deckKeys)) return false;
    }
    if (holeCardsByUserId != null) {
      if (!isPlainObject(holeCardsByUserId)) return false;
      const userIds = Object.keys(holeCardsByUserId);
      if (userIds.length > seatUserIds.size) return false;
      for (const userId of userIds) {
        if (typeof userId !== "string" || !userId.trim() || !seatUserIds.has(userId)) return false;
        const cardsCheck = validateCardsArray(holeCardsByUserId[userId], { exactLen: 2 });
        if (!cardsCheck.ok) return false;
        holeCardKeys.push(...cardsCheck.keys);
      }
      if (!validateNoDuplicates(holeCardKeys)) return false;
    }
  }
  if (communityKeys.length > 0 && holeCardKeys.length > 0) {
    if (communityKeys.some((key) => holeCardKeys.includes(key))) return false;
  }
  if (communityKeys.length > 0 && deckKeys.length > 0) {
    if (communityKeys.some((key) => deckKeys.includes(key))) return false;
  }
  if (holeCardKeys.length > 0 && deckKeys.length > 0) {
    if (holeCardKeys.some((key) => deckKeys.includes(key))) return false;
  }
  return true;
};

const getRng = () => {
  const testRng = globalThis.__TEST_RNG__;
  return typeof testRng === "function" ? testRng : Math.random;
};

export { normalizeJsonState, withoutPrivateState, getRng, isPlainObject, isStateStorageValid };
