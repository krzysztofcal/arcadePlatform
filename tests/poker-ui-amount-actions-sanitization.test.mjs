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

assert.ok(hooks && hooks.sanitizeAllowedActions && hooks.validateAmountActionPayload && hooks.resolveTurnActionUiState, 'expected poker UI amount-action hooks');

// Contract: legalActions availability is server-authoritative even when constraints are missing.
{
  const allowedInfo = hooks.sanitizeAllowedActions(new Set(['BET']), null);
  assert.equal(allowedInfo.allowed.has('BET'), true, 'BET should remain available when constraints are missing');
  const payload = hooks.validateAmountActionPayload('BET', '20', allowedInfo);
  assert.equal(payload.error, undefined, 'positive BET should pass local validation when maxBetAmount is absent');
  assert.equal(payload.amount, 20, 'validated payload amount should be normalized to integer');
}

{
  const allowedInfo = hooks.sanitizeAllowedActions(new Set(['RAISE']), { minRaiseTo: null, maxRaiseTo: null });
  assert.equal(allowedInfo.allowed.has('RAISE'), true, 'RAISE should remain available when raise range constraints are absent');
  const payload = hooks.validateAmountActionPayload('RAISE', '20', allowedInfo);
  assert.equal(payload.error, undefined, 'positive RAISE should pass local validation when raise range is absent');
  assert.equal(payload.amount, 20, 'validated raise payload should normalize to integer');
}

// Invalid non-positive amount is still rejected.
{
  const allowedInfo = hooks.sanitizeAllowedActions(new Set(['BET']), null);
  const zeroPayload = hooks.validateAmountActionPayload('BET', '0', allowedInfo);
  assert.equal(zeroPayload.error, 'Enter an amount for bet/raise', 'zero bet amount should fail local validation');
  const negativePayload = hooks.validateAmountActionPayload('RAISE', '-4', hooks.sanitizeAllowedActions(new Set(['RAISE']), null));
  assert.equal(negativePayload.error, 'Enter an amount for bet/raise', 'negative raise amount should fail local validation');
}

// When constraints are present and valid they still enforce ranges.
{
  const allowedInfo = hooks.sanitizeAllowedActions(new Set(['BET']), { maxBetAmount: 20 });
  const payload = hooks.validateAmountActionPayload('BET', '21', allowedInfo);
  assert.equal(payload.error, 'Invalid amount', 'BET should enforce maxBetAmount when present');
}

{
  const allowedInfo = hooks.sanitizeAllowedActions(new Set(['RAISE']), { minRaiseTo: 10, maxRaiseTo: 20 });
  const low = hooks.validateAmountActionPayload('RAISE', '9', allowedInfo);
  assert.equal(low.error, 'Invalid amount', 'RAISE should enforce minRaiseTo when valid range is present');
  const inRange = hooks.validateAmountActionPayload('RAISE', '15', allowedInfo);
  assert.equal(inRange.error, undefined, 'RAISE should accept value inside valid range');
}

// Turn actions visibility is computed from available legal actions.
{
  const uiState = hooks.resolveTurnActionUiState({
    isUsersTurn: true,
    phase: 'RIVER',
    turnUserId: 'user-1',
    currentUserId: 'user-1',
    rawLegalActions: ['BET'],
    availableActions: ['BET']
  });
  assert.equal(uiState.showActions, true, 'BET should keep action row visible');
  assert.equal(uiState.status, null, 'status should be clear when available legal actions exist');
}

{
  const uiState = hooks.resolveTurnActionUiState({
    isUsersTurn: true,
    phase: 'TURN',
    turnUserId: 'user-1',
    currentUserId: 'user-1',
    rawLegalActions: [],
    availableActions: []
  });
  assert.equal(uiState.status, 'contract_mismatch', 'empty raw legal actions on user turn should still report contract mismatch');
}
