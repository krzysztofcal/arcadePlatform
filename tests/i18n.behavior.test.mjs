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
  location: {
    search: '',
    hash: '',
    href: 'https://example.com/poker/table-v2.html',
    pathname: '/poker/table-v2.html',
    assign: (url) => { sandbox.assignedUrl = url; },
  },
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
  'admin',
  'adminTitle',
  'adminUnauthorized',
  'adminSearchPlaceholder',
];
for (const key of requiredKeys){
  const value = sandbox.window.I18N.t(key);
  assert.ok(value && value.length > 0, `translation for ${key} should exist`);
  assert.notEqual(value, key, `translation for ${key} should not fallback to raw key`);
}

sandbox.window.I18N.setLang('pl');
assert.equal(sandbox.window.I18N.t('accountTitle'), 'Twoje konto', 'setLang should update the active language on regular pages');
assert.equal(sandbox.assignedUrl, undefined, 'setLang should not navigate on regular pages');

const localizedSandbox = {
  ...sandbox,
  window: {},
  location: {
    search: '?source=test',
    hash: '#details',
    href: 'https://example.com/legal/terms.en.html?source=test',
    pathname: '/legal/terms.en.html',
    assign: (url) => { localizedSandbox.assignedUrl = url; },
  },
  localStorage: { getItem: () => 'pl', setItem: () => {} },
};
localizedSandbox.window.document = localizedSandbox.document;
localizedSandbox.window.navigator = localizedSandbox.navigator;
localizedSandbox.window.location = localizedSandbox.location;
localizedSandbox.window.history = localizedSandbox.history;
localizedSandbox.window.localStorage = localizedSandbox.localStorage;
localizedSandbox.window.URL = URL;
localizedSandbox.window.URLSearchParams = URLSearchParams;
localizedSandbox.window.CustomEvent = localizedSandbox.CustomEvent;
localizedSandbox.window.requestAnimationFrame = localizedSandbox.requestAnimationFrame;
vm.createContext(localizedSandbox);
vm.runInContext(source, localizedSandbox, { filename: 'js/i18n.js' });

assert.equal(localizedSandbox.window.I18N.getLang(), 'en', 'a localized document path should take precedence over stored language');
localizedSandbox.window.I18N.setLang('pl');
assert.equal(localizedSandbox.assignedUrl, '/legal/terms.pl.html?source=test#details', 'switching localized documents should navigate to the matching language file');
