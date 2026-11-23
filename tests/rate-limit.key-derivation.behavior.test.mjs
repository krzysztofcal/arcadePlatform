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

// 3. sum of phases plus otherMs equals totalMs; otherMs >= 0 when phases overlap or exceed
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

  // Exceed/overlap case: measured phases exceed totalMs
  let clockTimeOverlap = 1000;
  const tOverlap = createXpTiming(() => clockTimeOverlap);
  tOverlap.set({ op: "award", signedIn: false });
  await tOverlap.measure("jwt", async () => { clockTimeOverlap += 600; });
  await tOverlap.measure("award", async () => { clockTimeOverlap += 600; });
  clockTimeOverlap = 1000 + 1000; // totalMs = 1000, while sum = 1200
  const fOverlap = tOverlap.fields();
  assert.equal(fOverlap.totalMs, 1000);
  assert.equal(fOverlap.jwtMs, 600);
  assert.equal(fOverlap.awardMs, 600);
  assert.ok(fOverlap.otherMs >= 0);
  assert.equal(fOverlap.otherMs, 0);
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

// 5. handler status request still returns the same status and body
{
  const statusRes = await handler({
    httpMethod: "POST",
    headers: { origin: "http://127.0.0.1:4173" },
    body: JSON.stringify({ anonId: "rate-key-status-user", operation: "status" }),
  });
  assert.equal(statusRes.statusCode, 200);
  const statusBody = JSON.parse(statusRes.body);
  assert.equal(statusBody.ok, true);
  assert.equal(typeof statusBody.totalLifetime, "number");
  assert.equal(typeof statusBody.totalToday, "number");
}

console.log('calc_xp_timing diagnostic tests passed');
