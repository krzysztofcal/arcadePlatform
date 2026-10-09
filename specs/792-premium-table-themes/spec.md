# Feature Specification: Six premium Poker V2 presentation packages

**Feature Branch**: `design/792-premium-table-themes`
**Created**: 2026-10-09
**Status**: Six packages implemented and exact-SHA Preview verified — awaiting manual live runtime verification
**Input**: Issue #792, latest owner amendment of 2026-10-09, supersedes the previous three-theme scope. Source: https://github.com/krzysztofcal/arcadePlatform/issues/792

## User Scenarios & Testing

### User Story 1 — Approve six complete visual directions (Priority: P1)

The owner can inspect six cohesive premium art packages on the existing Poker V2 composition before any product behavior changes.

**Why this priority**: Complete art and explicit owner approval are prerequisites; felt recoloring alone does not meet the brief.
**Independent Test**: Inspect the six design boards, their component details and unchanged baseline in portrait and landscape.

**Acceptance Scenarios**:
1. Given the latest brief, when reviewing the catalog, the owner sees Classic Casino, Royal Gold, Neon Vegas, Midnight Sapphire, Crimson Velvet and Emerald Palace, each covering room, lighting, rail/felt, card faces/backs, avatar frame and static dealer wardrobe.
2. Given the current Classic table, when comparing designs, all seats, action controls, HUD, cards, dealer pose/hands and dealing origin retain their existing positions and sizes. Concept illustrations are explicitly distinguished from geometry verification.
3. Given the review package, when approval is pending, the PR stays Draft and product theme switching is not implemented.

### User Story 2 — Preview a complete theme locally (Priority: P1)

A tester can select any approved theme in Table Settings → Diagnostics → Preview FX on a Deploy Preview, including a guest or spectator, without changing play.

**Why this priority**: The owner needs the actual package applied together to evaluate it in context.
**Independent Test**: Select all six themes, return to Classic, reload and inspect the default. Repeat as seated player, guest, spectator and during reconnect.

**Acceptance Scenarios**:
1. Given a Deploy Preview, when selecting a theme, all package components change together while current cards, seat ownership, stakes, actions and table state remain identical.
2. Given an unseated spectator or demo, when opening Preview FX, the theme selector is available; existing celebration/gift demos retain their original live-player restrictions.
3. Given a selected theme, when reloading, Classic is restored; no account or browser-persistent preference is written.
4. Given a non-preview build, when opening settings, the chooser is absent and Classic is unchanged.
5. Given a missing or failed artwork load, when selecting a package, the current complete presentation is retained, a readable status is shown and play continues. Rapid selection cannot apply a stale load.

### User Story 3 — Read and play comfortably (Priority: P1)

Players can read values, suits, names and actions on every package at existing card sizes, in both orientations and with reduced motion.

**Why this priority**: Premium art must not impair poker decisions or conceal authoritative state.
**Independent Test**: Inspect the smallest opponent/showdown cards, hero/board cards, turn indicators and made-hand highlights on targeted preview viewports.

**Acceptance Scenarios**:
1. Given any theme, when cards reveal, black and red suits remain recognizable and readable on a light face; theme ornament never occupies rank/suit space.
2. Given reduced motion, when switching themes, the final static artwork appears without added motion; existing reduced-motion behavior is preserved.
3. Given portrait or landscape, when art changes, no seat/card/action/dealer anchor shifts and no additional page scroll or hit-target obstruction appears.

### Edge Cases

- Unknown theme IDs retain the current theme; only catalog entries can supply local asset paths.
- Rapid A→B→Classic selection cannot let A/B's delayed load overwrite Classic.
- Switching during dealing/showdown/fold preserves existing animation lifecycle and revealed-card visibility; it never recreates private-card data.
- A spectator, reconnecting player or closed table may inspect art; theme selection never enables poker actions or celebration execution.
- Missing build metadata fails closed: no chooser and unchanged Classic.
- Dark rooms and bright Neon lighting cannot obscure card suits, turn timers, chip denominations or made-hand highlights.

