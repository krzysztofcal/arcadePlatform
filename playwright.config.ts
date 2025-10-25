import { defineConfig } from '@playwright/test';
import { findSystemChromium } from './scripts/system-browser';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;

const systemChromium = findSystemChromium();

type UseConfig = NonNullable<ReturnType<typeof defineConfig>['use']>;
const useConfig: UseConfig = {
  baseURL: BASE_URL,
};

if (process.env.PLAYWRIGHT_BROWSER_CHANNEL) {
  useConfig.channel = process.env.PLAYWRIGHT_BROWSER_CHANNEL as UseConfig['channel'];
} else if (systemChromium) {
  useConfig.browserName = 'chromium';
  useConfig.launchOptions = {
    executablePath: systemChromium,
  };
}

export default defineConfig({
  // Only run Playwright specs; ignore browser-only *.test.js files
  testMatch: ['tests/**/*.spec.ts'],
  use: useConfig,
  webServer: {
    command: 'node scripts/static-server.js',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
