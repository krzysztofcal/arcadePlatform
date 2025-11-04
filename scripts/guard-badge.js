#!/usr/bin/env node
const { execSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

function loadConfig() {
  const repoRoot = process.cwd();
  const cfgPath = path.join(repoRoot, 'guard.config.json');
  if (!existsSync(cfgPath)) {
    console.error('❌ guard.config.json not found.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(cfgPath, 'utf8'));
}

function listHtmlFiles(globs) {
  const patterns = Array.isArray(globs) && globs.length
    ? globs
    : ['*.html', '**/*.html'];
  const escaped = patterns
    .map(pattern => `'${pattern.replace(/'/g, "'\\''")}'`)
    .join(' ');
  const output = execSync(`git ls-files ${escaped}`, { encoding: 'utf8' }).trim();
  if (!output) return [];
  const seen = new Set();
  const files = [];
  for (const entry of output.split('\n')) {
    if (!entry) continue;
    const normalized = entry.replace(/\\+/g, '/');
    if (!seen.has(normalized)) {
      seen.add(normalized);
      files.push(normalized);
    }
  }
  return files;
}

function analyze(source, requiredId, requiredClass) {
  const violations = [];
  const anchorRx = /<a\b[^>]*>/gi;
  const classRx = /class\s*=\s*(["'])([^"']*)\1/i;
  const idAttrRx = new RegExp(`\\bid\\s*=\\s*["']${requiredId}["']`, 'i');
  const classTokenRx = new RegExp(`\\b${requiredClass}\\b`);
  const labelIdRx = new RegExp(`<span\\b[^>]*\\bid\\s*=\\s*["']${requiredId}["']`, 'i');
  const idAnyTagRx = new RegExp(`<([a-zA-Z0-9:-]+)\\b[^>]*\\bid\\s*=\\s*["']${requiredId}["'][^>]*>`, 'gi');

  let anchorMatch;
  const xpAnchors = [];
  const anchorsMissingId = [];
  const anchorsWithIdMissingClass = [];

  while ((anchorMatch = anchorRx.exec(source)) !== null) {
    const tag = anchorMatch[0];
    const classMatch = tag.match(classRx);
    const classValue = classMatch ? classMatch[2] : '';
    const hasXpClass = classValue ? classTokenRx.test(classValue) : false;
    const hasId = idAttrRx.test(tag);

    if (hasXpClass) {
      xpAnchors.push({ hasId });
      if (!hasId) {
        anchorsMissingId.push(tag);
      }
    }

    if (hasId && !hasXpClass) {
      anchorsWithIdMissingClass.push(tag);
    }
  }

  const anchorCount = xpAnchors.length;
  if (anchorCount === 0) {
    violations.push('missing xp badge anchor');
  } else if (anchorCount > 1) {
    violations.push('multiple xp badge anchors');
  }

  const anchorsWithId = xpAnchors.filter(a => a.hasId).length;
  if (anchorCount > 0 && anchorsWithId === 0) {
    violations.push('xp badge anchor missing id attribute');
  } else if (anchorsWithId > 1) {
    violations.push('multiple xp badge anchors with id');
  }

  if (anchorsWithIdMissingClass.length) {
    violations.push('id attached to non xp-badge anchor');
  }

  if (labelIdRx.test(source)) {
    violations.push('xp-badge__label carries id');
  }

  let idMatch;
  while ((idMatch = idAnyTagRx.exec(source)) !== null) {
    const tagName = idMatch[1].toLowerCase();
    if (tagName !== 'a') {
      violations.push(`id used on <${tagName}>`);
    }
  }

  return Array.from(new Set(violations));
}

function main() {
  const cfg = loadConfig();
  const requiredId = cfg.badge?.id || 'xpBadge';
  const selector = cfg.badge?.selector || 'a.xp-badge';
  const requiredClass = selector.split('.').pop() || 'xp-badge';

  const files = listHtmlFiles(cfg.badge?.include);
  if (files.length === 0) {
    console.error('❌ No HTML files detected to verify badge discipline.');
    process.exit(1);
  }

  const offenders = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const violations = analyze(source, requiredId, requiredClass);
    if (violations.length) {
      offenders.push({ file, violations });
    }
  }

  if (offenders.length) {
    for (const offender of offenders) {
      console.error(`❌ ${offender.file} — ${offender.violations.join('; ')}`);
    }
    process.exit(1);
  }

  console.log(`✅ Badge id discipline OK across ${files.length} HTML file${files.length === 1 ? '' : 's'}.`);
}

main();
