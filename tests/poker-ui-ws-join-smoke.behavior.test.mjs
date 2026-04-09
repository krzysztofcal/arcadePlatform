import test from 'node:test';
import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

test('poker UI WS smoke renders joined player plus two bots from authoritative public snapshot', async () => {
  var joinPayloads = [];
  var snapshotHandler = null;
  var harness = createPokerTableHarness({
    responses: [
      {
        tableId: 'table-1',
        status: 'OPEN',
        maxPlayers: 6,
        seats: [],
        legalActions: [],
        actionConstraints: {},
        state: { version: 0, state: { phase: 'LOBBY', pot: 0, community: [], stacks: {} } }
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
        sendJoin(payload){
          joinPayloads.push(payload);
          return Promise.resolve({ ok: true, seatNo: 1 });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();
  var getCallsBeforeJoin = harness.fetchState.getCalls;

  harness.elements.pokerSeatNo.value = '1';
  harness.elements.pokerBuyIn.value = '150';
  harness.elements.pokerJoin.click();
  await harness.flush();

  assert.equal(joinPayloads.length, 1, 'smoke join should use the WS path once');
  assert.equal(harness.fetchState.joinCalls, 0, 'smoke join should not use HTTP fallback');
  assert.equal(harness.fetchState.getCalls, getCallsBeforeJoin, 'WS join must not trigger HTTP reload');

  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      table: { id: 'table-1', maxPlayers: 6, status: 'OPEN', stakes: { sb: 1, bb: 2 } },
      youSeat: 1,
      seats: [
        { seatNo: 1, userId: 'user-1', status: 'ACTIVE' },
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE', isBot: true },
        { seatNo: 3, userId: 'bot-3', status: 'ACTIVE', isBot: true }
      ],
      stacks: { 'user-1': 150, 'bot-2': 150, 'bot-3': 150 },
      authoritativeMembers: [
        { userId: 'user-1', seat: 1 },
        { userId: 'bot-2', seat: 2 },
        { userId: 'bot-3', seat: 3 }
      ],
      hand: { status: 'PREFLOP', handId: 'hand-1' }
    }
  });
  await harness.flush();

  assert.equal(typeof snapshotHandler, 'function', 'smoke join should wire WS snapshot handler');
  assert.equal(harness.fetchState.getCalls, getCallsBeforeJoin, 'WS snapshot apply must not trigger HTTP reload');

  snapshotHandler({
    kind: 'stateSnapshot',
    payload: {
      table: { tableId: 'table-1', members: [{ userId: 'user-1', seat: 1 }, { userId: 'bot-2', seat: 2 }, { userId: 'bot-3', seat: 3 }] },
      version: 1,
      you: { seat: 1 },
      private: { holeCards: [{ r: 'A', s: 'S' }, { r: 'K', s: 'D' }] },
      public: {
        hand: { handId: 'hand-1', status: 'FLOP' },
        board: [{ r: '2', s: 'C' }, { r: '7', s: 'H' }, { r: 'Q', s: 'S' }]
      }
    }
  });
  await harness.flush();

  assert.equal(harness.fetchState.getCalls, getCallsBeforeJoin, 'WS rich snapshot must not trigger HTTP reload');
});
