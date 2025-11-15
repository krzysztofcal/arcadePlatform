const { test, expect } = require('@playwright/test');
const { driveActiveWindow } = require('./helpers/xp-driver');

const GAME_PAGE = process.env.XP_E2E_PAGE ?? '/game_cats.html';
const VISIBILITY_WARMUP_MS = 2_200;
const NUDGE_COUNT = 4;
const NUDGE_SPACING_MS = 120;

function initXpClientRecorder() {
  return `(() => {
    const calls = [];
    const record = (method, args) => {
      calls.push({ method, args: Array.from(args) });
    };
    Object.defineProperty(window, '__xpCalls', {
      configurable: false,
      enumerable: false,
      get() { return calls; },
    });
    const stub = {
      postWindow: (...args) => {
        record('postWindow', args);
        return Promise.resolve({ ok: true, stub: true });
      },
      fetchStatus: (...args) => {
        record('fetchStatus', args);
        return Promise.resolve({ ok: true, stub: true, totalToday: 0, cap: null, totalLifetime: 0 });
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

async function runWindow(page, scoreDelta) {
  await page.evaluate(() => {
    const xp = window.XP;
    if (!xp || typeof xp.startSession !== 'function') return;
    xp.startSession('xp-score-e2e');
  });

  await page.waitForTimeout(VISIBILITY_WARMUP_MS);

  for (let i = 0; i < NUDGE_COUNT; i += 1) {
    await page.evaluate(() => {
      const xp = window.XP;
      if (!xp || typeof xp.nudge !== 'function') return;
      xp.nudge();
    });
    await page.waitForTimeout(NUDGE_SPACING_MS);
  }

  if (typeof scoreDelta === 'number') {
    await page.evaluate((delta) => {
      const xp = window.XP;
      if (!xp || typeof xp.addScore !== 'function') return;
      xp.addScore(delta);
    }, scoreDelta);
  }

  await driveActiveWindow(page);

  await page.evaluate(() => {
    const xp = window.XP;
    if (!xp || typeof xp.stopSession !== 'function') return;
    xp.stopSession({ flush: true });
  });
}

function getPostWindowPayloads(page) {
  return page.evaluate(() => {
    return (window.__xpCalls || [])
      .filter((entry) => entry.method === 'postWindow')
      .map((entry) => entry.args[0]);
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript({ content: initXpClientRecorder() });
});

test.describe('XP score protocol', () => {
  test('includes scoreDelta only when a score window has awards', async ({ page }) => {
    // Allow large deltas for this test; bypass client clamp
    await page.addInitScript(() => {
      window.XP_DELTA_CAP_CLIENT = 10_000;
    });

    await page.goto(GAME_PAGE, { waitUntil: 'domcontentloaded' });
    await ensureXpReady(page);

    await runWindow(page, 321);
    await page.waitForFunction(() => {
      const calls = (window.__xpCalls || []).filter((entry) => entry.method === 'postWindow');
      return calls.length >= 1;
    });

    let payloads = await getPostWindowPayloads(page);
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    const firstPayload = payloads[0];
    expect(firstPayload.scoreDelta).toBe(321);

    await runWindow(page, undefined);
    await page.waitForFunction(() => {
      const calls = (window.__xpCalls || []).filter((entry) => entry.method === 'postWindow');
      return calls.length >= 2;
    });

    payloads = await getPostWindowPayloads(page);
    expect(payloads.length).toBeGreaterThanOrEqual(2);
    const secondPayload = payloads[1];
    expect(secondPayload.scoreDelta === undefined || secondPayload.scoreDelta === 0).toBeTruthy();
  });
});
