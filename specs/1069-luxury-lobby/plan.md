# Implementation Plan: Arcade-style Luxury Poker Lobby

**Branch**: `1069-luxury-lobby-design` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

## Summary
Deliver an isolated landscape/portrait review prototype with five original cards and existing-theme Cosmetics gallery now. After explicit owner approval, reshape the existing lobby and implement local Cosmetics in separate focused PRs. Preserve all engine/economy/navigation behavior.

## Technical Context
**Language/Version**: Existing plain browser JavaScript, global/IIFE, JSP-compatible; HTML and CSS.
**Primary Dependencies**: Existing topbar/auth/ChipsClient/XPClient/UserUiState/sidebar; browser scroll-snap and dialog; existing sharp for asset optimization only. No new packages/frameworks.
**Storage**: None in this prototype. Proposed #800 local versioned preference scoped by authenticated user ID or separate guest identity; never entitlements or gameplay state.
**Testing**: Existing syntax/CSP/guards; targeted browser/manual visual verification. No new UI/CSS/glue/JSP test suites. Existing fundamental poker/access checks apply if critical logic changes later.
**Target Platform**: Mobile portrait/landscape web, keyboard desktop, 320px upward, safe areas/reduced motion.
**Project Type**: Existing static/JSP-compatible frontend with unchanged Netlify/WS runtime.
**Performance Goals**: Five WebP illustrations <1.5MB total; first <350KB; reserved dimensions, async decoding and lazy later cards; no autoplay or animation library.
**Constraints**: No backend/DB/WS/shared runtime/Production modifications; no final lobby yet; no purchase or ownership assertions.
**Scale/Scope**: Five mode tiles, four shortcuts, six theme previews, two review URLs.

## Constitution Check
Before research and after design: PASS within authorized design scope.
- Simplicity: static review pages + shared scoped CSS/IIFE; reuse shipped themes, no new dependency/catalog in production.
- Authority: prototype performs no auth, wallet or WS requests; later actions reuse `initLobby()` closures.
- Environment: no migrations/shared Stage changes/runtime deploy/production/merge. Only Draft PR Netlify preview.
- Compatibility: no modules/imports/inline JS/inline handlers; self-hosted scripts satisfy `script-src 'self'`. No new SHA needed now; future inline changes require exact SHA in canonical `_headers` and CSP guard.
- Logs: preview has no application logging; future failure paths use existing `klog` recorder.
- Tests: no generated UI unit suite, framework or TDD obligation. Existing checks and bounded visual smoke only.
- SpecKit hooks: `.specify/extensions.yml` absent; no before/after hooks registered.
- Approval: owner explicitly requested complete review artifacts now. Future implementation is gated, not authorized by these artifacts.

## Project Structure
- `specs/1069-luxury-lobby/{spec,plan,tasks,research,data-model,quickstart,self-review}.md`, `contracts/ui.md`, `checklists/requirements.md`.
- Review only: `poker/designs/luxury-lobby/{index,landscape,portrait}.html`, `preview.css`, `preview.js`, `art/*-v1.webp`, `ARTWORK.md`, review screenshots.
- Local ignored feature selector `.specify/feature.json` points at this spec and is not committed; no tooling/dependency/ignore/deploy configuration change.
- Future #1069: `poker/index.html`, `poker/poker.css`, `poker/poker.js`; promote approved images to `poker/assets/lobby/`.
- Future separate #800: `poker/poker-v2.js`, `poker/poker-v2.css`, `poker/table-v2.html`; proposed single catalog/apply helper `poker/poker-cosmetics.js` shared with `poker/index.html`.

## Phase 0 — Research decisions
See [research.md](research.md). Live main and issues #1069/#800/#1075/#797/#1077 are authoritative. Reuse existing lobby rather than a new shell. Native scroll-snap with buttons beats library/autoplay. Future mode details beat unsupported links. Keep Cosmetics preview-only until permissions are explicit. No screenshot file available; detailed issue description is the inspiration.

