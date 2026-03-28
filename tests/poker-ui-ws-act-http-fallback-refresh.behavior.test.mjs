import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

const wsActPayloads = [];

const harness = createPokerTableHarness({
  responses: [
    {
      tableId: 'table-1',
      status: 'OPEN',
      maxPlayers: 6,
      seats: [
        { seatNo: 0, userId: 'user-1', status: 'ACTIVE', stack: 100 },
        { seatNo: 1, userId: 'user-2', status: 'ACTIVE', stack: 100 },
      ],
      legalActions: ['FOLD'],
      actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
      state: { version: 4, state: { handId: 'h-http-1', phase: 'PREFLOP', turnUserId: 'user-1', pot: 10, community: [] } },
    },
    {
      tableId: 'table-1',
      status: 'OPEN',
      maxPlayers: 6,
      seats: [
        { seatNo: 0, userId: 'user-1', status: 'ACTIVE', stack: 99 },
        { seatNo: 1, userId: 'user-2', status: 'ACTIVE', stack: 100 },
      ],
      legalActions: [],
      actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
      state: { version: 5, state: { handId: 'h-http-1', phase: 'FLOP', turnUserId: 'user-2', pot: 12, community: ['As', 'Kd', '3h'] } },
    },
  ],
  wsFactory: function wsFactory(){
    return {
      start(){},
      destroy(){},
      sendAct(payload){
        wsActPayloads.push(payload);
        const err = new Error('connection_closed');
        err.code = 'connection_closed';
        return Promise.reject(err);
      }
    };
  }
});

harness.fireDomContentLoaded();
await harness.flush();

assert.equal(harness.fetchState.getCalls, 1, 'bootstrap should fetch initial table state once');
assert.equal(harness.fetchState.actCalls, 0);

harness.elements.pokerActFoldBtn.click();
await harness.flush();
await harness.flush();

assert.equal(wsActPayloads.length, 1, 'WS should still be attempted first');
assert.equal(harness.fetchState.actCalls, 1, 'fallback should call HTTP poker-act once');
assert.equal(harness.fetchState.getCalls, 2, 'successful HTTP fallback should refresh table via loadTable(false)');

const wsRequestId = wsActPayloads[0] && wsActPayloads[0].requestId ? String(wsActPayloads[0].requestId) : '';
const httpRequestId = harness.fetchState.actBodies[0] && harness.fetchState.actBodies[0].requestId ? String(harness.fetchState.actBodies[0].requestId) : '';
assert.ok(wsRequestId.length > 0, 'WS attempt should include non-empty requestId');
assert.equal(httpRequestId, wsRequestId, 'HTTP fallback should reuse the same requestId for idempotency');

assert.equal(Number(harness.elements.pokerVersion.textContent), 5, 'UI should reflect refreshed authoritative version after fallback success');
assert.equal(harness.elements.pokerPhase.textContent, 'FLOP', 'UI phase should come from refreshed HTTP state after fallback');
