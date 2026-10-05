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
- [x] **T012A — Custom gift picker.** Six existing gifts as Arcade buttons, localized name/emoji/CH price, exclusive selection, disabled/pending and native keyboard focus. Server prices remain authoritative.
- [x] **T012B — Custom recipient picker.** Current state.seats only; reuse avatar/name/seat presentation, exclusive selection, stale-seat removal and existing giftRetry reset. No payload/model change.
- [x] **T012C — Guest-visible disabled Gift Shop.** Locked visible guest/signed-out control with localized explanation; no opening/send; unchanged authenticated availability/auth.
- [ ] **T012D — Consume #1048 stable three-slot gift HUD.** BLOCKED on #1048; no avatar overflow/z-index/offset workaround. Preserve gift state/recovery.
- [ ] **T013 — Exact-SHA Preview gate.** Deploy latest runtime-affecting SHA with WS Preview Deploy, verify release metadata/health, then perform the mandatory Stage smoke above.
- [ ] **T014 — Production handoff.** Prepare/verify the Production-equivalent empty receipt schema according to current manifest rules and STOP for owner authorization before any Production DB mutation. Do not merge Production-deploying runtime while required Production schema is absent.
- [ ] **T015 — Final handoff.** Record exact runtime SHA, Stage migration/apply evidence, CI, WS Preview deploy, smoke evidence, any Production schema status and breaking impacts. Only call merge-ready when repository Definition of Done is satisfied.


T003 includes scripts/check-db-migrations.mjs inventory counts, required by the new exhaustive manifest entry.

T012 requires registering the two focused gift suites in scripts/test-all.mjs and classifying the two gift diagnostics in ws-server/poker/observability/poker-log-policy.mjs. Existing vitest-only tests/chips-ledger.test.mjs is not runnable with installed repo dependencies; extend the existing Node canonical-ledger suite tests/chips-ledger.human.buyin.unit.test.mjs instead. Receipt migration constraints/RLS/indexes are exercised with existing PGlite in the focused domain suite; external migration DB suite remains gated by CHIPS_MIGRATIONS_TEST_DB_URL. No new framework/dependency.

## Gate progress

T013 partial: Stage apply and exact-SHA WS Preview Deploy succeeded for `eb4144882028f44233609ade15b1323b553e9564`; installed metadata/health checks passed. Authenticated Stage gift smoke remains pending (no credentials here). T014 Production-equivalent schema and manifest are prepared, not applied; separate owner GO is required. T015 evidence is recorded in review.md and draft PR #1047, but final completion remains gated by required runtime smoke/Production handoff. No merge.

PR #1047 review correction: replay is accepted/state-only, never another table_gift. Latest exact-SHA Preview deploy for `03c7ab5b80698b82e8f3a46e9bf442615318c24f` succeeded: https://github.com/krzysztofcal/arcadePlatform/actions/runs/37269427509. T013 still pending authenticated Stage smoke; T014 Production owner GO/schema apply pending; T015 final handoff pending. Live #1042 synchronized with the same status/task progress.

T012B P1 follow-up completed: occupant identity = seatNo + userId; replacement clears target selection/retry and creates a fresh button/avatar. Controlled Deploy Preview Alice→Bob check passes on `b3c141fbfa63da3a76f60f66e865007c90a75958`; other-seat replacement retains target retry. T012D remains blocked on #1048; T013/T014/T015 remain pending.
