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

const withoutPrivateState = (state) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) return state;
  const { holeCardsByUserId, deck, ...rest } = state;
  return rest;
};

const getRng = () => {
  const testRng = globalThis.__TEST_RNG__;
  return typeof testRng === "function" ? testRng : Math.random;
};

export { normalizeJsonState, withoutPrivateState, getRng };
