import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isStateStorageValid as realIsStateStorageValid } from "../../netlify/functions/_shared/poker-state-utils.mjs";

const root = process.cwd();
const loadExecutePokerLeave = (mocks) => {
  const source = fs.readFileSync(path.join(root, "shared/poker-domain/leave.mjs"), "utf8");
  const withoutImports = source.replace(/^\s*import[\s\S]*?;\s*$/gm, "");
  const rewritten = withoutImports.replace(/export\s+async\s+function\s+executePokerLeave\s*\(/, "async function executePokerLeave(");
  const factory = new Function("mocks", `"use strict"; const { postTransaction, deletePokerRequest, ensurePokerRequest, storePokerRequestResult, updatePokerStateOptimistic, advanceIfNeeded, applyLeaveTable, isStateStorageValid, withoutPrivateState, buildSeatBotMap, isBotTurn, deriveCommunityCards, deriveRemainingDeck, isHoleCardsTableMissing, loadHoleCardsByUserId, hasParticipatingHumanInHand, runAdvanceLoop, runBotAutoplayLoop } = mocks; ${rewritten}; return executePokerLeave;`);
  return factory(mocks);
};

const tableId = "77777777-7777-4777-8777-777777777777";
const userId = "99999999-9999-4999-8999-999999999999";

const makeMocks = () => {
  const calls = { cashouts: 0, actions: 0, deleteSeat: 0, storeResult: 0, updates: 0, closeTable: 0 };
  const state = { version: 2, value: { tableId, phase: "INIT", seats: [{ userId, seatNo: 1 }], stacks: { [userId]: 50 }, leftTableByUserId: {} } };
  let tableStatus = "OPEN";
  const requests = new Map();
  const tx = { unsafe: async (query, params) => {
    const text = String(query).toLowerCase();
    if (text.includes("select id, status from public.poker_tables")) return [{ id: tableId, status: tableStatus }];
    if (text.includes("from public.poker_state")) return [{ version: state.version, state: state.value }];
    if (text.includes("select seat_no, status, stack from public.poker_seats") && text.includes("for update")) {
      const seat = Array.isArray(state.value?.seats)
        ? state.value.seats.find((entry) => entry && entry.userId === params[1])
        : null;
      if (!seat) return [];
      const stack = state.value?.stacks && state.value.stacks[params[1]] != null ? state.value.stacks[params[1]] : 0;
      return [{ seat_no: seat.seatNo ?? 1, status: "ACTIVE", stack }];
    }
    if (text.includes("select user_id, seat_no, is_bot from public.poker_seats where table_id = $1 and status = 'active'")) {
      const seats = Array.isArray(state.value?.seats) ? state.value.seats : [];
      return seats.map((seat) => ({ user_id: seat.userId, seat_no: seat.seatNo, is_bot: !!seat.isBot }));
    }
    if (text.includes("select user_id, status, is_bot, stack from public.poker_seats where table_id = $1 for update")) {
      const seats = Array.isArray(state.value?.seats) ? state.value.seats : [];
      const stacks = state.value?.stacks && typeof state.value.stacks === "object" ? state.value.stacks : {};
      return seats.map((seat) => ({
        user_id: seat.userId,
        status: "ACTIVE",
        is_bot: !!seat.isBot,
        stack: stacks[seat.userId] ?? 0,
      }));
    }
    if (text.includes("update public.poker_state") && text.includes("version = version + 1")) { state.version += 1; state.value = JSON.parse(params[2]); calls.updates += 1; return [{ version: state.version }]; }
    if (text.includes("insert into public.poker_actions")) { calls.actions += 1; return [{ id: 1 }]; }
    if (text.includes("delete from public.poker_seats")) {
      calls.deleteSeat += 1;
      const targetUserId = params[1];
      if (Array.isArray(state.value?.seats)) {
        state.value.seats = state.value.seats.filter((seat) => seat && seat.userId !== targetUserId);
      }
      if (state.value?.stacks && typeof state.value.stacks === "object") {
        delete state.value.stacks[targetUserId];
      }
      return [];
    }
    if (text.includes("update public.poker_seats set status = 'inactive', stack = 0 where table_id = $1;")) {
      return [];
    }
    if (text.includes("update public.poker_tables set status = 'closed'")) {
      tableStatus = "CLOSED";
      calls.closeTable += 1;
      return [];
    }
    if (text.includes("delete from public.poker_hole_cards where table_id = $1")) return [];
    if (text.includes("update public.poker_tables set last_activity_at")) return [];
    return [];
  } };
  return {
    calls,
    state,
    requests,
    mocks: {
      ensurePokerRequest: async (_tx, { requestId }) => requests.get(requestId) || { status: "proceed" },
      storePokerRequestResult: async (_tx, { requestId, result }) => { requests.set(requestId, { status: "stored", result }); calls.storeResult += 1; },
      deletePokerRequest: async () => {},
      postTransaction: async () => { calls.cashouts += 1; return { transaction: { id: "tx-1" } }; },
      updatePokerStateOptimistic: async (_tx, { nextState }) => { state.version += 1; state.value = nextState; calls.updates += 1; return { ok: true, newVersion: state.version }; },
      applyLeaveTable: (s) => ({ state: { ...s, seats: [], stacks: {}, leftTableByUserId: { ...s.leftTableByUserId, [userId]: true } } }),
      advanceIfNeeded: () => ({}),
      isStateStorageValid: () => true,
      withoutPrivateState: (s) => s,
      buildSeatBotMap: () => ({}),
      isBotTurn: () => false,
      deriveCommunityCards: () => [],
      deriveRemainingDeck: () => [],
      isHoleCardsTableMissing: () => false,
      loadHoleCardsByUserId: async () => ({ holeCardsByUserId: {} }),
      hasParticipatingHumanInHand: () => true,
      runAdvanceLoop: (s) => ({ nextState: s }),
      runBotAutoplayLoop: async () => ({ responseFinalState: state.value, loopVersion: state.version, botActionCount: 0, botStopReason: "not_applicable" }),
    },
    beginSql: async (fn) => fn(tx),
  };
};

{
  const ctx = makeMocks();
  const executePokerLeave = loadExecutePokerLeave(ctx.mocks);
  const result = await executePokerLeave({ beginSql: ctx.beginSql, tableId, userId, requestId: "r1", klog: () => {} });
  assert.equal(result.ok, true);
  assert.equal(result.cashedOut, 50);
  assert.equal(ctx.calls.cashouts, 1);
  assert.equal(ctx.calls.deleteSeat, 1);
  assert.equal(ctx.calls.storeResult, 1);
}

{
  const ctx = makeMocks();
  ctx.state.value = { tableId, phase: "INIT", seats: [], stacks: {}, leftTableByUserId: {} };
  const executePokerLeave = loadExecutePokerLeave(ctx.mocks);
  const result = await executePokerLeave({ beginSql: ctx.beginSql, tableId, userId, requestId: "r2", includeState: true, klog: () => {} });
  assert.equal(result.status, "already_left");
  assert.equal(ctx.calls.cashouts, 0);
}

{
  const ctx = makeMocks();
  ctx.requests.set("r3", { status: "stored", result: { ok: true, tableId, cashedOut: 9 } });
  const executePokerLeave = loadExecutePokerLeave(ctx.mocks);
  const result = await executePokerLeave({ beginSql: ctx.beginSql, tableId, userId, requestId: "r3", klog: () => {} });
  assert.equal(result.cashedOut, 9);
  assert.equal(ctx.calls.cashouts, 0);
}

{
  const ctx = makeMocks();
  ctx.mocks.updatePokerStateOptimistic = async () => ({ ok: false, reason: "conflict" });
  const executePokerLeave = loadExecutePokerLeave(ctx.mocks);
  await assert.rejects(() => executePokerLeave({ beginSql: ctx.beginSql, tableId, userId, requestId: "r4", klog: () => {} }), /state_conflict/);
}

for (const settledPhase of ["SETTLED", "HAND_DONE"]) {
  const ctx = makeMocks();
  ctx.state.value = {
    tableId,
    phase: settledPhase,
    handId: `hand-${settledPhase.toLowerCase()}-leave`,
    seats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }],
    stacks: { [userId]: 41, "bot-1": 59 },
    leftTableByUserId: {},
    foldedByUserId: { [userId]: true, "bot-1": false },
    actedThisRoundByUserId: { [userId]: true, "bot-1": true },
    handSettlement: settledPhase === "SETTLED"
      ? { handId: `hand-${settledPhase.toLowerCase()}-leave`, settledAt: "2026-04-13T00:00:00.000Z", payouts: { "bot-1": 4 } }
      : null,
  };
  const executePokerLeave = loadExecutePokerLeave(ctx.mocks);
  const result = await executePokerLeave({ beginSql: ctx.beginSql, tableId, userId, requestId: `r4-${settledPhase.toLowerCase()}`, includeState: true, klog: () => {} });
  assert.equal(result.ok, true);
  assert.equal(result.cashedOut, 41);
  assert.equal(ctx.calls.cashouts, 1);
  assert.equal(ctx.calls.deleteSeat, 1);
  assert.equal(result.state.state.seats.some((seat) => seat.userId === userId), false);
  assert.equal(result.state.state.stacks[userId], undefined);
}

