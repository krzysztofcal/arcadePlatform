# #1048 — final implementation plan

## Scope and constitution

Refine the existing Poker V2 renderer/assets; no second runtime, purchase flow, backend/WS/protocol/config, dependency or unrelated cleanup. Tests remain fundamental; visual checks use narrow external Preview fixtures, not repository UI/CSS/JSP suites.

## Implementation

- poker/poker-v2.js: renderSeats/configureSeatHud reuse six physical seatSceneGeometry variants, viewport composition scaling and occupant-scoped avatar/image reuse. Scene owns hero cards, dealer and keyed seat stack/bet/pot nodes; mergeSnapshot respects partial-field presence and lifecycle boundaries. Common high transient ownership preserves payouts/reactions above chips. Targeted effects use avatar centers.
- poker/poker-v2.css: approved portrait/landscape premium composition, equal occupied avatars, protected center lane, horizontal landscape controls, readable best-hand and full normal-word reaction wrapping with bounded inward edge offset. CSS declarations stay one physical line per selector.
- poker/table-v2.html: existing scene/chip/transient layers, compact chrome, existing Settings Diagnostics, ChipsClient and stable gift/quick anchors. Preview FX uses existing environment signal only in Diagnostics.
- Account HUD: authoritative wallet/projection reads, Total/Poker compact values, document transaction refresh, identity/generation guards and reduced-motion-aware wallet pulse. No balance cache/local purchase deduction.
- scripts/check-xpbadge.js and existing tests: retain scoped XP badge exclusion and obsolete static assertion update; fundamental lifecycle/ownership/privacy/CH checks only.

## Cleanup before review

Confirm no runtime/test references to casino-room-v1.svg or dealer-v1.webp, then remove those unused artifacts. Remove all feature PNG and historical evidence JSON; keep only four final SpecKit Markdown documents. Do not modify accepted JS/CSS/HTML, v2 assets or tests during cleanup. Preserve detailed history in live #1048/#1049 and Git history; no replacement evidence collection.

## Verification and handoff

Existing focused tests plus syntax, check:all, ci:guards, CSP and diff checks; full GitHub CI. Verify final changed-file list and runtime byte identity against pre-cleanup HEAD. New exact cleanup SHA must be served by Deploy Preview because deleted scene assets change deployable contents. Minimal portrait/landscape sanity only: v2 room/dealer load, whole table/no scroll and action/reaction/chat targets work. No repeated matrix or broad owner smoke. Record final outcome on GitHub; no screenshots/evidence JSON in repository.

Keep Draft for final owner review and authenticated Stage CH gate. Browser-only cleanup needs no WS deployment, database mutation or Production action. Gift #1047 consumes existing external three slots, avatar-edge quick slot and avatar-center endpoints after #1048 integration.
