import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

const wsClientSource = fs.readFileSync(path.join(process.cwd(), 'poker/poker-ws-client.js'), 'utf8');
const sentFrames = [];
const sockets = [];

class FakeWebSocket {
  constructor(url){
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    sockets.push(this);
  }
  send(raw){ sentFrames.push(JSON.parse(raw)); }
  close(){ this.readyState = 3; if (this.onclose) this.onclose({ code: 1000 }); }
}

function emitFrame(ws, frame){
  ws.onmessage({ data: JSON.stringify(frame) });
}

function createRealWsFactory(){
  return function wsFactory(createOptions){
    const sandbox = {
      window: {
        WebSocket: FakeWebSocket,
        __POKER_WS_URL: 'wss://example/ws',
        KLog: { log: () => {} }
      },
      fetch: async () => ({ ok: true, json: async () => ({ ok: true, token: 'mint-token' }) }),
      JSON,
      Date,
      Math,
      setTimeout,
      clearTimeout,
      Promise,
      Error,
      Map
    };
    sandbox.window.fetch = sandbox.fetch;
    vm.createContext(sandbox);
    vm.runInContext(wsClientSource, sandbox, { filename: 'poker/poker-ws-client.js' });
    return sandbox.window.PokerWsClient.create(createOptions);
  };
}

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
      state: { version: 4, state: { handId: 'h-err-1', phase: 'PREFLOP', turnUserId: 'user-1', pot: 10, community: [] } },
    },
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
      state: { version: 5, state: { handId: 'h-err-1', phase: 'FLOP', turnUserId: 'user-2', pot: 12, community: ['As', 'Kd', '3h'] } },
    },
  ],
  wsFactory: createRealWsFactory()
});

harness.fireDomContentLoaded();
await harness.flush();
await harness.flush();
await harness.flush();

const ws = sockets[0];
ws.readyState = 1;
ws.onopen();
emitFrame(ws, { version: '1.0', type: 'helloAck', payload: {} });
await harness.flush();
emitFrame(ws, { version: '1.0', type: 'authOk', payload: { roomId: 'table-1' } });
await harness.flush();
emitFrame(ws, {
  version: '1.0',
  type: 'table_state',
  payload: {
    tableId: 'table-1',
    stateVersion: 5,
    hand: { handId: 'h-err-1', status: 'PREFLOP' },
    turn: { userId: 'user-1', deadlineAt: Date.now() + 30000 },
    legalActions: { actions: ['FOLD'] },
    actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
    authoritativeMembers: [
      { userId: 'user-1', seat: 0 },
      { userId: 'user-2', seat: 1 }
    ]
  }
});
await harness.flush();

harness.elements.pokerActFoldBtn.click();
await harness.flush();
const firstAct = sentFrames.filter((frame) => frame.type === 'act').slice(-1)[0];
assert.ok(firstAct && firstAct.requestId, 'first act should be sent over WS with requestId');
emitFrame(ws, {
  version: '1.0',
  type: 'commandResult',
  requestId: firstAct.requestId,
  payload: { requestId: firstAct.requestId, status: 'rejected', reason: 'invalid_amount' }
});
await harness.flush();

assert.equal(harness.elements.pokerActStatus.textContent, 'Invalid amount', 'WS invalid_amount should show specific invalid amount message');
assert.notEqual(harness.elements.pokerActStatus.textContent, 'Failed to send action', 'WS invalid_amount should not show generic action error');

const getCallsBeforeStateInvalid = harness.fetchState.getCalls;
harness.elements.pokerActFoldBtn.click();
await harness.flush();
const secondAct = sentFrames.filter((frame) => frame.type === 'act').slice(-1)[0];
assert.ok(secondAct && secondAct.requestId, 'second act should be sent over WS with requestId');
emitFrame(ws, {
  version: '1.0',
  type: 'commandResult',
  requestId: secondAct.requestId,
  payload: { requestId: secondAct.requestId, status: 'rejected', reason: 'state_invalid' }
});
await harness.flush();
await harness.flush();
assert.notEqual(harness.elements.pokerActStatus.textContent, 'Failed to send action', 'WS state_invalid should not collapse to generic failure');
assert.equal(harness.fetchState.getCalls > getCallsBeforeStateInvalid, true, 'WS state_invalid should trigger loadTable(false) refresh when active');
