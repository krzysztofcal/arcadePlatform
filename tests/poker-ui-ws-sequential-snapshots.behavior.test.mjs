import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

function readRenderedCards(container){
  var nodes = container && Array.isArray(container.children) ? container.children : [];
  return nodes.map(function(card){
    var rank = card && card.children && card.children[0] ? String(card.children[0].textContent || '') : '';
    var suit = card && card.children && card.children[1] ? String(card.children[1].textContent || '') : '';
    return (rank + suit).trim();
  }).filter(Boolean);
}

const harness = createPokerTableHarness();

harness.fireDomContentLoaded();
await harness.flush();

assert.equal(harness.wsCreates.length, 1, 'expected ws bootstrap on table init');
const ws = harness.wsCreates[0].options;

ws.onSnapshot({ kind: 'table_state', payload: { tableId: 'table-1', stateVersion: 2, hand: { handId: 'h2', status: 'FLOP' }, board: { cards: ['As', 'Kd', '3h'] }, pot: { total: 20, sidePots: [] }, authoritativeMembers: [] } });
await harness.flush();
assert.equal(Number(harness.elements.pokerVersion.textContent), 2, 'first newer snapshot should apply');
assert.equal(harness.elements.pokerPhase.textContent, 'FLOP', 'first newer snapshot should update phase');
assert.deepEqual(readRenderedCards(harness.elements.pokerBoard).slice(-3), ['A♠', 'K♦', '3♥'], 'table_state string board cards should render expected visible values');

ws.onSnapshot({ kind: 'table_state', payload: { tableId: 'table-1', stateVersion: 3, hand: { handId: 'h2', status: 'TURN' }, board: { cards: ['As', 'Kd', '3h', '2c'] }, pot: { total: 44, sidePots: [] }, authoritativeMembers: [] } });
await harness.flush();
assert.equal(Number(harness.elements.pokerVersion.textContent), 3, 'second newer snapshot should overwrite prior state');
assert.equal(harness.elements.pokerPhase.textContent, 'TURN', 'second newer snapshot should update phase');

ws.onSnapshot({ kind: 'table_state', payload: { tableId: 'table-1', stateVersion: 3, hand: { handId: 'h2', status: 'RIVER' }, board: { cards: ['As', 'Kd', '3h', '2c', '9d'] }, pot: { total: 80, sidePots: [] }, authoritativeMembers: [] } });
await harness.flush();
assert.equal(Number(harness.elements.pokerVersion.textContent), 3, 'equal-version snapshot should be ignored');
assert.equal(harness.elements.pokerPhase.textContent, 'TURN', 'equal-version snapshot should not regress/overwrite rendered state');
const boardCountBeforeRich = harness.elements.pokerBoard.children.length;

ws.onSnapshot({
  kind: 'stateSnapshot',
  payload: {
    table: { tableId: 'table-1', members: [] },
    version: 3,
    public: {
      hand: { handId: 'h2', status: 'TURN' },
      board: [{ r: 'A', s: 'S' }, { r: 'K', s: 'D' }, { r: '3', s: 'H' }, { r: '2', s: 'C' }],
      legalActions: ['FOLD', 'CALL']
    },
    private: {
      holeCards: [{ r: 'Q', s: 'S' }, { r: 'Q', s: 'D' }]
    }
  }
});
await harness.flush();
assert.equal(Number(harness.elements.pokerVersion.textContent), 3, 'equal-version rich snapshot keeps version and may still apply');
const myCards = readRenderedCards(harness.elements.pokerMyCards);
assert.deepEqual(myCards.slice(-2), ['Q♠', 'Q♦'], 'equal-version rich snapshot should render expected hole card values');
const boardCards = readRenderedCards(harness.elements.pokerBoard);
assert.equal(harness.elements.pokerBoard.children.length > boardCountBeforeRich, true, 'equal-version rich snapshot should update community board rendering');
assert.deepEqual(boardCards.slice(-4), ['A♠', 'K♦', '3♥', '2♣'], 'equal-version rich snapshot should render expected board card values');
assert.equal(harness.elements.pokerPhase.textContent, 'TURN', 'equal-version rich snapshot should not regress phase');

ws.onSnapshot({ kind: 'table_state', payload: { tableId: 'another-table', stateVersion: 99, hand: { handId: 'x', status: 'SHOWDOWN' }, authoritativeMembers: [] } });
await harness.flush();
assert.equal(Number(harness.elements.pokerVersion.textContent), 3, 'cross-table snapshot must be ignored');
assert.equal(harness.elements.pokerPhase.textContent, 'TURN', 'cross-table snapshot must not leak state');
