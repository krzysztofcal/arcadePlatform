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
  assert.match(protocolDoc, /retired and return .*410/i);
  assert.doesNotMatch(protocolDoc, /read-only API/i);
});

test('deployment docs describe retired HTTP gameplay endpoints', () => {
  assert.match(deploymentDoc, /non-authoritative/i);
  assert.match(deploymentDoc, /410/);
  assert.match(deploymentDoc, /\.netlify\/functions\/poker-heartbeat/);
  assert.match(deploymentDoc, /\.netlify\/functions\/poker-get-table/);
  assert.match(deploymentDoc, /\.netlify\/functions\/poker-sweep/);
});

const holeCardsDoc = fs.readFileSync('docs/poker-hole-cards-normalization.md', 'utf8');

test('hole-cards doc is explicit that poker-get-table is retired 410 stub', () => {
  assert.match(holeCardsDoc, /historical/i);
  assert.match(holeCardsDoc, /WS-only/i);
  assert.match(holeCardsDoc, /retired HTTP stub/i);
  assert.match(holeCardsDoc, /returns `410`/i);
  assert.doesNotMatch(holeCardsDoc, /migrat(e|ion)|read-only API/i);
});
