import test from 'node:test';
import assert from 'node:assert/strict';
import { runPlaySupportWork } from '../netlify/functions/_shared/play-support-work.mjs';

const packageName = 'pl.kcswh.arcadepoker.stage';
const token = 'mock-purchase-token';
const receiptId = 'mock-receipt';
const time = Date.UTC(2026, 10, 27, 12);
const claim = { generation: 3, tokenHash: Buffer.alloc(32, 1), failureCount: 0 };
const purchase = {
  obfuscatedExternalAccountId: 'mock_binding',
  testPurchaseContext: { fopType: 'TEST' },
  purchaseStateContext: { purchaseState: 'PURCHASED' },
  acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
  orderId: 'mock-order',
  productLineItem: [{ productId: 'supporter_gold', productOfferDetails: {
    quantity: 1, consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED'
  } }]
};

function fixture({ observation = purchase, apply = 'GRANTED', completes = true, ackOutcome } = {}) {
  const calls = [];
  const store = {
    claim: async () => claim,
    applyPurchase: async input => {
      calls.push(['apply', input.state, input.accountBinding, input.generation]);
      return { outcome: apply, receiptId };
    },
    recoverAck: async () => null,
    beginAck: async () => { calls.push(['begin']); return 'mock-attempt'; },
    finishAck: async (id, generation, attempt, status) => { calls.push(['finish', status]); return ackOutcome ?? status; },
    complete: async () => { calls.push(['complete']); return completes; },
    reschedule: async (work, next, failed) => {
      calls.push(['reschedule', next.valueOf(), failed]);
      return true;
    }
  };
  const publisher = {
    readPurchase: async () => observation,
    acknowledge: async () => { calls.push(['provider-confirm']); }
  };
  const codec = { decrypt: () => token };
  return { calls, run: () => runPlaySupportWork({
    packageName, environment: 'stage', store, publisher, codec, now: () => time, random: () => 0
  }) };
}

test('applies provider evidence and commits an ack attempt before calling Google', async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { state: 'COMPLETE' });
  assert.deepEqual(f.calls, [
    ['apply', 'PURCHASED', 'mock_binding', 3], ['begin'], ['provider-confirm'], ['finish', 'CONFIRMED'], ['complete']
  ]);
});

test('pending and mismatched package context never grant or acknowledge', async () => {
  const pending = fixture({ observation: { ...purchase, purchaseStateContext: { purchaseState: 'PENDING' } }, apply: 'PENDING' });
  assert.deepEqual(await pending.run(), { state: 'PENDING' });
  assert.deepEqual(pending.calls, [['apply', 'PENDING', 'mock_binding', 3], ['reschedule', time + 10000, false]]);
  const invalid = fixture({ observation: { ...purchase, testPurchaseContext: undefined } });
  assert.deepEqual(await invalid.run(), { state: 'SUPPORT_REQUIRED', reason: 'unexpected_purchase_context' });
  assert.deepEqual(invalid.calls, [['reschedule', time + 30000, true]]);
});

test('a newer event observed during completion leaves work queued for another read', async () => {
  const f = fixture({ completes: false });
  assert.deepEqual(await f.run(), { state: 'RETRY' });
  assert.deepEqual(f.calls.at(-1), ['reschedule', time + 30000, true]);
});

test('unrecognized acknowledgement state never completes a purchase', async () => {
  const f = fixture({ ackOutcome: 'UNRECOGNIZED' });
  assert.deepEqual(await f.run(), { state: 'RETRY' });
  assert.ok(!f.calls.some(([name]) => name === 'complete'));
});
