import http from "http";
import fs from "node:fs";
import WebSocket, { WebSocketServer } from "ws";
import { MAX_FRAME_BYTES } from "./poker/protocol/constants.mjs";
import { makeErrorFrame, parseFrame, validateEnvelope } from "./poker/protocol/envelope.mjs";
import { handleHello } from "./poker/handlers/hello.mjs";
import { handlePing } from "./poker/handlers/ping.mjs";
import { handleAuth } from "./poker/handlers/auth.mjs";
import { handleProtectedEcho } from "./poker/handlers/protected-echo.mjs";
import { verifyToken } from "./poker/auth/verify-token.mjs";
import { createConnState, HEARTBEAT_MS } from "./poker/runtime/conn-state.mjs";
import {
  acknowledgeTransportEvidence,
  beginTransportTermination,
  decideTransportWatchdogAction,
  markTransportPingSent
} from "./poker/runtime/transport-watchdog.mjs";
import { ackSessionSeq, touchSession } from "./poker/runtime/session.mjs";
import { recordProtocolViolation, shouldClose } from "./poker/runtime/conn-guards.mjs";
import { createTableManager } from "./poker/table/table-manager.mjs";
import { adaptPersistedBootstrap } from "./poker/bootstrap/persisted-bootstrap-adapter.mjs";
import { createSessionStore } from "./poker/runtime/session-store.mjs";
import { createDisconnectCleanupRuntime } from "./poker/runtime/disconnect-cleanup.mjs";
import { createBotReactionOverrideStore } from "./poker/runtime/bot-reaction-override.mjs";
import { createReactionTimers, shouldObservePersistedReactionMutation } from "./poker/runtime/reaction-timers.mjs";
import {
  createNonRetryableTerminalJanitorSuppression,
  evaluateTableHealth,
  matchesNonRetryableTerminalJanitorSuppression,
  runTableJanitor
} from "./poker/runtime/table-janitor.mjs";
import { buildStateSnapshotPayload, normalizePrivateBranch } from "./poker/read-model/state-snapshot.mjs";
import { buildStatePatch } from "./poker/read-model/state-patch.mjs";
import { createStreamLog } from "./poker/runtime/stream-log.mjs";
import { createPersistedStateWriter } from "./poker/persistence/persisted-state-writer.mjs";
import { createTableSnapshotLoader } from "./poker/table/table-snapshot.mjs";
import { handleJoinCommand } from "./poker/handlers/join.mjs";
import { handleActCommand } from "./poker/handlers/act.mjs";
import { handleStartHandCommand } from "./poker/handlers/start-hand.mjs";
import {
  classifyAmbientReaction,
  classifyDirectedBotReaction,
  classifyRaiseReaction,
  classifySettlementReaction,
  canBotStartReaction,
  deriveRiverChangedWinnerUserIds,
  eligibleActiveHandBotSeats,
  evaluateHumanReactionCommand,
  isCompleteReactionSettlement,
  tryCreateBotReaction,
  tryReserveBotReaction,
  clearTable as clearReactionTable
} from "./poker/handlers/reaction.mjs";
import { handleTurnTimeoutCommand } from "./poker/handlers/turn-timeout.mjs";
import {
  createBotAutoplayCascadeScheduler,
  createBotAutoplayObservability,
  handleBotStepCommand,
  matchesBotTimeoutSafetySuppression,
  shouldClearBotTimeoutSafetySuppression,
  shouldSuppressBotTimeoutSafetyRetry
} from "./poker/handlers/bot-autoplay.mjs";
import { handleLeaveCommand } from "./poker/handlers/leave.mjs";
import { handleRebuyCommand } from "./poker/handlers/rebuy.mjs";
import { createTableCommandQueue } from "./poker/runtime/table-command-queue.mjs";
import { recoverFromPersistConflict } from "./poker/runtime/persist-conflict-recovery.mjs";
import { resolveSettledRevealDueAt } from "./poker/runtime/settled-reveal-timing.mjs";
import { loadBotClaimsRecoveryExecutorIfInactive } from "./poker/persistence/bot-claims-recovery-adapter.mjs";
import { serializePokerLogPayload } from "./poker/observability/poker-log-policy.mjs";
import {
  pokerLogRuntimeControl,
  setPokerLogRuntimeAuditLogger
} from "./poker/observability/poker-log-runtime-control.mjs";
import { getBotConfig, parseStakes } from "./shared/poker-domain/bots.mjs";
import { createContinuousBotTableRepository } from "./poker/persistence/continuous-bot-table-repository.mjs";
import { createContinuousBotTableSupervisor } from "./poker/runtime/continuous-bot-table-supervisor.mjs";
import { handleContinuousBotRotationAtSettled } from "./poker/runtime/continuous-bot-table-rotation.mjs";
import { createActionHistoryCleanup } from "./poker/persistence/action-history-cleanup.mjs";
import { createClosedTableCleanup } from "./poker/persistence/closed-table-cleanup.mjs";
import { createVpsMetricsCollector } from "./observability/vps-metrics.mjs";
import {
  isManagedReplacementSeatProjectionConflict,
  retireManagedTableAfterReplacementConflict as retireManagedTableAfterReplacementConflictFlow
} from "./poker/runtime/continuous-bot-retirement.mjs";

const PORT = Number(process.env.PORT || 3000);
const PROTECTED_MESSAGE_TYPES = new Set([
  "protected_echo",
  "join",
  "leave",
  "table_join",
  "table_leave",
  "rebuy",
  "table_rebuy",
  "lobby_subscribe",
  "table_state_sub",
  "table_snapshot",
  "reaction_send",
  "act",
  "start_hand",
  "resync",
  "resume",
  "ack"
]);
const REQUEST_ID_REQUIRED_TYPES = new Set(["join", "leave", "table_join", "table_leave", "rebuy", "table_rebuy", "lobby_subscribe", "table_state_sub", "table_snapshot", "reaction_send", "act", "start_hand", "resync", "resume"]);
const TABLE_SNAPSHOT_KNOWN_FAILURE_CODES = new Set([
  "invalid_table_id",
  "table_not_found",
  "state_missing",
  "state_invalid",
  "contract_mismatch_empty_legal_actions"
]);
const SESSION_REBOUND_CLOSE_CODE = 4001;
const LIVE_HAND_PHASES = new Set(["POSTING_BLINDS", "PREFLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN"]);
const DEFAULT_EMPTY_JOINABLE_GRACE_MS = 60_000;
const DEFAULT_SEATED_RECONNECT_GRACE_MS = 90_000;
const DEFAULT_ACTIVE_SEAT_FRESH_MS = 120_000;
const FAST_SETTLED_ROLLOVER_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000];
const SLOW_SETTLED_ROLLOVER_RETRY_MS = 60_000;
const HUMAN_HELLO_REPLY_PROBABILITY = 0.6;

function resolvePresenceTtlMs(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 10_000;
  }
  return parsed;
}

function resolveSeatedReconnectGraceMs(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_SEATED_RECONNECT_GRACE_MS;
  }
  return Math.trunc(parsed);
}

function resolveActiveSeatFreshMs(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < HEARTBEAT_MS) {
    return DEFAULT_ACTIVE_SEAT_FRESH_MS;
  }
  return Math.trunc(Math.min(parsed, 15 * 60_000));
}

function isLiveHandPhase(value) {
  if (typeof value !== "string") {
    return false;
  }
  return LIVE_HAND_PHASES.has(value.trim().toUpperCase());
}


function resolveSessionTtlMs(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 60_000;
  }
  return parsed;
}

function resolveMaxSeats(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 10;
  }
  if (parsed > 10) {
    return 10;
  }
  return parsed;
}

function resolveLobbyMaterializeMaxPlayers(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 2 || parsed > 10) {
    return null;
  }
  return parsed;
}

function resolveActionResultCacheMax(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 256;
  }
  return parsed;
}

function resolveObserveOnlyJoin(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    return false;
  }
  const normalized = String(rawValue).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

const DEFAULT_SETTLED_REVEAL_MS = 5_000;
// Disconnect cleanup intentionally keeps the historical shorter grace window;
// it must not inherit the longer client-facing settlement reveal budget.
const DEFAULT_DISCONNECT_SETTLED_REVEAL_MS = 4_000;

function resolveSettledRevealMs(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_SETTLED_REVEAL_MS;
  }
  return Math.trunc(parsed);
}

function resolveEmptyJoinableGraceMs(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_EMPTY_JOINABLE_GRACE_MS;
  }
  return Math.trunc(parsed);
}

function resolveAuthoritativeJoinEnabled(rawValue, { hasSupabaseDbUrl = false, observeOnlyJoinEnabled = false } = {}) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
    return Boolean(hasSupabaseDbUrl && !observeOnlyJoinEnabled);
  }
  const normalized = String(rawValue).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return Boolean(hasSupabaseDbUrl && !observeOnlyJoinEnabled);
}

const hasSupabaseDbUrl = Boolean(process.env.SUPABASE_DB_URL);
const publicProfileStorageBaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_URL_V2 || "";
const persistedBootstrapEnabled = Boolean(hasSupabaseDbUrl || process.env.WS_PERSISTED_BOOTSTRAP_FIXTURES_JSON || process.env.WS_PERSISTED_STATE_FILE);
const persistedStateWriteEnabled = Boolean(process.env.SUPABASE_DB_URL || process.env.WS_PERSISTED_STATE_FILE);
const observeOnlyJoinEnabled = resolveObserveOnlyJoin(process.env.WS_OBSERVE_ONLY_JOIN);
const authoritativeJoinEnabled = resolveAuthoritativeJoinEnabled(process.env.WS_AUTHORITATIVE_JOIN_ENABLED, {
  hasSupabaseDbUrl,
  observeOnlyJoinEnabled
});

function createPersistedBootstrapLoader({ env = process.env } = {}) {
  let repositoryPromise = null;

  async function loadRepository() {
    if (!repositoryPromise) {
      repositoryPromise = import("./poker/bootstrap/persisted-bootstrap-repository.mjs")
        .then((module) => module.createPersistedBootstrapRepository({ env }));
    }
    return repositoryPromise;
  }

  return async function loadPersistedTableBootstrap({ tableId }) {
    const repository = await loadRepository();
    const loaded = await repository.load(tableId);
    const adapted = adaptPersistedBootstrap({
      tableId,
      tableRow: loaded?.tableRow,
      seatRows: loaded?.seatRows,
      stateRow: loaded?.stateRow
    });
    if (adapted?.reason === "live_hand_runtime_unrecoverable") {
      klogSafe("ws_persisted_bootstrap_live_hand_rejected", {
        tableId,
        code: adapted.code,
        reason: adapted.reason
      });
    }
    return adapted;
  };
}

function createPublicProfileLoader({ env = process.env } = {}) {
  let repositoryPromise = null;
  async function loadRepository() {
    if (!repositoryPromise) {
      repositoryPromise = import("./poker/profile/public-profile-repository.mjs")
        .then((module) => module.createPublicProfileRepository({ env }));
    }
    return repositoryPromise;
  }
  return async function loadPublicProfiles(userIds) {
    const repository = await loadRepository();
    return repository.loadPublicProfiles(userIds);
  };
}

const loadPersistedTableBootstrap = persistedBootstrapEnabled ? createPersistedBootstrapLoader() : null;
const loadPublicProfiles = hasSupabaseDbUrl ? createPublicProfileLoader() : null;
let persistedStateWriter = null;

const tableManager = createTableManager({
  presenceTtlMs: resolvePresenceTtlMs(process.env.WS_PRESENCE_TTL_MS),
  maxSeats: resolveMaxSeats(process.env.WS_MAX_SEATS),
  actionResultCacheMax: resolveActionResultCacheMax(process.env.WS_ACTION_RESULT_CACHE_MAX),
  tableBootstrapLoader: loadPersistedTableBootstrap,
  publicProfileLoader: loadPublicProfiles,
  publicProfileStorageBaseUrl,
  publicProfileLog: klogSafe,
  onTableEvicted: (tableId) => {
    persistedStateWriter?.forgetHoleCardAcknowledgement(tableId);
    releaseTableRuntimeResources(tableId);
  },
  observeOnlyJoin: observeOnlyJoinEnabled
});
const tableCommandQueue = createTableCommandQueue({
  onError: (error, meta) => {
    klogSafe("ws_table_command_queue_unhandled", {
      tableId: meta?.tableId || null,
      dedupeKey: meta?.dedupeKey || null,
      message: error?.message || "unknown"
    });
  }
});
const sessionStore = createSessionStore({
  sessionTtlMs: resolveSessionTtlMs(process.env.WS_SESSION_TTL_MS)
});
const activeSeatFreshMs = resolveActiveSeatFreshMs(process.env.WS_ACTIVE_SEAT_FRESH_MS);
const seatedReconnectGraceMs = resolveSeatedReconnectGraceMs(process.env.WS_SEATED_RECONNECT_GRACE_MS);
const janitorLiveHandStaleMs = resolvePositiveInt(process.env.POKER_LIVE_HAND_STALE_MS, 15_000, {
  min: 1_000,
  max: 900_000
});
const persistedSeatTouchThrottleMs = resolvePositiveInt(
  process.env.WS_PERSISTED_SEAT_TOUCH_THROTTLE_MS,
  30_000,
  { min: 1_000, max: 60_000 }
);
const streamLog = createStreamLog({ cap: Number(process.env.WS_STREAM_REPLAY_CAP || 128) });
const tableSnapshotLoader = createTableSnapshotLoader({ env: process.env });
persistedStateWriter = persistedStateWriteEnabled ? createPersistedStateWriter({ env: process.env, klog: klogSafe }) : null;
const durableActionStore = hasSupabaseDbUrl && persistedStateWriter?.readDurableActionRequest
  ? persistedStateWriter
  : null;
const botFundingSystemKey = getBotConfig(process.env).bankrollSystemKey;
function continuousBotMaxDesiredTablesForRuntime() {
  return loadReleaseMetadata().environment === "preview" ? 100 : 2;
}
const continuousBotMaxDesiredTables = continuousBotMaxDesiredTablesForRuntime();
const vpsMetricsCollector = createVpsMetricsCollector();
const continuousBotTableRepository = hasSupabaseDbUrl
  ? createContinuousBotTableRepository({
      env: process.env,
      maxDesiredTables: continuousBotMaxDesiredTables,
      klog: klogSafe
    })
  : null;
const lastSnapshotBySessionAndTable = new Map();
const persistedSeatTouchByTableUser = new Map();
const lobbySubscribers = new Set();
const activeLobbyTablesById = new Map();
const pendingTableJanitorEvaluationByTableId = new Map();
const suppressedNonRetryableTerminalJanitorFailuresByTableId = new Map();
const suppressedTerminalJanitorCountsByReason = new Map();
const continuousBotRetirementRequested = new Set();
const AUTOMATIC_TABLE_JANITOR_TRIGGERS = new Set([
  "stale_active_seat_sweep",
  "zombie_table_sweep",
  "open_table_reconciler"
]);
const TERMINAL_JANITOR_SUPPRESSION_TTL_MS = 10 * 60_000;
const TERMINAL_JANITOR_SUPPRESSION_MAX = 1_000;
const lobbyEmptyJoinableGraceMs = resolveEmptyJoinableGraceMs(process.env.POKER_TABLE_CLOSE_GRACE_MS);
const internalRuntimeToken = typeof process.env.POKER_WS_INTERNAL_TOKEN === "string" ? process.env.POKER_WS_INTERNAL_TOKEN.trim() : "";
const botReactionOverrideStore = createBotReactionOverrideStore({ env: process.env });
let openTableJanitorCursor = null;

function snapshotCacheKey(sessionId, tableId) {
  return `${sessionId}:${tableId}`;
}


let authoritativeLeaveExecutorPromise = null;
let authoritativeJoinExecutorPromise = null;
let authoritativeRebuyExecutorPromise = null;
let inactiveCleanupExecutorPromise = null;
let deferredLeaveFinalizerPromise = null;
let acceptedBotAutoplayExecutorPromise = null;
let botClaimsRecoveryExecutorPromise = null;
let beginSqlWsLoaderPromise = null;
const timeoutFailureTrackerByTableId = new Map();
const settledRolloverTimerByTableId = new Map();
const settlementRevealDeadlineByTableId = new Map();
const reactionTimers = createReactionTimers();
const evaluatedSettlementReactionHandByTableId = new Map();
const evaluatedAmbientReactionHandByTableId = new Map();
const TURN_TIMEOUT_FATAL_PREFIXES = ["showdown_"];
const TURN_TIMEOUT_FATAL_REASONS = new Set(["timeout_apply_failed"]);
const DEFAULT_INACTIVE_CLEANUP_ADAPTER_URL = new URL("./poker/persistence/inactive-cleanup-adapter.mjs", import.meta.url).href;
const DEFAULT_ACCEPTED_BOT_AUTOPLAY_ADAPTER_URL = new URL("./poker/runtime/accepted-bot-autoplay-adapter.mjs", import.meta.url).href;
const settledRevealMs = resolveSettledRevealMs(process.env.WS_POKER_SETTLED_REVEAL_MS);
const disconnectSettledRevealMs = Math.min(settledRevealMs, DEFAULT_DISCONNECT_SETTLED_REVEAL_MS);

async function loadAuthoritativeLeaveExecutor() {
  if (!authoritativeLeaveExecutorPromise) {
    authoritativeLeaveExecutorPromise = import("./poker/persistence/authoritative-leave-adapter.mjs")
      .then((module) => module.createAuthoritativeLeaveExecutor({
        env: process.env,
        klog: klogSafe,
        hasConnectedHumanPresence: ({ tableId }) => tableManager.hasConnectedHumanPresence(tableId)
      }));
  }
  return authoritativeLeaveExecutorPromise;
}

async function loadBotClaimsRecoveryExecutor() {
  if (!botClaimsRecoveryExecutorPromise) {
    botClaimsRecoveryExecutorPromise = import("./poker/persistence/bot-claims-recovery-adapter.mjs")
      .then((module) => module.createBotClaimsRecoveryExecutor({ env: process.env, klog: klogSafe }));
  }
  return botClaimsRecoveryExecutorPromise;
}

async function loadAuthoritativeJoinExecutor() {
  if (!authoritativeJoinExecutorPromise) {
    authoritativeJoinExecutorPromise = import("./poker/persistence/authoritative-join-adapter.mjs")
      .then((module) => module.createAuthoritativeJoinExecutor({ env: process.env, klog: klogSafe }));
  }
  return authoritativeJoinExecutorPromise;
}

async function loadAuthoritativeRebuyExecutor() {
  if (!authoritativeRebuyExecutorPromise) {
    authoritativeRebuyExecutorPromise = import("./poker/persistence/authoritative-rebuy-adapter.mjs")
      .then((module) => module.createAuthoritativeRebuyExecutor({ env: process.env, klog: klogSafe }));
  }
  return authoritativeRebuyExecutorPromise;
}

async function loadInactiveCleanupExecutor() {
  if (!inactiveCleanupExecutorPromise) {
    inactiveCleanupExecutorPromise = (async () => {
      const configured = typeof process.env.WS_INACTIVE_CLEANUP_ADAPTER_MODULE_PATH === "string"
        ? process.env.WS_INACTIVE_CLEANUP_ADAPTER_MODULE_PATH.trim()
        : "";
      const adapterModulePath = configured || DEFAULT_INACTIVE_CLEANUP_ADAPTER_URL;
      const module = await import(adapterModulePath);
      return module.createInactiveCleanupExecutor({
        env: process.env,
        klog: klogSafe,
        hasConnectedHumanPresence: ({ tableId }) => tableManager.hasConnectedHumanPresence(tableId)
      });
    })();
  }
  return inactiveCleanupExecutorPromise;
}

async function loadDeferredLeaveFinalizer() {
  if (!deferredLeaveFinalizerPromise) {
    deferredLeaveFinalizerPromise = import("./poker/persistence/deferred-leave-finalization-adapter.mjs")
      .then((module) => module.createDeferredLeaveFinalizer({ env: process.env, klog: klogSafe }));
  }
  return deferredLeaveFinalizerPromise;
}

function runReactionObserverSafely(name, observer) {
  void Promise.resolve()
    .then(observer)
    .catch((error) => klogSafe("ws_reaction_observer_failed", {
      observer: name,
      message: error?.message || "unknown"
    }));
}

function botSeatsForTable(tableId) {
  const snapshot = tableManager.tableSnapshot(tableId, null);
  return Array.isArray(snapshot?.members)
    ? snapshot.members
      .filter((member) => tableManager.isBotUser(tableId, member?.userId) === true)
      .map((member) => ({ userId: member.userId, seatNo: member.seat }))
    : [];
}

function availableBotSeatsForReaction(tableId) {
  const nowMs = Date.now();
  return botSeatsForTable(tableId).filter((bot) => (
    !reactionTimers.hasPendingReaction(tableId, bot.userId)
    && canBotStartReaction({ tableId, botUserId: bot.userId, nowMs })
  ));
}

function currentBotReactionSettings() {
  return botReactionOverrideStore.getReactionSettings();
}

function seatOwnerForTable(tableId, seatNo) {
  const snapshot = tableManager.tableSnapshot(tableId, null);
  const member = Array.isArray(snapshot?.members)
    ? snapshot.members.find((entry) => entry?.seat === seatNo)
    : null;
  return typeof member?.userId === "string" ? member.userId : null;
}

function scheduleBotReactionCandidate(tableId, createCandidate, {
  handId = null,
  targetUserId = null,
  validateCurrentState = null
} = {}) {
  const candidate = createCandidate();
  if (!candidate) return false;
  if (reactionTimers.hasPendingReaction(tableId, candidate.botUserId)) return false;
  const reserved = tryReserveBotReaction({
    tableId,
    botUserId: candidate.botUserId,
    botSeatNo: candidate.botSeatNo,
    targetSeatNo: candidate.targetSeatNo,
    reactionKey: candidate.reactionKey,
    reactionSettings: currentBotReactionSettings(),
    tableClosed: tableManager.isTableClosed(tableId),
    nowMs: Date.now()
  });
  if (!reserved) return false;
  const expectedTargetUserId = targetUserId
    || (Number.isInteger(candidate.targetSeatNo) ? seatOwnerForTable(tableId, candidate.targetSeatNo) : null);
  return reactionTimers.scheduleReaction({ tableId, botUserId: candidate.botUserId, delayMs: reserved.delayMs, validate: () => {
    if (currentBotReactionSettings().enabled !== true) return;
    if (tableManager.isTableClosed(tableId)) return;
    if (tableManager.isBotUser(tableId, candidate.botUserId) !== true) return;
    if (seatOwnerForTable(tableId, candidate.botSeatNo) !== candidate.botUserId) return;
    const state = tableManager.privatePokerStateForAudit?.(tableId);
    if (handId && state?.handId !== handId) return;
    if (expectedTargetUserId && seatOwnerForTable(tableId, candidate.targetSeatNo) !== expectedTargetUserId) return;
    if (typeof validateCurrentState === "function" && validateCurrentState(candidate, state) !== true) return;
    return true;
  }, emit: () => broadcastTableReaction(tableId, reserved) });
}

function candidateRemainsActiveInHand(candidate, state) {
  return eligibleActiveHandBotSeats({
    state,
    botSeats: [{ userId: candidate?.botUserId, seatNo: candidate?.botSeatNo }]
  }).length === 1;
}

function scheduleReservedBotReaction(tableId, candidate, { botUserId, handId = null } = {}) {
  if (!candidate || reactionTimers.hasPendingReaction(tableId, botUserId)) return false;
  return reactionTimers.scheduleReaction({ tableId, botUserId, delayMs: candidate.delayMs, validate: () => {
    if (currentBotReactionSettings().enabled !== true) return;
    if (tableManager.isTableClosed(tableId)) return;
    if (tableManager.isBotUser(tableId, botUserId) !== true) return;
    if (seatOwnerForTable(tableId, candidate.seatNo) !== botUserId) return;
    const state = tableManager.privatePokerStateForAudit?.(tableId);
    if (handId && state?.handId !== handId) return;
    return true;
  }, emit: () => broadcastTableReaction(tableId, candidate) });
}

function buildDetachedReactionContext(state) {
  const copyBooleanMap = (value) => Object.freeze(Object.fromEntries(Object.entries(value || {})
    .filter(([, flag]) => flag === true)
    .map(([userId]) => [userId, true])));
  const handSeats = Object.freeze(Array.isArray(state?.handSeats)
    ? state.handSeats.map((seat) => Object.freeze({ userId: seat?.userId, seatNo: seat?.seatNo }))
    : []);
  const payouts = state?.handSettlement?.payouts && typeof state.handSettlement.payouts === "object"
    ? Object.freeze({ ...state.handSettlement.payouts })
    : null;
  const handsByUserId = state?.showdown?.handsByUserId && typeof state.showdown.handsByUserId === "object"
    ? Object.freeze(Object.fromEntries(Object.entries(state.showdown.handsByUserId)
      .map(([userId, hand]) => [userId, Object.freeze({
        category: hand?.category,
        ranks: Array.isArray(hand?.ranks) ? Object.freeze([...hand.ranks]) : Object.freeze([]),
        key: hand?.key
      })])))
    : undefined;
  const riverChangedWinnerUserIds = Object.freeze(deriveRiverChangedWinnerUserIds(state));
  return Object.freeze({
    phase: state?.phase,
    handId: state?.handId,
    bigBlind: state?.bigBlind,
    turnUserId: state?.turnUserId,
    turnStartedAt: state?.turnStartedAt,
    turnDeadlineAt: state?.turnDeadlineAt,
    handSeats,
    foldedByUserId: copyBooleanMap(state?.foldedByUserId),
    leftTableByUserId: copyBooleanMap(state?.leftTableByUserId),
    sitOutByUserId: copyBooleanMap(state?.sitOutByUserId),
    riverChangedWinnerUserIds,
    handSettlement: state?.handSettlement ? Object.freeze({ handId: state.handSettlement.handId, payouts }) : null,
    showdown: state?.showdown ? Object.freeze({
      handId: state.showdown.handId,
      winners: Array.isArray(state.showdown.winners) ? Object.freeze([...state.showdown.winners]) : null,
      ...(handsByUserId ? { handsByUserId } : {})
    }) : null
  });
}

