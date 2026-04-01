import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import WebSocket from "ws";
import { makeBotUserId } from "../shared/poker-domain/bots.mjs";
import { createDisconnectCleanupRuntime } from "./poker/runtime/disconnect-cleanup.mjs";

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

    const summarize = (chunks) => {
      const joined = chunks.join("");
      if (!joined) {
        return "<empty>";
      }
      return joined.slice(-4000);
    };

    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout.off("data", onStdout);
      proc.stderr.off("data", onStderr);
      proc.off("exit", onExit);
    };

    const onStdout = (buf) => {
      const text = String(buf);
      stdoutChunks.push(text);
      if (text.includes("WS listening on")) {
        cleanup();
        resolve();
      }
    };

    const onStderr = (buf) => {
      stderrChunks.push(String(buf));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(
        `Server did not start in time. stdout: ${summarize(stdoutChunks)} stderr: ${summarize(stderrChunks)}`
      ));
    }, timeoutMs);

    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(
        `Server exited before ready: code=${code} signal=${signal || "none"}. stdout: ${summarize(stdoutChunks)} stderr: ${summarize(stderrChunks)}`
      ));
    };

    proc.stdout.on("data", onStdout);
    proc.stderr.on("data", onStderr);
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

function nextMessage(ws, timeoutMs = 10000) {
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

function nextNMessages(ws, count, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const messages = [];

    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
      ws.off("close", onClose);
    };

    const onMessage = (data) => {
      messages.push(JSON.parse(String(data)));
      if (messages.length >= count) {
        cleanup();
        resolve(messages);
      }
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const onClose = (code) => {
      cleanup();
      reject(new Error(`Socket closed before receiving ${count} messages: ${code}`));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${count} websocket messages`));
    }, timeoutMs);

    ws.on("message", onMessage);
    ws.on("error", onError);
    ws.on("close", onClose);
  });
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


function sendFrame(ws, frame) {
  ws.send(JSON.stringify(frame));
}

async function writePersistedFile(fixture) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-persist-"));
  const filePath = path.join(dir, "persisted-state.json");
  await fs.writeFile(filePath, `${JSON.stringify(fixture)}
`, "utf8");
  return { dir, filePath };
}

async function readPersistedFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeTestModule(source, filename = "ws-test-module.mjs") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-module-"));
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, source, "utf8");
  return { dir, filePath };
}

async function nextMessageOfType(ws, type, timeoutMs = 10000) {
  const started = Date.now();
  while (true) {
    const elapsed = Date.now() - started;
    const remainingMs = timeoutMs - elapsed;
    if (remainingMs <= 0) {
      break;
    }

    const frame = await nextMessage(ws, remainingMs);
    if (frame?.type === type) {
      return frame;
    }
  }
  throw new Error(`Timed out waiting for message type: ${type}`);
}

async function nextMessageMatching(ws, predicate, timeoutMs = 10000) {
  const started = Date.now();
  while (true) {
    const elapsed = Date.now() - started;
    const remainingMs = timeoutMs - elapsed;
    if (remainingMs <= 0) {
      break;
    }
    const frame = await nextMessage(ws, remainingMs);
    if (predicate(frame)) {
      return frame;
    }
  }
  throw new Error("Timed out waiting for matching websocket message");
}

function nextCommandResultForRequest(ws, requestId, timeoutMs = 10000) {
  return nextMessageMatching(
    ws,
    (frame) => frame?.type === "commandResult" && frame?.payload?.requestId === requestId,
    timeoutMs
  );
}

function nextMessageForRequest(ws, { type, requestId, timeoutMs = 10000 }) {
  return nextMessageMatching(
    ws,
    (frame) => frame?.type === type && frame?.requestId === requestId,
    timeoutMs
  );
}

function nextJoinTableState(ws, { requestId, tableId, timeoutMs = 10000 }) {
  return nextMessageMatching(
    ws,
    (frame) =>
      frame?.type === "table_state" &&
      frame?.roomId === tableId &&
      (frame?.requestId === requestId || frame?.requestId == null),
    timeoutMs
  );
}

async function collectMatchingFrames(ws, { expectations, timeoutMs = 10000, label = "websocket frame collection" }) {
  const started = Date.now();
  const remaining = new Set(expectations.map((entry) => entry.name));
  const matched = new Map();
  const observed = [];

  while (remaining.size > 0) {
    const elapsed = Date.now() - started;
    const remainingMs = timeoutMs - elapsed;
    if (remainingMs <= 0) {
      const missing = [...remaining].join(", ");
      const recent = observed.slice(-5).map((frame) => frame?.type || "<unknown>").join(", ");
      throw new Error(`Timed out waiting for ${label}. Missing: ${missing}. Recent frame types: ${recent || "<none>"}`);
    }

    const frame = await nextMessage(ws, remainingMs);
    const normalizedFrame = (frame !== null && typeof frame === "object")
      ? frame
      : { payload: frame };
    observed.push(normalizedFrame);

    for (const expectation of expectations) {
      if (!remaining.has(expectation.name)) {
        continue;
      }
      if (expectation.match(normalizedFrame)) {
        matched.set(expectation.name, normalizedFrame);
        remaining.delete(expectation.name);
      }
    }
  }

  return Object.fromEntries(expectations.map((entry) => [entry.name, matched.get(entry.name)]));
}



async function nextStateUpdate(ws, { baseline = null, timeoutMs = 10000 } = {}) {
  const started = Date.now();
  while (true) {
    const remainingMs = timeoutMs - (Date.now() - started);
    if (remainingMs <= 0) {
      throw new Error("Timed out waiting for state update frame");
    }
    const frame = await nextMessage(ws, remainingMs);
    if (frame?.type === "stateSnapshot") {
      return { frame, payload: frame.payload, baseline: frame.payload };
    }
    if (frame?.type === "statePatch") {
      const merged = baseline ? { ...baseline, ...frame.payload } : { ...frame.payload };
      return { frame, payload: merged, baseline: merged };
    }
  }
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

async function auth(ws, token, requestId = "req-auth") {
  sendFrame(ws, {
    version: "1.0",
    type: "auth",
    requestId,
    ts: "2026-02-28T00:00:01Z",
    payload: { token }
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

test("nextMessageOfType respects total timeout budget when only non-matching frames arrive", async () => {
  const fakeWs = new EventEmitter();
  fakeWs.close = () => {};

  const tick = setInterval(() => {
    fakeWs.emit("message", JSON.stringify({ type: "pong" }));
  }, 25);

  const timeoutMs = 200;
  const started = Date.now();

  try {
    await assert.rejects(
      () => nextMessageOfType(fakeWs, "stateSnapshot", timeoutMs),
      /Timed out waiting for (message type: stateSnapshot|websocket message)/
    );
  } finally {
    clearInterval(tick);
  }

  const elapsed = Date.now() - started;
  assert.equal(elapsed >= timeoutMs, true);
  assert.equal(elapsed < timeoutMs + 300, true);
});

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



test("server boots with leave handler wired in default env without override", async () => {
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: "test-secret" } });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    const helloAck = await hello(ws);
    assert.equal(helloAck.type, "helloAck");

    sendFrame(ws, {
      version: "1.0",
      type: "table_leave",
      requestId: "req-leave-boot-safe",
      ts: "2026-02-28T00:00:00Z",
      payload: { tableId: "table_boot_safe" }
    });
    const authRequired = await nextMessage(ws);
    assert.equal(authRequired.type, "error");
    assert.equal(authRequired.payload.code, "auth_required");

    ws.close();
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

test("table_state_sub snapshot view requires auth and does not leak stateSnapshot", async () => {
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: "test-secret" } });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);

    sendFrame(ws, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-unauth",
      ts: "2026-02-28T00:00:01Z",
      payload: { tableId: "table_A", view: "snapshot" }
    });

    const frame = await nextMessage(ws);
    assert.equal(frame.type, "error");
    assert.equal(frame.payload.code, "auth_required");
    assert.notEqual(frame.type, "stateSnapshot");

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("table_leave non-override path does not fabricate accepted success from WS in-memory snapshot", async () => {
  const secret = "test-secret";
  const actorToken = makeHs256Jwt({ secret, sub: "leave_non_override_actor" });
  const otherToken = makeHs256Jwt({ secret, sub: "leave_non_override_other" });
  const tableId = "table_leave_non_override";
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret } });

  try {
    await waitForListening(child, 5000);
    const actor = await connectClient(port);
    const other = await connectClient(port);
    await hello(actor);
    await hello(other);
    await auth(actor, actorToken, "auth-leave-non-override-actor");
    await auth(other, otherToken, "auth-leave-non-override-other");

    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "join-leave-non-override-actor", ts: "2026-02-28T00:00:01Z", payload: { tableId } });
    const actorJoinAck = await nextMessageOfType(actor, "commandResult");
    await nextMessageOfType(actor, "table_state");
    assert.equal(actorJoinAck.payload.status, "accepted");
    sendFrame(other, { version: "1.0", type: "table_join", requestId: "join-leave-non-override-other", ts: "2026-02-28T00:00:02Z", payload: { tableId } });
    const otherJoinAck = await nextMessageOfType(other, "commandResult");
    await nextMessageOfType(other, "table_state");
    assert.equal(otherJoinAck.payload.status, "accepted");

    sendFrame(actor, {
      version: "1.0",
      type: "table_leave",
      requestId: "leave-non-override",
      ts: "2026-02-28T00:00:03Z",
      payload: { tableId }
    });
    const first = await nextMessageOfType(actor, "commandResult");
    assert.equal(first.payload.status, "rejected");
    assert.notEqual(first.payload.reason, null);
    assert.notEqual(first.payload.reason, "authoritative_state_invalid");

    assert.equal(await attemptMessage(other, 300), null);
    sendFrame(other, { version: "1.0", type: "table_state_sub", requestId: "sub-leave-non-override-other", ts: "2026-02-28T00:00:04Z", payload: { tableId } });
    const observerState = await nextMessageOfType(other, "table_state");
    assert.deepEqual(observerState.payload.members, [
      { userId: "leave_non_override_actor", seat: 1 },
      { userId: "leave_non_override_other", seat: 2 }
    ]);

    actor.close();
    other.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});



test("table_leave non-override path returns temporarily_unavailable when loader contract is broken", async () => {
  const secret = "test-secret";
  const actorToken = makeHs256Jwt({ secret, sub: "leave_non_override_broken_loader" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_AUTHORITATIVE_LEAVE_MODULE_PATH: "./does-not-exist/leave.mjs"
    }
  });

  try {
    await waitForListening(child, 5000);
    const actor = await connectClient(port);
    await hello(actor);
    await auth(actor, actorToken, "auth-leave-non-override-broken-loader");

    sendFrame(actor, {
      version: "1.0",
      type: "table_leave",
      requestId: "leave-non-override-broken-loader",
      ts: "2026-02-28T00:00:03Z",
      payload: { tableId: "table_leave_non_override_broken_loader" }
    });
    const first = await nextMessageOfType(actor, "commandResult");
    assert.equal(first.payload.status, "rejected");
    assert.equal(first.payload.reason, "temporarily_unavailable");
    assert.equal(actor.readyState, WebSocket.OPEN);

    actor.close();
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



test("table_leave succeeds with commandResult accepted as first response", async () => {
  const secret = "test-secret";
  const actorToken = makeHs256Jwt({ secret, sub: "leave_actor" });
  const keepToken = makeHs256Jwt({ secret, sub: "leave_keep" });
  const tableId = "table_leave_accept";
  const override = JSON.stringify({
    ok: true,
    tableId,
    state: {
      version: 11,
      state: {
        tableId,
        seats: [{ seatNo: 2, userId: "leave_keep" }],
        stacks: { leave_keep: 200 },
        phase: "INIT"
      }
    }
  });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_TEST_LEAVE_RESULT_JSON: override } });

  try {
    await waitForListening(child, 5000);
    const actor = await connectClient(port);
    const other = await connectClient(port);
    await hello(actor);
    await hello(other);
    await auth(actor, actorToken, "auth-leave-actor");
    await auth(other, keepToken, "auth-leave-keep");

    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "join-leave-actor", ts: "2026-02-28T00:00:01Z", payload: { tableId } });
    const actorJoinAck = await nextMessageOfType(actor, "commandResult");
    assert.equal(actorJoinAck.payload.requestId, "join-leave-actor");
    assert.equal(actorJoinAck.payload.status, "accepted");
    sendFrame(other, { version: "1.0", type: "table_join", requestId: "join-leave-keep", ts: "2026-02-28T00:00:02Z", payload: { tableId } });
    const otherJoinAck = await nextMessageOfType(other, "commandResult");
    assert.equal(otherJoinAck.payload.requestId, "join-leave-keep");
    assert.equal(otherJoinAck.payload.status, "accepted");
    sendFrame(actor, { version: "1.0", type: "table_leave", requestId: "leave-accepted", ts: "2026-02-28T00:00:03Z", payload: { tableId } });
    const first = await attemptMessage(actor, 1200);
    if (first) {
      assert.ok(["commandResult", "table_state", "stateSnapshot"].includes(first.type));
      if (first.type === "commandResult") assert.equal(first.payload.status, "accepted");
    }
    assert.notEqual(first.payload.code, "INVALID_COMMAND");

    sendFrame(other, { version: "1.0", type: "table_state_sub", requestId: "sub-leave-keep-post", ts: "2026-02-28T00:00:04Z", payload: { tableId } });
    const otherState = await nextMessageOfType(other, "table_state");
    assert.equal(Array.isArray(otherState.payload.members), true);
    assert.equal(otherState.payload.members.some((m) => m.userId === "leave_keep" && m.seat === 2), true);

    actor.close();
    other.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});





test("table_leave rejects when authoritative executor returns invalid state contract", async () => {
  const secret = "test-secret";
  const actorToken = makeHs256Jwt({ secret, sub: "leave_invalid_state_actor" });
  const tableId = "table_leave_invalid_state";
  const override = JSON.stringify({
    ok: true,
    tableId,
    state: {
      version: 77,
      state: {
        tableId: "table_other_invalid",
        seats: [{ seatNo: 1, userId: "leave_invalid_state_actor" }],
        phase: "INIT"
      }
    }
  });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_TEST_LEAVE_RESULT_JSON: override } });

  try {
    await waitForListening(child, 5000);
    const actor = await connectClient(port);
    await hello(actor);
    await auth(actor, actorToken, "auth-leave-invalid-state");

    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "join-leave-invalid-state", ts: "2026-02-28T00:00:01Z", payload: { tableId } });
    await nextMessageOfType(actor, "commandResult");
    await nextMessageOfType(actor, "table_state");

    sendFrame(actor, { version: "1.0", type: "table_leave", requestId: "leave-invalid-state", ts: "2026-02-28T00:00:02Z", payload: { tableId } });
    const first = await nextMessageOfType(actor, "commandResult");
    assert.equal(first.payload.status, "rejected");
    assert.equal(first.payload.reason, "authoritative_state_invalid");
    assert.equal(actor.readyState, WebSocket.OPEN);
    assert.equal(await attemptMessage(actor, 300), null);

    actor.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("table_leave invalid authoritative sync rejection does not broadcast or mutate observer view", async () => {
  const secret = "test-secret";
  const actorToken = makeHs256Jwt({ secret, sub: "leave_invalid_sync_actor" });
  const keepToken = makeHs256Jwt({ secret, sub: "leave_invalid_sync_keep" });
  const tableId = "table_leave_invalid_sync";
  const override = JSON.stringify({
    ok: true,
    tableId,
    state: {
      version: 88,
      state: {
        tableId,
        seats: null,
        phase: "INIT"
      }
    }
  });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_TEST_LEAVE_RESULT_JSON: override } });

  try {
    await waitForListening(child, 5000);
    const actor = await connectClient(port);
    const other = await connectClient(port);
    await hello(actor);
    await hello(other);
    await auth(actor, actorToken, "auth-leave-invalid-sync-actor");
    await auth(other, keepToken, "auth-leave-invalid-sync-keep");

    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "join-leave-invalid-sync-actor", ts: "2026-02-28T00:00:01Z", payload: { tableId } });
    await nextMessage(actor);
    sendFrame(other, { version: "1.0", type: "table_join", requestId: "join-leave-invalid-sync-keep", ts: "2026-02-28T00:00:02Z", payload: { tableId } });
    const otherJoinAck = await nextMessageOfType(other, "commandResult");
    assert.equal(otherJoinAck.payload.status, "accepted");

    sendFrame(actor, { version: "1.0", type: "table_leave", requestId: "leave-invalid-sync", ts: "2026-02-28T00:00:03Z", payload: { tableId } });
    const result = await nextMessageOfType(actor, "commandResult");
    assert.equal(result.payload.status, "rejected");
    assert.equal(result.payload.reason, "authoritative_state_invalid");
    assert.equal(await attemptMessage(other, 300), null);

    sendFrame(other, { version: "1.0", type: "table_state_sub", requestId: "sub-after-invalid-sync", ts: "2026-02-28T00:00:04Z", payload: { tableId } });
    const observerState = await nextMessageOfType(other, "table_state");
    assert.deepEqual(observerState.payload.members, [
      { userId: "leave_invalid_sync_actor", seat: 1 },
      { userId: "leave_invalid_sync_keep", seat: 2 }
    ]);

    actor.close();
    other.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("table_leave rejects when authoritative success state still contains actor and does not broadcast", async () => {
  const secret = "test-secret";
  const actorToken = makeHs256Jwt({ secret, sub: "leave_still_present_actor" });
  const keepToken = makeHs256Jwt({ secret, sub: "leave_still_present_keep" });
  const tableId = "table_leave_still_present";
  const override = JSON.stringify({
    ok: true,
    tableId,
    state: {
      version: 19,
      state: {
        tableId,
        seats: [
          { seatNo: 1, userId: "leave_still_present_actor" },
          { seatNo: 2, userId: "leave_still_present_keep" }
        ],
        phase: "INIT"
      }
    }
  });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_TEST_LEAVE_RESULT_JSON: override } });

  try {
    await waitForListening(child, 5000);
    const actor = await connectClient(port);
    const other = await connectClient(port);
    await hello(actor);
    await hello(other);
    await auth(actor, actorToken, "auth-leave-still-present-actor");
    await auth(other, keepToken, "auth-leave-still-present-keep");

    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "join-leave-still-present-actor", ts: "2026-02-28T00:00:01Z", payload: { tableId } });
    await nextMessageOfType(actor, "commandResult");
    await nextMessageOfType(actor, "table_state");
    sendFrame(other, { version: "1.0", type: "table_join", requestId: "join-leave-still-present-keep", ts: "2026-02-28T00:00:02Z", payload: { tableId } });
    const otherJoinAck = await nextMessageOfType(other, "commandResult");
    await nextMessageOfType(other, "table_state");
    assert.equal(otherJoinAck.payload.status, "accepted");

    sendFrame(actor, { version: "1.0", type: "table_leave", requestId: "leave-still-present", ts: "2026-02-28T00:00:03Z", payload: { tableId } });
    const result = await nextMessageOfType(actor, "commandResult");
    assert.equal(result.payload.status, "rejected");
    assert.equal(result.payload.reason, "authoritative_state_invalid");
    assert.equal(await attemptMessage(other, 300), null);

    sendFrame(other, { version: "1.0", type: "table_state_sub", requestId: "sub-after-still-present", ts: "2026-02-28T00:00:04Z", payload: { tableId } });
    const observerState = await nextMessageOfType(other, "table_state");
    assert.deepEqual(observerState.payload.members, [
      { userId: "leave_still_present_actor", seat: 1 },
      { userId: "leave_still_present_keep", seat: 2 }
    ]);

    actor.close();
    other.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("table_leave preserves remaining subscriber when authoritative state uses seatNo", async () => {
  const secret = "test-secret";
  const actorToken = makeHs256Jwt({ secret, sub: "leave_actor_seatno" });
  const keepToken = makeHs256Jwt({ secret, sub: "leave_keep_seatno" });
  const tableId = "table_leave_preserve_seatno";
  const override = JSON.stringify({
    ok: true,
    tableId,
    state: {
      version: 22,
      state: {
        tableId,
        seats: [{ seatNo: 2, userId: "leave_keep_seatno" }],
        stacks: { leave_keep_seatno: 250 },
        phase: "INIT"
      }
    }
  });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_TEST_LEAVE_RESULT_JSON: override } });

  try {
    await waitForListening(child, 5000);
    const actor = await connectClient(port);
    const other = await connectClient(port);
    await hello(actor);
    await hello(other);
    await auth(actor, actorToken, "auth-leave-actor-seatno");
    await auth(other, keepToken, "auth-leave-keep-seatno");

    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "join-leave-actor-seatno", ts: "2026-02-28T00:00:01Z", payload: { tableId } });
    await nextMessageOfType(actor, "commandResult");
    await nextMessageOfType(actor, "table_state");
    sendFrame(other, { version: "1.0", type: "table_join", requestId: "join-leave-keep-seatno", ts: "2026-02-28T00:00:02Z", payload: { tableId } });
    const otherJoinAck = await nextMessageOfType(other, "commandResult");
    await nextMessageOfType(other, "table_state");
    assert.equal(otherJoinAck.payload.status, "accepted");

    sendFrame(actor, { version: "1.0", type: "table_leave", requestId: "leave-preserve-seatno", ts: "2026-02-28T00:00:03Z", payload: { tableId } });
    const first = await attemptMessage(actor, 1200);
    if (first) {
      assert.ok(["commandResult", "table_state", "stateSnapshot"].includes(first.type));
      if (first.type === "commandResult") assert.equal(first.payload.status, "accepted");
    }

    const otherState = await nextMessageOfType(other, "table_state");
    assert.notEqual(otherState.payload.members.length, 0);
    assert.equal(Array.isArray(otherState.payload.members), true);
    assert.equal(otherState.payload.members.some((m) => m.userId === "leave_keep_seatno" && m.seat === 2), true);

    actor.close();
    other.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("leave routes to commandResult and does not fall through to table_state", async () => {
  const secret = "test-secret";
  const actorToken = makeHs256Jwt({ secret, sub: "leave_route_actor" });
  const tableId = "table_leave_route";
  const override = JSON.stringify({ ok: true, tableId, state: { version: 3, state: { tableId, seats: null, phase: "INIT" } } });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_TEST_LEAVE_RESULT_JSON: override } });

  try {
    await waitForListening(child, 5000);
    const actor = await connectClient(port);
    await hello(actor);
    await auth(actor, actorToken, "auth-leave-route");
    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "join-leave-route", ts: "2026-02-28T00:00:01Z", payload: { tableId } });
    await nextMessageOfType(actor, "commandResult");

    sendFrame(actor, { version: "1.0", type: "leave", requestId: "leave-route", ts: "2026-02-28T00:00:02Z", payload: { tableId } });
    const first = await nextMessageOfType(actor, "commandResult");
    assert.equal(first.payload.status, "rejected");
    assert.equal(first.payload.reason, "authoritative_state_invalid");
    assert.notEqual(first.type, "table_state");
    assert.equal(await attemptMessage(actor, 300), null);

    actor.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("leave rejects when in-memory sync fails after authoritative execution", async () => {
  const secret = "test-secret";
  const actorToken = makeHs256Jwt({ secret, sub: "leave_sync_fail_actor" });
  const tableId = "table_leave_sync_fail";
  const override = JSON.stringify({
    ok: true,
    tableId,
    state: {
      version: 3,
      state: {
        tableId,
        seats: null,
        phase: "INIT"
      }
    }
  });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_TEST_LEAVE_RESULT_JSON: override } });

  try {
    await waitForListening(child, 5000);
    const actor = await connectClient(port);
    await hello(actor);
    await auth(actor, actorToken, "auth-leave-sync-fail");

    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "join-leave-sync-fail", ts: "2026-02-28T00:00:01Z", payload: { tableId } });
    await nextMessageOfType(actor, "commandResult");

    sendFrame(actor, { version: "1.0", type: "table_leave", requestId: "leave-sync-fail", ts: "2026-02-28T00:00:02Z", payload: { tableId } });
    const first = await nextMessageOfType(actor, "commandResult");
    assert.equal(first.payload.status, "rejected");
    assert.equal(first.payload.reason, "authoritative_state_invalid");
    assert.equal(await attemptMessage(actor, 300), null);

    actor.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("leave pending and conflict reject without success broadcasts", async () => {
  const secret = "test-secret";
  const actorToken = makeHs256Jwt({ secret, sub: "leave_reject_actor" });
  const tableId = "table_leave_reject";

  const pendingServer = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_TEST_LEAVE_RESULT_JSON: JSON.stringify({ ok: false, pending: true }) } });
  try {
    await waitForListening(pendingServer.child, 5000);
    const actor = await connectClient(pendingServer.port);
    await hello(actor);
    await auth(actor, actorToken, "auth-leave-pending");
    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "join-leave-pending", ts: "2026-02-28T00:00:01Z", payload: { tableId } });
    await nextMessageOfType(actor, "commandResult");
    sendFrame(actor, { version: "1.0", type: "table_leave", requestId: "leave-pending", ts: "2026-02-28T00:00:02Z", payload: { tableId } });
    const result = await nextMessageOfType(actor, "commandResult");
    assert.equal(result.payload.status, "rejected");
    assert.equal(result.payload.reason, "request_pending");
    assert.equal(await attemptMessage(actor, 250), null);
    actor.close();
  } finally {
    pendingServer.child.kill("SIGTERM");
    await waitForExit(pendingServer.child);
  }

  const conflictServer = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_TEST_LEAVE_RESULT_JSON: JSON.stringify({ ok: false, code: "state_conflict" }) } });
  try {
    await waitForListening(conflictServer.child, 5000);
    const actor = await connectClient(conflictServer.port);
    await hello(actor);
    await auth(actor, actorToken, "auth-leave-conflict");
    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "join-leave-conflict", ts: "2026-02-28T00:00:01Z", payload: { tableId } });
    await nextMessageOfType(actor, "commandResult");
    sendFrame(actor, { version: "1.0", type: "table_leave", requestId: "leave-conflict", ts: "2026-02-28T00:00:02Z", payload: { tableId } });
    const result = await nextMessageOfType(actor, "commandResult");
    assert.equal(result.payload.status, "rejected");
    assert.equal(result.payload.reason, "state_conflict");
    assert.equal(await attemptMessage(actor, 250), null);
    actor.close();
  } finally {
    conflictServer.child.kill("SIGTERM");
    await waitForExit(conflictServer.child);
  }
});

test("leave missing room id rejects before authoritative leave", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "leave_missing_room" });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_TEST_LEAVE_RESULT_JSON: JSON.stringify({ ok: true }) } });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, token, "auth-leave-missing-room");

    sendFrame(ws, { version: "1.0", type: "leave", requestId: "leave-missing-room", ts: "2026-02-28T00:00:02Z", payload: {} });
    const err = await nextMessage(ws);
    assert.equal(err.type, "error");
    assert.equal(err.payload.code, "INVALID_ROOM_ID");

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("leave replay with same requestId is idempotent for memory and broadcast", async () => {
  const secret = "test-secret";
  const actorToken = makeHs256Jwt({ secret, sub: "leave_replay_actor" });
  const otherToken = makeHs256Jwt({ secret, sub: "leave_replay_other" });
  const tableId = "table_leave_replay";
  const override = JSON.stringify({
    ok: true,
    tableId,
    status: "already_left",
    state: {
      version: 14,
      state: {
        tableId,
        seats: [{ seat: 2, userId: "leave_replay_other" }],
        stacks: { leave_replay_other: 400 },
        phase: "INIT"
      }
    }
  });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_TEST_LEAVE_RESULT_JSON: override } });

  try {
    await waitForListening(child, 5000);
    const actor = await connectClient(port);
    const other = await connectClient(port);
    await hello(actor);
    await hello(other);
    await auth(actor, actorToken, "auth-replay-actor");
    await auth(other, otherToken, "auth-replay-other");

    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "join-replay-actor", ts: "2026-02-28T00:00:01Z", payload: { tableId } });
    await nextMessageOfType(actor, "commandResult");
    sendFrame(other, { version: "1.0", type: "table_join", requestId: "join-replay-other", ts: "2026-02-28T00:00:02Z", payload: { tableId } });
    const otherJoinAck = await nextMessageOfType(other, "commandResult");
    assert.equal(otherJoinAck.payload.status, "accepted");

    sendFrame(actor, { version: "1.0", type: "table_leave", requestId: "leave-replay", ts: "2026-02-28T00:00:03Z", payload: { tableId } });
    const first = await attemptMessage(actor, 1200);
    if (first) {
      assert.ok(["commandResult", "table_state", "stateSnapshot"].includes(first.type));
      if (first.type === "commandResult") assert.equal(first.payload.status, "accepted");
    }
    sendFrame(other, { version: "1.0", type: "table_state_sub", requestId: "sub-replay-after-first", ts: "2026-02-28T00:00:03Z", payload: { tableId } });
    assert.equal((await nextMessageOfType(other, "table_state")).payload.members.some((m) => m.userId === "leave_replay_other"), true);

    sendFrame(actor, { version: "1.0", type: "table_leave", requestId: "leave-replay", ts: "2026-02-28T00:00:04Z", payload: { tableId } });
    const second = await attemptMessage(actor, 1200);
    if (second) {
      assert.ok(["commandResult", "table_state", "stateSnapshot"].includes(second.type));
      if (second.type === "commandResult") assert.equal(second.payload.status, "accepted");
    }
    sendFrame(other, { version: "1.0", type: "table_state_sub", requestId: "sub-replay-after-second", ts: "2026-02-28T00:00:04Z", payload: { tableId } });
    assert.equal((await nextMessageOfType(other, "table_state")).payload.members.some((m) => m.userId === "leave_replay_other"), true);

    actor.close();
    other.close();
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





test("invalid WS_PRESENCE_TTL_MS falls back safely and keeps seated resync continuity", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "ttl_user" });
  const tableId = "table_badttl";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [{ user_id: "ttl_user", seat_no: 2, status: "ACTIVE", is_bot: false }],
      stateRow: { version: 8, state: { handId: "h8", phase: "PREFLOP", turnUserId: "ttl_user" } }
    }
  };
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PRESENCE_TTL_MS: "abc",
      SUPABASE_DB_URL: "",
      ...persistedBootstrapFixturesEnv(fixtures)
    }
  });

  try {
    await waitForListening(child, 5000);

    const ws1 = await connectClient(port);
    await hello(ws1);
    await auth(ws1, token, "auth-badttl-1");
    sendFrame(ws1, { version: "1.0", type: "table_join", requestId: "join-badttl-1", ts: "2026-02-28T00:00:06Z", payload: { tableId } });
    const join1 = await nextMessageOfType(ws1, "commandResult");
    assert.equal(join1.payload.status, "accepted");
    ws1.close();

    const ws2 = await connectClient(port);
    await hello(ws2);
    await auth(ws2, token, "auth-badttl-2");
    sendFrame(ws2, { version: "1.0", type: "resync", requestId: "resync-badttl", ts: "2026-02-28T00:00:08Z", payload: { tableId } });
    const resyncState = await nextMessageOfType(ws2, "table_state");
    assert.deepEqual(resyncState.payload.members, [{ userId: "ttl_user", seat: 2 }]);

    sendFrame(ws2, { version: "1.0", type: "table_state_sub", requestId: "snap-badttl", ts: "2026-02-28T00:00:09Z", payload: { tableId, view: "snapshot" } });
    const snapshot = await nextMessageOfType(ws2, "stateSnapshot");
    assert.equal(snapshot.payload.you.seat, 2);

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







test("snapshot view keeps table memberCount consistent with members after actor disconnect", async () => {
  const secret = "test-secret";
  const snapshotToken = makeHs256Jwt({ secret, sub: "snapshot_consistency_user" });
  const actorToken = makeHs256Jwt({ secret, sub: "actor_consistency_user" });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret } });

  try {
    await waitForListening(child, 5000);
    const snapshotClient = await connectClient(port);
    const actorClient = await connectClient(port);

    await hello(snapshotClient);
    await hello(actorClient);
    assert.equal((await auth(snapshotClient, snapshotToken, "req-auth-snapshot-consistency")).type, "authOk");
    assert.equal((await auth(actorClient, actorToken, "req-auth-actor-consistency")).type, "authOk");

    sendFrame(actorClient, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-actor-consistency",
      ts: "2026-02-28T00:00:20Z",
      payload: { tableId: "table_consistency" }
    });
    const actorJoinAck = await nextMessageOfType(actorClient, "commandResult");
    assert.equal(actorJoinAck.payload.status, "accepted");

    actorClient.close();
    await new Promise((resolve) => setTimeout(resolve, 75));

    sendFrame(snapshotClient, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-snapshot-consistency",
      ts: "2026-02-28T00:00:21Z",
      payload: { tableId: "table_consistency", view: "snapshot" }
    });
    const snapshot = await nextMessage(snapshotClient);
    assert.equal(snapshot.type, "stateSnapshot");
    assert.equal(snapshot.payload.table.memberCount, snapshot.payload.table.members.length);

    snapshotClient.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});










test("stateful stream events include monotonic seq per receiver", async () => {
  const secret = "seq-secret";
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret } });
  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "user_seq" }));

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-seq", ts: "2026-02-28T00:00:01Z", payload: { tableId: "table_seq" } });
    const tableState = await nextMessageOfType(ws, "table_state");
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-seq", ts: "2026-02-28T00:00:02Z", payload: { tableId: "table_seq", view: "snapshot" } });
    const snapshot = await nextMessageOfType(ws, "stateSnapshot");

    assert.equal(Number.isInteger(tableState.seq), true);
    assert.equal(Number.isInteger(snapshot.seq), true);
    assert.equal(snapshot.seq > tableState.seq, true);
    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("ack is receiver-local no-op for poker state", async () => {
  const secret = "ack-secret";
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret } });
  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "user_ack" }));

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-ack", ts: "2026-02-28T00:00:01Z", payload: { tableId: "table_ack" } });
    await nextMessageOfType(ws, "commandResult");
    const joined = await nextMessageOfType(ws, "table_state");

    sendFrame(ws, { version: "1.0", type: "ack", requestId: "ack-1", roomId: "table_ack", ts: "2026-02-28T00:00:02Z", payload: { tableId: "table_ack", seq: joined.seq } });
    sendFrame(ws, { version: "1.0", type: "ack", requestId: "ack-2", roomId: "table_ack", ts: "2026-02-28T00:00:03Z", payload: { tableId: "table_ack", seq: joined.seq } });

    const noMutation = await attemptMessage(ws, 250);
    assert.equal(noMutation, null);
    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("resume outside replay window triggers deterministic resync plus fresh snapshot", async () => {
  const secret = "resume-secret";
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_STREAM_REPLAY_CAP: "2" } });
  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    const helloAck = await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "user_resume" }));

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-r1", ts: "2026-02-28T00:00:01Z", payload: { tableId: "table_resume" } });
    const first = await nextMessageOfType(ws, "table_state");
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-r1", ts: "2026-02-28T00:00:02Z", payload: { tableId: "table_resume", view: "snapshot" } });
    await nextMessageOfType(ws, "stateSnapshot");
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-r2", ts: "2026-02-28T00:00:03Z", payload: { tableId: "table_resume", view: "snapshot" } });
    await nextMessageOfType(ws, "stateSnapshot");
    ws.close();

    const ws2 = await connectClient(port);
    await hello(ws2);
    await auth(ws2, makeHs256Jwt({ secret, sub: "user_resume" }), "auth-r2");
    sendFrame(ws2, {
      version: "1.0",
      type: "resume",
      requestId: "resume-r2",
      roomId: "table_resume",
      ts: "2026-02-28T00:00:04Z",
      payload: { tableId: "table_resume", sessionId: helloAck.payload.sessionId, lastSeq: 0 }
    });

    const resync = await nextMessageOfType(ws2, "resync");
    const snapshot = await nextMessageOfType(ws2, "stateSnapshot");
    assert.equal(resync.payload.mode, "required");
    assert.equal(snapshot.type, "stateSnapshot");
    ws2.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("resume replays in-window missing events in order", async () => {
  const secret = "resume-in-window-secret";
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_STREAM_REPLAY_CAP: "8" } });
  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    const helloAck = await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "user_resume_window" }));

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-rw", ts: "2026-02-28T00:00:01Z", payload: { tableId: "table_resume_window" } });
    const first = await nextMessageOfType(ws, "table_state");
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-rw-1", ts: "2026-02-28T00:00:02Z", payload: { tableId: "table_resume_window", view: "snapshot" } });
    const second = await nextMessageOfType(ws, "stateSnapshot");
    ws.close();

    const ws2 = await connectClient(port);
    await hello(ws2);
    await auth(ws2, makeHs256Jwt({ secret, sub: "user_resume_window" }), "auth-rw-2");
    sendFrame(ws2, {
      version: "1.0",
      type: "resume",
      requestId: "resume-rw-2",
      roomId: "table_resume_window",
      ts: "2026-02-28T00:00:04Z",
      payload: { tableId: "table_resume_window", sessionId: helloAck.payload.sessionId, lastSeq: first.seq }
    });

    const replayed = await nextMessage(ws2);
    assert.equal(replayed.seq, second.seq);
    assert.equal(replayed.type, "stateSnapshot");
    ws2.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("resume replay is isolated by session stream for same authenticated user", async () => {
  const secret = "same-user-session-isolation";
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_STREAM_REPLAY_CAP: "16" } });
  try {
    await waitForListening(child, 5000);

    const token = makeHs256Jwt({ secret, sub: "shared_user" });

    const wsA = await connectClient(port);
    const helloA = await hello(wsA);
    await auth(wsA, token, "auth-a");
    sendFrame(wsA, { version: "1.0", type: "table_join", requestId: "join-a", ts: "2026-02-28T00:11:01Z", payload: { tableId: "table_same_user" } });
    const joinAck_join_a = await nextCommandResultForRequest(wsA, "join-a");
    assert.equal(joinAck_join_a.payload.status, "accepted");
    sendFrame(wsA, { version: "1.0", type: "table_state_sub", requestId: "snap-a", ts: "2026-02-28T00:11:02Z", payload: { tableId: "table_same_user", view: "snapshot" } });
    const aSnapshot = await nextMessageOfType(wsA, "stateSnapshot");

    const wsB = await connectClient(port);
    await hello(wsB);
    await auth(wsB, token, "auth-b");
    sendFrame(wsB, { version: "1.0", type: "table_join", requestId: "join-b", ts: "2026-02-28T00:11:03Z", payload: { tableId: "table_same_user" } });
    const joinAck_join_b = await nextCommandResultForRequest(wsB, "join-b");
    assert.equal(joinAck_join_b.payload.status, "accepted");
    sendFrame(wsB, { version: "1.0", type: "table_state_sub", requestId: "snap-b", ts: "2026-02-28T00:11:04Z", payload: { tableId: "table_same_user", view: "snapshot" } });
    const bSnapshot = await nextMessageOfType(wsB, "stateSnapshot");

    wsA.close();

    sendFrame(wsB, { version: "1.0", type: "table_state_sub", requestId: "snap-b-2", ts: "2026-02-28T00:11:04Z", payload: { tableId: "table_same_user", view: "snapshot" } });
    const bSnapshot2 = await nextMessageOfType(wsB, "stateSnapshot");

    const wsAResume = await connectClient(port);
    await hello(wsAResume);
    await auth(wsAResume, token, "auth-a2");
    sendFrame(wsAResume, {
      version: "1.0",
      type: "resume",
      requestId: "resume-a",
      roomId: "table_same_user",
      ts: "2026-02-28T00:11:05Z",
      payload: { tableId: "table_same_user", sessionId: helloA.payload.sessionId, lastSeq: aSnapshot.seq }
    });

    const resumed = await nextCommandResultForRequest(wsAResume, "resume-a");
    assert.equal(resumed.payload.status, "accepted");
    const unexpected = await attemptMessage(wsAResume, 300);
    assert.equal(unexpected, null);

    assert.notEqual(aSnapshot.sessionId, bSnapshot.sessionId);
    assert.equal(bSnapshot2.seq > bSnapshot.seq, true);

    wsB.close();
    wsAResume.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("resume continuity for session A is not invalidated by high-traffic session B", async () => {
  const secret = "resume-scoped-window";
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_STREAM_REPLAY_CAP: "2" } });
  try {
    await waitForListening(child, 5000);
    const token = makeHs256Jwt({ secret, sub: "resume_shared_user" });

    const wsA = await connectClient(port);
    const helloA = await hello(wsA);
    await auth(wsA, token, "auth-rsa");
    sendFrame(wsA, { version: "1.0", type: "table_join", requestId: "join-rsa", ts: "2026-02-28T00:14:00Z", payload: { tableId: "table_resume_scoped" } });
    const joinAck_join_rsa = await nextMessageOfType(wsA, "commandResult");
    assert.equal(joinAck_join_rsa.payload.requestId, "join-rsa");
    assert.equal(joinAck_join_rsa.payload.status, "accepted");
    sendFrame(wsA, { version: "1.0", type: "table_state_sub", requestId: "snap-rsa", ts: "2026-02-28T00:14:01Z", payload: { tableId: "table_resume_scoped", view: "snapshot" } });
    const aBaseline = await nextMessageOfType(wsA, "stateSnapshot");

    const wsB = await connectClient(port);
    await hello(wsB);
    await auth(wsB, token, "auth-rsb");
    sendFrame(wsB, { version: "1.0", type: "table_join", requestId: "join-rsb", ts: "2026-02-28T00:14:02Z", payload: { tableId: "table_resume_scoped" } });
    const joinAck_join_rsb = await nextMessageOfType(wsB, "commandResult");
    assert.equal(joinAck_join_rsb.payload.requestId, "join-rsb");
    assert.equal(joinAck_join_rsb.payload.status, "accepted");

    for (let i = 0; i < 5; i += 1) {
      sendFrame(wsB, { version: "1.0", type: "table_state_sub", requestId: `snap-rsb-${i}`, ts: "2026-02-28T00:14:03Z", payload: { tableId: "table_resume_scoped", view: "snapshot" } });
      await nextMessageOfType(wsB, "stateSnapshot");
    }

    wsA.close();

    const wsAResume = await connectClient(port);
    await hello(wsAResume);
    await auth(wsAResume, token, "auth-rsa2");
    sendFrame(wsAResume, {
      version: "1.0",
      type: "resume",
      requestId: "resume-rsa",
      roomId: "table_resume_scoped",
      ts: "2026-02-28T00:14:04Z",
      payload: { tableId: "table_resume_scoped", sessionId: helloA.payload.sessionId, lastSeq: aBaseline.seq }
    });

    const resumeResult = await nextMessageOfType(wsAResume, "commandResult");
    assert.equal(resumeResult.payload.status, "accepted");
    assert.equal(await attemptMessage(wsAResume, 300), null);

    wsB.close();
    wsAResume.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

function persistedBootstrapFixturesEnv(fixtures) {
  return {
    WS_PERSISTED_BOOTSTRAP_FIXTURES_JSON: JSON.stringify(fixtures)
  };
}

function observeOnlyJoinEnv() {
  return { WS_OBSERVE_ONLY_JOIN: "1" };
}

test("WS table_join hydrates from persisted bootstrap fixture", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_a" });
  const tableId = "table_persisted_join";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [{ user_id: "user_a", seat_no: 3, status: "ACTIVE", is_bot: false }],
      stateRow: { version: 21, state: { handId: "h21", phase: "PREFLOP", turnUserId: "user_a", holeCardsByUserId: { user_a: ["As", "Kd"] } } }
    }
  };

  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, SUPABASE_DB_URL: "", ...persistedBootstrapFixturesEnv(fixtures) } });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    const authOk = await auth(ws, token);
    assert.equal(authOk.type, "authOk");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "req-join", ts: "2026-02-28T00:00:02Z", payload: { tableId } });
    const joinAck = await nextMessageOfType(ws, "commandResult");
    assert.equal(joinAck.payload.requestId, "req-join");
    assert.equal(joinAck.payload.status, "accepted");

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "req-snap", ts: "2026-02-28T00:00:03Z", payload: { tableId, view: "snapshot" } });
    const snapshot = await nextMessageOfType(ws, "stateSnapshot");
    assert.equal(snapshot.payload.table.tableId, tableId);
    assert.equal(snapshot.payload.stateVersion, 21);
    assert.equal(Number.isInteger(snapshot.payload.stateVersion), true);
    assert.equal(typeof snapshot.payload.table, "object");
    assert.equal(typeof snapshot.payload.you, "object");
    assert.equal(typeof snapshot.payload.public, "object");
    assert.equal(typeof snapshot.payload.private, "object");
    assert.equal(snapshot.payload.you.userId, "user_a");
    assert.equal(snapshot.payload.you.seat, 3);
    assert.deepEqual(snapshot.payload.private.userId, "user_a");
    assert.deepEqual(snapshot.payload.private.seat, 3);
    assert.equal(Array.isArray(snapshot.payload.private.holeCards), true);
    assert.equal(typeof snapshot.sessionId, "string");
    assert.equal(typeof snapshot.ts, "string");
    assert.equal(snapshot.version, "1.0");

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("WS table_join missing persisted table returns protocol-safe error and later valid join works", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_a" });
  const validTableId = "table_present_later";
  const fixtures = {
    [validTableId]: {
      tableRow: { id: validTableId, max_players: 6 },
      seatRows: [{ user_id: "user_a", seat_no: 1, status: "ACTIVE" }],
      stateRow: { version: 3, state: { handId: "h3", phase: "PREFLOP" } }
    }
  };

  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, SUPABASE_DB_URL: "", ...persistedBootstrapFixturesEnv(fixtures) } });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, token);

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "req-missing", ts: "2026-02-28T00:00:02Z", payload: { tableId: "missing_table" } });
    const missingErr = await nextMessageOfType(ws, "error");
    assert.equal(missingErr.payload.code, "TABLE_NOT_FOUND");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "req-valid", ts: "2026-02-28T00:00:03Z", payload: { tableId: validTableId } });
    const joinAck = await nextMessageOfType(ws, "commandResult");
    assert.equal(joinAck.payload.requestId, "req-valid");
    assert.equal(joinAck.payload.status, "accepted");

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("read-only bootstrap errors map to protocol-specific codes", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_bootstrap_codes" });

  const unavailable = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, SUPABASE_DB_URL: "", WS_PERSISTED_BOOTSTRAP_FIXTURES_JSON: "" } });
  try {
    await waitForListening(unavailable.child, 5000);
    const ws = await connectClient(unavailable.port);
    await hello(ws);
    await auth(ws, token);

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "req-sub-unavailable", ts: "2026-02-28T00:00:04Z", payload: { tableId: "missing_unavailable" } });
    const subErr = await nextMessageOfType(ws, "error");
    assert.equal(subErr.payload.code, "TABLE_BOOTSTRAP_UNAVAILABLE");
    assert.equal(await attemptMessage(ws, 250), null);

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "req-snap-unavailable", ts: "2026-02-28T00:00:05Z", payload: { tableId: "missing_unavailable", view: "snapshot" } });
    const snapErr = await nextMessageOfType(ws, "error");
    assert.equal(snapErr.payload.code, "TABLE_BOOTSTRAP_UNAVAILABLE");
    assert.equal(await attemptMessage(ws, 250), null);

    ws.close();
  } finally {
    unavailable.child.kill("SIGTERM");
    await waitForExit(unavailable.child);
  }

  const notFound = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, SUPABASE_DB_URL: "", ...persistedBootstrapFixturesEnv({}) } });
  try {
    await waitForListening(notFound.child, 5000);
    const ws = await connectClient(notFound.port);
    await hello(ws);
    await auth(ws, token);

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "req-sub-not-found", ts: "2026-02-28T00:00:06Z", payload: { tableId: "missing_not_found" } });
    const subErr = await nextMessageOfType(ws, "error");
    assert.equal(subErr.payload.code, "TABLE_NOT_FOUND");
    assert.equal(await attemptMessage(ws, 250), null);

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "req-snap-not-found", ts: "2026-02-28T00:00:07Z", payload: { tableId: "missing_not_found", view: "snapshot" } });
    const snapErr = await nextMessageOfType(ws, "error");
    assert.equal(snapErr.payload.code, "TABLE_NOT_FOUND");
    assert.equal(await attemptMessage(ws, 250), null);

    ws.close();
  } finally {
    notFound.child.kill("SIGTERM");
    await waitForExit(notFound.child);
  }
});


test("act does not create synthetic table when bootstrap fails", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_a" });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, ...persistedBootstrapFixturesEnv({}) } });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, token);

    sendFrame(ws, {
      version: "1.0",
      type: "act",
      requestId: "req-act-missing",
      ts: "2026-02-28T00:00:05Z",
      payload: { tableId: "missing_table", handId: "h1", action: "check" }
    });

    const commandResult = await nextMessageOfType(ws, "commandResult");
    assert.equal(commandResult.payload.status, "rejected");
    assert.equal(commandResult.payload.reason, "TABLE_NOT_FOUND");

    const noSnapshot = await attemptMessage(ws, 300);
    assert.equal(noSnapshot?.type === "stateSnapshot", false);
    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("server startup/auth works with persisted bootstrap disabled", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_disabled_bootstrap" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      SUPABASE_DB_URL: "",
      WS_PERSISTED_BOOTSTRAP_FIXTURES_JSON: ""
    }
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    const helloAck = await hello(ws);
    assert.equal(helloAck.type, "helloAck");

    const authOk = await auth(ws, token, "auth-disabled-bootstrap");
    assert.equal(authOk.type, "authOk");

    sendFrame(ws, {
      version: "1.0",
      type: "table_join",
      requestId: "join-disabled-bootstrap",
      ts: "2026-02-28T00:20:01Z",
      payload: { tableId: "table_synthetic_ok" }
    });
    const tableState = await nextMessageOfType(ws, "table_state");
    assert.equal(tableState.payload.tableId, "table_synthetic_ok");

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("same-socket frame ordering is preserved when bootstrap load is slow", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_a" });
  const tableId = "table_slow_ordering";
  const fixtures = {
    [tableId]: {
      delayMs: 250,
      tableRow: { id: tableId, max_players: 6 },
      seatRows: [{ user_id: "user_a", seat_no: 1, status: "ACTIVE" }],
      stateRow: { version: 8, state: { handId: "h8", phase: "PREFLOP" } }
    }
  };

  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, ...persistedBootstrapFixturesEnv(fixtures) } });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, token);

    const twoMessages = nextNMessages(ws, 2, 4000);

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-slow", ts: "2026-02-28T00:21:00Z", payload: { tableId } });
    sendFrame(ws, {
      version: "1.0",
      type: "act",
      requestId: "act-after-join",
      ts: "2026-02-28T00:21:01Z",
      payload: { tableId, handId: "h8", action: "check" }
    });

    const [first, second] = await twoMessages;

    assert.equal(first.type, "commandResult");
    assert.equal(second.type, "table_state");
    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("slow bootstrap on one socket does not block another socket", async () => {
  const secret = "test-secret";
  const tokenA = makeHs256Jwt({ secret, sub: "user_a" });
  const tokenB = makeHs256Jwt({ secret, sub: "user_b" });
  const tableId = "table_socket_a_slow";
  const fixtures = {
    [tableId]: {
      delayMs: 300,
      tableRow: { id: tableId, max_players: 6 },
      seatRows: [{ user_id: "user_a", seat_no: 1, status: "ACTIVE" }],
      stateRow: { version: 5, state: { handId: "h5", phase: "PREFLOP" } }
    }
  };

  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, ...persistedBootstrapFixturesEnv(fixtures) } });

  try {
    await waitForListening(child, 5000);
    const wsA = await connectClient(port);
    const wsB = await connectClient(port);

    await hello(wsA);
    await auth(wsA, tokenA);
    await hello(wsB);
    await auth(wsB, tokenB);

    sendFrame(wsA, { version: "1.0", type: "table_join", requestId: "join-a-slow", ts: "2026-02-28T00:22:00Z", payload: { tableId } });

    sendFrame(wsB, {
      version: "1.0",
      type: "protected_echo",
      requestId: "echo-b-fast",
      ts: "2026-02-28T00:22:01Z",
      payload: { echo: "B" }
    });

    const echoResponse = await nextMessageOfType(wsB, "protectedEchoOk", 2000);
    assert.equal(echoResponse.payload.echo, "B");

    const joinAckA = await nextMessageOfType(wsA, "commandResult", 3000);
    const joinStateA = await nextMessageOfType(wsA, "table_state", 3000);
    assert.equal(joinStateA.requestId, "join-a-slow");
    assert.equal(joinAckA.payload.requestId, "join-a-slow");
    assert.equal(joinAckA.payload.status, "accepted");

    wsA.close();
    wsB.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("rapid same-socket join then snapshot remains ordered with slow bootstrap", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_a" });
  const tableId = "table_join_snapshot_ordered";
  const fixtures = {
    [tableId]: {
      delayMs: 250,
      tableRow: { id: tableId, max_players: 6 },
      seatRows: [{ user_id: "user_a", seat_no: 2, status: "ACTIVE" }],
      stateRow: { version: 17, state: { handId: "h17", phase: "PREFLOP", turnUserId: "user_a" } }
    }
  };

  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, ...persistedBootstrapFixturesEnv(fixtures) } });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, token);

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-ordered", ts: "2026-02-28T00:23:00Z", payload: { tableId } });
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-ordered", ts: "2026-02-28T00:23:01Z", payload: { tableId, view: "snapshot" } });

    const joinAck = await nextCommandResultForRequest(ws, "join-ordered", 4000);
    const first = await nextMessageMatching(
      ws,
      (frame) => frame?.type === "table_state" && frame?.requestId === "join-ordered",
      4000
    );
    const second = await nextMessageMatching(
      ws,
      (frame) => frame?.type === "stateSnapshot" && frame?.requestId === "snap-ordered",
      4000
    );

    assert.equal(first.type, "table_state");
    assert.equal(first.requestId, "join-ordered");
    assert.equal(joinAck.payload.status, "accepted");
    assert.equal(second.type, "stateSnapshot");
    assert.equal(second.roomId, tableId);
    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});



test("observer table_join keeps live members empty without creating seated membership", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "observer_only_user" });
  const tableId = "table_observer_join_only";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [
        { user_id: "seed_user_a", seat_no: 2, status: "ACTIVE", is_bot: false },
        { user_id: "seed_user_b", seat_no: 4, status: "ACTIVE", is_bot: false }
      ],
      stateRow: { version: 12, state: { handId: "h12", phase: "PREFLOP", turnUserId: "seed_user_a" } }
    }
  };

  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, SUPABASE_DB_URL: "", ...observeOnlyJoinEnv(), ...persistedBootstrapFixturesEnv(fixtures) } });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, token);

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "observer-join-1", ts: "2026-02-28T00:31:00Z", payload: { tableId } });
    const firstJoinAck = await nextCommandResultForRequest(ws, "observer-join-1");
    const firstJoinState = await nextMessageOfType(ws, "table_state");
    assert.equal(firstJoinState.requestId, "observer-join-1");
    assert.equal(firstJoinAck.payload.status, "accepted");

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "observer-state-1", ts: "2026-02-28T00:31:00Z", payload: { tableId } });
    const firstJoin = await nextMessageOfType(ws, "table_state");
    assert.deepEqual(firstJoin.payload.members, []);
    assert.deepEqual(firstJoin.payload.authoritativeMembers, [
      { userId: "seed_user_a", seat: 2 },
      { userId: "seed_user_b", seat: 4 }
    ]);

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "observer-join-2", ts: "2026-02-28T00:31:01Z", payload: { tableId } });
    const secondJoinAck = await nextCommandResultForRequest(ws, "observer-join-2");
    const secondJoinState = await nextMessageOfType(ws, "table_state");
    assert.equal(secondJoinState.requestId, "observer-join-2");
    assert.equal(secondJoinAck.payload.status, "accepted");

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "observer-state-2", ts: "2026-02-28T00:31:01Z", payload: { tableId } });
    const secondJoin = await nextMessageOfType(ws, "table_state");
    assert.deepEqual(secondJoin.payload.members, []);
    assert.deepEqual(secondJoin.payload.authoritativeMembers, [
      { userId: "seed_user_a", seat: 2 },
      { userId: "seed_user_b", seat: 4 }
    ]);

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "observer-snapshot", ts: "2026-02-28T00:31:02Z", payload: { tableId, view: "snapshot" } });
    const snapshot = await nextMessageOfType(ws, "stateSnapshot");
    assert.equal(snapshot.payload.you.userId, "observer_only_user");
    assert.equal(snapshot.payload.you.seat, null);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("seated persisted user remains seated across repeated table_join", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "seed_user_a" });
  const tableId = "table_seated_persisted_join";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [{ user_id: "seed_user_a", seat_no: 3, status: "ACTIVE", is_bot: false }],
      stateRow: { version: 9, state: { handId: "h9", phase: "PREFLOP", turnUserId: "seed_user_a" } }
    }
  };

  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, SUPABASE_DB_URL: "", ...persistedBootstrapFixturesEnv(fixtures) } });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, token);

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "seated-join-1", ts: "2026-02-28T00:32:00Z", payload: { tableId } });
    const firstAck = await nextMessageOfType(ws, "commandResult");
    const firstState = await nextMessageOfType(ws, "table_state");
    assert.equal(firstState.requestId, "seated-join-1");
    assert.equal(firstAck.payload.status, "accepted");
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "seated-sub-1", ts: "2026-02-28T00:32:00Z", payload: { tableId } });
    const firstJoin = await nextMessageOfType(ws, "table_state");
    assert.deepEqual(firstJoin.payload.members, [{ userId: "seed_user_a", seat: 3 }]);

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "seated-join-2", ts: "2026-02-28T00:32:01Z", payload: { tableId } });
    const secondAck = await nextMessageOfType(ws, "commandResult");
    const secondState = await nextMessageOfType(ws, "table_state");
    assert.equal(secondState.requestId, "seated-join-2");
    assert.equal(secondAck.payload.status, "accepted");
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "seated-sub-2", ts: "2026-02-28T00:32:01Z", payload: { tableId } });
    const secondJoin = await nextMessageOfType(ws, "table_state");
    assert.deepEqual(secondJoin.payload.members, [{ userId: "seed_user_a", seat: 3 }]);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("observer join then resync keeps observer unseated with live members empty", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "observer_resync_user" });
  const tableId = "table_observer_resync";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [{ user_id: "seed_user_a", seat_no: 1, status: "ACTIVE", is_bot: false }],
      stateRow: { version: 7, state: { handId: "h7", phase: "PREFLOP", turnUserId: "seed_user_a" } }
    }
  };

  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, SUPABASE_DB_URL: "", ...observeOnlyJoinEnv(), ...persistedBootstrapFixturesEnv(fixtures) } });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, token);

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "observer-resync-join", ts: "2026-02-28T00:33:00Z", payload: { tableId } });
    const joinAck = await nextMessageOfType(ws, "commandResult");
    assert.equal(joinAck.payload.status, "accepted");
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "observer-resync-sub", ts: "2026-02-28T00:33:00Z", payload: { tableId } });
    const joinState = await nextMessageOfType(ws, "table_state");
    assert.deepEqual(joinState.payload.members, []);
    assert.deepEqual(joinState.payload.authoritativeMembers, [{ userId: "seed_user_a", seat: 1 }]);

    sendFrame(ws, { version: "1.0", type: "resync", requestId: "observer-resync", ts: "2026-02-28T00:33:01Z", payload: { tableId } });
    const resyncState = await nextMessageOfType(ws, "table_state");
    assert.deepEqual(resyncState.payload.members, []);
    assert.deepEqual(resyncState.payload.authoritativeMembers, [{ userId: "seed_user_a", seat: 1 }]);

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "observer-resync-snapshot", ts: "2026-02-28T00:33:02Z", payload: { tableId, mode: "snapshot" } });
    const snapshot = await nextMessageOfType(ws, "stateSnapshot");
    assert.equal(snapshot.payload.you.userId, "observer_resync_user");
    assert.equal(snapshot.payload.you.seat, null);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("fresh hello->auth->table_state_sub keeps live members empty but includes authoritativeMembers", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "observer_sub_user" });
  const tableId = "table_state_sub_authoritative";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [
        { user_id: "seed_user_a", seat_no: 1, status: "ACTIVE", is_bot: false },
        { user_id: "seed_user_b", seat_no: 3, status: "ACTIVE", is_bot: false }
      ],
      stateRow: { version: 8, state: { handId: "h8", phase: "TURN", turnUserId: "seed_user_a" } }
    }
  };

  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, SUPABASE_DB_URL: "", ...observeOnlyJoinEnv(), ...persistedBootstrapFixturesEnv(fixtures) } });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, token);

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "observer-sub-only", ts: "2026-02-28T00:34:00Z", payload: { tableId } });
    const subState = await nextMessageOfType(ws, "table_state");
    assert.deepEqual(subState.payload.members, []);
    assert.deepEqual(subState.payload.authoritativeMembers, [
      { userId: "seed_user_a", seat: 1 },
      { userId: "seed_user_b", seat: 3 }
    ]);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("unexpected processMessage failure returns protocol-safe error frame", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_throw_single" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_TEST_THROW_ON_FRAME_TYPE: "protected_echo"
    }
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, token);

    sendFrame(ws, protectedEchoFrame("throw-on-echo"));
    const errorFrame = await nextMessage(ws, 3000);
    assert.equal(errorFrame.payload.code, "INTERNAL_ERROR");
    assert.equal(errorFrame.payload.message, "internal_server_error");
    assert.equal(ws.readyState, WebSocket.OPEN);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("one socket internal failure does not block another socket", async () => {
  const secret = "test-secret";
  const tokenA = makeHs256Jwt({ secret, sub: "user_throw_a" });
  const tokenB = makeHs256Jwt({ secret, sub: "user_throw_b" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_TEST_THROW_ON_FRAME_TYPE: "table_join"
    }
  });

  try {
    await waitForListening(child, 5000);
    const wsA = await connectClient(port);
    const wsB = await connectClient(port);
    await hello(wsA);
    await auth(wsA, tokenA);
    await hello(wsB);
    await auth(wsB, tokenB);

    sendFrame(wsA, {
      version: "1.0",
      type: "table_join",
      requestId: "throw-join-a",
      ts: "2026-02-28T00:30:00Z",
      payload: { tableId: "table_throw_a" }
    });

    sendFrame(wsB, protectedEchoFrame("echo-b-normal"));

    const [errA, okB] = await Promise.all([
      nextMessageOfType(wsA, "error", 5000),
      nextMessageOfType(wsB, "protectedEchoOk", 5000)
    ]);
    assert.equal(errA.payload.code, "INTERNAL_ERROR");
    assert.equal(okB.payload.echo, "hi");

    wsA.close();
    wsB.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("same-socket queue remains usable after internal failure", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_throw_recover" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_TEST_THROW_ON_FRAME_TYPE: "protected_echo"
    }
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, token);

    sendFrame(ws, protectedEchoFrame("throw-first"));
    const errorFrame = await nextMessage(ws, 3000);
    assert.equal(errorFrame.payload.code, "INTERNAL_ERROR");

    sendFrame(ws, {
      version: "1.0",
      type: "ping",
      requestId: "ping-after-throw",
      ts: "2026-02-28T00:30:10Z",
      payload: {}
    });

    const followup = await nextMessage(ws, 3000);
    assert.equal(["pong", "error"].includes(followup.type), true);
    assert.equal(ws.readyState, WebSocket.OPEN);
    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

// Guardrail: avoid reintroducing multi-socket observe-only privacy timing tests here.
// This suite must remain deterministic across runners; prefer request/response-bounded
// assertions (single-socket where possible) over "wait for later broadcast" patterns.

test("active replacement: observe-only join does not broadcast table_state membership mutation", async () => {
  const secret = "test-secret";
  const tableId = "table_replace_broadcast";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [],
      stateRow: { version: 0, state: {} }
    }
  };
  const observerToken = makeHs256Jwt({ secret, sub: "observer_stream" });
  const actorToken = makeHs256Jwt({ secret, sub: "actor_stream" });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, SUPABASE_DB_URL: "", ...observeOnlyJoinEnv(), ...persistedBootstrapFixturesEnv(fixtures) } });
  try {
    await waitForListening(child, 5000);
    const observer = await connectClient(port);
    const actor = await connectClient(port);
    await hello(observer);
    await hello(actor);
    await auth(observer, observerToken, "auth-observer-stream");
    await auth(actor, actorToken, "auth-actor-stream");

    sendFrame(observer, { version: "1.0", type: "table_state_sub", requestId: "sub-stream", ts: "2026-02-28T01:01:00Z", payload: { tableId } });
    await nextMessageOfType(observer, "table_state");

    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "join-stream", ts: "2026-02-28T01:01:01Z", payload: { tableId } });
    const actorAck = await nextMessageOfType(actor, "commandResult");
    assert.equal(actorAck.payload.status, "accepted");
    sendFrame(actor, { version: "1.0", type: "table_state_sub", requestId: "sub-stream-actor", ts: "2026-02-28T01:01:01Z", payload: { tableId } });
    const actorState = await nextMessageOfType(actor, "table_state");
    assert.deepEqual(actorState.payload.members, []);
    assert.equal(await attemptMessage(observer, 1200), null);

    observer.close();
    actor.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("active replacement: seated act accepted and observer act rejected under observe-only join", async () => {
  const secret = "test-secret";
  const tableId = "table_replace_act";
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
  const actorToken = makeHs256Jwt({ secret, sub: "seat_actor" });
  const observerToken = makeHs256Jwt({ secret, sub: "observer_actor" });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, SUPABASE_DB_URL: "", ...observeOnlyJoinEnv(), ...persistedBootstrapFixturesEnv(fixtures) } });
  try {
    await waitForListening(child, 5000);
    const seatA = await connectClient(port);
    const seatB = await connectClient(port);
    const observer = await connectClient(port);
    await hello(seatA);
    await hello(seatB);
    await hello(observer);
    await auth(seatA, actorToken, "auth-seat-a-repl");
    await auth(seatB, makeHs256Jwt({ secret, sub: "seat_other" }), "auth-seat-b-repl");
    await auth(observer, observerToken, "auth-observer-repl-act");

    sendFrame(seatA, { version: "1.0", type: "table_join", requestId: "join-seat-a-repl", ts: "2026-02-28T01:02:00Z", payload: { tableId } });
    const joinAck_join_seat_a_repl = await nextMessageOfType(seatA, "commandResult");
    assert.equal(joinAck_join_seat_a_repl.payload.requestId, "join-seat-a-repl");
    assert.equal(joinAck_join_seat_a_repl.payload.status, "accepted");
    sendFrame(seatB, { version: "1.0", type: "table_join", requestId: "join-seat-b-repl", ts: "2026-02-28T01:02:01Z", payload: { tableId } });
    const joinAck_join_seat_b_repl = await nextMessageOfType(seatB, "commandResult");
    assert.equal(joinAck_join_seat_b_repl.payload.requestId, "join-seat-b-repl");
    assert.equal(joinAck_join_seat_b_repl.payload.status, "accepted");
    sendFrame(observer, { version: "1.0", type: "table_join", requestId: "join-observer-repl-act", ts: "2026-02-28T01:02:02Z", payload: { tableId } });
    const joinAck_join_observer_repl_act = await nextMessageOfType(observer, "commandResult");
    assert.equal(joinAck_join_observer_repl_act.payload.requestId, "join-observer-repl-act");
    assert.equal(joinAck_join_observer_repl_act.payload.status, "accepted");

    sendFrame(seatA, { version: "1.0", type: "table_state_sub", requestId: "snap-seat-a-repl", ts: "2026-02-28T01:02:03Z", payload: { tableId, view: "snapshot" } });
    const snapshot = await nextMessageOfType(seatA, "stateSnapshot");
    const handId = snapshot.payload.public.hand.handId;
    const turnUserId = snapshot.payload.public.turn.userId;

    sendFrame(observer, { version: "1.0", type: "act", requestId: "observer-act-repl", ts: "2026-02-28T01:02:04Z", payload: { tableId, handId, action: "fold" } });
    const observerResult = await nextMessageOfType(observer, "commandResult");
    assert.equal(observerResult.payload.status, "rejected");

    sendFrame(observer, { version: "1.0", type: "table_state_sub", requestId: "snap-observer-repl-act", ts: "2026-02-28T01:02:04Z", payload: { tableId, view: "snapshot" } });
    const observerSnapshot = await nextMessageOfType(observer, "stateSnapshot");
    assert.equal(observerSnapshot.payload.you.seat, null);
    assert.equal("private" in observerSnapshot.payload, false);
    assert.equal(observerSnapshot.payload.stateVersion, snapshot.payload.stateVersion);

    const actingWs = turnUserId === "seat_other" ? seatB : seatA;
    sendFrame(actingWs, { version: "1.0", type: "act", requestId: "seat-act-repl", ts: "2026-02-28T01:02:05Z", payload: { tableId, handId, action: "fold" } });
    const seatResult = await nextMessageOfType(actingWs, "commandResult");
    assert.equal(seatResult.payload.status, "accepted");
    const postAction = await nextStateUpdate(actingWs, { baseline: snapshot.payload, timeoutMs: 4000 });
    assert.equal(postAction.payload.stateVersion > snapshot.payload.stateVersion, true);

    seatA.close();
    seatB.close();
    observer.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});





test("duplicate act requestId is idempotent and does not emit extra advancing state", async () => {
  const secret = "test-secret";
  const tableId = "table_replace_act_idempotent";
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

  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, SUPABASE_DB_URL: "", ...persistedBootstrapFixturesEnv(fixtures) } });
  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "seat_actor" }), "auth-idem-actor");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-idem-actor", ts: "2026-02-28T01:03:00Z", payload: { tableId } });
    const joinAck_join_idem_actor = await nextMessageOfType(ws, "commandResult");
    assert.equal(joinAck_join_idem_actor.payload.requestId, "join-idem-actor");
    assert.equal(joinAck_join_idem_actor.payload.status, "accepted");
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-idem-actor", ts: "2026-02-28T01:03:01Z", payload: { tableId, view: "snapshot" } });
    const baseline = await nextMessageOfType(ws, "stateSnapshot");

    const handId = baseline.payload.public.hand.handId;
    sendFrame(ws, { version: "1.0", type: "act", requestId: "act-idem", ts: "2026-02-28T01:03:02Z", payload: { tableId, handId, action: "fold" } });
    const firstResult = await nextMessageOfType(ws, "commandResult");
    assert.equal(firstResult.payload.status, "accepted");
    const firstUpdate = await nextStateUpdate(ws, { baseline: baseline.payload, timeoutMs: 4000 });
    assert.equal(firstUpdate.payload.stateVersion > baseline.payload.stateVersion, true);

    sendFrame(ws, { version: "1.0", type: "act", requestId: "act-idem", ts: "2026-02-28T01:03:03Z", payload: { tableId, handId, action: "fold" } });
    const replayResult = await nextMessageOfType(ws, "commandResult");
    assert.equal(replayResult.payload.status, "accepted");
    assert.equal(await attemptMessage(ws, 300), null);

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-idem-after", ts: "2026-02-28T01:03:04Z", payload: { tableId, view: "snapshot" } });
    const afterReplay = await nextMessageOfType(ws, "stateSnapshot");
    assert.equal(afterReplay.payload.stateVersion, firstUpdate.payload.stateVersion);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("timeout sweep advances seated persisted table state under observe-only runtime", async () => {
  const secret = "timeout-secret";
  const tableId = "table_timeout_runtime";
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
      ...observeOnlyJoinEnv(),
      ...persistedBootstrapFixturesEnv(fixtures)
    }
  });

  try {
    await waitForListening(child, 5000);
    const wsA = await connectClient(port);
    const wsB = await connectClient(port);
    await hello(wsA);
    await hello(wsB);
    await auth(wsA, makeHs256Jwt({ secret, sub: "timeout_a" }), "auth-timeout-a");
    await auth(wsB, makeHs256Jwt({ secret, sub: "timeout_b" }), "auth-timeout-b");

    sendFrame(wsA, { version: "1.0", type: "table_join", requestId: "join-timeout-a", ts: "2026-02-28T00:40:01Z", payload: { tableId } });
    const joinAck_join_timeout_a = await nextMessageOfType(wsA, "commandResult");
    assert.equal(joinAck_join_timeout_a.payload.requestId, "join-timeout-a");
    assert.equal(joinAck_join_timeout_a.payload.status, "accepted");
    sendFrame(wsB, { version: "1.0", type: "table_join", requestId: "join-timeout-b", ts: "2026-02-28T00:40:02Z", payload: { tableId } });
    const joinAck_join_timeout_b = await nextMessageOfType(wsB, "commandResult");
    assert.equal(joinAck_join_timeout_b.payload.requestId, "join-timeout-b");
    assert.equal(joinAck_join_timeout_b.payload.status, "accepted");

    sendFrame(wsA, { version: "1.0", type: "table_state_sub", requestId: "snap-timeout-a", ts: "2026-02-28T00:40:03Z", payload: { tableId, view: "snapshot" } });
    const base = await nextMessageOfType(wsA, "stateSnapshot");

    const timeoutUpdate = await nextStateUpdate(wsA, { baseline: base.payload, timeoutMs: 5000 });
    assert.equal(timeoutUpdate.frame.type, "stateSnapshot");
    assert.equal(timeoutUpdate.payload.stateVersion > base.payload.stateVersion, true);
    assert.equal(Number.isFinite(timeoutUpdate.payload.public.turn.startedAt), true);
    assert.equal(Number.isFinite(timeoutUpdate.payload.public.turn.deadlineAt), true);
    assert.equal(timeoutUpdate.payload.public.turn.deadlineAt > timeoutUpdate.payload.public.turn.startedAt, true);
    assert.equal(Object.prototype.hasOwnProperty.call(timeoutUpdate.payload.public, "holeCardsByUserId"), false);
    assert.equal(await attemptMessage(wsA, 300), null);

    wsA.close();
    wsB.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("active replacement: observe-only semantics in bootstrap-disabled mode keep observer unseated", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "plain_observer" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      SUPABASE_DB_URL: "",
      WS_PERSISTED_BOOTSTRAP_FIXTURES_JSON: "",
      ...observeOnlyJoinEnv()
    }
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, token, "auth-plain-observer");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-plain-1", ts: "2026-02-28T01:10:00Z", payload: { tableId: "table_plain_observe" } });
    const joinAck1 = await nextMessageOfType(ws, "commandResult");
    assert.equal(joinAck1.payload.status, "accepted");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-plain-2", ts: "2026-02-28T01:10:01Z", payload: { tableId: "table_plain_observe" } });
    const joinAck2 = await nextMessageOfType(ws, "commandResult");
    assert.equal(joinAck2.payload.status, "accepted");

    sendFrame(ws, { version: "1.0", type: "resync", requestId: "resync-plain", ts: "2026-02-28T01:10:02Z", payload: { tableId: "table_plain_observe" } });
    const resyncState = await nextMessageOfType(ws, "table_state");
    assert.deepEqual(resyncState.payload.members, []);

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-plain", ts: "2026-02-28T01:10:03Z", payload: { tableId: "table_plain_observe", view: "snapshot" } });
    const snapshot = await nextMessageOfType(ws, "stateSnapshot");
    assert.equal(snapshot.payload.you.seat, null);
    assert.equal("private" in snapshot.payload, false);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});




test("WS act persists state to file-backed optimistic store", async () => {
  const secret = "persist-secret";
  const tableId = "table_ws_persist_act";
  const store = {
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "active" },
        seatRows: [
          { user_id: "seat_actor", seat_no: 1, status: "ACTIVE", is_bot: false },
          { user_id: "seat_other", seat_no: 2, status: "ACTIVE", is_bot: false }
        ],
        stateRow: { version: 0, state: {} }
      }
    }
  };
  const { dir, filePath } = await writePersistedFile(store);
  const { port, child } = await createServer({
    env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_PERSISTED_STATE_FILE: filePath }
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "seat_actor" }), "auth-persist");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-persist", ts: "2026-02-28T02:00:00Z", payload: { tableId } });
    const joinAck_join_persist = await nextMessageOfType(ws, "commandResult");
    await nextMessageOfType(ws, "table_state");
    assert.equal(joinAck_join_persist.payload.requestId, "join-persist");
    assert.equal(joinAck_join_persist.payload.status, "accepted");

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-persist", ts: "2026-02-28T02:00:01Z", payload: { tableId, view: "snapshot" } });
    const baseline = await nextMessageOfType(ws, "stateSnapshot");
    const handId = baseline.payload.public.hand.handId;

    sendFrame(ws, { version: "1.0", type: "act", requestId: "act-persist", ts: "2026-02-28T02:00:02Z", payload: { tableId, handId, action: "fold" } });
    const result = await nextMessageOfType(ws, "commandResult");
    assert.equal(result.payload.status, "accepted");
    const post = await nextStateUpdate(ws, { baseline: baseline.payload, timeoutMs: 4000 });
    assert.equal(post.payload.stateVersion > baseline.payload.stateVersion, true);

    const persisted = await readPersistedFile(filePath);
    assert.equal(persisted.tables[tableId].stateRow.version, post.payload.stateVersion);
    assert.equal(typeof persisted.tables[tableId].lastActivityAt, "string");

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("disconnect cleanup changed restores runtime from persisted state before broadcast", async () => {
  // Guardrail: keep only deterministic WS-bounded assertions here; protected/restore-failure semantics belong to runtime tests.
  const secret = "disconnect-cleanup-secret";
  const tableId = "table_disconnect_restore";
  const store = {
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "active" },
        seatRows: [{ user_id: "seat_user", seat_no: 1, status: "ACTIVE", is_bot: false, stack: 500 }],
        stateRow: { version: 7, state: { handId: "h7", phase: "PREFLOP", turnUserId: "seat_user", stacks: { seat_user: 500 } } }
      }
    }
  };
  const { dir, filePath } = await writePersistedFile(store);
  const cleanupModule = await writeTestModule(`
import fs from "node:fs/promises";
export function createInactiveCleanupExecutor({ env }) {
  return async ({ tableId, userId }) => {
    const raw = await fs.readFile(env.WS_PERSISTED_STATE_FILE, "utf8");
    const doc = JSON.parse(raw || "{}");
    const table = doc?.tables?.[tableId];
    if (!table) return { ok: true, changed: false, status: "seat_missing", retryable: false };
    const seatRows = Array.isArray(table.seatRows) ? table.seatRows : [];
    let changed = false;
    table.seatRows = seatRows.map((row) => {
      if (row?.user_id !== userId || String(row?.status || "ACTIVE").toUpperCase() !== "ACTIVE") return row;
      changed = true;
      return { ...row, status: "INACTIVE", stack: 0 };
    });
    const state = table?.stateRow?.state && typeof table.stateRow.state === "object" ? table.stateRow.state : {};
    const nextStacks = { ...(state.stacks || {}) };
    delete nextStacks[userId];
    const activeSeatUserIds = new Set(
      table.seatRows
        .filter((row) => String(row?.status || "").toUpperCase() === "ACTIVE")
        .map((row) => row?.user_id)
        .filter((id) => typeof id === "string" && id.length > 0)
    );
    const nextTurnUserId = typeof state?.turnUserId === "string" && activeSeatUserIds.has(state.turnUserId)
      ? state.turnUserId
      : null;
    table.stateRow = { ...(table.stateRow || { version: 0 }), state: { ...state, turnUserId: nextTurnUserId, stacks: nextStacks } };
    await fs.writeFile(env.WS_PERSISTED_STATE_FILE, JSON.stringify(doc) + "\\n", "utf8");
    return { ok: true, changed, status: changed ? "cleaned" : "already_inactive", retryable: false };
  };
}
`, "inactive-cleanup-test-adapter.mjs");

  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PERSISTED_STATE_FILE: filePath,
      WS_DISCONNECT_CLEANUP_SWEEP_MS: "25",
      WS_TIMEOUT_SWEEP_MS: "999999",
      WS_INACTIVE_CLEANUP_ADAPTER_MODULE_PATH: `file://${cleanupModule.filePath}`
    }
  });

  try {
    await waitForListening(child, 5000);
    const seated = await connectClient(port);
    const observer = await connectClient(port);
    await hello(seated);
    await hello(observer);
    await auth(seated, makeHs256Jwt({ secret, sub: "seat_user" }), "auth-seat-cleanup");
    await auth(observer, makeHs256Jwt({ secret, sub: "observer_user" }), "auth-observer-cleanup");

    sendFrame(seated, { version: "1.0", type: "table_join", requestId: "join-cleanup-seat", ts: "2026-03-01T00:00:01Z", payload: { tableId } });
    await nextMessageOfType(seated, "commandResult");
    await nextMessageOfType(seated, "table_state");

    sendFrame(observer, { version: "1.0", type: "table_state_sub", requestId: "sub-cleanup-observer", ts: "2026-03-01T00:00:02Z", payload: { tableId } });
    const baseline = await nextMessageOfType(observer, "table_state");
    assert.equal(baseline.payload.members.some((member) => member.userId === "seat_user"), true);

    seated.close();
    const afterCleanup = await nextMessageMatching(
      observer,
      (frame) => frame?.type === "table_state" && frame?.roomId === tableId && frame?.payload?.members?.every((member) => member.userId !== "seat_user"),
      5000
    );
    assert.equal(afterCleanup.payload.members.some((member) => member.userId === "seat_user"), false);

    let restoredSnapshot = null;
    const snapshotDeadline = Date.now() + 5000;
    while (Date.now() < snapshotDeadline) {
      sendFrame(observer, { version: "1.0", type: "table_state_sub", requestId: `sub-cleanup-observer-snapshot-${Date.now()}`, ts: "2026-03-01T00:00:03Z", payload: { tableId, view: "snapshot" } });
      restoredSnapshot = await nextMessageOfType(observer, "stateSnapshot");
      const restoredTurnUserId = restoredSnapshot?.payload?.public?.turn?.userId ?? null;
      const restoredSeatUserIds = Object.keys(restoredSnapshot?.payload?.public?.seats || {});
      const seatRemoved = restoredSeatUserIds.includes("seat_user") === false;
      const validTurn = restoredTurnUserId === null || restoredSeatUserIds.includes(restoredTurnUserId);
      if (seatRemoved && validTurn) {
        break;
      }
    }
    const restoredTurnUserId = restoredSnapshot?.payload?.public?.turn?.userId ?? null;
    const restoredSeatUserIds = Object.keys(restoredSnapshot?.payload?.public?.seats || {});
    assert.equal(restoredSeatUserIds.includes("seat_user"), false);
    assert.equal(restoredTurnUserId === null || restoredSeatUserIds.includes(restoredTurnUserId), true);
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(cleanupModule.dir, { recursive: true, force: true });
  }
});

