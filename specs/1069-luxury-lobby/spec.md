# Feature Specification: Premium Mobile Arcade Poker Lobby

**Feature Branch**: `feat/1069-luxury-poker-lobby`
**Created**: 2026-10-10
**Revised**: Owner review in PR #1078, 2026-10-10; V3 landscape, portrait and Daily Bonus accepted by owner in this session
**Status**: V3 approved, #1078 merged; T009–T015 real lobby implementation authorized. Current requirements are in the implementation authorization section below; preceding design-only statements are historical.
**Input**: Owner requests complete landscape/portrait design, five original finished cards, four lower shortcuts and table-wide automatic theme planning, SpecKit, self-review and a Draft PR with Netlify preview. No final lobby implementation yet.

## User Scenarios & Testing

### User Story 1 — Review the complete arcade lobby (Priority: P1)
The owner evaluates a polished landscape composition and a portrait composition on a phone before approving changes to the existing lobby.

**Why this priority**: Approval concerns the actual card-first experience, not a dashboard or unfinished illustration placeholders.

**Independent Test**: Open each preview URL, swipe through all five cards and inspect the current Poker lobby separately. Presentation verification is manual/browser review, not a new UI test suite.

**Acceptance Scenarios**:
1. Given a landscape phone, opening the wide design shows several large vertically proportioned cards and a partial next card; all five are reachable by horizontal swipe or indicators.
2. Given a portrait phone, opening the portrait design shows one dominant card with a partial next card; Poker identity, unset or real balance, primary action and bottom shortcuts remain legible.
3. Given the initial lineup, order is Poker Online, Single Player, World Tour, Seasons, Sit & Go; all illustrations are finished and original.
4. Given an unimplemented mode, its card explicitly says Coming Soon; opening details never starts gameplay or offers purchases.

### User Story 2 — Retain real platform navigation (Priority: P1)
After visual approval, players use the new lobby while retaining all current online table, guest, account, bankroll and access behavior.

**Why this priority**: Luxury presentation cannot replace or bypass real poker functionality.

**Independent Test**: In the eventual implementation preview, verify existing Quick Seat, Create, Join, Refresh, progression, auth and guest pathways without changes to their authority. In this design PR the Poker Online action links to the unchanged lobby, rather than invoking Quick Seat.

**Acceptance Scenarios**:
1. Given an authenticated player, the final top player bar shows the actual avatar/name, XP level/progress and CH balance with honest loading/stale/error states, and preserves account/navigation access.
2. Given a guest, account sign-in and Play as Guest retain the current pathway and explicit restrictions.
3. Given an eligible player, Poker Online exposes current Play Now, Online Tables, Create, Join and Refresh; access remains governed by existing bankroll and tier rules.
4. Given locked/unaffordable tables or NORMAL/SLOW/RESTRICTED access, presentation preserves existing restrictions and errors.
5. Given an eligible unclaimed welcome bonus, only the real existing account claim pathway is shown; everyone else sees no bonus shortcut.

### User Story 3 — Shared automatic table appearance (Priority: P2, future #800)
Every participant at the same table sees one system-assigned appearance from the six existing FREE Poker V2 themes. The assigned theme is fixed for that table's entire lifecycle.

**Why this priority**: Owner Variant A supersedes all earlier per-player appearance guidance. No lobby appearance controls belong in this milestone.

**Independent Test**: After separate #800 approval/implementation, compare two clients at the same table, late join, hand change, reload and reconnect; the resolved theme ID must stay identical. This PR verifies only the absence of appearance controls and the completeness of its future plan.

**Acceptance Scenarios**:
1. Given one valid immutable table ID, every participant resolves the same one of Classic Casino, Royal Gold, Neon Vegas, Midnight Sapphire, Crimson Velvet or Emerald Palace.
2. Given hands, joins, redraws, reload or reconnect, the resolved ID stays unchanged for the life of that table.
3. Given any player, no theme selector or player appearance storage is present; all six themes are free.
4. Given missing/invalid table identity or unavailable art, the scene has a readable Classic fallback without changing gameplay or drawing another theme.
5. Given future event/path work, #1075 defines precedence/transitions separately; V1 performs no event rotation.

