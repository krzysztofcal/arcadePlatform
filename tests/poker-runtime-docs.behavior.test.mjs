import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const realtimeDoc = fs.readFileSync('docs/poker-realtime.md', 'utf8');
const protocolDoc = fs.readFileSync('docs/ws-poker-protocol.md', 'utf8');
const deploymentDoc = fs.readFileSync('docs/poker-deployment.md', 'utf8');

test('realtime docs assign table runtime ownership to WS-only path', () => {
  assert.match(realtimeDoc, /Active gameplay runtime ownership is WS-only/);
  assert.match(realtimeDoc, /table\.html`\) is strictly WS-only/i);
  assert.match(realtimeDoc, /no HTTP bootstrap/i);
  assert.match(realtimeDoc, /no gameplay HTTP fallback/i);
});

test('protocol docs forbid poker HTTP runtime on table page', () => {
  assert.match(protocolDoc, /MUST be 100% WS-only/i);
  assert.match(protocolDoc, /MUST NOT use `poker-get-table`/i);
  assert.match(protocolDoc, /MUST NOT use `poker-get-table`, `poker-heartbeat`/i);
});

test('deployment docs describe retired HTTP gameplay endpoints', () => {
  assert.match(deploymentDoc, /non-authoritative/i);
  assert.match(deploymentDoc, /410/);
  assert.match(deploymentDoc, /\.netlify\/functions\/poker-heartbeat/);
  assert.match(deploymentDoc, /\.netlify\/functions\/poker-get-table/);
  assert.match(deploymentDoc, /\.netlify\/functions\/poker-sweep/);
});
