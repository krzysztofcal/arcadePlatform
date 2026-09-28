import test from "node:test";
import assert from "node:assert/strict";
import { createTableManager } from "../table/table-manager.mjs";
import { persistAuthoritativeSlowOnlyForUser } from "./poker-access-propagation.mjs";

test("recovery persists authoritative SLOW-only marker before releasing the fail-closed barrier", async () => {
  const tableId = "table_access_recovery_slow";
  const userId = "00000000-0000-4000-8000-000000000031";
  const manager = createTableManager({ maxSeats: 4 });
  assert.equal(manager.restoreTableFromPersisted(tableId, {
    tableMeta: { maxPlayers: 4, lifecycleKind: "STANDARD", isSlowOnly: false },
    coreState: {
      version: 2,
      roomId: tableId,
      maxSeats: 4,
      members: [{ userId, seat: 1 }],
      seats: { [userId]: 1 },
      seatDetailsByUserId: { [userId]: { isBot: false } },
      pokerState: { phase: "SETTLED", handId: "hand_access_recovery", stacks: { [userId]: 100 } }
    }
  }).ok, true);
  manager.setPokerAccessMutationFailClosed(userId, true);

  let persisted = false;
  const tx = {
    async unsafe(sql, params) {
      assert.match(String(sql), /set is_slow_only = true/);
      assert.deepEqual(params, [userId]);
      persisted = true;
      return [{ id: tableId }];
    }
  };
  const tableIds = await persistAuthoritativeSlowOnlyForUser(tx, {
    userId,
    schemaBacked: true,
    effectiveClass: "SLOW"
  });
  assert.deepEqual(tableIds, [tableId]);
  assert.equal(persisted, true);

  manager.markSlowOnlyTables(tableIds);
  assert.equal(manager.tableMeta(tableId).isSlowOnly, true);
  manager.setPokerAccessMutationFailClosed(userId, false);
  manager.cachePokerAccess(tableId, userId, {
    automaticClass: "SLOW", override: "FORCE_SLOW", effectiveClass: "SLOW", revision: 9,
    loadedAtMs: 100, expiresAtMs: 30_100
  }, { schemaBacked: true, slowThresholdCh: 1_000_000_000, revision: 1, loadedAtMs: 100, expiresAtMs: 30_100 }, 100);
  assert.equal(manager.settledAccessStatus(tableId, { nowMs: 100 }).known, true);

  manager.cachePokerAccess(tableId, userId, {
    automaticClass: "SLOW", override: "FORCE_NORMAL", effectiveClass: "NORMAL", revision: 10,
    loadedAtMs: 200, expiresAtMs: 30_200
  }, null, 200);
  assert.equal(manager.tableMeta(tableId).isSlowOnly, true);
  manager.cachePokerAccess(tableId, userId, {
    automaticClass: "SLOW", override: "AUTO", effectiveClass: "SLOW", revision: 11,
    loadedAtMs: 300, expiresAtMs: 30_300
  }, null, 300);
  assert.equal(manager.tableMeta(tableId).isSlowOnly, true);
});

test("authoritative SLOW persistence is a no-op for legacy or non-SLOW snapshots", async () => {
  let calls = 0;
  const tx = { unsafe: async () => { calls += 1; return []; } };
  assert.deepEqual(await persistAuthoritativeSlowOnlyForUser(tx, {
    userId: "00000000-0000-4000-8000-000000000031",
    schemaBacked: false,
    effectiveClass: "SLOW"
  }), []);
  assert.deepEqual(await persistAuthoritativeSlowOnlyForUser(tx, {
    userId: "00000000-0000-4000-8000-000000000031",
    schemaBacked: true,
    effectiveClass: "NORMAL"
  }), []);
  assert.equal(calls, 0);
});

