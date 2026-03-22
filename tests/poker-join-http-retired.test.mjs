import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPokerHandler } from './helpers/poker-test-helpers.mjs';

const handler = loadPokerHandler('netlify/functions/poker-join.mjs', {
  baseHeaders(value){ return value; },
  corsHeaders(){ return { 'access-control-allow-origin': '*' }; },
  klog(){},
});

test('retired poker-join HTTP endpoint returns explicit gone response', async () => {
  const response = await handler({ httpMethod: 'POST', path: '/.netlify/functions/poker-join', headers: { 'user-agent': 'test-agent' } });
  assert.equal(response.statusCode, 410);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'join_http_retired');
  assert.match(body.message, /WS-only/);
});
