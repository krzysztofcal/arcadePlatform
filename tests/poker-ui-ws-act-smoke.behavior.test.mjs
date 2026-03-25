import test from 'node:test';
import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

test('poker UI WS smoke sends one action and refreshes public table state without freezing controls', async () => {
  var actPayloads = [];
  var snapshotHandler = null;
  var harness = createPokerTableHarness({
    responses: [
      {
        tableId: 'table-1',
        status: 'OPEN',
        maxPlayers: 6,
        seats: [
          { seatNo: 1, userId: 'user-1', status: 'ACTIVE', stack: 150 },
          { seatNo: 2, userId: 'bot-2', status: 'ACTIVE', stack: 150 },
          { seatNo: 3, userId: 'bot-3', status: 'ACTIVE', stack: 150 }
        ],
        legalActions: ['CHECK'],
        actionConstraints: {},
        state: {
          version: 1,
          state: {
            phase: 'PREFLOP',
            pot: 15,
            community: [],
            stacks: { 'user-1': 150, 'bot-2': 150, 'bot-3': 150 },
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
        sendAct(payload){
          actPayloads.push(payload);
          return Promise.resolve({ ok: true });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();

  assert.equal(harness.elements.pokerActionsRow.hidden, false, 'smoke act should expose action controls for the acting user');
  assert.equal(harness.elements.pokerActCheckBtn.hidden, false, 'smoke act should expose the CHECK button');

  harness.elements.pokerActCheckBtn.click();
  await harness.flush();

  assert.equal(actPayloads.length, 1, 'smoke act should send one WS action payload');
  assert.equal(actPayloads[0].handId, 'hand-1', 'smoke act should send the current hand id');
  assert.equal(actPayloads[0].action, 'CHECK', 'smoke act should send the normalized WS action');
  assert.equal(harness.fetchState.actCalls, 0, 'smoke act should stay on the WS action path');
  assert.equal(harness.fetchState.getCalls, 1, 'smoke act should not trigger an extra HTTP table reload after the WS write');

  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 2,
      seats: [
        { seatNo: 1, userId: 'user-1', status: 'ACTIVE' },
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' },
        { seatNo: 3, userId: 'bot-3', status: 'ACTIVE' }
      ],
      stacks: { 'user-1': 145, 'bot-2': 150, 'bot-3': 150 },
      authoritativeMembers: [
        { userId: 'user-1', seat: 1 },
        { userId: 'bot-2', seat: 2 },
        { userId: 'bot-3', seat: 3 }
      ],
      hand: { status: 'FLOP', handId: 'hand-1' },
      turn: { userId: 'bot-2', deadlineAt: Date.now() + 5000 },
      board: { cards: ['As', 'Kd', '3h'] },
      pot: { total: 20, sidePots: [] },
      legalActions: { actions: [] }
    }
  });
  await harness.flush();

  assert.equal(String(harness.elements.pokerVersion.textContent), '2', 'smoke act should render the refreshed public snapshot version');
  assert.equal(harness.elements.pokerPhase.textContent, 'FLOP', 'smoke act should render the refreshed public phase');
  assert.equal(String(harness.elements.pokerPot.textContent), '20', 'smoke act should render the refreshed public pot');
  assert.equal(harness.elements.pokerActionsRow.hidden, true, 'smoke act should move the UI out of the acting state after the refresh');
  assert.notEqual(harness.elements.pokerActStatus.textContent, 'Sending...', 'smoke act should clear the pending action status after the refresh');
});
