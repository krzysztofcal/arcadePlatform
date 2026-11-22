import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const security = require('../mobile/poker/security.cjs');
const config = JSON.parse(readFileSync(new URL('../mobile/poker/stage-public.json', import.meta.url), 'utf8'));
const prodConfig = JSON.parse(readFileSync(new URL('../mobile/poker/production-public.json', import.meta.url), 'utf8'));

test('mobile cannot target Production, foreign Preview or credential-bearing origins', () => {
  assert.equal(config.apiOrigin, 'https://deploy-preview-1155--playkcswh.netlify.app');
  const anon = JSON.parse(Buffer.from(config.supabaseAnonKey.split('.')[1], 'base64url').toString());
  assert.equal(anon.ref, 'krydukthwdvccggbyjfw');
  assert.equal(anon.role, 'anon');
  assert.equal(security.validate(config).apiOrigin, config.apiOrigin);
  assert.equal(security.publicProfileUrl(config, 'alice'), config.apiOrigin + '/u/alice');
  assert.equal(security.publicProfileUrl(config, '../?x'), config.apiOrigin + '/u/..%2F%3Fx');
  assert.equal(security.publicProfileUrl(prodConfig, 'alice'), 'https://play.kcswh.pl/u/alice');
  assert.equal(security.publicProfileUrl(prodConfig, '../?x'), 'https://play.kcswh.pl/u/..%2F%3Fx');
  assert.throws(() => security.publicProfileUrl({ ...config, apiOrigin: 'https://play.kcswh.pl' }, 'alice'));
  assert.throws(() => security.publicProfileUrl({ ...prodConfig, apiOrigin: 'https://evil.netlify.app' }, 'alice'));
  for (const apiOrigin of ['https://play.kcswh.pl', 'https://evil.netlify.app', 'https://user@deploy-preview-1155--playkcswh.netlify.app', config.apiOrigin + '/path']) {
    assert.throws(() => security.validate({ ...config, apiOrigin }));
  }
  assert.throws(() => security.validate({ ...config, wsUrl: 'wss://ws.kcswh.pl/ws' }));
  assert.throws(() => security.validate({ ...config, supabaseUrl: 'https://other.supabase.co' }));
});

test('callback accepts only exact mobile redirect and one PKCE code; never bearer tokens', () => {
  // Stage callback with default channel or explicit channel
  assert.equal(security.callbackCode('arcadepoker-stage://auth/callback?code=abc'), 'abc');
  assert.equal(security.callbackCode('arcadepoker-stage://auth/callback?code=abc', 'stage'), 'abc');
  for (const url of ['https://evil.test/?code=abc', 'arcadepoker-stage://auth/other?code=abc', 'arcadepoker-stage://evil/callback?code=abc', 'arcadepoker-stage://auth/callback#access_token=secret', 'arcadepoker-stage://auth/callback?code=a&code=b', 'arcadepoker-stage://auth/callback?error=denied']) {
    assert.throws(() => security.callbackCode(url));
  }

  // Production callback without channel defaults to stage and throws
  assert.throws(() => security.callbackCode('https://play.kcswh.pl/app/auth/callback?code=abc'), /Invalid auth callback/);

  // Production callback with channel 'production'
  assert.equal(security.callbackCode('https://play.kcswh.pl/app/auth/callback?code=abc', 'production'), 'abc');

  // Rejects Stage scheme, other host/subdomain/port, other path, hash, multiple/empty codes, error param, credentials
  for (const url of [
    'arcadepoker-stage://auth/callback?code=abc',
    'http://play.kcswh.pl/app/auth/callback?code=abc',
    'https://evil.test/app/auth/callback?code=abc',
    'https://play.kcswh.pl.evil.com/app/auth/callback?code=abc',
    'https://sub.play.kcswh.pl/app/auth/callback?code=abc',
    'https://play.kcswh.pl:8443/app/auth/callback?code=abc',
    'https://play.kcswh.pl/app/auth/callback/?code=abc',
    'https://play.kcswh.pl/app/auth/callbackx?code=abc',
    'https://play.kcswh.pl/other?code=abc',
    'https://play.kcswh.pl/app/auth/callback#access_token=secret',
    'https://play.kcswh.pl/app/auth/callback?code=a&code=b',
    'https://play.kcswh.pl/app/auth/callback?code=',
    'https://play.kcswh.pl/app/auth/callback?error=access_denied',
    'https://user:pass@play.kcswh.pl/app/auth/callback?code=abc',
    'https://user@play.kcswh.pl/app/auth/callback?code=abc'
  ]) {
    assert.throws(() => security.callbackCode(url, 'production'));
  }

  // Unknown channel throws
  assert.throws(() => security.callbackCode('https://play.kcswh.pl/app/auth/callback?code=abc', 'unknown'), /Unknown channel/);
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
  vm.runInNewContext(source, { window, document, URL, Event, navigator: connectivity, sessionStorage: { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, value); }, removeItem(key) { storage.delete(key); } }, setTimeout });
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
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(exchanged, 'recovery-code');
  assert.equal(navigated, false, 'do not discard shared PASSWORD_RECOVERY state');
  await listeners.appUrlOpen({ url: 'arcadepoker-stage://auth/callback?code=recovery-code' });
  await new Promise(resolve => setTimeout(resolve, 5));
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
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.match(node.textContent, /Sign-in return failed/);
  assert.equal(node.hidden, false);
  window.Capacitor.Plugins = {};
  ready();
  assert.match(node.textContent, /Mobile sign-in is unavailable/);
});

