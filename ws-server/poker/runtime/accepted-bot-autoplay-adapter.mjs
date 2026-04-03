import { advanceIfNeeded, TURN_MS } from "../snapshot-runtime/poker-reducer.mjs";
import { applyAction as applyRuntimeAction } from "../snapshot-runtime/poker-reducer.mjs";
import { materializeShowdownAndPayout } from "../snapshot-runtime/poker-materialize-showdown.mjs";
import { computeShowdown } from "../snapshot-runtime/poker-showdown.mjs";
import { awardPotsAtShowdown } from "../snapshot-runtime/poker-payout.mjs";
import { withoutPrivateState } from "../snapshot-runtime/poker-state-utils.mjs";
import { computeLegalActions } from "../snapshot-runtime/poker-legal-actions.mjs";

const DEFAULT_SHARED_AUTOPLAY_MODULE_URL = new URL("../../../shared/poker-domain/poker-autoplay.mjs", import.meta.url).href;
const sharedAutoplayModulePromiseByUrl = new Map();

const isActionPhase = (phase) => phase === "PREFLOP" || phase === "FLOP" || phase === "TURN" || phase === "RIVER";

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
  const raw = Number(env?.POKER_BOTS_MAX_ACTIONS_PER_REQUEST);
  const maxActionsPerRequest = Number.isInteger(raw) && raw > 0 ? raw : 5;
  const hardCapRaw = Number(env?.POKER_BOTS_BOTS_ONLY_HAND_HARD_CAP);
  const botsOnlyHandCompletionHardCap = Number.isInteger(hardCapRaw) && hardCapRaw > 0 ? hardCapRaw : 80;
  return { maxActionsPerRequest, botsOnlyHandCompletionHardCap, policyVersion: "WS_SHARED_AUTOPLAY" };
}

function buildPersistedFromPrivateState(privateStateInput, actorUserId, actionRequestId) {
  const persistedState = withoutPrivateState(privateStateInput);
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
  const community = Array.isArray(state.community) ? state.community : [];
  if (community.length !== 5) return false;
  const seats = Array.isArray(state.seats) ? state.seats : [];
  if (seats.length < 2) return false;
  if (!hasEntries(state.stacks)) return false;
  if (!hasEntries(state.contributionsByUserId)) return false;
  if (!hasEntries(state.holeCardsByUserId)) return false;
  if (!isPlainMap(state.foldedByUserId) || !isPlainMap(state.leftTableByUserId) || !isPlainMap(state.sitOutByUserId)) return false;
  return true;
}

