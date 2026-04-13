import test from 'node:test';
import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

function seatCardFor(seatsGrid, seatNo){
  if (!seatsGrid || !Array.isArray(seatsGrid.children)) return null;
  var index = Number(seatNo);
  if (!Number.isInteger(index) || index < 0) return null;
  return seatsGrid.children[index] || null;
}

function confirmLeave(harness){
  harness.elements.pokerLeave.click();
  harness.elements.pokerLeaveConfirmYes.click();
}

test('poker UI WS smoke sends leave over WS and waits for the live snapshot without forcing an HTTP reload', async () => {
  var leavePayloads = [];
  var snapshotHandler = null;
  var harness = createPokerTableHarness({
    responses: [
      {
        tableId: 'table-1',
        status: 'OPEN',
        maxPlayers: 6,
        seats: [
          { seatNo: 1, userId: 'user-1', status: 'ACTIVE', stack: 150 },
          { seatNo: 2, userId: 'bot-2', status: 'ACTIVE', stack: 150 }
        ],
        legalActions: [],
        actionConstraints: {},
        state: {
          version: 1,
          state: {
            phase: 'PREFLOP',
            pot: 15,
            community: [],
            stacks: { 'user-1': 150, 'bot-2': 150 },
            turnUserId: 'user-1',
            handId: 'hand-1'
          }
        }
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
        sendLeave(payload){
          leavePayloads.push(payload);
          return Promise.resolve({ ok: true });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();
  var getCallsBeforeLeave = harness.fetchState.getCalls;

  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      seats: [
        { seatNo: 1, userId: 'user-1', status: 'ACTIVE' },
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }
      ],
      stacks: { 'user-1': 150, 'bot-2': 150 },
      authoritativeMembers: [
        { userId: 'user-1', seat: 1 },
        { userId: 'bot-2', seat: 2 }
      ],
      hand: { status: 'PREFLOP', handId: 'hand-1' },
      turn: { userId: 'user-1' },
      legalActions: { actions: ['FOLD', 'CALL'] }
    }
  });
  await harness.flush();

  confirmLeave(harness);
  await harness.flush();

  assert.equal(leavePayloads.length, 1, 'smoke leave should send one WS leave payload');
  assert.equal(harness.fetchState.leaveCalls, 0, 'smoke leave should not use the HTTP leave path');
  assert.equal(harness.fetchState.getCalls, getCallsBeforeLeave, 'WS leave must not trigger HTTP reload');
  assert.equal(harness.windowLocation.href, '/poker/', 'accepted leave should navigate back to poker lobby');
  assert.equal(harness.elements.pokerYourStack.textContent, '-', 'accepted leave should clear the current user stack immediately');
  const seatOneCard = seatCardFor(harness.elements.pokerSeatsGrid, 1);
  const seatOneUserNode = seatOneCard && seatOneCard.children ? seatOneCard.children[1] : null;
  const seatOneStackNode = seatOneCard && seatOneCard.children ? seatOneCard.children[3] : null;
  assert.equal(seatOneUserNode && seatOneUserNode.textContent, 'Empty', 'accepted leave should clear the local seat immediately');
  assert.equal(
    seatOneStackNode && seatOneStackNode.textContent ? seatOneStackNode.textContent.indexOf(': -') !== -1 : false,
    true,
    'accepted leave should clear the local seat stack immediately'
  );

  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 2,
      seats: [
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }
      ],
      stacks: { 'bot-2': 150 },
      authoritativeMembers: [
        { userId: 'bot-2', seat: 2 }
      ],
      hand: { status: 'LOBBY', handId: null },
      legalActions: { actions: [] }
    }
  });
  await harness.flush();

  assert.equal(harness.fetchState.getCalls, getCallsBeforeLeave, 'WS leave snapshot must stay off the HTTP reload path');
});

