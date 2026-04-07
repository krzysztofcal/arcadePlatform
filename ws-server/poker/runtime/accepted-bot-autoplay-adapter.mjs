import { TURN_MS } from "../shared/poker-turn-timeout.mjs";
import { applyAction as applySharedAction } from "../shared/poker-action-reducer.mjs";
import { materializeShowdownAndPayout as materializeSharedShowdownAndPayout } from "../shared/settlement/poker-materialize-showdown.mjs";
import { computeShowdown as computeSharedShowdown } from "../shared/settlement/poker-showdown.mjs";
import { awardPotsAtShowdown as awardSharedPotsAtShowdown } from "../shared/settlement/poker-payout.mjs";
import { withoutPrivateState as withoutSharedPrivateState } from "../shared/settlement/poker-state-utils.mjs";
import { computeSharedLegalActions } from "../shared/poker-primitives.mjs";
import { advanceIfNeeded as advanceLegacyIfNeeded, applyAction as applyLegacyRuntimeAction } from "../snapshot-runtime/poker-reducer.mjs";
import { materializeShowdownAndPayout as materializeLegacyShowdownAndPayout } from "../snapshot-runtime/poker-materialize-showdown.mjs";
import { computeShowdown as computeLegacyShowdown } from "../snapshot-runtime/poker-showdown.mjs";
import { awardPotsAtShowdown as awardLegacyPotsAtShowdown } from "../snapshot-runtime/poker-payout.mjs";
import { withoutPrivateState as withoutLegacyPrivateState } from "../snapshot-runtime/poker-state-utils.mjs";
import { computeLegalActions as computeLegacyLegalActions } from "../snapshot-runtime/poker-legal-actions.mjs";

const DEFAULT_SHARED_AUTOPLAY_MODULE_URL = new URL("../../../shared/poker-domain/poker-autoplay.mjs", import.meta.url).href;
const sharedAutoplayModulePromiseByUrl = new Map();

const isActionPhase = (phase) => phase === "PREFLOP" || phase === "FLOP" || phase === "TURN" || phase === "RIVER";
const noopAdvanceIfNeeded = (state) => ({ state, events: [] });

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeCardForSharedSettlement(card) {
  if (typeof card === "string") {
    const match = /^(10|[2-9TJQKA])([CDHS])$/i.exec(card.trim());
    if (!match) return null;
    return { r: match[1].toUpperCase(), s: match[2].toUpperCase() };
  }
  if (!isPlainObject(card)) return null;
  const suit = typeof card.s === "string" ? card.s.trim().toUpperCase() : "";
  if (!suit) return null;
  if (typeof card.r === "number" && Number.isInteger(card.r) && card.r >= 2 && card.r <= 14) {
    return { r: card.r, s: suit };
  }
  if (typeof card.r === "string" && card.r.trim()) {
    return { r: card.r.trim().toUpperCase(), s: suit };
  }
  return null;
}

function normalizeCardsForSharedSettlement(cards) {
  if (!Array.isArray(cards)) return [];
  return cards.map(normalizeCardForSharedSettlement).filter(Boolean);
}

function normalizeHoleCardsMapForSharedSettlement(holeCardsByUserId) {
  if (!isPlainObject(holeCardsByUserId)) return {};
  const out = {};
  for (const [userId, cards] of Object.entries(holeCardsByUserId)) {
    if (typeof userId !== "string" || !userId.trim()) continue;
    const normalizedCards = normalizeCardsForSharedSettlement(cards);
    if (normalizedCards.length === 2) {
      out[userId] = normalizedCards;
    }
  }
  return out;
}

function hasStringCards(cards) {
  return Array.isArray(cards) && cards.some((card) => typeof card === "string");
}

function isEngineStateShape(state) {
  if (!isPlainObject(state)) return false;
  if (Number.isFinite(Number(state.potTotal))) return true;
  if (hasStringCards(state.community) || hasStringCards(state.deck)) return true;
  if (!isPlainObject(state.holeCardsByUserId)) return false;
  return Object.values(state.holeCardsByUserId).some((cards) => hasStringCards(cards));
}

function resolveSharedAutoplayModule(moduleUrl) {
  if (!sharedAutoplayModulePromiseByUrl.has(moduleUrl)) {
    sharedAutoplayModulePromiseByUrl.set(moduleUrl, import(moduleUrl));
  }
  return sharedAutoplayModulePromiseByUrl.get(moduleUrl);
}

function resolveSharedAutoplayModuleUrl(env = process.env) {
  const configured = typeof env?.WS_BOT_AUTOPLAY_MODULE_PATH === "string" ? env.WS_BOT_AUTOPLAY_MODULE_PATH.trim() : "";
  if (!configured) {
    return DEFAULT_SHARED_AUTOPLAY_MODULE_URL;
  }
  return configured;
}

function isBotTurn(turnUserId, seatBotMap) {
  if (typeof turnUserId !== "string" || !turnUserId.trim()) return false;
  if (seatBotMap instanceof Map) return seatBotMap.get(turnUserId) === true;
  return !!seatBotMap?.[turnUserId];
}

