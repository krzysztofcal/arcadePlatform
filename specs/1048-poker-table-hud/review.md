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

Existing ChipsClient independent allSettled outcomes, identity/generation guards, document transaction refresh, valid-wallet pulse and guest behavior remain. Owner JOIN smoke on bd0dd650 failed because a pre-JOIN projection had no later WS-triggered refresh. processSnapshotFrame now compares own merged seat/remaining stack before/after an accepted frame and refreshes on meaningful own exposure changes, not unrelated snapshots. Aggregate amounts still come only from fetchPokerProjection; normal leave navigates to existing lobby refresh, and a retained-page authoritative seat-loss snapshot refreshes the table HUD. No poll, second cache or local sum. The account lifecycle correction added only that accepted-frame lifecycle trigger; no CSS/HTML/layout/backend/service change. Existing fundamental sumPokerTableStacks regression retained; no new UI/glue tests or evidence artifacts. Narrow controlled Preview covers positive, zero/empty/error/invalid/inPoker-false and Wallet independence. Required results/latest SHA tracked on live #1048/#1049. Breaking impact: optional Poker segment follows existing topbar semantics, no accounting mutation. Draft and authenticated Stage gate remain.

## Player-name stacking correction

Names previously inherited the seat layer stacking context (3), below static chips (4); a child z-index alone could not escape it. A name-only scene layer (5) now preserves the existing coordinates and folded ancestor styling while leaving avatars/seat UI at 3 and all FX/notifications at their existing higher levels. Existing fundamental and multiplayer harness name lookups follow scene ownership, retaining their assertions; no new UI tests, geometry, assets, effect behavior, WS/backend or accounting changes. Breaking impact: overlapping names now paint over static chips as requested; no functional contract change. Current SHA/checks/Preview outcome are recorded on live #1048/#1049. Draft/owner smoke/authenticated Stage CH gates remain.

## Final portrait messages and name clipping correction

Owner smoke of SHA 7c09b1ae was FAIL; previous agent fixture PASS is not owner acceptance. Existing localized roomEvent/roomStatus sources and their timer/hidden semantics remain. Portrait center line uses its existing x110/y386/width140 and notification level20 so active text is above normal seat/chip/name layers. Landscape message behavior is unchanged.

Status width still ends with an 8px gap before unchanged action controls. Normal tall portrait keeps bottom=-10 scene px and unchanged Hero cards. Height-constrained portrait <=820px uses bottom:0, keeping the complete background/text inside the scene and parent clipping bounds. The previous negative4px extension was insufficient: window-only visibility did not establish visibility within clipping ancestors. Moving only status first reproduced overlap with actual rotated card elements on 320×640 and 390×760; the permitted 5-scene-px Hero card lift is restricted to the same breakpoint. Size, rotation, horizontal center and card ownership are unchanged. No seat/table/action/chrome relocation.

Names previously had 14px/20px containers while descender glyphs reached 16px/21.5px in controlled browser font measurements. Line-height/min-height20px portrait and26px landscape enclose g/j/p/q/y with margin while preserving font, width, anchor, folded opacity and chips4 < names5 < FX12/transients20/reactions100. No name JS/state/ownership changes.

Baseline controlled real Preview reproduced bottom clipping at390×760, active center message below seat/chip layers, and clipped descenders in both orientations. Narrow final Preview verifies390×844,320×640,landscape844×390 plus the specific390×760 reproducer: entire status/text in visual viewport, full normal messages on one portrait line, active source-driven center message above seat/chips, no card/action overlap or page scroll, unclipped Ragnar/Django/Poppy/Quincy/Sky glyphs. No new tests or repository screenshot/JSON artifacts; focused/required/full CI and exact runtime SHA are recorded on live #1048/#1049.

Breaking impact: portrait active-event layering, short-portrait status/card vertical polish and name line-box clipping only. No JS/HTML/assets/backend/WS/protocol/accounting/gameplay changes. Draft/not merge-ready awaiting owner smoke and authenticated Stage CH gate. Never merge.

## Portrait viewport ownership correction

Owner physical Android smoke supersedes earlier bottom:0/9px controlled checks: scene-relative status can still clip after fitTableScene transforms. The same roomStatus node now belongs to sceneViewport only for portrait; landscape returns it to scene. CSS anchors the complete box to the untransformed viewport, preserving scene-equivalent typography and an action gap. Text source/lifecycle unchanged. Obsolete negative status offsets and redundant short-portrait status override removed.

Portrait bottom status is the same persistent roomStatus element, reparented by fitTableScene() to pokerSceneViewport; landscape retains scene ownership. bottom:0 uses the untransformed clipping viewport, with scene-equivalent typography and a safe gap before unchanged actions. Center event, names and actions are unchanged. Retain short-portrait 9-scene-px Hero-card lift: removing it demonstrably overlaps status (6.78px at320×640,8.17px at390×760); tall portrait/landscape cards remain unchanged. No negative bottom or scene-relative status compensation.

Controlled Chromium Android emulation is Preview evidence, not physical-device acceptance. Final owner smoke and authenticated Stage CH remain pending. Breaking impact: portrait status now viewport-owned; no API, gameplay, accounting or WS change. No new UI/CSS/glue tests or repository screenshot artifacts.

Exact runtime SHA: f51306750a0c496f72d8fd7f3164a387decdab8f. Real Deploy Preview with Android Chromium emulation (mobile/touch/DPR3) PASS:320×640,390×760,390×844,844×390. Complete status/text within actual clipping ancestors, zero card/action overlap, zero scroll; three normal messages fit, center event/names/reaction/chat sanity PASS. Portrait dynamic viewport-height reduction48px also retains parent-contained status without scroll or action overlap. Focused127/127 and syntax/check:all/ci:guards/CSP/diff PASS. Physical Android owner smoke still required. External screenshots only; no broad tests added. Self-review: only portrait status ownership/styling changed, existing9px card lift retained after removal probe failed; landscape styles/center/action/name presentation unchanged.

## Owner-approved card/status clearance

Physical owner smoke confirms status clipping fixed; status styling and viewport ownership are locked. Existing9-scene-px lift left only0.35/0.44 visible px clearance in controlled320×640/390×760 Preview. Candidate13 yields3.53/4.26px;14 is the smallest integer lift meeting approximately4–6px on both (4.32/5.22px). Change only9→14 in existing portrait max-height:820px rule. Card size, rotation, horizontal center, status, actions, center event, names, tall portrait and landscape unchanged. Breaking impact: short-portrait card vertical spacing only. No new tests, JS, inline script or WS change.
