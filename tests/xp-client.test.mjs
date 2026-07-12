import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const comboSource = await readFile(path.join(__dirname, '..', 'js', 'xp', 'combo.js'), 'utf8');
const scoringSource = await readFile(path.join(__dirname, '..', 'js', 'xp', 'scoring.js'), 'utf8');
const xpCoreSource = await readFile(path.join(__dirname, '..', 'js', 'xp', 'core.js'), 'utf8');
const xpShellSource = await readFile(path.join(__dirname, '..', 'js', 'xp.js'), 'utf8');
const hookMarker = '  } catch (_) {}\n}';
const hookIndex = xpCoreSource.lastIndexOf(hookMarker);
if (hookIndex === -1) {
  throw new Error('xp core format mismatch');
}
const hookPrefix = xpCoreSource.slice(0, hookIndex);
const hookSuffix = xpCoreSource.slice(hookIndex + hookMarker.length);
const hookSnippet = '  } catch (_) {}\n  if (window && !window.__xpTestHook) { window.__xpTestHook = () => state; }\n}';
const instrumentedCore = `${hookPrefix}${hookSnippet}${hookSuffix}`;

const xpHookSource = await readFile(path.join(__dirname, '..', 'js', 'xp-game-hook.js'), 'utf8');
const xpOverlaySource = await readFile(path.join(__dirname, '..', 'js', 'ui', 'xp-overlay.js'), 'utf8');

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
  if (next.length) {
    store.set(key, next);
  } else {
    store.delete(key);
  }
}

function getListeners(store, type) {
  return store.get(String(type)) || [];
}

const docListeners = new Map();
const windowListeners = new Map();
const boostEvents = [];
const tickEvents = [];

const localStorageMock = {
  __store: new Map(),
  getItem(key) {
    return this.__store.has(key) ? this.__store.get(key) : null;
  },
  setItem(key, value) {
    this.__store.set(String(key), String(value));
  },
  removeItem(key) {
    this.__store.delete(String(key));
  },
  clear() {
    this.__store.clear();
  },
};

let now = 10_000;
let nextTimerId = 1;
const timers = new Map();

function scheduleTimer(fn, delay, repeating, interval) {
  const id = nextTimerId++;
  const due = now + Math.max(0, Number.isFinite(delay) ? Number(delay) : 0);
  timers.set(id, {
    fn,
    time: due,
    repeating: !!repeating,
    interval: repeating ? Math.max(0, Number(interval || delay) || 0) : 0,
  });
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
    try {
      timer.fn();
    } catch (err) {
      console.error('timer error', err);
      throw err;
    }
    if (timer.repeating) {
      timer.time = now + timer.interval;
      timers.set(nextId, timer);
    }
  }
  now = target;
}

async function settleMicrotasks() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

