import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import WebSocket from "ws";

const FIXED_RANDOM_BOT_AUTOPLAY_ADAPTER_URL = new URL(
  "./poker/runtime/accepted-bot-autoplay-adapter.fixed-random.fixture.mjs",
  import.meta.url
).href;

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
    const summarize = (chunks) => {
      const joined = chunks.join("");
      return joined ? joined.slice(-4000) : "<empty>";
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Server did not start in time. stdout: ${summarize(stdoutChunks)} stderr: ${summarize(stderrChunks)}`));
    }, timeoutMs);
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`Server exited before ready: code=${code} signal=${signal || "none"}. stdout: ${summarize(stdoutChunks)} stderr: ${summarize(stderrChunks)}`));
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
      env: {
        ...process.env,
        PORT: String(port),
        WS_BOT_REACTION_MIN_MS: "0",
        WS_BOT_REACTION_MAX_MS: "0",
        WS_ACCEPTED_BOT_AUTOPLAY_ADAPTER_MODULE_PATH: FIXED_RANDOM_BOT_AUTOPLAY_ADAPTER_URL,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
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

function nextMessageMatching(ws, predicate, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
      ws.off("close", onClose);
    };
    const onMessage = (data) => {
      const frame = JSON.parse(String(data));
      if (!predicate(frame)) return;
      cleanup();
      resolve(frame);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = (code) => {
      cleanup();
      reject(new Error(`Socket closed before matching message: ${code}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for matching websocket message"));
    }, timeoutMs);
    ws.on("message", onMessage);
    ws.on("error", onError);
    ws.on("close", onClose);
  });
}

function nextMessageOfType(ws, type, timeoutMs = 10000) {
  return nextMessageMatching(ws, (frame) => frame?.type === type, timeoutMs);
}

function nextCommandResultForRequest(ws, requestId, timeoutMs = 10000) {
  return nextMessageMatching(
    ws,
    (frame) => frame?.type === "commandResult" && frame?.payload?.requestId === requestId,
    timeoutMs
  );
}

function sendFrame(ws, frame) {
  ws.send(JSON.stringify(frame));
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function makeJwt({ secret, sub, expOffsetSec = 3600, mode = "user", nickname = null, tableId = null }) {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expOffsetSec,
  };
  if (mode) payload.mode = mode;
  if (nickname) payload.nickname = nickname;
  if (tableId) payload.tableId = tableId;
  const encodedHeader = base64urlJson(header);
  const encodedPayload = base64urlJson(payload);
  const signature = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function makeGuestJwt({ secret, sub, tableId, nickname, expOffsetSec = 3600 }) {
  return makeJwt({
    secret,
    sub,
    mode: "guest",
    nickname,
    tableId,
    expOffsetSec,
  });
}

async function writePersistedFile(fixture) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ws-persist-"));
  const filePath = path.join(dir, "persisted-state.json");
  await fs.writeFile(filePath, `${JSON.stringify(fixture)}\n`, "utf8");
  return { dir, filePath };
}

async function readPersistedFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function hello(ws) {
  sendFrame(ws, {
    version: "1.0",
    type: "hello",
    requestId: "req-hello",
    ts: "2026-02-28T00:00:00Z",
    payload: { supportedVersions: ["1.0"] },
  });
  return nextMessage(ws);
}

async function auth(ws, token, requestId = "req-auth") {
  sendFrame(ws, {
    version: "1.0",
    type: "auth",
    requestId,
    ts: "2026-02-28T00:00:01Z",
    payload: { token },
  });
  return nextMessage(ws);
}

function tableJoinFrame(tableId, requestId) {
  return {
    version: "1.0",
    type: "table_join",
    requestId,
    ts: "2026-02-28T00:00:02Z",
    payload: { tableId },
  };
}

async function joinTable(ws, tableId, requestId) {
  sendFrame(ws, tableJoinFrame(tableId, requestId));
  const ack = await nextCommandResultForRequest(ws, requestId);
  const tableState = await nextMessageOfType(ws, "table_state");
  return { ack, tableState };
}

