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
import { touchSession } from "./poker/runtime/session.mjs";
import { recordProtocolViolation, shouldClose } from "./poker/runtime/conn-guards.mjs";
import { createTableManager } from "./poker/table/table-manager.mjs";

const PORT = Number(process.env.PORT || 3000);
const PROTECTED_MESSAGE_TYPES = new Set(["protected_echo", "table_join", "table_leave", "table_state_sub"]);
const tableManager = createTableManager();

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

function sendTableState(ws, connState, { requestId = null, tableState }) {
  const frame = {
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
  ws.__connState = connState;

  ws.on("message", (msg, isBinary) => {
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

    if (frame.type === "protected_echo") {
      const response = handleProtectedEcho({ frame, connState, nowTs });
      sendFrame(ws, response.frame);
      return;
    }

    if (frame.type === "table_join") {
      const tableId = normalizeTableId(frame.payload.tableId);
      if (!tableId) {
        sendError(ws, connState, {
          code: "INVALID_COMMAND",
          message: "table_join requires payload.tableId as a non-empty string",
          requestId: frame.requestId ?? null
        });
        return;
      }

      const joined = tableManager.join({ ws, userId: connState.session.userId, tableId });
      if (!joined.ok) {
        sendError(ws, connState, {
          code: "INVALID_COMMAND",
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

    if (frame.type === "table_leave") {
      const tableId = frame.payload.tableId === undefined ? null : normalizeTableId(frame.payload.tableId);
      if (frame.payload.tableId !== undefined && !tableId) {
        sendError(ws, connState, {
          code: "INVALID_COMMAND",
          message: "table_leave payload.tableId must be a non-empty string when provided",
          requestId: frame.requestId ?? null
        });
        return;
      }

      const left = tableManager.leave({ ws, userId: connState.session.userId, tableId });
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
      const tableId = normalizeTableId(frame.payload.tableId);
      if (!tableId) {
        sendError(ws, connState, {
          code: "INVALID_COMMAND",
          message: "table_state_sub requires payload.tableId as a non-empty string",
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
    const cleanupUpdates = tableManager.cleanupConnection({ ws, userId: connState.session.userId });
    for (const update of cleanupUpdates) {
      broadcastTableState(update.tableId);
    }
    klog("ws_error", { message: err.message });
  });

  ws.on("close", () => {
    const cleanupUpdates = tableManager.cleanupConnection({ ws, userId: connState.session.userId });
    for (const update of cleanupUpdates) {
      broadcastTableState(update.tableId);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  klog("ws_listening", { message: `WS listening on ${PORT}`, port: PORT });
});
