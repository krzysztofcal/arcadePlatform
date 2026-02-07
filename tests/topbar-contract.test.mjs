import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');

const topbarSource = await readFile(path.join(repoRoot, 'js', 'topbar.js'), 'utf8');
const xpCoreSource = await readFile(path.join(repoRoot, 'js', 'xp', 'core.js'), 'utf8');
const formatSource = await readFile(path.join(repoRoot, 'js', 'core', 'number-format.js'), 'utf8');
const accountHtml = await readFile(path.join(repoRoot, 'account.html'), 'utf8');
const favoritesHtml = await readFile(path.join(repoRoot, 'favorites.html'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const recentlyPlayedHtml = await readFile(path.join(repoRoot, 'recently-played.html'), 'utf8');
const aboutEnHtml = await readFile(path.join(repoRoot, 'about.en.html'), 'utf8');
const aboutPlHtml = await readFile(path.join(repoRoot, 'about.pl.html'), 'utf8');
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
const pokerIndex = await readFile(path.join(repoRoot, 'poker', 'index.html'), 'utf8');
const pokerTable = await readFile(path.join(repoRoot, 'poker', 'table.html'), 'utf8');
const portalCss = await readFile(path.join(repoRoot, 'css', 'portal.css'), 'utf8');
const gameCss = await readFile(path.join(repoRoot, 'css', 'game.css'), 'utf8');
const xpHtmlFiles = [
  accountHtml,
  indexHtml,
  gameHtml,
  gameTrexHtml,
  pokerIndex,
  pokerTable,
  playHtml || '',
  xpHtml,
];

test('topbar ensures chip badge creation when missing', () => {
  assert.match(topbarSource, /CHIP_BADGE_HREF\s*=\s*['"]\/account\.html#chipPanel['"]/);
  assert.match(topbarSource, /ensureChipBadge/);
  assert.match(topbarSource, /badge\.id\s*=\s*['"]chipBadge['"]/);
  assert.match(topbarSource, /amount\.id\s*=\s*['"]chipBadgeAmount['"]/);
  assert.match(topbarSource, /badge\.hidden\s*=\s*true/);
  assert.match(topbarSource, /if\s*\(!isAuthed\(\)\)/);
  assert.match(topbarSource, /CH:\s/);
  assert.ok(!topbarSource.includes('options.show'));
  assert.ok(!topbarSource.includes('_user || _session'));
  assert.ok(!topbarSource.includes('ensureChipsClientLoaded'));
  assert.ok(!topbarSource.includes('chipsClientScript'));
  assert.match(topbarSource, /setAuthDataset\(['"]out['"]\)/);
  assert.match(topbarSource, /badge\.hidden\s*=\s*!isAuthed\(\)/);
  assert.match(topbarSource, /__topbarBooted/);
  assert.ok(!topbarSource.includes('suffix'));
});

test('topbar pages load topbar script', () => {
  const topbarScript = /\/?js\/topbar\.js/;
  assert.match(indexHtml, topbarScript);
  assert.match(accountHtml, topbarScript);
  if (playHtml) assert.match(playHtml, topbarScript);
  assert.match(gameHtml, topbarScript);
  assert.match(gameTrexHtml, topbarScript);
  assert.match(pokerIndex, topbarScript);
  assert.match(pokerTable, topbarScript);
});

test('root pages use relative topbar and format scripts', () => {
  const relativeTopbar = /src="js\/topbar\.js"/;
  const relativeFormat = /src="js\/core\/number-format\.js"/;
  const relativeChips = /src="js\/chips\/client\.js"/;
  const absoluteTopbar = /src="\/js\/topbar\.js"/;
  const absoluteFormat = /src="\/js\/core\/number-format\.js"/;
  const absoluteChips = /src="\/js\/chips\/client\.js"/;
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
  rootPages.forEach((content) => {
    if (!content) return;
    assert.match(content, relativeTopbar);
    assert.match(content, relativeFormat);
    assert.match(content, relativeChips);
    assert.ok(!absoluteTopbar.test(content));
    assert.ok(!absoluteFormat.test(content));
    assert.ok(!absoluteChips.test(content));
  });
  assert.match(accountHtml, /src="js\/chips\/client\.js"/);
  assert.match(pokerIndex, absoluteTopbar);
  assert.match(pokerTable, absoluteTopbar);
  assert.match(pokerIndex, absoluteFormat);
  assert.match(pokerTable, absoluteFormat);
  assert.match(pokerIndex, absoluteChips);
  assert.match(pokerTable, absoluteChips);
});

test('topbar scripts load once per page', () => {
  const scripts = [
    /src="js\/topbar\.js"/g,
    /src="js\/core\/number-format\.js"/g,
    /src="js\/chips\/client\.js"/g,
  ];
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
  rootPages.forEach((content) => {
    if (!content) return;
    scripts.forEach((pattern) => {
      const matches = content.match(pattern) || [];
      assert.equal(matches.length, 1);
    });
  });
  const pokerScripts = [
    /src="\/js\/topbar\.js"/g,
    /src="\/js\/core\/number-format\.js"/g,
    /src="\/js\/chips\/client\.js"/g,
  ];
  [pokerIndex, pokerTable].forEach((content) => {
    pokerScripts.forEach((pattern) => {
      const matches = content.match(pattern) || [];
      assert.equal(matches.length, 1);
    });
  });
});

test('chip badge is only provided by topbar', () => {
  assert.ok(!accountHtml.includes('id="chipBadge"'));
});

test('chip badge styles only live in portal css', () => {
  assert.match(portalCss, /\.chip-pill/);
  assert.match(portalCss, /--topbar-offset/);
  assert.match(portalCss, /safe-area-inset-top/);
  assert.match(portalCss, /html\[data-auth="in"\]\s*#chipBadge/);
  assert.match(portalCss, /html\[data-auth="out"\]\s*#chipBadge/);
  assert.ok(!gameCss.includes('.chip-pill'));
});

test('game pages load portal css for topbar styles', () => {
  assert.match(gameHtml, /css\/portal\.css/);
  assert.match(gameCatsHtml, /css\/portal\.css/);
  assert.match(gameTrexHtml, /css\/portal\.css/);
  if (playHtml) assert.match(playHtml, /css\/portal\.css/);
});

test('compact number formatting helpers exist', () => {
  assert.match(topbarSource, /ArcadeFormat/);
  assert.match(formatSource, /formatCompactNumber/);
  assert.ok(!topbarSource.includes('formatCompactNumber'));
  assert.ok(!xpCoreSource.includes('formatCompactNumber'));
});

test('xp badge placeholders are compact', () => {
  xpHtmlFiles.forEach((content) => {
    if (!content) return;
    assert.ok(!content.includes('Syncing XP'));
    assert.match(content, /xp-badge__label[^>]*>\s*XP\s*</);
  });
});

test('poker pages place xp badge inside topbar', () => {
  assert.match(pokerIndex, /topbar-right[\s\S]*id="xpBadge"/);
  assert.match(pokerTable, /topbar-right[\s\S]*id="xpBadge"/);
});
