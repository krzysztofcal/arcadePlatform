import assert from "node:assert/strict";

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

async function createHandler(ns = "test:drift", overrides = {}) {
  process.env.XP_DEBUG = "1";
  process.env.XP_KEY_NS = ns;
  process.env.XP_DAILY_CAP = String(overrides.dailyCap ?? 400);
  process.env.XP_SESSION_CAP = String(overrides.sessionCap ?? 300);
  process.env.XP_DELTA_CAP = String(overrides.deltaCap ?? 300);
  process.env.XP_DRIFT_MS = String(overrides.driftMs ?? 30_000);
  process.env.XP_DAILY_SECRET = overrides.secret ?? "test-secret";
  const { handler } = await import(`../netlify/functions/award-xp.mjs?drift=${ns}`);
  return handler;
}

async function invoke(handler, body, options = {}) {
  const jarName = options.jar ?? 'default';
  const existing = readCookie(handler, jarName);
  const headers = { ...(options.headers ?? {}) };
  if (existing) headers.cookie = existing;
  if (options.origin) headers.origin = options.origin;
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

(async () => {
  const handler = await createHandler("ok");

  const realNow = Date.now;
  const NOW = 1_700_000_000_000;
  Date.now = () => NOW;

  const base = { userId: "u", sessionId: "s" };

  // 1) Accept past timestamps - backfill to correct day bucket
  {
    const past = await invoke(handler, { ...base, ts: NOW - 86_400_000, delta: 5 });
    assert.equal(past.statusCode, 200);
    assert.equal(past.payload.awarded, 5, "Should award 5 XP to yesterday's bucket");
    assert.equal(past.payload.totalLifetime, 5, "Lifetime total should be 5");
    assert.equal(past.payload.totalToday, 0, "Today's bucket should still be 0 (award was to yesterday)");
    assert.equal(past.payload.remaining, 400, "Today's remaining should be full (400)");
    expectCookieTotal(past.cookie, 0); // Cookie shows TODAY's total, which is 0

    const past2 = await invoke(handler, { ...base, ts: NOW - 60_000, delta: 10 });
    assert.equal(past2.statusCode, 200);
    assert.equal(past2.payload.awarded, 10, "Should award 10 XP to today's bucket");
    assert.equal(past2.payload.totalLifetime, 15, "Lifetime total should be 15 (5 + 10)");
    assert.equal(past2.payload.totalToday, 10, "Today's bucket should be 10");
    assert.equal(past2.payload.remaining, 390, "Today's remaining should be 390");
    expectCookieTotal(past2.cookie, 10); // Cookie shows TODAY's actual total
  }

  // 2) Reject far-future timestamp
  {
    const driftMs = 30_000;
    const futureTs = NOW + driftMs + 1;
    const future = await invoke(handler, { ...base, ts: futureTs, delta: 20 });
    assert.equal(future.statusCode, 422);
    assert.equal(future.payload.error, "timestamp_in_future");
    assert.equal(future.payload.driftMs, driftMs);
    assert.equal(future.payload.totalToday, 10, "Error response should still show current totals");
    assert.equal(future.payload.totalLifetime, 15);
    expectCookieTotal(future.cookie, 10);
  }

  // 3) Future but within tolerance passes
  {
    const within = await invoke(handler, { ...base, ts: NOW + 29_000, delta: 7 });
    assert.equal(within.statusCode, 200);
    assert.equal(within.payload.awarded, 7);
    assert.equal(within.payload.totalToday, 17, "Today's total is now 17 (10 + 7)");
    assert.equal(within.payload.totalLifetime, 22, "Lifetime is 22 (5 + 10 + 7)");
    assert.equal(within.payload.remaining, 383);
    expectCookieTotal(within.cookie, 17);
  }

  // 4) Daily cap enforcement across buckets
  {
    const handler2 = await createHandler("capTest", { dailyCap: 20, driftMs: 200_000_000 });
    const base2 = { userId: "cap-user", sessionId: "cap-session" };
    Date.now = () => NOW;
    
    const first = await invoke(handler2, { ...base2, ts: NOW, delta: 15 });
    assert.equal(first.statusCode, 200);
    assert.equal(first.payload.awarded, 15);
    assert.equal(first.payload.totalToday, 15);
    assert.equal(first.payload.remaining, 5);
    
    const second = await invoke(handler2, { ...base2, ts: NOW + 1000, delta: 10 });
    assert.equal(second.statusCode, 200);
    assert.equal(second.payload.awarded, 5, "Should cap at daily limit");
    assert.equal(second.payload.capped, true);
    assert.equal(second.payload.totalToday, 20);
    assert.equal(second.payload.remaining, 0);
  }

  // 5) Non-POST surfaces current totals
  {
    const headers = {};
    const existing = readCookie(handler);
    if (existing) headers.cookie = existing;
    const res = await handler({
      httpMethod: "GET",
      headers,
      queryStringParameters: { userId: base.userId, sessionId: base.sessionId },
    });
    assert.equal(res.statusCode, 405);
    const payload = JSON.parse(res.body);
    assert.equal(payload.error, "method_not_allowed");
    assert.equal(payload.totalToday, 17, "Should reflect current today's total");
    assert.equal(payload.totalLifetime, 22, "Should reflect lifetime total");
  }

  Date.now = realNow;
  console.log("xp-award-drift tests passed");
})();
