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

Portrait bottom status is the same persistent roomStatus element, reparented by fitTableScene() to pokerSceneViewport; landscape retains scene ownership. bottom:0 uses the untransformed clipping viewport, with scene-equivalent typography and a safe gap before unchanged actions. Center event, names and actions are unchanged. Retain short-portrait 9-scene-px Hero-card lift: removing it demonstrably overlaps status (6.78px at320×640,8.17px at390×760); tall portrait/landscape cards remain unchanged. No negative bottom or scene-relative status compensation.

- [x] G003 Apply owner-approved short-portrait Hero-card lift 5→9 scene px only; retain bottom:0 and all other geometry. Verify exact-SHA Preview clipping, overlap and no-scroll acceptance.

- [x] G004 Move portrait status to visible scene viewport; preserve landscape and verify card-lift necessity. Narrow exact-runtime Preview verification; physical owner Android smoke remains required.
