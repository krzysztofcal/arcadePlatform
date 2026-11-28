import test from 'node:test';
import assert from 'node:assert/strict';
import { runPlaySupportAcknowledgement } from '../netlify/functions/_shared/play-support-ack-worker.mjs';

const receipt = { id: 'synthetic-receipt', generation: 2, sku: 'supporter_gold',
  environment: 'stage', accountBinding: 'synthetic_binding' };
const token = 'synthetic-provider-token';
const purchase = {
  obfuscatedExternalAccountId: receipt.accountBinding,
  testPurchaseContext: { fopType: 'TEST' },
  purchaseStateContext: { purchaseState: 'PURCHASED' },
  acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
  productLineItem: [{ productId: receipt.sku, productOfferDetails: {
    quantity: 1, consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED'
  } }]
};

function fixture({ previous = null, provider = purchase, lost = false, begin = 'current-attempt' } = {}) {
  const calls = [];
  const store = {
    recoverAck: async (...args) => { calls.push(['recover', ...args]); return previous; },
    beginAck: async (...args) => { calls.push(['begin', ...args]); return begin; },
    finishAck: async (...args) => {
      calls.push(['finish', ...args]);
      return args[3] === 'NOT_ACKNOWLEDGED' ? 'DUE' : args[3];
    }
  };
  const publisher = {
    readPurchase: async (...args) => { calls.push(['read', ...args]); return provider; },
    acknowledge: async (...args) => {
      calls.push(['ack', ...args]);
      if (lost) throw new Error('private provider response');
    }
  };
  return { calls, run: () => runPlaySupportAcknowledgement({ receipt, token, store, publisher }) };
}

test('external acknowledgement follows the committed claim and records uncertainty on lost response', async () => {
  const f = fixture({ lost: true });
  assert.deepEqual(await f.run(), { state: 'UNCERTAIN' });
  assert.deepEqual(f.calls, [
    ['recover', receipt.id, 2], ['begin', receipt.id, 2], ['ack', receipt.sku, token],
    ['finish', receipt.id, 2, 'current-attempt', 'UNCERTAIN']
  ]);

  const blocked = fixture({ begin: null });
  assert.deepEqual(await blocked.run(), { state: 'NO_ATTEMPT' });
  assert.ok(!blocked.calls.some(([name]) => name === 'ack'));
});

test('fresh claim reconciles a previous acknowledgement without sending it twice', async () => {
  const f = fixture({ previous: 'previous-attempt' });
  assert.deepEqual(await f.run(), { state: 'CONFIRMED' });
  assert.deepEqual(f.calls, [
    ['recover', receipt.id, 2], ['read', token],
    ['finish', receipt.id, 2, 'previous-attempt', 'CONFIRMED']
  ]);

  const cancelled = fixture({ previous: 'previous-attempt', provider: {
    ...purchase, purchaseStateContext: { purchaseState: 'CANCELLED' }
  } });
  assert.deepEqual(await cancelled.run(), { state: 'RECHECK_RECEIPT' });
  assert.ok(!cancelled.calls.some(([name]) => name === 'ack' || name === 'finish'));
});

test('an authoritative unacknowledged response reopens the attempt before any retry', async () => {
  const f = fixture({ previous: 'previous-attempt', provider: {
    ...purchase, acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING'
  } });
  assert.deepEqual(await f.run(), { state: 'CONFIRMED' });
  assert.deepEqual(f.calls.map(([name]) => name), ['recover', 'read', 'finish', 'begin', 'ack', 'finish']);
  assert.equal(f.calls[2][4], 'NOT_ACKNOWLEDGED');
});
