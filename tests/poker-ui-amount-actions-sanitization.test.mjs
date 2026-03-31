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

assert.ok(hooks && hooks.sanitizeAllowedActions && hooks.validateAmountActionPayload && hooks.resolveTurnActionUiState, 'expected poker UI sanitization hooks');

// Test case 1 — BET hidden when numeric max is zero.
{
  const sanitized = hooks.sanitizeAllowedActions(new Set(['BET', 'CHECK']), { maxBetAmount: 0, toCall: 0 });
  assert.equal(sanitized.allowed.has('BET'), false, 'BET should be removed when maxBetAmount is zero');
  const showActions = hooks.shouldShowTurnActions({
    phase: 'PREFLOP',
    turnUserId: 'user-1',
    currentUserId: 'user-1',
    legalActions: Array.from(sanitized.allowed)
  });
  assert.equal(showActions, true, 'row should stay visible when a sanitized non-amount action (CHECK) remains');
  assert.equal(sanitized.needsAmount, false, 'amount input should not be required when impossible amount action is removed');
}

// Test case 2 — BET shown when numeric max is valid.
{
  const sanitized = hooks.sanitizeAllowedActions(new Set(['BET']), { maxBetAmount: 20, toCall: 0 });
  assert.equal(sanitized.allowed.has('BET'), true, 'BET should remain available with positive maxBetAmount');
  const payload = hooks.validateAmountActionPayload('BET', '12', sanitized);
  assert.equal(payload.error, undefined, 'valid bet amount should pass payload validation');
  assert.equal(payload.amount, 12, 'validated payload amount should be normalized to integer');
}

// Test case 3 — RAISE hidden when raise range is impossible.
{
  const sanitized = hooks.sanitizeAllowedActions(new Set(['RAISE']), { minRaiseTo: 10, maxRaiseTo: 5 });
  assert.equal(sanitized.allowed.has('RAISE'), false, 'RAISE should be removed when minRaiseTo exceeds maxRaiseTo');
  assert.equal(sanitized.needsAmount, false, 'amount input should not remain required when impossible raise is removed');
  const showActions = hooks.shouldShowTurnActions({
    phase: 'TURN',
    turnUserId: 'user-1',
    currentUserId: 'user-1',
    legalActions: Array.from(sanitized.allowed)
  });
  assert.equal(showActions, false, 'row should be hidden when sanitization removes all actions');
}

// Test case 4 — stale selected BET cleared after snapshot update (modeled via validation).
{
  const initial = hooks.sanitizeAllowedActions(new Set(['BET']), { maxBetAmount: 15 });
  assert.equal(initial.allowed.has('BET'), true, 'BET is initially allowed');
  const updated = hooks.sanitizeAllowedActions(new Set(['BET']), { maxBetAmount: 0 });
  assert.equal(updated.allowed.has('BET'), false, 'BET is removed after constraints update');
  const payload = hooks.validateAmountActionPayload('BET', '5', updated);
  assert.equal(payload.error, 'Action not allowed right now', 'stale BET selection should fail as not allowed after sanitization update');
}

// Test case 5 — submission path uses sanitized action availability.
{
  const rawLegalButImpossible = hooks.sanitizeAllowedActions(new Set(['BET', 'CALL']), { maxBetAmount: 0, toCall: 0 });
  const payload = hooks.validateAmountActionPayload('BET', '1', rawLegalButImpossible);
  assert.equal(payload.error, 'Action not allowed right now', 'payload validation should reject impossible BET even if legalActions included BET');
}

// Regression — sanitized-empty actions hide turn actions row when driven by sanitized model.
{
  const sanitized = hooks.sanitizeAllowedActions(new Set(['BET']), { maxBetAmount: 0, toCall: 0 });
  assert.equal(sanitized.allowed.has('BET'), false, 'sanitization should remove impossible BET');
  const showActions = hooks.shouldShowTurnActions({
    phase: 'RIVER',
    turnUserId: 'user-1',
    currentUserId: 'user-1',
    legalActions: Array.from(sanitized.allowed)
  });
  assert.equal(showActions, false, 'turn actions should be hidden when sanitized actions are empty');
  const uiState = hooks.resolveTurnActionUiState({
    isUsersTurn: true,
    phase: 'RIVER',
    turnUserId: 'user-1',
    currentUserId: 'user-1',
    rawLegalActions: ['BET'],
    sanitizedAllowedActions: Array.from(sanitized.allowed)
  });
  assert.equal(uiState.showActions, false, 'resolved UI state should hide row when sanitized actions are empty');
  assert.equal(uiState.status, 'no_actionable_moves', 'resolved UI state should indicate non-mismatch no-actionable state');
  const payload = hooks.validateAmountActionPayload('BET', '1', sanitized);
  assert.equal(payload.error, 'Action not allowed right now', 'sanitized-empty state should block impossible BET submission');
}

// Regression happy path — valid positive BET keeps turn actions visible.
{
  const sanitized = hooks.sanitizeAllowedActions(new Set(['BET']), { maxBetAmount: 20, toCall: 0 });
  assert.equal(sanitized.allowed.has('BET'), true, 'BET should remain allowed when maxBetAmount is positive');
  const showActions = hooks.shouldShowTurnActions({
    phase: 'FLOP',
    turnUserId: 'user-1',
    currentUserId: 'user-1',
    legalActions: Array.from(sanitized.allowed)
  });
  assert.equal(showActions, true, 'turn actions should stay visible for valid sanitized BET');
  const uiState = hooks.resolveTurnActionUiState({
    isUsersTurn: true,
    phase: 'FLOP',
    turnUserId: 'user-1',
    currentUserId: 'user-1',
    rawLegalActions: ['BET'],
    sanitizedAllowedActions: Array.from(sanitized.allowed)
  });
  assert.equal(uiState.showActions, true, 'resolved UI state should keep row visible for valid sanitized BET');
  assert.equal(uiState.status, null, 'resolved UI state should not show empty-state status when sanitized action exists');
}

// Regression — raw-empty user-turn state remains contract mismatch.
{
  const uiState = hooks.resolveTurnActionUiState({
    isUsersTurn: true,
    phase: 'TURN',
    turnUserId: 'user-1',
    currentUserId: 'user-1',
    rawLegalActions: [],
    sanitizedAllowedActions: []
  });
  assert.equal(uiState.showActions, false, 'resolved UI state should hide row when no raw/sanitized actions exist');
  assert.equal(uiState.status, 'contract_mismatch', 'raw-empty user-turn state should preserve contract mismatch status');
}
