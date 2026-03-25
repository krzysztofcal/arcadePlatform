import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync('netlify/functions/_shared/poker-request-id.mjs', 'utf8');

test('requestId helper keeps non-heartbeat validation behavior', () => {
  assert.match(src, /value\s*==\s*null\s*\|\|\s*value\s*===\s*""[\s\S]*?ok\s*:\s*true[\s\S]*?value\s*:\s*null/);
  assert.match(src, /trimmed\s*===\s*"\[object PointerEvent\]"/);
  assert.match(src, /trimmed\.length\s*>\s*maxLen/);
  assert.match(src, /typeof\s+\w+\s*===\s*"number"[\s\S]*?Number\.isFinite/);
});
