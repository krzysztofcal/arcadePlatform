import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'js', 'i18n.js'), 'utf8');

const sandbox = {
  window: {},
  document: {
    readyState: 'loading',
    addEventListener: () => {},
    querySelectorAll: () => [],
    dispatchEvent: () => {},
  },
  navigator: { language: 'en-US' },
  location: { search: '', href: 'https://example.com/poker/table-v2.html?lang=en' },
  history: { replaceState: () => {} },
  localStorage: { getItem: () => null, setItem: () => {} },
  URL,
  URLSearchParams,
  CustomEvent: function CustomEvent(name, init){ this.name = name; this.detail = init && init.detail; },
  requestAnimationFrame: (fn) => fn(),
};

sandbox.window.document = sandbox.document;
sandbox.window.navigator = sandbox.navigator;
sandbox.window.location = sandbox.location;
sandbox.window.history = sandbox.history;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.URL = URL;
sandbox.window.URLSearchParams = URLSearchParams;
sandbox.window.CustomEvent = sandbox.CustomEvent;
sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;

vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'js/i18n.js' });

assert.ok(sandbox.window.I18N, 'I18N API should be exposed');
const requiredKeys = [
  'pokerDumpLogs',
  'pokerDumpLogsPending',
  'pokerDumpLogsOk',
  'pokerDumpLogsFail',
  'pokerDumpLogsEmpty',
];
for (const key of requiredKeys){
  const value = sandbox.window.I18N.t(key);
  assert.ok(value && value.length > 0, `translation for ${key} should exist`);
  assert.notEqual(value, key, `translation for ${key} should not fallback to raw key`);
}
