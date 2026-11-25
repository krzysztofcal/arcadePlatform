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

// --- #1313 calc_xp_timing deterministic tests ---

const { warsawDayKey, nextWarsawResetMs } = await import('../netlify/functions/_shared/time-utils.mjs');

// 1. threshold on raw time: raw 999.6 ms -> payload() null; exactly 1000 -> object; op "award" logs; op null / "other" -> null
{
  let now = 10_000;
  const timing = createXpTiming(() => now);
  timing.set({ op: "status" });

  now = 10_999.6;
  assert.equal(timing.payload(), null);

  now = 11_000;
  assert.notEqual(timing.payload(), null);
  assert.equal(timing.payload().op, "status");

  timing.set({ op: "award" });
  assert.notEqual(timing.payload(), null);
  assert.equal(timing.payload().op, "award");

  timing.set({ op: null });
  assert.equal(timing.payload(), null);

  timing.set({ op: "other" });
  assert.equal(timing.payload(), null);
}

// 2. rounding: sum of rounded phases >= 1000 but raw is 999.x -> null; rounded phase sum exceeds round(raw) -> totalMs === sum, otherMs === 0; phases + otherMs === totalMs
{
  let now = 0;
  const t1 = createXpTiming(() => now);
  t1.set({ op: "status" });
  await t1.measure("jwt", async () => { now += 499.8; });
  await t1.measure("totals", async () => { now += 499.8; });
  now = 999.8;
  assert.equal(t1.payload(), null);

  now = 0;
  const t2 = createXpTiming(() => now);
  t2.set({ op: "status" });
  await t2.measure("jwt", async () => { now += 333.6; });
  await t2.measure("totals", async () => { now += 333.6; });
  await t2.measure("persist", async () => { now += 333.6; });
  now = 1001.2;
  const p2 = t2.payload();
  const sum2 = p2.jwtMs + p2.conversionMs + p2.totalsMs + p2.persistMs + p2.awardMs;
  assert.equal(p2.totalMs, sum2);
  assert.equal(p2.otherMs, 0);
  assert.equal(sum2 + p2.otherMs, p2.totalMs);
}

// 3. measure adds elapsed time on success and on throw, rethrows the same error object, returns the value
{
  let now = 0;
  const timing = createXpTiming(() => now);

  const val = await timing.measure("jwt", async () => {
    now += 150;
    return "ok";
  });
  assert.equal(val, "ok");

  const err = new Error("boom");
  let thrown = null;
  try {
    await timing.measure("jwt", async () => {
      now += 75;
      throw err;
    });
  } catch (e) {
    thrown = e;
  }
  assert.equal(thrown, err);

  timing.set({ op: "status" });
  now = 1000;
  assert.equal(timing.payload().jwtMs, 225);
}

// Handler tests (stub global performance.now, restore in finally; capture [klog] calc_xp_timing lines)
{
  const captureTimingLogs = async (fn) => {
    const origLog = console.log;
    const lines = [];
    console.log = (...args) => {
      if (args[0] === '[klog] calc_xp_timing') {
        lines.push(typeof args[1] === 'string' ? JSON.parse(args[1]) : args[1]);
      }
      origLog(...args);
    };
    try {
      return { result: await fn(), lines };
    } finally {
      console.log = origLog;
    }
  };

  // 4. fast: performance.now = () => 5000 (constant) -> zero timing lines; stub Date.now to a fixed timestamp and assert.deepEqual the WHOLE response
  {
    const origPerf = performance.now;
    const origDate = Date.now;
    performance.now = () => 5000;
    const fixedNow = 1700000000000;
    Date.now = () => fixedNow;
    const expectedDayKey = warsawDayKey(fixedNow);
    const expectedNextReset = nextWarsawResetMs(fixedNow);

    try {
      const { result, lines } = await captureTimingLogs(() => handler({
        httpMethod: "POST",
        headers: { origin: "http://127.0.0.1:4173" },
        body: JSON.stringify({ anonId: "test-fast-status-user-r3", operation: "status" }),
      }));

      assert.equal(lines.length, 0);
      assert.deepEqual(
        {
          statusCode: result.statusCode,
          headers: result.headers,
          body: JSON.parse(result.body),
        },
        {
          statusCode: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "access-control-allow-origin": "http://127.0.0.1:4173",
            "access-control-allow-headers": "content-type,authorization,x-api-key",
            "access-control-allow-methods": "POST,OPTIONS",
            Vary: "Origin",
          },
          body: {
            ok: true,
            awarded: 0,
            granted: 0,
            cap: 3000,
            capDelta: 300,
            totalLifetime: 0,
            sessionTotal: 0,
            lastSync: 0,
            status: "statusOnly",
            totalToday: 0,
            remaining: 3000,
            dayKey: expectedDayKey,
            nextReset: expectedNextReset,
          },
        }
      );
    } finally {
      performance.now = origPerf;
      Date.now = origDate;
    }
  }

  // 5. slow: a step clock (+200 ms per read) -> exactly one line; jwt, conversion and totals each get one step (anonymous status has no persist)
  {
    const origPerf = performance.now;
    let n = 0;
    performance.now = () => (n++) * 200;

    try {
      const { lines } = await captureTimingLogs(() => handler({
        httpMethod: "POST",
        headers: { origin: "http://127.0.0.1:4173" },
        body: JSON.stringify({ anonId: "test-slow-status-user-r3", operation: "status" }),
      }));

      assert.equal(lines.length, 1);
      assert.deepEqual(lines[0], {
        op: "status",
        signedIn: false,
        status: 200,
        jwtMs: 200,
        conversionMs: 200,
        totalsMs: 200,
        persistMs: 0,
        awardMs: 0,
        otherMs: 800,
        totalMs: 1400,
      });
    } finally {
      performance.now = origPerf;
    }
  }

  // 6. throw: same clock as 5, event whose headers.authorization getter throws -> handler rethrows same error, exactly one line with status: null
  {
    const origPerf = performance.now;
    let n = 0;
    performance.now = () => (n++ === 0 ? 0 : 5000);
    const authError = new Error("auth_getter_boom");
    const throwingEvent = {
      httpMethod: "POST",
      headers: {
        origin: "http://127.0.0.1:4173",
        get authorization() { throw authError; },
      },
      body: JSON.stringify({ anonId: "test-throw-status-user-r3", operation: "status" }),
    };

    try {
      let thrown = null;
      const { lines } = await captureTimingLogs(async () => {
        try {
          await handler(throwingEvent);
        } catch (err) {
          thrown = err;
        }
      });

      assert.equal(thrown, authError);
      assert.equal(lines.length, 1);
      assert.deepEqual(lines[0], {
        op: "status",
        signedIn: false,
        status: null,
        jwtMs: 0,
        conversionMs: 0,
        totalsMs: 0,
        persistMs: 0,
        awardMs: 0,
        otherMs: 5000,
        totalMs: 5000,
      });
    } finally {
      performance.now = origPerf;
    }
  }
}

console.log('calc_xp_timing diagnostic tests passed');