function isBotTurnAuthoritatively(tableManager, tableId, turnUserId, seatBotMap) {
  if (typeof tableManager?.isBotUser === "function") {
    return tableManager.isBotUser(tableId, turnUserId) === true;
  }
  return isBotTurn(turnUserId, seatBotMap);
}

function chooseBotActionTrivial(legalActions) {
  const actions = Array.isArray(legalActions) ? legalActions : [];
  if (actions.includes("CHECK")) return { type: "CHECK" };
  if (actions.includes("CALL")) return { type: "CALL" };
  if (actions.includes("FOLD")) return { type: "FOLD" };
  const bet = actions.find((entry) => entry && typeof entry === "object" && entry.type === "BET");
  if (bet) return { type: "BET", amount: Number.isFinite(Number(bet.min)) ? Number(bet.min) : 0 };
  const raise = actions.find((entry) => entry && typeof entry === "object" && entry.type === "RAISE");
  if (raise) return { type: "RAISE", amount: Number.isFinite(Number(raise.min)) ? Number(raise.min) : 0 };
  return null;
}

function buildSeatBotMap(seats) {
  const rows = Array.isArray(seats) ? seats : [];
  const map = new Map();
  for (const seat of rows) {
    const userId = typeof seat?.userId === "string" ? seat.userId.trim() : "";
    if (!userId) continue;
    map.set(userId, seat?.isBot === true);
  }
  return map;
}

function buildSeatUserIdsInOrder(state) {
  const seats = Array.isArray(state?.seats) ? state.seats.slice() : [];
  return seats
    .filter((seat) => typeof seat?.userId === "string" && seat.userId.trim() && Number.isInteger(Number(seat?.seatNo)))
    .sort((a, b) => Number(a.seatNo) - Number(b.seatNo))
    .map((seat) => seat.userId.trim());
}

function getBotAutoplayConfig(env = process.env) {
  const hardCapRaw = Number(env?.POKER_BOTS_BOTS_ONLY_HAND_HARD_CAP);
  const botsOnlyHandCompletionHardCap = Number.isInteger(hardCapRaw) && hardCapRaw > 0 ? hardCapRaw : 80;
  return { botsOnlyHandCompletionHardCap, policyVersion: "WS_SHARED_AUTOPLAY" };
}

function buildPersistedFromPrivateState(privateStateInput, actorUserId, actionRequestId, withoutPrivateStateImpl = withoutLegacyPrivateState) {
  const persistedState = withoutPrivateStateImpl(privateStateInput);
  const actionUserId = typeof actorUserId === "string" ? actorUserId.trim() : "";
  const requestId = typeof actionRequestId === "string" ? actionRequestId.trim() : "";
  const baseLastActionRequestIdByUserId = persistedState?.lastActionRequestIdByUserId && typeof persistedState.lastActionRequestIdByUserId === "object" && !Array.isArray(persistedState.lastActionRequestIdByUserId)
    ? persistedState.lastActionRequestIdByUserId
    : {};
  const withActionMap = actionUserId && requestId
    ? {
        ...persistedState,
        lastActionRequestIdByUserId: {
          ...baseLastActionRequestIdByUserId,
          [actionUserId]: requestId
        }
      }
    : persistedState;
  const nowMs = Date.now();
  if (isActionPhase(withActionMap?.phase) && typeof withActionMap?.turnUserId === "string" && withActionMap.turnUserId.trim()) {
    return {
      ...withActionMap,
      turnStartedAt: nowMs,
      turnDeadlineAt: nowMs + TURN_MS
    };
  }
  return { ...withActionMap, turnStartedAt: null, turnDeadlineAt: null };
}

