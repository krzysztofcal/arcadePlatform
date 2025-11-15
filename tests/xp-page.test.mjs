import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
const xpPageSource = await readFile(path.join(repoRoot, 'js', 'xp-page.js'), 'utf8');

function createElement(id) {
  const classSet = new Set();
  const element = {
    id: id || null,
    textContent: '',
    hidden: false,
    style: { width: '' },
    attrs: {},
    classList: {
      add(...names) { names.forEach((name) => { if (name) classSet.add(name); }); },
      remove(...names) { names.forEach((name) => classSet.delete(name)); },
      contains(name) { return classSet.has(name); },
    },
    setAttribute(name, value) { this.attrs[name] = value; },
    getAttribute(name) { return this.attrs[name]; },
  };
  Object.defineProperty(element, 'className', {
    get() { return Array.from(classSet).join(' '); },
    set(value) {
      classSet.clear();
      if (!value) return;
      String(value).split(/\s+/).forEach((entry) => { if (entry) classSet.add(entry); });
    },
  });
  return element;
}

function registerElements() {
  const nodes = new Map();
  const register = (id) => {
    const el = createElement(id);
    nodes.set(id, el);
    return el;
  };
  ['xpLevel', 'xpTotal', 'xpDailyCap', 'xpRemaining', 'xpRemainingHint', 'xpTodayLine',
    'xpCapLine', 'xpRemainingLine', 'xpResetHint', 'xpProgressFill', 'xpProgressDetails',
    'xpBoostStatus', 'xpBoostHint', 'xpComboStatus', 'xpComboHint']
    .forEach(register);
  return nodes;
}

function setupDashboard(snapshot) {
  const nodes = registerElements();
  const pageEl = createElement();
  pageEl.classList.add('xp-page');
  const progressBar = createElement();
  const documentStub = {
    readyState: 'complete',
    body: createElement('body'),
    documentElement: { getAttribute() { return null; } },
    getElementById(id) { return nodes.get(id) || null; },
    querySelector(selector) {
      if (selector === '.xp-page') return pageEl;
      if (selector === '.xp-progress__bar') return progressBar;
      return null;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  documentStub.body.classList = { add() {}, remove() {}, toggle() {} };

  const listeners = new Map();
  const windowStub = {
    document: documentStub,
    XP: {
      refreshStatus: () => Promise.resolve(),
      getSnapshot: () => snapshot,
      getRemainingDaily: () => snapshot.remaining,
      getNextResetEpoch: () => snapshot.nextReset || 0,
      getBoostSnapshot: () => ({ active: false, multiplier: 1, expiresAt: 0, source: null }),
      getComboSnapshot: () => ({
        mode: 'build',
        multiplier: 1,
        points: 0,
        stepThreshold: 1,
        sustainLeftMs: 0,
        cooldownLeftMs: 0,
      }),
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    dispatchEvent(event) {
      const handler = listeners.get(event.type);
      if (handler) handler.call(this, event);
      return true;
    },
  };
  windowStub.window = windowStub;
  windowStub.console = console;
  windowStub.I18N = { t() { return null; } };
  windowStub.CustomEvent = class {};
  windowStub.setTimeout = setTimeout;
  windowStub.clearTimeout = clearTimeout;

  const context = {
    window: windowStub,
    document: documentStub,
    console,
    setTimeout,
    clearTimeout,
    Date,
    Intl,
    Promise,
  };
  context.globalThis = context;
  context.CustomEvent = class {};
  vm.createContext(context);
  new vm.Script(xpPageSource, { filename: 'xp-page.js' }).runInContext(context);
  windowStub.dispatchEvent({ type: 'xp:updated' });
  return nodes;
}

function extractNumber(text) {
  const normalized = String(text || '').replace(/[^0-9]/g, '');
  return normalized ? Number(normalized) : 0;
}

const snapshot = {
  level: 5,
  totalXp: 834,
  totalToday: 124,
  cap: 3_000,
  remaining: 2_876,
  xpIntoLevel: 150,
  xpForNextLevel: 400,
  progress: 0.375,
  nextReset: 0,
};

const nodes = setupDashboard(snapshot);
assert.equal(extractNumber(nodes.get('xpDailyCap').textContent), 3_000);
assert.equal(extractNumber(nodes.get('xpRemaining').textContent), 2_876);
assert.equal(extractNumber(nodes.get('xpTodayLine').textContent), 124);
console.log('xp-page tests passed');
