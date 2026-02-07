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
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
let playHtml = null;
try {
  playHtml = await readFile(path.join(repoRoot, 'play.html'), 'utf8');
} catch (_err) {
  playHtml = null;
}
const gameHtml = await readFile(path.join(repoRoot, 'game.html'), 'utf8');
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
];

test('topbar ensures chip badge creation when missing', () => {
  assert.match(topbarSource, /CHIP_BADGE_HREF\s*=\s*['"]\/account\.html#chipPanel['"]/);
  assert.match(topbarSource, /ensureChipBadge/);
  assert.match(topbarSource, /badge\.id\s*=\s*['"]chipBadge['"]/);
  assert.match(topbarSource, /amount\.id\s*=\s*['"]chipBadgeAmount['"]/);
  assert.match(topbarSource, /badge\.hidden\s*=\s*true/);
  assert.match(topbarSource, /if\s*\(!isSignedIn\)/);
  assert.match(topbarSource, /CH:\s/);
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

test('chip badge is only provided by topbar', () => {
  assert.ok(!accountHtml.includes('id="chipBadge"'));
});

test('chip badge styles only live in portal css', () => {
  assert.match(portalCss, /\.chip-pill/);
  assert.match(portalCss, /--topbar-offset/);
  assert.match(portalCss, /safe-area-inset-top/);
  assert.ok(!gameCss.includes('.chip-pill'));
});

test('game pages load portal css for topbar styles', () => {
  assert.match(gameHtml, /css\/portal\.css/);
  assert.match(gameTrexHtml, /css\/portal\.css/);
});

test('compact number formatting helpers exist', () => {
  assert.match(topbarSource, /ArcadeFormat/);
  assert.match(formatSource, /formatCompactNumber/);
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
