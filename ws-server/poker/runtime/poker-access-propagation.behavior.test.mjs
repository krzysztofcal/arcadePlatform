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
  }, { schemaBacked: true, slowThresholdCh: 1_000_000_000, slowHysteresisBps: 500, slowRecoveryThresholdCh: 950_000_000, revision: 1, loadedAtMs: 100, expiresAtMs: 30_100 }, 100);
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
async function accessRuntimeFixture(options = {}) {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../server.mjs', import.meta.url), 'utf8');
  const propagation = await import('./poker-access-propagation.mjs');
  const {
    ACCESS_OVERRIDES,
    hasPokerPoolSchema,
    isFreshAccessSnapshot,
    isFreshPolicySnapshot,
    normalizeAccessOverride,
    normalizeAccessSnapshot
  } = await import('../../../shared/poker-domain/bot-access.mjs');
  const userId = '00000000-0000-4000-8000-000000000031';
  const defaultActorId = '00000000-0000-4000-8000-000000000001';
  const manager = createTableManager({ maxSeats: 4 });
  const activeMutations = new Set();
  const generations = new Map();
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
    pokerAccessMutationGenerationByUser: generations,
    tableManager: manager,
    sessionStore: {
      activeUserIds: () => activeUsers,
      connectionsForUser: typeof options.connectionsForUser === 'function' ? options.connectionsForUser : () => []
    },
    hasSupabaseDbUrl: true,
    ACCESS_OVERRIDES,
    hasPokerPoolSchema,
    isFreshAccessSnapshot,
    isFreshPolicySnapshot,
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
    readPokerAccessPolicy: async () => ({ revision: 1, slowThresholdCh: 1000000000, slowHysteresisBps: 500, slowRecoveryThresholdCh: 950000000 }),
    readPokerAccessSnapshot: async (_tx, { userId: targetUserId }) => {
      const snapshot = normalizeAccessSnapshot({ ...userRow });
      if (typeof options.onReadSnapshot === 'function') {
        await options.onReadSnapshot({ userId: targetUserId, snapshot });
      }
      return snapshot;
    },
    readPokerAccessSnapshots: async (_tx, { userIds }) => {
      const snapshot = normalizeAccessSnapshot({ ...userRow });
      if (typeof options.onReadSnapshots === 'function') {
        await options.onReadSnapshots({ userIds, snapshot });
      }
      return new Map(userIds.map(id => [id, snapshot]));
    },
    readSettledBotFundingSnapshot: async () => null,
    persistAuthoritativeSlowOnlyForUser,
    buildPokerAccessRefreshCandidates: propagation.buildPokerAccessRefreshCandidates,
    sendPokerAccessFrame: typeof options.onSendFrame === 'function' ? options.onSendFrame : () => {},
    klogSafe: () => {}
  };
  const code = source.slice(source.indexOf('async function refreshConnectionPokerAccess('), source.indexOf('function broadcastPokerAccessTransition('))
    + source.slice(source.indexOf('let settledBotFundingSnapshot ='), source.indexOf('function resolvePositiveInt('));
  const runtime = new Function(...Object.keys(deps), code + '\nreturn { refreshConnectionPokerAccess, mutatePokerAccessForUser, refreshActivePokerAccess };')(...Object.values(deps));
  return {
    ...runtime,
    refreshConnectionPokerAccess: runtime.refreshConnectionPokerAccess,
    mutatePokerAccessForUser: (args = {}) => runtime.mutatePokerAccessForUser({
      actorId: 'actorId' in args ? args.actorId : defaultActorId,
      ...args
    }),
    manager,
    activeMutations,
    generations,
    userId,
    setActiveUsers: (users) => { activeUsers = users; },
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

test('stale periodic refresh cannot overwrite newer mutation revision', async () => {
  let finishReadHook = null;
  const readHookPromise = new Promise((resolve) => { finishReadHook = resolve; });
  let refreshReadStarted = null;
  const refreshStartedPromise = new Promise((resolve) => { refreshReadStarted = resolve; });

  const connState = {
    sessionId: 'sess_refresh_test',
    session: { userId: '00000000-0000-4000-8000-000000000031', identityMode: 'authenticated' },
    pokerAccess: null
  };
  const mockSocket = { __connState: connState };
  let heldStaleSnapshot = null;

  const f = await accessRuntimeFixture({
    connectionsForUser: () => [mockSocket],
    onReadSnapshots: async ({ snapshot }) => {
      heldStaleSnapshot = snapshot;
      refreshReadStarted();
      await readHookPromise;
    }
  });

  f.setActiveUsers([f.userId]);

  const cachedEvents = [];
  const origCache = f.manager.cachePokerAccessForUser.bind(f.manager);
  f.manager.cachePokerAccessForUser = (userId, access, policy, nowMs) => {
    cachedEvents.push({ userId, revision: access.revision, override: access.override });
    return origCache(userId, access, policy, nowMs);
  };

  // Start periodic refresh which reads rev 8
  const refreshPromise = f.refreshActivePokerAccess();
  await refreshStartedPromise;

  // Verify that the periodic refresh captured the stale rev 8 snapshot before mutation
  assert.equal(heldStaleSnapshot?.revision, 8);
  assert.equal(heldStaleSnapshot?.override, 'AUTO');

  // While refresh is paused waiting for DB snapshots read hook, an Admin mutation runs and commits rev 9
  const mutationResult = await f.mutatePokerAccessForUser({
    userId: f.userId,
    override: 'FORCE_RESTRICTED',
    expectedRevision: 8
  });
  assert.equal(mutationResult.ok, true);
  assert.equal(mutationResult.revision, 9);
  assert.equal(mutationResult.override, 'FORCE_RESTRICTED');
  assert.equal(connState.pokerAccess?.revision, 9);
  assert.equal(connState.pokerAccess?.override, 'FORCE_RESTRICTED');

  // Now let the stale refresh complete
  finishReadHook();
  await refreshPromise;

  // Stale refresh was skipped because generation changed during mutation
  // Last cached event must be rev 9, NOT rev 8!
  assert.equal(cachedEvents.length, 1);
  assert.equal(cachedEvents[0].revision, 9);
  assert.equal(cachedEvents[0].override, 'FORCE_RESTRICTED');

  // Socket state must still have rev 9
  assert.equal(connState.pokerAccess?.revision, 9);
  assert.equal(connState.pokerAccess?.override, 'FORCE_RESTRICTED');
});

test('stale connection refresh cannot overwrite newer mutation revision or emit stale frame', async () => {
  let finishReadHook = null;
  const readHookPromise = new Promise((resolve) => { finishReadHook = resolve; });
  let refreshReadStarted = null;
  const refreshStartedPromise = new Promise((resolve) => { refreshReadStarted = resolve; });

  const connState = {
    sessionId: 'sess_conn_refresh_race',
    session: { userId: '00000000-0000-4000-8000-000000000031', identityMode: 'authenticated' },
    pokerAccess: null
  };
  const mockSocket = { __connState: connState };

  const sentFrames = [];
  let heldStaleSnapshot = null;

  const f = await accessRuntimeFixture({
    connectionsForUser: () => [mockSocket],
    onSendFrame: (ws, state, access, opts) => {
      sentFrames.push({ access, opts });
    },
    onReadSnapshot: async ({ snapshot }) => {
      heldStaleSnapshot = snapshot;
      refreshReadStarted();
      await readHookPromise;
    }
  });

  const cachedEvents = [];
  const origCache = f.manager.cachePokerAccessForUser.bind(f.manager);
  f.manager.cachePokerAccessForUser = (userId, access, policy, nowMs) => {
    cachedEvents.push({ userId, revision: access.revision, override: access.override });
    return origCache(userId, access, policy, nowMs);
  };

  // Start connection refresh which reads rev 8
  const refreshPromise = f.refreshConnectionPokerAccess(mockSocket, connState, { force: true, reason: 'force_refresh' });
  await refreshStartedPromise;

  // Verify that the connection refresh captured the stale rev 8 snapshot before mutation
  assert.equal(heldStaleSnapshot?.revision, 8);
  assert.equal(heldStaleSnapshot?.override, 'AUTO');

  // While connection refresh is paused inside DB read, an Admin mutation runs and commits rev 9
  const mutationResult = await f.mutatePokerAccessForUser({
    userId: f.userId,
    override: 'FORCE_RESTRICTED',
    expectedRevision: 8
  });
  assert.equal(mutationResult.ok, true);
  assert.equal(mutationResult.revision, 9);
  assert.equal(mutationResult.override, 'FORCE_RESTRICTED');
  assert.equal(connState.pokerAccess?.revision, 9);
  assert.equal(connState.pokerAccess?.override, 'FORCE_RESTRICTED');

  // Exactly 1 frame sent so far: from admin mutation
  assert.equal(sentFrames.length, 1);
  assert.equal(sentFrames[0].access.revision, 9);
  assert.equal(sentFrames[0].access.override, 'FORCE_RESTRICTED');
  assert.equal(sentFrames[0].opts?.reason, 'admin_mutation');

  // Now let the stale connection refresh complete
  finishReadHook();
  const refreshResult = await refreshPromise;

  // Stale connection refresh returned null because generation changed
  assert.equal(refreshResult, null);

  // Table cache must still have rev 9, not rev 8
  assert.equal(cachedEvents.length, 1);
  assert.equal(cachedEvents[0].revision, 9);
  assert.equal(cachedEvents[0].override, 'FORCE_RESTRICTED');

  // Socket state must still have rev 9
  assert.equal(connState.pokerAccess?.revision, 9);
  assert.equal(connState.pokerAccess?.override, 'FORCE_RESTRICTED');

  // Stale refresh must NOT have emitted any old frame (sentFrames stays length 1)
  assert.equal(sentFrames.length, 1);
});

test('socket frame send throw does not fail mutation, returns ok: true, rev N+1, releases fail-closed', async () => {
  const connState = {
    sessionId: 'sess_socket_err',
    session: { userId: '00000000-0000-4000-8000-000000000031', identityMode: 'authenticated' },
    pokerAccess: null
  };
  const mockSocket = { __connState: connState };

  const f = await accessRuntimeFixture({
    connectionsForUser: () => [mockSocket],
    onSendFrame: () => {
      throw new Error('socket_closed_unexpectedly');
    }
  });

  const result = await f.mutatePokerAccessForUser({
    userId: f.userId,
    override: 'FORCE_RESTRICTED',
    expectedRevision: 8
  });

  assert.equal(result.ok, true);
  assert.equal(result.revision, 9);
  assert.equal(result.override, 'FORCE_RESTRICTED');
  assert.equal(result.failClosed, false);
  assert.equal(f.manager.isPokerAccessMutationFailClosed(f.userId), false);
  assert.equal(f.activeMutations.has(f.userId), false);
  assert.equal(f.getDbUpdates(), 1);
  assert.equal(connState.pokerAccess?.revision, 9);
  assert.equal(connState.pokerAccess?.override, 'FORCE_RESTRICTED');
});

test('missing or invalid actorId returns 400 invalid_actor_id without setting fail-closed or writing to DB', async () => {
  const f = await accessRuntimeFixture();

  const missing = await f.mutatePokerAccessForUser({
    userId: f.userId,
    override: 'FORCE_RESTRICTED',
    expectedRevision: 8,
    actorId: null
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.reason, 'invalid_actor_id');
  assert.equal(missing.failClosed, false);
  assert.equal(f.manager.isPokerAccessMutationFailClosed(f.userId), false);
  assert.equal(f.activeMutations.has(f.userId), false);
  assert.equal(f.getDbUpdates(), 0);

  const invalid = await f.mutatePokerAccessForUser({
    userId: f.userId,
    override: 'FORCE_RESTRICTED',
    expectedRevision: 8,
    actorId: 'not-a-uuid'
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.reason, 'invalid_actor_id');
  assert.equal(invalid.failClosed, false);
  assert.equal(f.manager.isPokerAccessMutationFailClosed(f.userId), false);
  assert.equal(f.activeMutations.has(f.userId), false);
  assert.equal(f.getDbUpdates(), 0);
});

async function settledRolloverRuntimeFixture(options = {}) {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../server.mjs', import.meta.url), 'utf8');
  const { decideSettledBotFunding, resolveSettledBotFundingSystemKey } = await import('./settled-bot-funding.mjs');
  const manager = createTableManager({ maxSeats: 6 });
  const retries = [];
  const initialFundingSnapshot = options.initialFundingSnapshot !== undefined ? options.initialFundingSnapshot : null;
  const persistedFundings = [];
  const stats = { persistedCount: 0 };

  const deps = {
    tableManager: manager,
    initialFundingSnapshot,
    retries,
    persistedFundings,
    stats,
    FAST_SETTLED_ROLLOVER_RETRY_DELAYS_MS: [50, 100],
    SLOW_SETTLED_ROLLOVER_RETRY_MS: 1000,
    settledRolloverTimerByTableId: new Map(),
    clearSettledRolloverTimer: () => {},
    klogVerbose: () => {},
    klogSafe: () => {},
    enqueueTableCommand: () => {},
    pokerLogRuntimeControl: { mayBuildDebugPayload: () => false },
    isGuestTableId: () => false,
    hasSupabaseDbUrl: true,
    loadDeferredLeaveFinalizer: async () => async () => ({ ok: true, changed: false }),
    syncCleanupRuntimeState: async () => ({ ok: true }),
    applyInactiveCleanupAndBroadcast: async () => ({ ok: true, changed: false }),
    handleContinuousBotRotationAtSettled: async () => ({ handled: false }),
    continuousBotTableRepository: { currentProfile: () => null },
    legacyBotFundingSystemKey: "TREASURY",
    decideSettledBotFunding,
    resolveSettledBotFundingSystemKey,
    settledRolloverGenerationKey: (tableId, pokerState = manager.persistedPokerState(tableId)) => {
      if (!pokerState || pokerState.phase !== "SETTLED") return null;
      const version = manager.persistedStateVersion(tableId);
      const handId = pokerState.handId || "unknown";
      return `${tableId}:${Number.isInteger(version) ? version : "unknown"}:${handId}`;
    },
    scheduleSettledRolloverRetry: (input) => {
      retries.push(input);
    },
    persistMutatedState: async (mutation) => {
      stats.persistedCount += 1;
      if (mutation.replacementFundings?.length > 0) {
        persistedFundings.push(...mutation.replacementFundings);
      }
      const nextVersion = mutation.expectedVersion + 1;
      return {
        ok: true,
        tableId: mutation.tableId,
        expectedVersion: mutation.expectedVersion,
        newVersion: nextVersion,
        replacementFundingCommitted: Boolean(mutation.replacementFundings?.length),
        fundedReplacements: (mutation.replacementFundings || []).map((funding, index) => ({
          seatNo: funding.seatNo,
          fundingDelta: funding.fundingDelta,
          idempotencyKey: `poker:bot-replacement-buyin:v1:${mutation.tableId}:${nextVersion}:${funding.seatNo}`,
          transactionId: `tx-replacement-${index}`,
          payloadHash: `hash-replacement-${index}`
        })),
        humanStackProjectionCommitted: Boolean(mutation.humanStackUpdates?.length),
        projectedHumanStacks: (mutation.humanStackUpdates || []).map(({ userId, seatNo, stack }) => ({ userId, seatNo, stack }))
      };
    },
    restoreTableFromPersisted: async () => ({ ok: true }),
    broadcastStateSnapshots: () => {},
    scheduleBotStep: () => {},
    broadcastPokerAccessTransition: () => {}
  };

  const code = source.slice(
    source.indexOf('async function runSettledRolloverCommand('),
    source.indexOf('function maybeScheduleSettledRollover(')
  );

  const runtime = new Function(
    ...Object.keys(deps),
    `let settledBotFundingSnapshot = initialFundingSnapshot;
${code}
return {
  runSettledRolloverCommand,
  setFundingSnapshot: (s) => { settledBotFundingSnapshot = s; },
  getFundingSnapshot: () => settledBotFundingSnapshot,
  getRetries: () => retries,
  getPersistedFundings: () => persistedFundings,
  getPersistedCount: () => stats.persistedCount,
  tableManager,
  settledRolloverGenerationKey,
  decideSettledBotFunding
};`
  )(...Object.values(deps));

  return runtime;
}

test("human and two busted bots retry on unknown funding, then fund replacements and exit SETTLED without duplicates", async () => {
  const runtime = await settledRolloverRuntimeFixture({ initialFundingSnapshot: null });
  const tableId = "table_settled_retry_test";
  const humanUserId = "00000000-0000-4000-8000-000000000031";
  const bot1Id = "00000000-0000-4000-8000-0000000000b1";
  const bot2Id = "00000000-0000-4000-8000-0000000000b2";

  const restored = runtime.tableManager.restoreTableFromPersisted(tableId, {
    tableMeta: {
      maxPlayers: 6,
      buyIn: 500,
      lifecycleKind: "STANDARD",
      isSlowOnly: false,
      stakes: { sb: 5, bb: 10 }
    },
    coreState: {
      roomId: tableId,
      version: 1,
      maxSeats: 6,
      members: [
        { userId: humanUserId, seat: 1 },
        { userId: bot1Id, seat: 2 },
        { userId: bot2Id, seat: 3 }
      ],
      seats: { [humanUserId]: 1, [bot1Id]: 2, [bot2Id]: 3 },
      publicStacks: { [humanUserId]: 1500, [bot1Id]: 0, [bot2Id]: 0 },
      seatDetailsByUserId: {
        [humanUserId]: { isBot: false, botProfile: null, leaveAfterHand: false },
        [bot1Id]: { isBot: true, botProfile: "NORMAL", leaveAfterHand: false },
        [bot2Id]: { isBot: true, botProfile: "NORMAL", leaveAfterHand: false }
      },
      pokerState: {
        roomId: tableId,
        handId: "hand_settled_retry",
        phase: "SETTLED",
        dealerSeatNo: 1,
        seats: [
          { userId: humanUserId, seatNo: 1, status: "ACTIVE" },
          { userId: bot1Id, seatNo: 2, status: "ACTIVE" },
          { userId: bot2Id, seatNo: 3, status: "ACTIVE" }
        ],
        stacks: { [humanUserId]: 1500, [bot1Id]: 0, [bot2Id]: 0 },
        handSettlement: { handId: "hand_settled_retry", settledAt: "2026-09-28T00:00:00.000Z", payouts: {} }
      }
    },
    presenceByUserId: new Map([
      [humanUserId, { userId: humanUserId, seat: 1, connected: true, lastSeenAt: 1, expiresAt: null }],
      [bot1Id, { userId: bot1Id, seat: 2, connected: false, lastSeenAt: 1, expiresAt: null }],
      [bot2Id, { userId: bot2Id, seat: 3, connected: false, lastSeenAt: 1, expiresAt: null }]
    ])
  });
  assert.equal(restored.ok, true);
  runtime.tableManager.join({
    ws: { send: () => {} },
    userId: humanUserId,
    tableId,
    requestId: "join-settled-retry",
    nowTs: Date.now()
  });

  const nowMs = Date.now();
  runtime.tableManager.cachePokerAccess(tableId, humanUserId, {
    automaticClass: "NORMAL",
    override: "AUTO",
    effectiveClass: "NORMAL",
    revision: 8,
    loadedAtMs: nowMs,
    expiresAtMs: nowMs + 30_000
  }, {
    slowThresholdCh: 1_000_000_000,
    slowHysteresisBps: 500,
    slowRecoveryThresholdCh: 950_000_000,
    revision: 1,
    loadedAtMs: nowMs,
    expiresAtMs: nowMs + 30_000
  }, nowMs);

  const genKey = runtime.settledRolloverGenerationKey(tableId);
  assert.equal(genKey, `${tableId}:1:hand_settled_retry`);

  // Attempt 0: funding snapshot is UNKNOWN (null) -> must schedule retry, not advance state, not fund bots
  const res1 = await runtime.runSettledRolloverCommand({ tableId, generationKey: genKey, attempt: 0 });
  assert.equal(res1.ok, true);
  assert.equal(res1.changed, false);
  assert.equal(res1.retryable, true);
  assert.equal(res1.reason, "missing_snapshot");

  // State remains settled and unadvanced
  assert.equal(runtime.tableManager.persistedPokerState(tableId).phase, "SETTLED");
  assert.equal(runtime.tableManager.persistedStateVersion(tableId), 1);
  assert.equal(runtime.tableManager.persistedPokerState(tableId).stacks[bot1Id], 0);
  assert.equal(runtime.tableManager.persistedPokerState(tableId).stacks[bot2Id], 0);

  // Exact retry scheduled with attempt + 1
  const retries = runtime.getRetries();
  assert.equal(retries.length, 1);
  assert.deepEqual(retries[0], { tableId, generationKey: genKey, attempt: 1 });
  assert.equal(runtime.getPersistedCount(), 0);
  assert.equal(runtime.getPersistedFundings().length, 0);

  // Now funding becomes available and provisioned
  runtime.setFundingSnapshot({
    schemaBacked: true,
    expiresAtMs: Date.now() + 30_000,
    tiers: {
      500: { enabled: true, provisioned: { NORMAL: true, SLOW: true } }
    }
  });

  // Attempt 1 (retry): funding is now known and allowed -> replaces broke bots and exits SETTLED
  const res2 = await runtime.runSettledRolloverCommand({ tableId, generationKey: genKey, attempt: 1 });
  assert.equal(res2.ok, true);
  assert.equal(res2.changed, true);

  // Table has exited SETTLED and version bumped
  assert.notEqual(runtime.tableManager.persistedPokerState(tableId).phase, "SETTLED");
  assert.equal(runtime.tableManager.persistedStateVersion(tableId), 2);

  // Replacement fundings persisted exactly once: 2 bots funded with 500 chips
  assert.equal(runtime.getPersistedCount(), 1);
  const fundings = runtime.getPersistedFundings();
  assert.equal(fundings.length, 2);
  assert.equal(fundings[0].fundingDelta, 500);
  assert.equal(fundings[1].fundingDelta, 500);

  // No further retry was scheduled
  assert.equal(retries.length, 1);

  // Authoritative no-funding check: with disabled tier or RESTRICTED, "not_enough_players" does not retry
  const tableId2 = "table_settled_disabled_tier";
  runtime.tableManager.restoreTableFromPersisted(tableId2, {
    tableMeta: { maxPlayers: 6, buyIn: 500, lifecycleKind: "STANDARD", isSlowOnly: false, stakes: { sb: 5, bb: 10 } },
    coreState: {
      roomId: tableId2, version: 1, maxSeats: 6,
      members: [{ userId: humanUserId, seat: 1 }, { userId: bot1Id, seat: 2 }, { userId: bot2Id, seat: 3 }],
      seats: { [humanUserId]: 1, [bot1Id]: 2, [bot2Id]: 3 },
      publicStacks: { [humanUserId]: 1500, [bot1Id]: 0, [bot2Id]: 0 },
      seatDetailsByUserId: {
        [humanUserId]: { isBot: false, botProfile: null, leaveAfterHand: false },
        [bot1Id]: { isBot: true, botProfile: "NORMAL", leaveAfterHand: false },
        [bot2Id]: { isBot: true, botProfile: "NORMAL", leaveAfterHand: false }
      },
      pokerState: {
        roomId: tableId2, handId: "hand_disabled_tier", phase: "SETTLED", dealerSeatNo: 1,
        seats: [{ userId: humanUserId, seatNo: 1, status: "ACTIVE" }, { userId: bot1Id, seatNo: 2, status: "ACTIVE" }, { userId: bot2Id, seatNo: 3, status: "ACTIVE" }],
        stacks: { [humanUserId]: 1500, [bot1Id]: 0, [bot2Id]: 0 },
        handSettlement: { handId: "hand_disabled_tier", settledAt: "2026-09-28T00:00:00.000Z", payouts: {} }
      }
    },
    presenceByUserId: new Map([
      [humanUserId, { userId: humanUserId, seat: 1, connected: true, lastSeenAt: 1, expiresAt: null }],
      [bot1Id, { userId: bot1Id, seat: 2, connected: false, lastSeenAt: 1, expiresAt: null }],
      [bot2Id, { userId: bot2Id, seat: 3, connected: false, lastSeenAt: 1, expiresAt: null }]
    ])
  });
  runtime.tableManager.join({
    ws: { send: () => {} },
    userId: humanUserId,
    tableId: tableId2,
    requestId: "join-disabled-tier",
    nowTs: Date.now()
  });

  const nowMs2 = Date.now();
  runtime.tableManager.cachePokerAccess(tableId2, humanUserId, {
    automaticClass: "NORMAL", override: "AUTO", effectiveClass: "NORMAL", revision: 8,
    loadedAtMs: nowMs2, expiresAtMs: nowMs2 + 30_000
  }, { slowThresholdCh: 1_000_000_000, slowHysteresisBps: 500, slowRecoveryThresholdCh: 950_000_000, revision: 1, loadedAtMs: nowMs2, expiresAtMs: nowMs2 + 30_000 }, nowMs2);

  runtime.setFundingSnapshot({
    schemaBacked: true,
    expiresAtMs: Date.now() + 30_000,
    tiers: {
      500: { enabled: false, provisioned: { NORMAL: true, SLOW: true } }
    }
  });

  const genKey2 = runtime.settledRolloverGenerationKey(tableId2);
  const res3 = await runtime.runSettledRolloverCommand({ tableId: tableId2, generationKey: genKey2, attempt: 0 });
  assert.equal(res3.ok, true);
  assert.equal(res3.changed, false);
  assert.equal(res3.reason, "not_enough_players");
  // Retry was NOT scheduled because no-funding is authoritative
  assert.equal(runtime.getRetries().length, 1);
});

test("RESTRICTED with missing or expired funding snapshot yields authoritative no-funding without retry", async () => {
  const runtime = await settledRolloverRuntimeFixture({ initialFundingSnapshot: null });
  const tableId = "table_settled_restricted_missing_snapshot";
  const humanUserId = "00000000-0000-4000-8000-000000000099";
  const bot1Id = "00000000-0000-4000-8000-0000000000b1";
  const bot2Id = "00000000-0000-4000-8000-0000000000b2";

  runtime.tableManager.restoreTableFromPersisted(tableId, {
    tableMeta: { maxPlayers: 6, buyIn: 500, lifecycleKind: "STANDARD", isSlowOnly: false, stakes: { sb: 5, bb: 10 } },
    coreState: {
      roomId: tableId, version: 1, maxSeats: 6,
      members: [{ userId: humanUserId, seat: 1 }, { userId: bot1Id, seat: 2 }, { userId: bot2Id, seat: 3 }],
      seats: { [humanUserId]: 1, [bot1Id]: 2, [bot2Id]: 3 },
      publicStacks: { [humanUserId]: 1500, [bot1Id]: 0, [bot2Id]: 0 },
      seatDetailsByUserId: {
        [humanUserId]: { isBot: false, botProfile: null, leaveAfterHand: false },
        [bot1Id]: { isBot: true, botProfile: "NORMAL", leaveAfterHand: false },
        [bot2Id]: { isBot: true, botProfile: "NORMAL", leaveAfterHand: false }
      },
      pokerState: {
        roomId: tableId, handId: "hand_restricted_missing_snapshot", phase: "SETTLED", dealerSeatNo: 1,
        seats: [{ userId: humanUserId, seatNo: 1, status: "ACTIVE" }, { userId: bot1Id, seatNo: 2, status: "ACTIVE" }, { userId: bot2Id, seatNo: 3, status: "ACTIVE" }],
        stacks: { [humanUserId]: 1500, [bot1Id]: 0, [bot2Id]: 0 },
        handSettlement: { handId: "hand_restricted_missing_snapshot", settledAt: "2026-09-28T00:00:00.000Z", payouts: {} }
      }
    },
    presenceByUserId: new Map([
      [humanUserId, { userId: humanUserId, seat: 1, connected: true, lastSeenAt: 1, expiresAt: null }],
      [bot1Id, { userId: bot1Id, seat: 2, connected: false, lastSeenAt: 1, expiresAt: null }],
      [bot2Id, { userId: bot2Id, seat: 3, connected: false, lastSeenAt: 1, expiresAt: null }]
    ])
  });
  runtime.tableManager.join({
    ws: { send: () => {} },
    userId: humanUserId,
    tableId,
    requestId: "join-restricted-missing-snapshot",
    nowTs: Date.now()
  });

  const nowMs = Date.now();
  // Seated human has effectiveClass: RESTRICTED
  runtime.tableManager.cachePokerAccess(tableId, humanUserId, {
    automaticClass: "NORMAL", override: "FORCE_RESTRICTED", effectiveClass: "RESTRICTED", revision: 12,
    loadedAtMs: nowMs, expiresAtMs: nowMs + 30_000
  }, { slowThresholdCh: 1_000_000_000, slowHysteresisBps: 500, slowRecoveryThresholdCh: 950_000_000, revision: 1, loadedAtMs: nowMs, expiresAtMs: nowMs + 30_000 }, nowMs);

  // Funding snapshot is missing (null) or expired
  runtime.setFundingSnapshot(null);

  // Directly verify decideSettledBotFunding contract: RESTRICTED takes precedence over missing snapshot
  const decision = runtime.decideSettledBotFunding({
    snapshot: null,
    buyIn: 500,
    effectiveRestricted: true,
    nowMs
  });
  assert.equal(decision.known, true);
  assert.equal(decision.allowed, false);
  assert.equal(decision.systemKey, null);
  assert.equal(decision.reason, "restricted");

  const genKey = runtime.settledRolloverGenerationKey(tableId);
  const result = await runtime.runSettledRolloverCommand({ tableId, generationKey: genKey, attempt: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.reason, "not_enough_players");
  // Zero funding persisted
  assert.equal(runtime.getPersistedFundings().length, 0);
  assert.equal(runtime.getPersistedCount(), 0);
  // Zero retries scheduled because RESTRICTED is authoritative no-funding, not UNKNOWN
  assert.equal(runtime.getRetries().length, 0);
});

test("normalizeWsPokerAccessPayload includes slowThresholdCh, slowHysteresisBps, and slowRecoveryThresholdCh (T061/T068)", async () => {
  const { readFile } = await import('node:fs/promises');
  const code = await readFile(new URL('../../server.mjs', import.meta.url), 'utf8');
  const extractFn = new Function(code.slice(code.indexOf('function normalizeWsPokerAccessPayload('), code.indexOf('function sendPokerAccessFrame(')) + '\nreturn normalizeWsPokerAccessPayload;');
  const normalize = extractFn();
  const payload = normalize({
    automaticClass: "NORMAL",
    override: "AUTO",
    effectiveClass: "NORMAL",
    revision: 3,
    slowThresholdCh: 2000,
    slowHysteresisBps: 2500,
    slowRecoveryThresholdCh: 1500,
    policyRevision: 2,
  });
  assert.equal(payload.slowThresholdCh, 2000);
  assert.equal(payload.slowHysteresisBps, 2500);
  assert.equal(payload.slowRecoveryThresholdCh, 1500);
  assert.equal(payload.policyRevision, 2);
  assert.equal(payload.automaticClass, "NORMAL");
  assert.equal(payload.override, "AUTO");
  assert.equal(payload.effectiveClass, "NORMAL");
});
