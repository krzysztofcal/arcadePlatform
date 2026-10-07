# #1048 — final tasks

## Implemented

- [x] T001 Reconcile live requirements and replace rejected panel/grid layouts with one existing renderer and deterministic physical variants.
- [x] T002 Approved premium portrait/landscape composition, perimeter equal-size avatars, fixed compact chrome, protected center, Hero best hand and lower-right controls; one viewport.
- [x] T003 Stable three gift slots/quick-action slot and avatar-center endpoints without gift purchase behavior.
- [x] T004 CH Wallet/Poker badge (independent Wallet, Poker only for inPoker + positive valid all-table sum; hide zero/empty/error/invalid) with existing ChipsClient, document + authoritative own-seat/stack transition refresh, wallet pulse, identity/generation and unavailable guards; remove table-only XP.
- [x] T005 Authoritative Hero deal presentation across transient same-hand projections/auth/reconnect; real lifecycle clears.
- [x] T006 Persistent keyed chip/dealer/avatar nodes, partial-frame semantics and correct new-hand/explicit transitions.
- [x] T007 High player-transient ownership, full human/bot words, anchored shake, contextual targeted Nice hand and dedicated Hero special celebration.
- [x] T008 Fresh JOIN waiting presentation, Preview-only Diagnostics FX and meaningful statuses/OPEN/compact participation indicators.
- [x] T009 Existing fundamental regressions and required checks; narrow Preview verification of implementation.

## Final cleanup

- [x] C001 Confirm v1 assets have no runtime/test references; remove unused v1 assets and all feature PNG/history JSON.
- [x] C002 Consolidate four SpecKit documents to final contract; remove dead evidence references and historical pass journals. Accepted runtime/UI unchanged.
- [x] C003 Fresh focused/required checks and full CI; exact cleanup-SHA Deploy Preview portrait/landscape minimal sanity.
- [x] C004 Final review/handoff with changed-file counts, removed bytes, checks and cleanup SHA on GitHub.

## Remaining gates

- [ ] G001 Owner final review/manual acceptance; PR stays Draft and not merge-ready.
- [ ] G002 Actual authenticated Stage CH verification.

No merge or Production deploy/mutation. Historical iteration details remain on live #1048/#1049 and in Git history, not additional repository evidence files.

## Player-name stacking contract

Both orientations preserve felt/normal seat UI < static chips < player names < chip FX/player notifications/reactions/celebrations. Only names use the scene-owned name layer (z-index 5), between static chips (4) and effects (12/20/100). Existing avatar/seat layer (3), name anchors, widths, font sizes and folded opacity remain unchanged; 20px portrait/26px landscape line-height and min-height prevent descender clipping without moving those anchors. No new UI/CSS/glue tests; reuse existing checks and narrow portrait/landscape Preview visual smoke.

## Portrait room event lines

Portrait bottom status is text-only with fully transparent background; preserve the same viewport-owned node, box, width/font/bottom/text source and lifecycle. Restore pre-bounded-footprint Hero card outer shadow, avatar paint (no added clipping) and14-scene-px lift only at portrait max-height:820px. No card size/rotation/horizontal-center, seat geometry, center event, action bar, names or landscape changes. Transparent status paint replaces the rejected bounded-shadow/gradient-inset approach; no visual-gap workaround, dynamic layout, new state or backend/WS change.

- [x] G003 Apply owner-approved short-portrait Hero-card lift 5→9 scene px only; retain bottom:0 and all other geometry. Verify exact-SHA Preview clipping, overlap and no-scroll acceptance.

- [x] G004 Move portrait status to visible scene viewport; preserve landscape and verify card-lift necessity. Narrow exact-runtime Preview verification; physical owner Android smoke remains required.

- [x] G005 Increase only short-portrait Hero-card lift9→14 scene px after rotated-card bounds show13px insufficient at320×640. Preserve owner-approved status anchoring and all other presentation.

- [x] G006 Measure card-shadow and upper-HUD budgets; supersede unsafe14px lift with bounded portrait paint footprints and8px short-portrait lift. Preview acceptance includes painted background, name/avatar clearance, no scroll and unchanged landscape.
- [ ] G007 Physical owner smoke of bounded-footprint correction; authenticated Stage CH gate remains pending.

- [x] G008 Restore original card/avatar paint and14px short-portrait lift; make only portrait bottom-status background fully transparent. Bounded-footprint iteration rejected by physical owner smoke.
