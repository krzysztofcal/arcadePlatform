import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const realtimeDoc = fs.readFileSync('docs/poker-realtime.md', 'utf8');
const deploymentDoc = fs.readFileSync('docs/poker-deployment.md', 'utf8');

test('realtime docs assign disconnect cleanup ownership to WS runtime', () => {
  assert.match(realtimeDoc, /Active gameplay runtime ownership is WS-only/);
  assert.match(realtimeDoc, /ws-server\/server\.mjs/);
});

test('deployment docs describe retired HTTP gameplay endpoints', () => {
  assert.match(deploymentDoc, /non-authoritative/i);
  assert.match(deploymentDoc, /410/);
  assert.match(deploymentDoc, /\.netlify\/functions\/poker-heartbeat/);
  assert.match(deploymentDoc, /\.netlify\/functions\/poker-get-table/);
  assert.match(deploymentDoc, /\.netlify\/functions\/poker-sweep/);
});
