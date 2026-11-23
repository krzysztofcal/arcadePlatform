import assert from 'node:assert/strict';

process.env.XP_DAILY_SECRET = 'test-secret-for-sessions-32chars!';
process.env.XP_TEST_MODE = '1';
process.env.XP_RATE_LIMIT_ENABLED = '1';
process.env.XP_RATE_LIMIT_USER_PER_MIN = '100';
process.env.XP_RATE_LIMIT_IP_PER_MIN = '2';
process.env.XP_RATE_LIMIT_WINDOW_SEC = '2';
process.env.XP_KEY_NS = `test:rate-key:${Date.now()}`;
process.env.XP_CORS_ALLOW = 'http://127.0.0.1:4173';

const { handler, createXpTiming } = await import('../netlify/functions/calculate-xp.mjs');

let windowOffset = 0;
const post = (ip, userId = `user-${Date.now()}`) => {
  const now = Date.now() + windowOffset++;
  return handler({
    httpMethod: 'POST',
    headers: {
      origin: 'http://127.0.0.1:4173',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify({
      anonId: userId,
      operation: 'award',
      sessionId: `sess-${now}`,
      gameId: '2048',
      windowStart: now - 1_000,
      windowEnd: now,
      inputEvents: 2,
      visibilitySeconds: 1,
      gameplayActions: 1,
      scoreDelta: 2,
    }),
  });
};

const ipA = '203.0.113.50';
const ipB = '203.0.113.51';

const a1 = await post(ipA, 'rate-key-user-a');
const a2 = await post(ipA, 'rate-key-user-b');
const a3 = await post(ipA, 'rate-key-user-c');
assert.equal(a1.statusCode, 200);
assert.equal(a2.statusCode, 200);
assert.equal(a3.statusCode, 429);

const b1 = await post(ipB, 'rate-key-user-d');
assert.equal(b1.statusCode, 200);

const a4 = await post(ipA, 'rate-key-user-e');
assert.equal(a4.statusCode, 429);

console.log('rate-limit key derivation behavior test passed');

// --- createXpTiming fundamental tests (#1313) ---

// 1. below 1000 ms -> shouldLog() false; at exactly 1000 -> true; unknown op -> false
{
  let now = 10_000;
  const timing = createXpTiming(() => now);
  timing.set({ op: "status", signedIn: false });
  assert.equal(timing.shouldLog(), false);

  now = 10_999;
  assert.equal(timing.shouldLog(), false);

  now = 11_000;
  assert.equal(timing.shouldLog(), true);

  now = 11_500;
  assert.equal(timing.shouldLog(), true);

  // award op logs at >= 1000ms
  timing.set({ op: "award" });
  assert.equal(timing.shouldLog(), true);

  // unknown op -> false
  timing.set({ op: "unknown" });
  assert.equal(timing.shouldLog(), false);
  timing.set({ op: "custom" });
  assert.equal(timing.shouldLog(), false);
  timing.set({ op: null });
  assert.equal(timing.shouldLog(), false);
  timing.set({ op: undefined });
  assert.equal(timing.shouldLog(), false);
}

// 2. Object.keys(fields()) is exactly the allowed list
{
  const allowedKeys = [
    "op",
    "signedIn",
    "status",
    "jwtMs",
    "conversionMs",
    "totalsMs",
    "persistMs",
    "awardMs",
    "otherMs",
    "totalMs",
  ];
  const timing = createXpTiming();
  assert.deepEqual(Object.keys(timing.fields()), allowedKeys);
  timing.set({ op: "status", signedIn: true, status: 200 });
  assert.deepEqual(Object.keys(timing.fields()), allowedKeys);
}

// 3. sum of phases plus otherMs equals totalMs; otherMs >= 0; clamping when sum exceeds totalMs
{
  // Normal case: sum of phases < totalMs
  let clockTime = 1000;
  const tNormal = createXpTiming(() => clockTime);
  tNormal.set({ op: "status", signedIn: true, status: 200 });
  await tNormal.measure("jwt", async () => { clockTime += 120; });
  await tNormal.measure("totals", async () => { clockTime += 230; });
  await tNormal.measure("persist", async () => { clockTime += 50; });
  clockTime = 1000 + 1200; // total elapsed = 1200 ms
  const fNormal = tNormal.fields();
  assert.equal(fNormal.totalMs, 1200);
  assert.equal(fNormal.jwtMs, 120);
  assert.equal(fNormal.conversionMs, 0);
  assert.equal(fNormal.totalsMs, 230);
  assert.equal(fNormal.persistMs, 50);
  assert.equal(fNormal.awardMs, 0);
  assert.equal(fNormal.otherMs, 1200 - (120 + 230 + 50)); // 800
  const phaseSum = fNormal.jwtMs + fNormal.conversionMs + fNormal.totalsMs + fNormal.persistMs + fNormal.awardMs;
  assert.equal(phaseSum + fNormal.otherMs, fNormal.totalMs);
  assert.ok(fNormal.otherMs >= 0);

  // Clamping case: when sum of rounded phases exceeds elapsed time, totalMs is raised to sum so phases + otherMs === totalMs
  let clockTimeExceed = 1000;
  const tExceed = createXpTiming(() => clockTimeExceed);
  tExceed.set({ op: "award", signedIn: false });
  await tExceed.measure("jwt", async () => { clockTimeExceed += 600; });
  await tExceed.measure("award", async () => { clockTimeExceed += 600; });
  clockTimeExceed = 1000 + 1000; // sum of measured phases = 1200
  const fExceed = tExceed.fields();
  assert.equal(fExceed.jwtMs, 600);
  assert.equal(fExceed.awardMs, 600);
  assert.equal(fExceed.otherMs, 0);
  assert.equal(fExceed.totalMs, 1200);
  assert.equal(fExceed.jwtMs + fExceed.conversionMs + fExceed.totalsMs + fExceed.persistMs + fExceed.awardMs + fExceed.otherMs, fExceed.totalMs);
}

// 4. measure adds time on success and on throw, and rethrows the same error
{
  let clockTime = 5000;
  const tMeasure = createXpTiming(() => clockTime);

  // Success
  const result = await tMeasure.measure("persist", async () => {
    clockTime += 75;
    return "persisted";
  });
  assert.equal(result, "persisted");
  assert.equal(tMeasure.fields().persistMs, 75);

  // Throw
  const testError = new Error("persist_failure");
  let thrown = null;
  try {
    await tMeasure.measure("persist", async () => {
      clockTime += 45;
      throw testError;
    });
  } catch (err) {
    thrown = err;
  }
  assert.equal(thrown, testError);
  // Accumulated 75 + 45 = 120
  assert.equal(tMeasure.fields().persistMs, 120);
}

// --- F1 clock guard tests ---
{
  // Clock throws at creation
  const tCreationThrow = createXpTiming(() => { throw new Error("clock_at_creation"); });
  assert.equal(tCreationThrow.shouldLog(), false);
  assert.equal(tCreationThrow.fields(), null);
  let ranCreation = false;
  const resCreation = await tCreationThrow.measure("jwt", async () => { ranCreation = true; return 42; });
  assert.equal(ranCreation, true);
  assert.equal(resCreation, 42);
  const errCreation = new Error("fn_err");
  await assert.rejects(async () => tCreationThrow.measure("jwt", async () => { throw errCreation; }), (err) => err === errCreation);

  // Clock throws at start of measure
  let startCalls = 0;
  const tStartThrow = createXpTiming(() => { if (++startCalls === 2) throw new Error("clock_start"); return 1000; });
  let ranStart = false;
  const resStart = await tStartThrow.measure("jwt", async () => { ranStart = true; return 99; });
  assert.equal(ranStart, true);
  assert.equal(resStart, 99);
  assert.equal(tStartThrow.shouldLog(), false);

  // Clock throws at end of measure (finally)
  let endCalls = 0;
  const tEndThrow = createXpTiming(() => { if (++endCalls === 3) throw new Error("clock_end"); return 2000; });
  let ranEnd = false;
  const resEnd = await tEndThrow.measure("jwt", async () => { ranEnd = true; return 101; });
  assert.equal(ranEnd, true);
  assert.equal(resEnd, 101);
  assert.equal(tEndThrow.shouldLog(), false);
  // and rethrows original error if fn throws
  endCalls = 0;
  const tEndThrowErr = createXpTiming(() => { if (++endCalls === 3) throw new Error("clock_end"); return 2000; });
  const fnExplosion = new Error("fn_explosion");
  await assert.rejects(async () => tEndThrowErr.measure("jwt", async () => { throw fnExplosion; }), (err) => err === fnExplosion);

  // Clock throws in fields()
  let fieldsCalls = 0;
  const tFieldsThrow = createXpTiming(() => { if (++fieldsCalls === 2) throw new Error("clock_fields"); return 3000; });
  assert.equal(tFieldsThrow.fields(), null);
  assert.equal(tFieldsThrow.shouldLog(), false);
}

// --- F4 handler-level tests ---
{
  const allowedKeys = [
    "op",
    "signedIn",
    "status",
    "jwtMs",
    "conversionMs",
    "totalsMs",
    "persistMs",
    "awardMs",
    "otherMs",
    "totalMs",
  ];

  const captureKlog = async (fn) => {
    const originalConsoleLog = console.log;
    const entries = [];
    console.log = (...args) => {
      if (args[0] === '[klog] calc_xp_timing') {
        entries.push(typeof args[1] === 'string' ? JSON.parse(args[1]) : args[1]);
      }
      originalConsoleLog(...args);
    };
    try {
      return { result: await fn(), entries };
    } finally {
      console.log = originalConsoleLog;
    }
  };

  // (a) a fast status request emits no calc_xp_timing
  {
    const { result, entries } = await captureKlog(() => handler({
      httpMethod: "POST",
      headers: { origin: "http://127.0.0.1:4173" },
      body: JSON.stringify({ anonId: "fast-status-user", operation: "status" }),
    }));
    assert.equal(result.statusCode, 200);
    assert.equal(entries.length, 0);
  }

  // (b) a slow path (>= 1000 ms via stubbed performance.now) emits exactly one entry with allowed fields
  {
    const origPerfNow = performance.now;
    let t = 10_000;
    performance.now = () => (t += 300);
    try {
      const { result, entries } = await captureKlog(() => handler({
        httpMethod: "POST",
        headers: { origin: "http://127.0.0.1:4173" },
        body: JSON.stringify({ anonId: "slow-status-user", operation: "status" }),
      }));
      assert.equal(result.statusCode, 200);
      assert.equal(entries.length, 1);
      const entry = entries[0];
      assert.deepEqual(Object.keys(entry), allowedKeys);
      assert.equal(entry.op, "status");
      assert.equal(entry.status, 200);
      assert.equal(entry.signedIn, false);
      assert.ok(entry.totalMs >= 1000);
      const phaseSum = entry.jwtMs + entry.conversionMs + entry.totalsMs + entry.persistMs + entry.awardMs;
      assert.equal(phaseSum + entry.otherMs, entry.totalMs);
    } finally {
      performance.now = origPerfNow;
    }
  }

  // (c) a handler that throws still emits at most one entry and rethrows the same error object
  {
    const origPerfNow = performance.now;
    let t = 20_000;
    performance.now = () => (t += 1500);
    const testThrowError = new Error("handler_forced_throw");
    const throwingEvent = {
      httpMethod: "POST",
      headers: {
        origin: "http://127.0.0.1:4173",
        get authorization() {
          throw testThrowError;
        },
      },
      body: JSON.stringify({ anonId: "throw-user", operation: "status" }),
    };

    try {
      let caught = null;
      const { entries } = await captureKlog(async () => {
        try {
          await handler(throwingEvent);
        } catch (err) {
          caught = err;
        }
      });
      assert.equal(caught, testThrowError);
      assert.equal(entries.length, 1);
      const entry = entries[0];
      assert.deepEqual(Object.keys(entry), allowedKeys);
      assert.equal(entry.op, "status");
      assert.equal(entry.status, null);
      assert.ok(entry.totalMs >= 1000);
    } finally {
      performance.now = origPerfNow;
    }
  }

  // (d) full status response, including statusCode, body and headers, is unchanged
  {
    const res = await handler({
      httpMethod: "POST",
      headers: { origin: "http://127.0.0.1:4173" },
      body: JSON.stringify({ anonId: "rate-key-status-user", operation: "status" }),
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.headers, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "http://127.0.0.1:4173",
      "access-control-allow-headers": "content-type,authorization,x-api-key",
      "access-control-allow-methods": "POST,OPTIONS",
      Vary: "Origin",
    });
    const statusBody = JSON.parse(res.body);
    assert.equal(statusBody.ok, true);
    assert.equal(typeof statusBody.totalLifetime, "number");
    assert.equal(typeof statusBody.totalToday, "number");
    assert.equal(statusBody.awarded, 0);
    assert.equal(statusBody.granted, 0);
    assert.equal(statusBody.cap, 3000);
    assert.equal(statusBody.capDelta, 300);
    assert.equal(statusBody.status, "statusOnly");
    assert.equal(typeof statusBody.remaining, "number");
    assert.equal(typeof statusBody.dayKey, "string");
    assert.equal(typeof statusBody.nextReset, "number");
  }
}

console.log('calc_xp_timing diagnostic tests passed');
