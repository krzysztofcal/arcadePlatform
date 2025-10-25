import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

function loadCatalog() {
  const catalogPath = path.join(__dirname, '..', 'js', 'games.json');
  const raw = fs.readFileSync(catalogPath, 'utf-8');
  const sanitized = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(sanitized);
}

function getLocalizedTitles(game: any): string[] {
  if (!game || !game.title) return [];
  if (typeof game.title === 'string') {
    const trimmed = game.title.trim();
    return trimmed ? [trimmed] : [];
  }
  const titles: string[] = [];
  if (typeof game.title.en === 'string') titles.push(game.title.en.trim());
  if (typeof game.title.pl === 'string') titles.push(game.title.pl.trim());
  return titles.filter(Boolean);
}

function isPlayableGame(game: any): boolean {
  if (!game || typeof game !== 'object') return false;
  const source = game.source;
  if (!source || typeof source !== 'object') return false;
  if (source.type === 'placeholder') return false;
  if (typeof source.page === 'string' && source.page.trim().length > 0) {
    return true;
  }
  if (source.type === 'distributor') {
    const embed = typeof source.embedUrl === 'string' ? source.embedUrl : source.url;
    return typeof embed === 'string' && embed.trim().length > 0;
  }
  return false;
}

const catalog = loadCatalog();
const arcadeGame = catalog.games.find((game: any) => Array.isArray(game?.category) && game.category.includes('Arcade'));
const puzzleGame = catalog.games.find((game: any) => Array.isArray(game?.category) && game.category.includes('Puzzle'));

if (!arcadeGame || !puzzleGame) {
  throw new Error('Required test fixtures missing from js/games.json');
}

const arcadeTitles = getLocalizedTitles(arcadeGame);
const puzzleTitles = getLocalizedTitles(puzzleGame);
const arcadeSlug = arcadeGame.slug || arcadeGame.id;
const puzzleSlug = puzzleGame.slug || puzzleGame.id;
const puzzleIsPlayable = isPlayableGame(puzzleGame);
const puzzleTitleForSelector = puzzleTitles[0] || puzzleSlug;

if (!arcadeSlug || !puzzleSlug) {
  throw new Error('Missing slug identifiers for test fixtures');
}

const puzzleCategory = Array.isArray(puzzleGame.category) && puzzleGame.category[0] ? puzzleGame.category[0] : 'Puzzle';
const arcadeSlugParam = encodeURIComponent(arcadeSlug);
const puzzleSlugParam = encodeURIComponent(puzzleSlug);

test.describe('portal smoke tests', () => {
  test('renders categories and game cards', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.querySelectorAll('#gamesGrid .card').length > 1);

    const defaultCategories = await page.evaluate(() => {
      return Array.isArray(window.PortalApp?.DEFAULT_CATEGORIES)
        ? window.PortalApp.DEFAULT_CATEGORIES.slice()
        : [];
    });
    expect(defaultCategories.length).toBeGreaterThan(0);

    const categoryButtons = page.locator('#categoryBar .category-button');
    await expect(categoryButtons).toHaveCount(defaultCategories.length);

    const activeText = await page.locator('#categoryBar .category-button[aria-pressed="true"]').innerText();
    expect(defaultCategories).toContain(activeText);

    const cards = page.locator('#gamesGrid .card');
    expect(await cards.count()).toBeGreaterThan(1);

    const firstCardClass = (await cards.first().getAttribute('class')) || '';
    expect(firstCardClass).toContain('slot-card');

    const titles = await page.locator('#gamesGrid .card .title').allTextContents();
    const hasArcadeTitle = titles.some((title) =>
      arcadeTitles.some((expected) => expected && title.includes(expected))
    );
    expect(hasArcadeTitle).toBeTruthy();

    await expect(page.locator(`#gamesGrid a.card[href*="slug=${arcadeSlugParam}"]`)).toBeVisible();
  });

  test('category selection updates grid and persists via URL', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.querySelectorAll('#gamesGrid .card').length > 1);

    const puzzleButton = page.locator(`#categoryBar .category-button[data-category="${puzzleCategory}"]`);
    await puzzleButton.click();
    await expect(puzzleButton).toHaveAttribute('aria-pressed', 'true');

    if (puzzleIsPlayable) {
      await page.waitForSelector(`#gamesGrid a.card[href*="slug=${puzzleSlugParam}"]`);
    } else if (puzzleTitleForSelector) {
      await expect(
        page.locator('#gamesGrid .card .title', {
          hasText: puzzleTitleForSelector,
        })
      ).toBeVisible();
    }

    const puzzleVisibleTitles = await page.locator('#gamesGrid .card .title').allTextContents();
    const hasPuzzleTitle = puzzleVisibleTitles.some((title) =>
      puzzleTitles.some((expected) => expected && title.includes(expected))
    );
    expect(hasPuzzleTitle).toBeTruthy();

    await expect(page.locator(`#gamesGrid a.card[href*="slug=${arcadeSlugParam}"]`)).toHaveCount(0);
    if (!puzzleIsPlayable && puzzleTitleForSelector) {
      await expect(page.locator(`#gamesGrid a.card[href*="slug=${puzzleSlugParam}"]`)).toHaveCount(0);
    }

    const urlAfterClick = new URL(page.url());
    expect(urlAfterClick.searchParams.get('category')).toBe(puzzleCategory);

    await page.reload();
    await page.waitForSelector('#categoryBar .category-button[aria-pressed="true"]');
    if (puzzleIsPlayable) {
      await page.waitForSelector(`#gamesGrid a.card[href*="slug=${puzzleSlugParam}"]`);
    } else if (puzzleTitleForSelector) {
      await expect(
        page.locator('#gamesGrid .card .title', {
          hasText: puzzleTitleForSelector,
        })
      ).toBeVisible();
    }

    const activeAfterReload = await page.locator('#categoryBar .category-button[aria-pressed="true"]').innerText();
    expect(activeAfterReload).toBe(puzzleCategory);
  });

  test('language switch updates localized content', async ({ page }) => {
    await page.goto('/');
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
    await page.goto('/');
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
