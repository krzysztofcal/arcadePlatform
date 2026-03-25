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

export function createAcceptedBotAutoplayExecutor({
  tableManager,
  persistMutatedState,
  restoreTableFromPersisted,
  broadcastResyncRequired,
  env = process.env,
  klog = () => {}
} = {}) {
  return async function runAcceptedBotAutoplay({ tableId, trigger, requestId, frameTs }) {
    const privateState = tableManager.persistedPokerState(tableId);
    if (!privateState || typeof privateState !== "object") {
      return { ok: true, changed: false, actionCount: 0, reason: "missing_state" };
    }

    const state = withoutPrivateState(privateState);
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
      computeLegalActions,
      withoutPrivateState,
      chooseBotActionTrivial,
      isBotTurn,
      applyAction: applyRuntimeAction,
      persistStep: async ({ botTurnUserId, botAction, botRequestId, fromState }) => {
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
          return { ok: false, reason: persisted?.reason || "persist_failed" };
        }

        const latestPrivateState = tableManager.persistedPokerState(tableId);
        return {
          ok: true,
          loopVersion: Number(applied.stateVersion),
          responseFinalState: withoutPrivateState(latestPrivateState),
          loopPrivateState: latestPrivateState
        };
      }
    });

    if (botLoop?.botActionCount > 0 || botLoop?.botStopReason) {
      klog("ws_bot_autoplay_stop", {
        tableId,
        requestId: requestId || null,
        trigger: trigger || null,
        botActionCount: botLoop?.botActionCount || 0,
        reason: botLoop?.botStopReason || "not_attempted"
      });
    }

    return {
      ok: true,
      changed: (botLoop?.botActionCount || 0) > 0,
      actionCount: botLoop?.botActionCount || 0,
      reason: botLoop?.botStopReason || "not_attempted"
    };
  };
}
