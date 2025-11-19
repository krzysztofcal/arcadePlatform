import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..', '..');

const hookSource = await readFile(path.join(repoRoot, 'js', 'xp-game-hook.js'), 'utf8');
const comboSource = await readFile(path.join(repoRoot, 'js', 'xp', 'combo.js'), 'utf8');
const scoringSource = await readFile(path.join(repoRoot, 'js', 'xp', 'scoring.js'), 'utf8');
const xpCoreSource = await readFile(path.join(repoRoot, 'js', 'xp', 'core.js'), 'utf8');
const xpShellSource = await readFile(path.join(repoRoot, 'js', 'xp.js'), 'utf8');

const hookMarker = '  } catch (_) {}\n}';
const hookIndex = xpCoreSource.lastIndexOf(hookMarker);
if (hookIndex === -1) {
  throw new Error('xp core format mismatch');
}
const hookPrefix = xpCoreSource.slice(0, hookIndex);
const hookSuffix = xpCoreSource.slice(hookIndex + hookMarker.length);
const hookSnippet = '  } catch (_) {}\n  if (window && !window.__xpTestHook) { window.__xpTestHook = () => state; }\n}';
const instrumentedCore = `${hookPrefix}${hookSnippet}${hookSuffix}`;

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

export function createEnvironment(options = {}) {
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

  let readyState = options.readyState || 'complete';
  let hidden = !!options.hidden;
  let visibilityState = options.visibilityState || (hidden ? 'hidden' : 'visible');
  let docTitle = options.title || 'Stub Game';
  let bodyGameId = options.bodyGameId || 'body-game';
  let windowGameId = options.windowGameId || null;
  let locationPath = options.pathname || '/games-open/test/index.html';

  const attributes = new Map();
  attributes.set('data-game-host', '');

  const bodyDataset = {};
  Object.defineProperty(bodyDataset, 'gameId', {
    get() {
      return bodyGameId;
    },
    set(value) {
      bodyGameId = value == null ? value : String(value);
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(bodyDataset, 'gameSlug', {
    get() {
      return bodyGameId;
    },
    set(value) {
      bodyGameId = value == null ? value : String(value);
    },
    enumerable: true,
    configurable: true,
  });

  const documentStub = {
    get readyState() { return readyState; },
    set readyState(value) { readyState = value; },
    get hidden() { return hidden; },
    set hidden(value) { hidden = !!value; },
    get visibilityState() { return visibilityState; },
    set visibilityState(value) { visibilityState = value; },
    get title() { return docTitle; },
    set title(value) { docTitle = value == null ? '' : String(value); },
    getElementById() { return null; },
    body: {
      dataset: bodyDataset,
      getAttribute(name) {
        if (name === 'data-game-id') return bodyGameId || null;
        const key = String(name).toLowerCase();
        return attributes.has(key) ? attributes.get(key) : null;
      },
      setAttribute(name, value) {
        const key = String(name).toLowerCase();
        attributes.set(key, value);
        if (key === 'data-game-id') {
          bodyGameId = value == null ? value : String(value);
        }
      },
      removeAttribute(name) {
        const key = String(name).toLowerCase();
        attributes.delete(key);
        if (key === 'data-game-id') {
          bodyGameId = null;
        }
      },
      hasAttribute(name) {
        const key = String(name).toLowerCase();
        return attributes.has(key);
      },
      className: '',
      textContent: '',
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
      emit(docListeners, event.type, event);
      return true;
    },
    querySelectorAll() { return []; },
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
  };

  const storage = new Map();

  const localStorageStub = {
    getItem(key) {
      const normalized = String(key);
      return storage.has(normalized) ? storage.get(normalized) : null;
    },
    setItem(key, value) {
      storage.set(String(key), String(value));
    },
    removeItem(key) {
      storage.delete(String(key));
    },
    clear() {
      storage.clear();
    },
  };

  const locationStub = {
    origin: options.origin || 'https://example.test',
    get pathname() {
      return locationPath;
    },
    set pathname(value) {
      locationPath = value == null ? '/' : String(value);
    },
  };

  const windowStub = {
    GAME_ID: windowGameId,
    localStorage: localStorageStub,
    addEventListener(type, handler) {
      addListener(windowListeners, type, handler);
    },
    removeEventListener(type, handler) {
      removeListener(windowListeners, type, handler);
    },
    dispatchEvent(event) {
      emit(windowListeners, event.type, event);
      return true;
    },
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    parent: null,
    location: locationStub,
    console,
    postMessage() {},
  };
  windowStub.parent = windowStub;
  windowStub.document = documentStub;

  const context = {
    window: windowStub,
    document: documentStub,
    location: locationStub,
    console,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    Date,
    Event: typeof Event === 'function' ? Event : class EventShim {
      constructor(type) { this.type = type; }
    },
  };

  vm.createContext(context);

  new vm.Script(hookSource, { filename: 'xp-game-hook.js' }).runInContext(context);

  const Bridge = context.window.GameXpBridge;
  assert(Bridge, 'GameXpBridge missing');

  function installXp() {
    if (!context.window.XP) {
      const scripts = [
        { code: comboSource, name: 'xp/combo.js' },
        { code: scoringSource, name: 'xp/scoring.js' },
        { code: instrumentedCore, name: 'xp/core.js' },
        { code: xpShellSource, name: 'xp.js' },
      ];
      for (const entry of scripts) {
        new vm.Script(entry.code, { filename: entry.name }).runInContext(context);
      }
    }
    const XP = context.window.XP;
    const getState = context.window.__xpTestHook;
    assert(XP, 'XP API missing after load');
    assert.equal(typeof getState, 'function', 'state hook missing');
    return { XP, getState };
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
      readyState = value;
    },
    updateVisibility({ hidden: nextHidden, visibilityState: nextState } = {}) {
      if (typeof nextHidden !== 'undefined') {
        hidden = !!nextHidden;
      }
      if (typeof nextState !== 'undefined') {
        visibilityState = nextState;
      }
    },
    updateGameDocument({ bodyGameId: nextBodyId, title: nextTitle, windowGameId: nextWindowId } = {}) {
      if (typeof nextBodyId !== 'undefined') {
        bodyGameId = nextBodyId == null ? nextBodyId : String(nextBodyId);
      }
      if (typeof nextTitle !== 'undefined') {
        docTitle = nextTitle == null ? '' : String(nextTitle);
      }
      if (typeof nextWindowId !== 'undefined') {
        windowStub.GAME_ID = nextWindowId == null ? nextWindowId : String(nextWindowId);
      }
    },
    updateLocation({ pathname } = {}) {
      if (typeof pathname !== 'undefined') {
        locationStub.pathname = pathname;
      }
    },
  };
}
