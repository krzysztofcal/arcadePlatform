const { test, expect } = require('@playwright/test');

const GAME_PAGE = process.env.XP_E2E_PAGE ?? '/game_cats.html';
const SETTLE_DELAY_MS = 1_000;
const IDLE_OBSERVE_MS = 12_000;
const GESTURE_SPACING_MS = 800; // keep "active" continuous (each gesture extends ~2s)

// The sustained-input case deliberately spends more than 20 seconds sending
// user gestures. Leave startup and CI scheduling headroom beyond Playwright's
// default 30 second test timeout.
test.setTimeout(45_000);

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

  test('reports activity after sustained input and gameplay actions', async ({ page }) => {
    await page.goto(GAME_PAGE, { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(SETTLE_DELAY_MS);

    const performGesture = async (offset) => {
      const base = 120 + offset * 30;
      await page.mouse.move(base, base);
      await page.waitForTimeout(50);
      await page.mouse.down();
      await page.waitForTimeout(50);
      await page.mouse.up();
      await page.waitForTimeout(50);
      await page.keyboard.press('Space');
      await page.evaluate(() => {
        const xp = window.XP;
        if (!xp || typeof xp.reportGameAction !== 'function') return;
        xp.reportGameAction('cats', { kind: 'accepted_move' });
      });
    };

    // ~14 gestures * 0.8s spacing ≈ 11–12s of continuous "active" time
    for (let i = 0; i < 14; i += 1) {
      await performGesture(i);
      if (i < 13) {
        await page.waitForTimeout(GESTURE_SPACING_MS);
      }
    }

    await expect.poll(async () => (
      await page.evaluate(() =>
        (window.__xpCalls || []).filter(c => c.method === 'postWindow').length
      )
    ), {
      message: 'XPClient.postWindow should be called after sustained gameplay',
      timeout: 8_000,
    }).toBeGreaterThan(0);
  });
});
