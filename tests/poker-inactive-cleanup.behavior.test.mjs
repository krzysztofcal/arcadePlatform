import test from 'node:test';
import assert from 'node:assert/strict';
import { executeInactiveCleanup } from '../shared/poker-domain/inactive-cleanup.mjs';

function makeTx({
  seat,
  state,
  allSeats = [],
  tableStatus = 'OPEN',
  createdAt = '2026-03-01T00:00:00.000Z',
  lastActivityAt = null,
  updatedAt = null
} = {}) {
  const ledgerCalls = [];
  const updates = [];
  let mutableState = state || {};
  return {
    ledgerCalls,
    updates,
    tx: {
      unsafe: async (query, params) => {
        const q = String(query);
        if (q.includes('from public.poker_seats') && q.includes('user_id = $2')) return seat ? [seat] : [];
        if (q.includes('from public.poker_state')) return [{ state: mutableState }];
        if (q.includes('select user_id, status, is_bot, stack from public.poker_seats')) return allSeats;
        if (q.includes('select status, created_at') && q.includes('from public.poker_tables')) {
          return [{
            status: tableStatus,
            created_at: createdAt,
            last_activity_at: lastActivityAt,
            updated_at: updatedAt
          }];
        }
        if (q.startsWith('update public.poker_state set state')) {
          mutableState = JSON.parse(params[1]);
          updates.push({ kind: 'state', value: mutableState });
          return [];
        }
        updates.push({ query: q, params });
        return [];
      }
    }
  };
}

test('inactive cleanup protects live actor turn without mutation/cashout', async () => {
  const ctx = makeTx({
    seat: { table_id: 'table-1', user_id: 'user-1', seat_no: 1, status: 'ACTIVE', is_bot: false, stack: 10 },
    state: { turnUserId: 'user-1', turnDeadlineAt: Date.now() + 60_000, stacks: { 'user-1': 40 } },
    allSeats: []
  });

  const result = await executeInactiveCleanup({
    tableId: 'table-1',
    userId: 'user-1',
    requestId: 'req-1',
    env: {},
    beginSql: async (fn) => fn(ctx.tx),
    postTransaction: async (payload) => ctx.ledgerCalls.push(payload),
    isHoleCardsTableMissing: () => false
  });

  assert.equal(result.protected, true);
  assert.equal(result.retryable, true);
  assert.equal(ctx.ledgerCalls.length, 0);
  assert.equal(ctx.updates.length, 0);
});

test('off-turn cleanup cashes out state-first amount and clears stack entry', async () => {
  const ctx = makeTx({
    seat: { table_id: 'table-2', user_id: 'user-2', seat_no: 2, status: 'ACTIVE', is_bot: false, stack: 15 },
    state: { turnUserId: 'other-user', turnDeadlineAt: Date.now() + 60_000, stacks: { 'user-2': 90 } },
    allSeats: [{ user_id: 'user-2', status: 'INACTIVE', is_bot: false, stack: 0 }, { user_id: 'h3', status: 'ACTIVE', is_bot: false, stack: 10 }]
  });

  const result = await executeInactiveCleanup({
    tableId: 'table-2',
    userId: 'user-2',
    requestId: 'req-2',
    env: {},
    beginSql: async (fn) => fn(ctx.tx),
    postTransaction: async (payload) => ctx.ledgerCalls.push(payload),
    isHoleCardsTableMissing: () => false
  });

  assert.equal(result.status, 'cleaned');
  assert.equal(ctx.ledgerCalls.length, 1);
  assert.equal(ctx.ledgerCalls[0].entries[1].amount, 90, 'state stack should win over seat fallback');
  assert.equal(ctx.ledgerCalls[0].idempotencyKey, 'poker:inactive_cleanup:table-2:user-2');
  const stateUpdate = ctx.updates.find((u) => u.kind === 'state');
  assert.ok(stateUpdate);
  assert.equal(stateUpdate.value.stacks['user-2'], undefined);
});

