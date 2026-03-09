import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

function waitSocketClose(ws, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      ws.off("close", onClose);
      ws.off("error", onError);
      reject(new Error("Timed out waiting for websocket close"));
    }, timeoutMs);

    const onClose = () => {
      clearTimeout(timer);
      ws.off("error", onError);
      resolve();
    };

    const onError = (error) => {
      clearTimeout(timer);
      ws.off("close", onClose);
      reject(error);
    };

    ws.once("close", onClose);
    ws.once("error", onError);
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

function sendFrame(ws, frame) {
  ws.send(JSON.stringify(frame));
}


async function writePersistedFile(fixture) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-resync-persist-"));
  const filePath = path.join(dir, "persisted-state.json");
  await fs.writeFile(filePath, `${JSON.stringify(fixture)}
`, "utf8");
  return { dir, filePath };
}

async function nextMessageOfType(ws, type, { timeoutMs = 5000, skipTypes = [] } = {}) {
  const started = Date.now();
  while (true) {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) {
      throw new Error(`Timed out waiting for message type: ${type}`);
    }
    const frame = await nextMessage(ws, remaining, `nextMessageOfType(${type})`);
    if (frame?.type === type) {
      return frame;
    }
    if (skipTypes.includes(frame?.type)) {
      continue;
    }
    throw new Error(`Unexpected frame while waiting for ${type}: ${frame?.type || "unknown"}`);
  }
}

