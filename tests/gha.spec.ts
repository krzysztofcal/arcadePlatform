import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test('browser tests page reports zero failures', async ({ page }) => {
  const abs = path.resolve(__dirname, 'index.html');
  expect(fs.existsSync(abs)).toBeTruthy();
  await page.goto('file://' + abs);
  await page.waitForSelector('#test-output');
  const summary = await page.locator('#test-output > :nth-child(1)').innerText();
  // Summary format: "Passed: X, Failed: Y"
  expect(summary).toMatch(/Passed: \d+, Failed: 0/);
});

