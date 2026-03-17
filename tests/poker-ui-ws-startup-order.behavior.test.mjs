import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

const harness = createPokerTableHarness({
  deferGetTableResponse: true,
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
  ],
});

harness.fireDomContentLoaded();
await harness.flush();

assert.equal(harness.wsCreates.length, 0, 'WS must not bootstrap before baseline loadTable(false) resolves');

harness.resolveDeferredGet({
  tableId: 'table-1',
  status: 'OPEN',
  maxPlayers: 6,
  seats: [],
  legalActions: [],
  actionConstraints: {},
  state: { version: 1, state: { phase: 'PREFLOP', pot: 10, community: [] } },
});
await harness.flush();

assert.equal(harness.wsCreates.length, 1, 'WS should bootstrap after baseline fetch completion');

const baselineDoneIndex = harness.timeline.findIndex((entry) => entry.kind === 'load_table_fetch_done');
const wsStartIndex = harness.timeline.findIndex((entry) => entry.kind === 'ws_start');
assert.ok(baselineDoneIndex >= 0, 'timeline should include baseline completion');
assert.ok(wsStartIndex >= 0, 'timeline should include ws start');
assert.ok(baselineDoneIndex < wsStartIndex, 'baseline completion must happen before ws start');

const ws = harness.wsCreates[0].options;
ws.onSnapshot({
  kind: 'table_state',
  payload: {
    tableId: 'table-1',
    stateVersion: 2,
    seats: [{ seatNo: 1, userId: 'user-1', status: 'ACTIVE' }],
    state: { phase: 'TURN', pot: 42, community: ['As', 'Kd', '3h', '2c'] },
    authoritativeMembers: [{ userId: 'user-1', seat: 1 }],
  },
});
await harness.flush();

const deferredNoBaseline = harness.logs.find((entry) => entry.kind === 'poker_ws_snapshot_deferred' && entry.data && entry.data.hasTableData === false);
assert.equal(!!deferredNoBaseline, false, 'ordered startup path must not defer valid ws snapshot due to missing baseline');
assert.equal(Number(harness.elements.pokerVersion.textContent), 2, 'joined/seated ws snapshot should render once baseline exists');
