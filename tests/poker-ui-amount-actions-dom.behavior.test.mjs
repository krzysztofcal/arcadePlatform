import test from 'node:test';
import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

function makeActionableResponse(legalActions){
  return {
    tableId: 'table-1',
    status: 'OPEN',
    maxPlayers: 6,
    seats: [
      { seatNo: 1, userId: 'user-1', status: 'ACTIVE', stack: 150 },
      { seatNo: 2, userId: 'bot-2', status: 'ACTIVE', stack: 150 }
    ],
    legalActions: legalActions,
    actionConstraints: {},
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
  handlers.forEach((fn) => fn({
    key: 'Enter',
    preventDefault(){},
    stopPropagation(){},
    target: input
  }));
}

function getSubmittedActionType(payload){
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.action === 'string') return payload.action;
  if (payload.action && typeof payload.action.type === 'string') return payload.action.type;
  return null;
}

function getSubmittedAmount(payload){
  if (!payload || typeof payload !== 'object') return null;
  if (Number.isFinite(Number(payload.amount))) return Number(payload.amount);
  if (payload.action && Number.isFinite(Number(payload.action.amount))) return Number(payload.action.amount);
  return null;
}

test('poker UI amount actions DOM flow supports select-first and submit-second without clearing value on harmless rerender', async () => {
  var actCalls = [];
  var snapshotHandler = null;
  var harness = createPokerTableHarness({
    responses: [makeActionableResponse(['CHECK', 'BET', 'RAISE'])],
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
        sendAct(payload, requestId){
          actCalls.push({ payload, requestId });
          return Promise.resolve({ ok: true });
        }
      };
    }
  });

  var amountInput = harness.elements.pokerActAmount;
  var focusCalls = 0;
  var selectCalls = 0;
  amountInput.focus = function(){ focusCalls += 1; };
  amountInput.select = function(){ selectCalls += 1; };

  harness.fireDomContentLoaded();
  await harness.flush();

  harness.elements.pokerActBetBtn.click();
  await harness.flush();
  assert.equal(actCalls.length, 0, 'first BET click should not submit immediately');
  assert.equal(harness.elements.pokerActAmountWrap.hidden, false, 'first BET click should reveal amount input row');
  assert.equal(amountInput.disabled, false, 'first BET click should enable amount input');
  assert.ok(focusCalls >= 1, 'first BET click should focus amount input');
  assert.ok(selectCalls >= 1, 'first BET click should select amount input text');

  amountInput.value = '23';
  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 2,
      seats: [
        { seatNo: 1, userId: 'user-1', status: 'ACTIVE' },
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }
      ],
      stacks: { 'user-1': 150, 'bot-2': 150 },
      hand: { status: 'TURN', handId: 'hand-1' },
      turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
      board: { cards: ['As', 'Kd', '3h', '2c'] },
      pot: { total: 20, sidePots: [] },
      legalActions: { actions: ['CHECK', 'BET', 'RAISE'] },
      actionConstraints: {}
    }
  });
  await harness.flush();
  assert.equal(harness.elements.pokerActAmountWrap.hidden, false, 'harmless rerender should keep amount row visible when pending BET remains legal');
  assert.equal(amountInput.disabled, false, 'harmless rerender should keep amount input editable');
  assert.equal(amountInput.value, '23', 'harmless rerender should not clear current amount value');

  harness.elements.pokerActBetBtn.click();
  await harness.flush();
  assert.equal(actCalls.length, 1, 'second BET click should submit exactly one action');
  assert.equal(actCalls[0].payload.handId, 'hand-1', 'second BET click should submit current hand id');
  assert.equal(getSubmittedActionType(actCalls[0].payload), 'BET', 'second BET click should submit BET action');
  assert.equal(getSubmittedAmount(actCalls[0].payload), 23, 'second BET click should submit entered amount');
  assert.equal(typeof actCalls[0].requestId, 'string', 'second BET click should provide request id to ws sender');
  assert.equal(harness.elements.pokerActAmountWrap.hidden, true, 'second BET click should clear amount mode immediately');
  assert.equal(amountInput.disabled, true, 'second BET click should disable amount input immediately');
  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 3,
      seats: [
        { seatNo: 1, userId: 'user-1', status: 'ACTIVE' },
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }
      ],
      stacks: { 'user-1': 150, 'bot-2': 150 },
      hand: { status: 'TURN', handId: 'hand-1' },
      turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
      board: { cards: ['As', 'Kd', '3h', '2c'] },
      pot: { total: 22, sidePots: [] },
      legalActions: { actions: ['CHECK', 'BET', 'RAISE'] },
      actionConstraints: {}
    }
  });
  await harness.flush();
  assert.equal(harness.elements.pokerActAmountWrap.hidden, true, 'successful BET submit should stay out of amount mode after rerender');

  harness.elements.pokerActRaiseBtn.click();
  await harness.flush();
  assert.equal(actCalls.length, 1, 'first RAISE click should switch pending mode without submitting');
  assert.equal(harness.elements.pokerActAmountWrap.hidden, false, 'switching BET to RAISE should keep amount mode visible');
  assert.equal(amountInput.disabled, false, 'switching BET to RAISE should keep input editable');

  amountInput.value = '31';
  fireEnterOnAmountInput(harness);
  await harness.flush();
  assert.equal(actCalls.length, 2, 'Enter key should submit selected pending RAISE exactly once');
  assert.equal(actCalls[1].payload.handId, 'hand-1', 'Enter key should submit current hand id for RAISE');
  assert.equal(getSubmittedActionType(actCalls[1].payload), 'RAISE', 'Enter key should submit RAISE after selecting it');
  assert.equal(getSubmittedAmount(actCalls[1].payload), 31, 'Enter key should use entered RAISE amount');
  assert.equal(typeof actCalls[1].requestId, 'string', 'Enter key submit should provide request id to ws sender');
  assert.equal(harness.elements.pokerActAmountWrap.hidden, true, 'Enter submit should clear amount mode immediately');
  assert.equal(amountInput.disabled, true, 'Enter submit should disable amount input immediately');
  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 4,
      seats: [
        { seatNo: 1, userId: 'user-1', status: 'ACTIVE' },
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }
      ],
      stacks: { 'user-1': 150, 'bot-2': 150 },
      hand: { status: 'TURN', handId: 'hand-1' },
      turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
      board: { cards: ['As', 'Kd', '3h', '2c'] },
      pot: { total: 24, sidePots: [] },
      legalActions: { actions: ['CHECK', 'BET', 'RAISE'] },
      actionConstraints: {}
    }
  });
  await harness.flush();
  assert.equal(harness.elements.pokerActAmountWrap.hidden, true, 'successful RAISE submit should stay out of amount mode after rerender');
});

