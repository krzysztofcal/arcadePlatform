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
import { dealHoleCards, deriveDeck, toCardCodes } from "./poker/shared/poker-primitives.mjs";
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
      env: {
        ...process.env,
        PORT: String(port),
        WS_BOT_REACTION_MIN_MS: "0",
        WS_BOT_REACTION_MAX_MS: "0",
        ...env
      },
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
  try {
    return await nextMessageMatching(
      ws,
      (frame) => frame?.type === type,
      timeoutMs
    );
  } catch (error) {
    if (error instanceof Error && error.message === "Timed out waiting for matching websocket message") {
      throw new Error(`Timed out waiting for message type: ${type}`);
    }
    throw error;
  }
}

async function nextMessageMatching(ws, predicate, timeoutMs = 10000) {
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

test("nextMessageOfType rejects within bounded timeout budget when only non-matching frames arrive", async () => {
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
  assert.equal(elapsed < timeoutMs + 300, true);
});

test("zombie cleanup keeps live bots-only table open while the hand is still running", async () => {
  const tableId = "table_zombie_live_bots_only";
  const botSeat1 = makeBotUserId(tableId, 1);
  const botSeat2 = makeBotUserId(tableId, 2);
  const store = {
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "OPEN" },
        seatRows: [
          { user_id: botSeat1, seat_no: 1, status: "ACTIVE", is_bot: true, stack: 101 },
          { user_id: botSeat2, seat_no: 2, status: "ACTIVE", is_bot: true, stack: 99 }
        ],
        stateRow: {
          version: 7,
          state: {
            tableId,
            handId: "hand_zombie_live",
            phase: "TURN",
            turnUserId: botSeat1,
            seats: [
              { userId: botSeat1, seatNo: 1, status: "ACTIVE", isBot: true },
              { userId: botSeat2, seatNo: 2, status: "ACTIVE", isBot: true }
            ],
            stacks: { [botSeat1]: 101, [botSeat2]: 99 }
          }
        }
      }
    }
  };
  const { dir, filePath } = await writePersistedFile(store);
  const { port, child } = await createServer({
    env: {
      WS_PERSISTED_STATE_FILE: filePath,
      WS_ZOMBIE_TABLE_SWEEP_MS: "25",
      WS_POKER_SETTLED_REVEAL_MS: "60000"
    }
  });

  try {
    await waitForListening(child, 5000);
    await new Promise((resolve) => setTimeout(resolve, 220));
    const persisted = await readPersistedFile(filePath);
    assert.equal(persisted.tables[tableId].tableRow.status, "OPEN");
    assert.equal(persisted.tables[tableId].stateRow.state.phase, "TURN");
    assert.equal(persisted.tables[tableId].stateRow.state.turnUserId, botSeat1);
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("settled rollover closes unwatched bots-only table instead of starting the next hand", async () => {
  const secret = "settled-bots-only-close-secret";
  const tableId = "table_settled_bots_only_close";
  const botSeat1 = makeBotUserId(tableId, 1);
  const botSeat2 = makeBotUserId(tableId, 2);
  const settledAtIso = new Date().toISOString();
  const { dir, filePath } = await writePersistedFile({
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "OPEN" },
        seatRows: [
          { user_id: botSeat1, seat_no: 1, status: "ACTIVE", is_bot: true, stack: 104 },
          { user_id: botSeat2, seat_no: 2, status: "ACTIVE", is_bot: true, stack: 96 }
        ],
        stateRow: {
          version: 9,
          state: {
            tableId,
            roomId: tableId,
            handId: "hand_settled_bots_only",
            phase: "SETTLED",
            dealerSeatNo: 1,
            seats: [
              { userId: botSeat1, seatNo: 1, status: "ACTIVE", isBot: true },
              { userId: botSeat2, seatNo: 2, status: "ACTIVE", isBot: true }
            ],
            stacks: { [botSeat1]: 104, [botSeat2]: 96 },
            showdown: {
              handId: "hand_settled_bots_only",
              winners: [botSeat1],
              potsAwarded: [{ amount: 8, winners: [botSeat1] }],
              potAwardedTotal: 8,
              reason: "computed"
            },
            handSettlement: {
              handId: "hand_settled_bots_only",
              settledAt: settledAtIso,
              payouts: { [botSeat1]: 8 }
            },
            holeCardsByUserId: {
              [botSeat1]: ["AS", "KD"],
              [botSeat2]: ["2C", "2D"]
            }
          }
        }
      }
    }
  });
  const cleanupModule = await writeTestModule(`
import fs from "node:fs/promises";
export function createInactiveCleanupExecutor({ env }) {
  return async ({ tableId }) => {
    const raw = await fs.readFile(env.WS_PERSISTED_STATE_FILE, "utf8");
    const doc = JSON.parse(raw || "{}");
    const table = doc?.tables?.[tableId];
    if (!table) return { ok: true, changed: false, status: "seat_missing", retryable: false };
    table.tableRow = { ...(table.tableRow || {}), status: "CLOSED" };
    table.seatRows = (Array.isArray(table.seatRows) ? table.seatRows : []).map((row) => ({ ...row, status: "INACTIVE", stack: 0 }));
    const state = table?.stateRow?.state && typeof table.stateRow.state === "object" ? table.stateRow.state : {};
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
        actedThisRoundByUserId: {}
      }
    };
    await fs.writeFile(env.WS_PERSISTED_STATE_FILE, JSON.stringify(doc) + "\\n", "utf8");
    return { ok: true, changed: true, status: "cleaned_closed", closed: true, retryable: false };
  };
}
`, "inactive-cleanup-test-adapter-settled-close.mjs");
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PERSISTED_STATE_FILE: filePath,
      WS_POKER_SETTLED_REVEAL_MS: "250",
      WS_INACTIVE_CLEANUP_ADAPTER_MODULE_PATH: `file://${cleanupModule.filePath}`
    }
  });

  try {
    await waitForListening(child, 5000);
    const serverLogs = [];
    child.stdout.on("data", (buf) => {
      const text = String(buf || "");
      if (text.includes("ws_settled_rollover_close_evict_closed_success")) {
        serverLogs.push(text.trim());
      }
    });
    const observerWs = await connectClient(port);
    await hello(observerWs);
    await auth(observerWs, makeHs256Jwt({ secret, sub: "observer_user" }), "auth-settled-bots-only");
    sendFrame(observerWs, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "snap-settled-bots-only",
      ts: "2026-04-14T09:00:01Z",
      payload: { tableId, view: "snapshot" }
    });
    const initialSnapshot = await nextMessageOfType(observerWs, "stateSnapshot");
    assert.equal(initialSnapshot.payload.public.hand.status, "SETTLED");
    const observerClosed = new Promise((resolve) => observerWs.once("close", resolve));
    observerWs.close();
    await observerClosed;

    await new Promise((resolve) => setTimeout(resolve, 600));
    const persisted = await readPersistedFile(filePath);
    assert.equal(persisted.tables[tableId].tableRow.status, "CLOSED");
    assert.equal(persisted.tables[tableId].stateRow.state.phase, "HAND_DONE");
    assert.equal(persisted.tables[tableId].stateRow.state.handId, "");
    assert.equal(serverLogs.some((line) => line.includes("ws_settled_rollover_close_evict_closed_success")), true);
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(cleanupModule.dir, { recursive: true, force: true });
  }
});

test("settled rollover keeps observer-watched bots-only table open through reveal and closes after observer disconnect", async () => {
  const secret = "settled-observer-hold-secret";
  const tableId = "table_settled_observer_hold";
  const botSeat1 = makeBotUserId(tableId, 1);
  const botSeat2 = makeBotUserId(tableId, 2);
  const settledAtIso = new Date().toISOString();
  const { dir, filePath } = await writePersistedFile({
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "OPEN" },
        seatRows: [
          { user_id: botSeat1, seat_no: 1, status: "ACTIVE", is_bot: true, stack: 101 },
          { user_id: botSeat2, seat_no: 2, status: "ACTIVE", is_bot: true, stack: 99 }
        ],
        stateRow: {
          version: 10,
          state: {
            tableId,
            roomId: tableId,
            handId: "hand_settled_observer_hold",
            phase: "SETTLED",
            dealerSeatNo: 1,
            seats: [
              { userId: botSeat1, seatNo: 1, status: "ACTIVE", isBot: true },
              { userId: botSeat2, seatNo: 2, status: "ACTIVE", isBot: true }
            ],
            stacks: { [botSeat1]: 101, [botSeat2]: 99 },
            showdown: {
              handId: "hand_settled_observer_hold",
              winners: [botSeat1],
              potsAwarded: [{ amount: 4, winners: [botSeat1] }],
              potAwardedTotal: 4,
              reason: "computed"
            },
            handSettlement: {
              handId: "hand_settled_observer_hold",
              settledAt: settledAtIso,
              payouts: { [botSeat1]: 4 }
            },
            holeCardsByUserId: {
              [botSeat1]: ["AS", "KD"],
              [botSeat2]: ["2C", "2D"]
            }
          }
        }
      }
    }
  });
  const cleanupModule = await writeTestModule(`
import fs from "node:fs/promises";
export function createInactiveCleanupExecutor({ env }) {
  return async ({ tableId }) => {
    const raw = await fs.readFile(env.WS_PERSISTED_STATE_FILE, "utf8");
    const doc = JSON.parse(raw || "{}");
    const table = doc?.tables?.[tableId];
    if (!table) return { ok: true, changed: false, status: "seat_missing", retryable: false };
    table.tableRow = { ...(table.tableRow || {}), status: "CLOSED" };
    table.seatRows = (Array.isArray(table.seatRows) ? table.seatRows : []).map((row) => ({ ...row, status: "INACTIVE", stack: 0 }));
    const state = table?.stateRow?.state && typeof table.stateRow.state === "object" ? table.stateRow.state : {};
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
        actedThisRoundByUserId: {}
      }
    };
    await fs.writeFile(env.WS_PERSISTED_STATE_FILE, JSON.stringify(doc) + "\\n", "utf8");
    return { ok: true, changed: true, status: "cleaned_closed", closed: true, retryable: false };
  };
}
`, "inactive-cleanup-test-adapter-settled-observer-hold.mjs");
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PERSISTED_STATE_FILE: filePath,
      WS_POKER_SETTLED_REVEAL_MS: "250",
      WS_INACTIVE_CLEANUP_ADAPTER_MODULE_PATH: `file://${cleanupModule.filePath}`
    }
  });

  try {
    await waitForListening(child, 5000);
    const serverLogs = [];
    child.stdout.on("data", (buf) => {
      const text = String(buf || "");
      if (
        text.includes("ws_settled_rollover_close_skipped_human_presence")
        || text.includes("ws_settled_rollover_close_restore_success")
        || text.includes("ws_settled_rollover_close_evict_closed_success")
      ) {
        serverLogs.push(text.trim());
      }
    });

    const observerWs = await connectClient(port);
    await hello(observerWs);
    await auth(observerWs, makeHs256Jwt({ secret, sub: "observer_user_hold" }), "auth-settled-observer-hold");
    sendFrame(observerWs, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "sub-settled-observer-hold",
      ts: "2026-04-14T09:05:01Z",
      payload: { tableId }
    });
    await nextMessageOfType(observerWs, "table_state");
    sendFrame(observerWs, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "snap-settled-observer-hold",
      ts: "2026-04-14T09:05:02Z",
      payload: { tableId, view: "snapshot" }
    });
    const initialSnapshot = await nextMessageOfType(observerWs, "stateSnapshot");
    assert.equal(initialSnapshot.payload.public.hand.status, "SETTLED");

    await new Promise((resolve) => setTimeout(resolve, 500));
    const heldOpen = await readPersistedFile(filePath);
    assert.equal(heldOpen.tables[tableId].tableRow.status, "OPEN");
    assert.equal(heldOpen.tables[tableId].stateRow.state.phase, "SETTLED");
    assert.equal(serverLogs.some((line) => line.includes("ws_settled_rollover_close_skipped_human_presence")), true);

    const observerClosed = new Promise((resolve) => observerWs.once("close", resolve));
    observerWs.close();
    await observerClosed;

    await new Promise((resolve) => setTimeout(resolve, 500));
    const closed = await readPersistedFile(filePath);
    assert.equal(closed.tables[tableId].tableRow.status, "CLOSED");
    assert.equal(closed.tables[tableId].stateRow.state.phase, "HAND_DONE");
    assert.equal(serverLogs.some((line) => line.includes("ws_settled_rollover_close_evict_closed_success")), true);
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(cleanupModule.dir, { recursive: true, force: true });
  }
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
    await nextMessageOfType(actor, "table_state");
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
    await nextMessageOfType(actor, "table_state");
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

