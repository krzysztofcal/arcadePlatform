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

  await page.goto(fileUrl(gamePath));

  const mute = page.locator('#btnMute');
  await expect(mute).toBeVisible();

  const beforePressed = await mute.getAttribute('aria-pressed');
  const beforeTitle = (await mute.getAttribute('title')) || '';

  await mute.click();
  const afterPressed = await mute.getAttribute('aria-pressed');
  const afterTitle = (await mute.getAttribute('title')) || '';

  // aria-pressed should toggle, and title should swap Mute/Unmute
  expect(beforePressed === 'true' ? 'false' : 'true').toBe(afterPressed);
  expect(beforeTitle === 'Mute' ? 'Unmute' : 'Mute').toBe(afterTitle);
});

test('Fullscreen buttons sanity (enter/exit visibility)', async ({ page }) => {
  const gamePath = path.join(__dirname, '..', 'game_cats.html');
  expect(fs.existsSync(gamePath)).toBeTruthy();

  await page.goto(fileUrl(gamePath));

  const enter = page.locator('#btnEnterFs');
  const exit = page.locator('#btnExitFs');

  await expect(enter).toBeVisible();
  // Exit is hidden by style="display:none;" initially
  const exitDisplay0 = await exit.evaluate((el) => (el as HTMLElement).style.display || '');
  expect(exitDisplay0).toBe('none');

  // Try to enter fullscreen; in headless this may be ignored, so tolerate either outcome
  await enter.click();
  await page.waitForTimeout(300);

  const isFs = await page.evaluate(() => {
    return !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
  });
  const exitDisplay1 = await exit.evaluate((el) => getComputedStyle(el).display);

  if (isFs) {
    // If fullscreen succeeded, exit button should be visible
    expect(exitDisplay1).not.toBe('none');
  } else {
    // Otherwise, at least ensure the click didn't break layout (enter stays visible)
    const enterVisible = await enter.isVisible();
    expect(enterVisible).toBeTruthy();
  }
});

