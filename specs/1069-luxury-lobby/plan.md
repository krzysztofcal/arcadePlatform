# Implementation Plan: Premium Mobile Arcade Poker Lobby

**Current scope:** #1078 is merged and #1069 implementation is authorized. The implementation authorization section at the end supersedes historical design-only restrictions in this document. T009–T015 and validation evidence are recorded in tasks.md/self-review.md; #800/#1079 remain separate.

**Branch**: `feat/1069-luxury-poker-lobby` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

## Summary
Deliver isolated landscape/portrait review prototypes with five original glossy 3D cards, four illustrated shortcuts and Day 1–4 Daily Bonus concept in existing Draft PR #1078. Remove all appearance controls. Owner accepted V3 landscape, portrait and Daily Bonus on 2026-10-10. #1069 runtime lobby starts only in a separate PR after this design PR is merged by the owner; #800 implementation and #1079 economics remain separate.

## Technical Context
**Language/Version**: Existing plain browser JavaScript, global/IIFE, JSP-compatible; HTML and CSS.
**Primary Dependencies**: Existing topbar/auth/ChipsClient/XPClient/UserUiState/sidebar; browser scroll-snap and dialog; existing sharp for asset optimization only. No new packages/frameworks.
**Storage**: None in this prototype or proposed theme resolver. Existing immutable table identity is the only theme assignment input.
**Testing**: Existing syntax/CSP/guards; targeted browser/manual visual verification. No new UI/CSS/glue/JSP test suites. Existing fundamental poker/access checks apply if critical logic changes later.
**Target Platform**: Mobile portrait/landscape web, keyboard desktop, 320px upward, safe areas/reduced motion.
**Project Type**: Existing static/JSP-compatible frontend with unchanged Netlify/WS runtime.
**Performance Goals**: Five WebP illustrations <1.5MB total; first <350KB; reserved dimensions, async decoding and lazy later cards; no autoplay or animation library.
**Constraints**: No backend/DB/WS/shared runtime/Production modifications; no final lobby yet; no purchase or ownership assertions.
**Scale/Scope**: Five mode tiles, four shortcuts, zero appearance controls, two review URLs.

## Constitution Check
Before research and after design: PASS within authorized design scope.
- Simplicity: static review pages + shared scoped CSS/IIFE; reuse shipped themes, no new dependency/catalog in production.
- Authority: prototype performs no auth, wallet or WS requests; later actions reuse `initLobby()` closures.
- Environment: no migrations/shared Stage changes/runtime deploy/production/merge. Only Draft PR Netlify preview.
- Compatibility: no modules/imports/inline JS/inline handlers; self-hosted scripts satisfy `script-src 'self'`. No new SHA needed now; future inline changes require exact SHA in canonical `_headers` and CSP guard.
- Logs: preview has no application logging; future failure paths use existing `klog` recorder.
- Tests: no generated UI unit suite, framework or TDD obligation. Existing checks and bounded visual smoke only.
- SpecKit hooks: `.specify/extensions.yml` absent; no before/after hooks registered.
- Approval: owner explicitly requested complete review artifacts now. Visual approval is recorded; runtime code is deferred to a separate post-merge PR, not authorized in #1078.

## Project Structure
- `specs/1069-luxury-lobby/{spec,plan,tasks,research,data-model,quickstart,self-review}.md`, `contracts/ui.md`, `checklists/requirements.md`.
- Review only: `poker/designs/luxury-lobby/{index,landscape,portrait}.html`, `preview.css`, `preview.js`, `art/*-v2.webp` (active), `ARTWORK.md`, review screenshots.
- Local ignored feature selector `.specify/feature.json` points at this spec and is not committed; no tooling/dependency/ignore/deploy configuration change.
- Future #1069: `poker/index.html`, `poker/poker.css`, `poker/poker.js`; promote approved images to `poker/assets/lobby/`.
- Future separate #800: `poker/poker-v2.js`, `poker/poker-v2.css`, `poker/table-v2.html`. Extend existing file-local renderer; no new shared module required..

