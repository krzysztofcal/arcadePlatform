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