function observeFreshPokerMutation({ tableId, acceptedActionAudit, nextState }) {
  const handId = typeof nextState?.handId === "string" ? nextState.handId : null;
  if (acceptedActionAudit?.action === "RAISE") {
    const actorUserId = acceptedActionAudit.actorUserId;
    const actorSeat = Array.isArray(nextState?.handSeats)
      ? nextState.handSeats.find((seat) => seat?.userId === actorUserId)
      : null;
    scheduleBotReactionCandidate(tableId, () => classifyRaiseReaction({
      actorUserId,
      actorSeatNo: actorSeat?.seatNo,
      street: nextState?.phase,
      botSeats: eligibleActiveHandBotSeats({
        state: nextState,
        botSeats: availableBotSeatsForReaction(tableId)
      }),
      reactionSettings: currentBotReactionSettings()
    }), {
      handId,
      targetUserId: actorUserId,
      validateCurrentState: candidateRemainsActiveInHand
    });
  }

  if (isCompleteReactionSettlement(nextState)
    && evaluatedSettlementReactionHandByTableId.get(tableId) !== handId) {
    evaluatedSettlementReactionHandByTableId.set(tableId, handId);
    scheduleBotReactionCandidate(tableId, () => classifySettlementReaction({
      state: nextState,
      botSeats: availableBotSeatsForReaction(tableId),
      reactionSettings: currentBotReactionSettings()
    }), { handId });
  }

  if (handId && nextState?.phase !== "SETTLED"
    && evaluatedAmbientReactionHandByTableId.get(tableId) !== handId) {
    evaluatedAmbientReactionHandByTableId.set(tableId, handId);
    scheduleBotReactionCandidate(tableId, () => classifyAmbientReaction({
      botSeats: eligibleActiveHandBotSeats({
        state: nextState,
        botSeats: availableBotSeatsForReaction(tableId)
      }),
      reactionSettings: currentBotReactionSettings()
    }), { handId, validateCurrentState: candidateRemainsActiveInHand });
  }

  syncHumanTurnReactionTimer(tableId, nextState);
}

function clearHumanTurnReactionTimer(tableId) {
  reactionTimers.clearTurnObserver(tableId);
}

function syncHumanTurnReactionTimer(tableId, state) {
  clearHumanTurnReactionTimer(tableId);
  const handId = typeof state?.handId === "string" ? state.handId : null;
  const turnUserId = typeof state?.turnUserId === "string" ? state.turnUserId : null;
  const turnStartedAt = Number(state?.turnStartedAt);
  const turnDeadlineAt = Number(state?.turnDeadlineAt);
  if (!handId || !turnUserId || tableManager.isBotUser(tableId, turnUserId) === true) return;
  if (!Number.isFinite(turnStartedAt) || !Number.isFinite(turnDeadlineAt) || turnDeadlineAt <= turnStartedAt) return;
  const triggerAt = turnStartedAt + Math.floor((turnDeadlineAt - turnStartedAt) * 0.8);
  const delayMs = triggerAt - Date.now();
  if (delayMs <= 0) return;
  const targetSeat = Array.isArray(state?.handSeats)
    ? state.handSeats.find((seat) => seat?.userId === turnUserId)
    : null;
  if (!Number.isInteger(targetSeat?.seatNo)) return;
  reactionTimers.scheduleTurnObserver({ tableId, delayMs, validate: () => {
    const current = tableManager.privatePokerStateForAudit?.(tableId);
    if (current?.handId !== handId || current?.turnUserId !== turnUserId) return;
    if (Number(current?.turnStartedAt) !== turnStartedAt || Number(current?.turnDeadlineAt) !== turnDeadlineAt) return;
    return true;
  }, onDue: () => {
    scheduleBotReactionCandidate(tableId, () => classifyDirectedBotReaction({
      botSeats: availableBotSeatsForReaction(tableId),
      excludedUserId: turnUserId,
      targetSeatNo: targetSeat.seatNo,
      reactionKeys: ["hurry_up"],
      probability: 0.8,
      reactionSettings: currentBotReactionSettings()
    }), { handId, targetUserId: turnUserId });
  } });
}

async function loadAcceptedBotAutoplayExecutor() {
  if (!acceptedBotAutoplayExecutorPromise) {
    acceptedBotAutoplayExecutorPromise = (async () => {
      const configured = typeof process.env.WS_ACCEPTED_BOT_AUTOPLAY_ADAPTER_MODULE_PATH === "string"
        ? process.env.WS_ACCEPTED_BOT_AUTOPLAY_ADAPTER_MODULE_PATH.trim()
        : "";
      const adapterModulePath = configured || DEFAULT_ACCEPTED_BOT_AUTOPLAY_ADAPTER_URL;

      try {
        const module = await import(adapterModulePath);
        const createExecutor = typeof module.createAcceptedBotStepExecutor === "function"
          ? module.createAcceptedBotStepExecutor
          : module.createAcceptedBotAutoplayExecutor;
        if (typeof createExecutor !== "function") {
          throw new Error("accepted_bot_step_executor_missing");
        }
        return createExecutor({
          tableManager,
          persistMutatedState,
          restoreTableFromPersisted,
          broadcastResyncRequired,
          onBotStepPersisted: async ({ tableId, botTurnUserId, botAction }) => {
            broadcastStateSnapshots(tableId);
            if (tableManager.isBotUser(tableId, botTurnUserId) !== true) return;
            if (reactionTimers.hasPendingReaction(tableId, botTurnUserId)) return;
            const botSnapshot = tableManager.tableSnapshot(tableId, botTurnUserId);
            const reaction = tryCreateBotReaction({
              tableId,
              botUserId: botTurnUserId,
              botSeatNo: botSnapshot?.youSeat,
              botAction,
              tableClosed: tableManager.isTableClosed(tableId),
              nowMs: Date.now(),
              reactionSettings: currentBotReactionSettings()
            });
            if (reaction) {
              const state = tableManager.privatePokerStateForAudit?.(tableId);
              scheduleReservedBotReaction(tableId, reaction, { botUserId: botTurnUserId, handId: state?.handId || null });
            }
          },
          getBotReactionOverride: () => botReactionOverrideStore.getOverrideRange(),
          env: process.env,
          klog: botAutoplayObservability.log
        });
      } catch (error) {
        klogSafe("ws_bot_autoplay_executor_unavailable", {
          modulePath: adapterModulePath,
          message: error?.message || "unknown"
        });
        return async () => ({
          ok: true,
          changed: false,
          actionCount: 0,
          noop: true,
          reason: "autoplay_unavailable"
        });
      }
    })();
  }
  return acceptedBotAutoplayExecutorPromise;
}

async function loadBeginSqlWs() {
  if (!beginSqlWsLoaderPromise) {
    beginSqlWsLoaderPromise = import("./poker/bootstrap/persisted-bootstrap-db.mjs")
      .then((module) => module.beginSqlWs);
  }
  return beginSqlWsLoaderPromise;
}

function resolvePositiveInt(rawValue, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  if (rounded < min) return fallback;
  if (rounded > max) return max;
  return rounded;
}

const transportPongTimeoutMs = resolvePositiveInt(
  process.env.WS_TRANSPORT_PONG_TIMEOUT_MS,
  60_000,
  {
    min: process.env.NODE_ENV === "test" ? 25 : HEARTBEAT_MS * 2,
    max: 5 * 60_000
  }
);
const transportWatchdogSweepMs = process.env.NODE_ENV === "test"
  ? Math.min(HEARTBEAT_MS, transportPongTimeoutMs)
  : HEARTBEAT_MS;

const turnTimeoutFailureThreshold = resolvePositiveInt(process.env.WS_TIMEOUT_FAILURE_THRESHOLD, 5, { min: 1, max: 100 });
const turnTimeoutQuarantineMs = resolvePositiveInt(process.env.WS_TIMEOUT_QUARANTINE_MS, 300_000, {
  min: 5_000,
  max: 86_400_000
});

function klog(kind, data) {
  if (!pokerLogRuntimeControl.shouldEmit(kind, data)) return;
  process.stdout.write(`[klog] ${kind} ${serializePokerLogPayload(kind, data)}\n`);
}


function klogSafe(kind, data) {
  try {
    klog(kind, data);
  } catch {
    // Logging must never break request handling.
  }
}

function klogVerbose(kind, createData, { tableId = null } = {}) {
  if (!pokerLogRuntimeControl.mayBuildDebugPayload(kind, { tableId })) return;
  klogSafe(kind, createData());
}

function klogBotAutoplayVerbose(kind, createData, { tableId = null } = {}) {
  if (!pokerLogRuntimeControl.mayBuildDebugPayload(kind, { tableId })) return;
  klogSafe(kind, createData());
}

setPokerLogRuntimeAuditLogger(klogSafe);
if (pokerLogRuntimeControl.invalidConfiguredLevel) {
  klogSafe("ws_poker_log_config_invalid", { fallbackLevel: pokerLogRuntimeControl.defaultLevel });
}

const botAutoplayLogSummaryMs = resolvePositiveInt(process.env.WS_BOT_AUTOPLAY_LOG_SUMMARY_MS, 60_000, {
  min: 10_000,
  max: 3_600_000
});
const botAutoplayObservability = createBotAutoplayObservability({
  klog: klogSafe,
  summaryIntervalMs: botAutoplayLogSummaryMs
});
const botAutoplaySummaryTimer = setInterval(() => {
  botAutoplayObservability.flush("interval");
}, botAutoplayLogSummaryMs);
botAutoplaySummaryTimer.unref();

function flushSuppressedTerminalJanitorSummary() {
  if (suppressedTerminalJanitorCountsByReason.size === 0) return;
  const countsByReason = Object.fromEntries(
    [...suppressedTerminalJanitorCountsByReason.entries()].sort(([left], [right]) => left.localeCompare(right))
  );
  const total = Object.values(countsByReason).reduce((sum, count) => sum + count, 0);
  suppressedTerminalJanitorCountsByReason.clear();
  klogSafe("ws_table_janitor_terminal_failure_suppression_summary", {
    intervalMs: 60_000,
    total,
    countsByReason
  });
}

const terminalJanitorSuppressionSummaryTimer = setInterval(() => {
  flushSuppressedTerminalJanitorSummary();
}, 60_000);
terminalJanitorSuppressionSummaryTimer.unref();

function loadReleaseMetadata() {
  const fallback = {
    releaseSha: typeof process.env.WS_RELEASE_SHA === "string" ? process.env.WS_RELEASE_SHA.trim() : "",
    deployRef: typeof process.env.WS_DEPLOY_REF === "string" ? process.env.WS_DEPLOY_REF.trim() : "",
    environment: typeof process.env.WS_DEPLOY_ENVIRONMENT === "string"
      ? process.env.WS_DEPLOY_ENVIRONMENT.trim()
      : (process.env.NODE_ENV || "unknown")
  };
  try {
    const parsed = JSON.parse(fs.readFileSync(new URL("./release-metadata.json", import.meta.url), "utf8"));
    return {
      releaseSha: typeof parsed?.releaseSha === "string" && parsed.releaseSha.trim()
        ? parsed.releaseSha.trim()
        : fallback.releaseSha,
      deployRef: typeof parsed?.deployRef === "string" && parsed.deployRef.trim()
        ? parsed.deployRef.trim()
        : fallback.deployRef,
      environment: typeof parsed?.environment === "string" && parsed.environment.trim()
        ? parsed.environment.trim()
        : fallback.environment
    };
  } catch {
    return fallback;
  }
}

process.on("uncaughtException", (error) => {
  klogSafe("ws_uncaught_exception", {
    message: error?.message || "unknown",
    stack: error?.stack || null
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const asError = reason instanceof Error ? reason : null;
  klogSafe("ws_unhandled_rejection", {
    message: asError?.message || String(reason),
    stack: asError?.stack || null
  });
  process.exit(1);
});

function nowTs() {
  return new Date().toISOString();
}

function staleSeatCandidateKey(tableId, userId) {
  return `${tableId}:${userId}`;
}

function tableSocketMatches(socket, tableId) {
  const association = tableManager.connectionTableAssociation(socket);
  const joined = association?.joinedTableId || null;
  const subscribed = association?.subscribedTableId || null;
  return joined === tableId || subscribed === tableId;
}

async function touchPersistedSeatLastSeen({ tableId, userId }) {
  if (isGuestTableId(tableId)) return false;
  if (!persistedBootstrapEnabled) return false;
  if (typeof tableId !== "string" || !tableId || typeof userId !== "string" || !userId) return false;
  const key = staleSeatCandidateKey(tableId, userId);
  const nowMs = Date.now();
  const previousTouchMs = Number(persistedSeatTouchByTableUser.get(key));
  if (Number.isFinite(previousTouchMs) && nowMs - previousTouchMs < persistedSeatTouchThrottleMs) {
    return false;
  }
  persistedSeatTouchByTableUser.set(key, nowMs);
  try {
    const beginSqlWs = await loadBeginSqlWs();
    await beginSqlWs(async (tx) => {
      await tx.unsafe(
        "update public.poker_seats set last_seen_at = now() where table_id = $1 and user_id = $2 and status = 'ACTIVE';",
        [tableId, userId]
      );
      return true;
    }, { env: process.env });
    return true;
  } catch (error) {
    persistedSeatTouchByTableUser.delete(key);
    klogSafe("ws_touch_persisted_seat_failed", {
      tableId,
      userId,
      message: error?.message || "unknown"
    });
    return false;
  }
}

function maybeTouchPersistedSeatLastSeen(ws, connState) {
  const association = tableManager.connectionTableAssociation(ws);
  const tableId = association?.joinedTableId || association?.subscribedTableId || null;
  const userId = connState?.session?.userId || null;
  if (!tableId || !userId) return;
  void touchPersistedSeatLastSeen({ tableId, userId });
}

function nextEventLoopTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function buildBotTurnScheduleKey(tableId) {
  const state = tableManager.persistedPokerState(tableId);
  if (!state || typeof state !== "object") return null;
  if (!isLiveHandPhase(state.phase) || state.phase === "SHOWDOWN") return null;
  const turnUserId = typeof state.turnUserId === "string" ? state.turnUserId.trim() : "";
  if (!turnUserId || tableManager.isBotUser(tableId, turnUserId) !== true) return null;
  const stateVersion = Number(tableManager.persistedStateVersion(tableId) || state.version || 0);
  const handId = typeof state.handId === "string" && state.handId.trim() ? state.handId.trim() : "unknown_hand";
  const phase = typeof state.phase === "string" && state.phase.trim() ? state.phase.trim() : "unknown_phase";
  return `${tableId}:${stateVersion}:${handId}:${phase}:${turnUserId}`;
}

async function runBotStep({ tableId, trigger, requestId, frameTs }) {
  const acceptedBotAutoplayExecutor = await loadAcceptedBotAutoplayExecutor();
  const result = await acceptedBotAutoplayExecutor({ tableId, trigger, requestId, frameTs });
  maybeScheduleSettledRollover(tableId);
  return result;
}

const scheduledObservedBotTurnKeys = new Map();
const suppressedBotTimeoutSafetyFailures = new Map();

function buildBotTimeoutSafetyFingerprint(tableId) {
  const pokerState = tableManager.persistedPokerState(tableId);
  if (!pokerState || typeof pokerState !== "object") return null;
  const stateVersion = Number(tableManager.persistedStateVersion(tableId));
  if (!Number.isFinite(stateVersion)) return null;
  return {
    tableId,
    handId: typeof pokerState.handId === "string" ? pokerState.handId.trim() : "",
    stateVersion,
    turnUserId: typeof pokerState.turnUserId === "string" ? pokerState.turnUserId.trim() : "",
    phase: typeof pokerState.phase === "string" ? pokerState.phase.trim() : ""
  };
}

function isBotTimeoutSafetyRetrySuppressed(tableId) {
  const suppressed = suppressedBotTimeoutSafetyFailures.get(tableId);
  if (!suppressed) return false;
  const current = buildBotTimeoutSafetyFingerprint(tableId);
  if (matchesBotTimeoutSafetySuppression(suppressed, current)) return true;
  suppressedBotTimeoutSafetyFailures.delete(tableId);
  return false;
}

function clearBotTimeoutSafetySuppressionAfterSuccess(tableId, result) {
  if (shouldClearBotTimeoutSafetySuppression(result)) {
    suppressedBotTimeoutSafetyFailures.delete(tableId);
  }
}

function pruneBotTimeoutSafetySuppressions() {
  if (suppressedBotTimeoutSafetyFailures.size === 0) return;
  const loadedTableIds = new Set(tableManager.listTableIds());
  for (const tableId of suppressedBotTimeoutSafetyFailures.keys()) {
    if (!loadedTableIds.has(tableId) || tableManager.isTableClosed(tableId) === true) {
      suppressedBotTimeoutSafetyFailures.delete(tableId);
    }
  }
}

const botAutoplayCascadeScheduler = createBotAutoplayCascadeScheduler({
  runStep: ({ tableId, trigger, requestId, frameTs }) => enqueueTableCommand({
    tableId,
    commandName: "bot_step",
    run: async () => {
      if (isBotTimeoutSafetyRetrySuppressed(tableId)) {
        return {
          ok: true,
          changed: false,
          actionCount: 0,
          reason: "same_state_retry_suppressed",
          suppressed: true
        };
      }
      const result = await handleBotStepCommand({
        tableId,
        trigger,
        requestId,
        frameTs,
        runBotStep,
        broadcastStateSnapshots,
        klog: botAutoplayObservability.log
      });
      clearBotTimeoutSafetySuppressionAfterSuccess(tableId, result);
      return result;
    }
  })
});

function scheduleBotStep({ tableId, trigger, requestId, frameTs }) {
  return botAutoplayCascadeScheduler.schedule({ tableId, trigger, requestId, frameTs });
}

function scheduleObservedBotTurn({ tableId, trigger, requestId = null, frameTs = null }) {
  const scheduleKey = buildBotTurnScheduleKey(tableId);
  if (!scheduleKey) {
    scheduledObservedBotTurnKeys.delete(tableId);
    return false;
  }
  if (scheduledObservedBotTurnKeys.get(tableId) === scheduleKey) return false;
  scheduledObservedBotTurnKeys.set(tableId, scheduleKey);
  try {
    scheduleBotStep({ tableId, trigger, requestId, frameTs });
    klogBotAutoplayVerbose("ws_observed_bot_turn_autoplay_scheduled", () => ({
      tableId,
      trigger: trigger || null,
      scheduleKey
    }), { tableId });
    return true;
  } catch (error) {
    scheduledObservedBotTurnKeys.delete(tableId);
    klogSafe("ws_observed_bot_turn_autoplay_failed", {
      tableId,
      trigger: trigger || null,
      scheduleKey,
      message: error?.message || "unknown"
    });
    return false;
  }
}

function enqueueTableCommand({ tableId, commandName, dedupeKey = null, run }) {
  return tableCommandQueue.enqueue({
    tableId,
    dedupeKey,
    run: async () => {
      try {
        return await run();
      } catch (error) {
        klogSafe("ws_table_command_failed", {
          tableId,
          commandName,
          dedupeKey,
          message: error?.message || "unknown"
        });
        throw error;
      }
    }
  });
}

function sendFrame(ws, frame) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}

function invalidateSocketSession(ws, { reason = "session_rebound", closeCode = SESSION_REBOUND_CLOSE_CODE, send_stale = true } = {}) {
  if (!ws) {
    return;
  }
  const staleConnState = ws.__connState;
  try {
    klogSafe("ws_invalidating_stale_socket", {
      sessionId: staleConnState && staleConnState.session ? staleConnState.session.sessionId : null,
      userId: staleConnState && staleConnState.session ? staleConnState.session.userId : null,
      reason
    });
  } catch (_err) {}
  if (staleConnState && typeof staleConnState === "object") {
    staleConnState.sessionInvalidated = true;
    staleConnState.sessionInvalidatedReason = reason;
  }

  // If caller opted out of sending a STALE_SESSION frame here, just close the socket
  // deterministically without emitting a second STALE frame (the caller may have
  // already emitted one with the relevant requestId).
  if (!send_stale) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.close(closeCode, reason); } catch (_err) {}
        return;
      }

      if (ws.readyState === WebSocket.CONNECTING) {
        try { ws.close(closeCode, reason); } catch (_e) {}
        return;
      }

      return;
    } catch (_err) {
      try { ws.close(closeCode, reason); } catch (_e) {}
      return;
    }
  }

  // Ensure STALE_SESSION is delivered to the socket before closing it.
  // Use ws.send callback to wait for the write to be handed to the kernel where possible.
  try {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        const errorFrame = makeErrorFrame({
          code: "STALE_SESSION",
          message: "socket no longer owns session",
          requestId: null,
          sessionId: staleConnState && staleConnState.session ? staleConnState.session.sessionId : null,
          ts: nowTs()
        });
        // Attempt to send error and close in callback so the frame is flushed first.
        ws.send(JSON.stringify(errorFrame), (err) => {
          try {
            // Give a short, deterministic grace period for the peer to receive and process
            // the error frame before closing the socket. This improves test determinism.
            setTimeout(() => {
              try { ws.close(closeCode, reason); } catch (_err) {}
            }, 25);
          } catch (_err) {}
        });
      } catch (_err) {
        // If send throws, still attempt close.
        try { ws.close(closeCode, reason); } catch (_e) {}
      }
      return;
    }

    if (ws.readyState === WebSocket.CONNECTING) {
      // If still connecting, just close — nothing to flush.
      try { ws.close(closeCode, reason); } catch (_e) {}
      return;
    }

    // Otherwise, already closed.
  } catch (_err) {
    // Socket invalidation is best-effort and must not throw into command handling.
    try { ws.close(closeCode, reason); } catch (_e) {}
  }
}


function sendError(ws, connState, { code, message, requestId = null, closeCode = null }) {
  sendFrame(
    ws,
    makeErrorFrame({
      code,
      message,
      requestId,
      sessionId: connState.sessionId,
      ts: nowTs()
    })
  );

  const violated = recordProtocolViolation(connState);
  if (closeCode) {
    ws.close(closeCode);
    return;
  }

  if (shouldClose(connState, violated)) {
    ws.close(1002);
  }
}

function normalizeTableId(value) {
  if (typeof value !== "string") {
    return null;
  }

  const tableId = value.trim();
  if (tableId.length === 0 || tableId.length > 64) {
    return null;
  }

  return tableId;
}

function isGuestTableId(tableId) {
  return typeof tableId === "string" && tableId.startsWith("guest_table_");
}

function isGuestSession(connState) {
  return connState?.session?.identityMode === "guest" || connState?.identityMode === "guest";
}

function resolveRoomId(frame, { allowMissing = false } = {}) {
  const envelopeRoomIdProvided = frame.roomId !== undefined;
  const payloadTableIdProvided = frame.payload.tableId !== undefined;

  const envelopeRoomId = envelopeRoomIdProvided ? normalizeTableId(frame.roomId) : null;
  if (envelopeRoomIdProvided && !envelopeRoomId) {
    return {
      ok: false,
      code: "INVALID_ROOM_ID",
      message: "roomId must be a non-empty string"
    };
  }

  const payloadTableId = payloadTableIdProvided ? normalizeTableId(frame.payload.tableId) : null;
  if (payloadTableIdProvided && !payloadTableId) {
    return {
      ok: false,
      code: "INVALID_ROOM_ID",
      message: "payload.tableId must be a non-empty string"
    };
  }

  if (envelopeRoomId && payloadTableId && envelopeRoomId !== payloadTableId) {
    return {
      ok: false,
      code: "INVALID_ROOM_ID",
      message: "roomId and payload.tableId must match when both are provided"
    };
  }

  const resolvedRoomId = envelopeRoomId || payloadTableId;
  if (!allowMissing && !resolvedRoomId) {
    return {
      ok: false,
      code: "INVALID_ROOM_ID",
      message: "roomId is required"
    };
  }

  return { ok: true, roomId: resolvedRoomId ?? null };
}