test("resume fallback snapshot on settled table still schedules delayed rollover", async () => {
  const secret = "resume-settled-secret";
  const settledAt = new Date(Date.now()).toISOString();
  const tableId = "table_resume_settled";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [
        { user_id: "user_resume", seat_no: 1, status: "ACTIVE", is_bot: false },
        { user_id: "user_other", seat_no: 2, status: "ACTIVE", is_bot: false }
      ],
      stateRow: {
        version: 21,
        state: {
          handId: "h21",
          phase: "SETTLED",
          dealerSeatNo: 1,
          community: [],
          communityDealt: 0,
          turnUserId: null,
          turnStartedAt: null,
          turnDeadlineAt: null,
          showdown: {
            handId: "h21",
            winners: ["user_resume"],
            reason: "computed"
          },
          handSettlement: {
            handId: "h21",
            settledAt,
            payouts: { user_resume: 12 }
          },
          stacks: {
            user_resume: 112,
            user_other: 88
          }
        }
      }
    }
  };
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_STREAM_REPLAY_CAP: "1",
      WS_POKER_SETTLED_REVEAL_MS: "1000",
      SUPABASE_DB_URL: "",
      ...persistedBootstrapFixturesEnv(fixtures)
    }
  });
  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    const helloAck = await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "user_resume" }));

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-settled-r1", ts: "2026-02-28T00:00:01Z", payload: { tableId } });
    await nextMessageOfType(ws, "commandResult");
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-settled-r1", ts: "2026-02-28T00:00:02Z", payload: { tableId, view: "snapshot" } });
    await nextMessageOfType(ws, "stateSnapshot");
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-settled-r2", ts: "2026-02-28T00:00:03Z", payload: { tableId, view: "snapshot" } });
    await nextMessageOfType(ws, "stateSnapshot");
    ws.close();

    const ws2 = await connectClient(port);
    await hello(ws2);
    await auth(ws2, makeHs256Jwt({ secret, sub: "user_resume" }), "auth-settled-r2");
    const resumeMessages = nextNMessages(ws2, 2, 10000);
    sendFrame(ws2, {
      version: "1.0",
      type: "resume",
      requestId: "resume-settled-r2",
      roomId: tableId,
      ts: "2026-02-28T00:00:04Z",
      payload: { tableId, sessionId: helloAck.payload.sessionId, lastSeq: 0 }
    });

    const [resync, resumedSnapshot] = await resumeMessages;
    assert.equal(resync.type, "resync");
    assert.equal(resumedSnapshot.type, "stateSnapshot");
    assert.equal(resync.payload.mode, "required");
    assert.ok(["SETTLED", "PREFLOP"].includes(resumedSnapshot.payload.public.hand.status));
    if (resumedSnapshot.payload.public.hand.status === "SETTLED") {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      sendFrame(ws2, { version: "1.0", type: "table_state_sub", requestId: "snap-settled-r3", ts: "2026-02-28T00:00:05Z", payload: { tableId, view: "snapshot" } });
      const rolledSnapshot = await nextMessageOfType(ws2, "stateSnapshot");
      assert.equal(rolledSnapshot.payload.public.hand.status, "PREFLOP");
      assert.equal(rolledSnapshot.payload.stateVersion > resumedSnapshot.payload.stateVersion, true);
    } else {
      assert.equal(resumedSnapshot.payload.stateVersion > 21, true);
    }
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

async function materializeLobbyTableRuntime({ port, token, tableId, maxPlayers = 6, stakes = { sb: 1, bb: 2 } }) {
  const response = await fetch(`http://127.0.0.1:${port}/internal/lobby/materialize-table`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ tableId, maxPlayers, stakes })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, tableId });
}

