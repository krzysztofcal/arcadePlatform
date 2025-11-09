import assert from 'node:assert/strict';

const BASE_TS = 1_700_000_000_000;

async function createHandler(label, overrides = {}) {
  process.env.XP_DEBUG = '1';
  process.env.XP_KEY_NS = `test:delta:${label}`;
  process.env.XP_DAILY_CAP = String(overrides.dailyCap ?? 400);
  process.env.XP_SESSION_CAP = String(overrides.sessionCap ?? 200);
  process.env.XP_DELTA_CAP = String(overrides.deltaCap ?? 300);
  const { handler } = await import(`../netlify/functions/award-xp.mjs?case=${label}`);
  return handler;
}

async function invoke(handler, body) {
  const res = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) });
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) };
}

async function testBasicAwarding() {
  const handler = await createHandler('basic');
  const base = { userId: 'user-basic', sessionId: 'sess-basic', ts: BASE_TS };

  const first = await invoke(handler, { ...base, delta: 120 });
  assert.equal(first.statusCode, 200);
  assert.equal(first.payload.awarded, 120);
  assert.equal(first.payload.totalToday, 120);
  assert.equal(first.payload.sessionTotal, 120);
  assert.equal(first.payload.reason ?? null, null);

  const second = await invoke(handler, { ...base, ts: BASE_TS + 10_000, delta: 80 });
  assert.equal(second.payload.awarded, 80);
  assert.equal(second.payload.sessionTotal, 200);
  assert.equal(second.payload.totalToday, 200);
  assert.equal(second.payload.reason ?? null, null);

  const third = await invoke(handler, { ...base, ts: BASE_TS + 20_000, delta: 50 });
  assert.equal(third.payload.awarded, 0);
  assert.equal(third.payload.sessionCapped, true);
  assert.equal(third.payload.reason, 'session_cap');
  assert.equal(third.payload.sessionTotal, 200);
}

async function testDailyCapPartial() {
  const handler = await createHandler('daily', { dailyCap: 180, sessionCap: 500 });
  const base = { userId: 'user-daily', sessionId: 'sess-daily', ts: BASE_TS };

  const first = await invoke(handler, { ...base, delta: 150 });
  assert.equal(first.payload.awarded, 150);
  assert.equal(first.payload.totalToday, 150);

  const second = await invoke(handler, { ...base, ts: BASE_TS + 1, delta: 100 });
  assert.equal(second.payload.awarded, 30);
  assert.equal(second.payload.capped, true);
  assert.equal(second.payload.reason, 'daily_cap_partial');
  assert.equal(second.payload.totalToday, 180);

  const third = await invoke(handler, { ...base, ts: BASE_TS + 2, delta: 10 });
  assert.equal(third.payload.awarded, 0);
  assert.equal(third.payload.capped, true);
  assert.equal(third.payload.reason, 'daily_cap');
}

async function testStaleAndStatus() {
  const handler = await createHandler('stale', { dailyCap: 500, sessionCap: 500 });
  const base = { userId: 'user-stale', sessionId: 'sess-stale', ts: BASE_TS };

  const first = await invoke(handler, { ...base, delta: 60 });
  assert.equal(first.payload.awarded, 60);

  const stale = await invoke(handler, { ...base, delta: 10 });
  assert.equal(stale.payload.awarded, 0);
  assert.equal(stale.payload.stale, true);
  assert.equal(stale.payload.reason, 'stale');

  const originalNow = Date.now;
  Date.now = () => BASE_TS;
  const status = await invoke(handler, { userId: base.userId, sessionId: base.sessionId, statusOnly: true });
  Date.now = originalNow;
  assert.equal(status.payload.totalToday, 60);
  assert.equal(status.payload.sessionTotal, 60);
  assert.equal(status.payload.status, 'statusOnly');
}

async function testDeltaValidation() {
  const handler = await createHandler('invalid');
  const base = { userId: 'user-invalid', sessionId: 'sess-invalid', ts: BASE_TS };

  const rejected = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ ...base, delta: 500 }) });
  assert.equal(rejected.statusCode, 422);
  const payload = JSON.parse(rejected.body);
  assert.equal(payload.error, 'delta_out_of_range');
}

await testBasicAwarding();
await testDailyCapPartial();
await testStaleAndStatus();
await testDeltaValidation();

console.log('xp-award-delta tests passed');
