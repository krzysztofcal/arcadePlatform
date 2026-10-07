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

Both orientations preserve felt/normal seat UI < static chips < player names < chip FX/player notifications/reactions/celebrations. Only names use the scene-owned name layer (z-index 5), between static chips (4) and effects (12/20/100). Existing avatar/seat layer (3), name coordinates, sizing and folded opacity remain unchanged. No new UI/CSS/glue tests; reuse existing checks and narrow portrait/landscape Preview visual smoke.

## Portrait room event lines

Portrait exposes the same existing roomEvent/roomStatus sources as landscape: one short centered felt event line and one short bottom-left status line. Only portrait overlay CSS changes; table/seat/name/chip/card/action/chrome geometry and landscape styles are unchanged. Preserve existing event timer, localized player-facing messages and hidden semantics; no debug logs, new state/source, backend or protocol. Use narrow real portrait/landscape Preview smoke and existing checks, no new UI/CSS/glue tests or repository screenshot artifacts.
