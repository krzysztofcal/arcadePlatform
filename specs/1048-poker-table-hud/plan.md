# Implementation plan

## Constitution check
Only existing checks and focused fundamental tests. No new UI/CSS/JSP tests, dependencies, framework, generic configuration or cleanup. Visual evidence comes from real Deploy Preview. Browser-only changes require no WS deploy. No inline scripts; existing CSP hashes stay unchanged.

## Design
- `poker/poker-v2.js::renderSeats`: grid seat articles with bounded identity, portrait/dealer/quick-action, cards, stack/bet, presentation, social and three gift areas. DOM mounts keep current render semantics and authoritative values. Measure actual layout for existing chip animation anchors.
- `positionHeroCards`, `renderDealerChip`, `renderSeatChips`, reaction rendering: mount into explicit areas instead of independent offset geometry.
- `poker/poker-v2.css`: replace conflicting seat/scene geometry with a single responsive grid; header and controls in document flow. Narrow screens may scroll vertically rather than clip/overlap.
- `table-v2.html`: remove XP badge and its five unused scripts; load existing ChipsClient, no topbar.
- Account HUD uses only fetchBalance/fetchPokerProjection, excludes current tableId, hides immediately for guests/sign-out, rejects stale asynchronous responses, displays neutral unavailable values on failed reads. chips:tx-complete shares this refresh path.
- Remove only obsolete ChipsClient prohibition in existing static HTML assertion.

## Integration
Each seat article carries data-seat-no and data-user-id. Three data-poker-gift-slot children in data-poker-gift-slots; one data-poker-quick-action-slot. Both outside avatar, rebuilt on render, occupant-scoped. #1047 must reconcile/repopulate after render; purchase/target behavior remains there.

## Reconciliation corrections
The global XP checker requires a badge even where its config excludes Poker Table. Add a single exact-path exemption in scripts/check-xpbadge.js. Two existing CSS assertions require the removed fixed action rail and targeted reaction offsets; remove these obsolete assertions rather than add new UI tests. No broader checker or test changes.

Existing Poker V2 checks are required by WS PR validation despite this change being browser-only. Adapt existing descendant selectors and DOM move emulation to semantic containers, retain fundamental snapshot/reconnect/card privacy/stack/settlement/reaction behavior assertions, and remove obsolete pixel offsets/chip-art/XP navigation assertions. No new presentation tests.