function waitBeyondTtl(ttlMs, bufferMs = 250) {
  return new Promise((resolve) => setTimeout(resolve, ttlMs + bufferMs));
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


async function subscribeTableState(ws, tableId, requestId, ts, label) {
  sendFrame(ws, {
    version: "1.0",
    type: "table_state_sub",
    requestId,
    ts,
    payload: { tableId }
  });
  return nextMessage(ws, 5000, label);
}


test("resync restores presence and seat without duplicates", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_1" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PRESENCE_TTL_MS: "10000"
    }
  });

  try {
    await waitForListening(child, 5000);

    const client1 = await connectClient(port);
    await hello(client1, "req-hello-c1");
    const auth1 = await auth(client1, token, "req-auth-c1");
    assert.equal(auth1.type, "authOk");

    sendFrame(client1, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-c1",
      ts: "2026-02-28T00:00:02Z",
      payload: { tableId: "table_reconnect" }
    });

    const joined = await nextMessage(client1, 5000, "joinAck");
    assert.equal(joined.type, "table_state");
    assert.equal(joined.payload.members.length, 1);
    const beforeSeat = joined.payload.members[0].seat;

    client1.close();

    const client2 = await connectClient(port);
    await hello(client2, "req-hello-c2");
    const auth2 = await auth(client2, token, "req-auth-c2");
    assert.equal(auth2.type, "authOk");

    sendFrame(client2, {
      version: "1.0",
      type: "resync",
      requestId: "req-resync-c2",
      ts: "2026-02-28T00:00:03Z",
      payload: { tableId: "table_reconnect" }
    });

    const resynced = await nextMessage(client2, 5000, "resyncState");
    assert.equal(resynced.type, "table_state");
    assert.equal(resynced.payload.members.length, 1);
    assert.equal(resynced.payload.members[0].userId, "user_1");
    assert.equal(resynced.payload.members[0].seat, beforeSeat);
    assert.deepEqual(resynced.payload.members, [{ userId: "user_1", seat: beforeSeat }]);

    const noExtraFrames = await attemptMessage(client2);
    assert.equal(noExtraFrames, null);

    client2.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("resync accepts roomId without payload.tableId", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_roomid" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PRESENCE_TTL_MS: "10000"
    }
  });

  try {
    await waitForListening(child, 5000);

    const client1 = await connectClient(port);
    await hello(client1, "req-hello-roomid-c1");
    const auth1 = await auth(client1, token, "req-auth-roomid-c1");
    assert.equal(auth1.type, "authOk");

    sendFrame(client1, {
      version: "1.0",
      type: "table_join",
      roomId: "table_roomid_resync",
      requestId: "req-join-roomid-c1",
      ts: "2026-02-28T00:00:20Z",
      payload: {}
    });
    const joined = await nextMessage(client1, 5000, "join-roomid-c1");
    assert.equal(joined.type, "table_state");
    assert.equal(joined.payload.tableId, "table_roomid_resync");

    client1.close();

    const client2 = await connectClient(port);
    await hello(client2, "req-hello-roomid-c2");
    const auth2 = await auth(client2, token, "req-auth-roomid-c2");
    assert.equal(auth2.type, "authOk");

    sendFrame(client2, {
      version: "1.0",
      type: "resync",
      roomId: "table_roomid_resync",
      requestId: "req-resync-roomid-c2",
      ts: "2026-02-28T00:00:21Z",
      payload: {}
    });
    const resynced = await nextMessage(client2, 5000, "resync-roomid-c2");
    assert.equal(resynced.type, "table_state");
    assert.equal(resynced.payload.tableId, "table_roomid_resync");
    assert.equal(resynced.payload.members.length, 1);
    assert.equal(resynced.payload.members[0].userId, "user_roomid");

    client2.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("expired disconnected presence is removed after TTL", async () => {
  const secret = "test-secret";
  const token1 = makeHs256Jwt({ secret, sub: "user_1" });
  const token2 = makeHs256Jwt({ secret, sub: "user_2" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PRESENCE_TTL_MS: "50"
    }
  });

  try {
    await waitForListening(child, 5000);

    const player = await connectClient(port);
    await hello(player, "req-hello-player");
    await auth(player, token1, "req-auth-player");

    sendFrame(player, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-player",
      ts: "2026-02-28T00:00:10Z",
      payload: { tableId: "table_ttl" }
    });
    await nextMessage(player, 5000, "joinPlayer");
    player.close();

    await waitBeyondTtl(50);

    const observer = await connectClient(port);
    await hello(observer, "req-hello-observer");
    await auth(observer, token2, "req-auth-observer");

    const firstState = await subscribeTableState(observer, "table_ttl", "req-sub-observer", "2026-02-28T00:00:11Z", "observerStateFirst");
    assert.equal(firstState.type, "table_state");

    const secondState = await subscribeTableState(
      observer,
      "table_ttl",
      "req-sub-observer-again",
      "2026-02-28T00:00:12Z",
      "observerStateSecond"
    );
    assert.equal(secondState.type, "table_state");
    assert.deepEqual(secondState.payload.members, []);

    observer.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("auth-only socket does not keep presence for the table", async () => {
  const secret = "test-secret";
  const token1 = makeHs256Jwt({ secret, sub: "user_1" });
  const token2 = makeHs256Jwt({ secret, sub: "user_2" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PRESENCE_TTL_MS: "50"
    }
  });

  try {
    await waitForListening(child, 5000);

    const socketA = await connectClient(port);
    await hello(socketA, "req-hello-a");
    await auth(socketA, token1, "req-auth-a");
    sendFrame(socketA, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-a",
      ts: "2026-02-28T00:01:00Z",
      payload: { tableId: "table_multi" }
    });
    await nextMessage(socketA, 5000, "joinA");

    const socketB = await connectClient(port);
    await hello(socketB, "req-hello-b");
    await auth(socketB, token1, "req-auth-b");

    socketA.close();
    await waitBeyondTtl(50);

    const observer = await connectClient(port);
    await hello(observer, "req-hello-observer-multi-1");
    await auth(observer, token2, "req-auth-observer-multi-1");
    const firstState = await subscribeTableState(
      observer,
      "table_multi",
      "req-sub-observer-multi-1",
      "2026-02-28T00:01:01Z",
      "observerStateMulti1First"
    );
    assert.equal(firstState.type, "table_state");

    const secondState = await subscribeTableState(
      observer,
      "table_multi",
      "req-sub-observer-multi-1-again",
      "2026-02-28T00:01:02Z",
      "observerStateMulti1Second"
    );
    assert.equal(secondState.type, "table_state");
    assert.deepEqual(secondState.payload.members, []);

    socketB.close();
    observer.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("table-associated socket keeps presence for the table", async () => {
  const secret = "test-secret";
  const token1 = makeHs256Jwt({ secret, sub: "user_1" });
  const token2 = makeHs256Jwt({ secret, sub: "user_2" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PRESENCE_TTL_MS: "50"
    }
  });

  try {
    await waitForListening(child, 5000);

    const socketA = await connectClient(port);
    await hello(socketA, "req-hello-a2");
    await auth(socketA, token1, "req-auth-a2");
    sendFrame(socketA, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-a2",
      ts: "2026-02-28T00:02:00Z",
      payload: { tableId: "table_multi" }
    });
    const joinA = await nextMessage(socketA, 5000, "joinA2");
    const originalSeat = joinA.payload.members[0].seat;

    const socketB = await connectClient(port);
    await hello(socketB, "req-hello-b2");
    await auth(socketB, token1, "req-auth-b2");
    sendFrame(socketB, {
      version: "1.0",
      type: "resync",
      requestId: "req-resync-b2",
      ts: "2026-02-28T00:02:01Z",
      payload: { tableId: "table_multi" }
    });
    const resyncB = await nextMessage(socketB, 5000, "resyncB2");
    assert.equal(resyncB.payload.members.length, 1);
    assert.equal(resyncB.payload.members[0].seat, originalSeat);

    socketA.close();
    await waitBeyondTtl(50);

    const observer = await connectClient(port);
    await hello(observer, "req-hello-observer-multi-2");
    await auth(observer, token2, "req-auth-observer-multi-2");
    const firstState = await subscribeTableState(
      observer,
      "table_multi",
      "req-sub-observer-multi-2",
      "2026-02-28T00:02:02Z",
      "observerStateMulti2First"
    );
    assert.equal(firstState.type, "table_state");

    const secondState = await subscribeTableState(
      observer,
      "table_multi",
      "req-sub-observer-multi-2-again",
      "2026-02-28T00:02:03Z",
      "observerStateMulti2Second"
    );
    assert.equal(secondState.type, "table_state");
    assert.equal(secondState.payload.members.length, 1);
    assert.equal(secondState.payload.members[0].userId, "user_1");
    assert.equal(secondState.payload.members[0].seat, originalSeat);

    socketB.close();
    observer.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("disconnect with ttl>0 broadcasts removal to existing subscribers", async () => {
  const secret = "test-secret";
  const token1 = makeHs256Jwt({ secret, sub: "user_1" });
  const token2 = makeHs256Jwt({ secret, sub: "user_2" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PRESENCE_TTL_MS: "50"
    }
  });

  try {
    await waitForListening(child, 5000);

    const player = await connectClient(port);
    await hello(player, "req-hello-broadcast-player");
    await auth(player, token1, "req-auth-broadcast-player");
    sendFrame(player, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-broadcast-player",
      ts: "2026-02-28T00:02:30Z",
      payload: { tableId: "table_broadcast_ttl" }
    });
    await nextMessage(player, 5000, "join-broadcast-player");

    const observer = await connectClient(port);
    await hello(observer, "req-hello-broadcast-observer");
    await auth(observer, token2, "req-auth-broadcast-observer");
    const initialState = await subscribeTableState(
      observer,
      "table_broadcast_ttl",
      "req-sub-broadcast-observer",
      "2026-02-28T00:02:31Z",
      "initial-broadcast-state"
    );
    assert.equal(initialState.type, "table_state");
    assert.equal(initialState.payload.members.length, 1);
    assert.equal(initialState.payload.members[0].userId, "user_1");

    const disconnectUpdatePromise = nextMessage(observer, 5000, "disconnect-broadcast-update");
    player.close();
    await waitSocketClose(player);

    const disconnectUpdate = await disconnectUpdatePromise;
    assert.equal(disconnectUpdate.type, "table_state");
    assert.equal(disconnectUpdate.payload.tableId, "table_broadcast_ttl");
    assert.deepEqual(disconnectUpdate.payload.members, []);

    observer.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("sweep removes multiple expired members in one pass", async () => {
  const secret = "test-secret";
  const users = ["user_1", "user_2", "user_3"];
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PRESENCE_TTL_MS: "50"
    }
  });

  try {
    await waitForListening(child, 5000);

    const sockets = [];
    for (const userId of users) {
      const ws = await connectClient(port);
      sockets.push(ws);
      await hello(ws, `req-hello-${userId}`);
      await auth(ws, makeHs256Jwt({ secret, sub: userId }), `req-auth-${userId}`);
      sendFrame(ws, {
        version: "1.0",
        type: "table_join",
        requestId: `req-join-${userId}`,
        ts: "2026-02-28T00:03:00Z",
        payload: { tableId: "table_sweep_multi" }
      });
      await nextMessage(ws, 5000, `join-${userId}`);
    }

    for (const ws of sockets) {
      ws.close();
    }

    await waitBeyondTtl(50);

    const observer = await connectClient(port);
    await hello(observer, "req-hello-observer-sweep");
    await auth(observer, makeHs256Jwt({ secret, sub: "observer" }), "req-auth-observer-sweep");
    sendFrame(observer, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-observer-sweep",
      ts: "2026-02-28T00:03:01Z",
      payload: { tableId: "table_sweep_multi" }
    });

    const state = await nextMessage(observer, 5000, "observer-state-sweep");
    assert.equal(state.type, "table_state");
    assert.deepEqual(state.payload.members, []);

    sendFrame(observer, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-observer-sweep-again",
      ts: "2026-02-28T00:03:02Z",
      payload: { tableId: "table_sweep_multi" }
    });
    const stateAgain = await nextMessage(observer, 5000, "observer-state-sweep-again");
    assert.equal(stateAgain.type, "table_state");
    assert.deepEqual(stateAgain.payload.members, []);

    observer.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("ttl=0 removes presence immediately on disconnect", async () => {
  const secret = "test-secret";
  const token1 = makeHs256Jwt({ secret, sub: "user_1" });
  const token2 = makeHs256Jwt({ secret, sub: "user_2" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PRESENCE_TTL_MS: "0"
    }
  });

  try {
    await waitForListening(child, 5000);

    const player = await connectClient(port);
    await hello(player, "req-hello-ttl0-player");
    await auth(player, token1, "req-auth-ttl0-player");
    sendFrame(player, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-ttl0-player",
      ts: "2026-02-28T00:04:00Z",
      payload: { tableId: "table_ttl_zero" }
    });
    await nextMessage(player, 5000, "join-ttl0-player");
    player.close();
    await waitSocketClose(player);

    const observer = await connectClient(port);
    await hello(observer, "req-hello-ttl0-observer");
    await auth(observer, token2, "req-auth-ttl0-observer");
    const state = await subscribeTableState(
      observer,
      "table_ttl_zero",
      "req-sub-ttl0-observer",
      "2026-02-28T00:04:01Z",
      "observerStateTtl0"
    );

    assert.equal(state.type, "table_state");
    assert.deepEqual(state.payload.members, []);

    observer.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("resume replays only missing frames when lastSeq is in window", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_resume_ok" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PRESENCE_TTL_MS: "10000"
    }
  });

  try {
    await waitForListening(child, 5000);

    const client1 = await connectClient(port);
    await hello(client1, "req-hello-resume-ok-c1");
    const auth1 = await auth(client1, token, "req-auth-resume-ok-c1");
    assert.equal(auth1.type, "authOk");
    const sessionId = auth1.payload.sessionId;

    sendFrame(client1, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-resume-ok-c1",
      ts: "2026-02-28T00:05:00Z",
      payload: { tableId: "table_resume_ok" }
    });
    const seq1 = await nextMessage(client1, 5000, "resume-ok-seq1");
    assert.equal(seq1.type, "table_state");
    assert.equal(typeof seq1.seq, "number");

    sendFrame(client1, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-resume-ok-c1",
      ts: "2026-02-28T00:05:01Z",
      payload: { tableId: "table_resume_ok" }
    });
    const seq2 = await nextMessage(client1, 5000, "resume-ok-seq2");
    assert.equal(seq2.type, "table_state");
    assert.equal(seq2.seq, seq1.seq + 1);

    client1.close();
    await waitSocketClose(client1);

    const client2 = await connectClient(port);
    await hello(client2, "req-hello-resume-ok-c2");
    const auth2 = await auth(client2, token, "req-auth-resume-ok-c2");
    assert.equal(auth2.type, "authOk");

    sendFrame(client2, {
      version: "1.0",
      type: "resume",
      roomId: "table_resume_ok",
      requestId: "req-resume-ok-c2",
      ts: "2026-02-28T00:05:02Z",
      payload: { tableId: "table_resume_ok", sessionId, lastSeq: seq1.seq }
    });

    const replayed = await nextMessage(client2, 5000, "resume-ok-replayed");
    assert.equal(replayed.type, "table_state");
    assert.equal(replayed.seq, seq2.seq);
    assert.equal(replayed.payload.tableId, "table_resume_ok");

    const noExtra = await attemptMessage(client2);
    assert.equal(noExtra, null);

    client2.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("resume with lastSeq at head returns explicit deterministic success", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_resume_head" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PRESENCE_TTL_MS: "10000"
    }
  });

  try {
    await waitForListening(child, 5000);

    const client1 = await connectClient(port);
    await hello(client1, "req-hello-resume-head-c1");
    const auth1 = await auth(client1, token, "req-auth-resume-head-c1");
    const sessionId = auth1.payload.sessionId;

    sendFrame(client1, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-resume-head-c1",
      ts: "2026-02-28T00:05:30Z",
      payload: { tableId: "table_resume_head" }
    });
    const seq1 = await nextMessage(client1, 5000, "resume-head-seq1");

    sendFrame(client1, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "req-sub-resume-head-c1",
      ts: "2026-02-28T00:05:31Z",
      payload: { tableId: "table_resume_head" }
    });
    const seq2 = await nextMessage(client1, 5000, "resume-head-seq2");
    assert.equal(seq2.seq, seq1.seq + 1);

    client1.close();
    await waitSocketClose(client1);

    const client2 = await connectClient(port);
    await hello(client2, "req-hello-resume-head-c2");
    await auth(client2, token, "req-auth-resume-head-c2");

    sendFrame(client2, {
      version: "1.0",
      type: "resume",
      roomId: "table_resume_head",
      requestId: "req-resume-head-c2",
      ts: "2026-02-28T00:05:32Z",
      payload: { tableId: "table_resume_head", sessionId, lastSeq: seq2.seq }
    });

    const ack = await nextMessage(client2, 5000, "resume-head-ack");
    assert.equal(ack.type, "commandResult");
    assert.equal(ack.payload.status, "accepted");
    assert.equal(ack.payload.reason, null);
    assert.equal(ack.requestId, "req-resume-head-c2");

    const noExtra = await attemptMessage(client2);
    assert.equal(noExtra, null);

    client2.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("resume with unknown sessionId returns explicit resync outcome", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_resume_unknown" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret
    }
  });

  try {
    await waitForListening(child, 5000);

    const ws = await connectClient(port);
    await hello(ws, "req-hello-resume-unknown");
    await auth(ws, token, "req-auth-resume-unknown");

    sendFrame(ws, {
      version: "1.0",
      type: "resume",
      roomId: "table_resume_unknown",
      requestId: "req-resume-unknown",
      ts: "2026-02-28T00:06:00Z",
      payload: { tableId: "table_resume_unknown", sessionId: "sess_missing", lastSeq: 0 }
    });

    const outcome = await nextMessage(ws, 5000, "resume-unknown-outcome");
    assert.equal(outcome.type, "resync");
    assert.equal(outcome.roomId, "table_resume_unknown");
    assert.equal(outcome.payload.mode, "required");
    assert.equal(outcome.payload.reason, "unknown_session");
    assert.equal(typeof outcome.payload.expectedSeq, "number");

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("resume rejects same sessionId for different authenticated user", async () => {
  const secret = "test-secret";
  const token1 = makeHs256Jwt({ secret, sub: "user_resume_owner" });
  const token2 = makeHs256Jwt({ secret, sub: "user_resume_other" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret
    }
  });

  try {
    await waitForListening(child, 5000);

    const owner = await connectClient(port);
    await hello(owner, "req-hello-resume-owner");
    const ownerAuth = await auth(owner, token1, "req-auth-resume-owner");
    const ownerSessionId = ownerAuth.payload.sessionId;

    owner.close();
    await waitSocketClose(owner);

    const other = await connectClient(port);
    await hello(other, "req-hello-resume-other");
    await auth(other, token2, "req-auth-resume-other");

    sendFrame(other, {
      version: "1.0",
      type: "resume",
      roomId: "table_resume_cross_user",
      requestId: "req-resume-cross-user",
      ts: "2026-02-28T00:07:00Z",
      payload: { tableId: "table_resume_cross_user", sessionId: ownerSessionId, lastSeq: 0 }
    });

    const outcome = await nextMessage(other, 5000, "resume-cross-user-outcome");
    assert.equal(outcome.type, "resync");
    assert.equal(outcome.payload.mode, "required");
    assert.equal(outcome.payload.reason, "session_user_mismatch");

    other.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("resume with stale lastSeq outside replay window returns deterministic resync", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_resume_stale" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_STREAM_REPLAY_CAP: "8"
    }
  });

  try {
    await waitForListening(child, 5000);

    const client1 = await connectClient(port);
    await hello(client1, "req-hello-resume-stale-c1");
    const auth1 = await auth(client1, token, "req-auth-resume-stale-c1");
    const sessionId = auth1.payload.sessionId;

    sendFrame(client1, {
      version: "1.0",
      type: "table_join",
      requestId: "req-join-resume-stale-c1",
      ts: "2026-02-28T00:08:00Z",
      payload: { tableId: "table_resume_stale" }
    });
    await nextMessage(client1, 5000, "resume-stale-seed");

    for (let idx = 0; idx < 24; idx += 1) {
      sendFrame(client1, {
        version: "1.0",
        type: "table_state_sub",
        requestId: `req-sub-resume-stale-${idx}`,
        ts: "2026-02-28T00:08:01Z",
        payload: { tableId: "table_resume_stale" }
      });
      await nextMessage(client1, 5000, `resume-stale-${idx}`);
    }

    client1.close();
    await waitSocketClose(client1);

    const client2 = await connectClient(port);
    await hello(client2, "req-hello-resume-stale-c2");
    await auth(client2, token, "req-auth-resume-stale-c2");

    sendFrame(client2, {
      version: "1.0",
      type: "resume",
      roomId: "table_resume_stale",
      requestId: "req-resume-stale-c2",
      ts: "2026-02-28T00:08:02Z",
      payload: { tableId: "table_resume_stale", sessionId, lastSeq: 0 }
    });

    const outcome = await nextMessageOfType(client2, "resync", { skipTypes: ["table_state"] });
    assert.equal(outcome.type, "resync");
    assert.equal(outcome.payload.mode, "required");
    assert.equal(outcome.payload.reason, "last_seq_out_of_window");
    assert.equal(typeof outcome.payload.expectedSeq, "number");

    const recovery = await nextMessageOfType(client2, "stateSnapshot", { skipTypes: ["table_state"] });
    assert.equal(recovery.type, "stateSnapshot");
    assert.equal(typeof recovery.seq, "number");
    assert.equal(recovery.payload.table.tableId, "table_resume_stale");
    assert.equal(recovery.payload.you.userId, "user_resume_stale");

    const noMutationFrames = await attemptMessage(client2, 300);
    assert.equal(noMutationFrames === null || noMutationFrames.type !== "commandResult", true);

    client2.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("resume after session expiry returns explicit unknown_session resync", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_resume_expired" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_SESSION_TTL_MS: "50"
    }
  });

  try {
    await waitForListening(child, 5000);

    const client1 = await connectClient(port);
    await hello(client1, "req-hello-resume-expired-c1");
    const auth1 = await auth(client1, token, "req-auth-resume-expired-c1");
    const sessionId = auth1.payload.sessionId;
    client1.close();
    await waitSocketClose(client1);

    await waitBeyondTtl(50);

    const client2 = await connectClient(port);
    await hello(client2, "req-hello-resume-expired-c2");
    await auth(client2, token, "req-auth-resume-expired-c2");

    sendFrame(client2, {
      version: "1.0",
      type: "resume",
      roomId: "table_resume_expired",
      requestId: "req-resume-expired-c2",
      ts: "2026-02-28T00:09:00Z",
      payload: { tableId: "table_resume_expired", sessionId, lastSeq: 0 }
    });

    const outcome = await nextMessage(client2, 5000, "resume-expired-outcome");
    assert.equal(outcome.type, "resync");
    assert.equal(outcome.payload.reason, "unknown_session");

    const noReplay = await attemptMessage(client2);
    assert.equal(noReplay, null);

    client2.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});


