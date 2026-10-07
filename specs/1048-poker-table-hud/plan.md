# #1048 — final implementation plan

## Scope and constitution

Refine the existing Poker V2 renderer/assets; no second runtime, purchase flow, backend/WS/protocol/config, dependency or unrelated cleanup. Tests remain fundamental; visual checks use narrow external Preview fixtures, not repository UI/CSS/JSP suites.

## Implementation

- poker/poker-v2.js: renderSeats/configureSeatHud reuse six physical seatSceneGeometry variants, viewport composition scaling and occupant-scoped avatar/image reuse. Scene owns hero cards, dealer and keyed seat stack/bet/pot nodes; mergeSnapshot respects partial-field presence and lifecycle boundaries. Common high transient ownership preserves payouts/reactions above chips. Targeted effects use avatar centers.
- poker/poker-v2.css: approved portrait/landscape premium composition, equal occupied avatars, protected center lane, horizontal landscape controls, readable best-hand and full normal-word reaction wrapping with bounded inward edge offset. CSS declarations stay one physical line per selector.
- poker/table-v2.html: existing scene/chip/transient layers, compact chrome, existing Settings Diagnostics, ChipsClient and stable gift/quick anchors. Preview FX uses existing environment signal only in Diagnostics.
- Account HUD: authoritative wallet/projection reads, Wallet/Poker compact values, document transaction refresh, identity/generation guards and reduced-motion-aware wallet pulse. Wallet comes only from fetchBalance, Poker from all projection table stacks including current. Reuse topbar visibility: inPoker === true plus valid sum > 0. Empty/zero/error/invalid projection hides Poker; loading shows Wallet only. Projection failure leaves successful Wallet and its availability title intact. processSnapshotFrame compares current seat/remaining stack around accepted merge and triggers refreshAccountHud only on own exposure change (JOIN, leave/cash-out, rebuy/own stack); no poll or local aggregate. No combined total, balance cache/local purchase deduction.
- scripts/check-xpbadge.js and existing tests: retain scoped XP badge exclusion and obsolete static assertion update; fundamental lifecycle/ownership/privacy/CH checks only.

## Cleanup before review

Confirm no runtime/test references to casino-room-v1.svg or dealer-v1.webp, then remove those unused artifacts. Remove all feature PNG and historical evidence JSON; keep only four final SpecKit Markdown documents. Do not modify accepted JS/CSS/HTML, v2 assets or tests during cleanup. Preserve detailed history in live #1048/#1049 and Git history; no replacement evidence collection.

## Verification and handoff

Existing focused tests plus syntax, check:all, ci:guards, CSP and diff checks; full GitHub CI. Verify final changed-file list and runtime byte identity against pre-cleanup HEAD. New exact cleanup SHA must be served by Deploy Preview because deleted scene assets change deployable contents. Minimal portrait/landscape sanity only: v2 room/dealer load, whole table/no scroll and action/reaction/chat targets work. No repeated matrix or broad owner smoke. Record final outcome on GitHub; no screenshots/evidence JSON in repository.

Keep Draft for final owner review and authenticated Stage CH gate. Browser-only cleanup needs no WS deployment, database mutation or Production action. Gift #1047 consumes existing external three slots, avatar-edge quick slot and avatar-center endpoints after #1048 integration.

## Player-name stacking contract

Both orientations preserve felt/normal seat UI < static chips < player names < chip FX/player notifications/reactions/celebrations. Only names use the scene-owned name layer (z-index 5), between static chips (4) and effects (12/20/100). Existing avatar/seat layer (3), name anchors, widths, font sizes and folded opacity remain unchanged; 20px portrait/26px landscape line-height and min-height prevent descender clipping without moving those anchors. No new UI/CSS/glue tests; reuse existing checks and narrow portrait/landscape Preview visual smoke.

## Portrait room event lines

Portrait bottom status is text-only with fully transparent background; preserve the same viewport-owned node, box, width/font/bottom/text source and lifecycle. Restore pre-bounded-footprint Hero card outer shadow, avatar paint (no added clipping) and14-scene-px lift only at portrait max-height:820px. No card size/rotation/horizontal-center, seat geometry, center event, action bar, names or landscape changes. Transparent status paint replaces the rejected bounded-shadow/gradient-inset approach; no visual-gap workaround, dynamic layout, new state or backend/WS change.
