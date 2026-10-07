# #1049 — final review state

## Final scope and decisions

Existing Poker V2 runtime with approved premium portrait/landscape presentation and six deterministic physical HUD variants. Compact CH Total/Poker chrome replaces table XP; technical text and Preview-only FX live in existing Settings Diagnostics. Gift integration provides three external received slots, one avatar-edge quick slot and avatar-center motion endpoints only; purchase behavior remains in #1047.

Cards, dealer, keyed chip and avatar images retain persistent scene ownership; partial same-hand omission cannot erase valid known presentation. Explicit authoritative values and genuine hand/seat/identity boundaries still apply. High transient layer keeps payout/best-hand/reactions above chips; Hero special celebration remains dedicated. Full human/bot reaction words wrap between words within scene-safe bounds. Existing actions/gameplay/privacy/settlement authority remains WS.

## Cleanup self-review

Final cleanup removes all feature PNG/history JSON plus unreferenced v1 room/dealer artwork. Source search found no runtime/test v1 references before deletion. Only four SpecKit Markdown documents remain; they record final contract and gates rather than superseded pass journals. Iteration history is preserved on live #1048/#1049 and in Git history.

Accepted poker-v2.js/CSS/table HTML, v2 artwork, scoped XP guard and fundamental tests are unchanged by cleanup. No new logging, inline script, dependency, protocol/backend/config change, WS deployment or Production action. Byte identity against pre-cleanup HEAD is confirmed for JS/CSS/HTML, v2 artwork, guard and tests; final PR diff is 12 files (was 118). Removed 86 PNG, 18 historical JSON and two unused v1 assets: 32,276,492 bytes / 30.78 MiB from the final tree; Git history is retained.

## Verification and gates

Cleanup deployable SHA: `b4c9aa6d98dbf5d36858c4642ab0221b113e23fa`. Fresh focused tests 127/127, syntax/check:all/ci:guards/CSP/diff checks PASS. Full cleanup-SHA CI PASS: Tests/core/Playwright/persistence run 37588398974, WS harness 37588399019, guards 37588398904 and remaining validation/CodeQL. Final documentation-only HEAD checks remain visible on PR #1049.

Real Deploy Preview BUILD_INFO matched the exact cleanup SHA. Minimal controlled public-state sanity at 390×844 and 844×390: both v2 assets byte-match/decode/load, scrollWidth=clientWidth and scrollHeight=clientHeight, reaction/chat open by click and actions have available hit targets. External Netlify collaboration drawer was excluded from product checks; no product behavior change. No new screenshots, JSON collection, broad smoke or geometry matrix. Later Markdown-only changes do not invalidate this deployment check.

Controlled Preview evidence is not authenticated Stage verification or owner acceptance. PR remains Draft/not merge-ready for final owner review and authenticated Stage CH gate. Never merge.

## Breaking impact

Overall PR: significant visual Poker Table HUD/premium composition changes, compact opponent indicators/chrome and CH replacing table XP. No API/gameplay/WS/ledger/settlement/XP-outside-table contract change. Cleanup itself has no runtime behavior or accepted-layout change; only unused assets and historical review files leave the deployable tree.
