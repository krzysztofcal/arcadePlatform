import test from 'node:test';
import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

async function flushUntil(harness, predicate, maxCycles){
  var cycles = Number.isInteger(maxCycles) && maxCycles > 0 ? maxCycles : 12;
  for (var i = 0; i < cycles; i++){
    await harness.flush();
    if (predicate()) return true;
  }
  return predicate();
}

function makeBaselineResponse(seats){
  return {
    tableId: 'table-1',
    status: 'OPEN',
    maxPlayers: 6,
    seats: Array.isArray(seats) ? seats : [],
    legalActions: [],
    actionConstraints: {},
    state: { version: 0, state: {} }
  };
}

function findRenderedSeatByUserId(harness, userId){
  return harness.elements.pokerSeatsGrid.children.find(function(seat){
    return !!(seat && seat.children && seat.children[1] && seat.children[1].textContent === userId);
  }) || null;
}

async function createSnapshotHarness(response){
  var snapshotHandler = null;
  var statusHandler = null;
  var harness = createPokerTableHarness({
    responses: [response],
    wsFactory(createOptions){
      snapshotHandler = createOptions.onSnapshot;
      statusHandler = createOptions.onStatus;
      return {
        start(){
          Promise.resolve().then(function(){
            if (typeof statusHandler === 'function') statusHandler('auth_ok', { roomId: 'table-1' });
          });
        },
        destroy(){},
        isReady(){ return true; }
      };
    }
  });

  harness.fireDomContentLoaded();
  var ready = await flushUntil(harness, function(){
    return typeof snapshotHandler === 'function' && harness.fetchState.getCalls >= 1;
  });
  assert.equal(ready, true, 'expected WS harness to finish baseline startup');

  return {
    harness: harness,
    emitSnapshot: function(payload){
      snapshotHandler({ kind: 'table_state', payload: payload });
    }
  };
}

test('equal-version snapshot that improves joined seat render is accepted and rendered', async () => {
  var setup = await createSnapshotHarness(makeBaselineResponse([
    { seatNo: 0, userId: null, status: 'EMPTY', stack: 100 },
    { seatNo: 1, userId: null, status: 'EMPTY', stack: 100 }
  ]));
  var harness = setup.harness;
  var baselineSeatRenderCount = harness.elements.pokerSeatsGrid.children.length;

  setup.emitSnapshot({
    tableId: 'table-1',
    stateVersion: 0,
    memberCount: 1,
    maxSeats: 6,
    youSeat: 1,
    seats: [{ seatNo: 1, userId: 'user-1', status: 'ACTIVE' }],
    stacks: { 'user-1': 100 },
    authoritativeMembers: [{ userId: 'user-1', seat: 1 }],
    hand: { status: 'LOBBY' }
  });
  await harness.flush();

  assert.equal(Number(harness.elements.pokerVersion.textContent), 0);
  assert.ok(findRenderedSeatByUserId(harness, 'user-1'), 'expected joined seat row to render from same-version snapshot');
  assert.equal(harness.elements.pokerYourStack.textContent, '100', 'material same-version snapshot should merge stack data for the seated user');
  assert.equal(harness.elements.pokerSeatsGrid.children.length, baselineSeatRenderCount + 6, 'accepted snapshot should produce one additional table render');
  assert.equal(harness.fetchState.joinCalls, 0, 'healthy WS snapshot must not trigger HTTP join fallback');
  assert.equal(harness.logs.some((entry) => entry.kind === 'poker_http_fallback_start'), false, 'healthy WS snapshot must not activate HTTP fallback');
  assert.equal(harness.logs.some((entry) => entry.kind === 'poker_ws_snapshot_ignored' && entry.data && entry.data.reason === 'stale_or_equal_version'), false, 'material same-version snapshot must not be ignored as stale/equal');
});

test('equal-version snapshot without joined seat improvement is ignored', async () => {
  var setup = await createSnapshotHarness(makeBaselineResponse([
    { seatNo: 0, userId: null, status: 'EMPTY', stack: 100 },
    { seatNo: 1, userId: 'user-1', status: 'ACTIVE', stack: 100 }
  ]));
  var harness = setup.harness;
  var baselineSeatRenderCount = harness.elements.pokerSeatsGrid.children.length;

  assert.ok(findRenderedSeatByUserId(harness, 'user-1'), 'baseline should already render current user as seated');

  setup.emitSnapshot({
    tableId: 'table-1',
    stateVersion: 0,
    memberCount: 1,
    maxSeats: 6,
    youSeat: 1,
    seats: [{ seatNo: 1, userId: 'user-1', status: 'ACTIVE' }],
    stacks: { 'user-1': 100 },
    authoritativeMembers: [{ userId: 'user-1', seat: 1 }],
    hand: { status: 'LOBBY' }
  });
  await harness.flush();

  assert.equal(harness.elements.pokerSeatsGrid.children.length, baselineSeatRenderCount, 'ignored same-version snapshot must not re-render the table');
  assert.equal(harness.fetchState.joinCalls, 0, 'ignored same-version snapshot must not trigger HTTP join fallback');
  assert.ok(harness.logs.some((entry) => entry.kind === 'poker_ws_snapshot_ignored' && entry.data && entry.data.reason === 'stale_or_equal_version' && entry.data.incomingStateVersion === 0 && entry.data.currentStateVersion === 0), 'ignored equal-version snapshot should log stale/equal protection');
});

test('repeated equal-version authoritative snapshot remains idempotent after the first apply', async () => {
  var setup = await createSnapshotHarness(makeBaselineResponse([
    { seatNo: 0, userId: null, status: 'EMPTY', stack: 100 },
    { seatNo: 1, userId: null, status: 'EMPTY', stack: 100 }
  ]));
  var harness = setup.harness;
  var snapshotPayload = {
    tableId: 'table-1',
    stateVersion: 0,
    memberCount: 1,
    maxSeats: 6,
    youSeat: 1,
    seats: [{ seatNo: 1, userId: 'user-1', status: 'ACTIVE' }],
    stacks: { 'user-1': 100 },
    authoritativeMembers: [{ userId: 'user-1', seat: 1 }],
    hand: { status: 'LOBBY' }
  };

  var baselineSeatRenderCount = harness.elements.pokerSeatsGrid.children.length;
  setup.emitSnapshot(snapshotPayload);
  await harness.flush();
  var afterFirstSeatRenderCount = harness.elements.pokerSeatsGrid.children.length;

  setup.emitSnapshot(snapshotPayload);
  await harness.flush();

  assert.equal(afterFirstSeatRenderCount, baselineSeatRenderCount + 6, 'first same-version authoritative snapshot should render once');
  assert.equal(harness.elements.pokerSeatsGrid.children.length, afterFirstSeatRenderCount, 'replayed same-version authoritative snapshot should be ignored after convergence');
  assert.ok(findRenderedSeatByUserId(harness, 'user-1'), 'idempotent replay should keep the joined seat rendered');
  var ignoredLogs = harness.logs.filter((entry) => entry.kind === 'poker_ws_snapshot_ignored' && entry.data && entry.data.reason === 'stale_or_equal_version' && entry.data.incomingStateVersion === 0 && entry.data.currentStateVersion === 0);
  assert.equal(ignoredLogs.length, 1, 'only the replayed equal-version snapshot should be ignored');
  assert.equal(harness.fetchState.joinCalls, 0, 'idempotent same-version snapshot replay must not trigger HTTP fallback');
  assert.equal(harness.logs.some((entry) => entry.kind === 'poker_http_fallback_start'), false, 'idempotent same-version snapshot replay must stay on healthy WS path');
});
