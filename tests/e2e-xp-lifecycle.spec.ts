import { test, expect, Page } from '@playwright/test';

async function waitForRunning(page: Page) {
  // 1) Wait until XP is on window
  await page.waitForFunction(() => !!(window as any).XP, { timeout: 5000 });

  // 2) Start or resume a session so XP.isRunning() can become true
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

  // 3) Wait for the running flag
  await page.waitForFunction(() => {
    const w = (window as any);
    return !!w.XP && typeof w.XP.isRunning === 'function' && w.XP.isRunning();
  }, { timeout: 5000 });
}

test.describe('XP lifecycle smoke', () => {
  test('session survives navigation and visibility toggles', async ({ page }) => {
    await page.goto('/game.html');
    await waitForRunning(page);

    await page.goto('/xp.html');
    await page.goBack();
    await waitForRunning(page);

    await page.evaluate(() => {
      const XP = (window as any).XP;
      (window as any).__resumeCalls = 0;
      if (!XP || typeof XP.resumeSession !== 'function') return;
      const original = XP.resumeSession.bind(XP);
      XP.resumeSession = function (...args: any[]) {
        (window as any).__resumeCalls += 1;
        return original(...args);
      };
    });

    const visibilityHack = await page.evaluate(() => {
      const XP = (window as any).XP;
      if (!XP) return false;

      (window as any).__testVisibilityState = 'visible';

      const define = (target: any) => {
        if (!target) return false;
        try {
          Object.defineProperty(target, 'visibilityState', {
            configurable: true,
            get() {
              return (window as any).__testVisibilityState;
            },
          });
          Object.defineProperty(target, 'hidden', {
            configurable: true,
            get() {
              return (window as any).__testVisibilityState === 'hidden';
            },
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

    await page.evaluate(() => {
      (window as any).__setVisibilityForTest?.('hidden');
    });

    await page.waitForTimeout(150);
    const runningAfterHide = await page.evaluate(() => {
      const XP = (window as any).XP;
      return !!XP && typeof XP.isRunning === 'function' && XP.isRunning();
    });
    expect(runningAfterHide).toBeFalsy();

    await page.evaluate(() => {
      (window as any).__setVisibilityForTest?.('visible');
    });

    await page.waitForFunction(() => {
      const XP = (window as any).XP;
      return !!XP && typeof XP.isRunning === 'function' && XP.isRunning();
    }, { timeout: 2000 });

    const resumeCalls = await page.evaluate(() => (window as any).__resumeCalls || 0);
    expect(resumeCalls).toBeGreaterThan(0);
  });
});
