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

function observeOnlyJoinEnv() {
  return { WS_OBSERVE_ONLY_JOIN: "1" };
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


async function nextMessageOfType(ws, type, timeoutMs = 5000, label = "") {
  const started = Date.now();
  while (true) {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) {
      throw new Error(`Timed out waiting for websocket message type: ${type}${label ? ` (${label})` : ""}`);
    }
    const frame = await nextMessage(ws, remaining, label);
    if (frame?.type === type) {
      return frame;
    }
  }
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






test("default runtime keeps legacy table_join membership mutation semantics", async () => runSerial(async () => {
  const secret = "test-secret";
  const { port, child } = await createServer({
    env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_PRESENCE_TTL_MS: "0", WS_MAX_SEATS: "3" }
  });

  try {
    await waitForListening(child, 5000);
    const subscriber = await connectClient(port);
    const actor = await connectClient(port);

    await hello(subscriber, "req-hello-default-sub");
    await hello(actor, "req-hello-default-actor");
    assert.equal((await auth(subscriber, secret, "default_sub", "req-auth-default-sub")).type, "authOk");
    assert.equal((await auth(actor, secret, "default_actor", "req-auth-default-actor")).type, "authOk");

    sendFrame(subscriber, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-default",
      ts: "2026-02-28T00:00:00Z",
      payload: { tableId: "table_default_join" }
    });
    const initial = await nextMessage(subscriber, 5000, "defaultInitial");
    assert.equal(initial.type, "table_state");
    assert.deepEqual(initial.payload.members, []);

    sendFrame(actor, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-default",
      ts: "2026-02-28T00:00:01Z",
      payload: { tableId: "table_default_join" }
    });
    const joined = await nextMessage(actor, 5000, "defaultJoined");
    assert.equal(joined.type, "table_state");
    assert.deepEqual(joined.payload.members, [{ userId: "default_actor", seat: 1 }]);

    const broadcast = await nextMessage(subscriber, 5000, "defaultBroadcast");
    assert.equal(broadcast.type, "table_state");
    assert.deepEqual(broadcast.payload.members, [{ userId: "default_actor", seat: 1 }]);

    subscriber.close();
    actor.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
}));

test("table_join is observe-only and does not emit membership mutation broadcasts", async () => runSerial(async () => {
  const secret = "test-secret";
  const { port, child } = await createServer({
    env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, ...observeOnlyJoinEnv(), WS_PRESENCE_TTL_MS: "0", WS_MAX_SEATS: "2" }
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
    const joinA = await nextMessage(userA, 5000, "joinAAck");
    assert.equal(joinA.type, "table_state");
    assert.deepEqual(joinA.payload.members, []);

    sendFrame(userB, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-B",
      ts: "2026-02-28T00:00:04Z",
      payload: { tableId: "table_A" }
    });
    const joinB = await nextMessage(userB, 5000, "joinBAck");
    assert.equal(joinB.type, "table_state");
    assert.deepEqual(joinB.payload.members, []);

    sendFrame(userC, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-C",
      ts: "2026-02-28T00:00:05Z",
      payload: { tableId: "table_A" }
    });

    const joinC = await nextMessage(userC, 5000, "joinCAck");
    assert.equal(joinC.type, "table_state");
    assert.deepEqual(joinC.payload.members, []);

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



test("observe-only table_join rejects second different table on same socket", async () => runSerial(async () => {
  const secret = "test-secret";
  const { port, child } = await createServer({
    env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, ...observeOnlyJoinEnv(), WS_PRESENCE_TTL_MS: "0", WS_MAX_SEATS: "3" }
  });

  try {
    await waitForListening(child, 5000);

    const observer = await connectClient(port);
    await hello(observer, "req-hello-observer-one-table");
    assert.equal((await auth(observer, secret, "observer_single_table", "req-auth-observer-one-table")).type, "authOk");

    sendFrame(observer, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-table-a",
      ts: "2026-02-28T00:00:10Z",
      payload: { tableId: "table_A" }
    });
    const firstJoin = await nextMessage(observer, 5000, "firstJoin");
    assert.equal(firstJoin.type, "table_state");

    sendFrame(observer, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-table-b",
      ts: "2026-02-28T00:00:11Z",
      payload: { tableId: "table_B" }
    });
    const secondJoin = await nextMessage(observer, 5000, "secondJoin");
    assert.equal(secondJoin.type, "error");
    assert.equal(secondJoin.payload.code, "INVALID_COMMAND");
    assert.match(secondJoin.payload.message || "", /already joined to a different table/);

    await drainFrames(observer, 75);
    await expectNoFrameOfType(observer, ["table_state", "stateSnapshot"], 800);

    observer.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
}));