class DateMock extends Date {
  constructor(...args) {
    if (args.length === 0) {
      super(now);
    } else {
      super(...args);
    }
  }
  static now() {
    return now;
  }
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

const sendBeaconCalls = [];
let sendBeaconShouldSucceed = false;
const flushRequests = [];
let fetchShouldFail = false;

async function fetchStub(url, options) {
  flushRequests.push({ url, options });
  if (fetchShouldFail) {
    throw new Error('flush-failed');
  }
  return { ok: true, status: 200 };
}

const xpWindowCalls = [];
let mockServerTotal = 0;
const xpStatusCalls = [];
const overlayBursts = [];

const documentStub = {
  readyState: 'complete',
  hidden: false,
  visibilityState: 'visible',
  body: {
    dataset: { gameHost: '1', gameSlug: 'unit-test', gameId: 'unit-test' },
    hasAttribute(name) {
      return name === 'data-game-host';
    },
    getAttribute(name) {
      if (name === 'data-game-id') return 'unit-test';
      if (name === 'data-game-host') return '1';
      return null;
    },
    appendChild() {},
    classList: { add() {}, remove() {}, toggle() {} },
    contains() { return false; },
    querySelector() { return null; },
  },
  addEventListener(type, handler) {
    addListener(docListeners, type, handler);
  },
  removeEventListener(type, handler) {
    removeListener(docListeners, type, handler);
  },
  dispatchEvent(event) {
    getListeners(docListeners, event.type).forEach((fn) => {
      fn.call(documentStub, event);
    });
    return true;
  },
  getElementById() {
    return null;
  },
  createElement() {
    return {
      className: '',
      textContent: '',
      appendChild() {},
      classList: { add() {}, remove() {}, toggle() {} },
      contains() { return false; },
      querySelector() { return null; },
    };
  },
  createEvent(type) {
    return {
      type,
      detail: null,
      initCustomEvent(eventType, _bubbles, _cancelable, detail) {
        this.type = eventType;
        this.detail = detail;
      },
    };
  },
};

const windowStub = {
  document: documentStub,
  location: { origin: 'https://example.test', pathname: '/games/unit-test', search: '' },
  localStorage: localStorageMock,
  addEventListener(type, handler) {
    addListener(windowListeners, type, handler);
  },
  removeEventListener(type, handler) {
    removeListener(windowListeners, type, handler);
  },
  dispatchEvent(event) {
    getListeners(windowListeners, event.type).forEach((fn) => {
      fn.call(windowStub, event);
    });
    return true;
  },
  setTimeout: (fn, delay) => scheduleTimer(fn, delay, false, delay),
  clearTimeout: clearTimer,
  setInterval: (fn, delay) => scheduleTimer(fn, delay, true, delay),
  clearInterval: clearTimer,
  navigator: {
    userActivation: { isActive: true },
    sendBeacon(url, data) {
      sendBeaconCalls.push({ url, data });
      return sendBeaconShouldSucceed;
    },
  },
  performance: { now: () => now },
  console,
  XP_REQUIRE_SCORE: 0,
  XP_ACTIVE_GRACE_MS: 2_000,
  XP_TICK_MS: 1_000,
  XP_AWARD_INTERVAL_MS: 1_000,
  XP_EARLY_WINDOW_MS: 2_000,
  XP_MIN_EVENTS_PER_TICK: 1,
  XP_FLUSH_ENDPOINT: 'https://example.test/flush',
  XP_BASELINE_XP_PER_SECOND: 10,
  XP_HARD_IDLE_MS: 6_000,
  XPClient: {
    postWindowServerCalc(payload) {
      xpWindowCalls.push(payload);
      mockServerTotal += 10;
      return Promise.resolve({ ok: true, awarded: 10, totalToday: mockServerTotal, totalLifetime: mockServerTotal, remaining: 3000 - mockServerTotal });
    },
    fetchStatus() {
      xpStatusCalls.push({ when: Date.now() });
      return Promise.resolve({ ok: true, totalToday: 0, cap: null, totalLifetime: 0 });
    },
  },
};
const origWindowDispatch = windowStub.dispatchEvent.bind(windowStub);
windowStub.dispatchEvent = function patchedDispatch(event) {
  if (event && event.type === 'xp:boost') {
    boostEvents.push(event);
  }
  if (event && event.type === 'xp:tick') {
    tickEvents.push(event);
  }
  return origWindowDispatch(event);
};
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
  fetch: fetchStub,
  navigator: windowStub.navigator,
  performance: windowStub.performance,
};

const RUNTIME_CACHE_KEY = 'kcswh:xp:regen';
const CACHE_KEY = 'kcswh:xp:last';

localStorageMock.setItem(RUNTIME_CACHE_KEY, JSON.stringify({
  carry: 1.4,
  momentum: 0.35,
  combo: {
    mode: 'build',
    multiplier: 5,
    points: 0.6,
    stepThreshold: 2,
    sustainLeftMs: 0,
    cooldownLeftMs: 0,
    cap: 20,
  },
  pending: 18,
  flushPending: 26,
  lastSync: 55_000,
  boost: { multiplier: 3, expiresAt: now + 5_000, source: 'storage' },
}));
localStorageMock.setItem(CACHE_KEY, JSON.stringify({
  totalToday: 120,
  cap: 900,
  totalLifetime: 4_200,
  badgeShownXp: 4_150,
  serverTotalXp: 4_250,
  badgeBaselineXp: 4_000,
  ts: 42_000,
}));