{
  const ctx = makeMocks();
  ctx.state.value = {
    tableId,
    phase: "PREFLOP",
    handId: "hand-preflop-no-action-leave",
    handSeed: "seed-preflop-no-action-leave",
    seats: [{ userId, seatNo: 1 }, { userId: "other-user", seatNo: 2 }],
    stacks: { [userId]: 99, "other-user": 98 },
    leftTableByUserId: {},
    foldedByUserId: { [userId]: false, "other-user": false },
    actedThisRoundByUserId: { [userId]: false, "other-user": false },
    betThisRoundByUserId: { [userId]: 1, "other-user": 2 },
    toCallByUserId: { [userId]: 1, "other-user": 0 },
    contributionsByUserId: { [userId]: 1, "other-user": 2 },
    currentBet: 2,
    communityDealt: 0,
    community: [],
    turnUserId: userId,
  };
  ctx.mocks.isStateStorageValid = realIsStateStorageValid;
  const executePokerLeave = loadExecutePokerLeave(ctx.mocks);
  const result = await executePokerLeave({ beginSql: ctx.beginSql, tableId, userId, requestId: "r5a", includeState: true, klog: () => {} });
  assert.equal(result.ok, true);
  assert.equal(result.cashedOut, 0);
  assert.equal(result.state.state.seats.some((seat) => seat.userId === userId), true);
  assert.equal(result.viewState.seats.some((seat) => seat.userId === userId), false);
  assert.equal(ctx.calls.cashouts, 0);
  assert.equal(ctx.calls.deleteSeat, 0);
}