test("restart and resync hydrate latest persisted WS mutation", async () => {
  const secret = "restart-secret";
  const tableId = "table_resync_restart_persisted";
  const persisted = {
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
  const { dir, filePath } = await writePersistedFile(persisted);
  const token = makeHs256Jwt({ secret, sub: "seat_actor" });

  const first = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_PERSISTED_STATE_FILE: filePath } });
  try {
    await waitForListening(first.child, 5000);
    const ws = await connectClient(first.port);
    await hello(ws, "hello-restart-1");
    await auth(ws, token, "auth-restart-1");
    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-restart-1", ts: "2026-02-28T02:20:00Z", payload: { tableId } });
    await nextMessageOfType(ws, "table_state");
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-restart-1", ts: "2026-02-28T02:20:01Z", payload: { tableId, view: "snapshot" } });
    const baseline = await nextMessageOfType(ws, "stateSnapshot");
    const handId = baseline.payload.public.hand.handId;
    sendFrame(ws, { version: "1.0", type: "act", requestId: "act-restart-1", ts: "2026-02-28T02:20:02Z", payload: { tableId, handId, action: "fold" } });
    await nextMessageOfType(ws, "commandResult");
    const advanced = await nextMessageOfType(ws, "stateSnapshot", { skipTypes: ["statePatch"] });
    assert.equal(advanced.payload.stateVersion > baseline.payload.stateVersion, true);
    ws.close();
  } finally {
    first.child.kill("SIGTERM");
    await waitForExit(first.child);
  }

  const second = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_PERSISTED_STATE_FILE: filePath } });
  try {
    await waitForListening(second.child, 5000);
    const ws2 = await connectClient(second.port);
    await hello(ws2, "hello-restart-2");
    await auth(ws2, token, "auth-restart-2");
    sendFrame(ws2, { version: "1.0", type: "resync", requestId: "resync-restart-2", ts: "2026-02-28T02:20:03Z", payload: { tableId } });
    await nextMessageOfType(ws2, "table_state");
    sendFrame(ws2, { version: "1.0", type: "table_state_sub", requestId: "snap-restart-2", ts: "2026-02-28T02:20:04Z", payload: { tableId, view: "snapshot" } });
    const rehydrated = await nextMessageOfType(ws2, "stateSnapshot");
    assert.equal(rehydrated.payload.stateVersion > 0, true);
    ws2.close();
  } finally {
    second.child.kill("SIGTERM");
    await waitForExit(second.child);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("resync after persistence conflict rehydrates persisted source of truth", async () => {
  const secret = "conflict-resync-secret";
  const tableId = "table_resync_after_conflict";
  const persisted = {
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
  const { dir, filePath } = await writePersistedFile(persisted);
  const token = makeHs256Jwt({ secret, sub: "seat_actor" });
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PERSISTED_STATE_FILE: filePath
    }
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws, "hello-conflict-resync");
    await auth(ws, token, "auth-conflict-resync");
    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-conflict-resync", ts: "2026-02-28T03:00:00Z", payload: { tableId } });
    await nextMessageOfType(ws, "table_state");
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-conflict-resync", ts: "2026-02-28T03:00:01Z", payload: { tableId, view: "snapshot" } });
    const baseline = await nextMessageOfType(ws, "stateSnapshot");
    const handId = baseline.payload.public.hand.handId;

    const forcedRaw = JSON.parse(await fs.readFile(filePath, "utf8"));
    forcedRaw.tables[tableId].stateRow.version = baseline.payload.stateVersion + 3;
    await fs.writeFile(filePath, `${JSON.stringify(forcedRaw)}\n`, "utf8");

    sendFrame(ws, { version: "1.0", type: "act", requestId: "act-conflict-resync", ts: "2026-02-28T03:00:02Z", payload: { tableId, handId, action: "fold" } });
    const rejected = await nextMessageOfType(ws, "commandResult");
    assert.equal(rejected.payload.status, "rejected");
    const resyncReq = await nextMessageOfType(ws, "resync");
    assert.equal(resyncReq.payload.reason, "persistence_conflict");

    sendFrame(ws, { version: "1.0", type: "resync", requestId: "resync-after-conflict", ts: "2026-02-28T03:00:03Z", payload: { tableId } });
    await nextMessageOfType(ws, "table_state");
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-after-conflict", ts: "2026-02-28T03:00:04Z", payload: { tableId, view: "snapshot" } });
    const hydrated = await nextMessageOfType(ws, "stateSnapshot");
    assert.equal(hydrated.payload.stateVersion, forcedRaw.tables[tableId].stateRow.version);
    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
