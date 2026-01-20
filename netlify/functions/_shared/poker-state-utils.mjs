const normalizeJsonState = (value) => {
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

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const withoutPrivateState = (state) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return state;
  const { holeCardsByUserId, deck, ...rest } = state;
  return rest;
};

const isStateStorageValid = (state, options = {}) => {
  if (!isPlainObject(state)) return false;
  const seats = Array.isArray(state.seats) ? state.seats : [];
  const requirePrivate = options.requirePrivate === true;
  const deck = state.deck;
  const holeCardsByUserId = state.holeCardsByUserId;

  if (requirePrivate) {
    if (!Array.isArray(deck) || deck.length > 52) return false;
    if (!isPlainObject(holeCardsByUserId)) return false;
    const userIds = Object.keys(holeCardsByUserId);
    if (userIds.length > seats.length) return false;
    for (const cards of Object.values(holeCardsByUserId)) {
      if (!Array.isArray(cards) || cards.length !== 2) return false;
    }
  } else {
    if (deck != null && (!Array.isArray(deck) || deck.length > 52)) return false;
    if (holeCardsByUserId != null) {
      if (!isPlainObject(holeCardsByUserId)) return false;
      const userIds = Object.keys(holeCardsByUserId);
      if (userIds.length > seats.length) return false;
      for (const cards of Object.values(holeCardsByUserId)) {
        if (!Array.isArray(cards) || cards.length !== 2) return false;
      }
    }
  }
  return true;
};

const getRng = () => {
  const testRng = globalThis.__TEST_RNG__;
  return typeof testRng === "function" ? testRng : Math.random;
};

export { normalizeJsonState, withoutPrivateState, getRng, isPlainObject, isStateStorageValid };
