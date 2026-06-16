import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const nightly = fs.readFileSync('.github/workflows/nightly-poker.yml', 'utf8');
const sweep = fs.readFileSync('.github/workflows/poker-sweep.yml', 'utf8');

test('poker workflows do not call retired HTTP poker-sweep endpoint', () => {
  assert.doesNotMatch(nightly, /\.netlify\/functions\/poker-sweep/);
  assert.doesNotMatch(sweep, /\.netlify\/functions\/poker-sweep/);
  assert.match(nightly, /retired/i);
  assert.match(sweep, /retired/i);
});
