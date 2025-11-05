import { test, expect } from '@playwright/test';

async function totalXp(page) {
  return await page.evaluate(() => (window as any).XP?.getSnapshot?.().totalXp ?? 0);
}

test('idle tab earns no XP', async ({ page }) => {
  await page.goto('/game.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const xp = await totalXp(page);
  expect(xp).toBe(0);
});

test('inputs extend engagement and earn XP', async ({ page }) => {
  await page.goto('/game.html', { waitUntil: 'domcontentloaded' });
  const xp0 = await totalXp(page);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(1000);
  const xp1 = await totalXp(page);
  expect(xp1).toBeGreaterThanOrEqual(xp0 + 1);
});

test('single input grace window only', async ({ page }) => {
  await page.goto('/game.html', { waitUntil: 'domcontentloaded' });
  const xp0 = await totalXp(page);
  await page.keyboard.press('ArrowLeft'); // one nudge
  await page.waitForTimeout(3000);
  const xp1 = await totalXp(page); // might increase slightly
  await page.waitForTimeout(9000); // past ACTIVE_WINDOW_MS
  const xp2 = await totalXp(page);
  expect(xp2).toBe(xp1); // no further growth after grace window
});
