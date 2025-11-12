import assert from 'node:assert/strict';

const BASE_TS = 1_700_000_000_000;

const cookieJar = new WeakMap();

async function createHandler(label, overrides = {}) {
  process.env.XP_DEBUG = '1';
  process.env.XP_KEY_NS = `test:delta:${label}`;
  process.env.XP_DAILY_CAP = String(overrides.dailyCap ?? 400);
  process.env.XP_SESSION_CAP = String(overrides.sessionCap ?? 200);
  process.env.XP_DELTA_CAP = String(overrides.deltaCap ?? 300);
  process.env.XP_REQUIRE_ACTIVITY = overrides.requireActivity ? '1' : '0';
  process.env.XP_MIN_ACTIVITY_EVENTS = String(overrides.minEvents ?? 4);
  process.env.XP_MIN_ACTIVITY_VIS_S = String(overrides.minVisibility ?? 8);
  process.env.XP_METADATA_MAX_BYTES = String(overrides.metadataLimit ?? 2048);
  process.env.XP_DAILY_SECRET = overrides.secret ?? 'test-secret';
  const { handler } = await import(`../netlify/functions/award-xp.mjs?case=${label}`);
  return handler;
}

async function invoke(handler, body) {
  const existing = cookieJar.get(handler) ?? '';
  const headers = existing ? { cookie: existing } : {};
  const res = await handler({ httpMethod: 'POST', headers, body: JSON.stringify(body) });
  const setCookie = res.headers?.['set-cookie'] ?? res.headers?.['Set-Cookie'];
  if (setCookie) {
    const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const pair = value.split(';')[0];
    cookieJar.set(handler, pair);
  }
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) };
}

async function testBasicAwarding() {
  const handler = await createHandler('basic');
  const base = { userId: 'user-basic', sessionId: 'sess-basic', ts: BASE_TS };

  const originalNow = Date.now;
  Date.now = () => BASE_TS;
  try {
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
  } finally {
    Date.now = originalNow;
  }
}

async function testDailyCapPartial() {
  const handler = await createHandler('daily', { dailyCap: 180, sessionCap: 500 });
  const base = { userId: 'user-daily', sessionId: 'sess-daily', ts: BASE_TS };

  const originalNow = Date.now;
  Date.now = () => BASE_TS;
  try {
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
  } finally {
    Date.now = originalNow;
  }
}

async function testStaleAndStatus() {
  const handler = await createHandler('stale', { dailyCap: 500, sessionCap: 500 });
  const base = { userId: 'user-stale', sessionId: 'sess-stale', ts: BASE_TS };

  const originalNow = Date.now;
  Date.now = () => BASE_TS;
  try {
    const first = await invoke(handler, { ...base, delta: 60 });
    assert.equal(first.payload.awarded, 60);

    const stale = await invoke(handler, { ...base, delta: 10 });
    assert.equal(stale.payload.awarded, 0);
    assert.equal(stale.payload.stale, true);
    assert.equal(stale.payload.reason, 'stale');

    const status = await invoke(handler, { userId: base.userId, sessionId: base.sessionId, statusOnly: true });
    assert.equal(status.payload.totalToday, 60);
    assert.equal(status.payload.sessionTotal, 60);
    assert.equal(status.payload.status, 'statusOnly');
  } finally {
    Date.now = originalNow;
  }
}

async function testDeltaValidation() {
  const handler = await createHandler('invalid');
  const base = { userId: 'user-invalid', sessionId: 'sess-invalid', ts: BASE_TS };

  const rejected = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ ...base, delta: 500 }) });
  assert.equal(rejected.statusCode, 422);
  const payload = JSON.parse(rejected.body);
  assert.equal(payload.error, 'delta_out_of_range');
  assert.equal(payload.capDelta, 300);
}

async function testMetadataLimits() {
  const handler = await createHandler('metadata', { metadataLimit: 64 });
  const base = { userId: 'meta-user', sessionId: 'meta-session', ts: BASE_TS };

  const accepted = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ ...base, delta: 10, metadata: { note: 'ok' } }) });
  assert.equal(accepted.statusCode, 200);

  const hugeMeta = { ...base, delta: 10, metadata: { blob: 'x'.repeat(200) } };
  const rejected = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(hugeMeta) });
  assert.equal(rejected.statusCode, 413);
  const payload = JSON.parse(rejected.body);
  assert.equal(payload.error, 'metadata_too_large');

  const depthMeta = { ...base, delta: 5, metadata: { a: { b: { c: { d: 1 } } } } };
  const deep = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(depthMeta) });
  assert.equal(deep.statusCode, 413);
  const deepPayload = JSON.parse(deep.body);
  assert.equal(deepPayload.error, 'metadata_too_large');

  const invalid = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ ...base, delta: 5, metadata: 'nope' }) });
  assert.equal(invalid.statusCode, 400);
  const invalidBody = JSON.parse(invalid.body);
  assert.equal(invalidBody.error, 'invalid_metadata');
}

async function testActivityGuard() {
  const handler = await createHandler('activity', { requireActivity: true, minEvents: 3, minVisibility: 5 });
  const base = { userId: 'active-user', sessionId: 'active-session', ts: BASE_TS };

  const inactive = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ ...base, delta: 20, metadata: { inputEvents: 1, visibilitySeconds: 2 } }) });
  assert.equal(inactive.statusCode, 200);
  const inactivePayload = JSON.parse(inactive.body);
  assert.equal(inactivePayload.reason, 'inactive');
  assert.equal(inactivePayload.status, 'inactive');
  assert.equal(inactivePayload.awarded, 0);

  const active = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ ...base, ts: BASE_TS + 10, delta: 20, metadata: { inputEvents: 4, visibilitySeconds: 6 } }) });
  assert.equal(active.statusCode, 200);
  const activePayload = JSON.parse(active.body);
  assert.equal(activePayload.awarded, 20);
}

await testBasicAwarding();
await testDailyCapPartial();
await testStaleAndStatus();
await testDeltaValidation();
await testMetadataLimits();
await testActivityGuard();

console.log('xp-award-delta tests passed');
