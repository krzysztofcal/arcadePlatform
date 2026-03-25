import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ciSrc = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
const testsSrc = fs.readFileSync('.github/workflows/tests.yml', 'utf8');
const matrixSrc = fs.readFileSync('.github/workflows/playwright-matrix.yml', 'utf8');

test('workflow policy keeps playwright install --with-deps', () => {
  assert.match(ciSrc, /playwright install --with-deps/);
  assert.match(testsSrc, /playwright install --with-deps/);
  assert.match(matrixSrc, /playwright install --with-deps/);
});