### Edge Cases
- 320px portrait, 360px short phone, 844×390 landscape, 200% zoom, safe-area insets: allow vertical overflow when needed; never hide critical controls to force a one-screen fit.
- Keyboard: scroll, arrows/Home/End on the carousel, labeled indicator buttons, details/dialog Escape and focus return; screen readers receive real mode availability.
- Reduced motion: no autoplay, animated shimmer or essential hover; scrolling respects the preference.
- Missing artwork: readable labels/actions and dark fallback remain; image loading must not block navigation.
- Missing or invalid authoritative table ID: keep Classic; no identity-derived theme or gameplay mutation.
- Reconnect: preserve authoritative snapshot/reveal/action gates and table-scoped theme; stale artwork requests from a different table cannot apply.
- No real configured offer/event: omit promotions, timers, VIP, real daily reward claims and notification counts. Daily Bonus here is explicitly illustrative, without amounts.

### User Story 4 — Review Daily Bonus progression (Priority: P2)
The owner reviews a cohesive Day 1–4 reward-panel concept in both orientations, reached from a bottom shortcut, before #1079 economic or claim implementation.

**Why this priority**: The reward destination is part of the arcade composition, with truthfulness about availability and its separate feature ownership.

**Independent Test**: Open `landscape.html#daily-bonus` and `portrait.html#daily-bonus`; inspect four labeled illustrative states and a visibly disabled claim design.

**Acceptance Scenarios**:
1. Given the lobby, Daily Bonus is a fifth bottom shortcut, never a sixth mode tile.
2. Given the reward panel, Day 1 is illustrative completed, Day 2 illustrative current and Days 3–4 illustrative upcoming; every card identifies an example state and no amount is shown.
3. Given the design preview, Claim is disabled, next availability says Not configured and there is no countdown, wallet/claim request, daily reward, jackpot or economy change.
4. Given a future live lobby without approved real campaign/status, Daily Bonus remains explicitly unavailable. #1079 alone owns authoritative claims, economic approval, day history/progression, budget and timing.

## Requirements

### Functional Requirements
- **FR-001**: Deliver two separate shareable, usable native landscape/portrait visual previews in one Draft PR before any final lobby replacement.
- **FR-002**: Use the exact five-card lineup/order and status in US1; landscape is a scrollable carousel rather than an equal-width dashboard grid; portrait shows one dominant swipeable card and a peek.
- **FR-003**: Provide original cinematic art for all five modes, locally hosted, optimized, with accessible HTML labels and no copied commercial artwork.
- **FR-004**: Preserve the existing topbar/sidebar/account system and all online poker actions; preserve loading, disabled, guest, auth and tier/access states.
- **FR-005**: Bottom navigation offers Online Tables, Progression, Daily Bonus and Profile. Welcome bonus appears only on actual eligibility, using existing account flow.
- **FR-006**: Four future modes are inert or honest accessible informational shells. Single Player means online one-human-vs-bots; World Tour is a future themed play path; Seasons rotates weekly on designated tables; Sit & Go is future tournament work.
- **FR-007**: #800 assigns one of six FREE shipped themes from immutable table identity, shared by all participants and stable for the entire table lifecycle, including late joins/reloads/reconnects. No per-player theme UI or storage. Implementation is separately gated.
- **FR-008**: Future approved lobby replacement removes Poker-lobby AdSense presentation only, preserves unrelated Hub inventory and legally required consent. This preview includes no ad SDK; existing lobby is unchanged here.
- **FR-009**: No backend, database, migrations, WS/protocol, purchase, production activation, new currency, fabricated prizes, VIP offers or unsupported routes.
- **FR-010**: Preserve touch targets of at least 44×44px, keyboard navigation, screen-reader availability, safe areas and reduced-motion behavior in both orientations.
- **FR-011**: Use existing architecture, minimal complexity, fundamental tests only, JSP-compatible global/IIFE JS, one physical CSS line per selector, CSP SHA allowlisting for any new inline scripts and klog for application logs. No git commands in the implementation plan.
- **FR-013**: Daily Bonus is a design-only bottom destination with separate landscape/portrait Day 1–4 layouts, labeled sample states, disabled claim and Not configured availability; no amounts, countdown or rewards API.
- **FR-014**: Use saturated blue/purple/magenta lighting, varied glossy 3D subjects, beveled frames, bold arcade typography, high-contrast green/gold/orange CTAs and an illustrated toolbar.
- **FR-015**: Remove all lobby appearance controls, dialog, theme links and selection JS/CSS; retain shipped Poker V2 assets for future #800 reuse. Remove unused V1 lobby art and redundant screenshots.
- **FR-012**: SpecKit names actual paths, methods, fields, dependencies and breaking-impact risks; self-review documents evidence and outstanding owner/device approval.

