import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

function fileUrl(p: string) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  return 'file://' + abs;
}

async function readTimeLeft(page) {
  const text = (await page.locator('#timeLeft').innerText()).trim();
  const m = text.match(/([0-9]+(?:\.[0-9]+)?)s/);
  return m ? parseFloat(m[1]) : NaN;
}

test('game starts, pauses, and resumes (deterministic, no timers)', async ({ page }) => {
  const gamePath = path.join(__dirname, '..', 'game_cats.html');
  expect(fs.existsSync(gamePath)).toBeTruthy();

  await page.goto(fileUrl(gamePath));
  // Ensure clean storage so tokens/time are predictable
  await page.evaluate(() => {
    try { localStorage.removeItem((window as any).CONFIG?.STORAGE_KEY || ''); } catch {}
  });
  await page.reload();

  // Verify initial tokens and overlay
  const tokensBefore = await page.locator('#tokens').innerText();
  expect(tokensBefore.trim()).toBe('10');
  await expect(page.locator('#centerOverlay')).toBeVisible();

  // Start the game (discrete state change)
  await page.locator('#playBtn').click();
  await expect(page.locator('#centerOverlay')).toHaveClass(/hidden/);
  const tokensAfterStart = await page.locator('#tokens').innerText();
  expect(tokensAfterStart.trim()).toBe('9');

  // Pause
  await page.locator('#btnPause').click();
  await expect(page.locator('#btnPause')).toHaveAttribute('aria-pressed', 'true');

  // Resume
  await page.locator('#btnPause').click();
  await expect(page.locator('#btnPause')).toHaveAttribute('aria-pressed', 'false');
});