// Execute the real server control points without starting sockets or periodic
// timers; only the authoritative DB and transport boundaries are substituted.
async function accessRuntimeFixture() {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../server.mjs', import.meta.url), 'utf8');
  const propagation = await import('./poker-access-propagation.mjs');
  const { normalizeAccessOverride } = await import('../../../shared/poker-domain/bot-access.mjs');
  const userId = '00000000-0000-4000-8000-000000000031';
  const manager = createTableManager({ maxSeats: 4 });
  const pending = new Map();
  let snapshot = { schemaBacked: true, revision: 8, override: 'AUTO', effectiveClass: 'NORMAL' };
  let failRead = false;
  let persisted = false;
  let candidateIds = [];
  let readBarrier = null;
  let activeUsers = [];
  const deps = {
    pendingPokerAccessMutations: pending, tableManager: manager,
    sessionStore: { activeUserIds: () => activeUsers, connectionsForUser: () => [] },
    hasSupabaseDbUrl: true, normalizeAccessOverride,
    loadBeginSqlWs: async () => async (fn) => {
      if (failRead) throw new Error('db_unavailable');
      return fn({ unsafe: async () => { persisted = true; return []; } });
    },
    readPokerAccessSnapshot: async () => {
      const value = { ...snapshot };
      const barrier = readBarrier;
      readBarrier = null;
      if (barrier) await barrier;
      return value;
    },
    readPokerAccessSnapshots: async (_tx, { userIds }) => {
      candidateIds = userIds;
      return new Map(userIds.map(id => [id, { ...snapshot }]));
    },
    readPokerAccessPolicy: async () => ({ revision: 1, slowThresholdCh: 1000000000 }),
    readSettledBotFundingSnapshot: async () => null,
    persistAuthoritativeSlowOnlyForUser,
    buildPokerAccessRefreshCandidates: propagation.buildPokerAccessRefreshCandidates,
    sendPokerAccessFrame: () => {}, klogSafe: () => {}
  };
  const code = source.slice(source.indexOf('function beginPokerAccessMutation('), source.indexOf('function broadcastPokerAccessTransition('))
    + source.slice(source.indexOf('let settledBotFundingSnapshot ='), source.indexOf('function resolvePositiveInt('));
  const runtime = new Function(...Object.keys(deps), code + '\nreturn { beginPokerAccessMutation, refreshPokerAccessForUser, refreshActivePokerAccess };')(...Object.values(deps));
  return { ...runtime, manager, pending, userId,
    setSnapshot: value => { snapshot = { ...snapshot, ...value }; },
    setReadFailure: value => { failRead = value; },
    setActive: () => { activeUsers = [userId]; },
    holdNextRead: () => new Promise(resolve => {
      readBarrier = new Promise(release => { resolve(release); });
    }),
    persisted: () => persisted, candidates: () => candidateIds };
}

test('offline pending-only user recovers committed SLOW and persists before clearing barrier', async () => {
  const f = await accessRuntimeFixture();
  f.beginPokerAccessMutation(f.userId, 8, 'FORCE_SLOW');
  f.setSnapshot({ revision: 9, override: 'FORCE_SLOW', effectiveClass: 'SLOW' });
  f.setReadFailure(true);
  assert.equal((await f.refreshPokerAccessForUser(f.userId)).failClosed, true);
  assert.equal(f.pending.has(f.userId), true);
  f.setReadFailure(false);
  await f.refreshActivePokerAccess();
  assert.deepEqual(f.candidates(), [f.userId]);
  assert.equal(f.persisted(), true);
  assert.equal(f.pending.has(f.userId), false);
  assert.equal(f.manager.isPokerAccessMutationFailClosed(f.userId), false);
});

test('periodic recovery cannot release a truly concurrent uncommitted Admin barrier', async () => {
  const f = await accessRuntimeFixture();
  f.setActive();
  f.beginPokerAccessMutation(f.userId, 8, 'FORCE_RESTRICTED');
  await f.refreshActivePokerAccess();
  assert.equal(f.pending.has(f.userId), true);
  assert.equal(f.manager.isPokerAccessMutationFailClosed(f.userId), true);
});

