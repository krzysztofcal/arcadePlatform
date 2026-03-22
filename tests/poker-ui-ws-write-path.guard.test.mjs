import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('poker/poker.js', 'utf8');

test('poker UI gameplay writes keep WS-only runtime path', () => {
  assert.doesNotMatch(source, /apiPost\(\s*WS_JOIN_ENDPOINT/);
  assert.doesNotMatch(source, /apiPost\([^\n]*poker-join/);
  assert.doesNotMatch(source, /apiPost\([^\n]*poker-start-hand/);
  assert.doesNotMatch(source, /apiPost\([^\n]*poker-act/);
  assert.doesNotMatch(source, /apiPost\([^\n]*poker-leave/);
  assert.doesNotMatch(source, /fetch\([^\n]*poker-join/);
  assert.doesNotMatch(source, /fetch\([^\n]*poker-start-hand/);
  assert.doesNotMatch(source, /fetch\([^\n]*poker-act/);
  assert.doesNotMatch(source, /fetch\([^\n]*poker-leave/);
  assert.match(source, /resolveGameplayWsSender\(wsClient, 'sendJoin', 'join'/);
  assert.match(source, /resolveGameplayWsSender\(wsClient, 'sendLeave', 'leave'/);
  assert.match(source, /resolveGameplayWsSender\(wsClient, 'sendStartHand', 'start_hand'/);
  assert.match(source, /resolveGameplayWsSender\(wsClient, 'sendAct', 'act'/);
  assert.match(source, /var GET_URL = '\/.netlify\/functions\/poker-get-table'/);
  assert.match(source, /var LEAVE_URL = '\/.netlify\/functions\/poker-leave'/);
});