## Phase 1 — Concrete design and touchpoints
### Review artifact (authorized now)
Separate review routes support native proportions; portrait is capped at 470px on desktop, landscape fills wide screens and responds to real phone orientation. The wide short-screen variant reduces card copy instead of shrinking touch controls. Both show honest unset player values; no live data fetching. `preview.js:goTo()/updatePosition()` handle navigation, `descriptions` contains four honest future scopes, HTML `data-theme/data-room/data-dealer` describes illustrative gallery samples only. This transient gallery is not an executable player catalog/preferences path. The review stylesheet hides only the Netlify-injected drawer on these two review pages because its fixed bottom iframe intercepts phone toolbar touches; deployment settings remain unchanged. Current Poker remains at `/poker/` and Profile at `/account.html`.

### #1069 implementation (BLOCKED pending visual approval)
1. `poker/index.html`: keep topbar/sidebar and existing ID nodes once each; introduce scoped lobby carousel. Reuse `pokerQuickSeat` for the actual Poker Online action inside `pokerLobbyContent`; current guest/sign-in controls remain visible in `pokerAuthMsg`. Preserve `data-required-buy-in`, `pokerError`, bonus and progression nodes; only one active action/handler path.
2. Keep table browsing/Create/Join/Refresh in an Online Tables subview with Back to modes. Relocate existing `pokerCreate`, `pokerBuyIn`, `pokerMaxPlayers`, `pokerRefresh`, `pokerTableList` rather than recreating them. Keep default semantics, table event delegation and form constraints.
3. `poker/poker.js:initLobby()`: add only view switching and carousel/detail handlers. Preserve `quickSeat()`, `createTable()`, `handleClick()`, `playAsGuest()`, `checkAuth()`, `refreshLobby()`, `ensureLobbyWs()` and existing lifecycle teardown. No endpoint or payload change.
4. Progression shortcut shows existing `pokerProgressBankroll`, `pokerProgressRoadmap`, `pokerProgressCelebration`. Preserve `refreshProgression()` early-return prerequisites and `renderProgression(data)` fields `balance`, `tiers`, `availableBuyIns`, `buyIn`, `stakes`, `available`, `unlocked`, `unlockBankroll`, `progressPercent`. Preserve `canViewLobbyTable()` / `isCanonicalTableForTier()` and insufficient chips/locked tier errors.
5. Topbar: preserve `xpBadge`, `avatarShell`, `avatarButton`, `avatarInitials`, `avatarMenu` children, `sbToggle`, `sidebar`. Existing `js/topbar.js:normalizeTopbarBadges()`, `refreshChipBadge()`, `refreshPokerBadge()`, `refreshXpBadge()` and `UserUiState` own data/loading/stale identity states. Reveal the actual name from existing profile state without creating a second auth/data-fetch framework. CSS overrides scoped to a lobby body class in `poker/poker.css`; no global `css/portal.css` change planned.
6. Bonus: `refreshWelcomeBonusBanner()` uses `ChipsClient.fetchWelcomeBonusStatus()`; preserve `eligible && !alreadyClaimed`. `pokerWelcomeBonusClaim` navigates to `/account.html`. Do not show a fixed daily reward.
7. Remove two Poker-lobby `.ad-slot.poker-ad-slot` blocks, its AdSense meta and `/js/adsense-init.js` include from `poker/index.html`; delete only resulting unused `.poker-ad-slot` rules in `poker/poker.css`. Preserve Klaro/config/consent services and other pages. This intentional removal is already approved in #1069, but its code waits with final implementation.
8. Original art: locally hosted versioned filenames, separate accessible HTML labels, dark error fallback, first visible eager image and later lazy images. Four Coming Soon buttons open details only. No events/offers beyond real availability.

