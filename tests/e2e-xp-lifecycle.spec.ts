import { test, expect, Page } from '@playwright/test';
import path from 'path';

// Preload XP scripts before every test so window.XP is always present.
test.beforeEach(async ({ page }) => {
  // Surface runtime errors to CI logs
  page.on('pageerror', e => console.log('[pageerror]', e.message ?? String(e)));
  page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

  const preload = [
    path.join(process.cwd(), 'js/xpClient.js'),
    path.join(process.cwd(), 'js/xp.js'),
  ];
  for (const p of preload) {
    try { await page.addInitScript({ path: p }); } catch { /* ignore in CI */ }
  }
});

async function ensureXP(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).XP, { timeout: 10_000 });
}

async function startOrResume(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
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
}

async function waitForRunning(page: Page): Promise<void> {
  await ensureXP(page);
  await startOrResume(page);
  await page.waitForFunction(() => {
    const w = window as any;
    return !!w.XP && typeof w.XP.isRunning === 'function' && w.XP.isRunning();
  }, { timeout: 10_000 });
}

test.describe('XP lifecycle smoke', () => {
  test('session survives navigation and visibility toggles', async ({ page }) => {
    await page.goto('/game.html', { waitUntil: 'load' });
    await waitForRunning(page);

    await page.goto('/xp.html', { waitUntil: 'load' });
    await page.goBack({ waitUntil: 'load' });
    await waitForRunning(page);

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
        } catch {
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

    // Hide -> expect paused
    await page.evaluate(() => { (window as any).__setVisibilityForTest?.('hidden'); });
    await page.waitForFunction(() => {
      const w = window as any;
      return !!w.XP && typeof w.XP.isRunning === 'function' && !w.XP.isRunning();
    }, { timeout: 10_000 });

    // Show -> expect running
    await page.evaluate(() => { (window as any).__setVisibilityForTest?.('visible'); });
    await page.waitForFunction(() => {
      const w = window as any;
      return !!w.XP && typeof w.XP.isRunning === 'function' && w.XP.isRunning();
    }, { timeout: 10_000 });
  });
});
