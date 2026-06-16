import crypto from "node:crypto";
import { createDeck } from "./poker-engine.mjs";

const DEAL_CONTEXT = "poker-deal:v1";

const getDealSecret = () => {
  const secret = process.env.POKER_DEAL_SECRET;
  if (typeof secret !== "string" || !secret.trim()) {
    throw new Error("deal_secret_missing");
  }
  return secret;
};

const createHmacStream = (handSeed) => {
  const secret = getDealSecret();
  let counter = 0;
  let buffer = Buffer.alloc(0);
  let offset = 0;
  const fill = () => {
    counter += 1;
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(`${DEAL_CONTEXT}:${handSeed}:${counter}`);
    buffer = hmac.digest();
    offset = 0;
  };
  const nextBytes = (len) => {
    const chunks = [];
    let remaining = len;
    while (remaining > 0) {
      if (offset >= buffer.length) fill();
      const take = Math.min(remaining, buffer.length - offset);
      chunks.push(buffer.subarray(offset, offset + take));
      offset += take;
      remaining -= take;
    }
    return Buffer.concat(chunks, len);
  };
  return { nextBytes };
};

const rng32 = (stream) => stream.nextBytes(4).readUInt32BE(0);

const randomInt = (maxInclusive, stream) => {
  const range = maxInclusive + 1;
  const limit = Math.floor(0x100000000 / range) * range;
  let value = rng32(stream);
  while (value >= limit) {
    value = rng32(stream);
  }
  return value % range;
};

const shuffleDeterministic = (deck, handSeed) => {
  const out = deck.slice();
  const stream = createHmacStream(handSeed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i, stream);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
};

const deriveDeck = (handSeed) => {
  if (typeof handSeed !== "string" || !handSeed.trim()) {
    throw new Error("hand_seed_required");
  }
  return shuffleDeterministic(createDeck(), handSeed);
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
  if (!Number.isInteger(communityDealt) || communityDealt < 0 || communityDealt > 5) {
    throw new Error("invalid_community_dealt");
  }
  const burn = seatOrder.length * 2;
  const dealt = communityDealt;
  return deck.slice(burn, burn + dealt);
};

const deriveRemainingDeck = ({ handSeed, seatUserIdsInOrder, communityDealt }) => {
  const deck = deriveDeck(handSeed);
  const seatOrder = normalizeSeatOrder(seatUserIdsInOrder);
  if (seatOrder.length <= 0) {
    throw new Error("invalid_seat_order");
  }
  if (!Number.isInteger(communityDealt) || communityDealt < 0 || communityDealt > 5) {
    throw new Error("invalid_community_dealt");
  }
  const burn = seatOrder.length * 2;
  const dealt = communityDealt;
  return deck.slice(burn + dealt);
};

export { deriveDeck, deriveCommunityCards, deriveRemainingDeck };
