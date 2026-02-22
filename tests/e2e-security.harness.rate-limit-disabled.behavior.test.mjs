import assert from "node:assert/strict";

process.env.XP_DAILY_SECRET = "test-secret-for-sessions-32chars!";
process.env.XP_TEST_MODE = "1";
process.env.XP_RATE_LIMIT_ENABLED = "0";
process.env.XP_CORS_ALLOW = "http://127.0.0.1:4173";
process.env.XP_KEY_NS = `test:rl-disabled:${Date.now()}`;

const { handler } = await import('../netlify/functions/award-xp.mjs');

for (let i = 0; i < 80; i += 1) {
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "http://127.0.0.1:4173", "x-forwarded-for": "203.0.113.90" },
    body: JSON.stringify({ userId: "rl-disabled-user", sessionId: `sess-${i}`, delta: 10, ts: Date.now() + i }),
  });
  assert.notEqual(response.statusCode, 429);
}

console.log("e2e security harness rate-limit-disabled behavior test passed");