{
  const ctx = makeMocks();
  ctx.state.value = {
    tableId,
    phase: "FLOP",
    handId: "hand-call-then-leave",
    handSeed: "seed-call-then-leave",
    seats: [{ userId, seatNo: 1 }, { userId: "other-user", seatNo: 2 }],
    stacks: { [userId]: 48, "other-user": 52 },
    leftTableByUserId: {},
    foldedByUserId: { [userId]: false, "other-user": false },
    actedThisRoundByUserId: { [userId]: true, "other-user": false },
    betThisRoundByUserId: { [userId]: 2, "other-user": 2 },
    toCallByUserId: { [userId]: 0, "other-user": 0 },
    contributionsByUserId: { [userId]: 2, "other-user": 2 },
    communityDealt: 3,
    community: ["3H", "AH", "7S"],
  };
  ctx.mocks.isStateStorageValid = realIsStateStorageValid;
  ctx.mocks.applyLeaveTable = (s) => ({
    state: {
      ...s,
      seats: s.seats.filter((seat) => seat.userId !== userId),
      stacks: { "other-user": 52 },
      leftTableByUserId: { ...s.leftTableByUserId, [userId]: true },
      foldedByUserId: { ...s.foldedByUserId, [userId]: true },
      actedThisRoundByUserId: { ...s.actedThisRoundByUserId, [userId]: true },
    }
  });
  const executePokerLeave = loadExecutePokerLeave(ctx.mocks);
  const result = await executePokerLeave({ beginSql: ctx.beginSql, tableId, userId, requestId: "r5", includeState: true, klog: () => {} });
  assert.equal(result.ok, true);
  assert.equal(result.cashedOut, 0);
  assert.equal(result.state.state.communityDealt, 3);
  assert.deepEqual(result.state.state.community, ["3H", "AH", "7S"]);
  assert.equal(result.state.state.leftTableByUserId[userId], true);
  assert.equal(result.state.state.seats.some((seat) => seat.userId === userId), true);
  assert.equal(result.viewState.seats.some((seat) => seat.userId === userId), false);
  assert.equal(ctx.calls.cashouts, 0);
  assert.equal(ctx.calls.deleteSeat, 0);
}

