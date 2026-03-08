import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
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


function waitForStdoutLine(proc, needle, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.stdout.off("data", onData);
      proc.off("exit", onExit);
      reject(new Error(`Timed out waiting for stdout line: ${needle}`));
    }, timeoutMs);

    const onData = (buf) => {
      if (String(buf).includes(needle)) {
        clearTimeout(timer);
        proc.stdout.off("data", onData);
        proc.off("exit", onExit);
        resolve();
      }
    };

    const onExit = (code) => {
      clearTimeout(timer);
      proc.stdout.off("data", onData);
      reject(new Error(`Server exited before stdout match (${needle}): ${code}`));
    };

    proc.stdout.on("data", onData);
    proc.once("exit", onExit);
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

test("authenticated snapshot view emits stateSnapshot with canonical payload shape", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_123" });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret } });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    const authOk = await auth(ws, token, "req-auth-snapshot");
    assert.equal(authOk.type, "authOk");

    sendFrame(ws, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-snapshot",
      ts: "2026-02-28T00:00:02Z",
      payload: { tableId: "table_A" }
    });
    const join = await nextMessage(ws);
    assert.equal(join.type, "table_state");

    sendFrame(ws, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-snapshot",
      ts: "2026-02-28T00:00:03Z",
      payload: { tableId: "table_A", view: "snapshot" }
    });
    const snapshot = await nextMessage(ws);
    assert.equal(snapshot.type, "stateSnapshot");
    assert.equal(snapshot.payload.table.tableId, "table_A");
    assert.equal(Number.isInteger(snapshot.payload.stateVersion), true);
    assert.equal(typeof snapshot.payload.table, "object");
    assert.equal(typeof snapshot.payload.you, "object");
    assert.equal(typeof snapshot.payload.public, "object");
    assert.deepEqual(snapshot.payload.table.members, [{ userId: "user_123", seat: 1 }]);
    assert.equal(snapshot.payload.you.userId, "user_123");
    assert.equal(snapshot.payload.you.seat, 1);
    assert.deepEqual(snapshot.payload.private, { userId: "user_123", seat: 1, holeCards: [] });
    assert.deepEqual(snapshot.payload.public.hand, { handId: null, status: "LOBBY", round: null });
    assert.deepEqual(snapshot.payload.public.board, { cards: [] });
    assert.deepEqual(snapshot.payload.public.pot, { total: 0, sidePots: [] });
    assert.equal(typeof snapshot.sessionId, "string");
    assert.equal(typeof snapshot.ts, "string");
    assert.equal(snapshot.version, "1.0");

    sendFrame(ws, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-snapshot-2",
      ts: "2026-02-28T00:00:04Z",
      payload: { tableId: "table_A", view: "snapshot" }
    });
    const snapshot2 = await nextMessage(ws);
    assert.equal(snapshot2.type, "stateSnapshot");
    assert.deepEqual(snapshot2.payload, snapshot.payload);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("snapshot-view subscription is one-shot and does not receive later legacy table_state broadcasts", async () => {
  const secret = "test-secret";
  const snapshotToken = makeHs256Jwt({ secret, sub: "snapshot_user" });
  const actorToken = makeHs256Jwt({ secret, sub: "actor_user" });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret } });

  try {
    await waitForListening(child, 5000);
    const snapshotClient = await connectClient(port);
    const actorClient = await connectClient(port);

    await hello(snapshotClient);
    await hello(actorClient);
    assert.equal((await auth(snapshotClient, snapshotToken, "req-auth-snapshot-oneshot")).type, "authOk");
    assert.equal((await auth(actorClient, actorToken, "req-auth-actor-oneshot")).type, "authOk");

    sendFrame(snapshotClient, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-snapshot-oneshot",
      ts: "2026-02-28T00:00:05Z",
      payload: { tableId: "table_oneshot", view: "snapshot" }
    });
    const snapshot = await nextMessage(snapshotClient);
    assert.equal(snapshot.type, "stateSnapshot");

    sendFrame(actorClient, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-actor-oneshot",
      ts: "2026-02-28T00:00:06Z",
      payload: { tableId: "table_oneshot" }
    });
    const actorJoin = await nextMessage(actorClient);
    assert.equal(actorJoin.type, "table_state");

    const snapshotFollowup = await attemptMessage(snapshotClient, 350);
    assert.equal(snapshotFollowup, null);

    snapshotClient.close();
    actorClient.close();
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

test("legacy table_state_sub subscribes and receives follow-up table_state", async () => {
  const secret = "test-secret";
  const subscriberToken = makeHs256Jwt({ secret, sub: "legacy_sub_user" });
  const actorToken = makeHs256Jwt({ secret, sub: "legacy_actor_user" });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret } });

  try {
    await waitForListening(child, 5000);
    const subscriber = await connectClient(port);
    const actor = await connectClient(port);

    await hello(subscriber);
    await hello(actor);
    assert.equal((await auth(subscriber, subscriberToken, "req-auth-legacy-sub")).type, "authOk");
    assert.equal((await auth(actor, actorToken, "req-auth-legacy-actor")).type, "authOk");

    sendFrame(subscriber, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-legacy",
      ts: "2026-02-28T00:00:09Z",
      payload: { tableId: "table_legacy" }
    });
    const initial = await nextMessage(subscriber);
    assert.equal(initial.type, "table_state");

    sendFrame(actor, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-legacy-actor",
      ts: "2026-02-28T00:00:10Z",
      payload: { tableId: "table_legacy" }
    });
    assert.equal((await nextMessage(actor)).type, "table_state");

    const followup = await nextMessage(subscriber);
    assert.equal(followup.type, "table_state");
    assert.deepEqual(followup.payload.members, [{ userId: "legacy_actor_user", seat: 1 }]);

    subscriber.close();
    actor.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});





