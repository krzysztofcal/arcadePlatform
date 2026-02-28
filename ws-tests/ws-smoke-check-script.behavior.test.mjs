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
const timer = setTimeout(() => finish(2), 2500);
const ws = new WebSocket(url);
let done = false;

function finish(code, message) {
  if (done) return;
  done = true;
  clearTimeout(timer);
  if (message) {
    process.stdout.write(message + '\\n');
  }
  if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  process.exit(code);
}

ws.once('message', (data) => {
  const msg = String(data);
  let parsed;

  try {
    parsed = JSON.parse(msg);
  } catch {
    finish(3, msg);
    return;
  }

  if (parsed && parsed.type === 'helloAck' && parsed.payload && parsed.payload.version === '1.0') {
    finish(0, JSON.stringify(parsed));
    return;
  }

  finish(3, JSON.stringify(parsed));
});

ws.once('error', () => finish(4));
ws.once('close', () => finish(5));
ws.once('open', () => {
  ws.send(
    JSON.stringify({
      version: '1.0',
      type: 'hello',
      ts: new Date().toISOString(),
      payload: { supportedVersions: ['1.0'] }
    })
  );
});
`;

  const child = spawn(process.execPath, ["-e", script, url], {
    cwd: "ws-server",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (buf) => {
      stdout += String(buf);
    });

    child.stderr.on("data", (buf) => {
      stderr += String(buf);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: 124, stdout, stderr });
    }, timeoutMs);

    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

test("smoke script succeeds when websocket returns helloAck", async () => {
  const port = await getFreePort();
  const server = spawn(process.execPath, ["ws-server/server.mjs"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForListening(server, 5000);
    const started = Date.now();
    const result = await runSmokeScript(`ws://127.0.0.1:${port}`, 5000);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /"type":"helloAck"/);
    assert.match(result.stdout, /"version":"1\.0"/);
    assert.ok(Date.now() - started < 5000, "smoke script should finish within timeout");
  } finally {
    server.kill("SIGTERM");
    await waitForExit(server);
  }
});

test("smoke script fails when websocket endpoint is unreachable", async () => {
  const port = await getFreePort();
  const started = Date.now();
  const result = await runSmokeScript(`ws://127.0.0.1:${port}`, 5000);
  assert.notEqual(result.code, 0);
  assert.ok(Date.now() - started < 5000, "smoke script should fail within timeout");
});

test("smoke script resolves deterministically when server closes quickly", async () => {
  const port = await getFreePort();
  const fastCloseServer = net.createServer((socket) => {
    socket.destroy();
  });

  await new Promise((resolve) => fastCloseServer.listen(port, "127.0.0.1", resolve));

  try {
    const started = Date.now();
    const result = await runSmokeScript(`ws://127.0.0.1:${port}`, 5000);
    assert.notEqual(result.code, 0);
    assert.ok(Date.now() - started < 5000, "smoke script should resolve quickly on fast close");
  } finally {
    await new Promise((resolve) => fastCloseServer.close(resolve));
  }
});
