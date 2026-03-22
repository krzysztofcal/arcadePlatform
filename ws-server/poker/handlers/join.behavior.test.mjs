import test from 'node:test';
import assert from 'node:assert/strict';
import { handleJoinCommand } from './join.mjs';

function baseCtx(payload = {}){
  const calls = { command: [], table: 0, snapshots: 0, joinArgs: null, authoritativeArgs: null, sendError: 0, sentErrors: [], actorTableState: 0, resync: 0 };
  const tableManager = {
    ensureTableLoaded: async () => ({ ok: true }),
    join: (args) => { calls.joinArgs = args; return { ok: true, changed: true, tableState: { tableId: 't1', members: [] } }; },
    persistedStateVersion: () => 1,
    bootstrapHand: () => ({ ok: true, changed: false }),
    tableSnapshot: () => ({
      tableId: 't1',
      stateVersion: 1,
      members: [{ userId: 'u1', seat: 2 }],
      seats: [{ userId: 'u1', seatNo: 2, status: 'ACTIVE' }],
      stacks: { u1: 100 }
    })
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
      sendError: (_ws, _cs, payload) => { calls.sendError += 1; calls.sentErrors.push(payload); },
      sendCommandResult: (_ws, _cs, payload) => calls.command.push(payload),
      sendTableState: () => { calls.actorTableState += 1; },
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
  assert.equal(calls.actorTableState, 1);
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
  assert.equal(calls.joinArgs.authoritativeSeatNo, 2);
});

test('handleJoinCommand rejects instead of degrading when authoritative join is required but unavailable', async () => {
  const { ctx, calls } = baseCtx({ seatNo: 1, buyIn: 100 });
  ctx.authoritativeJoinEnabled = true;

  await handleJoinCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, 'rejected');
  assert.equal(calls.command[0].reason, 'temporarily_unavailable');
  assert.equal(calls.joinArgs, null);
  assert.equal(calls.actorTableState, 0);
  assert.equal(calls.table, 0);
  assert.equal(calls.snapshots, 0);
});

test('handleJoinCommand authoritative rehydrate failure does not emit accepted success state', async () => {
  const { ctx, calls } = baseCtx({ seatNo: 3, buyIn: 200 });
  ctx.authoritativeJoinEnabled = true;
  ctx.persistedBootstrapEnabled = true;
  ctx.restoreTableFromPersisted = async () => ({ ok: false, reason: 'restore_error' });
  await handleJoinCommand(ctx);

  assert.equal(calls.sendError, 1);
  assert.equal(calls.command.length, 0);
  assert.equal(calls.actorTableState, 0);
  assert.equal(calls.table, 0);
});

test('handleJoinCommand rejects restored human-only authoritative state instead of broadcasting success', async () => {
  const { ctx, calls } = baseCtx({ seatNo: 1, buyIn: 200 });
  ctx.authoritativeJoinEnabled = true;
  ctx.persistedBootstrapEnabled = true;
  ctx.loadAuthoritativeJoinExecutor = async () => async () => ({
    ok: true,
    seatNo: 1,
    stack: 200,
    seededBots: [
      { userId: 'bot_2', seatNo: 2, stack: 200 },
      { userId: 'bot_3', seatNo: 3, stack: 200 }
    ]
  });
  ctx.tableManager.tableSnapshot = () => ({
    tableId: 't1',
    stateVersion: 0,
    members: [{ userId: 'u1', seat: 1 }],
    seats: [{ userId: 'u1', seatNo: 1, status: 'ACTIVE' }],
    stacks: { u1: 200 }
  });

  await handleJoinCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, 'rejected');
  assert.equal(calls.command[0].reason, 'authoritative_state_invalid');
  assert.equal(calls.joinArgs, null);
  assert.equal(calls.actorTableState, 0);
  assert.equal(calls.table, 0);
  assert.equal(calls.snapshots, 0);
});

