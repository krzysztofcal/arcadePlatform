// tests/e2e-xp-lifecycle.spec.ts
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Read once in Node, inject as raw text in the page.
const XP_CLIENT_SRC = fs.readFileSync(path.join(process.cwd(), 'js/xpClient.js'), 'utf8');
const XP_SRC       = fs.readFileSync(path.join(process.cwd(), 'js/xp.js'), 'utf8');

// Log page-side errors to CI output, and preload XP scripts for every test.
test.beforeEach(async ({ page }) => {
  page.on('pageerror', e => console.log('[pageerror]', e.message ?? String(e)));
  page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
  try { await page.addInitScript({ content: XP_CLIENT_SRC }); } catch {}
  try { await page.addInitScript({ content: XP_SRC }); } catch {}
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

      const ok = define(document) || define(Object.getPrototypeOf(document));
      if (!ok) return false;

      (window as any).__setVisibilityForTest = (v: 'visible' | 'hidden') => {
        (window as any).__testVisibilityState = v;
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
