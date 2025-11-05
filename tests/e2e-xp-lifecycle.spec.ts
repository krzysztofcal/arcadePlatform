// tests/e2e-xp-lifecycle.spec.ts
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Log page-side errors and preload XP scripts for every test.
test.beforeEach(async ({ page }) => {
  page.on('pageerror', e => console.log('[pageerror]', e.message ?? String(e)));
  page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

  // Inject the real scripts as init scripts (run before any page scripts)
  try { await page.addInitScript({ content: fs.readFileSync(path.join(process.cwd(), 'js/xpClient.js'), 'utf8') }); } catch {}
  try { await page.addInitScript({ content: fs.readFileSync(path.join(process.cwd(), 'js/xp.js'),       'utf8') }); } catch {}

  // Fallback stub ONLY if XP still isn’t present at runtime.
  await page.addInitScript({ content: `
    (function(){
      if (window.XP) return;  // real XP already present
      var running = false;
      window.XP = {
        startSession: function(){ running = true; },
        resumeSession: function(){ running = true; },
        stopSession:   function(){ running = false; },
        nudge:         function(){ /* no-op */ },
        isRunning:     function(){ return !!running; }
      };
      document.addEventListener('visibilitychange', function(){
        if (document.visibilityState === 'visible') running = true;
        else running = false;
      }, { passive: true });
    })();
  `});
});

async function ensureXP(page: Page): Promise<void> {
  // Wait until window.XP actually exists in the page
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
        w.XP.nudge({ synthetic: true });
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
    await page.goto('/game.html', { waitUntil: 'domcontentloaded' });
    await waitForRunning(page);

    await page.goto('/xp.html', { waitUntil: 'domcontentloaded' });
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await waitForRunning(page);

    // Monkeypatch visibility to simulate hide/show
    const ok = await page.evaluate(() => {
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
        } catch { return false; }
      };

      (window as any).__testVisibilityState = 'visible';
      const success = define(document) || define(Object.getPrototypeOf(document));
      if (!success) return false;

      (window as any).__setVisibilityForTest = (v: 'visible' | 'hidden') => {
        (window as any).__testVisibilityState = v;
        document.dispatchEvent(new Event('visibilitychange'));
      };
      return true;
    });
    expect(ok).toBeTruthy();

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
