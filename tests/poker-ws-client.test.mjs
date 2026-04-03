import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadClientHarness(options = {}){
  const source = fs.readFileSync(new URL('../poker/poker-ws-client.js', import.meta.url), 'utf8');
  const sentFrames = [];
  const logs = [];
  const statuses = [];
  const snapshots = [];
  const protocolErrors = [];
  let fetchCalls = [];

  const buildInfo = options.buildInfo || null;
  const pokerWsUrlOverride = Object.prototype.hasOwnProperty.call(options, 'pokerWsUrlOverride') ? options.pokerWsUrlOverride : undefined;
  const pokerWsEndpointOverride = Object.prototype.hasOwnProperty.call(options, 'pokerWsEndpointOverride') ? options.pokerWsEndpointOverride : undefined;

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
    close(code, reason){
      this.readyState = 3;
      if (this.onclose) this.onclose({ code: code || 1000, reason: reason || '', wasClean: (code || 1000) === 1000 });
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
      BUILD_INFO: buildInfo,
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
  if (pokerWsUrlOverride !== undefined) context.window.__POKER_WS_URL = pokerWsUrlOverride;
  if (pokerWsEndpointOverride !== undefined) context.window.__POKER_WS_ENDPOINT = pokerWsEndpointOverride;
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

function getLogEntries(logs, kind){
  return logs.filter((entry) => entry.kind === kind);
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

  const lifecycleKinds = h.logs.map((entry) => entry.kind);
  assert.ok(lifecycleKinds.includes('poker_ws_bootstrap_begin'));
  assert.ok(lifecycleKinds.includes('poker_ws_url_resolved'));
  assert.ok(lifecycleKinds.includes('poker_ws_ctor'));
  assert.ok(lifecycleKinds.includes('poker_ws_open'));

  const sendLogs = getLogEntries(h.logs, 'poker_ws_send');
  const recvLogs = getLogEntries(h.logs, 'poker_ws_recv');
  assert.deepEqual(sendLogs.slice(0, 3).map((entry) => entry.data.type), ['hello', 'auth', 'table_state_sub']);
  assert.deepEqual(recvLogs.slice(0, 4).map((entry) => entry.data.type), ['helloAck', 'authOk', 'table_state', 'table_state']);
  const authSend = sendLogs.find((entry) => entry.data && entry.data.type === 'auth');
  assert.equal(Array.isArray(authSend.data.payloadKeys), true);
  assert.equal(authSend.data.payloadKeys[0], 'token_redacted');

  const logDump = JSON.stringify(h.logs);
  assert.equal(logDump.includes('minted_token_value'), false);
  assert.equal(logDump.includes('supabase_token_value'), false);
});


test('poker ws client sendJoin/sendLeave/sendStartHand/sendAct resolve and reject by commandResult', async () => {
  const h = loadClientHarness();
  h.client.start();
  const ws = h.FakeWebSocket.instances[0];
  ws.open();
  ws.message({ type: 'helloAck', payload: { version: '1.0' } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  ws.message({ type: 'authOk', payload: { roomId: 'table_test_1' } });

  const joinPromise = h.client.sendJoin({ tableId: 'table_test_1' }, 'join_req_1');
  ws.message({ type: 'commandResult', requestId: 'join_req_1', payload: { requestId: 'join_req_1', status: 'accepted', reason: null, seatNo: 3, tableId: 'table_test_1' } });
  const joinResult = await joinPromise;
  assert.equal(joinResult.ok, true);
  assert.equal(joinResult.seatNo, 3);
  assert.equal(joinResult.tableId, 'table_test_1');

  const leavePromise = h.client.sendLeave({ tableId: 'table_test_1' }, 'leave_req_1');
  ws.message({ type: 'commandResult', requestId: 'leave_req_1', payload: { requestId: 'leave_req_1', status: 'accepted', reason: null } });
  const leaveResult = await leavePromise;
  assert.equal(leaveResult.ok, true);

  const startPromise = h.client.sendStartHand({ tableId: 'table_test_1' }, 'start_req_1');
  ws.message({ type: 'commandResult', requestId: 'start_req_1', payload: { requestId: 'start_req_1', status: 'rejected', reason: 'not_enough_players' } });
  await assert.rejects(startPromise, (err) => err && err.code === 'not_enough_players');

  const actPromise = h.client.sendAct({ handId: 'h1', action: 'CHECK' }, 'act_req_1');
  ws.message({ type: 'commandResult', requestId: 'act_req_1', payload: { requestId: 'act_req_1', status: 'rejected', reason: 'hand_not_live' } });
  await assert.rejects(actPromise, (err) => err && err.code === 'hand_not_live');
});

test('poker ws client auto-requests resync when server marks session stale', async () => {
  const h = loadClientHarness();
  h.client.start();
  const ws = h.FakeWebSocket.instances[0];
  ws.open();
  ws.message({ type: 'helloAck', payload: { version: '1.0' } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  ws.message({ type: 'authOk', payload: { roomId: 'table_test_1' } });

  const sentBefore = h.sentFrames.length;
  ws.message({ type: 'resync', payload: { mode: 'required', reason: 'persistence_conflict', expectedSeq: 0 } });

  assert.equal(h.sentFrames.length, sentBefore + 1);
  assert.equal(h.sentFrames[sentBefore].type, 'resync');
  assert.equal(h.sentFrames[sentBefore].payload.tableId, 'table_test_1');
  assert.equal(h.sentFrames[sentBefore].payload.reason, 'persistence_conflict');
  assert.equal(h.protocolErrors.length, 0);

  const resyncStatus = h.statuses.find((entry) => entry.status === 'resync');
  assert.equal(!!resyncStatus, true);
  assert.equal(resyncStatus.data.reason, 'persistence_conflict');
  assert.equal(resyncStatus.data.mode, 'required');
});

test('poker ws client rejects pending commands on close', async () => {
  const h = loadClientHarness();
  h.client.start();
  const ws = h.FakeWebSocket.instances[0];
  ws.open();
  ws.message({ type: 'helloAck', payload: { version: '1.0' } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  ws.message({ type: 'authOk', payload: { roomId: 'table_test_1' } });

  const actPromise = h.client.sendAct({ handId: 'h1', action: 'CHECK' }, 'act_req_close');
  ws.close(1006, 'abnormal_close');
  await assert.rejects(actPromise, (err) => err && err.code === 'ws_closed');
  const closeLogs = getLogEntries(h.logs, 'poker_ws_close');
  assert.equal(closeLogs.length > 0, true);
  assert.equal(closeLogs[0].data.code, 1006);
  assert.equal(closeLogs[0].data.reason, 'abnormal_close');
});

test('poker ws client logs socket error and destroy', () => {
  const h = loadClientHarness();
  h.client.start();
  const ws = h.FakeWebSocket.instances[0];
  ws.open();
  if (ws.onerror) ws.onerror({ message: 'network_down' });
  h.client.destroy();
  const errLog = getLogEntries(h.logs, 'poker_ws_error')[0];
  assert.equal(errLog.data.message, 'network_down');
  const destroyLog = getLogEntries(h.logs, 'poker_ws_destroy')[0];
  assert.equal(!!destroyLog, true);
});

test('poker ws client logs constructor exceptions', () => {
  const source = fs.readFileSync(new URL('../poker/poker-ws-client.js', import.meta.url), 'utf8');
  const logs = [];
  function ThrowingWebSocket(){
    throw new Error('ctor_failed_for_test');
  }
  const context = {
    window: {
      KLog: { log: (kind, data) => logs.push({ kind, data }) },
      WebSocket: ThrowingWebSocket
    },
    Date,
    Math,
    JSON,
    setTimeout,
    clearTimeout
  };
  context.window.window = context.window;
  vm.runInNewContext(source, context);
  const client = context.window.PokerWsClient.create({ tableId: 'table_test_1' });
  assert.throws(() => client.start(), /ctor_failed_for_test/);
  const exceptionLogs = getLogEntries(logs, 'poker_ws_exception');
  assert.equal(exceptionLogs.length, 1);
  assert.equal(exceptionLogs[0].data.phase, 'ws_ctor');
});


test('poker ws client uses preview build WS endpoint when available', () => {
  const h = loadClientHarness({
    buildInfo: { isPreview: true, pokerWsUrl: null, pokerWsPreviewUrl: 'wss://ws-preview.kcswh.pl/ws' }
  });
  h.client.start();
  assert.equal(h.FakeWebSocket.instances[0].url, 'wss://ws-preview.kcswh.pl/ws');
});

test('poker ws client uses production build WS endpoint when not preview', () => {
  const h = loadClientHarness({
    buildInfo: { isPreview: false, pokerWsUrl: 'wss://ws.kcswh.pl/ws', pokerWsPreviewUrl: 'wss://ws-preview.kcswh.pl/ws' }
  });
  h.client.start();
  assert.equal(h.FakeWebSocket.instances[0].url, 'wss://ws.kcswh.pl/ws');
});

test('poker ws client falls back to hardcoded production WS endpoint when config missing', () => {
  const h = loadClientHarness();
  h.client.start();
  assert.equal(h.FakeWebSocket.instances[0].url, 'wss://ws.kcswh.pl/ws');
});

test('poker ws client preview build overrides production globals when preview URL exists', () => {
  const h = loadClientHarness({
    buildInfo: { isPreview: true, pokerWsUrl: 'wss://ws.kcswh.pl/ws', pokerWsPreviewUrl: 'wss://ws-preview.kcswh.pl/ws' },
    pokerWsUrlOverride: 'wss://ws.override.prod/ws',
    pokerWsEndpointOverride: 'wss://ws.override.endpoint/ws'
  });
  h.client.start();
  assert.equal(h.FakeWebSocket.instances[0].url, 'wss://ws-preview.kcswh.pl/ws');
});
