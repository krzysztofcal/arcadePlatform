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

const BOT_PROFILES = ["TIGHT", "NORMAL", "LOOSE"];

const parseProfile = (value, fallback = "RANDOM") => {
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
    minPerTable: parseIntClamped(source.POKER_BOTS_MIN_PER_TABLE, 2, 0, 9),
    maxPerTable: parseIntClamped(source.POKER_BOTS_MAX_PER_TABLE, 5, 0, 9),
    defaultProfile: parseProfile(source.POKER_BOT_PROFILE_DEFAULT, "RANDOM"),
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

function clampRandom(random = Math.random) {
  const sampled = typeof random === "function" ? Number(random()) : Number(random);
  if (!Number.isFinite(sampled)) return 0;
  return Math.max(0, Math.min(0.999999, sampled));
}

function randomIntInclusive(min, max, random = Math.random) {
  const low = Math.ceil(Number(min));
  const high = Math.floor(Number(max));
  if (!Number.isInteger(low) || !Number.isInteger(high) || high < low) return low;
  return low + Math.floor((high - low + 1) * clampRandom(random));
}

function normalizeBotProfile(value, random = Math.random) {
  const normalized = normalizeString(value).toUpperCase();
  if (BOT_PROFILES.includes(normalized)) return normalized;
  if (normalized === "TRIVIAL" || normalized === "DEFAULT") return "NORMAL";
  const index = randomIntInclusive(0, BOT_PROFILES.length - 1, random);
  return BOT_PROFILES[index] || "NORMAL";
}

function computeTargetBotCount({ maxPlayers, humanCount, maxBots, minBots = 2, random = Math.random } = {}) {
  const totalSeats = Number.isFinite(Number(maxPlayers)) ? Math.trunc(Number(maxPlayers)) : 0;
  const humans = Number.isFinite(Number(humanCount)) ? Math.trunc(Number(humanCount)) : 0;
  const limit = Number.isFinite(Number(maxBots)) ? Math.trunc(Number(maxBots)) : 0;
  const minimum = Number.isFinite(Number(minBots)) ? Math.trunc(Number(minBots)) : 0;
  const totalSeatsSafe = Math.max(0, totalSeats);
  const humansSafe = Math.max(0, humans);
  const limitSafe = Math.max(0, limit);
  const minimumSafe = Math.max(0, minimum);

  if (humansSafe <= 0) return 0;
  if (humansSafe >= totalSeatsSafe) return 0;

  const maxBotsAllowedByCapacity = Math.max(0, totalSeatsSafe - humansSafe);
  const upper = Math.max(0, Math.min(limitSafe, maxBotsAllowedByCapacity));
  if (upper <= 0) return 0;
  const lower = Math.min(upper, Math.max(1, minimumSafe));
  return randomIntInclusive(lower, upper, random);
}

function cardRank(card) {
  const raw = typeof card === "string" ? card.trim().slice(0, -1).toUpperCase() : card?.r;
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  if (raw === "A") return 14;
  if (raw === "K") return 13;
  if (raw === "Q") return 12;
  if (raw === "J") return 11;
  if (raw === "T" || raw === "10") return 10;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 2 && parsed <= 14 ? parsed : 0;
}

function cardSuit(card) {
  return typeof card === "string" ? card.trim().slice(-1).toUpperCase() : normalizeString(card?.s).toUpperCase();
}

function botCardsFromContext(context = {}) {
  const userId = typeof context?.userId === "string" ? context.userId : "";
  const privateCards = context?.privateState?.holeCardsByUserId?.[userId];
  const publicCards = context?.state?.holeCardsByUserId?.[userId];
  return Array.isArray(privateCards) ? privateCards : Array.isArray(publicCards) ? publicCards : [];
}

function scorePreflop(cards) {
  if (!Array.isArray(cards) || cards.length < 2) return 0.45;
  const ranks = cards.map(cardRank).sort((a, b) => b - a);
  const suited = cardSuit(cards[0]) && cardSuit(cards[0]) === cardSuit(cards[1]);
  const pair = ranks[0] === ranks[1];
  const high = ranks[0] || 0;
  const low = ranks[1] || 0;
  if (pair) return high >= 11 ? 0.95 : high >= 8 ? 0.78 : 0.62;
  let score = (high + low) / 28;
  if (suited) score += 0.1;
  if (high >= 14 && low >= 10) score += 0.2;
  else if (high >= 13 && low >= 10) score += 0.12;
  if (Math.abs(high - low) <= 2) score += 0.05;
  return Math.max(0.05, Math.min(0.98, score));
}

function scorePostflop(cards, community) {
  const allCards = [...(Array.isArray(cards) ? cards : []), ...(Array.isArray(community) ? community : [])];
  if (allCards.length < 3) return scorePreflop(cards);
  const rankCounts = new Map();
  const suitCounts = new Map();
  for (const card of allCards) {
    const rank = cardRank(card);
    const suit = cardSuit(card);
    if (rank) rankCounts.set(rank, (rankCounts.get(rank) || 0) + 1);
    if (suit) suitCounts.set(suit, (suitCounts.get(suit) || 0) + 1);
  }
  const counts = [...rankCounts.values()].sort((a, b) => b - a);
  const maxSuit = Math.max(0, ...suitCounts.values());
  if (counts[0] >= 4) return 0.98;
  if (counts[0] >= 3 && counts[1] >= 2) return 0.94;
  if (maxSuit >= 5) return 0.9;
  if (counts[0] >= 3) return 0.82;
  if (counts[0] >= 2 && counts[1] >= 2) return 0.72;
  if (counts[0] >= 2) return 0.58;
  return Math.max(0.1, Math.min(0.55, scorePreflop(cards) - 0.12 + (maxSuit === 4 ? 0.12 : 0)));
}

function strengthThresholds(profile) {
  if (profile === "TIGHT") return { bet: 0.78, call: 0.55, bluff: 0.06, aggression: 0.28 };
  if (profile === "LOOSE") return { bet: 0.62, call: 0.32, bluff: 0.18, aggression: 0.55 };
  return { bet: 0.7, call: 0.43, bluff: 0.11, aggression: 0.38 };
}

function pickLegalAction(legalActions, preferredTypes) {
  for (const type of preferredTypes) {
    const action = findAction(legalActions, type);
    if (!action) continue;
    const amount = readAmount(action);
    if (type === "BET" || type === "RAISE") {
      if (amount == null) continue;
      const normalizedAmount = Math.trunc(amount);
      if (normalizedAmount <= 0) continue;
      return { type, amount: normalizedAmount };
    }
    return { type };
  }
  return null;
}

function hasAggressedThisRound(context = {}) {
  const userId = typeof context?.userId === "string" ? context.userId : "";
  const lastAction = normalizeString(context?.state?.lastBettingRoundActionByUserId?.[userId]).toUpperCase();
  return lastAction === "BET" || lastAction === "RAISE";
}

function chooseBotActionProfiled(legalActions, context = {}) {
  const seatProfile = Array.isArray(context?.state?.seats)
    ? context.state.seats.find((seat) => seat?.userId === context?.userId)?.botProfile
    : null;
  const profile = normalizeBotProfile(context?.profile ?? context?.botProfile ?? seatProfile, context?.random);
  const cards = botCardsFromContext(context);
  const phase = normalizeString(context?.state?.phase).toUpperCase();
  const strength = phase === "PREFLOP" ? scorePreflop(cards) : scorePostflop(cards, context?.state?.community);
  const thresholds = strengthThresholds(profile);
  const roll = clampRandom(context?.random);
  const toCall = Number(context?.state?.toCallByUserId?.[context?.userId] ?? 0);
  const aggressiveTypes = hasAggressedThisRound(context) ? ["BET", "CALL", "CHECK", "FOLD"] : ["BET", "RAISE", "CALL", "CHECK", "FOLD"];

  if ((strength >= thresholds.bet && roll < thresholds.aggression) || roll < thresholds.bluff) {
    return pickLegalAction(legalActions, aggressiveTypes);
  }
  if (toCall <= 0 && strength >= thresholds.call - 0.15) {
    return pickLegalAction(legalActions, ["CHECK", "BET", "CALL", "FOLD"]);
  }
  if (strength >= thresholds.call || roll < thresholds.call * 0.35) {
    return pickLegalAction(legalActions, ["CALL", "CHECK", "FOLD"]);
  }
  return pickLegalAction(legalActions, ["CHECK", "FOLD", "CALL"]);
}

function chooseBotActionTrivial(legalActions, context = {}) {
  const profiled = chooseBotActionProfiled(legalActions, context);
  if (profiled) return profiled;

  const check = findAction(legalActions, "CHECK");
  if (check) return { type: "CHECK" };

  const call = findAction(legalActions, "CALL");
  if (call) return { type: "CALL" };

  const fold = findAction(legalActions, "FOLD");
  if (fold) return { type: "FOLD" };

  return null;
}

function getBotAutoplayConfig(env = process.env) {
  const source = env || {};
  return {
    maxActionsPerRequest: parseIntClamped(source.POKER_BOTS_MAX_ACTIONS_PER_REQUEST, 5, 1, 20),
    botsOnlyHandCompletionHardCap: parseIntClamped(source.POKER_BOTS_BOTS_ONLY_HAND_HARD_CAP, 80, 10, 250),
    policyVersion: normalizeString(source.POKER_BOT_POLICY_VERSION) || "PROFILED_RANDOM_V1",
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
  chooseBotActionProfiled,
  chooseBotActionTrivial,
  computeTargetBotCount,
  getBotAutoplayConfig,
  getBotConfig,
  isBotTurn,
  makeBotSystemKey,
  makeBotUserId,
};