function resolveTrustedStateToMaterialize({
  primaryState,
  fallbackState,
  trustedHoleCardsByUserId
}) {
  const isPlainMap = (value) => !!(value && typeof value === "object" && !Array.isArray(value));
  const mapSize = (value) => (isPlainMap(value) ? Object.keys(value).length : 0);
  const mergeMap = (primaryMap, fallbackMap) => {
    const safePrimary = isPlainMap(primaryMap) ? primaryMap : {};
    const safeFallback = isPlainMap(fallbackMap) ? fallbackMap : {};
    return { ...safeFallback, ...safePrimary };
  };
  const toArrayOrNull = (value) => (Array.isArray(value) ? value : null);
  const mergeTrustedSupplementState = (primary, fallback, resolvedHoleCards) => {
    const base = primary && typeof primary === "object" ? { ...primary } : {};
    const fb = fallback && typeof fallback === "object" ? fallback : {};
    const baseCommunity = toArrayOrNull(base.community);
    const fallbackCommunity = toArrayOrNull(fb.community);
    if ((!baseCommunity || baseCommunity.length < 5) && fallbackCommunity && fallbackCommunity.length === 5) {
      base.community = fallbackCommunity.slice();
    }
    if (!Number.isFinite(Number(base.pot)) && Number.isFinite(Number(fb.pot))) {
      base.pot = Number(fb.pot);
    }
    if ((!Array.isArray(base.sidePots) || (Array.isArray(base.sidePots) && base.sidePots.some((pot) => !pot || typeof pot !== "object"))) && Array.isArray(fb.sidePots)) {
      base.sidePots = fb.sidePots.slice();
    }
    if ((!Array.isArray(base.seats) || base.seats.length < 2) && Array.isArray(fb.seats) && fb.seats.length >= 2) {
      base.seats = fb.seats.slice();
    }
    if (Array.isArray(base.seats) && Array.isArray(fb.seats) && base.seats.length >= 2 && fb.seats.length >= 2) {
      const byUserId = {};
      for (const seat of fb.seats) {
        const userId = typeof seat?.userId === "string" ? seat.userId.trim() : "";
        if (!userId) continue;
        byUserId[userId] = seat;
      }
      base.seats = base.seats.map((seat) => {
        const userId = typeof seat?.userId === "string" ? seat.userId.trim() : "";
        const fallbackSeat = userId ? byUserId[userId] : null;
        if (!fallbackSeat) return seat;
        return {
          ...fallbackSeat,
          ...seat
        };
      });
    }
    if (mapSize(base.stacks) > 0 || mapSize(fb.stacks) > 0) base.stacks = mergeMap(base.stacks, fb.stacks);
    if (mapSize(base.contributionsByUserId) > 0 || mapSize(fb.contributionsByUserId) > 0) base.contributionsByUserId = mergeMap(base.contributionsByUserId, fb.contributionsByUserId);
    if (mapSize(base.foldedByUserId) > 0 || mapSize(fb.foldedByUserId) > 0) base.foldedByUserId = mergeMap(base.foldedByUserId, fb.foldedByUserId);
    if (mapSize(base.leftTableByUserId) > 0 || mapSize(fb.leftTableByUserId) > 0) base.leftTableByUserId = mergeMap(base.leftTableByUserId, fb.leftTableByUserId);
    if (mapSize(base.sitOutByUserId) > 0 || mapSize(fb.sitOutByUserId) > 0) base.sitOutByUserId = mergeMap(base.sitOutByUserId, fb.sitOutByUserId);
    if ((typeof base.handId !== "string" || !base.handId.trim()) && typeof fb.handId === "string" && fb.handId.trim()) {
      base.handId = fb.handId.trim();
    }
    if ((!base.showdown || typeof base.showdown !== "object") && fb.showdown && typeof fb.showdown === "object") {
      base.showdown = { ...fb.showdown };
    }
    if (resolvedHoleCards && typeof resolvedHoleCards === "object") {
      base.holeCardsByUserId = resolvedHoleCards;
    } else if (mapSize(base.holeCardsByUserId) === 0 && mapSize(fb.holeCardsByUserId) > 0) {
      base.holeCardsByUserId = { ...fb.holeCardsByUserId };
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
  if (primaryTrusted) {
    selectedState = mergeTrustedSupplementState(primary, null, trustedHoleCardsByUserId);
    trustedStateSource = "runtime_private";
  } else if (fallbackTrusted && trustedMismatch) {
    trustedStateSource = "fallback_private_hand_mismatch_rejected";
  } else if (fallbackTrusted && sameHand) {
    selectedState = mergeTrustedSupplementState(primary, fallback, trustedHoleCardsByUserId);
    trustedStateSource = "fallback_private_same_hand";
  } else if (fallbackTrusted) {
    trustedStateSource = "fallback_private_primary_identity_unknown_rejected";
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
  return materializeShowdownAndPayout({
    state: stateToMaterialize,
    seatUserIdsInOrder: seatOrder,
    holeCardsByUserId,
    computeShowdown,
    awardPotsAtShowdown,
    klog,
    nowIso
  }).nextState;
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
    pot: Number.isFinite(Number(state?.pot)) ? Number(state.pot) : 0,
    communityDealt: state?.communityDealt === true || state?.communityDealt === false ? state.communityDealt : (communityCards.length > 0),
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

export function createAcceptedBotAutoplayExecutor({
  tableManager,
  persistMutatedState,
  restoreTableFromPersisted,
  broadcastResyncRequired,
  env = process.env,
  klog = () => {}
} = {}) {
  return async function runAcceptedBotAutoplay({ tableId, trigger, requestId, frameTs }) {
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
      ...buildDiagnosticSnapshot(state),
      stateVersion: Number(tableManager.persistedStateVersion(tableId) || 0),
      maxActions: cfg.maxActionsPerRequest
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
        maxActions: cfg.maxActionsPerRequest,
        botsOnlyHandCompletionHardCap: cfg.botsOnlyHandCompletionHardCap,
        policyVersion: cfg.policyVersion,
        klog,
        isActionPhase,
        advanceIfNeeded,
        buildPersistedFromPrivateState,
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

      return {
        ok: true,
        changed: (botLoop?.botActionCount || 0) > 0,
        actionCount: botLoop?.botActionCount || 0,
        reason: botLoop?.botStopReason || "not_attempted"
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
