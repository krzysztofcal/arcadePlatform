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

function materializeShowdownState(stateToMaterialize, seatOrder, nowIso, klog) {
  return materializeShowdownAndPayout({
    state: stateToMaterialize,
    seatUserIdsInOrder: seatOrder,
    holeCardsByUserId: stateToMaterialize?.holeCardsByUserId,
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
        materializeShowdownState: (nextState, seatOrder) => materializeShowdownState(nextState, seatOrder, frameTs || new Date().toISOString(), klog),
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
