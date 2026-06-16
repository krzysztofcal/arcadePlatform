import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import WebSocket from "ws";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = address && typeof address === "object" ? address.port : null;
      srv.close((err) => {
        if (err) return reject(err);
        if (!port) return reject(new Error("Port allocation failed"));
        resolve(port);
      });
    });
    srv.on("error", reject);
  });
}

function waitForListening(proc, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server did not start in time")), timeoutMs);
    const onData = (buf) => {
      if (String(buf).includes("WS listening on")) {
        clearTimeout(timer);
        proc.stdout.off("data", onData);
        proc.off("exit", onExit);
        resolve();
      }
    };
    const onExit = (code) => {
      clearTimeout(timer);
      proc.stdout.off("data", onData);
      reject(new Error(`Server exited before ready: ${code}`));
    };
    proc.stdout.on("data", onData);
    proc.once("exit", onExit);
  });
}

function waitForExit(proc) {
  if (proc.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => proc.once("exit", resolve));
}

function nextMessage(ws) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
      ws.off("close", onClose);
    };

    const onMessage = (data) => {
      cleanup();
      resolve(JSON.parse(String(data)));
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const onClose = (code) => {
      cleanup();
      reject(new Error(`Socket closed before message: ${code}`));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket message"));
    }, 5000);

    ws.on("message", onMessage);
    ws.on("error", onError);
    ws.on("close", onClose);
  });
}

test("helloAck and pong are returned for hello/ping", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["ws-server/server.mjs"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForListening(child, 5000);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => ws.once("open", resolve));

    ws.send(
      JSON.stringify({
        version: "1.0",
        type: "hello",
        requestId: "req-hello",
        ts: "2026-02-28T00:00:00Z",
        payload: { supportedVersions: ["1.0"] }
      })
    );

    const helloAck = await nextMessage(ws);
    assert.equal(helloAck.type, "helloAck");
    assert.equal(helloAck.payload.version, "1.0");
    assert.equal(typeof helloAck.payload.sessionId, "string");
    assert.ok(helloAck.payload.sessionId.length > 0);
    assert.equal(helloAck.sessionId, helloAck.payload.sessionId);
    assert.equal(typeof helloAck.payload.heartbeatMs, "number");

    const unexpectedClose = new Promise((_, reject) => {
      const onUnexpectedClose = (code) => {
        reject(new Error(`Socket closed unexpectedly before pong: ${code}`));
      };

      ws.once("close", onUnexpectedClose);
      ws.once("message", () => ws.off("close", onUnexpectedClose));
    });

    ws.send(
      JSON.stringify({
        version: "1.0",
        type: "ping",
        requestId: "req-ping",
        ts: "2026-02-28T00:00:01Z",
        payload: { clientTime: "2026-02-28T00:00:01Z" }
      })
    );

    const pong = await Promise.race([nextMessage(ws), unexpectedClose]);
    assert.equal(pong.type, "pong");
    assert.equal(pong.payload.clientTime, "2026-02-28T00:00:01Z");
    assert.equal(typeof pong.payload.serverTime, "string");
    assert.ok(pong.payload.serverTime.length > 0);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});
