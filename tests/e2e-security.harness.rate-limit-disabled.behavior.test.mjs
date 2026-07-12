import assert from "node:assert/strict";

process.env.XP_DAILY_SECRET = "test-secret-for-sessions-32chars!";
process.env.XP_TEST_MODE = "1";
process.env.XP_RATE_LIMIT_ENABLED = "0";
process.env.XP_CORS_ALLOW = "http://127.0.0.1:4173";
process.env.XP_KEY_NS = `test:rl-disabled:${Date.now()}`;

const { handler } = await import('../netlify/functions/calculate-xp.mjs');

for (let i = 0; i < 80; i += 1) {
  const response = await handler({
    httpMethod: "POST",
    headers: { origin: "http://127.0.0.1:4173", "x-forwarded-for": "203.0.113.90" },
    body: JSON.stringify({
      anonId: "rl-disabled-user",
      operation: "award",
      sessionId: `sess-${i}`,
      gameId: "2048",
      windowStart: Date.now() - 1_000,
      windowEnd: Date.now() + i,
      inputEvents: 2,
      visibilitySeconds: 1,
      gameplayActions: 1,
      scoreDelta: 2,
    }),
  });
  assert.notEqual(response.statusCode, 429);
}

console.log("e2e security harness rate-limit-disabled behavior test passed");