{
  const ctx = makeMocks();
  ctx.state.value = {
    tableId,
    phase: "INIT",
    seats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }],
    stacks: { [userId]: 50, "bot-1": 100 },
    leftTableByUserId: {},
  };
  const executePokerLeave = loadExecutePokerLeave(ctx.mocks);
  const result = await executePokerLeave({ beginSql: ctx.beginSql, tableId, userId, requestId: "r6", includeState: true, klog: () => {} });
  assert.equal(result.ok, true);
  assert.equal(ctx.calls.closeTable, 1, "table should be closed when no active humans remain");
  assert.equal(result.state.state.phase, "HAND_DONE");
  assert.deepEqual(result.state.state.stacks, {});
}

{
  const ctx = makeMocks();
  let requiredUserIdsSeen = null;
  ctx.state.value = {
    tableId,
    phase: "FLOP",
    handId: "hand-bots-only-leave",
    handSeed: "seed-bots-only-leave",
    seats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }, { userId: "bot-2", seatNo: 3, isBot: true }],
    handSeats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }],
    stacks: { [userId]: 48, "bot-1": 52, "bot-2": 80 },
    leftTableByUserId: {},
    foldedByUserId: { [userId]: false, "bot-1": false, "bot-2": false },
    actedThisRoundByUserId: { [userId]: true, "bot-1": false },
    betThisRoundByUserId: { [userId]: 2, "bot-1": 2 },
    toCallByUserId: { [userId]: 0, "bot-1": 0 },
    contributionsByUserId: { [userId]: 2, "bot-1": 2 },
    communityDealt: 3,
    community: ["3H", "AH", "7S"],
    turnUserId: "bot-1",
  };
  ctx.mocks.isStateStorageValid = realIsStateStorageValid;
  ctx.mocks.applyLeaveTable = (s) => ({
    state: {
      ...s,
      seats: s.seats.filter((seat) => seat.userId !== userId),
      stacks: { "bot-1": 52 },
      leftTableByUserId: { ...s.leftTableByUserId, [userId]: true },
      foldedByUserId: { ...s.foldedByUserId, [userId]: true },
      actedThisRoundByUserId: { ...s.actedThisRoundByUserId, [userId]: true },
    }
  });
  ctx.mocks.buildSeatBotMap = (rows) => rows.reduce((acc, row) => ({ ...acc, [row.user_id]: row.is_bot === true }), {});
  ctx.mocks.isBotTurn = (turnUserId, seatBotMap) => !!seatBotMap?.[turnUserId];
  ctx.mocks.hasParticipatingHumanInHand = () => false;
  ctx.mocks.loadHoleCardsByUserId = async (_tx, args) => {
    requiredUserIdsSeen = Array.isArray(args.requiredUserIds) ? args.requiredUserIds.slice() : null;
    return {
      holeCardsByUserId: {
        "bot-1": [{ r: "A", s: "S" }, { r: "K", s: "S" }],
      }
    };
  };
  ctx.mocks.runBotAutoplayLoop = async () => ({
    responseFinalState: {
      ...ctx.state.value,
      phase: "HAND_DONE",
      seats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }, { userId: "bot-2", seatNo: 3, isBot: true }],
      handSeats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }],
      stacks: { [userId]: 48, "bot-1": 52, "bot-2": 80 },
      leftTableByUserId: { [userId]: true },
      foldedByUserId: { [userId]: true, "bot-1": false, "bot-2": false },
      turnUserId: null,
    },
    loopVersion: ctx.state.version,
    botActionCount: 1,
    botStopReason: "completed",
  });
  const executePokerLeave = loadExecutePokerLeave(ctx.mocks);
  const result = await executePokerLeave({ beginSql: ctx.beginSql, tableId, userId, requestId: "r7", includeState: true, klog: () => {} });
  assert.equal(result.ok, true);
  assert.equal(result.cashedOut, 48);
  assert.deepEqual(requiredUserIdsSeen, ["bot-1"]);
  assert.equal(ctx.calls.cashouts, 1);
  assert.equal(ctx.calls.deleteSeat, 1);
  assert.equal(ctx.calls.closeTable, 1);
  assert.equal(result.state.state.phase, "HAND_DONE");
  assert.equal(result.state.state.seats.some((seat) => seat.userId === userId), false);
}

