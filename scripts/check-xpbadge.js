#!/usr/bin/env node
/* Ensures:
 *  - pages with an <a ... class="...xp-badge..."> element give exactly one configured badge id
 *  - no <span ... class="xp-badge__label"> shares that id
 */
const { execSync } = require('child_process');
const { readFileSync } = require('fs');
const path = require('path');

function gitList(patterns) {
  const cmd = 'git ls-files ' + patterns.map(p => `"${p}"`).join(' ');
  return execSync(cmd, { encoding: 'utf8' })
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const cfgPath = path.resolve(process.cwd(), 'guard.config.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const requiredId = cfg.badge?.id || 'xpBadge';
const badgeSelector = cfg.badge?.selector || 'a.xp-badge';
const classToken = badgeSelector.split('.').pop();
const classPattern = classToken
  ? new RegExp(`<a\\b[^>]*class="[^"]*\\b${escapeRegex(classToken)}\\b[^"]*"[^>]*>`, 'gi')
  : /<a\b[^>]*class="[^"]*\bxp-badge\b[^"]*"[^>]*>/gi;
const strict = process.env.STRICT_GUARDS === '1';

const htmlFiles = gitList(['*.html', '**/*.html']);

let bad = false;
for (const f of htmlFiles) {
  const s = readFileSync(f, 'utf8');

  const anchors = [...s.matchAll(classPattern)].map(m => m[0]);
  if (anchors.length === 0) {
    continue;
  }

  const idPattern = new RegExp(`\\bid\\s*=\\s*"${escapeRegex(requiredId)}"`, 'i');
  const withId = anchors.filter(a => idPattern.test(a));
  const labelHasId = new RegExp(
    `<span\\b[^>]*class="[^"]*\\bxp-badge__label\\b[^"]*"[^>]*\\bid\\s*=\\s*"${escapeRegex(requiredId)}"`,
    'i'
  ).test(s);

  if (withId.length !== 1) {
    console.error(`❌ ${f}: expected exactly 1 ${badgeSelector} with id="${requiredId}" (found ${withId.length})`);
    bad = true;
  }
  if (labelHasId) {
    console.error(`❌ ${f}: xp-badge__label must NOT carry id="${requiredId}"`);
    bad = true;
  }
}

if (bad && strict) process.exit(1);
if (bad && !strict) {
  console.warn('[guard] Badge violations found (non-blocking). Set STRICT_GUARDS=1 to enforce.');
} else if (!bad) {
  console.log('✅ xpBadge guard passed');
}
