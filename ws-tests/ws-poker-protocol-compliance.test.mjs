import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import net from "node:net";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";


const require = createRequire(import.meta.url);

function resolveWebSocketImpl() {
  if (typeof globalThis.WebSocket === "function") {
    return { impl: globalThis.WebSocket, source: "globalThis.WebSocket" };
  }

  const resolutionAttempts = [
    () => require.resolve("ws", { paths: ["./ws-server"] }),
    () => require.resolve("ws")
  ];

  for (const resolvePath of resolutionAttempts) {
    try {
      const wsModulePath = resolvePath();
      const wsModule = require(wsModulePath);
      if (typeof wsModule === "function") {
        return { impl: wsModule, source: wsModulePath };
      }
      if (typeof wsModule?.WebSocket === "function") {
        return { impl: wsModule.WebSocket, source: wsModulePath };
      }
    } catch {
      // continue to fallback path
    }
  }

  return { impl: null, source: null };
}

const websocketResolution = resolveWebSocketImpl();
const WebSocketImpl = websocketResolution.impl;
const HAS_WS = typeof WebSocketImpl === "function";
const WS_RESOLUTION_HINT = "globalThis.WebSocket or require.resolve('ws', { paths: ['./ws-server'] }) or require.resolve('ws')";

let serialQueue = Promise.resolve();
function runSerial(step) {
  const run = serialQueue.then(step);
  serialQueue = run.catch(() => {});
  return run;
}

function wsOn(ws, eventName, handler, { once = false } = {}) {
  if (typeof ws.addEventListener === "function") {
    ws.addEventListener(eventName, handler, once ? { once: true } : undefined);
    return;
  }

  if (once && typeof ws.once === "function") {
    ws.once(eventName, handler);
    return;
  }

  if (typeof ws.on === "function") {
    ws.on(eventName, handler);
    return;
  }

  throw new Error(`Unsupported websocket event API for event '${eventName}'`);
}

function wsOff(ws, eventName, handler) {
  if (typeof ws.removeEventListener === "function") {
    ws.removeEventListener(eventName, handler);
    return;
  }
  if (typeof ws.off === "function") {
    ws.off(eventName, handler);
    return;
  }
  if (typeof ws.removeListener === "function") {
    ws.removeListener(eventName, handler);
  }
}

function messagePayload(arg) {
  if (arg && typeof arg === "object" && "data" in arg) {
    return arg.data;
  }
  return arg;
}

function errorPayload(arg) {
  if (arg && typeof arg === "object" && "error" in arg && arg.error) {
    return arg.error;
  }
  return arg instanceof Error ? arg : new Error("WebSocket error");
}

function closeCodePayload(arg) {
  if (arg && typeof arg === "object" && "code" in arg) {
    return arg.code;
  }
  return arg;
}

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
    const stdoutChunks = [];
    const stderrChunks = [];
    const timer = setTimeout(() => {
      cleanup();
      const stdoutText = stdoutChunks.join("").trim();
      const stderrText = stderrChunks.join("").trim();
      reject(new Error(`Server did not start in time (expected readiness marker containing "WS listening on"); stdout=${stdoutText || "<empty>"}; stderr=${stderrText || "<empty>"}`));
    }, timeoutMs);

    const onData = (buf) => {
      if (String(buf).includes("WS listening on")) {
        cleanup();
        resolve();
      }
    };

    const onStdoutData = (buf) => {
      stdoutChunks.push(String(buf));
      onData(buf);
    };

    const onStderrData = (buf) => {
      stderrChunks.push(String(buf));
      onData(buf);
    };

    const onExit = (code) => {
      cleanup();
      const stdoutText = stdoutChunks.join("").trim();
      const stderrText = stderrChunks.join("").trim();
      reject(new Error(`Server exited before ready: ${code}; stdout=${stdoutText || "<empty>"}; stderr=${stderrText || "<empty>"}`));
    };

    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout.off("data", onStdoutData);
      proc.stderr.off("data", onStderrData);
      proc.off("exit", onExit);
    };

    proc.stdout.on("data", onStdoutData);
    proc.stderr.on("data", onStderrData);
    proc.once("exit", onExit);
  });
}

function waitForExit(proc, timeoutMs = 5000) {
  if (proc.exitCode !== null) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`Server did not exit within ${timeoutMs}ms after SIGTERM`));
    }, timeoutMs);

    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
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
    const ws = new WebSocketImpl(`ws://127.0.0.1:${port}`);
    const onOpen = () => {
      wsOff(ws, "error", onError);
      resolve(ws);
    };
    const onError = (event) => {
      wsOff(ws, "open", onOpen);
      reject(errorPayload(event) ?? new Error("WebSocket open failed"));
    };

    wsOn(ws, "open", onOpen, { once: true });
    wsOn(ws, "error", onError, { once: true });
  });
}

