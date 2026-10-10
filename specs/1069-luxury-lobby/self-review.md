# Self-review — final owner Variant A, review v3

2026-10-10, existing Draft PR #1078 only. Latest issue #800/#1069/#1075 top sections and owner review https://github.com/krzysztofcal/arcadePlatform/pull/1078#issuecomment-6100781471 analyzed; prior conflicting player-selection guidance removed. Main reconfirmed `d8f48bd3b7dd47e6c2619646b3b708149d4af4d4`; start revision `1c9ecd2a30e9e8eefb31f159e2838b7c5da04034`.

## Findings addressed
1. Entire lobby appearance shortcut/dialog/gallery/controls/deep links, associated theme loading/request logic and CSS removed from both layouts and review hub. No replacement appearance control. Four lower shortcuts: Online Tables, Progression, Daily Bonus, Profile.
2. Five original glossy arcade-mode illustrations/styles retained; four modes remain Coming Soon. Daily Bonus remains separately designed for portrait/landscape with four EXAMPLE STATE cards, no amounts/countdown/claim API and disabled Claim.
3. Play Now overlap reproduced at 320×568: center hit-testing returned shortcut-art because the sticky toolbar covered it. Removed sticky positioning from all toolbar variants; flow plus natural vertical scrolling preserves every control. Five-point button hit-testing now passes all six viewports. No new production/global CSS.
4. Deleted five unused V1 artwork exports and 19 gallery/redundant screenshot files. Retained five representative refreshed screenshots: two lobby, two Daily Bonus and one portrait Daily footer. Small viewport evidence is recorded below rather than duplicating images.
5. SpecKit spec/plan/tasks/research/data-model/contracts/quickstart/checklist rewritten around one shared table assignment. No player preference keys/read/save APIs or selection tasks. Future #800 reuses existing file-local catalog/hash/loader, not a new module. T008 is now completed by explicit owner approval; T009–T015 and T017–T021 remain unimplemented in separate future PRs.
6. CSS physical selector rules remain single-line, media braces separate. Preview script is an IIFE, external self-origin CSP; no new inline script/hash needed or application logs introduced. Future runtime failure logs use klog. Netlify drawer suppression stays review-route-scoped.

## Future #800 source review and risks
Proposed resolveTableTheme(tableId) hashes canonical accepted state.tableId using existing hashBotPresentationKey (FNV-1a) modulo fixed six IDs. No per-user/seat/hand/time state. Existing mergeSnapshot wrong-table guards, actual seven-resource preload/generation/timeout and static Classic scene are reused. No implementation in this PR.

Fixed V1 list/hash must never be reordered/expanded for active tables; identical compatible clients produce identical assignments through late join/hand/reload/reconnect. Old pre-#800 clients still show Classic; rollout/cache compatibility must be planned separately. Asset failure can locally show Classic even with identical assigned ID; that is a safe fallback, not another assignment. Different tables may map to the same ID. True persisted randomness or stronger server-enforced cross-version guarantees would need separately authorized architecture. Events/World Tour/Seasons precedence and weekly transitions remain future #1075 work.

Existing Daily API filters eligible unclaimed campaigns, so no completed-day history/countdown can be inferred from absence. Admin's 20 CH template is not an active campaign. No campaign/environment reads or changes performed; #1079 owns economic/history/status approval.

## Traceability / consistency review
| Requirements | Tasks |
| --- | --- |
| FR-001–003, FR-014; SC-001/002/004/005 | T005–T008, T024/T025/T030/T031 |
| FR-004–005; SC-006 | Future T009–T013/T015, current T005/T025/T027 |
| FR-006; SC-003 | T006/T024/T025 |
| FR-007 | Current T016/T026, future T017–T021 |
| FR-008–009 | Future T014, current scope/T028 |
| FR-010–012 | T003/T007/T022/T029–T031 |
| FR-013 | T027–T029, separate #1079 |
| FR-015 | T016/T026/T030 |

15 functional requirements, 31 sequential tasks; all requirements covered. No constitution conflicts, unresolved placeholder or implementation authorization inferred. Theme scheme is explicitly a proposal to implement later under approved Variant A. SpecKit setup-plan/setup-tasks/check-prerequisites executed for the same feature, extensions.yml absent (no hooks). No git commands in plan; fundamental critical resolver tests planned only in existing node:test/vm harness, no maintained UI suite.

## Verification evidence
Local temporary browser inspection passed 1280×800, 390×844, 844×390, 568×320, 360×640, 320×568: five decoded tile illustrations, four lower shortcuts, zero appearance controls, whole-button Play Now hit-test at five points, Coming Soon/details/carousel touch/keyboard, Daily four states/disabled claim/touch-close/Escape/focus-return, Progression dialog, direct Daily link and orientation resize. No horizontal page overflow, JavaScript errors, application platform/API/WS calls or storage writes. Short-screen vertical scrolling is intentional. Screenshots refreshed from these exact local files.

Syntax passed 225 files; CSP inline passed 55 documents; lifecycle/badge/29 XP-hook guards and diff whitespace check passed. Physical CSS-rule/task-ID/scope checks included. HTTPS temporary browser inspection passed the same six viewports/assertions on deploy-preview-1078 for `07df46bd06d6226838adcf0c4bf3ada6d77ec009`, including whole Play Now five-point hit-testing, four shortcuts and zero appearance controls/platform calls/storage writes/JS errors. Both routes returned 200 with CSP. Deployed preview.css/preview.js and all six active WebP SHA-256 values matched repository files. Active five-tile bundle is 1,018,952 bytes. GitHub actionlint, CI verify and netlify/playkcswh/deploy-preview succeeded for that revision; PR remained Draft. Final evidence-only commit changes no browser/deployable files; its exact HEAD Deploy Preview status and hashes are rechecked before handoff. Earlier v2 evidence is superseded and is not approval.

Review URLs: [Landscape](https://deploy-preview-1078--playkcswh.netlify.app/poker/designs/luxury-lobby/landscape.html), [Portrait](https://deploy-preview-1078--playkcswh.netlify.app/poker/designs/luxury-lobby/portrait.html). Append #daily-bonus for the corresponding panel.

## Owner acceptance and merge preparation
On 2026-10-10 the owner explicitly stated in this conversation: “Akceptuję kierunek wizualny V3 w PR #1078 jako docelowy projekt nowego Poker Lobby, w tym landscape, portrait i Daily Bonus.” Accepted visual artifact SHA: `a92b55d0905f8406a5ae1b893f1a3fcf5e01fdb6`. T008 is completed. Acceptance covers the V3 design, not implemented daily economics or table runtime. This approval is recorded from the direct owner instruction, not inferred from GitHub CI/review status.

The owner requests this design PR be prepared for merge but explicitly forbids agent merge or runtime lobby implementation here. After owner merge, begin a separate #1069 implementation PR using the approved design and existing architecture. #800 resolver and #1079 daily claim/history/economics remain separate work. No new PR opened in this step.

Approval update changes SpecKit documents only; browser/deployable code is identical to the accepted SHA. Before handoff verify final remote HEAD equals local HEAD, PR ready-for-review/mergeability and all CI statuses. Existing six-viewport HTTPS evidence remains valid because no preview runtime/art/config changed; final deployed route/CSS/JS/art identity is rechecked. Physical-device, large-text/200% zoom and safe-area testing are not newly claimed.

Final lobby and table resolver remain unimplemented. No backend/WS/DB/CH economy/Production/Stage changes or merge performed. Worktree retained for the owner merge process.