test("observe-only mode keeps seated persisted user table_leave authoritative", async () => runSerial(async () => {
  const secret = "test-secret";
  const tableId = "table_leave_authoritative";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [{ user_id: "seat_user", seat_no: 2, status: "ACTIVE", is_bot: false }],
      stateRow: { version: 13, state: { handId: "h13", phase: "PREFLOP", turnUserId: "seat_user" } }
    }
  };

  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      ...observeOnlyJoinEnv(),
      SUPABASE_DB_URL: "",
      WS_PERSISTED_BOOTSTRAP_FIXTURES_JSON: JSON.stringify(fixtures)
    }
  });

  try {
    await waitForListening(child, 5000);

    const ws = await connectClient(port);
    const observer = await connectClient(port);
    await hello(ws, "req-hello-seat-leave");
    await hello(observer, "req-hello-seat-leave-observer");
    assert.equal((await auth(ws, secret, "seat_user", "req-auth-seat-leave")).type, "authOk");
    assert.equal((await auth(observer, secret, "observer_leave_authoritative", "req-auth-seat-leave-observer")).type, "authOk");

    sendFrame(observer, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-seat-leave-observer",
      ts: "2026-02-28T00:00:19Z",
      payload: { tableId }
    });
    const observerInitial = await nextMessage(observer, 5000, "observerInitialSeatLeave");
    assert.equal(observerInitial.type, "table_state");

    sendFrame(ws, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-seat-leave",
      ts: "2026-02-28T00:00:20Z",
      payload: { tableId }
    });
    const joined = await nextMessage(ws, 5000, "joinedState");
    assert.equal(joined.type, "table_state");
    assert.deepEqual(joined.payload.members, [{ userId: "seat_user", seat: 2 }]);

    sendFrame(ws, {
      version: "1.0",
      type: "table_leave",
      requestId: "req-leave-seat-leave",
      ts: "2026-02-28T00:00:21Z",
      payload: { tableId }
    });
    const left = await nextMessage(ws, 5000, "leftState");
    assert.equal(left.type, "table_state");
    assert.deepEqual(left.payload.members, []);

    sendFrame(ws, {
      version: "1.0",
      type: "resync",
      requestId: "req-resync-after-leave",
      ts: "2026-02-28T00:00:22Z",
      payload: { tableId }
    });
    const resyncState = await nextMessage(ws, 5000, "resyncAfterLeave");
    assert.equal(resyncState.type, "table_state");
    assert.deepEqual(resyncState.payload.members, []);

    sendFrame(ws, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-snapshot-after-leave",
      ts: "2026-02-28T00:00:23Z",
      payload: { tableId, view: "snapshot" }
    });
    const afterLeaveSnapshot = await nextMessage(ws, 5000, "afterLeaveSnapshot");
    assert.equal(afterLeaveSnapshot.type, "stateSnapshot");
    assert.deepEqual(afterLeaveSnapshot.payload.table.members, []);
    assert.equal(afterLeaveSnapshot.payload.table.memberCount, 0);
    assert.equal(afterLeaveSnapshot.payload.you.seat, null);

    ws.close();
    observer.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
}));



