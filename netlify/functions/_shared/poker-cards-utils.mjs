const SUIT_SET = new Set(["S", "H", "D", "C"]);
const RANK_SET = new Set(["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "T", "J", "Q", "K", "A"]);

const normalizeRank = (value) => {
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase();
};

const normalizeSuit = (value) => {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase();
};

export const isValidCard = (card) => {
  if (!card || typeof card !== "object") return false;
  const rank = normalizeRank(card.r);
  const suit = normalizeSuit(card.s);
  if (!RANK_SET.has(rank)) return false;
  if (!SUIT_SET.has(suit)) return false;
  return true;
};

export const cardIdentity = (card) => {
  const rank = normalizeRank(card?.r);
  const suit = normalizeSuit(card?.s);
  if (!RANK_SET.has(rank) || !SUIT_SET.has(suit)) return "";
  return `${rank}-${suit}`;
};

export const areCardsUnique = (cards) => {
  if (!Array.isArray(cards)) return false;
  const ids = cards.map(cardIdentity);
  if (ids.some((id) => !id)) return false;
  return new Set(ids).size === ids.length;
};

export const isValidTwoCards = (cards) => {
  if (!Array.isArray(cards) || cards.length !== 2) return false;
  for (const card of cards) {
    if (!isValidCard(card)) return false;
  }
  return areCardsUnique(cards);
};