{
  const ctx = makeMocks();
  let requiredUserIdsSeen = null;
  ctx.state.value = {
    tableId,
    phase: "TURN",
    handId: "hand-fold-then-leave",
    handSeed: "seed-fold-then-leave",
    seats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }],
    handSeats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }],
    stacks: { [userId]: 47, "bot-1": 53 },
    leftTableByUserId: {},
    foldedByUserId: { [userId]: true, "bot-1": false },
    actedThisRoundByUserId: { [userId]: true, "bot-1": false },
    betThisRoundByUserId: { [userId]: 3, "bot-1": 3 },
    toCallByUserId: { [userId]: 0, "bot-1": 0 },
    contributionsByUserId: { [userId]: 3, "bot-1": 3 },
    communityDealt: 4,
    community: ["3H", "AH", "7S", "2D"],
    turnUserId: "bot-1",
  };
  ctx.mocks.isStateStorageValid = realIsStateStorageValid;
  ctx.mocks.applyLeaveTable = (s) => ({
    state: {
      ...s,
      seats: s.seats.filter((seat) => seat.userId !== userId),
      stacks: { "bot-1": 53 },
      leftTableByUserId: { ...s.leftTableByUserId, [userId]: true },
      foldedByUserId: { ...s.foldedByUserId, [userId]: true },
      actedThisRoundByUserId: { ...s.actedThisRoundByUserId, [userId]: true },
    }
  });
  ctx.mocks.buildSeatBotMap = (rows) => rows.reduce((acc, row) => ({ ...acc, [row.user_id]: row.is_bot === true }), {});
  ctx.mocks.isBotTurn = (turnUserId, seatBotMap) => !!seatBotMap?.[turnUserId];
  ctx.mocks.hasParticipatingHumanInHand = () => false;
  ctx.mocks.loadHoleCardsByUserId = async (_tx, args) => {
    requiredUserIdsSeen = Array.isArray(args.requiredUserIds) ? args.requiredUserIds.slice() : null;
    return {
      holeCardsByUserId: {
        "bot-1": [{ r: "A", s: "S" }, { r: "K", s: "S" }],
      }
    };
  };
  ctx.mocks.runBotAutoplayLoop = async () => ({
    responseFinalState: {
      ...ctx.state.value,
      phase: "SETTLED",
      seats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }],
      handSeats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }],
      stacks: { [userId]: 47, "bot-1": 53 },
      leftTableByUserId: { [userId]: true },
      foldedByUserId: { [userId]: true, "bot-1": false },
      turnUserId: null,
      showdown: { handId: "hand-fold-then-leave", winners: ["bot-1"], reason: "computed", potsAwarded: [], potAwardedTotal: 6 },
      handSettlement: { handId: "hand-fold-then-leave", settledAt: "2026-04-13T00:00:00.000Z", payouts: { "bot-1": 6 } },
    },
    loopVersion: ctx.state.version,
    botActionCount: 2,
    botStopReason: "completed",
  });
  const executePokerLeave = loadExecutePokerLeave(ctx.mocks);
  const result = await executePokerLeave({ beginSql: ctx.beginSql, tableId, userId, requestId: "r8", includeState: true, klog: () => {} });
  assert.equal(result.ok, true);
  assert.equal(result.cashedOut, 47);
  assert.deepEqual(requiredUserIdsSeen, ["bot-1"]);
  assert.equal(ctx.calls.cashouts, 1);
  assert.equal(ctx.calls.deleteSeat, 1);
  assert.equal(ctx.calls.closeTable, 1);
  assert.equal(result.state.state.seats.some((seat) => seat.userId === userId), false);
  assert.equal(result.state.state.handSettlement.payouts["bot-1"], 6);
}

