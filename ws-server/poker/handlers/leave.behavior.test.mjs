import test from "node:test";
import assert from "node:assert/strict";
import { handleLeaveCommand, reconcileInactivityEjectionsCommand } from "./leave.mjs";

function createCtx() {
  const calls = { command: [], snapshots: 0, tableState: 0, autoplay: 0, executorArgs: null, buildArgs: null, restoreArgs: [], leaveArgs: [] };
  return {
    calls,
    ctx: {
      frame: { requestId: "leave-r1" },
      ws: {},
      connState: { session: { userId: "u1" } },
      tableId: "t1",
      tableManager: {
        leave(args) {
          calls.leaveArgs.push(args);
          return { ok: true, changed: false };
        },
        buildAuthoritativeLeaveRestore(args) {
          calls.buildArgs = args;
          return {
            ok: true,
            restoredTable: {
              coreState: {
                version: 3
              }
            }
          };
        },
        restoreTableFromPersisted(tableId, restoredTable) {
          calls.restoreArgs.push({ tableId, restoredTable });
          return { ok: true };
        }
      },
      loadAuthoritativeLeaveExecutor: async () => async (args) => {
        calls.executorArgs = args;
        return { ok: true, tableStatus: "CLOSED", state: { version: 3, state: { handId: "h1" } } };
      },
      sendCommandResult: (_ws, _connState, payload) => {
        calls.command.push(payload);
      },
      broadcastStateSnapshots: () => {
        calls.snapshots += 1;
      },
      broadcastTableState: () => {
        calls.tableState += 1;
      },
      scheduleBotStep: () => {
        calls.autoplay += 1;
      }
    }
  };
}

test("handleLeaveCommand accepts and broadcasts when authoritative leave changes state", async () => {
  const { ctx, calls } = createCtx();
  await handleLeaveCommand(ctx);

  assert.equal(calls.executorArgs.tableId, "t1");
  assert.equal(calls.buildArgs.tableId, "t1");
  assert.equal(calls.buildArgs.tableStatus, "CLOSED");
  assert.equal(calls.restoreArgs[0].tableId, "t1");
  assert.equal(calls.leaveArgs[0].tableId, "t1");
  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, "accepted");
  assert.equal(calls.snapshots, 1);
  assert.equal(calls.tableState, 1);
  assert.equal(calls.autoplay, 1);
});

test("handleLeaveCommand maps pending authoritative leave to rejected request_pending", async () => {
  const { ctx, calls } = createCtx();
  ctx.loadAuthoritativeLeaveExecutor = async () => async () => ({ ok: false, pending: true });
  await handleLeaveCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].reason, "request_pending");
  assert.equal(calls.snapshots, 0);
  assert.equal(calls.tableState, 0);
  assert.equal(calls.autoplay, 0);
});

test("handleLeaveCommand rejects invalid authoritative restore shape without broadcast", async () => {
  const { ctx, calls } = createCtx();
  ctx.tableManager.buildAuthoritativeLeaveRestore = () => ({ ok: false, code: "authoritative_state_invalid" });
  await handleLeaveCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, "rejected");
  assert.equal(calls.command[0].reason, "authoritative_state_invalid");
  assert.equal(calls.snapshots, 0);
  assert.equal(calls.tableState, 0);
  assert.equal(calls.autoplay, 0);
});

test("handleLeaveCommand rejects when authoritative restore cannot be applied", async () => {
  const { ctx, calls } = createCtx();
  ctx.tableManager.restoreTableFromPersisted = () => ({ ok: false, reason: "authoritative_state_invalid" });
  await handleLeaveCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, "rejected");
  assert.equal(calls.command[0].reason, "authoritative_state_invalid");
  assert.equal(calls.snapshots, 0);
  assert.equal(calls.tableState, 0);
  assert.equal(calls.autoplay, 0);
});

test("handleLeaveCommand maps thrown executor errors to stable rejection", async () => {
  const { ctx, calls } = createCtx();
  ctx.loadAuthoritativeLeaveExecutor = async () => async () => {
    const error = new Error("boom");
    error.code = "state_conflict";
    throw error;
  };
  await handleLeaveCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].reason, "state_conflict");
  assert.equal(calls.autoplay, 0);
});


test('durable inactivity retry reloads committed Leave after a lost result, without stale state or second cashout', async () => {
  let state = { seats: [{ userId: 'u1', seatNo: 1 }], stacks: { u1: 25 },
    inactivityEjectionByUserId: { u1: { handId: 'h1', isSinglePlayer: false } } };
  let financialState = structuredClone(state);
  let cashouts = 0, reloads = 0, publications = 0;
  const ctx = { tableId: 't1', tableManager: { isTableClosed: () => false, persistedPokerState: () => state },
    loadAuthoritativeLeaveExecutor: async () => async input => {
      assert.equal(input.inactivityEjection, true);
      assert.equal(input.requestId, 'inactivity:t1:h1:u1');
      cashouts++;
      financialState = { ...financialState, seats: [], stacks: {}, leftTableByUserId: { u1: true } };
      return { ok: false, code: 'lost_result' };
    }, restoreTableFromPersisted: async () => { reloads++; state = structuredClone(financialState); return { ok: true }; },
    broadcastStateSnapshots: () => publications++, broadcastTableState: () => {} };
  const lost = await reconcileInactivityEjectionsCommand(ctx);
  assert.equal(lost.ok, false);
  assert.equal(cashouts, 1);
  assert.equal(reloads, 1);
  assert.equal(publications, 1);
  assert.deepEqual(state.seats, []);
  const recovered = await reconcileInactivityEjectionsCommand(ctx);
  assert.equal(recovered.ok, true);
  assert.equal(cashouts, 1);
});

test('inactivity Leave failure remains pending and retries the same durable idempotency key', async () => {
  const state = { seats: [{ userId: 'u1', seatNo: 1 }], stacks: { u1: 25 },
    inactivityEjectionByUserId: { u1: { handId: 'h1', isSinglePlayer: true } } };
  const requests = [];
  const ctx = { tableId: 't1', tableManager: { isTableClosed: () => false, persistedPokerState: () => state },
    loadAuthoritativeLeaveExecutor: async () => async input => { requests.push(input.requestId); return { ok: false, code: 'state_conflict' }; },
    restoreTableFromPersisted: async () => ({ ok: true }), broadcastStateSnapshots: () => {}, broadcastTableState: () => {} };
  assert.equal((await reconcileInactivityEjectionsCommand(ctx)).ok, false);
  assert.equal((await reconcileInactivityEjectionsCommand(ctx)).ok, false);
  assert.deepEqual(requests, ['inactivity:t1:h1:u1', 'inactivity:t1:h1:u1']);
  assert.equal(state.stacks.u1, 25);
});
