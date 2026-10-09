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
- [x] **T012D — Consume #1048 stable three-slot gift HUD.** Integrated main/#1049 HUD slots during conflict reconciliation; preserve gift state/recovery. Authenticated visual smoke remains T013.
- [x] **T012E — Quick Gift per seat + no self-gifting.** E1 preserved; E2 uses main/#1049 quick-action slot and the shared sendSelectedGift/catalog/retry path. Authenticated smoke remains T013.
- [ ] **T013 — Final Preview gate after T012D + T012E.** Deploy latest runtime-affecting SHA with WS Preview Deploy, verify release metadata/health, then perform final authenticated Stage smoke after HUD/Quick Gift integration.
- [ ] **T014 — Production handoff.** Prepare/verify the Production-equivalent empty receipt schema according to current manifest rules and STOP for owner authorization before any Production DB mutation. Do not merge Production-deploying runtime while required Production schema is absent.
- [ ] **T015 — Final handoff.** Record exact runtime SHA, Stage migration/apply evidence, CI, WS Preview deploy, smoke evidence, any Production schema status and breaking impacts. Only call merge-ready when repository Definition of Done is satisfied.


T003 includes scripts/check-db-migrations.mjs inventory counts, required by the new exhaustive manifest entry.

T012 requires registering the two focused gift suites in scripts/test-all.mjs and classifying the two gift diagnostics in ws-server/poker/observability/poker-log-policy.mjs. Existing vitest-only tests/chips-ledger.test.mjs is not runnable with installed repo dependencies; extend the existing Node canonical-ledger suite tests/chips-ledger.human.buyin.unit.test.mjs instead. Receipt migration constraints/RLS/indexes are exercised with existing PGlite in the focused domain suite; external migration DB suite remains gated by CHIPS_MIGRATIONS_TEST_DB_URL. No new framework/dependency.

## Gate progress

T013 partial: Stage apply and exact-SHA WS Preview Deploy succeeded for `eb4144882028f44233609ade15b1323b553e9564`; installed metadata/health checks passed. Authenticated Stage gift smoke remains pending (no credentials here). T014 Production-equivalent schema and manifest are prepared, not applied; separate owner GO is required. T015 evidence is recorded in review.md and draft PR #1047, but final completion remains gated by required runtime smoke/Production handoff. No merge.

PR #1047 review correction: replay is accepted/state-only, never another table_gift. Latest exact-SHA Preview deploy for `03c7ab5b80698b82e8f3a46e9bf442615318c24f` succeeded: https://github.com/krzysztofcal/arcadePlatform/actions/runs/37269427509. T013 still pending authenticated Stage smoke; T014 Production owner GO/schema apply pending; T015 final handoff pending. Live #1042 synchronized with the same status/task progress.

T012B P1 follow-up completed: occupant identity = seatNo + userId; replacement clears target selection/retry and creates a fresh button/avatar. Controlled Deploy Preview Alice→Bob check passes on `b3c141fbfa63da3a76f60f66e865007c90a75958`; other-seat replacement retains target retry. T012D remains blocked on #1048; T013/T014/T015 remain pending.

T012E E1 COMPLETE: no-self domain guard before ledger (0 calls/BURN/receipt), own-seat browser exclusion, focused 12/12 plus selected WS 1/1 and required checks pass. Exact runtime SHA `f69ab9eabea21d8ec941abefc8f37ea7b5505738` deployed successfully: https://github.com/krzysztofcal/arcadePlatform/actions/runs/37295246079; RELEASE_SHA == DEPLOY_REF and installed metadata/health gates verified. T012E overall remains unchecked because E2 is BLOCKED on #1048; T012D likewise blocked. T013 final authenticated smoke follows D+E; T014 owner GO/schema and T015 final handoff pending.


## PR #1047 reconciliation — user T001–T005 (2026-10-08)

These integration tasks supplement the original feature task IDs above.

- [x] T001 — Fetch main/PR, record exact two textual conflicts; resolve individual hunks without selecting entire files.
- [x] T002 — Preserve main HUD/scene/avatars/animations/lifecycle; consume three gift slots and Quick Gift anchor with one purchase/retry path.
- [x] T003 — Review auto-merged WS/log policy against main; retain security, reconnect, janitor/lifecycle and gift replay/state/idempotency semantics.
- [x] T004 — Review browser client/i18n/adapter/protocol/tests/Production inventory; applied Stage migration unchanged.
- [x] T005 — Existing fundamental/repo checks, final diff review, CI and exact-SHA WS Preview deployment evidence. Authenticated Stage smoke and Production schema GO remain separate outstanding gates.

