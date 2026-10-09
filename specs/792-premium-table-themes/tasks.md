# Tasks: Six premium Poker V2 presentation packages

**Input**: [spec.md](spec.md), [plan.md](plan.md). Product implementation starts only after T006. No UI/CSS/layout/JSP/glue test suites, generic setup changes or Git commands. Stage effects: none; Preview only.

## Phase 1 — Scope and SpecKit

- [x] T001 Verify latest #792 and `agents.md`, `skills.md`, `.specify/memory/constitution.md`; record live baseline in `specs/792-premium-table-themes/research.md`.
- [x] T002 Prepare `specs/792-premium-table-themes/spec.md`, `plan.md`, `tasks.md`, `data-model.md`, `contracts/preview.md`, `quickstart.md` and requirements checklist; check six-package coverage and exclusions.

## Phase 2 — US1: Owner visual review (no product changes)

Independent verification: owner sees all six complete directions and the unchanged Poker V2 baseline in both orientations.

- [x] T003 [US1] Capture current table geometry without product edits; save portrait/landscape baseline images in `specs/792-premium-table-themes/design/`.
- [x] T004 [US1] Prepare six high-quality concept boards and room/lighting/rail/felt/card/frame/dealer detail directions in `specs/792-premium-table-themes/design/`; label illustrative art separately from exact-layout proof.
- [ ] T005 [US1] Publish static review gallery `specs/792-premium-table-themes/design/index.html` on Draft PR Deploy Preview, verify its URL/images and self-review this phase in `specs/792-premium-table-themes/review.md`.
- [ ] T006 [US1] Record owner's explicit acceptance or requested corrections against the reviewed revision in `specs/792-premium-table-themes/approval.md`; do not proceed to T007 without acceptance.

## Phase 3 — US2: Complete approved packages and local preview

Independent verification: six packages selectable from Preview FX, default/reset unchanged, no account/gameplay writes.

- [ ] T007 [US2] Produce approved local room/dealer/felt/rail/face/back/frame art under `poker/assets/themes/<theme-id>/`; keep Classic's shipped defaults, record all reused/generated assets and measured budgets in `specs/792-premium-table-themes/artwork.md`.
- [ ] T008 [US2] Add `TABLE_THEME_CATALOG`, `previewThemeId` and `applyPreviewTheme(themeId)` to `poker/poker-v2.js`, with exact six IDs, preview build gate, requested-only loading, stale-load cancellation and error retention of current art.
- [ ] T009 [US2] Extend `bindCelebrationPreview()` with labeled Theme select/status in `poker/poker-v2.js`; audit `render()`/preference/leave visibility assignments for demo, guest, spectator and reconnect while preserving existing effect click gates and no persistence.
- [ ] T010 [US2] Add scoped cosmetic overrides in `poker/poker-v2.css` for room, rail/felt, dealer, face/back and frame; reuse `createCard()` text and existing FX hooks without geometry changes.
- [ ] T011 [US2] Verify six switches, Classic/reload, non-preview absence, guest/spectator access, rapid/failed loading and no gameplay writes on Deploy Preview; record evidence in `specs/792-premium-table-themes/review.md`.

## Phase 4 — US3: Readability and geometry

Independent verification: readable cards and UI, unchanged bounds, reduced motion at target orientations.

- [ ] T012 [US3] Inspect all exported dealer assets against current pose/hands/origin and `::after` clipping in `poker/poker-v2.css`; correct artwork registration without moving dealer boxes.
- [ ] T013 [US3] Verify 390×844, 844×390 and 1440×900 on Deploy Preview, compare protected bounds to baseline, inspect native-size hero/board/opponent/showdown/FX cards, turn/highlight/avatar cues and contrast; record in `specs/792-premium-table-themes/review.md`.
- [ ] T014 [US3] Verify keyboard chooser/status, focus and reduced-motion switching in Preview; adjust only scoped presentation in `poker/poker-v2.css`/`poker/poker-v2.js` when necessary.

## Phase 5 — Review and handoff

- [ ] T015 Re-run Constitution Check against actual diff and task list in `specs/792-premium-table-themes/plan.md`; run `node --check poker/poker-v2.js` and `npm run check:csp-inline`, document results in `review.md`; no new test suites.
- [ ] T016 Review final complete art/catalog/code for scope, simple reuse, default/preview gates, JSP/CSP/klog, geometry/readability and provenance; resolve findings in `review.md`.
- [ ] T017 Verify current Draft PR Deploy Preview corresponds to latest deployable revision; record URL/SHA and any pending live smoke in `review.md`. Hand off without merge or Production deployment.

## Dependencies and Delivery Strategy

T001→T002→T003/T004→T005→T006 is the design milestone. T006→T007→T008→T009→T010→T011→T012/T013/T014→T015→T016→T017 is implementation. The initial review deliverable is US1; the final V1 includes US1–US3 and all six complete packages. Art production for separate packages can be independent after approval; code edits stay sequential in the existing files. Do not ship a three-theme or felt-only substitute.