test("table_join bootstrap logging path is runtime-safe and does not crash server", async () => {
  const secret = "test-secret";
  const userAToken = makeHs256Jwt({ secret, sub: "log_user_a" });
  const userBToken = makeHs256Jwt({ secret, sub: "log_user_b" });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret } });

  try {
    await waitForListening(child, 5000);
    const a = await connectClient(port);
    const b = await connectClient(port);

    await hello(a);
    await hello(b);
    assert.equal((await auth(a, userAToken, "req-auth-log-a")).type, "authOk");
    assert.equal((await auth(b, userBToken, "req-auth-log-b")).type, "authOk");

    sendFrame(a, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-log-a",
      ts: "2026-02-28T00:01:00Z",
      payload: { tableId: "table_log_bootstrap" }
    });
    assert.equal((await nextMessage(a)).type, "table_state");

    sendFrame(b, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-log-b",
      ts: "2026-02-28T00:01:01Z",
      payload: { tableId: "table_log_bootstrap" }
    });
    const bJoin = await nextMessage(b);
    assert.equal(bJoin.type, "table_state");

    const aFollowup = await nextMessage(a);
    assert.equal(aFollowup.type, "table_state");

    await waitForStdoutLine(child, "ws_hand_bootstrap_started", 5000);

    assert.equal(a.readyState, WebSocket.OPEN);
    assert.equal(b.readyState, WebSocket.OPEN);

    sendFrame(a, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-log-a",
      ts: "2026-02-28T00:01:02Z",
      payload: { tableId: "table_log_bootstrap", view: "snapshot" }
    });
    const snapshot = await nextMessage(a);
    assert.equal(snapshot.type, "stateSnapshot");
    assert.equal(snapshot.payload.public.hand.status, "PREFLOP");

    a.close();
    b.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});
test("snapshot view projects live bootstrapped PREFLOP hand for seated user and observer", async () => {
  const secret = "test-secret";
  const seatedToken = makeHs256Jwt({ secret, sub: "live_seated_user" });
  const otherToken = makeHs256Jwt({ secret, sub: "live_other_user" });
  const observerToken = makeHs256Jwt({ secret, sub: "live_observer_user" });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret } });

  try {
    await waitForListening(child, 5000);
    const seated = await connectClient(port);
    const other = await connectClient(port);
    const observer = await connectClient(port);

    await hello(seated);
    await hello(other);
    await hello(observer);
    assert.equal((await auth(seated, seatedToken, "req-auth-live-seated")).type, "authOk");
    assert.equal((await auth(other, otherToken, "req-auth-live-other")).type, "authOk");
    assert.equal((await auth(observer, observerToken, "req-auth-live-observer")).type, "authOk");

    sendFrame(seated, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-live-seated",
      ts: "2026-02-28T00:00:30Z",
      payload: { tableId: "table_live_ws" }
    });
    assert.equal((await nextMessage(seated)).type, "table_state");

    sendFrame(other, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-live-other",
      ts: "2026-02-28T00:00:31Z",
      payload: { tableId: "table_live_ws" }
    });
    assert.equal((await nextMessage(other)).type, "table_state");
    assert.equal((await nextMessage(seated)).type, "table_state");

    sendFrame(seated, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-live-seated",
      ts: "2026-02-28T00:00:32Z",
      payload: { tableId: "table_live_ws", view: "snapshot" }
    });
    const seatedSnapshot = await nextMessage(seated);
    assert.equal(seatedSnapshot.type, "stateSnapshot");

    sendFrame(observer, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-live-observer",
      ts: "2026-02-28T00:00:33Z",
      payload: { tableId: "table_live_ws", view: "snapshot" }
    });
    const observerSnapshot = await nextMessage(observer);
    assert.equal(observerSnapshot.type, "stateSnapshot");

    assert.equal(seatedSnapshot.payload.public.hand.status, "PREFLOP");
    assert.equal(typeof seatedSnapshot.payload.public.hand.handId, "string");
    assert.deepEqual(seatedSnapshot.payload.public.pot, { total: 3, sidePots: [] });
    assert.equal(seatedSnapshot.payload.public.turn.userId, "live_seated_user");
    assert.equal(Number.isFinite(seatedSnapshot.payload.public.turn.startedAt), true);
    assert.equal(Number.isFinite(seatedSnapshot.payload.public.turn.deadlineAt), true);
    assert.deepEqual(seatedSnapshot.payload.public.legalActions, { seat: 1, actions: ["FOLD", "CALL", "RAISE"] });
    assert.equal(Array.isArray(seatedSnapshot.payload.private?.holeCards), true);
    assert.equal(seatedSnapshot.payload.private.holeCards.length, 2);

    assert.equal(observerSnapshot.payload.you.seat, null);
    assert.equal("private" in observerSnapshot.payload, false);
    assert.deepEqual(observerSnapshot.payload.public, {
      ...seatedSnapshot.payload.public,
      legalActions: { seat: null, actions: [] }
    });

    seated.close();
    other.close();
    observer.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});
