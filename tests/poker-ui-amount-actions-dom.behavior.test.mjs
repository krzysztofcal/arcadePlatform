import test from 'node:test';
import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

function makeActionableResponse(legalActions, constraints){
  return {
    tableId: 'table-1',
    status: 'OPEN',
    maxPlayers: 6,
    seats: [
      { seatNo: 1, userId: 'user-1', status: 'ACTIVE', stack: 150 },
      { seatNo: 2, userId: 'bot-2', status: 'ACTIVE', stack: 150 }
    ],
    legalActions,
    actionConstraints: constraints || {},
    state: {
      version: 1,
      state: {
        phase: 'TURN',
        pot: 15,
        community: [],
        stacks: { 'user-1': 150, 'bot-2': 150 },
        turnUserId: 'user-1',
        handId: 'hand-1'
      }
    }
  };
}

function fireEnterOnAmountInput(harness){
  const input = harness.elements.pokerActAmount;
  const handlers = input._listeners.keydown || [];
  handlers.forEach((fn) => fn({ key: 'Enter', preventDefault(){}, stopPropagation(){}, target: input }));
}

function actionOf(call){ return call && call.payload ? call.payload.action : null; }

function trackAmountAttributes(harness){
  const input = harness.elements.pokerActAmount;
  const attrs = {};
  input.setAttribute = function(name, value){ attrs[name] = String(value); };
  input.removeAttribute = function(name){ delete attrs[name]; };
  return attrs;
}

