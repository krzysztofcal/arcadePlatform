import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const helperSrc = fs.readFileSync('netlify/functions/_shared/poker-idempotency.mjs', 'utf8');
const migrationSrc = fs.readFileSync('supabase/migrations/20260118000000_poker_requests_idempotency_scope.sql', 'utf8');
const leaveDomainSrc = fs.readFileSync('shared/poker-domain/leave.mjs', 'utf8');

test('idempotency helper uses scoped key contracts and pending created_at checks', () => {
  assert.match(helperSrc, /select result_json, created_at from public\.poker_requests/);
  assert.match(helperSrc, /table_id = \$1 and user_id = \$2 and request_id = \$3 and kind = \$4/);
  assert.match(helperSrc, /on conflict \(table_id, kind, request_id, user_id\)/);
  assert.doesNotMatch(helperSrc, /on conflict \(table_id, request_id\)/);
  assert.match(migrationSrc, /poker_requests_table_kind_request_id_user_id_key/);
  assert.match(leaveDomainSrc, /ensurePokerRequest/);
  assert.match(leaveDomainSrc, /storePokerRequestResult/);
});
