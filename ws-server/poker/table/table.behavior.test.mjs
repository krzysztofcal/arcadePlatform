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
    assert.equal(subState.type, "error");
    assert.equal(subState.payload.code, "TABLE_BOOTSTRAP_UNAVAILABLE");

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
    assert.equal(c1LeaveAck.type, "commandResult");
    assert.equal(c1LeaveAck.payload.status, "rejected");
    assert.equal(await attemptMessage(client2), null);

    sendFrame(client1, {
      version: "1.0",
      type: "table_leave",
      requestId: "req-leave-c1-dup",
      ts: "2026-02-28T00:00:08Z",
      payload: { tableId: "table_A" }
    });

    const c1LeaveDup = await nextMessage(client1, 5000, "c1LeaveDup");
    assert.equal(c1LeaveDup.type, "commandResult");
    assert.equal(c1LeaveDup.payload.status, "rejected");

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
    assert.equal(c3LeaveNoTable.payload.code, "INVALID_ROOM_ID");

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
    assert.deepEqual(c1AfterDisconnect.payload.members, [{ userId: "user_1", seat: 1 }]);

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
    assert.deepEqual(c2bJoinAck.payload.members.map((entry) => entry.userId), ["user_1", "user_2"]);
    assert.deepEqual(c1AfterC2bJoin.payload.members.map((entry) => entry.userId), ["user_1", "user_2"]);

    client1.close();
    client2b.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("roomId-only join alias works and legacy table_join remains compatible", async () => {
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

    const aliasClient = await connectClient(port);
    await hello(aliasClient, "req-hello-alias");
    const aliasToken = makeHs256Jwt({ secret, sub: "user_alias" });
    const aliasAuth = await auth(aliasClient, aliasToken, "req-auth-alias");
    assert.equal(aliasAuth.type, "authOk");

    sendFrame(aliasClient, {
      version: "1.0",
      type: "join",
      roomId: "table_room_id_only",
      requestId: "req-join-alias-roomid-only",
      ts: "2026-02-28T00:10:00Z",
      payload: {}
    });

    const aliasJoin = await nextMessage(aliasClient, 5000, "aliasJoin");
    assert.equal(aliasJoin.type, "table_state");
    assert.equal(aliasJoin.payload.tableId, "table_room_id_only");
    assert.deepEqual(aliasJoin.payload.members.map((entry) => entry.userId), ["user_alias"]);

    sendFrame(aliasClient, {
      version: "1.0",
      type: "table_state_sub",
      roomId: "table_room_id_only",
      requestId: "req-sub-alias-roomid-only",
      ts: "2026-02-28T00:10:01Z",
      payload: {}
    });

    const aliasSub = await nextMessage(aliasClient, 5000, "aliasSub");
    assert.equal(aliasSub.type, "table_state");
    assert.equal(aliasSub.payload.tableId, "table_room_id_only");
    assert.deepEqual(aliasSub.payload.members.map((entry) => entry.userId), ["user_alias"]);

    const legacyClient = await connectClient(port);
    await hello(legacyClient, "req-hello-legacy");
    const legacyToken = makeHs256Jwt({ secret, sub: "user_legacy" });
    const legacyAuth = await auth(legacyClient, legacyToken, "req-auth-legacy");
    assert.equal(legacyAuth.type, "authOk");

    sendFrame(legacyClient, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-legacy-payload-tableid",
      ts: "2026-02-28T00:10:02Z",
      payload: { tableId: "table_legacy" }
    });

    const legacyJoin = await nextMessage(legacyClient, 5000, "legacyJoin");
    assert.equal(legacyJoin.type, "table_state");
    assert.equal(legacyJoin.payload.tableId, "table_legacy");
    assert.deepEqual(legacyJoin.payload.members.map((entry) => entry.userId), ["user_legacy"]);

    aliasClient.close();
    legacyClient.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("conflicting roomId and payload.tableId is rejected deterministically without state mutation", async () => {
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

    const observer = await connectClient(port);
    const actor = await connectClient(port);
    await hello(observer, "req-hello-observer-conflict");
    await hello(actor, "req-hello-actor-conflict");

    const observerToken = makeHs256Jwt({ secret, sub: "user_observer" });
    const actorToken = makeHs256Jwt({ secret, sub: "user_actor" });
    const observerAuth = await auth(observer, observerToken, "req-auth-observer-conflict");
    const actorAuth = await auth(actor, actorToken, "req-auth-actor-conflict");
    assert.equal(observerAuth.type, "authOk");
    assert.equal(actorAuth.type, "authOk");

    sendFrame(observer, {
      version: "1.0",
      type: "table_state_sub",
      roomId: "table_A",
      requestId: "req-sub-observer-conflict",
      ts: "2026-02-28T00:11:00Z",
      payload: {}
    });
    const initialObserverState = await nextMessage(observer, 5000, "initialObserverState");
    assert.equal(initialObserverState.type, "error");
    assert.equal(initialObserverState.payload.code, "TABLE_BOOTSTRAP_UNAVAILABLE");

    sendFrame(actor, {
      version: "1.0",
      type: "join",
      roomId: "table_A",
      requestId: "req-join-conflict",
      ts: "2026-02-28T00:11:01Z",
      payload: { tableId: "table_B" }
    });

    const conflictError = await nextMessage(actor, 5000, "conflictError");
    assert.equal(conflictError.type, "error");
    assert.equal(conflictError.payload.code, "INVALID_ROOM_ID");

    const observerNoBroadcast = await attemptMessage(observer);
    assert.equal(observerNoBroadcast, null);

    sendFrame(observer, {
      version: "1.0",
      type: "table_state_sub",
      roomId: "table_A",
      requestId: "req-sub-observer-conflict-again",
      ts: "2026-02-28T00:11:02Z",
      payload: {}
    });
    const afterConflictObserverState = await nextMessage(observer, 5000, "afterConflictObserverState");
    assert.equal(afterConflictObserverState.type, "error");
    assert.equal(afterConflictObserverState.payload.code, "TABLE_BOOTSTRAP_UNAVAILABLE");

    observer.close();
    actor.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("table_leave without room/table id resolves to joined table", async () => {
  const secret = "test-secret";
  const override = JSON.stringify({
    ok: true,
    tableId: "table_leave_implicit",
    state: {
      version: 5,
      state: {
        tableId: "table_leave_implicit",
        seats: []
      }
    }
  });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PRESENCE_TTL_MS: "0",
      WS_TEST_LEAVE_RESULT_JSON: override
    }
  });

  try {
    await waitForListening(child, 5000);

    const leaver = await connectClient(port);
    const observer = await connectClient(port);

    await hello(leaver, "req-hello-leaver");
    await hello(observer, "req-hello-observer-leave");

    const leaverAuth = await auth(leaver, makeHs256Jwt({ secret, sub: "user_leaver" }), "req-auth-leaver");
    const observerAuth = await auth(observer, makeHs256Jwt({ secret, sub: "user_observer_leave" }), "req-auth-observer-leave");
    assert.equal(leaverAuth.type, "authOk");
    assert.equal(observerAuth.type, "authOk");

    sendFrame(observer, {
      version: "1.0",
      type: "table_state_sub",
      roomId: "table_leave_implicit",
      requestId: "req-sub-observer-leave",
      ts: "2026-02-28T00:12:00Z",
      payload: {}
    });
    const observerInitial = await nextMessage(observer, 5000, "observerInitial");
    assert.equal(observerInitial.type, "error");
    assert.equal(observerInitial.payload.code, "TABLE_BOOTSTRAP_UNAVAILABLE");

    sendFrame(leaver, {
      version: "1.0",
      type: "table_join",
      roomId: "table_leave_implicit",
      requestId: "req-join-leaver",
      ts: "2026-02-28T00:12:01Z",
      payload: {}
    });

    const leaverJoinAck = await nextMessage(leaver, 5000, "leaverJoinAck");
    assert.equal(leaverJoinAck.type, "table_state");
    assert.deepEqual(leaverJoinAck.payload.members.map((entry) => entry.userId), ["user_leaver"]);

    sendFrame(observer, {
      version: "1.0",
      type: "table_state_sub",
      roomId: "table_leave_implicit",
      requestId: "req-sub-observer-leave-after-join",
      ts: "2026-02-28T00:12:01Z",
      payload: {}
    });

    const observerAfterJoin = await nextMessage(observer, 5000, "observerAfterJoin");
    assert.equal(observerAfterJoin.type, "table_state");
    assert.deepEqual(observerAfterJoin.payload.members.map((entry) => entry.userId), ["user_leaver"]);

    sendFrame(leaver, {
      version: "1.0",
      type: "table_leave",
      requestId: "req-leave-implicit",
      ts: "2026-02-28T00:12:02Z",
      payload: {}
    });

    const leaverLeaveAck = await nextMessage(leaver, 5000, "leaverLeaveAck");
    assert.equal(leaverLeaveAck.type, "commandResult");
    assert.equal(leaverLeaveAck.payload.status, "accepted");

    const observerAfterLeaveFirst = await nextMessage(observer, 5000, "observerAfterLeaveFirst");
    const observerAfterLeave = observerAfterLeaveFirst.type === "table_state"
      ? observerAfterLeaveFirst
      : await nextMessage(observer, 5000, "observerAfterLeave");
    assert.equal(observerAfterLeave.type, "table_state");
    assert.deepEqual(observerAfterLeave.payload.members, []);

    leaver.close();
    observer.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("table_leave without room/table id fails deterministically when not joined and does not broadcast", async () => {
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

    const actor = await connectClient(port);
    const observer = await connectClient(port);
    await hello(actor, "req-hello-actor-leave-not-joined");
    await hello(observer, "req-hello-observer-leave-not-joined");

    const actorAuth = await auth(actor, makeHs256Jwt({ secret, sub: "user_actor_leave_not_joined" }), "req-auth-actor-leave-not-joined");
    const observerAuth = await auth(observer, makeHs256Jwt({ secret, sub: "user_observer_leave_not_joined" }), "req-auth-observer-leave-not-joined");
    assert.equal(actorAuth.type, "authOk");
    assert.equal(observerAuth.type, "authOk");

    sendFrame(observer, {
      version: "1.0",
      type: "table_state_sub",
      roomId: "table_leave_not_joined",
      requestId: "req-sub-observer-leave-not-joined",
      ts: "2026-02-28T00:13:00Z",
      payload: {}
    });
    await nextMessage(observer, 5000, "observerInitLeaveNotJoined");

    sendFrame(actor, {
      version: "1.0",
      type: "table_leave",
      requestId: "req-leave-not-joined",
      ts: "2026-02-28T00:13:01Z",
      payload: {}
    });

    const leaveError = await nextMessage(actor, 5000, "leaveErrorNotJoined");
    assert.equal(leaveError.type, "error");
    assert.equal(leaveError.payload.code, "INVALID_ROOM_ID");

    const actorNoExtra = await attemptMessage(actor);
    const observerNoBroadcast = await attemptMessage(observer);
    assert.equal(actorNoExtra, null);
    assert.equal(observerNoBroadcast, null);

    actor.close();
    observer.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("missing requestId on join is rejected with INVALID_COMMAND and does not mutate membership", async () => {
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

    const client = await connectClient(port);
    await hello(client, "req-hello-missing-requestid");
    const authResp = await auth(client, makeHs256Jwt({ secret, sub: "user_missing_requestid" }), "req-auth-missing-requestid");
    assert.equal(authResp.type, "authOk");

    sendFrame(client, {
      version: "1.0",
      type: "join",
      roomId: "table_reqid",
      ts: "2026-02-28T00:14:00Z",
      payload: {}
    });

    const missingRequestIdError = await nextMessage(client, 5000, "missingRequestIdError");
    assert.equal(missingRequestIdError.type, "error");
    assert.equal(missingRequestIdError.payload.code, "INVALID_COMMAND");

    sendFrame(client, {
      version: "1.0",
      type: "table_state_sub",
      roomId: "table_reqid",
      requestId: "req-sub-after-missing-requestid",
      ts: "2026-02-28T00:14:01Z",
      payload: {}
    });

    const stateAfterRejectedJoin = await nextMessage(client, 5000, "stateAfterRejectedJoin");
    assert.equal(stateAfterRejectedJoin.type, "error");
    assert.equal(stateAfterRejectedJoin.payload.code, "TABLE_BOOTSTRAP_UNAVAILABLE");

    client.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("table_join is idempotent by requestId and preserves a single seat-bearing member", async () => {
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

    const client = await connectClient(port);
    await hello(client, "req-hello-idempotent");
    const authResp = await auth(client, makeHs256Jwt({ secret, sub: "user_idempotent" }), "req-auth-idempotent");
    assert.equal(authResp.type, "authOk");

    const joinFrame = {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-same-id",
      ts: "2026-02-28T00:15:00Z",
      payload: { tableId: "table_idempotent" }
    };

    sendFrame(client, joinFrame);
    const firstJoin = await nextMessage(client, 5000, "firstJoinSameRequestId");
    assert.equal(firstJoin.type, "table_state");
    assert.deepEqual(firstJoin.payload.members, [{ userId: "user_idempotent", seat: 1 }]);

    sendFrame(client, joinFrame);
    const secondJoin = await nextMessage(client, 5000, "secondJoinSameRequestId");
    assert.equal(secondJoin.type, "table_state");
    assert.deepEqual(secondJoin.payload.members, [{ userId: "user_idempotent", seat: 1 }]);

    const noExtra = await attemptMessage(client);
    assert.equal(noExtra, null);

    client.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("join rejects with bounds_exceeded when table is full and does not mutate membership", async () => {
  const secret = "test-secret";
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PRESENCE_TTL_MS: "0",
      WS_MAX_SEATS: "1"
    }
  });

  try {
    await waitForListening(child, 5000);

    const userA = await connectClient(port);
    const userB = await connectClient(port);

    await hello(userA, "req-hello-userA-bounds");
    await hello(userB, "req-hello-userB-bounds");

    const userAAuth = await auth(userA, makeHs256Jwt({ secret, sub: "user_A" }), "req-auth-userA-bounds");
    const userBAuth = await auth(userB, makeHs256Jwt({ secret, sub: "user_B" }), "req-auth-userB-bounds");
    assert.equal(userAAuth.type, "authOk");
    assert.equal(userBAuth.type, "authOk");

    sendFrame(userA, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-userA-bounds",
      ts: "2026-02-28T00:16:00Z",
      payload: { tableId: "table_bounds" }
    });

    const userAJoin = await nextMessage(userA, 5000, "userAJoinBounds");
    assert.equal(userAJoin.type, "table_state");
    assert.deepEqual(userAJoin.payload.members, [{ userId: "user_A", seat: 1 }]);

    sendFrame(userB, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-userB-bounds",
      ts: "2026-02-28T00:16:01Z",
      payload: { tableId: "table_bounds" }
    });

    const userBError = await nextMessage(userB, 5000, "userBJoinBoundsError");
    assert.equal(userBError.type, "error");
    assert.equal(userBError.payload.code, "bounds_exceeded");

    sendFrame(userB, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-userB-bounds",
      ts: "2026-02-28T00:16:02Z",
      payload: { tableId: "table_bounds" }
    });

    const stableState = await nextMessage(userB, 5000, "stableStateAfterBoundsError");
    assert.equal(stableState.type, "table_state");
    assert.deepEqual(stableState.payload.members, [{ userId: "user_A", seat: 1 }]);

    userA.close();
    userB.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("WS_MAX_SEATS above core limit is clamped and does not brick table_join", async () => {
  const secret = "test-secret";
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PRESENCE_TTL_MS: "0",
      WS_MAX_SEATS: "11"
    }
  });

  try {
    await waitForListening(child, 5000);

    const client = await connectClient(port);
    await hello(client, "req-hello-max-seats-clamp");
    const authResp = await auth(client, makeHs256Jwt({ secret, sub: "user_clamp" }), "req-auth-max-seats-clamp");
    assert.equal(authResp.type, "authOk");

    sendFrame(client, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-max-seats-clamp",
      ts: "2026-02-28T00:17:00Z",
      payload: { tableId: "table_clamp" }
    });

    const joinAck = await nextMessage(client, 5000, "joinAckMaxSeatsClamp");
    assert.equal(joinAck.type, "table_state");
    assert.deepEqual(joinAck.payload.members, [{ userId: "user_clamp", seat: 1 }]);

    client.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("clamped max seats enforces bounds at 10 when WS_MAX_SEATS is 999", async () => {
  const secret = "test-secret";
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PRESENCE_TTL_MS: "0",
      WS_MAX_SEATS: "999"
    }
  });

  try {
    await waitForListening(child, 5000);

    const tableId = "table_clamp_999";
    const clients = [];

    for (let index = 1; index <= 11; index += 1) {
      const client = await connectClient(port);
      clients.push(client);
      await hello(client, `req-hello-clamp-999-${index}`);
      const authResp = await auth(client, makeHs256Jwt({ secret, sub: `user_clamp_999_${index}` }), `req-auth-clamp-999-${index}`);
      assert.equal(authResp.type, "authOk");

      sendFrame(client, {
        version: "1.0",
        type: "table_join",
        requestId: `req-join-clamp-999-${index}`,
        ts: "2026-02-28T00:18:00Z",
        payload: { tableId }
      });

      const joinResponse = await nextMessage(client, 5000, `joinResponseClamp999-${index}`);
      if (index <= 10) {
        assert.equal(joinResponse.type, "table_state");
        assert.equal(joinResponse.payload.members.length, index);
      } else {
        assert.equal(joinResponse.type, "error");
        assert.equal(joinResponse.payload.code, "bounds_exceeded");
      }
    }

    const observer = clients[10];
    sendFrame(observer, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-clamp-999-after-failed-join",
      ts: "2026-02-28T00:18:01Z",
      payload: { tableId }
    });

    const stableState = await nextMessage(observer, 5000, "stableStateClamp999");
    assert.equal(stableState.type, "table_state");
    assert.equal(stableState.payload.members.length, 10);

    for (const client of clients) {
      client.close();
    }
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("table_leave is idempotent by requestId and does not mutate state on replay", async () => {
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

    const client = await connectClient(port);
    await hello(client, "req-hello-leave-idempotent");
    const authResp = await auth(client, makeHs256Jwt({ secret, sub: "user_leave_idempotent" }), "req-auth-leave-idempotent");
    assert.equal(authResp.type, "authOk");

    sendFrame(client, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-leave-idempotent",
      ts: "2026-02-28T00:19:00Z",
      payload: { tableId: "table_leave_idempotent" }
    });

    const joinAck = await nextMessage(client, 5000, "joinAckLeaveIdempotent");
    assert.equal(joinAck.type, "table_state");
    assert.deepEqual(joinAck.payload.members, [{ userId: "user_leave_idempotent", seat: 1 }]);

    const leaveFrame = {
      version: "1.0",
      type: "table_leave",
      requestId: "req-leave-same-id",
      ts: "2026-02-28T00:19:01Z",
      payload: { tableId: "table_leave_idempotent" }
    };

    sendFrame(client, leaveFrame);
    const firstLeave = await nextMessage(client, 5000, "firstLeaveSameRequestId");
    assert.equal(firstLeave.type, "commandResult");
    assert.equal(firstLeave.payload.status, "rejected");

    sendFrame(client, leaveFrame);
    const secondLeave = await nextMessage(client, 5000, "secondLeaveSameRequestId");
    assert.equal(secondLeave.type, "commandResult");
    assert.equal(secondLeave.payload.status, "rejected");

    const noExtra = await attemptMessage(client);
    assert.equal(noExtra, null);

    client.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});
