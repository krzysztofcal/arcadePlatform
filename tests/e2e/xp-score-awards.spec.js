const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_PAGE = process.env.XP_E2E_PAGE ?? '/game_cats.html';
const VISIBILITY_WARMUP_MS = 2_200;
const NUDGE_COUNT = 4;
const NUDGE_SPACING_MS = 120;

function initXpClientHarness() {
  return `(() => {
    const calls = [];
    const responses = [];
    const record = (method, args) => {
      calls.push({ method, args: Array.from(args) });
    };
    Object.defineProperty(window, '__xpCalls', {
      configurable: false,
      enumerable: false,
      get() { return calls; },
    });
    Object.defineProperty(window, '__xpResponses', {
      configurable: false,
      enumerable: false,
      get() { return responses; },
    });
    const stub = {
      postWindow: (...args) => {
        record('postWindow', args);
        const payload = args[0];
        if (typeof window.__xpHandlePostWindow === 'function') {
          return Promise.resolve(window.__xpHandlePostWindow(payload)).then((result) => {
            responses.push({ method: 'postWindow', payload: result });
            return result;
          });
        }
        const fallback = { ok: true, stub: true };
        responses.push({ method: 'postWindow', payload: fallback });
        return Promise.resolve(fallback);
      },
      fetchStatus: (...args) => {
        record('fetchStatus', args);
        if (typeof window.__xpHandleFetchStatus === 'function') {
          return Promise.resolve(window.__xpHandleFetchStatus(args[0])).then((result) => {
            responses.push({ method: 'fetchStatus', payload: result });
            return result;
          });
        }
        const fallback = { ok: true, stub: true, totalToday: 0, cap: null, totalLifetime: 0 };
        responses.push({ method: 'fetchStatus', payload: fallback });
        return Promise.resolve(fallback);
      },
    };
    Object.defineProperty(window, 'XPClient', {
      configurable: true,
      enumerable: false,
      get() { return stub; },
      set() { /* ignore assignments; keep stub */ },
    });
  })();`;
}

async function ensureXpReady(page) {
  await page.waitForFunction(() => {
    return !!(window.XP && typeof window.XP.startSession === 'function');
  });
}

async function runWindow(page, scoreDelta, options = {}) {
  const {
    nudgeCount = NUDGE_COUNT,
    nudgeSpacingMs = NUDGE_SPACING_MS,
    visibilityMs = VISIBILITY_WARMUP_MS,
  } = options;

  await page.evaluate(() => {
    const xp = window.XP;
    if (!xp || typeof xp.startSession !== 'function') return;
    xp.startSession('xp-score-awards');
  });

  if (visibilityMs > 0) {
    await page.waitForTimeout(visibilityMs);
  }

  for (let i = 0; i < nudgeCount; i += 1) {
    await page.evaluate(() => {
      const xp = window.XP;
      if (!xp || typeof xp.nudge !== 'function') return;
      xp.nudge();
    });
    if (i < nudgeCount - 1 && nudgeSpacingMs > 0) {
      await page.waitForTimeout(nudgeSpacingMs);
    }
  }

  if (typeof scoreDelta === 'number') {
    await page.evaluate((delta) => {
      const xp = window.XP;
      if (!xp || typeof xp.addScore !== 'function') return;
      xp.addScore(delta);
    }, scoreDelta);
  }

  await page.evaluate(() => {
    const xp = window.XP;
    if (!xp || typeof xp.stopSession !== 'function') return;
    xp.stopSession({ flush: true });
  });
}

async function getPostWindowResponses(page) {
  return page.evaluate(() => {
    return (window.__xpResponses || [])
      .filter((entry) => entry.method === 'postWindow')
      .map((entry) => entry.payload);
  });
}

async function clearHarness(page) {
  await page.evaluate(() => {
    const calls = window.__xpCalls;
    const responses = window.__xpResponses;
    if (Array.isArray(calls)) {
      calls.splice(0, calls.length);
    }
    if (Array.isArray(responses)) {
      responses.splice(0, responses.length);
    }
  });
}

