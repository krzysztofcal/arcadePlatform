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

function nextMessage(ws, timeoutMs = 5000, label = "") {
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
      reject(new Error(`Timed out waiting for websocket message${label ? `: ${label}` : ""}`));
    }, timeoutMs);

    ws.on("message", onMessage);
    ws.on("error", onError);
    ws.on("close", onClose);
  });
}

function sendFrame(ws, frame) {
  ws.send(JSON.stringify(frame));
}

function attemptMessage(ws, timeoutMs = 250) {
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

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function makeHs256Jwt({ secret, sub }) {
  const encodedHeader = base64urlJson({ alg: "HS256", typ: "JWT" });
  const encodedPayload = base64urlJson({ sub });
  const signature = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

async function hello(ws, requestId = "req-hello") {
  sendFrame(ws, {
    version: "1.0",
    type: "hello",
    requestId,
    ts: "2026-02-28T00:00:00Z",
    payload: { supportedVersions: ["1.0"] }
  });
  return nextMessage(ws);
}

async function auth(ws, token, requestId) {
  sendFrame(ws, {
    version: "1.0",
    type: "auth",
    requestId,
    ts: "2026-02-28T00:00:01Z",
    payload: { token }
  });
  return nextMessage(ws);
}

test("table join/leave/sub flow is auth-gated, idempotent, and cleaned on disconnect (ttl=0 immediate removal)", async () => {
  const secret = "test-secret";
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PRESENCE_TTL_MS: "0"
    }
  });

  try {
    await waitForListening(child, 5000);

    const unauth = await connectClient(port);
    await hello(unauth, "req-hello-unauth");

    sendFrame(unauth, {
      version: "1.0",
      type: "table_join",
      requestId: "req-unauth-join",
      ts: "2026-02-28T00:00:02Z",
      payload: { tableId: "table_A" }
    });
    const unauthError = await nextMessage(unauth, 5000, "unauthError");
    assert.equal(unauthError.type, "error");
    assert.equal(unauthError.payload.code, "auth_required");
    assert.equal(unauth.readyState, WebSocket.OPEN);
    unauth.close();

    const client1 = await connectClient(port);
    const client2 = await connectClient(port);

    await hello(client1, "req-hello-c1");
    await hello(client2, "req-hello-c2");

    const token1 = makeHs256Jwt({ secret, sub: "user_1" });
    const token2 = makeHs256Jwt({ secret, sub: "user_2" });

    const auth1 = await auth(client1, token1, "req-auth-c1");
    const auth2 = await auth(client2, token2, "req-auth-c2");
    assert.equal(auth1.type, "authOk");
    assert.equal(auth2.type, "authOk");

    sendFrame(client1, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-c1",
      ts: "2026-02-28T00:00:03Z",
      payload: { tableId: "table_A" }
    });
    const subState = await nextMessage(client1, 5000, "subState");
    assert.equal(subState.type, "table_state");
    assert.equal(subState.payload.tableId, "table_A");
    assert.deepEqual(subState.payload.members, []);

    sendFrame(client1, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-c1",
      ts: "2026-02-28T00:00:04Z",
      payload: { tableId: "table_A" }
    });

    const c1JoinAck = await nextMessage(client1, 5000, "c1JoinAck");
    assert.equal(c1JoinAck.type, "table_state");
    assert.deepEqual(c1JoinAck.payload.members.map((entry) => entry.userId), ["user_1"]);

    const noExtraAfterC1Join = await attemptMessage(client1);
    assert.equal(noExtraAfterC1Join, null);

    sendFrame(client2, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-c2",
      ts: "2026-02-28T00:00:05Z",
      payload: { tableId: "table_A" }
    });

    const c2Ack = await nextMessage(client2, 5000, "c2Ack");
    const c1AfterC2Join = await nextMessage(client1, 5000, "c1AfterC2Join");

    assert.equal(c2Ack.type, "table_state");
    assert.equal(c1AfterC2Join.type, "table_state");
    assert.deepEqual(c2Ack.payload.members.map((entry) => entry.userId), ["user_1", "user_2"]);
    assert.deepEqual(c1AfterC2Join.payload.members.map((entry) => entry.userId), ["user_1", "user_2"]);

    sendFrame(client2, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-c2-dup",
      ts: "2026-02-28T00:00:06Z",
      payload: { tableId: "table_A" }
    });

    const c2DupAck = await nextMessage(client2, 5000, "c2DupAck");
    assert.equal(c2DupAck.type, "table_state");
    assert.deepEqual(c2DupAck.payload.members.map((entry) => entry.userId), ["user_1", "user_2"]);
    assert.equal(c2DupAck.payload.members.length, 2);

    const noExtraAfterC2DupForC1 = await attemptMessage(client1);
    const noExtraAfterC2DupForC2 = await attemptMessage(client2);
    assert.equal(noExtraAfterC2DupForC1, null);
    assert.equal(noExtraAfterC2DupForC2, null);

    sendFrame(client1, {
      version: "1.0",
      type: "table_leave",
      requestId: "req-leave-c1",
      ts: "2026-02-28T00:00:07Z",
      payload: { tableId: "table_A" }
    });

    const c1LeaveAck = await nextMessage(client1, 5000, "c1LeaveAck");
    const c2AfterC1Leave = await nextMessage(client2, 5000, "c2AfterC1Leave");
    assert.equal(c1LeaveAck.type, "table_state");
    assert.deepEqual(c1LeaveAck.payload.members.map((entry) => entry.userId), ["user_2"]);
    assert.deepEqual(c2AfterC1Leave.payload.members.map((entry) => entry.userId), ["user_2"]);

    sendFrame(client1, {
      version: "1.0",
      type: "table_leave",
      requestId: "req-leave-c1-dup",
      ts: "2026-02-28T00:00:08Z",
      payload: { tableId: "table_A" }
    });

    const c1LeaveDup = await nextMessage(client1, 5000, "c1LeaveDup");
    assert.equal(c1LeaveDup.type, "table_state");
    assert.deepEqual(c1LeaveDup.payload.members.map((entry) => entry.userId), ["user_2"]);

    const client3 = await connectClient(port);
    await hello(client3, "req-hello-c3");
    const token3 = makeHs256Jwt({ secret, sub: "user_3" });
    const auth3 = await auth(client3, token3, "req-auth-c3");
    assert.equal(auth3.type, "authOk");

    sendFrame(client3, {
      version: "1.0",
      type: "table_leave",
      requestId: "req-leave-c3-no-table",
      ts: "2026-02-28T00:00:08Z",
      payload: {}
    });

    const c3LeaveNoTable = await nextMessage(client3, 5000, "c3LeaveNoTable");
    assert.equal(c3LeaveNoTable.type, "error");
    assert.equal(c3LeaveNoTable.payload.code, "INVALID_COMMAND");

    const c3NoExtra = await attemptMessage(client3);
    assert.equal(c3NoExtra, null);

    client3.close();

    sendFrame(client1, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-c1-again",
      ts: "2026-02-28T00:00:09Z",
      payload: { tableId: "table_A" }
    });
    await nextMessage(client1, 5000, "subAgain");

    client2.close();

    const c1AfterDisconnect = await nextMessage(client1, 5000, "c1AfterDisconnect");
    assert.equal(c1AfterDisconnect.type, "table_state");
    assert.deepEqual(c1AfterDisconnect.payload.members, []);

    const client2b = await connectClient(port);
    await hello(client2b, "req-hello-c2b");
    const auth2b = await auth(client2b, token2, "req-auth-c2b");
    assert.equal(auth2b.type, "authOk");

    sendFrame(client2b, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-c2b",
      ts: "2026-02-28T00:00:10Z",
      payload: { tableId: "table_A" }
    });

    const c2bJoinAck = await nextMessage(client2b, 5000, "c2bJoinAck");
    const c1AfterC2bJoin = await nextMessage(client1, 5000, "c1AfterC2bJoin");
    assert.equal(c2bJoinAck.type, "table_state");
    assert.deepEqual(c2bJoinAck.payload.members.map((entry) => entry.userId), ["user_2"]);
    assert.deepEqual(c1AfterC2bJoin.payload.members.map((entry) => entry.userId), ["user_2"]);

    client1.close();
    client2b.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});
