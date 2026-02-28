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

test("server supports healthz and hello/helloAck smoke flow", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["ws-server/server.mjs"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForListening(child, 5000);

    const helloAck = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out waiting for helloAck"));
      }, 5000);

      ws.once("open", () => {
        ws.send(
          JSON.stringify({
            version: "1.0",
            type: "hello",
            requestId: "req-smoke",
            ts: "2026-02-28T00:00:00Z",
            payload: { supportedVersions: ["1.0"] }
          })
        );
      });

      ws.once("message", (data) => {
        clearTimeout(timer);
        ws.close();
        resolve(JSON.parse(String(data)));
      });

      ws.once("error", () => {
        clearTimeout(timer);
        ws.close();
        reject(new Error("WebSocket connection failed"));
      });
    });

    assert.equal(helloAck.type, "helloAck");
    assert.equal(helloAck.payload.version, "1.0");
    assert.equal(typeof helloAck.payload.sessionId, "string");
    assert.ok(helloAck.payload.sessionId.length > 0);
    assert.equal(helloAck.sessionId, helloAck.payload.sessionId);
    assert.equal(typeof helloAck.payload.heartbeatMs, "number");
    assert.ok(helloAck.payload.heartbeatMs > 0);

    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});
