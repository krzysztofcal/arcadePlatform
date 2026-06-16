import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('netlify/functions/poker-get-table.mjs', 'utf8');

const forbiddenTokens = [
  'beginSql',
  'verifySupabaseJwt',
  'extractBearerToken',
  'deriveCommunityCards',
  'deriveRemainingDeck',
  'isHoleCardsTableMissing',
  'loadHoleCardsByUserId',
  'isStateStorageValid',
  'normalizeJsonState',
  'withoutPrivateState',
  'maybeApplyTurnTimeout',
  'normalizeSeatOrderFromState',
  'isValidUuid',
  'tableId',
  'state_invalid'
];

test('poker-get-table implementation is a pure retired 410 stub', () => {
  assert.match(source, /error:\s*"get_table_http_retired"/);
  assert.match(source, /klog\("poker_get_table_http_retired"/);
  assert.match(source, /statusCode:\s*410/);
  assert.match(source, /if \(method === "OPTIONS"\) return \{ statusCode: 204/);

  for (const token of forbiddenTokens) {
    assert.doesNotMatch(source, new RegExp(token), `retired stub must not include legacy gameplay token: ${token}`);
  }
});