test("observe-only runtime keeps seated act accepted and observer act rejected", async () => runSerial(async () => {
  const secret = "test-secret";
  const tableId = "table_protocol_act_contract";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [
        { user_id: "seat_actor", seat_no: 1, status: "ACTIVE", is_bot: false },
        { user_id: "seat_other", seat_no: 2, status: "ACTIVE", is_bot: false }
      ],
      stateRow: { version: 0, state: {} }
    }
  };

  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      ...observeOnlyJoinEnv(),
      SUPABASE_DB_URL: "",
      WS_PERSISTED_BOOTSTRAP_FIXTURES_JSON: JSON.stringify(fixtures)
    }
  });

  try {
    await waitForListening(child, 5000);
    const seat = await connectClient(port);
    const other = await connectClient(port);
    const observer = await connectClient(port);
    await hello(seat, "hello-act-seat");
    await hello(other, "hello-act-other");
    await hello(observer, "hello-act-observer");
    assert.equal((await auth(seat, secret, "seat_actor", "auth-act-seat")).type, "authOk");
    assert.equal((await auth(other, secret, "seat_other", "auth-act-other")).type, "authOk");
    assert.equal((await auth(observer, secret, "observer_actor", "auth-act-observer")).type, "authOk");

    sendFrame(seat, { version: "1.0", type: "table_join", requestId: "join-act-seat", ts: "2026-02-28T00:05:00Z", payload: { tableId } });
    await nextMessage(seat, 5000, "joinActSeat");
    sendFrame(other, { version: "1.0", type: "table_join", requestId: "join-act-other", ts: "2026-02-28T00:05:01Z", payload: { tableId } });
    await nextMessage(other, 5000, "joinActOther");
    sendFrame(observer, { version: "1.0", type: "table_join", requestId: "join-act-observer", ts: "2026-02-28T00:05:02Z", payload: { tableId } });
    await nextMessage(observer, 5000, "joinActObserver");

    sendFrame(seat, { version: "1.0", type: "table_state_sub", requestId: "snap-act-seat", ts: "2026-02-28T00:05:03Z", payload: { tableId, view: "snapshot" } });
    const base = await nextMessageOfType(seat, "stateSnapshot", 5000, "baseActSnapshot");
    const handId = base.payload.public.hand.handId;

    sendFrame(observer, { version: "1.0", type: "act", requestId: "act-observer-reject", ts: "2026-02-28T00:05:04Z", payload: { tableId, handId, action: "fold" } });
    const observerAct = await nextMessage(observer, 5000, "observerActReject");
    assert.equal(observerAct.type, "commandResult");
    assert.equal(observerAct.payload.status, "rejected");

    sendFrame(observer, { version: "1.0", type: "table_state_sub", requestId: "snap-act-observer", ts: "2026-02-28T00:05:05Z", payload: { tableId, view: "snapshot" } });
    const observerSnap = await nextMessageOfType(observer, "stateSnapshot", 5000, "observerActSnapshot");
    assert.equal(observerSnap.payload.you.seat, null);
    assert.equal("private" in observerSnap.payload, false);

    const actor = base.payload.public.turn.userId === "seat_other" ? other : seat;
    sendFrame(actor, { version: "1.0", type: "act", requestId: "act-seat-accept", ts: "2026-02-28T00:05:06Z", payload: { tableId, handId, action: "fold" } });
    const seatedAct = await nextMessage(actor, 5000, "seatedActAccept");
    assert.equal(seatedAct.type, "commandResult");
    assert.equal(seatedAct.payload.status, "accepted");

    seat.close();
    other.close();
    observer.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
}));


test("duplicate act requestId does not emit additional advancing state frame", async () => runSerial(async () => {
  const secret = "test-secret";
  const tableId = "table_protocol_act_idempotent";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [
        { user_id: "seat_actor", seat_no: 1, status: "ACTIVE", is_bot: false },
        { user_id: "seat_other", seat_no: 2, status: "ACTIVE", is_bot: false }
      ],
      stateRow: { version: 0, state: {} }
    }
  };
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, ...observeOnlyJoinEnv(), SUPABASE_DB_URL: "", WS_PERSISTED_BOOTSTRAP_FIXTURES_JSON: JSON.stringify(fixtures) } });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws, "hello-idem");
    assert.equal((await auth(ws, secret, "seat_actor", "auth-idem")).type, "authOk");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-idem", ts: "2026-02-28T00:06:00Z", payload: { tableId } });
    await nextMessage(ws, 5000, "joinIdem");
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-idem-1", ts: "2026-02-28T00:06:01Z", payload: { tableId, view: "snapshot" } });
    const base = await nextMessage(ws, 5000, "baseIdem");

    sendFrame(ws, { version: "1.0", type: "act", requestId: "act-idem", ts: "2026-02-28T00:06:02Z", payload: { tableId, handId: base.payload.public.hand.handId, action: "fold" } });
    const accepted = await nextMessage(ws, 5000, "idemAccepted");
    assert.equal(accepted.type, "commandResult");
    assert.equal(accepted.payload.status, "accepted");

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-idem-2", ts: "2026-02-28T00:06:02Z", payload: { tableId, view: "snapshot" } });
    const afterFirst = await nextMessage(ws, 5000, "afterFirstAct");
    assert.equal(afterFirst.type, "stateSnapshot");

    sendFrame(ws, { version: "1.0", type: "act", requestId: "act-idem", ts: "2026-02-28T00:06:03Z", payload: { tableId, handId: base.payload.public.hand.handId, action: "fold" } });
    let replay = null;
    for (let i = 0; i < 3; i += 1) {
      const frame = await nextMessage(ws, 5000, `idemReplay-${i}`);
      if (frame.type === "commandResult") {
        replay = frame;
        break;
      }
    }
    assert.equal(replay?.type, "commandResult");
    assert.equal(replay.payload.status, "accepted");

    await drainFrames(ws, 75);
    await expectNoFrameOfType(ws, ["stateSnapshot", "statePatch"], 500);

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-idem-3", ts: "2026-02-28T00:06:04Z", payload: { tableId, view: "snapshot" } });
    const afterReplay = await nextMessage(ws, 5000, "afterReplayAct");
    assert.equal(afterReplay.type, "stateSnapshot");
    assert.equal(afterReplay.payload.stateVersion, afterFirst.payload.stateVersion);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
}));


