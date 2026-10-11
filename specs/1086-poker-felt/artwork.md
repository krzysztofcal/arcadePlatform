# Final artwork and verification — #1086

Owner approved Classic/Neon saturated branded design and level portrait; GO T005–T007 extends it to all six themes. Existing Draft PR #1088, no merge or Stage/Production action.

## Assets and rendering
Original shared `felt-weave.webp`:384×384 RGBA,68,632B, SHA256 `ed08e67fcb79bf51200aad7892a612553f92f19978c967fa818482e8173eb7f8`. Generated originally for this issue with imagegen (neutral seamless fine baize, no logo/reference artwork); optimized using existing sharp, WebP quality80/alphaQuality80/effort6. Source alpha is near opaque, not an unfulfilled claim of transparent gaps; soft-light/opacity provide the material blend. Source PNG remains outside repo.

Original `felt-house-mark.svg`:360×220,1,480B, SHA256 `716aec2d06de875b6e715661c38e89784f30743fcf83b309db770e9b18950bfc`. Hand-authored medallion/spade/leaves and ARCADE/POKER CLUB. No copied brands/event art or external SVG resources. Two static same-origin assets total70,112B /68.47KiB; decoded weave ~576KiB.

Shared noninteractive felt ::after repeats128px at opacity.40 with soft-light inside isolation:isolate. Shared ::before places print at50%50%,240×147portrait/280×171landscape, over colored illumination. Classic emerald, Neon violet, Royal charcoal with warm gold lighting, Midnight blue, Crimson burgundy, Emerald green. Original ornament SVGs/gradients, catalog/map/preload, DOM and inner ring remain unchanged. One existing portrait shell rule keeps perspective(900px) rotateX(12deg), removes in-plane rotation for all themes. Cards/chips naturally cover the centered seal. No extra JS/renderer/library/filter/animation.

## Verification
Final exact-SHA Netlify captures and summary will be recorded here after validation. Temporary browser tooling stays outside repo. Required24views: six themes×390×844,320×568,844×390,568×320. Native deployed renderer/art with isolated identity/WS/CH fixtures, no live game mutation. Mobile Chromium emulation/touch, not physical-device or authenticated-WS acceptance.

Only final review images and two concise original-main landscape comparisons are retained in this feature. No historical variants or large raw measurement JSON. No unrelated documentation/production asset removal.

## Self-review and limits
Presentation-only; no poker/backend/WS/DB/economy/schema/protocol/config/dependency changes or #1077 edits. No new CSS/UI tests. Existing syntax/CSP/guards/test:unit and GitHubCI verification required. New inline scripts:none, CSP hashes unchanged. Missing optional weave/print retains original theme art and lighting; unsupported blend disables optional weave. Serif fallback can vary letter shapes, centering remains fixed. Static blend has compositor cost; mobile emulation timings do not prove physical GPU/battery performance. Final PR remains Draft for owner final review.
