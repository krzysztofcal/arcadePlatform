import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'poker/poker.js'), 'utf8');

function loadHooks(overrides){
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
      KLog: overrides && overrides.klog,
    },
    document: {
      readyState: 'loading',
      addEventListener: () => {},
      getElementById: () => null,
      body: { innerHTML: '', appendChild: () => {}, removeChild: () => {} },
      visibilityState: 'visible',
      createElement: () => ({
        value: '',
        style: {},
        setAttribute: () => {},
        focus: () => {},
        select: () => {},
        setSelectionRange: () => {},
        remove: () => {},
        parentNode: null,
      }),
      execCommand: () => true,
    },
    URLSearchParams,
    Date,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    navigator: overrides && overrides.navigator ? overrides.navigator : { userAgent: 'node' },
    localStorage: localStorageStub,
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
  return { hooks: sandbox.window.__POKER_UI_TEST_HOOKS__, sandbox };
}

const base = loadHooks();
assert.ok(base.hooks, 'poker UI should expose test hooks when explicitly enabled');

const countdown = base.hooks.computeRemainingTurnSeconds(Date.now() + 30000, Date.now());
assert.ok(countdown > 0, 'countdown should be positive for future deadline in ms');

const countdownFromSeconds = base.hooks.computeRemainingTurnSeconds(Math.floor(Date.now() / 1000) + 30, Date.now());
assert.ok(countdownFromSeconds > 0, 'countdown should normalize second-based deadline values');

const showActions = base.hooks.shouldShowTurnActions({
  phase: 'PREFLOP',
  turnUserId: 'user-1',
  currentUserId: 'user-1',
  legalActions: ['FOLD', 'CALL'],
});
assert.equal(showActions, true, 'actions should render when it is the current user turn and legal actions exist');

const hideActions = base.hooks.shouldShowTurnActions({
  phase: 'PREFLOP',
  turnUserId: 'user-2',
  currentUserId: 'user-1',
  legalActions: ['FOLD', 'CALL'],
});
assert.equal(hideActions, true, 'action row should stay visible when fold is legal outside the current turn');

const hideActionsWithoutFold = base.hooks.shouldShowTurnActions({
  phase: 'PREFLOP',
  turnUserId: 'user-2',
  currentUserId: 'user-1',
  legalActions: ['CALL'],
});
assert.equal(hideActionsWithoutFold, false, 'non-acting player should still hide action row when fold is not legal');

const mixedLogs = [
  '[t] poker_join_click {"tableId":"1"}',
  '[t] poker_rt_event {"event":"insert"}',
  '[t] ws_open {}',
  '[t] poker_ws_auth_error {"code":"mint_failed"}',
  '[t] analytics_event {"message":"poker night starts"}',
  '[t] arcade_sidebar_open {}',
].join('\n');

const withLogs = loadHooks({
  klog: { getText: () => mixedLogs }
});
const dumpText = withLogs.hooks.getPokerDumpText();
assert.ok(dumpText.includes('poker_join_click'), 'dump should include poker UI log lines');
assert.ok(dumpText.includes('poker_rt_event'), 'dump should include realtime log lines');
assert.ok(dumpText.includes('ws_open'), 'dump should include websocket lifecycle lines');
assert.ok(!dumpText.includes('arcade_sidebar_open'), 'dump should exclude unrelated arcade lines');
assert.ok(!dumpText.includes('poker night starts'), 'dump should exclude non-diagnostic lines that only contain the plain word poker');
assert.equal(withLogs.hooks.getPokerDumpText(), dumpText, 'dump output should be idempotent when source logs are unchanged');

const emptyDump = loadHooks({ klog: { getText: () => 'arcade_only_line {}' } }).hooks.getPokerDumpText();
assert.equal(emptyDump, '', 'dump should be empty when no poker lines match');

let startedCount = 0;
const hookWithRecorder = loadHooks({
  klog: {
    start: () => { startedCount += 1; },
    status: () => ({ startedAt: 0 }),
  },
});
assert.equal(hookWithRecorder.hooks.ensurePokerRecorder(), true, 'recorder should start when available and not started');
assert.equal(startedCount, 1, 'recorder start should be invoked once');
assert.equal(hookWithRecorder.hooks.ensurePokerRecorder(), true, 'recorder ensure should be idempotent and safe when called repeatedly');
assert.equal(startedCount, 2, 'ensure should call start on repeated calls when status does not indicate started');

const alreadyStarted = loadHooks({
  klog: {
    start: () => { throw new Error('should not start when already started'); },
    status: () => ({ startedAt: Date.now() }),
  },
});
assert.equal(alreadyStarted.hooks.ensurePokerRecorder(), true, 'recorder ensure should no-op when already started');
assert.equal(loadHooks({ klog: null }).hooks.ensurePokerRecorder(), false, 'missing recorder should be handled safely');


const availability = base.hooks.resolveDevLogActionAvailability;
assert.ok(availability, 'dev action availability helper should be exposed for UI behavior tests');

const baseFlags = {
  devActionsEnabled: true,
  tableId: 'table-1',
  joinPending: false,
  leavePending: false,
  startHandPending: false,
  actPending: false,
  dumpLogsPending: false,
  copyLogPending: false,
};
assert.equal(availability(baseFlags).canDumpLogs, true, 'dump logs should be enabled when no action is pending');
assert.equal(availability(baseFlags).canCopyLog, true, 'copy log should be enabled when no action is pending');
assert.equal(
  base.hooks.buildPokerTableUrl('table-1', { useV2: true, seatNo: 3, autoJoin: true }),
  '/poker/table-v2.html?tableId=table-1&seatNo=3&autoJoin=1',
  'lobby routing helper should default user flows to v2 table url'
);
assert.equal(
  base.hooks.buildPokerTableUrl('table-1', { useV2: false }),
  '/poker/table.html?tableId=table-1',
  'lobby routing helper should keep classic table url available for testing'
);
assert.match(source, /window\.location\.href = '\/account\.html';/, 'poker auth fallback should route to account page on the current deploy');

const dumpPendingFlags = Object.assign({}, baseFlags, { dumpLogsPending: true, copyLogPending: false });
assert.equal(availability(dumpPendingFlags).canDumpLogs, false, 'dump logs should be disabled when dump action is pending');
assert.equal(availability(dumpPendingFlags).canCopyLog, true, 'copy log should remain enabled when only dump action is pending');

const copyPendingFlags = Object.assign({}, baseFlags, { dumpLogsPending: false, copyLogPending: true });
assert.equal(availability(copyPendingFlags).canDumpLogs, true, 'dump logs should remain enabled when only copy action is pending');
assert.equal(availability(copyPendingFlags).canCopyLog, false, 'copy log should be disabled when copy action is pending');

let asyncClipboardText = null;
const asyncClipboardResult = loadHooks({
  navigator: { clipboard: { writeText: async (txt) => { asyncClipboardText = txt; } } },
});
assert.equal(await asyncClipboardResult.hooks.copyTextToClipboard('hello poker'), true, 'async clipboard path should succeed');
assert.equal(asyncClipboardText, 'hello poker', 'async clipboard path should copy exact text');

let fallbackCopied = false;
const fallback = loadHooks({
  navigator: {},
});
fallback.sandbox.document.execCommand = (cmd) => {
  fallbackCopied = cmd === 'copy';
  return true;
};
assert.equal(await fallback.hooks.copyTextToClipboard('fallback poker logs'), true, 'fallback copy should succeed when async clipboard is unavailable');
assert.equal(fallbackCopied, true, 'fallback path should use execCommand copy');
