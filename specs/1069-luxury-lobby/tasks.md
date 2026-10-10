# Tasks: Premium Mobile Arcade Poker Lobby

**Scope**: Review delivery now; final implementation after owner approval only. Common #1069/#800 UX; separate future implementation PRs. No backend/DB/WS/Production work. No new automated UI/CSS/JSP/glue suite.

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
- [ ] T008 [US1] Obtain owner visual acceptance for landscape and portrait and record decisions in specs/1069-luxury-lobby/self-review.md. STOP final implementation until approved.

## Phase 4 — US2: real lobby integration (P1, BLOCKED by T008; future #1069 PR)
**Independent verification**: actual guest/auth/current table actions work with unchanged runtime and access rules.
- [ ] T009 [US2] Promote approved original art to poker/assets/lobby/; update poker/index.html carousel while preserving existing ID nodes, topbar/sidebar and guest/auth paths.
- [ ] T010 [US2] Relocate existing pokerCreate/pokerBuyIn/pokerMaxPlayers/pokerRefresh/pokerTableList into Online Tables subview in poker/index.html; preserve bindings in poker/poker.js:initLobby(), quickSeat(), createTable(), handleClick(), playAsGuest(), checkAuth().
- [ ] T011 [US2] Add only view switching/carousel/Coming Soon handlers in poker/poker.js:initLobby(); retain refreshLobby()/ensureLobbyWs() lifecycle and buildPokerTableUrl()/navigateToPokerTable() parameters.
- [ ] T012 [US2] Style lobby under scoped selectors in poker/poker.css with one physical line each; preserve actual topbar XP/avatar/CH loading/stale states from js/topbar.js/UserUiState and current sidebar navigation.
- [ ] T013 [US2] Expose existing Progress Roadmap and conditionally eligible welcome bonus in poker/index.html; preserve poker/poker.js:renderProgression()/refreshProgression()/refreshWelcomeBonusBanner(), available versus unlocked and account bonus destination.
- [ ] T014 [US2] Remove only Poker-lobby AdSense meta/include/two ad slots in poker/index.html and unused poker-ad-slot rules in poker/poker.css; preserve Klaro/consent and unrelated Hub ads.
- [ ] T015 [US2] Run existing guards/CSP/syntax and targeted manual real guest/auth/Quick Seat/Create/Join/Refresh/tiers/bonus/back/reconnect scenarios; record evidence in specs/1069-luxury-lobby/self-review.md. No protocol or WS deployment change.

## Phase 5 — US3: shared automatic table theme (P2; future #800 blocked)
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
T001 → T002 → T003/T004 → T005/T006/T016 → T007/T022/T023 → owner T008. Revised design tasks T024–T031 are authorized now and supersede previous visual evidence; T024 → T025/T026/T027 → T028/T029/T030 → T031 → renewed owner T008. Current delivery stops at that gate. Complete approved five-card design is the current milestone; Online functionality uses unchanged lobby link.

After approval: T009 → T010 → T011/T012/T013/T014 → T015 in focused #1069 implementation. Separately approved #800: T017 → T018 → T019/T020 → T021. #800 is not a lobby prerequisite. Daily reward logic belongs to independently approved #1079.

Parallel opportunities: after requirements, research documentation and art cleanup affect different files. Once markup settles, screenshot verification and SpecKit review are independent; shared preview CSS/JS and future renderer must be edited sequentially. Stop after current T031 for renewed T008; elapsed time/green checks are not owner approval.

Task count: 31. US1: 8; US2: 7; US3: 7; US4: 3; setup/foundation/polish: 6. Checked boxes mean completed design artifacts, never future runtime implementation.
