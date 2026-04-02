import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

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
    table: { tableId: 'table-1', status: 'OPEN', maxSeats: 9, members: [{ userId: 'u1', seat: 1 }] },
    public: {
      hand: { handId: 'h-2', status: 'TURN' },
      turn: { userId: 'u1', deadlineAt: Date.now() + 5000 },
      board: ['As', 'Kd', '3h', '2c'],
      pot: { total: 42, sidePots: [] },
      legalActions: ['CHECK']
    }
  },
});
await harness.flush();

assert.equal(Number(harness.elements.pokerVersion.textContent), 2, 'WS snapshot should drive rendered table version');
assert.equal(harness.elements.pokerPhase.textContent, 'TURN', 'WS snapshot should drive rendered phase');
assert.equal(harness.elements.pokerSeatsGrid.children.length, 9, 'WS maxSeats bootstrap should set table capacity without HTTP baseline');
assert.ok(
  harness.clearTimeoutCalls.length > clearTimeoutBeforeSnapshot,
  'stopPolling should be triggered after a valid WS snapshot is applied'
);
