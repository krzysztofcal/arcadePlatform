import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
const overlaySource = await readFile(path.join(repoRoot, 'js', 'ui', 'xp-overlay.js'), 'utf8');

function createHarness(options = {}) {
  const listeners = new Map();
  const docListeners = new Map();
  const rafCallbacks = new Map();
  const timeouts = new Map();
  const idMap = new Map();
  let nextRafId = 1;
  let nextTimeoutId = 1;
  let now = 0;
  let readyState = 'loading';
  let hidden = false;
  let visibilityState = 'visible';
  let activeGame = options.activeGame !== false;
  const dispatchedEvents = [];

  function addListener(store, type, handler) {
    if (!handler) return;
    if (!store.has(type)) store.set(type, new Set());
    store.get(type).add(handler);
  }

  function removeListener(store, type, handler) {
    if (!store.has(type)) return;
    const bucket = store.get(type);
    bucket.delete(handler);
    if (bucket.size === 0) store.delete(type);
  }

  function emit(store, type, event) {
    if (!store.has(type)) return;
    const payload = event || { type };
    for (const handler of [...store.get(type)]) {
      if (typeof handler === 'function') {
        handler(payload);
      }
    }
  }

  const realDate = Date;
  function FakeDate(...args) {
    if (this instanceof FakeDate) {
      if (args.length === 0) {
        return new realDate(now);
      }
      return new realDate(...args);
    }
    return realDate(...args);
  }
  FakeDate.now = () => now;
  FakeDate.UTC = realDate.UTC;
  FakeDate.parse = realDate.parse;
  FakeDate.prototype = realDate.prototype;

  function createElement(tagName) {
    const node = { };
    const classSet = new Set();
    const styleMap = new Map();
    const children = [];
    let localId = '';
    node.tagName = String(tagName || '').toUpperCase();
    node.parentNode = null;
    node.textContent = '';
    node.dataset = {};
    node.hidden = false;
    Object.defineProperty(node, 'id', {
      get() { return localId; },
      set(value) {
        const next = value == null ? '' : String(value);
        if (localId) idMap.delete(localId);
        localId = next;
        if (localId) idMap.set(localId, node);
      },
      enumerable: true,
      configurable: true,
    });
    Object.defineProperty(node, 'className', {
      get() { return [...classSet].join(' '); },
      set(value) {
        classSet.clear();
        if (!value) return;
        String(value).split(/\s+/).forEach((entry) => {
          if (entry) classSet.add(entry);
        });
      },
      enumerable: true,
      configurable: true,
    });
    node.classList = {
      add(...names) { names.forEach((name) => { if (name) classSet.add(name); }); },
      remove(...names) { names.forEach((name) => { if (name) classSet.delete(name); }); },
      toggle(name, force) {
        if (!name) return classSet.has(name);
        if (force === true) { classSet.add(name); return true; }
        if (force === false) { classSet.delete(name); return false; }
        if (classSet.has(name)) { classSet.delete(name); return false; }
        classSet.add(name);
        return true;
      },
      contains(name) { return classSet.has(name); },
    };
    node.style = {
      setProperty(name, value) { styleMap.set(name, String(value)); },
      removeProperty(name) { styleMap.delete(name); },
      getPropertyValue(name) { return styleMap.get(name) || ''; },
    };
    node.appendChild = function appendChild(child) {
      if (!child) return child;
      if (child.parentNode && child.parentNode !== node && typeof child.parentNode.removeChild === 'function') {
        child.parentNode.removeChild(child);
      }
      child.parentNode = node;
      children.push(child);
      return child;
    };
    node.removeChild = function removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) {
        children.splice(index, 1);
        child.parentNode = null;
      }
      return child;
    };
    node.contains = function contains(target) {
      if (target === node) return true;
      return children.some((child) => (child.contains ? child.contains(target) : child === target));
    };
    node.getAttribute = function getAttribute(name) {
      const key = String(name).toLowerCase();
      if (key === 'id') return localId || null;
      if (key === 'class') return node.className || null;
      return null;
    };
    node.setAttribute = function setAttribute(name, value) {
      const key = String(name).toLowerCase();
      if (key === 'id') { node.id = value; return; }
      if (key === 'class') { node.className = value; return; }
    };
    node.querySelectorAll = function querySelectorAll(selector) {
      const list = [];
      const matchers = Array.isArray(selector) ? selector : [String(selector)];
      const match = (el, sel) => {
        if (!el) return false;
        if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
        if (sel.startsWith('#')) return el.id === sel.slice(1);
        return el.tagName.toLowerCase() === sel.toLowerCase();
      };
      const visit = (el) => {
        matchers.forEach((sel) => { if (match(el, sel)) list.push(el); });
        childrenOf(el).forEach(visit);
      };
      const childrenOf = (el) => {
        if (!el) return [];
        if (Array.isArray(el.children)) return el.children;
        if (el === node) return children;
        return [];
      };
      visit(node);
      return list;
    };
    node.querySelector = function querySelector(selector) {
      const results = node.querySelectorAll(selector);
      return results.length ? results[0] : null;
    };
    Object.defineProperty(node, 'children', {
      get() { return children.slice(); },
    });
    return node;
  }

  const document = {
    get readyState() { return readyState; },
    set readyState(value) { readyState = value || 'loading'; },
    get hidden() { return hidden; },
    set hidden(value) { hidden = !!value; },
    get visibilityState() { return visibilityState; },
    set visibilityState(value) { visibilityState = value || 'visible'; },
    body: createElement('body'),
    createElement,
    querySelector(selector) { return this.body.querySelector(selector); },
    querySelectorAll(selector) { return this.body.querySelectorAll(selector); },
    getElementById(id) { return idMap.get(String(id)) || null; },
    addEventListener(type, handler) { addListener(docListeners, type, handler); },
    removeEventListener(type, handler) { removeListener(docListeners, type, handler); },
    dispatchEvent(event) {
      emit(docListeners, event.type, event);
      return true;
    },
  };

  const windowStub = {
    document,
    GameXpBridge: {
      isActiveGameWindow() { return !!activeGame && !hidden; },
    },
    addEventListener(type, handler) { addListener(listeners, type, handler); },
    removeEventListener(type, handler) { removeListener(listeners, type, handler); },
    dispatchEvent(event) {
      if (event && typeof event === 'object') {
        dispatchedEvents.push(event);
      }
      emit(listeners, event.type, event);
      return true;
    },
    requestAnimationFrame(callback) {
      const id = nextRafId++;
      rafCallbacks.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      rafCallbacks.delete(id);
    },
    setTimeout(callback, delay) {
      const id = nextTimeoutId++;
      timeouts.set(id, { callback, at: now + Math.max(0, Number(delay) || 0) });
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    CSS: {
      supports() {
        return options.conicSupport !== false;
      },
    },
    console,
  };

  const context = {
    window: windowStub,
    document,
    console,
    Date: FakeDate,
    setTimeout: windowStub.setTimeout.bind(windowStub),
    clearTimeout: windowStub.clearTimeout.bind(windowStub),
    CSS: windowStub.CSS,
  };

  vm.createContext(context);
  new vm.Script(overlaySource, { filename: 'xp-overlay.js' }).runInContext(context);

  const badge = document.createElement('a');
  badge.id = 'xpBadge';
  badge.classList.add('xp-badge');
  document.body.appendChild(badge);

  function flushRaf() {
    if (rafCallbacks.size === 0) return;
    const queue = [...rafCallbacks.entries()];
    rafCallbacks.clear();
    for (const [id, callback] of queue) {
      if (typeof callback === 'function') {
        callback(now);
      }
    }
  }

  function flushTimeouts() {
    const pending = [...timeouts.entries()].filter(([, meta]) => meta.at <= now);
    for (const [id, meta] of pending) {
      timeouts.delete(id);
      try { meta.callback(); }
      catch (err) { console.error(err); }
    }
  }

  function advance(ms) {
    const target = now + Math.max(0, Number(ms) || 0);
    while (now < target) {
      now = Math.min(target, now + 16);
      flushRaf();
      flushTimeouts();
    }
    flushRaf();
    flushTimeouts();
  }

  function fireDomContentLoaded() {
    document.readyState = 'interactive';
    emit(docListeners, 'DOMContentLoaded', { type: 'DOMContentLoaded' });
  }

  function dispatchBoost(detail) {
    windowStub.dispatchEvent({ type: 'xp:boost', detail });
  }

  function dispatchTick(detail) {
    windowStub.dispatchEvent({ type: 'xp:tick', detail });
  }

  return {
    context,
    window: windowStub,
    document,
    badge,
    advance,
    dispatchBoost,
    dispatchTick,
    fireDomContentLoaded,
    setActiveGame(value) { activeGame = !!value; },
    setVisibility({ hidden: isHidden, visibility } = {}) {
      if (typeof isHidden !== 'undefined') {
        hidden = !!isHidden;
      }
      if (typeof visibility !== 'undefined') {
        visibilityState = visibility;
      }
    },
    triggerWindow(type) { emit(listeners, type, { type }); },
    triggerDocument(type) { emit(docListeners, type, { type }); },
    getWindowListenerCount(type) { return listeners.has(type) ? listeners.get(type).size : 0; },
    getActiveRafCount() { return rafCallbacks.size; },
    getActiveTimeoutCount() { return [...timeouts.values()].filter((meta) => meta.at > now).length; },
    getTimerText() {
      const timer = badge.querySelector('.xp-boost-chip__timer');
      return timer ? timer.textContent : '';
    },
    getMultiplierText() {
      const mult = badge.querySelector('.xp-boost-chip__multiplier');
      return mult ? mult.textContent : '';
    },
    getDispatchedEvents() { return dispatchedEvents.slice(); },
  };
}

