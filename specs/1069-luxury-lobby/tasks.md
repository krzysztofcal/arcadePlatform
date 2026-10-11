# Tasks: Premium Mobile Arcade Poker Lobby

**Scope**: T009–T015 implementation authorized after merged #1078; historical review delivery: final implementation after owner approval only. Common #1069/#800 UX; separate future implementation PRs. No backend/DB/WS/Production work. No new automated UI/CSS/JSP/glue suite.

## Phase 1 — Setup and live evidence
- [x] T001 Read live main `d8f48bd3`, agents.md, skills.md and .specify/memory/constitution.md; record issue #1069/#800/#1075/#797/#1077 scope in specs/1069-luxury-lobby/research.md.
- [x] T002 Select specs/1069-luxury-lobby in .specify/feature.json and execute existing SpecKit plan/tasks setup scripts without dependency/tooling/configuration changes.

## Phase 2 — Foundational reviewed design
- [x] T003 Write specs/1069-luxury-lobby/spec.md, plan.md, data-model.md, contracts/ui.md and quickstart.md with actual methods/properties/dependencies and breaking impacts.
- [x] T004 Create original finished five-card WebP art in poker/designs/luxury-lobby/art/ and document prompts/provenance/budgets in poker/designs/luxury-lobby/ARTWORK.md.

## Phase 3 — US1: two visual previews (P1, authorized now)
**Independent verification**: two preview URLs; five reachable cards, native phone layouts, honest four Coming Soon shells.
- [x] T005 [US1] Create poker/designs/luxury-lobby/landscape.html and portrait.html plus shared preview.css, native scroll-snap cards, peek, safe-area spacing and 44px targets.
- [x] T006 [US1] Create poker/designs/luxury-lobby/preview.js IIFE for navigation indicators/arrows and honest Coming Soon dialogs; no gameplay, auth, wallet, logging or storage code.
- [x] T007 [US1] Record bounded browser viewport/dialog/CSP review and deploy-preview URLs in specs/1069-luxury-lobby/self-review.md; publish Draft PR only.
- [x] T008 [US1] Owner accepted V3 landscape, portrait and Daily Bonus on 2026-10-10 in this session; recorded exact approval and accepted design SHA a92b55d0 in specs/1069-luxury-lobby/self-review.md. Runtime implementation remains deferred to separate post-merge #1069 PR.

## Phase 4 — US2: real lobby integration (P1, T008 complete; separate #1069 PR after #1078 merge)
**Independent verification**: actual guest/auth/current table actions work with unchanged runtime and access rules.
- [x] T009 [US2] Promote approved original art to poker/assets/lobby/; update poker/index.html carousel while preserving existing ID nodes, topbar/sidebar and guest/auth paths.
- [x] T010 [US2] Relocate existing pokerCreate/pokerBuyIn/pokerMaxPlayers/pokerRefresh/pokerTableList into Online Tables subview in poker/index.html; preserve bindings in poker/poker.js:initLobby(), quickSeat(), createTable(), handleClick(), playAsGuest(), checkAuth().
- [x] T011 [US2] Reuse view switching/carousel/Coming Soon handlers; add inline exact-tier quick choice from availableBuyIns and optional validated buyIn in existing Quick Seat API; preserve Resume-first, locks/caps/class/funding/capability; keep existing authoritative JOIN auto-bootstrap. Add only fundamental backend tests. Add view handlers in poker/poker.js:initLobby(); retain refreshLobby()/ensureLobbyWs() lifecycle and buildPokerTableUrl()/navigateToPokerTable() parameters.
- [x] T012 [US2] Style lobby under scoped selectors in poker/poker.css with one physical line each; preserve actual topbar XP/avatar/CH loading/stale states from js/topbar.js/UserUiState and current sidebar navigation.
- [x] T013 [US2] Expose existing Progress Roadmap and conditionally eligible welcome bonus in poker/index.html; preserve poker/poker.js:renderProgression()/refreshProgression()/refreshWelcomeBonusBanner(), available versus unlocked and account bonus destination.
- [x] T014 [US2] Remove only Poker-lobby AdSense meta/include/two ad slots in poker/index.html and unused poker-ad-slot rules in poker/poker.css; preserve Klaro/consent and unrelated Hub ads.
- [x] T015 [US2] Run existing guards/CSP/syntax and fundamental Quick Seat rules; perform available actual guest/auto-join/readiness/reload and anonymous/API negative Deploy Preview smoke; record authenticated Stage/physical-phone Quick Seat/Create/Join/Refresh/tiers/bonus/back/reconnect scenarios still requiring user verification and evidence in specs/1069-luxury-lobby/self-review.md. Existing JOIN auto-bootstrap verified by source; no protocol or WS deployment change. Record unauthenticated/guest runtime smoke and any authenticated/manual verification still pending.