test('handleJoinCommand accepts restored authoritative state when bots are only projected through seats and stacks', async () => {
  const { ctx, calls } = baseCtx({ seatNo: 1, buyIn: 200 });
  ctx.authoritativeJoinEnabled = true;
  ctx.persistedBootstrapEnabled = true;
  ctx.loadAuthoritativeJoinExecutor = async () => async () => ({
    ok: true,
    seatNo: 1,
    stack: 200,
    seededBots: [
      { userId: 'bot_2', seatNo: 2, stack: 200 },
      { userId: 'bot_3', seatNo: 3, stack: 200 }
    ]
  });
  ctx.tableManager.tableSnapshot = () => ({
    tableId: 't1',
    stateVersion: 2,
    members: [{ userId: 'u1', seat: 1 }],
    seats: [
      { userId: 'u1', seatNo: 1, status: 'ACTIVE' },
      { userId: 'bot_2', seatNo: 2, status: 'ACTIVE', isBot: true },
      { userId: 'bot_3', seatNo: 3, status: 'ACTIVE', isBot: true }
    ],
    stacks: { u1: 200, bot_2: 200, bot_3: 200 }
  });

  await handleJoinCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, 'accepted');
  assert.equal(calls.command[0].reason, null);
  assert.equal(calls.joinArgs.authoritativeSeatNo, 1);
  assert.equal(calls.actorTableState, 1);
  assert.equal(calls.table, 1);
});

test('handleJoinCommand rejects invalid buyIn without broadcast', async () => {
  const { ctx, calls } = baseCtx({ buyIn: -1 });
  await handleJoinCommand(ctx);
  assert.equal(calls.command.length, 0);
  assert.equal(calls.sendError, 1);
  assert.equal(calls.sentErrors[0].code, 'INVALID_COMMAND');
  assert.equal(calls.sentErrors[0].message, 'invalid_buy_in');
  assert.equal(calls.table, 0);
  assert.equal(calls.snapshots, 0);
});

test('handleJoinCommand rejects seatNo 0 and preferredSeatNo 0 deterministically', async () => {
  {
    const { ctx, calls } = baseCtx({ seatNo: 0, buyIn: 100 });
    await handleJoinCommand(ctx);
    assert.equal(calls.command.length, 0);
    assert.equal(calls.sendError, 1);
    assert.equal(calls.sentErrors[0].code, 'INVALID_COMMAND');
    assert.equal(calls.sentErrors[0].message, 'invalid_seat_no');
  }

  {
    const { ctx, calls } = baseCtx({ autoSeat: true, preferredSeatNo: 0, buyIn: 100 });
    await handleJoinCommand(ctx);
    assert.equal(calls.command.length, 0);
    assert.equal(calls.sendError, 1);
    assert.equal(calls.sentErrors[0].code, 'INVALID_COMMAND');
    assert.equal(calls.sentErrors[0].message, 'invalid_seat_no');
  }
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
  assert.equal(calls.actorTableState, 1);
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


test('handleJoinCommand rejects ensureTableLoaded failure with stable commandResult code', async () => {
  const { ctx, calls } = baseCtx({ seatNo: 2, buyIn: 100 });
  ctx.frame.__resolvedTableId = 't_missing';
  ctx.tableManager.ensureTableLoaded = async () => ({ ok: false, code: 'table_not_found' });
  ctx.ensureTableLoadedErrorMapper = () => ({ code: 'table_not_found', message: 'human text not for protocol' });
  await handleJoinCommand(ctx);

  assert.equal(calls.command.length, 0);
  assert.equal(calls.sendError, 1);
  assert.equal(calls.sentErrors[0].code, 'table_not_found');
  assert.equal(calls.table, 0);
  assert.equal(calls.snapshots, 0);
});

test('handleJoinCommand rejects join failure with stable code instead of message text', async () => {
  const { ctx, calls } = baseCtx({ seatNo: 2, buyIn: 100 });
  ctx.tableManager.join = () => ({ ok: false, code: 'seat_taken', message: 'Seat already occupied by user X' });
  await handleJoinCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, 'rejected');
  assert.equal(calls.command[0].reason, 'seat_taken');
  assert.notEqual(calls.command[0].reason, 'Seat already occupied by user X');
  assert.equal(calls.table, 0);
  assert.equal(calls.snapshots, 0);
});

test('handleJoinCommand falls back to join_failed when join failure has no code', async () => {
  const { ctx, calls } = baseCtx({ seatNo: 2, buyIn: 100 });
  ctx.tableManager.join = () => ({ ok: false, message: 'arbitrary failure text' });
  await handleJoinCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, 'rejected');
  assert.equal(calls.command[0].reason, 'join_failed');
  assert.notEqual(calls.command[0].reason, 'arbitrary failure text');
  assert.equal(calls.table, 0);
  assert.equal(calls.snapshots, 0);
});