test('production native PKCE callback uses HTTPS App Link, rejects Stage scheme, and scrubs codes', async () => {
  const { readFile } = await import('node:fs/promises');
  const vm = await import('node:vm');
  const source = await readFile(new URL('../mobile/poker/runtime.js', import.meta.url), 'utf8');
  const listeners = {};
  let ready;
  let exchanged;
  let exchangeCount = 0;
  const openedUrls = [];
  let closedBrowser = false;
  const klogEntries = [];
  const connectivity = { onLine: true };
  const events = [];
  const pageListeners = {};
  const barCalls = [];
  const storage = new Map();
  let navigated = false;
  const node = { textContent: '', hidden: true };
  const document = {
    addEventListener(name, fn) { if (name === 'DOMContentLoaded') ready = fn; },
    getElementById() { return node; }
  };
  const window = {
    MobilePokerSecurity: security,
    MOBILE_POKER_CONFIG: { ...prodConfig, sha: '12345678' },
    KLog: { log(kind, data) { klogEntries.push({ kind, data }); } },
    Capacitor: { Plugins: {
      Browser: {
        open: async (options) => { openedUrls.push(options.url); return {}; },
        close: async () => { closedBrowser = true; }
      },
      SystemBars: { hide: async () => { barCalls.push('hide'); }, show: async () => { barCalls.push('show'); } },
      App: { addListener(name, fn) { listeners[name] = fn; }, getLaunchUrl: async () => null }
    } },
    supabaseClient: { auth: {
      startAutoRefresh() {},
      stopAutoRefresh() {},
      exchangeCodeForSession: async code => {
        exchanged = code;
        exchangeCount++;
        return { data: { session: {} } };
      }
    } },
    location: { pathname: '/account.html', replace() { navigated = true; } },
    addEventListener(name, fn) { pageListeners[name] = fn; },
    dispatchEvent(event) { events.push(event.type); }
  };

  vm.runInNewContext(source, {
    window,
    document,
    URL,
    Event,
    navigator: connectivity,
    sessionStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, value); },
      removeItem(key) { storage.delete(key); }
    },
    setTimeout
  });

  ready();

  // Verify redirectTo is the Production HTTPS callback
  assert.equal(window.MobilePoker.redirectTo, 'https://play.kcswh.pl/app/auth/callback');

  // openOAuth rejects Stage redirect_to
  const stageRedirectOAuth = `https://otbqfijerkieoxwpxjnm.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent('arcadepoker-stage://auth/callback')}`;
  await assert.rejects(() => window.MobilePoker.openOAuth(stageRedirectOAuth), /google_failed/);

  // openOAuth rejects Stage supabaseUrl
  const wrongOriginOAuth = `https://krydukthwdvccggbyjfw.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent('https://play.kcswh.pl/app/auth/callback')}`;
  await assert.rejects(() => window.MobilePoker.openOAuth(wrongOriginOAuth), /google_failed/);

  // openOAuth rejects duplicated redirect_to (both orders: good+evil, evil+good)
  const goodEvilOAuth = `https://otbqfijerkieoxwpxjnm.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent('https://play.kcswh.pl/app/auth/callback')}&redirect_to=${encodeURIComponent('https://evil.com')}`;
  await assert.rejects(() => window.MobilePoker.openOAuth(goodEvilOAuth), /google_failed/);

  const evilGoodOAuth = `https://otbqfijerkieoxwpxjnm.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent('https://evil.com')}&redirect_to=${encodeURIComponent('https://play.kcswh.pl/app/auth/callback')}`;
  await assert.rejects(() => window.MobilePoker.openOAuth(evilGoodOAuth), /google_failed/);

  // openOAuth rejects duplicated provider
  const dupProviderOAuth = `https://otbqfijerkieoxwpxjnm.supabase.co/auth/v1/authorize?provider=google&provider=github&redirect_to=${encodeURIComponent('https://play.kcswh.pl/app/auth/callback')}`;
  await assert.rejects(() => window.MobilePoker.openOAuth(dupProviderOAuth), /google_failed/);

  const dupProviderOAuth2 = `https://otbqfijerkieoxwpxjnm.supabase.co/auth/v1/authorize?provider=github&provider=google&redirect_to=${encodeURIComponent('https://play.kcswh.pl/app/auth/callback')}`;
  await assert.rejects(() => window.MobilePoker.openOAuth(dupProviderOAuth2), /google_failed/);

  // browser.open was never called for any rejected OAuth URL
  assert.equal(openedUrls.length, 0);

  // openOAuth succeeds with single correct URL
  const validOAuth = `https://otbqfijerkieoxwpxjnm.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent('https://play.kcswh.pl/app/auth/callback')}`;
  await window.MobilePoker.openOAuth(validOAuth);
  assert.equal(openedUrls.length, 1);
  assert.equal(openedUrls[0], validOAuth);

  // HTTPS callback exchanges code
  const prodSecretCode = 'prod-auth-code-12345';
  await listeners.appUrlOpen({ url: `https://play.kcswh.pl/app/auth/callback?code=${prodSecretCode}` });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(exchanged, prodSecretCode);
  assert.equal(exchangeCount, 1);
  assert.equal(closedBrowser, true);
  assert.match(node.textContent, /Signed in/);

  // Stage-scheme URL is rejected in Production (notice shown, no exchange)
  const strayStageCode = 'stray-stage-code-67890';
  node.textContent = '';
  await listeners.appUrlOpen({ url: `arcadepoker-stage://auth/callback?code=${strayStageCode}` });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(exchangeCount, 1, 'rejected callback must not exchange code');
  assert.match(node.textContent, /Sign-in return failed or expired/);
  assert.equal(node.textContent.includes(strayStageCode), false, 'notice text must never contain auth code');

  // Callback with error= shows generic notice and no exchange
  const leakCode = 'leak-code-99999';
  node.textContent = '';
  await listeners.appUrlOpen({ url: `https://play.kcswh.pl/app/auth/callback?error=access_denied&code=${leakCode}` });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(exchangeCount, 1, 'error callback must not exchange code');
  assert.match(node.textContent, /Sign-in return failed or expired/);
  assert.equal(node.textContent.includes(leakCode), false, 'notice text must never contain code');
  assert.equal(node.textContent.includes('access_denied'), false, 'notice text must never contain error detail');

  // Verify klog payloads never contain the codes
  for (const entry of klogEntries) {
    const raw = JSON.stringify(entry);
    assert.equal(raw.includes(prodSecretCode), false);
    assert.equal(raw.includes(strayStageCode), false);
    assert.equal(raw.includes(leakCode), false);
  }
});

