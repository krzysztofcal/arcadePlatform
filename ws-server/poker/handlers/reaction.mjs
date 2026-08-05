const HUMAN_REACTION_COOLDOWN_MS = 4_000;
const BOT_TABLE_THROTTLE_MS = 20_000;
const BOT_REACTION_PROBABILITY = 0.02;
const BOT_REACTION_JITTER_MIN_MS = 300;
const BOT_REACTION_JITTER_MAX_MS = 1_200;

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
  "thanks",
  "hurry_up",
  "you_are_bluffing",
  "i_was_bluffing",
  "lucky"
]);

export const HUMAN_REACTION_KEYS = Object.freeze([
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
const HUMAN_REACTION_KEY_SET = new Set(HUMAN_REACTION_KEYS);
const BOT_REACTION_KEYS_BY_ACTION = Object.freeze({
  BET: Object.freeze(["wow", "haha"]),
  ALL_IN: Object.freeze(["wow", "haha"])
});

const senderCooldownUntilByTableUser = new Map();
const botReactionUntilByTable = new Map();
const targetedNiceHandByTableUser = new Map();

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

function samplePasses(random, probability) {
  const sample = Number(random());
  return Number.isFinite(sample) && sample >= 0 && sample < probability;
}

function resolveJitterMs(random) {
  const sample = Number(random());
  const normalized = Number.isFinite(sample) && sample >= 0 && sample < 1 ? sample : 0;
  return BOT_REACTION_JITTER_MIN_MS
    + Math.floor(normalized * (BOT_REACTION_JITTER_MAX_MS - BOT_REACTION_JITTER_MIN_MS + 1));
}

function normalizeBotSeats(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((entry) => ({
      userId: normalizeString(entry?.userId),
      seatNo: Number(entry?.seatNo)
    }))
    .filter((entry) => entry.userId && isPositiveSeatNo(entry.seatNo) && !seen.has(entry.userId) && seen.add(entry.userId))
    .sort((left, right) => left.seatNo - right.seatNo);
}

function normalizeHandSeats(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((entry) => ({ userId: normalizeString(entry?.userId), seatNo: Number(entry?.seatNo) }))
    .filter((entry) => entry.userId && isPositiveSeatNo(entry.seatNo) && !seen.has(entry.userId) && seen.add(entry.userId))
    .sort((left, right) => left.seatNo - right.seatNo);
}

function winnerSeats(state, handSeats) {
  const winners = new Set(Array.isArray(state?.showdown?.winners)
    ? state.showdown.winners.map(normalizeString).filter(Boolean)
    : []);
  return handSeats.filter((seat) => winners.has(seat.userId));
}

function normalFoldWin(state, handSeats, winners) {
  if (winners.length !== 1 || handSeats.length < 2) return false;
  const winnerUserId = winners[0].userId;
  return handSeats.every((seat) => seat.userId === winnerUserId || (
    state?.foldedByUserId?.[seat.userId] === true
    && state?.leftTableByUserId?.[seat.userId] !== true
    && state?.sitOutByUserId?.[seat.userId] !== true
  ));
}

function canBotSpeakAfterSettlement(state, handSeats, bot) {
  return !!bot
    && handSeats.some((seat) => seat.userId === bot.userId)
    && state?.leftTableByUserId?.[bot.userId] !== true
    && state?.sitOutByUserId?.[bot.userId] !== true;
}

function canBotReactToSettlement(state, handSeats, bot, winners) {
  return canBotSpeakAfterSettlement(state, handSeats, bot)
    && !winners.some((winner) => winner.userId === bot.userId);
}

const PRIMARY_RANK_COUNT_BY_CATEGORY = Object.freeze({ 2: 1, 3: 2, 4: 1, 8: 1 });

function validRankVector(hand) {
  return Number.isInteger(Number(hand?.category))
    && Array.isArray(hand?.ranks)
    && hand.ranks.length > 0
    && hand.ranks.every((rank) => Number.isInteger(Number(rank)))
    ? hand.ranks.map(Number)
    : null;
}

function looksLuckyComparedWith(winningHand, losingHand) {
  const winningRanks = validRankVector(winningHand);
  const losingRanks = validRankVector(losingHand);
  const category = Number(winningHand?.category);
  if (!winningRanks || !losingRanks || category !== Number(losingHand?.category)) return false;
  const differingIndexes = [];
  for (let index = 0; index < Math.max(winningRanks.length, losingRanks.length); index += 1) {
    if ((winningRanks[index] ?? 0) !== (losingRanks[index] ?? 0)) differingIndexes.push(index);
  }
  if (differingIndexes.length === 0) return false;
  const firstDifference = differingIndexes[0];
  const primaryRankCount = PRIMARY_RANK_COUNT_BY_CATEGORY[category];
  const kickerDecided = Number.isInteger(primaryRankCount) && firstDifference >= primaryRankCount;
  const narrowRankDifference = Math.abs((winningRanks[firstDifference] ?? 0) - (losingRanks[firstDifference] ?? 0)) === 1;
  return kickerDecided || narrowRankDifference || differingIndexes.length === 1;
}

function luckyWinner(state, handSeats, winners) {
  const comparedHands = state?.showdown?.handsByUserId;
  const riverChangedWinnerUserIds = new Set(Array.isArray(state?.riverChangedWinnerUserIds)
    ? state.riverChangedWinnerUserIds.map(normalizeString).filter(Boolean)
    : []);
  if (!comparedHands || typeof comparedHands !== "object") {
    return winners.find((winner) => riverChangedWinnerUserIds.has(winner.userId)) || null;
  }
  const winnerUserIds = new Set(winners.map((winner) => winner.userId));
  const losers = handSeats.filter((seat) => !winnerUserIds.has(seat.userId));
  return winners.find((winner) => riverChangedWinnerUserIds.has(winner.userId)
    || losers.some((loser) => looksLuckyComparedWith(comparedHands[winner.userId], comparedHands[loser.userId]))) || null;
}

function reactionCard(cardCode) {
  if (typeof cardCode !== "string") return null;
  const match = cardCode.trim().toUpperCase().match(/^(10|[2-9TJQKA])([CDHS])$/);
  if (!match) return null;
  const rank = { T: 10, J: 11, Q: 12, K: 13, A: 14 }[match[1]] || Number(match[1]);
  return { r: rank, s: match[2] };
}

export function deriveRiverChangedWinnerUserIds(state) {
  if (!Array.isArray(state?.community) || state.community.length !== 5) return [];
  const turnBoard = state.community.slice(0, 4).map(reactionCard);
  if (turnBoard.some((card) => !card)) return [];
  const shownUserIds = Object.keys(state?.showdown?.handsByUserId || {}).sort();
  const turnHands = [];
  for (const userId of shownUserIds) {
    const holeCards = Array.isArray(state?.holeCardsByUserId?.[userId])
      ? state.holeCardsByUserId[userId].map(reactionCard)
      : [];
    if (holeCards.length !== 2 || holeCards.some((card) => !card)) return [];
    turnHands.push({ userId, hand: evaluateBestHand([...turnBoard, ...holeCards]) });
  }
  if (turnHands.length < 2) return [];
  let best = turnHands[0].hand;
  let turnWinners = [turnHands[0].userId];
  for (const entry of turnHands.slice(1)) {
    const comparison = compareHands(entry.hand, best);
    if (comparison > 0) {
      best = entry.hand;
      turnWinners = [entry.userId];
    } else if (comparison === 0) {
      turnWinners.push(entry.userId);
    }
  }
  const turnWinnerSet = new Set(turnWinners);
  return (Array.isArray(state?.showdown?.winners) ? state.showdown.winners : [])
    .filter((userId) => typeof userId === "string" && !turnWinnerSet.has(userId));
}

export function isCompleteReactionSettlement(state) {
  if (!state || state.phase !== "SETTLED") return false;
  const handId = normalizeString(state.handId);
  return !!handId
    && handId === normalizeString(state?.handSettlement?.handId)
    && handId === normalizeString(state?.showdown?.handId)
    && Array.isArray(state.handSeats)
    && Array.isArray(state.showdown?.winners)
    && !!state.handSettlement?.payouts
    && typeof state.handSettlement.payouts === "object"
    && !Array.isArray(state.handSettlement.payouts);
}

export function evaluateHumanReactionCommand({
  tableId,
  senderUserId,
  senderSeatNo,
  reactionKey,
  targeted = false,
  targetSeatNo,
  targetOccupied = false,
  targetIsWinner = false,
  settlementMatchesHand = false,
  settlementWindowOpen = false,
  settlementHandId,
  tableClosed = false,
  nowMs
} = {}) {
  const normalizedTableId = normalizeString(tableId);
  const normalizedUserId = normalizeString(senderUserId);
  const normalizedReactionKey = normalizeString(reactionKey);
  const normalizedSettlementHandId = normalizeString(settlementHandId);
  const resolvedNowMs = normalizeNowMs(nowMs);

  if (!normalizedTableId || !normalizedUserId || !isPositiveSeatNo(senderSeatNo)) {
    return { ok: false, reason: "invalid_sender" };
  }
  if (!HUMAN_REACTION_KEY_SET.has(normalizedReactionKey)) {
    return { ok: false, reason: "invalid_reaction" };
  }
  if (targeted === true) {
    if (normalizedReactionKey !== "nice_hand") {
      return { ok: false, reason: "invalid_reaction" };
    }
    if (!isPositiveSeatNo(targetSeatNo) || targetSeatNo === senderSeatNo) {
      return { ok: false, reason: "target_not_available" };
    }
    if (settlementMatchesHand !== true) {
      return { ok: false, reason: "settlement_mismatch" };
    }
    if (targetOccupied !== true || targetIsWinner !== true) {
      return { ok: false, reason: "target_not_available" };
    }
    if (settlementWindowOpen !== true) {
      return { ok: false, reason: "settlement_reaction_window_closed" };
    }
    if (!normalizedSettlementHandId) {
      return { ok: false, reason: "settlement_mismatch" };
    }
  }
  if (tableClosed === true) {
    return { ok: false, reason: "table_closed" };
  }

  if (targeted === true) {
    const dedupeKey = `${normalizedTableId}:${normalizedUserId}`;
    let dedupe = targetedNiceHandByTableUser.get(dedupeKey);
    if (!dedupe || dedupe.settlementHandId !== normalizedSettlementHandId) {
      dedupe = { settlementHandId: normalizedSettlementHandId, targetSeatNos: new Set() };
      targetedNiceHandByTableUser.set(dedupeKey, dedupe);
    }
    if (dedupe.targetSeatNos.has(targetSeatNo)) {
      return { ok: false, reason: "reaction_already_sent" };
    }
    dedupe.targetSeatNos.add(targetSeatNo);
    return {
      ok: true,
      seatNo: senderSeatNo,
      targetSeatNo,
      reactionKey: normalizedReactionKey
    };
  }

  const cooldownKey = `${normalizedTableId}:${normalizedUserId}`;
  if (hasActiveCooldown(senderCooldownUntilByTableUser, cooldownKey, resolvedNowMs)) {
    return { ok: false, reason: "reaction_rate_limited" };
  }

  senderCooldownUntilByTableUser.set(cooldownKey, resolvedNowMs + HUMAN_REACTION_COOLDOWN_MS);
  return {
    ok: true,
    seatNo: senderSeatNo,
    reactionKey: normalizedReactionKey,
    ...(targeted === true ? { targetSeatNo } : {})
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

  if (!samplePasses(random, BOT_REACTION_PROBABILITY)) {
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
    reactionKey: availableReactionKeys[selectionIndex] || availableReactionKeys[0],
    delayMs: resolveJitterMs(random)
  };
}

export function tryReserveBotReaction({
  tableId,
  botUserId,
  botSeatNo,
  reactionKey,
  targetSeatNo,
  tableClosed = false,
  nowMs,
  random = Math.random
} = {}) {
  const normalizedTableId = normalizeString(tableId);
  const normalizedBotUserId = normalizeString(botUserId);
  const normalizedReactionKey = normalizeString(reactionKey);
  const resolvedNowMs = normalizeNowMs(nowMs);
  if (tableClosed === true || !normalizedTableId || !normalizedBotUserId || !isPositiveSeatNo(botSeatNo)) return null;
  if (!REACTION_KEY_SET.has(normalizedReactionKey)) return null;
  if (targetSeatNo != null && (!isPositiveSeatNo(targetSeatNo) || targetSeatNo === botSeatNo)) return null;
  const senderKey = `${normalizedTableId}:${normalizedBotUserId}`;
  if (hasActiveCooldown(senderCooldownUntilByTableUser, senderKey, resolvedNowMs)) return null;
  if (hasActiveCooldown(botReactionUntilByTable, normalizedTableId, resolvedNowMs)) return null;
  senderCooldownUntilByTableUser.set(senderKey, resolvedNowMs + HUMAN_REACTION_COOLDOWN_MS);
  botReactionUntilByTable.set(normalizedTableId, resolvedNowMs + BOT_TABLE_THROTTLE_MS);
  return {
    seatNo: botSeatNo,
    ...(isPositiveSeatNo(targetSeatNo) ? { targetSeatNo } : {}),
    reactionKey: normalizedReactionKey,
    delayMs: resolveJitterMs(random)
  };
}

export function classifyRaiseReaction({ actorUserId, actorSeatNo, botSeats, random = Math.random } = {}) {
  const normalizedActorUserId = normalizeString(actorUserId);
  if (!normalizedActorUserId || !isPositiveSeatNo(actorSeatNo) || !samplePasses(random, 0.08)) return null;
  const reactor = normalizeBotSeats(botSeats).find((bot) => bot.userId !== normalizedActorUserId);
  return reactor ? {
    botUserId: reactor.userId,
    botSeatNo: reactor.seatNo,
    targetSeatNo: actorSeatNo,
    reactionKey: "you_are_bluffing"
  } : null;
}

export function classifyDirectedBotReaction({
  botSeats,
  excludedUserId,
  targetSeatNo,
  reactionKeys,
  probability,
  random = Math.random
} = {}) {
  if (!isPositiveSeatNo(targetSeatNo) || !Array.isArray(reactionKeys) || reactionKeys.length === 0) return null;
  if (!samplePasses(random, probability)) return null;
  const normalizedExcludedUserId = normalizeString(excludedUserId);
  const reactor = normalizeBotSeats(botSeats).find((bot) => bot.userId !== normalizedExcludedUserId);
  const availableKeys = reactionKeys.map(normalizeString).filter((key) => REACTION_KEY_SET.has(key));
  if (!reactor || availableKeys.length === 0) return null;
  const selection = Number(random());
  const selectionIndex = Number.isFinite(selection) && selection >= 0 && selection < 1
    ? Math.floor(selection * availableKeys.length)
    : 0;
  return {
    botUserId: reactor.userId,
    botSeatNo: reactor.seatNo,
    targetSeatNo,
    reactionKey: availableKeys[selectionIndex] || availableKeys[0]
  };
}

export function classifySettlementReaction({ state, botSeats, random = Math.random } = {}) {
  if (!isCompleteReactionSettlement(state)) return null;
  const handId = normalizeString(state.handId);
  const handSeats = normalizeHandSeats(state.handSeats);
  const bots = normalizeBotSeats(botSeats);
  const botByUserId = new Map(bots.map((bot) => [bot.userId, bot]));
  const winners = winnerSeats(state, handSeats);
  if (normalFoldWin(state, handSeats, winners)) {
    const winner = winners[0];
    const winningBot = botByUserId.get(winner.userId);
    if (canBotSpeakAfterSettlement(state, handSeats, winningBot) && samplePasses(random, 0.5)) {
      return { botUserId: winningBot.userId, botSeatNo: winningBot.seatNo, reactionKey: "i_was_bluffing", handId };
    }
    const reactor = bots.find((bot) => canBotReactToSettlement(state, handSeats, bot, winners));
    if (reactor && samplePasses(random, 0.5)) {
      return { botUserId: reactor.userId, botSeatNo: reactor.seatNo, targetSeatNo: winner.seatNo, reactionKey: "nice_bluff", handId };
    }
  }
  const comparedHands = state?.showdown?.handsByUserId;
  const luckyTarget = luckyWinner(state, handSeats, winners);
  const luckyReactor = bots.find((bot) => canBotReactToSettlement(state, handSeats, bot, winners));
  if (luckyTarget && luckyReactor && samplePasses(random, 0.25)) {
    return { botUserId: luckyReactor.userId, botSeatNo: luckyReactor.seatNo, targetSeatNo: luckyTarget.seatNo, reactionKey: "lucky", handId };
  }
  if (comparedHands && typeof comparedHands === "object" && Object.keys(comparedHands).length >= 2) {
    const strongWinner = winners.find((winner) => Number(comparedHands?.[winner.userId]?.category) >= 4);
    const reactor = bots.find((bot) => canBotReactToSettlement(state, handSeats, bot, winners));
    if (strongWinner && reactor && samplePasses(random, 0.5)) {
      return { botUserId: reactor.userId, botSeatNo: reactor.seatNo, targetSeatNo: strongWinner.seatNo, reactionKey: "nice_hand", handId };
    }
  }
  const bigBlind = Number(state.bigBlind);
  if (Number.isInteger(bigBlind) && bigBlind > 0) {
    const largeWinner = winners.find((winner) => {
      const payout = Number(state?.handSettlement?.payouts?.[winner.userId]);
      return botByUserId.has(winner.userId) && Number.isFinite(payout) && payout >= 20 * bigBlind;
    });
    if (largeWinner) {
      const bot = botByUserId.get(largeWinner.userId);
      return { botUserId: bot.userId, botSeatNo: bot.seatNo, reactionKey: "wow", handId };
    }
  }
  const firstWinner = winners[0];
  const reactor = bots.find((bot) => canBotReactToSettlement(state, handSeats, bot, winners));
  if (firstWinner && reactor && samplePasses(random, 0.25)) {
    return { botUserId: reactor.userId, botSeatNo: reactor.seatNo, targetSeatNo: firstWinner.seatNo, reactionKey: "well_played", handId };
  }
  return null;
}

export function clearTable(tableId) {
  const normalizedTableId = normalizeString(tableId);
  if (!normalizedTableId) return;

  const prefix = `${normalizedTableId}:`;
  for (const key of [...senderCooldownUntilByTableUser.keys()]) {
    if (key.startsWith(prefix)) senderCooldownUntilByTableUser.delete(key);
  }
  for (const key of [...targetedNiceHandByTableUser.keys()]) {
    if (key.startsWith(prefix)) targetedNiceHandByTableUser.delete(key);
  }
  botReactionUntilByTable.delete(normalizedTableId);
}
import { compareHands, evaluateBestHand } from "../shared/settlement/poker-eval.mjs";
