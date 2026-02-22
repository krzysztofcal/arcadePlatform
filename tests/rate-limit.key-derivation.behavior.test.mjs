import assert from 'node:assert/strict';

process.env.XP_DAILY_SECRET = 'test-secret-for-sessions-32chars!';
process.env.XP_TEST_MODE = '1';
process.env.XP_RATE_LIMIT_ENABLED = '1';
process.env.XP_RATE_LIMIT_USER_PER_MIN = '100';
process.env.XP_RATE_LIMIT_IP_PER_MIN = '2';
process.env.XP_RATE_LIMIT_WINDOW_SEC = '2';
process.env.XP_KEY_NS = `test:rate-key:${Date.now()}`;
process.env.XP_CORS_ALLOW = 'http://127.0.0.1:4173';

const { handler } = await import('../netlify/functions/award-xp.mjs');

const post = (ip, userId = `user-${Date.now()}`) =>
  handler({
    httpMethod: 'POST',
    headers: {
      origin: 'http://127.0.0.1:4173',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify({ userId, sessionId: `sess-${Date.now()}`, delta: 10, ts: Date.now() }),
  });

const ipA = '203.0.113.50';
const ipB = '203.0.113.51';

const a1 = await post(ipA, 'rate-key-user-a');
const a2 = await post(ipA, 'rate-key-user-b');
const a3 = await post(ipA, 'rate-key-user-c');
assert.equal(a1.statusCode, 200);
assert.equal(a2.statusCode, 200);
assert.equal(a3.statusCode, 429);

const b1 = await post(ipB, 'rate-key-user-d');
assert.equal(b1.statusCode, 200);

const a4 = await post(ipA, 'rate-key-user-e');
assert.equal(a4.statusCode, 429);

console.log('rate-limit key derivation behavior test passed');
