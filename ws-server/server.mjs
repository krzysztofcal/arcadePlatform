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
import { recordReplayFrame, resolveReplay, touchSession } from "./poker/runtime/session.mjs";
import { recordProtocolViolation, shouldClose } from "./poker/runtime/conn-guards.mjs";
import { createTableManager } from "./poker/table/table-manager.mjs";
import { createSessionStore } from "./poker/runtime/session-store.mjs";
import { buildStateSnapshotPayload } from "./poker/read-model/state-snapshot.mjs";

const PORT = Number(process.env.PORT || 3000);
const PROTECTED_MESSAGE_TYPES = new Set([
  "protected_echo",
  "join",
  "leave",
  "table_join",
  "table_leave",
  "table_state_sub",
  "resync",
  "resume"
]);
const REQUEST_ID_REQUIRED_TYPES = new Set(["join", "leave", "table_join", "table_leave", "table_state_sub", "resync", "resume"]);

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

const tableManager = createTableManager({
  presenceTtlMs: resolvePresenceTtlMs(process.env.WS_PRESENCE_TTL_MS),
  maxSeats: resolveMaxSeats(process.env.WS_MAX_SEATS)
});
const sessionStore = createSessionStore({
  sessionTtlMs: resolveSessionTtlMs(process.env.WS_SESSION_TTL_MS)
});

function klog(kind, data) {
  const payload = data && typeof data === "object" ? ` ${JSON.stringify(data)}` : "";
  process.stdout.write(`[klog] ${kind}${payload}\n`);
}

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

function sendTableState(ws, connState, { requestId = null, tableState }) {
  const baseFrame = {
    version: "1.0",
    type: "table_state",
    ts: nowTs(),
    sessionId: connState.sessionId,
    payload: {
      tableId: tableState.tableId,
      members: tableState.members
    }
  };

  if (requestId) {
    baseFrame.requestId = requestId;
  }

  const frame = recordReplayFrame({
    session: connState.session,
    tableId: tableState.tableId,
    frame: baseFrame
  });
  sendFrame(ws, frame);
}

function sendStateSnapshot(ws, connState, { requestId = null, tableSnapshot }) {
  const baseFrame = {
    version: "1.0",
    type: "stateSnapshot",
    ts: nowTs(),
    roomId: tableSnapshot.tableId,
    sessionId: connState.sessionId,
    payload: buildStateSnapshotPayload({
      tableSnapshot,
      userId: connState.session.userId
    })
  };

  if (requestId) {
    baseFrame.requestId = requestId;
  }

  const frame = recordReplayFrame({
    session: connState.session,
    tableId: tableSnapshot.tableId,
    frame: baseFrame
  });
  sendFrame(ws, frame);
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

  sendFrame(ws, frame);
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


function sweepAndBroadcastExpiredPresence() {
  const nowMs = Date.now();
  sessionStore.sweepExpiredSessions({ nowMs });
  const sweepUpdates = tableManager.sweepExpiredPresence({ nowTs: nowMs });
  for (const update of sweepUpdates) {
    broadcastTableState(update.tableId);
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

  ws.on("message", (msg, isBinary) => {
    sweepAndBroadcastExpiredPresence();
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
      if (joined.changed) {
        broadcastTableState(tableId, { excludeWs: ws });
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

      const replay = resolveReplay({ session: rebound.session, tableId, lastSeq: resumeLastSeq });
      if (!replay.ok) {
        sendResumeRequired(ws, connState, {
          requestId: frame.requestId ?? null,
          tableId,
          reason: replay.reason,
          expectedSeq: replay.latestSeq ?? 0
        });
        return;
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

      if (replay.frames.length === 0) {
        sendResumeAck(ws, connState, { requestId: frame.requestId ?? null, tableId });
        return;
      }

      for (const replayFrame of replay.frames) {
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
      const tableId = resolvedRoomId.roomId;

      const left = tableManager.leave({ ws, userId: connState.session.userId, tableId, requestId: frame.requestId });
      if (!left.tableState) {
        sendError(ws, connState, {
          code: "INVALID_COMMAND",
          message: "table_leave requires payload.tableId when connection is not joined",
          requestId: frame.requestId ?? null
        });
        return;
      }

      sendTableState(ws, connState, { requestId: frame.requestId ?? null, tableState: left.tableState });
      if (left.changed) {
        broadcastTableState(left.tableState.tableId, { excludeWs: ws });
      }
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
        const tableSnapshot = tableManager.tableSnapshot(tableId, connState.session.userId);
        sendStateSnapshot(ws, connState, { requestId: frame.requestId ?? null, tableSnapshot });
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
    klog("ws_error", { message: err.message });
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

server.listen(PORT, "0.0.0.0", () => {
  klog("ws_listening", { message: `WS listening on ${PORT}`, port: PORT });
});
