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
  dispatchEvent() {},
};

const windowStub = {
  localStorage: {
    getItem() { return null; },
    setItem() {},
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

console.log('xp-client tests passed');
