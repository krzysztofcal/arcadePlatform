import { defineConfig } from '@playwright/test';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;

export default defineConfig({
  // Only run Playwright specs; ignore browser-only *.test.js files
  testMatch: ['tests/**/*.spec.ts'],
  use: {
    baseURL: BASE_URL,
  },
  webServer: {
    command: 'node scripts/static-server.js',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
