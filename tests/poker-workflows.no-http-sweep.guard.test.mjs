import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const nightly = fs.readFileSync('.github/workflows/nightly-poker.yml', 'utf8');
const deployment = fs.readFileSync('docs/poker-deployment.md', 'utf8');
const systemSpec = fs.readFileSync('docs/poker-system-spec.md', 'utf8');
const tombstone = fs.readFileSync('netlify/functions/poker-sweep.mjs', 'utf8');

test('retired HTTP poker sweep has no scheduler or workflow authority', () => {
  assert.equal(fs.existsSync('.github/workflows/poker-sweep.yml'), false);
  assert.equal(fs.existsSync('netlify/functions/poker-sweep-scheduled.mjs'), false);
  assert.doesNotMatch(nightly, /\.netlify\/functions\/poker-sweep/);
  assert.doesNotMatch(nightly, /sweep endpoint retired notice/i);
  assert.doesNotMatch(systemSpec, /POKER_SWEEP_SECRET/);
  assert.match(deployment, /no scheduled HTTP sweep/i);
  assert.match(deployment, /runTableJanitor\(\)/);
  assert.match(tombstone, /statusCode: 410/);
  assert.match(tombstone, /sweep_http_retired/);
});
