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

const toUuidLike = (input) => {
  const digest = createHash("sha256").update(input).digest();
  const bytes = digest.subarray(0, 16);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
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

  if (humans <= 0) return 0;
  if (humans >= totalSeats) return 0;

  const freeSeats = totalSeats - humans;
  const maxBotsAllowedByCapacity = Math.max(0, freeSeats - 1);
  return Math.max(0, Math.min(limit, maxBotsAllowedByCapacity));
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

export {
  chooseBotActionTrivial,
  computeTargetBotCount,
  getBotConfig,
  makeBotSystemKey,
  makeBotUserId,
};
