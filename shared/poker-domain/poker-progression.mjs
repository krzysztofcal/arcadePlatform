import { DEFAULT_CASH_TABLE_BUY_IN_CHIPS } from "./table-economy.mjs";

const BUY_IN_TIERS_ENV = "POKER_BUY_IN_TIERS_JSON";

export const DEFAULT_POKER_BUY_IN_TIERS = Object.freeze([
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
  10_000_000
]);

function configError() {
  const error = new Error("poker_buy_in_tiers_config_invalid");
  error.code = "poker_buy_in_tiers_config_invalid";
  return error;
}

function normalizePositiveSafeInteger(value, errorCode) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    const error = new Error(errorCode);
    error.code = errorCode;
    throw error;
  }
  return value;
}

function normalizeBalance(value) {
  const balance = Number(value);
  if (!Number.isSafeInteger(balance) || balance < 0) {
    const error = new Error("chips_balance_integrity_error");
    error.code = "chips_balance_integrity_error";
    throw error;
  }
  return balance;
}

export function resolvePokerBuyInTiers(env = process.env) {
  const raw = env && Object.prototype.hasOwnProperty.call(env, BUY_IN_TIERS_ENV)
    ? env[BUY_IN_TIERS_ENV]
    : undefined;
  if (raw === undefined) {
    return [...DEFAULT_POKER_BUY_IN_TIERS];
  }
  if (typeof raw !== "string" || !raw.trim()) throw configError();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw configError();
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw configError();
  const tiers = parsed.map((value) => {
    try {
      return normalizePositiveSafeInteger(value, "poker_buy_in_tiers_config_invalid");
    } catch {
      throw configError();
    }
  });
  const normalizedTiers = [...new Set(tiers)].sort((left, right) => left - right);
  if (!normalizedTiers.includes(DEFAULT_CASH_TABLE_BUY_IN_CHIPS)) throw configError();
  return normalizedTiers;
}

export function calculateUnlockBankroll(buyIn) {
  const normalizedBuyIn = normalizePositiveSafeInteger(buyIn, "invalid_buy_in");
  const buffer = Math.ceil(normalizedBuyIn / 10);
  if (!Number.isSafeInteger(buffer) || normalizedBuyIn > Number.MAX_SAFE_INTEGER - buffer) {
    const error = new Error("poker_buy_in_tiers_config_invalid");
    error.code = "poker_buy_in_tiers_config_invalid";
    throw error;
  }
  return normalizedBuyIn + buffer;
}

export function evaluatePokerProgression({ balance, tiers }) {
  const normalizedBalance = normalizeBalance(balance);
  if (!Array.isArray(tiers) || tiers.length === 0) throw configError();
  const normalizedTiers = tiers.map((tier) => normalizePositiveSafeInteger(tier, "poker_buy_in_tiers_config_invalid"));
  let highestUnlockedIndex = -1;
  const tierRows = normalizedTiers.map((buyIn, index) => {
    const unlockBankroll = calculateUnlockBankroll(buyIn);
    const unlocked = normalizedBalance >= unlockBankroll;
    if (unlocked) highestUnlockedIndex = index;
    const progressPercent = unlocked
      ? 100
      : Math.max(0, Math.min(99, Math.round((normalizedBalance / unlockBankroll) * 100)));
    return {
      buyIn,
      unlockBankroll,
      unlocked,
      available: false,
      progressPercent,
      remaining: Math.max(0, unlockBankroll - normalizedBalance)
    };
  });
  const availableIndexes = highestUnlockedIndex < 0
    ? []
    : [highestUnlockedIndex, highestUnlockedIndex - 1].filter((index) => index >= 0);
  const availableSet = new Set(availableIndexes);
  const tiersWithAvailability = tierRows.map((tier, index) => ({
    ...tier,
    available: availableSet.has(index)
  }));
  return {
    balance: normalizedBalance,
    highestUnlockedIndex,
    highestUnlockedBuyIn: highestUnlockedIndex >= 0 ? normalizedTiers[highestUnlockedIndex] : null,
    availableBuyIns: availableIndexes.map((index) => normalizedTiers[index]),
    tiers: tiersWithAvailability
  };
}

export function isConfiguredPokerBuyIn(buyIn, tiers) {
  const normalizedBuyIn = Number(buyIn);
  return Number.isSafeInteger(normalizedBuyIn)
    && normalizedBuyIn > 0
    && Array.isArray(tiers)
    && tiers.includes(normalizedBuyIn);
}

export async function readPokerBankroll(tx, { userId, lock = false } = {}) {
  if (!tx || typeof tx.unsafe !== "function") throw new Error("poker_progression_tx_required");
  if (typeof userId !== "string" || !userId.trim()) throw new Error("poker_progression_user_required");
  const lockClause = lock ? " for update" : "";
  const rows = await tx.unsafe(
    `
select balance
from public.chips_accounts
where user_id = $1
  and account_type = 'USER'
limit 1${lockClause};
    `,
    [userId]
  );
  return rows?.[0] ? normalizeBalance(rows[0].balance) : 0;
}

export async function readPokerProgression(tx, { userId, env = process.env, lock = false } = {}) {
  const tiers = resolvePokerBuyInTiers(env);
  const balance = await readPokerBankroll(tx, { userId, lock });
  return evaluatePokerProgression({ balance, tiers });
}

export function evaluatePokerBuyInAccess({ balance, buyIn, tiers }) {
  const normalizedBuyIn = Number(buyIn);
  if (!isConfiguredPokerBuyIn(normalizedBuyIn, tiers)) {
    return {
      eligible: false,
      configured: false,
      balance: normalizeBalance(balance),
      buyIn: normalizedBuyIn,
      requiredBankroll: null
    };
  }
  const requiredBankroll = calculateUnlockBankroll(normalizedBuyIn);
  const progression = evaluatePokerProgression({ balance, tiers });
  return {
    eligible: progression.availableBuyIns.includes(normalizedBuyIn),
    configured: true,
    balance: progression.balance,
    buyIn: normalizedBuyIn,
    requiredBankroll,
    progression
  };
}
