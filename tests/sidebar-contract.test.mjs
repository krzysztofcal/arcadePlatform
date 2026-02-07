import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');

const sidebarModelSource = await readFile(path.join(repoRoot, 'js', 'core', 'sidebar-model.js'), 'utf8');
const accountHtml = await readFile(path.join(repoRoot, 'account.html'), 'utf8');
const favoritesHtml = await readFile(path.join(repoRoot, 'favorites.html'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const recentlyPlayedHtml = await readFile(path.join(repoRoot, 'recently-played.html'), 'utf8');
const aboutEnHtml = await readFile(path.join(repoRoot, 'about.en.html'), 'utf8');
const aboutPlHtml = await readFile(path.join(repoRoot, 'about.pl.html'), 'utf8');
const licensesHtml = await readFile(path.join(repoRoot, 'about', 'licenses.html'), 'utf8');
const termsEnHtml = await readFile(path.join(repoRoot, 'legal', 'terms.en.html'), 'utf8');
const termsPlHtml = await readFile(path.join(repoRoot, 'legal', 'terms.pl.html'), 'utf8');
const privacyEnHtml = await readFile(path.join(repoRoot, 'legal', 'privacy.en.html'), 'utf8');
const privacyPlHtml = await readFile(path.join(repoRoot, 'legal', 'privacy.pl.html'), 'utf8');
const xpHtml = await readFile(path.join(repoRoot, 'xp.html'), 'utf8');
let playHtml = null;
try {
  playHtml = await readFile(path.join(repoRoot, 'play.html'), 'utf8');
} catch (_err) {
  playHtml = null;
}
const gameHtml = await readFile(path.join(repoRoot, 'game.html'), 'utf8');
const gameCatsHtml = await readFile(path.join(repoRoot, 'game_cats.html'), 'utf8');
const gameTrexHtml = await readFile(path.join(repoRoot, 'game_trex.html'), 'utf8');

const rootPages = [
  accountHtml,
  indexHtml,
  gameHtml,
  gameCatsHtml,
  gameTrexHtml,
  favoritesHtml,
  recentlyPlayedHtml,
  aboutEnHtml,
  aboutPlHtml,
  xpHtml,
  playHtml || '',
];

const nestedPages = [
  licensesHtml,
  termsEnHtml,
  termsPlHtml,
  privacyEnHtml,
  privacyPlHtml,
];

test('sidebar model includes required entries', () => {
  assert.match(sidebarModelSource, /id:\s*['"]poker['"]/);
  assert.match(sidebarModelSource, /href:\s*['"]\/poker\//);
  assert.match(sidebarModelSource, /id:\s*['"]favorites['"]/);
  assert.match(sidebarModelSource, /id:\s*['"]recentlyPlayed['"]/);
});

test('sidebar scripts load once per root page', () => {
  const modelScript = /src="js\/core\/sidebar-model\.js"/g;
  const sidebarScript = /src="js\/sidebar\.js"/g;
  rootPages.forEach((content) => {
    if (!content) return;
    assert.equal((content.match(modelScript) || []).length, 1);
    assert.equal((content.match(sidebarScript) || []).length, 1);
    const modelIndex = content.indexOf('js/core/sidebar-model.js');
    const sidebarIndex = content.indexOf('js/sidebar.js');
    assert.ok(modelIndex > -1);
    assert.ok(sidebarIndex > -1);
    assert.ok(modelIndex < sidebarIndex);
  });
});

test('sidebar scripts load once per nested page', () => {
  const modelScript = /src="\/js\/core\/sidebar-model\.js"/g;
  const sidebarScript = /src="\/js\/sidebar\.js"/g;
  const nestedRelative = /src="(?:\.\.\/)?js\/core\/sidebar-model\.js"/;
  nestedPages.forEach((content) => {
    assert.equal((content.match(modelScript) || []).length, 1);
    assert.equal((content.match(sidebarScript) || []).length, 1);
    assert.ok(!nestedRelative.test(content));
    const modelIndex = content.indexOf('/js/core/sidebar-model.js');
    const sidebarIndex = content.indexOf('/js/sidebar.js');
    assert.ok(modelIndex > -1);
    assert.ok(sidebarIndex > -1);
    assert.ok(modelIndex < sidebarIndex);
  });
});

test('sidebar shell exists on all root and nested pages', () => {
  const pages = rootPages.concat(nestedPages);
  pages.forEach((content) => {
    if (!content) return;
    assert.match(content, /id="sbToggle"/);
    assert.match(content, /id="sidebar"/);
  });
});
