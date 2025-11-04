#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const playwrightPackagePath = require.resolve('playwright/package.json');
const cliPath = path.join(path.dirname(playwrightPackagePath), 'cli.js');
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

const result = spawnSync(process.execPath, [cliPath, 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
