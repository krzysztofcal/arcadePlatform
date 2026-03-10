import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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
  const calls = { cashouts: 0, actions: 0, deleteSeat: 0, storeResult: 0, updates: 0 };
  const state = { version: 2, value: { tableId, phase: "INIT", seats: [{ userId, seatNo: 1 }], stacks: { [userId]: 50 }, leftTableByUserId: {} } };
  const requests = new Map();
  const tx = { unsafe: async (query, params) => {
    const text = String(query).toLowerCase();
    if (text.includes("from public.poker_tables")) return [{ id: tableId, status: "OPEN" }];
    if (text.includes("from public.poker_state")) return [{ version: state.version, state: state.value }];
    if (text.includes("from public.poker_seats") && text.includes("for update")) return [{ seat_no: 1, status: "ACTIVE", stack: 50 }];
    if (text.includes("update public.poker_state") && text.includes("version = version + 1")) { state.version += 1; state.value = JSON.parse(params[2]); calls.updates += 1; return [{ version: state.version }]; }
    if (text.includes("insert into public.poker_actions")) { calls.actions += 1; return [{ id: 1 }]; }
    if (text.includes("delete from public.poker_seats")) { calls.deleteSeat += 1; return []; }
    if (text.includes("update public.poker_tables set last_activity_at")) return [];
    if (text.includes("select user_id, seat_no, is_bot")) return [];
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

console.log("poker-domain leave behavior test passed");