vm.createContext(context);
const bootScripts = [
  { code: comboSource, name: 'xp/combo.js' },
  { code: scoringSource, name: 'xp/scoring.js' },
  { code: instrumentedCore, name: 'xp/core.js' },
  { code: xpShellSource, name: 'xp.js' },
  { code: xpHookSource, name: 'xp-game-hook.js' },
  { code: xpOverlaySource, name: 'xp-overlay.js' },
];
for (const entry of bootScripts) {
  new vm.Script(entry.code, { filename: entry.name }).runInContext(context);
}

const XP = context.window.XP;
assert(XP, 'XP API not initialized');
const getState = context.window.__xpTestHook;
assert.equal(typeof getState, 'function', 'state hook missing');
const GameXpBridge = context.window.GameXpBridge;
assert(GameXpBridge, 'GameXpBridge missing');
const XPOverlay = context.window.XPOverlay;
assert(XPOverlay && XPOverlay.__test && typeof XPOverlay.__test.attach === 'function', 'XPOverlay test interface missing');
XPOverlay.__test.attach();
const overlaySpy = (args) => {
  overlayBursts.push(Object.assign({}, args));
};
if (context.window.XpOverlay) {
  context.window.XpOverlay.showBurst = overlaySpy;
}
XPOverlay.showBurst = overlaySpy;
if (XPOverlay.__test) {
  XPOverlay.__test.showBurst = overlaySpy;
}

const AWARD_INTERVAL_MS = windowStub.XP_AWARD_INTERVAL_MS;
const HARD_IDLE_MS = windowStub.XP_HARD_IDLE_MS;
const COMBO_SUSTAIN_MS = 5_000;
const COMBO_COOLDOWN_MS = 3_000;

function setVisibility(hidden) {
  documentStub.hidden = hidden;
  documentStub.visibilityState = hidden ? 'hidden' : 'visible';
}

function trigger(type, target, eventInit = {}) {
  const evt = new EventShim(type, eventInit);
  target.dispatchEvent(evt);
}

function markActiveWindow({ ratio = 1, events = 3, trusted = true } = {}) {
  const state = getState();
  const clamped = Math.max(0, Math.min(1, ratio));
  state.lastInputAt = DateMock.now();
  if (trusted) {
    state.lastTrustedInputTs = DateMock.now();
  }
  state.eventsSinceLastAward = Math.max(events, 1);
  state.inputEvents += Math.max(events, 1);
  state.gameplayActionsInWindow += 1;
  state.activeUntil = DateMock.now() + clamped * AWARD_INTERVAL_MS;
}

function runTick(options) {
  markActiveWindow(options);
  const before = Number(getState().sessionXp) || 0;
  advanceTime(AWARD_INTERVAL_MS);
  const after = Number(getState().sessionXp) || 0;
  return after - before;
}

async function runTickAndSettle(options) {
  const before = Number(getState().sessionXp) || 0;
  runTick(options);
  await settleFlush();
  return (Number(getState().sessionXp) || 0) - before;
}

function getLastTickDetail() {
  const last = tickEvents[tickEvents.length - 1];
  if (!last || !last.detail || typeof last.detail !== 'object') return null;
  return last.detail;
}

async function combo_cap_and_sustain() {
  const cap = (getState().combo && getState().combo.cap) || 20;
  let guard = 0;
  while ((getState().combo && getState().combo.multiplier) < cap && guard < 200) {
    await runTickAndSettle({ ratio: 1 });
    guard += 1;
  }
  const combo = getState().combo;
  assert(combo, 'combo state should exist at cap');
  assert.equal(combo.multiplier, cap, 'combo should reach the cap');
  assert.equal(combo.mode, 'sustain', 'combo should enter sustain at cap');
  const detail = getLastTickDetail();
  assert(detail && detail.mode === 'sustain', 'xp:tick should report sustain mode');
  assert(detail && detail.progressToNext <= 1 && detail.progressToNext >= 0, 'progress should be normalized');
  const sustainTicks = Math.max(0, Math.ceil(COMBO_SUSTAIN_MS / AWARD_INTERVAL_MS) - 1);
  for (let i = 0; i < sustainTicks; i++) {
    await runTickAndSettle({ ratio: 1 });
    const sustainDetail = getLastTickDetail();
    assert(sustainDetail && sustainDetail.mode === 'sustain', 'sustain should persist during timer');
    assert(sustainDetail.progressToNext <= 1 && sustainDetail.progressToNext >= 0, 'sustain progress must remain bounded');
  }
}

