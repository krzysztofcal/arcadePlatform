# Feature Specification: Arcade-style Luxury Poker Lobby

**Feature Branch**: `1069-luxury-lobby-design`
**Created**: 2026-10-10
**Status**: Draft — visual approval required; final implementation blocked
**Input**: Owner requests complete landscape/portrait design, five original finished cards, coordinated Cosmetics UX, SpecKit, self-review and a Draft PR with Netlify preview. No final lobby implementation yet.

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

### User Story 3 — Preview coherent Cosmetics UX (Priority: P2)
Players discover a secondary Cosmetics gallery from the bottom toolbar, visually aligned with the lobby and existing table settings.

**Why this priority**: #800 is part of the shared presentation milestone, with a separate implementation PR.

**Independent Test**: Open Cosmetics, inspect all six shipped theme artworks and close it. The design prototype changes only its own transient gallery view.

**Acceptance Scenarios**:
1. Given the Cosmetics gallery, Classic Casino, Royal Gold, Neon Vegas, Midnight Sapphire, Crimson Velvet and Emerald Palace are all illustrated using the shipped catalog artwork.
2. Given a gallery selection in this preview, the room/dealer/felt preview changes without saving preferences, claiming ownership or changing a table.
3. Given the later #800 implementation, permitted selection changes only this user's local scene and survives reload/reconnect; another account or guest never inherits that selection.
4. Given absent entitlement policy, Classic remains selectable; other theme art remains previewable without Buy/Owned/free-unlock claims. Paid selection needs the authoritative contract owned by #1070.

### Edge Cases
- 320px portrait, 360px short phone, 844×390 landscape, 200% zoom, safe-area insets: allow vertical overflow when needed; never hide critical controls to force a one-screen fit.
- Keyboard: scroll, arrows/Home/End on the carousel, labeled indicator buttons, details/dialog Escape and focus return; screen readers receive real mode availability.
- Reduced motion: no autoplay, animated shimmer or essential hover; scrolling respects the preference.
- Missing artwork: readable labels/actions and dark fallback remain; image loading must not block navigation.
- Account switch/logout/storage denial: Classic-safe identity reset; no paid entitlement inferred from local storage.
- Reconnect: preserve authoritative snapshot/reveal/action gates and local theme; ignore stale asset loads after identity changes.
- No real configured offer/event: omit promotions, timers, VIP, daily rewards and notification counts.

## Requirements

### Functional Requirements
- **FR-001**: Deliver two separate shareable, usable native landscape/portrait visual previews in one Draft PR before any final lobby replacement.
- **FR-002**: Use the exact five-card lineup/order and status in US1; landscape is a scrollable carousel rather than an equal-width dashboard grid; portrait shows one dominant swipeable card and a peek.
- **FR-003**: Provide original cinematic art for all five modes, locally hosted, optimized, with accessible HTML labels and no copied commercial artwork.
- **FR-004**: Preserve the existing topbar/sidebar/account system and all online poker actions; preserve loading, disabled, guest, auth and tier/access states.
- **FR-005**: Bottom navigation offers Online Tables, Progression, Cosmetics and Profile. Welcome bonus appears only on actual eligibility, using existing account flow.
- **FR-006**: Four future modes are inert or honest accessible informational shells. Single Player means online one-human-vs-bots; World Tour is a future themed play path; Seasons rotates weekly on designated tables; Sit & Go is future tournament work.
- **FR-007**: Cosmetics shares six shipped themes with table settings; a local preference is not ownership. #800 implements permitted persistence separately; #1070 owns paid authorization.
- **FR-008**: Future approved lobby replacement removes Poker-lobby AdSense presentation only, preserves unrelated Hub inventory and legally required consent. This preview includes no ad SDK; existing lobby is unchanged here.
- **FR-009**: No backend, database, migrations, WS/protocol, purchase, production activation, new currency, fabricated prizes, VIP offers or unsupported routes.
- **FR-010**: Preserve touch targets of at least 44×44px, keyboard navigation, screen-reader availability, safe areas and reduced-motion behavior in both orientations.
- **FR-011**: Use existing architecture, minimal complexity, fundamental tests only, JSP-compatible global/IIFE JS, one physical CSS line per selector, CSP SHA allowlisting for any new inline scripts and klog for application logs. No git commands in the implementation plan.
- **FR-012**: SpecKit names actual paths, methods, fields, dependencies and breaking-impact risks; self-review documents evidence and outstanding owner/device approval.