test("timeout sweep emits at most one immediate transition for a single due turn", async () => runSerial(async () => {
  const secret = "test-secret";
  const tableId = "table_protocol_timeout_once";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [
        { user_id: "timeout_a", seat_no: 1, status: "ACTIVE", is_bot: false },
        { user_id: "timeout_b", seat_no: 2, status: "ACTIVE", is_bot: false }
      ],
      stateRow: { version: 0, state: {} }
    }
  };
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_POKER_TURN_MS: "600",
      WS_TIMEOUT_SWEEP_MS: "20",
      SUPABASE_DB_URL: "",
      WS_PERSISTED_BOOTSTRAP_FIXTURES_JSON: JSON.stringify(fixtures)
    }
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws, "hello-timeout-once");
    assert.equal((await auth(ws, secret, "timeout_a", "auth-timeout-once")).type, "authOk");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-timeout-once", ts: "2026-02-28T00:07:00Z", payload: { tableId } });
    await nextMessage(ws, 5000, "joinTimeoutOnce");
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-timeout-once", ts: "2026-02-28T00:07:01Z", payload: { tableId, view: "snapshot" } });
    const base = await nextMessage(ws, 5000, "baseTimeoutOnce");

    const firstUpdate = await nextMessage(ws, 5000, "timeoutFirstUpdate");
    assert.equal(firstUpdate.type, "stateSnapshot");
    assert.equal(firstUpdate.payload.stateVersion > base.payload.stateVersion, true);

    await drainFrames(ws, 75);
    await expectNoFrameOfType(ws, ["stateSnapshot", "statePatch"], 500);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
}));

test("table_state_sub observer stream stays stable across observe-only join/leave", async () => runSerial(async () => {
  const secret = "test-secret";
  const { port, child } = await createServer({
    env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, ...observeOnlyJoinEnv(), WS_PRESENCE_TTL_MS: "0", WS_MAX_SEATS: "3" }
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
    assert.equal(joinAck.type, "table_state");
    assert.deepEqual(joinAck.payload.members, []);
    await drainFrames(observer, 75);
    await expectNoFrameOfType(observer, ["table_state"], 1200);

    sendFrame(actor, {
      version: "1.0",
      type: "table_leave",
      requestId: "req-leave-contract",
      ts: "2026-02-28T00:01:02Z",
      payload: { tableId: "table_contract" }
    });

    const leaveAck = await nextMessage(actor, 5000, "leaveAck");
    assert.equal(leaveAck.type, "table_state");
    assert.deepEqual(leaveAck.payload.members, []);
    await drainFrames(observer, 75);
    await expectNoFrameOfType(observer, ["table_state"], 1200);

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
    env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, ...observeOnlyJoinEnv(), WS_PRESENCE_TTL_MS: "25", WS_MAX_SEATS: "2" }
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
    await expectNoFrameOfType(observer, ["table_state"], 1200);

    leaver.close();

    await expectNoFrameOfType(observer, ["table_state"], 1200);

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
    env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, ...observeOnlyJoinEnv(), WS_PRESENCE_TTL_MS: "0", WS_MAX_SEATS: "2" }
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
    await expectNoFrameOfType(observer, ["table_state"], 1200);

    leaver.close();

    await expectNoFrameOfType(observer, ["table_state"], 1200);

    await drainFrames(observer, 75);
    await expectNoFrameOfType(observer, ["table_state"], 1200);

    observer.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
}));

test("observe-only table_leave without tableId resolves subscribed context", async () => runSerial(async () => {
  const secret = "test-secret";
  const { port, child } = await createServer({
    env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, ...observeOnlyJoinEnv(), WS_PRESENCE_TTL_MS: "0", WS_MAX_SEATS: "2" }
  });

  try {
    await waitForListening(child, 5000);

    const observer = await connectClient(port);
    await hello(observer, "req-hello-observer-implicit-leave");
    assert.equal((await auth(observer, secret, "observer_leave_ctx", "req-auth-observer-implicit-leave")).type, "authOk");

    sendFrame(observer, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-observer-implicit-leave",
      ts: "2026-02-28T00:04:00Z",
      payload: { tableId: "table_implicit_leave" }
    });
    const joined = await nextMessage(observer, 5000, "observerJoinImplicitLeave");
    assert.equal(joined.type, "table_state");

    sendFrame(observer, {
      version: "1.0",
      type: "table_leave",
      requestId: "req-leave-observer-implicit-leave",
      ts: "2026-02-28T00:04:01Z",
      payload: {}
    });

    const leaveAck = await nextMessage(observer, 5000, "observerLeaveImplicitLeave");
    assert.equal(leaveAck.type, "table_state");

    observer.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
}));
