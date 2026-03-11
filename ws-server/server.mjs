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
import { buildStateSnapshotPayload } from "./poker/read-model/state-snapshot.mjs";
import { buildStatePatch } from "./poker/read-model/state-patch.mjs";
import { createStreamLog } from "./poker/runtime/stream-log.mjs";
import { createPersistedStateWriter } from "./poker/persistence/persisted-state-writer.mjs";
import { createTableSnapshotLoader } from "./poker/table/table-snapshot.mjs";
import { beginSqlWs } from "./poker/bootstrap/persisted-bootstrap-db.mjs";
import { executePokerLeave } from "../shared/poker-domain/leave.mjs";

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
  "resync",
  "resume",
  "ack"
]);
const REQUEST_ID_REQUIRED_TYPES = new Set(["join", "leave", "table_join", "table_leave", "table_state_sub", "table_snapshot", "act", "resync", "resume"]);
const TABLE_SNAPSHOT_KNOWN_FAILURE_CODES = new Set([
  "invalid_table_id",
  "table_not_found",
  "state_missing",
  "state_invalid",
  "contract_mismatch_empty_legal_actions"
]);

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
  observeOnlyJoin: resolveObserveOnlyJoin(process.env.WS_OBSERVE_ONLY_JOIN)
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


function resolveLeaveTestOverride() {
  const raw = process.env.WS_TEST_LEAVE_RESULT_JSON;
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function executeAuthoritativeLeave({ tableId, userId, requestId }) {
  const override = resolveLeaveTestOverride();
  if (override) {
    return override;
  }

  return executePokerLeave({
    beginSql: (fn) => beginSqlWs(fn, { env: process.env }),
    tableId,
    userId,
    requestId,
    includeState: true,
    klog: klogSafe
  });
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

function sendFrame(ws, frame) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame));
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