function mapEnsureTableLoadedError(ensured) {
  const code = typeof ensured?.code === "string" ? ensured.code.trim().toLowerCase() : "";
  if (code === "table_bootstrap_unavailable") {
    return { code: "TABLE_BOOTSTRAP_UNAVAILABLE", message: "table_bootstrap_unavailable" };
  }
  if (code === "table_not_found") {
    return { code: "TABLE_NOT_FOUND", message: "table_not_found" };
  }
  return { code: "TABLE_BOOTSTRAP_FAILED", message: ensured?.message || ensured?.code || "table_bootstrap_failed" };
}

function requiresRequestId(frameType) {
  return REQUEST_ID_REQUIRED_TYPES.has(frameType);
}

function recordStatefulFrame({ ws, connState, tableId, frame }) {
  const replayFrame = streamLog.append({
    tableId,
    frame,
    receiverKey: connState.sessionId
  });
  connState.session.latestDeliveredSeqByTableId.set(tableId, replayFrame.seq);
  sendFrame(ws, replayFrame);
  return replayFrame;
}

function normalizeLobbyHandStatus(value) {
  if (typeof value !== "string") {
    return "LOBBY";
  }
  const normalized = value.trim().toUpperCase();
  return normalized || "LOBBY";
}

function hasVisibleHumanLobbySeat(seats) {
  if (!Array.isArray(seats)) {
    return false;
  }
  return seats.some((seat) => (
    seat?.isBot !== true
    && (seat?.status === "ACTIVE" || seat?.status === "WAITING_NEXT_HAND")
  ));
}

function isLobbyTableJoinable({ seats, maxPlayers, lastActivityAtMs }) {
  const seatCount = Array.isArray(seats) ? seats.length : 0;
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || seatCount >= maxPlayers) {
    return false;
  }
  if (seatCount > 0) {
    return true;
  }
  if (!Number.isFinite(lastActivityAtMs)) {
    return false;
  }
  return Date.now() - lastActivityAtMs <= lobbyEmptyJoinableGraceMs;
}

function buildLobbyTableEntry(tableId) {
  if (isGuestTableId(tableId)) return null;
  if (tableManager.isTableClosed(tableId) === true) {
    return null;
  }
  const tableSnapshot = tableManager.tableSnapshot(tableId, null);
  const tableMeta = tableManager.tableMeta(tableId);
  const seats = Array.isArray(tableSnapshot?.seats) ? tableSnapshot.seats : [];
  const handStatus = normalizeLobbyHandStatus(tableSnapshot?.hand?.status);
  const liveHand = isLiveHandPhase(handStatus);
  const maxPlayers = Number.isInteger(tableMeta?.maxPlayers)
    ? tableMeta.maxPlayers
    : (Number.isInteger(tableSnapshot?.maxSeats) ? tableSnapshot.maxSeats : null);
  const joinable = isLobbyTableJoinable({
    seats,
    maxPlayers,
    lastActivityAtMs: Number(tableMeta?.lastActivityAtMs)
  });
  if (!liveHand && !hasVisibleHumanLobbySeat(seats) && !joinable) {
    return null;
  }
  const humanCount = seats.filter((seat) => seat?.isBot !== true).length;
  return {
    id: tableId,
    tableId,
    roomId: typeof tableSnapshot?.roomId === "string" && tableSnapshot.roomId ? tableSnapshot.roomId : tableId,
    stateVersion: Number.isInteger(tableSnapshot?.stateVersion) ? tableSnapshot.stateVersion : 0,
    status: handStatus,
    live: liveHand,
    joinable,
    stakes: tableMeta?.stakes ?? null,
    buyIn: tableMeta?.buyIn ?? null,
    maxPlayers,
    seatCount: seats.length,
    humanCount
  };
}

function syncLobbyTable(tableId) {
  const previous = activeLobbyTablesById.get(tableId) ?? null;
  const next = buildLobbyTableEntry(tableId);
  const previousJson = previous ? JSON.stringify(previous) : null;
  const nextJson = next ? JSON.stringify(next) : null;
  if (nextJson === previousJson) {
    return false;
  }
  if (next) {
    activeLobbyTablesById.set(tableId, next);
  } else {
    activeLobbyTablesById.delete(tableId);
  }
  return true;
}

function syncLobbyRegistry() {
  let changed = false;
  const loadedTableIds = new Set(tableManager.listTableIds());
  for (const tableId of loadedTableIds) {
    if (syncLobbyTable(tableId)) {
      changed = true;
    }
  }
  for (const tableId of [...activeLobbyTablesById.keys()]) {
    if (loadedTableIds.has(tableId)) {
      continue;
    }
    activeLobbyTablesById.delete(tableId);
    changed = true;
  }
  return changed;
}

function buildLobbySnapshotPayload() {
  return {
    tables: [...activeLobbyTablesById.values()].sort((left, right) => left.tableId.localeCompare(right.tableId))
  };
}

function sendLobbySnapshot(ws, connState, { requestId = null } = {}) {
  const frame = {
    version: "1.0",
    type: "lobby_snapshot",
    ts: nowTs(),
    sessionId: connState.sessionId,
    payload: buildLobbySnapshotPayload()
  };
  if (requestId) {
    frame.requestId = requestId;
  }
  sendFrame(ws, frame);
}

function maybeBroadcastLobbySnapshot({ force = false } = {}) {
  const changed = syncLobbyRegistry();
  if (!force && !changed) {
    return;
  }
  for (const recipient of lobbySubscribers) {
    const recipientConnState = recipient?.__connState;
    if (!recipientConnState) {
      continue;
    }
    sendLobbySnapshot(recipient, recipientConnState);
  }
}

function buildTableStatePayload({ tableState, tableSnapshot, userId }) {
  const payload = {
    tableId: tableState.tableId,
    members: Array.isArray(tableState.members) ? tableState.members : []
  };

  if (!tableSnapshot || typeof tableSnapshot !== "object") {
    return payload;
  }

  if (typeof tableSnapshot.roomId === "string" && tableSnapshot.roomId) payload.roomId = tableSnapshot.roomId;
  if (typeof tableSnapshot.status === "string" && tableSnapshot.status) payload.status = tableSnapshot.status;
  if (Number.isInteger(tableSnapshot.stateVersion)) payload.stateVersion = tableSnapshot.stateVersion;
  if (Number.isInteger(tableSnapshot.memberCount)) payload.memberCount = tableSnapshot.memberCount;
  if (Number.isInteger(tableSnapshot.maxSeats)) payload.maxSeats = tableSnapshot.maxSeats;
  if (Number.isSafeInteger(tableSnapshot.buyIn) && tableSnapshot.buyIn > 0) payload.buyIn = tableSnapshot.buyIn;
  if (Number.isInteger(tableSnapshot.youSeat)) payload.youSeat = tableSnapshot.youSeat;
  if (Number.isInteger(tableSnapshot.dealerSeatNo)) payload.dealerSeatNo = tableSnapshot.dealerSeatNo;
  if (Array.isArray(tableSnapshot.seats)) payload.seats = tableSnapshot.seats;
  if (tableSnapshot.stacks && typeof tableSnapshot.stacks === "object" && !Array.isArray(tableSnapshot.stacks)) payload.stacks = tableSnapshot.stacks;
  if (Number.isInteger(tableSnapshot.bigBlind) && tableSnapshot.bigBlind > 0) payload.bigBlind = tableSnapshot.bigBlind;
  if (tableSnapshot.hand && typeof tableSnapshot.hand === "object") {
    payload.hand = { ...tableSnapshot.hand };
    if (!Number.isInteger(payload.hand.dealerSeatNo) && Number.isInteger(tableSnapshot.dealerSeatNo)) {
      payload.hand.dealerSeatNo = tableSnapshot.dealerSeatNo;
    }
  }
  if (tableSnapshot.board && typeof tableSnapshot.board === "object") payload.board = tableSnapshot.board;
  if (tableSnapshot.pot && typeof tableSnapshot.pot === "object") payload.pot = tableSnapshot.pot;
  if (tableSnapshot.turn && typeof tableSnapshot.turn === "object") payload.turn = tableSnapshot.turn;
  if (tableSnapshot.legalActions && typeof tableSnapshot.legalActions === "object") payload.legalActions = tableSnapshot.legalActions;
  if (tableSnapshot.projectedLegalActions && typeof tableSnapshot.projectedLegalActions === "object") payload.projectedLegalActions = tableSnapshot.projectedLegalActions;
  if (tableSnapshot.actionConstraints && typeof tableSnapshot.actionConstraints === "object") payload.actionConstraints = tableSnapshot.actionConstraints;
  if (Array.isArray(tableSnapshot.members)) payload.authoritativeMembers = tableSnapshot.members;
  if (tableSnapshot.showdown && typeof tableSnapshot.showdown === "object") payload.showdown = tableSnapshot.showdown;
  if (tableSnapshot.handSettlement && typeof tableSnapshot.handSettlement === "object") payload.handSettlement = tableSnapshot.handSettlement;
  if (Number.isSafeInteger(tableSnapshot.settlementRevealDueAt) && tableSnapshot.settlementRevealDueAt >= 0) payload.settlementRevealDueAt = tableSnapshot.settlementRevealDueAt;

  // Identyczny bezpieczny kontrakt jak buildStateSnapshotPayload:
  // prywatny branch tylko dla siedzącego usera, hole cards przeciwników nie wyciekają.
  const youSeat = Number.isInteger(tableSnapshot.youSeat) ? tableSnapshot.youSeat : null;
  if (youSeat !== null && typeof userId === "string" && userId) {
    payload.private = normalizePrivateBranch(tableSnapshot?.private, { userId, youSeat });
  }

  return payload;
}

function sendTableState(ws, connState, { requestId = null, tableState, tableSnapshot = null }) {
  const preparedReveal = preparePublishedSettlementReveal(tableState.tableId, tableSnapshot);
  const settlementRevealDueAt = preparedReveal?.dueAt ?? null;
  maybeScheduleSettledRollover(tableState.tableId, preparedReveal?.dueAt ?? null);
  const snapshotWithRevealDeadline = tableSnapshot && settlementRevealDueAt !== null
    ? { ...tableSnapshot, settlementRevealDueAt }
    : tableSnapshot;
  const frame = {
    version: "1.0",
    type: "table_state",
    ts: nowTs(),
    roomId: tableState.tableId,
    sessionId: connState.sessionId,
    payload: buildTableStatePayload({ tableState, tableSnapshot: snapshotWithRevealDeadline, userId: connState.session.userId })
  };

  if (requestId) {
    frame.requestId = requestId;
  }

  return recordStatefulFrame({ ws, connState, tableId: tableState.tableId, frame });
}

function sendStateSnapshot(ws, connState, { requestId = null, tableSnapshot, reason = null }) {
  const preparedReveal = preparePublishedSettlementReveal(tableSnapshot.tableId, tableSnapshot);
  const settlementRevealDueAt = preparedReveal?.dueAt ?? null;
  maybeScheduleSettledRollover(tableSnapshot.tableId, preparedReveal?.dueAt ?? null);
  const payload = buildStateSnapshotPayload({
    tableSnapshot,
    userId: connState.session.userId,
    publicProfileStorageBaseUrl,
    settlementRevealDueAt
  });

  const frame = {
    version: "1.0",
    type: "stateSnapshot",
    ts: nowTs(),
    roomId: tableSnapshot.tableId,
    sessionId: connState.sessionId,
    payload
  };

  if (requestId) {
    frame.requestId = requestId;
  }

  if (reason) {
    frame.payload.resyncReason = reason;
  }

  lastSnapshotBySessionAndTable.set(snapshotCacheKey(connState.sessionId, tableSnapshot.tableId), payload);
  return recordStatefulFrame({ ws, connState, tableId: tableSnapshot.tableId, frame });
}

function sendStateDelta(ws, connState, { tableSnapshot }) {
  const preparedReveal = preparePublishedSettlementReveal(tableSnapshot.tableId, tableSnapshot);
  const settlementRevealDueAt = preparedReveal?.dueAt ?? null;
  maybeScheduleSettledRollover(tableSnapshot.tableId, preparedReveal?.dueAt ?? null);
  const payload = buildStateSnapshotPayload({
    tableSnapshot,
    userId: connState.session.userId,
    publicProfileStorageBaseUrl,
    settlementRevealDueAt
  });
  const cacheKey = snapshotCacheKey(connState.sessionId, tableSnapshot.tableId);
  const previousPayload = lastSnapshotBySessionAndTable.get(cacheKey) ?? null;
  const patch = buildStatePatch({ beforePayload: previousPayload, nextPayload: payload });

  if (!patch.ok) {
    return sendStateSnapshot(ws, connState, { tableSnapshot });
  }

  const frame = {
    version: "1.0",
    type: "statePatch",
    ts: nowTs(),
    roomId: tableSnapshot.tableId,
    sessionId: connState.sessionId,
    payload: patch.patch
  };

  lastSnapshotBySessionAndTable.set(cacheKey, payload);
  return recordStatefulFrame({ ws, connState, tableId: tableSnapshot.tableId, frame });
}

function sendResumeRequired(ws, connState, { requestId = null, tableId, reason, expectedSeq = 0 }) {
  const frame = {
    version: "1.0",
    type: "resync",
    ts: nowTs(),
    roomId: tableId,
    sessionId: connState.sessionId,
    payload: {
      mode: "required",
      reason,
      expectedSeq
    }
  };

  if (requestId) {
    frame.requestId = requestId;
  }

  return recordStatefulFrame({ ws, connState, tableId, frame });
}

function sendResumeAck(ws, connState, { requestId = null, tableId }) {
  const frame = {
    version: "1.0",
    type: "commandResult",
    ts: nowTs(),
    roomId: tableId,
    sessionId: connState.sessionId,
    payload: {
      requestId,
      status: "accepted",
      reason: null
    }
  };

  if (requestId) {
    frame.requestId = requestId;
  }

  sendFrame(ws, frame);
}

function sendCommandResult(ws, connState, { requestId = null, tableId = null, status, reason = null, ...result }) {
  const frame = {
    version: "1.0",
    type: "commandResult",
    ts: nowTs(),
    sessionId: connState.sessionId,
    payload: {
      requestId,
      status,
      reason,
      ...result
    }
  };

  if (tableId) {
    frame.roomId = tableId;
  }

  if (requestId) {
    frame.requestId = requestId;
  }

  sendFrame(ws, frame);
}

function sendGameplaySnapshot(ws, connState, { requestId = null, tableId, snapshot }) {
  const frame = {
    version: "1.0",
    type: "table_snapshot",
    ts: nowTs(),
    roomId: tableId,
    sessionId: connState.sessionId,
    payload: snapshot
  };

  if (requestId) {
    frame.requestId = requestId;
  }

  sendFrame(ws, frame);
}

function broadcastTableState(tableId, { excludeWs = null } = {}) {
  maybeBroadcastLobbySnapshot();
  const publicationSnapshot = tableManager.tableSnapshot(tableId, null);
  const preparedReveal = preparePublishedSettlementReveal(tableId, publicationSnapshot);
  maybeScheduleSettledRollover(tableId, preparedReveal?.dueAt ?? null);
  const tableState = tableManager.tableState(tableId);
  const subscribers = tableManager.orderedSubscribers(tableId, (socket) => socket.__connState?.sessionId ?? "");

  for (const subscriber of subscribers) {
    if (excludeWs && subscriber === excludeWs) {
      continue;
    }

    const subscriberConnState = subscriber.__connState;
    if (subscriberConnState) {
      const tableSnapshot = tableManager.tableSnapshot(tableId, subscriberConnState.session.userId);
      sendTableState(subscriber, subscriberConnState, { tableState, tableSnapshot });
    }
  }
}




async function persistMutatedState({
  tableId,
  expectedVersion,
  mutationKind,
  acceptedActionAudit = null,
  nextStateOverride = null,
  privateStateForHoleCardsOverride = null,
  replacementFundings = undefined,
  managedBotTopUps = undefined,
  humanStackUpdates = undefined,
  replacementFundingSystemKey = null,
  durableActionRequest = null,
  deferRuntimeVersionUpdate = false
}) {
  if (isGuestTableId(tableId)) {
    return { ok: true, skipped: true, guest: true };
  }
  if (!persistedStateWriter) {
    if ((Array.isArray(replacementFundings) && replacementFundings.length > 0)
      || (Array.isArray(managedBotTopUps) && managedBotTopUps.length > 0)) {
      return { ok: false, reason: "persistence_required" };
    }
    if (process.env.WS_PERSISTED_BOOTSTRAP_FIXTURES_JSON && Array.isArray(humanStackUpdates)) {
      return {
        ok: true,
        skipped: true,
        fixture: true,
        tableId,
        expectedVersion,
        newVersion: expectedVersion + 1,
        humanStackProjectionCommitted: true,
        projectedHumanStacks: humanStackUpdates.map(({ userId, seatNo, stack }) => ({ userId, seatNo, stack }))
      };
    }
    return { ok: true, skipped: true };
  }
  const nextState = nextStateOverride || tableManager.persistedPokerState(tableId);
  if (!nextState) {
    return { ok: false, reason: "invalid_state" };
  }
  const privateStateForHoleCards = privateStateForHoleCardsOverride || (typeof tableManager.privatePokerStateForAudit === "function"
    ? tableManager.privatePokerStateForAudit(tableId)
    : nextState);
  const persistStartedAtMs = pokerLogRuntimeControl.mayBuildDebugPayload("ws_state_persist_start", { tableId }) ? Date.now() : 0;
  klogVerbose("ws_state_persist_start", () => ({ tableId, expectedVersion, mutationKind }), { tableId });
  const persisted = await persistedStateWriter.writeMutation({
    tableId,
    expectedVersion,
    nextState,
    privateStateForHoleCards,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    meta: { mutationKind },
    acceptedActionAudit,
    replacementFundings,
    managedBotTopUps,
    humanStackUpdates,
    botFundingSystemKey: replacementFundingSystemKey,
    durableActionRequest
  });
  if (!persisted?.ok) {
    klogSafe("ws_state_persist_failed", { tableId, expectedVersion, mutationKind, reason: persisted?.reason || "unknown" });
    return persisted;
  }
  klogVerbose("ws_state_persist_result", () => ({
    tableId,
    expectedVersion,
    mutationKind,
    newVersion: persisted.newVersion ?? null,
    durationMs: Math.max(0, Date.now() - persistStartedAtMs)
  }), { tableId });
  if (!deferRuntimeVersionUpdate && persisted.outcome !== "durable_replay") {
    tableManager.setPersistedStateVersion(tableId, persisted.newVersion);
  }
  if (shouldObservePersistedReactionMutation(persisted)) {
    try {
      const reactionContext = buildDetachedReactionContext(privateStateForHoleCards);
      const reactionAction = acceptedActionAudit ? {
        action: acceptedActionAudit.action,
        actorUserId: acceptedActionAudit.actorUserId
      } : null;
      runReactionObserverSafely("fresh_poker_mutation", () => observeFreshPokerMutation({
        tableId,
        acceptedActionAudit: reactionAction,
        nextState: reactionContext
      }));
    } catch (error) {
      klogSafe("ws_reaction_observer_failed", {
        observer: "build_fresh_poker_mutation_context",
        message: error?.message || "unknown"
      });
    }
  }
  return persisted;
}

async function restoreTableFromPersisted(tableId) {
  if (typeof loadPersistedTableBootstrap !== "function") {
    return { ok: false, reason: "persisted_bootstrap_disabled" };
  }
  const restoreStartedAtMs = pokerLogRuntimeControl.mayBuildDebugPayload("ws_restore_start", { tableId }) ? Date.now() : null;
  klogVerbose("ws_restore_start", () => ({
    tableId,
    stage: "load",
    ok: null,
    durationMs: 0
  }), { tableId });
  try {
    const restored = await loadPersistedTableBootstrap({ tableId });
    if (!restored?.ok || !restored?.table) {
      const reason = restored?.code || "restore_failed";
      klogSafe("ws_restore_failed", {
        tableId,
        stage: "load",
        reason
      });
      klogVerbose("ws_restore_outcome", () => ({
        tableId,
        stage: "load",
        ok: false,
        reason,
        durationMs: Math.max(0, Date.now() - restoreStartedAtMs)
      }), { tableId });
      return { ok: false, reason };
    }
    persistedStateWriter?.forgetHoleCardAcknowledgement(tableId);
    const applied = tableManager.restoreTableFromPersisted(tableId, restored.table);
    if (!applied?.ok) {
      const reason = applied?.reason || applied?.code || "restore_failed";
      klogSafe("ws_restore_failed", {
        tableId,
        stage: "apply",
        reason
      });
      klogVerbose("ws_restore_outcome", () => ({
        tableId,
        stage: "apply",
        ok: false,
        reason,
        durationMs: Math.max(0, Date.now() - restoreStartedAtMs)
      }), { tableId });
      return applied;
    }
    maybeScheduleSettledRollover(tableId);
    klogVerbose("ws_restore_outcome", () => ({
      tableId,
      stage: "apply",
      ok: true,
      durationMs: Math.max(0, Date.now() - restoreStartedAtMs)
    }), { tableId });
    return {
      ...applied,
      restoredTable: restored.table
    };
  } catch (error) {
    klogSafe("ws_state_restore_failed", { tableId, message: error?.message || "unknown" });
    klogVerbose("ws_restore_outcome", () => ({
      tableId,
      stage: "exception",
      ok: false,
      reason: "restore_error",
      durationMs: Math.max(0, Date.now() - restoreStartedAtMs)
    }), { tableId });
    return { ok: false, reason: "restore_error" };
  }
}

function broadcastResyncRequired(tableId, reason) {
  const recipients = tableManager.orderedConnectionsForTable(tableId, (socket) => socket.__connState?.sessionId ?? "");
  for (const recipient of recipients) {
    const recipientConnState = recipient.__connState;
    if (!recipientConnState) continue;
    sendResumeRequired(recipient, recipientConnState, { tableId, reason, expectedSeq: 0 });
  }
}

function clearSettledRolloverTimer(tableId) {
  const existing = settledRolloverTimerByTableId.get(tableId);
  if (!existing) {
    return;
  }
  clearTimeout(existing.timer);
  settledRolloverTimerByTableId.delete(tableId);
}

function clearSettlementRevealDeadline(tableId) {
  settlementRevealDeadlineByTableId.delete(tableId);
}

function clearSnapshotCacheForTable(tableId) {
  for (const key of [...lastSnapshotBySessionAndTable.keys()]) {
    if (key.endsWith(`:${tableId}`)) {
      lastSnapshotBySessionAndTable.delete(key);
    }
  }
}

function clearPersistedSeatTouchForTable(tableId) {
  for (const key of [...persistedSeatTouchByTableUser.keys()]) {
    if (key.startsWith(`${tableId}:`)) {
      persistedSeatTouchByTableUser.delete(key);
    }
  }
}

function releaseTableRuntimeResources(tableId) {
  clearSettledRolloverTimer(tableId);
  clearSettlementRevealDeadline(tableId);
  clearTurnTimeoutFailureTracker(tableId);
  clearSnapshotCacheForTable(tableId);
  clearPersistedSeatTouchForTable(tableId);
  reactionTimers.clearTable(tableId);
  evaluatedSettlementReactionHandByTableId.delete(tableId);
  evaluatedAmbientReactionHandByTableId.delete(tableId);
  scheduledObservedBotTurnKeys.delete(tableId);
  suppressedBotTimeoutSafetyFailures.delete(tableId);
  pendingTableJanitorEvaluationByTableId.delete(tableId);
  suppressedNonRetryableTerminalJanitorFailuresByTableId.delete(tableId);
  guestDisconnectCleanupRuntime?.forgetTable(tableId);
  clearReactionTable(tableId);
  streamLog.forgetTable(tableId);
  continuousBotRetirementRequested.delete(tableId);
}

function shouldEvictClosedRuntimeTable(tableId, result) {
  const status = typeof result?.status === "string" ? result.status : null;
  const isClosedResult = result?.closed === true || status === "cleaned_closed" || status === "already_closed";
  if (!isClosedResult) {
    return false;
  }
  return tableManager.hasConnectedHumanPresence(tableId) !== true;
}

function shouldSyncCleanupRuntimeState(tableId, result) {
  if (result?.changed === true) {
    return true;
  }
  const status = typeof result?.status === "string" ? result.status : null;
  const isClosedResult = result?.closed === true || status === "cleaned_closed" || status === "already_closed";
  if (!isClosedResult) {
    return false;
  }
  return tableManager.isTableClosed(tableId) !== true || activeLobbyTablesById.has(tableId);
}

function evictClosedRuntimeTable({ tableId, logPrefix, status = null }) {
  const evicted = typeof tableManager?.evictTable === "function"
    ? tableManager.evictTable(tableId)
    : { ok: false, existed: false };
  const removedFromLobby = activeLobbyTablesById.delete(tableId);
  if (removedFromLobby || evicted?.existed === true) {
    maybeBroadcastLobbySnapshot({ force: true });
  }
  klogSafe(`${logPrefix}_evict_closed_success`, {
    tableId,
    status,
    evicted: evicted?.existed === true
  });
  return evicted;
}

