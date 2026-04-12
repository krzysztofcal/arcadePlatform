import test from 'node:test';
import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

function seatCardFor(seatsGrid, seatNo){
  if (!seatsGrid || !Array.isArray(seatsGrid.children)) return null;
  var index = Number(seatNo);
  if (!Number.isInteger(index) || index < 0) return null;
  return seatsGrid.children[index] || null;
}

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
  var getCallsBeforeLeave = harness.fetchState.getCalls;

  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      seats: [
        { seatNo: 1, userId: 'user-1', status: 'ACTIVE' },
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }
      ],
      stacks: { 'user-1': 150, 'bot-2': 150 },
      authoritativeMembers: [
        { userId: 'user-1', seat: 1 },
        { userId: 'bot-2', seat: 2 }
      ],
      hand: { status: 'PREFLOP', handId: 'hand-1' },
      turn: { userId: 'user-1' },
      legalActions: { actions: ['FOLD', 'CALL'] }
    }
  });
  await harness.flush();

  harness.elements.pokerLeave.click();
  await harness.flush();

  assert.equal(leavePayloads.length, 1, 'smoke leave should send one WS leave payload');
  assert.equal(harness.fetchState.leaveCalls, 0, 'smoke leave should not use the HTTP leave path');
  assert.equal(harness.fetchState.getCalls, getCallsBeforeLeave, 'WS leave must not trigger HTTP reload');
  assert.equal(harness.windowLocation.href, '/poker/', 'accepted leave should navigate back to poker lobby');
  assert.equal(harness.elements.pokerYourStack.textContent, '-', 'accepted leave should clear the current user stack immediately');
  const seatOneCard = seatCardFor(harness.elements.pokerSeatsGrid, 1);
  const seatOneUserNode = seatOneCard && seatOneCard.children ? seatOneCard.children[1] : null;
  const seatOneStackNode = seatOneCard && seatOneCard.children ? seatOneCard.children[3] : null;
  assert.equal(seatOneUserNode && seatOneUserNode.textContent, 'Empty', 'accepted leave should clear the local seat immediately');
  assert.equal(
    seatOneStackNode && seatOneStackNode.textContent ? seatOneStackNode.textContent.indexOf(': -') !== -1 : false,
    true,
    'accepted leave should clear the local seat stack immediately'
  );

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

  assert.equal(harness.fetchState.getCalls, getCallsBeforeLeave, 'WS leave snapshot must stay off the HTTP reload path');
});