test('production runtime recovery handoff from non-account page to account.html', async () => {
  const { readFile } = await import('node:fs/promises');
  const vm = await import('node:vm');
  const source = await readFile(new URL('../mobile/poker/runtime.js', import.meta.url), 'utf8');

  const storage = new Map();
  const sessionStorage = {
    getItem(key) { return storage.get(key) || null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); }
  };

  // Phase 1: Boot on /poker/index.html
  const listeners1 = {};
  let ready1;
  let exchanged1 = null;
  let exchangeCount1 = 0;
  let replacedUrl1 = null;
  const node1 = { textContent: '', hidden: true };
  const document1 = {
    addEventListener(name, fn) { if (name === 'DOMContentLoaded') ready1 = fn; },
    getElementById() { return node1; }
  };
  const window1 = {
    MobilePokerSecurity: security,
    MOBILE_POKER_CONFIG: { ...prodConfig, sha: '12345678' },
    KLog: { log() {} },
    Capacitor: { Plugins: {
      Browser: { close: async () => {} },
      SystemBars: { hide: async () => {}, show: async () => {} },
      App: { addListener(name, fn) { listeners1[name] = fn; }, getLaunchUrl: async () => null }
    } },
    supabaseClient: { auth: {
      exchangeCodeForSession: async (code) => {
        exchanged1 = code;
        exchangeCount1++;
        return { data: { session: {} } };
      }
    } },
    location: {
      pathname: '/poker/index.html',
      replace(url) { replacedUrl1 = url; }
    },
    addEventListener() {},
    dispatchEvent() {}
  };

  vm.runInNewContext(source, {
    window: window1,
    document: document1,
    URL,
    Event,
    navigator: { onLine: true },
    sessionStorage,
    setTimeout
  });
  ready1();

  // Trigger appUrlOpen with recovery callback while on lobby
  await listeners1.appUrlOpen({ url: 'https://play.kcswh.pl/app/auth/callback?code=rec-1' });
  await new Promise(resolve => setTimeout(resolve, 5));

  assert.equal(sessionStorage.getItem('mobilePokerAuthCode'), 'rec-1');
  assert.equal(replacedUrl1, '/account.html');
  assert.equal(exchangeCount1, 0, 'no exchange on lobby; deferred to account.html');
  assert.equal(exchanged1, null);

  // Phase 2: Boot again on /account.html with the same storage
  const listeners2 = {};
  let ready2;
  let exchanged2 = null;
  let exchangeCount2 = 0;
  let launchUrlCalls2 = 0;
  const node2 = { textContent: '', hidden: true };
  const document2 = {
    addEventListener(name, fn) { if (name === 'DOMContentLoaded') ready2 = fn; },
    getElementById() { return node2; }
  };
  const window2 = {
    MobilePokerSecurity: security,
    MOBILE_POKER_CONFIG: { ...prodConfig, sha: '12345678' },
    KLog: { log() {} },
    Capacitor: { Plugins: {
      Browser: { close: async () => {} },
      SystemBars: { hide: async () => {}, show: async () => {} },
      App: { addListener(name, fn) { listeners2[name] = fn; }, getLaunchUrl: async () => { launchUrlCalls2++; return { url: 'https://play.kcswh.pl/app/auth/callback?code=older-launch' }; } }
    } },
    supabaseClient: { auth: {
      exchangeCodeForSession: async (code) => {
        exchanged2 = code;
        exchangeCount2++;
        return { data: { session: {} } };
      }
    } },
    location: {
      pathname: '/account.html',
      replace() {}
    },
    addEventListener() {},
    dispatchEvent() {}
  };

  vm.runInNewContext(source, {
    window: window2,
    document: document2,
    URL,
    Event,
    navigator: { onLine: true },
    sessionStorage,
    setTimeout
  });
  ready2();

  // Allow setTimeout and async callback to complete
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(exchanged2, 'rec-1');
  assert.equal(exchangeCount2, 1);
  assert.equal(launchUrlCalls2, 0, 'pending handoff code wins over an older launch URL');
  assert.equal(sessionStorage.getItem('mobilePokerAuthCode'), null, 'mobilePokerAuthCode consumed and removed');
  assert.equal(sessionStorage.getItem('mobilePokerConsumedAuthCode'), 'rec-1');
  assert.match(node2.textContent, /Signed in/);
  assert.equal(node2.textContent.includes('rec-1'), false, 'notice must not leak auth code');
});

