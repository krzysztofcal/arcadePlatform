import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../poker/poker-v2.js', import.meta.url), 'utf8');
const functionSource = source.slice(source.indexOf('  function sumOtherTableStacks('), source.indexOf('  function accountHudContext('));
const sum = vm.runInNewContext(functionSource + '\nsumOtherTableStacks');

test('Other tables excludes the current authoritative stack and rejects unavailable values', () => {
  assert.equal(sum([{ tableId: 'here', stack: 900 }, { tableId: 'other', stack: 75 }, { tableId: 'bot-table', stack: 25 }], 'here'), 100);
  assert.equal(sum([], 'here'), 0);
  assert.equal(sum([{ tableId: 'other', stack: 0 }], 'here'), 0);
  assert.equal(sum(null, 'here'), null);
  assert.equal(sum([{ tableId: 'other', stack: null }], 'here'), null);
  assert.equal(sum([{ tableId: 'other', stack: -1 }], 'here'), null);
  assert.equal(sum([{ tableId: 'other', stack: Number.MAX_SAFE_INTEGER }, { tableId: 'third', stack: 1 }], 'here'), null);
});
