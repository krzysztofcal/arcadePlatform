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

const PORT = Number(process.env.PORT || 3000);
const PROTECTED_MESSAGE_TYPES = new Set([
  "protected_echo",
  "join",
  "leave",
  "table_join",
  "table_leave",
  "table_state_sub",
  "table_snapshot",
  "act",
  "start_hand",
  "resync",
  "resume",
  "ack"
]);
const REQUEST_ID_REQUIRED_TYPES = new Set(["join", "leave", "table_join", "table_leave", "table_state_sub", "table_snapshot", "act", "start_hand", "resync", "resume"]);
const TABLE_SNAPSHOT_KNOWN_FAILURE_CODES = new Set([
  "invalid_table_id",
  "table_not_found",
  "state_missing",
  "state_invalid",
  "contract_mismatch_empty_legal_actions"
]);
const SESSION_REBOUND_CLOSE_CODE = 4001;

function resolvePresenceTtlMs(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 10_000;
  }
  return parsed;
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

const persistedBootstrapEnabled = Boolean(process.env.SUPABASE_DB_URL || process.env.WS_PERSISTED_BOOTSTRAP_FIXTURES_JSON || process.env.WS_PERSISTED_STATE_FILE);
const persistedStateWriteEnabled = Boolean(process.env.SUPABASE_DB_URL || process.env.WS_PERSISTED_STATE_FILE);
const observeOnlyJoinEnabled = resolveObserveOnlyJoin(process.env.WS_OBSERVE_ONLY_JOIN);
const authoritativeJoinEnabled = String(process.env.WS_AUTHORITATIVE_JOIN_ENABLED || "").trim() === "1";

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

function snapshotCacheKey(sessionId, tableId) {
  return `${sessionId}:${tableId}`;
}


let authoritativeLeaveExecutorPromise = null;
let authoritativeJoinExecutorPromise = null;
let inactiveCleanupExecutorPromise = null;
let acceptedBotAutoplayExecutorPromise = null;
const DEFAULT_INACTIVE_CLEANUP_ADAPTER_URL = new URL("./poker/persistence/inactive-cleanup-adapter.mjs", import.meta.url).href;
const DEFAULT_ACCEPTED_BOT_AUTOPLAY_ADAPTER_URL = new URL("./poker/runtime/accepted-bot-autoplay-adapter.mjs", import.meta.url).href;

async function loadAuthoritativeLeaveExecutor() {
  if (!authoritativeLeaveExecutorPromise) {
    authoritativeLeaveExecutorPromise = import("./poker/persistence/authoritative-leave-adapter.mjs")
      .then((module) => module.createAuthoritativeLeaveExecutor({ env: process.env, klog: klogSafe }));
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
      return module.createInactiveCleanupExecutor({ env: process.env, klog: klogSafe });
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

function invalidateSocketSession(ws, { reason = "session_rebound", closeCode = SESSION_REBOUND_CLOSE_CODE } = {}) {
  if (!ws) {
    return;
  }
  const staleConnState = ws.__connState;
  if (staleConnState && typeof staleConnState === "object") {
    staleConnState.sessionInvalidated = true;
    staleConnState.sessionInvalidatedReason = reason;
  }

  try {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(closeCode, reason);
    }
  } catch {
    // Socket invalidation is best-effort and must not throw into command handling.
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
  if (Array.isArray(tableSnapshot.seats)) payload.seats = tableSnapshot.seats;
  if (tableSnapshot.stacks && typeof tableSnapshot.stacks === "object" && !Array.isArray(tableSnapshot.stacks)) payload.stacks = tableSnapshot.stacks;
  if (tableSnapshot.hand && typeof tableSnapshot.hand === "object") payload.hand = tableSnapshot.hand;
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

function broadcastStateSnapshots(tableId) {
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

async function sweepDisconnectCleanupAndBroadcast() {
  await disconnectCleanupRuntime.sweep();
}

async function sweepTurnTimeoutsAndBroadcast() {
  const nowMs = Date.now();
  const timeoutUpdates = tableManager.listDueTurnTimeouts({
    nowMs,
    shouldProcessTable: (tableId) => tableManager.isTableClosed(tableId) !== true
  });
  await Promise.allSettled(timeoutUpdates.map((update) => enqueueTableCommand({
    tableId: update.tableId,
    commandName: "turn_timeout",
    dedupeKey: "turn_timeout",
    run: async () => handleTurnTimeoutCommand({
      tableId: update.tableId,
      nowMs,
      tableManager,
      persistMutatedState,
      restoreTableFromPersisted,
      broadcastResyncRequired,
      broadcastStateSnapshots,
      scheduleBotStep,
      klog: klogSafe
    })
  })));
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  res.writeHead(404);
  res.end();
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
      klogSafe("ws_stale_session_socket_rejected", {
        frameType: frame.type,
        sessionId: connState.session.sessionId,
        userId: connState.session.userId
      });
      invalidateSocketSession(ws, { reason: "session_rebound" });
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
        invalidateSocketSession(rebound.priorSocket, { reason: "session_rebound" });
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

server.listen(PORT, "0.0.0.0", () => {
  klogSafe("ws_listening", { message: `WS listening on ${PORT}`, port: PORT });
});