test('pending handoff code starts before an appUrlOpen delivered at listener registration (T2A-07)', async () => {
  const { readFile } = await import('node:fs/promises');
  const vm = await import('node:vm');
  const source = await readFile(new URL('../mobile/poker/runtime.js', import.meta.url), 'utf8');
  const store = new Map([['mobilePokerAuthCode', 'handoff-1']]);
  const exchanged = [];
  let ready;
  const node = { textContent: '', hidden: true };
  const window = {
    MobilePokerSecurity: security, MOBILE_POKER_CONFIG: { ...prodConfig, sha: '12345678' }, KLog: { log() {} },
    Capacitor: { Plugins: {
      Browser: { close: async () => {} },
      SystemBars: { hide: async () => {}, show: async () => {} },
      // Deliver a different callback synchronously while the listener registers, before the handoff timer.
      App: { addListener(name, fn) { if (name === 'appUrlOpen') fn({ url: 'https://play.kcswh.pl/app/auth/callback?code=later-2' }); }, getLaunchUrl: async () => null }
    } },
    supabaseClient: { auth: { exchangeCodeForSession: async code => { exchanged.push(code); return { data: { session: {} } }; } } },
    location: { pathname: '/account.html', replace() {} }, addEventListener() {}, dispatchEvent() {}
  };
  const sessionStorage = { getItem: key => store.get(key) || null, setItem: (key, value) => { store.set(key, value); }, removeItem: key => { store.delete(key); } };
  vm.runInNewContext(source, { window, document: { addEventListener(name, fn) { if (name === 'DOMContentLoaded') ready = fn; }, getElementById: () => node }, URL, Event, navigator: { onLine: true }, sessionStorage, setTimeout });
  ready();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(exchanged, ['handoff-1'], 'only the handed-over code is exchanged; the later callback cannot pre-empt it');
  assert.equal(store.get('mobilePokerAuthCode'), undefined);
  assert.equal(store.get('mobilePokerConsumedAuthCode'), 'handoff-1');
  assert.equal(node.textContent.includes('handoff-1') || node.textContent.includes('later-2'), false);

  // Variant (T2A-08): nothing pending, the same synchronous delivery, and the shared client is created
  // only after the runtime boot (as supabaseClient.js does later in DOMContentLoaded).
  store.clear();
  exchanged.length = 0;
  const client = window.supabaseClient;
  window.supabaseClient = null;
  vm.runInNewContext(source, { window, document: { addEventListener(name, fn) { if (name === 'DOMContentLoaded') ready = fn; }, getElementById: () => node }, URL, Event, navigator: { onLine: true }, sessionStorage, setTimeout });
  ready();
  window.supabaseClient = client;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(exchanged, ['later-2'], 'a callback delivered during boot waits for the shared client');
  assert.equal(store.get('mobilePokerConsumedAuthCode'), 'later-2');

  // Variant (T2A-09): nothing pending and an older launch URL resolves at once; the callback delivered
  // during registration still starts first.
  store.clear();
  exchanged.length = 0;
  window.Capacitor.Plugins.App.getLaunchUrl = async () => ({ url: 'https://play.kcswh.pl/app/auth/callback?code=older-0' });
  vm.runInNewContext(source, { window, document: { addEventListener(name, fn) { if (name === 'DOMContentLoaded') ready = fn; }, getElementById: () => node }, URL, Event, navigator: { onLine: true }, sessionStorage, setTimeout });
  ready();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(exchanged, ['later-2'], 'the fresh callback wins and the older launch URL is not replayed');
});

