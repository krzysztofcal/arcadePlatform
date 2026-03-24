import test from 'node:test';
import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

function findRenderedSeatByUserId(harness, userId){
  return harness.elements.pokerSeatsGrid.children.find(function(seat){
    return !!(seat && seat.children && seat.children[1] && seat.children[1].textContent === userId);
  }) || null;
}

function countRenderedOccupiedSeats(harness){
  var seen = new Set();
  harness.elements.pokerSeatsGrid.children.forEach(function(seat){
    var userId = seat && seat.children && seat.children[1] ? seat.children[1].textContent : '';
    if (userId) seen.add(userId);
  });
  return seen.size;
}

function readRenderedCards(container){
  var nodes = container && Array.isArray(container.children) ? container.children : [];
  return nodes.map(function(card){
    var rank = card && card.children && card.children[0] ? String(card.children[0].textContent || '') : '';
    var suit = card && card.children && card.children[1] ? String(card.children[1].textContent || '') : '';
    return (rank + suit).trim();
  }).filter(Boolean);
}

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

  harness.elements.pokerSeatNo.value = '1';
  harness.elements.pokerBuyIn.value = '150';
  harness.elements.pokerJoin.click();
  await harness.flush();

  assert.equal(joinPayloads.length, 1, 'smoke join should use the WS path once');
  assert.equal(harness.fetchState.joinCalls, 0, 'smoke join should not use HTTP fallback');
  assert.equal(harness.fetchState.getCalls, 1, 'smoke join should not trigger an extra HTTP table reload after the WS write');

  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
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

  assert.equal(countRenderedOccupiedSeats(harness) >= 3, true, 'smoke join should render at least the three occupied seats from the public snapshot');
  assert.ok(findRenderedSeatByUserId(harness, 'user-1'), 'smoke join should render the joined user seat');
  assert.ok(findRenderedSeatByUserId(harness, 'bot-2'), 'smoke join should render bot seat 2');
  assert.ok(findRenderedSeatByUserId(harness, 'bot-3'), 'smoke join should render bot seat 3');
  assert.equal(String(harness.elements.pokerVersion.textContent), '1', 'smoke join should render the public snapshot version');
  assert.equal(harness.elements.pokerPhase.textContent, 'PREFLOP', 'smoke join should render the public hand phase');
  assert.equal(harness.elements.pokerYourStack.textContent, '150', 'smoke join should render the user stack from public state');

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

  assert.deepEqual(readRenderedCards(harness.elements.pokerMyCards).slice(-2), ['A♠', 'K♦'], 'smoke join should render private hole cards with expected values');
  assert.deepEqual(readRenderedCards(harness.elements.pokerBoard).slice(-3), ['2♣', '7♥', 'Q♠'], 'smoke join should render community cards with expected values');
  assert.ok(findRenderedSeatByUserId(harness, 'user-1'), 'smoke join should keep seat rendering after rich snapshot');
});
