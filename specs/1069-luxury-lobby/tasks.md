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
- [x] T007 [US1] Record bounded browser viewport/dialog/gallery/CSP review and deploy-preview URLs in specs/1069-luxury-lobby/self-review.md; publish Draft PR only.
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

## Phase 5 — US3: coordinated Cosmetics (P2)
**Independent verification**: six artwork previews now; FREE identity-scoped Auto/manual choice later in separate #800 PR.
- [x] T016 [US3] Add six shipped-theme art samples and transient gallery preview in poker/designs/luxury-lobby/landscape.html, portrait.html and preview.js; no apply/save/Buy/Owned claims.
- [ ] T017 [US3] After T008, in separate #800 PR extract poker/poker-v2.js:TABLE_THEME_CATALOG and all-assets apply logic into proposed poker/poker-cosmetics.js shared IIFE; reuse six IDs/assets, generation guard and klog.
- [ ] T018 [US3] Implement free local appearance preference in poker/poker-cosmetics.js under kcswh:poker-cosmetics:v1:<userId> / separate guest key, value {mode:"auto"} or {mode:"manual",themeId}; validate mode/known catalog ID; all six FREE with no purchase/VIP/entitlement checks. Proposed stable identity+tableId hash modulo six on new participation only; no reroll on snapshot/hand/reconnect/reload. Storage failure → Classic/static dealer.
- [ ] T019 [US3] Connect one gallery/apply path from poker/index.html and poker/table-v2.html settings; update poker/poker-v2.css theme attribute selectors together, keeping hand/cards/HUD/seats/actions/portrait-landscape coordinates unchanged.
- [ ] T020 [US3] Reset/invalidate theme request on poker/poker-v2.js:applySignedOutState()/applyAuthenticatedPendingState() identity transitions; preload before scene reveal, retain preference through reconnectGate/wsReady/hasAppliedAuthoritativeSnapshot without changing gameplay.
- [ ] T021 [US3] Verify #800 six free choices, Auto/manual stability, invalid mode/IDs, account/guest separation, storage denial, missing assets, static dealer and reconnect manually; record in specs/1069-luxury-lobby/self-review.md. Extend existing fundamental critical-logic tests only if changed rules warrant it.

## Phase 6 — Polish and review
- [x] T022 Review specs/1069-luxury-lobby/checklists/requirements.md and self-review.md for traceability/contradictions, actual art quality, incomplete approval and separate PR boundaries; fix review findings before handoff.
- [x] T023 Confirm exact Draft PR HTTPS Netlify URLs/assets and revision, existing checks and unchanged runtime/DB/WS/Production scope; record in specs/1069-luxury-lobby/self-review.md.

## Phase 7 — Owner review revision: US1/US3/US4 (authorized design only)
**Independent verification**: landscape/portrait deep links show four Day 1–4 example states, disabled claim, no amount/countdown/account or rewards API.
- [x] T024 [US1] Replace active art with original poker/designs/luxury-lobby/art/*-v2.webp and record bright arcade prompts/provenance/budgets in ARTWORK.md.
- [x] T025 [US1] Restyle poker/designs/luxury-lobby/preview.css with saturated arcade colors, bold headings/beveled CTAs, illustrated five-shortcut bar; one rule per physical line including media blocks, safe portrait/short-landscape controls.
- [x] T026 [US3] Correct all six Free theme samples in poker/designs/luxury-lobby/landscape.html and portrait.html using actual felt/rail/room/dealer/card/frame assets; add default Auto/Random and optional manual preview via preview.js:showTheme(), no save/random gameplay implementation.
- [x] T027 [US4] Add dailyDialog/Day 1–4 completed/current/upcoming EXAMPLE STATE cards, decorative original bonus art and disabled Claim/Not configured availability to poker/designs/luxury-lobby/landscape.html and portrait.html; preview.js:openPanel() opens #daily-bonus only, no claim/API/timer.
- [x] T028 [US4] Record existing daily API/status/template limitations and separate #1079 economic/history/timing gates in specs/1069-luxury-lobby/research.md, plan.md, contracts/ui.md and data-model.md; no live campaign read/activation or ledger change.
- [x] T029 [US4] Inspect small-screen portrait/landscape Daily Bonus layouts, disabled claim, dialog keyboard/focus and zero rewards calls; refresh poker/designs/luxury-lobby/screenshots/* and specs/1069-luxury-lobby/self-review.md using temporary browser inspection only.
- [x] T030 [US3] Inspect all six real asset samples, Auto/default/manual selection, Classic reset and no storage writes in both orientations; update poker/designs/luxury-lobby/screenshots/* and specs/1069-luxury-lobby/self-review.md.
- [ ] T031 [US1] Publish revised visual artifacts and SpecKit to existing Draft PR #1078 only; verify exact HEAD Netlify preview, CSS/active-art hashes/CSP and phone viewports; record in specs/1069-luxury-lobby/self-review.md.


## Dependencies / execution strategy
T001 → T002 → T003/T004 → T005/T006/T016 → T007/T022/T023 → owner T008. Revised design tasks T024–T031 are authorized now and supersede previous visual evidence; T024 → T025/T026/T027 → T028/T029/T030 → T031 → renewed owner T008. Current delivery stops at that gate. Complete approved five-card design is the current milestone; Online functionality uses unchanged lobby link.

After approval: T009 → T010 → T011/T012/T013/T014 → T015 in focused #1069 PR. T017 → T018 → T019 → T020 → T021 in separate #800 PR; #1069 may ship honest preview-only Cosmetics while #800 awaits implementation approval. No dependency on future playable modes/payments for six free themes. Daily reward logic is outside these tasks and belongs to independently approved #1079.

Parallel opportunities: documentation and art authoring can proceed independently after research. After markup contract settles, asset optimization and documentation review are independent. Do not concurrently edit shared lobby JS/HTML or extract the catalog in two PRs. Owner approval is not inferred from elapsed time or green checks.

Task count: 31. US1: 7; US2: 7; US3: 8; US4: 3; setup/foundation/polish: 6. Checked boxes describe only finished design work, never future product implementation.
