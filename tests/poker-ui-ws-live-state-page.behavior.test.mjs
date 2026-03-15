import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

const harness = createPokerTableHarness({
  responses: [
    {
      tableId: 'table-1',
      status: 'OPEN',
      maxPlayers: 6,
      seats: [],
      legalActions: [],
      actionConstraints: {},
      state: { version: 1, state: { phase: 'PREFLOP', pot: 10, community: [] } },
    },
    {
      tableId: 'table-1',
      status: 'OPEN',
      maxPlayers: 6,
      seats: [],
      legalActions: [],
      actionConstraints: {},
      state: { version: 1, state: { phase: 'PREFLOP', pot: 10, community: [] } },
    },
  ],
});

harness.fireDomContentLoaded();
await harness.flush();

assert.equal(harness.fetchState.getCalls, 1, 'table bootstrap should fetch once via loadTable(false)');
assert.equal(harness.wsCreates.length, 1, 'table startup should bootstrap WS client once');

const ws = harness.wsCreates[0].options;
ws.onProtocolError({ code: 'socket_error', detail: 'simulated' });
await harness.flush();

assert.ok(harness.fetchState.getCalls >= 2, 'protocol error should trigger fallback loadTable(false)');

const clearTimeoutBeforeSnapshot = harness.clearTimeoutCalls.length;
ws.onSnapshot({
  kind: 'table_state',
  payload: {
    tableId: 'table-1',
    stateVersion: 2,
    hand: { handId: 'h-2', status: 'TURN' },
    turn: { userId: 'u1', deadlineAt: Date.now() + 5000 },
    board: { cards: ['As', 'Kd', '3h', '2c'] },
    pot: { total: 42, sidePots: [] },
    authoritativeMembers: [],
  },
});
await harness.flush();

assert.equal(Number(harness.elements.pokerVersion.textContent), 2, 'WS snapshot should drive rendered table version');
assert.equal(harness.elements.pokerPhase.textContent, 'TURN', 'WS snapshot should drive rendered phase');
assert.ok(
  harness.clearTimeoutCalls.length > clearTimeoutBeforeSnapshot,
  'stopPolling should be triggered after a valid WS snapshot is applied'
);
