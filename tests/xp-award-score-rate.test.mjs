import assert from 'node:assert/strict';

const CHUNK_MS = 10_000;
const BASE_NOW = Date.UTC(2024, 0, 2, 3, 4, 5);

function scoreRateKey(ns, userId, t) {
  const d = new Date(t);
  const bucket = [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0'),
    String(d.getUTCHours()).padStart(2, '0'),
    String(d.getUTCMinutes()).padStart(2, '0'),
  ].join('');
  return `${ns}:scorerl:${userId}:${bucket}`;
}

function createInvoker(handler, {
  userId,
  gameId,
  sessionPrefix,
  pointsPerPeriod,
  visibilitySeconds,
  inputEvents,
}) {
  let nowCursor = BASE_NOW;
  let sessionCounter = 0;
  return async function invoke(overrides = {}) {
    const callNow = nowCursor;
    nowCursor += CHUNK_MS;
    const realNow = Date.now;
    Date.now = () => callNow;
    try {
      const body = {
        userId,
        gameId,
        sessionId: `${sessionPrefix}-${sessionCounter++}`,
        windowStart: callNow - CHUNK_MS,
        windowEnd: callNow,
        chunkMs: CHUNK_MS,
        visibilitySeconds,
        inputEvents,
        pointsPerPeriod,
        ...overrides,
      };
      const res = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) });
      return { statusCode: res.statusCode, payload: JSON.parse(res.body) };
    } finally {
      Date.now = realNow;
    }
  };
}

async function testWithinAllowance() {
  process.env.XP_DEBUG = '1';
  process.env.XP_USE_SCORE = '1';
  process.env.XP_SCORE_TO_XP = '10';
  process.env.XP_MAX_XP_PER_WINDOW = '200';
  process.env.XP_SCORE_RATE_LIMIT_PER_MIN = '24';
  process.env.XP_SCORE_BURST_MAX = '24';
  process.env.XP_SCORE_MIN_EVENTS = '4';
  process.env.XP_SCORE_MIN_VIS_S = '8';
  process.env.XP_KEY_NS = 'test:score-rate:within';

  const { handler } = await import('../netlify/functions/award-xp.mjs?mode=score&case=within');
  const { store } = await import('../netlify/functions/_shared/store-upstash.mjs');

  const userId = 'score-rate-user';
  const gameId = 'score-rate-game';
  const sessionPrefix = 'score-rate-session';

  const minuteKey = scoreRateKey(process.env.XP_KEY_NS, userId, BASE_NOW);
  await store.setex(minuteKey, 60, 6);

  const invoke = createInvoker(handler, {
    userId,
    gameId,
    sessionPrefix,
    pointsPerPeriod: 9,
    visibilitySeconds: 16,
    inputEvents: 8,
  });

  const { statusCode, payload } = await invoke({ scoreDelta: 7 });
  assert.equal(statusCode, 200);
  assert.equal(payload.awarded, 70);
  assert.equal(payload.totalToday, 70);
  assert(payload.debug, 'debug info missing');
  assert.equal(payload.debug.scoreDeltaAccepted, 7);
  assert.equal(payload.debug.scoreRateMinute, 13);
  assert.equal(payload.debug.scoreRateLimit, 24);
  assert.equal(payload.debug.scoreBurstMax, 24);
}

async function testMinuteCapReached() {
  process.env.XP_DEBUG = '1';
  process.env.XP_USE_SCORE = '1';
  process.env.XP_SCORE_TO_XP = '5';
  process.env.XP_MAX_XP_PER_WINDOW = '200';
  process.env.XP_SCORE_RATE_LIMIT_PER_MIN = '18';
  process.env.XP_SCORE_BURST_MAX = '22';
  process.env.XP_SCORE_MIN_EVENTS = '4';
  process.env.XP_SCORE_MIN_VIS_S = '8';
  process.env.XP_KEY_NS = 'test:score-rate:minute-cap';

  const { handler } = await import('../netlify/functions/award-xp.mjs?mode=score&case=minute');
  const { store } = await import('../netlify/functions/_shared/store-upstash.mjs');

  const userId = 'score-rate-minute';
  const gameId = 'score-rate-game';
  const sessionPrefix = 'score-rate-session-minute';

  const minuteKey = scoreRateKey(process.env.XP_KEY_NS, userId, BASE_NOW);
  await store.setex(minuteKey, 60, 18);

  const invoke = createInvoker(handler, {
    userId,
    gameId,
    sessionPrefix,
    pointsPerPeriod: 9,
    visibilitySeconds: 15,
    inputEvents: 7,
  });

  const { statusCode, payload } = await invoke({ scoreDelta: 4 });
  assert.equal(statusCode, 200);
  assert.equal(payload.awarded, 0);
  assert.equal(payload.reason, 'score_rate_limit');
  assert.equal(payload.debug.reason, 'score_rate_limit');
  assert.equal(payload.debug.scoreDeltaAccepted, 0);
  assert.equal(payload.debug.scoreRateMinute, 18);
  assert.equal(payload.debug.scoreRateLimit, 18);
}

