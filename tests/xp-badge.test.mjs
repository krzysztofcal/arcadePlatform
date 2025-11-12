import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
const overlaySource = await readFile(path.join(repoRoot, 'js', 'ui', 'xp-overlay.js'), 'utf8');

function createFakeDate(now) {
  const RealDate = Date;
  function FakeDate(...args) {
    if (this instanceof FakeDate) {
      if (args.length === 0) {
        return new RealDate(now);
      }
      return new RealDate(...args);
    }
    if (args.length === 0) {
      return RealDate();
    }
    return RealDate(...args);
  }
  FakeDate.now = () => now;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.parse = RealDate.parse;
  FakeDate.prototype = RealDate.prototype;
  return FakeDate;
}

function createNode(tagName) {
  const classSet = new Set();
  const node = {
    tagName: String(tagName || '').toUpperCase(),
    parentNode: null,
    textContent: '',
    dataset: {},
    style: {
      setProperty() {},
      removeProperty() {},
      getPropertyValue() { return ''; },
    },
    appendChild(child) {
      if (!child) return;
      child.parentNode = this;
    },
    setAttribute() {},
    querySelector() { return null; },
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(node, 'className', {
    get() { return [...classSet].join(' '); },
    set(value) {
      classSet.clear();
      if (!value) return;
      String(value).split(/\s+/).forEach((entry) => {
        if (entry) classSet.add(entry);
      });
    },
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
  return node;
}

function loadOverlay(now = 0) {
  const warnings = [];
  const body = createNode('body');
  body.contains = () => true;
  const document = {
    body,
    readyState: 'complete',
    visibilityState: 'visible',
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
    createElement: createNode,
    querySelector() { return null; },
    createEvent() { return { initCustomEvent() {} }; },
  };
  const windowObj = {
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame() { return 0; },
    cancelAnimationFrame() {},
    setTimeout() { return 0; },
    clearTimeout() {},
  };
  windowObj.window = windowObj;
  windowObj.document = document;
  const FakeDate = createFakeDate(now);
  const sandbox = {
    window: windowObj,
    document,
    console: {
      debug() {},
      warn(...args) { warnings.push(args); },
    },
    Date: FakeDate,
    setTimeout: windowObj.setTimeout,
    clearTimeout: windowObj.clearTimeout,
    requestAnimationFrame: windowObj.requestAnimationFrame,
    cancelAnimationFrame: windowObj.cancelAnimationFrame,
  };
  windowObj.Date = FakeDate;
  windowObj.console = sandbox.console;
  sandbox.global = sandbox;

  vm.runInNewContext(overlaySource, sandbox, { filename: 'xp-overlay.js' });

  const testApi = windowObj.XpOverlay && windowObj.XpOverlay.__test;
  assert.ok(testApi, 'overlay test API should exist');
  assert.equal(typeof testApi.normalizeExpiresAt, 'function', 'normalizeExpiresAt helper should exist');
  assert.equal(typeof testApi.computeRemainingSeconds, 'function', 'computeRemainingSeconds helper should exist');
  assert.equal(typeof testApi.formatClock, 'function', 'formatClock helper should exist');

  return { api: testApi, warnings, window: windowObj };
}

test('normalizeExpiresAt returns millisecond timestamps unchanged', () => {
  const now = 25_000;
  const { api } = loadOverlay(now);
  const expiresAt = now + 15_000;
  assert.equal(api.normalizeExpiresAt(expiresAt), expiresAt);
});

test('normalizeExpiresAt repairs epoch seconds once', () => {
  const now = 1_731_280_000_000;
  const { api, warnings } = loadOverlay(now);
  const expiresAtSeconds = Math.floor((now + 12_000) / 1000);
  const repaired = api.normalizeExpiresAt(expiresAtSeconds);
  assert.equal(repaired, expiresAtSeconds * 1000);
  assert.ok(warnings.length >= 1, 'repair should trigger a console warning');
});

test('computeRemainingSeconds returns rounded-up seconds from ms', () => {
  const now = 100_000;
  const { api } = loadOverlay(now);
  const expiresAt = now + 12_500;
  assert.equal(api.computeRemainingSeconds(expiresAt, now), 13);
});

test('computeRemainingSeconds yields zero when expired', () => {
  const now = 100_000;
  const { api } = loadOverlay(now);
  const expiresAt = now - 5_000;
  assert.equal(api.computeRemainingSeconds(expiresAt, now), 0);
});

test('formatClock renders two-digit minutes and seconds', () => {
  const { api } = loadOverlay(0);
  assert.equal(api.formatClock(0), '00:00');
  assert.equal(api.formatClock(5), '00:05');
  assert.equal(api.formatClock(75), '01:15');
});

test('boost timer renders countdown from authoritative expiresAt', () => {
  const now = 1_731_280_000_000;
  const { window, api } = loadOverlay(now);
  const badge = createNode('a');
  badge.className = 'xp-badge';
  badge.contains = () => false;
  window.document.body.appendChild(badge);
  window.document.querySelector = (selector) => {
    if (!selector) return null;
    if (String(selector).indexOf('xp-badge') !== -1) return badge;
    return null;
  };
  window.GameXpBridge = {
    isActiveGameWindow() { return true; },
  };

  const overlay = window.XpOverlay && window.XpOverlay.__test;
  assert.ok(overlay, 'overlay test harness should exist');
  overlay.attach();

  const secondsFromEpoch = Math.floor((now + 15_000) / 1000);
  overlay.applyBoost({ multiplier: 1.5, expiresAt: secondsFromEpoch });
  const state = overlay.getState();

  assert.equal(state.timerEl && state.timerEl.textContent, '15s');
  assert.equal(state.multiplierEl && state.multiplierEl.textContent, 'x1.5');
  assert.equal(api.computeRemainingSeconds(state.boost.expiresAt, now), 15);
});