test("observer snapshot and seated snapshot keep shared public fields but scoped private differences", async () => {
  const secret = "test-secret";
  const seatedToken = makeHs256Jwt({ secret, sub: "seated_user" });
  const observerToken = makeHs256Jwt({ secret, sub: "observer_user" });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret } });

  try {
    await waitForListening(child, 5000);
    const seatedClient = await connectClient(port);
    const observerClient = await connectClient(port);

    await hello(seatedClient);
    await hello(observerClient);
    assert.equal((await auth(seatedClient, seatedToken, "req-auth-seated-snap")).type, "authOk");
    assert.equal((await auth(observerClient, observerToken, "req-auth-observer-snap")).type, "authOk");

    sendFrame(seatedClient, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-seated",
      ts: "2026-02-28T00:00:11Z",
      payload: { tableId: "table_scope" }
    });
    assert.equal((await nextMessage(seatedClient)).type, "table_state");

    sendFrame(seatedClient, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-seated-snap",
      ts: "2026-02-28T00:00:12Z",
      payload: { tableId: "table_scope", mode: "snapshot" }
    });
    const seatedSnapshot = await nextMessage(seatedClient);
    assert.equal(seatedSnapshot.type, "stateSnapshot");

    sendFrame(observerClient, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-observer-snap",
      ts: "2026-02-28T00:00:13Z",
      payload: { tableId: "table_scope", view: "snapshot" }
    });
    const observerSnapshot = await nextMessage(observerClient);
    assert.equal(observerSnapshot.type, "stateSnapshot");

    assert.deepEqual(seatedSnapshot.payload.public, observerSnapshot.payload.public);
    assert.deepEqual(seatedSnapshot.payload.table, observerSnapshot.payload.table);
    assert.equal(seatedSnapshot.payload.you.userId, "seated_user");
    assert.equal(seatedSnapshot.payload.you.seat, 1);
    assert.deepEqual(seatedSnapshot.payload.private, { userId: "seated_user", seat: 1, holeCards: [] });
    assert.equal(observerSnapshot.payload.you.userId, "observer_user");
    assert.equal(observerSnapshot.payload.you.seat, null);
    assert.equal("private" in observerSnapshot.payload, false);

    seatedClient.close();
    observerClient.close();
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
    assert.equal((await nextMessage(actorClient)).type, "table_state");

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