## Phase 0 — Research decisions
See [research.md](research.md). Live main and issues #1069/#800/#1075/#797/#1077 are authoritative. Reuse existing lobby rather than a new shell. Native scroll-snap with buttons beats library/autoplay. Future mode details beat unsupported links. Six themes are free and system-assigned per table; no prototype theme selection or runtime implementation. No screenshot file available; detailed issue description is the inspiration.

## Phase 1 — Concrete design and touchpoints
### Review artifact (authorized now)
Separate review routes support native proportions; portrait is capped at 470px on desktop, landscape responds to real phone orientation. Both show unset player data without fetching. `preview.js:goTo()/updatePosition()` handle carousel, `descriptions` contains four future scopes, `openPanel()/openHashPanel()` open Daily Bonus or Progression dialogs. There is no appearance catalog/control/loader in the review script. Four shortcuts: Online Tables, Progression, Daily Bonus, Profile. Current Poker remains `/poker/`, Profile `/account.html`.

Play Now occlusion at 320×568 was reproduced by hit-testing: sticky lower toolbar covered the button center. Toolbar now participates in document flow in every layout; short screens scroll naturally rather than overlapping actions. Safe-area padding remains. Isolated preview-only Netlify drawer suppression remains to prevent hosting-toolbar touch interception, without deploy configuration changes.

### #1069 implementation (V3 approved; separate PR only after #1078 merge)
1. `poker/index.html`: keep topbar/sidebar and existing ID nodes once each; introduce scoped lobby carousel. Reuse `pokerQuickSeat` for the actual Poker Online action inside `pokerLobbyContent`; current guest/sign-in controls remain visible in `pokerAuthMsg`. Preserve `data-required-buy-in`, `pokerError`, bonus and progression nodes; only one active action/handler path.
2. Keep table browsing/Create/Join/Refresh in an Online Tables subview with Back to modes. Relocate existing `pokerCreate`, `pokerBuyIn`, `pokerMaxPlayers`, `pokerRefresh`, `pokerTableList` rather than recreating them. Keep default semantics, table event delegation and form constraints.
3. `poker/poker.js:initLobby()`: add only view switching and carousel/detail handlers. Preserve `quickSeat()`, `createTable()`, `handleClick()`, `playAsGuest()`, `checkAuth()`, `refreshLobby()`, `ensureLobbyWs()` and existing lifecycle teardown. No endpoint or payload change.
4. Progression shortcut shows existing `pokerProgressBankroll`, `pokerProgressRoadmap`, `pokerProgressCelebration`. Preserve `refreshProgression()` early-return prerequisites and `renderProgression(data)` fields `balance`, `tiers`, `availableBuyIns`, `buyIn`, `stakes`, `available`, `unlocked`, `unlockBankroll`, `progressPercent`. Preserve `canViewLobbyTable()` / `isCanonicalTableForTier()` and insufficient chips/locked tier errors.
5. Topbar: preserve `xpBadge`, `avatarShell`, `avatarButton`, `avatarInitials`, `avatarMenu` children, `sbToggle`, `sidebar`. Existing `js/topbar.js:normalizeTopbarBadges()`, `refreshChipBadge()`, `refreshPokerBadge()`, `refreshXpBadge()` and `UserUiState` own data/loading/stale identity states. Reveal the actual name from existing profile state without creating a second auth/data-fetch framework. CSS overrides scoped to a lobby body class in `poker/poker.css`; no global `css/portal.css` change planned.
6. Bonus: `refreshWelcomeBonusBanner()` uses `ChipsClient.fetchWelcomeBonusStatus()`; preserve `eligible && !alreadyClaimed`. `pokerWelcomeBonusClaim` navigates to `/account.html`. Do not show a fixed daily reward.
7. Remove two Poker-lobby `.ad-slot.poker-ad-slot` blocks, its AdSense meta and `/js/adsense-init.js` include from `poker/index.html`; delete only resulting unused `.poker-ad-slot` rules in `poker/poker.css`. Preserve Klaro/config/consent services and other pages. This intentional removal is already approved in #1069, but its code waits with final implementation.
8. Original art: locally hosted versioned filenames, separate accessible HTML labels, dark error fallback, first visible eager image and later lazy images. Four Coming Soon buttons open details only. No events/offers beyond real availability.