function ensureAttached(harness) {
  harness.fireDomContentLoaded();
}

await (async () => {
  const harness = createHarness();
  ensureAttached(harness);
  assert.equal(harness.getWindowListenerCount('xp:boost'), 1, 'overlay should attach xp:boost listener for active game');
  assert.equal(harness.getWindowListenerCount('xp:tick'), 1, 'overlay should attach xp:tick listener for active game');

  harness.dispatchBoost({ multiplier: 2, ttlMs: 5000 });
  harness.advance(160);
  assert(harness.badge.classList.contains('xp-boost--active'), 'boost_border_active: badge should carry active class');
  const frac = parseFloat(harness.badge.style.getPropertyValue('--boost-frac') || '0');
  assert(frac > 0, 'conic_fallback: conic-supported badge should expose progress fraction');

  harness.advance(5200);
  assert.equal(harness.badge.classList.contains('xp-boost--active'), false, 'boost_border_inactive: class removed after expiry');
})();

await (async () => {
  const harness = createHarness();
  ensureAttached(harness);
  const overlayState = () => harness.window.XPOverlay.__test.getState();
  harness.dispatchTick({
    combo: { multiplier: 4, cap: 20 },
    progressToNext: 0.5,
    mode: 'build',
  });
  assert.equal(overlayState().comboDetail.multiplier, 4, 'xp:tick should update combo multiplier');
  assert(Math.abs(overlayState().comboDetail.progress - 0.5) < 0.001, 'xp:tick should update combo progress');
  assert.equal(harness.badge.style.getPropertyValue('--combo-progress'), '0.5', 'combo progress CSS variable should update');
  harness.dispatchTick({
    combo: { multiplier: 20, cap: 20 },
    progressToNext: 0.8,
    mode: 'sustain',
  });
  assert(harness.badge.classList.contains('xp-combo--sustain'), 'badge should reflect sustain mode');
  harness.dispatchTick({
    combo: { multiplier: 1, cap: 20 },
    progressToNext: 0,
    mode: 'cooldown',
  });
  assert.equal(harness.badge.classList.contains('xp-combo--sustain'), false, 'cooldown should clear sustain class');
  assert(harness.badge.classList.contains('xp-combo--cooldown'), 'badge should reflect cooldown mode');
})();

