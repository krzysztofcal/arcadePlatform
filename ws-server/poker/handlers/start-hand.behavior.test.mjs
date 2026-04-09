import test from 'node:test';
import assert from 'node:assert/strict';
import { handleStartHandCommand } from './start-hand.mjs';

test('handleStartHandCommand accepts and broadcasts on persisted change', async () => {
  const calls = { command: [], snapshots: 0, persist: 0, autoplay: 0 };
  await handleStartHandCommand({
    frame: { __resolvedTableId: 't1', requestId: 'r1' },
    ws: {},
    connState: { session: { userId: 'u1' } },
    tableManager: {
      ensureTableLoaded: async () => ({ ok: true }),
      tableSnapshot: () => ({ youSeat: 1 }),
      persistedStateVersion: () => 2,
      bootstrapHand: () => ({ ok: true, changed: true, bootstrap: 'started' })
    },
    ensureTableLoadedErrorMapper: (x) => x,
    sendError: () => assert.fail('unexpected sendError'),
    sendCommandResult: (_ws, _cs, payload) => { calls.command.push(payload); },
    persistMutatedState: async () => { calls.persist += 1; return { ok: true }; },
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    broadcastStateSnapshots: () => { calls.snapshots += 1; },
    scheduleBotStep: () => { calls.autoplay += 1; }
  });
  assert.equal(calls.command[0].status, 'accepted');
  assert.equal(calls.snapshots, 1);
  assert.equal(calls.persist, 1);
  assert.equal(calls.autoplay, 1);
});

test('handleStartHandCommand does not autoplay on rejected or persist-conflict outcomes', async () => {
  const autoplayCalls = [];
  const conflictCalls = { snapshots: 0, resync: 0 };

  await handleStartHandCommand({
    frame: { __resolvedTableId: 't1', requestId: 'r4' },
    ws: {},
    connState: { session: { userId: 'observer_u' } },
    tableManager: {
      ensureTableLoaded: async () => ({ ok: true }),
      tableSnapshot: () => ({ youSeat: null }),
      persistedStateVersion: () => 2,
      bootstrapHand: () => ({ ok: true, changed: true, bootstrap: 'started' })
    },
    ensureTableLoadedErrorMapper: (x) => x,
    sendError: () => assert.fail('unexpected sendError'),
    sendCommandResult: () => {},
    persistMutatedState: async () => ({ ok: true }),
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    broadcastStateSnapshots: () => {},
    scheduleBotStep: () => { autoplayCalls.push('rejected'); }
  });

  await handleStartHandCommand({
    frame: { __resolvedTableId: 't1', requestId: 'r5' },
    ws: {},
    connState: { session: { userId: 'u1' } },
    tableManager: {
      ensureTableLoaded: async () => ({ ok: true }),
      tableSnapshot: () => ({ youSeat: 1 }),
      persistedStateVersion: () => 2,
      bootstrapHand: () => ({ ok: true, changed: true, bootstrap: 'started' })
    },
    ensureTableLoadedErrorMapper: (x) => x,
    sendError: () => assert.fail('unexpected sendError'),
    sendCommandResult: () => {},
    persistMutatedState: async () => ({ ok: false, reason: 'persistence_conflict' }),
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => { conflictCalls.resync += 1; },
    broadcastStateSnapshots: () => { conflictCalls.snapshots += 1; },
    scheduleBotStep: () => { autoplayCalls.push('conflict'); }
  });

  assert.deepEqual(autoplayCalls, []);
  assert.equal(conflictCalls.snapshots, 1);
  assert.equal(conflictCalls.resync, 0);
});

test('handleStartHandCommand emits resync only when restore fails after persist conflict', async () => {
  const calls = { snapshots: 0, resync: 0 };
  await handleStartHandCommand({
    frame: { __resolvedTableId: 't1', requestId: 'r5b' },
    ws: {},
    connState: { session: { userId: 'u1' } },
    tableManager: {
      ensureTableLoaded: async () => ({ ok: true }),
      tableSnapshot: () => ({ youSeat: 1 }),
      persistedStateVersion: () => 2,
      bootstrapHand: () => ({ ok: true, changed: true, bootstrap: 'started' })
    },
    ensureTableLoadedErrorMapper: (x) => x,
    sendError: () => assert.fail('unexpected sendError'),
    sendCommandResult: () => {},
    persistMutatedState: async () => ({ ok: false, reason: 'persistence_conflict' }),
    restoreTableFromPersisted: async () => ({ ok: false, reason: 'restore_failed' }),
    broadcastResyncRequired: () => { calls.resync += 1; },
    broadcastStateSnapshots: () => { calls.snapshots += 1; },
    scheduleBotStep: () => assert.fail('unexpected autoplay')
  });

  assert.equal(calls.snapshots, 0);
  assert.equal(calls.resync, 1);
});