function resolveTrustedHoleCardsByUserId({
  primaryState,
  fallbackState
}) {
  const primary = primaryState?.holeCardsByUserId && typeof primaryState.holeCardsByUserId === "object" && !Array.isArray(primaryState.holeCardsByUserId)
    ? primaryState.holeCardsByUserId
    : {};
  const fallback = fallbackState?.holeCardsByUserId && typeof fallbackState.holeCardsByUserId === "object" && !Array.isArray(fallbackState.holeCardsByUserId)
    ? fallbackState.holeCardsByUserId
    : {};
  const out = {};
  const userIds = new Set([...Object.keys(fallback), ...Object.keys(primary)]);
  for (const userId of userIds) {
    const primaryCards = primary[userId];
    const fallbackCards = fallback[userId];
    if (Array.isArray(primaryCards) && primaryCards.length === 2) {
      out[userId] = primaryCards;
      continue;
    }
    if (Array.isArray(fallbackCards) && fallbackCards.length === 2) {
      out[userId] = fallbackCards;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function hasTrustedRuntimeShape(state) {
  if (!state || typeof state !== "object") return false;
  const isPlainMap = (value) => !!(value && typeof value === "object" && !Array.isArray(value));
  const hasEntries = (value) => isPlainMap(value) && Object.keys(value).length > 0;
  const seats = Array.isArray(state.seats) ? state.seats : [];
  if (seats.length < 2) return false;
  if (!hasEntries(state.holeCardsByUserId)) return false;
  if (!isPlainMap(state.foldedByUserId) || !isPlainMap(state.leftTableByUserId) || !isPlainMap(state.sitOutByUserId)) return false;
  if (!isPlainMap(state.stacks) || !isPlainMap(state.contributionsByUserId)) return false;
  if (state.community != null && !Array.isArray(state.community)) return false;
  return true;
}

function resolveTrustedStateToMaterialize({
  primaryState,
  fallbackState,
  trustedHoleCardsByUserId
}) {
  const isPlainMap = (value) => !!(value && typeof value === "object" && !Array.isArray(value));
  const hasEntries = (value) => isPlainMap(value) && Object.keys(value).length > 0;
  const mergeMapPrimaryFirst = (primaryMap, fallbackMap) => {
    const primary = isPlainMap(primaryMap) ? primaryMap : {};
    const fallback = isPlainMap(fallbackMap) ? fallbackMap : {};
    if (!hasEntries(primary) && !hasEntries(fallback)) return undefined;
    return { ...fallback, ...primary };
  };
  const mergeSeatsPrimaryFirst = (primarySeats, fallbackSeats) => {
    const primary = Array.isArray(primarySeats) ? primarySeats : [];
    const fallback = Array.isArray(fallbackSeats) ? fallbackSeats : [];
    if (primary.length === 0) return fallback.length > 0 ? fallback.slice() : undefined;
    if (fallback.length === 0) return primary.slice();
    const fallbackByUserId = new Map();
    const fallbackBySeatNo = new Map();
    for (const seat of fallback) {
      const userId = typeof seat?.userId === "string" ? seat.userId.trim() : "";
      if (userId) fallbackByUserId.set(userId, seat);
      if (Number.isInteger(Number(seat?.seatNo))) fallbackBySeatNo.set(Number(seat.seatNo), seat);
    }
    return primary.map((seat) => {
      const userId = typeof seat?.userId === "string" ? seat.userId.trim() : "";
      const seatNo = Number.isInteger(Number(seat?.seatNo)) ? Number(seat.seatNo) : null;
      const fallbackSeat = (userId && fallbackByUserId.get(userId)) || (seatNo != null ? fallbackBySeatNo.get(seatNo) : null);
      return fallbackSeat ? { ...fallbackSeat, ...seat } : seat;
    });
  };
  const mergePrimaryWithFallbackSupplement = (primary, fallback, resolvedHoleCards) => {
    const base = primary && typeof primary === "object" ? { ...primary } : {};
    const fb = fallback && typeof fallback === "object" ? fallback : {};
    const primaryCommunity = Array.isArray(base.community) ? base.community : null;
    const fallbackCommunity = Array.isArray(fb.community) ? fb.community : null;
    if ((!primaryCommunity || primaryCommunity.length === 0) && fallbackCommunity && fallbackCommunity.length > 0) {
      base.community = fallbackCommunity.slice();
    }
    if (!Array.isArray(base.seats) || base.seats.length === 0) {
      if (Array.isArray(fb.seats) && fb.seats.length > 0) base.seats = fb.seats.slice();
    } else {
      const mergedSeats = mergeSeatsPrimaryFirst(base.seats, fb.seats);
      if (Array.isArray(mergedSeats)) base.seats = mergedSeats;
    }
    if (!Number.isFinite(Number(base.potTotal)) && Number.isFinite(Number(fb.potTotal))) base.potTotal = Number(fb.potTotal);
    if (!Number.isFinite(Number(base.pot)) && Number.isFinite(Number(fb.pot))) base.pot = Number(fb.pot);
    if (!Array.isArray(base.sidePots) && Array.isArray(fb.sidePots)) base.sidePots = fb.sidePots.slice();
    const mapFields = ["stacks", "contributionsByUserId", "foldedByUserId", "leftTableByUserId", "sitOutByUserId"];
    for (const key of mapFields) {
      const merged = mergeMapPrimaryFirst(base[key], fb[key]);
      if (merged) base[key] = merged;
    }
    if ((typeof base.handId !== "string" || !base.handId.trim()) && typeof fb.handId === "string" && fb.handId.trim()) {
      base.handId = fb.handId.trim();
    }
    if ((!base.showdown || typeof base.showdown !== "object") && fb.showdown && typeof fb.showdown === "object") {
      base.showdown = { ...fb.showdown };
    }
    if (resolvedHoleCards && isPlainMap(resolvedHoleCards) && Object.keys(resolvedHoleCards).length > 0) {
      const merged = mergeMapPrimaryFirst(resolvedHoleCards, base.holeCardsByUserId);
      if (merged) base.holeCardsByUserId = merged;
    } else {
      const merged = mergeMapPrimaryFirst(base.holeCardsByUserId, fb.holeCardsByUserId);
      if (merged) base.holeCardsByUserId = merged;
    }
    return base;
  };
  const readHandId = (state) => (typeof state?.handId === "string" && state.handId.trim() ? state.handId.trim() : "");
  const primary = primaryState && typeof primaryState === "object" ? primaryState : null;
  const fallback = fallbackState && typeof fallbackState === "object" ? fallbackState : null;
  const primaryTrusted = hasTrustedRuntimeShape(primary);
  const fallbackTrusted = hasTrustedRuntimeShape(fallback);
  const primaryComparableHandId = readHandId(primary);
  const fallbackComparableHandId = fallbackTrusted ? readHandId(fallback) : "";
  const sameHand = !!primaryComparableHandId && !!fallbackComparableHandId && primaryComparableHandId === fallbackComparableHandId;
  const trustedMismatch = !!primaryComparableHandId && !!fallbackComparableHandId && primaryComparableHandId !== fallbackComparableHandId;
  let selectedState = null;
  let trustedStateSource = "runtime_public_like_rejected";
  if (trustedMismatch) {
    trustedStateSource = "fallback_private_hand_mismatch_rejected";
  } else if (primaryTrusted) {
    selectedState = mergePrimaryWithFallbackSupplement(primary, fallbackTrusted ? fallback : null, trustedHoleCardsByUserId);
    trustedStateSource = "runtime_private";
  } else if (fallbackTrusted) {
    selectedState = mergePrimaryWithFallbackSupplement(primary, fallback, trustedHoleCardsByUserId);
    trustedStateSource = sameHand ? "fallback_private_same_hand" : "fallback_private_primary_identity_unknown";
  } else if (fallback && !fallbackTrusted) {
    trustedStateSource = "fallback_private_untrusted_rejected";
  }
  return {
    state: selectedState,
    trustedStateSource,
    sameHand,
    trustedMismatch,
    primaryTrusted,
    fallbackTrusted
  };
}

function validateTrustedShowdownInputs({
  stateToMaterialize,
  seatOrder,
  holeCardsByUserId,
  trustedStateSource = "trusted_private"
}) {
  const community = Array.isArray(stateToMaterialize?.community) ? stateToMaterialize.community : [];
  const seats = Array.isArray(seatOrder) ? seatOrder : [];
  const trustedHoleCards = holeCardsByUserId && typeof holeCardsByUserId === "object" && !Array.isArray(holeCardsByUserId)
    ? holeCardsByUserId
    : {};
  const validSeatUserIds = [];
  const invalidSeatUserIds = [];
  for (const userId of seats) {
    if (typeof userId !== "string" || !userId.trim()) {
      invalidSeatUserIds.push(userId ?? null);
      continue;
    }
    validSeatUserIds.push(userId.trim());
  }
  const eligibleUserIds = validSeatUserIds.filter((userId) =>
    !stateToMaterialize?.foldedByUserId?.[userId]
    && !stateToMaterialize?.leftTableByUserId?.[userId]
    && !stateToMaterialize?.sitOutByUserId?.[userId]
  );
  const missingHoleCardsUserIds = [];
  const invalidHoleCardsUserIds = [];
  const showdownComparedUserIds = [];
  for (const userId of eligibleUserIds) {
    const cards = trustedHoleCards?.[userId];
    if (!Array.isArray(cards)) {
      missingHoleCardsUserIds.push(userId);
      continue;
    }
    if (cards.length !== 2) {
      invalidHoleCardsUserIds.push(userId);
      continue;
    }
    showdownComparedUserIds.push(userId);
  }
  const eligibleMissingFromShowdownUserIds = eligibleUserIds.filter((userId) => !showdownComparedUserIds.includes(userId));
  const hasInvalidInput = (
    community.length !== 5
    || eligibleUserIds.length < 2
    || invalidSeatUserIds.length > 0
    || eligibleMissingFromShowdownUserIds.length > 0
    || invalidHoleCardsUserIds.length > 0
  );
  return {
    trustedStateSource,
    communityLen: community.length,
    eligibleUserIds,
    showdownComparedUserIds,
    eligibleCount: eligibleUserIds.length,
    showdownComparedCount: showdownComparedUserIds.length,
    invalidSeatUserIds,
    missingHoleCardsUserIds,
    invalidHoleCardsUserIds,
    eligibleMissingFromShowdownUserIds,
    hasInvalidInput
  };
}

function materializeShowdownState(stateToMaterialize, seatOrder, holeCardsByUserId, nowIso, klog, options = {}) {
  if (options?.requiresShowdownComparison === true) {
    const showdownInputs = validateTrustedShowdownInputs({
      stateToMaterialize,
      seatOrder,
      holeCardsByUserId,
      trustedStateSource: typeof options?.trustedStateSource === "string" ? options.trustedStateSource : "trusted_private"
    });
    if (typeof klog === "function") {
      klog("ws_bot_autoplay_showdown_preflight", {
        handId: typeof stateToMaterialize?.handId === "string" ? stateToMaterialize.handId : null,
        phase: typeof stateToMaterialize?.phase === "string" ? stateToMaterialize.phase : null,
        communityLen: showdownInputs.communityLen,
        eligibleUserIds: showdownInputs.eligibleUserIds,
        showdownComparedUserIds: showdownInputs.showdownComparedUserIds,
        missingHoleCardsUserIds: showdownInputs.missingHoleCardsUserIds,
        invalidHoleCardsUserIds: showdownInputs.invalidHoleCardsUserIds,
        invalidSeatUserIds: showdownInputs.invalidSeatUserIds,
        eligibleMissingFromShowdownUserIds: showdownInputs.eligibleMissingFromShowdownUserIds,
        trustedStateSource: showdownInputs.trustedStateSource
      });
    }
    if (showdownInputs.hasInvalidInput) {
      const error = new Error("showdown_missing_private_inputs");
      error.code = "showdown_missing_private_inputs";
      if (typeof klog === "function") {
        klog("ws_bot_autoplay_showdown_input_missing", {
          handId: typeof stateToMaterialize?.handId === "string" ? stateToMaterialize.handId : null,
          phase: typeof stateToMaterialize?.phase === "string" ? stateToMaterialize.phase : null,
          communityLen: showdownInputs.communityLen,
          eligibleCount: showdownInputs.eligibleCount,
          showdownComparedCount: showdownInputs.showdownComparedCount,
          eligibleUserIds: showdownInputs.eligibleUserIds,
          showdownComparedUserIds: showdownInputs.showdownComparedUserIds,
          missingHoleCardsUserIds: showdownInputs.missingHoleCardsUserIds,
          invalidHoleCardsUserIds: showdownInputs.invalidHoleCardsUserIds,
          invalidSeatUserIds: showdownInputs.invalidSeatUserIds,
          eligibleMissingFromShowdownUserIds: showdownInputs.eligibleMissingFromShowdownUserIds,
          trustedStateSource: showdownInputs.trustedStateSource
        });
      }
      throw error;
    }
  }
  const runtimeFlavor = options?.runtimeFlavor === "engine" ? "engine" : "legacy";
  const useSharedSettlement = runtimeFlavor === "engine";
  const nextState = (useSharedSettlement ? materializeSharedShowdownAndPayout : materializeLegacyShowdownAndPayout)({
    state: useSharedSettlement
      ? {
          ...stateToMaterialize,
          pot: Number.isFinite(Number(stateToMaterialize?.potTotal))
            ? Number(stateToMaterialize.potTotal)
            : Number.isFinite(Number(stateToMaterialize?.pot))
              ? Number(stateToMaterialize.pot)
              : 0,
          community: normalizeCardsForSharedSettlement(stateToMaterialize?.community)
        }
      : stateToMaterialize,
    seatUserIdsInOrder: seatOrder,
    holeCardsByUserId: useSharedSettlement ? normalizeHoleCardsMapForSharedSettlement(holeCardsByUserId) : holeCardsByUserId,
    computeShowdown: useSharedSettlement ? computeSharedShowdown : computeLegacyShowdown,
    awardPotsAtShowdown: useSharedSettlement ? awardSharedPotsAtShowdown : awardLegacyPotsAtShowdown,
    klog,
    nowIso
  }).nextState;
  if (!useSharedSettlement) {
    return nextState;
  }
  return {
    ...stateToMaterialize,
    ...nextState,
    phase: "SETTLED",
    turnUserId: null,
    turnStartedAt: null,
    turnDeadlineAt: null,
    community: Array.isArray(stateToMaterialize?.community) ? stateToMaterialize.community.slice() : [],
    holeCardsByUserId: isPlainObject(stateToMaterialize?.holeCardsByUserId) ? { ...stateToMaterialize.holeCardsByUserId } : {},
    deck: Array.isArray(stateToMaterialize?.deck) ? stateToMaterialize.deck.slice() : [],
    potTotal: Number(nextState?.pot ?? stateToMaterialize?.potTotal ?? stateToMaterialize?.pot ?? 0),
    sidePots: []
  };
}

function buildDiagnosticSnapshot(state) {
  const seats = Array.isArray(state?.seats) ? state.seats : [];
  const seatUserIds = seats
    .filter((seat) => typeof seat?.userId === "string" && seat.userId.trim())
    .sort((a, b) => Number(a?.seatNo ?? 0) - Number(b?.seatNo ?? 0))
    .map((seat) => seat.userId.trim());
  const stacks = state?.stacks && typeof state.stacks === "object" && !Array.isArray(state.stacks) ? state.stacks : {};
  const communityCards = Array.isArray(state?.community) ? state.community : [];
  return {
    phase: typeof state?.phase === "string" ? state.phase : null,
    handId: typeof state?.handId === "string" ? state.handId : null,
    turnUserId: typeof state?.turnUserId === "string" ? state.turnUserId : null,
    pot: Number.isFinite(Number(state?.potTotal))
      ? Number(state.potTotal)
      : Number.isFinite(Number(state?.pot))
        ? Number(state.pot)
        : 0,
    communityDealt: Number.isFinite(Number(state?.communityDealt)) ? Number(state.communityDealt) : communityCards.length,
    communityLen: communityCards.length,
    seatsCount: seats.length,
    seatUserIds,
    stacksKeys: Object.keys(stacks),
    stackCount: Object.keys(stacks).length
  };
}

function summarizeLegalActions(legalActions) {
  const actions = Array.isArray(legalActions) ? legalActions : [];
  const types = [];
  for (const item of actions) {
    if (typeof item === "string") {
      types.push(item);
    } else if (item && typeof item === "object" && typeof item.type === "string") {
      types.push(item.type);
    }
  }
  return {
    count: actions.length,
    types: [...new Set(types)].slice(0, 8)
  };
}

export function createAcceptedBotStepExecutor({
  tableManager,
  persistMutatedState,
  restoreTableFromPersisted,
  broadcastResyncRequired,
  env = process.env,
  klog = () => {}
} = {}) {
  return async function runAcceptedBotStep({ tableId, trigger, requestId, frameTs }) {
    const baseLog = {
      tableId,
      trigger: trigger || null,
      requestId: requestId || null
    };
    let lastKnown = {
      stage: "init",
      state: null,
      actionType: null,
      actionAmount: null,
      legalActionSummary: null
    };
    const privateState = tableManager.persistedPokerState(tableId);
    if (!privateState || typeof privateState !== "object") {
      return { ok: true, changed: false, actionCount: 0, reason: "missing_state" };
    }

    const runtimeFlavor = isEngineStateShape(privateState) ? "engine" : "legacy";
    const withoutPrivateState = runtimeFlavor === "engine" ? withoutSharedPrivateState : withoutLegacyPrivateState;
    const advanceIfNeeded = runtimeFlavor === "engine" ? noopAdvanceIfNeeded : advanceLegacyIfNeeded;
    const computeLegalActions = runtimeFlavor === "engine"
      ? ({ statePublic, userId }) => computeSharedLegalActions({ statePublic, userId })
      : ({ statePublic, userId }) => computeLegacyLegalActions({ statePublic, userId });
    const applyRuntimeAction = runtimeFlavor === "engine"
      ? (loopPrivateState, botAction) => {
          const applied = applySharedAction({
            pokerState: loopPrivateState,
            userId: botAction?.userId,
            action: botAction?.type,
            amount: botAction?.amount,
            nowIso: frameTs || new Date().toISOString()
          });
          if (!applied?.ok || !applied?.state) {
            throw new Error(applied?.reason || "invalid_state");
          }
          return { state: applied.state, events: [] };
        }
      : (loopPrivateState, botAction) => applyLegacyRuntimeAction(loopPrivateState, botAction);
    const state = withoutPrivateState(privateState);
    lastKnown.state = state;
    if (!isActionPhase(state?.phase) || !state?.turnUserId) {
      return { ok: true, changed: false, actionCount: 0, reason: "not_action_phase" };
    }

    let runBotAutoplayLoop;
    const sharedAutoplayModuleUrl = resolveSharedAutoplayModuleUrl(env);
    try {
      ({ runBotAutoplayLoop } = await resolveSharedAutoplayModule(sharedAutoplayModuleUrl));
    } catch (error) {
      klog("ws_bot_autoplay_unavailable", {
        tableId,
        trigger: trigger || null,
        requestId: requestId || null,
        moduleUrl: sharedAutoplayModuleUrl,
        message: error?.message || "unknown"
      });
      return { ok: true, changed: false, actionCount: 0, reason: "autoplay_unavailable", noop: true };
    }

    const turnSnapshot = tableManager.tableSnapshot(tableId, state.turnUserId);
    const seatBotMap = buildSeatBotMap(turnSnapshot?.seats);
    const seatUserIdsInOrder = buildSeatUserIdsInOrder(privateState);
    const cfg = getBotAutoplayConfig(env);
    klog("ws_bot_autoplay_loop_start", {
      ...baseLog,
      runtimeFlavor,
      ...buildDiagnosticSnapshot(state),
      stateVersion: Number(tableManager.persistedStateVersion(tableId) || 0),
      maxActions: 1
    });
    try {
      const botLoop = await runBotAutoplayLoop({
        tableId,
        requestId: `${trigger || "ws"}:${requestId || "no-request-id"}`,
        initialState: state,
        initialPrivateState: privateState,
        initialVersion: Number(tableManager.persistedStateVersion(tableId) || 0),
        seatBotMap,
        seatUserIdsInOrder,
        maxActions: 1,
        botsOnlyHandCompletionHardCap: cfg.botsOnlyHandCompletionHardCap,
        policyVersion: cfg.policyVersion,
        klog,
        isActionPhase,
        advanceIfNeeded,
        buildPersistedFromPrivateState: (loopPrivateState, actorUserId, actionRequestId) =>
          buildPersistedFromPrivateState(loopPrivateState, actorUserId, actionRequestId, withoutPrivateState),
        materializeShowdownState: (nextState, seatOrder, loopPrivateHoleCardsByUserId, options = {}) => {
          const requiresShowdownComparison = options?.requiresShowdownComparison === true;
          const trustedHoleCardsByUserId = requiresShowdownComparison
            ? resolveTrustedHoleCardsByUserId({
                primaryState: { holeCardsByUserId: loopPrivateHoleCardsByUserId },
                fallbackState: tableManager.persistedPokerState(tableId)
              })
            : null;
          let stateToMaterialize = nextState;
          let trustedStateSource = "runtime_state_no_showdown_compare";
          if (requiresShowdownComparison) {
            const trustedStateResolution = resolveTrustedStateToMaterialize({
              primaryState: nextState,
              fallbackState: tableManager.persistedPokerState(tableId),
              trustedHoleCardsByUserId
            });
            stateToMaterialize = trustedStateResolution.state;
            trustedStateSource = trustedStateResolution.trustedStateSource;
          }
          return materializeShowdownState(
            stateToMaterialize,
            seatOrder,
            trustedHoleCardsByUserId,
            frameTs || new Date().toISOString(),
            klog,
            {
              ...options,
              runtimeFlavor,
              trustedStateSource
            }
          );
        },
        computeLegalActions: ({ statePublic, userId }) => {
          const legal = computeLegalActions({ statePublic, userId });
          const legalSummary = summarizeLegalActions(legal?.actions);
          lastKnown = { ...lastKnown, stage: "turn_snapshot", state: statePublic, legalActionSummary: legalSummary };
          klog("ws_bot_autoplay_turn_snapshot", {
            ...baseLog,
            botTurnUserId: userId || null,
            legalActionSummary: legalSummary,
            ...buildDiagnosticSnapshot(statePublic),
            stateVersion: Number(tableManager.persistedStateVersion(tableId) || 0)
          });
          return legal;
        },
        withoutPrivateState,
        chooseBotActionTrivial: (legalActions) => {
          const action = chooseBotActionTrivial(legalActions);
          lastKnown = { ...lastKnown, stage: "action_chosen", actionType: action?.type || null, actionAmount: action?.amount ?? null };
          klog("ws_bot_autoplay_action_chosen", {
            ...baseLog,
            botTurnUserId: typeof lastKnown?.state?.turnUserId === "string" ? lastKnown.state.turnUserId : null,
            actionType: action?.type || null,
            amount: action?.amount ?? null
          });
          return action;
        },
        isBotTurn,
        applyAction: (loopPrivateState, botAction) => {
          const safeState = withoutPrivateState(loopPrivateState);
          lastKnown = { ...lastKnown, stage: "apply_start", state: safeState, actionType: botAction?.type || null, actionAmount: botAction?.amount ?? null };
          klog("ws_bot_autoplay_apply_start", {
            ...baseLog,
            botTurnUserId: typeof safeState?.turnUserId === "string" ? safeState.turnUserId : null,
            actionType: botAction?.type || null,
            amount: botAction?.amount ?? null,
            ...buildDiagnosticSnapshot(safeState),
            legalActionSummary: lastKnown.legalActionSummary,
            stateVersion: Number(tableManager.persistedStateVersion(tableId) || 0)
          });
          const applied = applyRuntimeAction(loopPrivateState, botAction);
          const nextState = withoutPrivateState(applied?.state);
          lastKnown = { ...lastKnown, stage: "apply_result", state: nextState };
          klog("ws_bot_autoplay_apply_result", {
            ...baseLog,
            botTurnUserId: typeof safeState?.turnUserId === "string" ? safeState.turnUserId : null,
            actionType: botAction?.type || null,
            amount: botAction?.amount ?? null,
            ...buildDiagnosticSnapshot(nextState),
            legalActionSummary: lastKnown.legalActionSummary,
            stateVersion: Number(tableManager.persistedStateVersion(tableId) || 0)
          });
          return applied;
        },
        persistStep: async ({ botTurnUserId, botAction, botRequestId, fromState }) => {
          klog("ws_bot_autoplay_persist_start", {
            ...baseLog,
            botTurnUserId: botTurnUserId || null,
            actionType: botAction?.type || null,
            amount: botAction?.amount ?? null,
            ...buildDiagnosticSnapshot(fromState),
            legalActionSummary: lastKnown.legalActionSummary,
            stateVersion: Number(tableManager.persistedStateVersion(tableId) || 0)
          });
          const applied = tableManager.applyAction({
            tableId,
            handId: fromState?.handId,
            userId: botTurnUserId,
            requestId: botRequestId,
            action: botAction?.type,
            amount: botAction?.amount,
            nowIso: frameTs || new Date().toISOString()
          });

          if (!applied?.accepted || applied?.replayed || !applied?.changed) {
            klog("ws_bot_autoplay_persist_result", {
              ...baseLog,
              botTurnUserId: botTurnUserId || null,
              actionType: botAction?.type || null,
              amount: botAction?.amount ?? null,
              ok: false,
              reason: applied?.reason || "bot_action_rejected"
            });
            return { ok: false, reason: applied?.reason || "bot_action_rejected" };
          }

          const persisted = await persistMutatedState({
            tableId,
            expectedVersion: Number(applied.stateVersion) - 1,
            mutationKind: "act"
          });

          if (!persisted?.ok) {
            await restoreTableFromPersisted(tableId);
            broadcastResyncRequired(tableId, "persistence_conflict");
            klog("ws_bot_autoplay_persist_result", {
              ...baseLog,
              botTurnUserId: botTurnUserId || null,
              actionType: botAction?.type || null,
              amount: botAction?.amount ?? null,
              ok: false,
              reason: persisted?.reason || "persist_failed"
            });
            return { ok: false, reason: persisted?.reason || "persist_failed" };
          }

          const latestPrivateState = tableManager.persistedPokerState(tableId);
          const latestState = withoutPrivateState(latestPrivateState);
          lastKnown = { ...lastKnown, stage: "state_after_step", state: latestState };
          klog("ws_bot_autoplay_persist_result", {
            ...baseLog,
            botTurnUserId: botTurnUserId || null,
            actionType: botAction?.type || null,
            amount: botAction?.amount ?? null,
            ok: true,
            stateVersion: Number(applied.stateVersion)
          });
          klog("ws_bot_autoplay_state_after_step", {
            ...baseLog,
            botTurnUserId: botTurnUserId || null,
            actionType: botAction?.type || null,
            amount: botAction?.amount ?? null,
            ...buildDiagnosticSnapshot(latestState),
            legalActionSummary: lastKnown.legalActionSummary,
            stateVersion: Number(applied.stateVersion)
          });
          return {
            ok: true,
            loopVersion: Number(applied.stateVersion),
            responseFinalState: latestState,
            loopPrivateState: latestPrivateState
          };
        }
      });

      if (botLoop?.botActionCount > 0 || botLoop?.botStopReason) {
        klog("ws_bot_autoplay_loop_stop", {
          ...baseLog,
          botActionCount: botLoop?.botActionCount || 0,
          reason: botLoop?.botStopReason || "not_attempted",
          ...buildDiagnosticSnapshot(botLoop?.responseFinalState || lastKnown.state),
          stateVersion: Number(tableManager.persistedStateVersion(tableId) || 0)
        });
      }

      const finalPrivateState = tableManager.persistedPokerState(tableId);
      const finalPublicState = finalPrivateState ? withoutPrivateState(finalPrivateState) : null;
      const finalTurnUserId = typeof finalPublicState?.turnUserId === "string" ? finalPublicState.turnUserId : null;
      const finalTurnSnapshot = finalTurnUserId
        ? tableManager.tableSnapshot(tableId, finalTurnUserId)
        : tableManager.tableSnapshot(tableId, state.turnUserId || "");
      const finalSeatBotMap = buildSeatBotMap(finalTurnSnapshot?.seats);
      const pendingBotTurn = !!finalPublicState
        && isActionPhase(finalPublicState.phase)
        && isBotTurnAuthoritatively(tableManager, tableId, finalTurnUserId, finalSeatBotMap);

      return {
        ok: true,
        changed: (botLoop?.botActionCount || 0) > 0,
        actionCount: botLoop?.botActionCount || 0,
        reason: botLoop?.botStopReason || "not_attempted",
        pendingBotTurn,
        phase: typeof finalPublicState?.phase === "string" ? finalPublicState.phase : null,
        turnUserId: finalTurnUserId,
        shouldContinue: (botLoop?.botActionCount || 0) > 0 && pendingBotTurn === true
      };
    } catch (error) {
      const lastState = lastKnown.state;
      const diagnostic = buildDiagnosticSnapshot(lastState);
      const failureReason = error?.code || error?.name || "autoplay_failed";
      let restoreOk = false;
      let restoreReason = null;
      try {
        await restoreTableFromPersisted(tableId);
        restoreOk = true;
      } catch (restoreError) {
        restoreReason = restoreError?.message || "restore_failed";
      }
      try {
        broadcastResyncRequired(tableId, restoreOk ? "autoplay_failed_resync" : "autoplay_restore_failed");
      } catch (_broadcastError) {}
      klog("ws_bot_autoplay_failed", {
        ...baseLog,
        stage: lastKnown.stage,
        reason: failureReason,
        errorMessage: error?.message || "unknown",
        errorStackShort: error?.stack ? String(error.stack).slice(0, 500) : null,
        lastKnownPhase: diagnostic.phase,
        lastKnownTurnUserId: diagnostic.turnUserId,
        lastKnownStateVersion: Number(tableManager.persistedStateVersion(tableId) || 0) || null,
        lastKnownStacksKeys: diagnostic.stacksKeys,
        lastKnownSeatUserIds: diagnostic.seatUserIds,
        restoreOk,
        restoreReason
      });
      return {
        ok: false,
        changed: false,
        actionCount: 0,
        reason: failureReason,
        restoreOk
      };
    }
  };
}

export const createAcceptedBotAutoplayExecutor = createAcceptedBotStepExecutor;
