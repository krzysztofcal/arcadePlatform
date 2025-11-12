import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const BASE_TS = 1_700_000_000_000;

const cookieJar = new WeakMap();
const XP_DAY_COOKIE = 'xp_day';
const DEFAULT_SECRET = 'test-secret';

function getJar(handler) {
  let jar = cookieJar.get(handler);
  if (!jar) {
    jar = new Map();
    cookieJar.set(handler, jar);
  }
  return jar;
}

function readCookie(handler, name = 'default') {
  const jar = getJar(handler);
  return jar.get(name) ?? '';
}

function storeCookie(handler, value, name = 'default') {
  const jar = getJar(handler);
  jar.set(name, value);
}

function decodeCookie(pair) {
  if (!pair) return null;
  const [, value] = pair.split('=');
  if (!value) return null;
  const [payload] = value.split('.');
  if (!payload) return null;
  const json = Buffer.from(payload, 'base64url').toString('utf8');
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function expectCookieTotal(pair, expected) {
  const decoded = decodeCookie(pair);
  assert.ok(decoded, 'cookie parsed');
  assert.equal(decoded.t, expected);
}

function buildSignedCookie({ key, total, secret = DEFAULT_SECRET }) {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
  const payload = JSON.stringify({ k: key, t: safeTotal });
  const encoded = Buffer.from(payload, 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${XP_DAY_COOKIE}=${encoded}.${signature}`;
}

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

async function invoke(handler, body, options = {}) {
  const jarName = options.jar ?? 'default';
  const existing = readCookie(handler, jarName);
  const headers = existing ? { cookie: existing } : {};
  const res = await handler({ httpMethod: options.method ?? 'POST', headers, body: JSON.stringify(body) });
  const setCookie = res.headers?.['Set-Cookie'] ?? res.headers?.['set-cookie'];
  let pair = null;
  if (setCookie) {
    const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    pair = value.split(';')[0];
    storeCookie(handler, pair, jarName);
  }
  return { statusCode: res.statusCode, payload: JSON.parse(res.body), cookie: pair, headers: res.headers };
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
    assert.equal(first.payload.remaining, 280);
    expectCookieTotal(first.cookie, 120);

    const second = await invoke(handler, { ...base, ts: BASE_TS + 10_000, delta: 80 });
    assert.equal(second.payload.awarded, 80);
    assert.equal(second.payload.sessionTotal, 200);
    assert.equal(second.payload.totalToday, 200);
    assert.equal(second.payload.reason ?? null, null);
    assert.equal(second.payload.remaining, 200);
    expectCookieTotal(second.cookie, 200);

    const third = await invoke(handler, { ...base, ts: BASE_TS + 20_000, delta: 50 });
    assert.equal(third.payload.awarded, 0);
    assert.equal(third.payload.sessionCapped, true);
    assert.equal(third.payload.reason, 'session_cap');
    assert.equal(third.payload.sessionTotal, 200);
    assert.equal(third.payload.totalToday, 200);
    assert.equal(third.payload.remaining, 200);
    expectCookieTotal(third.cookie, 200);
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
    assert.equal(first.payload.remaining, 30);
    expectCookieTotal(first.cookie, 150);

    const second = await invoke(handler, { ...base, ts: BASE_TS + 1, delta: 100 });
    assert.equal(second.payload.awarded, 30);
    assert.equal(second.payload.capped, true);
    assert.equal(second.payload.reason, 'daily_cap_partial');
    assert.equal(second.payload.totalToday, 180);
    assert.equal(second.payload.remaining, 0);
    expectCookieTotal(second.cookie, 180);

    const third = await invoke(handler, { ...base, ts: BASE_TS + 2, delta: 10 });
    assert.equal(third.payload.awarded, 0);
    assert.equal(third.payload.capped, true);
    assert.equal(third.payload.reason, 'daily_cap');
    assert.equal(third.payload.totalToday, 180);
    assert.equal(third.payload.remaining, 0);
    expectCookieTotal(third.cookie, 180);
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
    expectCookieTotal(first.cookie, 60);

    const stale = await invoke(handler, { ...base, delta: 10 });
    assert.equal(stale.payload.awarded, 0);
    assert.equal(stale.payload.stale, true);
    assert.equal(stale.payload.reason, 'stale');
    assert.equal(stale.payload.totalToday, 60);
    assert.equal(stale.payload.remaining, 440);
    expectCookieTotal(stale.cookie, 60);

    const status = await invoke(handler, { userId: base.userId, sessionId: base.sessionId, statusOnly: true });
    assert.equal(status.payload.totalToday, 60);
    assert.equal(status.payload.sessionTotal, 60);
    assert.equal(status.payload.status, 'statusOnly');
    assert.equal(status.payload.remaining, 440);
    expectCookieTotal(status.cookie, 60);
  } finally {
    Date.now = originalNow;
  }
}

async function testStatusOnlyHealsCookie() {
  const handler = await createHandler('status-heal');
  const base = { userId: 'heal-user', sessionId: 'heal-session', ts: BASE_TS };

  const originalNow = Date.now;
  Date.now = () => BASE_TS;
  try {
    const award = await invoke(handler, { ...base, delta: 90 });
    assert.equal(award.statusCode, 200);
    assert.equal(award.payload.totalToday, 90);
    expectCookieTotal(award.cookie, 90);

    const statusFresh = await invoke(handler, { userId: base.userId, sessionId: base.sessionId, statusOnly: true }, { jar: 'device-b' });
    assert.equal(statusFresh.statusCode, 200);
    assert.equal(statusFresh.payload.totalToday, 90);
    assert.equal(statusFresh.payload.remaining, 310);
    expectCookieTotal(statusFresh.cookie, 90);

    storeCookie(handler, 'xp_day=bogus.invalid', 'device-b');
    const statusTampered = await invoke(handler, { userId: base.userId, sessionId: base.sessionId, statusOnly: true }, { jar: 'device-b' });
    assert.equal(statusTampered.statusCode, 200);
    assert.equal(statusTampered.payload.totalToday, 90);
    assert.equal(statusTampered.payload.remaining, 310);
    expectCookieTotal(statusTampered.cookie, 90);
  } finally {
    Date.now = originalNow;
  }
}

async function testNoUnderGrantWithStaleCookie() {
  const handler = await createHandler('under-grant');
  const base = { userId: 'under-user', ts: BASE_TS };

  const originalNow = Date.now;
  Date.now = () => BASE_TS;
  try {
    const first = await invoke(handler, { ...base, sessionId: 'session-a', delta: 200 });
    assert.equal(first.statusCode, 200);
    expectCookieTotal(first.cookie, 200);
    const decoded = decodeCookie(first.cookie);
    assert.ok(decoded?.k, 'day key available');

    const stalePair = buildSignedCookie({ key: decoded.k, total: 0 });
    storeCookie(handler, stalePair, 'device-b');

    const second = await invoke(
      handler,
      { ...base, sessionId: 'session-b', ts: BASE_TS + 1, delta: 100 },
      { jar: 'device-b' }
    );
    assert.equal(second.statusCode, 200);
    assert.equal(second.payload.awarded, 100);
    assert.equal(second.payload.remaining, 100);
    assert.equal(second.payload.totalToday, 300);
    expectCookieTotal(second.cookie, 300);
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
  assert.equal(payload.totalToday, 0);
  assert.equal(payload.remaining, 400);
  const setCookie = rejected.headers?.['Set-Cookie'] ?? rejected.headers?.['set-cookie'];
  if (setCookie) {
    const pair = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
    expectCookieTotal(pair, 0);
  }
}

async function testMetadataLimits() {
  const handler = await createHandler('metadata', { metadataLimit: 64 });
  const base = { userId: 'meta-user', sessionId: 'meta-session', ts: BASE_TS };

  const accepted = await invoke(handler, { ...base, delta: 10, metadata: { note: 'ok' } });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.payload.totalToday, 10);
  assert.equal(accepted.payload.remaining, 390);
  expectCookieTotal(accepted.cookie, 10);

  const hugeMeta = { ...base, delta: 10, metadata: { blob: 'x'.repeat(200) } };
  const rejected = await invoke(handler, hugeMeta);
  assert.equal(rejected.statusCode, 413);
  assert.equal(rejected.payload.error, 'metadata_too_large');
  assert.equal(rejected.payload.totalToday, 10);
  assert.equal(rejected.payload.remaining, 390);
  expectCookieTotal(rejected.cookie, 10);

  const depthMeta = { ...base, delta: 5, metadata: { a: { b: { c: { d: 1 } } } } };
  const deep = await invoke(handler, depthMeta);
  assert.equal(deep.statusCode, 413);
  assert.equal(deep.payload.error, 'metadata_too_large');
  assert.equal(deep.payload.totalToday, 10);
  assert.equal(deep.payload.remaining, 390);
  expectCookieTotal(deep.cookie, 10);

  const invalid = await invoke(handler, { ...base, delta: 5, metadata: 'nope' });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.payload.error, 'invalid_metadata');
  assert.equal(invalid.payload.totalToday, 10);
  assert.equal(invalid.payload.remaining, 390);
  expectCookieTotal(invalid.cookie, 10);
}

async function testActivityGuard() {
  const handler = await createHandler('activity', { requireActivity: true, minEvents: 3, minVisibility: 5 });
  const base = { userId: 'active-user', sessionId: 'active-session', ts: BASE_TS };

  const inactive = await invoke(handler, { ...base, delta: 20, metadata: { inputEvents: 1, visibilitySeconds: 2 } });
  assert.equal(inactive.statusCode, 200);
  assert.equal(inactive.payload.reason, 'inactive');
  assert.equal(inactive.payload.status, 'inactive');
  assert.equal(inactive.payload.awarded, 0);
  assert.equal(inactive.payload.totalToday, 0);
  assert.equal(inactive.payload.remaining, 400);
  expectCookieTotal(inactive.cookie, 0);

  const active = await invoke(handler, { ...base, ts: BASE_TS + 10, delta: 20, metadata: { inputEvents: 4, visibilitySeconds: 6 } });
  assert.equal(active.statusCode, 200);
  assert.equal(active.payload.awarded, 20);
  assert.equal(active.payload.totalToday, 20);
  assert.equal(active.payload.remaining, 380);
  expectCookieTotal(active.cookie, 20);
}

async function testInactiveConsistency() {
  const handler = await createHandler('inactive-consistency', { requireActivity: true, minEvents: 3, minVisibility: 5 });
  const base = { userId: 'inactive-user', sessionId: 'inactive-session', ts: BASE_TS };

  const originalNow = Date.now;
  Date.now = () => BASE_TS;
  try {
    const initial = await invoke(handler, { ...base, delta: 40, metadata: { inputEvents: 5, visibilitySeconds: 12 } });
    assert.equal(initial.statusCode, 200);
    assert.equal(initial.payload.totalToday, 40);
    expectCookieTotal(initial.cookie, 40);

    const inactive = await invoke(handler, { ...base, ts: BASE_TS + 1000, delta: 50, metadata: { inputEvents: 1, visibilitySeconds: 1 } });
    assert.equal(inactive.statusCode, 200);
    assert.equal(inactive.payload.status, 'inactive');
    assert.equal(inactive.payload.totalToday, 40);
    assert.equal(inactive.payload.remaining, 360);
    expectCookieTotal(inactive.cookie, 40);

    const status = await invoke(handler, { userId: base.userId, sessionId: base.sessionId, statusOnly: true });
    assert.equal(status.statusCode, 200);
    assert.equal(status.payload.totalToday, 40);
    assert.equal(status.payload.remaining, 360);
    expectCookieTotal(status.cookie, 40);
  } finally {
    Date.now = originalNow;
  }
}

async function testNoIdentitySkipsCookie() {
  const handler = await createHandler('no-identity');
  const base = { userId: 'no-identity-user', sessionId: 'no-identity-session', ts: BASE_TS };

  const originalNow = Date.now;
  Date.now = () => BASE_TS;
  try {
    const award = await invoke(handler, { ...base, delta: 50 });
    assert.equal(award.statusCode, 200);
    expectCookieTotal(award.cookie, 50);

    const noIdentityGet = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: {} });
    assert.equal(noIdentityGet.statusCode, 405);
    assert.equal(noIdentityGet.headers?.['Set-Cookie'] ?? noIdentityGet.headers?.['set-cookie'], undefined);

    const identifiedGet = await handler({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: { userId: base.userId, sessionId: base.sessionId },
    });
    const getCookie = identifiedGet.headers?.['Set-Cookie'] ?? identifiedGet.headers?.['set-cookie'];
    assert.ok(getCookie, 'cookie present for identified GET');
    const getPair = (Array.isArray(getCookie) ? getCookie[0] : getCookie).split(';')[0];
    expectCookieTotal(getPair, 50);

    const badJson = await handler({
      httpMethod: 'POST',
      headers: {},
      body: '{',
      queryStringParameters: {},
    });
    assert.equal(badJson.statusCode, 400);
    assert.equal(badJson.headers?.['Set-Cookie'] ?? badJson.headers?.['set-cookie'], undefined);

    const badJsonIdentified = await handler({
      httpMethod: 'POST',
      headers: {},
      body: '{',
      queryStringParameters: { userId: base.userId, sessionId: base.sessionId },
    });
    const badCookie = badJsonIdentified.headers?.['Set-Cookie'] ?? badJsonIdentified.headers?.['set-cookie'];
    assert.ok(badCookie, 'cookie present for identified bad JSON');
    const badPair = (Array.isArray(badCookie) ? badCookie[0] : badCookie).split(';')[0];
    expectCookieTotal(badPair, 50);
  } finally {
    Date.now = originalNow;
  }
}

await testBasicAwarding();
await testDailyCapPartial();
await testStaleAndStatus();
await testStatusOnlyHealsCookie();
await testNoUnderGrantWithStaleCookie();
await testDeltaValidation();
await testMetadataLimits();
await testActivityGuard();
await testInactiveConsistency();
await testNoIdentitySkipsCookie();

console.log('xp-award-delta tests passed');