### #800 implementation (SEPARATE PR; not authorized in #1078; Variant A)
1. Extend `poker/poker-v2.js` in place; do not extract a new catalog/module or add lobby settings. Reuse `TABLE_THEME_CATALOG`, `hashBotPresentationKey(value)` (existing FNV-1a unsigned 32-bit hash using `Math.imul`) and existing asset preload/generation guard from `applyPreviewTheme()`.
2. Proposed `resolveTableTheme(tableId)` takes only a non-empty authoritative string ID, rejects whitespace/control characters without silently normalizing a different identity, and computes `hashBotPresentationKey(tableId) % 6`. Pin V1 order explicitly: classic-casino, royal-gold, neon-vegas, midnight-sapphire, crimson-velvet, emerald-palace. Same ID yields same assigned ID in all compatible clients; this is deterministic pseudo-random distribution, not a persisted random draw. Multiple different tables may legitimately map to the same theme. No user, seat, hand, clock, entropy, storage, economy or event input.
3. `readTableId()` is only the existing URL routing hint. `mergeSnapshot(payload, frame)` receives `payload.tableId` / `payload.table.tableId` and sets `state.tableId`; retain its wrong-table guard. Resolve only after an accepted authoritative snapshot establishes non-empty `state.tableId` consistent with the requested table. Missing/invalid/mismatching identity stays Classic with existing error handling; never mutate identity/state to make art apply. Resolution is idempotent, skipped if the same canonical table ID was already resolved. It never depends on auth identity or rerolls on subsequent snapshots/hands/reconnects/reloads.
4. Refactor existing `applyPreviewTheme()` within the same file into a table-controlled `applyTableTheme(themeId, tableId)` reusing seven-resource preload, bounded timeout, stale-request generation guard and static dealer. Cache only resolved table ID/theme ID and pending-load generation in memory. Discard an artwork completion if the canonical table changed or the request was superseded. Classic restores native styles. Asset failure shows Classic with klog, never hashes again or chooses another theme. Gameplay actions must not wait for image loading. No new preference API/storage or DB/WS field.
5. `bindCelebrationPreview()` currently creates `pokerPreviewTheme` selection and `els.previewThemeSelect/previewThemeStatus`; remove its theme-selection fragment and references in #800, retaining unrelated diagnostic celebration controls. No player override of the table assignment, including deploy previews. `isThemePreviewBuild()` continues gating diagnostic FX only. Review PR does not touch these production/runtime files.
6. Update `poker/poker-v2.css` theme selectors with one coherent scene attribute (`data-poker-theme`, currently `data-preview-theme`) and references in `poker/table-v2.html` if affected; preserve actual room/dealer/rail/felt/card/frame assets, rank/suit legibility and seat/action/HUD/orientation coordinates. Keep all six FREE. No engine/WS/backend/database changes planned.
7. Fundamental deterministic resolver tests in the existing `tests/poker-v2-live.behavior.test.mjs`: same table across participant identities/late joins/hands/reconnect/reload, known mapping vectors, all six IDs, invalid identity → Classic and no re-roll. Existing asset-load guard/fallback reviewed with bounded manual smoke, no UI/CSS suite. The existing node:test/vm harness evaluates poker-v2.js; extend its critical resolver coverage without a framework or rendering assertions.
8. Freeze the V1 hash and six-entry mapping independently of later catalog expansion/reordering; otherwise active table appearances could change on code reload. Deployment/cache must serve the same mapping/art version to clients. Old clients pre-#800 still render Classic: cross-version agreement cannot be guaranteed by frontend-only hashing; declare compatibility limitation and coordinate rollout separately. Same assigned ID does not guarantee successful asset loading on a disconnected client: Classic is a local safety fallback, not a second assignment.
9. #1075 country/weekly-event precedence, transition boundary and lifetime rules require a separate approved design. Do not append event themes to the V1 modulo list or rotate active tables. If a truly persisted random draw or cross-version server-enforced assignment is required, stop and propose separately; no new protocol/state is authorized here.

