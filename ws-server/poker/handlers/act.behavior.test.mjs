import test from 'node:test';
import assert from 'node:assert/strict';
import { handleActCommand } from './act.mjs';

test('handleActCommand maps rejection reasons', async () => {
  const calls = [];
  await handleActCommand({
    frame: { __resolvedTableId: 't1', requestId: 'r1', ts: new Date().toISOString(), payload: { handId: 'h1', action: 'CHECK' } },
    ws: {},
    connState: { session: { userId: 'u1' } },
    tableManager: { ensureTableLoaded: async () => ({ ok: true }), applyAction: () => ({ accepted: false, reason: 'illegal_action' }) },
    ensureTableLoadedErrorMapper: (x) => x,
    sendError: () => assert.fail('unexpected sendError'),
    sendCommandResult: (_ws, _cs, payload) => calls.push(payload),
    persistMutatedState: async () => ({ ok: true }),
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    broadcastStateSnapshots: () => {}
  });
  assert.equal(calls[0].reason, 'action_not_allowed');
});


test('handleActCommand persists and broadcasts only for accepted fresh action', async () => {
  const calls = { persisted: 0, snaps: 0 };
  await handleActCommand({
    frame: { __resolvedTableId: 't1', requestId: 'r2', ts: new Date().toISOString(), payload: { handId: 'h1', action: 'CHECK' } },
    ws: {},
    connState: { session: { userId: 'u1' } },
    tableManager: { ensureTableLoaded: async () => ({ ok: true }), applyAction: () => ({ accepted: true, replayed: false, changed: true, stateVersion: 2, reason: null }) },
    ensureTableLoadedErrorMapper: (x) => x,
    sendError: () => assert.fail('unexpected sendError'),
    sendCommandResult: () => {},
    persistMutatedState: async () => { calls.persisted += 1; return { ok: true }; },
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    broadcastStateSnapshots: () => { calls.snaps += 1; }
  });
  assert.equal(calls.persisted, 1);
  assert.equal(calls.snaps, 1);
});
