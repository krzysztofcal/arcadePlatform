import test from 'node:test';
import assert from 'node:assert/strict';
import { handleStartHandCommand } from './start-hand.mjs';

test('handleStartHandCommand accepts and broadcasts on persisted change', async () => {
  const calls = { command: [], snapshots: 0, persist: 0 };
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
    sendCommandResult: (_ws, _cs, payload) => calls.command.push(payload),
    persistMutatedState: async () => { calls.persist += 1; return { ok: true }; },
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    broadcastStateSnapshots: () => { calls.snapshots += 1; }
  });
  assert.equal(calls.command[0].status, 'accepted');
  assert.equal(calls.snapshots, 1);
  assert.equal(calls.persist, 1);
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