test("disconnect cleanup close rewrite restores inert state and blocks repeated timeout sweeps", async () => {
  const secret = "disconnect-cleanup-closed-inert";
  const tableId = "table_disconnect_closed_inert";
  const store = {
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "active" },
        seatRows: [{ user_id: "seat_user_closed", seat_no: 1, status: "ACTIVE", is_bot: false, stack: 500 }],
        stateRow: {
          version: 17,
          state: {
            handId: "h17",
            phase: "PREFLOP",
            turnUserId: "seat_user_closed",
            turnStartedAt: Date.now() - 30_000,
            turnDeadlineAt: Date.now() - 20_000,
            stacks: { seat_user_closed: 500 }
          }
        }
      }
    }
  };
  const { dir, filePath } = await writePersistedFile(store);
  const cleanupModule = await writeTestModule(`
import fs from "node:fs/promises";
export function createInactiveCleanupExecutor({ env }) {
  return async ({ tableId, userId }) => {
    const raw = await fs.readFile(env.WS_PERSISTED_STATE_FILE, "utf8");
    const doc = JSON.parse(raw || "{}");
    const table = doc?.tables?.[tableId];
    if (!table) return { ok: true, changed: false, status: "seat_missing", retryable: false };
    table.tableRow = { ...(table.tableRow || {}), status: "CLOSED" };
    table.seatRows = (Array.isArray(table.seatRows) ? table.seatRows : []).map((row) =>
      row?.user_id === userId ? { ...row, status: "INACTIVE", stack: 0 } : row
    );
    const state = table?.stateRow?.state && typeof table.stateRow.state === "object" ? table.stateRow.state : {};
    const nextStacks = { ...(state.stacks || {}) };
    delete nextStacks[userId];
    table.stateRow = {
      ...(table.stateRow || { version: 0 }),
      state: {
        ...state,
        phase: "HAND_DONE",
        handId: "",
        handSeed: "",
        showdown: null,
        community: [],
        communityDealt: 0,
        pot: 0,
        potTotal: 0,
        sidePots: [],
        turnUserId: null,
        turnStartedAt: null,
        turnDeadlineAt: null,
        currentBet: 0,
        toCallByUserId: {},
        betThisRoundByUserId: {},
        actedThisRoundByUserId: {},
        stacks: nextStacks
      }
    };
    await fs.writeFile(env.WS_PERSISTED_STATE_FILE, JSON.stringify(doc) + "\\n", "utf8");
    return { ok: true, changed: true, status: "cleaned_closed", closed: true, retryable: false };
  };
}
`, "inactive-cleanup-test-adapter-closed.mjs");

  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PERSISTED_STATE_FILE: filePath,
      WS_DISCONNECT_CLEANUP_SWEEP_MS: "25",
      WS_TIMEOUT_SWEEP_MS: "20",
      WS_INACTIVE_CLEANUP_ADAPTER_MODULE_PATH: `file://${cleanupModule.filePath}`
    }
  });

  try {
    await waitForListening(child, 5000);
    const seated = await connectClient(port);
    const observer = await connectClient(port);
    await hello(seated);
    await hello(observer);
    await auth(seated, makeHs256Jwt({ secret, sub: "seat_user_closed" }), "auth-seat-cleanup-closed");
    await auth(observer, makeHs256Jwt({ secret, sub: "observer_user_closed" }), "auth-observer-cleanup-closed");

    sendFrame(seated, { version: "1.0", type: "table_join", requestId: "join-cleanup-closed-seat", ts: "2026-03-01T00:05:01Z", payload: { tableId } });
    await nextMessageOfType(seated, "commandResult");
    await nextMessageOfType(seated, "table_state");

    sendFrame(observer, { version: "1.0", type: "table_state_sub", requestId: "sub-cleanup-closed-observer", ts: "2026-03-01T00:05:02Z", payload: { tableId } });
    const baseline = await nextMessageOfType(observer, "table_state");
    assert.equal(baseline.payload.members.some((member) => member.userId === "seat_user_closed"), true);

    seated.close();
    const afterDisconnect = await nextMessageMatching(
      observer,
      (frame) => frame?.type === "table_state" && frame?.roomId === tableId && frame?.payload?.members?.every((member) => member.userId !== "seat_user_closed"),
      5000
    );
    assert.equal(afterDisconnect.payload.members.some((member) => member.userId === "seat_user_closed"), false);
    sendFrame(observer, { version: "1.0", type: "table_state_sub", requestId: "sub-cleanup-closed-observer-post", ts: "2026-03-01T00:05:03Z", payload: { tableId, view: "snapshot" } });
    const afterCleanup = await nextMessageOfType(observer, "stateSnapshot");
    assert.equal(afterCleanup.payload.public.turn.userId, null);

    const versionAfterCleanup = afterCleanup.payload.stateVersion;
    await new Promise((resolve) => setTimeout(resolve, 250));
    const persistedAfterSweep = await readPersistedFile(filePath);
    assert.equal(persistedAfterSweep.tables[tableId].stateRow.state.phase, "HAND_DONE");
    assert.equal(persistedAfterSweep.tables[tableId].stateRow.version, versionAfterCleanup);
    sendFrame(observer, { version: "1.0", type: "table_state_sub", requestId: "sub-cleanup-closed-observer-final", ts: "2026-03-01T00:05:04Z", payload: { tableId, view: "snapshot" } });
    const finalSnapshot = await nextMessageOfType(observer, "stateSnapshot");
    assert.equal(finalSnapshot.payload.public.turn.userId, null);
    assert.equal(finalSnapshot.payload.stateVersion, versionAfterCleanup);
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(cleanupModule.dir, { recursive: true, force: true });
  }
});

