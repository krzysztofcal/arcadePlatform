import { createDeck, shuffle } from "./poker-engine.mjs";

const xmur3 = (input) => {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
};

const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const makeSeededRng = (handSeed) => {
  const seed = typeof handSeed === "string" ? handSeed : "";
  const seedFn = xmur3(seed);
  return mulberry32(seedFn());
};

const deriveDeck = (handSeed) => {
  if (typeof handSeed !== "string" || !handSeed.trim()) {
    throw new Error("hand_seed_required");
  }
  return shuffle(createDeck(), makeSeededRng(handSeed));
};

const normalizeSeatOrder = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const userId = raw.trim();
    if (!userId) continue;
    if (seen.has(userId)) {
      throw new Error("duplicate_seat_user_id");
    }
    seen.add(userId);
    out.push(userId);
  }
  return out;
};

const deriveCommunityCards = ({ handSeed, seatUserIdsInOrder, communityDealt }) => {
  const deck = deriveDeck(handSeed);
  const seatOrder = normalizeSeatOrder(seatUserIdsInOrder);
  if (seatOrder.length <= 0) {
    throw new Error("invalid_seat_order");
  }
  const burn = seatOrder.length * 2;
  const dealt = Number.isInteger(communityDealt) ? communityDealt : 0;
  return deck.slice(burn, burn + dealt);
};

const deriveRemainingDeck = ({ handSeed, seatUserIdsInOrder, communityDealt }) => {
  const deck = deriveDeck(handSeed);
  const seatOrder = normalizeSeatOrder(seatUserIdsInOrder);
  if (seatOrder.length <= 0) {
    throw new Error("invalid_seat_order");
  }
  const burn = seatOrder.length * 2;
  const dealt = Number.isInteger(communityDealt) ? communityDealt : 0;
  return deck.slice(burn + dealt);
};

export { deriveDeck, deriveCommunityCards, deriveRemainingDeck };
