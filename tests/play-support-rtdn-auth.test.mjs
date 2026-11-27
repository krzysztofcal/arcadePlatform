import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createPlaySupportPushVerifier } from '../netlify/functions/_shared/play-support-rtdn-auth.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const audience = 'https://preview.invalid/notify';
const serviceAccountEmail = 'push@fixture.iam.gserviceaccount.com';
const now = Date.UTC(2026, 10, 27, 12);
const kid = 'fixture-key';
const jwt = (overrides = {}, header = {}) => {
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = encoded({ alg: 'RS256', kid, ...header }) + '.' + encoded({
    iss: 'https://accounts.google.com', aud: audience, email: serviceAccountEmail, email_verified: true,
    iat: now / 1000 - 5, exp: now / 1000 + 60, ...overrides
  });
  return 'Bearer ' + input + '.' + sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
};

test('pins Google signing keys and rejects wrong audience, identity, expiry and signature', async () => {
  let requests = 0;
  const verify = createPlaySupportPushVerifier({
    audience, serviceAccountEmail, now: () => now,
    fetchImpl: async (url, options) => {
      requests++;
      assert.equal(url, 'https://www.googleapis.com/oauth2/v3/certs');
      assert.equal(options.redirect, 'error');
      return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }] });
    }
  });
  assert.equal(await verify(jwt({ aud: 'wrong' })), false);
  assert.equal(await verify(jwt({ email: 'wrong@fixture.invalid' })), false);
  assert.equal(await verify(jwt({ exp: now / 1000 - 1 })), false);
  assert.equal(await verify(jwt({ email_verified: false })), false);
  assert.equal(await verify(jwt({ iss: 'https://wrong.invalid' })), false);
  assert.equal(await verify(jwt({ iat: undefined })), false);
  assert.equal(await verify(jwt({}, { alg: 'none' })), false);
  assert.equal(requests, 0, 'invalid claims must not reach JWKS');
  assert.equal(await verify(jwt()), true);
  assert.equal(await verify(jwt()), true);
  const valid = jwt();
  const signatureAt = valid.lastIndexOf('.') + 1;
  assert.equal(await verify(valid.slice(0, signatureAt) + (valid[signatureAt] === 'A' ? 'B' : 'A') + valid.slice(signatureAt + 1)), false);
  assert.equal(requests, 1);
});

test('key lookup failure is retryable and does not expose fetch errors', async () => {
  const verify = createPlaySupportPushVerifier({
    audience, serviceAccountEmail, now: () => now,
    fetchImpl: async () => { throw new Error('private fixture details'); }
  });
  await assert.rejects(() => verify(jwt()), /^Error: play_support_push_keys_unavailable$/);
});

test('refresh is bounded even when the key response has a short TTL', async () => {
  let clock = now;
  let requests = 0;
  const verifier = createPlaySupportPushVerifier({
    audience, serviceAccountEmail, now: () => clock,
    fetchImpl: async () => {
      requests++;
      return Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }] },
        { headers: { 'cache-control': 'public, max-age=0' } });
    }
  });
  assert.equal(await verifier(jwt()), true);
  assert.equal(await verifier(jwt({}, { kid: 'unknown-key' })), false);
  assert.equal(requests, 1);
  clock += 31_000;
  assert.equal(await verifier(jwt()), true);
  assert.equal(requests, 2);
});
