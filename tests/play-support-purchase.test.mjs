import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPlaySupportPurchase } from '../netlify/functions/_shared/play-support-purchase.mjs';

const expected = { environment: 'stage', accountBinding: 'opaque_binding', sku: 'supporter_gold' };
const purchase = {
  obfuscatedExternalAccountId: expected.accountBinding,
  testPurchaseContext: { fopType: 'TEST' },
  purchaseStateContext: { purchaseState: 'PURCHASED' },
  acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
  purchaseCompletionTime: '2026-11-26T12:00:00Z',
  orderId: 'synthetic-order',
  productLineItem: [{
    productId: expected.sku,
    productOfferDetails: { quantity: 1, consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED' }
  }]
};

test('extracts authoritative purchase facts without treating pending as fulfilled', () => {
  assert.deepEqual(inspectPlaySupportPurchase(purchase, expected), {
    state: 'PURCHASED', sku: expected.sku, orderId: purchase.orderId,
    acknowledged: false, completedAt: purchase.purchaseCompletionTime
  });
  for (const state of ['PENDING', 'CANCELLED']) {
    const result = inspectPlaySupportPurchase({
      ...purchase, purchaseStateContext: { purchaseState: state }, purchaseCompletionTime: undefined
    }, expected);
    assert.equal(result.state, state);
    assert.equal(result.completedAt, null);
  }
  assert.equal(inspectPlaySupportPurchase({
    ...purchase, acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'
  }, expected).acknowledged, true);
});

test('rejects mixed environments, mismatched bindings and unsupported purchase shapes', () => {
  assert.deepEqual(inspectPlaySupportPurchase(purchase, { ...expected, environment: 'production' }),
    { state: 'REJECTED', reason: 'unexpected_purchase_context' });
  assert.deepEqual(inspectPlaySupportPurchase({ ...purchase, testPurchaseContext: undefined }, expected),
    { state: 'REJECTED', reason: 'unexpected_purchase_context' });
  assert.deepEqual(inspectPlaySupportPurchase({ ...purchase, obfuscatedExternalAccountId: 'other' }, expected),
    { state: 'REJECTED', reason: 'account_binding_mismatch' });
  for (const details of [
    { quantity: 2 }, { rentOfferDetails: {} }, { preorderOfferDetails: {} },
    { consumptionState: 'CONSUMPTION_STATE_CONSUMED' }
  ]) {
    const item = purchase.productLineItem[0];
    assert.equal(inspectPlaySupportPurchase({
      ...purchase, productLineItem: [{ ...item, productOfferDetails: { ...item.productOfferDetails, ...details } }]
    }, expected).state, 'REJECTED');
  }
  assert.equal(inspectPlaySupportPurchase({ ...purchase, productLineItem: [] }, expected).state, 'REJECTED');
});