test('singleton human disconnect closes table, ignores bots keep-alive, and close cashout uses state-first', async () => {
  const ctx = makeTx({
    seat: { table_id: 'table-3', user_id: 'user-3', seat_no: 3, status: 'ACTIVE', is_bot: false, stack: 5 },
    state: { turnUserId: 'other-user', turnDeadlineAt: Date.now() - 1, stacks: { 'user-3': 50, 'user-4': 70 } },
    allSeats: [
      { user_id: 'user-3', status: 'INACTIVE', is_bot: false, stack: 0 },
      { user_id: 'user-4', status: 'INACTIVE', is_bot: false, stack: 10 },
      { user_id: 'bot-1', status: 'ACTIVE', is_bot: true, stack: 999 }
    ],
    tableStatus: 'OPEN'
  });

  const result = await executeInactiveCleanup({
    tableId: 'table-3',
    userId: 'user-3',
    requestId: 'req-3',
    env: { POKER_SYSTEM_ACTOR_USER_ID: 'actor-1' },
    beginSql: async (fn) => fn(ctx.tx),
    postTransaction: async (payload) => ctx.ledgerCalls.push(payload),
    isHoleCardsTableMissing: () => false
  });

  assert.equal(result.closed, true);
  assert.equal(ctx.ledgerCalls.length, 2);
  assert.equal(ctx.ledgerCalls[0].idempotencyKey, 'poker:inactive_cleanup:table-3:user-3');
  const closeUser4 = ctx.ledgerCalls.find((entry) => entry.userId === 'user-4');
  assert.ok(closeUser4);
  assert.equal(closeUser4.entries[1].amount, 70, 'close cashout should be state-first, not seat fallback');
  assert.equal(closeUser4.idempotencyKey, 'poker:inactive_cleanup_close:table-3:user-4');
  const holeCardDelete = ctx.updates.find((u) => String(u.query).includes('delete from public.poker_hole_cards'));
  assert.ok(holeCardDelete, 'close path should clear hole cards');
  const closedState = ctx.updates.filter((u) => u.kind === 'state').at(-1)?.value;
  assert.ok(closedState, 'close path should persist closed inert state');
  assert.equal(closedState.phase, 'HAND_DONE');
  assert.equal(closedState.handId, '');
  assert.equal(closedState.handSeed, '');
  assert.equal(closedState.showdown, null);
  assert.deepEqual(closedState.community, []);
  assert.equal(closedState.communityDealt, 0);
  assert.equal(closedState.pot, 0);
  assert.equal(closedState.potTotal, 0);
  assert.deepEqual(closedState.sidePots, []);
  assert.equal(closedState.turnUserId, null);
  assert.equal(closedState.turnStartedAt, null);
  assert.equal(closedState.turnDeadlineAt, null);
  assert.equal(closedState.currentBet, 0);
  assert.deepEqual(closedState.toCallByUserId, {});
  assert.deepEqual(closedState.betThisRoundByUserId, {});
  assert.deepEqual(closedState.actedThisRoundByUserId, {});
});

test('bots-only live hand stays open until the hand is finished', async () => {
  const ctx = makeTx({
    seat: null,
    state: {
      phase: 'TURN',
      handId: 'hand-live-bots-only',
      turnUserId: 'bot-1',
      turnDeadlineAt: Date.now() + 60_000,
      stacks: { 'bot-1': 50, 'user-ghost': 20 }
    },
    allSeats: [
      { user_id: 'user-ghost', status: 'INACTIVE', is_bot: false, stack: 0 },
      { user_id: 'bot-1', status: 'ACTIVE', is_bot: true, stack: 50 }
    ],
    tableStatus: 'OPEN',
    lastActivityAt: new Date(Date.now()).toISOString()
  });

  const result = await executeInactiveCleanup({
    tableId: 'table-live-bots-only',
    userId: null,
    requestId: 'req-live-bots-only',
    env: {},
    beginSql: async (fn) => fn(ctx.tx),
    postTransaction: async (payload) => ctx.ledgerCalls.push(payload),
    isHoleCardsTableMissing: () => false
  });

  assert.equal(result.status, 'live_hand_preserved');
  assert.equal(result.closed, false);
  const closedUpdate = ctx.updates.find((u) => String(u.query).includes("set status = 'CLOSED'"));
  assert.equal(closedUpdate, undefined);
  const stateUpdate = ctx.updates.find((u) => u.kind === 'state');
  assert.ok(stateUpdate);
  assert.equal(stateUpdate.value.phase, 'TURN');
  assert.equal(stateUpdate.value.turnUserId, 'bot-1');
});

