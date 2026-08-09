export const DEFAULT_CASH_TABLE_BUY_IN_CHIPS = 100;

export function calculateCanonicalPokerStakes(buyIn) {
  const normalizedBuyIn = Number(buyIn);
  if (!Number.isSafeInteger(normalizedBuyIn) || normalizedBuyIn <= 0) return null;
  const bb = Math.max(2, Math.round(normalizedBuyIn / 50));
  const sb = Math.max(1, Math.floor(bb / 2));
  return { sb, bb };
}

export function isCanonicalPokerStakes(buyIn, stakes) {
  const canonical = calculateCanonicalPokerStakes(buyIn);
  if (!canonical || !stakes || typeof stakes !== "object" || Array.isArray(stakes)) return false;
  return Number(stakes.sb) === canonical.sb && Number(stakes.bb) === canonical.bb;
}
