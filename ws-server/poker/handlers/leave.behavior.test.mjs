import test from "node:test";
import assert from "node:assert/strict";
import { handleLeaveCommand, reconcileInactivityEjectionsCommand } from "./leave.mjs";

function createCtx() {
  const calls = { command: [], snapshots: 0, tableState: 0, autoplay: 0, executorArgs: null, restoreArgs: [], leaveArgs: [] };
  return {
    calls,
    ctx: {
      frame: { requestId: "leave-r1" },
      ws: {},
      connState: { session: { userId: "u1" } },
      tableId: "t1",
      tableManager: {
        leave(args) {
          calls.leaveArgs.push(args);
          return { ok: true, changed: false };
        },
      },
      restoreTableFromPersisted: async tableId => {
        calls.restoreArgs.push({ tableId });
        return { ok: true };
      },
      loadAuthoritativeLeaveExecutor: async () => async (args) => {
        calls.executorArgs = args;
        return { ok: true, tableStatus: "CLOSED", state: { version: 3, state: { handId: "h1" } } };
      },
      sendCommandResult: (_ws, _connState, payload) => {
        calls.command.push(payload);
      },
      broadcastStateSnapshots: () => {
        calls.snapshots += 1;
      },
      broadcastTableState: () => {
        calls.tableState += 1;
      },
      scheduleBotStep: () => {
        calls.autoplay += 1;
      }
    }
  };
}

test("handleLeaveCommand accepts and broadcasts when authoritative leave changes state", async () => {
  const { ctx, calls } = createCtx();
  await handleLeaveCommand(ctx);

  assert.equal(calls.executorArgs.tableId, "t1");
  assert.equal(calls.restoreArgs[0].tableId, "t1");
  assert.equal(calls.leaveArgs[0].tableId, "t1");
  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, "accepted");
  assert.equal(calls.snapshots, 1);
  assert.equal(calls.tableState, 1);
  assert.equal(calls.autoplay, 1);
});

test("handleLeaveCommand maps pending authoritative leave to rejected request_pending", async () => {
  const { ctx, calls } = createCtx();
  ctx.loadAuthoritativeLeaveExecutor = async () => async () => ({ ok: false, pending: true });
  await handleLeaveCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].reason, "request_pending");
  assert.equal(calls.snapshots, 0);
  assert.equal(calls.tableState, 0);
  assert.equal(calls.autoplay, 0);
});

test("handleLeaveCommand rejects failed full-state reload without broadcast", async () => {
  const { ctx, calls } = createCtx();
  ctx.restoreTableFromPersisted = async () => ({ ok: false, code: "authoritative_state_invalid" });
  await handleLeaveCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, "rejected");
  assert.equal(calls.command[0].reason, "authoritative_state_invalid");
  assert.equal(calls.snapshots, 0);
  assert.equal(calls.tableState, 0);
  assert.equal(calls.autoplay, 0);
});

test("handleLeaveCommand rejects a thrown reload failure without broadcasting", async () => {
  const { ctx, calls } = createCtx();
  ctx.restoreTableFromPersisted = async () => { throw Object.assign(new Error("reload failed"), { code: "state_conflict" }); };
  await handleLeaveCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].status, "rejected");
  assert.equal(calls.command[0].reason, "state_conflict");
  assert.equal(calls.snapshots, 0);
  assert.equal(calls.tableState, 0);
  assert.equal(calls.autoplay, 0);
});

test("handleLeaveCommand maps thrown executor errors to stable rejection", async () => {
  const { ctx, calls } = createCtx();
  ctx.loadAuthoritativeLeaveExecutor = async () => async () => {
    const error = new Error("boom");
    error.code = "state_conflict";
    throw error;
  };
  await handleLeaveCommand(ctx);

  assert.equal(calls.command.length, 1);
  assert.equal(calls.command[0].reason, "state_conflict");
  assert.equal(calls.autoplay, 0);
});