test('BET is one-click submit with immediate amount row', async () => {
  const actCalls = [];
  let snapshotHandler = null;
  const harness = createPokerTableHarness({
    responses: [makeActionableResponse(['CHECK', 'BET'], { maxBetAmount: 100, toCall: 0 })],
    wsFactory(createOptions){
      snapshotHandler = createOptions.onSnapshot;
      return {
        start(){ Promise.resolve().then(() => createOptions.onStatus && createOptions.onStatus('auth_ok', { roomId: 'table-1' })); },
        destroy(){},
        isReady(){ return true; },
        sendAct(payload, requestId){ actCalls.push({ payload, requestId }); return Promise.resolve({ ok: true }); }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();

  assert.equal(harness.elements.pokerActAmountWrap.hidden, false);
  assert.equal(harness.elements.pokerActAmount.value, '20');
  harness.elements.pokerActAmount.value = '23';

  snapshotHandler({ kind: 'table_state', payload: {
    tableId: 'table-1', stateVersion: 2,
    seats: [{ seatNo: 1, userId: 'user-1', status: 'ACTIVE' }, { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }],
    stacks: { 'user-1': 150, 'bot-2': 150 },
    hand: { status: 'TURN', handId: 'hand-1' },
    turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
    board: { cards: ['As', 'Kd', '3h', '2c'] },
    pot: { total: 20, sidePots: [] },
    legalActions: { actions: ['CHECK', 'BET'] },
    actionConstraints: { maxBetAmount: 100, toCall: 0 }
  }});
  await harness.flush();
  assert.equal(harness.elements.pokerActAmount.value, '23', 'harmless rerender should preserve valid typed amount');

  harness.elements.pokerActBetBtn.click();
  await harness.flush();

  assert.equal(actCalls.length, 1, 'BET should submit in one click');
  assert.equal(actionOf(actCalls[0]), 'BET');
  assert.equal(actCalls[0].payload.amount, 23);
});

test('RAISE is one-click submit and Enter submits once', async () => {
  const actCalls = [];
  const harness = createPokerTableHarness({
    responses: [makeActionableResponse(['CALL', 'RAISE', 'FOLD'], { minRaiseTo: 12, maxRaiseTo: 30, toCall: 5 })],
    wsFactory(createOptions){
      return {
        start(){ Promise.resolve().then(() => createOptions.onStatus && createOptions.onStatus('auth_ok', { roomId: 'table-1' })); },
        destroy(){},
        isReady(){ return true; },
        sendAct(payload, requestId){ actCalls.push({ payload, requestId }); return Promise.resolve({ ok: true }); }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();
  assert.equal(harness.elements.pokerActAmountWrap.hidden, false);
  assert.equal(Number(harness.elements.pokerActAmount.value) >= 12, true);

  harness.elements.pokerActAmount.value = '17';
  harness.elements.pokerActRaiseBtn.click();
  await harness.flush();
  assert.equal(actCalls.length, 1);
  assert.equal(actionOf(actCalls[0]), 'RAISE');
  assert.equal(actCalls[0].payload.amount, 17);

  harness.elements.pokerActAmount.value = '18';
  fireEnterOnAmountInput(harness);
  await harness.flush();
  assert.equal(actCalls.length, 2, 'Enter should submit exactly one additional act');
  assert.equal(actionOf(actCalls[1]), 'RAISE');
  assert.equal(actCalls[1].payload.amount, 18);
});

test('amount row hides immediately when amount actions become illegal on rerender', async () => {
  let snapshotHandler = null;
  const harness = createPokerTableHarness({
    responses: [makeActionableResponse(['CHECK', 'BET'], { maxBetAmount: 80, toCall: 0 })],
    wsFactory(createOptions){
      snapshotHandler = createOptions.onSnapshot;
      return {
        start(){ Promise.resolve().then(() => createOptions.onStatus && createOptions.onStatus('auth_ok', { roomId: 'table-1' })); },
        destroy(){},
        isReady(){ return true; },
        sendAct(){ return Promise.resolve({ ok: true }); }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();
  assert.equal(harness.elements.pokerActAmountWrap.hidden, false);

  snapshotHandler({ kind: 'table_state', payload: {
    tableId: 'table-1', stateVersion: 2,
    seats: [{ seatNo: 1, userId: 'user-1', status: 'ACTIVE' }, { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }],
    stacks: { 'user-1': 150, 'bot-2': 150 },
    hand: { status: 'TURN', handId: 'hand-1' },
    turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
    board: { cards: ['As', 'Kd', '3h', '2c'] },
    pot: { total: 20, sidePots: [] },
    legalActions: { actions: ['CHECK'] },
    actionConstraints: { toCall: 0 }
  }});
  await harness.flush();

  assert.equal(harness.elements.pokerActAmountWrap.hidden, true);
  assert.equal(harness.elements.pokerActAmount.disabled, true);
});

test('Enter does not guess action when BET and RAISE are both legal', async () => {
  const actCalls = [];
  const harness = createPokerTableHarness({
    responses: [makeActionableResponse(['CHECK', 'BET', 'RAISE'], { maxBetAmount: 100, minRaiseTo: 12, maxRaiseTo: 40, toCall: 0 })],
    wsFactory(createOptions){
      return {
        start(){ Promise.resolve().then(() => createOptions.onStatus && createOptions.onStatus('auth_ok', { roomId: 'table-1' })); },
        destroy(){},
        isReady(){ return true; },
        sendAct(payload, requestId){ actCalls.push({ payload, requestId }); return Promise.resolve({ ok: true }); }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();
  harness.elements.pokerActAmount.value = '19';
  fireEnterOnAmountInput(harness);
  await harness.flush();
  assert.equal(actCalls.length, 0, 'Enter should not auto-choose BET/RAISE when both are legal');

  harness.elements.pokerActBetBtn.click();
  await harness.flush();
  assert.equal(actCalls.length, 1);
  assert.equal(actionOf(actCalls[0]), 'BET');
  assert.equal(actCalls[0].payload.amount, 19);
});

test('both-legal selection updates textbox min/max to selected action constraints', async () => {
  const harnessBet = createPokerTableHarness({
    responses: [makeActionableResponse(['CHECK', 'BET', 'RAISE'], { maxBetAmount: 100, minRaiseTo: 12, maxRaiseTo: 40, toCall: 0 })],
    wsFactory(createOptions){
      return {
        start(){ Promise.resolve().then(() => createOptions.onStatus && createOptions.onStatus('auth_ok', { roomId: 'table-1' })); },
        destroy(){},
        isReady(){ return true; },
        sendAct(){ return new Promise(() => {}); }
      };
    }
  });
  const betAttrs = trackAmountAttributes(harnessBet);
  harnessBet.fireDomContentLoaded();
  await harnessBet.flush();
  harnessBet.elements.pokerActBetBtn.click();
  await harnessBet.flush();
  assert.equal(betAttrs.min, '1');
  assert.equal(betAttrs.max, '100');

  const harnessRaise = createPokerTableHarness({
    responses: [makeActionableResponse(['CHECK', 'BET', 'RAISE'], { maxBetAmount: 100, minRaiseTo: 12, maxRaiseTo: 40, toCall: 0 })],
    wsFactory(createOptions){
      return {
        start(){ Promise.resolve().then(() => createOptions.onStatus && createOptions.onStatus('auth_ok', { roomId: 'table-1' })); },
        destroy(){},
        isReady(){ return true; },
        sendAct(){ return new Promise(() => {}); }
      };
    }
  });
  const raiseAttrs = trackAmountAttributes(harnessRaise);
  harnessRaise.fireDomContentLoaded();
  await harnessRaise.flush();
  harnessRaise.elements.pokerActRaiseBtn.click();
  await harnessRaise.flush();
  assert.equal(raiseAttrs.min, '12');
  assert.equal(raiseAttrs.max, '40');
});

test('first-click RAISE applies selected constraints before submit when both are legal', async () => {
  const actCalls = [];
  const harness = createPokerTableHarness({
    responses: [makeActionableResponse(['CHECK', 'BET', 'RAISE'], { maxBetAmount: 100, minRaiseTo: 30, maxRaiseTo: 60, toCall: 0 })],
    wsFactory(createOptions){
      return {
        start(){ Promise.resolve().then(() => createOptions.onStatus && createOptions.onStatus('auth_ok', { roomId: 'table-1' })); },
        destroy(){},
        isReady(){ return true; },
        sendAct(payload, requestId){ actCalls.push({ payload, requestId }); return Promise.resolve({ ok: true }); }
      };
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();
  harness.elements.pokerActAmount.value = '20';
  harness.elements.pokerActRaiseBtn.click();
  await harness.flush();
  assert.equal(actCalls.length, 1);
  assert.equal(actionOf(actCalls[0]), 'RAISE');
  assert.equal(actCalls[0].payload.amount >= 30 && actCalls[0].payload.amount <= 60, true, 'first-click RAISE should not submit stale neutral amount');
});

test('first-click BET applies selected constraints before submit when both are legal', async () => {
  const actCalls = [];
  const harness = createPokerTableHarness({
    responses: [makeActionableResponse(['CHECK', 'BET', 'RAISE'], { maxBetAmount: 25, minRaiseTo: 40, maxRaiseTo: 80, toCall: 0 })],
    wsFactory(createOptions){
      return {
        start(){ Promise.resolve().then(() => createOptions.onStatus && createOptions.onStatus('auth_ok', { roomId: 'table-1' })); },
        destroy(){},
        isReady(){ return true; },
        sendAct(payload, requestId){ actCalls.push({ payload, requestId }); return Promise.resolve({ ok: true }); }
      };
    }
  });
  harness.fireDomContentLoaded();
  await harness.flush();
  harness.elements.pokerActAmount.value = '50';
  harness.elements.pokerActBetBtn.click();
  await harness.flush();
  assert.equal(actCalls.length, 1);
  assert.equal(actionOf(actCalls[0]), 'BET');
  assert.equal(actCalls[0].payload.amount >= 1 && actCalls[0].payload.amount <= 25, true, 'first-click BET should not submit stale neutral amount');
});

test('stale BET/RAISE selection is cleared for a new both-legal decision cycle', async () => {
  const actCalls = [];
  let snapshotHandler = null;
  const harness = createPokerTableHarness({
    responses: [makeActionableResponse(['CHECK', 'BET', 'RAISE'], { maxBetAmount: 100, minRaiseTo: 12, maxRaiseTo: 40, toCall: 0 })],
    wsFactory(createOptions){
      snapshotHandler = createOptions.onSnapshot;
      return {
        start(){ Promise.resolve().then(() => createOptions.onStatus && createOptions.onStatus('auth_ok', { roomId: 'table-1' })); },
        destroy(){},
        isReady(){ return true; },
        sendAct(payload, requestId){ actCalls.push({ payload, requestId }); return Promise.resolve({ ok: true }); }
      };
    }
  });
  const attrs = trackAmountAttributes(harness);

  harness.fireDomContentLoaded();
  await harness.flush();
  harness.elements.pokerActAmount.value = '21';
  harness.elements.pokerActBetBtn.click();
  await harness.flush();
  assert.equal(actCalls.length, 1);
  assert.equal(actionOf(actCalls[0]), 'BET');

  snapshotHandler({ kind: 'table_state', payload: {
    tableId: 'table-1', stateVersion: 3,
    seats: [{ seatNo: 1, userId: 'user-1', status: 'ACTIVE' }, { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }],
    stacks: { 'user-1': 150, 'bot-2': 150 },
    hand: { status: 'TURN', handId: 'hand-1' },
    turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
    board: { cards: ['As', 'Kd', '3h', '2c'] },
    pot: { total: 27, sidePots: [] },
    legalActions: { actions: ['CHECK', 'BET', 'RAISE'] },
    actionConstraints: { maxBetAmount: 80, minRaiseTo: 16, maxRaiseTo: 50, toCall: 0 }
  }});
  await harness.flush();
  assert.equal(attrs.min, '1', 'after decision-cycle reset, neutral both-legal model should set shared minimum');
  assert.equal(Object.prototype.hasOwnProperty.call(attrs, 'max'), false, 'after decision-cycle reset, neutral both-legal model should clear stale selected max');

  harness.elements.pokerActAmount.value = '22';
  fireEnterOnAmountInput(harness);
  await harness.flush();
  assert.equal(actCalls.length, 1, 'Enter should not reuse stale prior BET selection after decision-cycle rerender');
  assert.match(String(harness.elements.pokerActStatus.textContent || ''), /Choose BET or RAISE/i);
});
