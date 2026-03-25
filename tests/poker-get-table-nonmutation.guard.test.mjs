import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync('netlify/functions/poker-get-table.mjs', 'utf8');

test('get-table remains non-mutating for seat/table lifecycle fields', () => {
  assert.doesNotMatch(src, /set last_activity_at/);
  assert.doesNotMatch(src, /update public\.poker_seats set status = 'INACTIVE'/);
  assert.doesNotMatch(src, /max_players\s*:/);
  assert.doesNotMatch(src, /last_activity_at\s*:/);
});
