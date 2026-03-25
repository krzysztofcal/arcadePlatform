import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const realtimeDoc = fs.readFileSync('docs/poker-realtime.md', 'utf8');
const deploymentDoc = fs.readFileSync('docs/poker-deployment.md', 'utf8');

test('realtime docs assign disconnect cleanup ownership to WS runtime', () => {
  assert.match(realtimeDoc, /Active disconnect cleanup ownership is in WS runtime/);
  assert.match(realtimeDoc, /ws-server\/server\.mjs/);
});

test('deployment docs describe one-time sweep invocation contract', () => {
  assert.match(deploymentDoc, /POST/);
  assert.match(deploymentDoc, /x-sweep-secret/i);
  assert.match(deploymentDoc, /POKER_SWEEP_SECRET/);
  assert.match(deploymentDoc, /\.netlify\/functions\/poker-sweep/);
});
