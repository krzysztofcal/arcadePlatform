import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { MAX_FRAME_BYTES } from "./poker/protocol/constants.mjs";
import { makeErrorFrame, parseFrame, validateEnvelope } from "./poker/protocol/envelope.mjs";
import { handleHello } from "./poker/handlers/hello.mjs";
import { handlePing } from "./poker/handlers/ping.mjs";
import { createConnState } from "./poker/runtime/conn-state.mjs";
import { recordProtocolViolation, shouldClose } from "./poker/runtime/conn-guards.mjs";

const PORT = Number(process.env.PORT || 3000);

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
  const connState = createConnState();

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
    klog("ws_error", { message: err.message });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  klog("ws_listening", { message: `WS listening on ${PORT}`, port: PORT });
});
