import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const security = require('../mobile/poker/security.cjs');
const config = { apiOrigin: 'https://deploy-preview-1141--playkcswh.netlify.app', supabaseUrl: 'https://krydukthwdvccggbyjfw.supabase.co', wsUrl: 'wss://ws-preview.kcswh.pl/ws' };
test('mobile cannot target Production, foreign Preview or credential-bearing origins', () => {
  assert.equal(security.validate(config).apiOrigin, config.apiOrigin);
  assert.equal(security.publicProfileUrl(config, 'alice'), config.apiOrigin + '/u/alice');
  assert.equal(security.publicProfileUrl(config, '../?x'), config.apiOrigin + '/u/..%2F%3Fx');
  assert.throws(() => security.publicProfileUrl({ ...config, apiOrigin: 'https://play.kcswh.pl' }, 'alice'));
  for (const apiOrigin of ['https://play.kcswh.pl', 'https://evil.netlify.app', 'https://user@deploy-preview-1141--playkcswh.netlify.app', config.apiOrigin + '/path']) {
    assert.throws(() => security.validate({ ...config, apiOrigin }));
  }
  assert.throws(() => security.validate({ ...config, wsUrl: 'wss://ws.kcswh.pl/ws' }));
  assert.throws(() => security.validate({ ...config, supabaseUrl: 'https://other.supabase.co' }));
});
test('callback accepts only exact mobile redirect and one PKCE code; never bearer tokens', () => {
  assert.equal(security.callbackCode('arcadepoker-stage://auth/callback?code=abc'), 'abc');
  for (const url of ['https://evil.test/?code=abc', 'arcadepoker-stage://auth/other?code=abc', 'arcadepoker-stage://evil/callback?code=abc', 'arcadepoker-stage://auth/callback#access_token=secret', 'arcadepoker-stage://auth/callback?code=a&code=b', 'arcadepoker-stage://auth/callback?error=denied']) {
    assert.throws(() => security.callbackCode(url));
  }
});

test('native PKCE callback uses injected plugins and preserves recovery document', async () => {
  const { readFile } = await import('node:fs/promises');
  const vm = await import('node:vm');
  const source = await readFile(new URL('../mobile/poker/runtime.js', import.meta.url), 'utf8');
  const listeners = {};
  let ready;
  let exchanged;
  let exchangeCount = 0;
  const connectivity = { onLine: false };
  const events = [];
  const pageListeners = {};
  const barCalls = [];
  let refreshStarts = 0;
  const storage = new Map();
  let navigated = false;
  const node = { textContent: '' };
  const document = { addEventListener(name, fn) { if (name === 'DOMContentLoaded') ready = fn; }, getElementById() { return node; } };
  const window = {
    MobilePokerSecurity: security, MOBILE_POKER_CONFIG: { ...config, sha: '12345678' },
    Capacitor: { Plugins: {
      Browser: { close: async () => {} },
      SystemBars: { hide: async () => { barCalls.push('hide'); }, show: async () => { barCalls.push('show'); } },
      App: { addListener(name, fn) { listeners[name] = fn; }, getLaunchUrl: async () => null }
    } },
    supabaseClient: { auth: { startAutoRefresh() { refreshStarts++; }, stopAutoRefresh() {}, exchangeCodeForSession: async code => { exchanged = code; exchangeCount++; return { data: { session: {} } }; } } },
    location: { pathname: '/account.html', replace() { navigated = true; } }, addEventListener(name, fn) { pageListeners[name] = fn; }, dispatchEvent(event) { events.push(event.type); }
  };
  vm.runInNewContext(source, { window, document, URL, Event, navigator: connectivity, sessionStorage: { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, value); }, removeItem(key) { storage.delete(key); } } });
  ready();
  assert.equal(node.textContent, '', 'normal boot has no developer/connectivity status');
  if (pageListeners.offline) pageListeners.offline();
  if (pageListeners.online) pageListeners.online();
  assert.equal(node.textContent, '', 'connectivity changes create no diagnostic banner');
  assert.deepEqual(barCalls, ['show'], 'Account is never immersive');
  listeners.appStateChange({ isActive: true });
  assert.deepEqual(events, [], 'offline resume must not emit online');
  assert.equal(refreshStarts, 1);
  connectivity.onLine = true;
  listeners.appStateChange({ isActive: true });
  assert.deepEqual(events, ['online']);
  await listeners.appUrlOpen({ url: 'arcadepoker-stage://auth/callback?code=recovery-code' });
  // Listener deliberately schedules asynchronous completion; drain promise chain.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(exchanged, 'recovery-code');
  assert.equal(navigated, false, 'do not discard shared PASSWORD_RECOVERY state');
  await listeners.appUrlOpen({ url: 'arcadepoker-stage://auth/callback?code=recovery-code' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(exchangeCount, 1, 'ignore a repeated launch callback after successful consumption');
  // Table-only lifecycle routing, independent of Auth availability; no layout assertions.
  barCalls.length = 0;
  window.location.pathname = '/poker/table-v2.html';
  window.supabaseClient = null;
  ready();
  listeners.appStateChange({ isActive: false });
  listeners.appStateChange({ isActive: true });
  window.location.pathname = '/poker/index.html';
  ready();
  window.location.pathname = '/poker/table-v2.html';
  ready();
  window.location.pathname = '/account.html';
  ready();
  assert.deepEqual(barCalls, ['hide','show','hide','show','hide','show']);
  await listeners.appUrlOpen({ url: 'https://evil.test/?code=invalid' });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(node.textContent, /Sign-in return failed/);
  assert.equal(node.hidden, false);
  window.Capacitor.Plugins = {};
  ready();
  assert.match(node.textContent, /Mobile sign-in is unavailable/);
});

test('verified binding pins own PR/SHA/site and never reuses parent or Production origin', () => {
  const sha = 'a'.repeat(40);
  const binding = { prNumber: 1160, sourceSha: sha, apiOrigin: 'https://deploy-preview-1160--playkcswh.netlify.app', netlify: { deployId: '6ae3c8f8dfcc32f97a6aba47', sourceSha: sha, reviewId: 1160, context: 'deploy-preview', state: 'ready', siteId: 'f7e19a84-28f7-41f7-978a-f3b4552a404d', siteName: 'playkcswh', origin: 'https://deploy-preview-1160--playkcswh.netlify.app' } };
  assert.equal(security.forPreview(config, binding, 1160, sha).apiOrigin, binding.apiOrigin);
  for (const patch of [{ apiOrigin: config.apiOrigin }, { apiOrigin: 'https://play.kcswh.pl' }, { sourceSha: 'b'.repeat(40) }, { prNumber: 1155 }, { netlify: { ...binding.netlify, siteId: 'other' } }, { netlify: { ...binding.netlify, context: 'production' } }]) {
    assert.throws(() => security.forPreview(config, { ...binding, ...patch }, 1160, sha));
  }
});