async function syncCleanupRuntimeState({ tableId, result, logPrefix, onRestore = null }) {
  if (!shouldSyncCleanupRuntimeState(tableId, result)) {
    return { ok: true, changed: false, evicted: false, restored: false };
  }
  if (shouldEvictClosedRuntimeTable(tableId, result)) {
    evictClosedRuntimeTable({ tableId, logPrefix, status: result?.status || null });
    return { ok: true, changed: true, evicted: true, restored: false };
  }
  const restored = await restoreTableFromPersisted(tableId);
  if (!restored?.ok) {
    return { ok: false, changed: true, evicted: false, restored: false };
  }
  broadcastStateSnapshots(tableId);
  broadcastTableState(tableId);
  if (typeof onRestore === "function") {
    await onRestore();
  }
  return { ok: true, changed: true, evicted: false, restored: true };
}

async function applyInactiveCleanupAndBroadcast({ tableId, requestId, logPrefix }) {
  const executor = await loadInactiveCleanupExecutor();
  const result = await executor({
    tableId,
    userId: null,
    requestId
  });
  if (result?.ok !== true) {
    if (result?.retryable !== false) {
      klogSafe(`${logPrefix}_retry`, { tableId, code: result?.code || "unknown" });
    }
    return result;
  }
  if (shouldSyncCleanupRuntimeState(tableId, result)) {
    await syncCleanupRuntimeState({ tableId, result, logPrefix });
  }
  return result;
}

async function executeUserInactiveCleanupPrimitive({
  tableId,
  userId,
  requestId,
  commandName,
  dedupeKey,
  logPrefix,
  botTrigger,
  skipSocketCheck = false
}) {
  return enqueueTableCommand({
    tableId,
    commandName,
    dedupeKey,
    run: async () => {
      const tableMeta = tableManager.tableMeta(tableId);
      const managedContinuousTable = tableMeta?.lifecycleKind === "CONTINUOUS_BOT"
        && tableMeta?.managedProfileKey === "CONTINUOUS_BOT_DEFAULT";
      if (!skipSocketCheck) {
        const activeSockets = sessionStore.connectionsForUser(userId) || [];
        if (activeSockets.some((socket) => tableSocketMatches(socket, tableId))) {
          return { ok: true, changed: false, status: "socket_present" };
        }
      }
      if (!managedContinuousTable && await isSettledRevealPending(tableId)) {
        maybeScheduleSettledRollover(tableId);
        klogSafe(`${logPrefix}_settled_reveal_deferred`, {
          tableId,
          userId,
          revealMs: disconnectSettledRevealMs
        });
        return {
          ok: true,
          changed: false,
          deferred: true,
          status: "settled_reveal_pending",
          closed: false,
          retryable: true
        };
      }
      const executor = await loadInactiveCleanupExecutor();
      const result = await executor({ tableId, userId, requestId });
      if (result?.ok !== true) {
        if (result?.retryable !== false) {
          klogSafe(`${logPrefix}_retry`, { tableId, userId, code: result?.code || "unknown" });
        }
        return result;
      }
      if (result?.protected === true || result?.deferred === true) {
        return result;
      }
      if (shouldSyncCleanupRuntimeState(tableId, result)) {
        await syncCleanupRuntimeState({
          tableId,
          result,
          logPrefix,
          onRestore: async () => {
            try {
              scheduleBotStep({
                tableId,
                trigger: botTrigger,
                requestId: requestId || null,
                frameTs: null
              });
            } catch (error) {
              klogSafe(`${logPrefix}_schedule_bot_step_failed`, {
                tableId,
                userId,
                message: error?.message || "unknown"
              });
            }
          }
        });
        return result;
      }
      return result;
    }
  });
}

async function executeDisconnectCleanupPrimitive({ tableId, userId, requestId }) {
  return executeUserInactiveCleanupPrimitive({
    tableId,
    userId,
    requestId,
    commandName: "disconnect_cleanup",
    dedupeKey: `disconnect_cleanup:${userId}`,
    logPrefix: "ws_disconnect_cleanup",
    botTrigger: "disconnect_cleanup",
    skipSocketCheck: true
  });
}

async function executeStaleSeatCleanupPrimitive({ tableId, userId, requestId }) {
  return executeUserInactiveCleanupPrimitive({
    tableId,
    userId,
    requestId,
    commandName: "stale_active_seat_cleanup",
    dedupeKey: `stale_active_seat_cleanup:${userId}`,
    logPrefix: "ws_stale_seat_cleanup",
    botTrigger: "stale_active_seat_cleanup"
  });
}

async function executeTableInactiveCleanupPrimitive({
  tableId,
  requestId,
  commandName,
  dedupeKey,
  logPrefix,
  requireNoHumanPresence = false
}) {
  return enqueueTableCommand({
    tableId,
    commandName,
    dedupeKey,
    run: async () => {
      if (requireNoHumanPresence && tableManager.hasConnectedHumanPresence(tableId)) {
        return { ok: true, changed: false, status: "human_presence_present" };
      }
      return applyInactiveCleanupAndBroadcast({
        tableId,
        requestId,
        logPrefix
      });
    }
  });
}

async function executeZombieCleanupPrimitive({ tableId, requestId }) {
  return executeTableInactiveCleanupPrimitive({
    tableId,
    requestId,
    commandName: "zombie_cleanup",
    dedupeKey: "zombie_cleanup",
    logPrefix: "ws_zombie_cleanup",
    requireNoHumanPresence: true
  });
}

async function executeInactiveCleanupPrimitive({ tableId, requestId }) {
  return executeTableInactiveCleanupPrimitive({
    tableId,
    requestId,
    commandName: "table_inactive_cleanup",
    dedupeKey: "table_inactive_cleanup",
    logPrefix: "ws_table_inactive_cleanup"
  });
}

const tableJanitorPrimitives = {
  disconnect_cleanup: executeDisconnectCleanupPrimitive,
  stale_seat_cleanup: executeStaleSeatCleanupPrimitive,
  zombie_cleanup: executeZombieCleanupPrimitive,
  inactive_cleanup: executeInactiveCleanupPrimitive
};

function settledRolloverGenerationKey(tableId, pokerState = tableManager.persistedPokerState(tableId)) {
  if (!pokerState || pokerState.phase !== "SETTLED") {
    return null;
  }
  const version = tableManager.persistedStateVersion(tableId);
  const handId = typeof pokerState.handId === "string" && pokerState.handId.trim()
    ? pokerState.handId.trim()
    : "unknown";
  return `${tableId}:${Number.isInteger(version) ? version : "unknown"}:${handId}`;
}

function scheduleSettledRolloverTimer({ tableId, generationKey, dueAt, attempt = 0, mode = "reveal" }) {
  clearSettledRolloverTimer(tableId);
  const nowMs = Date.now();
  const delayMs = Math.max(0, dueAt - nowMs);
  klogVerbose("ws_settled_rollover_scheduled", () => ({
    tableId,
    delayMs,
    attempt,
    mode
  }), { tableId });
  const timer = setTimeout(() => {
    settledRolloverTimerByTableId.delete(tableId);
    void enqueueTableCommand({
      tableId,
      commandName: "settled_rollover",
      dedupeKey: "settled_rollover",
      run: () => runSettledRolloverCommand({ tableId, generationKey, attempt })
    });
  }, delayMs);
  if (typeof timer?.unref === "function") {
    timer.unref();
  }
  settledRolloverTimerByTableId.set(tableId, { timer, dueAt, generationKey, attempt, mode });
}

function scheduleSettledRolloverRetry({ tableId, generationKey, attempt }) {
  const pokerState = tableManager.persistedPokerState(tableId);
  if (settledRolloverGenerationKey(tableId, pokerState) !== generationKey) {
    return;
  }
  const fastDelay = FAST_SETTLED_ROLLOVER_RETRY_DELAYS_MS[attempt - 1];
  const delayMs = Number.isFinite(fastDelay) ? fastDelay : SLOW_SETTLED_ROLLOVER_RETRY_MS;
  scheduleSettledRolloverTimer({
    tableId,
    generationKey,
    dueAt: Date.now() + delayMs,
    attempt,
    mode: Number.isFinite(fastDelay) ? "fast_retry" : "slow_retry"
  });
}

async function runSettledRolloverCommand({ tableId, generationKey, attempt = 0 }) {
  const rolloverStartedAtMs = pokerLogRuntimeControl.mayBuildDebugPayload("ws_settled_rollover_start", { tableId }) ? Date.now() : null;
  const finishSettledRollover = (result) => {
    klogVerbose("ws_settled_rollover_outcome", () => ({
      tableId,
      attempt,
      ok: result?.ok !== false,
      changed: result?.changed === true,
      closed: result?.closed === true,
      reason: result?.reason || result?.code || result?.status || (result?.changed === true ? "changed" : "unchanged"),
      durationMs: Math.max(0, Date.now() - rolloverStartedAtMs)
    }), { tableId });
    return result;
  };
  let pokerState = tableManager.persistedPokerState(tableId);
  if (settledRolloverGenerationKey(tableId, pokerState) !== generationKey) {
    return finishSettledRollover({ ok: true, changed: false, reason: "settled_generation_changed" });
  }
  klogVerbose("ws_settled_rollover_start", () => ({ tableId, attempt }), { tableId });
  if (!isGuestTableId(tableId) && hasSupabaseDbUrl) {
    const finalizeDeferredLeaves = await loadDeferredLeaveFinalizer();
    const finalized = await finalizeDeferredLeaves({ tableId });
    if (finalized?.ok !== true) {
      klogSafe("ws_settled_rollover_deferred_leave_failed", {
        tableId,
        code: finalized?.code || "unknown",
        retryable: finalized?.retryable !== false,
      });
      if (finalized?.retryable !== false) {
        scheduleSettledRolloverRetry({ tableId, generationKey, attempt: attempt + 1 });
      }
      return finishSettledRollover(finalized);
    }
    if (finalized.changed === true || finalized.closed === true) {
      const synced = await syncCleanupRuntimeState({
        tableId,
        result: finalized,
        logPrefix: "ws_settled_rollover_deferred_leave",
      });
      if (!synced?.ok) {
        scheduleSettledRolloverRetry({ tableId, generationKey, attempt: attempt + 1 });
        return finishSettledRollover({ ok: false, changed: true, code: "runtime_restore_failed", retryable: true });
      }
      if (finalized.closed === true) return finishSettledRollover(finalized);
      pokerState = tableManager.persistedPokerState(tableId);
      if (!pokerState || pokerState.phase !== "SETTLED") {
        return finishSettledRollover({ ok: true, changed: true, reason: "deferred_leave_state_changed" });
      }
    }
  }
  const tableMeta = tableManager.tableMeta(tableId);
  const managedContinuousTable = tableMeta?.lifecycleKind === "CONTINUOUS_BOT"
    && tableMeta?.managedProfileKey === "CONTINUOUS_BOT_DEFAULT";
  if (!managedContinuousTable && !tableManager.hasActiveHumanMember(tableId)) {
    if (tableManager.hasConnectedHumanPresence(tableId)) {
      klogSafe("ws_settled_rollover_close_skipped_human_presence", { tableId, phase: pokerState?.phase || null });
      return finishSettledRollover({ ok: true, changed: false, deferred: true, reason: "human_presence_present" });
    }
    const cleanupResult = await applyInactiveCleanupAndBroadcast({
      tableId,
      requestId: `ws-settled-rollover-close:${tableId}`,
      logPrefix: "ws_settled_rollover_close"
    });
    return finishSettledRollover(cleanupResult);
  }
  const rotation = await handleContinuousBotRotationAtSettled({
    tableId,
    tableMeta,
    phase: pokerState?.phase,
    tableManager,
    continuousBotTableRepository,
    applyInactiveCleanupAndBroadcast,
    scheduleSettledRolloverRetry,
    generationKey,
    attempt,
    klog: klogSafe
  });
  if (rotation.handled) {
    return finishSettledRollover(rotation.result);
  }

  if (isGuestTableId(tableId)) {
    const guestRollover = tableManager.rolloverSettledHand({ tableId, nowMs: Date.now(), economyMode: "none" });
    if (!guestRollover?.ok || !guestRollover.changed) {
      return finishSettledRollover(guestRollover);
    }
    broadcastStateSnapshots(tableId);
    try {
      scheduleBotStep({ tableId, trigger: "settled_rollover", requestId: null, frameTs: null });
    } catch (error) {
      klogSafe("ws_settled_rollover_bot_autoplay_failed", { tableId, message: error?.message || "unknown" });
    }
    return finishSettledRollover(guestRollover);
  }

  const managedBotProfile = managedContinuousTable ? continuousBotTableRepository?.currentProfile() : null;
  if (managedContinuousTable && !managedBotProfile) {
    scheduleSettledRolloverRetry({ tableId, generationKey, attempt: attempt + 1 });
    return finishSettledRollover({ ok: false, changed: false, reason: "managed_profile_unavailable" });
  }
  const prepared = tableManager.prepareSettledHandRollover({
    tableId,
    nowMs: Date.now(),
    allowManagedBotsOnly: managedContinuousTable,
    managedBotProfile
  });
  if (!prepared?.ok || !prepared.changed) {
    return finishSettledRollover(prepared);
  }

  const candidatePokerState = prepared.nextCoreState?.pokerState;
  const persisted = await persistMutatedState({
    tableId,
    expectedVersion: prepared.expectedVersion,
    mutationKind: "settled_rollover",
    nextStateOverride: candidatePokerState,
    privateStateForHoleCardsOverride: candidatePokerState,
    replacementFundings: prepared.replacementFundings,
    managedBotTopUps: prepared.managedBotTopUps,
    humanStackUpdates: prepared.humanStackUpdates,
    replacementFundingSystemKey: botFundingSystemKey,
    deferRuntimeVersionUpdate: true
  });
  if (!persisted?.ok || persisted.alreadyApplied) {
    const replacementSeatConflict = isManagedReplacementSeatProjectionConflict({
      managedContinuousTable,
      replacementFundingCount: prepared.replacementFundings.length,
      persisted
    });
    if (replacementSeatConflict) {
      const retirement = await retireManagedTableAfterReplacementConflict({
        tableId,
        generationKey,
        attempt
      });
      if (retirement?.ok === true) {
        return finishSettledRollover(retirement);
      }
    }
    if (!persisted?.alreadyApplied) {
      klogSafe("ws_settled_rollover_persist_failed", {
        tableId,
        reason: persisted?.reason || "persist_failed",
        stateVersion: prepared.stateVersion,
        replacementCount: prepared.replacementFundings.length,
        totalFundingDelta: prepared.replacementFundings.reduce((sum, entry) => sum + entry.fundingDelta, 0)
      });
    }
    await recoverFromPersistConflict({
      tableId,
      restoreTableFromPersisted,
      broadcastStateSnapshots,
      broadcastResyncRequired
    });
    if (persisted?.alreadyApplied) {
      try {
        scheduleBotStep({ tableId, trigger: "settled_rollover_restore", requestId: null, frameTs: null });
      } catch (error) {
        klogSafe("ws_settled_rollover_bot_autoplay_failed", { tableId, message: error?.message || "unknown" });
      }
    }
    if (!persisted?.alreadyApplied) {
      scheduleSettledRolloverRetry({ tableId, generationKey, attempt: attempt + 1 });
    }
    return finishSettledRollover({
      ok: Boolean(persisted?.alreadyApplied),
      changed: false,
      reason: persisted?.alreadyApplied ? "already_applied_restored" : (persisted?.reason || "persist_failed"),
      stateVersion: prepared.stateVersion
    });
  }

  const rollover = tableManager.commitSettledHandRollover({
    tableId,
    expectedVersion: prepared.expectedVersion,
    nextCoreState: prepared.nextCoreState,
    replacementFundings: prepared.replacementFundings,
    managedBotTopUps: prepared.managedBotTopUps,
    managedBotProfile,
    humanStackUpdates: prepared.humanStackUpdates,
    persistenceReceipt: persisted,
    nowMs: Date.now()
  });
  if (!rollover?.ok) {
    await restoreTableFromPersisted(tableId);
    broadcastStateSnapshots(tableId);
    try {
      scheduleBotStep({ tableId, trigger: "settled_rollover_commit_restore", requestId: null, frameTs: null });
    } catch (error) {
      klogSafe("ws_settled_rollover_bot_autoplay_failed", { tableId, message: error?.message || "unknown" });
    }
    return finishSettledRollover(rollover);
  }

  tableManager.setPersistedStateVersion(tableId, persisted.newVersion);
  broadcastStateSnapshots(tableId);
  try {
    scheduleBotStep({ tableId, trigger: "settled_rollover", requestId: null, frameTs: null });
  } catch (error) {
    klogSafe("ws_settled_rollover_bot_autoplay_failed", { tableId, message: error?.message || "unknown" });
  }
  return finishSettledRollover(rollover);
}

function maybeScheduleSettledRollover(tableId, preparedDueAt = null) {
  const pokerState = tableManager.persistedPokerState(tableId);
  if (!pokerState || pokerState.phase !== "SETTLED") {
    clearSettledRolloverTimer(tableId);
    clearSettlementRevealDeadline(tableId);
    return;
  }

  const dueAt = Number.isSafeInteger(preparedDueAt)
    ? preparedDueAt
    : resolvePublishedSettlementRevealDueAtForTable(tableId);
  if (!Number.isSafeInteger(dueAt)) {
    clearSettledRolloverTimer(tableId);
    return;
  }
  const generationKey = settledRolloverGenerationKey(tableId, pokerState);
  const existing = settledRolloverTimerByTableId.get(tableId);
  if (existing && existing.generationKey === generationKey && existing.dueAt === dueAt) {
    return;
  }
  scheduleSettledRolloverTimer({ tableId, generationKey, dueAt });
}

function isSettledRevealPendingForState(pokerState, nowMs = Date.now()) {
  if (disconnectSettledRevealMs <= 0) {
    return false;
  }
  if (!pokerState || pokerState.phase !== "SETTLED") {
    return false;
  }
  const settledAt = pokerState?.handSettlement?.settledAt;
  if (typeof settledAt !== "string" || !settledAt.trim()) {
    return false;
  }
  const dueAt = resolveSettledRevealDueAt({
    settledAt,
    nowMs,
    revealMs: disconnectSettledRevealMs
  });
  return dueAt > nowMs;
}

function isValidTargetedSettlementTimestamp(settledAt, nowMs = Date.now()) {
  if (typeof settledAt !== "string" || !settledAt.trim()) return false;
  const settledAtMs = Date.parse(settledAt);
  return Number.isFinite(settledAtMs) && settledAtMs <= nowMs + 1_000;
}

function resolveSettledHandId(pokerState) {
  const stateHandId = typeof pokerState?.handId === "string" ? pokerState.handId.trim() : "";
  const settlementHandId = typeof pokerState?.handSettlement?.handId === "string"
    ? pokerState.handSettlement.handId.trim()
    : "";
  if (stateHandId && settlementHandId && stateHandId !== settlementHandId) return null;
  return stateHandId || settlementHandId || null;
}

function preparePublishedSettlementReveal(tableId, tableSnapshot, nowMs = Date.now()) {
  if (!tableSnapshot || tableSnapshot.tableId !== tableId) {
    return null;
  }
  const handStatus = tableSnapshot?.hand?.status;
  const handId = typeof tableSnapshot?.hand?.handId === "string"
    ? tableSnapshot.hand.handId.trim()
    : "";
  const showdownHandId = typeof tableSnapshot?.showdown?.handId === "string"
    ? tableSnapshot.showdown.handId.trim()
    : "";
  const settlementHandId = typeof tableSnapshot?.handSettlement?.handId === "string"
    ? tableSnapshot.handSettlement.handId.trim()
    : "";
  if (handStatus !== "SETTLED" || !handId || !showdownHandId || !settlementHandId
    || handId !== showdownHandId || handId !== settlementHandId
    || !isValidTargetedSettlementTimestamp(tableSnapshot?.handSettlement?.settledAt, nowMs)) {
    return null;
  }
  const existing = settlementRevealDeadlineByTableId.get(tableId);
  if (handId && existing?.handId === handId && Number.isSafeInteger(existing.dueAt)) {
    return { handId, dueAt: existing.dueAt };
  }
  const dueAt = nowMs + settledRevealMs;
  settlementRevealDeadlineByTableId.set(tableId, { handId, dueAt });
  return { handId, dueAt };
}

function resolvePublishedSettlementRevealDueAtForTable(tableId) {
  const pokerState = tableManager.persistedPokerState(tableId);
  if (!pokerState || pokerState.phase !== "SETTLED") {
    clearSettlementRevealDeadline(tableId);
    return null;
  }
  const handId = resolveSettledHandId(pokerState);
  const existing = settlementRevealDeadlineByTableId.get(tableId);
  if (handId && existing?.handId === handId && Number.isSafeInteger(existing.dueAt)) {
    return existing.dueAt;
  }
  return null;
}

function isPublishedSettlementRevealPendingForTable(tableId, nowMs = Date.now()) {
  const pokerState = tableManager.persistedPokerState(tableId);
  const handId = resolveSettledHandId(pokerState);
  const entry = settlementRevealDeadlineByTableId.get(tableId);
  return pokerState?.phase === "SETTLED"
    && !!handId
    && entry?.handId === handId
    && Number.isSafeInteger(entry.dueAt)
    && entry.dueAt > nowMs;
}

function normalizeTargetReactionUserIds(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const result = [];
  const seen = new Set();
  for (const rawUserId of value) {
    const userId = typeof rawUserId === "string" ? rawUserId.trim() : "";
    if (!userId || seen.has(userId)) return null;
    seen.add(userId);
    result.push(userId);
  }
  return result;
}

function collectTargetableWinnerUserIds(showdown) {
  if (!showdown || typeof showdown !== "object" || Array.isArray(showdown)) return null;
  const reason = typeof showdown.reason === "string" ? showdown.reason.trim().toLowerCase() : "";
  const pots = showdown.potsAwarded;
  if ((reason !== "all_folded" && reason !== "computed") || !Array.isArray(pots) || pots.length === 0) return null;
  if (reason === "all_folded" && pots.length !== 1) return null;

  const targetableWinnerUserIds = new Set();
  for (let potIndex = 0; potIndex < pots.length; potIndex += 1) {
    const pot = pots[potIndex];
    if (!pot || typeof pot !== "object" || Array.isArray(pot)) return null;
    if (!Number.isSafeInteger(pot.amount) || pot.amount < 0) return null;
    const winners = normalizeTargetReactionUserIds(pot.winners);
    const eligibleUserIds = normalizeTargetReactionUserIds(pot.eligibleUserIds);
    if (!winners || !eligibleUserIds || winners.some((userId) => !eligibleUserIds.includes(userId))) return null;

    let kind = null;
    if (reason === "all_folded") {
      if (potIndex === 0
        && eligibleUserIds.length === 1
        && winners.length === 1
        && eligibleUserIds[0] === winners[0]) {
        kind = "main";
      }
    } else if (potIndex === 0) {
      if (eligibleUserIds.length >= 2) kind = "main";
    } else if (eligibleUserIds.length >= 2) {
      kind = "side";
    } else if (eligibleUserIds.length === 1 && winners.length === 1 && eligibleUserIds[0] === winners[0]) {
      kind = "return";
    }
    if (!kind) return null;
    if (kind === "main" || kind === "side") {
      winners.forEach((userId) => targetableWinnerUserIds.add(userId));
    }
  }
  return targetableWinnerUserIds;
}

async function isSettledRevealPending(tableId, nowMs = Date.now()) {
  const runtimeState = tableManager.persistedPokerState(tableId);
  if (isSettledRevealPendingForState(runtimeState, nowMs)) {
    return true;
  }
  if (typeof loadPersistedTableBootstrap !== "function") {
    return false;
  }
  try {
    const loaded = await loadPersistedTableBootstrap({ tableId });
    const persistedState = loaded?.table?.coreState?.pokerState;
    const pending = isSettledRevealPendingForState(persistedState, nowMs);
    if (runtimeState?.phase === "SETTLED" || persistedState?.phase === "SETTLED") {
      klogSafe("ws_settled_reveal_pending_check", {
        tableId,
        loadedOk: loaded?.ok === true,
        runtimePhase: runtimeState?.phase || null,
        persistedPhase: persistedState?.phase || null,
        persistedSettledAt: persistedState?.handSettlement?.settledAt || null,
        pending
      });
    }
    return pending;
  } catch (error) {
    klogSafe("ws_settled_reveal_pending_check_failed", {
      tableId,
      message: error?.message || "unknown"
    });
    return false;
  }
}

function broadcastStateSnapshots(tableId) {
  maybeBroadcastLobbySnapshot();
  const publicationSnapshot = tableManager.tableSnapshot(tableId, null);
  const preparedReveal = preparePublishedSettlementReveal(tableId, publicationSnapshot);
  maybeScheduleSettledRollover(tableId, preparedReveal?.dueAt ?? null);
  const recipients = tableManager.orderedConnectionsForTable(tableId, (socket) => socket.__connState?.sessionId ?? "");
  for (const recipient of recipients) {
    const recipientConnState = recipient.__connState;
    if (!recipientConnState) {
      continue;
    }
    const tableSnapshot = tableManager.tableSnapshot(tableId, recipientConnState.session.userId);
    sendStateSnapshot(recipient, recipientConnState, { tableSnapshot });
  }
}