test('js/api-url resolves netlify functions per channel and fails safely on invalid config', async () => {
  const { readFile } = await import('node:fs/promises');
  const vm = await import('node:vm');
  const apiUrlSource = await readFile(new URL('../js/api-url.js', import.meta.url), 'utf8');

  function makeContext(cfg) {
    const win = {
      MOBILE_POKER_CONFIG: cfg,
      MobilePokerSecurity: security
    };
    vm.runInNewContext(apiUrlSource, { window: win });
    return win;
  }

  // Production config
  const prodWin = makeContext(prodConfig);
  assert.equal(prodWin.ArcadeApi.url('/.netlify/functions/poker-state'), 'https://play.kcswh.pl/.netlify/functions/poker-state');
  assert.equal(prodWin.ArcadeApi.url('/poker/index.html'), '/poker/index.html', 'non-function path unchanged');
  assert.equal(prodWin.ArcadeApi.url('/.netlify/functions/poker-state\\escape'), '/.netlify/functions/poker-state\\escape', 'backslash guard');
  assert.equal(prodWin.ArcadeApi.url('/.netlify/functions/poker-state\r\n'), '/.netlify/functions/poker-state\r\n', 'CRLF guard');

  // Stage config
  const stageWin = makeContext(config);
  assert.equal(stageWin.ArcadeApi.url('/.netlify/functions/poker-state'), config.apiOrigin + '/.netlify/functions/poker-state');
  assert.equal(stageWin.ArcadeApi.url('/account.html'), '/account.html', 'non-function path unchanged');

  // No config (web environment)
  const webWin = makeContext(null);
  assert.equal(webWin.ArcadeApi.url('/.netlify/functions/poker-state'), '/.netlify/functions/poker-state');

  // Invalid config throws
  const invalidWin = makeContext({ ...prodConfig, apiOrigin: 'https://evil.netlify.app' });
  assert.throws(() => invalidWin.ArcadeApi.url('/.netlify/functions/poker-state'));

  // Missing security module throws
  const noSecWin = { MOBILE_POKER_CONFIG: prodConfig };
  vm.runInNewContext(apiUrlSource, { window: noSecWin });
  assert.throws(() => noSecWin.ArcadeApi.url('/.netlify/functions/poker-state'), /Mobile security configuration missing/);
});

test('verified binding pins own PR/SHA/site and never reuses parent or Production origin', () => {
  const sha = 'a'.repeat(40);
  const binding = { prNumber: 1160, sourceSha: sha, apiOrigin: 'https://deploy-preview-1160--playkcswh.netlify.app', netlify: { deployId: '6ae3c8f8dfcc32f97a6aba47', sourceSha: sha, reviewId: 1160, context: 'deploy-preview', state: 'ready', siteId: 'f7e19a84-28f7-41f7-978a-f3b4552a404d', siteName: 'playkcswh', origin: 'https://deploy-preview-1160--playkcswh.netlify.app' } };
  assert.equal(security.forPreview(config, binding, 1160, sha).apiOrigin, binding.apiOrigin);
  for (const patch of [{ apiOrigin: config.apiOrigin }, { apiOrigin: 'https://play.kcswh.pl' }, { sourceSha: 'b'.repeat(40) }, { prNumber: 1155 }, { netlify: { ...binding.netlify, siteId: 'other' } }, { netlify: { ...binding.netlify, context: 'production' } }]) {
    assert.throws(() => security.forPreview(config, { ...binding, ...patch }, 1160, sha));
  }
});

