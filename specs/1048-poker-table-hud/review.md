# #1049 — final review state

## Final scope and decisions

Existing Poker V2 runtime with approved premium portrait/landscape presentation and six deterministic physical HUD variants. Compact CH Wallet/Poker chrome replaces table XP; technical text and Preview-only FX live in existing Settings Diagnostics. Gift integration provides three external received slots, one avatar-edge quick slot and avatar-center motion endpoints only; purchase behavior remains in #1047.

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

## Current account-label correction

Matches global/lobby topbar: Wallet: <wallet> CH comes exclusively from fetchBalance. Append Poker: <all authoritative table stacks> CH, including current, only for projection.inPoker === true and a positive valid sum. Empty/zero/unavailable/invalid projection hides Poker rather than rendering 0 or unavailable. Loading renders only Wallet; projection failure cannot change a successful Wallet or its availability title. No combined Total/Other tables.

Existing ChipsClient independent allSettled outcomes, identity/generation guards, document transaction refresh, valid-wallet pulse and guest behavior remain. Owner JOIN smoke on bd0dd650 failed because a pre-JOIN projection had no later WS-triggered refresh. processSnapshotFrame now compares own merged seat/remaining stack before/after an accepted frame and refreshes on meaningful own exposure changes, not unrelated snapshots. Aggregate amounts still come only from fetchPokerProjection; normal leave navigates to existing lobby refresh, and a retained-page authoritative seat-loss snapshot refreshes the table HUD. No poll, second cache or local sum. The current runtime diff adds only that accepted-frame lifecycle trigger; no CSS/HTML/layout/backend/service change. Existing fundamental sumPokerTableStacks regression retained; no new UI/glue tests or evidence artifacts. Narrow controlled Preview covers positive, zero/empty/error/invalid/inPoker-false and Wallet independence. Required results/latest SHA tracked on live #1048/#1049. Breaking impact: optional Poker segment follows existing topbar semantics, no accounting mutation. Draft and authenticated Stage gate remain.

## Player-name stacking correction

Names previously inherited the seat layer stacking context (3), below static chips (4); a child z-index alone could not escape it. A name-only scene layer (5) now preserves the existing coordinates and folded ancestor styling while leaving avatars/seat UI at 3 and all FX/notifications at their existing higher levels. Existing fundamental and multiplayer harness name lookups follow scene ownership, retaining their assertions; no new UI tests, geometry, assets, effect behavior, WS/backend or accounting changes. Breaking impact: overlapping names now paint over static chips as requested; no functional contract change. Current SHA/checks/Preview outcome are recorded on live #1048/#1049. Draft/owner smoke/authenticated Stage CH gates remain.

## Portrait event-line parity

Both existing message nodes and localized runtime sources already rendered in both orientations; CSS hid them in portrait. Three portrait-only rules now expose the center event overlay (scene x110/y386, width140) and bottom-left status (x8/bottom4, width94), preserving the event hidden flag and timer. No JS, HTML, geometry, state/accounting/gameplay/backend/WS, asset, notification ownership or landscape change. Existing checks plus narrow real Deploy Preview validate visible messages, no scroll and no center/cards/actions overlap; final SHA/results are on live #1048/#1049. Breaking impact: portrait now shows the same player-facing event/status messages, visual only. Draft/owner smoke/authenticated Stage gate remain.