test('handleJoinCommand maps authoritative missing-state aliases to stable state_missing rejection', async () => {
  for (const code of ['state_missing', 'poker_state_missing']) {
    const { ctx, calls } = baseCtx({ seatNo: 2, buyIn: 100 });
    ctx.authoritativeJoinEnabled = true;
    ctx.persistedBootstrapEnabled = true;
    ctx.loadAuthoritativeJoinExecutor = async () => async () => ({ ok: false, code });

    await handleJoinCommand(ctx);

    assert.equal(calls.command.length, 1);
    assert.equal(calls.command[0].status, 'rejected');
    assert.equal(calls.command[0].reason, 'state_missing');
    assert.equal(calls.actorTableState, 0);
    assert.equal(calls.table, 0);
    assert.equal(calls.snapshots, 0);
  }
});

test('handleJoinCommand maps authoritative historical seat conflicts to seat_taken', async () => {
  for (const code of ['seat_taken', 'duplicate_seat']) {
    const { ctx, calls } = baseCtx({ seatNo: 1, buyIn: 100 });
    ctx.authoritativeJoinEnabled = true;
    ctx.persistedBootstrapEnabled = true;
    ctx.loadAuthoritativeJoinExecutor = async () => async () => ({ ok: false, code });

    await handleJoinCommand(ctx);

    assert.equal(calls.command.length, 1);
    assert.equal(calls.command[0].status, 'rejected');
    assert.equal(calls.command[0].reason, 'seat_taken');
    assert.notEqual(calls.command[0].reason, 'temporarily_unavailable');
    assert.equal(calls.actorTableState, 0);
    assert.equal(calls.table, 0);
    assert.equal(calls.snapshots, 0);
  }
});


test('handleJoinCommand maps authoritative_join_failed + restore missing-state signal to state_missing', async () => {
  const { ctx, calls } = baseCtx({ seatNo: 2, buyIn: 100 });
  ctx.authoritativeJoinEnabled = true;
  ctx.persistedBootstrapEnabled = true;
  ctx.loadAuthoritativeJoinExecutor = async () => async () => ({ ok: false, code: 'authoritative_join_failed' });
  ctx.restoreTableFromPersisted = async () => ({ ok: false, reason: 'invalid_persisted_state' });

  await handleJoinCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, 'rejected');
  assert.equal(calls.command[0].reason, 'state_missing');
  assert.equal(calls.sendError, 0);
  assert.equal(calls.actorTableState, 0);
});


test('handleJoinCommand preserves temporarily_unavailable for runtime authoritative failures', async () => {
  const { ctx, calls } = baseCtx({ seatNo: 2, buyIn: 100 });
  ctx.authoritativeJoinEnabled = true;
  ctx.persistedBootstrapEnabled = true;
  ctx.loadAuthoritativeJoinExecutor = async () => async () => ({ ok: false, code: 'temporarily_unavailable' });

  await handleJoinCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, 'rejected');
  assert.equal(calls.command[0].reason, 'temporarily_unavailable');
  assert.equal(calls.actorTableState, 0);
  assert.equal(calls.table, 0);
  assert.equal(calls.snapshots, 0);
});
