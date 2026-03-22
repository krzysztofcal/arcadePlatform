import test from 'node:test';
import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

test('poker UI WS smoke sends leave over WS and waits for the live snapshot without forcing an HTTP reload', async () => {
  var leavePayloads = [];
  var snapshotHandler = null;
  var harness = createPokerTableHarness({
    responses: [
      {
        tableId: 'table-1',
        status: 'OPEN',
        maxPlayers: 6,
        seats: [
          { seatNo: 1, userId: 'user-1', status: 'ACTIVE', stack: 150 },
          { seatNo: 2, userId: 'bot-2', status: 'ACTIVE', stack: 150 }
        ],
        legalActions: [],
        actionConstraints: {},
        state: {
          version: 1,
          state: {
            phase: 'PREFLOP',
            pot: 15,
            community: [],
            stacks: { 'user-1': 150, 'bot-2': 150 },
            turnUserId: 'user-1',
            handId: 'hand-1'
          }
        }
      }
    ],
    wsFactory(createOptions){
      snapshotHandler = createOptions.onSnapshot;
      return {
        start(){
          Promise.resolve().then(function(){
            if (typeof createOptions.onStatus === 'function') createOptions.onStatus('auth_ok', { roomId: 'table-1' });
          });
        },
        destroy(){},
        isReady(){ return true; },
        sendLeave(payload){
          leavePayloads.push(payload);
          return Promise.resolve({ ok: true });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();

  harness.elements.pokerLeave.click();
  await harness.flush();

  assert.equal(leavePayloads.length, 1, 'smoke leave should send one WS leave payload');
  assert.equal(harness.fetchState.leaveCalls, 0, 'smoke leave should not use the HTTP leave path');
  assert.equal(harness.fetchState.getCalls, 1, 'smoke leave should not trigger an extra HTTP table reload after the WS write');

  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 2,
      seats: [
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }
      ],
      stacks: { 'bot-2': 150 },
      authoritativeMembers: [
        { userId: 'bot-2', seat: 2 }
      ],
      hand: { status: 'LOBBY', handId: null },
      legalActions: { actions: [] }
    }
  });
  await harness.flush();

  assert.equal(String(harness.elements.pokerVersion.textContent), '2', 'smoke leave should render the refreshed public snapshot version');
  assert.equal(harness.elements.pokerPhase.textContent, 'LOBBY', 'smoke leave should render the refreshed public phase');
  assert.equal(harness.fetchState.getCalls, 1, 'smoke leave should stay off the HTTP reload path even after the leave snapshot arrives');
});
