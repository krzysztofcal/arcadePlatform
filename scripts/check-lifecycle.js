#!/usr/bin/env node
const { execSync } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const path = require('path');

const repoRoot = process.cwd();

function toRelative(file) {
  const abs = path.isAbsolute(file) ? file : path.resolve(repoRoot, file);
  return path.relative(repoRoot, abs).split(path.sep).join('/');
}

function gitList(patterns) {
  const cmd = 'git ls-files ' + patterns.map(p => `"${p}"`).join(' ');
  return execSync(cmd, { encoding: 'utf8' })
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

const args = process.argv.slice(2);
let fileArgs = [];
let fixRequested = false;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--fix') {
    fixRequested = true;
    continue;
  }
  if (arg === '--files') {
    for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j += 1) {
      fileArgs.push(args[j]);
      i = j;
    }
    continue;
  }
}

if (fixRequested) {
  console.warn('ℹ️  --fix has no effect for lifecycle checks (report-only).');
}

const cfgPath = path.resolve(repoRoot, 'guard.config.json');
if (!existsSync(cfgPath)) {
  console.error('Lifecycle guard: guard.config.json not found.');
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const allowedFiles = new Set(
  (cfg.lifecycle?.allowedFiles || ['js/xp.js']).map(f => f.split(path.sep).join('/'))
);
const waiverToken = cfg.lifecycle?.waiverToken || 'xp-lifecycle-allow';
const strict = process.env.STRICT_GUARDS === '1';

const events = [
  { event: 'pageshow', target: 'window' },
  { event: 'pagehide', target: 'window' },
  { event: 'beforeunload', target: 'window' },
  { event: 'visibilitychange', target: 'document' }
];
const expectedTargets = events.reduce((acc, entry) => {
  acc[entry.event] = entry.target;
  return acc;
}, {});

const EVENT_RX = /(?:\b([A-Za-z0-9_$\.\[\]]+)\s*\.\s*)?addEventListener\s*\(\s*['"](pageshow|pagehide|beforeunload|visibilitychange)['"]/gi;
const LINE_SPLIT_RX = /\r?\n/;
const WAIVER_RX = new RegExp(
  `${waiverToken}\s*:\\s*([a-z0-9_-]+)\\(\\s*(\\d{4}-\\d{2}-\\d{2})\\s*\\)`,
  'i'
);

const filesToInspect = (() => {
  if (fileArgs.length) {
    return Array.from(
      new Set(
        fileArgs
          .map(toRelative)
          .filter(f => f.endsWith('.js') || f.endsWith('.html'))
      )
    );
  }
  return Array.from(
    new Set([
      ...gitList(['*.js', '**/*.js']),
      ...gitList(['*.html', '**/*.html'])
    ])
  );
})();

let violations = [];
let waiverWarnings = [];
let scannedFiles = 0;

for (const relativePath of filesToInspect) {
  const filePath = path.resolve(repoRoot, relativePath);
  if (!existsSync(filePath)) continue;
  if (!relativePath.endsWith('.js') && !relativePath.endsWith('.html')) continue;

  const source = readFileSync(filePath, 'utf8');
  scannedFiles += 1;

  const matches = [];
  let match;
  while ((match = EVENT_RX.exec(source)) !== null) {
    const target = match[1] ? match[1].replace(/\s+/g, '') : null;
    const event = match[2];
    const index = match.index;
    const preceding = source.slice(0, index);
    const lineNumber = preceding.split(LINE_SPLIT_RX).length;
    const lines = source.split(LINE_SPLIT_RX);
    const lineText = lines[lineNumber - 1] || '';

    matches.push({
      target,
      event,
      lineNumber,
      lineText
    });
  }

  if (!matches.length) continue;

  const normPath = relativePath.split(path.sep).join('/');
  const fileAllowed = allowedFiles.has(normPath);

  for (const info of matches) {
    const waiverMatch = info.lineText.match(WAIVER_RX);
    if (waiverMatch) {
      const [, label, expiry] = waiverMatch;
      waiverWarnings.push({
        file: normPath,
        line: info.lineNumber,
        label,
        expiry
      });
      continue;
    }

    const expectedTarget = expectedTargets[info.event];
    const normalizedTarget = info.target ? info.target.replace(/\s+/g, '') : null;

    if (!fileAllowed) {
      violations.push({
        file: normPath,
        line: info.lineNumber,
        message: `${info.event} listener outside ${Array.from(allowedFiles).join(', ')}`
      });
      continue;
    }

    if (!normalizedTarget || normalizedTarget.toLowerCase() !== expectedTarget) {
      violations.push({
        file: normPath,
        line: info.lineNumber,
        message: `${info.event} listener must use ${expectedTarget}.addEventListener`
      });
    }
  }
}

if (violations.length) {
  for (const v of violations) {
    console.error(`❌ ${v.file}:${v.line} — ${v.message}`);
  }
}

if (waiverWarnings.length) {
  for (const waiver of waiverWarnings) {
    console.warn(`⚠️  Waiver in ${waiver.file}:${waiver.line} — ${waiverToken}:${waiver.label} (expires ${waiver.expiry})`);
  }
}

const summaryParts = [];
if (violations.length) {
  summaryParts.push(`Lifecycle: ${violations.length} violation${violations.length === 1 ? '' : 's'}`);
  if (violations.length) {
    const sample = violations[0];
    summaryParts[0] += ` (${sample.file}:${sample.line})`;
  }
} else {
  summaryParts.push(`Lifecycle: OK (${scannedFiles} file${scannedFiles === 1 ? '' : 's'} checked)`);
}

console.log(summaryParts.join(' '));

if (violations.length) {
  if (strict) {
    process.exit(1);
  } else {
    process.exitCode = 1;
  }
}
