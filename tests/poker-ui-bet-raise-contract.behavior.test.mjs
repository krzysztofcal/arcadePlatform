import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'poker/poker.js'), 'utf8');

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
  navigator: { userAgent: 'node' },
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
  fetch: async () => { throw new Error('fetch not available in unit test'); },
  atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
  btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
};

sandbox.window.document = sandbox.document;
sandbox.window.navigator = sandbox.navigator;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.fetch = sandbox.fetch;
sandbox.window.atob = sandbox.atob;
sandbox.window.btoa = sandbox.btoa;

vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'poker/poker.js' });
const hooks = sandbox.window.__POKER_UI_TEST_HOOKS__;

assert.ok(hooks, 'expected poker UI test hooks');

{
  const allowedInfo = hooks.sanitizeAllowedActions(new Set(['CHECK', 'BET']), { maxBetAmount: null });
  assert.equal(allowedInfo.allowed.has('BET'), true, 'BET should stay in UI model when maxBetAmount is missing');
  const payload = hooks.validateAmountActionPayload('BET', '20', allowedInfo);
  assert.equal(payload.error, undefined, 'BET payload should accept positive amount when maxBetAmount is missing');
  const uiState = hooks.resolveTurnActionUiState({
    isUsersTurn: true,
    phase: 'FLOP',
    turnUserId: 'user-1',
    currentUserId: 'user-1',
    rawLegalActions: ['CHECK', 'BET'],
    availableActions: ['CHECK', 'BET'],
  });
  assert.equal(uiState.showActions, true, 'action row should be visible with CHECK/BET legal actions');
}

{
  const allowedInfo = hooks.sanitizeAllowedActions(new Set(['CALL', 'RAISE', 'FOLD']), { minRaiseTo: null, maxRaiseTo: null });
  assert.equal(allowedInfo.allowed.has('RAISE'), true, 'RAISE should stay in UI model when raise range is missing');
  const payload = hooks.validateAmountActionPayload('RAISE', '20', allowedInfo);
  assert.equal(payload.error, undefined, 'RAISE payload should accept positive amount when range is missing');
  assert.notEqual(payload.error, 'Action not allowed right now', 'RAISE should not fail with action-availability error when legal');
  const uiState = hooks.resolveTurnActionUiState({
    isUsersTurn: true,
    phase: 'TURN',
    turnUserId: 'user-1',
    currentUserId: 'user-1',
    rawLegalActions: ['CALL', 'RAISE', 'FOLD'],
    availableActions: ['CALL', 'RAISE', 'FOLD'],
  });
  assert.equal(uiState.showActions, true, 'action row should be visible with CALL/RAISE/FOLD legal actions');
}
