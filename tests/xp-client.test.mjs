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

class ElementStub {
  constructor(tag) {
    this.nodeName = String(tag || "div").toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = Object.create(null);
    this.style = {};
    this.dataset = {};
    this.__className = "";
    this.textContent = "";
    this.id = "";
    this.hidden = false;
    this.__listeners = new Map();
    const classSet = new Set();
    const syncClassName = () => { this.__className = Array.from(classSet).join(" "); };
    Object.defineProperty(this, 'className', {
      get: () => this.__className,
      set: (value) => {
        classSet.clear();
        if (value) {
          String(value).split(/\s+/).filter(Boolean).forEach((token) => classSet.add(token));
        }
        syncClassName();
      },
      enumerable: true,
    });
    this.classList = {
      add: (...tokens) => {
        tokens.forEach((token) => { if (token) classSet.add(String(token)); });
        syncClassName();
      },
      remove: (...tokens) => {
        tokens.forEach((token) => { classSet.delete(String(token)); });
        syncClassName();
      },
      contains: (token) => classSet.has(String(token)),
      toggle: (token, force) => {
        const key = String(token);
        const shouldAdd = force == null ? !classSet.has(key) : !!force;
        if (shouldAdd) classSet.add(key); else classSet.delete(key);
        syncClassName();
        return shouldAdd;
      },
    };
    this.className = "";
  }

  setAttribute(name, value) {
    const key = String(name);
    this.attributes[key] = String(value);
    if (key === "id") this.id = String(value);
    if (key === "hidden") this.hidden = true;
  }

