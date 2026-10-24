// Canonical accepted WS strategy; browser Offline consumes these same functions.
function normalizeString(value) {
  return String(value == null ? "" : value).trim();
}

function clampRandom(random = Math.random) {
  const sampled = typeof random === "function" ? Number(random()) : Number(random);
  if (!Number.isFinite(sampled)) return 0;
  return Math.max(0, Math.min(0.999999, sampled));
}

function readAmount(entry) {
  if (!entry || typeof entry !== "object") return null;
  for (const key of ["min", "minimum", "minAmount", "amountMin", "amount"]) {
    const value = Number(entry[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function findAction(legalActions, actionType) {
  const target = normalizeString(actionType).toUpperCase();
  for (const entry of Array.isArray(legalActions) ? legalActions : []) {
    if (typeof entry === "string" && entry.toUpperCase() === target) return { type: target };
    const entryType = normalizeString(entry?.type || entry?.action).toUpperCase();
    if (entryType === target) return entry;
  }
  return null;
}

function botCardsFromContext(context = {}) {
  const userId = typeof context?.userId === "string" ? context.userId : "";
  const privateCards = context?.privateState?.holeCardsByUserId?.[userId];
  const publicCards = context?.state?.holeCardsByUserId?.[userId];
  return Array.isArray(privateCards) ? privateCards : Array.isArray(publicCards) ? publicCards : [];
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

function bucketStrength(strength) {
  if (strength >= 0.8) return "very_strong";
  if (strength >= 0.65) return "strong";
  if (strength >= 0.45) return "medium";
  if (strength >= 0.25) return "weak";
  return "very_weak";
}

function bucketRoll(roll) {
  if (roll < 0.2) return "low";
  if (roll < 0.5) return "medium";
  if (roll < 0.8) return "high";
  return "very_high";
}

function describeAggressiveActionSkip(legalActions, actionType) {
  const action = findAction(legalActions, actionType);
  if (!action) return null;
  const amount = readAmount(action);
  if (amount == null) return "missing_amount";
  if (Math.trunc(amount) <= 0) return "invalid_amount";
  return null;
}

function enrichBotLegalActions(legalInfo = {}) {
  const actions = Array.isArray(legalInfo?.actions) ? legalInfo.actions : [];
  const minRaiseTo = Number(legalInfo?.minRaiseTo);
  const maxRaiseTo = Number(legalInfo?.maxRaiseTo);
  const maxBetAmount = Number(legalInfo?.maxBetAmount);
  const minBetAmount = Number(legalInfo?.minBetAmount);
  const normalizedMinRaiseTo = Number.isFinite(minRaiseTo) ? Math.trunc(minRaiseTo) : null;
  const normalizedMaxRaiseTo = Number.isFinite(maxRaiseTo) ? Math.trunc(maxRaiseTo) : null;
  const normalizedMaxBetAmount = Number.isFinite(maxBetAmount) ? Math.trunc(maxBetAmount) : null;
  const normalizedMinBetAmount = Number.isFinite(minBetAmount) ? Math.trunc(minBetAmount) : null;
  const botMinBet = normalizedMinBetAmount > 0 ? normalizedMinBetAmount : 1;
  return actions.map((action) => {
    const type = typeof action === "string"
      ? action.toUpperCase()
      : normalizeString(action?.type || action?.action).toUpperCase();
    if (type === "BET" && normalizedMaxBetAmount > 0) {
      return {
        type: "BET",
        min: botMinBet,
        minAmount: botMinBet,
        amount: botMinBet,
        max: normalizedMaxBetAmount,
        maxAmount: normalizedMaxBetAmount
      };
    }
    if (type === "RAISE" && normalizedMinRaiseTo > 0) {
      return {
        type: "RAISE",
        min: normalizedMinRaiseTo,
        minAmount: normalizedMinRaiseTo,
        amount: normalizedMinRaiseTo,
        max: normalizedMaxRaiseTo,
        maxAmount: normalizedMaxRaiseTo
      };
    }
    return action;
  });
}

function buildBotDecisionDiagnostics({ legalActions, context, profile, roll, action }) {
  const cards = botCardsFromContext(context);
  const phase = normalizeString(context?.state?.phase).toUpperCase();
  const strength = phase === "PREFLOP" ? scorePreflop(cards) : scorePostflop(cards, context?.state?.community);
  return {
    botUserId: typeof context?.userId === "string" ? context.userId : null,
    botProfile: profile,
    phase: phase || null,
    handStrengthBucket: bucketStrength(strength),
    randomRollBucket: bucketRoll(roll),
    selectedAction: action?.type || null,
    selectedAmount: action?.amount ?? null,
    aggressiveActionSkips: {
      bet: describeAggressiveActionSkip(legalActions, "BET"),
      raise: describeAggressiveActionSkip(legalActions, "RAISE")
    }
  };
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
  const seatProfile = Array.isArray(context?.state?.seats) ? context.state.seats.find((seat) => seat?.userId === context?.userId)?.botProfile : null;
  const profile = normalizeString(context?.profile ?? context?.botProfile ?? seatProfile).toUpperCase() || "NORMAL";
  const cards = botCardsFromContext(context);
  const phase = normalizeString(context?.state?.phase).toUpperCase();
  const strength = phase === "PREFLOP" ? scorePreflop(cards) : scorePostflop(cards, context?.state?.community);
  const thresholds = strengthThresholds(profile);
  const roll = clampRandom(context?.random);
  const toCall = Number(context?.state?.toCallByUserId?.[context?.userId] ?? 0);
  const aggressiveTypes = hasAggressedThisRound(context) ? ["BET", "CALL", "CHECK", "FOLD"] : ["BET", "RAISE", "CALL", "CHECK", "FOLD"];
  if ((strength >= thresholds.bet && roll < thresholds.aggression) || roll < thresholds.bluff) return pickLegalAction(legalActions, aggressiveTypes);
  if (toCall <= 0 && strength >= thresholds.call - 0.15) return pickLegalAction(legalActions, ["CHECK", "BET", "CALL", "FOLD"]);
  if (strength >= thresholds.call || roll < thresholds.call * 0.35) return pickLegalAction(legalActions, ["CALL", "CHECK", "FOLD"]);
  return pickLegalAction(legalActions, ["CHECK", "FOLD", "CALL"]);
}


export { normalizeString, clampRandom, pickLegalAction, enrichBotLegalActions, buildBotDecisionDiagnostics, chooseBotActionProfiled };
