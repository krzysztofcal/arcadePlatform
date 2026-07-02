import { executeSql, klog } from "./supabase-admin.mjs";
import { postTransaction } from "./chips-ledger.mjs";

const DEFAULT_BONUS_AMOUNT = 500;
const GENESIS_SYSTEM_KEY = "GENESIS";

function parsePositiveInt(value, fallback) {
  const raw = value == null || value === "" ? fallback : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || Math.trunc(parsed) !== parsed || parsed <= 0) return null;
  if (Math.abs(parsed) > Number.MAX_SAFE_INTEGER) return null;
  return parsed;
}

function parseRequiredStartAt(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function getConfig(env = process.env) {
  const amount = parsePositiveInt(env.WELCOME_BONUS_CHIPS, DEFAULT_BONUS_AMOUNT);
  const startAt = parseRequiredStartAt(env.WELCOME_BONUS_START_AT);
  return {
    amount,
    startAt,
    configured: !!(amount && startAt),
  };
}

function buildIdempotencyKey(userId) {
  return `welcome-bonus:${userId}`;
}

async function fetchUserCreatedAt(userId, runSql = executeSql) {
  const rows = await runSql(
    `
select created_at
from auth.users
where id = $1
limit 1;
`,
    [userId],
  );
  return toIso(rows?.[0]?.created_at);
}

async function fetchClaimTransaction(userId, idempotencyKey, runSql = executeSql) {
  const rows = await runSql(
    `
select id, created_at
from public.chips_transactions
where user_id = $1
  and tx_type = 'WELCOME_BONUS'
  and idempotency_key = $2
limit 1;
`,
    [userId, idempotencyKey],
  );
  return rows?.[0] || null;
}

async function getWelcomeBonusStatus(userId, deps = {}) {
  const env = deps.env || process.env;
  const runSql = deps.executeSql || executeSql;
  const config = getConfig(env);
  const idempotencyKey = buildIdempotencyKey(userId);

  if (!config.configured) {
    return {
      eligible: false,
      alreadyClaimed: false,
      amount: config.amount || DEFAULT_BONUS_AMOUNT,
      reason: "missing_or_invalid_config",
      idempotencyKey,
    };
  }

  const createdAt = await fetchUserCreatedAt(userId, runSql);
  if (!createdAt) {
    return {
      eligible: false,
      alreadyClaimed: false,
      amount: config.amount,
      reason: "user_not_found",
      idempotencyKey,
      startAt: config.startAt,
    };
  }

  const claimed = await fetchClaimTransaction(userId, idempotencyKey, runSql);
  if (claimed) {
    return {
      eligible: false,
      alreadyClaimed: true,
      amount: config.amount,
      reason: "already_claimed",
      idempotencyKey,
      startAt: config.startAt,
      createdAt,
      transactionId: claimed.id,
    };
  }

  const eligible = Date.parse(createdAt) >= Date.parse(config.startAt);
  return {
    eligible,
    alreadyClaimed: false,
    amount: config.amount,
    reason: eligible ? "eligible" : "created_before_start",
    idempotencyKey,
    startAt: config.startAt,
    createdAt,
  };
}

function buildWelcomeBonusEntries(userId, amount) {
  const metadata = { source: "welcome_bonus", entry_role: "welcome_bonus" };
  return [
    {
      accountType: "USER",
      userId,
      amount,
      metadata,
    },
    {
      accountType: "SYSTEM",
      systemKey: GENESIS_SYSTEM_KEY,
      amount: -amount,
      metadata: { source: "welcome_bonus", entry_role: "genesis_offset" },
    },
  ];
}

async function claimWelcomeBonus(userId, deps = {}) {
  const writeTransaction = deps.postTransaction || postTransaction;
  const status = await getWelcomeBonusStatus(userId, deps);
  const baseLog = {
    userId,
    eligible: status.eligible,
    alreadyClaimed: status.alreadyClaimed,
    amount: status.amount,
    reason: status.reason,
  };

  if (!status.eligible) {
    klog("welcome_bonus_skipped", {
      ...baseLog,
      transactionId: status.transactionId || null,
    });
    return { ...status, claimed: false, transaction: null, entries: [], account: null };
  }

  try {
    const metadata = {
      source: "guest_conversion",
      amount: status.amount,
      welcome_bonus_start_at: status.startAt,
    };
    const result = await writeTransaction({
      userId,
      txType: "WELCOME_BONUS",
      idempotencyKey: status.idempotencyKey,
      reference: `welcome_bonus:${userId}`,
      description: "Welcome Bonus",
      metadata,
      entries: buildWelcomeBonusEntries(userId, status.amount),
      createdBy: userId,
    });
    const transactionId = result?.transaction?.id || null;
    klog("welcome_bonus_claimed", {
      ...baseLog,
      transactionId,
    });
    return {
      ...status,
      eligible: false,
      alreadyClaimed: true,
      claimed: true,
      reason: "claimed",
      transactionId,
      transaction: result?.transaction || null,
      entries: result?.entries || [],
      account: result?.account || null,
    };
  } catch (error) {
    klog("welcome_bonus_failed", {
      ...baseLog,
      reason: error?.code || error?.message || "server_error",
    });
    throw error;
  }
}

export {
  DEFAULT_BONUS_AMOUNT,
  GENESIS_SYSTEM_KEY,
  buildIdempotencyKey,
  claimWelcomeBonus,
  getConfig,
  getWelcomeBonusStatus,
};
