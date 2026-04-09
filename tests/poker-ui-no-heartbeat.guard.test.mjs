import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('poker/poker.js', 'utf8');

test('poker UI runtime has no heartbeat dependency', () => {
  assert.doesNotMatch(source, /HEARTBEAT_URL/);
  assert.doesNotMatch(source, /poker-heartbeat/);
  assert.doesNotMatch(source, /sendHeartbeat\s*\(/);
  assert.doesNotMatch(source, /startHeartbeat\s*\(/);
});
