import { createHash } from "node:crypto";

const TRUE_SET = new Set(["1", "true", "yes"]);
const FALSE_SET = new Set(["0", "false", "no"]);

const normalizeString = (value) => String(value == null ? "" : value).trim();

const parseBool = (value, fallback = false) => {
  const normalized = normalizeString(value).toLowerCase();
  if (TRUE_SET.has(normalized)) return true;
  if (FALSE_SET.has(normalized)) return false;
  return fallback;
};

const parseIntClamped = (value, fallback, min, max) => {
  const parsed = Number.parseInt(normalizeString(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
};

const parseProfile = (value, fallback = "TRIVIAL") => {
  const normalized = normalizeString(value).toUpperCase();
  return normalized || fallback;
};

const readAmount = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  const candidates = [entry.min, entry.minimum, entry.minAmount, entry.amountMin, entry.amount];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
};

const findAction = (legalActions, actionType) => {
  if (!Array.isArray(legalActions)) return null;
  const target = String(actionType || "").toUpperCase();
  for (const entry of legalActions) {
    if (typeof entry === "string") {
      if (entry.toUpperCase() === target) return { type: target };
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const entryType = String(entry.type || entry.action || "").toUpperCase();
    if (entryType === target) return entry;
  }
  return null;
};

const toHex = (bytes) => Buffer.from(bytes).toString("hex");

const toUuidLike = (input) => {
  const bytes = Buffer.from(createHash("sha256").update(input).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return `${toHex(bytes.subarray(0, 4))}-${toHex(bytes.subarray(4, 6))}-${toHex(bytes.subarray(6, 8))}-${toHex(bytes.subarray(8, 10))}-${toHex(bytes.subarray(10, 16))}`;
};

function getBotConfig(env = process.env) {
  const source = env || {};
  return {
    enabled: parseBool(source.POKER_BOTS_ENABLED, false),
    maxPerTable: parseIntClamped(source.POKER_BOTS_MAX_PER_TABLE, 2, 0, 9),
    defaultProfile: parseProfile(source.POKER_BOT_PROFILE_DEFAULT, "TRIVIAL"),
    buyInBB: parseIntClamped(source.POKER_BOT_BUYIN_BB, 100, 1, 1000),
    bankrollSystemKey: normalizeString(source.POKER_BOT_BANKROLL_SYSTEM_KEY) || "TREASURY",
    maxActionsPerPoll: parseIntClamped(source.POKER_BOTS_MAX_ACTIONS_PER_POLL, 2, 0, 10),
  };
}

function makeBotUserId(tableId, seatNo) {
  return toUuidLike(`${tableId ?? ""}:${seatNo ?? ""}`);
}

function makeBotSystemKey(tableId, seatNo) {
  return `POKER_BOT:${tableId}:${seatNo}`;
}

function computeTargetBotCount({ maxPlayers, humanCount, maxBots } = {}) {
  const totalSeats = Number.isFinite(Number(maxPlayers)) ? Math.trunc(Number(maxPlayers)) : 0;
  const humans = Number.isFinite(Number(humanCount)) ? Math.trunc(Number(humanCount)) : 0;
  const limit = Number.isFinite(Number(maxBots)) ? Math.trunc(Number(maxBots)) : 0;
  const totalSeatsSafe = Math.max(0, totalSeats);
  const humansSafe = Math.max(0, humans);
  const limitSafe = Math.max(0, limit);

  if (humansSafe <= 0) return 0;
  if (humansSafe >= totalSeatsSafe) return 0;

  const maxBotsAllowedByCapacity = Math.max(0, (totalSeatsSafe - humansSafe) - 1);
  return Math.max(0, Math.min(limitSafe, maxBotsAllowedByCapacity));
}

function chooseBotActionTrivial(legalActions) {
  const check = findAction(legalActions, "CHECK");
  if (check) return { type: "CHECK" };

  const call = findAction(legalActions, "CALL");
  if (call) return { type: "CALL" };

  const fold = findAction(legalActions, "FOLD");
  if (fold) return { type: "FOLD" };

  const bet = findAction(legalActions, "BET");
  if (bet) {
    const amount = readAmount(bet);
    return { type: "BET", amount: amount == null ? 0 : amount };
  }

  const raise = findAction(legalActions, "RAISE");
  if (raise) {
    const amount = readAmount(raise);
    return { type: "RAISE", amount: amount == null ? 0 : amount };
  }

  return null;
}

function getBotAutoplayConfig(env = process.env) {
  const source = env || {};
  return {
    maxActionsPerRequest: parseIntClamped(source.POKER_BOTS_MAX_ACTIONS_PER_REQUEST, 5, 1, 20),
    botsOnlyHandCompletionHardCap: parseIntClamped(source.POKER_BOTS_BOTS_ONLY_HAND_HARD_CAP, 80, 10, 250),
    policyVersion: normalizeString(source.POKER_BOT_POLICY_VERSION) || "TRIVIAL_V1",
  };
}

function buildSeatBotMap(seatRows) {
  const rows = Array.isArray(seatRows) ? seatRows : [];
  const map = new Map();
  for (const row of rows) {
    const userId = typeof row?.user_id === "string" ? row.user_id.trim() : "";
    if (!userId) continue;
    map.set(userId, !!row?.is_bot);
  }
  return map;
}

function isBotTurn(turnUserId, seatBotMap) {
  if (typeof turnUserId !== "string" || !turnUserId.trim()) return false;
  if (!(seatBotMap instanceof Map)) return false;
  return seatBotMap.get(turnUserId) === true;
}

export {
  buildSeatBotMap,
  chooseBotActionTrivial,
  computeTargetBotCount,
  getBotAutoplayConfig,
  getBotConfig,
  isBotTurn,
  makeBotSystemKey,
  makeBotUserId,
};
