import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'poker/poker-ws-client.js'), 'utf8');

const sentFrames = [];
const sockets = [];
let snapshotPayload = null;

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
    if (this.onclose) this.onclose({ code: 1000 });
  }
}

const sandbox = {
  window: {
    WebSocket: FakeWebSocket,
    __POKER_WS_URL: 'wss://example/ws',
    KLog: { log: () => {} },
  },
  fetch: async () => ({ ok: true, json: async () => ({ ok: true, token: 'mint-token' }) }),
  JSON,
  Date,
  Math,
};

sandbox.window.fetch = sandbox.fetch;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'poker/poker-ws-client.js' });

const client = sandbox.window.PokerWsClient.create({
  tableId: 'table-1',
  getAccessToken: async () => 'access-token',
  onSnapshot: (snapshot) => {
    snapshotPayload = snapshot;
  },
});

client.start();
assert.equal(sockets.length, 1, 'expected one websocket instance');

const ws = sockets[0];
ws.readyState = 1;
ws.onopen();

assert.equal(sentFrames[0].type, 'hello', 'expected hello handshake frame');
assert.equal(sentFrames[0].roomId, 'table-1', 'expected roomId on hello frame');

ws.onmessage({ data: JSON.stringify({ type: 'helloAck', payload: {} }) });
await new Promise((resolve) => setTimeout(resolve, 0));

assert.equal(sentFrames[1].type, 'auth', 'expected auth command after helloAck');

ws.onmessage({ data: JSON.stringify({ type: 'authOk', payload: { roomId: 'table-1' } }) });
assert.equal(sentFrames[2].type, 'table_state_sub', 'expected table_state_sub after authOk');

const nextPayload = {
  tableId: 'table-1',
  stateVersion: 9,
  hand: { handId: 'h-1', status: 'TURN' },
};
ws.onmessage({ data: JSON.stringify({ type: 'table_state', payload: nextPayload }) });

assert.ok(snapshotPayload, 'expected table_state snapshot callback');
assert.equal(snapshotPayload.kind, 'table_state', 'expected table_state kind');
assert.equal(snapshotPayload.payload.stateVersion, 9, 'expected pushed state version to flow through callback');
