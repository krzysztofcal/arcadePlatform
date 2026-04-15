import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { MAX_FRAME_BYTES } from "./poker/protocol/constants.mjs";
import { makeErrorFrame, parseFrame, validateEnvelope } from "./poker/protocol/envelope.mjs";
import { handleHello } from "./poker/handlers/hello.mjs";
import { handlePing } from "./poker/handlers/ping.mjs";
import { handleAuth } from "./poker/handlers/auth.mjs";
import { handleProtectedEcho } from "./poker/handlers/protected-echo.mjs";
import { verifyToken } from "./poker/auth/verify-token.mjs";
import { createConnState } from "./poker/runtime/conn-state.mjs";
import { ackSessionSeq, touchSession } from "./poker/runtime/session.mjs";
import { recordProtocolViolation, shouldClose } from "./poker/runtime/conn-guards.mjs";
import { createTableManager } from "./poker/table/table-manager.mjs";
import { adaptPersistedBootstrap } from "./poker/bootstrap/persisted-bootstrap-adapter.mjs";
import { createSessionStore } from "./poker/runtime/session-store.mjs";
import { createDisconnectCleanupRuntime } from "./poker/runtime/disconnect-cleanup.mjs";
import { buildStateSnapshotPayload } from "./poker/read-model/state-snapshot.mjs";
import { buildStatePatch } from "./poker/read-model/state-patch.mjs";
import { createStreamLog } from "./poker/runtime/stream-log.mjs";
import { createPersistedStateWriter } from "./poker/persistence/persisted-state-writer.mjs";
import { createTableSnapshotLoader } from "./poker/table/table-snapshot.mjs";
import { handleJoinCommand } from "./poker/handlers/join.mjs";
import { handleActCommand } from "./poker/handlers/act.mjs";
import { handleStartHandCommand } from "./poker/handlers/start-hand.mjs";
import { handleTurnTimeoutCommand } from "./poker/handlers/turn-timeout.mjs";
import { handleBotStepCommand } from "./poker/handlers/bot-autoplay.mjs";
import { handleLeaveCommand } from "./poker/handlers/leave.mjs";
import { createTableCommandQueue } from "./poker/runtime/table-command-queue.mjs";
import { recoverFromPersistConflict } from "./poker/runtime/persist-conflict-recovery.mjs";
import { resolveSettledRevealDueAt } from "./poker/runtime/settled-reveal-timing.mjs";
import { parseStakes } from "../shared/poker-domain/bots.mjs";

const PORT = Number(process.env.PORT || 3000);
const PROTECTED_MESSAGE_TYPES = new Set([
  "protected_echo",
  "join",
  "leave",
  "table_join",
  "table_leave",
  "lobby_subscribe",
  "table_state_sub",
  "table_snapshot",
  "act",
  "start_hand",
  "resync",
  "resume",
  "ack"
]);
const REQUEST_ID_REQUIRED_TYPES = new Set(["join", "leave", "table_join", "table_leave", "lobby_subscribe", "table_state_sub", "table_snapshot", "act", "start_hand", "resync", "resume"]);
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

function resolvePresenceTtlMs(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 10_000;
  }
  return parsed;
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

function resolveSettledRevealMs(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 4_000;
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
    return adaptPersistedBootstrap({
      tableId,
      tableRow: loaded?.tableRow,
      seatRows: loaded?.seatRows,
      stateRow: loaded?.stateRow
    });
  };
}

const loadPersistedTableBootstrap = persistedBootstrapEnabled ? createPersistedBootstrapLoader() : null;