{
  const ctx = makeMocks();
  ctx.state.value = {
    tableId,
    phase: "HAND_DONE",
    seats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }],
    stacks: { [userId]: 47, "bot-1": 53 },
    leftTableByUserId: {}
  };
  ctx.mocks.applyLeaveTable = (s) => ({
    state: {
      ...s,
      seats: s.seats.filter((seat) => seat.userId !== userId),
      stacks: { "bot-1": 53 },
      leftTableByUserId: { ...s.leftTableByUserId, [userId]: true }
    }
  });
  const executePokerLeave = loadExecutePokerLeave(ctx.mocks);
  const result = await executePokerLeave({
    beginSql: ctx.beginSql,
    tableId,
    userId,
    requestId: "r9",
    includeState: true,
    hasConnectedHumanPresence: () => true,
    klog: () => {}
  });
  assert.equal(result.ok, true);
  assert.equal(ctx.calls.closeTable, 0);
  assert.equal(result.state.state.seats.some((seat) => seat.userId === userId), false);
}

{
  const ctx = makeMocks();
  const logEvents = [];
  ctx.state.value = {
    tableId,
    phase: "TURN",
    handId: "hand-live-deferred-idempotent",
    seats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }],
    stacks: { [userId]: 47, "bot-1": 53 },
    leftTableByUserId: {},
    turnUserId: "bot-1"
  };
  const executePokerLeave = loadExecutePokerLeave(ctx.mocks);
  const first = await executePokerLeave({
    beginSql: ctx.beginSql,
    tableId,
    userId,
    requestId: "r10",
    includeState: true,
    runPostLeaveBotAutoplay: false,
    klog: (name, payload) => logEvents.push({ name, payload })
  });
  const second = await executePokerLeave({
    beginSql: ctx.beginSql,
    tableId,
    userId,
    requestId: "r10",
    includeState: true,
    runPostLeaveBotAutoplay: false,
    klog: (name, payload) => logEvents.push({ name, payload })
  });
  assert.equal(first.ok, true);
  assert.equal(first.cashedOut, 0);
  assert.equal(first.state.state.seats.some((seat) => seat.userId === userId), true);
  assert.equal(first.state.state.leftTableByUserId[userId], true);
  assert.deepEqual(second, first);
  assert.equal(ctx.calls.cashouts, 0);
  assert.equal(ctx.calls.deleteSeat, 0);
  assert.equal(ctx.calls.updates, 1);
  assert.equal(ctx.calls.storeResult, 1);
  assert.equal(logEvents.some((entry) => entry.name === "poker_leave_retained_live_hand"), true);
  assert.equal(logEvents.some((entry) => entry.name === "poker_leave_detach_start"), false);
}

