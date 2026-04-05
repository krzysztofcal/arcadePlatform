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
