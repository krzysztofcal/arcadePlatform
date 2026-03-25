import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pokerUiSrc = fs.readFileSync('poker/poker.js', 'utf8');

test('UI keeps requestId retry contracts for WS join/leave', () => {
  assert.match(pokerUiSrc, /function\s+resolveRequestId\s*\(/);
  assert.match(pokerUiSrc, /if\s*\(\s*pending\s*\)\s*return\s*\{[\s\S]*?requestId\s*:\s*pending[\s\S]*?nextPending\s*:\s*pending[\s\S]*?\}/);
  assert.match(pokerUiSrc, /async function retryJoin\([\s\S]*?joinTable\(pendingJoinRequestId\)/);
  assert.match(pokerUiSrc, /async function retryLeave\([\s\S]*?leaveTable\(pendingLeaveRequestId\)/);
  assert.match(pokerUiSrc, /resolveRequestId\(\s*pendingJoinRequestId\s*,\s*requestIdOverride\s*\)/);
  assert.match(pokerUiSrc, /resolveRequestId\(\s*pendingLeaveRequestId\s*,\s*requestIdOverride\s*\)/);
  assert.match(pokerUiSrc, /var\s+joinPayload\s*=\s*\{[\s\S]*?requestId\s*:\s*joinRequestId[\s\S]*?\}\s*;/);
  assert.match(pokerUiSrc, /leaveSender\(\{ tableId: tableId, requestId: leaveRequestId \}, leaveRequestId\)/);
  assert.doesNotMatch(pokerUiSrc, /String\(\s*joinRequestId\s*\)/);
  assert.doesNotMatch(pokerUiSrc, /String\(\s*leaveRequestId\s*\)/);
  assert.match(pokerUiSrc, /var\s+pendingJoinAutoSeat\s*=\s*false;/);
  assert.match(pokerUiSrc, /requestIdOverride\s*===\s*pendingJoinRequestId[\s\S]*?wantAutoSeat\s*=\s*!!pendingJoinAutoSeat/);
});
