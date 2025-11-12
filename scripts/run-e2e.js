#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

function resolvePlaywrightCli() {
  const candidates = ['@playwright/test', 'playwright'];
  for (const pkg of candidates) {
    try {
      const pkgPath = require.resolve(`${pkg}/package.json`);
      return {
        packageName: pkg,
        cliPath: path.join(path.dirname(pkgPath), 'cli.js'),
      };
    } catch (err) {
      if (err && err.code !== 'MODULE_NOT_FOUND') {
        throw err;
      }
    }
  }
  return null;
}

const resolvedCli = resolvePlaywrightCli();
if (!resolvedCli) {
  console.warn('⚠️  Playwright tests skipped: no Playwright package is installed.');
  console.warn('    Install @playwright/test (or playwright) to enable the smoke suite.');
  process.exit(0);
}

const { cliPath } = resolvedCli;
const skipFile = path.resolve(__dirname, '../.cache/skip-playwright-tests');

if (process.env.CI_NO_E2E === '1') {
  console.warn('ℹ️  Playwright tests skipped: CI_NO_E2E=1');
  process.exit(0);
}

if (existsSync(skipFile)) {
  const message = readFileSync(skipFile, 'utf8').trim();
  console.warn('⚠️  Playwright tests skipped:');
  if (message) {
    console.warn(`    ${message}`);
  }
  console.warn('    Install a Chromium-based browser or allow Playwright downloads to enable the suite.');
  process.exit(0);
}

const childEnv = { ...process.env };

if (!childEnv.XP_DAILY_SECRET) {
  childEnv.XP_DAILY_SECRET = 'test-secret';
}

if (!childEnv.XP_DEBUG) {
  childEnv.XP_DEBUG = '1';
}

const result = spawnSync(process.execPath, [cliPath, 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: childEnv,
});

process.exit(result.status ?? 1);