async function combo_cooldown_blocks_build() {
  let guard = 0;
  while (getState().combo && getState().combo.mode !== 'cooldown' && guard < 10) {
    await runTickAndSettle({ ratio: 1 });
    guard += 1;
  }
  const combo = getState().combo;
  assert(combo && combo.mode === 'cooldown', 'combo should enter cooldown after sustain');
  assert.equal(combo.multiplier, 1, 'cooldown should reset multiplier');
  const detail = getLastTickDetail();
  assert(detail && detail.mode === 'cooldown', 'xp:tick should report cooldown mode');
  assert.equal(detail.progressToNext, 0, 'cooldown progress must lock at zero');
  const cooldownTicks = Math.max(0, Math.ceil(COMBO_COOLDOWN_MS / AWARD_INTERVAL_MS) - 1);
  for (let i = 0; i < cooldownTicks; i++) {
    await runTickAndSettle({ ratio: 1 });
    const cooldownDetail = getLastTickDetail();
    assert(cooldownDetail && cooldownDetail.mode === 'cooldown', 'cooldown should persist for full timer');
    assert.equal(cooldownDetail.progressToNext, 0, 'cooldown progress should remain locked');
    assert.equal(getState().combo.multiplier, 1, 'multiplier should remain at baseline during cooldown');
  }
}

async function combo_rebuild_after_cooldown() {
  let guard = 0;
  while (getState().combo && getState().combo.mode === 'cooldown' && guard < 10) {
    await runTickAndSettle({ ratio: 1 });
    guard += 1;
  }
  const combo = getState().combo;
  assert(combo && combo.mode === 'build', 'combo should return to build after cooldown');
  const baseline = combo.multiplier;
  await runTickAndSettle({ ratio: 1 });
  assert(getState().combo.multiplier >= baseline, 'combo multiplier should not regress after rebuild tick');
  let rebuildGuard = 0;
  while (getState().combo.multiplier <= baseline && rebuildGuard < 40) {
    await runTickAndSettle({ ratio: 1 });
    rebuildGuard += 1;
  }
  assert(getState().combo.multiplier > baseline, 'combo should begin rebuilding after cooldown');
}

function combo_no_stuck_values() {
  assert(tickEvents.length > 0, 'xp:tick should emit events during combo lifecycle');
  tickEvents.forEach((event) => {
    if (!event || !event.detail || typeof event.detail !== 'object') return;
    const detail = event.detail;
    const combo = detail.combo;
    assert(combo && typeof combo === 'object', 'tick detail should include combo payload');
    assert(combo.multiplier >= 1 && combo.multiplier <= combo.cap, 'multiplier must stay within cap bounds');
    assert(detail.progressToNext >= 0 && detail.progressToNext <= 1, 'progressToNext should stay normalized');
    assert(['build', 'sustain', 'cooldown'].includes(detail.mode), 'combo mode should be known');
  });
}

async function settleFlush() {
  const pendingWindow = getState().pending;
  if (pendingWindow && typeof pendingWindow.then === 'function') {
    try {
      await pendingWindow;
    } catch (_) {}
  }
  const inflight = getState().flush && getState().flush.inflight;
  if (inflight && typeof inflight.then === 'function') {
    try {
      await inflight;
    } catch (_) {}
  }
  await settleMicrotasks();
}

function resetNetworkStubs() {
  sendBeaconCalls.length = 0;
  flushRequests.length = 0;
  fetchShouldFail = false;
  sendBeaconShouldSucceed = false;
}

function getTimerCount() {
  return timers.size;
}

