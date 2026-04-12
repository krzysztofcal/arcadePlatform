import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'poker/poker.js'), 'utf8');

const localStorageStub = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const sandbox = {
  Buffer,
  window: {
    location: { pathname: '/poker/table.html', search: '' },
    addEventListener: () => {},
    removeEventListener: () => {},
    __RUNNING_POKER_UI_TESTS__: true,
  },
  document: {
    readyState: 'loading',
    addEventListener: () => {},
    getElementById: () => null,
    body: { innerHTML: '' },
    visibilityState: 'visible',
  },
  URLSearchParams,
  Date,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  console,
  navigator: { userAgent: 'node' },
  localStorage: localStorageStub,
  fetch: async () => { throw new Error('fetch not available in unit test'); },
  atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
  btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
};

sandbox.window.document = sandbox.document;
sandbox.window.console = sandbox.console;
sandbox.window.navigator = sandbox.navigator;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.fetch = sandbox.fetch;
sandbox.window.atob = sandbox.atob;
sandbox.window.btoa = sandbox.btoa;

vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'poker/poker.js' });

const hooks = sandbox.window.__POKER_UI_TEST_HOOKS__;
assert.ok(hooks, 'poker UI should expose test hooks when explicitly enabled');
assert.equal(typeof hooks.sanitizeAllowedActions, 'function');
assert.equal(typeof hooks.validateAmountActionPayload, 'function');
assert.equal(typeof hooks.resolveTurnActionUiState, 'function');
assert.equal(typeof hooks.resolveAmountActionModel, 'function');
assert.equal(typeof hooks.resolveAllInPlan, 'function');
assert.equal(typeof hooks.evaluateViewerBestHand, 'function');
assert.equal(typeof hooks.formatViewerHandCategory, 'function');

const betInfo = hooks.sanitizeAllowedActions(new Set(['CHECK', 'BET']), { maxBetAmount: 100 });
const betModel = hooks.resolveAmountActionModel(betInfo, 20, '');
assert.equal(betModel.visible, true, 'BET model should be visible when BET is legal');
assert.equal(betModel.actionType, 'BET');
assert.equal(betModel.min, 1);
assert.equal(betModel.max, 100);
assert.equal(betModel.defaultValue, 20);

const raiseInfo = hooks.sanitizeAllowedActions(new Set(['CALL', 'RAISE', 'FOLD']), { minRaiseTo: 12, maxRaiseTo: 100 });
const raiseModel = hooks.resolveAmountActionModel(raiseInfo, 20, '');
assert.equal(raiseModel.visible, true, 'RAISE model should be visible when RAISE is legal');
assert.equal(raiseModel.actionType, 'RAISE');
assert.equal(raiseModel.defaultValue, 20);

const bothModel = hooks.resolveAmountActionModel(
  hooks.sanitizeAllowedActions(new Set(['BET', 'RAISE']), { maxBetAmount: 100, minRaiseTo: 12, maxRaiseTo: 30 }),
  20,
  ''
);
assert.equal(bothModel.visible, true, 'shared amount row should still be visible when BET and RAISE are both legal');
assert.equal(bothModel.actionType, null, 'model should not guess a submit action when both BET and RAISE are legal');
assert.equal(bothModel.hasBet, true);
assert.equal(bothModel.hasRaise, true);

const bothAsBetModel = hooks.resolveAmountActionModel(
  hooks.sanitizeAllowedActions(new Set(['BET', 'RAISE']), { maxBetAmount: 100, minRaiseTo: 12, maxRaiseTo: 30 }),
  20,
  'BET'
);
assert.equal(bothAsBetModel.actionType, 'BET');
assert.equal(bothAsBetModel.min, 1);
assert.equal(bothAsBetModel.max, 100);

const bothAsRaiseModel = hooks.resolveAmountActionModel(
  hooks.sanitizeAllowedActions(new Set(['BET', 'RAISE']), { maxBetAmount: 100, minRaiseTo: 12, maxRaiseTo: 30 }),
  20,
  'RAISE'
);
assert.equal(bothAsRaiseModel.actionType, 'RAISE');
assert.equal(bothAsRaiseModel.min, 12);
assert.equal(bothAsRaiseModel.max, 30);

const lowMaxBet = hooks.resolveAmountActionModel(hooks.sanitizeAllowedActions(new Set(['BET']), { maxBetAmount: 7 }), 20, '');
assert.equal(lowMaxBet.defaultValue, 7, 'default should clamp down to server maxBetAmount');

const noneModel = hooks.resolveAmountActionModel(hooks.sanitizeAllowedActions(new Set(['CHECK', 'CALL']), {}), 20, '');
assert.equal(noneModel.visible, false, 'amount row should be hidden when neither BET nor RAISE is legal');

