const SUIT_SET = new Set(["S", "H", "D", "C"]);

const normalizeRank = (value) => {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 2 || value > 14) return "";
    if (value === 11) return "J";
    if (value === 12) return "Q";
    if (value === 13) return "K";
    if (value === 14) return "A";
    return String(value);
  }

  if (typeof value !== "string") return "";
  const raw = value.trim().toUpperCase();
  if (!raw) return "";

  if (raw === "T" || raw === "10") return "10";
  if (raw === "J" || raw === "11") return "J";
  if (raw === "Q" || raw === "12") return "Q";
  if (raw === "K" || raw === "13") return "K";
  if (raw === "A" || raw === "14") return "A";
  if (/^[2-9]$/.test(raw)) return raw;
  return "";
};

const normalizeSuit = (value) => {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase();
};

export const isValidCard = (card) => {
  return normalizeCardForCompare(card) !== null;
};


export const normalizeCardForCompare = (card) => {
  if (typeof card === "string") {
    const match = /^(10|[2-9TJQKA])([SHDC])$/i.exec(card.trim());
    if (!match) return null;
    return {
      r: normalizeRank(match[1]),
      s: normalizeSuit(match[2])
    };
  }
  const rank = normalizeRank(card?.r);
  const suit = normalizeSuit(card?.s);
  if (!rank || !SUIT_SET.has(suit)) return null;
  return { r: rank, s: suit };
};

export const cardIdentity = (card) => {
  const normalized = normalizeCardForCompare(card);
  if (!normalized) return "";
  return `${normalized.r}-${normalized.s}`;
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
