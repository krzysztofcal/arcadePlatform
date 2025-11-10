const { test, expect } = require('@playwright/test');

function applyEnvOverrides(overrides = {}) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      previous.set(key, process.env[key]);
    } else {
      previous.set(key, undefined);
    }
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function loadAwardHandler(envOverrides = {}) {
  const restoreImportEnv = applyEnvOverrides(envOverrides);
  const cacheBuster = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const module = await import(`../../netlify/functions/award-xp.mjs?cache=${cacheBuster}`);
  const { handler } = module;
  restoreImportEnv();

  return async function wrapped(event) {
    const restoreInvocationEnv = applyEnvOverrides(envOverrides);
    try {
      return await handler(event);
    } finally {
      restoreInvocationEnv();
    }
  };
}

let namespaceCounter = 0;
function nextNamespace(prefix) {
  namespaceCounter += 1;
  return `e2e:xp:${prefix}:${Date.now()}:${namespaceCounter}`;
}

function createAwardEvent(overrides = {}) {
  const now = Date.now();
  const chunkMs = overrides.chunkMs ?? 10_000;
  const body = {
    userId: overrides.userId ?? 'user-default',
    gameId: overrides.gameId ?? 'game-default',
    sessionId: overrides.sessionId ?? `session-${now}-${Math.random().toString(16).slice(2)}`,
    windowStart: overrides.windowStart ?? (now - chunkMs),
    windowEnd: overrides.windowEnd ?? now,
    chunkMs,
    visibilitySeconds: overrides.visibilitySeconds ?? 20,
    inputEvents: overrides.inputEvents ?? 8,
    pointsPerPeriod: overrides.pointsPerPeriod ?? 10,
    scoreDelta: overrides.scoreDelta,
    statusOnly: overrides.statusOnly,
  };

  for (const key of Object.keys(body)) {
    if (body[key] === undefined) {
      delete body[key];
    }
  }

  return {
    httpMethod: 'POST',
    headers: { origin: 'https://example.com' },
    body: JSON.stringify(body),
  };
}

test.describe('XP score awards handler', () => {
  test('provides debug payload in time mode when XP_DEBUG=1', async () => {
    const handler = await loadAwardHandler({
      XP_DEBUG: '1',
      XP_USE_SCORE: '0',
      XP_KEY_NS: nextNamespace('time'),
      XP_DAILY_CAP: '100',
    });

    const res = await handler(createAwardEvent({
      userId: 'time-user',
      gameId: 'time-game',
    }));

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.debug).toBeTruthy();
    // Delta-based debug payload mirrors the server contract.
    expect(typeof payload.debug.delta).toBe('number');
    expect(typeof payload.debug.ts).toBe('number');
    expect(typeof payload.debug.now).toBe('number');
    expect(payload.debug.sessionCap).toBeGreaterThan(0);
    expect(payload.debug.dailyCap).toBeGreaterThan(0);
    expect(payload.awarded).toBeGreaterThan(0);
    if (payload.reason) {
      expect(typeof payload.reason).toBe('string');
    }
  });

  test('provides delta-based debug payload with score input', async () => {
    const handler = await loadAwardHandler({
      XP_DEBUG: '1',
      XP_USE_SCORE: '1',
      XP_SCORE_TO_XP: '10',
      XP_MAX_XP_PER_WINDOW: '25',
      XP_DAILY_CAP: '50',
      XP_KEY_NS: nextNamespace('score'),
    });

    const res = await handler(createAwardEvent({
      userId: 'score-user',
      gameId: 'score-game',
      scoreDelta: 2,
    }));

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.debug).toBeTruthy();
    expect(typeof payload.debug.delta).toBe('number');
    expect(payload.awarded).toBe(payload.debug.delta);
    expect(typeof payload.debug.ts).toBe('number');
    expect(typeof payload.debug.now).toBe('number');
    expect(payload.debug.sessionCap).toBeGreaterThan(0);
    expect(payload.debug.dailyCap).toBeGreaterThan(0);
    if (payload.reason) {
      expect(typeof payload.reason).toBe('string');
    }
  });
});
