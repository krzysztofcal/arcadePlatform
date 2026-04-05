import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

function seatCardFor(seatsGrid, seatNo){
  if (!seatsGrid || !Array.isArray(seatsGrid.children)) return null;
  var index = Number(seatNo) - 1;
  if (!Number.isInteger(index) || index < 0) return null;
  return seatsGrid.children[index] || null;
}

const harness = createPokerTableHarness();

harness.fireDomContentLoaded();
await harness.flush();

assert.equal(harness.fetchState.getCalls, 0, 'table bootstrap must not fetch poker-get-table');
assert.equal(harness.wsCreates.length, 1, 'table startup should bootstrap WS client once');

const ws = harness.wsCreates[0].options;
ws.onProtocolError({ code: 'socket_error', detail: 'simulated' });
await harness.flush();

assert.equal(harness.fetchState.getCalls, 0, 'protocol error must not trigger HTTP fallback fetch');

const clearTimeoutBeforeSnapshot = harness.clearTimeoutCalls.length;
ws.onSnapshot({
  kind: 'stateSnapshot',
  payload: {
    tableId: 'table-1',
    stateVersion: 2,
    table: { tableId: 'table-1', status: 'OPEN', maxSeats: 9, members: [{ userId: 'user-1', seat: 1 }] },
    public: {
      hand: { handId: 'h-2', status: 'TURN' },
      turn: { userId: 'u1', deadlineAt: Date.now() + 5000 },
      board: ['As', 'Kd', '3h', '2c'],
      pot: { total: 42, sidePots: [] },
      legalActions: ['CHECK'],
      stacks: { 'user-1': 250 }
    },
    you: { seat: 1 }
  },
});
await harness.flush();

assert.equal(Number(harness.elements.pokerVersion.textContent), 2, 'WS snapshot should drive rendered table version');
assert.equal(harness.elements.pokerPhase.textContent, 'TURN', 'WS snapshot should drive rendered phase');
assert.equal(harness.elements.pokerSeatsGrid.children.length, 9, 'WS maxSeats bootstrap should set table capacity without HTTP baseline');
assert.equal(harness.elements.pokerYourStack.textContent, '250', 'WS snapshot should normalize public.stacks and render current user stack');
assert.equal(
  harness.logs.some((entry) => entry.kind === 'poker_stack_missing_for_seated_user'),
  false,
  'stack missing log should not fire when stack exists in payload.public.stacks'
);

assert.ok(
  harness.clearTimeoutCalls.length > clearTimeoutBeforeSnapshot,
  'stopPolling should be triggered after a valid WS snapshot is applied'
);

const missingHarness = createPokerTableHarness();
missingHarness.fireDomContentLoaded();
await missingHarness.flush();
assert.equal(missingHarness.fetchState.getCalls, 0, 'missing-stack scenario should remain WS-only');
const missingWs = missingHarness.wsCreates[0].options;
missingWs.onSnapshot({
  kind: 'stateSnapshot',
  payload: {
    tableId: 'table-1',
    stateVersion: 2,
    table: { tableId: 'table-1', status: 'OPEN', maxSeats: 9, members: [{ userId: 'user-1', seat: 1 }] },
    public: {
      hand: { handId: 'h-3', status: 'TURN' },
      turn: { userId: 'u2', deadlineAt: Date.now() + 5000 },
      board: ['As', 'Kd', '3h', '2c'],
      pot: { total: 22, sidePots: [] },
      legalActions: ['CHECK']
    },
    you: { seat: 1 }
  },
});
await missingHarness.flush();

assert.equal(missingHarness.elements.pokerYourStack.textContent, '-', 'missing stack for seated user should render placeholder and never fake zero');
const seatOneCard = seatCardFor(missingHarness.elements.pokerSeatsGrid, 1);
const seatOneStackNode = seatOneCard && seatOneCard.children
  ? seatOneCard.children[3]
  : null;
assert.equal(
  seatOneStackNode && seatOneStackNode.textContent ? seatOneStackNode.textContent.indexOf(': -') !== -1 : false,
  true,
  'active seat with missing stack should render placeholder, not zero'
);