await (async () => {
  const harness = createHarness();
  harness.window.XP = {
    getBoost() {
      return { multiplier: 2, expiresAt: harness.context.Date.now() + 3_000 };
    },
  };
  ensureAttached(harness);
  harness.advance(100);
  const xpEvents = harness.getDispatchedEvents().filter((event) => event && event.type === 'xp:boost');
  assert.equal(xpEvents.length, 0, 'overlay self-hydrate path should not dispatch xp:boost events');
  assert(harness.badge.classList.contains('xp-boost--active'), 'self-hydrate: badge should activate from XP state');
  assert.notEqual(harness.getTimerText(), '', 'self-hydrate: timer text should populate');
})();

await (async () => {
  const harness = createHarness({ activeGame: false });
  ensureAttached(harness);
  assert.equal(harness.getWindowListenerCount('xp:boost'), 0, 'boost_gating: overlay should not attach when game inactive');
  assert.equal(harness.getWindowListenerCount('xp:tick'), 0, 'boost_gating: xp:tick listener should not attach when game inactive');
  assert.equal(harness.badge.querySelector('.xp-boost-chip'), null, 'boost_gating: chip should not be injected for inactive game');
})();

await (async () => {
  const harness = createHarness();
  ensureAttached(harness);
  harness.dispatchBoost({ multiplier: 2, ttlMs: 5000 });
  harness.advance(160);
  harness.triggerWindow('pagehide');
  assert.equal(harness.getWindowListenerCount('xp:boost'), 0, 'no_duplicate_listeners_after_bfcache: listener removed on pagehide');
  assert.equal(harness.getWindowListenerCount('xp:tick'), 0, 'no_duplicate_listeners_after_bfcache: xp:tick listener removed on pagehide');
  harness.triggerWindow('pageshow');
  assert.equal(harness.getWindowListenerCount('xp:boost'), 1, 'no_duplicate_listeners_after_bfcache: listener reattached once');
  assert.equal(harness.getWindowListenerCount('xp:tick'), 1, 'no_duplicate_listeners_after_bfcache: xp:tick listener reattached once');
})();

