#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, unlinkSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { findSystemChromium } = require('./system-browser');

const playwrightPackagePath = require.resolve('playwright/package.json');
const cliPath = path.join(path.dirname(playwrightPackagePath), 'cli.js');
const skipFile = path.resolve(__dirname, '../.cache/skip-playwright-tests');

function ensureCacheDir() {
  const dir = path.dirname(skipFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function clearSkipMarker() {
  if (existsSync(skipFile)) {
    unlinkSync(skipFile);
  }
}

function markSkip(reason) {
  ensureCacheDir();
  writeFileSync(skipFile, `${reason}\n`, 'utf8');
}

function shouldAttemptDownload() {
  return process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD !== '1' &&
    process.env.PW_SKIP_BROWSER_DOWNLOAD !== '1';
}

if (shouldAttemptDownload()) {
  const installResult = spawnSync(process.execPath, [cliPath, 'install'], {
    stdio: 'inherit',
    env: process.env,
  });

  if ((installResult.status ?? 0) === 0) {
    clearSkipMarker();
    process.exit(0);
  }

  console.warn('\n⚠️  Playwright browser download failed; checking for a system Chromium build.');
}

const systemChromium = findSystemChromium();
if (systemChromium) {
  clearSkipMarker();
  console.warn(`ℹ️  Using system Chromium at: ${systemChromium}`);
  process.exit(0);
}

markSkip('No Playwright-managed browsers could be installed and no system Chromium binary was found.');
console.warn('⚠️  Skipping Playwright browser installation: no browser binary is available.');
console.warn('    Install Google Chrome/Chromium and set CHROME_BIN, or make Playwright downloads accessible to run the E2E suite.');
process.exit(0);
