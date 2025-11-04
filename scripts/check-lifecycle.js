#!/usr/bin/env node
const fs = require('fs');
const fg = require('fast-glob');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync('guard.config.json', 'utf8'));
const allowed = new Set(cfg.lifecycle.allowedFiles);
const allowToken = cfg.lifecycle.allowToken;
const strict = process.env.STRICT_GUARDS === '1';

const JS_GLOBS = ['**/*.js', '**/*.html', '!node_modules/**', '!.git/**'];

const RX = {
  // raw lifecycle hooks that must be centralized
  pagehide: /addEventListener\(['"]pagehide['"]/, 
  beforeunload: /addEventListener\(['"]beforeunload['"]/, 
  pageshow: /addEventListener\(['"]pageshow['"]/, 
  visibility: /addEventListener\(['"]visibilitychange['"]/, 
  // direct XP control calls (should be centralized too)
  xpStart: /XP\s*\.\s*startSession\s*\(/,
  xpStop: /XP\s*\.\s*stopSession\s*\(/,
  xpResume: /XP\s*\.\s*resumeSession\s*\(/
};

let failed = false;
const files = fg.sync(JS_GLOBS, { dot: false });

function isAllowed(file) {
  // exact match on forward slashes
  const norm = file.split(path.sep).join('/');
  return allowed.has(norm);
}
function hasAllowComment(src) {
  return src.includes(allowToken);
}

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const isHtml = f.endsWith('.html');

  // We only flag if outside allowed files AND no allow token
  const hits = [];
  for (const [key, rx] of Object.entries(RX)) {
    if (rx.test(src)) hits.push(key);
  }
  if (!hits.length) continue;

  if (!isAllowed(f) && !hasAllowComment(src)) {
    failed = true;
    console.error(
      `[lifecycle] ${f}: found ${hits.join(', ')} outside ${[...allowed].join(', ')}. ` +
      `Centralize in js/xp.js or add '/* ${allowToken} <ticket> */' (temporary, reviewed).`
    );
    // Optional: print offending lines
    const lines = src.split('\n');
    hits.forEach(key => {
      const rx = RX[key];
      lines.forEach((line, i) => {
        if (rx.test(line)) console.error(`  ${String(i + 1).padStart(4)} | ${line.trim()}`);
      });
    });
  }
}

if (failed && strict) process.exit(1);
if (failed && !strict) {
  console.warn('[guard] Lifecycle violations found (non-blocking). Set STRICT_GUARDS=1 to enforce.');
}