### Key Entities
- Mode card: identity, label, original illustration, availability, honest destination/description and feature owner.
- Player presentation: existing identity, XP, actual CH and availability states; design preview intentionally uses unset values.
- Progression: existing bankroll, current/available tiers and eligibility; unlock and available access are distinct.
- Theme: existing six catalog IDs/assets; fixed automatic table-scoped assignment, no user entity or preference.
- Visual approval: portrait and landscape decisions, recorded separately from future feature implementation authorization. Daily Bonus implementation belongs to #1079, independently of visual approval.

## Success Criteria

### Measurable Outcomes
- **SC-001**: Both URLs load over HTTPS from the Draft PR preview; all five card artworks and Day 1–4 panels are accessible.
- **SC-002**: At 390×844, 360×640, 320×568 and 844×390, every mode/shortcut is reachable without page-wide horizontal overflow; intentional carousel overflow remains.
- **SC-003**: All four future modes have visible Coming Soon labels and zero gameplay/purchase effects; the preview makes zero wallet/auth/WS requests.
- **SC-004**: Main active five-art bundle totals under 1.5MB, first visible illustration under 350KB; bonus art under 150KB; images reserve dimensions and later cards load lazily.
- **SC-005**: Owner can inspect portrait, landscape and Daily Bonus; T008 records explicit owner visual acceptance; runtime implementation tasks remain unchecked for separate post-merge PRs.
- **SC-006**: Final approved implementation keeps every existing action and access rule, removes only Poker-lobby ads, and passes existing fundamental checks plus targeted manual preview scenarios.

## Assumptions
- The screenshot itself is absent from #1069 attachments/comments and this conversation; its detailed 2026-10-10 composition description is the design brief. Pixel matching cannot be claimed.
- Preview markup is an isolated review artifact, not a competing application or live data layer. No fixture balance/rank or account data is invented.
- Current main is `d8f48bd3b7dd47e6c2619646b3b708149d4af4d4`, including merged #1076 theme assets.
- Common UX/specification for #1069/#800; separate focused future implementation PRs. Future playable modes require independent approvals in #1077/#1075/#797.
- All six shipped themes are free. Final owner Variant A is authoritative: deterministic table-ID mapping is the proposed smallest implementation; one shared assignment, immutable mapping/order through table lifetime. Event precedence is separate #1075 work.

## Concrete repository scope and dependencies
Required by the project constitution: future #1069 touches `poker/index.html`, `poker/poker.css`, `poker/poker.js:initLobby()` and original lobby assets; preserve `quickSeat()`, `createTable()`, `playAsGuest()`, `renderTables()`, `renderProgression()`, `checkAuth()`, `buildPokerTableUrl()` and `navigateToPokerTable()`. Actual topbar/navigation owners are `js/topbar.js`, `js/sidebar.js`, `js/core/sidebar-model.js`, `css/portal.css` (the `portal/portal.js` mapping in skills.md is stale). #800 uses `poker/poker-v2.js`, `poker/poker-v2.css`, `poker/table-v2.html`, and theme art under `poker/assets/themes/`. Exact properties and contracts are in [plan.md](plan.md) and [contracts/ui.md](contracts/ui.md).

## Breaking impact and environment boundary
No existing production runtime files are modified by this review PR. Future DOM relocation must preserve IDs, event handlers, loading/hidden behavior and accessibility; CSS must be lobby-scoped. Removing ads is an intentional Poker-lobby-only presentation change after approval. Widening the preview-only theme apply path in the existing Poker V2 renderer is a future #800 change with mapping/version/asset-fallback risks. No new DB/Stage effect, WS deploy or Production effect is authorized. Daily repeating claim support is not evidence of active campaigns or Day 1–4 streak support; no campaign/API read is needed to review this concept.

## Implementation authorization — 2026-10-10 (#1069 after merged #1078)
Owner explicitly requests T009–T015 on current main c4f26e4c. Reuse approved V3 art and portrait/landscape composition; no redesign. The earlier design-only restrictions describe historical #1078 and do not block this focused implementation. #800/#1079 and future playable modes remain excluded.

`poker/index.html`, `poker/poker.css`, `poker/poker.js:initLobby()` retain one controller, existing IDs, auth/guest/topbar/sidebar, Online Tables/Create/Join/Refresh and Progress Roadmap. Promote approved art to `poker/assets/lobby/`. Daily Bonus is honestly Coming Soon. Retain approved V3 Day 1–4 as SAMPLE JOURNEY · NOT YOUR ACCOUNT with EXAMPLE STATE labels, no configured amounts/timer and disabled Claim; never present sample states as account history or eligibility. Remove Poker lobby AdSense only; preserve consent.