function broadcastTableReaction(tableId, { seatNo, targetSeatNo, reactionKey } = {}) {
  const recipients = tableManager.orderedConnectionsForTable(tableId, (socket) => socket.__connState?.sessionId ?? "");
  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const recipient of recipients) {
    const recipientConnState = recipient?.__connState;
    if (!recipientConnState || recipient.readyState !== WebSocket.OPEN) {
      skippedCount += 1;
      continue;
    }

    try {
      sendFrame(recipient, {
        version: "1.0",
        type: "table_reaction",
        ts: nowTs(),
        roomId: tableId,
        sessionId: recipientConnState.sessionId,
        payload: {
          seatNo,
          ...(Number.isInteger(targetSeatNo) ? { targetSeatNo } : {}),
          reactionKey
        }
      });
      sentCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  if (failedCount > 0) {
    klogSafe("ws_table_reaction_broadcast_failed", {
      tableId,
      recipientCount: recipients.length,
      sentCount,
      skippedCount,
      failedCount
    });
  }

  return { sentCount, skippedCount, failedCount };
}

function sweepExpiredSessionsOnly() {
  const nowMs = Date.now();
  const expiredSessionIds = sessionStore.sweepExpiredSessions({ nowMs });
  for (const sessionId of expiredSessionIds) {
    for (const key of [...lastSnapshotBySessionAndTable.keys()]) {
      if (key.startsWith(`${sessionId}:`)) {
        lastSnapshotBySessionAndTable.delete(key);
      }
    }
  }
}

const disconnectCleanupRuntime = createDisconnectCleanupRuntime({
  executeCleanup: async ({ tableId, userId, requestId }) => {
    return runTableJanitor({
      classification: {
        tableId,
        healthy: false,
        classification: "disconnect_cleanup",
        action: "disconnect_cleanup",
        reasonCode: "disconnect_candidate",
        concerns: [],
        userId
      },
      trigger: "disconnect_cleanup",
      requestId,
      primitives: tableJanitorPrimitives,
      klog: klogSafe,
      klogVerbose
    });
  },
  listActiveSocketsForUser: (userId) => sessionStore.connectionsForUser(userId),
  socketMatchesTable: (socket, tableId) => tableSocketMatches(socket, tableId),
  seatedReconnectGraceMs,
  onChanged: async () => {},
  klog: klogSafe
});

async function evictDisconnectedGuestTable({ tableId, userId, requestId }) {
  return enqueueTableCommand({
    tableId,
    commandName: "guest_disconnect_cleanup",
    dedupeKey: "guest_disconnect_cleanup",
    run: async () => {
      if (!isGuestTableId(tableId)) {
        return { ok: false, changed: false, retryable: false, code: "not_guest_table" };
      }
      if (!tableManager.listTableIds().includes(tableId)) {
        return { ok: true, changed: false, closed: true, status: "already_evicted" };
      }
      const hasLiveSocket = sessionStore.connectionsForUser(userId)
        .some((socket) => tableSocketMatches(socket, tableId));
      if (hasLiveSocket || tableManager.hasConnectedHumanPresence(tableId)) {
        return { ok: true, changed: false, status: "guest_reconnected" };
      }
      const evicted = tableManager.evictTable(tableId);
      klogSafe("ws_guest_table_evicted", {
        tableId,
        trigger: "disconnect_cleanup",
        requestId,
        evicted: evicted?.existed === true
      });
      return {
        ok: true,
        changed: evicted?.existed === true,
        closed: true,
        status: evicted?.existed === true ? "guest_evicted" : "already_evicted"
      };
    }
  });
}

const guestDisconnectCleanupRuntime = createDisconnectCleanupRuntime({
  executeCleanup: evictDisconnectedGuestTable,
  listActiveSocketsForUser: (userId) => sessionStore.connectionsForUser(userId),
  socketMatchesTable: (socket, tableId) => tableSocketMatches(socket, tableId),
  seatedReconnectGraceMs,
  onChanged: async () => {},
  onCancelled: ({ tableId }) => {
    klogSafe("ws_guest_table_cleanup_cancelled", {
      tableId,
      reason: "active_socket"
    });
  },
  klog: klogSafe
});

function enqueueDisconnectCleanupCandidate({ tableId, userId }) {
  if (typeof userId !== "string" || !userId) return;
  if (isGuestTableId(tableId)) {
    const enqueued = guestDisconnectCleanupRuntime.enqueue({ tableId, userId });
    if (enqueued) {
      klogSafe("ws_guest_table_cleanup_scheduled", {
        tableId,
        graceMs: seatedReconnectGraceMs
      });
    }
    return;
  }
  // When DB-backed persistence is active, persisted tables always have UUID
  // IDs. Guest and other non-persisted tables use prefixed string IDs that
  // cannot target DB-backed cleanup. Filter them out to prevent 22P02 failures.
  if (hasSupabaseDbUrl) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (typeof tableId !== "string" || !UUID_RE.test(tableId)) return;
  }
  disconnectCleanupRuntime.enqueue({ tableId, userId });
}

function normalizeTurnTimeoutReason(reason) {
  if (typeof reason !== "string") return "";
  return reason.trim().toLowerCase();
}

function isFatalTurnTimeoutReason(reason) {
  const normalized = normalizeTurnTimeoutReason(reason);
  if (!normalized) return false;
  if (TURN_TIMEOUT_FATAL_REASONS.has(normalized)) return true;
  return TURN_TIMEOUT_FATAL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isTurnTimeoutTableQuarantined(tableId, nowMs = Date.now()) {
  const entry = timeoutFailureTrackerByTableId.get(tableId);
  if (!entry || !Number.isFinite(Number(entry.quarantinedUntil))) return false;
  if (nowMs >= Number(entry.quarantinedUntil)) {
    timeoutFailureTrackerByTableId.delete(tableId);
    return false;
  }
  return true;
}

function clearTurnTimeoutFailureTracker(tableId) {
  if (timeoutFailureTrackerByTableId.has(tableId)) {
    timeoutFailureTrackerByTableId.delete(tableId);
  }
}

async function forceTableToHandDoneFromPersisted({ tableId, nowMs }) {
  if (!persistedBootstrapEnabled) {
    return { ok: false, reason: "persisted_bootstrap_disabled" };
  }
  if (!persistedStateWriter) {
    return { ok: false, reason: "persisted_state_write_disabled" };
  }
  try {
    const beginSqlWs = await loadBeginSqlWs();
    const loaded = await beginSqlWs(async (tx) => {
      const stateRows = await tx.unsafe("select version, state from public.poker_state where table_id = $1 limit 1;", [tableId]);
      const stateRow = stateRows?.[0] || null;
      if (!stateRow) {
        return { ok: false, reason: "state_missing" };
      }
      const expectedVersion = Number(stateRow.version);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
        return { ok: false, reason: "state_invalid" };
      }

      const rawState = stateRow.state;
      let currentState;
      if (typeof rawState === "string") {
        try {
          currentState = JSON.parse(rawState);
        } catch {
          return { ok: false, reason: "state_invalid" };
        }
      } else {
        currentState = rawState;
      }
      if (!currentState || typeof currentState !== "object" || Array.isArray(currentState)) {
        return { ok: false, reason: "state_invalid" };
      }

      const nextState = {
        ...currentState,
        phase: "HAND_DONE",
        turnUserId: null,
        turnStartedAt: null,
        turnDeadlineAt: null,
        pendingAutoStartAt: null
      };
      return { ok: true, expectedVersion, nextState };
    }, { env: process.env });
    if (!loaded?.ok) return loaded;

    return persistedStateWriter.writeMutation({
      tableId,
      expectedVersion: loaded.expectedVersion,
      nextState: loaded.nextState,
      meta: { mutationKind: "quarantine_force_hand_done", nowMs }
    });
  } catch (error) {
    klogSafe("ws_turn_timeout_quarantine_force_hand_done_failed", {
      tableId,
      nowMs,
      message: error?.message || "unknown"
    });
    return { ok: false, reason: "db_error" };
  }
}

async function quarantineTurnTimeoutTable({ tableId, reason, nowMs }) {
  const existing = timeoutFailureTrackerByTableId.get(tableId) || {};
  const quarantineUntil = nowMs + turnTimeoutQuarantineMs;
  timeoutFailureTrackerByTableId.set(tableId, {
    ...existing,
    count: Number(existing.count) || 0,
    lastReason: reason || null,
    lastFailureAt: nowMs,
    quarantinedUntil: quarantineUntil
  });

  klogSafe("ws_turn_timeout_table_quarantined", {
    tableId,
    reason: reason || "unknown",
    quarantineMs: turnTimeoutQuarantineMs,
    quarantineUntil
  });

  try {
    const executor = await loadInactiveCleanupExecutor();
    const cleanupResult = await executor({
      tableId,
      userId: null,
      requestId: `ws-timeout-quarantine:${tableId}:${nowMs}`
    });
    if (cleanupResult?.ok === true && shouldSyncCleanupRuntimeState(tableId, cleanupResult)) {
      const synced = await syncCleanupRuntimeState({
        tableId,
        result: cleanupResult,
        logPrefix: "ws_turn_timeout_quarantine_cleanup"
      });
      if (synced?.ok === true) {
        clearTurnTimeoutFailureTracker(tableId);
        klogSafe("ws_turn_timeout_quarantine_recovered", { tableId, mode: "inactive_cleanup" });
        return;
      }
    }
  } catch (error) {
    klogSafe("ws_turn_timeout_quarantine_cleanup_failed", {
      tableId,
      message: error?.message || "unknown"
    });
  }

  const forced = await forceTableToHandDoneFromPersisted({ tableId, nowMs });
  if (!forced?.ok) {
    klogSafe("ws_turn_timeout_quarantine_force_hand_done_skipped", {
      tableId,
      reason: forced?.reason || "unknown"
    });
    return;
  }
  const restored = await restoreTableFromPersisted(tableId);
  if (!restored?.ok) {
    klogSafe("ws_turn_timeout_quarantine_restore_failed", { tableId, reason: restored?.reason || "unknown" });
    return;
  }
  broadcastStateSnapshots(tableId);
  broadcastTableState(tableId);
  clearTurnTimeoutFailureTracker(tableId);
  klogSafe("ws_turn_timeout_quarantine_recovered", { tableId, mode: "force_hand_done" });
}

async function recordTurnTimeoutOutcome({ tableId, result, nowMs }) {
  const tableClosed = tableManager.isTableClosed(tableId) === true;
  if (tableClosed) {
    clearTurnTimeoutFailureTracker(tableId);
    return;
  }
  if (result?.ok === true) {
    clearTurnTimeoutFailureTracker(tableId);
    return;
  }
  const reason = result?.reason || "timeout_apply_failed";
  if (!isFatalTurnTimeoutReason(reason)) {
    return;
  }
  const existing = timeoutFailureTrackerByTableId.get(tableId) || {};
  const nextCount = (Number(existing.count) || 0) + 1;
  timeoutFailureTrackerByTableId.set(tableId, {
    ...existing,
    count: nextCount,
    lastReason: reason,
    lastFailureAt: nowMs,
    quarantinedUntil: Number(existing.quarantinedUntil) || null
  });
  if (nextCount < turnTimeoutFailureThreshold) {
    return;
  }
  if (isTurnTimeoutTableQuarantined(tableId, nowMs)) {
    return;
  }
  await quarantineTurnTimeoutTable({ tableId, reason, nowMs });
}

async function sweepDisconnectCleanupAndBroadcast() {
  await disconnectCleanupRuntime.sweep();
  await guestDisconnectCleanupRuntime.sweep();
}

async function listStaleActiveHumanSeatCandidates({ limit = 25 } = {}) {
  if (!persistedBootstrapEnabled) return [];
  const boundedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 25;
  const cutoffIso = new Date(Date.now() - activeSeatFreshMs).toISOString();
  try {
    const beginSqlWs = await loadBeginSqlWs();
    return await beginSqlWs(async (tx) => {
      const rows = await tx.unsafe(
        `select s.table_id, s.user_id
         from public.poker_seats s
         join public.poker_tables t on t.id = s.table_id
         where t.status = 'OPEN'
           and s.status = 'ACTIVE'
           and coalesce(s.is_bot, false) = false
           and coalesce(s.last_seen_at, to_timestamp(0)) < $1::timestamptz
         order by s.last_seen_at asc nulls first, t.updated_at asc
         limit $2;`,
        [cutoffIso, boundedLimit]
      );
      if (!Array.isArray(rows)) return [];
      return rows
        .map((row) => ({
          tableId: typeof row?.table_id === "string" ? row.table_id : "",
          userId: typeof row?.user_id === "string" ? row.user_id : ""
        }))
        .filter((row) => row.tableId && row.userId);
    }, { env: process.env });
  } catch (error) {
    klogSafe("ws_stale_seat_cleanup_list_failed", { message: error?.message || "unknown" });
    return [];
  }
}

async function loadPersistedTableHealthSnapshot(tableId) {
  if (!persistedBootstrapEnabled) return null;
  try {
    const beginSqlWs = await loadBeginSqlWs();
    return beginSqlWs(async (tx) => {
      const tableRows = await tx.unsafe(
        "select id, status, created_at, updated_at, last_activity_at, lifecycle_kind, managed_profile_key, rotation_due_at from public.poker_tables where id = $1 limit 1;",
        [tableId]
      );
      const seatRows = await tx.unsafe(
        "select user_id, seat_no, status, is_bot, stack, last_seen_at from public.poker_seats where table_id = $1 order by seat_no asc;",
        [tableId]
      );
      const stateRows = await tx.unsafe(
        "select version, state from public.poker_state where table_id = $1 limit 1;",
        [tableId]
      );
      return {
        table: tableRows?.[0] || null,
        seats: Array.isArray(seatRows) ? seatRows : [],
        stateVersion: Number.isInteger(Number(stateRows?.[0]?.version)) ? Number(stateRows[0].version) : null,
        state: stateRows?.[0]?.state ?? null
      };
    }, { env: process.env });
  } catch (error) {
    klogSafe("ws_table_janitor_snapshot_failed", {
      tableId,
      message: error?.message || "unknown"
    });
    return null;
  }
}

function buildTableJanitorRuntimeContext(tableId, persistedSeats = []) {
  const loaded = tableManager.listTableIds().includes(tableId);
  const connectedUserIds = new Set();
  if (loaded && typeof tableManager.orderedConnectionsForTable === "function") {
    const sockets = tableManager.orderedConnectionsForTable(tableId, (socket) => {
      const userId = socket?.__connState?.session?.userId;
      return typeof userId === "string" ? userId : "";
    });
    for (const socket of sockets) {
      if (socket?.__connState?.sessionInvalidated === true) continue;
      const userId = socket?.__connState?.session?.userId;
      if (typeof userId === "string" && userId.trim()) {
        connectedUserIds.add(userId.trim());
      }
    }
  }
  for (const seat of persistedSeats || []) {
    if (seat?.is_bot === true) continue;
    const userId = typeof seat?.user_id === "string" ? seat.user_id.trim() : "";
    if (!userId) continue;
    const activeSockets = sessionStore.connectionsForUser(userId) || [];
    if (activeSockets.some((socket) => tableSocketMatches(socket, tableId))) {
      connectedUserIds.add(userId);
    }
  }
  return {
    loaded,
    tableStatus: loaded ? (tableManager.isTableClosed(tableId) ? "CLOSED" : "OPEN") : null,
    hasConnectedHumanPresence: tableManager.hasConnectedHumanPresence(tableId),
    connectedUserIds: [...connectedUserIds]
  };
}

async function evaluateTableForJanitor(tableId) {
  const persistedHealth = await loadPersistedTableHealthSnapshot(tableId);
  if (!persistedHealth?.table) {
    return {
      result: {
        ok: true,
        changed: false,
        skipped: true,
        status: "table_missing"
      }
    };
  }
  const classification = evaluateTableHealth({
    tableId,
    persistedTable: persistedHealth.table,
    persistedSeats: persistedHealth.seats,
    persistedState: persistedHealth.state,
    runtime: buildTableJanitorRuntimeContext(tableId, persistedHealth.seats),
    nowMs: Date.now(),
    activeSeatFreshMs,
    seatedReconnectGraceMs,
    tableCloseGraceMs: lobbyEmptyJoinableGraceMs,
    liveHandStaleMs: janitorLiveHandStaleMs
  });
  return {
    classification,
    suppressionContext: {
      tableId,
      stateVersion: persistedHealth.stateVersion,
      tableStatus: typeof persistedHealth.table?.status === "string"
        ? persistedHealth.table.status.trim().toUpperCase()
        : "",
      handId: typeof persistedHealth.state?.handId === "string" ? persistedHealth.state.handId.trim() : "",
      phase: typeof persistedHealth.state?.phase === "string" ? persistedHealth.state.phase.trim() : ""
    }
  };
}

function suppressedTerminalJanitorResult({ trigger, classification, suppressionContext }) {
  if (!AUTOMATIC_TABLE_JANITOR_TRIGGERS.has(trigger)) return null;
  const tableId = suppressionContext?.tableId;
  const existing = suppressedNonRetryableTerminalJanitorFailuresByTableId.get(tableId);
  if (!existing) return null;
  if (!matchesNonRetryableTerminalJanitorSuppression(existing, {
    ...suppressionContext,
    classification,
    nowMs: Date.now()
  })) {
    suppressedNonRetryableTerminalJanitorFailuresByTableId.delete(tableId);
    return null;
  }
  suppressedTerminalJanitorCountsByReason.set(
    existing.reason,
    (suppressedTerminalJanitorCountsByReason.get(existing.reason) || 0) + 1
  );
  return {
    ok: false,
    changed: false,
    closed: false,
    retryable: false,
    suppressed: true,
    code: existing.code,
    reason: existing.reason,
    status: "same_state_terminal_failure_suppressed"
  };
}

function rememberNonRetryableTerminalJanitorFailure({
  trigger,
  classification,
  suppressionContext,
  result
}) {
  if (!AUTOMATIC_TABLE_JANITOR_TRIGGERS.has(trigger)) return;
  const suppression = createNonRetryableTerminalJanitorSuppression({
    ...suppressionContext,
    classification,
    result,
    nowMs: Date.now(),
    ttlMs: TERMINAL_JANITOR_SUPPRESSION_TTL_MS
  });
  if (!suppression) return;
  const existing = suppressedNonRetryableTerminalJanitorFailuresByTableId.get(suppression.tableId);
  if (existing && matchesNonRetryableTerminalJanitorSuppression(existing, {
    ...suppressionContext,
    classification,
    nowMs: Date.now()
  })) {
    return;
  }
  if (
    !suppressedNonRetryableTerminalJanitorFailuresByTableId.has(suppression.tableId)
    && suppressedNonRetryableTerminalJanitorFailuresByTableId.size >= TERMINAL_JANITOR_SUPPRESSION_MAX
  ) {
    const oldestTableId = suppressedNonRetryableTerminalJanitorFailuresByTableId.keys().next().value;
    if (oldestTableId) {
      suppressedNonRetryableTerminalJanitorFailuresByTableId.delete(oldestTableId);
    }
  }
  suppressedNonRetryableTerminalJanitorFailuresByTableId.set(suppression.tableId, suppression);
  klogSafe("ws_table_janitor_terminal_failure_suppression_activated", {
    tableId: suppression.tableId,
    stateVersion: suppression.stateVersion,
    status: suppression.tableStatus,
    handId: suppressionContext?.handId || null,
    phase: suppressionContext?.phase || null,
    code: suppression.code,
    reason: suppression.reason,
    ttlMs: TERMINAL_JANITOR_SUPPRESSION_TTL_MS
  });
}

async function runEvaluatedTableJanitor({ tableId, trigger, requestId }) {
  let pendingEvaluation = pendingTableJanitorEvaluationByTableId.get(tableId);
  if (pendingEvaluation) {
    klogSafe("ws_table_janitor_evaluation_coalesced", {
      tableId,
      trigger,
      requestId: requestId || null
    });
  } else {
    const evaluation = evaluateTableForJanitor(tableId);
    pendingEvaluation = evaluation.finally(() => {
      if (pendingTableJanitorEvaluationByTableId.get(tableId) === pendingEvaluation) {
        pendingTableJanitorEvaluationByTableId.delete(tableId);
      }
    });
    pendingTableJanitorEvaluationByTableId.set(tableId, pendingEvaluation);
  }

  const evaluated = await pendingEvaluation;
  if (evaluated?.result) {
    suppressedNonRetryableTerminalJanitorFailuresByTableId.delete(tableId);
    return evaluated.result;
  }
  const suppressedResult = suppressedTerminalJanitorResult({
    trigger,
    classification: evaluated?.classification,
    suppressionContext: evaluated?.suppressionContext
  });
  if (suppressedResult) return suppressedResult;
  const result = await runTableJanitor({
    classification: evaluated?.classification,
    trigger,
    requestId,
    primitives: tableJanitorPrimitives,
    klog: klogSafe,
    klogVerbose
  });
  rememberNonRetryableTerminalJanitorFailure({
    trigger,
    classification: evaluated?.classification,
    suppressionContext: evaluated?.suppressionContext,
    result
  });
  return result;
}

async function sweepStaleActiveHumanSeatsAndBroadcast() {
  const staleSeatCandidates = await listStaleActiveHumanSeatCandidates({
    limit: Number(process.env.WS_STALE_ACTIVE_SEAT_SWEEP_BATCH || 25)
  });
  if (!Array.isArray(staleSeatCandidates) || staleSeatCandidates.length === 0) return;
  const staleTableIds = [...new Set(staleSeatCandidates.map((candidate) => candidate?.tableId).filter(Boolean))];
  await Promise.allSettled(staleTableIds.map((tableId) => runEvaluatedTableJanitor({
    tableId,
    trigger: "stale_active_seat_sweep",
    requestId: `ws-stale-active-seat-cleanup:${tableId}`
  })));
}

async function listZombieOpenTableIds({ limit = 25 } = {}) {
  if (!persistedBootstrapEnabled) return [];
  const boundedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 25;
  try {
    const beginSqlWs = await loadBeginSqlWs();
    return beginSqlWs(async (tx) => {
      const rows = await tx.unsafe(
        `select t.id
         from public.poker_tables t
         where t.status = 'OPEN'
           and not exists (
             select 1
             from public.poker_seats s
             where s.table_id = t.id
               and s.status = 'ACTIVE'
               and coalesce(s.is_bot, false) = false
           )
         order by t.updated_at asc
         limit $1;`,
        [boundedLimit]
      );
      if (!Array.isArray(rows)) return [];
      return rows
        .map((row) => (typeof row?.id === "string" ? row.id : ""))
        .filter((id) => id);
    }, { env: process.env });
  } catch (error) {
    klogSafe("ws_zombie_cleanup_list_failed", { message: error?.message || "unknown" });
    return [];
  }
}

async function sweepZombieTablesAndBroadcast() {
  const zombieTableIds = await listZombieOpenTableIds({
    limit: Number(process.env.WS_ZOMBIE_TABLE_SWEEP_BATCH || 25)
  });
  if (!Array.isArray(zombieTableIds) || zombieTableIds.length === 0) return;
  await Promise.allSettled(zombieTableIds.map((tableId) => runEvaluatedTableJanitor({
    tableId,
    trigger: "zombie_table_sweep",
    requestId: `ws-zombie-cleanup:${tableId}`
  })));
}

async function listOpenTableIdsForJanitor({ limit = 10 } = {}) {
  if (!persistedBootstrapEnabled) return [];
  const boundedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 10;
  const selectionStartedAtMs = pokerLogRuntimeControl.mayBuildDebugPayload("ws_open_table_reconciler_batch_selected") ? Date.now() : 0;
  // UUID order is immutable and round-trips exactly, so the boundary row cannot requeue itself.
  const hasCursor = Boolean(typeof openTableJanitorCursor?.tableId === "string"
    && openTableJanitorCursor.tableId.trim());
  const cursorTableId = hasCursor ? openTableJanitorCursor.tableId.trim() : null;
  try {
    const beginSqlWs = await loadBeginSqlWs();
    return beginSqlWs(async (tx) => {
      const rows = await tx.unsafe(
         `select
           t.id,
           case
             when $1::uuid is null then false
             when t.id > $1::uuid then false
             else true
           end as cursor_wrapped
         from public.poker_tables t
         where t.status = 'OPEN'
         order by cursor_wrapped asc, t.id asc
         limit $2;`,
        [cursorTableId, boundedLimit]
      );
      const selectedRows = Array.isArray(rows)
        ? rows.filter((row) => typeof row?.id === "string" && row.id)
        : [];
      const tableIds = selectedRows.map((row) => row.id);
      const lastRow = selectedRows.at(-1) || null;
      openTableJanitorCursor = lastRow ? { tableId: lastRow.id } : null;
      klogVerbose("ws_open_table_reconciler_batch_selected", () => ({
        limit: boundedLimit,
        selectedCount: tableIds.length,
        wrapped: selectedRows.some((row) => row?.cursor_wrapped === true),
        cursorPresentBefore: hasCursor,
        cursorPresentAfter: Boolean(openTableJanitorCursor),
        durationMs: Math.max(0, Date.now() - selectionStartedAtMs)
      }));
      return tableIds;
    }, { env: process.env });
  } catch (error) {
    klogSafe("ws_open_table_reconciler_list_failed", { message: error?.message || "unknown" });
    return [];
  }
}

