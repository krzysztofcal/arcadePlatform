# #1049 — final review state

## Final scope and decisions

Existing Poker V2 runtime with approved premium portrait/landscape presentation and six deterministic physical HUD variants. Compact CH Total/Poker chrome replaces table XP; technical text and Preview-only FX live in existing Settings Diagnostics. Gift integration provides three external received slots, one avatar-edge quick slot and avatar-center motion endpoints only; purchase behavior remains in #1047.

Cards, dealer, keyed chip and avatar images retain persistent scene ownership; partial same-hand omission cannot erase valid known presentation. Explicit authoritative values and genuine hand/seat/identity boundaries still apply. High transient layer keeps payout/best-hand/reactions above chips; Hero special celebration remains dedicated. Full human/bot reaction words wrap between words within scene-safe bounds. Existing actions/gameplay/privacy/settlement authority remains WS.

## Cleanup self-review

Final cleanup removes all feature PNG/history JSON plus unreferenced v1 room/dealer artwork. Source search found no runtime/test v1 references before deletion. Only four SpecKit Markdown documents remain; they record final contract and gates rather than superseded pass journals. Iteration history is preserved on live #1048/#1049 and in Git history.

Accepted poker-v2.js/CSS/table HTML, v2 artwork, scoped XP guard and fundamental tests are unchanged by cleanup. No new logging, inline script, dependency, protocol/backend/config change, WS deployment or Production action. Verify byte identity and final file list at handoff.

## Verification and gates

Fresh existing focused tests, syntax/check:all/ci:guards/CSP/diff checks and full CI are required for cleanup. Because asset removal changes deployment contents, verify the exact cleanup SHA on real Deploy Preview and perform only minimal portrait/landscape sanity: v2 artwork loads, no page scroll and action/reaction/chat controls usable. Final run results/SHA are recorded on live GitHub rather than a new evidence collection.

Controlled Preview evidence is not authenticated Stage verification or owner acceptance. PR remains Draft/not merge-ready for final owner review and authenticated Stage CH gate. Never merge.

## Breaking impact

Overall PR: significant visual Poker Table HUD/premium composition changes, compact opponent indicators/chrome and CH replacing table XP. No API/gameplay/WS/ledger/settlement/XP-outside-table contract change. Cleanup itself has no runtime behavior or accepted-layout change; only unused assets and historical review files leave the deployable tree.
