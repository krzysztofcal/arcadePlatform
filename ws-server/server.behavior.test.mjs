import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
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

function createServer({ env = {} } = {}) {
  return getFreePort().then((port) => {
    const child = spawn(process.execPath, ["ws-server/server.mjs"], {
      env: { ...process.env, PORT: String(port), ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { port, child };
  });
}

function connectClient(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws, timeoutMs = 5000) {
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
    }, timeoutMs);

    ws.on("message", onMessage);
    ws.on("error", onError);
    ws.on("close", onClose);
  });
}

function sendFrame(ws, frame) {
  ws.send(JSON.stringify(frame));
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function makeHs256Jwt({ secret, sub }) {
  const encodedHeader = base64urlJson({ alg: "HS256", typ: "JWT" });
  const encodedPayload = base64urlJson({ sub });
  const signature = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

async function hello(ws) {
  sendFrame(ws, {
    version: "1.0",
    type: "hello",
    requestId: "req-hello",
    ts: "2026-02-28T00:00:00Z",
    payload: { supportedVersions: ["1.0"] }
  });
  return nextMessage(ws);
}

function protectedEchoFrame(requestId = "req-protected") {
  return {
    version: "1.0",
    type: "protected_echo",
    requestId,
    ts: "2026-02-28T00:00:01Z",
    payload: { echo: "hi" }
  };
}

test("server supports healthz and hello/helloAck smoke flow", async () => {
  const { port, child } = await createServer();

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);

    const helloAck = await hello(ws);
    assert.equal(helloAck.type, "helloAck");
    assert.equal(helloAck.payload.version, "1.0");
    assert.equal(typeof helloAck.payload.sessionId, "string");
    assert.ok(helloAck.payload.sessionId.length > 0);
    assert.equal(helloAck.sessionId, helloAck.payload.sessionId);
    assert.equal(typeof helloAck.payload.heartbeatMs, "number");
    assert.ok(helloAck.payload.heartbeatMs > 0);

    ws.close();

    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("protected message requires auth", async () => {
  const { port, child } = await createServer();

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);

    const helloAck = await hello(ws);
    assert.equal(helloAck.type, "helloAck");

    sendFrame(ws, protectedEchoFrame());
    const authRequired = await nextMessage(ws);
    assert.equal(authRequired.type, "error");
    assert.equal(authRequired.payload.code, "auth_required");
    assert.equal(ws.readyState, WebSocket.OPEN);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("resync message requires auth", async () => {
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: "test-secret" } });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);

    sendFrame(ws, {
      version: "1.0",
      type: "resync",
      requestId: "req-resync-unauth",
      ts: "2026-02-28T00:00:01Z",
      payload: { tableId: "table_A" }
    });

    const authRequired = await nextMessage(ws);
    assert.equal(authRequired.type, "error");
    assert.equal(authRequired.payload.code, "auth_required");
    assert.equal(ws.readyState, WebSocket.OPEN);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("table_leave message requires auth", async () => {
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: "test-secret" } });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);

    sendFrame(ws, {
      version: "1.0",
      type: "table_leave",
      requestId: "req-table-leave-unauth",
      ts: "2026-02-28T00:00:01Z",
      payload: { tableId: "table_A" }
    });

    const authRequired = await nextMessage(ws);
    assert.equal(authRequired.type, "error");
    assert.equal(authRequired.payload.code, "auth_required");
    assert.equal(ws.readyState, WebSocket.OPEN);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("unauth table_leave is blocked by auth guard, not handler validation", async () => {
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: "test-secret" } });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);

    sendFrame(ws, {
      version: "1.0",
      type: "table_leave",
      requestId: "req-table-leave-guard-check",
      ts: "2026-02-28T00:00:01Z",
      payload: { tableId: "table_A" }
    });

    const authRequired = await nextMessage(ws);
    assert.equal(authRequired.type, "error");
    assert.equal(authRequired.payload.code, "auth_required");
    assert.notEqual(authRequired.payload.code, "INVALID_COMMAND");
    assert.equal(ws.readyState, WebSocket.OPEN);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("invalid token returns authError and does not authenticate", async () => {
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: "test-secret" } });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);

    sendFrame(ws, {
      version: "1.0",
      type: "auth",
      requestId: "req-auth-invalid",
      ts: "2026-02-28T00:00:02Z",
      payload: { token: "invalid.token.value" }
    });

    const authError = await nextMessage(ws);
    assert.equal(authError.type, "error");
    assert.equal(authError.payload.code, "auth_invalid");

    sendFrame(ws, protectedEchoFrame("req-protected-after-invalid"));
    const authRequired = await nextMessage(ws);
    assert.equal(authRequired.type, "error");
    assert.equal(authRequired.payload.code, "auth_required");

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("invalid WS_PRESENCE_TTL_MS falls back safely and keeps resync idempotent", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_123" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PRESENCE_TTL_MS: "abc"
    }
  });

  try {
    await waitForListening(child, 5000);

    const ws1 = await connectClient(port);
    await hello(ws1);
    const authOk = await (async () => {
      sendFrame(ws1, {
        version: "1.0",
        type: "auth",
        requestId: "req-auth-badttl-1",
        ts: "2026-02-28T00:00:05Z",
        payload: { token }
      });
      return nextMessage(ws1);
    })();
    assert.equal(authOk.type, "authOk");

    sendFrame(ws1, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-badttl-1",
      ts: "2026-02-28T00:00:06Z",
      payload: { tableId: "table_badttl" }
    });
    const join1 = await nextMessage(ws1);
    assert.equal(join1.type, "table_state");
    assert.equal(join1.payload.members.length, 1);
    const seatBefore = join1.payload.members[0].seat;
    ws1.close();

    const ws2 = await connectClient(port);
    await hello(ws2);
    sendFrame(ws2, {
      version: "1.0",
      type: "auth",
      requestId: "req-auth-badttl-2",
      ts: "2026-02-28T00:00:07Z",
      payload: { token }
    });
    const authOk2 = await nextMessage(ws2);
    assert.equal(authOk2.type, "authOk");

    sendFrame(ws2, {
      version: "1.0",
      type: "resync",
      requestId: "req-resync-badttl",
      ts: "2026-02-28T00:00:08Z",
      payload: { tableId: "table_badttl" }
    });

    const resync = await nextMessage(ws2);
    assert.equal(resync.type, "table_state");
    assert.equal(resync.payload.members.length, 1);
    assert.equal(resync.payload.members[0].userId, "user_123");
    assert.equal(resync.payload.members[0].seat, seatBefore);

    ws2.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("valid token returns authOk and unlocks protected messages", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_123" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret
    }
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);

    sendFrame(ws, {
      version: "1.0",
      type: "auth",
      requestId: "req-auth-valid-1",
      ts: "2026-02-28T00:00:03Z",
      payload: { token }
    });

    const authOk = await nextMessage(ws);
    assert.equal(authOk.type, "authOk");
    assert.equal(authOk.payload.userId, "user_123");
    assert.equal(typeof authOk.payload.sessionId, "string");

    sendFrame(ws, protectedEchoFrame("req-protected-after-auth"));
    const protectedOk = await nextMessage(ws);
    assert.equal(protectedOk.type, "protectedEchoOk");
    assert.equal(protectedOk.payload.userId, "user_123");
    assert.equal(protectedOk.payload.echo, "hi");

    sendFrame(ws, {
      version: "1.0",
      type: "auth",
      requestId: "req-auth-valid-2",
      ts: "2026-02-28T00:00:04Z",
      payload: { token }
    });

    const authOkRepeat = await nextMessage(ws);
    assert.equal(authOkRepeat.type, "authOk");
    assert.equal(authOkRepeat.payload.userId, "user_123");

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});