async function sweepOpenTableJanitorAndBroadcast() {
  const openTableIds = await listOpenTableIdsForJanitor({
    limit: Number(process.env.WS_OPEN_TABLE_JANITOR_SWEEP_BATCH || 10)
  });
  if (!Array.isArray(openTableIds) || openTableIds.length === 0) return;
  await Promise.allSettled(openTableIds.map((tableId) => runEvaluatedTableJanitor({
    tableId,
    trigger: "open_table_reconciler",
    requestId: `ws-open-table-janitor:${tableId}`
  })));
}

async function sweepTurnTimeoutsAndBroadcast() {
  const nowMs = Date.now();
  pruneBotTimeoutSafetySuppressions();
  const timeoutUpdates = tableManager.listDueTurnTimeouts({
    nowMs,
    shouldProcessTable: (tableId) => (
      tableManager.isTableClosed(tableId) !== true
      && !isTurnTimeoutTableQuarantined(tableId, nowMs)
      && !isBotTimeoutSafetyRetrySuppressed(tableId)
    )
  });
  await Promise.allSettled(timeoutUpdates.map((update) => enqueueTableCommand({
    tableId: update.tableId,
    commandName: update.isBotTurn === true ? "bot_timeout_safety" : "turn_timeout",
    dedupeKey: update.isBotTurn === true ? null : "turn_timeout",
    run: async () => {
      if (update.isBotTurn === true) {
        klogSafe("ws_bot_timeout_safety_autoplay", {
          tableId: update.tableId,
          turnUserId: update.turnUserId || null,
          stateVersion: Number.isFinite(Number(update.stateVersion)) ? Number(update.stateVersion) : null
        });
        const result = await handleBotStepCommand({
          tableId: update.tableId,
          trigger: "bot_timeout_safety",
          requestId: `bot-timeout-safety:${update.tableId}:${nowMs}`,
          frameTs: null,
          runBotStep,
          broadcastStateSnapshots,
          klog: botAutoplayObservability.log
        });
        if (shouldSuppressBotTimeoutSafetyRetry(result)) {
          const fingerprint = buildBotTimeoutSafetyFingerprint(update.tableId);
          if (fingerprint && fingerprint.stateVersion === Number(update.stateVersion)) {
            suppressedBotTimeoutSafetyFailures.set(update.tableId, {
              ...fingerprint,
              reason: result.reason
            });
            botAutoplayObservability.log("ws_bot_timeout_safety_same_state_retry_suppressed", {
              ...fingerprint,
              reason: result.reason
            });
          }
        } else {
          clearBotTimeoutSafetySuppressionAfterSuccess(update.tableId, result);
        }
        return result;
      }
      const result = await handleTurnTimeoutCommand({
        tableId: update.tableId,
        nowMs,
        tableManager,
        persistMutatedState,
        restoreTableFromPersisted,
        broadcastResyncRequired,
        broadcastStateSnapshots,
        scheduleBotStep,
        klog: klogSafe
      });
      await recordTurnTimeoutOutcome({
        tableId: update.tableId,
        result,
        nowMs
      });
      return result;
    }
  })));
}

function readJsonBody(req, { maxBytes = 64 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        const error = new Error("body_too_large");
        error.code = "body_too_large";
        reject(error);
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendInternalJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function hasExactKeys(payload, allowedKeys) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const allowed = new Set(allowedKeys);
  return Object.keys(payload).every((key) => allowed.has(key));
}

async function handleInternalBotReactionConfig(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    sendInternalJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  if (!internalRuntimeToken) {
    sendInternalJson(res, 503, { error: "internal_runtime_token_missing" });
    return;
  }
  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization.trim() : "";
  if (authHeader !== `Bearer ${internalRuntimeToken}`) {
    sendInternalJson(res, 401, { error: "unauthorized" });
    return;
  }
  try {
    if (req.method === "GET") {
      sendInternalJson(res, 200, botReactionOverrideStore.read());
      return;
    }
    const payload = await readJsonBody(req, { maxBytes: 1_024 });
    const mode = typeof payload?.mode === "string" ? payload.mode.trim() : "";
    let result;
    if (mode === "override" && hasExactKeys(payload, ["mode", "minMs", "maxMs", "updatedBy"])) {
      result = botReactionOverrideStore.setOverride({
        minMs: payload.minMs,
        maxMs: payload.maxMs,
        updatedBy: payload.updatedBy
      });
    } else if (mode === "default" && hasExactKeys(payload, ["mode", "updatedBy"])) {
      result = botReactionOverrideStore.clearOverride({ updatedBy: payload.updatedBy });
    } else if (mode === "reaction_settings" && hasExactKeys(payload, ["mode", "enabled", "frequencyPercent", "updatedBy"])) {
      result = botReactionOverrideStore.setReactionSettings({
        enabled: payload.enabled,
        frequencyPercent: payload.frequencyPercent,
        updatedBy: payload.updatedBy
      });
      if (result.reactionSettings.enabled !== true) reactionTimers.clearPendingReactions();
    } else {
      sendInternalJson(res, 400, { error: "invalid_request" });
      return;
    }
    klogSafe("ws_preview_bot_reaction_updated", {
      mode: result.mode,
      minMs: result.active.minMs,
      maxMs: result.active.maxMs,
      reactionsEnabled: result.reactionSettings.enabled,
      reactionFrequencyPercent: result.reactionSettings.frequencyPercent,
      updatedBy: typeof payload.updatedBy === "string" ? payload.updatedBy : null
    });
    sendInternalJson(res, 200, result);
  } catch (error) {
    const code = error?.code || (error instanceof SyntaxError ? "invalid_json" : "internal_server_error");
    const statusCode = Number(error?.status) || (code === "body_too_large" || code === "invalid_json" ? 400 : 500);
    if (statusCode >= 500) {
      klogSafe("ws_preview_bot_reaction_failed", { code });
    }
    sendInternalJson(res, statusCode, { error: code });
  }
}

async function handleInternalPokerLogControl(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    sendInternalJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  if (!internalRuntimeToken) {
    sendInternalJson(res, 503, { error: "internal_runtime_token_missing" });
    return;
  }
  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization.trim() : "";
  if (authHeader !== `Bearer ${internalRuntimeToken}`) {
    sendInternalJson(res, 401, { error: "unauthorized" });
    return;
  }
  try {
    if (req.method === "GET") {
      sendInternalJson(res, 200, pokerLogRuntimeControl.snapshot());
      return;
    }
    const payload = await readJsonBody(req, { maxBytes: 2_048 });
    const operation = typeof payload?.operation === "string" ? payload.operation.trim().toLowerCase() : "";
    const scope = typeof payload?.scope === "string" ? payload.scope.trim().toLowerCase() : "";
    const adminUserId = typeof payload?.adminUserId === "string" ? payload.adminUserId.trim() : "";
    const adminIdValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(adminUserId);
    const scopeFieldsValid = (
      (scope === "global" && payload?.category === null && payload?.tableId === null)
      || (scope === "category" && typeof payload?.category === "string" && payload?.tableId === null)
      || (scope === "table" && payload?.category === null && typeof payload?.tableId === "string")
    );
    const commonValid = adminIdValid && scopeFieldsValid;
    let result;
    if (
      operation === "enable"
      && commonValid
      && hasExactKeys(payload, ["operation", "scope", "category", "tableId", "ttlMs", "adminUserId"])
      && Object.keys(payload).length === 6
    ) {
      result = pokerLogRuntimeControl.enable({
        scope,
        category: payload.category,
        tableId: payload.tableId,
        ttlMs: payload.ttlMs,
        adminUserId
      });
    } else if (
      operation === "disable"
      && commonValid
      && hasExactKeys(payload, ["operation", "scope", "category", "tableId", "adminUserId"])
      && Object.keys(payload).length === 5
    ) {
      result = pokerLogRuntimeControl.disable({
        scope,
        category: payload.category,
        tableId: payload.tableId,
        adminUserId
      });
    } else {
      sendInternalJson(res, 400, { error: "invalid_request" });
      return;
    }
    sendInternalJson(res, 200, result);
  } catch (error) {
    const code = error?.code || (error instanceof SyntaxError ? "invalid_json" : "internal_server_error");
    const statusCode = Number(error?.status)
      || (code === "body_too_large" || code === "invalid_json" ? 400 : 500);
    sendInternalJson(res, statusCode, { error: code });
  }
}

function isUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function getPokerMaintenanceEnvironment() {
  const environment = loadReleaseMetadata().environment;
  return environment === "preview" || environment === "production" ? environment : null;
}

async function buildInternalPokerMaintenanceStatus(environment) {
  const repositoryStatus = await continuousBotTableRepository?.readStatus?.();
  if (!repositoryStatus?.ok) {
    return { ok: false, error: repositoryStatus?.reason || "continuous_maintenance_unavailable" };
  }
  const loadedTableIds = new Set(tableManager.listTableIds());
  const tables = repositoryStatus.tables.map((table) => {
    const loaded = loadedTableIds.has(table.tableId);
    const pokerState = loaded ? tableManager.persistedPokerState(table.tableId) : null;
    const hasHuman = loaded && (
      tableManager.hasActiveHumanMember(table.tableId)
      || tableManager.hasConnectedHumanPresence(table.tableId)
    );
    return {
      ...table,
      humanParticipation: loaded ? (hasHuman ? "present" : "none") : "unknown",
      phase: pokerState?.phase || null,
      loaded
    };
  });
  const cleanup = actionHistoryCleanup
    ? await actionHistoryCleanup.status()
    : null;
  const closedTableCleanupStatus = closedTableCleanup
    ? await closedTableCleanup.status()
    : null;
  return {
    ok: true,
    environment,
    continuous: {
      maintenanceEnabled: repositoryStatus.profile.enabled,
      desiredTableCount: repositoryStatus.profile.desiredTableCount,
      maxDesiredTableCount: repositoryStatus.maxDesiredTableCount || continuousBotMaxDesiredTables,
      creationLimitPerReconcile: repositoryStatus.creationLimitPerReconcile || 2,
      effectiveDesiredTableCount: repositoryStatus.profile.enabled
        ? repositoryStatus.profile.desiredTableCount
        : 0,
      profileUpdatedAt: repositoryStatus.profile.updatedAt || null,
      tables,
      supervisor: continuousBotTableSupervisor?.status?.() || {
        started: false,
        sweepInProgress: false,
        lastSweepStartedAt: null,
        lastSweepFinishedAt: null,
        lastSweepResult: null,
        lastError: null
      }
    },
    cleanup,
    closedTableCleanup: closedTableCleanupStatus
  };
}

function safeMetricInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function projectContinuousTablesMetrics(repositoryResult) {
  if (!repositoryResult?.ok || !repositoryResult.profile) return null;
  return {
    active: Array.isArray(repositoryResult.tables) ? repositoryResult.tables.length : null,
    desired: safeMetricInteger(repositoryResult.profile.desiredTableCount),
    enabled: typeof repositoryResult.profile.enabled === "boolean"
      ? repositoryResult.profile.enabled
      : null
  };
}

function projectCleanupMetrics(cleanupResult) {
  if (!cleanupResult || typeof cleanupResult !== "object") return null;
  const backlog = cleanupResult.backlog;
  const lastRun = cleanupResult.lastRun;
  const orphanHoleCardsDeleted = safeMetricInteger(lastRun?.orphanHoleCardsDeleted);
  const holeCardsDeleted = safeMetricInteger(lastRun?.holeCardsDeleted);
  const phase1Deleted = safeMetricInteger(lastRun?.phase1Deleted);
  const phase2Deleted = safeMetricInteger(lastRun?.phase2Deleted);
  const deletedRows = phase1Deleted != null && phase2Deleted != null
    ? (orphanHoleCardsDeleted || 0) + (holeCardsDeleted || 0) + phase1Deleted + phase2Deleted
    : null;
  const failedPhaseOrder = ["orphan_hole_cards", "hole_cards", "ordinary_actions", "hand_settled"];
  const failedPhases = Array.isArray(lastRun?.failedPhases)
    ? failedPhaseOrder.filter((phase) => lastRun.failedPhases.includes(phase))
    : [];
  return {
    backlog: backlog && typeof backlog === "object" ? {
      orphanHoleCardHands: safeMetricInteger(backlog.orphanHoleCardHands),
      orphanHoleCardRows: safeMetricInteger(backlog.orphanHoleCardRows),
      ordinaryActionRows: safeMetricInteger(backlog.ordinaryActionRows),
      handSettledRows: safeMetricInteger(backlog.handSettledRows),
      cappedAtBatchSize: typeof backlog.cappedAtBatchSize === "boolean"
        ? backlog.cappedAtBatchSize
        : null,
      measuredAt: typeof backlog.measuredAt === "string" ? backlog.measuredAt : null
    } : null,
    lastRun: lastRun && typeof lastRun === "object" ? {
      finishedAt: typeof lastRun.finishedAt === "string" ? lastRun.finishedAt : null,
      durationMs: safeMetricInteger(lastRun.durationMs),
      orphanHoleCardsDeleted,
      holeCardsDeleted,
      phase1Deleted,
      phase2Deleted,
      deletedRows: Number.isSafeInteger(deletedRows) ? deletedRows : null,
      result: typeof lastRun.result === "string" ? lastRun.result : null,
      errorCode: typeof lastRun.errorCode === "string" ? lastRun.errorCode : null,
      failedPhases
    } : null
  };
}

async function handleInternalVpsMetrics(req, res) {
  if (req.method !== "GET") {
    sendInternalJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  if (!internalRuntimeToken) {
    sendInternalJson(res, 503, { error: "internal_runtime_token_missing" });
    return;
  }
  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization.trim() : "";
  if (authHeader !== `Bearer ${internalRuntimeToken}`) {
    sendInternalJson(res, 401, { error: "unauthorized" });
    return;
  }
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  if (requestUrl.search) {
    sendInternalJson(res, 400, { error: "query_not_supported" });
    return;
  }
  const environment = getPokerMaintenanceEnvironment();
  if (!environment) {
    klogSafe("ws_vps_metrics_failed", { code: "environment_not_allowed" });
    sendInternalJson(res, 503, { error: "environment_not_allowed" });
    return;
  }

  const [hostResult, tablesResult, cleanupResult] = await Promise.allSettled([
    vpsMetricsCollector.collect(),
    continuousBotTableRepository?.readStatus?.() || Promise.resolve(null),
    actionHistoryCleanup?.status?.() || Promise.resolve(null)
  ]);
  if (hostResult.status === "rejected") {
    klogSafe("ws_vps_metrics_collection_failed", { source: "host", code: "collector_failed" });
  }
  const host = hostResult.status === "fulfilled" && hostResult.value ? hostResult.value : {
    rootFilesystem: null,
    logs: { varLogBytes: null, journaldBytes: null },
    runtime: {
      wsCpuPercent: null,
      wsRssBytes: null,
      wsUptimeSeconds: null,
      hostAvailableRamBytes: null,
      hostLogicalCpuCount: null,
      loadAverage: { one: null, five: null, fifteen: null },
      ioWaitPercent: null
    }
  };
  const tables = tablesResult.status === "fulfilled"
    ? projectContinuousTablesMetrics(tablesResult.value)
    : null;
  const cleanup = cleanupResult.status === "fulfilled"
    ? projectCleanupMetrics(cleanupResult.value)
    : null;
  sendInternalJson(res, 200, {
    environment,
    measuredAt: new Date().toISOString(),
    rootFilesystem: host.rootFilesystem || null,
    logs: host.logs || { varLogBytes: null, journaldBytes: null },
    runtime: host.runtime || null,
    continuousTables: tables,
    cleanup
  });
}

async function handleInternalPokerMaintenance(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    sendInternalJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  if (!internalRuntimeToken) {
    sendInternalJson(res, 503, { error: "internal_runtime_token_missing" });
    return;
  }
  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization.trim() : "";
  if (authHeader !== `Bearer ${internalRuntimeToken}`) {
    sendInternalJson(res, 401, { error: "unauthorized" });
    return;
  }
  const environment = getPokerMaintenanceEnvironment();
  if (!environment) {
    klogSafe("ws_admin_poker_maintenance_failed", { code: "environment_not_allowed", statusCode: 503 });
    sendInternalJson(res, 503, { error: "environment_not_allowed" });
    return;
  }
  try {
    if (req.method === "GET") {
      const status = await buildInternalPokerMaintenanceStatus(environment);
      sendInternalJson(res, status.ok ? 200 : 503, status);
      return;
    }
    const payload = await readJsonBody(req, { maxBytes: 4_096 });
    const operation = typeof payload?.operation === "string" ? payload.operation.trim() : "";
    const actorUserId = typeof payload?.actorUserId === "string" ? payload.actorUserId.trim() : "";
    const requestId = typeof payload?.requestId === "string" ? payload.requestId.trim() : "";
    const validRequestId = requestId.length >= 8 && requestId.length <= 140;
    if (!isUuid(actorUserId) || !validRequestId) {
      sendInternalJson(res, 400, { error: "invalid_request" });
      return;
    }
    let result;
    if (
      operation === "set_desired_state"
      && hasExactKeys(payload, ["operation", "enabled", "desiredTableCount", "actorUserId", "requestId"])
      && typeof payload.enabled === "boolean"
      && Number.isInteger(payload.desiredTableCount)
    ) {
      if (payload.desiredTableCount < 0 || payload.desiredTableCount > continuousBotMaxDesiredTables) {
        sendInternalJson(res, 400, { error: "invalid_desired_table_count" });
        return;
      }
      const profileResult = await continuousBotTableRepository?.setDesiredState?.({
        enabled: payload.enabled,
        desiredTableCount: payload.desiredTableCount,
        updatedBy: actorUserId
      });
      if (!profileResult?.ok) {
        sendInternalJson(res, 400, { error: profileResult?.reason || "profile_update_failed" });
        return;
      }
      const reconciliation = await continuousBotTableSupervisor?.sweep?.();
      result = {
        ok: true,
        operation,
        profileChanged: profileResult.profileChanged === true,
        reconciliationStarted: reconciliation?.skipped !== true,
        reconciliationSkipped: reconciliation?.skipped === true,
        effectiveDesiredTableCount: profileResult.profile.enabled ? profileResult.profile.desiredTableCount : 0,
        maxDesiredTableCount: continuousBotMaxDesiredTables,
        creationLimitPerReconcile: reconciliation?.creationLimitPerReconcile || 2,
        creationLimited: reconciliation?.creationLimited === true,
        remainingTableCount: Number(reconciliation?.remainingTableCount || 0),
        reconciliationResult: reconciliation?.ok === true ? "ok" : "failed"
      };
    } else if (
      operation === "request_rotation"
      && hasExactKeys(payload, ["operation", "tableId", "actorUserId", "requestId"])
      && isUuid(payload.tableId)
    ) {
      result = await requestContinuousBotTableRetirement({ tableId: payload.tableId.trim() });
      result = { ok: result?.ok === true, operation, ...result };
    } else if (
      operation === "reconcile"
      && hasExactKeys(payload, ["operation", "actorUserId", "requestId"])
    ) {
      const reconciliation = await continuousBotTableSupervisor?.sweep?.();
      result = {
        ok: reconciliation?.ok === true,
        operation,
        reconciliationStarted: reconciliation?.skipped !== true,
        reconciliationSkipped: reconciliation?.skipped === true,
        reconciliationResult: reconciliation?.ok === true ? "ok" : "failed",
        reason: reconciliation?.reason || null
      };
    } else if (
      operation === "cleanup"
      && hasExactKeys(payload, ["operation", "actorUserId", "requestId"])
    ) {
      const cleanupResult = await actionHistoryCleanup?.sweep?.();
      result = { ok: cleanupResult?.ok === true, operation, ...cleanupResult };
    } else {
      sendInternalJson(res, 400, { error: "invalid_request" });
      return;
    }
    klogSafe("ws_admin_poker_maintenance_action", {
      operation,
      actorUserId,
      requestId,
      ok: result?.ok === true,
      changed: result?.changed === true,
      skipped: result?.skipped === true
    });
    sendInternalJson(res, result?.ok === true ? 200 : 409, { ...result, environment });
  } catch (error) {
    const code = error?.code || (error instanceof SyntaxError ? "invalid_json" : "internal_server_error");
    const statusCode = Number(error?.status)
      || (code === "body_too_large" || code === "invalid_json" ? 400 : 500);
    klogSafe("ws_admin_poker_maintenance_failed", { code: String(code).slice(0, 120), statusCode });
    sendInternalJson(res, statusCode, { error: code });
  }
}

async function handleInternalBotClaimsRecovery(req, res) {
  if (req.method !== "POST") {
    sendInternalJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  if (!internalRuntimeToken) {
    sendInternalJson(res, 503, { error: "internal_runtime_token_missing" });
    return;
  }
  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization.trim() : "";
  if (authHeader !== `Bearer ${internalRuntimeToken}`) {
    sendInternalJson(res, 401, { error: "unauthorized" });
    return;
  }
  if (loadReleaseMetadata().environment !== "preview") {
    sendInternalJson(res, 403, { error: "preview_only" });
    return;
  }

  try {
    const payload = await readJsonBody(req, { maxBytes: 4_096 });
    const mode = typeof payload?.mode === "string" ? payload.mode.trim() : "";
    const tableId = typeof payload?.tableId === "string" ? payload.tableId.trim() : "";
    const adminUserId = typeof payload?.adminUserId === "string" ? payload.adminUserId.trim() : "";
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const preflightKeys = ["adminUserId", "mode", "tableId"];
    const executeKeys = [
      "adminUserId",
      "expectedInputHash",
      "expectedStateVersion",
      "mode",
      "reason",
      "requestId",
      "tableId"
    ];
    const validPreflight = mode === "preflight"
      && hasExactKeys(payload, preflightKeys)
      && Object.keys(payload).length === preflightKeys.length;
    const validExecute = mode === "execute"
      && hasExactKeys(payload, executeKeys)
      && Object.keys(payload).length === executeKeys.length
      && Number.isSafeInteger(payload.expectedStateVersion)
      && payload.expectedStateVersion >= 0
      && /^[a-f0-9]{64}$/i.test(String(payload.expectedInputHash || ""))
      && typeof payload.requestId === "string"
      && payload.requestId.trim().length >= 8
      && payload.requestId.trim().length <= 140
      && typeof payload.reason === "string"
      && payload.reason.trim().length >= 3
      && payload.reason.trim().length <= 240;
    if ((!validPreflight && !validExecute) || !UUID_RE.test(tableId) || !UUID_RE.test(adminUserId)) {
      sendInternalJson(res, 400, { error: "invalid_request" });
      return;
    }

    const result = await enqueueTableCommand({
      tableId,
      commandName: `admin_bot_claims_recovery_${mode}`,
      dedupeKey: mode === "execute" ? `admin_bot_claims_recovery:${payload.requestId.trim()}` : null,
      run: async () => {
        const hasActivePresence = () => (
          [...wss.clients].some((socket) => tableSocketMatches(socket, tableId))
          || tableManager.hasConnectedHumanPresence(tableId)
        );
        const executeRecovery = await loadBotClaimsRecoveryExecutorIfInactive({
          hasActivePresence,
          loadExecutor: loadBotClaimsRecoveryExecutor,
        });
        if (!executeRecovery) {
          return {
            ok: false,
            eligible: false,
            changed: false,
            closed: false,
            reason: "active_table_presence"
          };
        }
        const recoveryResult = await executeRecovery({
          mode,
          tableId,
          adminUserId,
          requestId: validExecute ? payload.requestId.trim() : null,
          expectedStateVersion: validExecute ? payload.expectedStateVersion : null,
          expectedInputHash: validExecute ? payload.expectedInputHash.trim() : null,
          reason: validExecute ? payload.reason.trim() : null,
          hasActivePresence
        });
        if (mode === "execute" && recoveryResult?.closed === true) {
          evictClosedRuntimeTable({
            tableId,
            logPrefix: "ws_bot_claims_recovery",
            status: "bot_claims_recovered_closed"
          });
        }
        return recoveryResult;
      }
    });
    klogSafe("ws_bot_claims_recovery_outcome", {
      tableId,
      mode,
      ok: result?.ok === true,
      eligible: result?.eligible === true,
      changed: result?.changed === true,
      closed: result?.closed === true,
      reason: result?.reason || null,
      stateVersion: result?.stateVersion ?? null,
      finalStateVersion: result?.finalStateVersion ?? null,
      delta: result?.delta ?? null,
      botCount: Array.isArray(result?.bots) ? result.bots.length : 0,
      humanPreserved: result?.humanStack != null
    });
    sendInternalJson(res, 200, { ...result, environment: "ws-preview" });
  } catch (error) {
    const code = error?.code || (error instanceof SyntaxError ? "invalid_json" : "internal_server_error");
    const statusCode = Number(error?.status)
      || (code === "body_too_large" || code === "invalid_json" ? 400 : 500);
    klogSafe("ws_bot_claims_recovery_failed", { code, statusCode });
    sendInternalJson(res, statusCode, { error: code });
  }
}

async function handleInternalLobbyMaterialize(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  if (!internalRuntimeToken) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "internal_runtime_token_missing" }));
    return;
  }
  const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization.trim() : "";
  if (authHeader !== `Bearer ${internalRuntimeToken}`) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_json" }));
    return;
  }
  const tableId = typeof payload?.tableId === "string" ? payload.tableId.trim() : "";
  if (!tableId) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_table_id" }));
    return;
  }
  const maxPlayers = resolveLobbyMaterializeMaxPlayers(payload?.maxPlayers);
  if (!Number.isInteger(maxPlayers)) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_max_players" }));
    return;
  }
  const stakesParsed = parseStakes(payload?.stakes);
  if (!stakesParsed?.ok) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_stakes" }));
    return;
  }
  const buyIn = payload?.buyIn == null ? null : Number(payload.buyIn);
  if (buyIn !== null && (!Number.isSafeInteger(buyIn) || buyIn <= 0)) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_buy_in" }));
    return;
  }
  const materialized = tableManager.materializeLobbyTable({
    tableId,
    tableMeta: {
      maxPlayers,
      stakes: stakesParsed.value,
      ...(buyIn === null ? {} : { buyIn })
    },
    nowMs: Date.now()
  });
  if (!materialized?.ok) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: materialized?.code || "table_materialize_failed" }));
    return;
  }
  syncLobbyRegistry();
  maybeBroadcastLobbySnapshot({ force: true });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, tableId }));
}