test("WS lobby_subscribe includes explicit runtime-materialized joinable tables before any player joins", async () => {
  const secret = "lobby-joinable-secret";
  const internalToken = "lobby-internal-token";
  const lobbyToken = makeHs256Jwt({ secret, sub: "lobby_user" });
  const tableId = "table_runtime_joinable_recent";
  const nowIso = new Date().toISOString();
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      POKER_WS_INTERNAL_TOKEN: internalToken,
      SUPABASE_DB_URL: ""
    }
  });

  try {
    await waitForListening(child, 5000);
    await materializeLobbyTableRuntime({ port, token: internalToken, tableId });
    const lobby = await connectClient(port);
    await hello(lobby);
    assert.equal((await auth(lobby, lobbyToken, "auth-lobby-joinable")).type, "authOk");
    sendFrame(lobby, {
      version: "1.0",
      type: "lobby_subscribe",
      requestId: "req-lobby-joinable",
      ts: nowIso,
      payload: {}
    });
    const snapshot = await nextMessageOfType(lobby, "lobby_snapshot");
    const lobbyTable = snapshot.payload.tables.find((table) => table.tableId === tableId);
    assert.ok(lobbyTable, "recent joinable table should be visible in the first lobby snapshot");
    assert.equal(lobbyTable.status, "INIT");
    assert.equal(lobbyTable.seatCount, 0);
    assert.equal(lobbyTable.maxPlayers, 6);
    assert.equal(lobbyTable.joinable, true);
    assert.deepEqual(lobbyTable.stakes, { sb: 1, bb: 2 });
    lobby.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("WS lobby removes empty joinable tables after runtime grace expires", async () => {
  const secret = "lobby-joinable-expiry-secret";
  const internalToken = "lobby-expiry-internal-token";
  const lobbyToken = makeHs256Jwt({ secret, sub: "lobby_user" });
  const tableId = "table_runtime_joinable_expiring";
  const nowIso = new Date().toISOString();
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      POKER_WS_INTERNAL_TOKEN: internalToken,
      POKER_TABLE_CLOSE_GRACE_MS: "1200",
      WS_LOBBY_VISIBILITY_SWEEP_MS: "50",
      SUPABASE_DB_URL: ""
    }
  });

  try {
    await waitForListening(child, 5000);
    await materializeLobbyTableRuntime({ port, token: internalToken, tableId });
    const lobby = await connectClient(port);
    await hello(lobby);
    assert.equal((await auth(lobby, lobbyToken, "auth-lobby-expiry")).type, "authOk");
    sendFrame(lobby, {
      version: "1.0",
      type: "lobby_subscribe",
      requestId: "req-lobby-expiry",
      ts: nowIso,
      payload: {}
    });
    const snapshot = await nextMessageOfType(lobby, "lobby_snapshot");
    assert.ok(snapshot.payload.tables.some((table) => table.tableId === tableId), "joinable table should be visible before grace expiry");

    const removedSnapshot = await nextMessageMatching(
      lobby,
      (frame) => frame?.type === "lobby_snapshot" && Array.isArray(frame?.payload?.tables) && !frame.payload.tables.some((table) => table?.tableId === tableId),
      6000
    );
    assert.ok(Array.isArray(removedSnapshot.payload.tables));
    lobby.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("WS lobby materialization does not shadow persisted bootstrap on later table_join", async () => {
  const secret = "lobby-materialized-join-secret";
  const internalToken = "lobby-materialized-join-internal";
  const token = makeHs256Jwt({ secret, sub: "user_a" });
  const tableId = "table_materialized_join";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active", stakes: '{"sb":1,"bb":2}' },
      seatRows: [{ user_id: "user_a", seat_no: 3, status: "ACTIVE", is_bot: false }],
      stateRow: { version: 21, state: { handId: "h21", phase: "PREFLOP", turnUserId: "user_a", holeCardsByUserId: { user_a: ["As", "Kd"] } } }
    }
  };

  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      POKER_WS_INTERNAL_TOKEN: internalToken,
      SUPABASE_DB_URL: "",
      ...persistedBootstrapFixturesEnv(fixtures)
    }
  });

  try {
    await waitForListening(child, 5000);
    await materializeLobbyTableRuntime({ port, token: internalToken, tableId });

    const ws = await connectClient(port);
    await hello(ws);
    assert.equal((await auth(ws, token)).type, "authOk");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "req-materialized-join", ts: "2026-02-28T00:00:02Z", payload: { tableId } });
    const joinAck = await nextMessageOfType(ws, "commandResult");
    assert.equal(joinAck.payload.status, "accepted");

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "req-materialized-snap", ts: "2026-02-28T00:00:03Z", payload: { tableId, view: "snapshot" } });
    const snapshot = await nextMessageOfType(ws, "stateSnapshot");
    assert.equal(snapshot.payload.table.tableId, tableId);
    assert.equal(snapshot.payload.stateVersion, 21);
    assert.equal(snapshot.payload.you.userId, "user_a");
    assert.equal(snapshot.payload.you.seat, 3);
    assert.deepEqual(snapshot.payload.private.holeCards, ["As", "Kd"]);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("WS lobby_subscribe publishes runtime-visible tables only and removes them live", async () => {
  const secret = "lobby-runtime-secret";
  const lobbyToken = makeHs256Jwt({ secret, sub: "lobby_user" });
  const playerToken = makeHs256Jwt({ secret, sub: "player_user" });
  const tableId = "table_runtime_lobby_only";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "OPEN", stakes: '{"sb":1,"bb":2}' },
      seatRows: [],
      stateRow: {
        version: 1,
        state: {
          tableId,
          phase: "LOBBY",
          seats: [],
          stacks: {},
          leftTableByUserId: {},
          waitingForNextHandByUserId: {}
        }
      }
    }
  };
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PRESENCE_TTL_MS: "0",
      SUPABASE_DB_URL: "",
      ...persistedBootstrapFixturesEnv(fixtures)
    }
  });

  try {
    await waitForListening(child, 5000);

    const lobby = await connectClient(port);
    await hello(lobby);
    assert.equal((await auth(lobby, lobbyToken, "auth-lobby-runtime")).type, "authOk");
    sendFrame(lobby, {
      version: "1.0",
      type: "lobby_subscribe",
      requestId: "req-lobby-subscribe",
      ts: "2026-02-28T00:00:02Z",
      payload: {}
    });
    const emptySnapshot = await nextMessageOfType(lobby, "lobby_snapshot");
    assert.deepEqual(emptySnapshot.payload.tables, []);

    const player = await connectClient(port);
    await hello(player);
    assert.equal((await auth(player, playerToken, "auth-player-runtime")).type, "authOk");
    sendFrame(player, {
      version: "1.0",
      type: "table_join",
      requestId: "req-runtime-join",
      ts: "2026-02-28T00:00:03Z",
      payload: { tableId }
    });
    const joinAck = await nextCommandResultForRequest(player, "req-runtime-join");
    assert.equal(joinAck.payload.status, "accepted");

    const visibleSnapshot = await nextMessageMatching(
      lobby,
      (frame) => frame?.type === "lobby_snapshot" && frame?.payload?.tables?.some((table) => table?.tableId === tableId),
      10000
    );
    const lobbyTable = visibleSnapshot.payload.tables.find((table) => table.tableId === tableId);
    assert.ok(lobbyTable, "joined table should appear in runtime lobby snapshot");
    assert.equal(lobbyTable.status, "LOBBY");
    assert.equal(lobbyTable.seatCount, 1);
    assert.equal(lobbyTable.maxPlayers, 6);
    assert.deepEqual(lobbyTable.stakes, { sb: 1, bb: 2 });

    player.close();

    const removedSnapshot = await nextMessageMatching(
      lobby,
      (frame) => frame?.type === "lobby_snapshot" && Array.isArray(frame?.payload?.tables) && frame.payload.tables.length === 0,
      10000
    );
    assert.deepEqual(removedSnapshot.payload.tables, []);
    lobby.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("table_leave closes live runtime table without showdown errors and removes it from lobby", async () => {
  const secret = "leave-live-lobby-cleanup-secret";
  const humanUserId = "leave_live_human";
  const tableId = "table_leave_live_lobby_cleanup";
  const handSeed = "seed_leave_live_cleanup";
  const botSeat2 = makeBotUserId(tableId, 2);
  const botSeat3 = makeBotUserId(tableId, 3);
  const dealt = dealHoleCards(deriveDeck(handSeed), [humanUserId, botSeat2, botSeat3]);
  const turnCommunity = toCardCodes(dealt.deck.slice(0, 4));
  const livePhases = new Set(["PREFLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN"]);
  const { dir, filePath } = await writePersistedFile({
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "OPEN", stakes: '{"sb":1,"bb":2}' },
        seatRows: [
          { user_id: humanUserId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 100 },
          { user_id: botSeat2, seat_no: 2, status: "ACTIVE", is_bot: true, stack: 100 },
          { user_id: botSeat3, seat_no: 3, status: "ACTIVE", is_bot: true, stack: 100 }
        ],
        stateRow: {
          version: 12,
          state: {
            tableId,
            roomId: tableId,
            handId: "hand_leave_live_cleanup",
            handSeed,
            phase: "TURN",
            dealerSeatNo: 1,
            seats: [
              { userId: humanUserId, seatNo: 1, status: "ACTIVE" },
              { userId: botSeat2, seatNo: 2, status: "ACTIVE", isBot: true },
              { userId: botSeat3, seatNo: 3, status: "ACTIVE", isBot: true }
            ],
            handSeats: [
              { userId: humanUserId, seatNo: 1, status: "ACTIVE" },
              { userId: botSeat2, seatNo: 2, status: "ACTIVE", isBot: true },
              { userId: botSeat3, seatNo: 3, status: "ACTIVE", isBot: true }
            ],
            stacks: {
              [humanUserId]: 100,
              [botSeat2]: 100,
              [botSeat3]: 100
            },
            community: turnCommunity,
            communityDealt: 4,
            currentBet: 0,
            toCallByUserId: {
              [humanUserId]: 0,
              [botSeat2]: 0,
              [botSeat3]: 0
            },
            betThisRoundByUserId: {
              [humanUserId]: 0,
              [botSeat2]: 0,
              [botSeat3]: 0
            },
            actedThisRoundByUserId: {
              [humanUserId]: true,
              [botSeat2]: true,
              [botSeat3]: false
            },
            lastBettingRoundActionByUserId: {
              [humanUserId]: "check",
              [botSeat2]: "check",
              [botSeat3]: null
            },
            foldedByUserId: {},
            leftTableByUserId: {},
            sitOutByUserId: {},
            pendingAutoSitOutByUserId: {},
            allInByUserId: {
              [humanUserId]: false,
              [botSeat2]: false,
              [botSeat3]: false
            },
            contributionsByUserId: {
              [humanUserId]: 10,
              [botSeat2]: 10,
              [botSeat3]: 10
            },
            turnUserId: botSeat3,
            turnNo: 1,
            pot: 30,
            potTotal: 30,
            sidePots: []
          }
        }
      }
    }
  });
  const leaveModule = await writeTestModule(`
import fs from "node:fs/promises";

export async function executePokerLeave({ tableId, userId, includeState = false }) {
  const raw = await fs.readFile(process.env.WS_PERSISTED_STATE_FILE, "utf8");
  const doc = JSON.parse(raw || "{}");
  const table = doc?.tables?.[tableId];
  if (!table) {
    return { ok: false, code: "table_not_found" };
  }

  const seatRows = Array.isArray(table.seatRows) ? table.seatRows : [];
  const seatRow = seatRows.find((row) => row?.user_id === userId) || null;
  const seatNo = Number.isInteger(Number(seatRow?.seat_no)) ? Number(seatRow.seat_no) : null;
  const currentVersion = Number(table?.stateRow?.version || 0);
  const state = table?.stateRow?.state && typeof table.stateRow.state === "object" && !Array.isArray(table.stateRow.state)
    ? table.stateRow.state
    : {};

  table.seatRows = seatRows.map((row) => (
    row?.user_id === userId
      ? { ...row, status: "INACTIVE", stack: 0 }
      : row
  ));

  const nextStateWithPrivate = {
    ...state,
    stacks: { ...(state.stacks || {}) },
    leftTableByUserId: { ...(state.leftTableByUserId || {}), [userId]: true },
    foldedByUserId: { ...(state.foldedByUserId || {}), [userId]: true },
    actedThisRoundByUserId: { ...(state.actedThisRoundByUserId || {}), [userId]: true },
    lastBettingRoundActionByUserId: { ...(state.lastBettingRoundActionByUserId || {}), [userId]: "fold" }
  };
  delete nextStateWithPrivate.stacks[userId];

    const { holeCardsByUserId: _ignoredHoleCards, deck: _ignoredDeck, ...publicState } = nextStateWithPrivate;

  table.stateRow = {
    version: currentVersion + 1,
    state: publicState
  };

  await fs.writeFile(process.env.WS_PERSISTED_STATE_FILE, JSON.stringify(doc) + "\\n", "utf8");

  return {
    ok: true,
    tableId,
    cashedOut: 0,
    seatNo,
    ...(includeState
      ? {
          state: {
            version: currentVersion + 1,
            state: publicState
          },
          viewState: publicState
        }
      : {})
  };
}
`, "leave-live-lobby-cleanup.mjs");
  const cleanupModule = await writeTestModule(`
import fs from "node:fs/promises";

export function createInactiveCleanupExecutor({ env }) {
  return async ({ tableId }) => {
    const raw = await fs.readFile(env.WS_PERSISTED_STATE_FILE, "utf8");
    const doc = JSON.parse(raw || "{}");
    const table = doc?.tables?.[tableId];
    if (!table) {
      return { ok: true, changed: false, status: "seat_missing", retryable: false };
    }

    table.tableRow = { ...(table.tableRow || {}), status: "CLOSED" };
    table.seatRows = (Array.isArray(table.seatRows) ? table.seatRows : []).map((row) => ({ ...row, status: "INACTIVE", stack: 0 }));
    const state = table?.stateRow?.state && typeof table.stateRow.state === "object" && !Array.isArray(table.stateRow.state)
      ? table.stateRow.state
      : {};
    table.stateRow = {
      version: Number(table?.stateRow?.version || 0),
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
        stacks: {}
      }
    };

    await fs.writeFile(env.WS_PERSISTED_STATE_FILE, JSON.stringify(doc) + "\\n", "utf8");
    return { ok: true, changed: true, status: "cleaned_closed", closed: true, retryable: false };
  };
}
`, "inactive-cleanup-leave-live-lobby.mjs");
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PERSISTED_STATE_FILE: filePath,
      WS_AUTHORITATIVE_LEAVE_MODULE_PATH: leaveModule.filePath,
      WS_INACTIVE_CLEANUP_ADAPTER_MODULE_PATH: cleanupModule.filePath,
      WS_POKER_SETTLED_REVEAL_MS: "80"
    }
  });

  try {
    await waitForListening(child, 5000);
    const serverLogs = [];
    child.stdout.on("data", (buf) => {
      const text = String(buf || "");
      if (
        text.includes("showdown_missing_hole_cards")
        || text.includes("apply_action_failed")
        || text.includes("ws_bot_autoplay_finish")
        || text.includes("ws_settled_rollover")
        || text.includes("showdown_incomplete_community")
      ) {
        serverLogs.push(text.trim());
      }
    });

    const humanWs = await connectClient(port);
    await hello(humanWs);
    await auth(humanWs, makeHs256Jwt({ secret, sub: humanUserId }), "auth-leave-live-human");
    sendFrame(humanWs, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "sub-leave-live-human",
      ts: "2026-02-28T00:00:01Z",
      payload: { tableId, view: "snapshot" }
    });
    const baseline = await nextMessageOfType(humanWs, "stateSnapshot");
    assert.equal(baseline.payload.public.hand.status, "TURN");

    const lobbyWs = await connectClient(port);
    await hello(lobbyWs);
    await auth(lobbyWs, makeHs256Jwt({ secret, sub: "leave_live_lobby_user" }), "auth-leave-live-lobby");
    sendFrame(lobbyWs, {
      version: "1.0",
      type: "lobby_subscribe",
      requestId: "lobby-leave-live",
      ts: "2026-02-28T00:00:02Z",
      payload: {}
    });
    const initialLobbySnapshot = await nextMessageOfType(lobbyWs, "lobby_snapshot");
    assert.equal(initialLobbySnapshot.payload.tables.some((table) => table?.tableId === tableId), true);

    sendFrame(humanWs, {
      version: "1.0",
      type: "table_leave",
      requestId: "leave-live-human",
      ts: "2026-02-28T00:00:03Z",
      payload: { tableId }
    });
    const leaveAck = await nextCommandResultForRequest(humanWs, "leave-live-human");
    assert.equal(leaveAck.payload.status, "accepted");

    let removedSnapshot = null;
    const observedLobbySnapshots = [];
    const removedDeadline = Date.now() + 8000;
    while (Date.now() < removedDeadline) {
      const remaining = Math.max(50, removedDeadline - Date.now());
      const frame = await attemptMessage(lobbyWs, Math.min(remaining, 1000));
      if (!frame) {
        continue;
      }
      if (frame?.type !== "lobby_snapshot" || !Array.isArray(frame?.payload?.tables)) {
        continue;
      }
      observedLobbySnapshots.push(frame.payload.tables.map((table) => ({
        tableId: table?.tableId || null,
        status: table?.status || null,
        live: table?.live === true,
        joinable: table?.joinable === true,
        humanCount: Number(table?.humanCount || 0),
        seatCount: Number(table?.seatCount || 0)
      })));
      if (!frame.payload.tables.some((table) => table?.tableId === tableId)) {
        removedSnapshot = frame;
        break;
      }
    }

    let finalPersisted = null;
    const finalDeadline = Date.now() + 8000;
    while (Date.now() < finalDeadline) {
      let current;
      try {
        current = await readPersistedFile(filePath);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      const table = current?.tables?.[tableId];
      const finalPhase = table?.stateRow?.state?.phase || null;
      if (table?.tableRow?.status === "CLOSED" && !livePhases.has(finalPhase)) {
        finalPersisted = current;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const finalTable = finalPersisted?.tables?.[tableId];
    assert.ok(
      removedSnapshot,
      `lobby table was not removed\nLOBBY:\n${JSON.stringify(observedLobbySnapshots)}\nLOGS:\n${serverLogs.slice(-40).join("\n")}\nFINAL:\n${JSON.stringify(finalTable || null, null, 2)}`
    );
    assert.deepEqual(removedSnapshot.payload.tables.some((table) => table?.tableId === tableId), false);
    assert.ok(finalTable, `missing final persisted table\nLOGS:\n${serverLogs.slice(-20).join("\n")}`);
    assert.equal(livePhases.has(finalTable.stateRow.state.phase), false);
    assert.equal(finalTable.tableRow.status, "CLOSED");
    assert.equal(serverLogs.some((line) => line.includes("showdown_missing_hole_cards")), false, serverLogs.join("\n"));
    assert.equal(serverLogs.some((line) => line.includes("showdown_incomplete_community")), false, serverLogs.join("\n"));
    assert.equal(serverLogs.some((line) => line.includes("\"reason\":\"apply_action_failed\"")), false, serverLogs.join("\n"));
    assert.equal(serverLogs.some((line) => line.includes("ws_bot_autoplay_finish") && line.includes("\"trigger\":\"leave\"")), true, serverLogs.join("\n"));

    humanWs.close();
    lobbyWs.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(leaveModule.dir, { recursive: true, force: true });
    await fs.rm(cleanupModule.dir, { recursive: true, force: true });
  }
});

