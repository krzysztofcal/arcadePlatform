# #1083 — Poker Lobby: Welcome Bonus Visibility

**Source**: GitHub Issue [#1083](https://github.com/krzysztofcal/arcadePlatform/issues/1083)  
**Baseline**: main (`1ba99776ff427783f858e075d3474e144c3947b3`)  
**Status**: Implementation ready for review in Draft PR

---

## 🎯 Goal

Make the existing Welcome Bonus offer visible, clearly discoverable, and usable in the main Poker lobby across portrait and landscape orientations, without duplicate competing cards/banners and without obscuring primary poker navigation or interfering with Daily Bonus.

---

## 📋 Requirements & Acceptance Criteria

### Functional Requirements
- **FR-001**: Eligible registered accounts see `#pokerWelcomeBonusBanner` in the main Poker lobby when the Welcome Bonus is available and unclaimed.
- **FR-002**: Unauthenticated visitors (guests), ineligible accounts, and accounts that have already claimed the bonus do not see the offer banner.
- **FR-003**: Activating the CTA (`#pokerWelcomeBonusClaim`) opens the established claim flow by routing to `/account.html`.
- **FR-004**: Once claimed (or when switching to an ineligible / signed-out account), the offer disappears dynamically; no stale banner or duplicate award is exposed.
- **FR-005**: The Welcome Bonus remains distinct from and does not interfere with the Daily Bonus shortcut or modal (`#dailyDialog`).

### Responsive & Usability Requirements
- **FR-006 (Portrait)**: Banner displays prominently above the game modes carousel with balanced spacing (`margin: 8px 20px`, `padding: 10px 14px`) so the primary game mode action and navigation remain accessible.
- **FR-007 (Landscape)**: In short landscape viewports (`max-height: 550px`), the banner remains inline and horizontal (`flex-direction: row`, `margin: 4px 20px`, `padding: 6px 14px`, touch-accessible CTA button `min-height: 44px`), preventing vertical expansion from pushing the carousel cards and bottom navigation shortcuts below the fold.

---

## 🚫 Operational Boundaries

- **No backend changes**: No new API endpoints, database migrations, scheduler tasks, ledger logic, or economic rules.
- **No changes to PR #1084**: Daily Bonus PR #1084 remains independent and untouched.
- **No production deployment or merge**: Changes are isolated to a feature branch for owner review in a Draft PR.
