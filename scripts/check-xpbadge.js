#!/usr/bin/env node
const fs = require('fs');
const fg = require('fast-glob');
const cheerio = require('cheerio');

const cfg = JSON.parse(fs.readFileSync('guard.config.json', 'utf8'));
const strict = process.env.STRICT_GUARDS === '1';

const HTML_GLOBS = [
  '**/*.html',
  '!node_modules/**',
  '!.git/**',
  // ignore external vendor demos if any:
  '!games-open/**' // remove this line if those pages should also comply
];

let failed = false;
const files = fg.sync(HTML_GLOBS, { dot: false });

for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const $ = cheerio.load(html);

  const badgeSel = cfg.badge.selector;         // 'a.xp-badge'
  const requiredId = cfg.badge.id;             // 'xpBadge'

  const nodes = $(badgeSel);
  if (nodes.length === 0) {
    // Not every page must have the badge; skip silently
    continue;
  }
  if (nodes.length > 1) {
    failed = true;
    console.error(`[xp-badge] ${f}: expected exactly 1 '${badgeSel}', found ${nodes.length}.`);
    continue;
  }
  const node = nodes.first();
  const id = node.attr('id');

  if (id !== requiredId) {
    failed = true;
    console.error(
      `[xp-badge] ${f}: badge must have id="${requiredId}". Found id="${id ?? '<none>'}".`
    );
  }
}

if (failed && strict) process.exit(1);
if (failed && !strict) {
  console.warn('[guard] Badge violations found (non-blocking). Set STRICT_GUARDS=1 to enforce.');
}
