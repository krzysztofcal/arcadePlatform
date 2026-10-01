export const DEFAULT_CASH_TABLE_BUY_IN_CHIPS = 100;
export const HIGH_TIER_BOT_BANKROLL_SYSTEM_KEY = "POKER_BOT_BANKROLL";
export const MAX_POKER_STAKE_CHIPS = 1_000_000;
export const POKER_BUY_IN_MATERIALIZATION_CAPABILITY_VERSION = "2";

export const CANONICAL_POKER_BUY_IN_TIERS = Object.freeze([
  DEFAULT_CASH_TABLE_BUY_IN_CHIPS,
  500,
  1_000,
  5_000,
  10_000,
  50_000,
  100_000,
  500_000,
  1_000_000,
  5_000_000,
  10_000_000,
]);

export function getBotFundingSystemKeyForBuyIn(buyIn, options = {}) {
  const normalizedBuyIn = Number(buyIn);
  const hasExplicitPoolClass = Object.prototype.hasOwnProperty.call(options, "poolClass");
  const poolClass = typeof options.poolClass === "string" ? options.poolClass.trim().toUpperCase() : "";
  if (hasExplicitPoolClass) {
    if (poolClass !== "NORMAL" && poolClass !== "SLOW") return null;
    if (!CANONICAL_POKER_BUY_IN_TIERS.includes(normalizedBuyIn)) return null;
    if (poolClass === "SLOW") {
      return `POKER_BOT_SLOW_BANKROLL_${normalizedBuyIn}`;
    }
    if (normalizedBuyIn === 500) {
      return HIGH_TIER_BOT_BANKROLL_SYSTEM_KEY;
    }
    return `POKER_BOT_BANKROLL_${normalizedBuyIn}`;
  }
  const { legacySystemKey = "TREASURY" } = options;
  if (normalizedBuyIn === DEFAULT_CASH_TABLE_BUY_IN_CHIPS) {
    const configuredKey = typeof legacySystemKey === "string" ? legacySystemKey.trim() : "";
    return configuredKey || "TREASURY";
  }
  if (normalizedBuyIn === 500) return HIGH_TIER_BOT_BANKROLL_SYSTEM_KEY;
  return null;
}

export const CANONICAL_POKER_BOT_POOL_KEYS = Object.freeze((() => {
  const keys = [];
  for (const buyIn of CANONICAL_POKER_BUY_IN_TIERS) {
    const normal = getBotFundingSystemKeyForBuyIn(buyIn, { poolClass: "NORMAL" });
    const slow = getBotFundingSystemKeyForBuyIn(buyIn, { poolClass: "SLOW" });
    if (normal) keys.push(normal);
    if (slow) keys.push(slow);
  }
  return [...new Set(keys)];
})());

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