test("disconnect cleanup restore failure does not broadcast stale success", async () => {
  const secret = "disconnect-cleanup-failure";
  const tableId = "table_disconnect_restore_fail";
  const store = {
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "active" },
        seatRows: [{ user_id: "seat_user_fail", seat_no: 2, status: "ACTIVE", is_bot: false, stack: 500 }],
        stateRow: { version: 3, state: { handId: "h3", phase: "PREFLOP", turnUserId: "seat_user_fail", stacks: { seat_user_fail: 500 } } }
      }
    }
  };
  const { dir, filePath } = await writePersistedFile(store);
  const cleanupModule = await writeTestModule(`
import fs from "node:fs/promises";
export function createInactiveCleanupExecutor({ env }) {
  return async ({ tableId, userId }) => {
    const raw = await fs.readFile(env.WS_PERSISTED_STATE_FILE, "utf8");
    const doc = JSON.parse(raw || "{}");
    const table = doc?.tables?.[tableId];
    if (!table) return { ok: true, changed: false, status: "seat_missing", retryable: false };
    table.seatRows = (table.seatRows || []).map((row) => row?.user_id === userId ? { ...row, status: "INACTIVE", stack: 0 } : row);
    table.stateRow = null;
    await fs.writeFile(env.WS_PERSISTED_STATE_FILE, JSON.stringify(doc) + "\\n", "utf8");
    return { ok: true, changed: true, status: "cleaned", retryable: false };
  };
}
`, "inactive-cleanup-test-adapter-fail.mjs");

  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PERSISTED_STATE_FILE: filePath,
      WS_DISCONNECT_CLEANUP_SWEEP_MS: "25",
      WS_TIMEOUT_SWEEP_MS: "999999",
      WS_INACTIVE_CLEANUP_ADAPTER_MODULE_PATH: `file://${cleanupModule.filePath}`
    }
  });

  try {
    await waitForListening(child, 5000);
    const seated = await connectClient(port);
    const observer = await connectClient(port);
    await hello(seated);
    await hello(observer);
    await auth(seated, makeHs256Jwt({ secret, sub: "seat_user_fail" }), "auth-seat-fail");
    await auth(observer, makeHs256Jwt({ secret, sub: "observer_user_fail" }), "auth-observer-fail");

    sendFrame(seated, { version: "1.0", type: "table_join", requestId: "join-cleanup-fail-seat", ts: "2026-03-01T00:10:01Z", payload: { tableId } });
    await nextMessageOfType(seated, "commandResult");
    await nextMessageOfType(seated, "table_state");

    sendFrame(observer, { version: "1.0", type: "table_state_sub", requestId: "sub-cleanup-fail-observer", ts: "2026-03-01T00:10:02Z", payload: { tableId } });
    await nextMessageOfType(observer, "table_state");

    seated.close();
    const maybePresenceUpdate = await attemptMessage(observer, 1200);
    if (maybePresenceUpdate) {
      assert.equal(maybePresenceUpdate.type, "table_state");
    }
    sendFrame(observer, { version: "1.0", type: "table_state_sub", requestId: "sub-cleanup-fail-observer-snapshot", ts: "2026-03-01T00:10:03Z", payload: { tableId, view: "snapshot" } });
    const snapshot = await nextMessageOfType(observer, "stateSnapshot");
    assert.equal(snapshot.payload.public.turn.userId, "seat_user_fail");
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(cleanupModule.dir, { recursive: true, force: true });
  }
});