### Daily Bonus design / #1079 boundary (authorized concept only)
- Add `data-panel="daily"` toolbar shortcut, `dailyDialog`, `dailyTitle`, `dailyDisclaimer`, four `.bonus-day` cards and disabled `.claim-concept` only in the review HTML. `preview.js:openPanel()` may open a dialog but has no claim handler, storage, fetch or timer. Deep links `#daily-bonus` open each native concept layout for review.
- Day 1 completed / Day 2 current / Days 3–4 upcoming are labeled EXAMPLE STATE under SAMPLE JOURNEY · NOT YOUR ACCOUNT. Decorative box art has no coins/currency or quantities. Amount not configured and next availability Not configured; no fake countdown placeholder.
- Inspect source only: `netlify/functions/bonus-campaigns.mjs:createBonusCampaignsHandler()/publicClaimableItem()` GET filters `eligible && !alreadyClaimed`; returned `code/title/claimPolicy/amount/eligible/alreadyClaimed/reason` cannot reconstruct completed-day history or next availability. `netlify/functions/_shared/bonus-campaigns.mjs:getBonusCampaignStatus()/buildClaimPeriodKey()` and `bonus_claims` support existing UTC daily/idempotent PROMO_BONUS. `js/chips/client.js:fetchBonusCampaigns()/claimBonusCampaign()` and `chips:tx-complete` refresh path must be reused in later #1079, not implemented here.
- `js/admin-page.js` Daily Login template (20 CH) is not an active-campaign assertion. No Stage/Production campaign queries, activation or DB writes performed. Real cycle/amounts/missed-day/reset/audiences/caps/funding/timezone/budget need separate #1079 owner economic GO. A smallest authenticated history/status projection may need later design; do not prescribe schema/protocol now.
- Future #1069 live shortcut stays visibly unavailable without approved real daily status/campaign. Claim/history/timer belong to a separate #1079 implementation PR; visual approval alone does not authorize economics.

## Dependencies and delivery order
Design approval → focused #1069 navigation/lobby implementation. Separately approved #800 extends existing Poker V2 table renderer for shared automatic assignment; it is not a prerequisite for the visual lobby. #792/#1076 provide the six free assets; #791 owns animations; #1075/#1077/#797 own future playable modes; #1079 owns real daily economy/status. Reconfirm current main before implementing.

## Breaking changes and mitigation
- Review PR: isolated design routes only; removed appearance deep link and obsolete V1 assets/screenshots are intentional review-artifact changes. Existing lobby byte-for-byte unchanged.
- Future DOM relocation: event delegation, visibility/error/loading and progression prerequisites can break. Preserve IDs and single handlers, verify real guest/auth/create/join/quick-seat/refresh and return/back.
- Topbar/global CSS: existing badge normalization moves nodes. Keep structure and scope styles; preserve loading/stale balance rather than fake zero.
- URL: preserve `/poker/table-v2.html` with `tableId`, `seatNo`, `autoJoin`, `autoStart`, `guest`; no router replacement.
- Ad removal: intended Poker-only business/presentation change; consent and Hub inventory unchanged.
- Theme rollout: widening preview-only apply logic/renaming scene attributes can affect card/room rendering; update internal consumers together in #800. Fixed V1 mapping must not change during table lifetime. Mixed old/new clients and local missing-art Classic fallback are explicit visual consistency limitations; never alter gameplay or add authority to solve them without approval.
- API, schemas, protocol, engine, currencies, stakes, retention and tier access: no breaking change or authorization.

## Validation / approval gates
Now: run existing CSP and syntax checks/guards; bounded browser review for both orientations, all images, swipe/indicators/details/Daily Bonus/Escape, safe overflow and zero account/WS requests. Inspect Draft PR preview HTTPS/CSP. Owner visual acceptance is recorded separately from browser verification; do not claim physical-device or 200% zoom checks were performed.
Later: same checks plus targeted existing critical poker/access tests if their logic changes and manual actual guest/auth/Quick Seat/Create/Join/Refresh/progression/bonus/table reconnect in Netlify preview. No WS Preview Deploy needed for this art-only PR; any later WS/protocol change is outside scope and requires independent plan/exact-SHA deploy. No DB Stage effect. No Production or merge action.

## Complexity Tracking
No constitution exception. CSS media blocks contain one complete selector/declaration rule per physical line; media braces are on separate lines, not multiple collapsed rules. No new helper module is justified: #800 can extend the existing file-local Poker V2 hash/catalog/loader. Resolver and loader changes are future work, not created in this design PR.

