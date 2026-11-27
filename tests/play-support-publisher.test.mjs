import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { createPlaySupportPublisher } from '../netlify/functions/_shared/play-support-publisher.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const credentials = {
  client_email: 'synthetic@fixture.iam.gserviceaccount.com',
  private_key: privateKey.export({ format: 'pem', type: 'pkcs8' })
};

test('uses signed service credentials for pinned Play read and acknowledgement paths', async () => {
  const calls = [];
  const publisher = createPlaySupportPublisher({
    environment: 'stage', credentials,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === 'https://oauth2.googleapis.com/token') {
        const [header, claims, signature] = options.body.get('assertion').split('.');
        assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT' });
        const payload = JSON.parse(Buffer.from(claims, 'base64url'));
        assert.equal(payload.scope, 'https://www.googleapis.com/auth/androidpublisher');
        assert.equal(payload.aud, url);
        assert.equal(payload.iss, credentials.client_email);
        assert.ok(verify('RSA-SHA256', Buffer.from(header + '.' + claims), publicKey, Buffer.from(signature, 'base64url')));
        return Response.json({ access_token: 'fixture-access', token_type: 'Bearer', expires_in: 3600 });
      }
      if (options.method === 'GET') return Response.json({ kind: 'fixture-purchase' });
      return new Response(null, { status: 204 });
    }
  });
  assert.deepEqual(await publisher.readPurchase('synthetic/token'), { kind: 'fixture-purchase' });
  await publisher.acknowledge('supporter_gold', 'synthetic/token');

  assert.equal(calls.length, 3, 'OAuth token is cached');
  const root = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/pl.kcswh.arcadepoker.stage';
  assert.equal(calls[1].url, root + '/purchases/productsv2/tokens/synthetic%2Ftoken');
  assert.equal(calls[2].url, root + '/purchases/products/supporter_gold/tokens/synthetic%2Ftoken:acknowledge');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer fixture-access');
  assert.equal(calls[2].options.body, '{}');
  assert.ok(calls.every(({ options }) => options.redirect === 'error' && options.signal));
  await assert.rejects(() => publisher.readPurchase('..'), { code: 'play_support_invalid_token' });
  await assert.rejects(() => publisher.acknowledge('../other-product', 'token'), { code: 'play_support_invalid_sku' });
  assert.equal(calls.length, 3, 'invalid input never reaches the network');
});

test('sanitizes provider failures and keeps Retry-After without interpreting terminal purchase state', async () => {
  const publisher = createPlaySupportPublisher({
    environment: 'production', credentials,
    fetchImpl: async (url) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        return Response.json({ access_token: 'fixture-access', token_type: 'Bearer', expires_in: 3600 });
      }
      if (url.endsWith('/failure')) throw new Error('sensitive/fixture-token');
      return new Response('sensitive response body', { status: 429, headers: { 'retry-after': '12' } });
    }
  });
  await assert.rejects(() => publisher.readPurchase('private-token'), error => {
    assert.equal(error.code, 'play_support_publisher_http');
    assert.equal(error.status, 429);
    assert.equal(error.phase, 'purchase');
    assert.equal(error.retryAfterMs, 12000);
    assert.doesNotMatch(String(error), /sensitive|private-token/);
    assert.equal(error.cause, undefined);
    return true;
  });
  await assert.rejects(() => publisher.readPurchase('failure'), error => {
    assert.equal(error.code, 'play_support_publisher_unavailable');
    assert.doesNotMatch(String(error), /sensitive|fixture-token/);
    return true;
  });
});

test('OAuth failure is distinguishable from a purchase failure', async () => {
  const publisher = createPlaySupportPublisher({
    environment: 'stage', credentials,
    fetchImpl: async () => new Response('sensitive OAuth body', { status: 401 })
  });
  await assert.rejects(() => publisher.readPurchase('private-token'), error => {
    assert.equal(error.phase, 'oauth');
    assert.equal(error.status, 401);
    assert.doesNotMatch(String(error), /sensitive|private-token/);
    return true;
  });
});

test('reads one pinned page of void evidence and refuses an expired window without contacting Play', async () => {
  const now = Date.UTC(2026, 10, 27);
  const startMs = now - 86400000;
  const queries = [];
  const publisher = createPlaySupportPublisher({
    environment: 'stage', credentials, now: () => now,
    fetchImpl: async url => {
      if (url === 'https://oauth2.googleapis.com/token') {
        return Response.json({ access_token: 'fixture-access', token_type: 'Bearer', expires_in: 3600 });
      }
      const target = new URL(url);
      assert.equal(target.pathname, '/androidpublisher/v3/applications/pl.kcswh.arcadepoker.stage/purchases/voidedpurchases');
      queries.push(target.searchParams);
      return target.searchParams.has('token')
        ? Response.json({})
        : Response.json({ voidedPurchases: [{ orderId: 'fixture' }], tokenPagination: { nextPageToken: 'next+/=' } });
    }
  });
  assert.deepEqual(await publisher.listVoidedPurchases({ startMs, endMs: now }), {
    purchases: [{ orderId: 'fixture' }], nextPageToken: 'next+/='
  });
  assert.equal(queries[0].get('startTime'), String(startMs));
  assert.equal(queries[0].get('type'), '0');
  assert.equal(queries[0].get('maxResults'), '50');
  assert.deepEqual(await publisher.listVoidedPurchases({ startMs, endMs: now, pageToken: 'next+/=' }), {
    purchases: [], nextPageToken: null
  });
  assert.equal(queries[1].get('token'), 'next+/=');
  assert.equal(queries[1].get('startTime'), null);
  await assert.rejects(publisher.listVoidedPurchases({ startMs: now - 31 * 86400000, endMs: now }),
    { code: 'play_support_invalid_void_window' });
  assert.equal(queries.length, 2);
});
