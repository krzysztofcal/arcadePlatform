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

test('seated reconnect grace delays the first cleanup attempt until grace expires', async () => {
  let currentNowMs = 1_000;
  let cleanupCalls = 0;
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async () => {
      cleanupCalls += 1;
      return { ok: true, changed: true, status: 'cleaned' };
    },
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false,
    seatedReconnectGraceMs: 5_000,
    nowMs: () => currentNowMs
  });

  runtime.enqueue({ tableId: 't_first_grace', userId: 'u_first_grace' });
  await runtime.sweep();
  assert.equal(cleanupCalls, 0);
  assert.equal(runtime.size(), 1);

  currentNowMs = 5_999;
  await runtime.sweep();
  assert.equal(cleanupCalls, 0);
  assert.equal(runtime.size(), 1);

  currentNowMs = 6_000;
  await runtime.sweep();
  assert.equal(cleanupCalls, 1);
  assert.equal(runtime.size(), 0);
});

test('seated reconnect grace delays deferred cleanup retry until grace expires', async () => {
  let currentNowMs = 1_000;
  let cleanupCalls = 0;
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async () => {
      cleanupCalls += 1;
      return cleanupCalls === 1
        ? { ok: true, changed: false, deferred: true, status: 'cleaned_live_hand_preserved' }
        : { ok: true, changed: true, status: 'cleaned' };
    },
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false,
    seatedReconnectGraceMs: 5_000,
    nowMs: () => currentNowMs
  });

  runtime.enqueue({ tableId: 't_grace', userId: 'u_grace' });
  await runtime.sweep();
  assert.equal(cleanupCalls, 0);
  assert.equal(runtime.size(), 1);

  currentNowMs = 5_999;
  await runtime.sweep();
  assert.equal(cleanupCalls, 0);
  assert.equal(runtime.size(), 1);

  currentNowMs = 6_000;
  await runtime.sweep();
  assert.equal(cleanupCalls, 1);
  assert.equal(runtime.size(), 1);

  currentNowMs = 10_999;
  await runtime.sweep();
  assert.equal(cleanupCalls, 1);
  assert.equal(runtime.size(), 1);

  currentNowMs = 11_000;
  await runtime.sweep();
  assert.equal(cleanupCalls, 2);
  assert.equal(runtime.size(), 0);
});

test('protected or deferred results refresh reconnect grace on each retry', async () => {
  let currentNowMs = 1_000;
  let cleanupCalls = 0;
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async () => {
      cleanupCalls += 1;
      if (cleanupCalls < 3) {
        return { ok: true, changed: false, deferred: true, status: 'cleaned_live_hand_preserved' };
      }
      return { ok: true, changed: true, status: 'cleaned' };
    },
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false,
    seatedReconnectGraceMs: 5_000,
    nowMs: () => currentNowMs
  });

  runtime.enqueue({ tableId: 't_refresh_grace', userId: 'u_refresh_grace' });

  await runtime.sweep();
  assert.equal(cleanupCalls, 0);
  assert.equal(runtime.size(), 1);

  currentNowMs = 6_000;
  await runtime.sweep();
  assert.equal(cleanupCalls, 1);
  assert.equal(runtime.size(), 1);

  currentNowMs = 10_999;
  await runtime.sweep();
  assert.equal(cleanupCalls, 1);
  assert.equal(runtime.size(), 1);

  currentNowMs = 11_000;
  await runtime.sweep();
  assert.equal(cleanupCalls, 2);
  assert.equal(runtime.size(), 1);

  currentNowMs = 16_000;
  await runtime.sweep();
  assert.equal(cleanupCalls, 3);
  assert.equal(runtime.size(), 0);
});

test('success cleanup triggers onChanged', async () => {
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

test('retryable vs terminal cleanup failure', async () => {
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

test('protected cleanup keeps candidate queued and skips onChanged', async () => {
  const changed = [];
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async () => ({ ok: true, changed: false, protected: true, status: 'turn_protected', retryable: true }),
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false,
    onChanged: (tableId, result) => changed.push({ tableId, result })
  });

  runtime.enqueue({ tableId: 't_protected', userId: 'u9' });
  await runtime.sweep();

  assert.equal(runtime.size(), 1);
  assert.equal(changed.length, 0);
});

test('deferred cleanup keeps candidate queued and skips onChanged', async () => {
  const changed = [];
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async () => ({ ok: true, changed: false, deferred: true, status: 'cleaned_live_hand_preserved' }),
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false,
    onChanged: (tableId, result) => changed.push({ tableId, result })
  });

  runtime.enqueue({ tableId: 't_deferred', userId: 'u10' });
  await runtime.sweep();

  assert.equal(runtime.size(), 1);
  assert.equal(changed.length, 0);
});

test('deferred cleanup completes on a later sweep after the hand ends', async () => {
  const changed = [];
  let cleanupCalls = 0;
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async () => {
      cleanupCalls += 1;
      return cleanupCalls === 1
        ? { ok: true, changed: false, deferred: true, status: 'cleaned_live_hand_preserved' }
        : { ok: true, changed: true, status: 'cleaned' };
    },
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false,
    onChanged: (tableId, result) => changed.push({ tableId, result })
  });

  runtime.enqueue({ tableId: 't_deferred_done', userId: 'u11' });
  await runtime.sweep();
  assert.equal(runtime.size(), 1);
  assert.equal(changed.length, 0);

  await runtime.sweep();
  assert.equal(runtime.size(), 0);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].tableId, 't_deferred_done');
  assert.equal(changed[0].result.status, 'cleaned');
});

test('repeated cleanup idempotency', async () => {
  let cleanupCalls = 0;
  const changed = [];
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async () => {
      cleanupCalls += 1;
      return cleanupCalls === 1
        ? { ok: true, changed: true, status: 'cleaned' }
        : { ok: true, changed: false, status: 'already_inactive' };
    },
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false,
    onChanged: (tableId, result) => changed.push({ tableId, result })
  });

  runtime.enqueue({ tableId: 't_idem', userId: 'u6' });
  await runtime.sweep();
  runtime.enqueue({ tableId: 't_idem', userId: 'u6' });
  await runtime.sweep();

  assert.equal(runtime.size(), 0);
  assert.equal(changed.length, 2);
  assert.equal(changed[0].result.changed, true);
  assert.equal(changed[1].result.changed, false);
  assert.equal(changed[1].result.status, 'already_inactive');
});

test('awaited async onChanged', async () => {
  const order = [];
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async ({ userId }) => {
      order.push(`cleanup:${userId}`);
      return { ok: true, changed: true };
    },
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false,
    onChanged: async (_tableId, result) => {
      order.push(`onChanged:start:${result.ok}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
      order.push('onChanged:end');
    }
  });

  runtime.enqueue({ tableId: 't_async_1', userId: 'u7' });
  runtime.enqueue({ tableId: 't_async_2', userId: 'u8' });
  await runtime.sweep();

  assert.deepEqual(order, [
    'cleanup:u7',
    'onChanged:start:true',
    'onChanged:end',
    'cleanup:u8',
    'onChanged:start:true',
    'onChanged:end'
  ]);
});
