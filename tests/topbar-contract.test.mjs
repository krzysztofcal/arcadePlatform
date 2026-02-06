import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');

const topbarSource = await readFile(path.join(repoRoot, 'js', 'topbar.js'), 'utf8');
const pokerIndex = await readFile(path.join(repoRoot, 'poker', 'index.html'), 'utf8');
const pokerTable = await readFile(path.join(repoRoot, 'poker', 'table.html'), 'utf8');

test('topbar ensures chip badge creation when missing', () => {
  assert.match(topbarSource, /ensureChipBadge/);
  assert.match(topbarSource, /chipBadgeAmount/);
  assert.match(topbarSource, /createElement\(['"][a-z]+['"]\)/);
});

test('poker pages load topbar script', () => {
  assert.match(pokerIndex, /\/js\/topbar\.js/);
  assert.match(pokerTable, /\/js\/topbar\.js/);
});
