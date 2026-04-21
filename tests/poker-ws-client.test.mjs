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
  const lobbySnapshots = [];
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
    setTimeout: options.setTimeout || setTimeout,
    clearTimeout: options.clearTimeout || clearTimeout,
    setInterval: options.setInterval || setInterval,
    clearInterval: options.clearInterval || clearInterval
  };
  context.window.window = context.window;
  if (pokerWsUrlOverride !== undefined) context.window.__POKER_WS_URL = pokerWsUrlOverride;
  if (pokerWsEndpointOverride !== undefined) context.window.__POKER_WS_ENDPOINT = pokerWsEndpointOverride;
  vm.runInNewContext(source, context);

  const client = context.window.PokerWsClient.create(Object.assign({
    tableId: 'table_test_1',
    getAccessToken: async () => 'supabase_token_value',
    onStatus: (status, data) => statuses.push({ status, data }),
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onLobbySnapshot: (snapshot) => lobbySnapshots.push(snapshot),
    onProtocolError: (info) => protocolErrors.push(info)
  }, options.clientOptions || {}));

  return { client, FakeWebSocket, sentFrames, logs, statuses, snapshots, lobbySnapshots, protocolErrors, getFetchCalls: () => fetchCalls };
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
  ws.message({ type: 'statePatch', payload: { stateVersion: 2, public: { turn: { userId: 'u2' }, legalActions: { seat: 2, actions: ['CHECK', 'BET'] } } } });

  assert.equal(h.snapshots.length, 3);
  assert.equal(h.snapshots[0].kind, 'table_state');
  assert.equal(h.snapshots[0].initial, true);
  assert.equal(h.snapshots[0].payload.hand.status, 'FLOP');
  assert.equal(h.snapshots[0].payload.actionConstraints.maxBetAmount, 500);
  assert.equal(h.snapshots[1].kind, 'table_state');
  assert.equal(h.snapshots[1].initial, false);
  assert.equal(h.snapshots[1].payload.members[0].userId, 'u2');
  assert.equal(h.snapshots[2].kind, 'statePatch');
  assert.equal(h.snapshots[2].initial, false);
  assert.equal(h.snapshots[2].payload.public.turn.userId, 'u2');
  assert.deepEqual(h.snapshots[2].payload.public.legalActions.actions, ['CHECK', 'BET']);
  assert.equal(h.protocolErrors.length, 0);

  const lifecycleKinds = h.logs.map((entry) => entry.kind);
  assert.ok(lifecycleKinds.includes('poker_ws_bootstrap_begin'));
  assert.ok(lifecycleKinds.includes('poker_ws_url_resolved'));
  assert.ok(lifecycleKinds.includes('poker_ws_ctor'));
  assert.ok(lifecycleKinds.includes('poker_ws_open'));

  const sendLogs = getLogEntries(h.logs, 'poker_ws_send');
  const recvLogs = getLogEntries(h.logs, 'poker_ws_recv');
  assert.deepEqual(sendLogs.slice(0, 3).map((entry) => entry.data.type), ['hello', 'auth', 'table_state_sub']);
  assert.deepEqual(recvLogs.slice(0, 5).map((entry) => entry.data.type), ['helloAck', 'authOk', 'table_state', 'table_state', 'statePatch']);
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

