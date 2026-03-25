import test from 'node:test';
import assert from 'node:assert/strict';
import { createDisconnectCleanupRuntime } from './disconnect-cleanup.mjs';

function socketFor(tableId) {
  return { __connState: { joinedTableId: tableId, subscribedTableId: null } };
}

test('reconnect before sweep skips cleanup and removes candidate', async () => {
  const calls = [];
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async (input) => { calls.push(input); return { ok: true, changed: true }; },
    listActiveSocketsForUser: () => [socketFor('t1')],
    socketMatchesTable: (socket, tableId) => socket?.__connState?.joinedTableId === tableId
  });
  runtime.enqueue({ tableId: 't1', userId: 'u1' });
  await runtime.sweep();
  assert.equal(calls.length, 0);
  assert.equal(runtime.size(), 0);
});

test('successful cleanup de-queues candidate and triggers onChanged', async () => {
  const changed = [];
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async () => ({ ok: true, changed: true }),
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false,
    onChanged: (tableId, result) => changed.push({ tableId, result })
  });
  runtime.enqueue({ tableId: 't_success', userId: 'u1' });
  await runtime.sweep();
  assert.equal(runtime.size(), 0);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].tableId, 't_success');
  assert.equal(changed[0].result.ok, true);
});

test('cleanup failure matrix keeps retryable candidates and removes terminal failures', async () => {
  const retryableRuntime = createDisconnectCleanupRuntime({
    executeCleanup: async () => ({ ok: false, code: 'inactive_cleanup_failed', retryable: true }),
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false
  });
  retryableRuntime.enqueue({ tableId: 't_retry', userId: 'u4' });
  await retryableRuntime.sweep();
  assert.equal(retryableRuntime.size(), 1);

  const terminalRuntime = createDisconnectCleanupRuntime({
    executeCleanup: async () => ({ ok: false, code: 'temporarily_unavailable', retryable: false }),
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false
  });
  terminalRuntime.enqueue({ tableId: 't_terminal', userId: 'u5' });
  await terminalRuntime.sweep();
  assert.equal(terminalRuntime.size(), 0);
});
