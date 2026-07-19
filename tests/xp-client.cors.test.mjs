import assert from 'node:assert/strict';
import { buildApiCorsPolicy, buildCorsHeaders } from '../netlify/functions/_shared/api-cors.mjs';

process.env.XP_DAILY_SECRET = 'test-secret-for-sessions-32chars!';

const normalizedPolicy = buildApiCorsPolicy({
  configuredOrigins: 'https://allowed.test,not-a-url,https://user:pass@example.test,https://allowed.test/path',
  buildContext: 'deploy-preview',
  buildDeployOrigin: 'https://current-preview.netlify.app',
});
assert.deepEqual(normalizedPolicy.origins, ['https://allowed.test', 'https://current-preview.netlify.app']);
assert.equal(normalizedPolicy.invalidConfiguredOriginCount, 3);
const credentialedHeaders = buildCorsHeaders({ origin: 'https://allowed.test', policy: normalizedPolicy, credentials: true });
assert.equal(credentialedHeaders['access-control-allow-credentials'], 'true');
assert.equal(buildCorsHeaders({ origin: 'https://other-preview.netlify.app', policy: normalizedPolicy }), null);
assert.equal(buildCorsHeaders({ origin: 'https://allowed.test/path', policy: normalizedPolicy }), null);

async function createHandler(ns = 'test:cors') {
  process.env.XP_DEBUG = '0';
  process.env.XP_KEY_NS = ns;
  process.env.XP_CORS_ALLOW = 'https://allowed.test';
  const { handler } = await import('../netlify/functions/calculate-xp.mjs?cors=' + ns);
  return handler;
}

(async () => {
  const handler = await createHandler();

  // Test 1: Allowed origin should work
  const options = await handler({ httpMethod: 'OPTIONS', headers: { origin: 'https://allowed.test' } });
  assert.equal(options.statusCode, 204);
  assert.equal(options.headers['access-control-allow-origin'], 'https://allowed.test');
  assert.equal(options.headers.Vary, 'Origin');

  // Test 2: Blocked origin should be rejected with 403
  const blocked = await handler({
    httpMethod: 'POST',
    headers: { origin: 'https://blocked.test' },
    body: JSON.stringify({ anonId: 'cors-user', operation: 'status' }),
  });
  assert.equal(blocked.statusCode, 403);
  const blockedPayload = JSON.parse(blocked.body);
  assert.equal(blockedPayload.error, 'forbidden');
  assert.equal(blockedPayload.message, 'origin_not_allowed');
  assert.equal(blocked.headers['access-control-allow-origin'], undefined);
  assert.equal(blocked.headers['access-control-allow-credentials'], undefined);

  const unrelatedPreview = await handler({
    httpMethod: 'OPTIONS',
    headers: { origin: 'https://unrelated-preview.netlify.app' },
  });
  assert.equal(unrelatedPreview.statusCode, 403);

  // Test 3: Allowed origin should get proper response
  const allowed = await handler({
    httpMethod: 'POST',
    headers: { origin: 'https://allowed.test' },
    body: JSON.stringify({ anonId: 'cors-user', operation: 'status' }),
  });
  assert.equal(allowed.statusCode, 200);
  const allowedPayload = JSON.parse(allowed.body);
  assert.equal(allowedPayload.status, 'statusOnly');
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://allowed.test');

  // Test 4: No origin (same-origin/local) should work
  const noOrigin = await handler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({ anonId: 'cors-user2', operation: 'status' }),
  });
  assert.equal(noOrigin.statusCode, 200);
  const noOriginPayload = JSON.parse(noOrigin.body);
  assert.equal(noOriginPayload.status, 'statusOnly');
  // No CORS headers for same-origin requests
  assert.equal(noOrigin.headers['access-control-allow-origin'], undefined);

  console.log('xp-client CORS tests passed');
})();