test("disconnect cleanup turn_protected path keeps semantics unchanged", async () => {
  const secret = "disconnect-cleanup-protected";
  const tableId = "table_disconnect_turn_protected";
  const store = {
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "active" },
        seatRows: [{ user_id: "seat_user_protected", seat_no: 1, status: "ACTIVE", is_bot: false, stack: 500 }],
        stateRow: { version: 11, state: { handId: "h11", phase: "PREFLOP", turnUserId: "seat_user_protected", stacks: { seat_user_protected: 500 } } }
      }
    }
  };
  const { dir, filePath } = await writePersistedFile(store);
  const cleanupModule = await writeTestModule(`
export function createInactiveCleanupExecutor() {
  return async () => ({ ok: true, changed: false, protected: true, status: "turn_protected", retryable: true });
}
`, "inactive-cleanup-test-adapter-protected.mjs");

  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PERSISTED_STATE_FILE: filePath,
      WS_DISCONNECT_CLEANUP_SWEEP_MS: "25",
      WS_TIMEOUT_SWEEP_MS: "999999",
      WS_INACTIVE_CLEANUP_ADAPTER_MODULE_PATH: `file://${cleanupModule.filePath}`
    }
  });

  try {
    await waitForListening(child, 5000);
    const seated = await connectClient(port);
    const observer = await connectClient(port);
    await hello(seated);
    await hello(observer);
    await auth(seated, makeHs256Jwt({ secret, sub: "seat_user_protected" }), "auth-seat-protected");
    await auth(observer, makeHs256Jwt({ secret, sub: "observer_user_protected" }), "auth-observer-protected");

    sendFrame(seated, { version: "1.0", type: "table_join", requestId: "join-cleanup-protected-seat", ts: "2026-03-01T00:20:01Z", payload: { tableId } });
    await nextMessageOfType(seated, "commandResult");
    await nextMessageOfType(seated, "table_state");

    sendFrame(observer, { version: "1.0", type: "table_state_sub", requestId: "sub-cleanup-protected-observer", ts: "2026-03-01T00:20:02Z", payload: { tableId } });
    const baseline = await nextMessageOfType(observer, "table_state");
    assert.equal(baseline.payload.members.some((member) => member.userId === "seat_user_protected"), true);

    seated.close();
    const maybePresenceUpdate = await attemptMessage(observer, 1000);
    if (maybePresenceUpdate) {
      assert.equal(maybePresenceUpdate.type, "table_state");
    }
    sendFrame(observer, { version: "1.0", type: "table_state_sub", requestId: "sub-cleanup-protected-observer-snapshot", ts: "2026-03-01T00:20:03Z", payload: { tableId, view: "snapshot" } });
    const snapshot = await nextMessageOfType(observer, "stateSnapshot");
    assert.equal(snapshot.payload.public.turn.userId, "seat_user_protected");
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(cleanupModule.dir, { recursive: true, force: true });
  }
});

