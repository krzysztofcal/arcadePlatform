import assert from 'node:assert/strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_TS = Date.UTC(2024, 0, 2, 3, 4, 5);

const cookieJar = new WeakMap();

function getJar(handler) {
  let jar = cookieJar.get(handler);
  if (!jar) {
    jar = new Map();
    cookieJar.set(handler, jar);
  }
  return jar;
}

function readCookie(handler, name = 'default') {
  return getJar(handler).get(name) ?? '';
}

function storeCookie(handler, value, name = 'default') {
  getJar(handler).set(name, value);
}

function decodeCookie(pair) {
  if (!pair) return null;
  const [, value] = pair.split('=');
  if (!value) return null;
  const [payload] = value.split('.');
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function expectCookieTotal(pair, expected) {
  const parsed = decodeCookie(pair);
  assert.ok(parsed, 'cookie parsed');
  assert.equal(parsed.t, expected);
}

async function createHandler(label, overrides = {}) {
  process.env.XP_DEBUG = '1';
  process.env.XP_KEY_NS = `test:delta:${label}`;
  process.env.XP_DAILY_CAP = String(overrides.dailyCap ?? 300);
  process.env.XP_SESSION_CAP = String(overrides.sessionCap ?? 200);
  process.env.XP_DELTA_CAP = String(overrides.deltaCap ?? 300);
  process.env.XP_SESSION_TTL_SEC = String(overrides.sessionTtl ?? 604800);
  process.env.XP_DAILY_SECRET = overrides.secret ?? 'test-secret-for-sessions-32chars!';
  const { handler } = await import(`../netlify/functions/award-xp.mjs?mix=${label}`);
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
  return { statusCode: res.statusCode, payload: JSON.parse(res.body), cookie: pair };
}

async function testDailyAcrossSessions() {
  const handler = await createHandler('multi', { dailyCap: 260, sessionCap: 200 });
  const userId = 'multi-user';

  const firstSession = { userId, sessionId: 'sess-a', ts: BASE_TS };
  const secondSession = { userId, sessionId: 'sess-b', ts: BASE_TS + 50 }; // slight offset

  const originalNow = Date.now;
  Date.now = () => BASE_TS;
  try {
    const first = await invoke(handler, { ...firstSession, delta: 150 });
    assert.equal(first.payload.awarded, 150);
    assert.equal(first.payload.totalToday, 150);
    assert.equal(first.payload.sessionTotal, 150);
    assert.equal(first.payload.remaining, 110);
    expectCookieTotal(first.cookie, 150);

    const second = await invoke(handler, { ...secondSession, delta: 150 });
    assert.equal(second.payload.awarded, 110);
    assert.equal(second.payload.capped, true);
    assert.equal(second.payload.reason, 'daily_cap_partial');
    assert.equal(second.payload.totalToday, 260);
    assert.equal(second.payload.sessionTotal, 110);
    assert.equal(second.payload.remaining, 0);
    expectCookieTotal(second.cookie, 260);

    const third = await invoke(handler, { ...firstSession, ts: BASE_TS + 120, delta: 20 });
    assert.equal(third.payload.awarded, 0);
    assert.equal(third.payload.capped, true);
    assert.equal(third.payload.reason, 'daily_cap');
    assert.equal(third.payload.totalToday, 260);
    assert.equal(third.payload.remaining, 0);
    expectCookieTotal(third.cookie, 260);
  } finally {
    Date.now = originalNow;
  }
}

async function testSessionCapAcrossDays() {
  const handler = await createHandler('carry', { dailyCap: 400, sessionCap: 180 });
  const base = { userId: 'carry-user', sessionId: 'carry-session', ts: BASE_TS };

  const originalNow = Date.now;
  try {
    Date.now = () => BASE_TS;
    const dayOne = await invoke(handler, { ...base, delta: 140 });
    assert.equal(dayOne.payload.awarded, 140);
    assert.equal(dayOne.payload.sessionTotal, 140);
    assert.equal(dayOne.payload.totalToday, 140);
    assert.equal(dayOne.payload.remaining, 260);
    expectCookieTotal(dayOne.cookie, 140);

    Date.now = () => BASE_TS + DAY_MS + 1_000;
    const dayTwo = await invoke(handler, { ...base, ts: BASE_TS + DAY_MS + 1000, delta: 100 });
    assert.equal(dayTwo.payload.awarded, 40);
    assert.equal(dayTwo.payload.sessionCapped, true);
    assert.equal(dayTwo.payload.reason, 'session_cap_partial');
    assert.equal(dayTwo.payload.sessionTotal, 180);
    assert.equal(dayTwo.payload.totalToday, 40);
    assert.equal(dayTwo.payload.remaining, 360);
    expectCookieTotal(dayTwo.cookie, 40);

    Date.now = () => BASE_TS + DAY_MS + 2_000;
    const dayTwoFollowUp = await invoke(handler, { ...base, ts: BASE_TS + DAY_MS + 2000, delta: 50 });
    assert.equal(dayTwoFollowUp.payload.awarded, 0);
    assert.equal(dayTwoFollowUp.payload.sessionCapped, true);
    assert.equal(dayTwoFollowUp.payload.reason, 'session_cap');
    assert.equal(dayTwoFollowUp.payload.totalToday, 40);
    assert.equal(dayTwoFollowUp.payload.remaining, 360);
    expectCookieTotal(dayTwoFollowUp.cookie, 40);
  } finally {
    Date.now = originalNow;
  }
}

async function testZeroDeltaAdvancesLastSync() {
  const handler = await createHandler('zero', { dailyCap: 500, sessionCap: 300 });
  const base = { userId: 'zero-user', sessionId: 'zero-session', ts: BASE_TS };

  const originalNow = Date.now;
  Date.now = () => BASE_TS;
  try {
    const first = await invoke(handler, { ...base, delta: 90 });
    assert.equal(first.payload.lastSync, BASE_TS);
    expectCookieTotal(first.cookie, 90);

    Date.now = () => BASE_TS + 1_234;
    const zeroAward = await invoke(handler, { ...base, ts: BASE_TS + 1234, delta: 0 });
    assert.equal(zeroAward.payload.awarded, 0);
    assert.equal(zeroAward.payload.lastSync, BASE_TS + 1234);
    assert.equal(zeroAward.payload.reason ?? null, null);
    assert.equal(zeroAward.payload.totalToday, 90);
    assert.equal(zeroAward.payload.remaining, 410);
    expectCookieTotal(zeroAward.cookie, 90);
  } finally {
    Date.now = originalNow;
  }
}

async function testMidnightRollover() {
  const beforeReset = Date.UTC(2024, 0, 2, 23, 50, 0); // 10 min before UTC midnight
  const handler = await createHandler('midnight', { dailyCap: 400, sessionCap: 250 });
  const base = { userId: 'midnight-user', sessionId: 'midnight-session', ts: beforeReset };

  const originalNow = Date.now;
  try {
    Date.now = () => beforeReset;
    const dayOne = await invoke(handler, { ...base, delta: 150 });
    assert.equal(dayOne.payload.totalToday, 150);
    assert.equal(dayOne.payload.sessionTotal, 150);
    assert.equal(dayOne.payload.remaining, 250);
    expectCookieTotal(dayOne.cookie, 150);

    const afterReset = Date.UTC(2024, 0, 3, 0, 10, 0); // 10 min after UTC midnight
    Date.now = () => afterReset;
    const dayTwo = await invoke(handler, { ...base, ts: afterReset, delta: 200 });
    assert.equal(dayTwo.payload.totalToday, 100);
    assert.equal(dayTwo.payload.awarded, 100);
    assert.equal(dayTwo.payload.sessionTotal, 250);
    assert.equal(dayTwo.payload.sessionCapped, true);
    assert.notEqual(dayTwo.payload.dayKey, dayOne.payload.dayKey);
    assert.equal(dayTwo.payload.remaining, 300);
    expectCookieTotal(dayTwo.cookie, 100);
  } finally {
    Date.now = originalNow;
  }
}

async function testCrossDeviceNearCap() {
  const handler = await createHandler('cross-device', { dailyCap: 200, sessionCap: 400 });
  const base = { userId: 'cross-user', sessionId: 'cross-session', ts: BASE_TS };

  const originalNow = Date.now;
  Date.now = () => BASE_TS;
  try {
    const deviceA = await invoke(handler, { ...base, delta: 190 }, { jar: 'device-a' });
    assert.equal(deviceA.payload.totalToday, 190);
    assert.equal(deviceA.payload.remaining, 10);
    expectCookieTotal(deviceA.cookie, 190);

    const statusB = await invoke(handler, { userId: base.userId, sessionId: base.sessionId, statusOnly: true }, { jar: 'device-b' });
    assert.equal(statusB.payload.totalToday, 190);
    assert.equal(statusB.payload.remaining, 10);
    expectCookieTotal(statusB.cookie, 190);

    const awardB = await invoke(handler, { ...base, ts: BASE_TS + 5, delta: 50 }, { jar: 'device-b' });
    assert.equal(awardB.payload.awarded, 10);
    assert.equal(awardB.payload.capped, true);
    assert.equal(awardB.payload.reason, 'daily_cap_partial');
    assert.equal(awardB.payload.totalToday, 200);
    assert.equal(awardB.payload.remaining, 0);
    expectCookieTotal(awardB.cookie, 200);

    const statusA = await invoke(handler, { userId: base.userId, sessionId: base.sessionId, statusOnly: true }, { jar: 'device-a' });
    assert.equal(statusA.payload.totalToday, 200);
    assert.equal(statusA.payload.remaining, 0);
    expectCookieTotal(statusA.cookie, 200);
  } finally {
    Date.now = originalNow;
  }
}

async function testSessionTtlRefresh() {
  const userId = 'ttl-user';
  const sessionId = 'ttl-session';
  process.env.XP_SESSION_TTL_SEC = '3';
  const handler = await createHandler('ttl', { dailyCap: 500, sessionCap: 400, sessionTtl: 3 });
  const base = { userId, sessionId, ts: BASE_TS };

  const first = await invoke(handler, { ...base, delta: 50 });
  assert.equal(first.payload.awarded, 50);
  expectCookieTotal(first.cookie, 50);

  const { createHash } = await import('node:crypto');
  const { store } = await import('../netlify/functions/_shared/store-upstash.mjs');
  const hash = createHash('sha256').update(`${userId}|${sessionId}`).digest('hex');
  const sessionKey = `${process.env.XP_KEY_NS}:session:${hash}`;

  let ttlInitial = await store.ttl(sessionKey);
  assert(ttlInitial > 0 && ttlInitial <= 3);

  await new Promise(resolve => setTimeout(resolve, 1_200));
  const ttlAfterWait = await store.ttl(sessionKey);
  assert(ttlAfterWait > -2);

  await invoke(handler, { ...base, ts: BASE_TS + 2_000, delta: 0 });
  const ttlAfterHeartbeat = await store.ttl(sessionKey);
  assert(ttlAfterHeartbeat > ttlAfterWait);
}

await testDailyAcrossSessions();
await testSessionCapAcrossDays();
await testZeroDeltaAdvancesLastSync();
await testMidnightRollover();
await testSessionTtlRefresh();
await testCrossDeviceNearCap();

console.log('xp-award session/daily tests passed');
