import assert from 'node:assert/strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_TS = Date.UTC(2024, 0, 2, 3, 4, 5);

async function createHandler(label, overrides = {}) {
  process.env.XP_DEBUG = '1';
  process.env.XP_KEY_NS = `test:delta:${label}`;
  process.env.XP_DAILY_CAP = String(overrides.dailyCap ?? 300);
  process.env.XP_SESSION_CAP = String(overrides.sessionCap ?? 200);
  process.env.XP_DELTA_CAP = String(overrides.deltaCap ?? 300);
  const { handler } = await import(`../netlify/functions/award-xp.mjs?mix=${label}`);
  return handler;
}

async function invoke(handler, body) {
  const res = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) });
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) };
}

async function testDailyAcrossSessions() {
  const handler = await createHandler('multi', { dailyCap: 260, sessionCap: 200 });
  const userId = 'multi-user';

  const firstSession = { userId, sessionId: 'sess-a', ts: BASE_TS };
  const secondSession = { userId, sessionId: 'sess-b', ts: BASE_TS + 50 }; // slight offset

  const first = await invoke(handler, { ...firstSession, delta: 150 });
  assert.equal(first.payload.awarded, 150);
  assert.equal(first.payload.totalToday, 150);
  assert.equal(first.payload.sessionTotal, 150);

  const second = await invoke(handler, { ...secondSession, delta: 150 });
  assert.equal(second.payload.awarded, 110);
  assert.equal(second.payload.capped, true);
  assert.equal(second.payload.reason, 'daily_cap_partial');
  assert.equal(second.payload.totalToday, 260);
  assert.equal(second.payload.sessionTotal, 110);

  const third = await invoke(handler, { ...firstSession, ts: BASE_TS + 120, delta: 20 });
  assert.equal(third.payload.awarded, 0);
  assert.equal(third.payload.capped, true);
  assert.equal(third.payload.reason, 'daily_cap');
}

async function testSessionCapAcrossDays() {
  const handler = await createHandler('carry', { dailyCap: 400, sessionCap: 180 });
  const base = { userId: 'carry-user', sessionId: 'carry-session', ts: BASE_TS };

  const dayOne = await invoke(handler, { ...base, delta: 140 });
  assert.equal(dayOne.payload.awarded, 140);
  assert.equal(dayOne.payload.sessionTotal, 140);

  const dayTwo = await invoke(handler, { ...base, ts: BASE_TS + DAY_MS + 1000, delta: 100 });
  assert.equal(dayTwo.payload.awarded, 40);
  assert.equal(dayTwo.payload.sessionCapped, true);
  assert.equal(dayTwo.payload.reason, 'session_cap_partial');
  assert.equal(dayTwo.payload.sessionTotal, 180);
  assert.equal(dayTwo.payload.totalToday, 40);

  const dayTwoFollowUp = await invoke(handler, { ...base, ts: BASE_TS + DAY_MS + 2000, delta: 50 });
  assert.equal(dayTwoFollowUp.payload.awarded, 0);
  assert.equal(dayTwoFollowUp.payload.sessionCapped, true);
  assert.equal(dayTwoFollowUp.payload.reason, 'session_cap');
}

async function testZeroDeltaAdvancesLastSync() {
  const handler = await createHandler('zero', { dailyCap: 500, sessionCap: 300 });
  const base = { userId: 'zero-user', sessionId: 'zero-session', ts: BASE_TS };

  const first = await invoke(handler, { ...base, delta: 90 });
  assert.equal(first.payload.lastSync, BASE_TS);

  const zeroAward = await invoke(handler, { ...base, ts: BASE_TS + 1234, delta: 0 });
  assert.equal(zeroAward.payload.awarded, 0);
  assert.equal(zeroAward.payload.lastSync, BASE_TS + 1234);
  assert.equal(zeroAward.payload.reason ?? null, null);
}

await testDailyAcrossSessions();
await testSessionCapAcrossDays();
await testZeroDeltaAdvancesLastSync();

console.log('xp-award session/daily tests passed');
