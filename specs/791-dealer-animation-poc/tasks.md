# Tasks — Poker Dealer Personalities PoC (#791)

Authority: CURRENT OWNER DECISION — 2026-10-12
Status: Tracking implementation of T001–T005.

## Tasks Breakdown

- [x] **T001 — Read-Only Audit**
  - [x] Audit `poker/table-v2.html:#pokerRoomDealer` and `poker/poker-v2.css:.poker-room-dealer`
  - [x] Record portrait/landscape layout geometry, z-index, and forearm/deck clip-path
  - [x] Inspect card flight origin in `poker/poker-v2.js:animateCardDiff()`
  - [x] Distinguish rotating button `pokerDealerChip` (D) from illustrated female dealer
  - [x] Verify local asset tooling: Sharp, FFmpeg 7.0.2 static, Pillow/NumPy/SciPy, Playwright

- [x] **T002 — Animation Feasibility & Asset Source**
  - [x] Investigate Gemini AI capabilities and report technical constraints honestly
  - [x] Generate key-pose reference assets for blinking, dealing, and hand-end
  - [x] Build 30fps articulated animation synthesis pipeline from `dealer-v2.webp`
  - [x] Generate `idle.webp` (105 frames / 3.5s @ 30fps, seamless loop, breathing + blink)
  - [x] Generate `deal.webp` (30 frames / 1.0s @ 30fps, card slide & pitch to origin, return to neutral)
  - [x] Generate `hand-end.webp` (36 frames / 1.2s @ 30fps, gracious nod, smile, presentation, return to neutral)
  - [x] Validate frame counts, 33ms durations, alpha transparency, and payload budget

- [x] **T003 — Isolated Working Design Preview**
  - [x] Create `poker/designs/dealer-poc/index.html`
  - [x] Create `poker/designs/dealer-poc/poc.css` (1 line per selector, JSP compliant)
  - [x] Create `poker/designs/dealer-poc/poc.js` (IIFE, klog, state switching, telemetry)
  - [x] Embed within authentic Poker V2 table layout (felt, rail, cards, status)
  - [x] Add interactive buttons: `Idle`, `Deal`, `Hand End`, `Original Static`

- [x] **T004 — Performance & Fallback Validation**
  - [x] Verify 30 FPS timing with Sharp / FFmpeg metadata (all 33.00ms delay, 30.3 FPS nominal)
  - [x] Verify file sizes against budget and document trade-offs (full 546×640 vs retina 382×448)
  - [x] Verify `prefers-reduced-motion: reduce` fallback to static `dealer-v2.webp`
  - [x] Test portrait & landscape responsiveness across viewports (390×844, 320×568, 844×390, 568×320)

- [x] **T005 — Evidence, Self-Review & Draft PR**
  - [x] Capture multi-viewport screenshots
  - [x] Capture video recording of real in-browser motion (`dealer-poc-demo.mp4` / `.webm`)
  - [x] Write `specs/791-dealer-animation-poc/self-review.md`
  - [x] Run syntax checks and CSP guards (both passing with 0 errors)
  - [ ] Open Draft PR linked to #791 (`POC ONLY – NOT FOR MERGE`)
  - [ ] Deploy Netlify preview and provide exact-SHA URL for owner gate
