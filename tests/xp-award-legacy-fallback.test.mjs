process.env.XP_DAILY_SECRET = 'test-secret';

import assert from 'node:assert/strict';

async function createHandler(ns = 'test:legacy-fallback') {
  process.env.XP_DEBUG = '1';
  process.env.XP_KEY_NS = ns;
  process.env.XP_DAILY_CAP = '400';
  process.env.XP_SESSION_CAP = '300';
  process.env.XP_DELTA_CAP = '200';
  const { handler } = await import('../netlify/functions/award-xp.mjs?case=legacy');
  return handler;
}

async function invoke(handler, body) {
  const res = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) });
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) };
}

(async () => {
  const handler = await createHandler();
  const base = { userId: 'legacy-user', sessionId: 'legacy-sess', ts: 1_700_000_000_000 };

  const legacyScoreDelta = await invoke(handler, { ...base, scoreDelta: 50 });
  assert.equal(legacyScoreDelta.statusCode, 200);
  assert.equal(legacyScoreDelta.payload.awarded, 50);

  const legacyPointsPerPeriod = await invoke(handler, { ...base, ts: base.ts + 1, pointsPerPeriod: 30 });
  assert.equal(legacyPointsPerPeriod.statusCode, 200);
  assert.equal(legacyPointsPerPeriod.payload.awarded, 30);

  const missingDelta = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ userId: base.userId, sessionId: base.sessionId, ts: base.ts + 2 }) });
  assert.equal(missingDelta.statusCode, 422);
  const err = JSON.parse(missingDelta.body);
  assert.equal(err.error, 'invalid_delta');

  console.log('xp-award-legacy-fallback tests passed');
})();
