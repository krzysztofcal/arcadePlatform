export const DEFAULT_CASH_TABLE_BUY_IN_CHIPS = 100;
export const HIGH_TIER_BOT_BANKROLL_SYSTEM_KEY = "POKER_BOT_BANKROLL";
export const MAX_POKER_STAKE_CHIPS = 1_000_000;
export const POKER_BUY_IN_MATERIALIZATION_CAPABILITY_VERSION = "2";

export function getBotFundingSystemKeyForBuyIn(buyIn, options = {}) {
  const normalizedBuyIn = Number(buyIn);
  const hasExplicitPoolClass = Object.prototype.hasOwnProperty.call(options, "poolClass");
  const poolClass = typeof options.poolClass === "string" ? options.poolClass.trim().toUpperCase() : "";
  if (hasExplicitPoolClass) {
    if (poolClass !== "NORMAL" && poolClass !== "SLOW") return null;
    const keys = poolClass === "SLOW"
      ? { 100: "POKER_BOT_SLOW_BANKROLL_100", 500: "POKER_BOT_SLOW_BANKROLL_500" }
      : { 100: "POKER_BOT_BANKROLL_100", 500: HIGH_TIER_BOT_BANKROLL_SYSTEM_KEY };
    return keys[normalizedBuyIn] || null;
  }
  const { legacySystemKey = "TREASURY" } = options;
  if (normalizedBuyIn === DEFAULT_CASH_TABLE_BUY_IN_CHIPS) {
    const configuredKey = typeof legacySystemKey === "string" ? legacySystemKey.trim() : "";
    return configuredKey || "TREASURY";
  }
  if (normalizedBuyIn === 500) return HIGH_TIER_BOT_BANKROLL_SYSTEM_KEY;
  return null;
}

export function isBotFundingAllowedForBuyIn(buyIn, options = {}) {
  return getBotFundingSystemKeyForBuyIn(buyIn, options) !== null;
}

export function calculateCanonicalPokerStakes(buyIn) {
  const normalizedBuyIn = Number(buyIn);
  if (!Number.isSafeInteger(normalizedBuyIn) || normalizedBuyIn <= 0) return null;
  const bb = Math.max(2, Math.round(normalizedBuyIn / 50));
  const sb = Math.max(1, Math.floor(bb / 2));
  if (sb > MAX_POKER_STAKE_CHIPS || bb > MAX_POKER_STAKE_CHIPS) return null;
  return { sb, bb };
}

export function isCanonicalPokerBuyIn(buyIn) {
  const normalizedBuyIn = Number(buyIn);
  const canonical = calculateCanonicalPokerStakes(normalizedBuyIn);
  return !!canonical && normalizedBuyIn === canonical.bb * 50;
}

export function isCanonicalPokerStakes(buyIn, stakes) {
  const canonical = calculateCanonicalPokerStakes(buyIn);
  if (!canonical || !stakes || typeof stakes !== "object" || Array.isArray(stakes)) return false;
  return Number(stakes.sb) === canonical.sb && Number(stakes.bb) === canonical.bb;
}
