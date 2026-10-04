import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

function fileUrl(p: string) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  return 'file://' + abs;
}

test('Mute button toggles aria-pressed and title', async ({ page }) => {
  const gamePath = path.join(__dirname, '..', 'game_cats.html');
  expect(fs.existsSync(gamePath)).toBeTruthy();

  // Ensure deterministic mute state across runs
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('arcade_cats_smooth_state_page_fs_fix');
    } catch (_) {}
  });

  await page.goto(fileUrl(gamePath), { waitUntil: 'domcontentloaded' });

  const mute = page.locator('#btnMute');
  await expect(mute).toBeVisible();

  // Initial state should be unmuted
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await expect(mute).toHaveAttribute('title', 'Mute');

  await mute.click();

  // aria-pressed should toggle, and title should swap Mute/Unmute
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await expect(mute).toHaveAttribute('title', 'Unmute');

  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await expect(mute).toHaveAttribute('title', 'Mute');
});

test('Fullscreen buttons sanity (enter/exit visibility)', async ({ page }) => {
  const gamePath = path.join(__dirname, '..', 'game_cats.html');
  expect(fs.existsSync(gamePath)).toBeTruthy();

  await page.goto(fileUrl(gamePath), { waitUntil: 'domcontentloaded' });

  const enter = page.locator('#btnEnterFs');
  const exit = page.locator('#btnExitFs');

  await expect(enter).toBeVisible();
  // Exit is hidden by style="display:none;" initially
  const exitDisplay0 = await exit.evaluate((el) => (el as HTMLElement).style.display || '');
  expect(exitDisplay0).toBe('none');

  // Await the native outcome, not a fixed delay or an intermediate fullscreen property.
  const [isFs] = await Promise.all([
    page.evaluate(() => {
      if (!document.fullscreenEnabled && !(document as any).webkitFullscreenEnabled) return false;
      return new Promise<boolean>((resolve) => {
        const events = ['fullscreenchange', 'webkitfullscreenchange', 'fullscreenerror', 'webkitfullscreenerror'];
        const done = () => {
          events.forEach((event) => document.removeEventListener(event, done));
          resolve(!!(document.fullscreenElement || (document as any).webkitFullscreenElement));
        };
        events.forEach((event) => document.addEventListener(event, done, { once: true }));
      });
    }),
    enter.click(),
  ]);

  if (isFs) {
    // The existing application listener synchronizes the buttons on fullscreenchange.
    await expect(exit).toBeVisible();
  } else {
    // Preserve coverage for browsers where headless fullscreen is unavailable/rejected.
    await expect(enter).toBeVisible();
  }
});