test('terminal bots-only table stays open when a human observer is still connected', async () => {
  const ctx = makeTx({
    seat: null,
    state: {
      phase: 'HAND_DONE',
      handId: '',
      turnUserId: null,
      stacks: { 'bot-1': 80 }
    },
    allSeats: [
      { user_id: 'bot-1', status: 'ACTIVE', is_bot: true, stack: 80 }
    ],
    tableStatus: 'OPEN'
  });

  const result = await executeInactiveCleanup({
    tableId: 'table-human-observer',
    userId: null,
    requestId: 'req-human-observer',
    env: {},
    beginSql: async (fn) => fn(ctx.tx),
    postTransaction: async (payload) => ctx.ledgerCalls.push(payload),
    isHoleCardsTableMissing: () => false,
    hasConnectedHumanPresence: () => true
  });

  assert.equal(result.status, 'human_presence_present');
  assert.equal(result.closed, false);
  const closedUpdate = ctx.updates.find((u) => String(u.query).includes("set status = 'CLOSED'"));
  assert.equal(closedUpdate, undefined);
});

test('idempotent no-op when seat is already inactive', async () => {
  const ctx = makeTx({
    seat: { table_id: 'table-4', user_id: 'user-4', seat_no: 4, status: 'INACTIVE', is_bot: false, stack: 0 },
    state: { stacks: { 'user-4': 0 } },
    allSeats: [{ user_id: 'user-4', status: 'INACTIVE', is_bot: false, stack: 0 }, { user_id: 'bot-1', status: 'ACTIVE', is_bot: true, stack: 100 }],
    tableStatus: 'CLOSED'
  });

  const result = await executeInactiveCleanup({
    tableId: 'table-4',
    userId: 'user-4',
    requestId: 'req-4',
    env: {},
    beginSql: async (fn) => fn(ctx.tx),
    postTransaction: async (payload) => ctx.ledgerCalls.push(payload),
    isHoleCardsTableMissing: () => false
  });

  assert.equal(result.ok, true);
  assert.equal(ctx.ledgerCalls.length, 0);
});

test('repeated cleanup against already closed inert table remains stable and no-op', async () => {
  const inertState = {
    phase: 'HAND_DONE',
    handId: '',
    handSeed: '',
    showdown: null,
    community: [],
    communityDealt: 0,
    pot: 0,
    potTotal: 0,
    sidePots: [],
    turnUserId: null,
    turnStartedAt: null,
    turnDeadlineAt: null,
    stacks: {}
  };
  const ctx = makeTx({
    seat: { table_id: 'table-5', user_id: 'user-5', seat_no: 5, status: 'INACTIVE', is_bot: false, stack: 0 },
    state: inertState,
    allSeats: [{ user_id: 'user-5', status: 'INACTIVE', is_bot: false, stack: 0 }],
    tableStatus: 'CLOSED'
  });

  const result = await executeInactiveCleanup({
    tableId: 'table-5',
    userId: 'user-5',
    requestId: 'req-5',
    env: {},
    beginSql: async (fn) => fn(ctx.tx),
    postTransaction: async (payload) => ctx.ledgerCalls.push(payload),
    isHoleCardsTableMissing: () => false
  });

  assert.equal(result.status, 'already_closed');
  assert.equal(result.changed, false);
  const finalState = ctx.updates.filter((u) => u.kind === 'state').at(-1)?.value;
  assert.equal(finalState.phase, inertState.phase);
  assert.equal(finalState.turnUserId, inertState.turnUserId);
  assert.equal(finalState.turnStartedAt, inertState.turnStartedAt);
  assert.equal(finalState.turnDeadlineAt, inertState.turnDeadlineAt);
  assert.deepEqual(finalState.stacks, inertState.stacks);
  assert.equal(ctx.ledgerCalls.length, 0);
});