test('durable inactivity retry reloads committed Leave after a lost result, without stale state or second cashout', async () => {
  let state = { seats: [{ userId: 'u1', seatNo: 1 }], stacks: { u1: 25 },
    inactivityEjectionByUserId: { u1: { handId: 'h1', isSinglePlayer: false } } };
  let financialState = structuredClone(state);
  let cashouts = 0, reloads = 0, publications = 0;
  const ctx = { tableId: 't1', tableManager: { isTableClosed: () => false, persistedPokerState: () => state },
    loadAuthoritativeLeaveExecutor: async () => async input => {
      assert.equal(input.inactivityEjection, true);
      assert.equal(input.requestId, 'inactivity:t1:h1:u1');
      cashouts++;
      financialState = { ...financialState, seats: [], stacks: {}, leftTableByUserId: { u1: true } };
      return { ok: false, code: 'lost_result' };
    }, restoreTableFromPersisted: async () => { reloads++; state = structuredClone(financialState); return { ok: true }; },
    broadcastStateSnapshots: () => publications++, broadcastTableState: () => {} };
  const lost = await reconcileInactivityEjectionsCommand(ctx);
  assert.equal(lost.ok, false);
  assert.equal(cashouts, 1);
  assert.equal(reloads, 1);
  assert.equal(publications, 1);
  assert.deepEqual(state.seats, []);
  const recovered = await reconcileInactivityEjectionsCommand(ctx);
  assert.equal(recovered.ok, true);
  assert.equal(cashouts, 1);
});

test('inactivity Leave failure remains pending and retries the same durable idempotency key', async () => {
  const state = { seats: [{ userId: 'u1', seatNo: 1 }], stacks: { u1: 25 },
    inactivityEjectionByUserId: { u1: { handId: 'h1', isSinglePlayer: true } } };
  const requests = [];
  const ctx = { tableId: 't1', tableManager: { isTableClosed: () => false, persistedPokerState: () => state },
    loadAuthoritativeLeaveExecutor: async () => async input => { requests.push(input.requestId); return { ok: false, code: 'state_conflict' }; },
    restoreTableFromPersisted: async () => ({ ok: true }), broadcastStateSnapshots: () => {}, broadcastTableState: () => {} };
  assert.equal((await reconcileInactivityEjectionsCommand(ctx)).ok, false);
  assert.equal((await reconcileInactivityEjectionsCommand(ctx)).ok, false);
  assert.deepEqual(requests, ['inactivity:t1:h1:u1', 'inactivity:t1:h1:u1']);
  assert.equal(state.stacks.u1, 25);
});

test('normal Leave reloads private starting stacks through bot settlement without publishing them', async () => {
  const { createTableManager } = await import('../table/table-manager.mjs');
  const { buildBootstrappedPokerState } = await import('../engine/poker-engine.mjs');
  const { applyLeaveTable } = await import('../../../netlify/functions/_shared/poker-reducer.mjs');
  const { withoutPrivateState } = await import('../../../netlify/functions/_shared/poker-state-utils.mjs');
  const { createPersistedStateWriter } = await import('../persistence/persisted-state-writer.mjs');
  const { buildStateSnapshotPayload } = await import('../read-model/state-snapshot.mjs');
  const manager = createTableManager({ maxSeats: 3, defaultBuyIn: 100 });
  const tableId = 'leave_audit';
  const core = { version: 1, roomId: tableId, maxSeats: 3,
    members: ['u1', 'b1', 'b2'].map((userId, i) => ({ userId, seat: i + 1 })),
    seats: { u1: 1, b1: 2, b2: 3 }, publicStacks: { u1: 100, b1: 100, b2: 100 },
    seatDetailsByUserId: { u1: { isBot: false }, b1: { isBot: true }, b2: { isBot: true } } };
  const initial = { ...buildBootstrappedPokerState({ tableId, coreState: core,
    dealerSeatNo: 1, startingStacks: core.publicStacks, handVersion: 1 }), tableId };
  const starts = structuredClone(initial.handStartStacksByUserId);
  const install = (state, version) => manager.restoreTableFromPersisted(tableId, {
    tableMeta: { buyIn: 100 }, tableStatus: 'OPEN', presenceByUserId: new Map(),
    coreState: { ...core, version, pokerState: state,
      members: core.members.filter(m => !state.leftTableByUserId?.[m.userId]),
      seats: Object.fromEntries(core.members.filter(m => !state.leftTableByUserId?.[m.userId]).map(m => [m.userId, m.seat])) } });
  assert.equal(install(initial, 1).ok, true);
  // The SQL boundary commits full state but returns a public projection, as executePokerLeave does.
  const afterLeave = { ...applyLeaveTable(initial, { userId: 'u1' }).state,
    seats: initial.seats, stacks: initial.stacks };
  const response = { ok: true, state: { version: 2, state: withoutPrivateState(afterLeave) } };
  assert.equal('handStartStacksByUserId' in response.state.state, false);
  const { ctx, calls } = createCtx();
  let reloads = 0;
  Object.assign(ctx, { tableId, tableManager: manager,
    loadAuthoritativeLeaveExecutor: async () => async () => response,
    restoreTableFromPersisted: async id => { assert.equal(id, tableId); reloads++; return install(afterLeave, 2); } });
  await handleLeaveCommand(ctx);
  assert.equal(calls.command[0].status, 'accepted');
  assert.deepEqual(manager.persistedPokerState(tableId).handStartStacksByUserId, starts);
  assert.equal(reloads, 1);
  for (const userId of ['u1', 'b1', 'observer']) {
    const snapshot = buildStateSnapshotPayload({ tableSnapshot: manager.tableSnapshot(tableId, userId), userId });
    assert.equal(JSON.stringify(snapshot).includes('handStartStacksByUserId'), false);
  }
  // Real legal engine actions, not a synthetic settlement/audit status.
  let state = manager.persistedPokerState(tableId);
  for (let step = 0; state.phase !== 'SETTLED' && step < 20; step++) {
    const toCall = Number(state.toCallByUserId[state.turnUserId] || 0);
    const action = manager.applyAction({ tableId, handId: state.handId, userId: state.turnUserId,
      action: toCall > 0 ? 'CALL' : 'CHECK', requestId: `bot-${step}` });
    assert.equal(action.accepted, true);
    state = manager.persistedPokerState(tableId);
  }
  assert.equal(state.phase, 'SETTLED');
  assert.equal(state.potTotal, 0);
  assert.equal(Object.values(state.stacks).reduce((sum, n) => sum + n, 0), 300);
  let audit;
  const writer = createPersistedStateWriter({ env: { SUPABASE_DB_URL: 'postgres://example.invalid/db' },
    beginSql: async fn => fn({ unsafe: async (query, params = []) => {
      if (query.startsWith('update public.poker_state set version')) return [{ version: 20 }];
      if (query.startsWith('insert into public.poker_actions') && params[3] === 'HAND_SETTLED') {
        audit = params[9]; return [{ id: 1 }];
      }
      return [];
    } }) });
  assert.equal((await writer.writeMutation({ tableId, expectedVersion: 19, nextState: state })).ok, true);
  assert.equal(audit.integrity.status, 'OK');
  assert.deepEqual(audit.integrity.flags, []);
  assert.equal(audit.integrity.stackConservationDelta, 0);
});

