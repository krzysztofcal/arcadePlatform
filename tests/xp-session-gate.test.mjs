import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load source files
const xpClientSource = await readFile(path.join(__dirname, '..', 'js', 'xpClient.js'), 'utf8');
const comboSource = await readFile(path.join(__dirname, '..', 'js', 'xp', 'combo.js'), 'utf8');
const scoringSource = await readFile(path.join(__dirname, '..', 'js', 'xp', 'scoring.js'), 'utf8');
const xpCoreSource = await readFile(path.join(__dirname, '..', 'js', 'xp', 'core.js'), 'utf8');
const xpShellSource = await readFile(path.join(__dirname, '..', 'js', 'xp.js'), 'utf8');

// Instrument core.js to expose state
const hookMarker = '  } catch (_) {}\n}';
const hookIndex = xpCoreSource.lastIndexOf(hookMarker);
if (hookIndex === -1) {
  throw new Error('xp core format mismatch');
}
const hookPrefix = xpCoreSource.slice(0, hookIndex);
const hookSuffix = xpCoreSource.slice(hookIndex + hookMarker.length);
const hookSnippet = '  } catch (_) {}\n  if (window && !window.__xpTestHook) { window.__xpTestHook = () => state; }\n}';
const instrumentedCore = `${hookPrefix}${hookSnippet}${hookSuffix}`;

// Test utilities
let now = 10_000;
let nextTimerId = 1;
const timers = new Map();

function scheduleTimer(fn, delay, repeating, interval) {
  const id = nextTimerId++;
  const due = now + Math.max(0, Number.isFinite(delay) ? Number(delay) : 0);
  timers.set(id, { fn, time: due, repeating: !!repeating, interval: repeating ? Math.max(0, Number(interval || delay) || 0) : 0 });
  return id;
}

function clearTimer(id) {
  timers.delete(id);
}

function advanceTime(ms) {
  const target = now + Math.max(0, Number(ms) || 0);
  while (true) {
    let nextId = null;
    let nextTime = Infinity;
    for (const [id, timer] of timers) {
      if (timer.time <= target && timer.time < nextTime) {
        nextId = id;
        nextTime = timer.time;
      }
    }
    if (nextId == null) break;
    const timer = timers.get(nextId);
    timers.delete(nextId);
    now = timer.time;
    try { timer.fn(); } catch (err) { console.error('timer error', err); }
    if (timer.repeating) {
      timer.time = now + timer.interval;
      timers.set(nextId, timer);
    }
  }
  now = target;
}

async function settleMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

class DateMock extends Date {
  constructor(...args) {
    if (args.length === 0) super(now);
    else super(...args);
  }
  static now() { return now; }
}
DateMock.UTC = Date.UTC;
DateMock.parse = Date.parse;

class EventShim {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}

class CustomEventShim extends EventShim {
  constructor(type, init = {}) {
    super(type, init);
    this.detail = init && init.detail;
  }
}

// Track calls and logs
const postWindowCalls = [];
const debugLogs = [];
let sessionFetchShouldFail = false;
let sessionToken = null;