test("act command accepts turn action and broadcasts updated snapshot while preserving observer privacy", async () => {
  const secret = "test-secret";
  const actorToken = makeHs256Jwt({ secret, sub: "act_actor_user" });
  const otherToken = makeHs256Jwt({ secret, sub: "act_other_user" });
  const observerToken = makeHs256Jwt({ secret, sub: "act_observer_user" });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret } });

  try {
    await waitForListening(child, 5000);
    const actor = await connectClient(port);
    const other = await connectClient(port);
    const observer = await connectClient(port);

    await hello(actor);
    await hello(other);
    await hello(observer);
    assert.equal((await auth(actor, actorToken, "req-auth-act-actor")).type, "authOk");
    assert.equal((await auth(other, otherToken, "req-auth-act-other")).type, "authOk");
    assert.equal((await auth(observer, observerToken, "req-auth-act-observer")).type, "authOk");

    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "req-join-act-actor", ts: "2026-02-28T00:01:00Z", payload: { tableId: "table_act" } });
    assert.equal((await nextMessage(actor)).type, "table_state");

    sendFrame(other, { version: "1.0", type: "table_join", requestId: "req-join-act-other", ts: "2026-02-28T00:01:01Z", payload: { tableId: "table_act" } });
    assert.equal((await nextMessage(other)).type, "table_state");
    assert.equal((await nextMessage(actor)).type, "table_state");

    sendFrame(observer, { version: "1.0", type: "table_state_sub", requestId: "req-sub-observer-act", ts: "2026-02-28T00:01:02Z", payload: { tableId: "table_act" } });
    assert.equal((await nextMessage(observer)).type, "table_state");

    sendFrame(actor, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-snapshot-before",
      ts: "2026-02-28T00:01:03Z",
      payload: { tableId: "table_act", view: "snapshot" }
    });
    const before = await nextMessage(actor);
    const handId = before.payload.public.hand.handId;

    const observerUpdatePromise = nextStateUpdate(observer, { baseline: null, timeoutMs: 1500 });

    sendFrame(actor, {
      version: "1.0",
      type: "act",
      roomId: "table_act",
      requestId: "req-act-call",
      ts: "2026-02-28T00:01:04Z",
      payload: { tableId: "table_act", handId, action: "call", amount: 999 }
    });

    const actorResult = await nextMessage(actor);
    assert.equal(actorResult.type, "commandResult");
    assert.equal(actorResult.payload.status, "accepted");
    assert.equal(actorResult.payload.reason, null);

    const actorUpdate = await nextStateUpdate(actor, { baseline: before.payload });
    const observerUpdate = await observerUpdatePromise;
    const otherUpdate = await attemptMessage(other, 1500);
    assert.equal(actorUpdate.frame.type, "stateSnapshot");
    assert.ok(otherUpdate === null || otherUpdate.type === "stateSnapshot");
    assert.equal(observerUpdate.frame.type, "stateSnapshot");
    assert.equal(actorUpdate.payload.stateVersion > before.payload.stateVersion, true);
    assert.deepEqual(actorUpdate.payload.public.pot, { total: 4, sidePots: [] });
    assert.equal(actorUpdate.payload.public.hand.status, "FLOP");
    assert.equal(actorUpdate.payload.public.board.cards.length, 3);
    assert.deepEqual(observerUpdate.payload.public, { ...actorUpdate.payload.public, legalActions: { seat: null, actions: [] } });
    assert.equal("private" in observerUpdate.payload, false);

    actor.close();
    other.close();
    observer.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("act command rejects non-turn user, malformed payload and unauthenticated attempts without mutation", async () => {
  const secret = "test-secret";
  const actorToken = makeHs256Jwt({ secret, sub: "act_reject_actor" });
  const otherToken = makeHs256Jwt({ secret, sub: "act_reject_other" });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret } });

  try {
    await waitForListening(child, 5000);
    const actor = await connectClient(port);
    const other = await connectClient(port);
    const anon = await connectClient(port);

    await hello(actor);
    await hello(other);
    await hello(anon);
    assert.equal((await auth(actor, actorToken, "req-auth-reject-actor")).type, "authOk");
    assert.equal((await auth(other, otherToken, "req-auth-reject-other")).type, "authOk");

    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "req-join-reject-actor", ts: "2026-02-28T00:02:00Z", payload: { tableId: "table_act_reject" } });
    assert.equal((await nextMessage(actor)).type, "table_state");
    sendFrame(other, { version: "1.0", type: "table_join", requestId: "req-join-reject-other", ts: "2026-02-28T00:02:01Z", payload: { tableId: "table_act_reject" } });
    assert.equal((await nextMessage(other)).type, "table_state");
    assert.equal((await nextMessage(actor)).type, "table_state");

    sendFrame(actor, { version: "1.0", type: "table_state_sub", requestId: "req-snapshot-reject-before", ts: "2026-02-28T00:02:02Z", payload: { tableId: "table_act_reject", view: "snapshot" } });
    const before = await nextMessage(actor);
    const handId = before.payload.public.hand.handId;

    sendFrame(anon, {
      version: "1.0",
      type: "act",
      requestId: "req-act-unauth",
      ts: "2026-02-28T00:02:03Z",
      payload: { tableId: "table_act_reject", handId, action: "call", amount: 0 }
    });
    const unauth = await nextMessage(anon);
    assert.equal(unauth.type, "error");
    assert.equal(unauth.payload.code, "auth_required");

    sendFrame(other, {
      version: "1.0",
      type: "act",
      requestId: "req-act-wrong-turn",
      ts: "2026-02-28T00:02:04Z",
      payload: { tableId: "table_act_reject", handId, action: "call", amount: 0 }
    });
    const wrongTurn = await nextMessage(other);
    assert.equal(wrongTurn.type, "commandResult");
    assert.equal(wrongTurn.payload.status, "rejected");

    sendFrame(other, {
      version: "1.0",
      type: "act",
      requestId: "req-act-bad-hand",
      ts: "2026-02-28T00:02:05Z",
      payload: { tableId: "table_act_reject", handId: "wrong", action: "call", amount: 0 }
    });
    const badHand = await nextMessage(other);
    assert.equal(badHand.type, "commandResult");
    assert.equal(badHand.payload.status, "rejected");

    sendFrame(other, {
      version: "1.0",
      type: "act",
      requestId: "req-act-bad-payload",
      ts: "2026-02-28T00:02:06Z",
      payload: { tableId: "table_act_reject", handId, action: "raise" }
    });
    const invalid = await nextMessage(other);
    assert.equal(invalid.type, "error");
    assert.equal(invalid.payload.code, "INVALID_COMMAND");

    sendFrame(actor, { version: "1.0", type: "table_state_sub", requestId: "req-snapshot-reject-after", ts: "2026-02-28T00:02:07Z", payload: { tableId: "table_act_reject", view: "snapshot" } });
    const after = await nextMessage(actor);
    assert.equal(after.payload.stateVersion, before.payload.stateVersion);
    assert.deepEqual(after.payload.public, before.payload.public);

    actor.close();
    other.close();
    anon.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("act accepted sends post-action snapshot to actor even after one-shot snapshot and to joined table members", async () => {
  const secret = "test-secret";
  const actorToken = makeHs256Jwt({ secret, sub: "act_delivery_actor" });
  const otherToken = makeHs256Jwt({ secret, sub: "act_delivery_other" });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret } });

  try {
    await waitForListening(child, 5000);
    const actor = await connectClient(port);
    const other = await connectClient(port);

    await hello(actor);
    await hello(other);
    assert.equal((await auth(actor, actorToken, "req-auth-delivery-actor")).type, "authOk");
    assert.equal((await auth(other, otherToken, "req-auth-delivery-other")).type, "authOk");

    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "req-join-delivery-actor", ts: "2026-02-28T00:03:00Z", payload: { tableId: "table_act_delivery" } });
    assert.equal((await nextMessage(actor)).type, "table_state");
    sendFrame(other, { version: "1.0", type: "table_join", requestId: "req-join-delivery-other", ts: "2026-02-28T00:03:01Z", payload: { tableId: "table_act_delivery" } });
    assert.equal((await nextMessage(other)).type, "table_state");
    assert.equal((await nextMessage(actor)).type, "table_state");

    sendFrame(actor, { version: "1.0", type: "table_state_sub", requestId: "req-delivery-snapshot-before", ts: "2026-02-28T00:03:02Z", payload: { tableId: "table_act_delivery", view: "snapshot" } });
    const before = await nextMessage(actor);

    const otherAfterPromise = nextStateUpdate(other, { baseline: null, timeoutMs: 1500 });

    sendFrame(actor, {
      version: "1.0",
      type: "act",
      requestId: "req-delivery-act-call",
      ts: "2026-02-28T00:03:03Z",
      payload: { tableId: "table_act_delivery", handId: before.payload.public.hand.handId, action: "call", amount: 0 }
    });

    const result = await nextMessage(actor);
    assert.equal(result.type, "commandResult");
    assert.equal(result.payload.status, "accepted");

    const actorAfter = await nextStateUpdate(actor, { baseline: before.payload });
    const otherAfter = await otherAfterPromise;
    assert.equal(actorAfter.frame.type, "stateSnapshot");
    assert.equal(actorAfter.payload.public.hand.status, "FLOP");
    assert.equal(actorAfter.payload.public.board.cards.length, 3);
    assert.deepEqual(actorAfter.payload.public.pot, { total: 4, sidePots: [] });
    assert.deepEqual(otherAfter.payload.public.pot, { total: 4, sidePots: [] });

    actor.close();
    other.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("act duplicate replay is idempotent in-scope and evicted requestIds do not double-apply", async () => {
  const secret = "test-secret";
  const actorToken = makeHs256Jwt({ secret, sub: "act_dup_actor" });
  const otherToken = makeHs256Jwt({ secret, sub: "act_dup_other" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_ACTION_RESULT_CACHE_MAX: "2"
    }
  });

  try {
    await waitForListening(child, 5000);
    const actor = await connectClient(port);
    const other = await connectClient(port);

    await hello(actor);
    await hello(other);
    assert.equal((await auth(actor, actorToken, "req-auth-dup-actor")).type, "authOk");
    assert.equal((await auth(other, otherToken, "req-auth-dup-other")).type, "authOk");

    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "req-join-dup-actor", ts: "2026-02-28T00:04:00Z", payload: { tableId: "table_act_dup" } });
    assert.equal((await nextMessage(actor)).type, "table_state");
    sendFrame(other, { version: "1.0", type: "table_join", requestId: "req-join-dup-other", ts: "2026-02-28T00:04:01Z", payload: { tableId: "table_act_dup" } });
    assert.equal((await nextMessage(other)).type, "table_state");
    assert.equal((await nextMessage(actor)).type, "table_state");

    sendFrame(actor, { version: "1.0", type: "table_state_sub", requestId: "req-snapshot-dup-before", ts: "2026-02-28T00:04:02Z", payload: { tableId: "table_act_dup", view: "snapshot" } });
    const before = await nextMessage(actor);
    const handId = before.payload.public.hand.handId;

    sendFrame(actor, {
      version: "1.0",
      type: "act",
      requestId: "req-act-dup-1",
      ts: "2026-02-28T00:04:03Z",
      payload: { tableId: "table_act_dup", handId, action: "call", amount: 0 }
    });
    const first = await nextMessage(actor);
    const firstSnapshot = await nextStateUpdate(actor, { baseline: before.payload });
    assert.equal(first.type, "commandResult");
    assert.equal(first.payload.status, "accepted");
    await attemptMessage(other, 400);

    sendFrame(actor, {
      version: "1.0",
      type: "act",
      requestId: "req-act-dup-1",
      ts: "2026-02-28T00:04:04Z",
      payload: { tableId: "table_act_dup", handId, action: "call", amount: 0 }
    });
    const duplicate = await nextMessage(actor);
    assert.equal(duplicate.type, "commandResult");
    assert.equal(duplicate.payload.status, "accepted");
    assert.equal((await attemptMessage(actor, 500)), null);
    assert.equal((await attemptMessage(other, 500)), null);

    sendFrame(other, {
      version: "1.0",
      type: "act",
      requestId: "req-act-dup-2",
      ts: "2026-02-28T00:04:05Z",
      payload: { tableId: "table_act_dup", handId, action: "call", amount: 0 }
    });
    const reject2 = await nextMessage(other);
    assert.equal(reject2.type, "commandResult");
    assert.equal(reject2.payload.status, "rejected");

    sendFrame(other, {
      version: "1.0",
      type: "act",
      requestId: "req-act-dup-3",
      ts: "2026-02-28T00:04:06Z",
      payload: { tableId: "table_act_dup", handId, action: "fold", amount: 0 }
    });
    const reject3 = await nextMessage(other);
    assert.equal(reject3.type, "commandResult");
    assert.equal(reject3.payload.status, "rejected");

    sendFrame(actor, {
      version: "1.0",
      type: "act",
      requestId: "req-act-dup-1",
      ts: "2026-02-28T00:04:07Z",
      payload: { tableId: "table_act_dup", handId, action: "call", amount: 0 }
    });
    const evictedReplay = await nextMessage(actor);
    assert.equal(evictedReplay.type, "commandResult");
    assert.equal(evictedReplay.payload.status, "rejected");
    assert.equal((await attemptMessage(other, 500)), null);

    sendFrame(actor, { version: "1.0", type: "table_state_sub", requestId: "req-snapshot-dup-after", ts: "2026-02-28T00:04:08Z", payload: { tableId: "table_act_dup", view: "snapshot" } });
    const after = await nextMessage(actor);
    assert.equal(after.payload.stateVersion, firstSnapshot.payload.stateVersion);

    actor.close();
    other.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("first postflop CHECK keeps same FLOP street and passes turn", async () => {
  const secret = "test-secret";
  const actorToken = makeHs256Jwt({ secret, sub: "flop_check_actor" });
  const otherToken = makeHs256Jwt({ secret, sub: "flop_check_other" });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret } });

  try {
    await waitForListening(child, 5000);
    const actor = await connectClient(port);
    const other = await connectClient(port);

    await hello(actor);
    await hello(other);
    assert.equal((await auth(actor, actorToken, "req-auth-flop-actor")).type, "authOk");
    assert.equal((await auth(other, otherToken, "req-auth-flop-other")).type, "authOk");

    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "req-join-flop-actor", ts: "2026-02-28T00:05:00Z", payload: { tableId: "table_flop_check" } });
    assert.equal((await nextMessage(actor)).type, "table_state");
    sendFrame(other, { version: "1.0", type: "table_join", requestId: "req-join-flop-other", ts: "2026-02-28T00:05:01Z", payload: { tableId: "table_flop_check" } });
    assert.equal((await nextMessage(other)).type, "table_state");
    assert.equal((await nextMessage(actor)).type, "table_state");

    sendFrame(actor, { version: "1.0", type: "table_state_sub", requestId: "req-snap-flop-before", ts: "2026-02-28T00:05:02Z", payload: { tableId: "table_flop_check", view: "snapshot" } });
    const before = await nextMessage(actor);
    const handId = before.payload.public.hand.handId;

    sendFrame(actor, { version: "1.0", type: "act", requestId: "req-pre-close", ts: "2026-02-28T00:05:03Z", payload: { tableId: "table_flop_check", handId, action: "call", amount: 0 } });
    assert.equal((await nextMessage(actor)).type, "commandResult");
    const preActor = await nextStateUpdate(actor, { baseline: before.payload });
    let otherBaseline = null;
    const preOther = await attemptMessage(other, 500);
    if (preOther && (preOther.type === "stateSnapshot" || preOther.type === "statePatch")) {
      otherBaseline = preOther.type === "stateSnapshot" ? preOther.payload : { ...preOther.payload };
    }
    assert.equal(preActor.payload.public.hand.status, "FLOP");
    assert.equal(preActor.payload.public.turn.userId, "flop_check_other");

    sendFrame(other, { version: "1.0", type: "act", requestId: "req-flop-check-1", ts: "2026-02-28T00:05:04Z", payload: { tableId: "table_flop_check", handId, action: "check", amount: 0 } });
    const checkResult = await nextMessageOfType(other, "commandResult");
    const checkOther = await nextStateUpdate(other, { baseline: otherBaseline });

    assert.equal(checkResult.type, "commandResult");
    assert.equal(checkResult.payload.status, "accepted");
    assert.equal(checkOther.payload.public.hand.status, "FLOP");
    assert.equal(checkOther.payload.public.board.cards.length, 3);
    assert.equal(checkOther.payload.public.turn.userId, "flop_check_actor");

    actor.close();
    other.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("river-closing WS action auto-advances to next PREFLOP hand and replay is idempotent", async () => {
  const secret = "test-secret";
  const actorToken = makeHs256Jwt({ secret, sub: "river_close_actor" });
  const otherToken = makeHs256Jwt({ secret, sub: "river_close_other" });
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret } });

  try {
    await waitForListening(child, 5000);
    const actor = await connectClient(port);
    const other = await connectClient(port);

    await hello(actor);
    await hello(other);
    assert.equal((await auth(actor, actorToken, "req-auth-river-actor")).type, "authOk");
    assert.equal((await auth(other, otherToken, "req-auth-river-other")).type, "authOk");

    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "req-join-river-actor", ts: "2026-02-28T00:06:00Z", payload: { tableId: "table_river_close" } });
    assert.equal((await nextMessage(actor)).type, "table_state");
    sendFrame(other, { version: "1.0", type: "table_join", requestId: "req-join-river-other", ts: "2026-02-28T00:06:01Z", payload: { tableId: "table_river_close" } });
    assert.equal((await nextMessage(other)).type, "table_state");
    assert.equal((await nextMessage(actor)).type, "table_state");

    sendFrame(actor, { version: "1.0", type: "table_state_sub", requestId: "req-snap-river-before", ts: "2026-02-28T00:06:02Z", payload: { tableId: "table_river_close", view: "snapshot" } });
    const before = await nextMessage(actor);
    const handId = before.payload.public.hand.handId;

    const baselineByWs = new Map([[actor, before.payload], [other, null]]);

    const act = async (ws, requestId, action) => {
      sendFrame(ws, { version: "1.0", type: "act", requestId, ts: "2026-02-28T00:06:03Z", payload: { tableId: "table_river_close", handId, action, amount: 0 } });
      const result = await nextMessageOfType(ws, "commandResult");
      assert.equal(result.payload.status, "accepted");
      const wsUpdate = await nextStateUpdate(ws, { baseline: baselineByWs.get(ws) });
      baselineByWs.set(ws, wsUpdate.baseline);
      return wsUpdate.payload;
    };

    let snap;
    snap = await act(actor, "req-river-pre-call", "call");
    assert.equal(snap.public.hand.status, "FLOP");

    snap = await act(other, "req-river-flop-1", "check");
    assert.equal(snap.public.hand.status, "FLOP");
    snap = await act(actor, "req-river-flop-2", "check");
    assert.equal(snap.public.hand.status, "TURN");

    snap = await act(other, "req-river-turn-1", "check");
    assert.equal(snap.public.hand.status, "TURN");
    snap = await act(actor, "req-river-turn-2", "check");
    assert.equal(snap.public.hand.status, "RIVER");

    snap = await act(other, "req-river-river-1", "check");
    assert.equal(snap.public.hand.status, "RIVER");
    assert.equal(snap.public.turn.userId, "river_close_actor");

    const finalSnap = await act(actor, "req-river-river-2", "check");
    assert.equal(finalSnap.public.hand.status, "PREFLOP");
    assert.equal(finalSnap.public.board.cards.length, 0);
    assert.equal(finalSnap.public.pot.total, 3);
    assert.equal(typeof finalSnap.public.turn.userId, "string");
    assert.equal("showdown" in finalSnap.public, false);
    assert.equal("handSettlement" in finalSnap.public, false);
    const nextHandId = finalSnap.public.hand.handId;
    assert.equal(typeof nextHandId, "string");

    sendFrame(actor, {
      version: "1.0",
      type: "act",
      requestId: "req-river-river-2",
      ts: "2026-02-28T00:06:04Z",
      payload: { tableId: "table_river_close", handId, action: "check", amount: 0 }
    });
    const replay = await nextMessageOfType(actor, "commandResult");
    assert.equal(replay.payload.status, "accepted");
    assert.equal((await attemptMessage(actor, 500)), null);

    sendFrame(actor, { version: "1.0", type: "table_state_sub", requestId: "req-river-snapshot-after-replay", ts: "2026-02-28T00:06:05Z", payload: { tableId: "table_river_close", view: "snapshot" } });
    const afterReplaySnapshot = await nextMessageOfType(actor, "stateSnapshot");
    assert.equal(afterReplaySnapshot.payload.public.hand.handId, nextHandId);
    assert.equal(afterReplaySnapshot.payload.public.hand.status, "PREFLOP");

    sendFrame(other, {
      version: "1.0",
      type: "act",
      requestId: "req-river-after-settled",
      ts: "2026-02-28T00:06:06Z",
      payload: { tableId: "table_river_close", handId, action: "check", amount: 0 }
    });
    const rejected = await nextMessageOfType(other, "commandResult");
    assert.equal(rejected.payload.status, "rejected");
    assert.equal(rejected.payload.reason, "hand_mismatch");

    assert.equal((await attemptMessage(actor, 500)), null);
    assert.equal((await attemptMessage(other, 500)), null);

    actor.close();
    other.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("server applies due timeout and emits one updated stateSnapshot", async () => {
  const secret = "timeout-secret";
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_POKER_TURN_MS: "600",
      WS_TIMEOUT_SWEEP_MS: "25"
    }
  });

  try {
    await waitForListening(child, 5000);

    const wsA = await connectClient(port);
    const wsB = await connectClient(port);
    await hello(wsA);
    await hello(wsB);

    assert.equal((await auth(wsA, makeHs256Jwt({ secret, sub: "user_a" }), "auth-a")).type, "authOk");
    assert.equal((await auth(wsB, makeHs256Jwt({ secret, sub: "user_b" }), "auth-b")).type, "authOk");

    sendFrame(wsA, { version: "1.0", type: "table_join", requestId: "join-a", ts: "2026-02-28T00:00:02Z", payload: { tableId: "table_timeout_ws" } });
    await nextMessageOfType(wsA, "table_state");

    sendFrame(wsB, { version: "1.0", type: "table_join", requestId: "join-b", ts: "2026-02-28T00:00:03Z", payload: { tableId: "table_timeout_ws" } });
    await nextMessageOfType(wsB, "table_state");
    await nextMessageOfType(wsA, "table_state");

    sendFrame(wsA, { version: "1.0", type: "table_state_sub", requestId: "snap-a", ts: "2026-02-28T00:00:04Z", payload: { tableId: "table_timeout_ws", view: "snapshot" } });
    const baseA = await nextMessageOfType(wsA, "stateSnapshot");

    sendFrame(wsB, { version: "1.0", type: "table_state_sub", requestId: "snap-b", ts: "2026-02-28T00:00:05Z", payload: { tableId: "table_timeout_ws", view: "snapshot" } });
    const baseB = await nextMessageOfType(wsB, "stateSnapshot");

    const timeoutA = (await nextStateUpdate(wsA, { baseline: baseA.payload, timeoutMs: 4000 })).payload;
    const timeoutB = (await nextStateUpdate(wsB, { baseline: baseB.payload, timeoutMs: 4000 })).payload;

    // Periodic timeout sweeps can emit adjacent valid timeout waves while each socket
    // awaits independently, so this test verifies receiver-local timer sanity and
    // progression invariants rather than exact cross-socket timer equality.
    assert.equal(timeoutA.stateVersion > baseA.payload.stateVersion, true);
    assert.equal(timeoutB.stateVersion > baseB.payload.stateVersion, true);
    assert.equal(timeoutA.private.userId, "user_a");
    assert.equal(timeoutB.private.userId, "user_b");
    assert.equal(Number.isFinite(timeoutA.public.turn.startedAt), true);
    assert.equal(Number.isFinite(timeoutA.public.turn.deadlineAt), true);
    assert.equal(timeoutA.public.turn.deadlineAt > timeoutA.public.turn.startedAt, true);
    assert.equal(Number.isFinite(timeoutB.public.turn.startedAt), true);
    assert.equal(Number.isFinite(timeoutB.public.turn.deadlineAt), true);
    assert.equal(timeoutB.public.turn.deadlineAt > timeoutB.public.turn.startedAt, true);
    assert.equal(Array.isArray(timeoutA.private.holeCards), true);
    assert.equal(Array.isArray(timeoutB.private.holeCards), true);
    assert.equal(Object.prototype.hasOwnProperty.call(timeoutA.public, "holeCardsByUserId"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(timeoutB.public, "holeCardsByUserId"), false);


    wsA.close();
    wsB.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("repeated timeout checks do not double-apply the same turn", async () => {
  const secret = "timeout-secret";
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_POKER_TURN_MS: "600",
      WS_TIMEOUT_SWEEP_MS: "20"
    }
  });

  try {
    await waitForListening(child, 5000);

    const wsA = await connectClient(port);
    const wsB = await connectClient(port);
    await hello(wsA);
    await hello(wsB);
    await auth(wsA, makeHs256Jwt({ secret, sub: "user_a" }), "auth-a");
    await auth(wsB, makeHs256Jwt({ secret, sub: "user_b" }), "auth-b");

    sendFrame(wsA, { version: "1.0", type: "table_join", requestId: "join-a", ts: "2026-02-28T00:00:02Z", payload: { tableId: "table_timeout_idempotent" } });
    await nextMessageOfType(wsA, "table_state");
    sendFrame(wsB, { version: "1.0", type: "table_join", requestId: "join-b", ts: "2026-02-28T00:00:03Z", payload: { tableId: "table_timeout_idempotent" } });
    await nextMessageOfType(wsB, "table_state");
    await nextMessageOfType(wsA, "table_state");

    sendFrame(wsA, { version: "1.0", type: "table_state_sub", requestId: "snap-a", ts: "2026-02-28T00:00:04Z", payload: { tableId: "table_timeout_idempotent", view: "snapshot" } });
    const base = await nextMessageOfType(wsA, "stateSnapshot");
    const firstTimeout = (await nextStateUpdate(wsA, { baseline: base.payload, timeoutMs: 4000 })).payload;

    assert.equal(firstTimeout.stateVersion > base.payload.stateVersion, true);

    const noDoubleApply = await attemptMessage(wsA, 200);
    assert.equal(noDoubleApply, null);

    wsA.close();
    wsB.close();
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
    await nextMessageOfType(wsA, "table_state");
    sendFrame(wsA, { version: "1.0", type: "table_state_sub", requestId: "snap-a", ts: "2026-02-28T00:11:02Z", payload: { tableId: "table_same_user", view: "snapshot" } });
    const aSnapshot = await nextMessageOfType(wsA, "stateSnapshot");

    const wsB = await connectClient(port);
    await hello(wsB);
    await auth(wsB, token, "auth-b");
    sendFrame(wsB, { version: "1.0", type: "table_join", requestId: "join-b", ts: "2026-02-28T00:11:03Z", payload: { tableId: "table_same_user" } });
    await nextMessageOfType(wsB, "table_state");
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

    const resumed = await nextMessageOfType(wsAResume, "commandResult");
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

test("server sends stateSnapshot fallback when receiver has no baseline cache", async () => {
  const secret = "snapshot-no-baseline";
  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret } });
  try {
    await waitForListening(child, 5000);
    const actor = await connectClient(port);
    const other = await connectClient(port);
    await hello(actor);
    await hello(other);
    await auth(actor, makeHs256Jwt({ secret, sub: "nobase_actor" }), "auth-nobase-actor");
    await auth(other, makeHs256Jwt({ secret, sub: "nobase_other" }), "auth-nobase-other");

    sendFrame(actor, { version: "1.0", type: "table_join", requestId: "join-na", ts: "2026-02-28T00:13:00Z", payload: { tableId: "table_no_baseline" } });
    await nextMessageOfType(actor, "table_state");
    sendFrame(other, { version: "1.0", type: "table_join", requestId: "join-no", ts: "2026-02-28T00:13:01Z", payload: { tableId: "table_no_baseline" } });
    await nextMessageOfType(other, "table_state");
    await nextMessageOfType(actor, "table_state");

    sendFrame(other, { version: "1.0", type: "table_state_sub", requestId: "snap-no", ts: "2026-02-28T00:13:02Z", payload: { tableId: "table_no_baseline", view: "snapshot" } });
    const otherBaseline = await nextMessageOfType(other, "stateSnapshot");

    const turnUserId = otherBaseline.payload.public.turn.userId;
    const actingWs = turnUserId === "nobase_actor" ? actor : other;
    sendFrame(actingWs, {
      version: "1.0",
      type: "act",
      requestId: "act-no",
      ts: "2026-02-28T00:13:03Z",
      payload: { tableId: "table_no_baseline", handId: otherBaseline.payload.public.hand.handId, action: "call", amount: 0 }
    });

    const actingResult = await nextMessageOfType(actingWs, "commandResult");
    assert.equal(actingResult.payload.status, "accepted");

    const actorUpdate = await nextMessageOfType(actor, "stateSnapshot");
    assert.equal(actorUpdate.type, "stateSnapshot");
    assert.equal(actorUpdate.payload.public.hand.status, "FLOP");

    actor.close();
    other.close();
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
    await nextMessageOfType(wsA, "table_state");
    sendFrame(wsA, { version: "1.0", type: "table_state_sub", requestId: "snap-rsa", ts: "2026-02-28T00:14:01Z", payload: { tableId: "table_resume_scoped", view: "snapshot" } });
    const aBaseline = await nextMessageOfType(wsA, "stateSnapshot");

    const wsB = await connectClient(port);
    await hello(wsB);
    await auth(wsB, token, "auth-rsb");
    sendFrame(wsB, { version: "1.0", type: "table_join", requestId: "join-rsb", ts: "2026-02-28T00:14:02Z", payload: { tableId: "table_resume_scoped" } });
    await nextMessageOfType(wsB, "table_state");

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
