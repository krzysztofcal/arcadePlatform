# Spec — Poker Dealer Personalities PoC (#791)

Authority: CURRENT OWNER DECISION — 2026-10-12 (overrides earlier multi-dealer, male-variant, full-V1-implementation or 3-static-pose scopes).
Status: Visual and Technical Proof of Concept (PoC) only. Not authorized for live game integration, merge, or Production.

## 1. Visual & Aesthetic Requirements
- **Single Female Dealer Identity**: Strictly retain the character identity, face, proportions, emerald silk dress, gold/emerald jewelry, hair, and lighting established in `/poker/assets/scene/dealer-v2.webp` (546×640 RGBA). No morphing, identity drift, facial warping, or changing costume elements between frames or states.
- **Three Core Animation States**:
  1. **Idle**: Continuous, seamlessly looping (3.0–3.5 s / 90–105 frames at 30fps). Realistic biological breathing (chest/torso expansion, subtle shoulder lift), natural eyelid blink once per cycle (~230ms, ~7 frames), micro head movement following breath, and stable resting hands.
  2. **Deal**: Short dealing gesture (0.8–1.0 s / 24–30 frames at 30fps). Dealer's hand slides top card from the deck and smoothly pitches it toward the table center matching the authoritative card-flight origin (`els.roomDealer` center-x, 84%-y), with gaze tracking and graceful return to the exact neutral resting pose.
  3. **Hand End**: Subtle luxury casino outcome reaction (1.0–1.2 s / 30–36 frames at 30fps). Gracious nod, warm smile brightening, gentle presentation gesture, and smooth return to the exact neutral resting pose.
- **Genuine 30 FPS Motion Quality**: Minimum 30 distinct motion samples per second (~33.3 ms per frame). No switching between 3–4 static poses, no duplicate frames wrapped in a nominal 30fps container, and no jarring whole-image translation drift.

## 2. Technical & Format Architecture
- **Format**: Lightweight animated WebP with 8-bit alpha transparency (`RGBA`).
- **Target File Sizes**:
  - `idle.webp`: roughly <= 1.5 MiB
  - Complete asset set (`idle.webp`, `deal.webp`, `hand-end.webp`): <= 5.0 MiB
- **Isolated Review Route**: Standalone preview at `poker/designs/dealer-poc/index.html` with `poc.css` and `poc.js`. Zero impact on live `poker/table-v2.html`, `poker/poker-v2.js`, or game runtime.
- **Scene Embedding**: Renders inside the authentic Poker V2 table layout (felt, rail, cards, dealer position) in both portrait (360×660 base scale) and landscape orientations.
- **Controls**: Interactive state buttons (`Idle`, `Deal`, `Hand End`, `Original Static`) and real-time playback telemetry.
- **Accessibility & Fallback**: Respects `prefers-reduced-motion: reduce` by presenting static `dealer-v2.webp`; falls back gracefully if animations fail to load.

## 3. Boundaries & Seams
- **Untouched Areas**: Live game runtime, WebSocket server (`ws-server/**`), Supabase migrations/DB, CH ledger, game engine reducers, audio, bot logic, user auth, and production CSS/HTML.
- **Review Gate**: Draft PR linked to #791 (`POC ONLY – NOT FOR MERGE`), live Netlify Deploy Preview URL, technical frame audit, and visual screen recording for owner aesthetic review.
