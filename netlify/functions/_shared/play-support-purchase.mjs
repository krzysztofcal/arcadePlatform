const SKUS = new Set(['supporter_bronze', 'supporter_silver', 'supporter_gold']);
const STATES = new Set(['PENDING', 'PURCHASED', 'CANCELLED']);
const ACKNOWLEDGED = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
const ACK_PENDING = 'ACKNOWLEDGEMENT_STATE_PENDING';

function rejected(reason) {
  return { state: 'REJECTED', reason };
}

// Call only with the authenticated Publisher API response for the pinned package.
// Rejection prevents fulfillment but does not prove cancellation or revocation.
export function inspectPlaySupportPurchase(purchase, { environment, accountBinding, sku }) {
  if ((environment !== 'stage' && environment !== 'production') ||
      typeof accountBinding !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(accountBinding)) {
    return rejected('invalid_expected_identity');
  }
  const state = purchase?.purchaseStateContext?.purchaseState;
  if (!STATES.has(state)) return rejected('unsupported_purchase_state');

  const testContext = purchase.testPurchaseContext;
  if (environment === 'stage' ? testContext?.fopType !== 'TEST' : testContext !== undefined) {
    return rejected('unexpected_purchase_context');
  }
  if (purchase.obfuscatedExternalAccountId !== accountBinding) {
    return rejected('account_binding_mismatch');
  }

  const items = purchase.productLineItem;
  if (!Array.isArray(items) || items.length !== 1 || !SKUS.has(items[0]?.productId) ||
      (sku !== undefined && sku !== items[0].productId)) {
    return rejected('unsupported_product');
  }
  const { productId, productOfferDetails: offer } = items[0];
  if (offer?.quantity !== 1 || offer.rentOfferDetails !== undefined || offer.preorderOfferDetails !== undefined ||
      (state === 'PURCHASED' && offer.consumptionState !== 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED')) {
    return rejected('unsupported_offer');
  }

  const ack = purchase.acknowledgementState;
  if (state === 'PURCHASED' && ack !== ACKNOWLEDGED && ack !== ACK_PENDING) {
    return rejected('unsupported_acknowledgement_state');
  }

  const { orderId, purchaseCompletionTime } = purchase;
  return {
    state,
    sku: productId,
    orderId: typeof orderId === 'string' && orderId.length <= 128 ? orderId : null,
    acknowledged: ack === ACKNOWLEDGED,
    completedAt: state === 'PURCHASED' && typeof purchaseCompletionTime === 'string' &&
      purchaseCompletionTime.length <= 40 && Number.isFinite(Date.parse(purchaseCompletionTime))
      ? purchaseCompletionTime : null
  };
}
