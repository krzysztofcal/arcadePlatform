import test from 'node:test';
import assert from 'node:assert/strict';
import { createPokerTableHarness } from './helpers/poker-ui-table-harness.mjs';

test('poker UI WS smoke sends one action and refreshes public table state without freezing controls', async () => {
  var actPayloads = [];
  var snapshotHandler = null;
  var harness = createPokerTableHarness({
    wsFactory(createOptions){
      snapshotHandler = createOptions.onSnapshot;
      return {
        start(){
          Promise.resolve().then(function(){
            if (typeof createOptions.onStatus === 'function') createOptions.onStatus('auth_ok', { roomId: 'table-1' });
            if (typeof createOptions.onSnapshot === 'function'){
              createOptions.onSnapshot({
                kind: 'stateSnapshot',
                payload: {
                  tableId: 'table-1',
                  stateVersion: 1,
                  table: {
                    tableId: 'table-1',
                    status: 'OPEN',
                    maxPlayers: 6,
                    members: [
                      { userId: 'user-1', seat: 1 },
                      { userId: 'bot-2', seat: 2 },
                      { userId: 'bot-3', seat: 3 }
                    ]
                  },
                  public: {
                    hand: { handId: 'hand-1', status: 'PREFLOP' },
                    turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
                    board: [],
                    pot: { total: 15, sidePots: [] },
                    legalActions: ['CHECK']
                  },
                  stacks: { 'user-1': 150, 'bot-2': 150, 'bot-3': 150 }
                }
              });
            }
          });
        },
        destroy(){},
        isReady(){ return true; },
        sendAct(payload){
          actPayloads.push(payload);
          return Promise.resolve({ ok: true });
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();

  assert.equal(harness.elements.pokerActionsRow.hidden, false, 'smoke act should expose action controls for the acting user');
  assert.equal(harness.elements.pokerActCheckBtn.hidden, false, 'smoke act should expose the CHECK button');

  harness.elements.pokerActCheckBtn.click();
  await harness.flush();

  assert.equal(actPayloads.length, 1, 'smoke act should send one WS action payload');
  assert.equal(actPayloads[0].handId, 'hand-1', 'smoke act should send the current hand id');
  assert.equal(actPayloads[0].action, 'CHECK', 'smoke act should send the normalized WS action');
  assert.equal(harness.fetchState.actCalls, 0, 'smoke act should stay on the WS action path');
  assert.equal(harness.fetchState.getCalls, 0, 'smoke act should stay off the retired HTTP table reload path');

  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 2,
      seats: [
        { seatNo: 1, userId: 'user-1', status: 'ACTIVE' },
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' },
        { seatNo: 3, userId: 'bot-3', status: 'ACTIVE' }
      ],
      stacks: { 'user-1': 145, 'bot-2': 150, 'bot-3': 150 },
      authoritativeMembers: [
        { userId: 'user-1', seat: 1 },
        { userId: 'bot-2', seat: 2 },
        { userId: 'bot-3', seat: 3 }
      ],
      hand: { status: 'FLOP', handId: 'hand-1' },
      turn: { userId: 'bot-2', deadlineAt: Date.now() + 5000 },
      board: { cards: ['As', 'Kd', '3h'] },
      pot: { total: 20, sidePots: [] },
      legalActions: { actions: [] }
    }
  });
  await harness.flush();

  assert.equal(String(harness.elements.pokerVersion.textContent), '2', 'smoke act should render the refreshed public snapshot version');
  assert.equal(harness.elements.pokerPhase.textContent, 'FLOP', 'smoke act should render the refreshed public phase');
  assert.equal(String(harness.elements.pokerPot.textContent), '20', 'smoke act should render the refreshed public pot');
  assert.equal(harness.elements.pokerActionsRow.hidden, true, 'smoke act should move the UI out of the acting state after the refresh');
  assert.notEqual(harness.elements.pokerActStatus.textContent, 'Sending...', 'smoke act should clear the pending action status after the refresh');
});

test('poker UI requests a gameplay snapshot after act acceptance when push state does not arrive', async () => {
  var actPayloads = [];
  var gameplaySnapshotRequests = 0;
  var snapshotHandler = null;
  var harness = createPokerTableHarness({
    wsFactory(createOptions){
      snapshotHandler = createOptions.onSnapshot;
      return {
        start(){
          Promise.resolve().then(function(){
            if (typeof createOptions.onStatus === 'function') createOptions.onStatus('auth_ok', { roomId: 'table-1' });
            if (typeof createOptions.onSnapshot === 'function'){
              createOptions.onSnapshot({
                kind: 'stateSnapshot',
                payload: {
                  tableId: 'table-1',
                  stateVersion: 1,
                  table: {
                    tableId: 'table-1',
                    status: 'OPEN',
                    maxPlayers: 6,
                    members: [
                      { userId: 'user-1', seat: 1 },
                      { userId: 'bot-2', seat: 2 },
                      { userId: 'bot-3', seat: 3 }
                    ]
                  },
                  public: {
                    hand: { handId: 'hand-1', status: 'PREFLOP' },
                    turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
                    board: [],
                    pot: { total: 15, sidePots: [] },
                    legalActions: ['CHECK']
                  },
                  stacks: { 'user-1': 150, 'bot-2': 150, 'bot-3': 150 }
                }
              });
            }
          });
        },
        destroy(){},
        isReady(){ return true; },
        sendAct(payload){
          actPayloads.push(payload);
          return Promise.resolve({ ok: true });
        },
        requestGameplaySnapshot(){
          gameplaySnapshotRequests += 1;
          if (typeof snapshotHandler === 'function'){
            snapshotHandler({
              kind: 'stateSnapshot',
              payload: {
                tableId: 'table-1',
                stateVersion: 4,
                table: {
                  tableId: 'table-1',
                  status: 'OPEN',
                  maxPlayers: 6,
                  members: [
                    { userId: 'user-1', seat: 1 },
                    { userId: 'bot-2', seat: 2 },
                    { userId: 'bot-3', seat: 3 }
                  ]
                },
                you: { seat: 1 },
                public: {
                  hand: { handId: 'hand-1', status: 'FLOP' },
                  turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
                  board: ['As', 'Kd', '3h'],
                  pot: { total: 20, sidePots: [] },
                  legalActions: { seat: 1, actions: ['CHECK', 'BET'] },
                  actionConstraints: { toCall: 0, minRaiseTo: null, maxRaiseTo: null, maxBetAmount: 120 },
                  stacks: { 'user-1': 145, 'bot-2': 150, 'bot-3': 150 }
                }
              }
            });
          }
          return 'snapshot-refresh-1';
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();

  harness.elements.pokerActCheckBtn.click();
  await harness.flush();

  assert.equal(actPayloads.length, 1, 'fallback smoke should still send the original WS act');
  assert.equal(gameplaySnapshotRequests, 0, 'fallback snapshot should not fire before the timer elapses');

  harness.runTimeouts();
  await harness.flush();

  assert.equal(gameplaySnapshotRequests, 1, 'fallback smoke should request one gameplay snapshot after accepted act');
  assert.equal(harness.elements.pokerActionsRow.hidden, false, 'fallback gameplay snapshot should restore the action controls');
  assert.equal(harness.elements.pokerActCheckBtn.hidden, false, 'fallback gameplay snapshot should restore CHECK');
  assert.equal(harness.elements.pokerActBetBtn.hidden, false, 'fallback gameplay snapshot should restore BET');
});

test('poker UI does not request fallback gameplay snapshot when live WS state arrives before act promise resolves', async () => {
  var actPayloads = [];
  var gameplaySnapshotRequests = 0;
  var snapshotHandler = null;
  var resolveAct = null;
  var harness = createPokerTableHarness({
    wsFactory(createOptions){
      snapshotHandler = createOptions.onSnapshot;
      return {
        start(){
          Promise.resolve().then(function(){
            if (typeof createOptions.onStatus === 'function') createOptions.onStatus('auth_ok', { roomId: 'table-1' });
            if (typeof createOptions.onSnapshot === 'function'){
              createOptions.onSnapshot({
                kind: 'stateSnapshot',
                payload: {
                  tableId: 'table-1',
                  stateVersion: 1,
                  table: {
                    tableId: 'table-1',
                    status: 'OPEN',
                    maxPlayers: 6,
                    members: [
                      { userId: 'user-1', seat: 1 },
                      { userId: 'bot-2', seat: 2 },
                      { userId: 'bot-3', seat: 3 }
                    ]
                  },
                  public: {
                    hand: { handId: 'hand-1', status: 'PREFLOP' },
                    turn: { userId: 'user-1', deadlineAt: Date.now() + 5000 },
                    board: [],
                    pot: { total: 15, sidePots: [] },
                    legalActions: ['CHECK']
                  },
                  stacks: { 'user-1': 150, 'bot-2': 150, 'bot-3': 150 }
                }
              });
            }
          });
        },
        destroy(){},
        isReady(){ return true; },
        sendAct(payload){
          actPayloads.push(payload);
          return new Promise(function(resolve){
            resolveAct = resolve;
          });
        },
        requestGameplaySnapshot(){
          gameplaySnapshotRequests += 1;
          return 'snapshot-refresh-2';
        }
      };
    }
  });

  harness.fireDomContentLoaded();
  await harness.flush();

  harness.elements.pokerActCheckBtn.click();
  await harness.flush();

  assert.equal(actPayloads.length, 1, 'pre-resolve smoke should send one WS act');
  assert.equal(typeof resolveAct, 'function', 'act promise resolver should be captured');

  snapshotHandler({
    kind: 'table_state',
    payload: {
      tableId: 'table-1',
      stateVersion: 2,
      seats: [
        { seatNo: 1, userId: 'user-1', status: 'ACTIVE' },
        { seatNo: 2, userId: 'bot-2', status: 'ACTIVE' },
        { seatNo: 3, userId: 'bot-3', status: 'ACTIVE' }
      ],
      stacks: { 'user-1': 145, 'bot-2': 150, 'bot-3': 150 },
      authoritativeMembers: [
        { userId: 'user-1', seat: 1 },
        { userId: 'bot-2', seat: 2 },
        { userId: 'bot-3', seat: 3 }
      ],
      hand: { status: 'FLOP', handId: 'hand-1' },
      turn: { userId: 'bot-2', deadlineAt: Date.now() + 5000 },
      board: { cards: ['As', 'Kd', '3h'] },
      pot: { total: 20, sidePots: [] },
      legalActions: { actions: [] }
    }
  });
  await harness.flush();

  resolveAct({ ok: true });
  await harness.flush();

  harness.runTimeouts();
  await harness.flush();

  assert.equal(gameplaySnapshotRequests, 0, 'live push before act resolution should suppress fallback gameplay snapshot');
  assert.equal(String(harness.elements.pokerVersion.textContent), '2', 'live push should remain the rendered state after act resolution');
  assert.equal(harness.elements.pokerActionsRow.hidden, true, 'live push should already move the UI out of acting state');
});
