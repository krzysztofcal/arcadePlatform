import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(path.join(process.cwd(), 'poker/poker-ws-client.js'), 'utf8');

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
    if (this.onclose) this.onclose({ code: 1000 });
  }
}

function emitFrame(ws, frame){
  ws.onmessage({ data: JSON.stringify(frame) });
}

function createClient(){
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
    Map,
    Promise,
    setTimeout,
    clearTimeout,
    Error,
  };
  sandbox.window.fetch = sandbox.fetch;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'poker/poker-ws-client.js' });

  const client = sandbox.window.PokerWsClient.create({
    tableId: 'table-1',
    getAccessToken: async () => 'access-token',
  });

  return client;
}

const client = createClient();
client.start();

assert.equal(sockets.length, 1);
const ws = sockets[0];
ws.readyState = 1;
ws.onopen();
emitFrame(ws, { type: 'helloAck', payload: {} });
await new Promise((resolve) => setTimeout(resolve, 0));
emitFrame(ws, { type: 'authOk', payload: { roomId: 'table-1' } });

const acceptedPromise = client.sendAct({ requestId: 'req-accepted', handId: 'h-1', action: 'fold' });
const actFrame = sentFrames.find((frame) => frame.type === 'act' && frame.requestId === 'req-accepted');
assert.ok(actFrame);

emitFrame(ws, { type: 'commandResult', requestId: 'req-accepted', payload: { requestId: 'req-accepted', status: 'accepted', reason: null } });
const accepted = await acceptedPromise;
assert.equal(accepted.ok, true);

const rejectedPromise = client.sendAct({ requestId: 'req-rejected', handId: 'h-1', action: 'fold' });
emitFrame(ws, { type: 'commandResult', requestId: 'req-rejected', payload: { requestId: 'req-rejected', status: 'rejected', reason: 'illegal_action' } });
await assert.rejects(rejectedPromise, (err) => err && err.code === 'illegal_action');

const invalidAmountPromise = client.sendAct({ requestId: 'req-invalid-amount', handId: 'h-1', action: 'raise', amount: 1 });
emitFrame(ws, { type: 'commandResult', requestId: 'req-invalid-amount', payload: { requestId: 'req-invalid-amount', status: 'rejected', reason: 'invalid_amount' } });
await assert.rejects(invalidAmountPromise, (err) => err && err.code === 'invalid_amount');

const stateInvalidPromise = client.sendAct({ requestId: 'req-state-invalid', handId: 'h-1', action: 'fold' });
emitFrame(ws, { type: 'commandResult', requestId: 'req-state-invalid', payload: { requestId: 'req-state-invalid', status: 'rejected', reason: 'state_invalid' } });
await assert.rejects(stateInvalidPromise, (err) => err && err.code === 'state_invalid');

const pendingClosePromise = client.sendAct({ requestId: 'req-close', handId: 'h-1', action: 'fold' });
ws.close();
await assert.rejects(pendingClosePromise, (err) => err && err.code === 'connection_closed');