test('poker ws client can queue leave without waiting for commandResult', async () => {
  const h = loadClientHarness();
  h.client.start();
  const ws = h.FakeWebSocket.instances[0];
  ws.open();
  ws.message({ type: 'helloAck', payload: { version: '1.0' } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  ws.message({ type: 'authOk', payload: { roomId: 'table_test_1' } });

  const sentBefore = h.sentFrames.length;
  const requestId = h.client.sendLeaveQueued({ tableId: 'table_test_1' }, 'leave_req_queued');

  assert.equal(requestId, 'leave_req_queued');
  assert.equal(h.sentFrames.length, sentBefore + 1);
  assert.equal(h.sentFrames[sentBefore].type, 'leave');
  assert.equal(h.sentFrames[sentBefore].payload.tableId, 'table_test_1');
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

test('poker ws client starts heartbeat loop from helloAck heartbeatMs', async () => {
  const intervalCalls = [];
  const h = loadClientHarness({
    setInterval(fn, delay){
      intervalCalls.push(delay);
      fn();
      return { fn, delay, unref(){} };
    },
    clientOptions: {
      heartbeatFallbackMs: 1000,
      autoReconnect: false
    }
  });
  h.client.start();
  const ws = h.FakeWebSocket.instances[0];
  ws.open();
  ws.message({ type: 'helloAck', payload: { version: '1.0', heartbeatMs: 1000 } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const pingFrames = h.sentFrames.filter((frame) => frame.type === 'ping');
  assert.equal(pingFrames.length > 0, true);
  assert.deepEqual(intervalCalls, [1000]);
  assert.equal(typeof pingFrames[0].payload.clientTime, 'string');
});

test('poker ws client clamps server-provided heartbeatMs before scheduling interval', async () => {
  const intervalCalls = [];
  const clearedIntervals = [];
  const h = loadClientHarness({
    setInterval(fn, delay){
      intervalCalls.push(delay);
      return { fn, delay, unref(){} };
    },
    clearInterval(timer){
      clearedIntervals.push(timer);
    },
    clientOptions: {
      heartbeatFallbackMs: 15000,
      autoReconnect: false
    }
  });
  h.client.start();
  const ws = h.FakeWebSocket.instances[0];
  ws.open();

  ws.message({ type: 'helloAck', payload: { version: '1.0', heartbeatMs: 1 } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(intervalCalls, [1000]);
  const helloAckStatus = h.statuses.find((entry) => entry.status === 'hello_ack');
  assert.equal(!!helloAckStatus, true);
  assert.equal(helloAckStatus.data.heartbeatMs, 1000);

  ws.message({ type: 'helloAck', payload: { version: '1.0', heartbeatMs: 9999999 } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(intervalCalls, [1000, 60000]);
  assert.equal(clearedIntervals.length, 1);
});

test('poker ws client heartbeat ping does not create pending command timeouts', async () => {
  const timeoutCalls = [];
  const intervalTimers = [];
  const h = loadClientHarness({
    setTimeout(fn, delay){
      timeoutCalls.push(delay);
      return { fn, delay };
    },
    clearTimeout(){},
    setInterval(fn, delay){
      var timer = { fn, delay, unref(){} };
      intervalTimers.push(timer);
      return timer;
    },
    clearInterval(){},
    clientOptions: {
      heartbeatFallbackMs: 1000,
      autoReconnect: false
    }
  });
  h.client.start();
  const ws = h.FakeWebSocket.instances[0];
  ws.open();
  ws.message({ type: 'helloAck', payload: { version: '1.0', heartbeatMs: 1000 } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(intervalTimers.length, 1);
  intervalTimers[0].fn();
  intervalTimers[0].fn();

  const pingFrames = h.sentFrames.filter((frame) => frame.type === 'ping');
  assert.equal(pingFrames.length, 2);
  assert.equal(timeoutCalls.includes(12000), false);
  assert.equal(h.protocolErrors.length, 0);
});

test('poker ws client auto-reconnects after abnormal close and re-authenticates', async () => {
  const h = loadClientHarness({
    clientOptions: {
      reconnectBaseMs: 5,
      reconnectMaxMs: 5,
      heartbeatFallbackMs: 5
    }
  });
  h.client.start();
  const ws1 = h.FakeWebSocket.instances[0];
  ws1.open();
  ws1.message({ type: 'helloAck', payload: { version: '1.0', heartbeatMs: 5 } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  ws1.message({ type: 'authOk', payload: { roomId: 'table_test_1' } });

  ws1.close(1006, 'abnormal_close');
  await new Promise((resolve) => setTimeout(resolve, 12));

  assert.equal(h.FakeWebSocket.instances.length, 2);
  const ws2 = h.FakeWebSocket.instances[1];
  ws2.open();
  ws2.message({ type: 'helloAck', payload: { version: '1.0', heartbeatMs: 5 } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  ws2.message({ type: 'authOk', payload: { roomId: 'table_test_1' } });

  const reconnectStatus = h.statuses.find((entry) => entry.status === 'reconnecting');
  assert.equal(!!reconnectStatus, true);
  assert.equal(reconnectStatus.data.code, 1006);
  const sendTypes = h.sentFrames.map((frame) => frame.type);
  assert.equal(sendTypes.filter((type) => type === 'hello').length >= 2, true);
  assert.equal(sendTypes.filter((type) => type === 'auth').length >= 2, true);
  assert.equal(sendTypes.filter((type) => type === 'table_state_sub').length >= 2, true);
});

test('poker ws client can request an explicit gameplay snapshot over the live socket', async () => {
  const h = loadClientHarness();
  h.client.start();
  const ws = h.FakeWebSocket.instances[0];
  ws.open();
  ws.message({ type: 'helloAck', payload: { version: '1.0' } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  ws.message({ type: 'authOk', payload: { roomId: 'table_test_1' } });

  const sentBefore = h.sentFrames.length;
  const requestId = h.client.requestGameplaySnapshot();

  assert.equal(typeof requestId, 'string');
  assert.equal(h.sentFrames.length, sentBefore + 1);
  assert.equal(h.sentFrames[sentBefore].type, 'table_state_sub');
  assert.equal(h.sentFrames[sentBefore].payload.tableId, 'table_test_1');
  assert.equal(h.sentFrames[sentBefore].payload.view, 'snapshot');
});

test('poker ws client supports lobby subscription snapshots without a table id', async () => {
  const h = loadClientHarness({
    clientOptions: {
      mode: 'lobby',
      tableId: ''
    }
  });
  h.client.start();
  const ws = h.FakeWebSocket.instances[0];
  ws.open();
  ws.message({ type: 'helloAck', payload: { version: '1.0' } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  ws.message({ type: 'authOk', payload: { sessionId: 'session_lobby' } });

  assert.equal(h.sentFrames[2].type, 'lobby_subscribe');
  assert.equal(Object.prototype.hasOwnProperty.call(h.sentFrames[2], 'roomId'), false);

  ws.message({ type: 'lobby_snapshot', payload: { tables: [{ tableId: 'table_a', status: 'LOBBY', seatCount: 1, maxPlayers: 6 }] } });

  assert.equal(h.lobbySnapshots.length, 1);
  assert.equal(h.lobbySnapshots[0].kind, 'lobby_snapshot');
  assert.equal(h.lobbySnapshots[0].initial, true);
  assert.equal(h.lobbySnapshots[0].payload.tables[0].tableId, 'table_a');
});

test('poker ws client start is idempotent and avoids duplicate sockets', () => {
  const h = loadClientHarness({
    clientOptions: {
      mode: 'lobby',
      tableId: ''
    }
  });
  h.client.start();
  h.client.start();
  assert.equal(h.FakeWebSocket.instances.length, 1);
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
