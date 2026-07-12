const { test, expect } = require('@playwright/test');

async function loadCalculateHandler(envOverrides = {}) {
  const previous = new Map();
  for (const [key, value] of Object.entries(envOverrides)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  const cacheBuster = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const { handler } = await import(`../../netlify/functions/calculate-xp.mjs?cache=${cacheBuster}`);
  return async (event) => {
    try { return await handler(event); }
    finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };
}

function createAwardEvent(overrides = {}) {
  const now = Date.now();
  return {
    httpMethod: 'POST',
    headers: { origin: 'https://example.com' },
    body: JSON.stringify({
      anonId: overrides.anonId || `score-user-${now}`,
      sessionId: overrides.sessionId || `score-session-${now}`,
      operation: 'award',
      gameId: overrides.gameId || 'cats',
      windowStart: now - 10_000,
      windowEnd: now,
      visibilitySeconds: 10,
      inputEvents: 8,
      gameplayActions: 1,
      scoreDelta: overrides.scoreDelta || 0,
    }),
  };
}

test.describe('authoritative XP score awards handler', () => {
  test('calculates a positive grant from a semantic activity window', async () => {
    const handler = await loadCalculateHandler({ XP_DEBUG: '1', XP_REQUIRE_ACTIVITY: '0', XP_KEY_NS: `e2e:calc:${Date.now()}` });
    const response = await handler(createAwardEvent());
    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.ok).toBe(true);
    expect(payload.awarded).toBeGreaterThan(0);
    expect(payload.totalLifetime).toBeGreaterThanOrEqual(payload.awarded);
  });

  test('accepts score input without trusting a client-provided XP delta', async () => {
    const handler = await loadCalculateHandler({ XP_REQUIRE_ACTIVITY: '0', XP_KEY_NS: `e2e:score:${Date.now()}` });
    const response = await handler(createAwardEvent({ scoreDelta: 200 }));
    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.ok).toBe(true);
    expect(payload.awarded).toBeGreaterThan(0);
    expect(payload.awarded).toBeLessThanOrEqual(payload.capDelta);
  });
});
