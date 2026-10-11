# Final artwork and verification — #1086

Owner approved Classic/Neon saturated branded design and level portrait; GO T005–T007 extends it to all six themes. Existing Draft PR #1088, no merge or Stage/Production action.

## Assets and rendering
Original shared `felt-weave.webp`:384×384 RGBA,68,632B, SHA256 `ed08e67fcb79bf51200aad7892a612553f92f19978c967fa818482e8173eb7f8`. Generated originally for this issue with imagegen (neutral seamless fine baize, no logo/reference artwork); optimized using existing sharp, WebP quality80/alphaQuality80/effort6. Source alpha is near opaque; soft-light/opacity provide the material blend. Source PNG remains outside repo.

Original `felt-house-mark.svg`:360×220,1,480B, SHA256 `716aec2d06de875b6e715661c38e89784f30743fcf83b309db770e9b18950bfc`. Hand-authored medallion/spade/leaves and ARCADE/POKER CLUB. No copied brands/event art or external SVG resources. Two static same-origin assets total70,112B /68.47KiB; decoded weave ~576KiB.

Shared noninteractive felt ::after repeats128px at opacity.40 with soft-light inside isolation:isolate. Shared ::before places print at50%50%,240×147portrait/280×171landscape, over colored illumination. Classic emerald, Neon violet, Royal charcoal with warm gold lighting, Midnight blue, Crimson burgundy, Emerald green. Original ornament SVGs/gradients, catalog/map/preload, DOM and inner ring remain unchanged. One existing portrait shell rule keeps perspective(900px) rotateX(12deg), removes in-plane rotation for all themes. Cards/chips naturally cover the centered seal. No extra JS/renderer/library/filter/animation.

## Verification
Runtime SHA `a36b6f8c035b74ec9ff166aa44daca7549a12d9e`, Netlify deploy `6acc07d460060400083a2198`, ready/commit_ref exact match. Immutable runtime: https://6acc07d460060400083a2198--playkcswh.netlify.app. Fetched CSS SHA256 `1d02f92d4aec8c9539715174e64fb8c17d18e74791864c70638d4861a28802b8`; both asset hashes above match local byte-for-byte. Later documentation commits change only this feature's specs/captures; latest immutable gallery/SHA are recorded in PR.

[Final gallery](design/index.html):24views, six themes×390×844,320×568,844×390,568×320, plus two original-main landscape examples.26images total1,607,442B, lazy loaded; zero game requests from documentation. No review scripts or large JSON. Original main `97f8b8e…` baseline is exact stylesheet with unchanged renderer/assets. Current theme mapping verified through actual unchanged hash: table-2Classic,table-5Royal,table-4Neon,table-1Midnight,table-6Crimson,table-3Emerald.

Native deployed renderer/art with isolated identity/WS/CH fixtures; no live game mutation. Mobile Chromium emulation/touch at deviceScaleFactor1, not physical-device or authenticated-WS acceptance. Raw temporary measurements/capture tooling remain outside repo.

All24scenes show five face cards, seat/pot chips, bets, names and wallet/actions. No observed new clipping, tile seams, gray dilution or stretched fibers. Center50%50% all sizes; portrait surface matrix m12=m21=0, rotateX retained. Portrait projected felt324.61×464.67px at390×844,217.10×310.78px at320×568. Community/hero/action/scene bounds and document scroll exactly match main all24; landscape felt unchanged. New layers pointer-events none.24touch menu and24touch range checks passed; existing mouse range20→95 updates Bet(95), no join/rebuy. Reduced-motion layer has no animation/filter.

45-frame samples in a single headless Chromium session: median16.7ms,p95/max≤16.8ms all24. Cold resource durations38–222ms with routing cache disabled; WebP encoded68,632B and compressed SVG697B (uncompressed1,480B). No ongoing fetch/animation. This is limited desktop mobile-emulation evidence, not physical-mobile GPU/FPS/battery certification.

Only final review images and two concise original-main landscape comparisons are retained in this feature. No historical variants or large raw measurement JSON. No unrelated documentation/production asset removal.

## Self-review and limits
Presentation-only; no poker/backend/WS/DB/economy/schema/protocol/config/dependency changes or #1077 edits. No new CSS/UI tests. Existing syntax226files, CSP55served documents, configured lifecycle/badge42/XP29 guards, test:unit games validation and diff whitespace passed. Runtime GitHubCI28checks completed, success/neutral/intentional skip, no failure. Independent read-only review found no critical/important breaking impacts; the final optional-asset and original-theme fallback checks also passed. New inline scripts:none, CSP hashes unchanged. Missing optional weave/print retains original theme art and lighting; unsupported blend disables optional weave. Serif fallback can vary letter shapes, centering remains fixed. Static blend has compositor cost; mobile emulation timings do not prove physical GPU/battery performance. Final PR remains Draft for owner final review.

Fallback validation:24views with both optional files blocked retain selected theme/layout and hit testing;24views with original theme felt.svg blocked use existing Classic fallback with material/print. Five cards/HUD remain readable; no page/CSP errors. Unsupported soft-light condition hides only ::after by CSS inspection. No API/protocol/schema breaking impact expected; authorized visual impact is new six-theme material/print and level portrait, with two cold static requests.

T005–T007 complete; final review requested in Draft PR #1088. No merge or environment mutation. Latest documentation SHA/Preview and final CI status are recorded in PR handoff.