#1048 dependency is now resolved (CLOSED; #1049 MERGED), rather than a remaining code blocker. Final integrated Gift Shop visual/authenticated smoke remains outstanding. Historical deployment evidence above is superseded by the deployment recorded in review.md for this integration. PR stays Draft, no merge or Production action.


Integration verification complete for runtime `8898a8673e1774a1667de27142bf5cbebaf9a950`: local tests/checks + independent review + all runtime-SHA CI passed; WS Preview Deploy run 37845007258 succeeded with metadata/health gates. Full evidence in review.md. T013 remains unchecked for authenticated Stage smoke; T014 Production owner GO/schema and T015 final acceptance/handoff remain pending. No merge-ready declaration.


## P1 — Recipient-bound Gift Shop retry

- [x] Analyze sendSelectedGift/syncGiftOwners/syncGiftShop and reproduce missing recipient identity.
- [x] Bind retry to seatNo + userId, reject stale recipient before send and clear target-scoped retry/selection on replacement/departure.
- [x] Preserve unchanged recipient requestId and unrelated-seat retry; retain WS/idempotency/BURN/replay/cooldown semantics.
- [x] Existing fundamental/browser/client checks, controlled red/green probe, independent diff review; update existing Draft #1047/SpecKit.

Authenticated Stage smoke/Production GO remain pending; no new UI suite, WS protocol/schema/migration changes or Production deployment.


## Persistent Gift HUD manual FAIL — correction tasks

- [x] T001 — Read-only Stage receipt/seat comparison, postgres serializer and WS/event/state path; check Firefox slot visibility.
- [x] T002 — Preserve timestamp precision; restore newest three purchases with additive state fields and recipient ownership validation, no accounting/schema changes.
- [x] T003 — Fundamental regression, Gift Shop/WS/browser/client/ledger/repo checks, diff review and exact-SHA Preview deployment. Conditional authenticated Stage smoke unavailable (no browser login); acceptance gate remains unchecked/FAIL.

Manual authenticated persistent HUD smoke remains FAIL/unverified until all three slots are confirmed; keep Draft/not merge-ready and Production GO pending.


Corrected runtime SHA `2c9976d4a01bd143898422208644840e7ec1efad`: WS Preview Deploy run 37853558761 success, installed RELEASE_SHA == DEPLOY_REF and health verified; Netlify same SHA. Full npm test exit 0 (144 runner groups), WS/reconnect 160/160, browser/client 170/170, Gift Shop 14/14. Current CI linked from PR #1047. Authenticated persistent HUD smoke remains FAIL/unverified; T013/Production T014/final acceptance T015 still pending.


## 2026-10-09 accepted correction — avatar action / tabletop receipts

Supersedes historical three-types/duplicate-counter/overflow presentation and the 2026-10-08 avatar-ring placement. Show three latest purchases newest-first, duplicate purchases as separate emoji objects; older purchases remain receipts. Legacy aggregate `gifts` stays compatible. Quick Gift belongs to the avatar edge, statically derived from avatar geometry/physical slot, outside its clipped element. Received gifts belong to a separate fixed tabletop anchor near stack/bet, for every slot including hero. Reuse existing quickAction/gifts/three slots and scene scaling; no runtime collision engine, observers, new dependencies or purchase/protocol/schema changes. Verify actual browser rectangles/screenshots across portrait/landscape, all seats/dealers and gameplay states.

Timestamp precision: modeled postgres-js/PGlite regression remains useful but is not real driver→PostgreSQL evidence. Read-only Stage receipt/seat equality and exact active summary recovery after a new-runtime purchase are required; if absent mark PENDING, never approximate historical identity or repair old receipts. Authenticated financial smoke and Production owner GO remain merge gates.

### New corrective tasks (historical completed tasks retained)

- [x] GHUD-T001 — Read live main/PR/#1048/#1049 geometry, update existing issue and SpecKit before implementation.
- [x] GHUD-T002 — Static Quick Gift avatar-edge anchor using existing quickAction; preserve picker/retry/focus/self exclusion.
- [x] GHUD-T003 — Static three-object tabletop anchors for six physical slots in both orientations; reuse gift slots.
- [x] GHUD-T004 — Preserve recentGifts/owner/recovery/lifecycle/purchase semantics.
- [ ] GHUD-T005 — Read-only real Stage timestamp/active-recovery check; PENDING if no eligible corrected-runtime receipt.
- [x] GHUD-T006 — Replace stale issue aggregation requirements with accepted contract and explicit history.
- [x] GHUD-T007 — Chromium/Firefox Preview rectangles/screenshots and interaction matrix; distinguish controlled probe from authenticated smoke.
- [x] GHUD-T008 — Existing fundamental/repo/CSP/syntax checks, review, update Draft PR/handoff; no redundant WS deployment for frontend-only change.

