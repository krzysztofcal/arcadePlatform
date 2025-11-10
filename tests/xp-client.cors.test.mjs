import assert from 'node:assert/strict';

async function createHandler(ns = 'test:cors') {
  process.env.XP_DEBUG = '0';
  process.env.XP_KEY_NS = ns;
  process.env.XP_CORS_ALLOW = 'https://allowed.test';
  const { handler } = await import('../netlify/functions/award-xp.mjs?cors=' + ns);
  return handler;
}

(async () => {
  const handler = await createHandler();

  const options = await handler({ httpMethod: 'OPTIONS', headers: { origin: 'https://allowed.test' } });
  assert.equal(options.statusCode, 204);
  assert.equal(options.headers['access-control-allow-origin'], 'https://allowed.test');

  const statusOnly = await handler({
    httpMethod: 'POST',
    headers: { origin: 'https://blocked.test' },
    body: JSON.stringify({ userId: 'cors-user', sessionId: 'cors-session', statusOnly: true }),
  });
  assert.equal(statusOnly.statusCode, 200);
  const payload = JSON.parse(statusOnly.body);
  assert.equal(payload.status, 'statusOnly');
  assert.equal(statusOnly.headers['access-control-allow-origin'], '*');

  console.log('xp-client CORS tests passed');
})();
