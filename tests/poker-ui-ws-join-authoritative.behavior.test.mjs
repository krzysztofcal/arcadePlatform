import test from 'node:test';
import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

async function flushUntil(harness, predicate, maxCycles){
  var cycles = Number.isInteger(maxCycles) && maxCycles > 0 ? maxCycles : 12;
  for (var i = 0; i < cycles; i++){
    await harness.flush();
    if (predicate()) return true;
  }
  return predicate();
}

test('poker UI join sends WS join payload with seatNo + buyIn semantics', async () => {
  const sent = [];
  const harness = createPokerTableHarness({
    wsFactory(createOptions){
      return {
        start(){},
        destroy(){},
        isReady(){ return true; },
        sendJoin(payload, requestId){
          sent.push({ payload, requestId, tableId: createOptions.tableId });
          return Promise.resolve({ ok: true });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();

  harness.elements.pokerSeatNo.value = '4';
  harness.elements.pokerBuyIn.value = '220';
  harness.elements.pokerJoin.click();
  await harness.flush();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.tableId, 'table-1');
  assert.equal(sent[0].payload.seatNo, 4);
  assert.equal(sent[0].payload.buyIn, 220);
  assert.equal(harness.fetchState.joinCalls, 0);
});

test('poker UI explicit join never sends seatNo 0', async () => {
  const sent = [];
  const harness = createPokerTableHarness({
    wsFactory(){
      return {
        start(){},
        destroy(){},
        isReady(){ return true; },
        sendJoin(payload){
          sent.push(payload);
          return Promise.resolve({ ok: true });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();

  harness.elements.pokerSeatNo.value = '0';
  harness.elements.pokerJoin.click();
  await harness.flush();

  assert.equal(sent.length, 1);
  assert.notEqual(sent[0].seatNo, 0);
});

test('poker UI explicit seat has parity between WS-ready and HTTP fallback payloads', async () => {
  const wsSent = [];
  const wsHarness = createPokerTableHarness({
    wsFactory(){
      return {
        start(){},
        destroy(){},
        isReady(){ return true; },
        sendJoin(payload){
          wsSent.push(payload);
          return Promise.resolve({ ok: true });
        }
      };
    }
  });
  wsHarness.fireDomContentLoaded();
  await wsHarness.flush();
  wsHarness.elements.pokerSeatNo.value = '4';
  wsHarness.elements.pokerJoin.click();
  await wsHarness.flush();

  const httpHarness = createPokerTableHarness({ disableWsClient: true });
  httpHarness.fireDomContentLoaded();
  await httpHarness.flush();
  httpHarness.elements.pokerSeatNo.value = '4';
  httpHarness.elements.pokerJoin.click();
  await httpHarness.flush();

  assert.equal(wsSent.length, 1);
  assert.equal(httpHarness.fetchState.joinBodies.length, 1);
  assert.equal(wsSent[0].seatNo, 4);
  assert.equal(httpHarness.fetchState.joinBodies[0].seatNo, 4);
});

test('poker UI autoJoin sends join payload with autoSeat + preferredSeatNo semantics after baseline startup ordering', async () => {
  const sent = [];
  const harness = createPokerTableHarness({
    search: '?tableId=table-1&autoJoin=1&seatNo=2',
    wsFactory(createOptions){
      return {
        start(){
          Promise.resolve().then(function(){
            if (typeof createOptions.onStatus === 'function') createOptions.onStatus('auth_ok', { roomId: 'table-1' });
          });
        },
        destroy(){},
        isReady(){ return true; },
        sendJoin(payload, requestId){
          sent.push({ payload, requestId });
          return Promise.resolve({ ok: true });
        }
      };
    }
  });

  harness.elements.pokerBuyIn.value = '300';
  harness.fireDomContentLoaded();
  const joined = await flushUntil(harness, function(){ return sent.length > 0 || harness.fetchState.joinBodies.length > 0; });

  assert.equal(joined, true, 'auto-join should emit a join payload once baseline startup completes');
  const baselineDoneIndex = harness.timeline.findIndex((entry) => entry.kind === 'load_table_fetch_done');
  assert.ok(baselineDoneIndex >= 0, 'baseline fetch completion should be observable');
  assert.equal(sent.length >= 1, true, 'ws-ready auto-join must send WS join payload');
  assert.equal(harness.fetchState.joinCalls, 0, 'ws-ready auto-join must not use HTTP join fallback');
  assert.equal(harness.fetchState.joinBodies.length, 0, 'ws-ready auto-join must not emit HTTP join body');
  const payload = sent[0].payload;
  assert.equal(payload.autoSeat, true);
  assert.equal(payload.preferredSeatNo, 2);
  assert.equal(payload.buyIn, 300);
});

test('poker UI autoJoin preferred seat has parity between authenticated startup and HTTP fallback payloads', async () => {
  const wsSent = [];
  const wsHarness = createPokerTableHarness({
    search: '?tableId=table-1&autoJoin=1&seatNo=3',
    wsFactory(createOptions){
      return {
        start(){
          Promise.resolve().then(function(){
            if (typeof createOptions.onStatus === 'function') createOptions.onStatus('auth_ok', { roomId: 'table-1' });
          });
        },
        destroy(){},
        isReady(){ return true; },
        sendJoin(payload){
          wsSent.push(payload);
          return Promise.resolve({ ok: true });
        }
      };
    }
  });
  wsHarness.fireDomContentLoaded();
  const wsJoined = await flushUntil(wsHarness, function(){ return wsSent.length > 0 || wsHarness.fetchState.joinBodies.length > 0; });

  const httpHarness = createPokerTableHarness({
    search: '?tableId=table-1&autoJoin=1&seatNo=3',
    disableWsClient: true
  });
  httpHarness.fireDomContentLoaded();
  const httpJoined = await flushUntil(httpHarness, function(){ return httpHarness.fetchState.joinBodies.length > 0; });

  assert.equal(wsJoined, true, 'authenticated startup auto-join should emit a join payload');
  assert.equal(httpJoined, true, 'http fallback auto-join should emit a join payload');
  assert.equal(wsSent.length >= 1, true, 'ws-ready auto-join must produce WS payload');
  assert.equal(wsHarness.fetchState.joinCalls, 0, 'ws-ready auto-join must not call HTTP join');
  assert.equal(wsHarness.fetchState.joinBodies.length, 0, 'ws-ready auto-join must not produce HTTP join body');
  const startupPayload = wsSent[0];
  assert.equal(startupPayload.autoSeat, true);
  assert.equal(httpHarness.fetchState.joinBodies[0].autoSeat, true);
  assert.equal(startupPayload.preferredSeatNo, 3);
  assert.equal(httpHarness.fetchState.joinBodies[0].preferredSeatNo, 3);
});

test('poker UI does not autoJoin before WS readiness and then joins via WS on auth_ok', async () => {
  const wsSent = [];
  let wsReady = false;
  let emitStatus = null;
  const harness = createPokerTableHarness({
    search: '?tableId=table-1&autoJoin=1&seatNo=4',
    wsFactory(createOptions){
      emitStatus = createOptions.onStatus;
      return {
        start(){},
        destroy(){},
        isReady(){ return wsReady; },
        sendJoin(payload){
          wsSent.push(payload);
          return Promise.resolve({ ok: true });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await flushUntil(harness, function(){ return harness.fetchState.getCalls >= 1 && harness.wsCreates.length >= 1; });
  assert.equal(wsSent.length, 0, 'baseline load with ws not-ready must not auto-join');
  assert.equal(harness.fetchState.joinBodies.length, 0, 'ws-configured startup must not fallback to http before ws readiness');

  wsReady = true;
  emitStatus('auth_ok', { roomId: 'table-1' });
  const joined = await flushUntil(harness, function(){ return wsSent.length > 0 || harness.fetchState.joinBodies.length > 0; });

  assert.equal(joined, true, 'join should occur after ws readiness signal');
  assert.equal(wsSent.length >= 1, true, 'ws readiness should trigger ws join payload');
  assert.equal(harness.fetchState.joinCalls, 0, 'ws-ready auto-join must not call http join');
  assert.equal(harness.fetchState.joinBodies.length, 0, 'ws-ready auto-join must not emit http join body');
});

test('poker UI protocol-error fallback activates HTTP autoJoin when WS stays not-ready', async () => {
  const wsSent = [];
  let wsHooks = null;
  const harness = createPokerTableHarness({
    search: '?tableId=table-1&autoJoin=1&seatNo=5',
    wsFactory(createOptions){
      wsHooks = createOptions;
      return {
        start(){},
        destroy(){},
        isReady(){ return false; },
        sendJoin(payload){
          wsSent.push(payload);
          return Promise.resolve({ ok: true });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  var started = await flushUntil(harness, function(){
    return harness.fetchState.getCalls >= 1 && !!wsHooks && harness.logs.some(function(entry){ return entry.kind === 'poker_ws_bootstrap_start'; });
  }, 30);
  assert.equal(started, true, 'startup should reach baseline-loaded + ws-created state before fallback test assertions');
  assert.equal(wsSent.length, 0, 'pre-fallback ws-not-ready startup must not auto-join via ws');
  assert.equal(harness.fetchState.joinBodies.length, 0, 'pre-fallback ws-not-ready startup must not auto-join via http');

  wsHooks.onProtocolError({ code: 'socket_error', detail: 'forced_test_fallback' });
  const joined = await flushUntil(harness, function(){ return harness.fetchState.joinBodies.length > 0 || wsSent.length > 0; });

  assert.equal(joined, true, 'fallback load should eventually emit auto-join payload');
  assert.equal(wsSent.length, 0, 'protocol-error fallback path should not emit ws join payload');
  assert.equal(harness.fetchState.joinBodies.length >= 1, true, 'protocol-error fallback path should emit http join body');
  assert.equal(harness.fetchState.joinBodies[0].autoSeat, true);
  assert.equal(harness.fetchState.joinBodies[0].preferredSeatNo, 5);
});


test('poker UI keeps join failed state on rejected WS join and does not fallback to HTTP join', async () => {
  const harness = createPokerTableHarness({
    wsFactory(){
      return {
        start(){},
        destroy(){},
        isReady(){ return true; },
        sendJoin(){
          const err = new Error('invalid_buy_in');
          err.code = 'invalid_buy_in';
          return Promise.reject(err);
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();
  harness.elements.pokerSeatNo.value = '1';
  harness.elements.pokerBuyIn.value = '50';
  harness.elements.pokerJoin.click();
  await harness.flush();

  assert.equal(harness.fetchState.joinCalls, 0);
  assert.equal(typeof harness.elements.pokerError.textContent, 'string');
  assert.equal(harness.elements.pokerError.textContent.length > 0, true);
});

test('poker UI uses WS join result payload fields when present', async () => {
  const harness = createPokerTableHarness({
    wsFactory(){
      return {
        start(){},
        destroy(){},
        isReady(){ return true; },
        sendJoin(){
          return Promise.resolve({ ok: true, seatNo: 5 });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();

  harness.elements.pokerSeatNo.value = '2';
  harness.elements.pokerJoin.click();
  await harness.flush();

  assert.equal(harness.elements.pokerSeatNo.value, '5');
  assert.equal(harness.fetchState.joinCalls, 0);
});

test('poker UI auto-seat accepted result keeps 1-based seat value', async () => {
  const harness = createPokerTableHarness({
    wsFactory(){
      return {
        start(){},
        destroy(){},
        isReady(){ return true; },
        sendJoin(){
          return Promise.resolve({ ok: true, seatNo: 2 });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();

  harness.elements.pokerSeatNo.value = '1';
  harness.elements.pokerJoin.click();
  await harness.flush();

  assert.equal(harness.elements.pokerSeatNo.value, '2');
});

test('poker UI accepts same-version authoritative reconnect snapshot for joined seat state without HTTP fallback', async () => {
  let snapshotHandler = null;
  const harness = createPokerTableHarness({
    responses: [
      {
        tableId: 'table-1',
        status: 'OPEN',
        maxPlayers: 6,
        seats: [
          { seatNo: 0, userId: null, status: 'EMPTY', stack: 100 },
          { seatNo: 1, userId: null, status: 'EMPTY', stack: 100 }
        ],
        legalActions: [],
        actionConstraints: {},
        state: { version: 1, state: { phase: 'PREFLOP', pot: 10, community: [] } },
      }
    ],
    wsFactory(createOptions){
      snapshotHandler = createOptions.onSnapshot;
      return {
        start(){
          Promise.resolve().then(function(){
            if (typeof createOptions.onStatus === 'function') createOptions.onStatus('auth_ok', { roomId: 'table-1' });
          });
        },
        destroy(){},
        isReady(){ return true; },
        sendJoin(){
          return Promise.resolve({ ok: true });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await flushUntil(harness, function(){ return typeof snapshotHandler === 'function' && harness.fetchState.getCalls >= 1; });

  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      youSeat: 1,
      authoritativeMembers: [{ userId: 'user-1', seat: 1 }],
      hand: { status: 'PREFLOP' }
    }
  });
  await harness.flush();

  assert.equal(String(harness.elements.pokerVersion.textContent), '1');
  assert.equal(harness.elements.pokerYourStack.textContent, '0');
  assert.equal(harness.fetchState.joinCalls, 0, 'healthy ws reconnect snapshot must not trigger HTTP join fallback');
  assert.equal(harness.logs.some((entry) => entry.kind === 'poker_http_fallback_start'), false, 'healthy ws reconnect snapshot must not activate fallback');
  assert.equal(harness.logs.some((entry) => entry.kind === 'poker_ws_snapshot_ignored' && entry.data && entry.data.incomingStateVersion === 1 && entry.data.currentStateVersion === 1), false, 'material same-version reconnect snapshot must not be ignored as stale');
});
