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
