import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

function fileUrl(p: string) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  return 'file://' + abs;
}

test.describe('portal smoke tests', () => {
  const indexPath = path.join(__dirname, '..', 'index.html');

  test.beforeEach(() => {
    expect(fs.existsSync(indexPath)).toBeTruthy();
  });

  test('renders categories and game cards', async ({ page }) => {
    await page.goto(fileUrl(indexPath));

    await page.waitForSelector('#gamesGrid .card');

    const defaultCategories = await page.evaluate(() => {
      return Array.isArray(window.PortalApp?.DEFAULT_CATEGORIES)
        ? window.PortalApp.DEFAULT_CATEGORIES.slice()
        : [];
    });
    expect(defaultCategories.length).toBeGreaterThan(0);

    const categoryButtons = page.locator('#categoryBar .category-button');
    await expect(categoryButtons).toHaveCount(defaultCategories.length);

    const activeText = await page.locator('#categoryBar .category-button[aria-pressed="true"]').innerText();
    expect(activeText).toBe(defaultCategories[0]);

    const cardCount = await page.locator('#gamesGrid .card').count();
    expect(cardCount).toBeGreaterThan(1);

    const firstCardClass = (await page.locator('#gamesGrid .card').first().getAttribute('class')) || '';
    expect(firstCardClass).toContain('slot-card');

    const titles = await page.locator('#gamesGrid .card .title').allTextContents();
    expect(titles.some((t) => t.toLowerCase().includes('catch cats'))).toBeTruthy();
  });

  test('category selection updates grid and persists via URL', async ({ page }) => {
    await page.goto(fileUrl(indexPath));
    await page.waitForSelector('#gamesGrid .card');

    const puzzleButton = page.locator('#categoryBar .category-button', { hasText: 'Puzzle' });
    await puzzleButton.click();
    await expect(puzzleButton).toHaveAttribute('aria-pressed', 'true');

    const urlAfterClick = new URL(page.url());
    expect(urlAfterClick.searchParams.get('category')).toBe('Puzzle');

    const titles = await page.locator('#gamesGrid .card .title').allTextContents();
    expect(titles.some((t) => /bubble|2048|solitaire/i.test(t))).toBeTruthy();
    expect(titles.some((t) => /catch cats/i.test(t))).toBeFalsy();

    await page.reload();
    await page.waitForSelector('#gamesGrid .card');

    const activeAfterReload = await page.locator('#categoryBar .category-button[aria-pressed="true"]').innerText();
    expect(activeAfterReload).toBe('Puzzle');
  });

  test('language switch updates localized content', async ({ page }) => {
    await page.goto(fileUrl(indexPath));
    await page.waitForSelector('.lang-btn');

    const searchInput = page.locator('.search input[type="search"]');
    const placeholderInitial = (await searchInput.getAttribute('placeholder')) || '';
    expect(placeholderInitial).toMatch(/Search/i);

    const plButton = page.locator('.lang-btn[data-lang="pl"]');
    await plButton.click();
    await expect(plButton).toHaveAttribute('aria-pressed', 'true');

    const placeholderPl = (await searchInput.getAttribute('placeholder')) || '';
    expect(placeholderPl).toMatch(/Szukaj/i);

    const aboutLink = page.locator('.footer-nav .ft-link', { hasText: 'O serwisie' });
    await expect(aboutLink).toBeVisible();
    const aboutHref = (await aboutLink.getAttribute('href')) || '';
    expect(aboutHref).toContain('about.pl.html');

    const url = new URL(page.url());
    expect(url.searchParams.get('lang')).toBe('pl');
  });

  test('sidebar toggle updates aria-expanded and classes', async ({ page }) => {
    await page.goto(fileUrl(indexPath));
    await page.waitForSelector('#sidebar');

    const sidebar = page.locator('#sidebar');
    const toggle = page.locator('#sbToggle');

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const initiallyCollapsed = await sidebar.evaluate((el) => el.classList.contains('collapsed'));
    expect(initiallyCollapsed).toBeTruthy();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const expanded = await sidebar.evaluate((el) => el.classList.contains('expanded'));
    expect(expanded).toBeTruthy();
  });
});
