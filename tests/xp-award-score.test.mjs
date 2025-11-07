import assert from 'node:assert/strict';

const CHUNK_MS = 10_000;
const BASE_NOW = 1_700_000_000_000;

function createInvoker(handler, { userId, gameId, sessionPrefix, pointsPerPeriod, visibilitySeconds, inputEvents }) {
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

async function testTimeMode() {
  process.env.XP_DEBUG = '1';
  process.env.XP_USE_SCORE = '0';
  process.env.XP_KEY_NS = 'test:time';
  const { handler } = await import(`../netlify/functions/award-xp.mjs?mode=time`);

  const invoke = createInvoker(handler, {
    userId: 'user-time',
    gameId: 'game-time',
    sessionPrefix: 'sess-time',
    pointsPerPeriod: 7,
    visibilitySeconds: 12,
    inputEvents: 5,
  });

  const { statusCode, payload } = await invoke();
  assert.equal(statusCode, 200);
  assert.equal(payload.awarded, 7);
  assert.equal(payload.totalToday, 7);
  assert(payload.debug, 'debug info missing');
  assert.equal(payload.debug.mode, 'time');
  assert.equal(payload.debug.grantStep, 7);
  assert.equal(payload.debug.pointsPerPeriod, 7);
  assert.equal(payload.debug.scoreDelta, null);
  assert(!('scoreXp' in payload.debug), 'scoreXp should be absent in time mode');
}

async function testScoreMode() {
  process.env.XP_DEBUG = '1';
  process.env.XP_USE_SCORE = '1';
  process.env.XP_SCORE_TO_XP = '10';
  process.env.XP_MAX_XP_PER_WINDOW = '25';
  process.env.XP_DAILY_CAP = '30';
  process.env.XP_KEY_NS = 'test:score';
  const { handler } = await import(`../netlify/functions/award-xp.mjs?mode=score`);

  const invoke = createInvoker(handler, {
    userId: 'user-score',
    gameId: 'game-score',
    sessionPrefix: 'sess-score',
    pointsPerPeriod: 6,
    visibilitySeconds: 12,
    inputEvents: 5,
  });

  const first = await invoke({ scoreDelta: 1 });
  assert.equal(first.statusCode, 200);
  assert.equal(first.payload.awarded, 10);
  assert.equal(first.payload.totalToday, 10);
  assert.equal(first.payload.debug.mode, 'score');
  assert.equal(first.payload.debug.scoreDelta, 1);
  assert.equal(first.payload.debug.scoreXp, 10);
  assert.equal(first.payload.debug.grantStep, 10);

  const second = await invoke({ scoreDelta: 5 });
  assert.equal(second.payload.awarded, 20);
  assert.equal(second.payload.totalToday, 30);
  assert.equal(second.payload.debug.mode, 'score');
  assert.equal(second.payload.debug.scoreXp, 25);
  assert.equal(second.payload.debug.grantStep, 25);

  const third = await invoke({ scoreDelta: 5 });
  assert.equal(third.payload.awarded, 0);
  assert.equal(third.payload.capped, true);
  assert.equal(third.payload.totalToday, 30);
}

await testTimeMode();
await testScoreMode();

console.log('xp-award-score tests passed');
