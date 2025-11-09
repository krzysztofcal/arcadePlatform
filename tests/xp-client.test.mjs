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

const docListeners = new Map();
const windowListeners = new Map();

const documentStub = {
  readyState: 'complete',
  hidden: false,
  visibilityState: 'visible',
  body: {
    dataset: { gameHost: '', gameSlug: 'unit-test', gameId: 'unit-test' },
    hasAttribute(name) {
      return name === 'data-game-host';
    },
    getAttribute(name) {
      if (name === 'data-game-id') return 'unit-test';
      if (name === 'data-game-host') return '';
      return null;
    },
  },
  addEventListener(type, handler) {
    docListeners.set(type, handler);
  },
  removeEventListener() {},
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
  dispatchEvent() {},
};

const windowStub = {
  localStorage: {
    __store: new Map(),
    getItem(key) {
      return this.__store.has(key) ? this.__store.get(key) : null;
    },
    setItem(key, value) {
      this.__store.set(key, String(value));
    },
    removeItem(key) {
      this.__store.delete(key);
    },
  },
  addEventListener(type, handler) {
    windowListeners.set(type, handler);
  },
  removeEventListener() {},
  setInterval() {
    return 1;
  },
  clearInterval() {},
  setTimeout,
  clearTimeout,
  console,
  dispatchEvent(evt) {
    if (!evt || !evt.type) return false;
    const handler = windowListeners.get(evt.type);
    if (typeof handler === 'function') {
      handler(evt);
    }
    return true;
  },
};
windowStub.document = documentStub;
windowStub.location = { origin: 'https://example.test' };

const context = {
  window: windowStub,
  document: documentStub,
  location: windowStub.location,
  console,
  setTimeout,
  clearTimeout,
  Date,
  Event,
};

class CustomEventShim {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init && init.detail;
  }
}

const previousCustomEvent = globalThis.CustomEvent;
if (typeof previousCustomEvent !== 'function') {
  globalThis.CustomEvent = CustomEventShim;
}
context.CustomEvent = globalThis.CustomEvent;

vm.createContext(context);
new vm.Script(instrumented, { filename: 'xp.js' }).runInContext(context);

const XP = context.window.XP;
assert(XP, 'XP API not initialized');
const getState = context.window.__xpTestHook;
assert.equal(typeof getState, 'function', 'state hook missing');

function resetRemainders() {
  const state = getState();
  state.scoreDelta = 0;
  state.scoreDeltaRemainder = 0;
}

function setVisibility(hidden) {
  documentStub.hidden = hidden;
  documentStub.visibilityState = hidden ? 'hidden' : 'visible';
}

function triggerVisibilityChange() {
  const handler = docListeners.get('visibilitychange');
  if (handler) handler();
}

function freshSession(label = 'test') {
  XP.startSession(label);
  resetRemainders();
}

// Fractional accumulation should roll into whole numbers
freshSession('fractional');
XP.addScore(0.4);
assert.equal(getState().scoreDelta, 0);
assert(getState().scoreDeltaRemainder > 0 && getState().scoreDeltaRemainder < 1);
XP.addScore(0.4);
assert.equal(getState().scoreDelta, 0);
XP.addScore(0.4);
assert.equal(getState().scoreDelta, 1);
assert(getState().scoreDeltaRemainder > 0 && getState().scoreDeltaRemainder < 1);
XP.addScore(0.8);
assert.equal(getState().scoreDelta, 2);

// Clamp should respect MAX_SCORE_DELTA
freshSession('clamp');
XP.addScore(20_000.5);
assert.equal(getState().scoreDelta, 10_000);
XP.addScore(5);
assert.equal(getState().scoreDelta, 10_000);

// NaN and non-positive values ignored
freshSession('nan');
XP.addScore(NaN);
XP.addScore(-5);
assert.equal(getState().scoreDelta, 0);
assert.equal(getState().scoreDeltaRemainder, 0);

// Remainder cleared on startSession
freshSession('start-reset');
XP.addScore(0.6);
assert(getState().scoreDeltaRemainder > 0);
XP.startSession('start-reset-2');
assert.equal(getState().scoreDeltaRemainder, 0);

