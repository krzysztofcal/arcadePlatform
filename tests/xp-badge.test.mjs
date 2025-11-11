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
  assert.equal(typeof testApi.normalizeBoostCountdown, 'function', 'normalizeBoostCountdown helper should exist');
  assert.equal(typeof testApi.getRemainingSeconds, 'function', 'getRemainingSeconds helper should exist');

  return { helper: testApi.normalizeBoostCountdown, helpers: testApi, warnings, window: windowObj };
}

test('normalizeBoostCountdown prefers secondsLeft when valid', () => {
  const { helper } = loadOverlay(0);
  assert.equal(helper({ secondsLeft: 12 }), 12);
});

test('normalizeBoostCountdown falls back to ttlMs', () => {
  const { helper } = loadOverlay(0);
  assert.equal(helper({ ttlMs: 9_500 }), 9);
});

test('normalizeBoostCountdown derives from endsAt', () => {
  const now = 10_000;
  const { helper } = loadOverlay(now);
  assert.equal(helper({ endsAt: now + 8_000 }), 8);
});

test('normalizeBoostCountdown clamps epoch seconds to realistic countdown', () => {
  const fakeNow = 1_731_280_000_000;
  const { helper } = loadOverlay(fakeNow);
  const normalized = helper({ secondsLeft: Math.floor(fakeNow / 1000) });
  assert.ok(normalized >= 0 && normalized <= 3600, 'normalized value should be within range');
});

test('getRemainingSeconds normalizes epoch expiresAt values', () => {
  const fakeNow = 1_731_280_000_000;
  const { helpers } = loadOverlay(fakeNow);
  const epochSeconds = Math.floor((fakeNow + 20_000) / 1000);
  const remaining = helpers.getRemainingSeconds(epochSeconds, fakeNow);
  assert.ok(remaining > 0 && remaining <= 20, 'remaining seconds should reflect delta, not epoch');
});

test('boost timer renders normalized countdown from epoch expiresAt', () => {
  const now = 1_731_280_000_000;
  const { window } = loadOverlay(now);
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
  overlay.applyBoost({ multiplier: 1.5, endsAt: secondsFromEpoch });
  const state = overlay.getState();

  assert.equal(state.timerEl && state.timerEl.textContent, '00:15');
  assert.equal(state.multiplierEl && state.multiplierEl.textContent, 'x1.5');
});
