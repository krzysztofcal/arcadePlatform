import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shouldRunPlaywrightForPaths } from '../scripts/should-run-playwright.mjs';

const ciSrc = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
const testsSrc = fs.readFileSync('.github/workflows/tests.yml', 'utf8');
const matrixSrc = fs.readFileSync('.github/workflows/playwright-matrix.yml', 'utf8');

test('workflow policy keeps playwright install --with-deps', () => {
  assert.match(ciSrc, /playwright install --with-deps/);
  assert.match(testsSrc, /playwright install --with-deps/);
  assert.match(matrixSrc, /playwright install --with-deps/);
});

test('tests job gates only Playwright steps on PR paths', () => {
  const detectionStep = testsSrc.match(
    /- name: Detect Playwright-relevant changes[\s\S]*?(?=\n\s+- name:)/,
  )?.[0] || '';
  assert.match(detectionStep, /id: playwright_changes/);
  assert.match(detectionStep, /github\.event_name == 'pull_request'/);
  assert.match(detectionStep, /git fetch --no-tags --depth=1 origin "\$PR_BASE_SHA"/);
  assert.match(detectionStep, /git diff --name-only "\$PR_BASE_SHA" "\$GITHUB_SHA"/);
  assert.match(detectionStep, /node scripts\/should-run-playwright\.mjs --github-output "\$GITHUB_OUTPUT"/);

  const browserStep = (name) => testsSrc.match(
    new RegExp(`- name: ${name}[\\s\\S]*?(?=\\n\\s+- name:|\\s*$)`),
  )?.[0] || '';
  for (const step of [
    browserStep('Install Playwright Browsers'),
    browserStep('Run Playwright tests'),
  ]) {
    assert.match(step, /github\.event_name != 'pull_request'/);
    assert.match(step, /steps\.playwright_changes\.outputs\.required == 'true'/);
  }

  const testsJobStart = testsSrc.indexOf('\n  tests:\n');
  assert.ok(testsJobStart >= 0, 'tests job must exist');
  const testsJobHeader = testsSrc.slice(testsJobStart, testsJobStart + 120);
  assert.doesNotMatch(testsJobHeader, /\n    if:/, 'tests job must not be path-skipped');
  for (const name of [
    'Native JSONB integration test',
    'Action-history cleanup PostgreSQL integration test',
    'Closed-table cleanup PostgreSQL integration test',
    'Validate games catalog',
  ]) {
    const step = browserStep(name);
    assert.ok(step, `integration step must exist: ${name}`);
    assert.doesNotMatch(step, /\n\s+if:/, `${name} must remain unconditional`);
  }
});

test('CI verify gates browser work without skipping structural or unit checks', () => {
  const detectionStep = ciSrc.match(
    /- name: Detect Playwright-relevant changes[\s\S]*?(?=\n\s+- name:)/,
  )?.[0] || '';
  assert.match(detectionStep, /id: playwright_changes/);
  assert.match(detectionStep, /github\.event_name == 'pull_request'/);
  assert.match(detectionStep, /node scripts\/should-run-playwright\.mjs --github-output "\$GITHUB_OUTPUT"/);

  for (const name of ['Install Playwright Browsers', 'Playwright E2E tests']) {
    const step = ciSrc.match(
      new RegExp(`- name: ${name}[\\s\\S]*?(?=\\n\\s+- name:|\\s*$)`),
    )?.[0] || '';
    assert.match(step, /github\.event_name != 'pull_request'/);
    assert.match(step, /steps\.playwright_changes\.outputs\.required == 'true'/);
  }

  for (const name of ['Structural guards', 'Unit checks']) {
    const step = ciSrc.match(
      new RegExp(`- name: ${name}[\\s\\S]*?(?=\\n\\s+- name:|\\s*$)`),
    )?.[0] || '';
    assert.ok(step, `CI step must exist: ${name}`);
    assert.doesNotMatch(step, /\n\s+if:/, `${name} must remain unconditional`);
  }
  const verifyStart = ciSrc.indexOf('\n  verify:\n');
  assert.ok(verifyStart >= 0, 'CI verify job must exist');
  assert.doesNotMatch(ciSrc.slice(verifyStart, verifyStart + 100), /\n    if:/, 'CI verify job must not be path-skipped');
});

test('Playwright path policy fails safe for web/E2E changes and skips non-web-only changes', () => {
  assert.equal(shouldRunPlaywrightForPaths([]), true, 'unknown/empty diff must retain browser coverage');
  assert.equal(shouldRunPlaywrightForPaths([
    '.github/workflows/tests.yml',
    'scripts/ops/chips-ledger-stage-automation.mjs',
    'tests/chips/chips-ledger-stage-cleanup-orchestration.test.mjs',
    'docs/ci-notes.md',
  ]), false);
  assert.equal(shouldRunPlaywrightForPaths(['docs/fixture.html']), false);
  assert.equal(shouldRunPlaywrightForPaths(['README.md']), true, 'unknown paths must retain browser coverage');

  for (const path of [
    'index.html',
    'js/ui/favorite-button.js',
    'poker/table-v2.html',
    'netlify/functions/poker-get-table.mjs',
    'ws-server/poker/handlers/join.mjs',
    'tests/e2e-ui.spec.ts',
    'playwright.config.ts',
    'playwright.config.mjs',
    'package.json',
    'package-lock.json',
    'src/components/Button.tsx',
  ]) {
    assert.equal(shouldRunPlaywrightForPaths([path]), true, `web/E2E path must run Playwright: ${path}`);
  }
});
