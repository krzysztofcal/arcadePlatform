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

  send(raw){
    sentFrames.push(JSON.parse(raw));
  }

  close(){
    this.readyState = 3;
    if (typeof this.onclose === 'function') this.onclose({ code: 1000 });
  }
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
      state: {
        version: 4,
        state: {
          handId: 'h-ws-1',
          phase: 'PREFLOP',
          turnUserId: 'user-1',
          pot: 10,
          community: []
        }
      },
    },
  ],
  wsFactory: createRealWsFactory()
});

harness.fireDomContentLoaded();
await harness.flush();
await harness.flush();
await harness.flush();

assert.equal(harness.fetchState.getCalls, 1, 'bootstrap should fetch table once');
assert.equal(sockets.length, 1, 'real WS client should create one socket');

const ws = sockets[0];
ws.readyState = 1;
ws.onopen();

assert.equal(sentFrames[0].type, 'hello', 'socket should send hello frame first');
emitFrame(ws, { version: '1.0', type: 'helloAck', payload: {} });
await harness.flush();

const authFrame = sentFrames.find((frame) => frame.type === 'auth');
assert.ok(authFrame, 'socket should send auth frame after helloAck');
emitFrame(ws, { version: '1.0', type: 'authOk', payload: { roomId: 'table-1' } });
await harness.flush();

const subFrame = sentFrames.find((frame) => frame.type === 'table_state_sub');
assert.ok(subFrame, 'socket should request table_state_sub after authOk');

emitFrame(ws, {
  version: '1.0',
  type: 'table_state',
  payload: {
    tableId: 'table-1',
    stateVersion: 5,
    hand: { handId: 'h-ws-1', status: 'PREFLOP' },
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

const actFrame = sentFrames.find((frame) => frame.type === 'act');
assert.ok(actFrame, 'clicking action should emit ws act envelope');
assert.equal(actFrame.payload.handId, 'h-ws-1', 'act envelope should include current handId');
assert.equal(actFrame.payload.action, 'FOLD', 'act envelope should include normalized action');
assert.equal(typeof actFrame.requestId, 'string');
assert.ok(actFrame.requestId.length > 0, 'act envelope should include requestId');

emitFrame(ws, {
  version: '1.0',
  type: 'commandResult',
  requestId: actFrame.requestId,
  payload: { requestId: actFrame.requestId, status: 'accepted', reason: null }
});
await harness.flush();

emitFrame(ws, {
  version: '1.0',
  type: 'table_state',
  payload: {
    tableId: 'table-1',
    stateVersion: 6,
    hand: { handId: 'h-ws-1', status: 'FLOP' },
    turn: { userId: 'user-2', deadlineAt: Date.now() + 30000 },
    legalActions: { actions: [] },
    actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: null },
    authoritativeMembers: [
      { userId: 'user-1', seat: 0 },
      { userId: 'user-2', seat: 1 }
    ]
  }
});
await harness.flush();

assert.equal(harness.fetchState.actCalls, 0, 'healthy WS success path must not call HTTP poker-act');
assert.equal(harness.fetchState.getCalls, 1, 'healthy WS success should not force HTTP refresh loadTable(false)');
assert.equal(Number(harness.elements.pokerVersion.textContent), 6, 'UI should update from WS table_state after commandResult');
assert.equal(harness.elements.pokerPhase.textContent, 'FLOP', 'UI should render phase from WS table_state update');
