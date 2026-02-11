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

const countdown = hooks.computeRemainingTurnSeconds(Date.now() + 30000, Date.now());
assert.ok(countdown > 0, 'countdown should be positive for future deadline in ms');

const countdownFromSeconds = hooks.computeRemainingTurnSeconds(Math.floor(Date.now() / 1000) + 30, Date.now());
assert.ok(countdownFromSeconds > 0, 'countdown should normalize second-based deadline values');

const showActions = hooks.shouldShowTurnActions({
  phase: 'PREFLOP',
  turnUserId: 'user-1',
  currentUserId: 'user-1',
  legalActions: ['FOLD', 'CALL'],
});
assert.equal(showActions, true, 'actions should render when it is the current user turn and legal actions exist');

const hideActions = hooks.shouldShowTurnActions({
  phase: 'PREFLOP',
  turnUserId: 'user-2',
  currentUserId: 'user-1',
  legalActions: ['FOLD', 'CALL'],
});
assert.equal(hideActions, false, 'actions should be hidden for the non-acting player');