const tableManager = createTableManager({
  presenceTtlMs: resolvePresenceTtlMs(process.env.WS_PRESENCE_TTL_MS),
  maxSeats: resolveMaxSeats(process.env.WS_MAX_SEATS),
  actionResultCacheMax: resolveActionResultCacheMax(process.env.WS_ACTION_RESULT_CACHE_MAX),
  tableBootstrapLoader: loadPersistedTableBootstrap,
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
const streamLog = createStreamLog({ cap: Number(process.env.WS_STREAM_REPLAY_CAP || 128) });
const tableSnapshotLoader = createTableSnapshotLoader({ env: process.env });
const persistedStateWriter = persistedStateWriteEnabled ? createPersistedStateWriter({ env: process.env, klog: klogSafe }) : null;
const lastSnapshotBySessionAndTable = new Map();
const lobbySubscribers = new Set();
const activeLobbyTablesById = new Map();
const lobbyEmptyJoinableGraceMs = resolveEmptyJoinableGraceMs(process.env.POKER_TABLE_CLOSE_GRACE_MS);
const internalRuntimeToken = typeof process.env.POKER_WS_INTERNAL_TOKEN === "string" ? process.env.POKER_WS_INTERNAL_TOKEN.trim() : "";

function snapshotCacheKey(sessionId, tableId) {
  return `${sessionId}:${tableId}`;
}


let authoritativeLeaveExecutorPromise = null;
let authoritativeJoinExecutorPromise = null;
let inactiveCleanupExecutorPromise = null;
let acceptedBotAutoplayExecutorPromise = null;
let beginSqlWsLoaderPromise = null;
const timeoutFailureTrackerByTableId = new Map();
const settledRolloverTimerByTableId = new Map();
const TURN_TIMEOUT_FATAL_PREFIXES = ["showdown_"];
const TURN_TIMEOUT_FATAL_REASONS = new Set(["timeout_apply_failed"]);
const DEFAULT_INACTIVE_CLEANUP_ADAPTER_URL = new URL("./poker/persistence/inactive-cleanup-adapter.mjs", import.meta.url).href;
const DEFAULT_ACCEPTED_BOT_AUTOPLAY_ADAPTER_URL = new URL("./poker/runtime/accepted-bot-autoplay-adapter.mjs", import.meta.url).href;
const settledRevealMs = resolveSettledRevealMs(process.env.WS_POKER_SETTLED_REVEAL_MS);

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

async function loadAuthoritativeJoinExecutor() {
  if (!authoritativeJoinExecutorPromise) {
    authoritativeJoinExecutorPromise = import("./poker/persistence/authoritative-join-adapter.mjs")
      .then((module) => module.createAuthoritativeJoinExecutor({ env: process.env, klog: klogSafe }));
  }
  return authoritativeJoinExecutorPromise;
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
          onBotStepPersisted: ({ tableId }) => {
            broadcastStateSnapshots(tableId);
          },
          env: process.env,
          klog: klogSafe
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

const turnTimeoutFailureThreshold = resolvePositiveInt(process.env.WS_TIMEOUT_FAILURE_THRESHOLD, 5, { min: 1, max: 100 });
const turnTimeoutQuarantineMs = resolvePositiveInt(process.env.WS_TIMEOUT_QUARANTINE_MS, 300_000, {
  min: 5_000,
  max: 86_400_000
});

function klog(kind, data) {
  const payload = data && typeof data === "object" ? ` ${JSON.stringify(data)}` : "";
  process.stdout.write(`[klog] ${kind}${payload}\n`);
}


function klogSafe(kind, data) {
  try {
    klog(kind, data);
  } catch {
    // Logging must never break request handling.
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

function nextEventLoopTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function buildAutoplayStartSnapshot(tableId) {
  const state = tableManager.persistedPokerState(tableId);
  const stateVersion = Number(tableManager.persistedStateVersion(tableId) || 0);
  return {
    stateVersionBeforeAutoplay: stateVersion || null,
    turnUserIdBeforeAutoplay: typeof state?.turnUserId === "string" ? state.turnUserId : null,
    phaseBeforeAutoplay: typeof state?.phase === "string" ? state.phase : null
  };
}

async function runBotStep({ tableId, trigger, requestId, frameTs }) {
  const acceptedBotAutoplayExecutor = await loadAcceptedBotAutoplayExecutor();
  const startSnapshot = buildAutoplayStartSnapshot(tableId);
  klogSafe("ws_bot_autoplay_start", {
    tableId,
    requestId: requestId || null,
    trigger: trigger || null,
    stateVersion_before_autoplay: startSnapshot.stateVersionBeforeAutoplay,
    turnUserId_before_autoplay: startSnapshot.turnUserIdBeforeAutoplay,
    phase_before_autoplay: startSnapshot.phaseBeforeAutoplay
  });
  return acceptedBotAutoplayExecutor({ tableId, trigger, requestId, frameTs });
}

function scheduleBotStep({ tableId, trigger, requestId, frameTs }) {
  const enqueueStep = () => enqueueTableCommand({
    tableId,
    commandName: "bot_step",
    dedupeKey: "bot_step",
    run: async () => handleBotStepCommand({
      tableId,
      trigger,
      requestId,
      frameTs,
      runBotStep,
      broadcastStateSnapshots,
      klog: klogSafe
    })
  });

  const runCascade = () => {
    const queued = enqueueStep();
    void queued
      .then((result) => {
        if (result?.ok === true && result?.shouldContinue === true) {
          setImmediate(() => {
            void runCascade();
          });
        }
      })
      .catch(() => {});
    return queued;
  };
  return runCascade();
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

function buildTableStatePayload({ tableState, tableSnapshot }) {
  const payload = {
    tableId: tableState.tableId,
    members: Array.isArray(tableState.members) ? tableState.members : []
  };

  if (!tableSnapshot || typeof tableSnapshot !== "object") {
    return payload;
  }

  if (typeof tableSnapshot.roomId === "string" && tableSnapshot.roomId) payload.roomId = tableSnapshot.roomId;
  if (Number.isInteger(tableSnapshot.stateVersion)) payload.stateVersion = tableSnapshot.stateVersion;
  if (Number.isInteger(tableSnapshot.memberCount)) payload.memberCount = tableSnapshot.memberCount;
  if (Number.isInteger(tableSnapshot.maxSeats)) payload.maxSeats = tableSnapshot.maxSeats;
  if (Number.isInteger(tableSnapshot.youSeat)) payload.youSeat = tableSnapshot.youSeat;
  if (Number.isInteger(tableSnapshot.dealerSeatNo)) payload.dealerSeatNo = tableSnapshot.dealerSeatNo;
  if (Array.isArray(tableSnapshot.seats)) payload.seats = tableSnapshot.seats;
  if (tableSnapshot.stacks && typeof tableSnapshot.stacks === "object" && !Array.isArray(tableSnapshot.stacks)) payload.stacks = tableSnapshot.stacks;
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
  if (tableSnapshot.actionConstraints && typeof tableSnapshot.actionConstraints === "object") payload.actionConstraints = tableSnapshot.actionConstraints;
  if (Array.isArray(tableSnapshot.members)) payload.authoritativeMembers = tableSnapshot.members;
  if (tableSnapshot.showdown && typeof tableSnapshot.showdown === "object") payload.showdown = tableSnapshot.showdown;
  if (tableSnapshot.handSettlement && typeof tableSnapshot.handSettlement === "object") payload.handSettlement = tableSnapshot.handSettlement;

  return payload;
}

function sendTableState(ws, connState, { requestId = null, tableState, tableSnapshot = null }) {
  const frame = {
    version: "1.0",
    type: "table_state",
    ts: nowTs(),
    roomId: tableState.tableId,
    sessionId: connState.sessionId,
    payload: buildTableStatePayload({ tableState, tableSnapshot })
  };

  if (requestId) {
    frame.requestId = requestId;
  }

  return recordStatefulFrame({ ws, connState, tableId: tableState.tableId, frame });
}

function sendStateSnapshot(ws, connState, { requestId = null, tableSnapshot, reason = null }) {
  maybeScheduleSettledRollover(tableSnapshot.tableId);
  const payload = buildStateSnapshotPayload({
    tableSnapshot,
    userId: connState.session.userId
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
  const payload = buildStateSnapshotPayload({
    tableSnapshot,
    userId: connState.session.userId
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

function sendCommandResult(ws, connState, { requestId = null, tableId = null, status, reason = null }) {
  const frame = {
    version: "1.0",
    type: "commandResult",
    ts: nowTs(),
    sessionId: connState.sessionId,
    payload: {
      requestId,
      status,
      reason
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
  maybeScheduleSettledRollover(tableId);
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




async function persistMutatedState({ tableId, expectedVersion, mutationKind }) {
  if (!persistedStateWriter) {
    return { ok: true, skipped: true };
  }
  const nextState = tableManager.persistedPokerState(tableId);
  if (!nextState) {
    return { ok: false, reason: "invalid_state" };
  }
  klogSafe("ws_state_persist_start", { tableId, expectedVersion, mutationKind });
  const persisted = await persistedStateWriter.writeMutation({
    tableId,
    expectedVersion,
    nextState,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    meta: { mutationKind }
  });
  if (!persisted?.ok) {
    klogSafe("ws_state_persist_failed", { tableId, expectedVersion, mutationKind, reason: persisted?.reason || "unknown" });
    return persisted;
  }
  klogSafe("ws_state_persist_result", { ok: true, newVersion: persisted.newVersion ?? null });
  tableManager.setPersistedStateVersion(tableId, persisted.newVersion);
  return persisted;
}

async function restoreTableFromPersisted(tableId) {
  if (typeof loadPersistedTableBootstrap !== "function") {
    return { ok: false, reason: "persisted_bootstrap_disabled" };
  }
  try {
    klogSafe("ws_restore_load_start", { tableId });
    const restored = await loadPersistedTableBootstrap({ tableId });
    klogSafe("ws_restore_load_result", {
      ok: restored?.ok === true,
      hasTable: Boolean(restored?.table),
      version: restored?.table?.coreState?.version ?? null
    });
    if (!restored?.ok || !restored?.table) {
      return { ok: false, reason: restored?.code || "restore_failed" };
    }
    const applied = tableManager.restoreTableFromPersisted(tableId, restored.table);
    klogSafe("ws_restore_apply_result", { ok: applied?.ok === true });
    if (!applied?.ok) {
      return applied;
    }
    return {
      ...applied,
      restoredTable: restored.table
    };
  } catch (error) {
    klogSafe("ws_state_restore_failed", { tableId, message: error?.message || "unknown" });
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
  if (result?.changed === true) {
    klogSafe(`${logPrefix}_restore_start`, { tableId, status: result?.status || null });
    const restored = await restoreTableFromPersisted(tableId);
    if (!restored?.ok) {
      klogSafe(`${logPrefix}_restore_failed`, { tableId, reason: restored?.reason || "unknown" });
      return result;
    }
    klogSafe(`${logPrefix}_restore_success`, { tableId, status: result?.status || null });
    broadcastStateSnapshots(tableId);
    broadcastTableState(tableId);
  }
  return result;
}

function maybeScheduleSettledRollover(tableId) {
  if (settledRevealMs <= 0) {
    clearSettledRolloverTimer(tableId);
    return;
  }

  const pokerState = tableManager.persistedPokerState(tableId);
  if (!pokerState || pokerState.phase !== "SETTLED") {
    clearSettledRolloverTimer(tableId);
    return;
  }

  const nowMs = Date.now();
  const dueAt = resolveSettledRevealDueAt({
    settledAt: pokerState?.handSettlement?.settledAt || null,
    nowMs,
    revealMs: settledRevealMs
  });
  const existing = settledRolloverTimerByTableId.get(tableId);
  if (existing && existing.dueAt === dueAt) {
    return;
  }

  clearSettledRolloverTimer(tableId);
  const delayMs = Math.max(0, dueAt - nowMs);
  const timer = setTimeout(() => {
    settledRolloverTimerByTableId.delete(tableId);
    void enqueueTableCommand({
      tableId,
      commandName: "settled_rollover",
      dedupeKey: "settled_rollover",
      run: async () => {
        if (!tableManager.hasActiveHumanMember(tableId)) {
          if (tableManager.hasConnectedHumanPresence(tableId)) {
            klogSafe("ws_settled_rollover_close_skipped_human_presence", {
              tableId,
              phase: pokerState?.phase || null
            });
            return {
              ok: true,
              changed: false,
              deferred: true,
              reason: "human_presence_present"
            };
          }
          return applyInactiveCleanupAndBroadcast({
            tableId,
            requestId: `ws-settled-rollover-close:${tableId}`,
            logPrefix: "ws_settled_rollover_close"
          });
        }
        const rollover = tableManager.rolloverSettledHand({ tableId, nowMs: Date.now() });
        if (!rollover?.ok) {
          return rollover;
        }
        if (!rollover.changed) {
          return rollover;
        }

        const persisted = await persistMutatedState({
          tableId,
          expectedVersion: Number(rollover.stateVersion) - 1,
          mutationKind: "settled_rollover"
        });
        if (!persisted?.ok) {
          await recoverFromPersistConflict({
            tableId,
            restoreTableFromPersisted,
            broadcastStateSnapshots,
            broadcastResyncRequired
          });
          return {
            ok: false,
            changed: false,
            reason: persisted?.reason || "persist_failed",
            stateVersion: rollover.stateVersion
          };
        }

        broadcastStateSnapshots(tableId);
        try {
          scheduleBotStep({
            tableId,
            trigger: "settled_rollover",
            requestId: null,
            frameTs: null
          });
        } catch (error) {
          klogSafe("ws_settled_rollover_bot_autoplay_failed", {
            tableId,
            message: error?.message || "unknown"
          });
        }
        return rollover;
      }
    });
  }, delayMs);
  if (typeof timer?.unref === "function") {
    timer.unref();
  }
  settledRolloverTimerByTableId.set(tableId, { timer, dueAt });
}

function broadcastStateSnapshots(tableId) {
  maybeBroadcastLobbySnapshot();
  maybeScheduleSettledRollover(tableId);
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
    return enqueueTableCommand({
      tableId,
      commandName: "disconnect_cleanup",
      dedupeKey: `disconnect_cleanup:${userId}`,
      run: async () => {
        const executor = await loadInactiveCleanupExecutor();
        const result = await executor({ tableId, userId, requestId });
        if (result?.ok !== true) {
          return result;
        }
        if (result?.protected === true) {
          return result;
        }
        if (result?.changed === true) {
          klogSafe("ws_disconnect_cleanup_restore_start", { tableId, status: result?.status || null });
          const restored = await restoreTableFromPersisted(tableId);
          if (!restored?.ok) {
            klogSafe("ws_disconnect_cleanup_restore_failed", { tableId, reason: restored?.reason || "unknown" });
            return result;
          }
          klogSafe("ws_disconnect_cleanup_restore_success", { tableId });
          broadcastStateSnapshots(tableId);
          broadcastTableState(tableId);
          klogSafe("ws_disconnect_cleanup_broadcast_after_restore", { tableId });
          try {
            scheduleBotStep({
              tableId,
              trigger: "disconnect_cleanup",
              requestId: requestId || null,
              frameTs: null
            });
          } catch (error) {
            klogSafe("ws_disconnect_cleanup_schedule_bot_step_failed", {
              tableId,
              message: error?.message || "unknown"
            });
          }
          return result;
        }
        klogSafe("ws_disconnect_cleanup_noop", { tableId, status: result?.status || null });
        return result;
      }
    });
  },
  listActiveSocketsForUser: (userId) => sessionStore.connectionsForUser(userId),
  socketMatchesTable: (socket, tableId) => {
    const conn = socket && socket.__connState;
    const joined = conn?.joinedTableId || null;
    const subscribed = conn?.subscribedTableId || null;
    return joined === tableId || subscribed === tableId;
  },
  onChanged: async () => {},
  klog: klogSafe
});

function enqueueDisconnectCleanupCandidate({ tableId, userId }) {
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
    if (cleanupResult?.ok === true && cleanupResult?.changed === true) {
      const restored = await restoreTableFromPersisted(tableId);
      if (restored?.ok) {
        broadcastStateSnapshots(tableId);
        broadcastTableState(tableId);
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
  await Promise.allSettled(zombieTableIds.map((tableId) => enqueueTableCommand({
    tableId,
    commandName: "zombie_cleanup",
    dedupeKey: "zombie_cleanup",
    run: async () => {
      if (tableManager.hasConnectedHumanPresence(tableId)) {
        return { ok: true, changed: false, status: "human_presence_present" };
      }
      return applyInactiveCleanupAndBroadcast({
        tableId,
        requestId: `ws-zombie-cleanup:${tableId}`,
        logPrefix: "ws_zombie_cleanup"
      });
    }
  })));
}

async function sweepTurnTimeoutsAndBroadcast() {
  const nowMs = Date.now();
  const timeoutUpdates = tableManager.listDueTurnTimeouts({
    nowMs,
    shouldProcessTable: (tableId) => (
      tableManager.isTableClosed(tableId) !== true
      && !isTurnTimeoutTableQuarantined(tableId, nowMs)
    )
  });
  await Promise.allSettled(timeoutUpdates.map((update) => enqueueTableCommand({
    tableId: update.tableId,
    commandName: "turn_timeout",
    dedupeKey: "turn_timeout",
    run: async () => {
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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
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
  const materialized = tableManager.materializeLobbyTable({
    tableId,
    tableMeta: {
      maxPlayers,
      stakes: stakesParsed.value
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
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  if (req.url === "/internal/lobby/materialize-table") {
    await handleInternalLobbyMaterialize(req, res);
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
      await enqueueTableCommand({
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
          klog: klogSafe
        })
      });
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

        const resyncedSnapshot = tableManager.tableSnapshot(tableId, connState.session.userId);
        sendTableState(ws, connState, { requestId: frame.requestId ?? null, tableState: resynced.tableState, tableSnapshot: resyncedSnapshot });
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
        const tableSnapshot = tableManager.tableSnapshot(tableId, connState.session.userId);
        await nextEventLoopTurn();
        sendStateSnapshot(ws, connState, { tableSnapshot, reason: replay.reason });
        return;
      }

      if (replay.frames.length === 0) {
        sendResumeAck(ws, connState, { requestId: frame.requestId ?? null, tableId });
        return;
      }

      for (const replayFrame of replay.frames) {
        connState.session.latestDeliveredSeqByTableId.set(tableId, replayFrame.seq);
        sendFrame(ws, replayFrame);
      }
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

        const tableSnapshot = tableManager.tableSnapshot(tableId, connState.session.userId);
        sendStateSnapshot(ws, connState, { requestId: frame.requestId ?? null, tableSnapshot });
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

      const subscribed = tableManager.subscribe({ ws, tableId });
      if (!subscribed.ok) {
        sendError(ws, connState, {
          code: "INVALID_COMMAND",
          message: subscribed.message,
          requestId: frame.requestId ?? null
        });
        return;
      }

      const tableSnapshot = tableManager.tableSnapshot(tableId, connState.session.userId);
      sendTableState(ws, connState, { requestId: frame.requestId ?? null, tableState: subscribed.tableState, tableSnapshot });
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
          scheduleBotStep,
          klog: klogSafe
        })
      });
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

  ws.on("error", (err) => {
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
    klogSafe("ws_error", { message: err.message });
  });

  ws.on("close", () => {
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
  });
});


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

const zombieTableSweepMs = Number(process.env.WS_ZOMBIE_TABLE_SWEEP_MS || 30_000);
const zombieTableSweepTimer = setInterval(() => {
  void sweepZombieTablesAndBroadcast();
}, Number.isFinite(zombieTableSweepMs) && zombieTableSweepMs > 0 ? zombieTableSweepMs : 30_000);
zombieTableSweepTimer.unref();

const lobbyVisibilitySweepMs = resolvePositiveInt(process.env.WS_LOBBY_VISIBILITY_SWEEP_MS, 1_000, { min: 250, max: 60_000 });
const lobbyVisibilitySweepTimer = setInterval(() => {
  maybeBroadcastLobbySnapshot();
}, lobbyVisibilitySweepMs);
lobbyVisibilitySweepTimer.unref();

async function startServer() {
  server.listen(PORT, "0.0.0.0", () => {
    klogSafe("ws_listening", { message: `WS listening on ${PORT}`, port: PORT });
  });
}

void startServer();
