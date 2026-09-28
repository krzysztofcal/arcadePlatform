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
  const { ACCESS_OVERRIDES, hasPokerPoolSchema, normalizeAccessOverride, normalizeAccessSnapshot } = await import('../../../shared/poker-domain/bot-access.mjs');
  const userId = '00000000-0000-4000-8000-000000000031';
  const manager = createTableManager({ maxSeats: 4 });
  const activeMutations = new Set();
  let userRow = {
    user_id: userId,
    poker_auto_class: 'NORMAL',
    poker_access_override: 'AUTO',
    poker_access_revision: 8,
    poker_auto_slow_at: null,
    poker_access_updated_at: '2026-09-28T00:00:00Z',
    poker_access_updated_by: null
  };
  let dbUpdates = 0;
  let failDb = false;
  let mutationBarrier = null;
  let activeUsers = [];
  const isUuid = (val) => typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);
  const deps = {
    activePokerAccessMutations: activeMutations,
    tableManager: manager,
    sessionStore: { activeUserIds: () => activeUsers, connectionsForUser: () => [] },
    hasSupabaseDbUrl: true,
    ACCESS_OVERRIDES,
    hasPokerPoolSchema,
    normalizeAccessOverride,
    normalizeAccessSnapshot,
    isUuid,
    loadBeginSqlWs: async () => async (fn) => {
      if (failDb) throw new Error('db_unavailable');
      const barrier = mutationBarrier;
      if (barrier) await barrier;
      return fn({
        unsafe: async (sql, params) => {
          const str = String(sql);
          if (str.includes('to_regclass')) {
            return [{ available: true }];
          }
          if (str.includes('for update')) {
            return userRow ? [{ ...userRow }] : [];
          }
          if (str.includes('update public.chips_accounts')) {
            dbUpdates += 1;
            userRow = {
              ...userRow,
              poker_access_override: params[1],
              poker_access_revision: Number(userRow.poker_access_revision) + 1,
              poker_access_updated_by: params[2]
            };
            return [{ ...userRow }];
          }
          if (str.includes('set is_slow_only = true')) {
            return [];
          }
          return [];
        }
      });
    },
    readPokerAccessPolicy: async () => ({ revision: 1, slowThresholdCh: 1000000000 }),
    readPokerAccessSnapshots: async (_tx, { userIds }) => {
      const snapshot = normalizeAccessSnapshot(userRow);
      return new Map(userIds.map(id => [id, snapshot]));
    },
    readSettledBotFundingSnapshot: async () => null,
    persistAuthoritativeSlowOnlyForUser,
    buildPokerAccessRefreshCandidates: propagation.buildPokerAccessRefreshCandidates,
    sendPokerAccessFrame: () => {},
    klogSafe: () => {}
  };
  const code = source.slice(source.indexOf('async function mutatePokerAccessForUser('), source.indexOf('function broadcastPokerAccessTransition('))
    + source.slice(source.indexOf('let settledBotFundingSnapshot ='), source.indexOf('function resolvePositiveInt('));
  const runtime = new Function(...Object.keys(deps), code + '\nreturn { mutatePokerAccessForUser, refreshActivePokerAccess };')(...Object.values(deps));
  return {
    ...runtime,
    manager,
    activeMutations,
    userId,
    getUserRow: () => userRow,
    setUserRow: (val) => { userRow = val; },
    getDbUpdates: () => dbUpdates,
    setFailDb: (val) => { failDb = val; },
    holdMutation: () => new Promise((resolve) => {
      mutationBarrier = new Promise((release) => { resolve(release); });
    })
  };
}

test('AUTO rev N -> FORCE_RESTRICTED rev N+1 -> immediately AUTO rev N+2 succeeds without periodic refresh', async () => {
  const f = await accessRuntimeFixture();
  const first = await f.mutatePokerAccessForUser({
    userId: f.userId,
    override: 'FORCE_RESTRICTED',
    expectedRevision: 8
  });
  assert.equal(first.ok, true);
  assert.equal(first.revision, 9);
  assert.equal(first.override, 'FORCE_RESTRICTED');
  assert.equal(first.effectiveClass, 'RESTRICTED');
  assert.equal(first.failClosed, false);
  assert.equal(f.manager.isPokerAccessMutationFailClosed(f.userId), false);

  // Immediately save AUTO with rev 9 -> rev 10
  const second = await f.mutatePokerAccessForUser({
    userId: f.userId,
    override: 'AUTO',
    expectedRevision: 9
  });
  assert.equal(second.ok, true);
  assert.equal(second.revision, 10);
  assert.equal(second.override, 'AUTO');
  assert.equal(second.effectiveClass, 'NORMAL');
  assert.equal(second.failClosed, false);
  assert.equal(f.getDbUpdates(), 2);
  assert.equal(f.manager.isPokerAccessMutationFailClosed(f.userId), false);
});

test('exactly one DB update occurs per accepted Admin request', async () => {
  const f = await accessRuntimeFixture();
  assert.equal(f.getDbUpdates(), 0);
  const result = await f.mutatePokerAccessForUser({
    userId: f.userId,
    override: 'FORCE_SLOW',
    expectedRevision: 8
  });
  assert.equal(result.ok, true);
  assert.equal(f.getDbUpdates(), 1);
});