test('fresh empty table remains open during close grace period', async () => {
  const ctx = makeTx({
    seat: null,
    state: { stacks: {} },
    allSeats: [],
    tableStatus: 'OPEN',
    createdAt: '2026-03-01T00:01:30.000Z'
  });
  const originalDateNow = Date.now;
  Date.now = () => Date.parse('2026-03-01T00:02:00.000Z');
  try {
    const result = await executeInactiveCleanup({
      tableId: 'table-grace',
      userId: null,
      requestId: 'req-grace',
      env: {},
      beginSql: async (fn) => fn(ctx.tx),
      postTransaction: async (payload) => ctx.ledgerCalls.push(payload),
      isHoleCardsTableMissing: () => false
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'grace_period');
    assert.equal(result.retryable, true);
    assert.equal(ctx.ledgerCalls.length, 0);
  } finally {
    Date.now = originalDateNow;
  }
});

test('system sweep closes settled bots-only table without requiring a UUID system actor', async () => {
  const ctx = makeTx({
    seat: null,
    state: {
      phase: 'SETTLED',
      handId: 'hand-settled',
      turnUserId: null,
      stacks: { 'bot-1': 80, 'user-left': 20 }
    },
    allSeats: [
      { user_id: 'user-left', status: 'INACTIVE', is_bot: false, stack: 0 },
      { user_id: 'bot-1', status: 'ACTIVE', is_bot: true, stack: 80 }
    ],
    tableStatus: 'OPEN',
    createdAt: '2026-03-01T00:00:00.000Z'
  });

  const result = await executeInactiveCleanup({
    tableId: 'table-system-sweep',
    userId: null,
    requestId: 'req-system-sweep',
    env: {},
    beginSql: async (fn) => fn(ctx.tx),
    postTransaction: async (payload) => ctx.ledgerCalls.push(payload),
    isHoleCardsTableMissing: () => false
  });

  assert.equal(result.ok, true);
  assert.equal(result.closed, true);
  assert.equal(result.status, 'cleaned_closed');
  assert.equal(ctx.ledgerCalls.length, 1);
  assert.equal(ctx.ledgerCalls[0].createdBy, null);
});

test('system sweep closes recent bots-only river when turn deadline is long expired', async () => {
  const nowMs = Date.parse('2026-03-01T00:02:00.000Z');
  const ctx = makeTx({
    seat: null,
    state: {
      phase: 'RIVER',
      handId: 'hand-expired-deadline',
      turnUserId: 'bot-1',
      turnDeadlineAt: nowMs - 20_000,
      stacks: { 'bot-1': 80, 'user-left': 20 }
    },
    allSeats: [
      { user_id: 'user-left', status: 'INACTIVE', is_bot: false, stack: 0 },
      { user_id: 'bot-1', status: 'ACTIVE', is_bot: true, stack: 80 }
    ],
    tableStatus: 'OPEN',
    createdAt: '2026-03-01T00:00:00.000Z',
    lastActivityAt: '2026-03-01T00:01:55.000Z'
  });
  const originalDateNow = Date.now;
  Date.now = () => nowMs;
  try {
    const result = await executeInactiveCleanup({
      tableId: 'table-recent-stuck',
      userId: null,
      requestId: 'req-recent-stuck',
      env: {},
      beginSql: async (fn) => fn(ctx.tx),
      postTransaction: async (payload) => ctx.ledgerCalls.push(payload),
      isHoleCardsTableMissing: () => false
    });

    assert.equal(result.ok, true);
    assert.equal(result.closed, true);
    assert.equal(result.status, 'cleaned_closed');
    const closedState = ctx.updates.filter((u) => u.kind === 'state').at(-1)?.value;
    assert.equal(closedState.phase, 'HAND_DONE');
    assert.equal(closedState.turnUserId, null);
  } finally {
    Date.now = originalDateNow;
  }
});