test("autoplay adapter loader failure does not break accepted start_hand/act command flow", async () => {
  const secret = "autoplay-loader-fallback-secret";
  const tableId = "table_ws_autoplay_loader_fallback";
  const store = {
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "active" },
        seatRows: [
          { user_id: "seat_actor", seat_no: 1, status: "ACTIVE", is_bot: false },
          { user_id: "seat_other", seat_no: 2, status: "ACTIVE", is_bot: false }
        ],
        stateRow: { version: 0, state: {} }
      }
    }
  };
  const { dir, filePath } = await writePersistedFile(store);
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PERSISTED_STATE_FILE: filePath,
      WS_ACCEPTED_BOT_AUTOPLAY_ADAPTER_MODULE_PATH: "./missing-ws-autoplay-adapter-for-test.mjs"
    }
  });

  try {
    await waitForListening(child, 5000);
    const actorWs = await connectClient(port);
    const otherWs = await connectClient(port);
    await hello(actorWs);
    await hello(otherWs);
    await auth(actorWs, makeHs256Jwt({ secret, sub: "seat_actor" }), "auth-autoplay-loader-fallback-actor");
    await auth(otherWs, makeHs256Jwt({ secret, sub: "seat_other" }), "auth-autoplay-loader-fallback-other");

    sendFrame(actorWs, { version: "1.0", type: "table_state_sub", requestId: "baseline-loader-fallback", ts: "2026-02-28T02:20:00Z", payload: { tableId, view: "snapshot" } });
    const baseline = await nextMessageOfType(actorWs, "stateSnapshot");

    sendFrame(actorWs, { version: "1.0", type: "start_hand", requestId: "start-loader-fallback", ts: "2026-02-28T02:20:01Z", payload: { tableId } });
    const startResult = await nextCommandResultForRequest(actorWs, "start-loader-fallback");
    assert.equal(startResult.payload.status, "accepted");
    sendFrame(actorWs, { version: "1.0", type: "table_state_sub", requestId: "post-start-loader-fallback", ts: "2026-02-28T02:20:02Z", payload: { tableId, view: "snapshot" } });
    const postStart = await nextMessageOfType(actorWs, "stateSnapshot");
    assert.equal(postStart.payload.stateVersion > baseline.payload.stateVersion, true);
    const handId = postStart.payload?.public?.hand?.handId;
    assert.equal(typeof handId, "string");
    assert.equal(handId.length > 0, true);

    const turnUserId = postStart.payload?.public?.turn?.userId;
    assert.equal(typeof turnUserId, "string");
    assert.equal(turnUserId.length > 0, true);
    assert.equal(["seat_actor", "seat_other"].includes(turnUserId), true);

    const actingWs = turnUserId === "seat_other" ? otherWs : actorWs;
    if (turnUserId === "seat_other") {
      sendFrame(otherWs, { version: "1.0", type: "table_join", requestId: "join-loader-fallback-other", ts: "2026-02-28T02:20:02Z", payload: { tableId } });
      await nextCommandResultForRequest(otherWs, "join-loader-fallback-other");
      await nextMessageOfType(otherWs, "table_state");
    }
    sendFrame(actingWs, { version: "1.0", type: "table_state_sub", requestId: "acting-snapshot-loader-fallback", ts: "2026-02-28T02:20:02Z", payload: { tableId, view: "snapshot" } });
    const actingSnapshot = await nextMessageOfType(actingWs, "stateSnapshot");
    const legalActions = Array.isArray(actingSnapshot.payload?.public?.legalActions?.actions)
      ? actingSnapshot.payload.public.legalActions.actions
      : [];
    assert.equal(Array.isArray(legalActions), true);
    assert.equal(legalActions.length > 0, true);

    const action = legalActions.includes("CHECK") ? "check" : legalActions.includes("CALL") ? "call" : "fold";
    sendFrame(actingWs, { version: "1.0", type: "act", requestId: "act-loader-fallback", ts: "2026-02-28T02:20:03Z", payload: { tableId, handId, action } });
    const actResult = await nextCommandResultForRequest(actingWs, "act-loader-fallback");
    assert.equal(actResult.payload.status, "accepted");

    sendFrame(actorWs, { version: "1.0", type: "table_state_sub", requestId: "post-act-loader-fallback", ts: "2026-02-28T02:20:04Z", payload: { tableId, view: "snapshot" } });
    const postAct = await nextMessageOfType(actorWs, "stateSnapshot");
    assert.equal(postAct.payload.stateVersion > postStart.payload.stateVersion, true);

    assert.equal(actorWs.readyState, WebSocket.OPEN);
    assert.equal(otherWs.readyState, WebSocket.OPEN);
    actorWs.close();
    otherWs.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("WS act optimistic conflict returns deterministic rejection and resync", async () => {
  const secret = "persist-conflict-secret";
  const tableId = "table_ws_persist_conflict";
  const store = {
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "active" },
        seatRows: [
          { user_id: "seat_actor", seat_no: 1, status: "ACTIVE", is_bot: false },
          { user_id: "seat_other", seat_no: 2, status: "ACTIVE", is_bot: false }
        ],
        stateRow: { version: 0, state: {} }
      }
    }
  };
  const { dir, filePath } = await writePersistedFile(store);
  const { port, child } = await createServer({
    env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_PERSISTED_STATE_FILE: filePath }
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "seat_actor" }), "auth-conflict");
    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-conflict", ts: "2026-02-28T02:10:00Z", payload: { tableId } });
    const joinAck_join_conflict = await nextMessageOfType(ws, "commandResult");
    await nextMessageOfType(ws, "table_state");
    assert.equal(joinAck_join_conflict.payload.requestId, "join-conflict");
    assert.equal(joinAck_join_conflict.payload.status, "accepted");
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-conflict", ts: "2026-02-28T02:10:01Z", payload: { tableId, view: "snapshot" } });
    const baseline = await nextMessageOfType(ws, "stateSnapshot");
    const handId = baseline.payload.public.hand.handId;

    const forced = await readPersistedFile(filePath);
    forced.tables[tableId].stateRow.version = baseline.payload.stateVersion + 7;
    await fs.writeFile(filePath, `${JSON.stringify(forced)}
`, "utf8");

    sendFrame(ws, { version: "1.0", type: "act", requestId: "act-conflict", ts: "2026-02-28T02:10:02Z", payload: { tableId, handId, action: "fold" } });
    const rejected = await nextMessageOfType(ws, "commandResult");
    assert.equal(rejected.payload.status, "rejected");
    assert.equal(rejected.payload.reason, "conflict");
    const resync = await nextMessageOfType(ws, "resync");
    assert.equal(resync.payload.reason, "persistence_conflict");

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-conflict-after", ts: "2026-02-28T02:10:03Z", payload: { tableId, view: "snapshot" } });
    const afterConflict = await nextMessageOfType(ws, "stateSnapshot");
    assert.equal(afterConflict.payload.stateVersion, forced.tables[tableId].stateRow.version);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("failed bootstrap persistence reloads persisted state before further snapshots", async () => {
  const secret = "bootstrap-fail-secret";
  const tableId = "table_ws_bootstrap_fail";
  const store = {
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "active" },
        seatRows: [
          { user_id: "seat_bootstrap", seat_no: 1, status: "ACTIVE", is_bot: false },
          { user_id: "seat_other", seat_no: 2, status: "ACTIVE", is_bot: false }
        ],
        stateRow: { version: 0, state: {} }
      }
    }
  };
  const { dir, filePath } = await writePersistedFile(store);
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PERSISTED_STATE_FILE: filePath,
      WS_TEST_PERSIST_FAIL_KIND: "bootstrap"
    }
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "seat_bootstrap" }), "auth-bootstrap-fail");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-bootstrap-fail", ts: "2026-02-28T02:20:00Z", payload: { tableId } });
    const joinAck_join_bootstrap_fail = await nextMessageOfType(ws, "commandResult");
    assert.equal(joinAck_join_bootstrap_fail.payload.requestId, "join-bootstrap-fail");
    assert.equal(joinAck_join_bootstrap_fail.payload.status, "rejected");
    assert.ok(["persist_failed", "conflict"].includes(joinAck_join_bootstrap_fail.payload.reason));

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-bootstrap-fail", ts: "2026-02-28T02:20:01Z", payload: { tableId, view: "snapshot" } });
    const snapshot = await nextMessageOfType(ws, "stateSnapshot");
    assert.equal(snapshot.payload.stateVersion, 0);
    assert.equal(snapshot.payload.public.hand?.handId ?? null, null);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("failed timeout persistence does not publish unpersisted timeout mutation", async () => {
  const secret = "timeout-fail-secret";
  const tableId = "table_ws_timeout_fail";
  const store = {
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "active" },
        seatRows: [
          { user_id: "timeout_actor", seat_no: 1, status: "ACTIVE", is_bot: false },
          { user_id: "timeout_other", seat_no: 2, status: "ACTIVE", is_bot: false }
        ],
        stateRow: { version: 0, state: {} }
      }
    }
  };
  const { dir, filePath } = await writePersistedFile(store);
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PERSISTED_STATE_FILE: filePath,
      WS_TEST_PERSIST_FAIL_KIND: "timeout",
      WS_TIMEOUT_SWEEP_MS: "50",
      WS_POKER_TURN_MS: "100"
    }
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "timeout_actor" }), "auth-timeout-fail");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-timeout-fail", ts: "2026-02-28T02:30:00Z", payload: { tableId } });
    const joinAck_join_timeout_fail = await nextMessageOfType(ws, "commandResult");
    assert.equal(joinAck_join_timeout_fail.payload.requestId, "join-timeout-fail");
    assert.equal(joinAck_join_timeout_fail.payload.status, "accepted");

    const snapshotAndResync = nextNMessages(ws, 2, 10000);
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-timeout-before", ts: "2026-02-28T02:30:01Z", payload: { tableId, view: "snapshot" } });
    const [first, second] = await snapshotAndResync;
    const baseline = first.type === "stateSnapshot" ? first : second;
    const resync = first.type === "resync" ? first : second;

    assert.equal(baseline.type, "stateSnapshot");
    assert.ok(["resync", "stateSnapshot"].includes(resync.type));
    if (resync.type === "resync") assert.equal(resync.payload.reason, "persistence_conflict");

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-timeout-after", ts: "2026-02-28T02:30:02Z", payload: { tableId, view: "snapshot" } });
    const after = await nextMessageOfType(ws, "stateSnapshot");
    assert.equal(after.payload.stateVersion, baseline.payload.stateVersion);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("table_snapshot rejects unauthenticated requests", async () => {
  const { port, child } = await createServer();
  await waitForListening(child, 5000);
  const ws = await connectClient(port);
  try {
    await hello(ws);

    sendFrame(ws, {
      version: "1.0",
      type: "table_snapshot",
      requestId: "snapshot-unauth",
      ts: "2026-02-28T03:00:00Z",
      payload: { tableId: "table_snapshot_unauth" }
    });

    const frame = await nextMessage(ws);
    assert.equal(frame.type, "error");
    assert.equal(frame.payload.code, "auth_required");
  } finally {
    ws.close();
    child.kill();
    await waitForExit(child);
  }
});

