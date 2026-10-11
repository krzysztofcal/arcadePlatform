# POC artwork and visual review — #1086

**Current review: centered larger Arcade seal, owner approval PENDING. T001–T004 only.** This report supersedes the initial gray material and small/off-center branding. No T005–T007 GO.

## Baseline and DOM impact map
Main fetched again: `97f8b8e521871548270db0f779ee3d87e67412c6`. `poker/table-v2.html:119–122` has shell, felt and independent inner-ring siblings. Original portrait/landscape felt geometry, gradients and radii remain unchanged. Portrait shell has perspective(900px), rotateX(12deg), rotateZ(-3deg); imprint follows this existing physical surface. Seat/chip/name/card/HUD layers remain above the felt. No DOM, JS, orientation sizing or poker behavior change.

Theme SVGs, room/rail/dealer/card art, theme catalog, FNV table-ID mapping, preloads and fallback remain untouched. Classic has no data-table-theme attribute; this existing representation and neon-vegas alone match the POC selectors. Four other theme attributes have no new material/artwork layer. #1077 backend/shared/WS files are untouched; no setup/dependency/config changes.

## Original assets and implementation
`poker/assets/scene/felt-weave.webp`: 384×384 RGBA, 68,632 bytes (67.02 KiB), SHA-256 `ed08e67fcb79bf51200aad7892a612553f92f19978c967fa818482e8173eb7f8`.

Original imagegen output for this issue, without third-party reference artwork. Prompt requested seamless uniformly lit neutral wool-baize fibers, no logo/table, transparent inter-fiber gaps. Generated PNG was 1254×1254 RGBA, near-opaque alpha (242–251 after initial resampling); transparency did not meet that prompt preference. Existing sharp optimized to 384×384, WebP quality80/alphaQuality80/effort6. No dependency added. Raw source remains outside repo. This records provenance, not exclusive copyright/license guarantees.

The initial ordinary RGB overlay at opacity .24 desaturated Neon and was rejected by owner. Current single shared ::after repeats at 128×128 scene CSS px, opacity .40, soft-light within felt isolation:isolate. This preserves hue and makes fibers finer. No stretch-to-fit, animation, filter, new JS or runtime generation. Unsupported soft-light disables only optional texture; missing WebP leaves underlying theme and lighting intact and cannot fail theme preload.

`poker/assets/scene/felt-house-mark.svg`: original 360×220 vector, 1,480 bytes, SHA-256 `716aec2d06de875b6e715661c38e89784f30743fcf83b309db770e9b18950bfc`. Original medallion, spade, leaves, principal ARCADE serif wordmark and secondary POKER CLUB; matte translucent ink, no external resources/scripts/filters. Native SVG follows existing artwork approach. Reference screenshots inspired saturation/printed branding, no copied game logo/event/sponsor artwork.

Noninteractive ::before combines mark and translucent colored radial illumination without replacing original gradients/ornaments. Classic stays emerald; Neon saturated violet. Owner explicitly requested geometric center and accepted cards/chips occlusion: background-position 50% 50% both orientations. Mark is 240×147 scene CSS px portrait, 280×171 landscape. Both pseudo-elements inherit border-radius and pointer-events none. Material-only A uses temporary browser CSS to hide the SVG while retaining lighting/material; branded B is committed two-theme POC. A may still fetch SVG before the review override; no claim of separate product setting or network saving.

Combined runtime art: 70,112 bytes (68.47 KiB), two static same-origin resources. Decoded texture RGBA ~576 KiB. Static docs images are not linked into gameplay and add zero game requests.

## Exact-SHA Preview and visual evidence
Draft PR: https://github.com/krzysztofcal/arcadePlatform/pull/1088 (Draft, no merge).
Runtime/art SHA: `609c48fa599e18b408f27359721f97252fd0dc39`.
Netlify ID `6acbff41817d36000769f4ea`, state ready, context deploy-preview, commit_ref matches exactly.
Immutable runtime: https://6acbff41817d36000769f4ea--playkcswh.netlify.app.
Mutable PR gallery: https://deploy-preview-1088--playkcswh.netlify.app/specs/1086-poker-felt/design/.