await (async () => {
  const harness = createHarness();
  ensureAttached(harness);
  harness.dispatchBoost({ multiplier: 2, ttlMs: 3000 });
  harness.advance(200);
  harness.setVisibility({ hidden: true, visibility: 'hidden' });
  harness.triggerDocument('visibilitychange');
  assert.equal(harness.getWindowListenerCount('xp:boost'), 0, 'timers_are_cleared_on_detach: listener cleared on detach');
  assert.equal(harness.getWindowListenerCount('xp:tick'), 0, 'timers_are_cleared_on_detach: xp:tick listener cleared on detach');
  assert.equal(harness.getActiveRafCount(), 0, 'timers_are_cleared_on_detach: raf cleared');
  assert.equal(harness.getActiveTimeoutCount(), 0, 'timers_are_cleared_on_detach: timers cleared');
})();

await (async () => {
  const harness = createHarness({ conicSupport: false });
  ensureAttached(harness);
  harness.dispatchBoost({ multiplier: 2, ttlMs: 4000 });
  harness.advance(200);
  const fracValue = harness.badge.style.getPropertyValue('--boost-frac');
  assert.equal(fracValue, '', 'numeric_fallback_without_conic: conic variable should clear when unsupported');
  assert.match(harness.getMultiplierText(), /^x/, 'numeric_fallback_without_conic: multiplier should be visible');
  assert.match(harness.getTimerText(), /s$/, 'numeric_fallback_without_conic: timer text should update');
  harness.dispatchTick({
    combo: { multiplier: 3, cap: 20 },
    progressToNext: 0.6,
    mode: 'build',
  });
  assert.equal(harness.badge.style.getPropertyValue('--combo-progress'), '', 'numeric_fallback_without_conic: combo progress var should clear when unsupported');
})();
