import test from 'node:test';
import assert from 'node:assert/strict';
import { handleGiftSendCommand } from './gift.mjs';
import { createGiftAdapter } from '../persistence/gift-adapter.mjs';
const input = { payload: { tableId: 'table', giftKey: 'beer', targetSeatNo: 3 }, tableId: 'table', buyerUserId: 'user', requestId: 'r1', identityMode: 'user', connectedToTable: true, senderSeatNo: 1, senderIsBot: false };
test('gift handler allows only authenticated seated humans and the narrow payload', async () => {
  const calls = [];
  const purchase = async (args) => { calls.push(args); return { ok: true }; };
  for (const [patch, code] of [[{ identityMode: 'guest' }, 'invalid_sender'], [{ senderIsBot: true }, 'invalid_sender'], [{ connectedToTable: false }, 'not_seated'], [{ senderSeatNo: null }, 'not_seated'], [{ payload: { ...input.payload, priceCh: 1 } }, 'gift_invalid'], [{ payload: { ...input.payload, recipientUserId: 'spoof' } }, 'gift_invalid']]) {
    assert.deepEqual(await handleGiftSendCommand({ ...input, ...patch, purchase }), { ok: false, code });
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(await handleGiftSendCommand({ ...input, purchase }), { ok: true });
  assert.deepEqual(calls[0], { tableId: 'table', buyerUserId: 'user', requestId: 'r1', giftKey: 'beer', recipientSeatNo: 3 });
});
test('file-backed adapter is unavailable with zero ledger/DB calls', async () => {
  const fail = () => { throw new Error('must not execute'); };
  const adapter = createGiftAdapter({ env: { WS_PERSISTED_STATE_FILE: '/tmp/gifts' }, beginSql: fail, postTransactionFn: fail });
  assert.deepEqual(await adapter.purchase({}), { ok: false, code: 'gift_shop_unavailable' });
  assert.deepEqual(await adapter.loadActiveGiftSummary('table'), null);
});
test('adapter maps only known errors and never exposes DB internals', async () => {
  for (const [error, code] of [[{ code: 'P0001', message: 'insufficient_funds' }, 'gift_insufficient_chips'], [{ code: '42P01' }, 'gift_shop_unavailable'], [{ code: 'secret_database_error' }, 'gift_purchase_failed']]) {
    const adapter = createGiftAdapter({ env: { SUPABASE_DB_URL: 'test' }, postTransactionFn: async () => {}, beginSql: async () => { throw error; } });
    assert.deepEqual(await adapter.purchase({ tableId: '00000000-0000-4000-8000-000000000001', buyerUserId: '00000000-0000-4000-8000-000000000002', requestId: 'r1', giftKey: 'beer', recipientSeatNo: 2 }), { ok: false, code });
  }
});