async function loadAwardHandler(envOverrides = {}) {
  const moduleUrl = pathToFileURL(path.join(__dirname, '..', '..', 'netlify', 'functions', 'award-xp.mjs')).href;
  const cacheBuster = `?t=${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const overrides = Object.entries(envOverrides);
  const previous = new Map(overrides.map(([key]) => [key, process.env[key]]));

  for (const [key, value] of overrides) {
    process.env[key] = value;
  }

  const mod = await import(`${moduleUrl}${cacheBuster}`);

  for (const [key] of overrides) {
    const prior = previous.get(key);
    if (prior === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prior;
    }
  }

  return mod.handler;
}

async function setupPostWindowHandler(page, handler, identity = {}) {
  const {
    userId = 'xp-e2e-user',
    sessionId = `sess-${Date.now()}`,
  } = identity;

  await page.exposeFunction('__xpHandlePostWindow', async (payload) => {
    const body = Object.assign({}, payload, {
      userId,
      sessionId,
    });

    const response = await handler({
      httpMethod: 'POST',
      headers: { origin: 'http://localhost' },
      body: JSON.stringify(body),
    });

    if (!response || typeof response !== 'object') {
      throw new Error('Invalid handler response');
    }

    const { body: resBody } = response;
    if (typeof resBody !== 'string') {
      throw new Error('Handler did not return string body');
    }

    return JSON.parse(resBody);
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript({ content: initXpClientHarness() });
});

test.describe('XP score awards debug modes', () => {
  test('score mode includes debug scoreXp and gating blocks insufficient input', async ({ page }) => {
    const xpScoreToXp = 3;
    const handler = await loadAwardHandler({
      XP_USE_SCORE: '1',
      XP_DEBUG: '1',
      XP_SCORE_TO_XP: String(xpScoreToXp),
      XP_MAX_XP_PER_WINDOW: '100',
    });

    await setupPostWindowHandler(page, handler, { userId: 'xp-score-mode-user' });

    await page.goto(GAME_PAGE, { waitUntil: 'domcontentloaded' });
    await ensureXpReady(page);

    await runWindow(page, 7);

    await page.waitForFunction(() => {
      return (window.__xpResponses || []).some((entry) => entry.method === 'postWindow');
    });

    const responses = await getPostWindowResponses(page);
    expect(responses.length).toBeGreaterThan(0);
    const debugPayload = responses[responses.length - 1];
    expect(debugPayload?.debug?.mode).toBe('score');
    expect(debugPayload?.debug?.scoreXp).toBe(7 * xpScoreToXp);

    await clearHarness(page);

    await runWindow(page, 7, { nudgeCount: 1 });

    await page.waitForTimeout(1_200);

    const postCount = await page.evaluate(() =>
      (window.__xpCalls || []).filter((entry) => entry.method === 'postWindow').length
    );
    expect(postCount).toBe(0);
  });

  test('time mode reports debug mode time and still blocks insufficient activity', async ({ page }) => {
    const handler = await loadAwardHandler({
      XP_USE_SCORE: '0',
      XP_DEBUG: '1',
    });

    await setupPostWindowHandler(page, handler, { userId: 'xp-time-mode-user' });

    await page.goto(GAME_PAGE, { waitUntil: 'domcontentloaded' });
    await ensureXpReady(page);

    await runWindow(page, 7);

    await page.waitForFunction(() => {
      return (window.__xpResponses || []).some((entry) => entry.method === 'postWindow');
    });

    const responses = await getPostWindowResponses(page);
    expect(responses.length).toBeGreaterThan(0);
    const debugPayload = responses[responses.length - 1];
    expect(debugPayload?.debug?.mode).toBe('time');
    expect(debugPayload?.debug?.scoreXp).toBeUndefined();

    await clearHarness(page);

    await runWindow(page, 7, { nudgeCount: 1 });

    await page.waitForTimeout(1_200);

    const postCount = await page.evaluate(() =>
      (window.__xpCalls || []).filter((entry) => entry.method === 'postWindow').length
    );
    expect(postCount).toBe(0);
  });
});
