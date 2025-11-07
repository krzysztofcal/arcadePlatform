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
    expect(payload.debug.mode).toBe('time');
    expect(payload.debug.scoreDelta).toBe(null);
    expect('scoreXp' in payload.debug).toBe(false);
  });

  test('provides debug payload in score mode with score deltas', async () => {
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
    expect(payload.debug.mode).toBe('score');
    expect(payload.debug.scoreDelta).toBe(2);
    expect(payload.debug.scoreXp).toBe(20);
    expect(payload.debug.grantStep).toBe(20);
  });
});