test('authoritative WS ACK contains exact state after barrier release and supports immediate AUTO', async () => {
  const f = await accessRuntimeFixture();
  f.beginPokerAccessMutation(f.userId, 8, 'FORCE_RESTRICTED');
  f.setSnapshot({ revision: 9, override: 'FORCE_RESTRICTED', effectiveClass: 'RESTRICTED' });
  const ack = await f.refreshPokerAccessForUser(f.userId);
  assert.equal(ack.revision, 9);
  assert.equal(ack.override, 'FORCE_RESTRICTED');
  assert.equal(ack.effectiveClass, 'RESTRICTED');
  assert.equal(ack.pending, false);
  assert.equal(ack.failClosed, false);
  assert.equal(f.pending.has(f.userId), false);
  assert.equal(f.manager.isPokerAccessMutationFailClosed(f.userId), false);
  assert.equal(f.beginPokerAccessMutation(f.userId, 9, 'AUTO').ok, true);
  f.setSnapshot({ revision: 10, override: 'AUTO', effectiveClass: 'NORMAL' });
  const next = await f.refreshPokerAccessForUser(f.userId);
  assert.equal(next.override, 'AUTO');
  assert.equal(next.revision, 10);
  assert.equal(next.pending, false);
});

test('refresh candidates prioritize pending, deduplicate and retain the bound', async () => {
  const { buildPokerAccessRefreshCandidates } = await import('./poker-access-propagation.mjs');
  assert.equal(typeof buildPokerAccessRefreshCandidates, 'function');
  assert.deepEqual(buildPokerAccessRefreshCandidates({ pendingUserIds: ['offline', 'active'],
    activeUserIds: ['active', 'session', '', null], seatedUserIds: ['seated'], limit: 3 }), ['offline', 'active', 'session']);
});


test('late refresh of an earlier mutation cannot clear a newer pending barrier', async () => {
  const f = await accessRuntimeFixture();
  f.beginPokerAccessMutation(f.userId, 8, 'FORCE_RESTRICTED');
  f.setSnapshot({ revision: 9, override: 'FORCE_RESTRICTED', effectiveClass: 'RESTRICTED' });
  const release = await f.holdNextRead();
  const delayed = f.refreshPokerAccessForUser(f.userId);
  // Let the delayed request reach its DB read, then confirm through another request.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.refreshPokerAccessForUser(f.userId)).refreshed, true);
  assert.equal(f.beginPokerAccessMutation(f.userId, 9, 'AUTO').ok, true);
  release();
  assert.equal((await delayed).refreshed, false);
  assert.equal(f.pending.get(f.userId).desiredOverride, 'AUTO');
  assert.equal(f.manager.isPokerAccessMutationFailClosed(f.userId), true);
});


test('lost ACK retry after a later confirmed revision does not leave an impossible pending barrier', async () => {
  const f = await accessRuntimeFixture();
  f.setSnapshot({ revision: 10, override: 'AUTO', effectiveClass: 'NORMAL' });
  const ack = await f.refreshPokerAccessForUser(f.userId, { expectedRevision: 8, expectedOverride: 'FORCE_RESTRICTED' });
  assert.equal(ack.revision, 10, 'Admin must reject this as a mismatch to revision 9');
  assert.equal(ack.override, 'AUTO');
  assert.equal(f.pending.has(f.userId), false);
  assert.equal(f.manager.isPokerAccessMutationFailClosed(f.userId), false);
});

test('late rollback confirmation cannot release another live mutation', async () => {
  const f = await accessRuntimeFixture();
  f.setSnapshot({ revision: 9, override: 'FORCE_RESTRICTED', effectiveClass: 'RESTRICTED' });
  f.beginPokerAccessMutation(f.userId, 9, 'AUTO');
  const ack = await f.refreshPokerAccessForUser(f.userId, {
    expectedRevision: 8, expectedOverride: 'FORCE_RESTRICTED', releasePending: true
  });
  assert.equal(ack.refreshed, false);
  assert.equal(f.pending.get(f.userId).desiredOverride, 'AUTO');
  assert.equal(f.manager.isPokerAccessMutationFailClosed(f.userId), true);
});
