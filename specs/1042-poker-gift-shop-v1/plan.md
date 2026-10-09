# Implementation plan — #1042

Accepted architecture and task sequence: spec.md (live issue #1042), parent #786. Baseline origin/main: 4f798bdd56dba0e11b34e8982895650920ec6944.

## Constitution Check

PASS: only fundamental deterministic accounting/domain/WS tests (T010/T011). No UI/CSS/JSP/glue tests, dependencies, tooling cleanup or generic framework. JSP globals; klog only; CSS one physical line per selector. WS owns gameplay; gifts do not change gameplay/ESCROW/settlement/bot bankroll/progression/recipient CH.

## Reconciliation

The WS table ledger wrapper is specialized for table lifecycle. Use the canonical netlify/functions/_shared/chips-ledger.mjs::postTransaction with the same tx; current WS deployment already packages that ledger and root shared/poker-domain. No wrapper ledger extension or deployment configuration change needed.

## Rollout

Publishing supabase/migrations intentionally permits DB Stage Apply PR to create only empty receipts/indexes/RLS, with zero CH/data mutations. Prepare Production-equivalent schema and exhaustive manifest; do not apply Production. Exact runtime-SHA WS Preview Deploy and mandatory authenticated Stage smoke are required; pending smoke means not merge-ready.

The exhaustive migration guard scripts/check-db-migrations.mjs hardcodes inventory/category counts. Update only these counts for the required new manifest entry (54 missing, 33 needs-production-equivalent); this exact tooling change is required by T003, not cleanup.

T012 requires registering the two focused gift suites in scripts/test-all.mjs and classifying the two gift diagnostics in ws-server/poker/observability/poker-log-policy.mjs. Existing vitest-only tests/chips-ledger.test.mjs is not runnable with installed repo dependencies; extend the existing Node canonical-ledger suite tests/chips-ledger.human.buyin.unit.test.mjs instead. Receipt migration constraints/RLS/indexes are exercised with existing PGlite in the focused domain suite; external migration DB suite remains gated by CHIPS_MIGRATIONS_TEST_DB_URL. No new framework/dependency.

Gift table/seat row locks use NOWAIT: current gameplay persistence can project seats before updating table activity. Reject a contended gift transaction immediately rather than creating table→seat vs seat→table lock waits. This preserves required validation/atomicity without changing gameplay locking. DB clock_timestamp after buyer advisory lock enforces cooldown; SQL to_char(joined_at) preserves microseconds. Gift recovery/broadcast uses a short per-table cosmetic promise chain separate from the gameplay queue. Every purchase is followed by authoritative aggregate state; storage errors return no recovery frame (never false empty state).

Review correction: the existing seat protocol does not expose joined_at. Keep it private and broadcast current receipt aggregates to all table connections after every accepted authenticated join (including same-user rejoin). This clears old participation badges even when an observer missed the intermediate absence. Browser clears disappeared/changed owners locally; DB exact participation joins remain final authority. Recovery is scheduled without awaiting it on gameplay lifecycle paths, and resume recovery follows replay frames.

The canonical ledger import is lazy after DB availability/auth validation, matching existing shared-domain adapters and keeping file-backed WS startup compatible with WS-package-only CI dependencies. Deploy packages already include root shared/ledger/dependencies.

Review P1 correction: only new purchases broadcast table_gift. Exact replay is accepted with current table_gift_state and no animation. This is a minimal WS fanout guard; canonical ledger/receipt idempotency remains unchanged, with no outbox or delivery framework.

## Manual smoke amendment implementation

T012A–C modify only table-v2.html, poker-v2.js, poker-v2.css and accessible copy in i18n.js. Group ordinary buttons with aria-pressed and native Tab/Enter/Space; keep selections inside existing Gift Shop DOM, reuse renderSeatAvatar and getDisplayName, reconcile recipient buttons from state.seats without a player cache. Preserve focus by retaining existing buttons on normal sync. Selection changes reset giftRetry; pending disables choices/send. Guest control is visible/locked with aria-disabled and click guard; authenticated availability remains existing. T012D is blocked on #1048, with no badge layout change. Constitution Check: no new UI/CSS/JSP test suites, dependencies, configuration or migration changes. Browser Deploy Preview inspection is required; no WS redeploy for presentation-only changes. Final T013 smoke follows #1048 integration, T014 remains owner-gated.

Preview reconciliation for T012C: applySignedOutState previously left the whole screen behind the boot splash. Call existing markBootReady after resolving signed-out identity so the locked control and existing sign-in message can be seen. No auth/gameplay/WS change.

T012B occupant review correction: reconcile by seatNo + userId on recipient buttons, not seat alone. Remove the obsolete occupant button, clear its selection/uncertain retry, build a new button for the replacement. Normal sync retains the same occupant button/focus but replaces the avatar span with a fresh element before calling unchanged renderSeatAvatar, so profile/style/data cannot leak. Retry invalidation is limited to the replaced/removed target seat; another seat changing must not discard a requestId after uncertain transport. No payload/backend/player-model changes.

## T012E no-self / Quick Gift amendment

Live main verified at 4f798bdd56dba0e11b34e8982895650920ec6944; no seat HUD gift/quick-action slot exists on main or #1047, no related HUD implementation PR found, #1048 remains open. E2 and T012D stay BLOCKED on #1048; no dormant Quick Gift UI, overlay or speculative purchase refactor. E1: after ACTIVE sender/recipient resolution reject matching user_id with existing gift_target_unavailable before postTransaction; browser giftEligibleSeats excludes isCurrentUserSeat. Keep receipt-first idempotent lookup and cooldown ordering unchanged (historical paid receipt replay remains accepted/state-only with no new debit/event). Replace prior self-purchase success case with focused zero-call/zero-BURN/zero-receipt self-rejection test. Constitution Check: only fundamental domain tests; no UI/CSS/JSP/dependency/migration/tooling changes. Shared WS dependency changes require a new exact-SHA WS Preview deployment with installed metadata and health checks. Final authenticated T013 follows T012D + completed T012E; Production T014 remains owner-gated.


## 2026-10-08 — Main integration plan

Integrate main `d49c33fa` into existing #1047. Preserve both seat name/transient cleanup operations in `renderSeats()`; bind gifts to `renderedSeatHud[seatNo].gifts` instead of cached avatar badge nodes. Keep every main CSS rule and add only scoped gift presentation. Reuse main HTML layers and `hud.quickAction`; share one `sendSelectedGift()` helper with existing purchase handling. Keep targeted-reaction content and pointer interaction intact. Maintain occupant identity reconciliation, authoritative summaries and replay suppression.

Review `ws-server/server.mjs` and log policy after textual auto-merge for retained message payload/backlog security, reconnect, janitor and lifecycle. No accounting, protocol or applied Stage SQL change. Verify existing Production inventory and remove unrelated JSON Unicode escaping churn. Constitution Check PASS: fundamental existing tests only, no new UI/CSS/JSP suites/dependencies/configuration changes; JSP globals/klog/CSS constraints preserved. WS test startup detection requires `WS_POKER_LOG_LEVEL=INFO`, matching WS CI, because current main defaults to ERROR. Complete checks, review and exact runtime-SHA Preview deployment; leave authenticated smoke/Production GO pending.


## P1 — Retry recipient identity correction

In `poker/poker-v2.js`, `sendSelectedGift()` resolves current eligible recipient, stores userId with retry and aborts a mismatched occupant before reuse/send. `syncGiftOwners()` independently invalidates mismatched retry and clears its selected seat; `syncGiftShop()` invokes owner reconciliation and checks the eligible seat/user pair. Remove quick-target-dependent retry invalidation so the actual retry target remains authoritative. Preserve requestId for unchanged occupant and unrelated seat changes. Constitution Check PASS: browser-only minimal correction, no WS/protocol/DB/migration/dependency/CSS change; existing fundamental/browser/client suites and temporary controlled probe only. No new WS Preview deployment required because the existing WS implementation/protocol/configuration is unchanged; authenticated Stage acceptance and Production GO remain pending.


## Persistent Gift HUD correction plan / Constitution Check

Evidence: Stage read-only receipts show recipient_joined_at .124000 versus current seat .124309; postgres timestamp serializer passes strings through Date, truncating microseconds. Event then authoritative empty summary erases badge. Firefox controlled HUD shows data-backed slots render, but a stricter hit-test proves Quick Gift overlaps the third slot. Offset only the existing Quick Gift button ±20px toward the outer side; retain received anchors/scene geometry. Fix SQL insert parameter types in shared/poker-domain/gift-purchase.mjs (text→timestamptz), keep exact participation joins, and extend loadActiveGiftSummary with bounded newest receipt rows plus userId while retaining aggregate compatibility. Browser keeps three recent event entries independent of fly animation; state recovery replaces list and verifies occupant. Fundamental receipt/order/participation and WS replay/reconnect tests only; existing browser/client suites and temporary Chromium/Firefox probes. No UI test suite or migrations. Exact-SHA WS Preview Deploy required; authenticated Stage smoke conditional on available access; Production untouched.


## 2026-10-09 accepted correction — avatar action / tabletop receipts

Supersedes historical three-types/duplicate-counter/overflow presentation and the 2026-10-08 avatar-ring placement. Show three latest purchases newest-first, duplicate purchases as separate emoji objects; older purchases remain receipts. Legacy aggregate `gifts` stays compatible. Quick Gift belongs to the avatar edge, statically derived from avatar geometry/physical slot, outside its clipped element. Received gifts belong to a separate fixed tabletop anchor near stack/bet, for every slot including hero. Reuse existing quickAction/gifts/three slots and scene scaling; no runtime collision engine, observers, new dependencies or purchase/protocol/schema changes. Verify actual browser rectangles/screenshots across portrait/landscape, all seats/dealers and gameplay states.

Timestamp precision: modeled postgres-js/PGlite regression remains useful but is not real driver→PostgreSQL evidence. Read-only Stage receipt/seat equality and exact active summary recovery after a new-runtime purchase are required; if absent mark PENDING, never approximate historical identity or repair old receipts. Authenticated financial smoke and Production owner GO remain merge gates.

Coordinates are design-scene centres, transformed only by existing fitTableScene scaling:

| Physical slot | Quick portrait | Gifts portrait | Quick landscape | Gifts landscape |
|---|---|---|---|---|
| top | (136,39) | (88,162) | (530,-4) | (387,132) |
| upper right | (278,159) | (238,234) | (848,49) | (757,120) |
| lower right | (278,344) | (174,375) | (912,189) | (838,258) |
| hero | (196,484), hidden for self | (230,475) | (488,282), hidden for self | (342,199) |
| lower left | (84,394) | (117,440) | (153,169) | (193,266) |
| upper left | (84,231) | (118,260) | (288,49) | (283,178) |

Quick Gift button is 24×24, centre at avatar ±(radius+10), y−16; side depends only on physical slot. Three 22×22 gift slots use offsets (0,0),(12,5),(24,10), with reverse horizontal direction only for portrait top; newest has highest z-index. The shared quickAction remains at its previous 16×16 reaction anchor; placeSeatNode positions only the Gift button relative to it. Keep gifts container display:contents and existing anchor mechanism. No other scene coordinates change.


## 2026-10-09 P2 — Quick Gift touch target

Measured24-scene-px button: portrait390×844 ≈24.93 CSS px;landscape844×390 ≈19.11 CSS px;desktop1440×1000 ≈32.86 CSS px in Chromium/Firefox. Expand only transparent button padding outward/upward, retaining18-scene-px glyph and its exact fixed avatar-edge anchor. Derive target size from existing fitTableScene scale, aiming30 CSS px with existing24 scene px minimum; protect shared reaction/other controls and viewport clipping. If a physical slot cannot fit30, document actual safe bound rather than overlap another control. No purchase/retry/WS/shared/schema/config changes or new UI tests; temporary browser rectangles/hit samples/touch only. Existing authenticated smoke/ACTIVE recovery/Production schema GO gates remain pending.

Implementation: fitTableScene publishes max(24,30/scale) in existing screen CSS scope. configureSeatHud retains quickGiftPoint and shared reaction anchor, chooses outward padding direction, caps northern landscape height32 scene px (24px existing top reserve +8px button bottom). syncQuickGifts uses placeSeatNode without overriding CSS dimensions. Asymmetric transparent button padding/transform keeps its original24×24 content rectangle/18px emoji stationary, extends outward and upward only. No extra DOM children or positioning layers. The northern landscape30×25.48 CSS px result is intentional; full30px height would be clipped outside viewport.


## 2026-10-09 manual FAIL — portrait S6 proximity / hero visual demo

Manual smoke FAIL: S6 gifts too far from avatar in portrait; hero gifts lack convenient on-device inspection. Seat numbers rotate relative to hero: resolve physical slot using rotateSeatIndex→seatPhysicalSlot, not S6 hardcoding. For six seats/heroS1,S6 is physical lower-right(slot2); manual hero/seat-count clarification requested. Change only the relevant portrait gifts anchor after mapping confirmation; preserve all Quick Gift anchors/hitboxes and landscape.

Extend existing gated bindCelebrationPreview with one unchecked,non-persisted checkbox “Show demo gifts on hero — DEMO / Visual only”. One local identity-bound state; renderGiftBadges selects beer/pizza/whisky only for actually occupied hero. Reuse three hud.gifts slots/geometric placement; mark visible hero name DEMO while active. Never mutate giftsBySeat/giftOwners/giftEventIds, create event IDs/receipts or call purchase/WS/backend. Turning off shows current real data. Clear on leave/table/user/seat changes and reconnect/recovery (participation boundary not exposed publicly); ordinary seat/hand renders retain demo. No changes to other players.

Constitution: existing fundamental checks and temporary browser probes only,no committed UI/CSS suite,backend/protocol/schema/dependency/inline-script changes or WS deployment. Draft/manual FAIL remains until authenticated acceptance; ACTIVE recovery and Production GO pending.

## 2026-10-09 follow-up smoke — hero gifts / dealer / purchase diagnostics

Manual portrait/landscape layout remains FAIL. Correct portrait hero anchor slightly left/down, landscape hero above left best-hand cards and left of stack; shift landscape woman dealer left, retaining DOM-derived card-flight source. Helena mapping is pending screenshots absent from request; do not guess her seat/physical slot. Preserve Quick Gift/reaction hitboxes, demo lifecycle, receipt ordering/economy/protocol.

Purchase investigation: deriveCurrentSeat can fabricate ACTIVE from stale youSeat; Gift Shop must require an actual occupied current-user seat, rejecting LEFT/INACTIVE/EMPTY. Reconnect/WS guards are expected safety gates; log attempted blocked sends and rejected purchases with table/target/code/readiness/reconnect/seat status via klog. Keep retry/requestId rules unchanged; reuse existing reconnect translation for ws_closed/ws_unavailable. No runtime WS change/deploy. Stage journal access attempt denied, so ee710913 incident cause not established.

Constitution: existing fundamental tests/repo checks and temporary browser probes only. No new UI/CSS tests, dependencies, inline scripts, schema/backend/protocol changes. Required screenshots and authenticated acceptance remain pending, as do ACTIVE recovery/Production GO.

## 2026-10-09 confirmed smoke mapping — Helena portrait

User confirms maxSeats6,heroS4,HelenaS3,S6empty. Zero-based Helena index2/hero index3 gives rotateSeatIndex=(2−3+3+6)%6=2; seatPhysicalSlot(2,6)=2 (lower-right). Supersedes earlier unconfirmed S6 interpretation/missing mapping. Change ONLY portrait.seats[2].gifts [174,375]→[290,440], fixed three-item offsets unchanged. Preserve all accepted hero/dealer/drawing-source/readiness/demo changes and Quick Gift/reaction anchors/hitboxes. Verify actual published Preview in Chromium/Firefox portrait390×844 with Helena three gifts,heroS4,S6empty,active action bar,all dealer positions/playing/showdown; landscape844×390 regression. Existing fundamental tests/checks only,no UI/CSS tests/dependencies/inline scripts/protocol/economic changes. ee710913 incident cause remains unconfirmed; next rejection code/klog required. No WS redeploy/Production/merge; Draft and authenticated Stage/ACTIVE recovery/Production GO gates unchanged.

## 2026-10-09 remaining smoke FAIL — Quick Gift Picker / landscape upper-right

Quick Gift menu (not main Gift Shop) must use dark16251f/gold725735/radius12,recipient header,six catalog cards2×3,separate emoji/name/CH price,minimum44×44CSSpx unscaled after scene fitting,one-tap shared sendSelectedGift. Preserve trigger hitboxes/reaction and focus/Escape/pending/disabled. Existing picker element may be locally hosted under body/fixed viewport to avoid transformed-scene clipping,with explicit cleanup on seat rerender and local placement bounded above active action bar; no global popover system/framework.

Landscape only slot1 gifts:desired whole group right of stack/name-below/right ofD/outside adjacent lower-right HUD. Measure actual DOM for all three staggered22px slots. If incompatible document exact obstruction,keep other anchors fixed and propose nearest safe variant for user acceptance,do not falsely reportPASS. No portrait/other landscape/dealer/rotation/economic/protocol changes.

Constitution:existing fundamental tests/repo/syntax/CSP and temporary probes only,no permanent UI/CSS tests/dependencies/inline scripts/endpoints/migrations. Smoke staysFAIL until owner acceptance;authenticatedStage/ACTIVErecovery/ProductionGO pending;noWSredeploy/Production/merge.

## Landscape-only follow-up — upper-right chips/gifts and top regular reaction

User supersedes prior whole-group-right-ofD criterion. Scope only landscape slot1.stack+gifts and landscape slot0 ordinary reaction positioning. Aim smallest right/down stack move and gift move right/nearstack with whole staggered group/CH label clear. If incompatible,select nearest safe variant and document exact deviation;do not move neighbors,bet/avatar/D/cards/name/portrait. Ordinary top reaction must anchor to avatar (above if space or on upper avatar otherwise),not compactTransient/presentation. Preserve presentation/targeted reactions/timing/owner cleanup/reduced motion;existing chip animation uses updated renderedSeatStackAnchors.

Constitution:temporary DOM-bounds/browser probes,existing fundamental tests/guards/syntax/CSP only,no UI/CSS suite/dependencies/inline scripts/backend/WS/schema/economy/picker/trigger changes. Manual smokeFAIL until owner acceptance;authenticatedStage/ACTIVErecovery/ProductionGO pending. NoWSredeploy/Production/merge.

Implement only slot1 stack/gifts constants and a physical-slot0 landscape branch in `renderRegularReactionBubble()`. Reuse `placeSeatNode()` and the existing transient layer; construct full bubble/float before computing height, then clamp the above-avatar top against the visible scene viewport/topbar with 4 CSS px margin. Clear special node anchor/styles on orientation/physical-slot change. Existing `renderSeatChips()` derives `renderedSeatStackAnchors` from `hud.config.stack`; settlement flights continue to resolve this updated anchor, with no animation/gameplay changes. Chosen coordinates and directional/large-label limitations are in review.md.


## Follow-up — upper-right gifts and Quick Gift outside pointerdown

Manual smoke remains FAIL. Candidate landscape physical slot1 gifts[883,173], retaining stack[820,154] and every other anchor, portrait, reaction and chip layout. Verify all three22×22 objects with (+12,+5), decoded chips/CHlabel/name/D/bet/cards/neighbor HUD. If it collides, nearest safe first-item center in x860–910/y150–190; if none retain[782,192] and document FAIL. Whole-group-right-ofD is not required.

One document pointerdown listener registered once in bindGiftShop(): if quickGiftTarget===null return; ignore open picker descendants and any Quick Gift trigger; otherwise clear only quickGiftTarget and syncQuickGifts(). No propagation/default suppression, overlay, retry/pending/purchase cancellation or main Gift Shop behavior change. Preserve trigger toggle/switch/Escape focus and lifecycle. Constitution: existing fundamental tests/guards/syntax/CSP plus temporary published Chromium/Firefox probes only; no persistent UI/CSS tests, dependencies, inline scripts, WS/backend/schema/economy changes. Draft/manual owner FAIL and authenticated Stage/ACTIVE recovery/Production GO gates remain. No WS redeploy, merge or Production.

Retain slot1 gifts `[782,192]` after candidate bounds identify the lower-right Quick Gift obstruction across the whole permitted region. Only runtime edit is the six-line document pointerdown listener in `bindGiftShop()`. Validate pending outside-close without clearing retry, uncertain transport same-request retry, rerender listener count, reconnect/resize/Escape/focus and main shop independence. Report relocation FAIL separately from outside-close implementation verification.

## 2026-10-09 accepted implementation / final handoff

Owner manual smoke **PASS**, UI/Quick Gift/current layout and ACTIVE reconnect/refresh recovery accepted. Preserve landscape slot1 gifts `[782,192]`. Read-only Stage:7 Coffee receipts/70 CH,7 correct BURN,14 entries,zero discrepancies; exact recipient timestamp .046715 preserved. See review.md latest evidence matrix and T013/T014/T015 preflight, which supersede historical FAIL/PENDING notes without deleting history. No runtime/UI/WS/schema changes.

T013 partial: baseline authenticated smoke and ACTIVE recovery cleared; original mandatory manual premium/human-bot,self-target,insufficient-CH,retry,cooldown,leave/rejoin,reduced-motion and gameplay/settlement cases need specific evidence or explicit owner amendment (automated coverage recorded separately). T014 preflight COMPLETE: existing Production-equivalent migration sufficient; Production table/version absent; STOP before separate schema GO/apply/postflight. T015 review prepared,conditional HOLD; Draft,no merge/Production action.

## 2026-10-09 final acceptance

T013 **PASS**: owner final manual smoke PASS; remaining manual-case requirement explicitly replaced by accepted existing automated evidence. No additional manual tests required. T014 **PASS**: Production schema deployed and independently checked read-only (14 columns,9 constraints,4 valid indexes,RLS/no client access,0 receipts,version recorded). T015 **PASS**,technical merge gates satisfied; current-head CI/Preview to be verified after this docs-only commit. See review.md final entry and linked schema postflight. Supersedes historical HOLD/FAIL/PENDING notes. No implementation/migration/deploy change; no merge or Production runtime authorization.
