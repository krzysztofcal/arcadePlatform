const { test, expect } = require('@playwright/test');
const { driveActiveWindow } = require('./helpers/xp-driver');

const GAME_PAGE = process.env.XP_E2E_PAGE ?? '/game_cats.html';
const SETTLE_DELAY_MS = 1_000;
const IDLE_OBSERVE_MS = 12_000;

function initXpClientStub() {
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__XP_TEST_DISABLE_IDLE_GUARD = true;
    window.__XP_TEST_WINDOW_MS = 1_000;
  });
  await page.addInitScript({ content: initXpClientStub() });
});

test.describe('XP idle behaviour', () => {
  test('remains idle without interactions', async ({ page }) => {
    await page.goto(GAME_PAGE, { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(SETTLE_DELAY_MS);
    await page.waitForTimeout(IDLE_OBSERVE_MS);

    const postCount = await page.evaluate(() =>
      (window.__xpCalls || []).filter(c => c.method === 'postWindow').length
    );
    expect(postCount).toBe(0);
  });

  test('reports activity after sustained user input', async ({ page }) => {
    await page.goto(GAME_PAGE, { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(SETTLE_DELAY_MS);

    await driveActiveWindow(page, IDLE_OBSERVE_MS, 12);

    const postCount = await page.evaluate(() =>
      (window.__xpCalls || []).filter(c => c.method === 'postWindow').length
    );
    expect(postCount).toBeGreaterThan(0);
  });
});