## Requirements

### Functional Requirements

- **FR-001**: Deliver exactly six initial complete packages with stable identities: `classic-casino`, `royal-gold`, `neon-vegas`, `midnight-sapphire`, `crimson-velvet`, `emerald-palace`. Adding a later package must not require rewriting table play.
- **FR-002**: Preserve the existing Classic presentation as the default and reset target. Its current room/dealer assets and card treatment may be explicitly reused; optional Classic wardrobe artwork is reviewed separately and does not silently replace the default.
- **FR-003**: Each non-default package includes original or documented commercially usable local artwork for room/lighting, rail/felt surface, decorative card face and back, avatar frame and static dealer. Do not use borrowed casino screenshots or remote runtime art.
- **FR-004**: Dealer artwork uses elegant strappy dresses, optionally theme-matched hair. Keep the current dealer silhouette registration, pose, face/hand placement, card stack and flight origin; #791 owns motion.
- **FR-005**: Preserve Poker V2's current portrait/landscape layout, geometry, actions, HUD and authoritative play. Card values/suits remain live readable text; decorative face art cannot alter rank or reveal hidden cards.
- **FR-006**: Apply approved art locally through the existing Deploy Preview-only Preview FX surface. Theme selection is in-memory for the current page only, safe for guests/spectators, with no entitlement checks or persistence.
- **FR-007**: Keep all gameplay and existing effect execution eligibility unchanged, including reconnect and winner-reveal gates.
- **FR-008**: Artwork switching does not block input, table rendering or WS processing. Load only the requested non-default package; retain a complete current presentation until required art is ready; fall back safely on error.
- **FR-009**: Preserve accessible contrast (normal UI text ≥4.5:1, large text/essential control boundaries ≥3:1), keyboard chooser access, existing focus/turn/made-hand indicators and reduced motion.
- **FR-010**: Owner reviews SpecKit and all six visual directions before implementation. Finish with review and a verified working Deploy Preview; retain Draft status.
- **FR-011**: Exclude #1075 play paths, country/season rotation, scheduler/cron, payments/shop, durable preference (#800), entitlement (#1070), migrations, backend/WS/protocol changes, new tier systems and Production deployment.

### Key Entities

- **Presentation package**: Stable identity, readable label, complete local artwork set and cosmetic color/material values.
- **Preview selection**: One page-lifetime selected identity and pending selection; independent of player/account/table authority.
- **Approval record**: Owner decision tied to the reviewed revision and visual artifacts, followed by a record of any requested adjustments.

## Success Criteria

- **SC-001**: Owner can review six distinct complete visual directions, including card/dealer/frame detail, before implementation begins.
- **SC-002**: All six packages can be selected and Classic restored through the existing Preview FX path; reload restores Classic and non-preview settings expose no selector.
- **SC-003**: At 390×844 portrait and 844×390 landscape, theme changes shift protected element bounding boxes by 0 CSS pixels and add no page scroll. Check desktop 1440×900 as well.
- **SC-004**: All ranks/suits remain readable at existing sizes; all targeted contrast checks meet FR-009 and reduced-motion checks show no added motion.
- **SC-005**: Selecting a cached package finishes within 100 ms on the preview verification device; uncached switching retains current play and reports loading without a blank scene.
- **SC-006**: No new requests to gameplay services, WS messages, account preference writes or bankroll/stakes changes are caused by selecting art.

## Assumptions

- This is a browser presentation change; existing play and tier eligibility are the source of truth and remain untouched.
- Preserve Classic means the currently shipped default, including its current dealer. New strappy-dress wardrobe applies to the five alternative themes; a Classic alternative may be approved without changing the default.
- Design boards are approval artifacts, not final geometry proof or ready-to-ship asset atlases. Final per-layer exports will be inspected at native size after approval.
- Original generated artwork can be used for commercial project art subject to the provider terms; no exclusivity or third-party rights clearance is asserted. Provenance and export processing are recorded per file.
- No Stage mutation or Production effect is intended. Netlify Deploy Preview is the only deployment target.
