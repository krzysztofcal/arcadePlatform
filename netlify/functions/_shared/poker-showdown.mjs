import { compareHands, evaluateBestHand } from "./poker-eval.mjs";

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const normalizeRank = (value) => {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value >= 2 && value <= 14 ? value : null;
  }
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  if (v === "A") return 14;
  if (v === "K") return 13;
  if (v === "Q") return 12;
  if (v === "J") return 11;
  if (v === "T") return 10;
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    return n >= 2 && n <= 10 ? n : null;
  }
  return null;
};

const normalizeSuit = (value) => {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  return v ? v : null;
};

const cardKey = (card) => {
  const rank = normalizeRank(card?.r);
  const suit = normalizeSuit(card?.s);
  if (!rank || !suit) return "";
  return `${rank}-${suit}`;
};

const validateCards = (cards, seen) => {
  if (!Array.isArray(cards)) return { ok: false };
  for (const card of cards) {
    if (!isPlainObject(card)) return { ok: false };
    const key = cardKey(card);
    if (!key || seen.has(key)) return { ok: false };
    seen.add(key);
  }
  return { ok: true };
};

const validatePlayers = (players, seenCards) => {
  if (!Array.isArray(players) || players.length === 0) return { ok: false };
  const seenUsers = new Set();
  for (const player of players) {
    if (!isPlainObject(player)) return { ok: false };
    if (typeof player.userId !== "string" || !player.userId.trim()) return { ok: false };
    if (seenUsers.has(player.userId)) return { ok: false };
    seenUsers.add(player.userId);
    if (!Array.isArray(player.holeCards) || player.holeCards.length !== 2) return { ok: false };
    const validCards = validateCards(player.holeCards, seenCards);
    if (!validCards.ok) return { ok: false };
  }
  return { ok: true };
};

const computeShowdown = ({ community, players }) => {
  try {
    if (!Array.isArray(community) || community.length !== 5) throw new Error("invalid_state");
    const seenCards = new Set();
    if (!validateCards(community, seenCards).ok) throw new Error("invalid_state");
    if (!validatePlayers(players, seenCards).ok) throw new Error("invalid_state");

    const handsByUserId = {};
    const revealedHoleCardsByUserId = {};
    let bestHand = null;
    const winners = [];

    for (const player of players) {
      const holeCards = player.holeCards.slice();
      const combined = community.concat(holeCards);
      const hand = evaluateBestHand(combined);
      handsByUserId[player.userId] = {
        category: hand.category,
        name: hand.name,
        ranks: hand.ranks,
        best5: hand.best5,
        key: hand.key,
      };
      revealedHoleCardsByUserId[player.userId] = holeCards;
      if (!bestHand) {
        bestHand = hand;
        winners.push(player.userId);
        continue;
      }
      const cmp = compareHands(hand, bestHand);
      if (cmp > 0) {
        bestHand = hand;
        winners.length = 0;
        winners.push(player.userId);
      } else if (cmp === 0) {
        winners.push(player.userId);
      }
    }

    if (!winners.length) throw new Error("invalid_state");

    return {
      winners,
      handsByUserId,
      revealedHoleCardsByUserId,
    };
  } catch (error) {
    if (error?.message === "invalid_state") {
      throw error;
    }
    throw new Error("invalid_state");
  }
};

export { computeShowdown };
