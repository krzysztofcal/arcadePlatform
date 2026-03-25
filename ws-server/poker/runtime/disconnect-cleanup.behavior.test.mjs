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

test('protected-turn result keeps candidate for retry', async () => {
  let calls = 0;
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async () => { calls += 1; return { ok: true, protected: true, retryable: true }; },
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false
  });
  runtime.enqueue({ tableId: 't1', userId: 'u1' });
  await runtime.sweep();
  assert.equal(calls, 1);
  assert.equal(runtime.size(), 1);
});

test('one of two sockets closed still skips cleanup', async () => {
  let calls = 0;
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async () => { calls += 1; return { ok: true, changed: true }; },
    listActiveSocketsForUser: () => [socketFor('t2')],
    socketMatchesTable: (socket, tableId) => socket?.__connState?.joinedTableId === tableId
  });
  runtime.enqueue({ tableId: 't2', userId: 'u2' });
  await runtime.sweep();
  assert.equal(calls, 0);
});

test('successful cleanup triggers changed callback and de-queues candidate', async () => {
  const changed = [];
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async () => ({ ok: true, changed: true, closed: true }),
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false,
    onChanged: (tableId, result) => changed.push({ tableId, result })
  });
  runtime.enqueue({ tableId: 't3', userId: 'u3' });
  await runtime.sweep();
  assert.equal(runtime.size(), 0);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].tableId, 't3');
});

test('cleanup failure keeps candidate for retry', async () => {
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async () => ({ ok: false, code: 'inactive_cleanup_failed' }),
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false
  });
  runtime.enqueue({ tableId: 't4', userId: 'u4' });
  await runtime.sweep();
  assert.equal(runtime.size(), 1);
});