// Remainder cleared on stopSession
freshSession('stop-reset');
XP.addScore(0.6);
assert(getState().scoreDeltaRemainder > 0);
XP.stopSession({ flush: false });
assert.equal(getState().scoreDeltaRemainder, 0);

// Remainder cleared on resetActivityCounters (via visibility change)
freshSession('reset-activity');
XP.addScore(0.6);
assert(getState().scoreDeltaRemainder > 0);
setVisibility(true);
triggerVisibilityChange();
assert.equal(getState().scoreDeltaRemainder, 0);
setVisibility(false);

// Boost via public API should dispatch event, schedule a timer, and persist across stop/resume.
freshSession('boost-public');
const boostStart = Date.now();
XP.requestBoost(2, 500, 'unit-test');
const initialBoost = getState().boost;
assert.equal(initialBoost.multiplier, 2);
assert.equal(initialBoost.source, 'unit-test');
assert(initialBoost.expiresAt > boostStart);
assert(initialBoost.expiresAt - boostStart >= 500 && initialBoost.expiresAt - boostStart < 800);
const firstTimer = getState().boostTimerId;
assert(firstTimer, 'boost timer should be scheduled');

XP.stopSession({ flush: false });
assert.equal(getState().boostTimerId, null, 'boost timer should clear on stop');
assert.equal(getState().boost.multiplier, 2, 'boost should persist after stop');

XP.startSession('boost-public-resume');
const resumed = getState();
assert(resumed.boostTimerId, 'boost timer should reschedule on resume');
assert.notEqual(resumed.boostTimerId, firstTimer, 'boost timer should refresh on resume');

const waitForExpiry = Math.max(0, resumed.boost.expiresAt - Date.now() + 20);
await new Promise((resolve) => setTimeout(resolve, waitForExpiry));
assert.equal(getState().boost.multiplier, 1, 'boost should reset after expiration');
assert.equal(getState().boostTimerId, null, 'boost timer should clear after expiration');

// Legacy bridge payloads should continue to work via xp:boost events.
const boostHandler = windowListeners.get('xp:boost');
assert.equal(typeof boostHandler, 'function', 'xp:boost listener missing');
boostHandler({ detail: { multiplier: 3, durationMs: 60, source: 'legacy-source' } });
const legacyBoost = getState().boost;
assert.equal(legacyBoost.multiplier, 3);
assert.equal(legacyBoost.source, 'legacy-source');
assert(legacyBoost.expiresAt > Date.now());
const legacyTimer = getState().boostTimerId;
assert(legacyTimer, 'legacy boost should schedule a timer');

await new Promise((resolve) => setTimeout(resolve, 80));
assert.equal(getState().boost.multiplier, 1, 'legacy boost should expire');
assert.equal(getState().boostTimerId, null, 'legacy boost timer should clear');

XP.stopSession({ flush: false });

// Legacy direct-object invocation of the public wrapper should be normalized.
freshSession('boost-legacy-direct-call');
XP.requestBoost({ multiplier: 2, durationMs: 120, source: 'legacy-direct' });
const directBoost = getState().boost;
assert.equal(directBoost.multiplier, 2);
assert.equal(directBoost.source, 'legacy-direct');
assert(directBoost.expiresAt > Date.now());
assert(getState().boostTimerId, 'legacy direct boost should schedule a timer');

await new Promise((resolve) => setTimeout(resolve, 160));
assert.equal(getState().boost.multiplier, 1, 'legacy direct boost should expire');
assert.equal(getState().boostTimerId, null, 'legacy direct boost timer should clear');

XP.stopSession({ flush: false });

const flushStatus = XP.getFlushStatus();
assert.equal(typeof flushStatus.pending, 'number');
assert.equal(typeof flushStatus.lastSync, 'number');
assert.equal(typeof flushStatus.inflight, 'boolean');

console.log('xp-client tests passed');

if (typeof previousCustomEvent !== 'function') {
  delete globalThis.CustomEvent;
} else {
  globalThis.CustomEvent = previousCustomEvent;
}
