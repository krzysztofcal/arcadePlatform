import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const startHandSrc = fs.readFileSync('netlify/functions/poker-start-hand.mjs', 'utf8');
const startHandCoreSrc = fs.readFileSync('netlify/functions/_shared/poker-start-hand-core.mjs', 'utf8');

test('start-hand storage/runtime assumptions stay aligned with ACTIVE seats', () => {
  assert.match(startHandSrc, /status = 'ACTIVE'/);
  assert.match(startHandCoreSrc, /nextStacks/);
  assert.match(startHandCoreSrc, /derivedSeats/);
});
