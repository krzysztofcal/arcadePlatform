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

test('game starts, pauses, and resumes', async ({ page }) => {
  const gamePath = path.join(__dirname, '..', 'game_cats.html');
  expect(fs.existsSync(gamePath)).toBeTruthy();

  await page.goto(fileUrl(gamePath));

  // Start the game
  await page.locator('#playBtn').click();

  // Verify time starts to decrease
  const t0 = await readTimeLeft(page);
  await page.waitForTimeout(700);
  const t1 = await readTimeLeft(page);
  expect(t0).toBeGreaterThan(t1);

  // Pause
  await page.locator('#btnPause').click();
  const tp0 = await readTimeLeft(page);
  await page.waitForTimeout(700);
  const tp1 = await readTimeLeft(page);
  // Allow tiny drift (render cadence), but ensure not decreasing
  expect(Math.abs(tp1 - tp0)).toBeLessThan(0.05);

  // Resume
  await page.locator('#btnPause').click();
  const tr0 = await readTimeLeft(page);
  await page.waitForTimeout(700);
  const tr1 = await readTimeLeft(page);
  expect(tr0).toBeGreaterThan(tr1);
});

