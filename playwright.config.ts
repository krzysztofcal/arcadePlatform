import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Only run Playwright specs; ignore browser-only *.test.js files
  testMatch: ['tests/**/*.spec.ts'],
});