test('poker UI CHECK remains one-click submit in DOM flow', async () => {
  var actCalls = [];
  var harness = createPokerTableHarness({
    responses: [makeActionableResponse(['CHECK'])],
    wsFactory(createOptions){
      return {
        start(){
          Promise.resolve().then(function(){
            if (typeof createOptions.onStatus === 'function') createOptions.onStatus('auth_ok', { roomId: 'table-1' });
          });
        },
        destroy(){},
        isReady(){ return true; },
        sendAct(payload){
          actCalls.push({ payload });
          return Promise.resolve({ ok: true });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();
  harness.elements.pokerActCheckBtn.click();
  await harness.flush();

  assert.equal(actCalls.length, 1, 'CHECK should submit immediately on first click');
  assert.equal(getSubmittedActionType(actCalls[0].payload), 'CHECK', 'CHECK should submit CHECK action');
  assert.equal(harness.elements.pokerActAmountWrap.hidden, true, 'CHECK click should not enter amount mode');
});

test('poker UI clears pending BET mode when switching to CHECK submit', async () => {
  var actCalls = [];
  var harness = createPokerTableHarness({
    responses: [makeActionableResponse(['CHECK', 'BET', 'RAISE'])],
    wsFactory(createOptions){
      return {
        start(){
          Promise.resolve().then(function(){
            if (typeof createOptions.onStatus === 'function') createOptions.onStatus('auth_ok', { roomId: 'table-1' });
          });
        },
        destroy(){},
        isReady(){ return true; },
        sendAct(payload){
          actCalls.push({ payload });
          return Promise.resolve({ ok: true });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();
  harness.elements.pokerActBetBtn.click();
  await harness.flush();
  harness.elements.pokerActAmount.value = '22';
  harness.elements.pokerActCheckBtn.click();
  await harness.flush();

  assert.equal(actCalls.length, 1, 'CHECK click from pending BET mode should submit exactly once');
  assert.equal(getSubmittedActionType(actCalls[0].payload), 'CHECK', 'CHECK click from pending BET mode should submit CHECK');
  assert.equal(harness.elements.pokerActAmountWrap.hidden, true, 'CHECK click from pending BET mode should hide amount row');
  assert.equal(harness.elements.pokerActAmount.disabled, true, 'CHECK click from pending BET mode should disable amount input');
});

test('poker UI clears pending RAISE mode when switching to FOLD submit', async () => {
  var actCalls = [];
  var harness = createPokerTableHarness({
    responses: [makeActionableResponse(['CALL', 'RAISE', 'FOLD'])],
    wsFactory(createOptions){
      return {
        start(){
          Promise.resolve().then(function(){
            if (typeof createOptions.onStatus === 'function') createOptions.onStatus('auth_ok', { roomId: 'table-1' });
          });
        },
        destroy(){},
        isReady(){ return true; },
        sendAct(payload){
          actCalls.push({ payload });
          return Promise.resolve({ ok: true });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();
  harness.elements.pokerActRaiseBtn.click();
  await harness.flush();
  harness.elements.pokerActAmount.value = '30';
  harness.elements.pokerActFoldBtn.click();
  await harness.flush();

  assert.equal(actCalls.length, 1, 'FOLD click from pending RAISE mode should submit exactly once');
  assert.equal(getSubmittedActionType(actCalls[0].payload), 'FOLD', 'FOLD click from pending RAISE mode should submit FOLD');
  assert.equal(harness.elements.pokerActAmountWrap.hidden, true, 'FOLD click from pending RAISE mode should hide amount row');
  assert.equal(harness.elements.pokerActAmount.disabled, true, 'FOLD click from pending RAISE mode should disable amount input');
});

test('poker UI clears pending amount mode when pending action becomes illegal on rerender', async () => {
  var snapshotHandler = null;
  var harness = createPokerTableHarness({
    responses: [makeActionableResponse(['CHECK', 'BET'])],
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
        sendAct(){ return Promise.resolve({ ok: true }); }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();
  harness.elements.pokerActBetBtn.click();
  await harness.flush();
  harness.elements.pokerActAmount.value = '29';
  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 3,
      seats: [
        { seatNo: 1, userId: 'user-1', status: 'ACTIVE' },
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }
      ],
      stacks: { 'user-1': 150, 'bot-2': 150 },
      hand: { status: 'TURN', handId: 'hand-1' },
      turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
      board: { cards: ['As', 'Kd', '3h', '2c'] },
      pot: { total: 20, sidePots: [] },
      legalActions: { actions: ['CHECK'] },
      actionConstraints: {}
    }
  });
  await harness.flush();

  assert.equal(harness.elements.pokerActAmountWrap.hidden, true, 'illegal pending action rerender should hide amount row');
  assert.equal(harness.elements.pokerActAmount.disabled, true, 'illegal pending action rerender should disable amount input');
  assert.equal(harness.elements.pokerActAmount.value, '', 'illegal pending action rerender should clear stale amount value');
});

test('poker UI restores BET amount mode and value after failed BET submit', async () => {
  var actCalls = [];
  var harness = createPokerTableHarness({
    responses: [makeActionableResponse(['CHECK', 'BET'])],
    wsFactory(createOptions){
      return {
        start(){
          Promise.resolve().then(function(){
            if (typeof createOptions.onStatus === 'function') createOptions.onStatus('auth_ok', { roomId: 'table-1' });
          });
        },
        destroy(){},
        isReady(){ return true; },
        sendAct(payload){
          actCalls.push({ payload });
          return Promise.reject(new Error('send_failed'));
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();
  harness.elements.pokerActBetBtn.click();
  await harness.flush();
  harness.elements.pokerActAmount.value = '27';
  harness.elements.pokerActBetBtn.click();
  await harness.flush();

  assert.equal(actCalls.length, 1, 'failed BET submit should still attempt one submit');
  assert.equal(getSubmittedActionType(actCalls[0].payload), 'BET', 'failed BET submit should send BET action');
  assert.equal(harness.elements.pokerActAmountWrap.hidden, false, 'failed BET submit should restore amount mode');
  assert.equal(harness.elements.pokerActAmount.disabled, false, 'failed BET submit should restore editable amount input');
  assert.equal(harness.elements.pokerActAmount.value, '27', 'failed BET submit should preserve typed amount');
  assert.equal(typeof harness.elements.pokerActStatus.textContent, 'string', 'failed BET submit should set an error status');
});

test('poker UI restores RAISE amount mode and value after failed Enter submit', async () => {
  var actCalls = [];
  var harness = createPokerTableHarness({
    responses: [makeActionableResponse(['CALL', 'RAISE', 'FOLD'])],
    wsFactory(createOptions){
      return {
        start(){
          Promise.resolve().then(function(){
            if (typeof createOptions.onStatus === 'function') createOptions.onStatus('auth_ok', { roomId: 'table-1' });
          });
        },
        destroy(){},
        isReady(){ return true; },
        sendAct(payload){
          actCalls.push({ payload });
          return Promise.reject(new Error('send_failed'));
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();
  harness.elements.pokerActRaiseBtn.click();
  await harness.flush();
  harness.elements.pokerActAmount.value = '33';
  fireEnterOnAmountInput(harness);
  await harness.flush();

  assert.equal(actCalls.length, 1, 'failed RAISE Enter submit should still attempt one submit');
  assert.equal(getSubmittedActionType(actCalls[0].payload), 'RAISE', 'failed RAISE Enter submit should send RAISE action');
  assert.equal(harness.elements.pokerActAmountWrap.hidden, false, 'failed RAISE submit should restore amount mode');
  assert.equal(harness.elements.pokerActAmount.disabled, false, 'failed RAISE submit should restore editable amount input');
  assert.equal(harness.elements.pokerActAmount.value, '33', 'failed RAISE submit should preserve typed amount');
  assert.equal(typeof harness.elements.pokerActStatus.textContent, 'string', 'failed RAISE submit should set an error status');
});
