import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

const source = fs.readFileSync('poker/poker.js', 'utf8');
assert.equal(/wsLiveHealthy/.test(source), false, 'dead wsLiveHealthy flag should be removed');

const harness = createPokerTableHarness({ disableWsClient: true });
harness.fireDomContentLoaded();
await harness.flush();

assert.equal(harness.fetchState.getCalls, 1, 'bootstrap loadTable(false) should still run when WS client is unavailable');
const baselineDoneIndex = harness.timeline.findIndex((entry) => entry.kind === 'load_table_fetch_done');
assert.ok(baselineDoneIndex >= 0, 'baseline table fetch should complete before fallback polling starts');
assert.ok(harness.getScheduledTimeoutCount() > 0, 'polling fallback should schedule an HTTP polling timer when WS is unavailable');

const throwingHarness = createPokerTableHarness({
  wsFactory(){
    throw new Error('ws_ctor_sync_fail');
  }
});
throwingHarness.fireDomContentLoaded();
await throwingHarness.flush();

const wsExceptionIndex = throwingHarness.logs.findIndex((entry) => entry.kind === 'poker_ws_exception');
const fallbackIndex = throwingHarness.logs.findIndex((entry) => entry.kind === 'poker_http_fallback_start');
assert.ok(wsExceptionIndex >= 0, 'sync WS bootstrap exception should be logged');
assert.ok(fallbackIndex >= 0, 'fallback start should be logged');
assert.ok(wsExceptionIndex < fallbackIndex, 'exception log must appear before fallback start');

const healthyHarness = createPokerTableHarness({
  responses: [
    {
      tableId: 'table-1',
      status: 'OPEN',
      maxPlayers: 6,
      seats: [
        { seatNo: 0, userId: null, status: 'EMPTY', stack: 100 },
        { seatNo: 1, userId: null, status: 'EMPTY', stack: 100 }
      ],
      legalActions: [],
      actionConstraints: {},
      state: { version: 1, state: { phase: 'PREFLOP', pot: 10, community: [], stacks: {} } },
    }
  ],
  wsFactory(createOptions){
    return {
      start(){
        Promise.resolve().then(function(){
          if (typeof createOptions.onStatus === 'function') createOptions.onStatus('auth_ok', { roomId: 'table-1' });
          if (typeof createOptions.onSnapshot === 'function') {
            createOptions.onSnapshot({
              kind: 'table_state',
              payload: {
                tableId: 'table-1',
                stateVersion: 1,
                authoritativeMembers: [{ userId: 'user-1', seat: 1 }],
                youSeat: 1,
                seats: [{ seatNo: 1, userId: 'user-1', status: 'ACTIVE' }],
                stacks: { 'user-1': 100 },
                hand: { status: 'PREFLOP' }
              }
            });
          }
        });
      },
      destroy(){},
      isReady(){ return true; }
    };
  }
});
healthyHarness.fireDomContentLoaded();
await healthyHarness.flush();
await healthyHarness.flush();
assert.equal(healthyHarness.fetchState.joinCalls, 0, 'healthy same-version WS snapshot should not trigger HTTP join fallback');
assert.equal(healthyHarness.logs.some((entry) => entry.kind === 'poker_http_fallback_start'), false, 'healthy same-version WS snapshot should not activate HTTP fallback');
assert.equal(healthyHarness.elements.pokerYourStack.textContent, '100', 'healthy same-version WS snapshot should still render joined state from WS stack data');
