import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPokerHandler } from './helpers/poker-test-helpers.mjs';

function loadRetired(path) {
  const logs = [];
  const handler = loadPokerHandler(path, {
    baseHeaders(value){ return value || {}; },
    corsHeaders(){ return { 'access-control-allow-origin': '*' }; },
    klog(kind, data){ logs.push({ kind, data }); },
  });
  return { handler, logs };
}

async function assertRetiredContract(path, expectedError, expectedLog) {
  const { handler, logs } = loadRetired(path);
  const optionsResponse = await handler({ httpMethod: 'OPTIONS', headers: {} });
  assert.equal(optionsResponse.statusCode, 204);

  const response = await handler({ httpMethod: 'POST', path: '/.netlify/functions/test', headers: { 'user-agent': 'test-agent' } });
  assert.equal(response.statusCode, 410);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.error, expectedError);
  assert.ok(typeof body.message === 'string' && body.message.length > 0);
  assert.ok(logs.some((entry) => entry.kind === expectedLog));
}

test('retired HTTP poker gameplay endpoints return 410 and emit stable klog markers', async () => {
  await assertRetiredContract('netlify/functions/poker-join.mjs', 'join_http_retired', 'poker_join_http_retired');
  await assertRetiredContract('netlify/functions/poker-heartbeat.mjs', 'heartbeat_http_retired', 'poker_heartbeat_http_retired');
  await assertRetiredContract('netlify/functions/poker-get-table.mjs', 'get_table_http_retired', 'poker_get_table_http_retired');
  await assertRetiredContract('netlify/functions/poker-act.mjs', 'act_http_retired', 'poker_act_http_retired');
  await assertRetiredContract('netlify/functions/poker-start-hand.mjs', 'start_hand_http_retired', 'poker_start_hand_http_retired');
  await assertRetiredContract('netlify/functions/poker-leave.mjs', 'leave_http_retired', 'poker_leave_http_retired');
  await assertRetiredContract('netlify/functions/poker-sweep.mjs', 'sweep_http_retired', 'poker_sweep_http_retired');
});
