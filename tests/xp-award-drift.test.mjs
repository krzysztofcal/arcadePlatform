import assert from "node:assert/strict";

const cookieJar = new WeakMap();

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

async function invoke(handler, body, origin) {
  const existing = cookieJar.get(handler) ?? "";
  const headers = {};
  if (origin) headers.origin = origin;
  if (existing) headers.cookie = existing;
  const res = await handler({ httpMethod: "POST", headers, body: JSON.stringify(body) });
  const setCookie = res.headers?.["set-cookie"] ?? res.headers?.["Set-Cookie"];
  if (setCookie) {
    const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const pair = value.split(";")[0];
    cookieJar.set(handler, pair);
  }
  return { status: res.statusCode, json: JSON.parse(res.body) };
}

(async () => {
  const handler = await createHandler("ok");

  const realNow = Date.now;
  const NOW = 1_700_000_000_000;
  Date.now = () => NOW;

  const base = { userId: "u", sessionId: "s" };

  // 1) Accept past timestamps (staleness handled by lastSync ordering)
  {
    const past = await invoke(handler, { ...base, ts: NOW - 86_400_000, delta: 5 });
    assert.equal(past.status, 200);
    assert.equal(past.json.awarded, 5);

    const past2 = await invoke(handler, { ...base, ts: NOW - 60_000, delta: 10 });
    assert.equal(past2.status, 200);
    assert.equal(past2.json.totalToday, 15);
  }

  // 2) Reject far-future timestamp
  {
    const driftMs = 30_000;
    const futureTs = NOW + driftMs + 1;
    const futureHeaders = {};
    const existing = cookieJar.get(handler) ?? "";
    if (existing) futureHeaders.cookie = existing;
    const fut = await handler({
      httpMethod: "POST",
      headers: futureHeaders,
      body: JSON.stringify({ ...base, ts: futureTs, delta: 20 }),
    });
    const setCookie = fut.headers?.["set-cookie"] ?? fut.headers?.["Set-Cookie"];
    if (setCookie) {
      const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      const pair = value.split(";")[0];
      cookieJar.set(handler, pair);
    }
    assert.equal(fut.statusCode, 422);
    const err = JSON.parse(fut.body);
    assert.equal(err.error, "timestamp_in_future");
    assert.equal(err.driftMs, driftMs);
  }

  // 3) Future but within tolerance passes
  {
    const within = await invoke(handler, { ...base, ts: NOW + 29_000, delta: 7 });
    assert.equal(within.status, 200);
    assert.equal(within.json.awarded, 7);
  }

  // 4) Server-day bucket wins over client ts day
  {
    const nextDayTs = NOW + 36 * 3_600 * 1_000;
    const handler2 = await createHandler("serverBucket", { driftMs: 200_000_000 });
    Date.now = () => NOW;
    const first = await invoke(handler2, { ...base, ts: NOW, delta: 9 });
    assert.equal(first.status, 200);
    assert.equal(first.json.awarded, 9);
    const second = await invoke(handler2, { ...base, ts: nextDayTs, delta: 11 });
    assert.equal(second.status, 200);
    assert.equal(second.json.totalToday, 20);
  }

  Date.now = realNow;
  console.log("xp-award-drift tests passed");
})();