{
  const ctx = makeMocks();
  const logEvents = [];
  ctx.state.value = {
    tableId,
    phase: "TURN",
    handId: "hand-bot-autoplay-idempotent",
    handSeed: "seed-bot-autoplay-idempotent",
    seats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }],
    handSeats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }],
    stacks: { [userId]: 44, "bot-1": 56 },
    leftTableByUserId: {},
    foldedByUserId: { [userId]: true, "bot-1": false },
    actedThisRoundByUserId: { [userId]: true, "bot-1": false },
    betThisRoundByUserId: { [userId]: 3, "bot-1": 3 },
    toCallByUserId: { [userId]: 0, "bot-1": 0 },
    contributionsByUserId: { [userId]: 3, "bot-1": 3 },
    communityDealt: 4,
    community: ["3H", "AH", "7S", "2D"],
    turnUserId: "bot-1",
  };
  ctx.mocks.isStateStorageValid = realIsStateStorageValid;
  ctx.mocks.applyLeaveTable = (s) => ({
    state: {
      ...s,
      seats: s.seats.filter((seat) => seat.userId !== userId),
      stacks: { "bot-1": 56 },
      leftTableByUserId: { ...s.leftTableByUserId, [userId]: true },
      foldedByUserId: { ...s.foldedByUserId, [userId]: true },
      actedThisRoundByUserId: { ...s.actedThisRoundByUserId, [userId]: true },
    }
  });
  ctx.mocks.buildSeatBotMap = (rows) => rows.reduce((acc, row) => ({ ...acc, [row.user_id]: row.is_bot === true }), {});
  ctx.mocks.isBotTurn = (turnUserId, seatBotMap) => !!seatBotMap?.[turnUserId];
  ctx.mocks.hasParticipatingHumanInHand = () => false;
  ctx.mocks.loadHoleCardsByUserId = async () => ({
    holeCardsByUserId: {
      "bot-1": [{ r: "A", s: "S" }, { r: "K", s: "S" }],
    }
  });
  ctx.mocks.runBotAutoplayLoop = async () => ({
    responseFinalState: {
      ...ctx.state.value,
      phase: "HAND_DONE",
      seats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }],
      handSeats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }],
      stacks: { [userId]: 44, "bot-1": 56 },
      leftTableByUserId: { [userId]: true },
      foldedByUserId: { [userId]: true, "bot-1": false },
      turnUserId: null,
    },
    loopVersion: ctx.state.version,
    botActionCount: 2,
    botStopReason: "completed",
  });
  const executePokerLeave = loadExecutePokerLeave(ctx.mocks);
  const first = await executePokerLeave({
    beginSql: ctx.beginSql,
    tableId,
    userId,
    requestId: "r11",
    includeState: true,
    klog: (name, payload) => logEvents.push({ name, payload })
  });
  const second = await executePokerLeave({
    beginSql: ctx.beginSql,
    tableId,
    userId,
    requestId: "r11",
    includeState: true,
    klog: (name, payload) => logEvents.push({ name, payload })
  });
  const logNames = logEvents.map((entry) => entry.name);
  assert.equal(first.ok, true);
  assert.deepEqual(second, first);
  assert.equal(first.cashedOut, 44);
  assert.equal(ctx.calls.cashouts, 1);
  assert.equal(ctx.calls.deleteSeat, 1);
  assert.equal(ctx.calls.closeTable, 1);
  assert.equal(ctx.calls.storeResult, 1);
  assert.equal(logNames.includes("poker_leave_bot_autoplay_start"), true);
  assert.equal(logNames.includes("poker_leave_bot_autoplay_finish"), true);
  assert.equal(logNames.includes("poker_leave_detach_start"), true);
  assert.equal(logNames.includes("poker_leave_post_hand_cashout"), true);
  assert.equal(logNames.includes("poker_leave_detach_finish"), true);
  assert.equal(logNames.includes("poker_leave_table_closed_terminal_bots_only"), true);
  assert.equal(logNames.indexOf("poker_leave_bot_autoplay_start") < logNames.indexOf("poker_leave_bot_autoplay_finish"), true);
  assert.equal(logNames.indexOf("poker_leave_detach_start") < logNames.indexOf("poker_leave_detach_finish"), true);
}

