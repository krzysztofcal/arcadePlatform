# Plan — Poker Dealer Personalities PoC (#791)

Authority: CURRENT OWNER DECISION — 2026-10-12
Status: Proof of Concept execution plan for T001–T005.

## 1. T001 — Read-Only Audit & Constraints
- Inspect `poker/table-v2.html:#pokerRoomDealer` and `poker/poker-v2.css:.poker-room-dealer`.
- Record exact orientation geometry:
  - Landscape: `left: 640px; top: -60px; width: 155px; height: 185px;`
  - Portrait: `left: 164px; top: -30px; width: 126px; height: 150px;`
  - Forearm/deck overlay `.poker-room-dealer::after`: `clip-path: polygon(0 64%, 30% 64%, 30% 89%, 70% 89%, 70% 64%, 100% 64%, 100% 100%, 0 100%)`.
- Note card-flight origin in `poker/poker-v2.js:animateCardDiff()`: `dealerBox.left + dealerBox.width * 0.5, dealerBox.top + dealerBox.height * 0.84`.
- Differentiate illustrated female dealer from rotating button `pokerDealerChip` (D).
- Record asset tooling: Node Sharp, FFmpeg 7.0.2 static binary, Python Pillow/NumPy/SciPy, Playwright Chromium.

## 2. T002 — Animation Feasibility & Asset Generation
- Base asset: `/poker/assets/scene/dealer-v2.webp` (546×640 RGBA).
- AI Feasibility finding: Gemini diffusion models (`generate_image`) output only single static RGB rasters without alpha channels or inter-frame temporal coherence. Direct frame-by-frame diffusion yields severe character morphing and noisy alpha edges.
- Solution: 2D articulated anatomical layer pipeline using reference key-poses from Gemini (`dealer_eyes_closed`, `dealer_deal_pose`, `dealer_hand_end_pose`). Synthesize genuine 30 distinct motion samples per second (~33.3 ms per frame) with sub-pixel spline interpolation and alpha preservation:
  - `idle.webp`: 105 frames (3.5 s) seamless loop. Sine breathing (chest expansion, shoulder lift), natural eyelid blink (7-frame cycle at t~1.8s), micro head tilt, grounded hands.
  - `deal.webp`: 30 frames (1.0 s) one-shot. Right hand slides top card from deck toward center deal origin (273, 537), pitches card, tracks with gaze, and returns smoothly to neutral pose.
  - `hand-end.webp`: 36 frames (1.2 s) one-shot. Gracious head nod, warm smile brightening, left-hand open palm presentation gesture, smooth return to neutral pose.
- Export to `poker/designs/dealer-poc/assets/{idle,deal,hand-end}.webp`.

## 3. T003 — Isolated Working Design Preview
- Create `poker/designs/dealer-poc/index.html` with external `poc.css` and `poc.js`.
- Visually recreate the authentic Poker V2 table backdrop (felt, table shell, rail, community cards, dealer chip D, room status) in both portrait and landscape.
- Provide interactive controls:
  - `Idle` (looping)
  - `Deal` (one-shot then idle)
  - `Hand End` (one-shot then idle)
  - `Original Static` (baseline comparison)
  - Telemetry HUD showing current state, nominal FPS (30 FPS), target frame count, playback time, and payload size.
- Ensure strict isolation: no modifications to live poker runtime, WS, or database.

## 4. T004 — Performance & Fallback Validation
- Verify frame count, encoded durations, and frame rate using Sharp and FFmpeg.
- Validate payload budget: `idle.webp` <= 1.5 MiB, complete set <= 5.0 MiB.
- Test `prefers-reduced-motion: reduce` behavior falling back to static `dealer-v2.webp`.
- Test responsive viewports across mobile portrait (390×844, 320×568) and landscape (844×390, 568×320).

## 5. T005 — Evidence & Review Gate
- Capture multi-viewport screenshots and a 10–20 second Playwright video recording of the native-motion preview.
- Write `self-review.md` covering technical metrics, breaking risks, and recommendations.
- Commit changes and open Draft PR linked to #791 (`POC ONLY – NOT FOR MERGE`).
- Deploy Netlify preview and provide exact-SHA URL for owner aesthetic review. No merge.