test('stale revision performs zero DB update and releases fail-closed immediately', async () => {
  const f = await accessRuntimeFixture();
  const result = await f.mutatePokerAccessForUser({
    userId: f.userId,
    override: 'FORCE_RESTRICTED',
    expectedRevision: 99
  });
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 409);
  assert.equal(result.reason, 'stale_revision');
  assert.equal(result.failClosed, false);
  assert.equal(f.getDbUpdates(), 0);
  assert.equal(f.manager.isPokerAccessMutationFailClosed(f.userId), false);
  assert.equal(f.activeMutations.has(f.userId), false);

  // An immediate following request with the correct revision succeeds at once
  const next = await f.mutatePokerAccessForUser({
    userId: f.userId,
    override: 'FORCE_RESTRICTED',
    expectedRevision: 8
  });
  assert.equal(next.ok, true);
  assert.equal(next.revision, 9);
});

test('DB transaction failure rolls back, releases guard and fail-closed state, next save succeeds', async () => {
  const f = await accessRuntimeFixture();
  f.setFailDb(true);
  const failed = await f.mutatePokerAccessForUser({
    userId: f.userId,
    override: 'FORCE_RESTRICTED',
    expectedRevision: 8
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.statusCode, 503);
  assert.equal(f.getDbUpdates(), 0);
  assert.equal(f.manager.isPokerAccessMutationFailClosed(f.userId), false);
  assert.equal(f.activeMutations.has(f.userId), false);

  // Immediate retry after DB recovery succeeds
  f.setFailDb(false);
  const success = await f.mutatePokerAccessForUser({
    userId: f.userId,
    override: 'FORCE_RESTRICTED',
    expectedRevision: 8
  });
  assert.equal(success.ok, true);
  assert.equal(success.revision, 9);
  assert.equal(f.getDbUpdates(), 1);
});

test('two concurrent same-user mutations: second gets fast 409, third succeeds after first completes', async () => {
  const f = await accessRuntimeFixture();
  const releaseFirst = await f.holdMutation();
  const firstPromise = f.mutatePokerAccessForUser({
    userId: f.userId,
    override: 'FORCE_RESTRICTED',
    expectedRevision: 8
  });

  // Second request while first is in-flight gets fast 409
  const second = await f.mutatePokerAccessForUser({
    userId: f.userId,
    override: 'FORCE_SLOW',
    expectedRevision: 8
  });
  assert.equal(second.ok, false);
  assert.equal(second.statusCode, 409);
  assert.equal(second.reason, 'poker_access_mutation_in_progress');

  // Finish first request
  releaseFirst();
  const first = await firstPromise;
  assert.equal(first.ok, true);
  assert.equal(first.revision, 9);
  assert.equal(f.manager.isPokerAccessMutationFailClosed(f.userId), false);

  // Third request starts immediately without waiting
  const third = await f.mutatePokerAccessForUser({
    userId: f.userId,
    override: 'AUTO',
    expectedRevision: 9
  });
  assert.equal(third.ok, true);
  assert.equal(third.revision, 10);
});

test('runtime cache contains committed revision and override before success ACK', async () => {
  const f = await accessRuntimeFixture();
  let cachedAtAck = null;
  const originalCache = f.manager.cachePokerAccessForUser.bind(f.manager);
  f.manager.cachePokerAccessForUser = (userId, access, policy, nowMs) => {
    cachedAtAck = { ...access };
    return originalCache(userId, access, policy, nowMs);
  };
  const result = await f.mutatePokerAccessForUser({
    userId: f.userId,
    override: 'FORCE_RESTRICTED',
    expectedRevision: 8
  });
  assert.equal(result.ok, true);
  assert.equal(cachedAtAck?.revision, 9);
  assert.equal(cachedAtAck?.override, 'FORCE_RESTRICTED');
  assert.equal(cachedAtAck?.effectiveClass, 'RESTRICTED');
});

test('FORCE_SLOW / Return AUTO preserves sticky is_slow_only', async () => {
  const f = await accessRuntimeFixture();
  const tableId = 'table_sticky_slow_test';
  f.manager.restoreTableFromPersisted(tableId, {
    tableMeta: { maxPlayers: 4, lifecycleKind: 'STANDARD', isSlowOnly: false },
    coreState: {
      version: 2,
      roomId: tableId,
      maxSeats: 4,
      members: [{ userId: f.userId, seat: 1 }],
      seats: { [f.userId]: 1 },
      seatDetailsByUserId: { [f.userId]: { isBot: false } },
      pokerState: { phase: 'SETTLED', handId: 'hand_sticky_slow', stacks: { [f.userId]: 100 } }
    }
  });

  const slowResult = await f.mutatePokerAccessForUser({
    userId: f.userId,
    override: 'FORCE_SLOW',
    expectedRevision: 8
  });
  assert.equal(slowResult.ok, true);
  assert.equal(slowResult.effectiveClass, 'SLOW');
  assert.equal(slowResult.revision, 9);
  f.manager.markSlowOnlyTables([tableId]);
  assert.equal(f.manager.tableMeta(tableId).isSlowOnly, true);

  const autoResult = await f.mutatePokerAccessForUser({
    userId: f.userId,
    override: 'AUTO',
    expectedRevision: 9
  });
  assert.equal(autoResult.ok, true);
  assert.equal(autoResult.effectiveClass, 'NORMAL');
  assert.equal(autoResult.revision, 10);
  assert.equal(f.manager.tableMeta(tableId).isSlowOnly, true);
});

test('refresh candidates deduplicate and retain the bound', async () => {
  const { buildPokerAccessRefreshCandidates } = await import('./poker-access-propagation.mjs');
  assert.equal(typeof buildPokerAccessRefreshCandidates, 'function');
  assert.deepEqual(buildPokerAccessRefreshCandidates({
    activeUserIds: ['active', 'session', '', null],
    seatedUserIds: ['seated'],
    limit: 2
  }), ['active', 'session']);
});
