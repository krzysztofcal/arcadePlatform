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


test('handleActCommand persists and triggers autoplay only for accepted fresh action', async () => {
  const calls = { persisted: 0, snaps: 0, autoplay: 0, persistArgs: null };
  await handleActCommand({
    frame: { __resolvedTableId: 't1', requestId: 'r2', ts: new Date().toISOString(), payload: { handId: 'h1', action: 'CHECK' } },
    ws: {},
    connState: { session: { userId: 'u1' } },
    tableManager: {
      ensureTableLoaded: async () => ({ ok: true }),
      applyAction: () => ({
        accepted: true,
        replayed: false,
        changed: true,
        stateVersion: 2,
        reason: null,
        acceptedActionAudit: { handId: 'h1', actorUserId: 'u1', action: 'CHECK' }
      })
    },
    ensureTableLoadedErrorMapper: (x) => x,
    sendError: () => assert.fail('unexpected sendError'),
    sendCommandResult: () => {},
    persistMutatedState: async (args) => { calls.persisted += 1; calls.persistArgs = args; return { ok: true }; },
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    broadcastStateSnapshots: () => { calls.snaps += 1; },
    scheduleBotStep: () => { calls.autoplay += 1; }
  });
  assert.equal(calls.persisted, 1);
  assert.equal(calls.snaps, 1);
  assert.equal(calls.autoplay, 1);
  assert.equal(calls.persistArgs.acceptedActionAudit.source, 'human');
  assert.equal(calls.persistArgs.acceptedActionAudit.action, 'CHECK');
});

