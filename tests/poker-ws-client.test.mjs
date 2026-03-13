import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadClientHarness(){
  const source = fs.readFileSync(new URL('../poker/poker-ws-client.js', import.meta.url), 'utf8');
  const sentFrames = [];
  const logs = [];
  const statuses = [];
  const snapshots = [];
  const protocolErrors = [];
  let fetchCalls = [];

  class FakeWebSocket {
    constructor(url){
      this.url = url;
      this.readyState = 0;
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      FakeWebSocket.instances.push(this);
    }
    send(text){
      sentFrames.push(JSON.parse(text));
    }
    close(code){
      this.readyState = 3;
      if (this.onclose) this.onclose({ code: code || 1000 });
    }
    open(){
      this.readyState = 1;
      if (this.onopen) this.onopen();
    }
    message(frame){
      if (this.onmessage) this.onmessage({ data: JSON.stringify(frame) });
    }
  }
  FakeWebSocket.instances = [];

  const context = {
    window: {
      KLog: { log: (kind, data) => logs.push({ kind, data }) },
      WebSocket: FakeWebSocket,
      fetch: async (...args) => {
        fetchCalls.push(args);
        return {
          ok: true,
          async json(){ return { ok: true, token: 'minted_token_value', mode: 'user' }; }
        };
      }
    },
    fetch: async (...args) => context.window.fetch(...args),
    Date,
    Math,
    JSON,
    setTimeout,
    clearTimeout
  };
  context.window.window = context.window;
  vm.runInNewContext(source, context);

  const client = context.window.PokerWsClient.create({
    tableId: 'table_test_1',
    getAccessToken: async () => 'supabase_token_value',
    onStatus: (status, data) => statuses.push({ status, data }),
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onProtocolError: (info) => protocolErrors.push(info)
  });

  return { client, FakeWebSocket, sentFrames, logs, statuses, snapshots, protocolErrors, getFetchCalls: () => fetchCalls };
}

test('poker ws client bootstraps hello -> auth -> snapshot once', async () => {
  const h = loadClientHarness();
  h.client.start();
  assert.equal(h.FakeWebSocket.instances.length, 1);
  const ws = h.FakeWebSocket.instances[0];
  ws.open();

  assert.equal(h.sentFrames[0].type, 'hello');

  ws.message({ type: 'helloAck', payload: { version: '1.0' } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const fetchCalls = h.getFetchCalls();
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0][0], '/.netlify/functions/ws-mint-token');
  assert.equal(h.sentFrames[1].type, 'auth');
  assert.equal(h.sentFrames[1].payload.token, 'minted_token_value');

  ws.message({ type: 'authOk', payload: { roomId: 'table_test_1' } });
  assert.equal(h.sentFrames[2].type, 'table_state_sub');
  assert.equal(Object.prototype.hasOwnProperty.call(h.sentFrames[2].payload, 'view'), false);
  assert.ok(typeof h.sentFrames[2].requestId === 'string' && h.sentFrames[2].requestId.length > 0);

  ws.message({ type: 'table_state', payload: { tableId: 'table_test_1', members: [{ userId: 'u1', seat: 1 }], hand: { status: 'FLOP' }, pot: { total: 12 }, turn: { userId: 'u1' }, legalActions: { seat: 1, actions: ['CHECK'] }, actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: 500 } } });
  ws.message({ type: 'table_state', payload: { tableId: 'table_test_1', members: [{ userId: 'u2', seat: 2 }] } });

  assert.equal(h.snapshots.length, 2);
  assert.equal(h.snapshots[0].kind, 'table_state');
  assert.equal(h.snapshots[0].initial, true);
  assert.equal(h.snapshots[0].payload.hand.status, 'FLOP');
  assert.equal(h.snapshots[0].payload.actionConstraints.maxBetAmount, 500);
  assert.equal(h.snapshots[1].kind, 'table_state');
  assert.equal(h.snapshots[1].initial, false);
  assert.equal(h.snapshots[1].payload.members[0].userId, 'u2');
  assert.equal(h.protocolErrors.length, 0);

  const logDump = JSON.stringify(h.logs);
  assert.equal(logDump.includes('minted_token_value'), false);
  assert.equal(logDump.includes('supabase_token_value'), false);
});
