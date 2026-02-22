import assert from 'node:assert/strict';

process.env.XP_DAILY_SECRET = 'test-secret-for-sessions-32chars!';
process.env.XP_SESSION_RATE_LIMIT_ENABLED = '0';

const allowKey = `origin-allow-${Date.now()}`;
process.env.XP_CORS_ALLOW = 'http://127.0.0.1:4173,http://localhost:8888';
let mod = await import(`../netlify/functions/start-session.mjs?${allowKey}`);
let response = await mod.handler({
  httpMethod: 'OPTIONS',
  headers: { origin: 'http://127.0.0.1:4173' },
});
assert.equal(response.statusCode, 204);

const blockKey = `origin-block-${Date.now()}`;
process.env.XP_CORS_ALLOW = 'https://example.netlify.app';
mod = await import(`../netlify/functions/start-session.mjs?${blockKey}`);
response = await mod.handler({
  httpMethod: 'POST',
  headers: { origin: 'http://127.0.0.1:4173' },
  body: JSON.stringify({ userId: 'origin-block-user' }),
});
assert.equal(response.statusCode, 403);
const payload = JSON.parse(response.body || '{}');
assert.equal(payload.message, 'origin_not_allowed');

console.log('e2e origin allowlist behavior test passed');