function createTestContext() {
  postWindowCalls.length = 0;
  debugLogs.length = 0;
  sessionFetchShouldFail = false;
  sessionToken = null;
  now = 10_000;
  timers.clear();
  nextTimerId = 1;

  const localStorageMock = {
    __store: new Map(),
    getItem(key) { return this.__store.has(key) ? this.__store.get(key) : null; },
    setItem(key, value) { this.__store.set(String(key), String(value)); },
    removeItem(key) { this.__store.delete(String(key)); },
    clear() { this.__store.clear(); },
  };

  const docListeners = new Map();
  const windowListeners = new Map();

  function addListener(store, type, handler) {
    const key = String(type);
    const list = store.get(key) || [];
    list.push(handler);
    store.set(key, list);
  }

  function removeListener(store, type, handler) {
    const key = String(type);
    const list = store.get(key);
    if (!list) return;
    const next = handler ? list.filter((fn) => fn !== handler) : [];
    if (next.length) store.set(key, next);
    else store.delete(key);
  }

  const documentStub = {
    readyState: 'complete',
    hidden: false,
    visibilityState: 'visible',
    body: {
      dataset: { gameHost: '1', gameSlug: 'session-test', gameId: 'session-test' },
      hasAttribute(name) { return name === 'data-game-host'; },
      getAttribute(name) {
        if (name === 'data-game-id') return 'session-test';
        if (name === 'data-game-host') return '1';
        return null;
      },
      appendChild() {},
      classList: { add() {}, remove() {}, toggle() {} },
    },
    addEventListener(type, handler) { addListener(docListeners, type, handler); },
    removeEventListener(type, handler) { removeListener(docListeners, type, handler); },
    dispatchEvent(event) {
      (docListeners.get(event.type) || []).forEach((fn) => fn.call(documentStub, event));
      return true;
    },
    getElementById() { return null; },
    createElement() {
      return { className: '', textContent: '', appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } };
    },
    querySelectorAll() { return []; },
  };

  const windowStub = {
    document: documentStub,
    location: { origin: 'https://example.test', pathname: '/games/session-test', search: '' },
    localStorage: localStorageMock,
    addEventListener(type, handler) { addListener(windowListeners, type, handler); },
    removeEventListener(type, handler) { removeListener(windowListeners, type, handler); },
    dispatchEvent(event) {
      (windowListeners.get(event.type) || []).forEach((fn) => fn.call(windowStub, event));
      return true;
    },
    setTimeout: (fn, delay) => scheduleTimer(fn, delay, false, delay),
    clearTimeout: clearTimer,
    setInterval: (fn, delay) => scheduleTimer(fn, delay, true, delay),
    clearInterval: clearTimer,
    navigator: { userActivation: { isActive: true } },
    performance: { now: () => now },
    console,
    crypto: {
      randomUUID() { return `test-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
    },
    // Session enforcement flags - will be set per test
    XP_REQUIRE_SERVER_SESSION: false,
    XP_SERVER_SESSION_WARN_MODE: false,
    // XP config
    XP_REQUIRE_SCORE: 0,
    XP_ACTIVE_GRACE_MS: 2_000,
    XP_TICK_MS: 1_000,
    XP_AWARD_INTERVAL_MS: 1_000,
    XP_MIN_EVENTS_PER_TICK: 1,
    XP_HARD_IDLE_MS: 6_000,
    XP_BASELINE_XP_PER_SECOND: 10,
    // KLog mock for logDebug
    KLog: {
      log(kind, data) {
        debugLogs.push({ kind, data });
        return true;
      },
      isAdmin() { return true; },
      isRecording() { return true; },
      startRecording() { return true; },
    },
  };

  // Mock fetch for start-session
  async function fetchMock(url, options) {
    if (url.includes('start-session')) {
      if (sessionFetchShouldFail) {
        throw new Error('Session fetch failed');
      }
      sessionToken = `test-token-${Date.now()}`;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          sessionId: `session-${Date.now()}`,
          sessionToken,
          expiresIn: 604800,
        }),
        text: async () => JSON.stringify({ ok: true }),
      };
    }
    // award-xp endpoint
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, scoreDelta: 10 }),
      text: async () => JSON.stringify({ ok: true }),
    };
  }

  windowStub.window = windowStub;
  documentStub.defaultView = windowStub;

  const context = {
    window: windowStub,
    document: documentStub,
    location: windowStub.location,
    console,
    setTimeout: windowStub.setTimeout,
    clearTimeout: windowStub.clearTimeout,
    setInterval: windowStub.setInterval,
    clearInterval: windowStub.clearInterval,
    Date: DateMock,
    Event: EventShim,
    CustomEvent: CustomEventShim,
    fetch: fetchMock,
    navigator: windowStub.navigator,
    performance: windowStub.performance,
    crypto: windowStub.crypto,
  };

  vm.createContext(context);

  // Boot scripts in order
  const bootScripts = [
    { code: xpClientSource, name: 'xpClient.js' },
    { code: comboSource, name: 'xp/combo.js' },
    { code: scoringSource, name: 'xp/scoring.js' },
    { code: instrumentedCore, name: 'xp/core.js' },
    { code: xpShellSource, name: 'xp.js' },
  ];

  for (const entry of bootScripts) {
    new vm.Script(entry.code, { filename: entry.name }).runInContext(context);
  }

  // Wrap postWindow to track calls
  const originalPostWindow = context.window.XPClient.postWindow;
  context.window.XPClient.postWindow = async function(payload) {
    postWindowCalls.push({ ...payload });
    return originalPostWindow.call(this, payload);
  };

  return context;
}

// Test 1: Enforce mode - no token → sendWindow blocks
async function test_enforce_mode_blocks_without_token() {
  const context = createTestContext();
  const windowStub = context.window;
  const XP = windowStub.XP;
  const getState = windowStub.__xpTestHook;

  // Set enforce mode and make session fetch fail
  windowStub.XP_REQUIRE_SERVER_SESSION = true;
  windowStub.XP_SERVER_SESSION_WARN_MODE = false;
  sessionFetchShouldFail = true;

  // Start session
  XP.startSession('test-game');
  await settleMicrotasks();
  advanceTime(100);
  await settleMicrotasks();

  // Simulate activity and advance through multiple ticks to trigger sendWindow
  const state = getState();
  const CHUNK_MS = 10_000;
  const AWARD_INTERVAL = 1_000;

  // Simulate active gameplay for enough time to trigger sendWindow
  for (let i = 0; i < 15; i++) {
    state.lastInputAt = DateMock.now();
    state.lastTrustedInputTs = DateMock.now();
    state.eventsSinceLastAward = 5;
    state.activeUntil = DateMock.now() + 2000;
    state.visibilitySeconds = 10;
    state.inputEvents = 10;
    advanceTime(AWARD_INTERVAL);
    await settleMicrotasks();
  }

  // Verify postWindow was NOT called (blocked)
  assert.equal(postWindowCalls.length, 0, 'postWindow should not be called when enforce mode is on and no token');

  // Verify blocked log was emitted
  const blockedLog = debugLogs.find(log => log.kind === 'send_blocked_no_session');
  assert(blockedLog, 'should log send_blocked_no_session when blocked');

  console.log('  [PASS] Enforce mode blocks requests without token');
}

// Test 2: With valid token → attaches token and calls postWindow
async function test_with_token_attaches_and_sends() {
  const context = createTestContext();
  const windowStub = context.window;
  const XP = windowStub.XP;
  const getState = windowStub.__xpTestHook;

  // Set enforce mode but allow session to succeed
  windowStub.XP_REQUIRE_SERVER_SESSION = true;
  windowStub.XP_SERVER_SESSION_WARN_MODE = false;
  sessionFetchShouldFail = false;

  // Start session
  XP.startSession('test-game');
  await settleMicrotasks();
  advanceTime(100);
  await settleMicrotasks();

  // Simulate activity and advance through multiple ticks to trigger sendWindow
  const state = getState();
  const AWARD_INTERVAL = 1_000;

  for (let i = 0; i < 15; i++) {
    state.lastInputAt = DateMock.now();
    state.lastTrustedInputTs = DateMock.now();
    state.eventsSinceLastAward = 5;
    state.activeUntil = DateMock.now() + 2000;
    state.visibilitySeconds = 10;
    state.inputEvents = 10;
    advanceTime(AWARD_INTERVAL);
    await settleMicrotasks();
  }

  // Verify postWindow was called with token
  assert(postWindowCalls.length > 0, 'postWindow should be called when token is available');
  const lastCall = postWindowCalls[postWindowCalls.length - 1];
  assert(lastCall.sessionToken, 'payload should include sessionToken');
  assert(lastCall.sessionToken.startsWith('test-token'), 'sessionToken should be the one from start-session');

  console.log('  [PASS] Valid token is attached and request proceeds');
}

// Test 3: Warn mode - session fails → still sends, logs warning
async function test_warn_mode_sends_without_token() {
  const context = createTestContext();
  const windowStub = context.window;
  const XP = windowStub.XP;
  const getState = windowStub.__xpTestHook;

  // Set warn mode and make session fetch fail
  windowStub.XP_REQUIRE_SERVER_SESSION = false;
  windowStub.XP_SERVER_SESSION_WARN_MODE = true;
  sessionFetchShouldFail = true;

  // Start session
  XP.startSession('test-game');
  await settleMicrotasks();
  advanceTime(100);
  await settleMicrotasks();

  // Simulate activity and advance through multiple ticks to trigger sendWindow
  const state = getState();
  const AWARD_INTERVAL = 1_000;

  for (let i = 0; i < 15; i++) {
    state.lastInputAt = DateMock.now();
    state.lastTrustedInputTs = DateMock.now();
    state.eventsSinceLastAward = 5;
    state.activeUntil = DateMock.now() + 2000;
    state.visibilitySeconds = 10;
    state.inputEvents = 10;
    advanceTime(AWARD_INTERVAL);
    await settleMicrotasks();
  }

  // Verify postWindow WAS called (warn mode allows it)
  assert(postWindowCalls.length > 0, 'postWindow should be called in warn mode even without token');

  // Verify the call did NOT have a sessionToken
  const lastCall = postWindowCalls[postWindowCalls.length - 1];
  assert(!lastCall.sessionToken, 'payload should NOT have sessionToken when session failed');

  // Verify warn log was emitted
  const warnLog = debugLogs.find(log => log.kind === 'send_without_session_warn');
  assert(warnLog, 'should log send_without_session_warn in warn mode');

  console.log('  [PASS] Warn mode sends request without token and logs warning');
}

// Test 4: Session expiry triggers re-fetch
async function test_session_expiry_triggers_refetch() {
  const context = createTestContext();
  const windowStub = context.window;
  const XPClient = windowStub.XPClient;

  sessionFetchShouldFail = false;

  // Manually set an expired session in localStorage
  const ls = windowStub.localStorage;
  ls.setItem('kcswh:serverSessionToken', 'old-token');
  ls.setItem('kcswh:serverSessionExpires', String(DateMock.now() - 1000)); // Expired

  // Call ensureServerSession - should detect expiry and fetch new
  const result = await XPClient.ensureServerSession();

  assert(result.token, 'should return a new token after expiry');
  assert(result.token !== 'old-token', 'should have fetched a new token');
  assert(result.token.startsWith('test-token'), 'should be a fresh token from start-session');

  console.log('  [PASS] Session expiry triggers re-fetch');
}

// Test 5: Concurrent ensureServerSession calls share promise
async function test_concurrent_calls_share_promise() {
  const context = createTestContext();
  const windowStub = context.window;
  const XPClient = windowStub.XPClient;

  sessionFetchShouldFail = false;

  // Clear any existing session
  windowStub.localStorage.clear();

  // Make two concurrent calls
  const promise1 = XPClient.ensureServerSession();
  const promise2 = XPClient.ensureServerSession();

  const [result1, result2] = await Promise.all([promise1, promise2]);

  // Both should return the same token (from the same fetch)
  assert.equal(result1.token, result2.token, 'concurrent calls should return the same token');

  console.log('  [PASS] Concurrent ensureServerSession calls share the same promise');
}

// Run all tests
(async () => {
  console.log('Running XP session gate tests...');

  await test_enforce_mode_blocks_without_token();
  await test_with_token_attaches_and_sends();
  await test_warn_mode_sends_without_token();
  await test_session_expiry_triggers_refetch();
  await test_concurrent_calls_share_promise();

  console.log('\nAll XP session gate tests passed!');
})();