### Key Entities
- Mode card: identity, label, original illustration, availability, honest destination/description and feature owner.
- Player presentation: existing identity, XP, actual CH and availability states; design preview intentionally uses unset values.
- Progression: existing bankroll, current/available tiers and eligibility; unlock and available access are distinct.
- Theme: existing catalog ID/artwork, display name, local presentation and permitted selection boundary; no invented ownership.
- Visual approval: portrait and landscape decisions, recorded separately from future feature implementation authorization.

## Success Criteria

### Measurable Outcomes
- **SC-001**: Both URLs load over HTTPS from the Draft PR preview; all five card artworks and all six Cosmetics entries are accessible.
- **SC-002**: At 390×844, 360×640, 320×568 and 844×390, every mode/shortcut is reachable without page-wide horizontal overflow; intentional carousel overflow remains.
- **SC-003**: All four future modes have visible Coming Soon labels and zero gameplay/purchase effects; the preview makes zero wallet/auth/WS requests.
- **SC-004**: Main five-art bundle totals under 1.5MB, first visible illustration under 350KB; images reserve dimensions and later cards load lazily.
- **SC-005**: Owner can inspect portrait, landscape and six-theme gallery; final implementation tasks remain unchecked until explicit visual acceptance.
- **SC-006**: Final approved implementation keeps every existing action and access rule, removes only Poker-lobby ads, and passes existing fundamental checks plus targeted manual preview scenarios.

## Assumptions
- The screenshot itself is absent from #1069 attachments/comments and this conversation; its detailed 2026-10-10 composition description is the design brief. Pixel matching cannot be claimed.
- Preview markup is an isolated review artifact, not a competing application or live data layer. No fixture balance/rank or account data is invented.
- Current main is `d8f48bd3b7dd47e6c2619646b3b708149d4af4d4`, including merged #1076 theme assets.
- Common UX/specification for #1069/#800; separate focused future implementation PRs. Future playable modes require independent approvals in #1077/#1075/#797.
- Proposed #800 minimum selection policy is Classic-only until another theme is explicitly permitted; this design does not classify existing art as paid or free.

## Concrete repository scope and dependencies
Required by the project constitution: future #1069 touches `poker/index.html`, `poker/poker.css`, `poker/poker.js:initLobby()` and original lobby assets; preserve `quickSeat()`, `createTable()`, `playAsGuest()`, `renderTables()`, `renderProgression()`, `checkAuth()`, `buildPokerTableUrl()` and `navigateToPokerTable()`. Actual topbar/navigation owners are `js/topbar.js`, `js/sidebar.js`, `js/core/sidebar-model.js`, `css/portal.css` (the `portal/portal.js` mapping in skills.md is stale). #800 uses `poker/poker-v2.js`, `poker/poker-v2.css`, `poker/table-v2.html`, and theme art under `poker/assets/themes/`. Exact properties and contracts are in [plan.md](plan.md) and [contracts/ui.md](contracts/ui.md).

## Breaking impact and environment boundary
No existing production runtime files are modified by this review PR. Future DOM relocation must preserve IDs, event handlers, loading/hidden behavior and accessibility; CSS must be lobby-scoped. Removing ads is an intentional Poker-lobby-only presentation change after approval. Extracting the local theme catalog and widening its preview-only apply path are #800 implementation changes with identity/fallback risks. No new DB/Stage effect, WS deploy or Production effect is authorized.
