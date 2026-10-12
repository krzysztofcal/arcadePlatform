# Tasks: Poker V2 UI: Luxury Casino Poker Hands quick-reference panel (#1093)

**Source**: GitHub Issue [#1093](https://github.com/krzysztofcal/arcadePlatform/issues/1093)  
**Baseline**: main (`8f691d65`)

---

## Task Checklist

- [x] **T001 — Baseline / Read-only Audit**:
  - Review `agents.md`, `skills.md`, issue #1093 specification and approval.
  - Audit existing top-right rail geometry, reaction controls, Join button positioning, and responsive media queries.
  - Identify collision risks (narrow viewports 320px portrait, 568px landscape; Join button visibility; safe-area insets).
- [x] **T002 — Markup & Content**:
  - Add `#pokerHandInfoToggle` button to `.poker-top-right-rail > .poker-top-right-reactions` in `poker/table-v2.html`.
  - Add static `#pokerHandInfoPanel` to `#pokerTableScreen` with 10 exact poker rankings, 5 sample cards per ranking, and Hold'em explanation note.
- [x] **T003 — Styling (CSS)**:
  - Add scoped `.poker-hand-info*` rules in `poker/poker-v2.css` formatted strictly one line per selector.
  - Apply Luxury Casino palette: deep charcoal base, warm gold borders, emerald highlights, high-contrast red/black suits.
  - Implement bounded height, internal scrolling, and sticky header.
  - Ensure zero collision/overlap with `#pokerV2JoinBtn` in portrait and landscape.
- [x] **T004 — Minimal Interaction (JS)**:
  - Cache handles in `selectElements()` in `poker/poker-v2.js`.
  - Wire toggle, close button, Escape key, and outside click in `poker/poker-v2.js`.
  - Support accessible focus management (focus to Close on open, focus restored to toggle on Close/Escape).
- [x] **T005 — Targeted Verification**:
  - Verify layout across standard viewports: 390×844, 320×568, 844×390, 568×320.
  - Verify Join button visibility and clickability while panel is open and closed.
  - Verify suit accuracy, internal scrolling, keyboard navigation, and Escape handling.
  - Run syntax validation (`npm run syntax`), CI guards (`npm run ci:guards`), and CSP inline check (`npm run check:csp-inline`).
- [x] **T006 — Delivery & Self-Review**:
  - Complete self-review document `specs/1093-poker-hand-info/self-review.md`.
  - Verify zero backend/WS/DB/migration/Single Player/Join changes.
  - Prepare Draft PR linked to #1093.
