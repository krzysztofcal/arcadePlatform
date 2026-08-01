import test from 'node:test';
import assert from 'node:assert/strict';
import { createDisconnectCleanupRuntime } from './disconnect-cleanup.mjs';
import { runTableJanitor } from './table-janitor.mjs';

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

test('forgetTable removes only cleanup candidates owned by the evicted table', () => {
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async () => ({ ok: true }),
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false
  });

  runtime.enqueue({ tableId: 't_evicted', userId: 'u1' });
  runtime.enqueue({ tableId: 't_evicted', userId: 'u2' });
  runtime.enqueue({ tableId: 't_retained', userId: 'u3' });

  assert.equal(runtime.forgetTable('t_evicted'), 2);
  assert.equal(runtime.forgetTable('t_evicted'), 0);
  assert.equal(runtime.size(), 1);
});


test('concurrent sweeps coalesce cleanup and emit one janitor result', async () => {
  let releaseCleanup;
  let cleanupStartedResolve;
  const cleanupStarted = new Promise((resolve) => {
    cleanupStartedResolve = resolve;
  });
  const cleanupGate = new Promise((resolve) => {
    releaseCleanup = resolve;
  });
  const cleanupCalls = [];
  const logs = [];
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async (input) => {
      cleanupCalls.push(input);
      cleanupStartedResolve();
      await cleanupGate;
      return runTableJanitor({
        classification: {
          tableId: input.tableId,
          healthy: false,
          classification: 'disconnect_cleanup',
          action: 'disconnect_cleanup',
          reasonCode: 'disconnect_candidate',
          concerns: [],
          userId: input.userId
        },
        trigger: 'disconnect_cleanup',
        requestId: input.requestId,
        primitives: {
          disconnect_cleanup: async () => ({
            ok: true,
            changed: true,
            status: 'managed_continuous_human_removed',
            retryable: false
          })
        },
        klog: (kind, data) => logs.push({ kind, data }),
        klogVerbose: () => {}
      });
    },
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false
  });

  runtime.enqueue({ tableId: 't_coalesced', userId: 'u_coalesced' });
  const firstSweep = runtime.sweep();
  await cleanupStarted;
  const secondSweep = runtime.sweep();
  assert.strictEqual(firstSweep, secondSweep);

  releaseCleanup();
  await secondSweep;

  assert.equal(cleanupCalls.length, 1);
  assert.deepEqual(logs.map((entry) => entry.kind), ['ws_table_janitor_result']);
  assert.equal(logs[0].data.status, 'managed_continuous_human_removed');
});

test('sweep requests during an active round schedule one follow-up round', async () => {
  let releaseFirst;
  let firstStartedResolve;
  const firstStarted = new Promise((resolve) => {
    firstStartedResolve = resolve;
  });
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const calls = [];
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async ({ tableId }) => {
      calls.push(tableId);
      if (tableId === 't_first') {
        firstStartedResolve();
        await firstGate;
      }
      return { ok: true, changed: true, status: 'cleaned', retryable: false };
    },
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false
  });

  runtime.enqueue({ tableId: 't_first', userId: 'u_first' });
  const firstSweep = runtime.sweep();
  await firstStarted;
  runtime.enqueue({ tableId: 't_second', userId: 'u_second' });
  const secondSweep = runtime.sweep();
  assert.strictEqual(firstSweep, secondSweep);

  releaseFirst();
  await firstSweep;

  assert.deepEqual(calls, ['t_first', 't_second']);
  assert.equal(runtime.size(), 0);
});

test('sweep state is cleared after a failed round', async () => {
  let shouldFail = true;
  let cleanupCalls = 0;
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async () => {
      cleanupCalls += 1;
      if (shouldFail) {
        shouldFail = false;
        throw new Error('cleanup_failed');
      }
      return { ok: true, changed: true, status: 'cleaned', retryable: false };
    },
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false
  });

  runtime.enqueue({ tableId: 't_failed_round', userId: 'u_failed_round' });
  await assert.rejects(runtime.sweep(), /cleanup_failed/);
  assert.equal(runtime.size(), 1);

  await runtime.sweep();
  assert.equal(cleanupCalls, 2);
  assert.equal(runtime.size(), 0);
});


test('concurrent janitor failure emits one ERROR result', async () => {
  let releaseCleanup;
  let cleanupStartedResolve;
  const cleanupStarted = new Promise((resolve) => {
    cleanupStartedResolve = resolve;
  });
  const cleanupGate = new Promise((resolve) => {
    releaseCleanup = resolve;
  });
  const cleanupCalls = [];
  const logs = [];
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async (input) => {
      cleanupCalls.push(input);
      cleanupStartedResolve();
      await cleanupGate;
      return runTableJanitor({
        classification: {
          tableId: input.tableId,
          healthy: false,
          classification: 'disconnect_cleanup',
          action: 'disconnect_cleanup',
          reasonCode: 'disconnect_candidate',
          concerns: [],
          userId: input.userId
        },
        trigger: 'disconnect_cleanup',
        requestId: input.requestId,
        primitives: {
          disconnect_cleanup: async () => ({
            ok: false,
            changed: false,
            status: 'cleanup_failed',
            code: 'inactive_cleanup_failed',
            retryable: false
          })
        },
        klog: (kind, data) => logs.push({ kind, data }),
        klogVerbose: () => {}
      });
    },
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false
  });

  runtime.enqueue({ tableId: 't_failed', userId: 'u_failed' });
  const firstSweep = runtime.sweep();
  await cleanupStarted;
  const secondSweep = runtime.sweep();
  assert.strictEqual(firstSweep, secondSweep);

  releaseCleanup();
  await secondSweep;

  assert.equal(cleanupCalls.length, 1);
  assert.deepEqual(logs.map((entry) => entry.kind), ['ws_table_janitor_result']);
  assert.equal(logs[0].data.ok, false);
});


test('a requested follow-up round still runs after a failed round', async () => {
  let shouldFail = true;
  let cleanupCalls = 0;
  const runtime = createDisconnectCleanupRuntime({
    executeCleanup: async () => {
      cleanupCalls += 1;
      if (shouldFail) {
        shouldFail = false;
        throw new Error('cleanup_failed');
      }
      return { ok: true, changed: true, status: 'cleaned', retryable: false };
    },
    listActiveSocketsForUser: () => [],
    socketMatchesTable: () => false
  });

  runtime.enqueue({ tableId: 't_failed_rerun', userId: 'u_failed_rerun' });
  const firstSweep = runtime.sweep();
  const secondSweep = runtime.sweep();
  assert.strictEqual(firstSweep, secondSweep);
  await assert.rejects(firstSweep, /cleanup_failed/);

  assert.equal(cleanupCalls, 2);
  assert.equal(runtime.size(), 0);
});
