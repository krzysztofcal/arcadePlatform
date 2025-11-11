import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const xpSource = await readFile(path.join(__dirname, '..', 'js', 'xp.js'), 'utf8');
const injectionTarget = '})(typeof window !== "undefined" ? window : this, typeof document !== "undefined" ? document : undefined);';
if (!xpSource.includes(injectionTarget)) {
  throw new Error('xp.js format mismatch');
}
const instrumented = xpSource.replace(
  injectionTarget,
  '  if (window && !window.__xpTestHook) { window.__xpTestHook = () => state; }\n' +
    injectionTarget
);

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
  await Promise.resolve();
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
const xpStatusCalls = [];

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
  location: { origin: 'https://example.test', pathname: '/games/unit-test' },
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
  XP_MIN_EVENTS_PER_TICK: 1,
  XP_FLUSH_ENDPOINT: 'https://example.test/flush',
  XP_BASELINE_XP_PER_SECOND: 10,
  XP_HARD_IDLE_MS: 6_000,
  XPClient: {
    postWindow(payload) {
      xpWindowCalls.push(payload);
      return Promise.resolve({ ok: true, scoreDelta: 0 });
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
  comboCount: 4,
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
new vm.Script(instrumented, { filename: 'xp.js' }).runInContext(context);
new vm.Script(xpHookSource, { filename: 'xp-game-hook.js' }).runInContext(context);
new vm.Script(xpOverlaySource, { filename: 'xp-overlay.js' }).runInContext(context);

const XP = context.window.XP;
assert(XP, 'XP API not initialized');
const getState = context.window.__xpTestHook;
assert.equal(typeof getState, 'function', 'state hook missing');
const GameXpBridge = context.window.GameXpBridge;
assert(GameXpBridge, 'GameXpBridge missing');
const XPOverlay = context.window.XPOverlay;
assert(XPOverlay && XPOverlay.__test && typeof XPOverlay.__test.attach === 'function', 'XPOverlay test interface missing');

const AWARD_INTERVAL_MS = windowStub.XP_AWARD_INTERVAL_MS;
const HARD_IDLE_MS = windowStub.XP_HARD_IDLE_MS;

function setVisibility(hidden) {
  documentStub.hidden = hidden;
  documentStub.visibilityState = hidden ? 'hidden' : 'visible';
}

function trigger(type, target, eventInit = {}) {
  const evt = new EventShim(type, eventInit);
  target.dispatchEvent(evt);
}

function markActiveWindow({ ratio = 1, events = 1, trusted = true } = {}) {
  const state = getState();
  const clamped = Math.max(0, Math.min(1, ratio));
  state.lastInputAt = DateMock.now();
  if (trusted) {
    state.lastTrustedInputTs = DateMock.now();
  }
  state.eventsSinceLastAward = Math.max(events, 1);
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
  const awarded = runTick(options);
  await settleFlush();
  return awarded;
}

async function settleFlush() {
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
  state.regen.comboCount = 0;
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
assert.equal(hydrated.regen.comboCount, 4);
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
  comboCount: 1,
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
  comboCount: 0,
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

// Tick loop awards roughly baseline XP and scales with activity
const lowerActivity = await runTickAndSettle({ ratio: 0.4 });
const fullActivity = await runTickAndSettle({ ratio: 1 });
assert(fullActivity >= 9 && fullActivity <= 20, `expected ~10-20xp, got ${fullActivity}`);
assert(lowerActivity < fullActivity, 'lower activity should yield less XP');

// Combo momentum increases awards over consecutive high-activity ticks
const comboBoost = await runTickAndSettle({ ratio: 1 });
assert(comboBoost > fullActivity, 'combo bonus should increase XP on streaks');

// Boost doubles payouts until expiration
XP.requestBoost(2, 4_000, 'unit-test');
const boosted = await runTickAndSettle({ ratio: 1 });
assert(boosted > comboBoost, 'boost should increase awards');
assert(boosted >= 20, 'boost should elevate awards near the cap');
advanceTime(4_100);
await settleFlush();
const afterBoost = await runTickAndSettle({ ratio: 1 });
assert(afterBoost < boosted, 'boost should expire after TTL');

// Cap prevents further awards once reached
const state = getState();
state.cap = Math.floor(state.totalToday) + Math.floor(afterBoost);
await runTickAndSettle({ ratio: 1 });
const capped = await runTickAndSettle({ ratio: 1 });
assert.equal(capped, 0, 'cap should block awards');
state.cap = null;

// Anti-idle: hard idle freezes activity until new input
state.lastTrustedInputTs = DateMock.now() - (HARD_IDLE_MS + 10);
const paused = await runTickAndSettle({ ratio: 1, trusted: false });
assert.equal(paused, 0, 'hard idle should prevent awards');
assert.equal(state.activityWindowFrozen, true);
assert.equal(state.phase, 'paused', 'hard idle should pause ticker');
XP.nudge();
assert.equal(state.activityWindowFrozen, false, 'nudge should unfreeze activity window');
state.phase = 'running';
const unfrozen = await runTickAndSettle({ ratio: 1 });
assert(unfrozen > 0, 'new input should resume awards');

// xp:boost events hydrate boosts
const boostListeners = getListeners(windowListeners, 'xp:boost');
assert(boostListeners.length > 0, 'xp:boost listener should be registered');
boostListeners[0]({ detail: { multiplier: 3, durationMs: 2_000, source: 'event' } });
const boostedByEvent = await runTickAndSettle({ ratio: 1 });
assert(boostedByEvent > unfrozen, 'xp:boost event should amplify awards');
assert(boostedByEvent >= 20, 'xp:boost event should approach the cap');
advanceTime(2_100);
await settleFlush();

// Flush batching by threshold and interval expiry
resetNetworkStubs();
freshSession('flush-behavior');
let totalAwarded = 0;
let beforeFlush = 0;
while (flushRequests.length === 0) {
  beforeFlush = totalAwarded;
  totalAwarded += await runTickAndSettle({ ratio: 1 });
}
const firstFlushPayload = JSON.parse(flushRequests[0].options.body);
assert(beforeFlush < firstFlushPayload.pending, 'flush should wait until batch threshold is reached');
assert(firstFlushPayload.pending >= 25, 'flush batches at least 25 XP');
assert.equal(getState().flush.pending, 0);

// Interval expiry triggers flush even below threshold
await runTickAndSettle({ ratio: 0.2 });
const pendingAfterAward = getState().flush.pending;
advanceTime(15_500);
await settleFlush();
const secondFlushPayload = JSON.parse(flushRequests[1].options.body);
assert(secondFlushPayload.pending === pendingAfterAward, 'interval expiry should flush remaining pending XP');
assert.equal(getState().flush.pending, 0);

// Document hidden triggers flush and pause activity
await runTickAndSettle({ ratio: 1 });
setVisibility(true);
trigger('visibilitychange', documentStub);
await settleFlush();
assert(getState().phase !== 'running', 'hidden document should pause ticker');
setVisibility(false);
trigger('visibilitychange', documentStub);

// Flush failure restores pending counts
resetNetworkStubs();
await runTickAndSettle({ ratio: 1 });
fetchShouldFail = true;
const pendingBeforeFailure = getState().flush.pending;
await XP.flushXp(true).catch(() => {});
await settleFlush();
assert.equal(getState().flush.pending, pendingBeforeFailure, 'pending XP should be restored after failure');
fetchShouldFail = false;
await XP.flushXp(true);
await settleFlush();
assert.equal(getState().flush.pending, 0, 'successful flush should clear pending');

console.log('xp-client tests passed');