function sendTableState(ws, connState, { requestId = null, tableState }) {
  const frame = {
    version: "1.0",
    type: "table_state",
    ts: nowTs(),
    roomId: tableState.tableId,
    sessionId: connState.sessionId,
    payload: {
      tableId: tableState.tableId,
      members: tableState.members
    }
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
      sendTableState(subscriber, subscriberConnState, { tableState });
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
  tableManager.setPersistedStateVersion(tableId, persisted.newVersion);
  return persisted;
}

async function restoreTableFromPersisted(tableId) {
  if (typeof loadPersistedTableBootstrap !== "function") {
    return { ok: false, reason: "persisted_bootstrap_disabled" };
  }
  try {
    const restored = await loadPersistedTableBootstrap({ tableId });
    if (!restored?.ok || !restored?.table) {
      return { ok: false, reason: restored?.code || "restore_failed" };
    }
    return tableManager.restoreTableFromPersisted(tableId, restored.table);
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

function sweepAndBroadcastExpiredPresence() {
  const nowMs = Date.now();
  const expiredSessionIds = sessionStore.sweepExpiredSessions({ nowMs });
  for (const sessionId of expiredSessionIds) {
    for (const key of [...lastSnapshotBySessionAndTable.keys()]) {
      if (key.startsWith(`${sessionId}:`)) {
        lastSnapshotBySessionAndTable.delete(key);
      }
    }
  }
  const sweepUpdates = tableManager.sweepExpiredPresence({ nowTs: nowMs });
  for (const update of sweepUpdates) {
    broadcastTableState(update.tableId);
  }
}

async function sweepTurnTimeoutsAndBroadcast() {
  const nowMs = Date.now();
  const timeoutUpdates = tableManager.sweepTurnTimeouts({ nowMs });
  for (const update of timeoutUpdates) {
    const persisted = await persistMutatedState({
      tableId: update.tableId,
      expectedVersion: Number(update.stateVersion) - 1,
      mutationKind: "timeout"
    });
    if (!persisted?.ok) {
      await restoreTableFromPersisted(update.tableId);
      broadcastResyncRequired(update.tableId, "persistence_conflict");
      continue;
    }
    broadcastStateSnapshots(update.tableId);
  }
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
    sweepAndBroadcastExpiredPresence();
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
      const tableId = resolvedRoomId.roomId;

      const ensured = await tableManager.ensureTableLoaded(tableId);
      if (!ensured.ok) {
        sendError(ws, connState, {
          code: "INVALID_COMMAND",
          message: ensured.message,
          requestId: frame.requestId ?? null
        });
        return;
      }

      sessionStore.trackConnection({ ws, userId: connState.session.userId, sessionId: connState.session.sessionId });
      const joined = tableManager.join({
        ws,
        userId: connState.session.userId,
        tableId,
        requestId: frame.requestId,
        nowTs: Date.now()
      });
      if (!joined.ok) {
        sendError(ws, connState, {
          code: joined.code === "bounds_exceeded" ? "bounds_exceeded" : "INVALID_COMMAND",
          message: joined.message,
          requestId: frame.requestId ?? null
        });
        return;
      }

      sendTableState(ws, connState, { requestId: frame.requestId ?? null, tableState: joined.tableState });

      const bootstrapped = tableManager.bootstrapHand(tableId, { nowMs: Date.now() });
      if (joined.changed) {
        broadcastTableState(tableId, { excludeWs: ws });
      }
      if (bootstrapped?.changed) {
        const persisted = await persistMutatedState({
          tableId,
          expectedVersion: Number(bootstrapped.stateVersion) - 1,
          mutationKind: "bootstrap"
        });
        if (!persisted?.ok) {
          await restoreTableFromPersisted(tableId);
          broadcastResyncRequired(tableId, "persistence_conflict");
          sendError(ws, connState, {
            code: "INTERNAL_ERROR",
            message: "state_persist_failed",
            requestId: frame.requestId ?? null
          });
          return;
        }
        klogSafe("ws_hand_bootstrap_started", { tableId, handId: bootstrapped.handId, stateVersion: persisted.newVersion });
      }
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
          sendError(ws, connState, {
            code: "INVALID_COMMAND",
            message: ensured.message,
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

        sendTableState(ws, connState, { requestId: frame.requestId ?? null, tableState: resynced.tableState });
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

      try {
        const left = await executeAuthoritativeLeave({
          tableId,
          userId: connState.session.userId,
          requestId: frame.requestId
        });

        if (!left?.ok) {
          if (left?.pending) {
            sendCommandResult(ws, connState, {
              requestId: frame.requestId ?? null,
              tableId,
              status: "rejected",
              reason: "request_pending"
            });
            return;
          }

          sendCommandResult(ws, connState, {
            requestId: frame.requestId ?? null,
            tableId,
            status: "rejected",
            reason: left?.code || left?.reason || "state_invalid"
          });
          return;
        }

        const leaveState = left?.state?.state && typeof left.state.state === "object" ? left.state.state : null;
        const synced = tableManager.syncAuthoritativeLeave({
          ws,
          userId: connState.session.userId,
          tableId,
          stateVersion: left?.state?.version ?? null,
          pokerState: leaveState
        });

        sendCommandResult(ws, connState, {
          requestId: frame.requestId ?? null,
          tableId,
          status: "accepted",
          reason: left?.status === "already_left" ? "already_left" : null
        });

        if (synced.changed) {
          broadcastStateSnapshots(tableId);
          broadcastTableState(tableId);
        }
        return;
      } catch (error) {
        const reason = typeof error?.code === "string" ? error.code : "state_invalid";
        sendCommandResult(ws, connState, {
          requestId: frame.requestId ?? null,
          tableId,
          status: "rejected",
          reason
        });
        return;
      }
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
          sendError(ws, connState, {
            code: "INVALID_COMMAND",
            message: ensured.message,
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
        sendError(ws, connState, {
          code: "INVALID_COMMAND",
          message: ensured.message,
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

      sendTableState(ws, connState, { requestId: frame.requestId ?? null, tableState: subscribed.tableState });
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

      const tableId = resolvedRoomId.roomId;
      const handId = typeof frame.payload?.handId === "string" ? frame.payload.handId.trim() : "";
      const action = typeof frame.payload?.action === "string" ? frame.payload.action.trim().toUpperCase() : "";
      const amount = frame.payload?.amount;

      if (!handId) {
        sendError(ws, connState, {
          code: "INVALID_COMMAND",
          message: "act requires payload.handId",
          requestId: frame.requestId ?? null
        });
        return;
      }

      if (!["FOLD", "CHECK", "CALL", "BET", "RAISE"].includes(action)) {
        sendError(ws, connState, {
          code: "INVALID_COMMAND",
          message: "act requires payload.action of fold/check/call/bet/raise",
          requestId: frame.requestId ?? null
        });
        return;
      }

      if ((action === "BET" || action === "RAISE") && !Number.isFinite(amount)) {
        sendError(ws, connState, {
          code: "INVALID_COMMAND",
          message: "act requires numeric payload.amount for bet/raise",
          requestId: frame.requestId ?? null
        });
        return;
      }

      const ensured = await tableManager.ensureTableLoaded(tableId);
      if (!ensured.ok) {
        sendCommandResult(ws, connState, {
          requestId: frame.requestId ?? null,
          tableId,
          status: "rejected",
          reason: ensured.code
        });
        return;
      }

      const result = tableManager.applyAction({
        tableId,
        handId,
        userId: connState.session.userId,
        requestId: frame.requestId,
        action,
        amount,
        nowIso: frame.ts
      });

      if (result.accepted && !result.replayed && result.changed) {
        const persisted = await persistMutatedState({
          tableId,
          expectedVersion: Number(result.stateVersion) - 1,
          mutationKind: "act"
        });
        if (!persisted?.ok) {
          await restoreTableFromPersisted(tableId);
          sendCommandResult(ws, connState, {
            requestId: frame.requestId ?? null,
            tableId,
            status: "rejected",
            reason: persisted?.reason || "persist_failed"
          });
          broadcastResyncRequired(tableId, "persistence_conflict");
          return;
        }
      }

      sendCommandResult(ws, connState, {
        requestId: frame.requestId ?? null,
        tableId,
        status: result.accepted ? "accepted" : "rejected",
        reason: result.reason
      });

      if (result.accepted && !result.replayed && result.changed) {
        broadcastStateSnapshots(tableId);
      }
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
    }
    sweepAndBroadcastExpiredPresence();
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
    }
    sweepAndBroadcastExpiredPresence();
  });
});


const timeoutSweepIntervalMs = Number(process.env.WS_TIMEOUT_SWEEP_MS || 250);
const timeoutSweepTimer = setInterval(() => {
  void sweepTurnTimeoutsAndBroadcast();
}, Number.isFinite(timeoutSweepIntervalMs) && timeoutSweepIntervalMs > 0 ? timeoutSweepIntervalMs : 250);

timeoutSweepTimer.unref();

server.listen(PORT, "0.0.0.0", () => {
  klogSafe("ws_listening", { message: `WS listening on ${PORT}`, port: PORT });
});