## Phase 5 — US3: shared automatic table theme (P2; future separately authorized #800 PR)
**Independent verification**: no appearance UI in current review. Later every compatible client at the same table resolves the same fixed theme through joins/hands/reload/reconnect.
- [x] T016 [US3] Remove entire appearance dialog/shortcut/controls and associated script/styles/deep links from poker/designs/luxury-lobby/{landscape,portrait,index}.html, preview.js and preview.css.
- [ ] T017 [US3] After T008 and separate #800 implementation approval, extend poker/poker-v2.js with resolveTableTheme(tableId), existing hashBotPresentationKey and fixed V1 six-ID order in plan.md; non-empty canonical string rejects whitespace/control characters, invalid → Classic. No player/seat/hand/time inputs or storage.
- [ ] T018 [US3] Resolve idempotently after accepted poker/poker-v2.js:mergeSnapshot establishes state.tableId consistent with requested table; reuse wrong-table/reconnect gates. No re-roll on joins/snapshots/hands/reload/reconnect; retain in-memory resolvedTableId/resolvedThemeId only.
- [ ] T019 [US3] Refactor poker/poker-v2.js:applyPreviewTheme into table-controlled applyTableTheme using seven-asset preload/timeout/generation/current-table guard, Classic safe fallback and klog; update poker/poker-v2.css scene attribute selectors and poker/table-v2.html references if needed. Keep static dealer/cards/HUD/actions/coordinates; no backend/WS/DB changes.
- [ ] T020 [US3] Remove theme-select fragment of poker/poker-v2.js:bindCelebrationPreview and els.previewThemeSelect/previewThemeStatus references only in #800; keep unrelated celebration FX. Freeze V1 hash/list independent of future catalog/event additions; document mixed-version rollout and missing-art fallback in specs/1069-luxury-lobby/self-review.md.
- [ ] T021 [US3] Extend existing tests/poker-v2-live.behavior.test.mjs node:test/vm harness for fundamental mapping vectors/table-wide agreement/lifetime stability/invalid ID fallback; targeted manual art-failure/reconnect smoke in specs/1069-luxury-lobby/self-review.md, no UI/CSS suite.

## Phase 6 — Polish and review
- [x] T022 Review specs/1069-luxury-lobby/checklists/requirements.md and self-review.md for traceability/contradictions, actual art quality, incomplete approval and separate PR boundaries; fix review findings before handoff.
- [x] T023 Confirm exact Draft PR HTTPS Netlify URLs/assets and revision, existing checks and unchanged runtime/DB/WS/Production scope; record in specs/1069-luxury-lobby/self-review.md.

