# Tasks — #1042

Execute sequentially T001–T015; each depends on the preceding task. Stage auto-apply intentionally creates empty receipt schema/indexes/RLS only; Production requires separate owner GO.


- [x] **T001 — SpecKit baseline reconciliation.** Re-read live #1042, #786, `agents.md`, `skills.md`, current ledger/WS/Poker V2 code; create/update `specs/1042-poker-gift-shop-v1/` artifacts from this accepted issue without broadening scope.
- [x] **T002 — Catalog contract.** Add `shared/poker-domain/gift-catalog.mjs` with exactly the six accepted keys/prices and small normalization helpers.
- [x] **T003 — Receipt migration.** Generate the forward-only `poker_gift_purchases` Stage migration, RLS and two narrow indexes; update current Production migration inventory/manifest as required. Declare shared Stage auto-apply effect. No data/CH mutation.
- [x] **T004 — Purchase core.** Add `shared/poker-domain/gift-purchase.mjs::executePokerGiftPurchase()` with advisory cooldown/idempotency lock, active seat/participation validation, atomic existing-ledger BURN and receipt.
- [x] **T005 — WS persistence adapter.** Add gift purchase deps/adapter, known-error mapping and active-participation gift summary loader. Guest/file-store path fails closed with zero DB mutation.
- [x] **T006 — WS handler/protocol.** Add `handleGiftSendCommand`, `gift_send`, `table_gift`, `table_gift_state`; wire protected/requestId lists, broadcast and subscription/join/resync recovery in `ws-server/server.mjs`.
- [x] **T007 — Browser WS client.** Extend `poker/poker-ws-client.js` with `sendGift`, `onGift`, `onGiftState`; preserve one socket and JSP globals.
- [x] **T008 — V1 UI.** Add Gift Shop control/panel in `poker/table-v2.html`; implement catalog/recipient selection, purchase state, gift event/state handlers, bounded event dedupe/animation queue and avatar gift aggregates in `poker/poker-v2.js`.
- [x] **T009 — CSS/i18n.** Add minimal responsive/reduced-motion gift styles in `poker/poker-v2.css` (one line per selector) and PL/EN strings in `js/i18n.js`. No asset/CDN/audio work.
- [x] **T010 — Fundamental accounting/migration tests.** Extend migration/ledger suites for receipt contract, RLS/indexes and exact USER→GENESIS BURN/no-recipient-credit invariants.
- [x] **T011 — Fundamental domain/WS tests.** Add only the focused gift purchase/handler/runtime cases listed above. No UI/CSS/glue suite.
- [x] **T012 — Full verification/refactor.** Run focused + required repo checks; review/refactor touched code for the smallest implementation; verify no second ledger/payment/event framework and no gameplay mutation.
- [ ] **T013 — Exact-SHA Preview gate.** Deploy latest runtime-affecting SHA with WS Preview Deploy, verify release metadata/health, then perform the mandatory Stage smoke above.
- [ ] **T014 — Production handoff.** Prepare/verify the Production-equivalent empty receipt schema according to current manifest rules and STOP for owner authorization before any Production DB mutation. Do not merge Production-deploying runtime while required Production schema is absent.
- [ ] **T015 — Final handoff.** Record exact runtime SHA, Stage migration/apply evidence, CI, WS Preview deploy, smoke evidence, any Production schema status and breaking impacts. Only call merge-ready when repository Definition of Done is satisfied.


T003 includes scripts/check-db-migrations.mjs inventory counts, required by the new exhaustive manifest entry.

T012 requires registering the two focused gift suites in scripts/test-all.mjs and classifying the two gift diagnostics in ws-server/poker/observability/poker-log-policy.mjs. Existing vitest-only tests/chips-ledger.test.mjs is not runnable with installed repo dependencies; extend the existing Node canonical-ledger suite tests/chips-ledger.human.buyin.unit.test.mjs instead. Receipt migration constraints/RLS/indexes are exercised with existing PGlite in the focused domain suite; external migration DB suite remains gated by CHIPS_MIGRATIONS_TEST_DB_URL. No new framework/dependency.