test('handleStartHandCommand rejects non-seated caller without persist or broadcast', async () => {
  const calls = { command: [], snapshots: 0, persist: 0 };
  await handleStartHandCommand({
    frame: { __resolvedTableId: 't1', requestId: 'r2' },
    ws: {},
    connState: { session: { userId: 'observer_u' } },
    tableManager: {
      ensureTableLoaded: async () => ({ ok: true }),
      tableSnapshot: () => ({ youSeat: null }),
      persistedStateVersion: () => 2,
      bootstrapHand: () => ({ ok: true, changed: true, bootstrap: 'started' })
    },
    ensureTableLoadedErrorMapper: (x) => x,
    sendError: () => assert.fail('unexpected sendError'),
    sendCommandResult: (_ws, _cs, payload) => calls.command.push(payload),
    persistMutatedState: async () => { calls.persist += 1; return { ok: true }; },
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    broadcastStateSnapshots: () => { calls.snapshots += 1; }
  });
  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, 'rejected');
  assert.equal(calls.command[0].reason, 'not_seated');
  assert.equal(calls.persist, 0);
  assert.equal(calls.snapshots, 0);
});


test('handleStartHandCommand rejects ensureTableLoaded failure with stable commandResult code', async () => {
  const calls = { command: [], snapshots: 0, persist: 0, sendError: 0 };
  await handleStartHandCommand({
    frame: { __resolvedTableId: 't_missing', requestId: 'r3' },
    ws: {},
    connState: { session: { userId: 'u1' } },
    tableManager: {
      ensureTableLoaded: async () => ({ ok: false, code: 'table_not_found' }),
      tableSnapshot: () => ({ youSeat: 1 }),
      persistedStateVersion: () => 2,
      bootstrapHand: () => ({ ok: true, changed: true, bootstrap: 'started' })
    },
    ensureTableLoadedErrorMapper: () => ({ code: 'table_not_found', message: 'human text not for protocol' }),
    sendError: () => { calls.sendError += 1; },
    sendCommandResult: (_ws, _cs, payload) => calls.command.push(payload),
    persistMutatedState: async () => { calls.persist += 1; return { ok: true }; },
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    broadcastStateSnapshots: () => { calls.snapshots += 1; }
  });

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, 'rejected');
  assert.equal(calls.command[0].reason, 'table_not_found');
  assert.equal(calls.sendError, 0);
  assert.equal(calls.persist, 0);
  assert.equal(calls.snapshots, 0);
});

test('handleStartHandCommand still broadcasts fresh state before queued autoplay runs', async () => {
  const calls = { command: [], snapshots: 0, persist: 0 };
  await handleStartHandCommand({
    frame: { __resolvedTableId: 't1', requestId: 'r6' },
    ws: {},
    connState: { session: { userId: 'u1' } },
    tableManager: {
      ensureTableLoaded: async () => ({ ok: true }),
      tableSnapshot: () => ({ youSeat: 1 }),
      persistedStateVersion: () => 2,
      bootstrapHand: () => ({ ok: true, changed: true, bootstrap: 'started' })
    },
    ensureTableLoadedErrorMapper: (x) => x,
    sendError: () => assert.fail('unexpected sendError'),
    sendCommandResult: (_ws, _cs, payload) => calls.command.push(payload),
    persistMutatedState: async () => { calls.persist += 1; return { ok: true }; },
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    broadcastStateSnapshots: () => { calls.snapshots += 1; },
    scheduleBotStep: () => { throw new Error('scheduler_failed'); },
    klog: () => {}
  });

  assert.equal(calls.command.length, 1);
    assert.equal(calls.command[0].status, 'accepted');
    assert.equal(calls.persist, 1);
    assert.equal(calls.snapshots, 1);
});
