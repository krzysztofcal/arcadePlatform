const HUMAN_REACTION_COOLDOWN_MS = 4_000;
const BOT_TABLE_THROTTLE_MS = 20_000;
const BOT_REACTION_PROBABILITY = 0.02;

export const REACTION_KEYS = Object.freeze([
  "hello",
  "nice_hand",
  "well_played",
  "thinking",
  "haha",
  "wow",
  "bad_beat",
  "nice_bluff",
  "good_luck",
  "thanks"
]);

const REACTION_KEY_SET = new Set(REACTION_KEYS);
const BOT_REACTION_KEYS_BY_ACTION = Object.freeze({
  BET: Object.freeze(["wow", "haha"]),
  RAISE: Object.freeze(["wow", "haha"]),
  ALL_IN: Object.freeze(["wow", "haha"])
});

const senderCooldownUntilByTableUser = new Map();
const botReactionUntilByTable = new Map();

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNowMs(value) {
  return Number.isFinite(value) ? Math.trunc(value) : Date.now();
}

function isPositiveSeatNo(value) {
  return Number.isInteger(value) && value > 0;
}

function hasActiveCooldown(map, key, nowMs) {
  const expiresAt = Number(map.get(key));
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
    if (map.has(key)) map.delete(key);
    return false;
  }
  return true;
}

function normalizeBotActionType(botAction) {
  if (!botAction || typeof botAction !== "object" || Array.isArray(botAction)) {
    return "";
  }
  const value = typeof botAction.type === "string" ? botAction.type.trim().toUpperCase() : "";
  return value;
}

export function evaluateHumanReactionCommand({
  tableId,
  senderUserId,
  senderSeatNo,
  reactionKey,
  tableClosed = false,
  nowMs
} = {}) {
  const normalizedTableId = normalizeString(tableId);
  const normalizedUserId = normalizeString(senderUserId);
  const normalizedReactionKey = normalizeString(reactionKey);
  const resolvedNowMs = normalizeNowMs(nowMs);

  if (!normalizedTableId || !normalizedUserId || !isPositiveSeatNo(senderSeatNo)) {
    return { ok: false, reason: "invalid_sender" };
  }
  if (!REACTION_KEY_SET.has(normalizedReactionKey)) {
    return { ok: false, reason: "invalid_reaction" };
  }
  if (tableClosed === true) {
    return { ok: false, reason: "table_closed" };
  }

  const cooldownKey = `${normalizedTableId}:${normalizedUserId}`;
  if (hasActiveCooldown(senderCooldownUntilByTableUser, cooldownKey, resolvedNowMs)) {
    return { ok: false, reason: "reaction_rate_limited" };
  }

  senderCooldownUntilByTableUser.set(cooldownKey, resolvedNowMs + HUMAN_REACTION_COOLDOWN_MS);
  return {
    ok: true,
    seatNo: senderSeatNo,
    reactionKey: normalizedReactionKey
  };
}

export function tryCreateBotReaction({
  tableId,
  botUserId,
  botSeatNo,
  botAction,
  tableClosed = false,
  nowMs,
  random = Math.random
} = {}) {
  const normalizedTableId = normalizeString(tableId);
  const normalizedBotUserId = normalizeString(botUserId);
  const actionType = normalizeBotActionType(botAction);
  const availableReactionKeys = BOT_REACTION_KEYS_BY_ACTION[actionType];
  const resolvedNowMs = normalizeNowMs(nowMs);

  if (tableClosed === true || !normalizedTableId || !normalizedBotUserId || !isPositiveSeatNo(botSeatNo)) {
    return null;
  }
  if (!availableReactionKeys || availableReactionKeys.length === 0) {
    return null;
  }

  const sample = Number(random());
  if (!Number.isFinite(sample) || sample < 0 || sample >= BOT_REACTION_PROBABILITY) {
    return null;
  }

  const senderKey = `${normalizedTableId}:${normalizedBotUserId}`;
  if (hasActiveCooldown(senderCooldownUntilByTableUser, senderKey, resolvedNowMs)) {
    return null;
  }
  if (hasActiveCooldown(botReactionUntilByTable, normalizedTableId, resolvedNowMs)) {
    return null;
  }

  const selection = Number(random());
  const selectionIndex = Number.isFinite(selection) && selection >= 0 && selection < 1
    ? Math.floor(selection * availableReactionKeys.length)
    : 0;

  senderCooldownUntilByTableUser.set(senderKey, resolvedNowMs + HUMAN_REACTION_COOLDOWN_MS);
  botReactionUntilByTable.set(normalizedTableId, resolvedNowMs + BOT_TABLE_THROTTLE_MS);

  return {
    seatNo: botSeatNo,
    reactionKey: availableReactionKeys[selectionIndex] || availableReactionKeys[0]
  };
}

export function clearTable(tableId) {
  const normalizedTableId = normalizeString(tableId);
  if (!normalizedTableId) return;

  const prefix = `${normalizedTableId}:`;
  for (const key of [...senderCooldownUntilByTableUser.keys()]) {
    if (key.startsWith(prefix)) senderCooldownUntilByTableUser.delete(key);
  }
  botReactionUntilByTable.delete(normalizedTableId);
}