test('handleActCommand does not autoplay for replayed, rejected, or conflicted actions', async () => {
  const autoplayCalls = [];
  const conflictCalls = { snapshots: 0, resync: 0 };

  await handleActCommand({
    frame: { __resolvedTableId: 't1', requestId: 'r4', ts: new Date().toISOString(), payload: { handId: 'h1', action: 'CHECK' } },
    ws: {},
    connState: { session: { userId: 'u1' } },
    tableManager: { ensureTableLoaded: async () => ({ ok: true }), applyAction: () => ({ accepted: false, reason: 'illegal_action' }) },
    ensureTableLoadedErrorMapper: (x) => x,
    sendError: () => assert.fail('unexpected sendError'),
    sendCommandResult: () => {},
    persistMutatedState: async () => ({ ok: true }),
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    broadcastStateSnapshots: () => {},
    scheduleBotStep: () => { autoplayCalls.push('rejected'); }
  });

  await handleActCommand({
    frame: { __resolvedTableId: 't1', requestId: 'r5', ts: new Date().toISOString(), payload: { handId: 'h1', action: 'CHECK' } },
    ws: {},
    connState: { session: { userId: 'u1' } },
    tableManager: { ensureTableLoaded: async () => ({ ok: true }), applyAction: () => ({ accepted: true, replayed: true, changed: false, stateVersion: 2, reason: null }) },
    ensureTableLoadedErrorMapper: (x) => x,
    sendError: () => assert.fail('unexpected sendError'),
    sendCommandResult: () => {},
    persistMutatedState: async () => ({ ok: true }),
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    broadcastStateSnapshots: () => {},
    scheduleBotStep: () => { autoplayCalls.push('replayed'); }
  });

  await handleActCommand({
    frame: { __resolvedTableId: 't1', requestId: 'r6', ts: new Date().toISOString(), payload: { handId: 'h1', action: 'CHECK' } },
    ws: {},
    connState: { session: { userId: 'u1' } },
    tableManager: { ensureTableLoaded: async () => ({ ok: true }), applyAction: () => ({ accepted: true, replayed: false, changed: true, stateVersion: 2, reason: null }) },
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

test('handleActCommand emits resync only when restore fails after persistence conflict', async () => {
  const calls = { snapshots: 0, resync: 0 };
  await handleActCommand({
    frame: { __resolvedTableId: 't1', requestId: 'r6b', ts: new Date().toISOString(), payload: { handId: 'h1', action: 'CHECK' } },
    ws: {},
    connState: { session: { userId: 'u1' } },
    tableManager: { ensureTableLoaded: async () => ({ ok: true }), applyAction: () => ({ accepted: true, replayed: false, changed: true, stateVersion: 2, reason: null }) },
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

test('handleActCommand still broadcasts fresh state before queued autoplay runs', async () => {
  const calls = { command: [], snapshots: 0 };
  await handleActCommand({
    frame: { __resolvedTableId: 't1', requestId: 'r7', ts: new Date().toISOString(), payload: { handId: 'h1', action: 'CHECK' } },
    ws: {},
    connState: { session: { userId: 'u1' } },
    tableManager: { ensureTableLoaded: async () => ({ ok: true }), applyAction: () => ({ accepted: true, replayed: false, changed: true, stateVersion: 2, reason: null }) },
    ensureTableLoadedErrorMapper: (x) => x,
    sendError: () => assert.fail('unexpected sendError'),
    sendCommandResult: (_ws, _cs, payload) => calls.command.push(payload),
    persistMutatedState: async () => ({ ok: true }),
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    broadcastStateSnapshots: () => { calls.snapshots += 1; },
    scheduleBotStep: () => { throw new Error('scheduler_failed'); },
    klog: () => {}
  });

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, 'accepted');
  assert.equal(calls.snapshots, 1);
});


test('handleActCommand rejects ensureTableLoaded failure with mapped stable code', async () => {
  const calls = [];
  let sendErrorCalls = 0;
  await handleActCommand({
    frame: { __resolvedTableId: 't_missing', requestId: 'r3', ts: new Date().toISOString(), payload: { handId: 'h1', action: 'CHECK' } },
    ws: {},
    connState: { session: { userId: 'u1' } },
    tableManager: { ensureTableLoaded: async () => ({ ok: false, code: 'table_not_found' }), applyAction: () => ({ accepted: true }) },
    ensureTableLoadedErrorMapper: () => ({ code: 'table_not_found', message: 'human text not for protocol' }),
    sendError: () => { sendErrorCalls += 1; },
    sendCommandResult: (_ws, _cs, payload) => calls.push(payload),
    persistMutatedState: async () => ({ ok: true }),
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    broadcastStateSnapshots: () => {}
  });

  assert.equal(sendErrorCalls, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'rejected');
  assert.equal(calls[0].reason, 'table_not_found');
});

test('durable pre-lookup replay bypasses reducer, persistence, and gameplay side effects', async () => {
  const calls = { results: [], apply: 0, persist: 0, snapshots: 0, autoplay: 0, rollover: 0 };
  await handleActCommand({
    frame: { __resolvedTableId: 't1', requestId: 'durable-r1', ts: new Date().toISOString(), payload: { handId: 'h1', action: 'CHECK' } },
    ws: {},
    connState: { session: { userId: 'u1' } },
    tableManager: {
      ensureTableLoaded: async () => ({ ok: true }),
      applyAction: () => { calls.apply += 1; return { accepted: true }; }
    },
    durableActionRequired: true,
    durableActionStore: { readDurableActionRequest: async () => ({ outcome: 'durable_replay', durableResult: { status: 'accepted', reason: null, handId: 'h1', stateVersion: 2 } }) },
    ensureTableLoadedErrorMapper: (value) => value,
    sendError: () => assert.fail('unexpected sendError'),
    sendCommandResult: (_ws, _state, payload) => calls.results.push(payload),
    persistMutatedState: async () => { calls.persist += 1; return { ok: true, outcome: 'committed' }; },
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    broadcastStateSnapshots: () => { calls.snapshots += 1; },
    scheduleBotStep: () => { calls.autoplay += 1; },
    scheduleSettledRollover: () => { calls.rollover += 1; }
  });

  assert.equal(calls.results[0].status, 'accepted');
  assert.equal(calls.results[0].stateVersion, 2);
  assert.deepEqual({ apply: calls.apply, persist: calls.persist, snapshots: calls.snapshots, autoplay: calls.autoplay, rollover: calls.rollover }, { apply: 0, persist: 0, snapshots: 0, autoplay: 0, rollover: 0 });
});

test('durable fresh commit bypasses runtime cache and alone triggers side effects', async () => {
  const calls = { results: [], applyArgs: null, persistArgs: null, snapshots: 0, autoplay: 0, rollover: 0 };
  await handleActCommand({
    frame: { __resolvedTableId: 't1', requestId: 'durable-r2', ts: new Date().toISOString(), payload: { handId: 'h1', action: 'RAISE', amount: 20 } },
    ws: {},
    connState: { session: { userId: 'u1' } },
    tableManager: {
      ensureTableLoaded: async () => ({ ok: true }),
      applyAction: (args) => {
        calls.applyArgs = args;
        return { accepted: true, replayed: false, changed: true, stateVersion: 2, handId: 'h1', reason: null, acceptedActionAudit: { action: 'RAISE' } };
      }
    },
    durableActionRequired: true,
    durableActionStore: { readDurableActionRequest: async () => ({ outcome: 'missing' }) },
    ensureTableLoadedErrorMapper: (value) => value,
    sendError: () => assert.fail('unexpected sendError'),
    sendCommandResult: (_ws, _state, payload) => calls.results.push(payload),
    persistMutatedState: async (args) => { calls.persistArgs = args; return { ok: true, outcome: 'committed', newVersion: 2 }; },
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    broadcastStateSnapshots: () => { calls.snapshots += 1; },
    scheduleBotStep: () => { calls.autoplay += 1; },
    scheduleSettledRollover: () => { calls.rollover += 1; }
  });

  assert.equal(calls.applyArgs.useActionReplayCache, false);
  assert.equal(calls.persistArgs.durableActionRequest.requestId, 'durable-r2');
  assert.equal(calls.persistArgs.durableActionRequest.payloadHash.length, 64);
  assert.deepEqual(calls.persistArgs.durableActionRequest.result, { status: 'accepted', reason: null, handId: 'h1', stateVersion: 2 });
  assert.equal(calls.results[0].status, 'accepted');
  assert.deepEqual({ snapshots: calls.snapshots, autoplay: calls.autoplay, rollover: calls.rollover }, { snapshots: 1, autoplay: 1, rollover: 1 });
});

test('durable race loser restores without gameplay broadcast or side effects', async () => {
  const calls = { results: [], restores: 0, snapshots: 0, autoplay: 0, rollover: 0, resync: 0 };
  await handleActCommand({
    frame: { __resolvedTableId: 't1', requestId: 'durable-r3', ts: new Date().toISOString(), payload: { handId: 'h1', action: 'CHECK' } },
    ws: {},
    connState: { session: { userId: 'u1' } },
    tableManager: {
      ensureTableLoaded: async () => ({ ok: true }),
      applyAction: () => ({ accepted: true, replayed: false, changed: true, stateVersion: 2, handId: 'h1', reason: null })
    },
    durableActionRequired: true,
    durableActionStore: { readDurableActionRequest: async () => ({ outcome: 'missing' }) },
    ensureTableLoadedErrorMapper: (value) => value,
    sendError: () => assert.fail('unexpected sendError'),
    sendCommandResult: (_ws, _state, payload) => calls.results.push(payload),
    persistMutatedState: async () => ({ ok: true, outcome: 'durable_replay', durableResult: { status: 'accepted', reason: null, handId: 'h1', stateVersion: 2 } }),
    restoreTableFromPersisted: async () => { calls.restores += 1; return { ok: true }; },
    broadcastResyncRequired: () => { calls.resync += 1; },
    broadcastStateSnapshots: () => { calls.snapshots += 1; },
    scheduleBotStep: () => { calls.autoplay += 1; },
    scheduleSettledRollover: () => { calls.rollover += 1; }
  });

  assert.equal(calls.results[0].status, 'accepted');
  assert.deepEqual({ restores: calls.restores, snapshots: calls.snapshots, autoplay: calls.autoplay, rollover: calls.rollover, resync: calls.resync }, { restores: 1, snapshots: 0, autoplay: 0, rollover: 0, resync: 0 });
});

for (const scenario of [
  {
    name: 'invalid projected durable result',
    applyResult: { accepted: true, replayed: false, changed: true, stateVersion: null, handId: 'h1', reason: null },
    persistResult: null
  },
  {
    name: 'unexpected successful writer outcome',
    applyResult: { accepted: true, replayed: false, changed: true, stateVersion: 2, handId: 'h1', reason: null },
    persistResult: { ok: true, outcome: 'unexpected' }
  }
]) {
  test(`durable ${scenario.name} fails closed when authoritative restore fails`, async () => {
    const calls = { results: [], persist: 0, resync: 0, snapshots: 0, autoplay: 0, rollover: 0 };
    await handleActCommand({
      frame: { __resolvedTableId: 't1', requestId: `restore-${scenario.name}`, ts: new Date().toISOString(), payload: { handId: 'h1', action: 'CHECK' } },
      ws: {},
      connState: { session: { userId: 'u1' } },
      tableManager: {
        ensureTableLoaded: async () => ({ ok: true }),
        applyAction: () => scenario.applyResult
      },
      durableActionRequired: true,
      durableActionStore: { readDurableActionRequest: async () => ({ outcome: 'missing' }) },
      ensureTableLoadedErrorMapper: (value) => value,
      sendError: () => assert.fail('unexpected sendError'),
      sendCommandResult: (_ws, _state, payload) => calls.results.push(payload),
      persistMutatedState: async () => { calls.persist += 1; return scenario.persistResult; },
      restoreTableFromPersisted: async () => ({ ok: false, reason: 'restore_failed' }),
      broadcastResyncRequired: () => { calls.resync += 1; },
      broadcastStateSnapshots: () => { calls.snapshots += 1; },
      scheduleBotStep: () => { calls.autoplay += 1; },
      scheduleSettledRollover: () => { calls.rollover += 1; }
    });

    assert.equal(calls.results.length, 1);
    assert.equal(calls.results[0].status, 'rejected');
    assert.equal(calls.results[0].reason, 'durable_action_restore_failed');
    assert.equal(calls.resync, 1);
    assert.deepEqual({ snapshots: calls.snapshots, autoplay: calls.autoplay, rollover: calls.rollover }, { snapshots: 0, autoplay: 0, rollover: 0 });
    assert.equal(calls.persist, scenario.persistResult ? 1 : 0);
  });
}

test('persistent human action fails closed when durable capability is unavailable', async () => {
  const results = [];
  let applyCalls = 0;
  await handleActCommand({
    frame: { __resolvedTableId: 't1', requestId: 'durable-r4', ts: new Date().toISOString(), payload: { handId: 'h1', action: 'CHECK' } },
    ws: {},
    connState: { session: { userId: 'u1' } },
    tableManager: { ensureTableLoaded: async () => ({ ok: true }), applyAction: () => { applyCalls += 1; } },
    durableActionRequired: true,
    durableActionStore: null,
    ensureTableLoadedErrorMapper: (value) => value,
    sendError: () => assert.fail('unexpected sendError'),
    sendCommandResult: (_ws, _state, payload) => results.push(payload),
    persistMutatedState: async () => assert.fail('unexpected persistence'),
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastResyncRequired: () => {},
    broadcastStateSnapshots: () => {}
  });
  assert.equal(applyCalls, 0);
  assert.equal(results[0].reason, 'durable_action_store_unavailable');
});