test('poker UI queued leave navigates to lobby immediately without waiting for snapshot removal', async () => {
  var leavePayloads = [];
  var snapshotHandler = null;
  var harness = createPokerTableHarness({
    responses: [
      {
        tableId: 'table-1',
        status: 'OPEN',
        maxPlayers: 6,
        seats: [
          { seatNo: 1, userId: 'user-1', status: 'ACTIVE', stack: 96 },
          { seatNo: 2, userId: 'bot-2', status: 'ACTIVE', stack: 104 }
        ],
        legalActions: [],
        actionConstraints: {},
        state: {
          version: 1,
          state: {
            phase: 'TURN',
            pot: 10,
            community: ['AS', 'KD', 'QC', '3H'],
            stacks: { 'user-1': 96, 'bot-2': 104 },
            turnUserId: 'bot-2',
            handId: 'hand-immediate-leave'
          }
        }
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
        sendLeaveQueued(payload, requestId){
          leavePayloads.push({ payload: payload, requestId: requestId });
          return requestId || 'leave-classic-queued';
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();
  var getCallsBeforeLeave = harness.fetchState.getCalls;

  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      seats: [
        { seatNo: 1, userId: 'user-1', status: 'ACTIVE' },
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }
      ],
      stacks: { 'user-1': 96, 'bot-2': 104 },
      authoritativeMembers: [
        { userId: 'user-1', seat: 1 },
        { userId: 'bot-2', seat: 2 }
      ],
      hand: { status: 'TURN', handId: 'hand-immediate-leave' },
      turn: { userId: 'bot-2' },
      legalActions: { seat: 1, actions: ['FOLD'] }
    }
  });
  await harness.flush();

  confirmLeave(harness);
  await harness.flush();

  assert.equal(leavePayloads.length, 1, 'immediate leave should queue one WS leave payload');
  assert.equal(harness.fetchState.leaveCalls, 0, 'immediate leave should stay on the WS path');
  assert.equal(harness.fetchState.getCalls, getCallsBeforeLeave, 'immediate leave should not trigger HTTP reload');
  assert.equal(harness.windowLocation.href, '/poker/', 'queued leave should navigate back to the poker lobby immediately');
});

test('poker UI cancel leave keeps the player on the table and sends no leave payload', async () => {
  var leavePayloads = [];
  var snapshotHandler = null;
  var harness = createPokerTableHarness({
    responses: [
      {
        tableId: 'table-1',
        status: 'OPEN',
        maxPlayers: 6,
        seats: [
          { seatNo: 1, userId: 'user-1', status: 'ACTIVE', stack: 96 },
          { seatNo: 2, userId: 'bot-2', status: 'ACTIVE', stack: 104 }
        ],
        legalActions: [],
        actionConstraints: {},
        state: {
          version: 1,
          state: {
            phase: 'TURN',
            pot: 10,
            community: ['AS', 'KD', 'QC', '3H'],
            stacks: { 'user-1': 96, 'bot-2': 104 },
            turnUserId: 'bot-2',
            handId: 'hand-cancel-leave'
          }
        }
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
        sendLeaveQueued(payload){
          leavePayloads.push(payload);
          return 'leave-classic-cancel';
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();
  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      seats: [
        { seatNo: 1, userId: 'user-1', status: 'ACTIVE' },
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }
      ],
      stacks: { 'user-1': 96, 'bot-2': 104 },
      authoritativeMembers: [
        { userId: 'user-1', seat: 1 },
        { userId: 'bot-2', seat: 2 }
      ],
      hand: { status: 'TURN', handId: 'hand-cancel-leave' },
      turn: { userId: 'bot-2' },
      legalActions: { seat: 1, actions: ['FOLD'] }
    }
  });
  await harness.flush();

  harness.elements.pokerLeave.click();
  harness.elements.pokerLeaveConfirmCancel.click();
  await harness.flush();

  assert.equal(harness.elements.pokerLeaveConfirmModal.hidden, true);
  assert.equal(leavePayloads.length, 0);
  assert.equal(harness.windowLocation.href, '');
});

test('poker UI retries leave after stale session reconnect and then returns to lobby', async () => {
  var leavePayloads = [];
  var snapshotHandler = null;
  var wsCreateCount = 0;
  var harness = createPokerTableHarness({
    responses: [
      {
        tableId: 'table-1',
        status: 'OPEN',
        maxPlayers: 6,
        seats: [
          { seatNo: 1, userId: 'user-1', status: 'ACTIVE', stack: 150 },
          { seatNo: 2, userId: 'bot-2', status: 'ACTIVE', stack: 150 }
        ],
        legalActions: [],
        actionConstraints: {},
        state: {
          version: 1,
          state: {
            phase: 'PREFLOP',
            pot: 15,
            community: [],
            stacks: { 'user-1': 150, 'bot-2': 150 },
            turnUserId: 'user-1',
            handId: 'hand-1'
          }
        }
      }
    ],
    wsFactory(createOptions){
      wsCreateCount += 1;
      snapshotHandler = createOptions.onSnapshot;
      return {
        start(){
          Promise.resolve().then(function(){
            if (typeof createOptions.onStatus === 'function') createOptions.onStatus('auth_ok', { roomId: 'table-1' });
          });
        },
        destroy(){},
        isReady(){ return true; },
        sendLeave(payload){
          leavePayloads.push(payload);
          if (leavePayloads.length === 1) {
            var err = new Error('STALE_SESSION');
            err.code = 'STALE_SESSION';
            return Promise.reject(err);
          }
          return Promise.resolve({ ok: true });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();

  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      seats: [
        { seatNo: 1, userId: 'user-1', status: 'ACTIVE' },
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }
      ],
      stacks: { 'user-1': 150, 'bot-2': 150 },
      authoritativeMembers: [
        { userId: 'user-1', seat: 1 },
        { userId: 'bot-2', seat: 2 }
      ],
      hand: { status: 'PREFLOP', handId: 'hand-1' },
      turn: { userId: 'user-1' },
      legalActions: { actions: ['FOLD', 'CALL'] }
    }
  });
  await harness.flush();

  confirmLeave(harness);
  await harness.flush();
  await harness.flush();

  assert.equal(leavePayloads.length, 2, 'stale session leave should retry once after reconnect');
  assert.equal(wsCreateCount, 2, 'stale session leave should recreate the WS client once');
  assert.equal(harness.windowLocation.href, '/poker/', 'successful leave retry should navigate back to poker lobby');
});

test('poker UI leaves cleanly before the first live snapshot when the removal snapshot arrives first', async () => {
  var leavePayloads = [];
  var snapshotHandler = null;
  var resolveLeave = null;
  var harness = createPokerTableHarness({
    responses: [
      {
        tableId: 'table-1',
        status: 'OPEN',
        maxPlayers: 6,
        seats: [
          { seatNo: 1, userId: 'user-1', status: 'ACTIVE', stack: 150 },
          { seatNo: 2, userId: 'bot-2', status: 'ACTIVE', stack: 150 }
        ],
        legalActions: [],
        actionConstraints: {},
        state: {
          version: 1,
          state: {
            phase: 'PREFLOP',
            pot: 15,
            community: [],
            stacks: { 'user-1': 150, 'bot-2': 150 },
            turnUserId: 'user-1',
            handId: 'hand-pre-snapshot-leave'
          }
        }
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
        sendLeave(payload){
          leavePayloads.push(payload);
          return new Promise(function(resolve){ resolveLeave = resolve; });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();

  confirmLeave(harness);
  await harness.flush();

  assert.equal(leavePayloads.length, 1);
  assert.equal(harness.windowLocation.href, '', 'leave should stay pending until the first live snapshot confirms the seat is gone');

  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      seats: [
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }
      ],
      stacks: { 'bot-2': 150 },
      authoritativeMembers: [
        { userId: 'bot-2', seat: 2 }
      ],
      hand: { status: 'SHOWDOWN', handId: 'hand-pre-snapshot-leave' },
      legalActions: { actions: [] }
    }
  });
  await harness.flush();

  assert.equal(harness.windowLocation.href, '/poker/', 'first live removal snapshot should return the player to the poker lobby');
  if (resolveLeave) resolveLeave({ ok: true });
});

test('poker UI redirects to lobby when leave snapshot confirms the seat is gone before leave promise resolves', async () => {
  var leavePayloads = [];
  var snapshotHandler = null;
  var resolveLeave = null;
  var harness = createPokerTableHarness({
    responses: [
      {
        tableId: 'table-1',
        status: 'OPEN',
        maxPlayers: 6,
        seats: [
          { seatNo: 1, userId: 'user-1', status: 'ACTIVE', stack: 150 },
          { seatNo: 2, userId: 'bot-2', status: 'ACTIVE', stack: 150 }
        ],
        legalActions: [],
        actionConstraints: {},
        state: {
          version: 1,
          state: {
            phase: 'PREFLOP',
            pot: 15,
            community: [],
            stacks: { 'user-1': 150, 'bot-2': 150 },
            turnUserId: 'user-1',
            handId: 'hand-1'
          }
        }
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
        sendLeave(payload){
          leavePayloads.push(payload);
          return new Promise(function(resolve){ resolveLeave = resolve; });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();

  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      seats: [
        { seatNo: 1, userId: 'user-1', status: 'ACTIVE' },
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }
      ],
      stacks: { 'user-1': 150, 'bot-2': 150 },
      authoritativeMembers: [
        { userId: 'user-1', seat: 1 },
        { userId: 'bot-2', seat: 2 }
      ],
      hand: { status: 'PREFLOP', handId: 'hand-1' },
      turn: { userId: 'user-1' },
      legalActions: { actions: ['FOLD', 'CALL'] }
    }
  });
  await harness.flush();

  confirmLeave(harness);
  await harness.flush();

  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 2,
      seats: [
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }
      ],
      stacks: { 'bot-2': 150 },
      authoritativeMembers: [
        { userId: 'bot-2', seat: 2 }
      ],
      hand: { status: 'LOBBY', handId: null },
      legalActions: { actions: [] }
    }
  });
  await harness.flush();

  assert.equal(leavePayloads.length, 1);
  assert.equal(harness.windowLocation.href, '/poker/', 'leave confirmation snapshot should navigate back to poker lobby');
  if (resolveLeave) resolveLeave({ ok: true });
});

test('poker UI leaves to lobby when settlement snapshot removes the player while the table stays open for the remaining bot', async () => {
  var leavePayloads = [];
  var snapshotHandler = null;
  var resolveLeave = null;
  var harness = createPokerTableHarness({
    responses: [
      {
        tableId: 'table-1',
        status: 'OPEN',
        maxPlayers: 6,
        seats: [
          { seatNo: 1, userId: 'user-1', status: 'ACTIVE', stack: 96 },
          { seatNo: 2, userId: 'bot-2', status: 'ACTIVE', stack: 104 }
        ],
        legalActions: [],
        actionConstraints: {},
        state: {
          version: 1,
          state: {
            phase: 'TURN',
            pot: 10,
            community: ['AS', 'KD', 'QC', '3H'],
            stacks: { 'user-1': 96, 'bot-2': 104 },
            turnUserId: 'user-1',
            handId: 'hand-settle-leave'
          }
        }
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
        sendLeave(payload){
          leavePayloads.push(payload);
          return new Promise(function(resolve){ resolveLeave = resolve; });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();

  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 1,
      seats: [
        { seatNo: 1, userId: 'user-1', status: 'ACTIVE' },
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }
      ],
      stacks: { 'user-1': 96, 'bot-2': 104 },
      authoritativeMembers: [
        { userId: 'user-1', seat: 1 },
        { userId: 'bot-2', seat: 2 }
      ],
      hand: { status: 'TURN', handId: 'hand-settle-leave' },
      turn: { userId: 'user-1' },
      legalActions: { actions: ['FOLD', 'CALL'] }
    }
  });
  await harness.flush();

  confirmLeave(harness);
  await harness.flush();

  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 2,
      seats: [
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' }
      ],
      stacks: { 'bot-2': 110 },
      authoritativeMembers: [
        { userId: 'bot-2', seat: 2 }
      ],
      hand: { status: 'SETTLED', handId: 'hand-settle-leave' },
      showdown: { handId: 'hand-settle-leave', winners: ['bot-2'], reason: 'computed', potsAwarded: [], potAwardedTotal: 10 },
      handSettlement: { handId: 'hand-settle-leave', settledAt: '2026-04-13T00:00:00.000Z', payouts: { 'bot-2': 10 } },
      legalActions: { actions: [] }
    }
  });
  await harness.flush();

  assert.equal(leavePayloads.length, 1);
  assert.equal(harness.windowLocation.href, '/poker/', 'settlement confirmation snapshot should navigate back to poker lobby');
  if (resolveLeave) resolveLeave({ ok: true });
});
