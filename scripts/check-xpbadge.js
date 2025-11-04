#!/usr/bin/env node
/*
 * Ensures each HTML file exposes exactly one XP badge anchor:
 *   <a id="xpBadge" class*="xp-badge">…</a>
 * The script can auto-fix single-anchor issues with --fix.
 */
const { execSync } = require('child_process');
const { existsSync, readFileSync, writeFileSync } = require('fs');
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

function getAttr(tag, attr) {
  const rx = new RegExp(`${attr}\\s*=\\s*(["'])(.*?)\\1`, 'i');
  const match = tag.match(rx);
  return match ? match[2] : null;
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

const cfgPath = path.resolve(repoRoot, 'guard.config.json');
if (!existsSync(cfgPath)) {
  console.error('Badge guard: guard.config.json not found.');
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const requiredId = cfg.badge?.id || 'xpBadge';
const requiredClass = (cfg.badge?.selector || 'a.xp-badge').split('.').pop() || 'xp-badge';
const strict = process.env.STRICT_GUARDS === '1';

const filesToInspect = (() => {
  if (fileArgs.length) {
    return Array.from(new Set(fileArgs.map(toRelative).filter(f => f.endsWith('.html'))));
  }
  return gitList(['*.html', '**/*.html']);
})();

function analyze(source) {
  const idRx = new RegExp(`<([a-zA-Z0-9:-]+)\\b[^>]*\\bid\\s*=\\s*["']${requiredId}["'][^>]*>`, 'gi');
  const anchorRx = /<a\b[^>]*>/gi;
  const labelIdRx = new RegExp(`<span\\b[^>]*class="[^"]*\\bxp-badge__label\\b[^"]*"[^>]*\\bid\\s*=\\s*["']${requiredId}["']`, 'i');

  const idMatches = [];
  let idMatch;
  while ((idMatch = idRx.exec(source)) !== null) {
    const tagName = idMatch[1].toLowerCase();
    const tag = idMatch[0];
    const classValue = getAttr(tag, 'class');
    const hasClass = classValue ? /\bxp-badge\b/.test(classValue) : false;
    idMatches.push({ tagName, hasClass });
  }

  const xpAnchors = [];
  let anchorMatch;
  const classPattern = new RegExp(`\\b${requiredClass}\\b`);
  const idPattern = new RegExp(`\\bid\\s*=\\s*["']${requiredId}["']`, 'i');

  while ((anchorMatch = anchorRx.exec(source)) !== null) {
    const tag = anchorMatch[0];
    const classValue = getAttr(tag, 'class');
    if (!classValue || !classPattern.test(classValue)) continue;
    const hasId = idPattern.test(tag);
    xpAnchors.push({ tag, hasId, index: anchorMatch.index, length: tag.length });
  }

  const labelHasId = labelIdRx.test(source);

  const violations = [];
  if (!xpAnchors.length) {
    violations.push('missing xp badge anchor');
  } else if (xpAnchors.length > 1) {
    violations.push('multiple xp badge anchors');
  }
  const anchorsWithId = xpAnchors.filter(a => a.hasId);
  if (anchorsWithId.length > 1) {
    violations.push('multiple xp badge anchors with id');
  } else if (xpAnchors.length && anchorsWithId.length === 0) {
    violations.push('xp badge anchor missing id attribute');
  }

  for (const entry of idMatches) {
    if (entry.tagName !== 'a') {
      violations.push(`id used on <${entry.tagName}>`);
    } else if (!entry.hasClass) {
      violations.push('xp badge anchor missing xp-badge class');
    }
  }

  if (labelHasId) {
    violations.push('xp-badge__label carries id');
  }

  return { xpAnchors, anchorsWithId, labelHasId, violations };
}

let violations = [];
let fixedFiles = [];
let scanned = 0;

for (const relativePath of filesToInspect) {
  const filePath = path.resolve(repoRoot, relativePath);
  if (!existsSync(filePath)) continue;
  if (!relativePath.endsWith('.html')) continue;

  let source = readFileSync(filePath, 'utf8');
  scanned += 1;

  let report = analyze(source);

  if (fixRequested && report.violations.length) {
    let mutated = source;
    let mutatedFlag = false;

    if (report.labelHasId) {
      const cleanRx = new RegExp(`(<span\\b[^>]*class="[^"]*\\bxp-badge__label\\b[^"]*"[^>]*?)\\s+id\\s*=\\s*["']${requiredId}["']`, 'gi');
      const updated = mutated.replace(cleanRx, '$1');
      if (updated !== mutated) {
        mutated = updated;
        mutatedFlag = true;
      }
    }

    if (report.xpAnchors.length === 1 && report.anchorsWithId.length === 0) {
      const anchor = report.xpAnchors[0];
      const replacement = anchor.tag.replace(/<a\b/i, `<a id="${requiredId}"`);
      mutated =
        mutated.slice(0, anchor.index) +
        replacement +
        mutated.slice(anchor.index + anchor.length);
      mutatedFlag = true;
    }

    if (mutatedFlag) {
      writeFileSync(filePath, mutated, 'utf8');
      fixedFiles.push(relativePath.split(path.sep).join('/'));
      source = mutated;
      report = analyze(source);
    }
  }

  if (report.violations.length) {
    violations.push({
      file: relativePath.split(path.sep).join('/'),
      reasons: Array.from(new Set(report.violations))
    });
  }
}

if (violations.length) {
  for (const v of violations) {
    console.error(`❌ ${v.file} — ${v.reasons.join('; ')}`);
  }
}

if (fixedFiles.length) {
  for (const file of fixedFiles) {
    console.log(`🛠️  Applied badge fixes to ${file}`);
  }
}

if (!violations.length) {
  console.log(`Badge: OK (${scanned} page${scanned === 1 ? '' : 's'})`);
} else {
  const sample = violations[0];
  console.log(`Badge: ${violations.length} violation${violations.length === 1 ? '' : 's'} (${sample.file})`);
}

if (violations.length) {
  if (strict) {
    process.exit(1);
  } else {
    process.exitCode = 1;
  }
}
