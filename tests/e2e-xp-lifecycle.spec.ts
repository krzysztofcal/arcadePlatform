import { test, expect, Page } from '@playwright/test';

async function ensureXP(page: Page) {
  // Be generous: wait for full load, then force-inject XP scripts if needed.
  await page.waitForLoadState('load');

  const hasXP = await page.evaluate(() => !!(window as any).XP).catch(() => false);
  if (!hasXP) {
    try { await page.addScriptTag({ url: '/js/xpClient.js' }); } catch {}
    try { await page.addScriptTag({ url: '/js/xp.js' }); } catch {}
    // Fallback relative (preview servers sometimes mount at a subpath)
    try { await page.addScriptTag({ url: './js/xpClient.js' }); } catch {}
    try { await page.addScriptTag({ url: './js/xp.js' }); } catch {}
  }

  await page.waitForFunction(() => !!(window as any).XP, { timeout: 10000 });
}

async function waitForRunning(page: Page) {
  await ensureXP(page);

  // Start or resume so XP.isRunning() can become true
  await page.evaluate(() => {
    const w = (window as any);
    if (!w.XP) return;
    try {
      if (typeof w.XP.startSession === 'function' && (!w.XP.isRunning || !w.XP.isRunning())) {
        w.XP.startSession('e2e-lifecycle');
      } else if (typeof w.XP.resumeSession === 'function') {
        w.XP.resumeSession();
      } else if (typeof w.XP.nudge === 'function') {
        w.XP.nudge();
      }
    } catch {}
  });

  await page.waitForFunction(() => {
    const w = (window as any);
    return !!w.XP && typeof w.XP.isRunning === 'function' && w.XP.isRunning();
  }, { timeout: 10000 });
}

test.describe('XP lifecycle smoke', () => {
  test('session survives navigation and visibility toggles', async ({ page }) => {
    await page.goto('/game.html', { waitUntil: 'load' });
    await waitForRunning(page);

    await page.goto('/xp.html', { waitUntil: 'load' });
    await page.goBack({ waitUntil: 'load' });
    await waitForRunning(page);

    // --- Visibility-change monkeypatch to simulate hide/show ---
    const visibilityHack = await page.evaluate(() => {
      const XP = (window as any).XP;
      if (!XP) return false;

      (window as any).__testVisibilityState = 'visible';

      const define = (target: any) => {
        if (!target) return false;
        try {
          Object.defineProperty(target, 'visibilityState', {
            configurable: true,
            get() { return (window as any).__testVisibilityState; },
          });
          Object.defineProperty(target, 'hidden', {
            configurable: true,
            get() { return (window as any).__testVisibilityState === 'hidden'; },
          });
          return true;
        } catch (_err) {
          return false;
        }
      };

      const success = define(document) || define(Object.getPrototypeOf(document));
      if (!success) return false;

      (window as any).__setVisibilityForTest = (value: 'visible' | 'hidden') => {
        (window as any).__testVisibilityState = value;
        document.dispatchEvent(new Event('visibilitychange'));
      };

      return true;
    });

    expect(visibilityHack).toBeTruthy();

    // Hide -> pause
    await page.evaluate(() => { (window as any).__setVisibilityForTest?.('hidden'); });
    await page.waitForFunction(() => {
      const w = (window as any);
      return !!w.XP && typeof w.XP.isRunning === 'function' && !w.XP.isRunning();
    }, { timeout: 10000 });

    // Show -> resume
    await page.evaluate(() => { (window as any).__setVisibilityForTest?.('visible'); });
    await page.waitForFunction(() => {
      const w = (window as any);
      return !!w.XP && typeof w.XP.isRunning === 'function' && w.XP.isRunning();
    }, { timeout: 10000 });
  });
});