GHUD-T005 partial evidence: four new real Stage receipts preserve exact microseconds; seat now INACTIVE, ACTIVE loader/WS reconnect remains PENDING. GHUD-T007 controlled local-JS/CSS-on-Preview matrix passes (120 seat-count/dealer/viewport/browser combinations), including normalized hero best-hand cards, stack 99,999/bet/pot, duplicate objects,1–3 hero gifts, next hand, avatar/replacement and picker actions. Await actual deployed frontend verification. No WS/shared/protocol/config/migration edits; retain installed WS2c9976d4 without redundant deployment.

Final GHUD-T007/T008 evidence: deployed Netlify frontend SHA c974e920877554228e779d25ab6a32bed0920a58 confirmed via BUILD_INFO; actual remote JS/CSS Chromium/Firefox matrix passed120 geometry combinations, each playing/end-showdown state (240 evaluations), zero collisions.1–3 receipt objects,hero,self exclusion,thumbs-up coexistence,stable action rectangles,resize/orientation,full reload+controlled recovery,avatar/seat replacement and touch picker/product mock send pass. CI for c974e920 complete with no pending/failed checks. GHUD-T005 ACTIVE recovery and authenticated real financial Stage acceptance remain PENDING; Production GO remains pending. These completed visual/check tasks do not clear the authenticated merge gates.


### Quick Gift P2 touch correction

- [x] QG-P2-T001 — Measure actual scaled hitbox at390×844/844×390 Chromium/Firefox.
- [x] QG-P2-T002 — Minimal fixed-anchor transparent padding, preserve glyph and existing reactions; size only from scene scale.
- [x] QG-P2-T003 — Controlled browser hitbox/glyph/overlap/clipping/touch/resize verification, appropriate existing checks and Draft PR evidence. No WS deploy.

QG-P2 deployed measurement: frontend71edd1654eeb1a410ff938502099763345df35ed confirmed BUILD_INFO; remote Chromium/Firefox JS/CSS reproduce30×30 sides/portrait,30×25.48 northern landscape,desktop unchanged and all hit-grid samples ownbutton. Local matrix/required checks passed; authenticated smoke/ACTIVE recovery/Production GO remain pending.


## 2026-10-09 manual FAIL — portrait S6 proximity / hero visual demo

Manual smoke FAIL: S6 gifts too far from avatar in portrait; hero gifts lack convenient on-device inspection. Seat numbers rotate relative to hero: resolve physical slot using rotateSeatIndex→seatPhysicalSlot, not S6 hardcoding. For six seats/heroS1,S6 is physical lower-right(slot2); manual hero/seat-count clarification requested. Change only the relevant portrait gifts anchor after mapping confirmation; preserve all Quick Gift anchors/hitboxes and landscape.

Extend existing gated bindCelebrationPreview with one unchecked,non-persisted checkbox “Show demo gifts on hero — DEMO / Visual only”. One local identity-bound state; renderGiftBadges selects beer/pizza/whisky only for actually occupied hero. Reuse three hud.gifts slots/geometric placement; mark visible hero name DEMO while active. Never mutate giftsBySeat/giftOwners/giftEventIds, create event IDs/receipts or call purchase/WS/backend. Turning off shows current real data. Clear on leave/table/user/seat changes and reconnect/recovery (participation boundary not exposed publicly); ordinary seat/hand renders retain demo. No changes to other players.

Constitution: existing fundamental checks and temporary browser probes only,no committed UI/CSS suite,backend/protocol/schema/dependency/inline-script changes or WS deployment. Draft/manual FAIL remains until authenticated acceptance; ACTIVE recovery and Production GO pending.

- [ ] HERO-T001 — Confirm rotated S6 physical slot; correct only matching portrait gift anchor.
- [x] HERO-T002 — Gated identity-bound hero visual demo/visible DEMO/restoration/cleanup, existing renderer only.
- [ ] HERO-T003 — Existing fundamentals/checks,controlled Preview on/off/recovery/collision/hitbox verification,issue/SpecKit/Draft PR handoff.