### #800 implementation (SEPARATE PR, also BLOCKED)
1. Extract existing `TABLE_THEME_CATALOG` from `poker/poker-v2.js` into proposed IIFE `poker/poker-cosmetics.js`, preserving six IDs and seven-asset definitions. Export one proposed `window.PokerCosmetics` with `catalog`, `readPreference(identity)`, `savePreference(identity, themeId)`, `canSelect(themeId, permissions)`, `applyTheme(screen, themeId, identity)`. Gallery/settings use this shared path; no generic inventory.
2. Start with `classic-casino` selectable; others are artwork previews only until explicit free/permitted policy or #1070 authoritative entitlement exists. Do not add backend for entitlement in #800/#1069; deny unpermitted persisted IDs. UI says Preview, not Owned/Buy/Free.
3. Proposed local key: `kcswh:poker-cosmetics:v1:<userId>`; guest key `kcswh:poker-cosmetics:guest:v1`. Value `{themeId}` only; validate catalog/permission, storage exceptions fall back Classic. Follow existing `syncSocialPreferencesIdentity()` / `persistSocialPreferences()` identity model, without modifying social/auto-rebuy keys.
4. Refactor `applyPreviewTheme()` into the shared apply path retaining all-assets preload, request-generation protection (`previewThemeRequest` equivalent), failed-load Classic/static dealer fallback and existing klog events. Production permitted preference and Preview gallery must call the same path; `isThemePreviewBuild()` continues gating diagnostic FX, not granting ownership. Proposed final CSS scene attribute `data-poker-theme` replaces theme CSS selectors only; update `poker/poker-v2.css` coherently, keep overlay/seat/action coordinates unchanged.
5. Load identity preference before revealing local scene. `applySignedOutState()`, `applyAuthenticatedPendingState()` invalidate pending art requests and reset scene before identity transition; no account leakage. Reconnect under `state.reconnectGate`, `state.wsReady`, `hasAppliedAuthoritativeSnapshot` must retain scene without triggering join/snapshot/gameplay changes.
6. Shared gallery accessible from lobby and table settings; preserve the static dealer and reduced motion, ranks/suits/HUD and hand origin. Failure retains a safe Classic scene; preference load never delays authoritative actions.

## Dependencies and delivery order
Design approval → #1069 card/navigation PR with Cosmetics preview destination → separate #800 permitted preference PR using common UX/catalog. If #800 is not yet delivered, Cosmetics remains an explicitly informational art gallery without apply/save. No need to block the basic lobby on payments. #1070 alone owns paid entitlements; #791 owns animations; #792/#1076 provide six theme artworks; #1075/#1077/#797 own future playable modes. Reconfirm concurrent main changes before implementation.

## Breaking changes and mitigation
- Review PR: additive URLs/assets and feature selector only; existing lobby byte-for-byte unchanged.
- Future DOM relocation: event delegation, visibility/error/loading and progression prerequisites can break. Preserve IDs and single handlers, verify real guest/auth/create/join/quick-seat/refresh and return/back.
- Topbar/global CSS: existing badge normalization moves nodes. Keep structure and scope styles; preserve loading/stale balance rather than fake zero.
- URL: preserve `/poker/table-v2.html` with `tableId`, `seatNo`, `autoJoin`, `autoStart`, `guest`; no router replacement.
- Ad removal: intended Poker-only business/presentation change; consent and Hub inventory unchanged.
- Cosmetics extraction: internal preview CSS attribute/catalog changes require all consumers updated in the same #800 PR; retain six IDs and default art, identity request generation and fallback. Storage is a permitted local preference, never an ownership source.
- API, schemas, protocol, engine, currencies, stakes, retention and tier access: no breaking change or authorization.

## Validation / approval gates
Now: run existing CSP and syntax checks/guards; bounded browser review for both orientations, all images, swipe/indicators/details/gallery/Escape, safe overflow and zero account/WS requests. Inspect Draft PR preview HTTPS/CSP. Record owner real-device approval as pending, not a passed automated check.
Later: same checks plus targeted existing critical poker/access tests if their logic changes and manual actual guest/auth/Quick Seat/Create/Join/Refresh/progression/bonus/table reconnect in Netlify preview. No WS Preview Deploy needed for this art-only PR; any later WS/protocol change is outside scope and requires independent plan/exact-SHA deploy. No DB Stage effect. No Production or merge action.

## Complexity Tracking
No constitution exception. Proposed single shared Cosmetics helper is justified because lobby and table scripts currently have separate closures; extracting the existing catalog/apply path avoids duplicating it. It is not created in the design PR.
