#!/usr/bin/env node
const fs = require('fs');
const fg = require('fast-glob');
const path = require('path');

const cfgPath = path.resolve(process.cwd(), 'guard.config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const allowed = new Set(cfg.lifecycle.allowedFiles);
const allowToken = cfg.lifecycle.allowToken;
const strict = process.env.STRICT_GUARDS === '1';

const JS_GLOBS = ['**/*.js', '**/*.html', '!node_modules/**', '!.git/**'];

const RX = {
  // raw lifecycle hooks that must be centralized
  pagehide: /addEventListener\(['"]pagehide['"][^)]*\)/,
  beforeunload: /addEventListener\(['"]beforeunload['"][^)]*\)/,
  pageshow: /addEventListener\(['"]pageshow['"][^)]*\)/,
  visibility: /addEventListener\(['"]visibilitychange['"][^)]*\)/,
  // direct XP control calls (should be centralized too)
  xpStart: /XP\s*\.\s*startSession\s*\(/,
  xpStop: /XP\s*\.\s*stopSession\s*\(/,
  xpResume: /XP\s*\.\s*resumeSession\s*\(/,
};

const LINE_RX = {
  pagehide: /addEventListener\(['"]pagehide['"]/,
  beforeunload: /addEventListener\(['"]beforeunload['"]/,
  pageshow: /addEventListener\(['"]pageshow['"]/,
  visibility: /addEventListener\(['"]visibilitychange['"]/,
  xpStart: /XP\s*\.\s*startSession\s*\(/,
  xpStop: /XP\s*\.\s*stopSession\s*\(/,
  xpResume: /XP\s*\.\s*resumeSession\s*\(/,
};

let failed = false;
const files = fg.sync(JS_GLOBS, { dot: false });

function isAllowed(file) {
  // exact match on forward slashes
  const norm = file.split(path.sep).join('/');
  return allowed.has(norm);
}

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');

  const matches = [];
  for (const [key, rx] of Object.entries(RX)) {
    if (!rx.test(src)) continue;

    const detail = { key, lines: [] };
    const lineRx = LINE_RX[key];

    lines.forEach((line, i) => {
      if (lineRx.test(line)) {
        detail.lines.push({ index: i + 1, text: line });
      }
    });

    if (!detail.lines.length) {
      const match = src.match(rx);
      if (match && typeof match.index === 'number') {
        const leading = src.slice(0, match.index);
        const lineNumber = leading.split('\n').length;
        detail.lines.push({
          index: lineNumber,
          text: lines[lineNumber - 1] ?? match[0],
        });
      }
    }

    matches.push(detail);
  }

  if (!matches.length) continue;
  if (isAllowed(f)) continue;

  const actionable = matches
    .map(match => ({
      key: match.key,
      lines: match.lines.filter(line => !line.text.includes(allowToken)),
    }))
    .filter(match => match.lines.length);

  if (!actionable.length) continue;

  failed = true;
  const summary = actionable.map(match => match.key).join(', ');
  console.error(
    `[lifecycle] ${f}: found ${summary} outside ${[...allowed].join(', ')}. ` +
    `Centralize in js/xp.js or add '/* ${allowToken} <ticket> */' (temporary, reviewed).`
  );

  actionable.forEach(match => {
    match.lines.forEach(line => {
      console.error(`  ${String(line.index).padStart(4)} | ${line.text.trim()}`);
    });
  });
}

if (failed && strict) process.exit(1);
if (failed && !strict) {
  console.warn('[guard] Lifecycle violations found (non-blocking). Set STRICT_GUARDS=1 to enforce.');
}