{
  const ctx = makeMocks();
  const logEvents = [];
  ctx.state.value = {
    tableId,
    phase: "TURN",
    handId: "hand-observer-presence-skip-close",
    handSeed: "seed-observer-presence-skip-close",
    seats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }],
    handSeats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }],
    stacks: { [userId]: 45, "bot-1": 55 },
    leftTableByUserId: {},
    foldedByUserId: { [userId]: true, "bot-1": false },
    actedThisRoundByUserId: { [userId]: true, "bot-1": false },
    betThisRoundByUserId: { [userId]: 2, "bot-1": 2 },
    toCallByUserId: { [userId]: 0, "bot-1": 0 },
    contributionsByUserId: { [userId]: 2, "bot-1": 2 },
    communityDealt: 4,
    community: ["3H", "AH", "7S", "2D"],
    turnUserId: "bot-1",
  };
  ctx.mocks.isStateStorageValid = realIsStateStorageValid;
  ctx.mocks.applyLeaveTable = (s) => ({
    state: {
      ...s,
      seats: s.seats.filter((seat) => seat.userId !== userId),
      stacks: { "bot-1": 55 },
      leftTableByUserId: { ...s.leftTableByUserId, [userId]: true },
      foldedByUserId: { ...s.foldedByUserId, [userId]: true },
      actedThisRoundByUserId: { ...s.actedThisRoundByUserId, [userId]: true },
    }
  });
  ctx.mocks.buildSeatBotMap = (rows) => rows.reduce((acc, row) => ({ ...acc, [row.user_id]: row.is_bot === true }), {});
  ctx.mocks.isBotTurn = (turnUserId, seatBotMap) => !!seatBotMap?.[turnUserId];
  ctx.mocks.hasParticipatingHumanInHand = () => false;
  ctx.mocks.loadHoleCardsByUserId = async () => ({
    holeCardsByUserId: {
      "bot-1": [{ r: "A", s: "S" }, { r: "K", s: "S" }],
    }
  });
  ctx.mocks.runBotAutoplayLoop = async () => ({
    responseFinalState: {
      ...ctx.state.value,
      phase: "HAND_DONE",
      seats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }],
      handSeats: [{ userId, seatNo: 1 }, { userId: "bot-1", seatNo: 2, isBot: true }],
      stacks: { [userId]: 45, "bot-1": 55 },
      leftTableByUserId: { [userId]: true },
      foldedByUserId: { [userId]: true, "bot-1": false },
      turnUserId: null,
    },
    loopVersion: ctx.state.version,
    botActionCount: 1,
    botStopReason: "completed",
  });
  const executePokerLeave = loadExecutePokerLeave(ctx.mocks);
  const result = await executePokerLeave({
    beginSql: ctx.beginSql,
    tableId,
    userId,
    requestId: "r12",
    includeState: true,
    hasConnectedHumanPresence: () => true,
    klog: (name, payload) => logEvents.push({ name, payload })
  });
  assert.equal(result.ok, true);
  assert.equal(result.cashedOut, 45);
  assert.equal(ctx.calls.cashouts, 1);
  assert.equal(ctx.calls.deleteSeat, 1);
  assert.equal(ctx.calls.closeTable, 0);
  assert.equal(result.state.state.phase, "HAND_DONE");
  assert.equal(logEvents.some((entry) => entry.name === "poker_leave_table_close_skipped_human_presence"), true);
}

console.log("poker-domain leave behavior test passed");