async function testBurstCapTrim() {
  process.env.XP_DEBUG = '1';
  process.env.XP_USE_SCORE = '1';
  process.env.XP_SCORE_TO_XP = '10';
  process.env.XP_MAX_XP_PER_WINDOW = '200';
  process.env.XP_SCORE_RATE_LIMIT_PER_MIN = '40';
  process.env.XP_SCORE_BURST_MAX = '14';
  process.env.XP_SCORE_MIN_EVENTS = '4';
  process.env.XP_SCORE_MIN_VIS_S = '8';
  process.env.XP_KEY_NS = 'test:score-rate:burst';

  const { handler } = await import('../netlify/functions/award-xp.mjs?mode=score&case=burst');
  const { store } = await import('../netlify/functions/_shared/store-upstash.mjs');

  const userId = 'score-rate-burst';
  const gameId = 'score-rate-game';
  const sessionPrefix = 'score-rate-session-burst';

  const minuteKey = scoreRateKey(process.env.XP_KEY_NS, userId, BASE_NOW);
  await store.setex(minuteKey, 60, 5);

  const invoke = createInvoker(handler, {
    userId,
    gameId,
    sessionPrefix,
    pointsPerPeriod: 9,
    visibilitySeconds: 18,
    inputEvents: 9,
  });

  const { statusCode, payload } = await invoke({ scoreDelta: 10 });
  assert.equal(statusCode, 200);
  assert.equal(payload.awarded, 90);
  assert.equal(payload.debug.scoreDeltaAccepted, 9);
  assert.equal(payload.debug.scoreRateMinute, 14);
  assert.equal(payload.debug.scoreBurstMax, 14);
  assert.equal(payload.debug.scoreRateLimit, 40);
}

async function testStrictActivityGate() {
  process.env.XP_DEBUG = '1';
  process.env.XP_USE_SCORE = '1';
  process.env.XP_SCORE_TO_XP = '10';
  process.env.XP_MAX_XP_PER_WINDOW = '200';
  process.env.XP_SCORE_RATE_LIMIT_PER_MIN = '30';
  process.env.XP_SCORE_BURST_MAX = '30';
  process.env.XP_SCORE_MIN_EVENTS = '6';
  process.env.XP_SCORE_MIN_VIS_S = '12';
  process.env.XP_KEY_NS = 'test:score-rate:activity';

  const { handler } = await import('../netlify/functions/award-xp.mjs?mode=score&case=activity');

  const invoke = createInvoker(handler, {
    userId: 'score-rate-activity',
    gameId: 'score-rate-game',
    sessionPrefix: 'score-rate-session-activity',
    pointsPerPeriod: 9,
    visibilitySeconds: 14,
    inputEvents: 7,
  });

  const { statusCode, payload } = await invoke({
    scoreDelta: 8,
    visibilitySeconds: 10,
    inputEvents: 5,
  });

  assert.equal(statusCode, 200);
  assert.equal(payload.awarded, 0);
  assert.equal(payload.reason, 'insufficient-activity');
  assert.equal(payload.debug.reason, 'insufficient-activity');
  assert.equal(payload.debug.scoreDeltaAccepted, 0);
  assert.equal(payload.debug.scoreRateMinute, null);
}

await testWithinAllowance();
await testMinuteCapReached();
await testBurstCapTrim();
await testStrictActivityGate();

console.log('xp-award-score-rate tests passed');
