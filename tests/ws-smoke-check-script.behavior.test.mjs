import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";

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

function runSmokeScript(url, timeoutMs) {
  const script = `
const WebSocket = require('ws');
const url = process.argv[1];
const timer = setTimeout(() => process.exit(2), 2500);
const ws = new WebSocket(url);
ws.once('message', (data) => {
  const msg = String(data);
  clearTimeout(timer);
  ws.close();
  process.exit(msg === 'connected' ? 0 : 3);
});
ws.once('error', () => {
  clearTimeout(timer);
  process.exit(4);
});
`;

  const child = spawn(process.execPath, ["-e", script, url], {
    cwd: "ws-server",
    stdio: ["ignore", "ignore", "ignore"]
  });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(124);
    }, timeoutMs);

    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

test("smoke script succeeds when websocket returns connected marker", async () => {
  const port = await getFreePort();
  const server = spawn(process.execPath, ["ws-server/server.mjs"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForListening(server, 5000);
    const started = Date.now();
    const code = await runSmokeScript(`ws://127.0.0.1:${port}`, 5000);
    assert.equal(code, 0);
    assert.ok(Date.now() - started < 5000, "smoke script should finish within timeout");
  } finally {
    server.kill("SIGTERM");
    await waitForExit(server);
  }
});

test("smoke script fails when websocket endpoint is unreachable", async () => {
  const port = await getFreePort();
  const started = Date.now();
  const code = await runSmokeScript(`ws://127.0.0.1:${port}`, 5000);
  assert.notEqual(code, 0);
  assert.ok(Date.now() - started < 5000, "smoke script should fail within timeout");
});