test("guest can auth and join only its token-bound guest_table_*", async () => {
  const secret = "guest-bound-secret";
  const guestUserId = "guest_user_1";
  const boundTableId = "guest_table_bound_1";
  const otherTableId = "guest_table_other_1";
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
    },
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    const authOk = await auth(
      ws,
      makeGuestJwt({ secret, sub: guestUserId, tableId: boundTableId, nickname: "Guest2468" }),
      "auth-guest-bound"
    );
    assert.equal(authOk.type, "authOk");
    assert.equal(authOk.payload.mode, "guest");
    assert.equal(authOk.payload.nickname, "Guest2468");

    const accepted = await joinTable(ws, boundTableId, "join-guest-bound");
    assert.equal(accepted.ack.payload.status, "accepted");
    assert.equal(accepted.tableState.roomId, boundTableId);

    sendFrame(ws, tableJoinFrame(otherTableId, "join-guest-other"));
    const rejected = await nextCommandResultForRequest(ws, "join-guest-other");
    assert.equal(rejected.payload.status, "rejected");
    assert.equal(rejected.payload.reason, "guest_multiplayer_requires_account");

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("guest cannot join normal table", async () => {
  const secret = "guest-normal-table-secret";
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
    },
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(
      ws,
      makeGuestJwt({ secret, sub: "guest_user_2", tableId: "guest_table_normal_gate", nickname: "Guest9021" }),
      "auth-guest-normal"
    );

    sendFrame(ws, tableJoinFrame("table_normal_gate", "join-normal-gate"));
    const rejected = await nextCommandResultForRequest(ws, "join-normal-gate");
    assert.equal(rejected.payload.status, "rejected");
    assert.equal(rejected.payload.reason, "guest_multiplayer_requires_account");

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("normal user cannot join guest_table_*", async () => {
  const secret = "normal-guest-table-secret";
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
    },
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, makeJwt({ secret, sub: "user_1" }), "auth-normal-user");

    sendFrame(ws, tableJoinFrame("guest_table_reserved", "join-guest-table-as-user"));
    const rejected = await nextCommandResultForRequest(ws, "join-guest-table-as-user");
    assert.equal(rejected.payload.status, "rejected");
    assert.equal(rejected.payload.reason, "guest_table_requires_guest_session");

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("guest table is not included in lobby snapshot", async () => {
  const secret = "guest-lobby-secret";
  const guestTableId = "guest_table_lobby_hidden";
  const normalTableId = "table_lobby_visible";
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
    },
  });

  try {
    await waitForListening(child, 5000);

    const normalWs = await connectClient(port);
    await hello(normalWs);
    await auth(normalWs, makeJwt({ secret, sub: "normal_lobby_user" }), "auth-normal-lobby");
    const normalJoin = await joinTable(normalWs, normalTableId, "join-normal-visible");
    assert.equal(normalJoin.ack.payload.status, "accepted");

    const guestWs = await connectClient(port);
    await hello(guestWs);
    await auth(
      guestWs,
      makeGuestJwt({ secret, sub: "guest_lobby_user", tableId: guestTableId, nickname: "Guest7777" }),
      "auth-guest-lobby"
    );
    const guestJoin = await joinTable(guestWs, guestTableId, "join-guest-hidden");
    assert.equal(guestJoin.ack.payload.status, "accepted");

    const lobbyWs = await connectClient(port);
    await hello(lobbyWs);
    await auth(lobbyWs, makeJwt({ secret, sub: "lobby_viewer" }), "auth-lobby-viewer");
    sendFrame(lobbyWs, {
      version: "1.0",
      type: "lobby_subscribe",
      requestId: "lobby-snapshot",
      ts: "2026-02-28T00:00:03Z",
      payload: {},
    });
    const snapshot = await nextMessageOfType(lobbyWs, "lobby_snapshot");
    assert.equal(snapshot.payload.tables.some((table) => table.tableId === normalTableId), true);
    assert.equal(snapshot.payload.tables.some((table) => table.tableId === guestTableId), false);

    normalWs.close();
    guestWs.close();
    lobbyWs.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("guest table mutations skip persistence and ledger", async () => {
  const secret = "guest-persistence-secret";
  const guestTableId = "guest_table_no_persist";
  const guestUserId = "guest_user_ledger";
  const { dir, filePath } = await writePersistedFile({});
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PERSISTED_STATE_FILE: filePath,
    },
  });
  const serverLogs = [];

  try {
    await waitForListening(child, 5000);
    child.stdout.on("data", (buf) => {
      serverLogs.push(String(buf));
    });

    const ws = await connectClient(port);
    await hello(ws);
    await auth(
      ws,
      makeGuestJwt({ secret, sub: guestUserId, tableId: guestTableId, nickname: "Guest4501" }),
      "auth-guest-persist"
    );
    const joined = await joinTable(ws, guestTableId, "join-guest-persist");
    assert.equal(joined.ack.payload.status, "accepted");

    sendFrame(ws, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "guest-persist-snapshot",
      ts: "2026-02-28T00:00:04Z",
      payload: { tableId: guestTableId, view: "snapshot" },
    });
    const snapshot = await nextMessageOfType(ws, "stateSnapshot");
    const legalActions = Array.isArray(snapshot.payload?.public?.legalActions?.actions)
      ? snapshot.payload.public.legalActions.actions
      : [];
    const handId = snapshot.payload?.public?.hand?.handId;
    const action = legalActions.includes("CALL") ? "CALL" : legalActions.includes("CHECK") ? "CHECK" : legalActions[0] || "FOLD";

    serverLogs.length = 0;

    sendFrame(ws, {
      version: "1.0",
      type: "act",
      requestId: "guest-act",
      ts: "2026-02-28T00:00:05Z",
      payload: { tableId: guestTableId, handId, action },
    });
    const actAck = await nextCommandResultForRequest(ws, "guest-act");
    assert.equal(actAck.payload.status, "accepted");

    await new Promise((resolve) => setTimeout(resolve, 250));
    const persisted = await readPersistedFile(filePath);
    assert.deepEqual(persisted, {});
    assert.equal(serverLogs.some((line) => line.includes("ws_state_persist_start")), false);
    assert.equal(serverLogs.some((line) => line.includes("poker_ledger")), false);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("guest can play at least one action and bot autoplay continues", async () => {
  const secret = "guest-autoplay-secret";
  const guestTableId = "guest_table_autoplay";
  const guestUserId = "guest_user_autoplay";
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
    },
  });
  const serverLogs = [];

  try {
    await waitForListening(child, 5000);
    child.stdout.on("data", (buf) => {
      const text = String(buf);
      if (text.includes("ws_bot_autoplay")) {
        serverLogs.push(text.trim());
      }
    });

    const ws = await connectClient(port);
    await hello(ws);
    await auth(
      ws,
      makeGuestJwt({ secret, sub: guestUserId, tableId: guestTableId, nickname: "Guest6123" }),
      "auth-guest-autoplay"
    );
    const joined = await joinTable(ws, guestTableId, "join-guest-autoplay");
    assert.equal(joined.ack.payload.status, "accepted");

    sendFrame(ws, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "guest-autoplay-snapshot",
      ts: "2026-02-28T00:00:06Z",
      payload: { tableId: guestTableId, view: "snapshot" },
    });
    const snapshot = await nextMessageOfType(ws, "stateSnapshot");
    const legalActions = Array.isArray(snapshot.payload?.public?.legalActions?.actions)
      ? snapshot.payload.public.legalActions.actions
      : [];
    const handId = snapshot.payload?.public?.hand?.handId;
    const action = legalActions.includes("CALL") ? "CALL" : legalActions.includes("CHECK") ? "CHECK" : legalActions[0] || "FOLD";

    serverLogs.length = 0;

    sendFrame(ws, {
      version: "1.0",
      type: "act",
      requestId: "guest-autoplay-act",
      ts: "2026-02-28T00:00:07Z",
      payload: { tableId: guestTableId, handId, action },
    });
    const actAck = await nextCommandResultForRequest(ws, "guest-autoplay-act");
    assert.equal(actAck.payload.status, "accepted");

    const nextState = await nextMessageMatching(
      ws,
      (frame) =>
        (frame?.type === "stateSnapshot" || frame?.type === "statePatch") &&
        frame?.payload?.public?.turn?.userId != null &&
        frame.payload.public.turn.userId !== guestUserId,
      15000
    );
    assert.equal(nextState.payload.public.turn.userId !== guestUserId, true);
    assert.equal(serverLogs.some((line) => line.includes("ws_bot_autoplay")), true);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("authenticated poker flow still works", async () => {
  const secret = "auth-flow-secret";
  const normalTableId = "table_auth_flow";
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
    },
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    const authOk = await auth(ws, makeJwt({ secret, sub: "user_auth_flow" }), "auth-flow");
    assert.equal(authOk.type, "authOk");
    assert.equal(authOk.payload.userId, "user_auth_flow");

    const joined = await joinTable(ws, normalTableId, "join-auth-flow");
    assert.equal(joined.ack.payload.status, "accepted");
    assert.equal(joined.tableState.roomId, normalTableId);

    sendFrame(ws, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "auth-flow-snapshot",
      ts: "2026-02-28T00:00:08Z",
      payload: { tableId: normalTableId, view: "snapshot" },
    });
    const snapshot = await nextMessageOfType(ws, "stateSnapshot");
    assert.equal(snapshot.type, "stateSnapshot");
    assert.equal(snapshot.payload?.public != null, true);
    assert.equal(snapshot.payload?.public?.turn != null, true);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});
