import { test, expect } from '@playwright/test';
import path from 'path';
import { pathToFileURL } from 'url';

const stubGames = [
  {
    id: 'cat-catcher',
    slug: 'cat-catcher',
    title: { en: 'Catch Cats', pl: 'Łap koty' },
    description: {
      en: 'Snag as many mischievous cats as you can!',
      pl: 'Złap jak najwięcej psotnych kotów!'
    },
    category: ['Arcade'],
    source: { type: 'distributor' },
    thumbnail: 'https://example.com/cat.png'
  },
  {
    id: 'puzzle-bubble',
    slug: 'puzzle-bubble',
    title: { en: 'Bubble Solver', pl: 'Bańkowy łamigłówka' },
    description: {
      en: 'Group colors to clear the board.',
      pl: 'Łącz kolory, aby wyczyścić planszę.'
    },
    category: ['Puzzle'],
    source: { type: 'distributor' },
    thumbnail: 'https://example.com/puzzle.png'
  }
];

test.describe('portal smoke tests', () => {
  const indexPath = path.join(__dirname, '..', 'index.html');

  test.beforeEach(async ({ page }) => {
    await page.route('**/js/games.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version: 1, games: stubGames })
      });
    });
  });

  test('renders categories and game cards', async ({ page }) => {
    await page.goto(pathToFileURL(indexPath).toString());

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

    const cards = page.locator('#gamesGrid .card');
    await expect(cards).toHaveCount(stubGames.length + 1);

    const firstCardClass = (await page.locator('#gamesGrid .card').first().getAttribute('class')) || '';
    expect(firstCardClass).toContain('slot-card');

    const titles = await page.locator('#gamesGrid .card .title').allTextContents();
    expect(titles).toEqual(expect.arrayContaining(['Catch Cats', 'Bubble Solver']));
  });

  test('category selection updates grid and persists via URL', async ({ page }) => {
    await page.goto(pathToFileURL(indexPath).toString());
    await page.waitForSelector('#gamesGrid .card');

    const puzzleButton = page.locator('#categoryBar .category-button', { hasText: 'Puzzle' });
    await puzzleButton.click();
    await expect(puzzleButton).toHaveAttribute('aria-pressed', 'true');

    const urlAfterClick = new URL(page.url());
    expect(urlAfterClick.searchParams.get('category')).toBe('Puzzle');

    const puzzleTitles = await page.locator('#gamesGrid .card .title').allTextContents();
    expect(puzzleTitles).toEqual(['Bubble Solver']);
    expect(puzzleTitles).not.toContain('Catch Cats');

    await page.reload();
    await page.waitForSelector('#gamesGrid .card');

    const activeAfterReload = await page.locator('#categoryBar .category-button[aria-pressed="true"]').innerText();
    expect(activeAfterReload).toBe('Puzzle');
  });

  test('language switch updates localized content', async ({ page }) => {
    await page.goto(pathToFileURL(indexPath).toString());
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
    await page.goto(pathToFileURL(indexPath).toString());
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