function freshSession(label) {
  try { XP.stopSession({ flush: false }); } catch (_) {}
  advanceTime(0);
  XP.startSession(label);
  advanceTime(0);
  const state = getState();
  state.sessionXp = 0;
  state.regen.pending = 0;
  state.regen.carry = 0;
  state.regen.momentum = 0;
  state.combo = {
    mode: 'build',
    multiplier: 1,
    points: 0,
    stepThreshold: 1,
    sustainLeftMs: 0,
    cooldownLeftMs: 0,
    cap: (state.combo && Number(state.combo.cap)) || 20,
  };
  state.flush.pending = 0;
  state.flush.lastSync = DateMock.now();
  state.totalToday = 0;
  state.totalLifetime = 0;
  state.cap = null;
  state.boost = { multiplier: 1, expiresAt: 0, source: null };
  state.boostTimerId = null;
  localStorageMock.removeItem(RUNTIME_CACHE_KEY);
}

// Hydration from localStorage and getFlushStatus coverage
const hydrated = getState();
assert.equal(hydrated.regen.pending, 18);
assert(hydrated.combo, 'combo state should hydrate');
assert.equal(hydrated.combo.mode, 'build');
assert.equal(hydrated.combo.multiplier, 5);
assert.equal(hydrated.flush.pending, 26);
assert.equal(hydrated.boost.multiplier, 3);
const hydrationBoostEvent = boostEvents.find((event) => event && event.type === 'xp:boost'
  && event.detail && Number(event.detail.multiplier) > 1 && Number(event.detail.ttlMs) > 0);
assert(hydrationBoostEvent, 'should emit xp:boost on hydration with active boost');
const status = XP.getFlushStatus();
assert.equal(status.pending, 26);
assert.equal(status.lastSync, 55_000);
assert.equal(status.inflight, false);

// BFCache/pageshow hydration refreshes runtime state and boosts
localStorageMock.setItem(RUNTIME_CACHE_KEY, JSON.stringify({
  carry: 0,
  momentum: 0,
  combo: {
    mode: 'build',
    multiplier: 3,
    points: 0.4,
    stepThreshold: 2,
    sustainLeftMs: 0,
    cooldownLeftMs: 0,
    cap: 20,
  },
  pending: 7,
  flushPending: 12,
  lastSync: 77_000,
  boost: { multiplier: 2, expiresAt: DateMock.now() + 3_000, source: 'pageshow' },
}));
trigger('pageshow', windowStub);
const hydratedAfterPageShow = getState();
assert.equal(hydratedAfterPageShow.flush.pending, 12);
assert.equal(hydratedAfterPageShow.boost.source, 'pageshow');

const beforeOffEventCount = boostEvents.length;
localStorageMock.setItem(RUNTIME_CACHE_KEY, JSON.stringify({
  carry: 0,
  momentum: 0,
  combo: {
    mode: 'cooldown',
    multiplier: 1,
    points: 0,
    stepThreshold: 1,
    sustainLeftMs: 0,
    cooldownLeftMs: 500,
    cap: 20,
  },
  pending: 0,
  flushPending: 0,
  lastSync: 77_500,
  boost: { multiplier: 4, expiresAt: DateMock.now() - 5, source: 'expired-hydration' },
}));
trigger('pageshow', windowStub);
const offEvent = boostEvents.slice(beforeOffEventCount).find((event) => event && event.type === 'xp:boost'
  && event.detail && Number(event.detail.multiplier) === 1 && Number(event.detail.ttlMs) === 0);
assert(offEvent, 'should emit xp:boost off signal when hydrated boost is expired');

freshSession('tick-baseline');

overlayBursts.length = 0;

// Partial activity does not manufacture local XP before a server window is sent.
const lowerActivity = await runTickAndSettle({ ratio: 0.4 });
assert.equal(lowerActivity, 0, 'client must not calculate provisional XP locally');
assert.equal(overlayBursts.length, 0, 'overlay must wait for an authoritative response');

assert.equal(typeof windowStub.XPClient.postWindowServerCalc, 'function', 'authoritative transport must be available');

console.log('xp-client tests passed');