const facingBetInfo = hooks.sanitizeAllowedActions(new Set(['CALL', 'BET', 'RAISE', 'FOLD']), { toCall: 10, minRaiseTo: 20, maxRaiseTo: 100, maxBetAmount: 100 });
assert.equal(facingBetInfo.allowed.has('BET'), false, 'BET should be hidden when there is a bet to call');
assert.equal(facingBetInfo.allowed.has('RAISE'), true, 'RAISE should remain when facing a bet and raising is legal');

const unopenedPotInfo = hooks.sanitizeAllowedActions(new Set(['CHECK', 'CALL', 'BET', 'RAISE']), { toCall: 0, maxBetAmount: 100, minRaiseTo: 20, maxRaiseTo: 100 });
assert.equal(unopenedPotInfo.allowed.has('CALL'), false, 'CALL should be hidden when there is nothing to call');
assert.equal(unopenedPotInfo.allowed.has('RAISE'), false, 'RAISE should be hidden when the pot is unopened');
assert.equal(unopenedPotInfo.allowed.has('BET'), true, 'BET should remain when the acting player may open the betting');

const shortStackCallAllIn = hooks.resolveAllInPlan(
  hooks.sanitizeAllowedActions(new Set(['CALL', 'FOLD']), { toCall: 20 }),
  { state: { state: { stacks: { 'user-1': 8 } } } },
  'user-1'
);
assert.equal(shortStackCallAllIn && shortStackCallAllIn.type, 'CALL', 'short stack facing bet should map ALL IN to CALL');
assert.equal(shortStackCallAllIn && shortStackCallAllIn.amount, null, 'CALL all-in should not require explicit amount');

const raiseAllIn = hooks.resolveAllInPlan(
  hooks.sanitizeAllowedActions(new Set(['CALL', 'RAISE', 'FOLD']), { toCall: 10, minRaiseTo: 20, maxRaiseTo: 70 }),
  { state: { state: { stacks: { 'user-1': 70 } } } },
  'user-1'
);
assert.equal(raiseAllIn && raiseAllIn.type, 'RAISE', 'raise spot should map ALL IN to RAISE');
assert.equal(raiseAllIn && raiseAllIn.amount, 70, 'raise spot should map ALL IN to maxRaiseTo');

const cappedRaiseAllIn = hooks.resolveAllInPlan(
  hooks.sanitizeAllowedActions(new Set(['CALL', 'RAISE', 'FOLD']), { toCall: 10, minRaiseTo: 20, maxRaiseTo: 100 }),
  {
    seats: [
      { userId: 'user-1', seatNo: 1, status: 'ACTIVE' },
      { userId: 'user-2', seatNo: 2, status: 'ACTIVE' },
      { userId: 'user-3', seatNo: 3, status: 'FOLDED' }
    ],
    state: { state: { stacks: { 'user-1': 100, 'user-2': 35, 'user-3': 250 } } }
  },
  'user-1'
);
assert.equal(cappedRaiseAllIn && cappedRaiseAllIn.type, 'RAISE', 'raise all-in should remain a raise when another active player can cover part of the shove');
assert.equal(cappedRaiseAllIn && cappedRaiseAllIn.amount, 45, 'raise all-in should include toCall plus the biggest active opponent stack behind');

const coveredRaiseAllIn = hooks.resolveAllInPlan(
  hooks.sanitizeAllowedActions(new Set(['CALL', 'RAISE', 'FOLD']), { toCall: 10, minRaiseTo: 20, maxRaiseTo: 70 }),
  {
    seats: [
      { userId: 'user-1', seatNo: 1, status: 'ACTIVE' },
      { userId: 'user-2', seatNo: 2, status: 'ACTIVE' }
    ],
    state: { state: { stacks: { 'user-1': 70, 'user-2': 140 } } }
  },
  'user-1'
);
assert.equal(coveredRaiseAllIn && coveredRaiseAllIn.type, 'RAISE', 'full all-in should remain unchanged when another active player covers the stack');
assert.equal(coveredRaiseAllIn && coveredRaiseAllIn.amount, 70, 'covered all-in should still use full stack raiseTo');

const noAllIn = hooks.resolveAllInPlan(
  hooks.sanitizeAllowedActions(new Set(['CHECK', 'FOLD']), { toCall: 0 }),
  { state: { state: { stacks: { 'user-1': 50 } } } },
  'user-1'
);
assert.equal(noAllIn, null, 'no all-in button when only CHECK/FOLD are legal');

const flushEval = hooks.evaluateViewerBestHand([
  { r: 'A', s: 'S' },
  { r: 'K', s: 'S' },
  { r: 'Q', s: 'S' },
  { r: '8', s: 'S' },
  { r: '2', s: 'S' },
  { r: 'J', s: 'D' },
  { r: '9', s: 'H' },
]);
assert.equal(flushEval && flushEval.category, 6, 'viewer best-hand helper should detect flush from 7 cards');
assert.equal(hooks.formatViewerHandCategory(6), 'Flush', 'viewer category formatter should map known categories');