async function handleHttpRequest(req, res) {
  if (req.url === "/healthz") {
    res.writeHead(200, {
      "content-type": "text/plain",
      "x-poker-buy-in-materialization": "1"
    });
    res.end("ok");
    return;
  }

  if (req.url === "/internal/lobby/materialize-table") {
    await handleInternalLobbyMaterialize(req, res);
    return;
  }

  if (req.url === "/internal/admin/bot-reaction") {
    await handleInternalBotReactionConfig(req, res);
    return;
  }

  if (req.url === "/internal/admin/poker-log-control") {
    await handleInternalPokerLogControl(req, res);
    return;
  }

  if (req.url === "/internal/admin/poker-maintenance") {
    await handleInternalPokerMaintenance(req, res);
    return;
  }

  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  if (requestUrl.pathname === "/internal/admin/vps-metrics") {
    await handleInternalVpsMetrics(req, res);
    return;
  }

  if (req.url === "/internal/admin/bot-claims-recovery") {
    await handleInternalBotClaimsRecovery(req, res);
    return;
  }

  res.writeHead(404);
  res.end();
}

const server = http.createServer((req, res) => {
  Promise.resolve(handleHttpRequest(req, res)).catch((error) => {
    klogSafe("ws_http_request_failed", {
      url: req?.url || null,
      message: error?.message || "unknown"
    });
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: "internal_server_error" }));
  });
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  const connState = createConnState(nowTs);
  sessionStore.registerSession({ session: connState.session });
  ws.__connState = connState;

  let messageQueue = Promise.resolve();
  let connectionCleanupStarted = false;

  async function processMessage(msg, isBinary) {
    sweepExpiredSessionsOnly();
    void sweepDisconnectCleanupAndBroadcast();
    await sweepTurnTimeoutsAndBroadcast();
    if (isBinary) {
      sendError(ws, connState, {
        code: "INVALID_ENVELOPE",
        message: "Frame must be a UTF-8 JSON text message"
      });
      return;
    }

    const raw = typeof msg === "string" ? msg : msg.toString();
    const frameSize = Buffer.byteLength(raw, "utf8");
    if (frameSize > MAX_FRAME_BYTES) {
      sendError(ws, connState, {
        code: "FRAME_TOO_LARGE",
        message: `Frame exceeds ${MAX_FRAME_BYTES} bytes`,
        closeCode: 1009
      });
      return;
    }

    const parsed = parseFrame(raw);
    if (!parsed.ok) {
      sendError(ws, connState, {
        code: "INVALID_ENVELOPE",
        message: parsed.error
      });
      return;
    }

    const validation = validateEnvelope(parsed.value);
    if (!validation.ok) {
      const closeCode = validation.code === "UNSUPPORTED_VERSION" ? 1002 : null;
      sendError(ws, connState, {
        code: validation.code,
        message: validation.message,
        requestId: validation.requestId,
        closeCode
      });
      return;
    }

    const frame = validation.value;
    if (
      PROTECTED_MESSAGE_TYPES.has(frame.type)
      && connState.session.userId
      && !sessionStore.socketOwnsSession({ ws, sessionId: connState.session.sessionId })
    ) {
      try {
        const ownerConns = sessionStore.connectionsForUser(connState.session.userId || null) || [];
        const ownerConnsInfo = ownerConns.map((s) => ({ remoteAddr: s && s._socket && s._socket.remoteAddress ? s._socket.remoteAddress : null, sessionId: s && s.__connState && s.__connState.sessionId ? s.__connState.sessionId : null }));
        klogSafe("ws_stale_session_socket_rejected", {
          event: "stale_frame_rejected",
          frameType: frame.type,
          requestId: frame.requestId ?? null,
          sessionId: connState.session.sessionId,
          userId: connState.session.userId,
          socketRemoteAddr: ws && ws._socket && ws._socket.remoteAddress ? ws._socket.remoteAddress : null,
          ownerConnections: ownerConnsInfo
        });
      } catch (_err) { }

      connState.sessionInvalidated = true;
      connState.sessionInvalidatedReason = "session_rebound";
      sendError(ws, connState, {
        code: "STALE_SESSION",
        message: "socket no longer owns session",
        requestId: frame.requestId ?? null
      });
      setImmediate(() => {
        try {
          klogSafe("ws_invalidate_before_close", { sessionId: connState.session.sessionId, socketRemoteAddr: ws && ws._socket && ws._socket.remoteAddress ? ws._socket.remoteAddress : null });
        } catch (_err) {}
        invalidateSocketSession(ws, { reason: "session_rebound", send_stale: false });
      });
      return;
    }
    touchSession(connState.session, nowTs);

    if (process.env.WS_TEST_THROW_ON_FRAME_TYPE && process.env.WS_TEST_THROW_ON_FRAME_TYPE === frame.type) {
      throw new Error("forced_process_message_failure");
    }

    if (frame.type === "hello") {
      const response = handleHello({ frame, connState, nowTs });
      if (!response.ok) {
        sendError(ws, connState, {
          code: response.code,
          message: response.message,
          requestId: frame.requestId ?? null,
          closeCode: response.closeCode ?? null
        });
        return;
      }

      sendFrame(ws, response.frame);
      return;
    }

    if (frame.type === "ping") {
      const response = handlePing({ frame, connState, nowTs });
      if (!response.ok) {
        sendError(ws, connState, {
          code: response.code,
          message: response.message,
          requestId: frame.requestId ?? null
        });
        return;
      }

      sendFrame(ws, response.frame);
      maybeTouchPersistedSeatLastSeen(ws, connState);
      return;
    }

    if (frame.type === "auth") {
      const response = handleAuth({ frame, connState, nowTs, verifyToken });
      if (!response.ok) {
        sendError(ws, connState, {
          code: response.code,
          message: response.message,
          requestId: frame.requestId ?? null
        });
        return;
      }

      sendFrame(ws, response.frame);
      if (response.frame.type === "authOk" && connState.session.userId) {
        sessionStore.trackConnection({ ws, userId: connState.session.userId, sessionId: connState.session.sessionId });
      }
      return;
    }

    if (PROTECTED_MESSAGE_TYPES.has(frame.type) && !connState.session.userId) {
      sendError(ws, connState, {
        code: "auth_required",
        message: "Authentication is required for this message type",
        requestId: frame.requestId ?? null
      });
      return;
    }

    if (requiresRequestId(frame.type) && typeof frame.requestId !== "string") {
      sendError(ws, connState, {
        code: "INVALID_COMMAND",
        message: `${frame.type} requires requestId`,
        requestId: null
      });
      return;
    }


    if (frame.type === "ack") {
      const resolvedRoomId = resolveRoomId(frame);
      if (!resolvedRoomId.ok) {
        sendError(ws, connState, {
          code: resolvedRoomId.code,
          message: resolvedRoomId.message,
          requestId: frame.requestId ?? null
        });
        return;
      }
      const ackSeq = frame.payload?.seq;
      const ackResult = ackSessionSeq({ session: connState.session, tableId: resolvedRoomId.roomId, seq: ackSeq });
      if (!ackResult.ok) {
        sendError(ws, connState, {
          code: "INVALID_COMMAND",
          message: "ack payload.seq must be an integer within delivered range",
          requestId: frame.requestId ?? null
        });
      }
      return;
    }

    if (frame.type === "protected_echo") {
      const response = handleProtectedEcho({ frame, connState, nowTs });
      sendFrame(ws, response.frame);
      return;
    }

    if (frame.type === "reaction_send") {
      const resolvedRoomId = resolveRoomId(frame);
      if (!resolvedRoomId.ok) {
        sendError(ws, connState, {
          code: resolvedRoomId.code,
          message: resolvedRoomId.message,
          requestId: frame.requestId ?? null
        });
        return;
      }

      const tableId = resolvedRoomId.roomId;
      const association = tableManager.connectionTableAssociation(ws);
      const connectedToTable = association?.joinedTableId === tableId || association?.subscribedTableId === tableId;
      if (!connectedToTable) {
        sendCommandResult(ws, connState, {
          requestId: frame.requestId ?? null,
          tableId,
          status: "rejected",
          reason: "not_seated"
        });
        return;
      }

      const senderUserId = connState.session.userId;
      if (tableManager.isBotUser(tableId, senderUserId) === true) {
        sendCommandResult(ws, connState, {
          requestId: frame.requestId ?? null,
          tableId,
          status: "rejected",
          reason: "invalid_sender"
        });
        return;
      }

      const senderSnapshot = tableManager.tableSnapshot(tableId, senderUserId);
      const senderSeatNo = Number.isInteger(senderSnapshot?.youSeat) ? senderSnapshot.youSeat : null;
      if (!Number.isInteger(senderSeatNo)) {
        sendCommandResult(ws, connState, {
          requestId: frame.requestId ?? null,
          tableId,
          status: "rejected",
          reason: "not_seated"
        });
        return;
      }

      const reactionPayload = frame.payload && typeof frame.payload === "object" ? frame.payload : {};
      const hasTargetSeatNo = Object.prototype.hasOwnProperty.call(reactionPayload, "targetSeatNo");
      const hasHandId = Object.prototype.hasOwnProperty.call(reactionPayload, "handId");
      const targeted = hasTargetSeatNo || hasHandId;
      let targetSeatNo = reactionPayload.targetSeatNo;
      let targetOccupied = false;
      let targetIsWinner = false;
      let settlementMatchesHand = false;
      let settlementWindowOpen = false;
      let settlementHandId = null;
      let targetUserId = null;
      if (targeted) {
        const pokerState = tableManager.persistedPokerState(tableId);
        const requestedHandId = typeof reactionPayload.handId === "string" ? reactionPayload.handId.trim() : "";
        const currentHandId = typeof pokerState?.handId === "string" ? pokerState.handId.trim() : "";
        const showdownHandId = typeof pokerState?.showdown?.handId === "string" ? pokerState.showdown.handId.trim() : "";
        settlementHandId = typeof pokerState?.handSettlement?.handId === "string" ? pokerState.handSettlement.handId.trim() : "";
        settlementMatchesHand = !!requestedHandId
          && requestedHandId === currentHandId
          && requestedHandId === showdownHandId
          && requestedHandId === settlementHandId;
        settlementWindowOpen = settlementMatchesHand
          && isValidTargetedSettlementTimestamp(pokerState?.handSettlement?.settledAt, Date.now())
          && isPublishedSettlementRevealPendingForTable(tableId);
        const members = tableManager.tableSnapshot(tableId, null)?.members;
        const matchingTargetMembers = Array.isArray(members)
          ? members.filter((member) => member && member.seat === targetSeatNo)
          : [];
        const targetMember = matchingTargetMembers.length === 1 ? matchingTargetMembers[0] : null;
        targetOccupied = !!(targetMember && typeof targetMember.userId === "string" && targetMember.userId.trim());
        targetUserId = targetOccupied ? targetMember.userId.trim() : null;
        if (targetOccupied && settlementMatchesHand) {
          const targetableWinnerUserIds = collectTargetableWinnerUserIds(pokerState?.showdown);
          targetIsWinner = targetableWinnerUserIds instanceof Set && targetableWinnerUserIds.has(targetMember.userId.trim());
        }
      }

      const result = evaluateHumanReactionCommand({
        tableId,
        senderUserId,
        senderSeatNo,
        reactionKey: reactionPayload.reactionKey,
        targeted,
        targetSeatNo,
        targetOccupied,
        targetIsWinner,
        settlementMatchesHand,
        settlementWindowOpen,
        settlementHandId,
        tableClosed: tableManager.isTableClosed(tableId),
        nowMs: Date.now()
      });
      if (!result.ok) {
        sendCommandResult(ws, connState, {
          requestId: frame.requestId ?? null,
          tableId,
          status: "rejected",
          reason: result.reason
        });
        return;
      }

      sendCommandResult(ws, connState, {
        requestId: frame.requestId ?? null,
        tableId,
        status: "accepted",
        reason: null
      });
      const broadcastResult = broadcastTableReaction(tableId, result);
      if (!targeted && result.reactionKey === "hello" && broadcastResult.sentCount > 0) {
        runReactionObserverSafely("human_hello", () => scheduleBotReactionCandidate(
          tableId,
          () => classifyDirectedBotReaction({
            botSeats: availableBotSeatsForReaction(tableId),
            excludedUserId: senderUserId,
            targetSeatNo: senderSeatNo,
            reactionKeys: ["hello"],
            probability: HUMAN_HELLO_REPLY_PROBABILITY,
            reactionSettings: currentBotReactionSettings()
          }),
          { targetUserId: senderUserId }
        ));
      }
      if (targeted && result.reactionKey === "nice_hand" && broadcastResult.sentCount > 0
        && targetUserId && tableManager.isBotUser(tableId, targetUserId) === true) {
        runReactionObserverSafely("targeted_nice_hand", () => scheduleBotReactionCandidate(
          tableId,
          () => classifyDirectedBotReaction({
            botSeats: availableBotSeatsForReaction(tableId).filter((bot) => bot.userId === targetUserId),
            excludedUserId: senderUserId,
            targetSeatNo: senderSeatNo,
            reactionKeys: ["thanks"],
            probability: 0.8,
            reactionSettings: currentBotReactionSettings()
          }),
          { targetUserId: senderUserId }
        ));
      }
      return;
    }

    if (frame.type === "lobby_subscribe") {
      sessionStore.trackConnection({ ws, userId: connState.session.userId, sessionId: connState.session.sessionId });
      lobbySubscribers.add(ws);
      syncLobbyRegistry();
      sendLobbySnapshot(ws, connState, { requestId: frame.requestId ?? null });
      return;
    }

    if (frame.type === "table_join" || frame.type === "join") {
      const resolvedRoomId = resolveRoomId(frame);
      if (!resolvedRoomId.ok) {
        sendError(ws, connState, {
          code: resolvedRoomId.code,
          message: resolvedRoomId.message,
          requestId: frame.requestId ?? null
        });
        return;
      }
      frame.__resolvedTableId = resolvedRoomId.roomId;

      if (isGuestSession(connState)) {
        if (!isGuestTableId(frame.__resolvedTableId) || (connState.guestTableId && connState.guestTableId !== frame.__resolvedTableId)) {
          sendCommandResult(ws, connState, {
            requestId: frame.requestId ?? null,
            tableId: frame.__resolvedTableId,
            status: "rejected",
            reason: "guest_multiplayer_requires_account"
          });
          return;
        }
        const tableId = frame.__resolvedTableId;
        const guestJoinIntent = frame.payload?.guestJoinIntent === "create" ? "create" : "resume";
        await enqueueTableCommand({
          tableId,
          commandName: "guest_join",
          run: async () => {
            const runtimeExists = tableManager.listTableIds().includes(tableId);
            if (!runtimeExists && guestJoinIntent !== "create") {
              sendCommandResult(ws, connState, {
                requestId: frame.requestId ?? null,
                tableId,
                status: "rejected",
                reason: "table_closed"
              });
              return { ok: false, changed: false, code: "table_closed", retryable: false };
            }
            if (!runtimeExists) {
              const materializedGuest = tableManager.materializeGuestTable({
                tableId,
                guestUserId: connState.session.userId,
                nickname: connState.session.nickname || connState.nickname || null,
                nowMs: Date.now()
              });
              if (!materializedGuest?.ok) {
                sendCommandResult(ws, connState, {
                  requestId: frame.requestId ?? null,
                  tableId,
                  status: "rejected",
                  reason: materializedGuest?.code || "guest_table_failed"
                });
                return materializedGuest;
              }
            }
            sessionStore.trackConnection({ ws, userId: connState.session.userId, sessionId: connState.session.sessionId });
            const joined = tableManager.join({
              ws,
              userId: connState.session.userId,
              tableId,
              requestId: frame.requestId,
              nowTs: Date.now(),
              authoritativeSeatNo: 1,
              buyIn: tableManager.tableMeta(tableId)?.buyIn ?? null
            });
            if (!joined.ok) {
              sendCommandResult(ws, connState, {
                requestId: frame.requestId ?? null,
                tableId,
                status: "rejected",
                reason: joined.code || "join_failed"
              });
              return joined;
            }
            const bootstrapped = tableManager.bootstrapHand(tableId, { nowMs: Date.now() });
            sendCommandResult(ws, connState, {
              requestId: frame.requestId ?? null,
              tableId,
              status: "accepted",
              reason: joined.changed ? null : "already_joined"
            });
            const tableSnapshot = tableManager.tableSnapshot(tableId, connState.session.userId);
            sendTableState(ws, connState, { requestId: frame.requestId ?? null, tableState: joined.tableState, tableSnapshot });
            if (joined.changed || bootstrapped?.changed) {
              broadcastStateSnapshots(tableId);
              broadcastTableState(tableId, { excludeWs: ws });
              scheduleBotStep({
                tableId,
                trigger: "guest_join_bootstrap",
                requestId: frame.requestId ?? null,
                frameTs: frame.ts
              });
            }
            return {
              ok: true,
              changed: joined.changed === true || bootstrapped?.changed === true,
              status: joined.changed ? "guest_joined" : "already_joined"
            };
          }
        });
        return;
      }

      if (isGuestTableId(frame.__resolvedTableId)) {
        sendCommandResult(ws, connState, {
          requestId: frame.requestId ?? null,
          tableId: frame.__resolvedTableId,
          status: "rejected",
          reason: "guest_table_requires_guest_session"
        });
        return;
      }

      const joinResult = await enqueueTableCommand({
        tableId: frame.__resolvedTableId,
        commandName: "join",
        run: async () => handleJoinCommand({
          frame,
          ws,
          connState,
          sessionStore,
          tableManager,
          ensureTableLoadedErrorMapper: mapEnsureTableLoadedError,
          restoreTableFromPersisted,
          persistMutatedState,
          broadcastResyncRequired,
          broadcastStateSnapshots,
          broadcastTableState,
          sendError,
          sendCommandResult,
          sendTableState,
          authoritativeJoinEnabled,
          observeOnlyJoinEnabled,
          persistedBootstrapEnabled,
          loadAuthoritativeJoinExecutor,
          scheduleBotStep,
          klog: klogSafe,
          klogVerbose,
          verboseLogsEnabled: pokerLogRuntimeControl.mayBuildDebugPayload("ws_join_authoritative_start", {
            tableId: frame.__resolvedTableId
          })
        })
      });
      if (joinResult?.newHumanJoined === true && Number.isInteger(joinResult.seatNo)) {
        runReactionObserverSafely("human_join", () => scheduleBotReactionCandidate(
          frame.__resolvedTableId,
          () => classifyDirectedBotReaction({
            botSeats: availableBotSeatsForReaction(frame.__resolvedTableId),
            excludedUserId: joinResult.userId,
            targetSeatNo: joinResult.seatNo,
            reactionKeys: ["hello", "good_luck"],
            probability: 1,
            reactionSettings: currentBotReactionSettings()
          }),
          { targetUserId: joinResult.userId }
        ));
      }
      maybeScheduleSettledRollover(frame.__resolvedTableId);
      maybeTouchPersistedSeatLastSeen(ws, connState);
      return;
    }

    if (frame.type === "resync" || frame.type === "resume") {
      const resolvedRoomId = resolveRoomId(frame);
      if (!resolvedRoomId.ok) {
        sendError(ws, connState, {
          code: resolvedRoomId.code,
          message: resolvedRoomId.message,
          requestId: frame.requestId ?? null
        });
        return;
      }
      const tableId = resolvedRoomId.roomId;

      if (frame.type === "resync") {
        const ensured = await tableManager.ensureTableLoaded(tableId);
        if (!ensured.ok) {
          const loadError = mapEnsureTableLoadedError(ensured);
          sendError(ws, connState, {
            code: loadError.code,
            message: loadError.message,
            requestId: frame.requestId ?? null
          });
          return;
        }

        sessionStore.trackConnection({ ws, userId: connState.session.userId, sessionId: connState.session.sessionId });
        const resynced = tableManager.resync({ ws, userId: connState.session.userId, tableId, nowTs: Date.now() });
        if (!resynced.ok) {
          sendError(ws, connState, {
            code: "INVALID_COMMAND",
            message: resynced.message,
            requestId: frame.requestId ?? null
          });
          return;
        }

        await tableManager.refreshPublicProfiles(tableId);
        const resyncedSnapshot = tableManager.tableSnapshot(tableId, connState.session.userId);
        sendTableState(ws, connState, { requestId: frame.requestId ?? null, tableState: resynced.tableState, tableSnapshot: resyncedSnapshot });
        maybeScheduleSettledRollover(tableId);
        maybeTouchPersistedSeatLastSeen(ws, connState);
        scheduleObservedBotTurn({
          tableId,
          trigger: "resync",
          requestId: frame.requestId ?? null,
          frameTs: frame.ts
        });
        return;
      }

      const resumeSessionId = frame.payload.sessionId;
      const resumeLastSeq = frame.payload.lastSeq;
      if (typeof resumeSessionId !== "string" || !Number.isInteger(resumeLastSeq) || resumeLastSeq < 0) {
        sendError(ws, connState, {
          code: "INVALID_COMMAND",
          message: "resume requires payload.sessionId and integer payload.lastSeq",
          requestId: frame.requestId ?? null
        });
        return;
      }

      const rebound = sessionStore.rebindSession({
        sessionId: resumeSessionId,
        userId: connState.session.userId,
        ws
      });
      if (!rebound.ok) {
        sendResumeRequired(ws, connState, {
          requestId: frame.requestId ?? null,
          tableId,
          reason: rebound.reason,
          expectedSeq: 0
        });
        return;
      }

      const replay = streamLog.eventsAfter({ tableId, lastSeq: resumeLastSeq, receiverKey: resumeSessionId });
      if (rebound.priorSocket && rebound.priorSocket !== ws) {
        try {
          // Emit detailed instrumentation so tests can reconstruct timeline and ownership
          const priorRemote = rebound.priorSocket && rebound.priorSocket._socket && rebound.priorSocket._socket.remoteAddress ? rebound.priorSocket._socket.remoteAddress : null;
          const priorConnSid = rebound.priorSocket && rebound.priorSocket.__connState && rebound.priorSocket.__connState.sessionId ? rebound.priorSocket.__connState.sessionId : null;
          const newRemote = ws && ws._socket && ws._socket.remoteAddress ? ws._socket.remoteAddress : null;
          const userConns = sessionStore.connectionsForUser(connState.session.userId || null) || [];
          const userConnsInfo = userConns.map((s) => ({ remoteAddr: s && s._socket && s._socket.remoteAddress ? s._socket._socket ? null : (s._socket.remoteAddress) : (s && s._socket && s._socket.remoteAddress) || null, sessionId: s && s.__connState && s.__connState.sessionId ? s.__connState.sessionId : null })).slice(0,10);

          klogSafe("ws_session_rebound", {
            event: "session_rebound",
            sessionId: resumeSessionId,
            userId: connState.session.userId,
            priorSocketSessionId: priorConnSid,
            priorSocketRemoteAddr: priorRemote,
            newSocketRemoteAddr: newRemote,
            userConnections: userConnsInfo
          });
        } catch (_err) {}

        // Enforce deny semantics: invalidate prior socket immediately after rebind.
        try {
          klogSafe("ws_invalidating_stale_socket", {
            event: "invalidate_prior_socket",
            sessionId: resumeSessionId,
            priorSocketSessionId: rebound.priorSocket && rebound.priorSocket.__connState ? rebound.priorSocket.__connState.sessionId : null,
            priorSocketRemoteAddr: rebound.priorSocket && rebound.priorSocket._socket && rebound.priorSocket._socket.remoteAddress ? rebound.priorSocket._socket.remoteAddress : null
          });
          invalidateSocketSession(rebound.priorSocket, { reason: "session_rebound" });
          klogSafe("ws_invalidated_prior_socket", { sessionId: resumeSessionId, reason: "session_rebound" });
        } catch (_err) {
          klogSafe("ws_invalidated_prior_socket_error", { sessionId: resumeSessionId, message: _err && _err.message ? _err.message : String(_err) });
        }
      }

      connState.session = rebound.session;
      connState.sessionId = rebound.session.sessionId;
      ws.__connState = connState;

      const resynced = tableManager.resync({ ws, userId: connState.session.userId, tableId, nowTs: Date.now() });
      if (!resynced.ok) {
        sendError(ws, connState, {
          code: "INVALID_COMMAND",
          message: resynced.message,
          requestId: frame.requestId ?? null
        });
        return;
      }

      if (!replay.ok) {
        sendResumeRequired(ws, connState, {
          requestId: frame.requestId ?? null,
          tableId,
          reason: replay.reason,
          expectedSeq: replay.latestSeq ?? 0
        });
        await tableManager.refreshPublicProfiles(tableId);
        const tableSnapshot = tableManager.tableSnapshot(tableId, connState.session.userId);
        await nextEventLoopTurn();
        sendStateSnapshot(ws, connState, { tableSnapshot, reason: replay.reason });
        maybeScheduleSettledRollover(tableId);
        scheduleObservedBotTurn({
          tableId,
          trigger: "resume_resync",
          requestId: frame.requestId ?? null,
          frameTs: frame.ts
        });
        return;
      }

      if (replay.frames.length === 0) {
        sendResumeAck(ws, connState, { requestId: frame.requestId ?? null, tableId });
        scheduleObservedBotTurn({
          tableId,
          trigger: "resume_ack",
          requestId: frame.requestId ?? null,
          frameTs: frame.ts
        });
        return;
      }

      for (const replayFrame of replay.frames) {
        connState.session.latestDeliveredSeqByTableId.set(tableId, replayFrame.seq);
        sendFrame(ws, replayFrame);
      }
      maybeScheduleSettledRollover(tableId);
      scheduleObservedBotTurn({
        tableId,
        trigger: "resume_replay",
        requestId: frame.requestId ?? null,
        frameTs: frame.ts
      });
      return;
    }

    if (frame.type === "table_rebuy" || frame.type === "rebuy") {
      const resolvedRoomId = resolveRoomId(frame);
      if (!resolvedRoomId.ok) {
        sendError(ws, connState, {
          code: resolvedRoomId.code,
          message: resolvedRoomId.message,
          requestId: frame.requestId ?? null
        });
        return;
      }
      const tableId = resolvedRoomId.roomId;
      if (isGuestSession(connState) || isGuestTableId(tableId)) {
        sendCommandResult(ws, connState, {
          requestId: frame.requestId ?? null,
          tableId,
          status: "rejected",
          reason: "rebuy_not_allowed"
        });
        return;
      }
      await enqueueTableCommand({
        tableId,
        commandName: "rebuy",
        run: async () => handleRebuyCommand({
          frame,
          ws,
          connState,
          tableId,
          loadAuthoritativeRebuyExecutor,
          restoreTableFromPersisted,
          broadcastStateSnapshots,
          broadcastTableState,
          broadcastResyncRequired,
          sendCommandResult,
          scheduleBotStep,
          scheduleSettledRolloverIfSettled: (tid) => maybeScheduleSettledRollover(tid),
          klog: klogSafe
        })
      });
      return;
    }

    if (frame.type === "table_leave" || frame.type === "leave") {
      const resolvedRoomId = resolveRoomId(frame, { allowMissing: true });
      if (!resolvedRoomId.ok) {
        sendError(ws, connState, {
          code: resolvedRoomId.code,
          message: resolvedRoomId.message,
          requestId: frame.requestId ?? null
        });
        return;
      }
      const tableId = resolvedRoomId.roomId || tableManager.resolveImplicitLeaveTableId({
        ws,
        userId: connState.session.userId
      });
      if (!tableId) {
        sendError(ws, connState, {
          code: "INVALID_ROOM_ID",
          message: "roomId is required",
          requestId: frame.requestId ?? null
        });
        return;
      }
      if (isGuestSession(connState)) {
        if (!isGuestTableId(tableId) || (connState.guestTableId && connState.guestTableId !== tableId)) {
          sendCommandResult(ws, connState, {
            requestId: frame.requestId ?? null,
            tableId,
            status: "rejected",
            reason: "guest_multiplayer_requires_account"
          });
          return;
        }
        await enqueueTableCommand({
          tableId,
          commandName: "guest_leave",
          dedupeKey: "guest_leave",
          run: async () => {
            const detached = tableManager.leave({
              ws,
              userId: connState.session.userId,
              tableId,
              requestId: frame.requestId
            });
            if (!detached?.ok) {
              sendCommandResult(ws, connState, {
                requestId: frame.requestId ?? null,
                tableId,
                status: "rejected",
                reason: detached?.code || "state_invalid"
              });
              return detached;
            }
            const hasLiveSocket = sessionStore.connectionsForUser(connState.session.userId)
              .some((socket) => tableSocketMatches(socket, tableId));
            const evicted = hasLiveSocket
              ? { ok: true, existed: false }
              : tableManager.evictTable(tableId);
            sendCommandResult(ws, connState, {
              requestId: frame.requestId ?? null,
              tableId,
              status: "accepted",
              reason: detached.changed === false ? "already_left" : null
            });
            klogSafe("ws_guest_table_evicted", {
              tableId,
              trigger: "explicit_leave",
              requestId: frame.requestId ?? null,
              evicted: evicted?.existed === true
            });
            return {
              ok: true,
              changed: detached.changed === true || evicted?.existed === true,
              closed: evicted?.existed === true,
              status: evicted?.existed === true ? "guest_evicted" : "guest_leave_detached"
            };
          }
        });
        return;
      }
      await enqueueTableCommand({
        tableId,
        commandName: "leave",
        run: async () => handleLeaveCommand({
          frame,
          ws,
          connState,
          tableId,
          tableManager,
          loadAuthoritativeLeaveExecutor,
          sendCommandResult,
          broadcastStateSnapshots,
          broadcastTableState,
          scheduleBotStep,
          klog: klogSafe
        })
      });
      return;
    }

    if (frame.type === "table_state_sub") {
      const resolvedRoomId = resolveRoomId(frame);
      if (!resolvedRoomId.ok) {
        sendError(ws, connState, {
          code: resolvedRoomId.code,
          message: resolvedRoomId.message,
          requestId: frame.requestId ?? null
        });
        return;
      }
      const tableId = resolvedRoomId.roomId;

      if (isGuestSession(connState)) {
        if (!isGuestTableId(tableId) || (connState.guestTableId && connState.guestTableId !== tableId)) {
          sendError(ws, connState, {
            code: "INVALID_COMMAND",
            message: "guest_multiplayer_requires_account",
            requestId: frame.requestId ?? null
          });
          return;
        }
        tableManager.materializeGuestTable({
          tableId,
          guestUserId: connState.session.userId,
          nickname: connState.session.nickname || connState.nickname || null,
          nowMs: Date.now()
        });
      }

      const wantsSnapshot = frame.payload?.view === "snapshot" || frame.payload?.mode === "snapshot";
      if (wantsSnapshot) {
        const ensured = await tableManager.ensureTableLoaded(tableId);
        if (!ensured.ok) {
          const loadError = mapEnsureTableLoadedError(ensured);
          sendError(ws, connState, {
            code: loadError.code,
            message: loadError.message,
            requestId: frame.requestId ?? null
          });
          return;
        }

        await tableManager.refreshPublicProfiles(tableId);
        const tableSnapshot = tableManager.tableSnapshot(tableId, connState.session.userId);
        sendStateSnapshot(ws, connState, { requestId: frame.requestId ?? null, tableSnapshot });
        maybeScheduleSettledRollover(tableId);
        maybeTouchPersistedSeatLastSeen(ws, connState);
        return;
      }

      const ensured = await tableManager.ensureTableLoaded(tableId);
      if (!ensured.ok) {
        const loadError = mapEnsureTableLoadedError(ensured);
        sendError(ws, connState, {
          code: loadError.code,
          message: loadError.message,
          requestId: frame.requestId ?? null
        });
        return;
      }

      const subscribed = tableManager.subscribe({
        ws,
        tableId,
        userId: connState.session.userId,
        nowTs: Date.now()
      });
      if (!subscribed.ok) {
        sendError(ws, connState, {
          code: "INVALID_COMMAND",
          message: subscribed.message,
          requestId: frame.requestId ?? null
        });
        return;
      }

      await tableManager.refreshPublicProfiles(tableId);
      const tableSnapshot = tableManager.tableSnapshot(tableId, connState.session.userId);
      sendTableState(ws, connState, { requestId: frame.requestId ?? null, tableState: subscribed.tableState, tableSnapshot });
      maybeScheduleSettledRollover(tableId);
      maybeTouchPersistedSeatLastSeen(ws, connState);
      scheduleObservedBotTurn({
        tableId,
        trigger: "table_state_sub",
        requestId: frame.requestId ?? null,
        frameTs: frame.ts
      });
      return;
    }

    if (frame.type === "table_snapshot") {
      const resolvedRoomId = resolveRoomId(frame);
      if (!resolvedRoomId.ok) {
        sendError(ws, connState, {
          code: resolvedRoomId.code,
          message: resolvedRoomId.message,
          requestId: frame.requestId ?? null
        });
        return;
      }
      const tableId = resolvedRoomId.roomId;
      const loaded = await tableSnapshotLoader({ tableId, userId: connState.session.userId, nowMs: Date.now() });
      if (!loaded?.ok || !loaded?.snapshot) {
        const snapshotFailureCode = TABLE_SNAPSHOT_KNOWN_FAILURE_CODES.has(loaded?.code) ? loaded.code : "snapshot_failed";
        sendError(ws, connState, {
          code: "INVALID_COMMAND",
          message: snapshotFailureCode,
          requestId: frame.requestId ?? null
        });
        return;
      }
      sendGameplaySnapshot(ws, connState, { requestId: frame.requestId ?? null, tableId, snapshot: loaded.snapshot });
      maybeTouchPersistedSeatLastSeen(ws, connState);
      return;
    }

    if (frame.type === "act") {
      const resolvedRoomId = resolveRoomId(frame);
      if (!resolvedRoomId.ok) {
        sendError(ws, connState, {
          code: resolvedRoomId.code,
          message: resolvedRoomId.message,
          requestId: frame.requestId ?? null
        });
        return;
      }
      frame.__resolvedTableId = resolvedRoomId.roomId;
      await enqueueTableCommand({
        tableId: frame.__resolvedTableId,
        commandName: "act",
        run: async () => handleActCommand({
          frame,
          ws,
          connState,
          tableManager,
          ensureTableLoadedErrorMapper: mapEnsureTableLoadedError,
          sendError,
          sendCommandResult,
          persistMutatedState,
          restoreTableFromPersisted,
          broadcastResyncRequired,
          broadcastStateSnapshots,
          durableActionRequired: hasSupabaseDbUrl && !isGuestTableId(frame.__resolvedTableId),
          durableActionStore,
          scheduleSettledRollover: maybeScheduleSettledRollover,
          scheduleBotStep,
          klog: klogSafe
        })
      });
      maybeTouchPersistedSeatLastSeen(ws, connState);
      return;
    }

    if (frame.type === "start_hand") {
      const resolvedRoomId = resolveRoomId(frame);
      if (!resolvedRoomId.ok) {
        sendError(ws, connState, {
          code: resolvedRoomId.code,
          message: resolvedRoomId.message,
          requestId: frame.requestId ?? null
        });
        return;
      }
      frame.__resolvedTableId = resolvedRoomId.roomId;
      await enqueueTableCommand({
        tableId: frame.__resolvedTableId,
        commandName: "start_hand",
        run: async () => handleStartHandCommand({
          frame,
          ws,
          connState,
          tableManager,
          ensureTableLoadedErrorMapper: mapEnsureTableLoadedError,
          sendError,
          sendCommandResult,
          persistMutatedState,
          restoreTableFromPersisted,
          broadcastResyncRequired,
          broadcastStateSnapshots,
          scheduleBotStep,
          klog: klogSafe
        })
      });
      return;
    }

    sendFrame(
      ws,
      makeErrorFrame({
        code: "INVALID_COMMAND",
        message: `Unsupported command type: ${frame.type}`,
        requestId: frame.requestId ?? null,
        sessionId: connState.sessionId,
        ts: nowTs()
      })
    );
  }

  ws.on("message", (msg, isBinary) => {
    if (connState.transportTerminationStarted === true) {
      return;
    }
    acknowledgeTransportEvidence(connState);
    messageQueue = messageQueue
      .then(() => processMessage(msg, isBinary))
      .catch((error) => {
        klogSafe("ws_message_processing_error", { message: error?.message || "unknown" });
        try {
          sendFrame(
            ws,
            makeErrorFrame({
              code: "INTERNAL_ERROR",
              message: "internal_server_error",
              requestId: null,
              sessionId: connState.sessionId,
              ts: nowTs()
            })
          );
        } catch {
          ws.close(1011);
        }
      });
  });

  ws.on("pong", () => {
    if (connState.transportTerminationStarted === true) {
      return;
    }
    acknowledgeTransportEvidence(connState);
  });

  const cleanupConnectionOnce = () => {
    if (connectionCleanupStarted) {
      return;
    }
    connectionCleanupStarted = true;
    lobbySubscribers.delete(ws);
    sessionStore.untrackConnection({ ws, userId: connState.session.userId });
    const cleanupUpdates = tableManager.cleanupConnection({
      ws,
      userId: connState.session.userId,
      nowTs: Date.now(),
      activeSockets: sessionStore.connectionsForUser(connState.session.userId)
    });
    for (const update of cleanupUpdates) {
      broadcastTableState(update.tableId);
      if (update && update.disconnectedUserId) {
        enqueueDisconnectCleanupCandidate({ tableId: update.tableId, userId: update.disconnectedUserId });
      }
    }
    sweepExpiredSessionsOnly();
    void sweepDisconnectCleanupAndBroadcast();
  };

  ws.on("error", (err) => {
    cleanupConnectionOnce();
    klogSafe("ws_error", { message: err.message });
  });

  ws.on("close", () => {
    cleanupConnectionOnce();
  });
});

