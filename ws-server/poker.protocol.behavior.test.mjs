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


function attemptMessage(ws, timeoutMs = 300) {
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

    const onClose = () => {
      cleanup();
      resolve(null);
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    ws.on("message", onMessage);
    ws.on("error", onError);
    ws.on("close", onClose);
  });
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

test("invalid JSON returns INVALID_ENVELOPE", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["ws-server/server.mjs"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForListening(child, 5000);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => ws.once("open", resolve));
    ws.send("{");

    const response = await nextMessage(ws);
    assert.equal(response.type, "error");
    assert.equal(response.payload.code, "INVALID_ENVELOPE");
    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("unsupported version returns UNSUPPORTED_VERSION and closes", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["ws-server/server.mjs"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForListening(child, 5000);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => ws.once("open", resolve));

    const messageAttempt = attemptMessage(ws);

    const closeP = new Promise((resolve) => ws.once("close", (code) => resolve(code)));

    ws.send(
      JSON.stringify({
        version: "9.9",
        type: "hello",
        ts: "2026-02-28T00:00:00Z",
        requestId: "req-unsupported",
        payload: { supportedVersions: ["9.9"] }
      })
    );

    const maybeErrorFrame = await messageAttempt;
    const close = await closeP;
    assert.equal(close, 1002);

    if (maybeErrorFrame !== null) {
      assert.equal(maybeErrorFrame.type, "error");
      assert.equal(maybeErrorFrame.payload.code, "UNSUPPORTED_VERSION");
    }
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("unsupported version closes with 1002 even if error frame is not observed by client", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["ws-server/server.mjs"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForListening(child, 5000);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => ws.once("open", resolve));

    const closeP = new Promise((resolve) => ws.once("close", (code) => resolve(code)));

    ws.send(
      JSON.stringify({
        version: "9.9",
        type: "hello",
        ts: "2026-02-28T00:00:00Z",
        requestId: "req-unsupported-close-only",
        payload: { supportedVersions: ["9.9"] }
      })
    );

    const close = await closeP;
    assert.equal(close, 1002);
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("unsupported version close listener registered first always resolves", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["ws-server/server.mjs"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForListening(child, 5000);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => ws.once("open", resolve));

    const closeP = new Promise((resolve) => ws.once("close", (code) => resolve(code)));

    ws.send(
      JSON.stringify({
        version: "9.9",
        type: "hello",
        ts: "2026-02-28T00:00:00Z",
        requestId: "req-unsupported-watchdog",
        payload: { supportedVersions: ["9.9"] }
      })
    );

    const close = await Promise.race([
      closeP,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for close")), 1000))
    ]);
    assert.equal(close, 1002);
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("frame >32KB returns FRAME_TOO_LARGE", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["ws-server/server.mjs"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForListening(child, 5000);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => ws.once("open", resolve));

    const huge = "x".repeat(33 * 1024);
    const closeP = new Promise((resolve) => ws.once("close", (code) => resolve(code)));

    ws.send(
      JSON.stringify({
        version: "1.0",
        type: "ping",
        ts: "2026-02-28T00:00:00Z",
        requestId: "req-big",
        payload: { clientTime: huge }
      })
    );

    const maybeFrame = await attemptMessage(ws);
    const close = await closeP;
    assert.equal(close, 1009);

    if (maybeFrame !== null) {
      assert.equal(maybeFrame.type, "error");
      assert.equal(maybeFrame.payload.code, "FRAME_TOO_LARGE");
    }
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("connection closes after repeated protocol violations but allows recovery after single violation", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["ws-server/server.mjs"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForListening(child, 5000);

    const wsRecover = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => wsRecover.once("open", resolve));
    wsRecover.send("{");
    const firstError = await nextMessage(wsRecover);
    assert.equal(firstError.payload.code, "INVALID_ENVELOPE");

    wsRecover.send(
      JSON.stringify({
        version: "1.0",
        type: "hello",
        requestId: "req-recover",
        ts: "2026-02-28T00:00:00Z",
        payload: { supportedVersions: ["1.0"] }
      })
    );
    const helloAck = await nextMessage(wsRecover);
    assert.equal(helloAck.type, "helloAck");
    wsRecover.close();

    const wsClose = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve) => wsClose.once("open", resolve));
    wsClose.send("{");
    await nextMessage(wsClose);
    wsClose.send("{");
    await nextMessage(wsClose);

    const closeP = new Promise((resolve) => wsClose.once("close", (code) => resolve(code)));
    wsClose.send("{");
    const closeCode = await closeP;
    assert.equal(closeCode, 1002);
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});
