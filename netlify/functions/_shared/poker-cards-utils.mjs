export const isValidTwoCards = (cards) => {
  if (!Array.isArray(cards) || cards.length !== 2) return false;
  for (const card of cards) {
    if (!card || typeof card !== "object") return false;
    if (typeof card.s !== "string") return false;
    const rankType = typeof card.r;
    if (rankType !== "string" && rankType !== "number") return false;
  }
  return true;
};