test("table_leave authoritative close removes closed bots-only table from lobby immediately", async () => {
  const secret = "leave-closed-lobby-sync-secret";
  const humanUserId = "leave_closed_human";
  const tableId = "table_leave_closed_lobby_sync";
  const botSeat2 = makeBotUserId(tableId, 2);
  const botSeat3 = makeBotUserId(tableId, 3);
  const { dir, filePath } = await writePersistedFile({
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "OPEN", stakes: '{"sb":1,"bb":2}' },
        seatRows: [
          { user_id: humanUserId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 100 },
          { user_id: botSeat2, seat_no: 2, status: "ACTIVE", is_bot: true, stack: 100 },
          { user_id: botSeat3, seat_no: 3, status: "ACTIVE", is_bot: true, stack: 100 }
        ],
        stateRow: {
          version: 7,
          state: {
            tableId,
            roomId: tableId,
            phase: "HAND_DONE",
            handId: "",
            seats: [
              { userId: humanUserId, seatNo: 1, status: "ACTIVE" },
              { userId: botSeat2, seatNo: 2, status: "ACTIVE", isBot: true },
              { userId: botSeat3, seatNo: 3, status: "ACTIVE", isBot: true }
            ],
            stacks: {
              [humanUserId]: 100,
              [botSeat2]: 100,
              [botSeat3]: 100
            },
            leftTableByUserId: {}
          }
        }
      }
    }
  });
  const leaveModule = await writeTestModule(`
import fs from "node:fs/promises";

export async function executePokerLeave({ tableId, userId, includeState = false }) {
  const raw = await fs.readFile(process.env.WS_PERSISTED_STATE_FILE, "utf8");
  const doc = JSON.parse(raw || "{}");
  const table = doc?.tables?.[tableId];
  if (!table) {
    return { ok: false, code: "table_not_found" };
  }

  const seatRows = Array.isArray(table.seatRows) ? table.seatRows : [];
  const seatRow = seatRows.find((row) => row?.user_id === userId) || null;
  const seatNo = Number.isInteger(Number(seatRow?.seat_no)) ? Number(seatRow.seat_no) : null;
  const currentVersion = Number(table?.stateRow?.version || 0);
  const state = table?.stateRow?.state && typeof table.stateRow.state === "object" && !Array.isArray(table.stateRow.state)
    ? table.stateRow.state
    : {};

  table.tableRow = { ...(table.tableRow || {}), status: "CLOSED" };
  table.seatRows = seatRows.map((row) => (
    row?.user_id === userId
      ? { ...row, status: "INACTIVE", stack: 0 }
      : row
  ));

  const publicState = {
    ...state,
    phase: "HAND_DONE",
    handId: "",
    turnUserId: null,
    seats: [
      { userId, seatNo: 1, status: "ACTIVE" },
      { userId: "${botSeat2}", seatNo: 2, status: "ACTIVE", isBot: true },
      { userId: "${botSeat3}", seatNo: 3, status: "ACTIVE", isBot: true }
    ],
    stacks: {
      "${botSeat2}": 100,
      "${botSeat3}": 100
    },
    leftTableByUserId: {
      ...(state.leftTableByUserId || {}),
      [userId]: true
    }
  };

  table.stateRow = {
    version: currentVersion + 1,
    state: publicState
  };

  await fs.writeFile(process.env.WS_PERSISTED_STATE_FILE, JSON.stringify(doc) + "\\n", "utf8");

  return {
    ok: true,
    tableId,
    seatNo,
    cashedOut: 100,
    tableStatus: "CLOSED",
    ...(includeState
      ? {
          state: {
            version: currentVersion + 1,
            state: publicState
          },
          viewState: publicState
        }
      : {})
  };
}
`, "leave-closed-lobby-sync.mjs");
  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_PERSISTED_STATE_FILE: filePath,
      WS_AUTHORITATIVE_LEAVE_MODULE_PATH: leaveModule.filePath
    }
  });

  try {
    await waitForListening(child, 5000);

    const humanWs = await connectClient(port);
    await hello(humanWs);
    await auth(humanWs, makeHs256Jwt({ secret, sub: humanUserId }), "auth-leave-closed-human");
    sendFrame(humanWs, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "sub-leave-closed-human",
      ts: "2026-02-28T00:10:01Z",
      payload: { tableId, view: "snapshot" }
    });
    await nextMessageOfType(humanWs, "stateSnapshot");

    const lobbyWs = await connectClient(port);
    await hello(lobbyWs);
    await auth(lobbyWs, makeHs256Jwt({ secret, sub: "leave_closed_lobby_user" }), "auth-leave-closed-lobby");
    sendFrame(lobbyWs, {
      version: "1.0",
      type: "lobby_subscribe",
      requestId: "lobby-leave-closed",
      ts: "2026-02-28T00:10:02Z",
      payload: {}
    });
    const initialLobbySnapshot = await nextMessageOfType(lobbyWs, "lobby_snapshot");
    assert.equal(initialLobbySnapshot.payload.tables.some((table) => table?.tableId === tableId), true);

    sendFrame(humanWs, {
      version: "1.0",
      type: "table_leave",
      requestId: "leave-closed-human",
      ts: "2026-02-28T00:10:03Z",
      payload: { tableId }
    });
    const leaveAck = await nextCommandResultForRequest(humanWs, "leave-closed-human");
    assert.equal(leaveAck.payload.status, "accepted");

    const removedSnapshot = await nextMessageMatching(
      lobbyWs,
      (frame) => frame?.type === "lobby_snapshot"
        && Array.isArray(frame?.payload?.tables)
        && !frame.payload.tables.some((table) => table?.tableId === tableId),
      5000
    );
    assert.deepEqual(removedSnapshot.payload.tables.some((table) => table?.tableId === tableId), false);

    const persisted = await readPersistedFile(filePath);
    assert.equal(persisted.tables[tableId].tableRow.status, "CLOSED");
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(leaveModule.dir, { recursive: true, force: true });
  }
});

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

  const { port, child } = await createServer({ env: { WS_AUTH_REQUIRED: "1", WS_AUTH_TEST_SECRET: secret, WS_POKER_SETTLED_REVEAL_MS: "60000", SUPABASE_DB_URL: "", ...persistedBootstrapFixturesEnv(fixtures) } });

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