test('already-left retry reloads the current hand rather than its old public result', async () => {
  const { createTableManager } = await import('../table/table-manager.mjs');
  const manager = createTableManager({ defaultBuyIn: 100 });
  const { ctx, calls } = createCtx();
  const current = { tableId: 't1', handId: 'new-hand', phase: 'PREFLOP',
    seats: [{ userId: 'b1', seatNo: 2 }], handSeats: [{ userId: 'b1', seatNo: 2 }],
    stacks: { b1: 125 }, handStartStacksByUserId: { b1: 125 } };
  let reloads = 0;
  Object.assign(ctx, { tableManager: manager,
    loadAuthoritativeLeaveExecutor: async () => async () => ({ ok: true, status: 'already_left',
      state: { version: 3, state: { tableId: 't1', handId: 'old-hand', seats: [] } } }),
    restoreTableFromPersisted: async () => {
      reloads++;
      if (reloads === 1) return { ok: false, reason: 'db_error' };
      return manager.restoreTableFromPersisted('t1', { tableMeta: { buyIn: 100 }, coreState: {
        version: 9, roomId: 't1', maxSeats: 6, members: [{ userId: 'b1', seat: 2 }],
        seats: { b1: 2 }, publicStacks: { b1: 125 }, seatDetailsByUserId: { b1: { isBot: true } },
        pokerState: current }, presenceByUserId: new Map() });
    } });
  await handleLeaveCommand(ctx);
  assert.equal(calls.command[0].reason, 'db_error');
  assert.equal(calls.snapshots, 0);
  assert.equal(calls.autoplay, 0);
  await handleLeaveCommand(ctx); // same requestId, no fallback to cached public response
  assert.equal(calls.command[1].status, 'accepted');
  assert.equal(calls.command[1].reason, 'already_left');
  assert.equal(manager.persistedStateVersion('t1'), 9);
  assert.equal(manager.persistedPokerState('t1').handId, 'new-hand');
  assert.deepEqual(manager.persistedPokerState('t1').handStartStacksByUserId, { b1: 125 });
  assert.equal(reloads, 2);
});
