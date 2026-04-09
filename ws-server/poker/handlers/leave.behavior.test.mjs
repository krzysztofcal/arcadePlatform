import test from "node:test";
import assert from "node:assert/strict";
import { handleLeaveCommand } from "./leave.mjs";

function createCtx() {
  const calls = { command: [], snapshots: 0, tableState: 0, executorArgs: null, buildArgs: null, restoreArgs: [], leaveArgs: [] };
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
        return { ok: true, state: { version: 3, state: { handId: "h1" } } };
      },
      sendCommandResult: (_ws, _connState, payload) => {
        calls.command.push(payload);
      },
      broadcastStateSnapshots: () => {
        calls.snapshots += 1;
      },
      broadcastTableState: () => {
        calls.tableState += 1;
      }
    }
  };
}

test("handleLeaveCommand accepts and broadcasts when authoritative leave changes state", async () => {
  const { ctx, calls } = createCtx();
  await handleLeaveCommand(ctx);

  assert.equal(calls.executorArgs.tableId, "t1");
  assert.equal(calls.buildArgs.tableId, "t1");
  assert.equal(calls.restoreArgs[0].tableId, "t1");
  assert.equal(calls.leaveArgs[0].tableId, "t1");
  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, "accepted");
  assert.equal(calls.snapshots, 1);
  assert.equal(calls.tableState, 1);
});

test("handleLeaveCommand maps pending authoritative leave to rejected request_pending", async () => {
  const { ctx, calls } = createCtx();
  ctx.loadAuthoritativeLeaveExecutor = async () => async () => ({ ok: false, pending: true });
  await handleLeaveCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].reason, "request_pending");
  assert.equal(calls.snapshots, 0);
  assert.equal(calls.tableState, 0);
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
});