function terminateUnresponsiveTransport(ws, connState, { ageMs, reason }) {
  klogSafe("ws_transport_watchdog_terminated", {
    sessionId: connState?.session?.sessionId || connState?.sessionId || null,
    userId: connState?.session?.userId || null,
    reason,
    ageMs,
    timeoutMs: transportPongTimeoutMs
  });
  try {
    ws.terminate();
  } catch (error) {
    klogSafe("ws_transport_watchdog_terminate_failed", {
      sessionId: connState?.session?.sessionId || connState?.sessionId || null,
      reason,
      message: error?.message || "unknown"
    });
  }
}

function sweepTransportWatchdog() {
  const nowMs = Date.now();
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN) {
      continue;
    }
    const connState = ws.__connState;
    const decision = decideTransportWatchdogAction(connState, {
      nowMs,
      timeoutMs: transportPongTimeoutMs
    });
    if (decision.action === "ping") {
      try {
        ws.ping();
        markTransportPingSent(connState, decision.nowMs);
      } catch (error) {
        if (beginTransportTermination(connState)) {
          terminateUnresponsiveTransport(ws, connState, {
            ageMs: 0,
            reason: "ping_failed"
          });
        }
      }
      continue;
    }
    if (decision.action === "terminate") {
      terminateUnresponsiveTransport(ws, connState, {
        ageMs: decision.ageMs,
        reason: decision.reason
      });
    }
  }
}

async function materializeCreatedContinuousBotTable({ tableId, created = false }) {
  return enqueueTableCommand({
    tableId,
    commandName: "continuous_bot_table_materialize",
    dedupeKey: "continuous_bot_table_materialize",
    run: async () => {
      const restored = await restoreTableFromPersisted(tableId);
      if (!restored?.ok) return restored;
      const meta = tableManager.tableMeta(tableId);
      if (meta?.lifecycleKind === "CONTINUOUS_BOT") {
        klogSafe("ws_continuous_bot_table_runtime_metadata", {
          tableId,
          created,
          lifecycleKind: meta.lifecycleKind,
          managedProfileKey: meta.managedProfileKey,
          rotationDueAtMs: meta.rotationDueAtMs,
          typeofRotationDueAtMs: typeof meta.rotationDueAtMs,
          isFiniteRotationDueAtMs: Number.isFinite(meta.rotationDueAtMs)
        });
      }
      const expectedVersion = tableManager.persistedStateVersion(tableId);
      const bootstrapped = tableManager.bootstrapHand(tableId, {
        nowMs: Date.now(),
        allowManagedBotsOnly: true
      });
      if (!bootstrapped?.ok) return bootstrapped;
      let stateVersion = bootstrapped.stateVersion;
      if (bootstrapped.changed) {
        const persisted = await persistMutatedState({
          tableId,
          expectedVersion,
          mutationKind: "continuous_bot_table_bootstrap"
        });
        if (!persisted?.ok) {
          await restoreTableFromPersisted(tableId);
          return persisted;
        }
        stateVersion = persisted.newVersion;
      }
      syncLobbyTable(tableId);
      maybeBroadcastLobbySnapshot({ force: true });
      broadcastStateSnapshots(tableId);
      scheduleBotStep({ tableId, trigger: "continuous_bot_table_created", requestId: null, frameTs: null });
      if (created) {
        klogSafe("ws_continuous_bot_table_created", { tableId, stateVersion });
      } else {
        klogSafe("ws_continuous_bot_table_restored", { tableId, stateVersion });
      }
      return { ok: true, changed: bootstrapped.changed === true, stateVersion };
    }
  });
}

async function retireManagedTableAfterReplacementConflict({ tableId, generationKey, attempt }) {
  return retireManagedTableAfterReplacementConflictFlow({
    tableId,
    generationKey,
    attempt,
    requestRetirement: (requestedTableId) => continuousBotTableRepository?.requestRetirement?.(requestedTableId),
    markRetirementRequested: (requestedTableId) => continuousBotRetirementRequested.add(requestedTableId),
    restoreTableFromPersisted,
    markTableRotationDue: (requestedTableId, dueAtMs) => tableManager.markTableRotationDue?.(requestedTableId, dueAtMs),
    scheduleSettledRolloverRetry: (requestedTableId, requestedGenerationKey, requestedAttempt) => {
      scheduleSettledRolloverRetry({
        tableId: requestedTableId,
        generationKey: requestedGenerationKey,
        attempt: requestedAttempt
      });
    },
    broadcastStateSnapshots,
    hasActiveHumanMember: (requestedTableId) => tableManager.hasActiveHumanMember(requestedTableId),
    hasConnectedHumanPresence: (requestedTableId) => tableManager.hasConnectedHumanPresence(requestedTableId),
    applyInactiveCleanupAndBroadcast
  });
}

async function requestContinuousBotTableRetirement({ tableId, forceQueue = false }) {
  if (continuousBotRetirementRequested.has(tableId)) return { ok: true, changed: false, reason: "already_requested" };
  const persisted = await continuousBotTableRepository?.requestRetirement?.(tableId);
  if (!persisted?.ok) {
    return persisted || { ok: false, reason: "retirement_request_unavailable" };
  }
  if (!forceQueue && persisted.changed !== true) return persisted;
  continuousBotRetirementRequested.add(tableId);
  return enqueueTableCommand({
    tableId,
    commandName: "continuous_bot_table_retirement",
    dedupeKey: "continuous_bot_table_retirement",
    run: async () => {
      const restored = await restoreTableFromPersisted(tableId);
      if (!restored?.ok) {
        continuousBotRetirementRequested.delete(tableId);
        return restored;
      }
      klogSafe("ws_continuous_bot_table_retirement_requested", {
        tableId,
        phase: tableManager.persistedPokerState(tableId)?.phase || null
      });
      maybeScheduleSettledRollover(tableId);
      return { ok: true, changed: false };
    }
  });
}

const continuousBotTableSupervisor = continuousBotTableRepository
  ? createContinuousBotTableSupervisor({
      repository: continuousBotTableRepository,
      onCreatedTable: materializeCreatedContinuousBotTable,
      onRetirementRequested: ({ tableId }) => requestContinuousBotTableRetirement({ tableId, forceQueue: true }),
      onRotationScheduled: async ({ tableId, rotationDueAt }) => {
        const dueAtMs = Date.parse(rotationDueAt);
        const marked = tableManager.setTableRotationDueAt(tableId, dueAtMs);
        if (!marked?.ok) return marked;
        klogSafe("ws_continuous_bot_table_rotation_scheduled", { tableId, rotationDueAt: dueAtMs });
        maybeScheduleSettledRollover(tableId);
        return marked;
      },
      klog: klogSafe
    })
  : null;

const transportWatchdogTimer = setInterval(() => {
  sweepTransportWatchdog();
}, transportWatchdogSweepMs);
transportWatchdogTimer.unref();


const timeoutSweepIntervalMs = Number(process.env.WS_TIMEOUT_SWEEP_MS || 250);
const timeoutSweepTimer = setInterval(() => {
  void sweepTurnTimeoutsAndBroadcast();
}, Number.isFinite(timeoutSweepIntervalMs) && timeoutSweepIntervalMs > 0 ? timeoutSweepIntervalMs : 250);

timeoutSweepTimer.unref();

const disconnectCleanupSweepMs = Number(process.env.WS_DISCONNECT_CLEANUP_SWEEP_MS || 500);
const disconnectCleanupTimer = setInterval(() => {
  void sweepDisconnectCleanupAndBroadcast();
}, Number.isFinite(disconnectCleanupSweepMs) && disconnectCleanupSweepMs > 0 ? disconnectCleanupSweepMs : 500);
disconnectCleanupTimer.unref();

const staleActiveSeatSweepMs = resolvePositiveInt(process.env.WS_STALE_ACTIVE_SEAT_SWEEP_MS, 30_000, { min: 500, max: 60_000 });
const staleActiveSeatSweepTimer = setInterval(() => {
  void sweepStaleActiveHumanSeatsAndBroadcast();
}, staleActiveSeatSweepMs);
staleActiveSeatSweepTimer.unref();

const zombieTableSweepMs = Number(process.env.WS_ZOMBIE_TABLE_SWEEP_MS || 30_000);
const zombieTableSweepTimer = setInterval(() => {
  void sweepZombieTablesAndBroadcast();
}, Number.isFinite(zombieTableSweepMs) && zombieTableSweepMs > 0 ? zombieTableSweepMs : 30_000);
zombieTableSweepTimer.unref();

const openTableJanitorSweepMs = resolvePositiveInt(process.env.WS_OPEN_TABLE_JANITOR_SWEEP_MS, 60_000, {
  min: 5_000,
  max: 300_000
});
const openTableJanitorSweepTimer = setInterval(() => {
  void sweepOpenTableJanitorAndBroadcast();
}, openTableJanitorSweepMs);
openTableJanitorSweepTimer.unref();

const lobbyVisibilitySweepMs = resolvePositiveInt(process.env.WS_LOBBY_VISIBILITY_SWEEP_MS, 1_000, { min: 250, max: 60_000 });
const lobbyVisibilitySweepTimer = setInterval(() => {
  maybeBroadcastLobbySnapshot();
}, lobbyVisibilitySweepMs);
lobbyVisibilitySweepTimer.unref();

// --- Action history retention cleanup ---------------------------------
// Validation (action=0 + settled>0, settled<action) is inside the module.

const actionHistoryCleanupSweepMs = resolvePositiveInt(
  process.env.WS_POKER_ACTION_HISTORY_SWEEP_MS, 300_000, { min: 30_000, max: 3_600_000 }
);

const actionHistoryCleanup = hasSupabaseDbUrl
  ? createActionHistoryCleanup({
      env: process.env,
      maxSweepRounds: loadReleaseMetadata().environment === "preview" ? 10 : 1,
      klog: klogSafe
    })
  : null;

// Closed-table retention cleanup runs AFTER the action-history sweep on the
// same timer, so table rows are only deleted once their action/hole-card
// history has been retained away. Runtime-loaded tables are excluded through
// tableManager.beginTableRetirement/endTableRetirement.
const closedTableCleanup = hasSupabaseDbUrl
  ? createClosedTableCleanup({
      env: process.env,
      maxSweepRounds: loadReleaseMetadata().environment === "preview" ? 10 : 1,
      klog: klogSafe
    })
  : null;

if (actionHistoryCleanup || closedTableCleanup) {
  const actionHistoryCleanupTimer = setInterval(() => {
    void actionHistoryCleanup.sweep().finally(() => {
      if (!closedTableCleanup) return;
      void closedTableCleanup.sweep({
        claimTableIds: (candidateIds) => tableManager.beginTableRetirement(candidateIds),
        releaseTableIds: (claimedIds) => tableManager.endTableRetirement(claimedIds)
      });
    });
  }, actionHistoryCleanupSweepMs);
  actionHistoryCleanupTimer.unref();
}

// -----------------------------------------------------------------------

async function startServer() {
  const release = loadReleaseMetadata();
  klogSafe("ws_artifact_start", {
    releaseSha: release.releaseSha || null,
    deployRef: release.deployRef || null,
    environment: release.environment || "unknown"
  });
  continuousBotTableSupervisor?.start();
  server.listen(PORT, "0.0.0.0", () => {
    klogSafe("ws_listening", { message: `WS listening on ${PORT}`, port: PORT });
  });
}

void startServer();