  removeAttribute(name) {
    const key = String(name);
    delete this.attributes[key];
    if (key === "id") this.id = "";
    if (key === "hidden") this.hidden = false;
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, String(name));
  }

  getAttribute(name) {
    return this.attributes[String(name)] ?? null;
  }

  appendChild(child) {
    if (!child) return child;
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  contains(node) {
    if (node === this) return true;
    for (const child of this.children) {
      if (child === node || (child.contains && child.contains(node))) return true;
    }
    return false;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  addEventListener(type, handler) {
    const key = String(type);
    const list = this.__listeners.get(key) || [];
    list.push(handler);
    this.__listeners.set(key, list);
  }

  removeEventListener(type, handler) {
    const key = String(type);
    if (!this.__listeners.has(key)) return;
    if (!handler) {
      this.__listeners.delete(key);
      return;
    }
    const next = this.__listeners.get(key).filter((fn) => fn !== handler);
    if (next.length) this.__listeners.set(key, next); else this.__listeners.delete(key);
  }

  dispatchEvent(event) {
    const handlers = this.__listeners.get(event.type) || [];
    handlers.slice().forEach((fn) => {
      try { fn.call(this, event); } catch (_) {}
    });
    return true;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const match = (element) => {
      const sel = String(selector);
      if (!sel) return false;
      if (sel.startsWith("#")) {
        return element.id === sel.slice(1);
      }
      if (sel.startsWith(".")) {
        return element.classList.contains(sel.slice(1));
      }
      return element.nodeName === sel.toUpperCase();
    };
    const traverse = (node) => {
      node.children.forEach((child) => {
        if (match(child)) results.push(child);
        if (child.children && child.children.length) traverse(child);
      });
    };
    traverse(this);
    return results;
  }

  get firstElementChild() {
    return this.children.find((child) => child != null) || null;
  }

  get childElementCount() {
    return this.children.length;
  }

  get isConnected() {
    let node = this;
    while (node) {
      if (node === documentStub.body) return true;
      node = node.parentNode;
    }
    return false;
  }

  get offsetWidth() {
    return 0;
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

const documentBody = new ElementStub('body');
documentBody.dataset = { gameHost: '1', gameSlug: 'unit-test', gameId: 'unit-test' };
documentBody.setAttribute('data-game-host', '1');
documentBody.setAttribute('data-game-id', 'unit-test');

const documentStub = {
  readyState: 'complete',
  hidden: false,
  visibilityState: 'visible',
  body: documentBody,
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
  getElementById(id) {
    return documentBody.querySelector(`#${id}`);
  },
  querySelector(selector) {
    return documentBody.querySelector(selector);
  },
  querySelectorAll(selector) {
    return documentBody.querySelectorAll(selector);
  },
  createElement(tag) {
    return new ElementStub(tag);
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

const xpHookSource = await readFile(path.join(__dirname, '..', 'js', 'xp-game-hook.js'), 'utf8');
new vm.Script(xpHookSource, { filename: 'xp-game-hook.js' }).runInContext(context);

const xpOverlaySource = await readFile(path.join(__dirname, '..', 'js', 'ui', 'xp-overlay.js'), 'utf8');
new vm.Script(xpOverlaySource, { filename: 'xp-overlay.js' }).runInContext(context);

const XP = context.window.XP;
assert(XP, 'XP API not initialized');
const getState = context.window.__xpTestHook;
assert.equal(typeof getState, 'function', 'state hook missing');

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

function freshSession(label) {
  const bridge = windowStub.GameXpBridge;
  if (bridge && typeof bridge.stop === 'function') {
    try { bridge.stop({ flush: false }); } catch (_) {}
  } else {
    try { XP.stopSession({ flush: false }); } catch (_) {}
  }
  advanceTime(0);
  if (bridge && typeof bridge.start === 'function') {
    try { bridge.start(label); } catch (_) {}
  } else {
    XP.startSession(label);
  }
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

freshSession('tick-baseline');

// Tick loop awards roughly baseline XP and scales with activity
const lowerActivity = await runTickAndSettle({ ratio: 0.4 });
const fullActivity = await runTickAndSettle({ ratio: 1 });
assert(fullActivity >= 9 && fullActivity <= 20, `expected ~10-20xp, got ${fullActivity}`);
assert(lowerActivity < fullActivity, 'lower activity should yield less XP');

const tickEvents = [];
const tickListener = (event) => { if (event && event.detail) tickEvents.push(event.detail); };
windowStub.addEventListener('xp:tick', tickListener);
const observedAward = await runTickAndSettle({ ratio: 1 });
windowStub.removeEventListener('xp:tick', tickListener);
assert(tickEvents.length > 0, 'xp:tick event should be emitted for awards');
const latestTick = tickEvents[tickEvents.length - 1];
assert.equal(latestTick.awarded, observedAward, 'xp:tick detail should match awarded amount');
assert(latestTick.combo >= 1, 'xp:tick detail should report combo streaks');
assert(latestTick.boost >= 1, 'xp:tick detail should surface boost multiplier');
assert(latestTick.ts >= DateMock.now() - 5_000, 'xp:tick detail should include a recent timestamp');
assert(latestTick.progressToNext >= 0 && latestTick.progressToNext <= 1, 'xp:tick progress should be clamped between 0 and 1');

// Combo momentum increases awards over consecutive high-activity ticks
const comboBoost = await runTickAndSettle({ ratio: 1 });
assert(comboBoost > fullActivity, 'combo bonus should increase XP on streaks');

// Boost doubles payouts until expiration
const boostEvents = [];
const boostListener = (event) => {
  if (event && event.detail && typeof event.detail.secondsLeft === 'number') {
    boostEvents.push(event.detail);
  }
};
windowStub.addEventListener('xp:boost', boostListener);
XP.requestBoost(2, 4_000, 'unit-test');
const boosted = await runTickAndSettle({ ratio: 1 });
windowStub.removeEventListener('xp:boost', boostListener);
assert(boosted > comboBoost, 'boost should increase awards');
assert(boosted >= 20, 'boost should elevate awards near the cap');
assert(boostEvents.length > 0, 'xp:boost status event should fire when boost activates');
const lastBoostEvent = boostEvents[boostEvents.length - 1];
assert.equal(lastBoostEvent.multiplier, 2, 'xp:boost detail should report the active multiplier');
assert(lastBoostEvent.secondsLeft >= 3 && lastBoostEvent.secondsLeft <= 4, 'xp:boost secondsLeft should reflect remaining time');
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

freshSession('2048');
localStorageMock.setItem('ap:hs:2048', '15');
const recordBoostEvents = [];
const recordBoostListener = (event) => { if (event && event.detail && event.detail.source) recordBoostEvents.push(event.detail); };
const recordTickDetails = [];
const recordTickListener = (event) => { if (event && event.detail) recordTickDetails.push(event.detail); };
windowStub.addEventListener('xp:boost', recordBoostListener);
windowStub.addEventListener('xp:tick', recordTickListener);

const emitScorePulse = (gameId, score) => {
  trigger('message', windowStub, { data: { type: 'game-score', gameId, score }, origin: windowStub.location.origin });
};

emitScorePulse('2048', 5);
emitScorePulse('2048', 10);
assert.equal(recordBoostEvents.length, 0, 'boost should not trigger before beating the stored record');

emitScorePulse('2048', 20);
assert(recordBoostEvents.some((detail) => detail.source === 'newRecord'), 'new record should dispatch a boost event');
const newRecordEvent = recordBoostEvents.find((detail) => detail.source === 'newRecord');
assert(newRecordEvent.secondsLeft > 0, 'new record boost should expose a countdown placeholder');
assert.equal(newRecordEvent.gameId, '2048');
await runTickAndSettle({ ratio: 1 });
const latestRecordTick = recordTickDetails[recordTickDetails.length - 1];
assert(latestRecordTick.boost >= 1.5, 'new record boost should amplify tick multipliers');
assert.equal(latestRecordTick.gameId, '2048');

windowStub.GameXpBridge.gameOver({ score: 28, gameId: '2048' });
const endRecordEvent = recordBoostEvents[recordBoostEvents.length - 1];
assert.equal(endRecordEvent.source, 'gameOver', 'gameOver should publish a terminating boost event');
assert.equal(endRecordEvent.multiplier, 1);
assert.equal(endRecordEvent.secondsLeft, 0);
await runTickAndSettle({ ratio: 1 });
const postRecordTick = recordTickDetails[recordTickDetails.length - 1];
assert(postRecordTick.boost <= 1.01, 'boost multiplier should clear after game over');
assert.equal(localStorageMock.getItem('ap:hs:2048'), '28', 'high score storage should update after finishing the run');

windowStub.removeEventListener('xp:boost', recordBoostListener);
windowStub.removeEventListener('xp:tick', recordTickListener);

recordBoostEvents.length = 0;
freshSession('2048');
localStorageMock.setItem('ap:hs:2048', '50');
windowStub.addEventListener('xp:boost', recordBoostListener);
emitScorePulse('2048', 60);
assert(recordBoostEvents.some((detail) => detail.source === 'newRecord'), 'new record boost should activate before xp:hidden');
assert(getListeners(docListeners, 'xp:hidden').length > 0, 'xp:hidden listener should be registered');
recordBoostEvents.length = 0;
trigger('pagehide', windowStub);
advanceTime(2_500);
const hiddenEvents = recordBoostEvents.filter((detail) => detail.source === 'hidden');
assert(hiddenEvents.length >= 1, 'xp:hidden should emit a boost termination event');
assert.equal(windowStub.GameXpBridge.isBoostActive(), false, 'boost state should clear after xp:hidden');
windowStub.removeEventListener('xp:boost', recordBoostListener);

const overlayRoot = documentStub.body.querySelector('#xpOverlay');
const overlayStack = overlayRoot && overlayRoot.querySelector('#xpOverlayStack');
assert(overlayRoot, 'overlay root should exist in the DOM');
windowStub.GameXpBridge.stop({ flush: false });
documentStub.hidden = true;
documentStub.visibilityState = 'hidden';
trigger('visibilitychange', documentStub);
const initialPopCount = overlayStack ? overlayStack.childElementCount : 0;
const idleTick = new CustomEventShim('xp:tick', { detail: { awarded: 5, combo: 1, boost: 1, progressToNext: 0.2, ts: DateMock.now(), gameId: 'about' } });
windowStub.dispatchEvent(idleTick);
const afterPopCount = overlayStack ? overlayStack.childElementCount : 0;
assert.equal(afterPopCount, initialPopCount, 'overlay should not render pops when no active game session is running');
assert(overlayRoot.hasAttribute('hidden'), 'overlay should remain hidden outside active gameplay');
documentStub.hidden = false;
documentStub.visibilityState = 'visible';
trigger('visibilitychange', documentStub);

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
