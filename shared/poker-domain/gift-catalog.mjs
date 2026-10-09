export const GIFT_CATALOG = Object.freeze([
  ['coffee', 10], ['beer', 25], ['whisky', 50], ['pizza', 100], ['cake', 250], ['diamond', 1000]
].map(([giftKey, priceCh]) => Object.freeze({ giftKey, priceCh })));
export function resolveGift(value) {
  return typeof value === 'string' ? GIFT_CATALOG.find((gift) => gift.giftKey === value) || null : null;
}
export function isGiftKey(value) { return resolveGift(value) !== null; }