## Phase 7 — Owner review revision: US1/US3/US4 (authorized design only)
**Independent verification**: landscape/portrait deep links show four Day 1–4 example states, disabled claim, no amount/countdown/account or rewards API.
- [x] T024 [US1] Replace active art with original poker/designs/luxury-lobby/art/*-v2.webp and record bright arcade prompts/provenance/budgets in ARTWORK.md.
- [x] T025 [US1] Restyle poker/designs/luxury-lobby/preview.css with saturated arcade colors, bold headings/beveled CTAs, illustrated four-shortcut bar; one rule per physical line including media blocks, safe portrait/short-landscape controls.
- [x] T026 [US3] Replace obsolete per-player requirements in specs/1069-luxury-lobby/{spec,plan,tasks,research,data-model}.md and contracts/ui.md with final owner shared table-wide automatic mapping; remove unneeded V1 art and gallery/redundant screenshots from poker/designs/luxury-lobby/.
- [x] T027 [US4] Add dailyDialog/Day 1–4 completed/current/upcoming EXAMPLE STATE cards, decorative original bonus art and disabled Claim/Not configured availability to poker/designs/luxury-lobby/landscape.html and portrait.html; preview.js:openPanel() opens #daily-bonus only, no claim/API/timer.
- [x] T028 [US4] Record existing daily API/status/template limitations and separate #1079 economic/history/timing gates in specs/1069-luxury-lobby/research.md, plan.md, contracts/ui.md and data-model.md; no live campaign read/activation or ledger change.
- [x] T029 [US4] Inspect small-screen portrait/landscape Daily Bonus layouts, disabled claim, dialog keyboard/focus and zero rewards calls; refresh poker/designs/luxury-lobby/screenshots/* and specs/1069-luxury-lobby/self-review.md using temporary browser inspection only.
- [x] T030 [US1] Reproduce 320×568 Play Now occlusion, fix flow toolbar in poker/designs/luxury-lobby/preview.css and verify whole-button hit-testing/touch, four shortcuts and no appearance nodes/requests/storage across both layouts; refresh representative screenshots and specs/1069-luxury-lobby/self-review.md.
- [x] T031 [US1] Publish revised visual artifacts and SpecKit to existing Draft PR #1078 only; verify exact HEAD Netlify preview, CSS/active-art hashes/CSP and phone viewports; record in specs/1069-luxury-lobby/self-review.md.


## Dependencies / execution strategy
T001 → T002 → T003/T004 → T005/T006/T016 → T007/T022/T023 → owner T008. Revised design tasks T024–T031 are authorized now and supersede previous visual evidence; T024 → T025/T026/T027 → T028/T029/T030 → T031 → renewed owner T008. T008 is now complete; current delivery stops at design-only merge preparation. Complete approved five-card design is the current milestone; Online functionality uses unchanged lobby link.

After owner merge of #1078, in a separate implementation PR: T009 → T010 → T011/T012/T013/T014 → T015 in focused #1069 implementation. Separately approved #800: T017 → T018 → T019/T020 → T021. #800 is not a lobby prerequisite. Daily reward logic belongs to independently approved #1079.

Parallel opportunities: after requirements, research documentation and art cleanup affect different files. Once markup settles, screenshot verification and SpecKit review are independent; shared preview CSS/JS and future renderer must be edited sequentially. T008 is complete based on explicit owner approval, not elapsed time/green checks. Historical #1078 kept T009–T015/T017–T021 unchecked. Current separate #1069 completes T009–T015; T017–T021 remain outside scope.

Task count: 31. US1: 8; US2: 7; US3: 7; US4: 3; setup/foundation/polish: 6. Checked boxes mean completed design artifacts, never future runtime implementation.

## Implementation progress (separate #1069 PR)
T009–T014 implemented on main c4f26e4c baseline. T015 CI/actual guest and negative API Deploy Preview evidence recorded; authenticated Stage/physical-phone runtime smoke remains explicitly pending. Existing poker-ui.behavior harness received browser API stubs and a funded-seat fixture correction only, with no new UI cases/suite. Optional selected tier tests extend existing backend file. Scoped CSS suppresses injected Hub mobile-bottom-nav on this lobby to prevent its fixed overlay hiding Play Now; Hub routes remain in unchanged sidebar, brand and Profile. No global stylesheet/navigation changes.

## PR #1080 confirmed review corrections
- [x] T031 Independently verify all three findings against current PR HEAD, live Preview and merged V3 before any implementation edit; record classifications/evidence in self-review.md.
- [x] T032 In poker/poker.js use stable subject and generation checks for identity-bound async responses/auth reads; reset account UI/client on transition. Restore approved illustrative Daily Bonus in poker/index.html and scoped poker/poker.css; improve only Online short-landscape contrast/spacing.
- [ ] T033 Run existing fundamental tests/guards and temporary auth-race/short-landscape checks; confirm CI/Netlify Preview latest SHA, record evidence and pending funded Stage/physical-device gate. Keep Draft, no merge/Production.

- [x] T034 Verify Welcome Bonus in-flight finding against live HEAD, reproduce with deferred status and extend existing fundamental account-isolation regression (A→B, A→B→A, logout, old-request rejection). Apply minimal same-method refresh in finally; no bonus economics or backend changes.
- [ ] T035 Confirm final CI and Netlify Preview SHA, record combined review evidence/self-review and pending funded authenticated Stage smoke; retain Draft/no merge.
