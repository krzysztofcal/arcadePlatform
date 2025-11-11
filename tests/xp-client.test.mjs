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

function matchesSelector(node, selector) {
  if (!node || !selector) return false;
  if (selector.startsWith('#')) {
    return node.id === selector.slice(1);
  }
  if (selector.startsWith('.')) {
    return node.classList && typeof node.classList.contains === 'function'
      ? node.classList.contains(selector.slice(1))
      : false;
  }
  return (node.tagName || '').toLowerCase() === selector.toLowerCase();
}

function traverseNodes(root, visitor) {
  if (!root || !root.children) return false;
  for (const child of root.children) {
    if (visitor(child)) return true;
    if (traverseNodes(child, visitor)) return true;
  }
  return false;
}

function collectNodes(root, selector, results) {
  if (!root || !root.children) return;
  for (const child of root.children) {
    if (matchesSelector(child, selector)) {
      results.push(child);
    }
    collectNodes(child, selector, results);
  }
}

function createNode(tagName = '') {
  const node = {
    tagName: String(tagName || '').toUpperCase(),
    id: '',
    attributes: {},
    dataset: {},
    style: {},
    hidden: false,
    textContent: '',
    children: [],
    parentNode: null,
    eventListeners: new Map(),
  };

  const classSet = new Set();

  Object.defineProperty(node, 'className', {
    get() {
      return Array.from(classSet).join(' ');
    },
    set(value) {
      classSet.clear();
      String(value || '')
        .split(/\s+/)
        .filter(Boolean)
        .forEach((cls) => classSet.add(cls));
    },
    enumerable: true,
  });

  node.classList = {
    add(...classes) {
      classes.forEach((cls) => {
        if (cls) classSet.add(String(cls));
      });
    },
    remove(...classes) {
      classes.forEach((cls) => classSet.delete(String(cls)));
    },
    contains(cls) {
      return classSet.has(String(cls));
    },
    toggle(cls, force) {
      const value = String(cls);
      if (force === true) {
        classSet.add(value);
        return true;
      }
      if (force === false) {
        classSet.delete(value);
        return false;
      }
      if (classSet.has(value)) {
        classSet.delete(value);
        return false;
      }
      classSet.add(value);
      return true;
    },
  };

  node.appendChild = function appendChild(child) {
    if (!child) return child;
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = node;
    node.children.push(child);
    return child;
  };

  node.removeChild = function removeChild(child) {
    if (!child) return child;
    const idx = node.children.indexOf(child);
    if (idx >= 0) {
      node.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  };

  node.insertBefore = function insertBefore(child, before) {
    if (!before || !node.children.length) {
      return node.appendChild(child);
    }
    const index = node.children.indexOf(before);
    if (index === -1) return node.appendChild(child);
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = node;
    node.children.splice(index, 0, child);
    return child;
  };

  node.setAttribute = function setAttribute(name, value) {
    const attr = String(name).toLowerCase();
    const val = String(value);
    node.attributes[attr] = val;
    if (attr === 'id') {
      node.id = val;
    } else if (attr === 'class') {
      node.className = val;
    }
  };

  node.getAttribute = function getAttribute(name) {
    const attr = String(name).toLowerCase();
    if (attr === 'id') return node.id || null;
    if (attr === 'class') return node.className || null;
    return Object.prototype.hasOwnProperty.call(node.attributes, attr) ? node.attributes[attr] : null;
  };

  node.hasAttribute = function hasAttribute(name) {
    const attr = String(name).toLowerCase();
    if (attr === 'id') return !!node.id;
    if (attr === 'class') return classSet.size > 0;
    return Object.prototype.hasOwnProperty.call(node.attributes, attr);
  };

  node.querySelector = function querySelector(selector) {
    let match = null;
    traverseNodes(node, (candidate) => {
      if (matchesSelector(candidate, selector)) {
        match = candidate;
        return true;
      }
      return false;
    });
    return match;
  };

  node.querySelectorAll = function querySelectorAll(selector) {
    const results = [];
    collectNodes(node, selector, results);
    return results;
  };

  node.contains = function contains(target) {
    if (!target) return false;
    if (target === node) return true;
    return traverseNodes(node, (candidate) => candidate === target);
  };

  node.addEventListener = function addEventListener(type, handler) {
    if (!type || typeof handler !== 'function') return;
    const key = String(type);
    const list = node.eventListeners.get(key) || [];
    list.push(handler);
    node.eventListeners.set(key, list);
  };

  node.removeEventListener = function removeEventListener(type, handler) {
    const key = String(type);
    const list = node.eventListeners.get(key);
    if (!list) return;
    const next = handler ? list.filter((fn) => fn !== handler) : [];
    if (next.length) {
      node.eventListeners.set(key, next);
    } else {
      node.eventListeners.delete(key);
    }
  };

  node.remove = function remove() {
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
  };

  return node;
}

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

const bodyNode = createNode('body');
bodyNode.dataset = { gameHost: '1', gameSlug: 'unit-test', gameId: 'unit-test' };
bodyNode.setAttribute('data-game-host', '1');
bodyNode.setAttribute('data-game-id', 'unit-test');

const documentStub = {
  readyState: 'complete',
  hidden: false,
  visibilityState: 'visible',
  body: bodyNode,
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
    return bodyNode.querySelector(`#${id}`);
  },
  querySelector(selector) {
    return bodyNode.querySelector(selector);
  },
  createElement(tag) {
    return createNode(tag);
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
  requestAnimationFrame(callback) {
    return scheduleTimer(() => {
      try { callback(now); } catch (_) {}
    }, 16, false, 16);
  },
  cancelAnimationFrame: clearTimer,
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

const xpGameHookSource = await readFile(path.join(__dirname, '..', 'js', 'xp-game-hook.js'), 'utf8');
new vm.Script(xpGameHookSource, { filename: 'xp-game-hook.js' }).runInContext(context);

const overlaySource = await readFile(path.join(__dirname, '..', 'js', 'ui', 'xp-overlay.js'), 'utf8');
new vm.Script(overlaySource, { filename: 'xp-overlay.js' }).runInContext(context);

const XP = context.window.XP;
assert(XP, 'XP API not initialized');
const getState = context.window.__xpTestHook;
assert.equal(typeof getState, 'function', 'state hook missing');

const AWARD_INTERVAL_MS = windowStub.XP_AWARD_INTERVAL_MS;
const HARD_IDLE_MS = windowStub.XP_HARD_IDLE_MS;

const Bridge = context.window.GameXpBridge;
assert(Bridge && typeof Bridge.auto === 'function', 'GameXpBridge missing');

const boostEvents = [];
windowStub.addEventListener('xp:boost', (event) => {
  boostEvents.push(event);
});

function clearBoostEvents() {
  boostEvents.length = 0;
}

function dispatchScore(gameId, score) {
  const event = {
    type: 'message',
    data: { type: 'game-score', gameId, score },
    origin: windowStub.location.origin,
  };
  windowStub.dispatchEvent(event);
}

function getOverlayRoot() {
  return documentStub.getElementById('xpOverlay');
}

function currentPopCount() {
  const root = getOverlayRoot();
  if (!root) return 0;
  const pops = root.querySelectorAll('.xp-pop');
  return Array.isArray(pops) ? pops.length : pops.size || 0;
}

function repeatingTimerCount() {
  return [...timers.values()].filter((timer) => timer.repeating).length;
}

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

// New record boost triggers on score pulse and powers awards
clearBoostEvents();
Bridge.setHighScore('2048', 15);
freshSession('2048');
Bridge.start('2048');
const baselineAward = await runTickAndSettle({ ratio: 1 });
dispatchScore('2048', 5);
dispatchScore('2048', 10);
dispatchScore('2048', 20);
await settleMicrotasks();
const recordEvent = boostEvents.find((event) => event.detail && event.detail.source === 'newRecord' && event.detail.multiplier > 1);
assert(recordEvent, 'expected new record boost event');
assert.equal(recordEvent.detail.gameId, '2048');
assert(recordEvent.detail.secondsLeft > 0, 'boost seconds should be positive');
assert(Math.abs(getState().boost.multiplier - 1.5) < 0.05, 'boost multiplier should be ~1.5');
const boostedAward = await runTickAndSettle({ ratio: 1 });
assert(boostedAward >= Math.floor(baselineAward * 1.4), 'boosted tick should reflect multiplier');

// Game over stops the boost and updates the stored high score
clearBoostEvents();
Bridge.gameOver({ score: 28 });
await settleMicrotasks();
assert.equal(Bridge.getHighScore('2048'), 28, 'high score should update after run');
const endEvent = boostEvents.find((event) => event.detail && event.detail.multiplier === 1 && event.detail.source === 'gameOver');
assert(endEvent, 'expected terminating boost event on gameOver');
assert.equal(Math.round(getState().boost.multiplier), 1, 'boost multiplier should reset after game over');

// Overlay stays quiet outside active game windows
clearBoostEvents();
Bridge.stop({ flush: false });
setVisibility(true);
windowStub.dispatchEvent(new CustomEventShim('xp:tick', {
  detail: {
    awarded: 5,
    combo: 1,
    boost: 1,
    progressToNext: 0.25,
    ts: DateMock.now(),
    gameId: 'unit-test',
  },
}));
await settleMicrotasks();
advanceTime(20);
await settleMicrotasks();
const popsAfter = currentPopCount();
assert(popsAfter === 0, 'overlay should not render pops when inactive');
const overlayRoot = getOverlayRoot();
assert(
  overlayRoot && (overlayRoot.hidden === true || overlayRoot.classList.contains('xp-faded')),
  'overlay root should remain hidden when inactive',
);
setVisibility(false);

// BFCache/pagehide clears boost ticker without duplicating timers
clearBoostEvents();
Bridge.setHighScore('2048', 5);
freshSession('2048');
Bridge.start('2048');
clearBoostEvents();
dispatchScore('2048', 6);
await settleMicrotasks();
advanceTime(20);
await settleMicrotasks();
const startedEvent = boostEvents.find((event) => event.detail && event.detail.source === 'newRecord');
assert(startedEvent, 'expected boost to start before pagehide');
const timersBefore = repeatingTimerCount();
Bridge.stopBoost('pagehide');
await settleMicrotasks();
advanceTime(1_000);
const timersAfter = repeatingTimerCount();
assert(timersAfter <= timersBefore, 'pagehide should clear active boost ticker');
const pagehideEvent = boostEvents.find((event) => event.detail && event.detail.source === 'pagehide' && event.detail.multiplier === 1);
assert(pagehideEvent, 'pagehide should emit a terminating boost event');
Bridge.stop({ flush: false });
clearBoostEvents();

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
