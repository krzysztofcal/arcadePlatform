# Tasks — #1092: Poker V2 UX: Animated Spectator Join Introduction

- [x] T001 Read project rules, Constitution, live issue #1092, and existing join/visibility mechanisms.
- [x] T002 Create SpecKit documentation (`spec.md`, `plan.md`, `tasks.md`).
- [x] T003 Add fundamental behavioral tests in `tests/poker-v2-live.behavior.test.mjs` verifying spectator join intro triggering, gating, single execution, flight/cleanup, cancellation, and manual join execution.
- [x] T004 Add `#pokerSpectatorJoinIntro` markup to `poker/table-v2.html`.
- [x] T005 Implement luxury styling, wobble/pulse animations, flight transitions, rail placeholder, and reduced-motion rules in `poker/poker-v2.css` (strictly one line per selector).
- [x] T006 Implement intro orchestration, dynamic geometric flight, cancellation guards, and shared join click handling in `poker/poker-v2.js`.
- [x] T007 Run fundamental tests and full test/guard suite (`npm test`, `npm run check:csp-inline`, `npm run syntax`).
- [x] T008 Perform multi-viewport responsive verification (390×844, 320×568, 844×390, 568×320) and edge-case verification (spectator, seated, auto-join, reconnect, guest, reduced motion, eligibility loss). Capture screenshots/recording.
- [x] T009 Prepare `self-review.md` and push branch to create Draft PR linked to #1092.