Fetched CSS SHA-256 `8ca8daa38340b77624e729be2cdd5f1149310ad0712e2de829c8bf418cc0a896`, SVG and WebP hashes match local byte-for-byte. Subsequent commit updates only specs/captures; final documentation SHA/immutable gallery is recorded in PR. No runtime change after these captures.

[Gallery](design/index.html): six scenes, each with current B active hand, B without community cards, A material-only, rejected gray POC and original main. Portrait390×844, landscape844×390, short landscape568×320, Classic/Neon. Baseline/rejected retained from previous deployed capture with unchanged HTML/JS/assets/geometry; baseline uses exact original main CSS. Current A/B/board-clear all fetched from exact runtime SHA above. Full SVG available separately; pot/seat chips and HUD still naturally cover parts of the board-clear mark.

Real deployed HTML/CSS/renderer/art, isolated identity/WS/CH browser fixtures (hero and bots, cards, pot, wallet/actions). External unrelated services blocked, Poppins loaded, CSP enabled. Browser emulation in desktop Chromium, not physical mobile or authenticated real WS/ledger gameplay. No live table mutations.

## Validation, performance and breaking impacts
[Raw measurements](design/measurements.json) record resources, geometry, frame timings, errors and controls. All current A/B scene/felt/community/hero/action rectangles and scroll dimensions match baseline at all six sizes; centered art does not move content. Felt projected sizes ~332.74×479.91 portrait,751.57×200.63 landscape,501.05×133.75 short landscape. Action hit tests pass. Menu opens/closes, mouse dragging existing range20→95 updates Bet(95), no join/rebuy. Four deferred themes have no ::after; no animation/filter with reduced motion. No JS/CSP errors in A/B/board-clear/blocked/control captures. Blocking WebP retains selected theme and readable layout, plus optional vector/lighting.

90-frame headless desktop Chromium requestAnimationFrame samples are an orientational signal only; see raw per-scene median/p95/max. These do not measure physical mobile GPU cost, paint performance during heavy gameplay or battery use. New blend isolation has some compositor cost and requires owner/device judgment; static repeat limits ongoing work. Missing SVG omits the house mark while original surface remains. Font fallback may change serif letter shapes across platforms; geometric centering remains fixed.

Visual review: no observed tile seams, stretched fibers, new rail clipping or geometry change. Card ranks/suits, amounts/actions and HUD remain readable. Center lettering intentionally sits under cards/chips; this is owner-requested natural occlusion. Existing Neon circuits remain in original SVG but are attenuated by colored illumination; do not claim unchanged ornament prominence. Recommendation B: larger centered seal plus hue-preserving material. Owner must assess final realism, saturation and ink strength.

Self-review: original CSS remains unchanged prefix, ten appended lines; one physical rule line per selector. No HTML/JS/theme assignment/API/protocol/schema changes. No backend/WS/DB/CH/Stage/Production/deployment/merge. Existing lifecycle/badge/XP guards, syntax226files, CSP55served documents and diff whitespace pass. No new CSS/UI tests. Independent read-only review of current centered seal found no critical/important breaking impacts; browser inspection is separate. No expected functional breaking impact; visible impact only two-theme felt, two cold resource requests, optional isolated blending.

Supplemental unscoped check-xpbadge.js reports missing XP anchors on four pre-existing main design galleries plus this static documentation gallery. Configured guard-badge scopes public/game pages and passes42files. No fake XP runtime or unrelated tooling changes to silence that diagnostic. GitHub/Netlify status is build evidence, never visual acceptance.

## T004 — STOP
Review updated after owner requested larger geometric-center branding. Owner visual approval still pending for material and mark. T005–T007 and other four themes remain unchecked and unauthorized. PR stays Draft.