## Implementation authorization — 2026-10-10 (#1069 after merged #1078)
Owner explicitly requests T009–T015 on current main c4f26e4c. Reuse approved V3 art and portrait/landscape composition; no redesign. The earlier design-only restrictions describe historical #1078 and do not block this focused implementation. #800/#1079 and future playable modes remain excluded.

`poker/index.html`, `poker/poker.css`, `poker/poker.js:initLobby()` retain one controller, existing IDs, auth/guest/topbar/sidebar, Online Tables/Create/Join/Refresh and Progress Roadmap. Promote approved art to `poker/assets/lobby/`. Daily Bonus is honestly Coming Soon. Retain approved V3 Day 1–4 as SAMPLE JOURNEY · NOT YOUR ACCOUNT with EXAMPLE STATE labels, no configured amounts/timer and disabled Claim; never present sample states as account history or eligibility. Remove Poker lobby AdSense only; preserve consent.

`renderProgression()` renders at most two actual `availableBuyIns`, defaults to highest on first view, retains a still-available explicit choice, resets safely on availability/account changes; one option is a label. `quickSeat()` sends optional numeric `buyIn` plus existing `maxPlayers`, keeps loading/error gates and navigates with existing `autoJoin=1`. `rejoinableTableIds` enables Resume Game regardless of tier availability; server always rechecks active seat first. Failed progression clears playable choices.

`netlify/functions/poker-quick-seat.mjs:handler()` validates a supplied positive safe integer `buyIn` (400 invalid_buy_in), then after resume-first and fresh progression/class validation restricts `selectCandidate()` to that exact available tier and `createAndRecommend()` to the same buy-in. Fresh unavailable selection returns existing 409 buy_in_tier_locked with bankroll metadata. Omitted property preserves legacy matching/default Create. Existing advisory lock order, canonical stakes, WS capability check, transactional table caps, authoritative JOIN funding, anti-farming and pool rules remain. No debit/seat write in Quick Seat.

Readiness: `ws-server/poker/handlers/join.mjs:handleJoinCommand()` already calls `tableManager.bootstrapHand()` after validated/funded JOIN and runtime membership; changed state is persisted with expected version, then broadcast and bot scheduling. Guest JOIN in `ws-server/server.mjs` already bootstraps. `bootstrapHand()` uses eligible human/member/readiness gates and returns unchanged for live/settlement/waiting states. Reuse this mechanism; no `autoStart` consumer, new client command, WS/protocol change or WS deployment. If runtime smoke demonstrates a gap, propose a separate readiness change for approval rather than forcing a hand.

Constitution Check: fundamental deterministic backend tests only in existing `tests/poker-quick-seat.behavior.test.mjs`: exact-tier match/create/mismatch fallback, fresh tier/class policy, resume/no debit and legacy defaults/capability/caps. Presentation uses temporary browser smoke; no new UI suite/dependencies/config/ignore cleanup. JSP IIFE/global JS, physical one-line CSS rules, klog and existing CSP; no added inline script or hash required. No migrations, Stage configuration/campaign changes, Production deploy or merge. Preview gameplay smoke may use existing isolated guest runtime only.

Breaking impact: optional API property is additive; supplied malformed values now fail 400. Exact-tier calls cannot silently switch tiers; legacy omitted calls unchanged. DOM relocation/CSS are scoped to lobby body and preserve IDs/handlers; ad removal intentional. No economy, DB or WS/protocol breaking change. Authenticated runtime verification requires a test account; do not invent credentials or use Production.

### PR #1080 review correction implementation
`poker/poker.js:checkAuth()/setLobbyIdentity()/refreshProgression()/quickSeat()/createTable()/refreshWelcomeBonusBanner()` retain stable subject and reject obsolete identity generations; auth callback refreshes outside lock, account transition clears old UI/client. `poker/index.html:dailyDialog` restores exact approved illustrative V3 markup/art; `poker/poker.css` restores its scoped responsive rules and locally improves short-landscape Online overlay/spacing/sign-in readability. Temporary browser checks cover same-account JWT rotation, ordered auth completion, A→B→A progression, logout, Guest text/background and hit targets at 844×390/568×320. Existing fundamental tests and CI remain required; no maintained UI/layout suite, no runtime backend/WS changes.