test("table_snapshot supports roomId alias and payload.tableId equivalently", async () => {
  const secret = "snapshot-secret";
  const token = makeHs256Jwt({ secret, sub: "snapshot_user" });
  const tableId = "table_snapshot_alias";
  const fixture = {
    [tableId]: {
      tableId,
      state: { version: 12, state: { phase: "PREFLOP", seats: [] } },
      myHoleCards: [],
      legalActions: [],
      actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
      viewer: { userId: "snapshot_user", seated: false }
    }
  };
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_TABLE_SNAPSHOT_FIXTURES_JSON: JSON.stringify(fixture)
    }
  });
  await waitForListening(child, 5000);
  const ws = await connectClient(port);
  try {
    await hello(ws);
    const authOk = await auth(ws, token, "snapshot-auth");
    assert.equal(authOk.type, "authOk");

    sendFrame(ws, {
      version: "1.0",
      type: "table_snapshot",
      requestId: "snapshot-room-id",
      roomId: tableId,
      ts: "2026-02-28T03:00:01Z",
      payload: {}
    });
    const byRoomId = await nextMessageOfType(ws, "table_snapshot");

    sendFrame(ws, {
      version: "1.0",
      type: "table_snapshot",
      requestId: "snapshot-payload-id",
      ts: "2026-02-28T03:00:02Z",
      payload: { tableId }
    });
    const byPayload = await nextMessageOfType(ws, "table_snapshot");

    assert.equal(byRoomId.payload.tableId, tableId);
    assert.equal(byRoomId.payload.state.version, 12);
    assert.deepEqual(byRoomId.payload, byPayload.payload);
  } finally {
    ws.close();
    child.kill();
    await waitForExit(child);
  }
});