function nextMessage(ws, timeoutMs = 5000, label = "") {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      wsOff(ws, "message", onMessage);
      wsOff(ws, "error", onError);
      wsOff(ws, "close", onClose);
    };

    const onMessage = (event) => {
      cleanup();
      resolve(JSON.parse(String(messagePayload(event))));
    };

    const onError = (event) => {
      cleanup();
      reject(errorPayload(event));
    };

    const onClose = (event) => {
      cleanup();
      reject(new Error(`Socket closed before message: ${closeCodePayload(event)}`));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for websocket message${label ? `: ${label}` : ""}`));
    }, timeoutMs);

    wsOn(ws, "message", onMessage);
    wsOn(ws, "error", onError);
    wsOn(ws, "close", onClose);
  });
}

function attemptMessage(ws, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      wsOff(ws, "message", onMessage);
      wsOff(ws, "error", onError);
      wsOff(ws, "close", onClose);
    };

    const onMessage = (event) => {
      cleanup();
      resolve(JSON.parse(String(messagePayload(event))));
    };

    const onError = (event) => {
      cleanup();
      reject(errorPayload(event));
    };

    const onClose = () => {
      cleanup();
      resolve(null);
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    wsOn(ws, "message", onMessage);
    wsOn(ws, "error", onError);
    wsOn(ws, "close", onClose);
  });
}



function drainFrames(ws, timeoutMs = 75) {
  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(timer);
      wsOff(ws, "message", onMessage);
      wsOff(ws, "error", onDone);
      wsOff(ws, "close", onDone);
    };

    const onMessage = () => {};
    const onDone = () => {
      cleanup();
      resolve();
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);

    wsOn(ws, "message", onMessage);
    wsOn(ws, "error", onDone);
    wsOn(ws, "close", onDone);
  });
}

function expectNoFrameOfType(ws, disallowedTypes, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const disallowed = new Set(disallowedTypes);

    const cleanup = () => {
      clearTimeout(timer);
      wsOff(ws, "message", onMessage);
      wsOff(ws, "error", onError);
      wsOff(ws, "close", onClose);
    };

    const onMessage = (event) => {
      let frame = null;
      try {
        frame = JSON.parse(String(messagePayload(event)));
      } catch {
        return;
      }

      if (frame && disallowed.has(frame.type)) {
        cleanup();
        reject(new Error(`Received disallowed frame type: ${frame.type}`));
      }
    };

    const onError = (event) => {
      cleanup();
      reject(errorPayload(event));
    };

    const onClose = () => {
      cleanup();
      resolve();
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);

    wsOn(ws, "message", onMessage);
    wsOn(ws, "error", onError);
    wsOn(ws, "close", onClose);
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

async function hello(ws, requestId) {
  sendFrame(ws, {
    version: "1.0",
    type: "hello",
    requestId,
    ts: "2026-02-28T00:00:00Z",
    payload: { supportedVersions: ["1.0"] }
  });
  return nextMessage(ws);
}

async function auth(ws, secret, userId, requestId) {
  sendFrame(ws, {
    version: "1.0",
    type: "auth",
    requestId,
    ts: "2026-02-28T00:00:01Z",
    payload: { token: makeHs256Jwt({ secret, sub: userId }) }
  });
  return nextMessage(ws);
}

test("protocol compliance tests are not skipped in CI", () => {
  assert.equal(
    HAS_WS,
    true,
    `WebSocket implementation is required for ws protocol compliance gate; resolved source=${websocketResolution.source ?? "unresolved"}. Tried ${WS_RESOLUTION_HINT}. Ensure ws dependency is installed for ws-server.`
  );
});

test("ws implementation resolves from same dependency graph as ws-server", () => {
  assert.equal(typeof WebSocketImpl, "function");
  assert.equal(typeof websocketResolution.source, "string");
});








test("expectNoFrameOfType ignores unrelated frames and fails on disallowed frames", async () => {
  const ws = new EventEmitter();

  const guarded = expectNoFrameOfType(ws, ["table_state"], 200);
  ws.emit("message", JSON.stringify({ type: "pong" }));
  ws.emit("message", JSON.stringify({ type: "table_state" }));

  await assert.rejects(guarded, /Received disallowed frame type: table_state/);

  const tolerant = expectNoFrameOfType(ws, ["table_state"], 100);
  ws.emit("message", JSON.stringify({ type: "pong" }));
  await tolerant;
});

test("waitForListening includes stdout+stderr in timeout diagnostics", async () => {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();

  const pending = waitForListening(proc, 50);
  proc.stdout.write("stdout line without marker\n");
  proc.stderr.write("stderr line without marker\n");

  await assert.rejects(pending, (error) => {
    assert.match(error.message, /expected readiness marker containing "WS listening on"/);
    assert.match(error.message, /stdout=stdout line without marker/);
    assert.match(error.message, /stderr=stderr line without marker/);
    return true;
  });
});

test("server shutdown is bounded after SIGTERM", async () => runSerial(async () => {
  const { child } = await createServer();
  try {
    await waitForListening(child, 5000);
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child, 3000);
  }
}));




test("bounds_exceeded emits canonical error code and rejected join does not emit table_state", async () => runSerial(async () => {
  const secret = "test-secret";
  const { port, child } = await createServer({
    env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_PRESENCE_TTL_MS: "0", WS_MAX_SEATS: "2" }
  });

  try {
    await waitForListening(child, 5000);

    const subscriber = await connectClient(port);
    const userA = await connectClient(port);
    const userB = await connectClient(port);
    const userC = await connectClient(port);

    await hello(subscriber, "req-hello-sub");
    await hello(userA, "req-hello-A");
    await hello(userB, "req-hello-B");
    await hello(userC, "req-hello-C");

    assert.equal((await auth(subscriber, secret, "user_sub", "req-auth-sub")).type, "authOk");
    assert.equal((await auth(userA, secret, "user_A", "req-auth-A")).type, "authOk");
    assert.equal((await auth(userB, secret, "user_B", "req-auth-B")).type, "authOk");
    assert.equal((await auth(userC, secret, "user_C", "req-auth-C")).type, "authOk");

    sendFrame(subscriber, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-table-A",
      ts: "2026-02-28T00:00:02Z",
      payload: { tableId: "table_A" }
    });
    const initialState = await nextMessage(subscriber, 5000, "initialState");
    assert.equal(initialState.type, "table_state");
    assert.deepEqual(initialState.payload.members, []);

    sendFrame(userA, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-A",
      ts: "2026-02-28T00:00:03Z",
      payload: { tableId: "table_A" }
    });
    assert.equal((await nextMessage(userA, 5000, "joinAAck")).type, "table_state");
    assert.equal((await nextMessage(subscriber, 5000, "joinABroadcast")).type, "table_state");

    sendFrame(userB, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-B",
      ts: "2026-02-28T00:00:04Z",
      payload: { tableId: "table_A" }
    });
    assert.equal((await nextMessage(userB, 5000, "joinBAck")).type, "table_state");
    const afterJoinB = await nextMessage(subscriber, 5000, "joinBBroadcast");
    assert.equal(afterJoinB.type, "table_state");
    assert.deepEqual(afterJoinB.payload.members, [
      { userId: "user_A", seat: 1 },
      { userId: "user_B", seat: 2 }
    ]);

    sendFrame(userC, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-C-reject",
      ts: "2026-02-28T00:00:05Z",
      payload: { tableId: "table_A" }
    });

    const reject = await nextMessage(userC, 5000, "joinCReject");
    assert.equal(reject.type, "error");
    assert.equal(reject.payload.code, "bounds_exceeded");

    await drainFrames(subscriber, 75);
    await expectNoFrameOfType(subscriber, ["table_state"], 1200);

    sendFrame(userC, {
      version: "1.0",
      type: "ping",
      requestId: "req-ping-after-reject",
      ts: "2026-02-28T00:00:06Z",
      payload: { clientTime: "2026-02-28T00:00:06Z" }
    });
    const pingReply = await nextMessage(userC, 5000, "pingAfterReject");
    assert.equal(pingReply.type, "pong");

    subscriber.close();
    userA.close();
    userB.close();
    userC.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
}));

test("table_state is emitted on join and leave with connected-only sorted members", async () => runSerial(async () => {
  const secret = "test-secret";
  const { port, child } = await createServer({
    env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_PRESENCE_TTL_MS: "0", WS_MAX_SEATS: "3" }
  });

  try {
    await waitForListening(child, 5000);

    const observer = await connectClient(port);
    const actor = await connectClient(port);

    await hello(observer, "req-hello-observer");
    await hello(actor, "req-hello-actor");

    assert.equal((await auth(observer, secret, "observer_1", "req-auth-observer")).type, "authOk");
    assert.equal((await auth(actor, secret, "actor_1", "req-auth-actor")).type, "authOk");

    sendFrame(observer, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-contract",
      ts: "2026-02-28T00:01:00Z",
      payload: { tableId: "table_contract" }
    });
    const initialState = await nextMessage(observer, 5000, "initialContractState");
    assert.deepEqual(initialState.payload.members, []);

    sendFrame(actor, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-contract",
      ts: "2026-02-28T00:01:01Z",
      payload: { tableId: "table_contract" }
    });

    const joinAck = await nextMessage(actor, 5000, "joinAck");
    const observerAfterJoin = await nextMessage(observer, 5000, "observerAfterJoin");

    assert.equal(joinAck.type, "table_state");
    assert.equal(observerAfterJoin.type, "table_state");
    assert.deepEqual(joinAck.payload.members, [{ userId: "actor_1", seat: 1 }]);
    assert.deepEqual(observerAfterJoin.payload.members, [{ userId: "actor_1", seat: 1 }]);

    sendFrame(actor, {
      version: "1.0",
      type: "table_leave",
      requestId: "req-leave-contract",
      ts: "2026-02-28T00:01:02Z",
      payload: { tableId: "table_contract" }
    });

    const leaveAck = await nextMessage(actor, 5000, "leaveAck");
    const observerAfterLeave = await nextMessage(observer, 5000, "observerAfterLeave");

    assert.equal(leaveAck.type, "table_state");
    assert.equal(observerAfterLeave.type, "table_state");
    assert.deepEqual(leaveAck.payload.members, []);
    assert.deepEqual(observerAfterLeave.payload.members, []);

    observer.close();
    actor.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
}));

test("table_state is emitted once per maintenance membership change and not emitted for no-op sweep", async () => runSerial(async () => {
  const secret = "test-secret";
  const { port, child } = await createServer({
    env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_PRESENCE_TTL_MS: "25", WS_MAX_SEATS: "2" }
  });

  try {
    await waitForListening(child, 5000);

    const observer = await connectClient(port);
    const leaver = await connectClient(port);

    await hello(observer, "req-hello-maint-observer");
    await hello(leaver, "req-hello-maint-leaver");

    assert.equal((await auth(observer, secret, "observer_maint", "req-auth-maint-observer")).type, "authOk");
    assert.equal((await auth(leaver, secret, "leaver_maint", "req-auth-maint-leaver")).type, "authOk");

    sendFrame(observer, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-maint",
      ts: "2026-02-28T00:02:00Z",
      payload: { tableId: "table_maint" }
    });
    await nextMessage(observer, 5000, "maintInitial");

    sendFrame(leaver, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-maint",
      ts: "2026-02-28T00:02:01Z",
      payload: { tableId: "table_maint" }
    });
    await nextMessage(leaver, 5000, "maintJoinAck");
    await nextMessage(observer, 5000, "maintJoinBroadcast");

    leaver.close();

    const disconnectUpdate = await nextMessage(observer, 5000, "disconnectUpdate");
    assert.equal(disconnectUpdate.type, "table_state");
    assert.deepEqual(disconnectUpdate.payload.members, []);

    await drainFrames(observer, 75);
    await expectNoFrameOfType(observer, ["table_state"], 1200);

    observer.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
}));

test("table_state is emitted once when cleanupConnection triggers immediate leave at ttl=0", async () => runSerial(async () => {
  const secret = "test-secret";
  const { port, child } = await createServer({
    env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_PRESENCE_TTL_MS: "0", WS_MAX_SEATS: "2" }
  });

  try {
    await waitForListening(child, 5000);

    const observer = await connectClient(port);
    const leaver = await connectClient(port);

    await hello(observer, "req-hello-cleanup-observer");
    await hello(leaver, "req-hello-cleanup-leaver");

    assert.equal((await auth(observer, secret, "observer_cleanup", "req-auth-cleanup-observer")).type, "authOk");
    assert.equal((await auth(leaver, secret, "leaver_cleanup", "req-auth-cleanup-leaver")).type, "authOk");

    sendFrame(observer, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-cleanup",
      ts: "2026-02-28T00:03:00Z",
      payload: { tableId: "table_cleanup" }
    });
    await nextMessage(observer, 5000, "cleanupInitial");

    sendFrame(leaver, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-cleanup",
      ts: "2026-02-28T00:03:01Z",
      payload: { tableId: "table_cleanup" }
    });
    await nextMessage(leaver, 5000, "cleanupJoinAck");
    await nextMessage(observer, 5000, "cleanupJoinBroadcast");

    leaver.close();

    const cleanupLeaveState = await nextMessage(observer, 5000, "cleanupLeaveState");
    assert.equal(cleanupLeaveState.type, "table_state");
    assert.deepEqual(cleanupLeaveState.payload.members, []);

    await drainFrames(observer, 75);
    await expectNoFrameOfType(observer, ["table_state"], 1200);

    observer.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
}));
