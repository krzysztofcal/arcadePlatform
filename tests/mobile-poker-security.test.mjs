import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const security = require('../mobile/poker/security.cjs');
const config = { apiOrigin: 'https://deploy-preview-1095--playkcswh.netlify.app', supabaseUrl: 'https://krydukthwdvccggbyjfw.supabase.co', wsUrl: 'wss://ws-preview.kcswh.pl/ws' };
test('mobile cannot target Production, foreign Preview or credential-bearing origins', () => {
  assert.equal(security.validate(config).apiOrigin, config.apiOrigin);
  for (const apiOrigin of ['https://play.kcswh.pl', 'https://evil.netlify.app', 'https://user@deploy-preview-1095--playkcswh.netlify.app', config.apiOrigin + '/path']) {
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
  let navigated = false;
  const node = { textContent: '' };
  const document = { addEventListener(name, fn) { if (name === 'DOMContentLoaded') ready = fn; }, getElementById() { return node; } };
  const window = {
    MobilePokerSecurity: security, MOBILE_POKER_CONFIG: { ...config, sha: '12345678' },
    Capacitor: { Plugins: {
      Browser: { close: async () => {} },
      App: { addListener(name, fn) { listeners[name] = fn; }, getLaunchUrl: async () => null }
    } },
    supabaseClient: { auth: { exchangeCodeForSession: async code => { exchanged = code; return { data: { session: {} } }; } } },
    location: { pathname: '/account.html', replace() { navigated = true; } }, addEventListener() {}
  };
  vm.runInNewContext(source, { window, document, URL, navigator: { onLine: true }, sessionStorage: { getItem() { return null; }, removeItem() {} } });
  ready();
  await listeners.appUrlOpen({ url: 'arcadepoker-stage://auth/callback?code=recovery-code' });
  // Listener deliberately schedules asynchronous completion; drain promise chain.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(exchanged, 'recovery-code');
  assert.equal(navigated, false, 'do not discard shared PASSWORD_RECOVERY state');
});
