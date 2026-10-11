# POC artwork and visual review — #1086

Owner approval pending. This is T001–T004, not the six-theme rollout.

## Baseline and impact map
Live main `97f8b8e521871548270db0f779ee3d87e67412c6`. Existing `poker/table-v2.html:119–122` has shell, felt and inner-ring siblings; seat/chip/name/center/FX layers remain above artwork. Felt rules at CSS lines 7, 519, 573 set its original gradients and portrait/landscape radii. Portrait shell applies perspective(900px), rotateX(12deg), rotateZ(-3deg); the static material follows that physical surface, without 100% background stretching. Landscape does not rotate the shell. Inner ring remains an independent sibling. No DOM or orientation rule was changed.

Neon SVG retains purple radial shading and cyan circuit ornament. All five original theme felt SVGs, room/rail/dealer/card assets, theme catalog order, FNV table-ID mapping and image preload/fallback are untouched. Classic intentionally has no data-table-theme attribute; POC selector uses that existing representation. Other four theme attributes do not match the POC selector. A brief Classic fallback during loading can therefore show the shared material; its single URL is reused.

Parallel #1077 has an isolated worktree and currently changes quick-seat/init/notify backend, shared join, WS bootstrap/persistence/table/server and its specs. This branch changes none of those paths. Recheck upstream before any future rollout.

## Original asset
`poker/assets/scene/felt-weave.webp`: 384×384 RGBA, 68,632 bytes (67.02 KiB), SHA-256 `ed08e67fcb79bf51200aad7892a612553f92f19978c967fa818482e8173eb7f8`.

Created with built-in imagegen for this issue, without an input/reference image or third-party artwork. Prompt requests original seamless, uniformly lit neutral fine wool-baize fibers, no logos/lettering/borders/table, actual transparent inter-fiber gaps. Generated PNG is 1254×1254 RGBA; alpha is near opaque (measured 242–251 after initial resampling), so generation did not provide the wide transparent gaps requested. Documented honestly: final WebP retains generated alpha and CSS opacity .24 provides the restrained translucent material layer. This is generated original artwork, not a claim of third-party license clearance or exclusive copyright.

Existing sharp 0.34.x performs ordinary size/format optimization: resize 384×384, WebP quality 80, alphaQuality 80, effort 6. No dependency added. Raw source remains outside repo in the imagegen output directory. The initial 512×512 candidate was 132,712 bytes; it was rejected in favor of the smaller candidate before handoff.

One 256×256 scene-CSS-pixel repeated tile over the existing art, border-radius inherited, pointer-events none. All original declarations remain unchanged. No filters/blend modes/WebGL/canvas/timers/runtime texture generation or new JS. Missing/blocked WebP leaves the original background and inner ring visible; it does not participate in the existing theme asset preload and cannot make the Neon theme fail.

## Variant decision
A: material only — the actual POC CSS in this Draft PR.
B: material plus subtle ARCADE POKER — review-only temporary browser-injected felt ::before, no committed runtime selector, DOM, JS or theme setting. Small matte lettering sits in the lower felt behind content. It follows existing surface perspective and therefore has slight tilt in portrait. Owner may approve material and reject marking independently. Final marking placement/style remains conditional on GO; it is not silently enabled by this PR.

## Verification status
Real renderer baseline captured locally at 390×844, 844×390 and 568×320, with isolated identity/WS/CH fixtures producing community and hole cards, pot/seat chips, names and wallet/action HUD. Browser emulation, not a physical-device or authenticated WS smoke. Exact-SHA deployed captures, resource/performance evidence and review links will be recorded below before T004 handoff.

Existing baseline lifecycle guard and CSP hash guard passed. No new UI/CSS suite. Shared Stage/Production/WS mutation: none. Green checks are not owner visual approval.
