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

function createListenerMap() {
  return new Map();
}

function addListener(store, type, handler) {
  if (!store.has(type)) {
    store.set(type, new Set());
  }
  store.get(type).add(handler);
}

function removeListener(store, type, handler) {
  if (!store.has(type)) return;
  const handlers = store.get(type);
  handlers.delete(handler);
  if (handlers.size === 0) {
    store.delete(type);
  }
}

function emit(store, type, event) {
  if (!store.has(type)) return;
  for (const handler of [...store.get(type)]) {
    if (typeof handler === 'function') {
      handler(event);
    }
  }
}

function createEnvironment(options = {}) {
  const docListeners = createListenerMap();
  const windowListeners = createListenerMap();
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
    readyState: options.readyState || 'complete',
    hidden: false,
    visibilityState: 'visible',
    title: options.title || 'Stub Game',
    body: {
      dataset: { gameId: options.bodyGameId || 'body-game' },
      getAttribute(name) {
        if (name === 'data-game-id') return options.bodyGameId || 'body-game';
        return null;
      },
    },
    addEventListener(type, handler, _opts) {
      addListener(docListeners, type, handler);
    },
    removeEventListener(type, handler) {
      removeListener(docListeners, type, handler);
    },
    dispatchEvent(event) {
      emit(docListeners, event.type, event);
      return true;
    },
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
    addEventListener(type, handler, _opts) {
      addListener(windowListeners, type, handler);
    },
    removeEventListener(type, handler) {
      removeListener(windowListeners, type, handler);
    },
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

  function installXp() {
    new vm.Script(instrumentedXp, { filename: 'xp.js' }).runInContext(context);
    const XP = context.window.XP;
    assert(XP, 'XP API missing after load');
    const getState = context.window.__xpTestHook;
    assert.equal(typeof getState, 'function', 'state hook missing');
    return { XP, getState };
  }

  return {
    context,
    Bridge,
    installXp,
    drainTimers,
    triggerDoc(type, event = {}) {
      emit(docListeners, type, { type, ...event });
    },
    triggerWindow(type, event = {}) {
      emit(windowListeners, type, { type, ...event });
    },
    setReadyState(value) {
      documentStub.readyState = value;
    },
  };
}

// Fractional roll-up and queued awards survive until XP loads
{
  const env = createEnvironment();
  const { Bridge, drainTimers, installXp } = env;

  Bridge.start('pre-init-game');
  Bridge.add(0.4);
  Bridge.add(0.4);
  Bridge.add(0.4);

  drainTimers();
  assert.equal(typeof env.context.window.XP, 'undefined', 'XP should not exist before loading xp.js');

  const { XP, getState } = installXp();
  drainTimers();

  assert.equal(getState().scoreDelta, 1, 'queued fractional adds should roll to a whole point once XP loads');

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
  assert.equal(getState().scoreDelta, 10_000, 'window awards should respect 10k cap');

  // stop should still flush cleanly when XP is present
  Bridge.stop({ flush: true });
  drainTimers();
  assert.equal(getState().running, false, 'stop should halt running session');
  assert.equal(typeof XP.stopSession, 'function');
}

// Auto wiring responds to visibility toggles and activity
{
  const env = createEnvironment();
  const { Bridge, drainTimers, installXp, triggerDoc, triggerWindow } = env;

  Bridge.auto('Auto Session Name');
  drainTimers();

  const { XP, getState } = installXp();
  drainTimers();

  assert.equal(getState().running, true, 'auto should start a session once XP is ready');
  assert.equal(getState().gameId, 'auto-session-name', 'auto start should slugify provided game id');

  let stopCalls = 0;
  const originalStop = XP.stopSession;
  XP.stopSession = function wrappedStop(options) {
    stopCalls += 1;
    return originalStop.call(this, options);
  };

  triggerDoc('xp:hidden');
  drainTimers();
  assert.equal(getState().running, false, 'xp:hidden should stop the session');
  assert.equal(stopCalls > 0, true, 'xp:hidden should flush stop');

  triggerDoc('xp:visible');
  drainTimers();
  assert.equal(getState().running, true, 'xp:visible should restart the session');

  let nudges = 0;
  const originalNudge = XP.nudge;
  XP.nudge = function wrappedNudge() {
    nudges += 1;
    return originalNudge.apply(this, arguments);
  };

  triggerWindow('pointerdown');
  assert.equal(nudges > 0, true, 'pointerdown should proxy to XP.nudge');
}

// DOM readiness fallback should trigger auto start even without custom events
{
  const env = createEnvironment({ readyState: 'loading', bodyGameId: 'fallback-body' });
  const { Bridge, drainTimers, installXp, triggerDoc, setReadyState } = env;

  Bridge.auto();
  drainTimers();

  // simulate early stop before XP or visibility hooks fire
  Bridge.stop({ flush: false });
  drainTimers();

  setReadyState('interactive');
  triggerDoc('DOMContentLoaded');
  drainTimers();

  const { getState } = installXp();
  drainTimers();
  assert.equal(getState().running, true, 'DOMContentLoaded fallback should restart the session');
  assert.equal(getState().gameId, 'fallback-body', 'detected body data attribute should provide the slugged id');
}

// Stop calls before XP loads should queue and flush later
{
  const env = createEnvironment();
  const { Bridge, drainTimers, installXp } = env;

  Bridge.start('queued-stop');
  Bridge.add(1.4);
  Bridge.stop({ flush: true });
  drainTimers();

  const { XP } = installXp();
  let stopCalls = 0;
  const originalStop = XP.stopSession;
  XP.stopSession = function wrappedStop(options) {
    stopCalls += 1;
    return originalStop.call(this, options);
  };

  drainTimers();
  assert.equal(stopCalls, 1, 'queued stop should flush once XP becomes available');
}

// Stop followed by start before XP initializes should leave the last start active
{
  const env = createEnvironment();
  const { Bridge, drainTimers, installXp } = env;

  Bridge.start('game-a');
  Bridge.stop({ flush: true });
  Bridge.start('game-b');

  const { getState } = installXp();
  drainTimers();

  assert.equal(getState().running, true, 'queued start should run after pending stop');
  assert.equal(getState().gameId, 'game-b', 'latest queued start should determine the running session');
}

console.log('xp-game-hook tests passed');
