import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

const harness = createPokerTableHarness();

harness.fireDomContentLoaded();
await harness.flush();

assert.equal(harness.wsCreates.length, 1, 'expected ws bootstrap on table init');
const ws = harness.wsCreates[0].options;

ws.onSnapshot({ kind: 'table_state', payload: { tableId: 'table-1', stateVersion: 2, hand: { handId: 'h2', status: 'FLOP' }, board: { cards: ['As', 'Kd', '3h'] }, pot: { total: 20, sidePots: [] }, authoritativeMembers: [] } });
await harness.flush();
assert.equal(Number(harness.elements.pokerVersion.textContent), 2, 'first newer snapshot should apply');
assert.equal(harness.elements.pokerPhase.textContent, 'FLOP', 'first newer snapshot should update phase');

ws.onSnapshot({ kind: 'table_state', payload: { tableId: 'table-1', stateVersion: 3, hand: { handId: 'h2', status: 'TURN' }, board: { cards: ['As', 'Kd', '3h', '2c'] }, pot: { total: 44, sidePots: [] }, authoritativeMembers: [] } });
await harness.flush();
assert.equal(Number(harness.elements.pokerVersion.textContent), 3, 'second newer snapshot should overwrite prior state');
assert.equal(harness.elements.pokerPhase.textContent, 'TURN', 'second newer snapshot should update phase');

ws.onSnapshot({ kind: 'table_state', payload: { tableId: 'table-1', stateVersion: 3, hand: { handId: 'h2', status: 'RIVER' }, board: { cards: ['As', 'Kd', '3h', '2c', '9d'] }, pot: { total: 80, sidePots: [] }, authoritativeMembers: [] } });
await harness.flush();
assert.equal(Number(harness.elements.pokerVersion.textContent), 3, 'equal-version snapshot should be ignored');
assert.equal(harness.elements.pokerPhase.textContent, 'TURN', 'equal-version snapshot should not regress/overwrite rendered state');

ws.onSnapshot({ kind: 'table_state', payload: { tableId: 'another-table', stateVersion: 99, hand: { handId: 'x', status: 'SHOWDOWN' }, authoritativeMembers: [] } });
await harness.flush();
assert.equal(Number(harness.elements.pokerVersion.textContent), 3, 'cross-table snapshot must be ignored');
assert.equal(harness.elements.pokerPhase.textContent, 'TURN', 'cross-table snapshot must not leak state');
