import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

function fileUrl(p: string) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  return 'file://' + abs;
}

async function readTimeLeft(page: import('@playwright/test').Page) {
  const text = (await page.locator('#timeLeft').innerText()).trim();
  const m = text.match(/([0-9]+(?:\.[0-9]+)?)s/);
  return m ? parseFloat(m[1]) : NaN;
}

test('game starts, pauses, and resumes', async ({ page }) => {
  const gamePath = path.join(__dirname, '..', 'game_cats.html');
  expect(fs.existsSync(gamePath)).toBeTruthy();

  await page.goto(fileUrl(gamePath));
  await page.evaluate(() => {
    try { localStorage.removeItem((window as any).CONFIG?.STORAGE_KEY || ''); } catch {}
  });
  await page.reload();

  await expect(page.locator('#centerOverlay')).toBeVisible();
  const i18nLoaded = await page.evaluate(() => {
    const api = (window as any).I18N;
    return !!(api && typeof api.t === 'function');
  });
  expect(i18nLoaded).toBe(true);
  await expect(page.locator('#tokens')).toHaveCount(0);
  await expect(page.locator('.stats .stat span:first-child')).toHaveText([
    'Czas',
    'Poziom',
    'Ostatni',
    'Rekord',
  ]);
  await expect(page.locator('body')).not.toContainText(/Kup\s*żetony/i);
  await expect(page.locator('body')).not.toContainText('Zagraj (-1 żeton)');
  await expect(page.locator('body')).not.toContainText('Kup żetony (+10)');
  await expect(page.locator('body')).not.toContainText('Reset');
  const statusBefore = (await page.locator('#status').innerText()).trim();
  expect(statusBefore).toBe('');

  await page.locator('#bigStartBtn').click();
  await expect(page.locator('#centerOverlay')).toHaveClass(/hidden/);
  await expect(page.locator('#status')).toHaveText(/Punkty: 0/);

  const timeAfterStart = await readTimeLeft(page);
  await page.waitForTimeout(200);
  const timeAfterWait = await readTimeLeft(page);
  expect(timeAfterWait).toBeLessThan(timeAfterStart);

  await page.locator('#btnPause').click();
  await expect(page.locator('#btnPause')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#btnPause').click();
  await expect(page.locator('#btnPause')).toHaveAttribute('aria-pressed', 'false');
});

test('replay button restarts the round', async ({ page }) => {
  const gamePath = path.join(__dirname, '..', 'game_cats.html');
  expect(fs.existsSync(gamePath)).toBeTruthy();

  await page.goto(fileUrl(gamePath));
  await page.evaluate(() => {
    try { localStorage.removeItem((window as any).CONFIG?.STORAGE_KEY || ''); } catch {}
  });
  await page.reload();
  await page.evaluate(() => {
    if ((window as any).CONFIG) (window as any).CONFIG.ROUND_TIME_MS = 600;
  });

  await expect(page.locator('#centerOverlay')).toBeVisible();
  await page.locator('#bigStartBtn').click();
  await expect(page.locator('#centerOverlay')).toHaveClass(/hidden/);

  await expect(page.locator('#gameOverOverlay')).toBeVisible({ timeout: 3000 });

  await page.locator('#replayBtn').click();

  await expect(page.locator('#gameOverOverlay')).toHaveClass(/hidden/);
  await expect(page.locator('#centerOverlay')).toHaveClass(/hidden/);
  await expect(page.locator('#status')).toHaveText(/Punkty: 0/);

  const timeAfterRestart = await readTimeLeft(page);
  expect(timeAfterRestart).toBeGreaterThan(0);
  expect(timeAfterRestart).toBeLessThanOrEqual(0.6);
});
