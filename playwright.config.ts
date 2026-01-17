import { defineConfig } from '@playwright/test';
import { findSystemChromium } from './scripts/system-browser';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;

const systemChromium = findSystemChromium();

type UseConfig = NonNullable<ReturnType<typeof defineConfig>['use']>;
const baseUseConfig: UseConfig = {
  baseURL: BASE_URL,
};

const requestedBrowser = process.env.PLAYWRIGHT_BROWSER || '';
const allowedBrowsers = new Set(['chromium', 'firefox', 'webkit']);
if (requestedBrowser && !allowedBrowsers.has(requestedBrowser)) {
  throw new Error(
    `Invalid PLAYWRIGHT_BROWSER "${requestedBrowser}". Allowed values: chromium, firefox, webkit.`
  );
}
const chromiumUse: UseConfig = { ...baseUseConfig, browserName: 'chromium' };
if (process.env.PLAYWRIGHT_BROWSER_CHANNEL) {
  chromiumUse.channel = process.env.PLAYWRIGHT_BROWSER_CHANNEL as UseConfig['channel'];
} else if (systemChromium) {
  chromiumUse.launchOptions = {
    executablePath: systemChromium,
  };
}

const resolvedBrowser = requestedBrowser || (systemChromium ? 'chromium' : '');
let useConfig: UseConfig = baseUseConfig;
if (resolvedBrowser) {
  if (resolvedBrowser === 'chromium') {
    useConfig = chromiumUse;
  } else {
    useConfig = { ...baseUseConfig, browserName: resolvedBrowser as UseConfig['browserName'] };
  }
}

const testMatch =
  process.env.CI_NO_E2E === '1'
    ? []
    : ['tests/**/*.spec.ts', 'tests/**/*.spec.js'];

if (process.env.CI_NO_E2E === '1') {
  console.warn('ℹ️  Playwright tests skipped: CI_NO_E2E=1');
}

export default defineConfig({
  // Only run Playwright specs; ignore browser-only *.test.js files
  testMatch,
  use: useConfig,
  webServer: {
    // Integrated test server serves static assets, security headers, and Netlify functions
    command: 'node scripts/test-server.js',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      XP_DAILY_SECRET: 'test-secret-for-sessions-32chars!',
      XP_DEBUG: '1',
      // Enable CORS whitelist for security testing
      XP_CORS_ALLOW: 'http://localhost:8888,https://example.netlify.app',
    },
  },
});
