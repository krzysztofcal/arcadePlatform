import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const hookSource = await readFile(path.join(__dirname, '..', 'js', 'xp-game-hook.js'), 'utf8');
const xpSource = await readFile(path.join(__dirname, '..', 'js', 'xp.js'), 'utf8');
const injectionTarget = '})(typeof window !== "undefined" ? window : this, typeof document !== "undefined" ? document : undefined);';
if (!xpSource.includes(injectionTarget)) {
  throw new Error('xp.js format mismatch');
}
const instrumentedXp = xpSource.replace(
  injectionTarget,
  '  if (window && !window.__xpTestHook) { window.__xpTestHook = () => state; }\n' + injectionTarget
);

const docListeners = new Map();
const windowListeners = new Map();
const timers = [];

function fakeSetTimeout(fn) {
  timers.push(typeof fn === 'function' ? fn : () => {});
  return timers.length;
}

function fakeClearTimeout(id) {
  if (!id || id > timers.length) return;
  timers[id - 1] = null;
}

function drainTimers(limit = 25) {
  let runs = 0;
  while (timers.some(Boolean) && runs < limit) {
    const pending = timers.splice(0, timers.length);
    for (const entry of pending) {
      if (typeof entry === 'function') {
        try { entry(); } catch (err) { console.error(err); }
      }
    }
    runs += 1;
  }
}

const documentStub = {
  readyState: 'complete',
  hidden: false,
  visibilityState: 'visible',
  title: 'Stub Game',
  body: {
    dataset: { gameId: 'body-game' },
    getAttribute(name) { return name === 'data-game-id' ? 'body-game' : null; },
  },
  addEventListener(type, handler) {
    docListeners.set(type, handler);
  },
  removeEventListener() {},
  dispatchEvent() {},
  getElementById() { return null; },
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
  querySelectorAll() { return []; },
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
  setInterval() { return 1; },
  clearInterval() {},
  setTimeout: fakeSetTimeout,
  clearTimeout: fakeClearTimeout,
  parent: null,
  location: { origin: 'https://example.test' },
  console,
};
windowStub.parent = windowStub;
windowStub.document = documentStub;

const context = {
  window: windowStub,
  document: documentStub,
  location: windowStub.location,
  console,
  setTimeout: fakeSetTimeout,
  clearTimeout: fakeClearTimeout,
  Date,
  Event,
};

vm.createContext(context);

new vm.Script(hookSource, { filename: 'xp-game-hook.js' }).runInContext(context);

const Bridge = context.window.GameXpBridge;
assert(Bridge, 'GameXpBridge missing');
assert.equal(typeof Bridge.add, 'function');

Bridge.start('pre-init-game');
Bridge.add(0.4);
Bridge.add(0.4);
Bridge.add(0.4);

drainTimers();
assert.equal(typeof context.window.XP, 'undefined', 'XP should not exist before loading xp.js');

new vm.Script(instrumentedXp, { filename: 'xp.js' }).runInContext(context);

drainTimers();

const XP = context.window.XP;
assert(XP, 'XP API missing after load');
const getState = context.window.__xpTestHook;
assert.equal(typeof getState, 'function', 'state hook missing');

const stateAfterInit = getState();
assert.equal(stateAfterInit.scoreDelta, 1, 'queued fractional adds should roll to a whole point once XP loads');

Bridge.add(0.25);
drainTimers();
assert.equal(getState().scoreDelta, 1, 'sub-integer adds should remain queued');

Bridge.add(0.25);
drainTimers();
assert.equal(getState().scoreDelta, 1, 'partial sum below one should not award points');

Bridge.add(0.6);
drainTimers();
assert.equal(getState().scoreDelta, 2, 'fractional roll-up should award once threshold reached');

Bridge.add(9_999.5);
drainTimers();
assert.equal(getState().scoreDelta, 10_000, 'session awards should respect 10k cap');

console.log('xp-game-hook tests passed');