`renderProgression()` renders at most two actual `availableBuyIns`, defaults to highest on first view, retains a still-available explicit choice, resets safely on availability/account changes; one option is a label. `quickSeat()` sends optional numeric `buyIn` plus existing `maxPlayers`, keeps loading/error gates and navigates with existing `autoJoin=1`. `rejoinableTableIds` enables Resume Game regardless of tier availability; server always rechecks active seat first. Failed progression clears playable choices.

`netlify/functions/poker-quick-seat.mjs:handler()` validates a supplied positive safe integer `buyIn` (400 invalid_buy_in), then after resume-first and fresh progression/class validation restricts `selectCandidate()` to that exact available tier and `createAndRecommend()` to the same buy-in. Fresh unavailable selection returns existing 409 buy_in_tier_locked with bankroll metadata. Omitted property preserves legacy matching/default Create. Existing advisory lock order, canonical stakes, WS capability check, transactional table caps, authoritative JOIN funding, anti-farming and pool rules remain. No debit/seat write in Quick Seat.

Readiness: `ws-server/poker/handlers/join.mjs:handleJoinCommand()` already calls `tableManager.bootstrapHand()` after validated/funded JOIN and runtime membership; changed state is persisted with expected version, then broadcast and bot scheduling. Guest JOIN in `ws-server/server.mjs` already bootstraps. `bootstrapHand()` uses eligible human/member/readiness gates and returns unchanged for live/settlement/waiting states. Reuse this mechanism; no `autoStart` consumer, new client command, WS/protocol change or WS deployment. If runtime smoke demonstrates a gap, propose a separate readiness change for approval rather than forcing a hand.

Constitution Check: fundamental deterministic backend tests only in existing `tests/poker-quick-seat.behavior.test.mjs`: exact-tier match/create/mismatch fallback, fresh tier/class policy, resume/no debit and legacy defaults/capability/caps. Presentation uses temporary browser smoke; no new UI suite/dependencies/config/ignore cleanup. JSP IIFE/global JS, physical one-line CSS rules, klog and existing CSP; no added inline script or hash required. No migrations, Stage configuration/campaign changes, Production deploy or merge. Preview gameplay smoke may use existing isolated guest runtime only.

Breaking impact: optional API property is additive; supplied malformed values now fail 400. Exact-tier calls cannot silently switch tiers; legacy omitted calls unchanged. DOM relocation/CSS are scoped to lobby body and preserve IDs/handlers; ad removal intentional. No economy, DB or WS/protocol breaking change. Authenticated runtime verification requires a test account; do not invent credentials or use Production.

## Confirmed review fixes — PR #1080
Review baseline `606df16ca08f475618bca748152047791e606d43`, design reference merged #1078 `c4f26e4c8945029d7d9dca16d71bb1f95a107c18`. All three findings were investigated before runtime edits.
- `poker/poker.js:initLobby()/checkAuth()` uses existing `getUserIdFromToken()` subject as stable presentation identity. Rotating JWT for the same account preserves a still-available explicit tier; account/logout transitions clear account-specific UI and obsolete lobby WS client. Monotonic identity generation guards progression, Quick Seat, Create and welcome-bonus replies, including A→B→A. Auth-read generation ignores an older completed session read. `SupabaseAuth.onAuthChange(event,user,session)` invalidates changed identity immediately, defers session read outside auth callback lock, and unsubscribes on unload. This is presentation isolation, never a replacement for server authorization.
- Daily Bonus keeps Coming Soon and approved V3 sample Day 1–4 artwork/states with conspicuous sample/not-account labels, disabled Claim and Not configured availability. No #1079 API, wallet operation, eligibility/history/timer or economy implementation. The prior implementation's unavailable-only simplification is superseded by this review correction.
- `poker/poker.css` changes only short-landscape Online tile: stronger dark art overlay, sufficient minimum height to separate status/title/guest controls, opaque sign-in button and status background. Preserve native carousel, art, portrait and 44px actions; allow vertical scrolling rather than clipping controls.
No backend/WS/shared/protocol/economy/config/Production change. No new CSS/rendering/glue suite; use existing fundamental tests and temporary controlled auth-race/browser diagnostics. Funded authenticated Stage and physical-phone acceptance remain pending.
