# Poker Table Felt V2 — #1086

Authority: owner Review PASS for Draft PR #1088 and explicit GO for T005–T007. Current main baseline: `97f8b8e521871548270db0f779ee3d87e67412c6`.

Apply approved saturated material and centered larger ARCADE seal to Classic Casino, Neon Vegas, Royal Gold, Midnight Sapphire, Crimson Velvet and Emerald Palace. Reuse `poker/assets/scene/felt-weave.webp` and `felt-house-mark.svg`; retain each theme's original colors, gradients, illumination identity and ornament SVG. No separate textures or renderer abstraction.

One shared portrait rule in `poker/poker-v2.css`: perspective(900px) rotateX(12deg), zero in-plane rotation. Landscape sizing/transforms unchanged. Imprint stays 50% 50%, horizontal relative to screen, naturally under cards/chips. Preserve card/chip/avatar/HUD/button positions and independent inner ring.

Validate real exact-SHA Netlify Preview for six themes at390×844,320×568,844×390,568×320: artwork, legibility, centering, rotation, clipping, interactions, resources/fallback and performance. Distinguish isolated browser fixtures and mobile emulation from authenticated gameplay/physical devices.

Keep only final review captures, concise original-main before/after, SpecKit and short artwork report. Remove rejected/tilted/A/B/intermediate screenshots and oversized JSON from this feature's final tree. No rewriting unrelated documentation or production assets.

Constitution: fundamental-tests-only, no new CSS/UI tests. Existing syntax/CSP/guards/appropriate CI, self-review. CSS one rule line per selector; no new JS. No changes to theme catalog/hash/preloads, poker engine/WS/backend/DB/CH/dependencies/config. No merge, Stage or Production changes. Continue in existing Draft PR #1088; #1077 paths untouched.