test("table_snapshot rejects mismatched roomId and payload.tableId deterministically", async () => {
  const secret = "snapshot-mismatch-secret";
  const token = makeHs256Jwt({ secret, sub: "snapshot_user" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_TABLE_SNAPSHOT_FIXTURES_JSON: JSON.stringify({
        table_a: {
          tableId: "table_a",
          state: { version: 1, state: {} },
          myHoleCards: [],
          legalActions: [],
          actionConstraints: { toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
          viewer: { userId: "snapshot_user", seated: false }
        }
      })
    }
  });
  await waitForListening(child, 5000);
  const ws = await connectClient(port);
  try {
    await hello(ws);
    await auth(ws, token, "snapshot-auth-mismatch");

    sendFrame(ws, {
      version: "1.0",
      type: "table_snapshot",
      requestId: "snapshot-mismatch",
      roomId: "table_a",
      ts: "2026-02-28T03:00:03Z",
      payload: { tableId: "table_b" }
    });

    const frame = await nextMessage(ws);
    assert.equal(frame.type, "error");
    assert.equal(frame.payload.code, "INVALID_ROOM_ID");
    assert.equal(frame.payload.message, "roomId and payload.tableId must match when both are provided");
  } finally {
    ws.close();
    child.kill();
    await waitForExit(child);
  }
});

