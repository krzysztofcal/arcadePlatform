const isValidTwoCards = (cards) => {
  if (!Array.isArray(cards) || cards.length !== 2) return false;
  return cards.every(
    (card) =>
      card &&
      typeof card === "object" &&
      typeof card.s === "string" &&
      (typeof card.r === "string" || typeof card.r === "number")
  );
};

export { isValidTwoCards };