test('#1300 native Google sign-in: Production only, SHA-256 nonce pairing, cancel, no double call, no secrets in logs, WWW routing unchanged', async () => {
  const { readFile } = await import('node:fs/promises');
  const vm = await import('node:vm');
  const { webcrypto, createHash } = await import('node:crypto');
  const runtimeSource = await readFile(new URL('../mobile/poker/runtime.js', import.meta.url), 'utf8');
  const clientSource = await readFile(new URL('../js/auth/supabaseClient.js', import.meta.url), 'utf8');
  function boot(config, google, cryptoImpl = webcrypto) {
    const logs = [];
    const window = {
      MobilePokerSecurity: security, MOBILE_POKER_CONFIG: { ...config, sha: '12345678' }, KLog: { log(kind, data) { logs.push(JSON.stringify([kind, data])); } },
      crypto: cryptoImpl,
      Capacitor: { Plugins: { Browser: { open: async () => {}, close: async () => {} }, SystemBars: { hide: async () => {}, show: async () => {} },
        App: { addListener() {}, getLaunchUrl: async () => null }, PokerGoogleSignIn: google } },
      location: { pathname: '/account.html', replace() {} }, addEventListener() {}, dispatchEvent() {}
    };
    const document = { addEventListener() {}, getElementById: () => ({ textContent: '', hidden: true }) };
    vm.runInNewContext(runtimeSource, { window, document, URL, Event, TextEncoder, navigator: { onLine: true }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, setTimeout });
    return { window, logs };
  }
  const sha256Hex = value => createHash('sha256').update(value).digest('hex');
  const until = async check => { for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 2)); assert.ok(check()); };

  // Production: Google gets only SHA-256(raw nonce); Supabase gets the raw nonce and the ID token.
  const seenNonces = [], idTokenCalls = [];
  let release;
  const google = { signIn: ({ nonce }) => { seenNonces.push(nonce); return new Promise(resolve => { release = () => resolve({ idToken: 'secret-id-token' }); }); }, clearCredential: async () => {} };
  const prod = boot(prodConfig, google);
  assert.equal(prod.window.MobilePoker.nativeGoogle, true);
  const client = { auth: { signInWithIdToken: async args => { idTokenCalls.push(args); return { data: { session: { user: { id: 'u1' } } } }; } } };
  const first = prod.window.MobilePoker.signInWithGoogle(client);
  for (let i = 0; i < 50 && !release; i++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(typeof release, 'function', 'native picker opened');
  await assert.rejects(prod.window.MobilePoker.signInWithGoogle(client), /google_in_progress/);
  release();
  await first;
  assert.equal(seenNonces.length, 1, 'no parallel native picker');
  assert.equal(idTokenCalls.length, 1);
  assert.equal(idTokenCalls[0].provider, 'google');
  assert.equal(idTokenCalls[0].token, 'secret-id-token');
  assert.match(idTokenCalls[0].nonce, /^[0-9a-f]{64}$/);
  assert.equal(seenNonces[0], sha256Hex(idTokenCalls[0].nonce), 'Google receives SHA-256 hex of the raw nonce');

  // Cancel and native failures stay retryable and never reach Supabase.
  for (const [code, expected] of [['canceled', /google_canceled/], ['no_credential', /google_unavailable/], ['failed', /google_failed/]]) {
    const failing = boot(prodConfig, { signIn: async () => { const e = new Error('native'); e.code = code; throw e; }, clearCredential: async () => {} });
    const calls = [];
    await assert.rejects(failing.window.MobilePoker.signInWithGoogle({ auth: { signInWithIdToken: async a => { calls.push(a); return {}; } } }), expected);
    assert.equal(calls.length, 0);
  }
  const rejected = boot(prodConfig, { signIn: async () => ({ idToken: 'secret-id-token' }), clearCredential: async () => {} });
  await assert.rejects(rejected.window.MobilePoker.signInWithGoogle({ auth: { signInWithIdToken: async () => ({ error: { message: 'secret-id-token invalid' } }) } }), /google_failed/);
  for (const line of [...prod.logs, ...rejected.logs]) {
    assert.doesNotMatch(line, /secret-id-token/);
    assert.doesNotMatch(line, new RegExp(idTokenCalls[0].nonce));
  }

  // Stage keeps browser OAuth: no native sign-in and no plugin call.
  let stageCalls = 0;
  const stage = boot(config, { signIn: async () => { stageCalls++; return { idToken: 'x' }; }, clearCredential: async () => {} });
  assert.equal(stage.window.MobilePoker.nativeGoogle, false);
  await assert.rejects(stage.window.MobilePoker.signInWithGoogle(client), /google_unavailable/);
  assert.equal(stageCalls, 0);

  // js/auth/supabaseClient.js routes to the native method only when MobilePoker.nativeGoogle is true.
  function loadAuth(mobilePoker) {
    const oauthCalls = [], idCalls = [], signOuts = [];
    const fakeClient = { auth: {
      signInWithOAuth: async args => { oauthCalls.push(args); return { data: { url: 'https://otbqfijerkieoxwpxjnm.supabase.co/auth/v1/authorize?provider=google' } }; },
      signInWithIdToken: async args => { idCalls.push(args); return { data: { session: {} } }; },
      signOut: async () => { signOuts.push(1); return {}; },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getSession: async () => ({ data: { session: null } })
    } };
    const window = { SUPABASE_CONFIG: { SUPABASE_URL: 'https://otbqfijerkieoxwpxjnm.supabase.co', SUPABASE_ANON_KEY: 'anon', AUTH_GOOGLE_ENABLED: true },
      supabase: { createClient: () => fakeClient }, MobilePoker: mobilePoker, location: { origin: 'https://play.kcswh.pl', protocol: 'https:', assign() {} } };
    const document = { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
    vm.runInNewContext(clientSource, { window, document, URL, fetch: async () => ({ ok: true, json: async () => ({ external: { google: true } }) }), setTimeout, console: { log() {}, warn() {}, error() {} } });
    return { auth: window.SupabaseAuth, client: fakeClient, oauthCalls, idCalls, signOuts };
  }
  let nativeArg = null, cleared = 0;
  const native = loadAuth({ nativeGoogle: true, signInWithGoogle: async c => { nativeArg = c; return { data: { session: {} } }; }, clearGoogleCredential: async () => { cleared++; return true; } });
  await native.auth.signInWithGoogle();
  assert.ok(nativeArg && nativeArg.auth, 'native method receives the shared Supabase client');
  assert.equal(native.oauthCalls.length, 0, 'no browser OAuth in the Production APK');
  const canceled = loadAuth({ nativeGoogle: true, signInWithGoogle: async () => { throw new Error('google_canceled'); } });
  await assert.rejects(canceled.auth.signInWithGoogle(), /auth_cancelled/, 'cancel reuses the Account page cancel message');
  await native.auth.signOut();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(native.signOuts.length, 1);
  assert.equal(cleared, 1, 'explicit sign-out clears the native Google account choice');
  const www = loadAuth(undefined);
  await www.auth.signInWithGoogle();
  assert.equal(www.oauthCalls.length, 1, 'WWW keeps browser OAuth');
  assert.equal(www.idCalls.length, 0);
  // GOOGLE-07: Supabase sign-out runs only after a running native exchange settles; its result reaches the caller.
  let settle;
  const ordering = loadAuth({ nativeGoogle: true, signInWithGoogle: async () => ({}), clearGoogleCredential: async () => true, googleSettled: () => new Promise(resolve => { settle = resolve; }) });
  const signOutError = { error: { message: 'network' } };
  ordering.client.auth.signOut = async () => { ordering.signOuts.push(1); return signOutError; };
  const orderingSignOut = ordering.auth.signOut();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(ordering.signOuts.length, 0, 'Supabase sign-out waits for the exchange');
  settle(true);
  assert.equal(await orderingSignOut, signOutError, 'the caller receives the Supabase sign-out result unchanged');
  assert.equal(ordering.signOuts.length, 1);
  ordering.client.auth.signOut = async () => { throw new Error('offline'); };
  const previousSettle = settle;
  const rejectedSignOut = ordering.auth.signOut();
  await until(() => settle !== previousSettle);
  settle(true);
  await assert.rejects(rejectedSignOut, /offline/, 'a rejected Supabase sign-out reaches the caller');
  // GOOGLE-03: nativeGoogle without the native method never falls back to the browser callback.
  const broken = loadAuth({ nativeGoogle: true });
  await assert.rejects(broken.auth.signInWithGoogle(), /google_unavailable/);
  assert.equal(broken.oauthCalls.length, 0);

  // GOOGLE-01a: sign-out while the picker is open discards its result.
  let openPicker;
  const pickerBoot = boot(prodConfig, { signIn: () => new Promise(resolve => { openPicker = resolve; }), clearCredential: async () => {} });
  const pickerExchange = [];
  const pickerAttempt = pickerBoot.window.MobilePoker.signInWithGoogle({ auth: { signInWithIdToken: async a => { pickerExchange.push(a); return { data: { session: {} } }; }, signOut: async () => ({}) } });
  await until(() => openPicker);
  await pickerBoot.window.MobilePoker.clearGoogleCredential();
  openPicker({ idToken: 'secret-id-token' });
  await assert.rejects(pickerAttempt, /google_canceled/);
  assert.equal(pickerExchange.length, 0);
  // GOOGLE-11: a picker that returns after the sign-out's clear finished triggers another clear; the next sign-in waits.
  let resolvePicker11; const clears11 = []; let picker11 = 0;
  const boot11 = boot(prodConfig, { signIn: () => { picker11++; return picker11 === 1 ? new Promise(resolve => { resolvePicker11 = resolve; }) : Promise.resolve({ idToken: 'secret-id-token' }); }, clearCredential: () => new Promise(resolve => { clears11.push(resolve); }) });
  const attempt11 = boot11.window.MobilePoker.signInWithGoogle({ auth: { signInWithIdToken: async () => ({ data: { session: {} } }) } });
  await until(() => resolvePicker11);
  const firstClear11 = boot11.window.MobilePoker.clearGoogleCredential();
  await until(() => clears11.length === 1);
  clears11[0]();
  await firstClear11;
  resolvePicker11({ idToken: 'secret-id-token' });
  await assert.rejects(attempt11, /google_canceled/);
  await until(() => clears11.length === 2);
  const next11 = boot11.window.MobilePoker.signInWithGoogle({ auth: { signInWithIdToken: async () => ({ data: { session: {} } }) } });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(picker11, 1, 'next sign-in waits for the clear after the late account choice');
  clears11[1]();
  await next11;
  assert.equal(picker11, 2);
  // GOOGLE-12: the same holds when the invalidated picker ends with an error instead of a result.
  let rejectPicker12; const clears12 = []; let picker12 = 0;
  const boot12 = boot(prodConfig, { signIn: () => { picker12++; return picker12 === 1 ? new Promise((_, reject) => { rejectPicker12 = reject; }) : Promise.resolve({ idToken: 'secret-id-token' }); }, clearCredential: () => new Promise(resolve => { clears12.push(resolve); }) });
  const attempt12 = boot12.window.MobilePoker.signInWithGoogle({ auth: { signInWithIdToken: async () => ({ data: { session: {} } }) } });
  await until(() => rejectPicker12);
  const firstClear12 = boot12.window.MobilePoker.clearGoogleCredential();
  await until(() => clears12.length === 1);
  clears12[0]();
  await firstClear12;
  rejectPicker12(Object.assign(new Error('native'), { code: 'failed' }));
  await assert.rejects(attempt12, /google_canceled/);
  await until(() => clears12.length === 2);
  const next12 = boot12.window.MobilePoker.signInWithGoogle({ auth: { signInWithIdToken: async () => ({ data: { session: {} } }) } });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(picker12, 1, 'next sign-in waits for the clear after the late picker error');
  clears12[1]();
  await next12;
  assert.equal(picker12, 2);
  // GOOGLE-09: a sign-out queued as the very next microtask after the picker resolves still prevents the exchange.
  let resolvePicker09; const exchange09 = [];
  const boot09 = boot(prodConfig, { signIn: () => new Promise(resolve => { resolvePicker09 = resolve; }), clearCredential: async () => {} });
  const attempt09 = boot09.window.MobilePoker.signInWithGoogle({ auth: { signInWithIdToken: async a => { exchange09.push(a); return { data: { session: {} } }; }, signOut: async () => ({}) } });
  await until(() => resolvePicker09);
  resolvePicker09({ idToken: 'secret-id-token' });
  // Two microtasks later lands exactly between the post-picker check and the queued exchange (Node/V8 job order;
  // the picker promise comes from another realm). The previous code sent the token in this window.
  queueMicrotask(() => queueMicrotask(() => { boot09.window.MobilePoker.clearGoogleCredential(); }));
  await assert.rejects(attempt09, /google_canceled/);
  assert.equal(exchange09.length, 0, 'no token reaches Supabase after the sign-out');
  // GOOGLE-01b: sign-out during the token exchange ends with a final Supabase sign-out.
  let finishExchange; const lateSignOuts = [];
  const exchangeBoot = boot(prodConfig, { signIn: async () => ({ idToken: 'secret-id-token' }), clearCredential: async () => {} });
  const exchangeAttempt = exchangeBoot.window.MobilePoker.signInWithGoogle({ auth: {
    signInWithIdToken: () => new Promise(resolve => { finishExchange = () => resolve({ data: { session: {} } }); }),
    signOut: async () => { lateSignOuts.push(1); return {}; } } });
  await until(() => finishExchange);
  await exchangeBoot.window.MobilePoker.clearGoogleCredential();
  let settled = false;
  exchangeBoot.window.MobilePoker.googleSettled().then(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(settled, false, 'a sign-out waits for the running ID-token exchange');
  finishExchange();
  await assert.rejects(exchangeAttempt, /google_canceled/);
  await until(() => settled);
  assert.equal(lateSignOuts.length, 0, 'the user sign-out (not the runtime) removes the exchanged session');
  // GOOGLE-04/08: a sign-out while the nonce digest is still running never opens the picker.
  let releaseDigest, digestStarted = false, hashingPicker = 0;
  const slowCrypto = { getRandomValues: a => webcrypto.getRandomValues(a), subtle: { digest: (alg, data) => { digestStarted = true; return new Promise(resolve => { releaseDigest = () => resolve(webcrypto.subtle.digest(alg, data)); }); } } };
  const hashingBoot = boot(prodConfig, { signIn: async () => { hashingPicker++; return { idToken: 'secret-id-token' }; }, clearCredential: async () => {} }, slowCrypto);
  const hashingAttempt = hashingBoot.window.MobilePoker.signInWithGoogle({ auth: { signInWithIdToken: async () => ({ data: { session: {} } }) } });
  await until(() => digestStarted);
  await hashingBoot.window.MobilePoker.clearGoogleCredential();
  releaseDigest();
  await assert.rejects(hashingAttempt, /google_canceled/);
  assert.equal(hashingPicker, 0);
  // GOOGLE-02: the next native sign-in waits until the credential-state clear has finished.
  let finishClear; let pickerCalls = 0;
  const clearBoot = boot(prodConfig, { signIn: async () => { pickerCalls++; return { idToken: 'secret-id-token' }; }, clearCredential: () => new Promise(resolve => { finishClear = resolve; }) });
  clearBoot.window.MobilePoker.clearGoogleCredential();
  const afterClear = clearBoot.window.MobilePoker.signInWithGoogle({ auth: { signInWithIdToken: async () => ({ data: { session: {} } }) } });
  await until(() => finishClear);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(pickerCalls, 0, 'picker stays closed while the previous account is being cleared');
  finishClear();
  await afterClear;
  assert.equal(pickerCalls, 1);
  // GOOGLE-05: two sign-outs chain their clears; the next sign-in waits for both.
  const clears = []; let chainPicker = 0;
  const chainBoot = boot(prodConfig, { signIn: async () => { chainPicker++; return { idToken: 'secret-id-token' }; }, clearCredential: () => new Promise(resolve => { clears.push(resolve); }) });
  chainBoot.window.MobilePoker.clearGoogleCredential();
  chainBoot.window.MobilePoker.clearGoogleCredential();
  const chained = chainBoot.window.MobilePoker.signInWithGoogle({ auth: { signInWithIdToken: async () => ({ data: { session: {} } }) } });
  await until(() => clears.length === 1);
  clears[0]();
  await until(() => clears.length === 2);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(chainPicker, 0, 'second clear still pending');
  clears[1]();
  await chained;
  assert.equal(chainPicker, 1);
});