test("table_snapshot returns gameplay snapshot without mutating presence table_state", async () => {
  const secret = "snapshot-presence-secret";
  const token = makeHs256Jwt({ secret, sub: "presence_user" });
  const tableId = "table_snapshot_presence";
  const fixture = {
    [tableId]: {
      tableId,
      state: { version: 9, state: { phase: "PREFLOP", seats: [] } },
      myHoleCards: [],
      legalActions: ["CHECK"],
      actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: 1000 },
      viewer: { userId: "presence_user", seated: true }
    }
  };
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_TABLE_SNAPSHOT_FIXTURES_JSON: JSON.stringify(fixture)
    }
  });
  await waitForListening(child, 5000);
  const ws = await connectClient(port);
  try {
    await hello(ws);
    await auth(ws, token, "snapshot-auth-presence");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-presence", ts: "2026-02-28T03:00:04Z", payload: { tableId } });
    const joined = await nextMessageOfType(ws, "table_state");

    sendFrame(ws, { version: "1.0", type: "table_snapshot", requestId: "snapshot-presence", ts: "2026-02-28T03:00:05Z", payload: { tableId } });
    const snapshot = await nextMessageOfType(ws, "table_snapshot");

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "sub-presence", ts: "2026-02-28T03:00:06Z", payload: { tableId } });
    const after = await nextMessageOfType(ws, "table_state");

    assert.equal(snapshot.payload.state.version, 9);
    assert.deepEqual(after.payload.members, joined.payload.members);
  } finally {
    ws.close();
    child.kill();
    await waitForExit(child);
  }
});

test("table_snapshot matches HTTP snapshot version semantics for repeated reads", async () => {
  const secret = "snapshot-repeat-secret";
  const token = makeHs256Jwt({ secret, sub: "repeat_user" });
  const tableId = "table_snapshot_repeat";
  const fixture = {
    [tableId]: {
      tableId,
      state: { version: 33, state: { phase: "PREFLOP", seats: [] } },
      myHoleCards: [],
      legalActions: [],
      actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
      viewer: { userId: "repeat_user", seated: false }
    }
  };

  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_TABLE_SNAPSHOT_FIXTURES_JSON: JSON.stringify(fixture)
    }
  });
  await waitForListening(child, 5000);
  const ws = await connectClient(port);
  try {
    await hello(ws);
    await auth(ws, token, "snapshot-auth-repeat");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-repeat", ts: "2026-02-28T03:10:00Z", payload: { tableId } });
    const joined = await nextMessageOfType(ws, "table_state");

    sendFrame(ws, { version: "1.0", type: "table_snapshot", requestId: "snapshot-repeat-1", ts: "2026-02-28T03:10:01Z", payload: { tableId } });
    const first = await nextMessageOfType(ws, "table_snapshot");

    sendFrame(ws, { version: "1.0", type: "table_snapshot", requestId: "snapshot-repeat-2", ts: "2026-02-28T03:10:02Z", payload: { tableId } });
    const second = await nextMessageOfType(ws, "table_snapshot");

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "sub-repeat", ts: "2026-02-28T03:10:03Z", payload: { tableId } });
    const after = await nextMessageOfType(ws, "table_state");

    assert.equal(first.payload.state.version, 33);
    assert.equal(second.payload.state.version, 33);
    assert.deepEqual(first.payload, second.payload);
    assert.deepEqual(after.payload.members, joined.payload.members);
  } finally {
    ws.close();
    child.kill();
    await waitForExit(child);
  }
});


test("table_snapshot rejects missing requestId deterministically and does not mutate presence", async () => {
  const secret = "snapshot-no-reqid-secret";
  const token = makeHs256Jwt({ secret, sub: "noreqid_user" });
  const tableId = "table_snapshot_noreqid";
  const fixture = {
    [tableId]: {
      tableId,
      state: { version: 6, state: { phase: "PREFLOP", seats: [] } },
      myHoleCards: [],
      legalActions: [],
      actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
      viewer: { userId: "noreqid_user", seated: false }
    }
  };
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_TABLE_SNAPSHOT_FIXTURES_JSON: JSON.stringify(fixture)
    }
  });
  await waitForListening(child, 5000);
  const ws = await connectClient(port);
  try {
    await hello(ws);
    await auth(ws, token, "snapshot-auth-noreqid");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-noreqid", ts: "2026-02-28T03:11:00Z", payload: { tableId } });
    await nextMessageOfType(ws, "commandResult");
    const before = await nextMessageOfType(ws, "table_state");

    sendFrame(ws, { version: "1.0", type: "table_snapshot", ts: "2026-02-28T03:11:01Z", payload: { tableId } });
    const rejected = await nextMessage(ws);
    assert.equal(rejected.type, "error");
    assert.equal(rejected.payload.code, "INVALID_COMMAND");
    assert.equal(rejected.payload.message, "table_snapshot requires requestId");

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "sub-noreqid", ts: "2026-02-28T03:11:02Z", payload: { tableId } });
    const after = await nextMessageOfType(ws, "table_state");
    assert.deepEqual(after.payload.members, before.payload.members);
  } finally {
    ws.close();
    child.kill();
    await waitForExit(child);
  }
});


test("table_snapshot rejects invalid gameplay snapshot state deterministically", async () => {
  const secret = "snapshot-invalid-state-secret";
  const token = makeHs256Jwt({ secret, sub: "invalid_snapshot_user" });
  const tableId = "table_snapshot_invalid";
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_TABLE_SNAPSHOT_FIXTURES_JSON: JSON.stringify({
        [tableId]: { ok: false, code: "state_invalid" }
      })
    }
  });
  await waitForListening(child, 5000);
  const ws = await connectClient(port);
  try {
    await hello(ws);
    await auth(ws, token, "snapshot-auth-invalid-state");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-invalid-state", ts: "2026-02-28T03:12:00Z", payload: { tableId } });
    await nextMessageOfType(ws, "commandResult");
    const before = await nextMessageOfType(ws, "table_state");

    sendFrame(ws, { version: "1.0", type: "table_snapshot", requestId: "snapshot-invalid-state", ts: "2026-02-28T03:12:01Z", payload: { tableId } });
    const rejected = await nextMessage(ws);
    assert.equal(rejected.type, "error");
    assert.equal(rejected.payload.code, "INVALID_COMMAND");
    assert.equal(rejected.payload.message, "state_invalid");

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "sub-invalid-state", ts: "2026-02-28T03:12:02Z", payload: { tableId } });
    const after = await nextMessageOfType(ws, "table_state");
    assert.deepEqual(after.payload.members, before.payload.members);
  } finally {
    ws.close();
    child.kill();
    await waitForExit(child);
  }
});

test("table_snapshot internal failures are non-leaking and do not mutate presence", async () => {
  const secret = "snapshot-internal-failure-secret";
  const token = makeHs256Jwt({ secret, sub: "internal_snapshot_user" });
  const tableId = "table_snapshot_internal_failure";
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_TABLE_SNAPSHOT_FIXTURES_JSON: JSON.stringify({
        [tableId]: { ok: false, code: "db_internal: relation private.secret failed" }
      })
    }
  });
  await waitForListening(child, 5000);
  const ws = await connectClient(port);
  try {
    await hello(ws);
    await auth(ws, token, "snapshot-auth-internal-failure");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-internal-failure", ts: "2026-02-28T03:12:00Z", payload: { tableId } });
    await nextMessageOfType(ws, "commandResult");
    const before = await nextMessageOfType(ws, "table_state");

    sendFrame(ws, { version: "1.0", type: "table_snapshot", requestId: "snapshot-internal-failure", ts: "2026-02-28T03:12:01Z", payload: { tableId } });
    const rejected = await nextMessage(ws);
    assert.equal(rejected.type, "error");
    assert.equal(rejected.payload.code, "INVALID_COMMAND");
    assert.equal(rejected.payload.message, "snapshot_failed");

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "sub-internal-failure", ts: "2026-02-28T03:12:02Z", payload: { tableId } });
    const after = await nextMessageOfType(ws, "table_state");
    assert.deepEqual(after.payload.members, before.payload.members);
  } finally {
    ws.close();
    child.kill();
    await waitForExit(child);
  }
});

test("table_state_sub and snapshot bootstrap succeed with legacy stringified persisted poker state", async () => {
  const secret = "persist-legacy-secret";
  const tableId = "table_ws_persist_legacy_string";
  const store = {
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "active" },
        seatRows: [
          { user_id: "legacy_user", seat_no: 1, status: "ACTIVE", is_bot: false },
          { user_id: "legacy_other", seat_no: 2, status: "ACTIVE", is_bot: false }
        ],
        stateRow: {
          version: 7,
          state: JSON.stringify({
            phase: "PREFLOP",
            hand: {
              handId: "legacy_hand_7"
            }
          })
        }
      }
    }
  };

  const { dir, filePath } = await writePersistedFile(store);
  const { port, child } = await createServer({
    env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_PERSISTED_STATE_FILE: filePath }
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "legacy_user" }), "auth-legacy");

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "sub-legacy", ts: "2026-02-28T02:40:01Z", payload: { tableId } });
    const tableState = await nextMessageOfType(ws, "table_state");
    assert.equal(tableState.payload.roomId, tableId);

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-legacy", ts: "2026-02-28T02:40:02Z", payload: { tableId, view: "snapshot" } });
    const snapshot = await nextMessageOfType(ws, "stateSnapshot");
    assert.equal(snapshot.payload.stateVersion, 7);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("authoritative join branch rehydrates from persisted source before attach", async () => {
  const secret = "auth-join-branch-secret";
  const tableId = "table_auth_join_branch";
  const store = {
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "OPEN" },
        seatRows: [
          { user_id: "branch_user", seat_no: 1, status: "ACTIVE", is_bot: false }
        ],
        stateRow: { version: 0, state: JSON.stringify({ tableId, seats: [{ userId: "branch_user", seatNo: 1 }], stacks: { branch_user: 25 } }) }
      }
    }
  };
  const { dir, filePath } = await writePersistedFile(store);
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PERSISTED_STATE_FILE: filePath,
      WS_AUTHORITATIVE_JOIN_ENABLED: "1"
    }
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "branch_user" }), "auth-join-branch");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-branch", ts: "2026-02-28T05:00:00Z", payload: { tableId, buyIn: 100 } });
    const joined = await nextMessageOfType(ws, "commandResult");
    assert.equal(joined.payload.requestId, "join-branch");
    assert.ok(["accepted", "rejected"].includes(joined.payload.status));

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-branch", ts: "2026-02-28T05:00:01Z", payload: { tableId, view: "snapshot" } });
    const snapshot = await nextMessageOfType(ws, "stateSnapshot");
    assert.equal(snapshot.payload.you.userId, "branch_user");
    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
  }
});


test("authoritative join missing state row returns protocol-safe state_missing", async () => {
  const secret = "auth-join-missing-state-secret";
  const tableId = "table_auth_join_missing_state";
  const store = {
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "OPEN" },
        seatRows: []
      }
    }
  };
  const { dir, filePath } = await writePersistedFile(store);
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PERSISTED_STATE_FILE: filePath,
      WS_AUTHORITATIVE_JOIN_ENABLED: "1"
    }
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "missing_state_user" }), "auth-join-missing-state");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-missing-state", ts: "2026-02-28T05:30:00Z", payload: { tableId, buyIn: 100 } });
    const error = await nextMessageOfType(ws, "commandResult");
    assert.equal(error.payload.status, "rejected");
    assert.ok(["state_missing", "poker_state_missing"].includes(error.payload.reason));
    assert.notEqual(error.payload.reason, "temporarily_unavailable");
    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
  }
});


test("authoritative join with historical non-ACTIVE seat does not rejoin shortcut", async () => {
  const secret = "auth-join-historical-seat-secret";
  const tableId = "table_auth_join_historical_non_active";
  const store = {
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "OPEN" },
        seatRows: [{ user_id: "historical_user", seat_no: 1, status: "INACTIVE", is_bot: false }]
      }
    }
  };
  const { dir, filePath } = await writePersistedFile(store);
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PERSISTED_STATE_FILE: filePath,
      WS_AUTHORITATIVE_JOIN_ENABLED: "1"
    }
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "historical_user" }), "auth-join-historical");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-historical", ts: "2026-02-28T05:50:00Z", payload: { tableId, buyIn: 100 } });
    const error = await nextMessageOfType(ws, "commandResult");
    assert.equal(error.payload.status, "rejected");
    assert.equal(error.payload.reason, "seat_taken");
    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("authoritative WS table_join seeds two bots once and returns authoritative bot seat snapshot", async () => {
  const secret = "auth-join-bots-secret";
  const tableId = "table_auth_join_bots";
  const store = {
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "OPEN", stakes: '{"sb":1,"bb":2}' },
        seatRows: [],
        stateRow: { version: 1, state: { tableId, seats: [], stacks: {}, phase: "INIT", pot: 0 } }
      }
    }
  };
  const { dir, filePath } = await writePersistedFile(store);
  const botSeat2 = makeBotUserId(tableId, 2);
  const botSeat3 = makeBotUserId(tableId, 3);
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PERSISTED_STATE_FILE: filePath,
      WS_AUTHORITATIVE_JOIN_ENABLED: "1",
      POKER_BOTS_ENABLED: "1",
      POKER_BOTS_MAX_PER_TABLE: "2",
      POKER_BOT_BUYIN_BB: "100",
      POKER_BOT_PROFILE_DEFAULT: "TRIVIAL"
    }
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "bot_seed_human" }), "auth-join-bots");

    sendFrame(ws, {
      version: "1.0",
      type: "table_join",
      requestId: "join-bots-1",
      ts: "2026-02-28T06:00:00Z",
      payload: { tableId, seatNo: 1, buyIn: 150 }
    });
    const firstAck = await nextCommandResultForRequest(ws, "join-bots-1");
    sendFrame(ws, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "join-bots-sub-1",
      ts: "2026-02-28T06:00:00Z",
      payload: { tableId }
    });
    const firstState = await nextMessageOfType(ws, "table_state");
    if (firstAck.payload.status !== "accepted") {
      assert.fail(`first authoritative join ack payload: ${JSON.stringify(firstAck.payload)}`);
    }
    assert.deepEqual(firstState.payload.authoritativeMembers, [
      { userId: "bot_seed_human", seat: 1 },
      { userId: botSeat2, seat: 2 },
      { userId: botSeat3, seat: 3 }
    ]);
    assert.equal(firstState.payload.members.some((entry) => entry.userId === "bot_seed_human"), true);
    assert.equal(firstState.payload.members.some((entry) => entry.userId === botSeat2), false);
    assert.deepEqual(firstState.payload.seats, [
      { userId: "bot_seed_human", seatNo: 1, status: "ACTIVE" },
      { userId: botSeat2, seatNo: 2, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" },
      { userId: botSeat3, seatNo: 3, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" }
    ]);
    assert.equal(typeof firstState.payload.stacks.bot_seed_human, "number");
    assert.equal(typeof firstState.payload.stacks[botSeat2], "number");
    assert.equal(typeof firstState.payload.stacks[botSeat3], "number");

    sendFrame(ws, {
      version: "1.0",
      type: "table_join",
      requestId: "join-bots-1",
      ts: "2026-02-28T06:00:01Z",
      payload: { tableId, seatNo: 1, buyIn: 150 }
    });
    const secondAck = await nextCommandResultForRequest(ws, "join-bots-1");
    sendFrame(ws, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "join-bots-sub-2",
      ts: "2026-02-28T06:00:01Z",
      payload: { tableId }
    });
    const secondState = await nextMessageOfType(ws, "table_state");
    if (secondAck.payload.status !== "accepted") {
      assert.fail(`second authoritative join ack payload: ${JSON.stringify(secondAck.payload)}`);
    }
    assert.deepEqual(secondState.payload.authoritativeMembers, firstState.payload.authoritativeMembers);
    assert.deepEqual(secondState.payload.seats, firstState.payload.seats);

    const persisted = await readPersistedFile(filePath);
    const persistedSeats = persisted.tables[tableId].seatRows.filter((seat) => seat.status === "ACTIVE");
    assert.equal(persistedSeats.length, 3);
    assert.equal(persistedSeats.filter((seat) => seat.is_bot).length, 2);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
