import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createRequire } from "node:module";
import { makeBotUserId } from "../shared/poker-domain/bots.mjs";

const require = createRequire(new URL("../ws-server/package.json", import.meta.url));
const WebSocket = require("ws");

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

async function nextMessageMatching(ws, predicate, options = {}) {
  const opts = typeof options === "number" ? { timeoutMs: options } : (options || {});
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 10000;
  const description = opts.description || "matching websocket message";
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
  throw new Error(`Timed out waiting for ${description}`);
}

function nextCommandResultForRequest(ws, requestId, timeoutMs = 10000) {
  return nextMessageMatching(
    ws,
    (frame) => frame?.type === "commandResult" && frame?.payload?.requestId === requestId,
    { timeoutMs, description: `commandResult for request ${requestId}` }
  );
}

function isStableReplayJoinState(frame, { tableId, userId, botSeat2, botSeat3 }) {
  if (frame?.type !== "table_state") return false;
  if (frame?.payload?.tableId !== tableId) return false;
  const members = Array.isArray(frame?.payload?.authoritativeMembers) ? frame.payload.authoritativeMembers : [];
  const seats = Array.isArray(frame?.payload?.seats) ? frame.payload.seats : [];
  if (members.length !== 3 || seats.length !== 3) return false;
  const expectedMembers = [
    { userId, seat: 1 },
    { userId: botSeat2, seat: 2 },
    { userId: botSeat3, seat: 3 }
  ];
  const expectedSeats = [
    { userId, seatNo: 1, status: "ACTIVE" },
    { userId: botSeat2, seatNo: 2, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" },
    { userId: botSeat3, seatNo: 3, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" }
  ];
  try {
    assert.deepEqual(members, expectedMembers);
    assert.deepEqual(seats, expectedSeats);
    return true;
  } catch (_err) {
    return false;
  }
}

async function nextJoinReplayOutcome(ws, { requestId, tableId, userId, botSeat2, botSeat3, timeoutMs = 10000 }) {
  return nextMessageMatching(
    ws,
    (frame) => {
      if (frame?.type === "commandResult" && frame?.payload?.requestId === requestId) return true;
      return isStableReplayJoinState(frame, { tableId, userId, botSeat2, botSeat3 });
    },
    { timeoutMs, description: `replay outcome for request ${requestId}` }
  );
}

function pickNonTerminalHumanAction(snapshotPayload) {
  const actions = Array.isArray(snapshotPayload?.public?.legalActions?.actions)
    ? snapshotPayload.public.legalActions.actions
    : [];
  if (actions.includes("CHECK")) return { action: "check" };
  if (actions.includes("CALL")) return { action: "call" };
  if (actions.includes("BET")) {
    const amount = Number(snapshotPayload?.public?.actionConstraints?.maxBetAmount);
    return { action: "bet", amount: Number.isFinite(amount) && amount > 0 ? amount : 1 };
  }
  if (actions.includes("RAISE")) {
    const amount = Number(snapshotPayload?.public?.actionConstraints?.minRaiseTo);
    return { action: "raise", amount: Number.isFinite(amount) && amount > 0 ? amount : 2 };
  }
  if (actions.includes("FOLD")) return { action: "fold" };
  return null;
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

async function waitForHumanTurn(ws, { userId, baseline, timeoutMs = 5000 }) {
  let current = baseline;
  if (current?.public?.turn?.userId === userId) {
    return current;
  }

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const next = await nextStateUpdate(ws, { baseline: current, timeoutMs: timeoutMs - (Date.now() - started) });
    current = next.payload;
    if (current?.public?.turn?.userId === userId) {
      return current;
    }
  }

  throw new Error(`Timed out waiting for ${userId} turn`);
}

function sendFrame(ws, frame) {
  ws.send(JSON.stringify(frame));
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

function runtimeJoinEnv({ secret, filePath }) {
  return {
    WS_AUTH_REQUIRED: "1",
    WS_AUTH_TEST_SECRET: secret,
    WS_PERSISTED_STATE_FILE: filePath,
    WS_AUTHORITATIVE_JOIN_ENABLED: "1",
    POKER_BOTS_ENABLED: "1",
    POKER_BOTS_MAX_PER_TABLE: "2",
    POKER_BOT_BUYIN_BB: "100",
    POKER_BOT_PROFILE_DEFAULT: "TRIVIAL",
    WS_POKER_TURN_MS: "80",
    WS_TIMEOUT_SWEEP_MS: "20"
  };
}

test("authoritative WS table_join rehydrates a live runtime snapshot and resync keeps authoritative seats aligned", async () => {
  const secret = "auth-join-runtime-secret";
  const tableId = "table_auth_join_runtime";
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
  const { port, child } = await createServer({ env: runtimeJoinEnv({ secret, filePath }) });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "runtime_human" }), "auth-runtime");

    sendFrame(ws, {
      version: "1.0",
      type: "table_join",
      requestId: "join-runtime",
      ts: "2026-02-28T06:10:00Z",
      payload: { tableId, seatNo: 1, buyIn: 150 }
    });
    const joinAck = await nextCommandResultForRequest(ws, "join-runtime");
    assert.equal(joinAck.payload.status, "accepted");

    sendFrame(ws, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "join-runtime-state",
      ts: "2026-02-28T06:10:01Z",
      payload: { tableId }
    });
    const joinedState = await nextMessageOfType(ws, "table_state");
    assert.deepEqual(joinedState.payload.authoritativeMembers, [
      { userId: "runtime_human", seat: 1 },
      { userId: botSeat2, seat: 2 },
      { userId: botSeat3, seat: 3 }
    ]);
    assert.equal(joinedState.payload.members.some((entry) => entry.userId === "runtime_human"), true);
    assert.equal(joinedState.payload.members.some((entry) => entry.userId === botSeat2), false);
    assert.equal(joinedState.payload.hand.status, "PREFLOP");
    assert.equal(typeof joinedState.payload.hand.handId, "string");
    assert.deepEqual(joinedState.payload.seats, [
      { userId: "runtime_human", seatNo: 1, status: "ACTIVE" },
      { userId: botSeat2, seatNo: 2, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" },
      { userId: botSeat3, seatNo: 3, status: "ACTIVE", isBot: true, botProfile: "TRIVIAL" }
    ]);
    assert.equal(typeof joinedState.payload.stacks.runtime_human, "number");
    assert.equal(typeof joinedState.payload.stacks[botSeat2], "number");
    assert.equal(typeof joinedState.payload.stacks[botSeat3], "number");

    sendFrame(ws, {
      version: "1.0",
      type: "resync",
      requestId: "join-runtime-resync",
      ts: "2026-02-28T06:10:02Z",
      payload: { tableId }
    });
    const resyncedState = await nextMessageOfType(ws, "table_state");
    assert.deepEqual(resyncedState.payload.authoritativeMembers, joinedState.payload.authoritativeMembers);
    assert.deepEqual(resyncedState.payload.seats, joinedState.payload.seats);
    assert.deepEqual(resyncedState.payload.stacks, joinedState.payload.stacks);
    assert.equal(resyncedState.payload.hand.handId, joinedState.payload.hand.handId);

    sendFrame(ws, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "join-runtime-snapshot",
      ts: "2026-02-28T06:10:03Z",
      payload: { tableId, view: "snapshot" }
    });
    const snapshot = await nextMessageOfType(ws, "stateSnapshot");
    assert.equal(snapshot.payload.public.hand.status, "PREFLOP");
    assert.equal(snapshot.payload.public.hand.handId, joinedState.payload.hand.handId);
    assert.equal(snapshot.payload.you.seat, 1);
    assert.equal(snapshot.payload.private.holeCards.length, 2);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("authoritative WS table_join can progress through human act and bot timeout autoplay", async () => {
  const secret = "auth-join-act-secret";
  const tableId = "table_auth_join_act";
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
  const { port, child } = await createServer({ env: runtimeJoinEnv({ secret, filePath }) });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "act_human" }), "auth-act-runtime");

    sendFrame(ws, {
      version: "1.0",
      type: "table_join",
      requestId: "join-act-runtime",
      ts: "2026-02-28T06:20:00Z",
      payload: { tableId, seatNo: 1, buyIn: 150 }
    });
    const joinAck = await nextCommandResultForRequest(ws, "join-act-runtime");
    assert.equal(joinAck.payload.status, "accepted");

    sendFrame(ws, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "join-act-snapshot",
      ts: "2026-02-28T06:20:01Z",
      payload: { tableId, view: "snapshot" }
    });
    const initialSnapshot = await nextMessageOfType(ws, "stateSnapshot");
    const humanTurnSnapshot = await waitForHumanTurn(ws, {
      userId: "act_human",
      baseline: initialSnapshot.payload,
      timeoutMs: 5000
    });
    const chosenAction = pickNonTerminalHumanAction(humanTurnSnapshot);
    assert.ok(chosenAction, "expected at least one legal human action");

    const actFrame = {
      version: "1.0",
      type: "act",
      requestId: "act-runtime-human",
      ts: "2026-02-28T06:20:02Z",
      payload: {
        tableId,
        handId: humanTurnSnapshot.public.hand.handId,
        action: chosenAction.action
      }
    };
    if (Number.isFinite(chosenAction.amount)) {
      actFrame.payload.amount = chosenAction.amount;
    }

    sendFrame(ws, actFrame);
    const actAck = await nextCommandResultForRequest(ws, "act-runtime-human");
    assert.equal(actAck.payload.status, "accepted");

    const afterHumanAction = await nextStateUpdate(ws, {
      baseline: humanTurnSnapshot,
      timeoutMs: 4000
    });
    assert.equal(afterHumanAction.payload.stateVersion > humanTurnSnapshot.stateVersion, true);
    assert.equal(afterHumanAction.payload.public.hand.handId, humanTurnSnapshot.public.hand.handId);

    const afterBotAutoplay = await nextStateUpdate(ws, {
      baseline: afterHumanAction.payload,
      timeoutMs: 5000
    });
    assert.equal(afterBotAutoplay.payload.stateVersion > afterHumanAction.payload.stateVersion, true);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("authoritative repeated and replayed table_join keep bot seating stable and still allow later act flow", async () => {
  const secret = "auth-join-replay-secret";
  const tableId = "table_auth_join_replay";
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
  const { port, child } = await createServer({ env: runtimeJoinEnv({ secret, filePath }) });

  try {
    await waitForListening(child, 5000);
    const ws = await connectClient(port);
    await hello(ws);
    await auth(ws, makeHs256Jwt({ secret, sub: "replay_human" }), "auth-replay");

    sendFrame(ws, {
      version: "1.0",
      type: "table_join",
      requestId: "join-replay-runtime",
      ts: "2026-02-28T06:30:00Z",
      payload: { tableId, seatNo: 1, buyIn: 150 }
    });
    const firstAck = await nextCommandResultForRequest(ws, "join-replay-runtime");
    assert.equal(firstAck.payload.status, "accepted");

    sendFrame(ws, {
      version: "1.0",
      type: "table_join",
      requestId: "join-replay-runtime",
      ts: "2026-02-28T06:30:01Z",
      payload: { tableId, seatNo: 1, buyIn: 150 }
    });
    sendFrame(ws, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "join-replay-runtime-state-check",
      ts: "2026-02-28T06:30:01Z",
      payload: { tableId }
    });
    const replayOutcome = await nextJoinReplayOutcome(ws, {
      requestId: "join-replay-runtime",
      tableId,
      userId: "replay_human",
      botSeat2,
      botSeat3,
      timeoutMs: 10000
    });
    if (replayOutcome.type === "commandResult") {
      assert.equal(replayOutcome.payload.status, "accepted");
    } else {
      assert.equal(isStableReplayJoinState(replayOutcome, { tableId, userId: "replay_human", botSeat2, botSeat3 }), true);
    }

    sendFrame(ws, {
      version: "1.0",
      type: "table_join",
      requestId: "join-repeat-runtime",
      ts: "2026-02-28T06:30:02Z",
      payload: { tableId, seatNo: 1, buyIn: 150 }
    });
    const repeatAck = await nextCommandResultForRequest(ws, "join-repeat-runtime");
    assert.equal(repeatAck.payload.status, "accepted");
    assert.equal(repeatAck.payload.reason, "already_joined");

    sendFrame(ws, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "join-replay-state",
      ts: "2026-02-28T06:30:03Z",
      payload: { tableId }
    });
    const state = await nextMessageOfType(ws, "table_state");
    assert.deepEqual(state.payload.authoritativeMembers, [
      { userId: "replay_human", seat: 1 },
      { userId: botSeat2, seat: 2 },
      { userId: botSeat3, seat: 3 }
    ]);
    assert.equal(state.payload.seats.length, 3);

    sendFrame(ws, {
      version: "1.0",
      type: "table_state_sub",
      requestId: "join-replay-snapshot",
      ts: "2026-02-28T06:30:04Z",
      payload: { tableId, view: "snapshot" }
    });
    const snapshot = await nextMessageOfType(ws, "stateSnapshot");
    const humanTurnSnapshot = await waitForHumanTurn(ws, {
      userId: "replay_human",
      baseline: snapshot.payload,
      timeoutMs: 5000
    });
    const chosenAction = pickNonTerminalHumanAction(humanTurnSnapshot);
    assert.ok(chosenAction, "expected at least one legal action after replayed join");

    const actFrame = {
      version: "1.0",
      type: "act",
      requestId: "act-replay-runtime",
      ts: "2026-02-28T06:30:05Z",
      payload: {
        tableId,
        handId: humanTurnSnapshot.public.hand.handId,
        action: chosenAction.action
      }
    };
    if (Number.isFinite(chosenAction.amount)) {
      actFrame.payload.amount = chosenAction.amount;
    }

    sendFrame(ws, actFrame);
    const actAck = await nextCommandResultForRequest(ws, "act-replay-runtime");
    assert.equal(actAck.payload.status, "accepted");
    const postAct = await nextStateUpdate(ws, { baseline: humanTurnSnapshot, timeoutMs: 4000 });
    assert.equal(postAct.payload.stateVersion > humanTurnSnapshot.stateVersion, true);

    const persisted = await readPersistedFile(filePath);
    const activeSeats = persisted.tables[tableId].seatRows.filter((seat) => seat.status === "ACTIVE");
    assert.equal(activeSeats.length, 3);
    assert.equal(activeSeats.filter((seat) => seat.user_id === "replay_human").length, 1);
    assert.equal(activeSeats.filter((seat) => seat.is_bot).length, 2);

    ws.close();
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
