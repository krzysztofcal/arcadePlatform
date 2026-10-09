# Proposed release and purchase boundaries — #1071

This document defines review obligations for later work. It introduces no endpoint, bridge implementation or store product.

## Client and provider boundary

- Web provider, Play Billing and StoreKit are distinct channels; mobile external-payment navigation is disabled by default unless an explicitly applicable agreement permits it.
- Shell/browser submits an opaque provider purchase identity and claimed SKU for verification; server determines identity, price/product mapping, environment and authoritative purchase state.
- Login must bind purchases to a stable authenticated account. Guest IDs, email strings, local storage, URL flags and editable user metadata do not authorize ownership.
- Store account and Arcade account may differ. Reinstall/restore must verify the original binding; account-link conflicts require a documented support path, not client reassignment.

## Server fulfillment boundary

- Verify provider authenticity, app/package/environment, SKU and paid/eligible state. Invalid, pending or unavailable verification denies grants.
- A provider-qualified unique identity protects fulfillment. Retried callbacks, notifications and acknowledgments cannot duplicate CH or entitlements.
- Durably record a once-only outcome before completing provider acknowledgment/consumption/finish. Retry provider completion after response loss without repeating the ledger grant.
- Reconcile missed/out-of-order events using current provider state. Refund/revoke handling preserves ledger invariants; a spent-CH policy is a product/legal dependency.
- Purchased IAP CH never expires; any promotional expiry must be separately identifiable and cannot remove paid units.
- CH consumption, permanent ownership restore and VIP validity are different operations. Cancellation leaves paid-period benefits until authoritative expiry unless provider refund/revocation requires otherwise.
- WS remains game-state authority. Billing never synthesizes table stacks from purchase callbacks. No privileged provider/service key is shipped to clients.

## Release boundary

Each F/M gate in the [report](../../../docs/issue-1071-mobile-store-readiness-audit.md) requires an assigned owner and dated evidence. Implementation, Production changes, registration, submission and rollout need separately scoped authorization. Free Android does not approve monetized Android or iOS. No payment deep-link exception, legal classification or store acceptance can be inferred from this documentation PR.
