import test from 'node:test';
import assert from 'node:assert/strict';
import { handleJoinCommand } from './join.mjs';

function baseCtx(payload = {}){
  const calls = { command: [], table: 0, snapshots: 0, joinArgs: null, authoritativeArgs: null, sendError: 0, resync: 0 };
  const tableManager = {
    ensureTableLoaded: async () => ({ ok: true }),
    join: (args) => { calls.joinArgs = args; return { ok: true, changed: true }; },
    persistedStateVersion: () => 1,
    bootstrapHand: () => ({ ok: true, changed: false })
  };
  return {
    calls,
    ctx: {
      frame: { __resolvedTableId: 't1', requestId: 'r1', payload },
      ws: {},
      connState: { session: { userId: 'u1', sessionId: 's1' } },
      sessionStore: { trackConnection: () => {} },
      tableManager,
      ensureTableLoadedErrorMapper: (x) => x,
      restoreTableFromPersisted: async () => ({ ok: true }),
      persistMutatedState: async () => ({ ok: true }),
      broadcastResyncRequired: () => { calls.resync += 1; },
      broadcastStateSnapshots: () => { calls.snapshots += 1; },
      broadcastTableState: () => { calls.table += 1; },
      sendError: () => { calls.sendError += 1; },
      sendCommandResult: (_ws, _cs, payload) => calls.command.push(payload),
      authoritativeJoinEnabled: false,
      observeOnlyJoinEnabled: false,
      persistedBootstrapEnabled: false,
      loadAuthoritativeJoinExecutor: async () => async (args) => { calls.authoritativeArgs = args; return { ok: true, seatNo: 2, stack: 100 }; }
    }
  };
}

test('handleJoinCommand forwards explicit seat + buyIn intent', async () => {
  const { ctx, calls } = baseCtx({ seatNo: 3, buyIn: 200 });
  await handleJoinCommand(ctx);
  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, 'accepted');
  assert.equal(calls.joinArgs.seatNo, 3);
  assert.equal(calls.joinArgs.autoSeat, false);
  assert.equal(calls.joinArgs.buyIn, 200);
});

test('handleJoinCommand forwards autoSeat + preferredSeatNo intent', async () => {
  const { ctx, calls } = baseCtx({ autoSeat: true, preferredSeatNo: 2, buyIn: 150 });
  await handleJoinCommand(ctx);
  assert.equal(calls.joinArgs.autoSeat, true);
  assert.equal(calls.joinArgs.preferredSeatNo, 2);
  assert.equal(calls.joinArgs.buyIn, 150);
});

test('handleJoinCommand forwards join intent to authoritative executor when enabled', async () => {
  const { ctx, calls } = baseCtx({ autoSeat: true, preferredSeatNo: 4, buyIn: 250, seatNo: 1 });
  ctx.authoritativeJoinEnabled = true;
  ctx.persistedBootstrapEnabled = true;
  await handleJoinCommand(ctx);
  assert.equal(calls.authoritativeArgs.seatNo, 1);
  assert.equal(calls.authoritativeArgs.autoSeat, true);
  assert.equal(calls.authoritativeArgs.preferredSeatNo, 4);
  assert.equal(calls.authoritativeArgs.buyIn, 250);
});

test('handleJoinCommand rejects invalid buyIn without broadcast', async () => {
  const { ctx, calls } = baseCtx({ buyIn: -1 });
  await handleJoinCommand(ctx);
  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, 'rejected');
  assert.equal(calls.command[0].reason, 'invalid_buy_in');
  assert.equal(calls.table, 0);
  assert.equal(calls.snapshots, 0);
  assert.equal(calls.sendError, 0);
});

test('handleJoinCommand emits one rejected result when bootstrap persist fails', async () => {
  const { ctx, calls } = baseCtx({ seatNo: 2, buyIn: 100 });
  ctx.tableManager.bootstrapHand = () => ({ ok: true, changed: true });
  ctx.persistMutatedState = async () => ({ ok: false, reason: 'persist_failed' });
  await handleJoinCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, 'rejected');
  assert.equal(calls.command[0].reason, 'persist_failed');
  assert.equal(calls.resync, 1);
  assert.equal(calls.table, 0);
  assert.equal(calls.snapshots, 0);
});

test('handleJoinCommand emits one accepted result only after full success', async () => {
  const { ctx, calls } = baseCtx({ seatNo: 2, buyIn: 100 });
  ctx.tableManager.bootstrapHand = () => ({ ok: true, changed: true });
  ctx.persistMutatedState = async () => ({ ok: true, newVersion: 2 });
  await handleJoinCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, 'accepted');
  assert.equal(calls.table, 1);
  assert.equal(calls.snapshots, 1);
});


test('handleJoinCommand rejects when authoritative funded join fails and does not broadcast', async () => {
  const { ctx, calls } = baseCtx({ seatNo: 2, buyIn: 100 });
  ctx.authoritativeJoinEnabled = true;
  ctx.persistedBootstrapEnabled = true;
  ctx.loadAuthoritativeJoinExecutor = async () => async () => ({ ok: false, code: 'insufficient_funds' });
  await handleJoinCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, 'rejected');
  assert.equal(calls.command[0].reason, 'insufficient_funds');
  assert.equal(calls.table, 0);
  assert.equal(calls.snapshots, 0);
});

test('handleJoinCommand rejects malformed authoritative success contract', async () => {
  const { ctx, calls } = baseCtx({ seatNo: 2, buyIn: 100 });
  ctx.authoritativeJoinEnabled = true;
  ctx.persistedBootstrapEnabled = true;
  ctx.loadAuthoritativeJoinExecutor = async () => async () => ({ ok: false, code: 'authoritative_state_invalid' });
  await handleJoinCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, 'rejected');
  assert.equal(calls.command[0].reason, 'authoritative_state_invalid');
  assert.equal(calls.table, 0);
  assert.equal(calls.snapshots, 0);
});