test("snapshot-only settled bootstrap schedules rollover without prior broadcast subscription", async () => {
  const secret = "test-secret";
  const token = makeHs256Jwt({ secret, sub: "user_a" });
  const tableId = "table_settled_snapshot_rollover";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [
        { user_id: "user_a", seat_no: 1, status: "ACTIVE", is_bot: false },
        { user_id: "user_b", seat_no: 2, status: "ACTIVE", is_bot: false }
      ],
      stateRow: {
        version: 21,
        state: {
          handId: "h21",
          phase: "SETTLED",
          dealerSeatNo: 1,
          community: [],
          communityDealt: 0,
          turnUserId: null,
          handSettlement: {
            reason: "computed",
            settledAt: new Date(Date.now()).toISOString(),
            winners: [{ userId: "user_a", amount: 12 }]
          },
          showdown: {
            reason: "computed",
            winners: [{ userId: "user_a", amount: 12 }]
          },
          stacks: { user_a: 112, user_b: 88 }
        }
      }
    }
  };

  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_POKER_SETTLED_REVEAL_MS: "50",
      SUPABASE_DB_URL: "",
      ...persistedBootstrapFixturesEnv(fixtures)
    }
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    const authOk = await auth(ws, token);
    assert.equal(authOk.type, "authOk");

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "req-snap-1", ts: "2026-02-28T00:00:03Z", payload: { tableId, view: "snapshot" } });
    const initialSnapshot = await nextMessageOfType(ws, "stateSnapshot");
    assert.equal(initialSnapshot.payload.public.hand.status, "SETTLED");

    await new Promise((resolve) => setTimeout(resolve, 150));

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "req-snap-2", ts: "2026-02-28T00:00:04Z", payload: { tableId, view: "snapshot" } });
    const rolledSnapshot = await nextMessageOfType(ws, "stateSnapshot");
    assert.equal(rolledSnapshot.payload.public.hand.status, "PREFLOP");
    assert.equal(rolledSnapshot.payload.stateVersion > initialSnapshot.payload.stateVersion, true);

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

  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_POKER_SETTLED_REVEAL_MS: "60000",
      SUPABASE_DB_URL: "",
      ...persistedBootstrapFixturesEnv(fixtures)
    }
  });

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

    const joinMessages = nextNMessages(wsA, 2, 3000);
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

    const [joinAckA, joinStateA] = await joinMessages;
    assert.equal(joinAckA.type, "commandResult");
    assert.equal(joinStateA.type, "table_state");
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
    let latestVersion = firstUpdate.payload.stateVersion;
    for (;;) {
      const maybeFrame = await attemptMessage(ws, 300);
      if (!maybeFrame) {
        break;
      }
      if (maybeFrame.type === "stateSnapshot") {
        latestVersion = maybeFrame.payload.stateVersion;
      }
    }

    sendFrame(ws, { version: "1.0", type: "act", requestId: "act-idem", ts: "2026-02-28T01:03:03Z", payload: { tableId, handId, action: "fold" } });
    const replayResult = await nextMessageOfType(ws, "commandResult");
    assert.equal(replayResult.payload.status, "accepted");
    assert.equal(await attemptMessage(ws, 300), null);

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-idem-after", ts: "2026-02-28T01:03:04Z", payload: { tableId, view: "snapshot" } });
    const afterReplay = await nextMessageOfType(ws, "stateSnapshot");
    assert.equal(afterReplay.payload.stateVersion, latestVersion);

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

    const settledUpdate = await nextStateUpdate(wsA, { baseline: base.payload, timeoutMs: 5000 });
    assert.equal(settledUpdate.frame.type, "stateSnapshot");
    assert.equal(settledUpdate.payload.stateVersion > base.payload.stateVersion, true);
    assert.equal(settledUpdate.payload.public.hand.status, "SETTLED");
    assert.equal(Number.isFinite(settledUpdate.payload.public.turn.startedAt), false);
    assert.equal(Number.isFinite(settledUpdate.payload.public.turn.deadlineAt), false);
    assert.equal(Object.prototype.hasOwnProperty.call(settledUpdate.payload.public, "holeCardsByUserId"), false);
    const nextHandUpdate = await nextStateUpdate(wsA, { baseline: settledUpdate.payload, timeoutMs: 5000 });
    assert.equal(nextHandUpdate.payload.public.hand.status, "PREFLOP");
    assert.equal(Number.isFinite(nextHandUpdate.payload.public.turn.startedAt), true);
    assert.equal(Number.isFinite(nextHandUpdate.payload.public.turn.deadlineAt), true);
    assert.equal(nextHandUpdate.payload.public.turn.deadlineAt > nextHandUpdate.payload.public.turn.startedAt, true);
    assert.equal(await attemptMessage(wsA, 300), null);

    wsA.close();
    wsB.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("timeout sweep plus queued bot step returns actionable human snapshot without state drift", async () => {
  const secret = "timeout-bot-secret";
  const humanUserId = "timeout_human";
  const botUserId = makeBotUserId("timeout_bot");
  const tableId = "table_timeout_bot_step_runtime";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [
        { user_id: humanUserId, seat_no: 1, status: "ACTIVE", is_bot: false },
        { user_id: botUserId, seat_no: 2, status: "ACTIVE", is_bot: true }
      ],
      stateRow: { version: 0, state: {} }
    }
  };

  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_POKER_TURN_MS: "350",
      WS_TIMEOUT_SWEEP_MS: "20",
      SUPABASE_DB_URL: "",
      ...observeOnlyJoinEnv(),
      ...persistedBootstrapFixturesEnv(fixtures)
    }
  });

  const isActionableHumanSnapshot = (payload) => {
    const turnUserId = payload?.public?.turn?.userId;
    const legalActions = Array.isArray(payload?.public?.legalActions?.actions)
      ? payload.public.legalActions.actions
      : [];
    return turnUserId === humanUserId && legalActions.length > 0;
  };

  try {
    await waitForListening(child, 5000);
    const serverLogs = [];
    child.stdout.on("data", (buf) => {
      const text = String(buf || "");
      if (text.includes("ws_bot_autoplay") || text.includes("ws_table_command_failed")) {
        serverLogs.push(text.trim());
      }
    });
    const humanWs = await connectClient(port);
    await hello(humanWs);
    await auth(humanWs, makeHs256Jwt({ secret, sub: humanUserId }), "auth-timeout-human");

    sendFrame(humanWs, { version: "1.0", type: "table_join", requestId: "join-timeout-human", ts: "2026-02-28T00:50:01Z", payload: { tableId } });
    const joinAck = await nextMessageOfType(humanWs, "commandResult");
    assert.equal(joinAck.payload.status, "accepted");
    await nextMessageOfType(humanWs, "table_state");

    sendFrame(humanWs, { version: "1.0", type: "table_state_sub", requestId: "snap-timeout-human-initial", ts: "2026-02-28T00:50:02Z", payload: { tableId, view: "snapshot" } });
    let current = await nextMessageOfType(humanWs, "stateSnapshot");
    let baseline = current.payload;

    if (!isActionableHumanSnapshot(baseline)) {
      const humanTurn = await nextMessageMatching(
        humanWs,
        (frame) => frame?.type === "stateSnapshot" && isActionableHumanSnapshot(frame.payload),
        7000
      );
      current = humanTurn;
      baseline = humanTurn.payload;
    }

    const beforeTimeoutVersion = Number(baseline.stateVersion || 0);
    const beforeTimeoutHandId = baseline?.public?.hand?.handId || null;
    assert.equal(isActionableHumanSnapshot(baseline), true);
    assert.equal(typeof beforeTimeoutHandId, "string");
    assert.equal(beforeTimeoutHandId.length > 0, true);

    const observedFrames = [];
    let afterTimeoutAndBotStep = null;
    const afterTimeoutDeadline = Date.now() + 9000;
    while (Date.now() < afterTimeoutDeadline) {
      const remaining = Math.max(50, afterTimeoutDeadline - Date.now());
      const frame = await attemptMessage(humanWs, Math.min(remaining, 1200));
      if (!frame) {
        continue;
      }
      observedFrames.push({
        type: frame.type,
        stateVersion: Number(frame?.payload?.stateVersion || 0),
        handId: frame?.payload?.public?.hand?.handId || null,
        turnUserId: frame?.payload?.public?.turn?.userId || null,
        legalActions: Array.isArray(frame?.payload?.public?.legalActions?.actions)
          ? frame.payload.public.legalActions.actions.slice()
          : []
      });
      if (
        frame?.type === "stateSnapshot"
        && isActionableHumanSnapshot(frame.payload)
        && Number(frame.payload?.stateVersion || 0) > beforeTimeoutVersion
      ) {
        afterTimeoutAndBotStep = frame;
        break;
      }
    }
    assert.ok(afterTimeoutAndBotStep, `${JSON.stringify(observedFrames)}\nLOGS:\n${serverLogs.slice(-20).join("\n")}`);

    const finalPayload = afterTimeoutAndBotStep.payload;
    const finalLegalActions = Array.isArray(finalPayload?.public?.legalActions?.actions)
      ? finalPayload.public.legalActions.actions
      : [];
    assert.equal(finalPayload.public.turn.userId, humanUserId);
    assert.equal(Number(finalPayload.stateVersion) > beforeTimeoutVersion, true);
    assert.equal(finalPayload.public.legalActions.seat, 1);
    assert.equal(finalLegalActions.length > 0, true);
    assert.equal(Object.prototype.hasOwnProperty.call(finalPayload.public, "holeCardsByUserId"), false);

    humanWs.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("queued timeout and bot runtime stays stable across many hands without state drift", async () => {
  const secret = "many-hands-secret";
  const humanUserId = "many_hands_human";
  const botUserId = makeBotUserId("many_hands_bot");
  const tableId = "table_many_hands_runtime";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [
        { user_id: humanUserId, seat_no: 1, status: "ACTIVE", is_bot: false },
        { user_id: botUserId, seat_no: 2, status: "ACTIVE", is_bot: true }
      ],
      stateRow: { version: 0, state: {} }
    }
  };

  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_POKER_TURN_MS: "300",
      WS_TIMEOUT_SWEEP_MS: "20",
      SUPABASE_DB_URL: "",
      ...observeOnlyJoinEnv(),
      ...persistedBootstrapFixturesEnv(fixtures)
    }
  });

  const actionableHumanSnapshot = (payload) => {
    const turnUserId = payload?.public?.turn?.userId;
    const legalActions = Array.isArray(payload?.public?.legalActions?.actions)
      ? payload.public.legalActions.actions
      : [];
    return turnUserId === humanUserId && legalActions.length > 0;
  };

  try {
    await waitForListening(child, 5000);
    const serverLogs = [];
    child.stdout.on("data", (buf) => {
      const text = String(buf || "");
      if (text.includes("ws_table_command_failed") || text.includes("ws_bot_autoplay_failed")) {
        serverLogs.push(text.trim());
      }
    });

    const humanWs = await connectClient(port);
    await hello(humanWs);
    await auth(humanWs, makeHs256Jwt({ secret, sub: humanUserId }), "auth-many-hands-human");

    sendFrame(humanWs, { version: "1.0", type: "table_join", requestId: "join-many-hands-human", ts: "2026-02-28T01:10:01Z", payload: { tableId } });
    const joinAck = await nextMessageOfType(humanWs, "commandResult");
    assert.equal(joinAck.payload.status, "accepted");
    await nextMessageOfType(humanWs, "table_state");

    sendFrame(humanWs, { version: "1.0", type: "table_state_sub", requestId: "snap-many-hands-initial", ts: "2026-02-28T01:10:02Z", payload: { tableId, view: "snapshot" } });

    const snapshotsByHandId = new Map();
    const observed = [];
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline && snapshotsByHandId.size < 3) {
      const remaining = Math.max(50, deadline - Date.now());
      const frame = await attemptMessage(humanWs, Math.min(remaining, 1200));
      if (!frame || frame.type !== "stateSnapshot") {
        continue;
      }
      if (!actionableHumanSnapshot(frame.payload)) {
        continue;
      }

      const handId = frame.payload?.public?.hand?.handId || null;
      const stateVersion = Number(frame.payload?.stateVersion || 0);
      const members = Array.isArray(frame.payload?.table?.members) ? frame.payload.table.members : [];
      const stacks = frame.payload?.public?.stacks && typeof frame.payload.public.stacks === "object"
        ? frame.payload.public.stacks
        : {};
      const potTotal = Number(frame.payload?.public?.pot?.total || 0);
      const legalActions = Array.isArray(frame.payload?.public?.legalActions?.actions)
        ? frame.payload.public.legalActions.actions.slice()
        : [];
      const chipTotal = Object.values(stacks).reduce((sum, value) => sum + Number(value || 0), 0) + potTotal;

      observed.push({
        handId,
        stateVersion,
        memberRows: members.map((member) => `${member.userId}:${member.seat}`).sort(),
        stackKeys: Object.keys(stacks).sort(),
        legalActions,
        chipTotal,
      });

      assert.equal(typeof handId, "string");
      assert.equal(handId.length > 0, true);
      assert.deepEqual(
        members.map((member) => `${member.userId}:${member.seat}`).sort(),
        [`${botUserId}:2`, `${humanUserId}:1`],
      );
      assert.deepEqual(Object.keys(stacks).sort(), [botUserId, humanUserId].sort());
      assert.equal(legalActions.length > 0, true);
      assert.equal(chipTotal, 200);

      const prior = snapshotsByHandId.get(handId);
      if (!prior || stateVersion > prior.stateVersion) {
        snapshotsByHandId.set(handId, { stateVersion, chipTotal, legalActions });
      }
    }

    assert.equal(snapshotsByHandId.size >= 3, true, `expected at least 3 actionable hands, saw ${snapshotsByHandId.size}: ${JSON.stringify(observed)}`);
    const orderedVersions = [...snapshotsByHandId.values()].map((entry) => entry.stateVersion);
    for (let i = 1; i < orderedVersions.length; i += 1) {
      assert.equal(orderedVersions[i] > orderedVersions[i - 1], true);
    }
    assert.deepEqual(serverLogs, []);

    humanWs.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("resync during your turn keeps actionable snapshot on the same live hand", async () => {
  const secret = "resync-turn-secret";
  const humanUserId = "resume_turn_human";
  const botUserId = makeBotUserId("resume_turn_bot");
  const tableId = "table_resume_turn_runtime";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [
        { user_id: humanUserId, seat_no: 1, status: "ACTIVE", is_bot: false },
        { user_id: botUserId, seat_no: 2, status: "ACTIVE", is_bot: true }
      ],
      stateRow: { version: 0, state: {} }
    }
  };

  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_POKER_TURN_MS: "2500",
      SUPABASE_DB_URL: "",
      ...observeOnlyJoinEnv(),
      ...persistedBootstrapFixturesEnv(fixtures)
    }
  });

  const isActionableHumanSnapshot = (payload) => {
    const turnUserId = payload?.public?.turn?.userId;
    const legalActions = Array.isArray(payload?.public?.legalActions?.actions)
      ? payload.public.legalActions.actions
      : [];
    return turnUserId === humanUserId && legalActions.length > 0;
  };

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: humanUserId }), "auth-resume-turn-human");

    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-resume-turn-human", ts: "2026-02-28T01:20:01Z", payload: { tableId } });
    const joinAck = await nextMessageOfType(ws, "commandResult");
    assert.equal(joinAck.payload.status, "accepted");
    await nextMessageOfType(ws, "table_state");

    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-resume-turn-human", ts: "2026-02-28T01:20:02Z", payload: { tableId, view: "snapshot" } });
    const firstTurn = await nextMessageMatching(
      ws,
      (frame) => frame?.type === "stateSnapshot" && isActionableHumanSnapshot(frame.payload),
      8000
    );

    const firstHandId = firstTurn.payload?.public?.hand?.handId || null;
    const firstSeq = Number(firstTurn.seq || 0);
    const firstLegalActions = Array.isArray(firstTurn.payload?.public?.legalActions?.actions)
      ? firstTurn.payload.public.legalActions.actions.slice().sort()
      : [];
    assert.equal(typeof firstHandId, "string");
    assert.equal(firstHandId.length > 0, true);
    assert.equal(firstSeq > 0, true);
    assert.equal(firstLegalActions.length > 0, true);

    ws.close();

    const ws2 = await connectClient(port);
    await hello(ws2);
    await auth(ws2, makeHs256Jwt({ secret, sub: humanUserId }), "auth-resume-turn-human-2");
    sendFrame(ws2, {
      version: "1.0",
      type: "resync",
      requestId: "resync-turn-human",
      roomId: tableId,
      ts: "2026-02-28T01:20:03Z",
      payload: { tableId, reason: "reconnect_during_turn" }
    });
    const resynced = await nextMessageOfType(ws2, "table_state");
    const resumedHandId = resynced.payload?.hand?.handId || null;
    const resumedLegalActions = Array.isArray(resynced.payload?.legalActions?.actions)
      ? resynced.payload.legalActions.actions.slice().sort()
      : Array.isArray(resynced.payload?.legalActions)
        ? resynced.payload.legalActions.slice().sort()
        : [];
    assert.equal(resynced.payload?.turn?.userId, humanUserId);
    assert.equal(resumedHandId, firstHandId);
    assert.deepEqual(resumedLegalActions, firstLegalActions);

    ws2.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("timeout during disconnect does not close active table and reconnect snapshot returns latest actionable state", async () => {
  const secret = "disconnect-timeout-secret";
  const humanUserId = "disconnect_timeout_human";
  const botUserId = makeBotUserId("disconnect_timeout_bot");
  const tableId = "table_disconnect_timeout_runtime";
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [
        { user_id: humanUserId, seat_no: 1, status: "ACTIVE", is_bot: false },
        { user_id: botUserId, seat_no: 2, status: "ACTIVE", is_bot: true }
      ],
      stateRow: { version: 0, state: {} }
    }
  };

  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      WS_POKER_TURN_MS: "350",
      WS_TIMEOUT_SWEEP_MS: "20",
      WS_PRESENCE_TTL_MS: "10000",
      SUPABASE_DB_URL: "",
      ...observeOnlyJoinEnv(),
      ...persistedBootstrapFixturesEnv(fixtures)
    }
  });

  const isActionableHumanSnapshot = (payload) => {
    const turnUserId = payload?.public?.turn?.userId;
    const legalActions = Array.isArray(payload?.public?.legalActions?.actions)
      ? payload.public.legalActions.actions
      : [];
    return turnUserId === humanUserId && legalActions.length > 0;
  };

  try {
    await waitForListening(child, 5000);
    const serverLogs = [];
    child.stdout.on("data", (buf) => {
      const text = String(buf || "");
      if (text.includes("table_closed") || text.includes("ws_table_command_failed")) {
        serverLogs.push(text.trim());
      }
    });

    const humanWs = await connectClient(port);
    const observerWs = await connectClient(port);
    await hello(humanWs);
    await hello(observerWs);
    await auth(humanWs, makeHs256Jwt({ secret, sub: humanUserId }), "auth-disconnect-timeout-human");
    await auth(observerWs, makeHs256Jwt({ secret, sub: "disconnect_timeout_observer" }), "auth-disconnect-timeout-observer");

    sendFrame(humanWs, { version: "1.0", type: "table_join", requestId: "join-disconnect-timeout-human", ts: "2026-02-28T01:25:01Z", payload: { tableId } });
    const joinAck = await nextMessageOfType(humanWs, "commandResult");
    assert.equal(joinAck.payload.status, "accepted");
    await nextMessageOfType(humanWs, "table_state");

    sendFrame(observerWs, { version: "1.0", type: "table_state_sub", requestId: "snap-disconnect-timeout-observer", ts: "2026-02-28T01:25:02Z", payload: { tableId } });
    await nextMessageOfType(observerWs, "table_state");

    sendFrame(humanWs, { version: "1.0", type: "table_state_sub", requestId: "snap-disconnect-timeout-human", ts: "2026-02-28T01:25:03Z", payload: { tableId, view: "snapshot" } });
    const firstTurn = await nextMessageMatching(
      humanWs,
      (frame) => frame?.type === "stateSnapshot" && isActionableHumanSnapshot(frame.payload),
      8000
    );

    const baselineVersion = Number(firstTurn.payload?.stateVersion || 0);
    assert.equal(baselineVersion > 0, true);

    humanWs.close();

    const observedFrames = [];
    let progressed = null;
    const progressedDeadline = Date.now() + 9000;
    while (Date.now() < progressedDeadline) {
      const remaining = Math.max(50, progressedDeadline - Date.now());
      const frame = await attemptMessage(observerWs, Math.min(remaining, 1200));
      if (!frame) {
        continue;
      }
      observedFrames.push({
        type: frame.type,
        stateVersion: Number(frame?.payload?.stateVersion || 0),
        handId: frame?.payload?.public?.hand?.handId || frame?.payload?.hand?.handId || null,
        turnUserId: frame?.payload?.public?.turn?.userId || frame?.payload?.turn?.userId || null,
        legalActions: Array.isArray(frame?.payload?.public?.legalActions?.actions)
          ? frame.payload.public.legalActions.actions.slice()
          : Array.isArray(frame?.payload?.legalActions?.actions)
            ? frame.payload.legalActions.actions.slice()
            : Array.isArray(frame?.payload?.legalActions)
              ? frame.payload.legalActions.slice()
              : []
      });
      if (
        frame?.type === "stateSnapshot"
        && frame?.payload?.public?.turn?.userId === humanUserId
        && Number(frame.payload?.stateVersion || 0) > baselineVersion
      ) {
        progressed = frame;
        break;
      }
    }
    assert.ok(progressed, `${JSON.stringify(observedFrames)}\nLOGS:\n${serverLogs.slice(-20).join("\n")}`);

    const expectedHandId = progressed.payload?.public?.hand?.handId || null;
    assert.equal(progressed.payload?.public?.turn?.userId, humanUserId);
    assert.equal(typeof expectedHandId, "string");
    assert.equal(expectedHandId.length > 0, true);

    const reconnectedWs = await connectClient(port);
    await hello(reconnectedWs);
    await auth(reconnectedWs, makeHs256Jwt({ secret, sub: humanUserId }), "auth-disconnect-timeout-human-2");
    sendFrame(reconnectedWs, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "snap-disconnect-timeout-human-reconnect",
      ts: "2026-02-28T01:25:04Z",
      payload: { tableId, view: "snapshot" }
    });
    const resynced = await nextMessageOfType(reconnectedWs, "stateSnapshot");
    const resumedLegalActions = Array.isArray(resynced.payload?.public?.legalActions?.actions)
      ? resynced.payload.public.legalActions.actions.slice().sort()
        : [];
    assert.equal(resynced.payload?.public?.turn?.userId, humanUserId);
    assert.equal(resynced.payload?.public?.hand?.handId, expectedHandId);
    assert.equal(resumedLegalActions.length > 0, true);
    assert.equal(Number(resynced.payload?.stateVersion || 0) >= Number(progressed.payload?.stateVersion || 0), true);
    assert.deepEqual(serverLogs, []);

    observerWs.close();
    reconnectedWs.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("human act against queued bots returns next actionable human snapshot", async () => {
  const secret = "human-bot-turn-secret";
  const humanUserId = "human_turn_user";
  const tableId = "table_human_bot_turn_runtime";
  const botSeat2 = makeBotUserId(tableId, 2);
  const botSeat3 = makeBotUserId(tableId, 3);
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [
        { user_id: humanUserId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 100 },
        { user_id: botSeat2, seat_no: 2, status: "ACTIVE", is_bot: true, stack: 100 },
        { user_id: botSeat3, seat_no: 3, status: "ACTIVE", is_bot: true, stack: 100 }
      ],
      stateRow: { version: 0, state: {} }
    }
  };

  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      SUPABASE_DB_URL: "",
      ...observeOnlyJoinEnv(),
      ...persistedBootstrapFixturesEnv(fixtures)
    }
  });

  const isActionableHumanSnapshot = (payload) => {
    const turnUserId = payload?.public?.turn?.userId;
    const legalActions = Array.isArray(payload?.public?.legalActions?.actions)
      ? payload.public.legalActions.actions
      : [];
    return turnUserId === humanUserId && legalActions.length > 0;
  };

  try {
    await waitForListening(child, 5000);
    const serverLogs = [];
    child.stdout.on("data", (buf) => {
      const text = String(buf || "");
      if (text.includes("ws_bot_autoplay") || text.includes("ws_table_command_failed")) {
        serverLogs.push(text.trim());
      }
    });
    const humanWs = await connectClient(port);
    await hello(humanWs);
    await auth(humanWs, makeHs256Jwt({ secret, sub: humanUserId }), "auth-human-bot-turn");

    sendFrame(humanWs, { version: "1.0", type: "table_join", requestId: "join-human-bot-turn", ts: "2026-02-28T00:55:01Z", payload: { tableId } });
    const joinAck = await nextMessageOfType(humanWs, "commandResult");
    assert.equal(joinAck.payload.status, "accepted");
    await nextMessageOfType(humanWs, "table_state");

    sendFrame(humanWs, { version: "1.0", type: "table_state_sub", requestId: "snap-human-bot-turn-baseline", ts: "2026-02-28T00:55:02Z", payload: { tableId, view: "snapshot" } });
    let baselineSnapshot = await nextMessageOfType(humanWs, "stateSnapshot");
    if (baselineSnapshot.payload?.public?.hand?.status === "LOBBY") {
      sendFrame(humanWs, { version: "1.0", type: "start_hand", requestId: "start-human-bot-turn", ts: "2026-02-28T00:55:02Z", payload: { tableId } });
      const startAck = await nextCommandResultForRequest(humanWs, "start-human-bot-turn");
      assert.equal(["accepted", "rejected"].includes(startAck.payload.status), true);
      if (startAck.payload.status === "rejected") {
        assert.equal(startAck.payload.reason, "already_live");
      }
      baselineSnapshot = await nextMessageMatching(
        humanWs,
        (frame) => frame?.type === "stateSnapshot",
        15000
      );
    }

    const firstHumanTurn = isActionableHumanSnapshot(baselineSnapshot.payload)
      ? baselineSnapshot
      : await nextMessageMatching(
          humanWs,
          (frame) => frame?.type === "stateSnapshot" && isActionableHumanSnapshot(frame.payload),
          15000
        );

    const firstPayload = firstHumanTurn.payload;
    const handId = firstPayload?.public?.hand?.handId;
    const legalActions = Array.isArray(firstPayload?.public?.legalActions?.actions)
      ? firstPayload.public.legalActions.actions
      : [];
    assert.equal(typeof handId, "string");
    assert.equal(handId.length > 0, true);
    assert.equal(legalActions.length > 0, true);

    const action = legalActions.includes("CALL")
      ? "call"
      : legalActions.includes("CHECK")
        ? "check"
        : "fold";
    sendFrame(humanWs, {
      version: "1.0",
      type: "act",
      requestId: "act-human-bot-turn",
      ts: "2026-02-28T00:55:03Z",
      payload: { tableId, handId, action }
    });
    const actAck = await nextCommandResultForRequest(humanWs, "act-human-bot-turn");
    assert.equal(actAck.payload.status, "accepted");

    const observedFrames = [];
    let secondHumanTurn = null;
    const secondTurnDeadline = Date.now() + 8000;
    while (Date.now() < secondTurnDeadline) {
      const remaining = Math.max(50, secondTurnDeadline - Date.now());
      const frame = await attemptMessage(humanWs, Math.min(remaining, 1200));
      if (!frame) {
        continue;
      }
      observedFrames.push({
        type: frame.type,
        stateVersion: Number(frame?.payload?.stateVersion || 0),
        turnUserId: frame?.payload?.public?.turn?.userId || null,
        legalActions: Array.isArray(frame?.payload?.public?.legalActions?.actions)
          ? frame.payload.public.legalActions.actions.slice()
          : []
      });
      if (
        frame?.type === "stateSnapshot"
        && isActionableHumanSnapshot(frame.payload)
        && Number(frame.payload?.stateVersion || 0) > Number(firstPayload?.stateVersion || 0)
      ) {
        secondHumanTurn = frame;
        break;
      }
    }
    assert.ok(secondHumanTurn, `${JSON.stringify(observedFrames)}\nLOGS:\n${serverLogs.slice(-20).join("\n")}`);

    const secondPayload = secondHumanTurn.payload;
    const secondLegalActions = Array.isArray(secondPayload?.public?.legalActions?.actions)
      ? secondPayload.public.legalActions.actions
      : [];
    assert.equal(secondPayload.public.turn.userId, humanUserId);
    assert.equal(Number(secondPayload.stateVersion) > Number(firstPayload.stateVersion), true);
    assert.equal(secondLegalActions.length > 0, true);
    assert.equal(Object.prototype.hasOwnProperty.call(secondPayload.public, "holeCardsByUserId"), false);

    humanWs.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
  }
});

test("observer snapshot stays public-state consistent with seated snapshot after queued bot progression", async () => {
  const secret = "observer-public-consistency-secret";
  const humanUserId = "observer_public_human";
  const observerUserId = "observer_public_observer";
  const tableId = "table_observer_public_consistency";
  const botSeat2 = makeBotUserId(tableId, 2);
  const botSeat3 = makeBotUserId(tableId, 3);
  const fixtures = {
    [tableId]: {
      tableRow: { id: tableId, max_players: 6, status: "active" },
      seatRows: [
        { user_id: humanUserId, seat_no: 1, status: "ACTIVE", is_bot: false, stack: 100 },
        { user_id: botSeat2, seat_no: 2, status: "ACTIVE", is_bot: true, stack: 100 },
        { user_id: botSeat3, seat_no: 3, status: "ACTIVE", is_bot: true, stack: 100 }
      ],
      stateRow: { version: 0, state: {} }
    }
  };

  const { port, child } = await createServer({
    env: {
      WS_AUTH_REQUIRED: "1",
      WS_AUTH_TEST_SECRET: secret,
      SUPABASE_DB_URL: "",
      ...observeOnlyJoinEnv(),
      ...persistedBootstrapFixturesEnv(fixtures)
    }
  });

  const isActionableHumanSnapshot = (payload) => {
    const turnUserId = payload?.public?.turn?.userId;
    const legalActions = Array.isArray(payload?.public?.legalActions?.actions)
      ? payload.public.legalActions.actions
      : [];
    return turnUserId === humanUserId && legalActions.length > 0;
  };

  try {
    await waitForListening(child, 5000);
    const humanWs = await connectClient(port);
    const observerWs = await connectClient(port);
    await hello(humanWs);
    await hello(observerWs);
    await auth(humanWs, makeHs256Jwt({ secret, sub: humanUserId }), "auth-observer-public-human");
    await auth(observerWs, makeHs256Jwt({ secret, sub: observerUserId }), "auth-observer-public-observer");

    sendFrame(humanWs, { version: "1.0", type: "table_join", requestId: "join-observer-public-human", ts: "2026-02-28T01:30:01Z", payload: { tableId } });
    const humanJoinAck = await nextMessageOfType(humanWs, "commandResult");
    assert.equal(humanJoinAck.payload.status, "accepted");
    await nextMessageOfType(humanWs, "table_state");

    sendFrame(observerWs, { version: "1.0", type: "table_join", requestId: "join-observer-public-observer", ts: "2026-02-28T01:30:02Z", payload: { tableId } });
    const observerJoinAck = await nextMessageOfType(observerWs, "commandResult");
    assert.equal(observerJoinAck.payload.status, "accepted");

    sendFrame(humanWs, { version: "1.0", type: "table_state_sub", requestId: "snap-observer-public-human-initial", ts: "2026-02-28T01:30:03Z", payload: { tableId, view: "snapshot" } });
    let baselineSnapshot = await nextMessageOfType(humanWs, "stateSnapshot");
    if (baselineSnapshot.payload?.public?.hand?.status === "LOBBY") {
      sendFrame(humanWs, { version: "1.0", type: "start_hand", requestId: "start-observer-public-human", ts: "2026-02-28T01:30:03Z", payload: { tableId } });
      const startAck = await nextCommandResultForRequest(humanWs, "start-observer-public-human");
      assert.equal(["accepted", "rejected"].includes(startAck.payload.status), true);
      if (startAck.payload.status === "rejected") {
        assert.equal(startAck.payload.reason, "already_live");
      }
      baselineSnapshot = await nextMessageMatching(
        humanWs,
        (frame) => frame?.type === "stateSnapshot",
        8000
      );
    }

    const firstHumanTurn = isActionableHumanSnapshot(baselineSnapshot.payload)
      ? baselineSnapshot
      : await nextMessageMatching(
          humanWs,
          (frame) => frame?.type === "stateSnapshot" && isActionableHumanSnapshot(frame.payload),
          8000
        );

    const firstPayload = firstHumanTurn.payload;
    const handId = firstPayload?.public?.hand?.handId;
    const legalActions = Array.isArray(firstPayload?.public?.legalActions?.actions)
      ? firstPayload.public.legalActions.actions
      : [];
    assert.equal(typeof handId, "string");
    assert.equal(handId.length > 0, true);
    assert.equal(legalActions.length > 0, true);

    const action = legalActions.includes("CALL")
      ? "call"
      : legalActions.includes("CHECK")
        ? "check"
        : "fold";
    sendFrame(humanWs, {
      version: "1.0",
      type: "act",
      requestId: "act-observer-public-human",
      ts: "2026-02-28T01:30:04Z",
      payload: { tableId, handId, action }
    });
    const actAck = await nextCommandResultForRequest(humanWs, "act-observer-public-human");
    assert.equal(actAck.payload.status, "accepted");

    const secondHumanTurn = await nextMessageMatching(
      humanWs,
      (frame) =>
        frame?.type === "stateSnapshot"
        && isActionableHumanSnapshot(frame.payload)
        && Number(frame.payload?.stateVersion || 0) > Number(firstPayload?.stateVersion || 0),
      15000
    );

    const seatedPayload = secondHumanTurn.payload;
    assert.equal(seatedPayload.public.turn.userId, humanUserId);
    assert.equal(seatedPayload.public.legalActions.seat, 1);
    assert.equal(Array.isArray(seatedPayload.private?.holeCards), true);
    assert.equal(seatedPayload.private.holeCards.length, 2);

    sendFrame(observerWs, { version: "1.0", type: "table_state_sub", requestId: "snap-observer-public-observer-final", ts: "2026-02-28T01:30:05Z", payload: { tableId, view: "snapshot" } });
    const observerSnapshot = await nextMessageOfType(observerWs, "stateSnapshot");

    assert.equal(observerSnapshot.payload.stateVersion, seatedPayload.stateVersion);
    assert.deepEqual(observerSnapshot.payload.table, seatedPayload.table);
    assert.deepEqual(observerSnapshot.payload.you, { userId: observerUserId, seat: null });
    assert.equal("private" in observerSnapshot.payload, false);
    assert.deepEqual(observerSnapshot.payload.public, {
      ...seatedPayload.public,
      legalActions: { seat: null, actions: [] },
      actionConstraints: { toCall: null, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null }
    });
    assert.equal(observerSnapshot.payload.table.memberCount, observerSnapshot.payload.table.members.length);
    assert.equal(Object.prototype.hasOwnProperty.call(observerSnapshot.payload.public, "holeCardsByUserId"), false);

    humanWs.close();
    observerWs.close();
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
      WS_SEATED_RECONNECT_GRACE_MS: "0",
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

test("WS act optimistic conflict returns deterministic rejection and restored snapshot without forced resync", async () => {
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
    let rejected = null;
    let restored = null;
    let highestSnapshotVersion = 0;
    const conflictDeadline = Date.now() + 10000;
    while ((!rejected || !restored) && Date.now() < conflictDeadline) {
      const remaining = Math.max(50, conflictDeadline - Date.now());
      const frame = await nextMessage(ws, remaining);
      if (!rejected && frame?.type === "commandResult") {
        rejected = frame;
        continue;
      }
      if (frame?.type === "stateSnapshot") {
        const version = Number(frame?.payload?.stateVersion || 0);
        if (version > highestSnapshotVersion) highestSnapshotVersion = version;
        if (!restored && version === forced.tables[tableId].stateRow.version) {
          restored = frame;
        }
      }
    }
    assert.ok(rejected, "expected commandResult after optimistic conflict");
    assert.ok(restored, `expected restored stateSnapshot after optimistic conflict (max_seen=${highestSnapshotVersion})`);
    assert.equal(rejected.payload.status, "rejected");
    assert.equal(rejected.payload.reason, "conflict");
    assert.equal(restored.type, "stateSnapshot");
    assert.equal(restored.payload.stateVersion, forced.tables[tableId].stateRow.version);

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

test("optimistic conflict restore to settled state still schedules delayed rollover", async () => {
  const secret = "persist-conflict-settled-secret";
  const tableId = "table_ws_persist_conflict_settled";
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
      WS_POKER_SETTLED_REVEAL_MS: "50"
    }
  });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "seat_actor" }), "auth-conflict-settled");
    sendFrame(ws, { version: "1.0", type: "table_join", requestId: "join-conflict-settled", ts: "2026-02-28T02:10:00Z", payload: { tableId } });
    await nextMessageOfType(ws, "commandResult");
    await nextMessageOfType(ws, "table_state");
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-conflict-settled", ts: "2026-02-28T02:10:01Z", payload: { tableId, view: "snapshot" } });
    const baseline = await nextMessageOfType(ws, "stateSnapshot");
    const handId = baseline.payload.public.hand.handId;

    const forced = await readPersistedFile(filePath);
    const nextVersion = baseline.payload.stateVersion + 7;
    const settledState = {
      ...forced.tables[tableId].stateRow.state,
      phase: "SETTLED",
      turnUserId: null,
      turnStartedAt: null,
      turnDeadlineAt: null,
      showdown: {
        handId,
        winners: ["seat_actor"],
        reason: "computed"
      },
      handSettlement: {
        handId,
        settledAt: new Date(Date.now()).toISOString(),
        payouts: { seat_actor: 3 }
      }
    };
    forced.tables[tableId].stateRow.version = nextVersion;
    forced.tables[tableId].stateRow.state = settledState;
    await fs.writeFile(filePath, `${JSON.stringify(forced)}\n`, "utf8");

    sendFrame(ws, { version: "1.0", type: "act", requestId: "act-conflict-settled", ts: "2026-02-28T02:10:02Z", payload: { tableId, handId, action: "fold" } });
    const rejected = await nextMessageOfType(ws, "commandResult");
    assert.equal(rejected.payload.status, "rejected");
    assert.equal(rejected.payload.reason, "conflict");

    await new Promise((resolve) => setTimeout(resolve, 150));
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-conflict-settled-after", ts: "2026-02-28T02:10:03Z", payload: { tableId, view: "snapshot" } });
    const rolledSnapshot = await nextMessageOfType(ws, "stateSnapshot");
    assert.equal(rolledSnapshot.payload.public.hand.status, "PREFLOP");
    assert.equal(rolledSnapshot.payload.stateVersion > nextVersion, true);
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

test("failed timeout persistence restores persisted state without forcing resync", async () => {
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

    const snapshotAndRecovery = nextNMessages(ws, 2, 10000);
    sendFrame(ws, { version: "1.0", type: "table_state_sub", requestId: "snap-timeout-before", ts: "2026-02-28T02:30:01Z", payload: { tableId, view: "snapshot" } });
    const [first, second] = await snapshotAndRecovery;
    const baseline = first.type === "stateSnapshot" ? first : second;
    const recovered = first.type === "stateSnapshot" && second.type === "stateSnapshot" ? second : first.type === "stateSnapshot" ? null : second;

    assert.equal(baseline.type, "stateSnapshot");
    if (recovered) {
      assert.equal(recovered.type, "stateSnapshot");
      assert.equal(recovered.payload.stateVersion, baseline.payload.stateVersion);
    }

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


test("authoritative join with historical non-ACTIVE seat retries to the next seat", async () => {
  const secret = "auth-join-historical-seat-secret";
  const tableId = "table_auth_join_historical_non_active";
  const store = {
    tables: {
      [tableId]: {
        tableRow: { id: tableId, max_players: 6, status: "OPEN" },
        seatRows: [{ user_id: "historical_user", seat_no: 1, status: "INACTIVE", is_bot: false }],
        stateRow: { version: 1, state: { tableId, seats: [], stacks: {}, phase: "INIT", pot: 0 } }
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
    const ack = await nextCommandResultForRequest(ws, "join-historical");
    assert.equal(ack.payload.status, "accepted");
    sendFrame(ws, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "join-historical-sub",
      ts: "2026-02-28T05:50:01Z",
      payload: { tableId }
    });
    const state = await nextMessageOfType(ws, "table_state");
    assert.deepEqual(state.payload.seats, [
      { userId: "historical_user", seatNo: 2, status: "ACTIVE" }
    ]);
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
