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

## Exact-SHA Netlify evidence
Draft PR: https://github.com/krzysztofcal/arcadePlatform/pull/1088.
Runtime/art SHA: `f92527351f7bf1285cf865949e6366759c505f49`. Netlify deploy ID `6acbf738e0c1ac0008d5f508`, state `ready`, context `deploy-preview`, commit_ref matches exactly. Immutable runtime URL: https://6acbf738e0c1ac0008d5f508--playkcswh.netlify.app. Mutable PR alias: https://deploy-preview-1088--playkcswh.netlify.app.

[Native-scale comparison gallery](design/index.html) contains 18 real deployed-renderer captures: both themes × portrait/landscape/short landscape × original main CSS/A/B. Entire review screenshot payload is 1,149,666 bytes, loaded only on the documentation gallery; it adds zero requests to gameplay. Baseline substitutes the exact original main stylesheet; deployed HTML/renderer/theme art are byte-equivalent because they were not edited. A uses fetched deployed CSS and WebP; B adds only the temporary review pseudo-element. CSP is not disabled. Google Poppins fonts were loaded for all final comparisons. Identity, WS and ledger endpoints were fulfilled locally in the browser; unrelated third-party requests were blocked. No authenticated real table/ledger smoke or physical-device testing is claimed.

Fetched CSS SHA-256 `d18c9fdbeca72f22c3f6478026eb5702c4879bc24915d288bc43da2d93a0df4f` and WebP SHA-256 above match local artifacts byte for byte. Subsequent changes are review docs/captures only; no gameplay code/art/config change. See PR for latest documentation SHA and Preview build verification.

### Measurements and rendering review
See [raw measurements](design/measurements.json). All 18 A/B/baseline scene/ felt/ community/ hero/ action-bar rectangles and document scroll extents match per viewport. Felt bounding boxes: portrait 332.74×479.91 screen px (includes the existing perspective/tilt); landscape 751.57×200.63; short landscape 501.05×133.75. Background tile remains 256×256 scene CSS px under the same existing scene transform, never stretched to 100% of surface.

One extra image resource per document, encoded body 68,632 bytes; observed resource transfer 68,932 bytes including reported overhead, durations 64–204 ms. Routing disables HTTP cache, so these measurements do not claim warmed-cache savings. Decoded tile RGBA footprint about 576 KiB. Static layer only; no new ongoing resource fetches/animations/filters. In 90-frame desktop headless Chromium samples, median requestAnimationFrame spacing 16.7 ms and p95 16.7–16.8 ms both before/after (approximately the 60 Hz scheduler). This is a limited sanity signal, not mobile GPU/FPS/battery acceptance or a benchmark of painting during heavy poker animations.

No visible tile boundaries, stretched fibers, new clipping/rail artifacts or content occlusion in reviewed captures. Community/hole ranks and all suits remain clear; chips, amounts, wallet and actions retain their backgrounds/contrast. Neon purple remains identifiable, but the light neutral fibers lift it slightly and make cyan circuits substantially subtler. This visual tradeoff requires owner assessment. Marking is very restrained and uses original surface perspective; portrait space between pot and pot chips is tight. Landscape marking is moved to the right, away from center cards/labels. Recommendation: A, texture-only; do not ship B without separate owner approval.

All six A samples pass action-button hit testing. Menu opens/closes; actual mouse dragging moves the existing range from 20 to 95 and updates the existing HUD to Bet (95). No join/rebuy is called. Reduced-motion sample reports no animation or filter on the new layer and pointer-events none. Four unmodified theme attributes report ::after content/background none; this is an exclusion check, not a final six-theme rollout.

Blocking the material request on the deployed renderer leaves original theme backgrounds intact in all six sizes. Full-image pixel comparison against baseline has mean absolute channel delta 0.00065–0.00394 / 255 (tiny pre-existing timing differences); no lost content or fallback layout shift. Neon theme remains selected because the new optional material does not enter its preload list. No JavaScript page errors or CSP violation messages in baseline/A/B/blocked/control captures.

### Self-review and breaking impacts
Original CSS is an unchanged prefix; only the POC comment and one selector line are appended. HTML, JS, theme assets/catalog/assignment, geometry, z-order, dealer origin and poker controls remain unchanged. Scope diff contains no backend/WS/shared/SQL/configuration/dependency files. Existing syntax check (using already installed parser via temporary copy outside repo), direct poker JS syntax, lifecycle/structural guards, XP hook guards, CSP hashes and diff whitespace pass. No new tests added. Independent read-only review found no critical/important code issues; it highlighted the Neon ornament attenuation for owner judgment. No gameplay/API/protocol/schema breaking impact expected. Visible impact: only Classic/Neon felt material; one additional 67 KiB cold resource. Failed WebP remains an optional visual enhancement. Documentation gallery has no scripts and is not linked into the game flow.

No WS deployment, Stage apply, production deployment or merge. Current main was fetched again after implementation and remains baseline `97f8b8e…`; #1077 paths are untouched. PR stays Draft, not merge-ready. Existing GitHub checks for runtime SHA passed or intentionally skipped/neutral; Netlify playkcswh Preview ready (landing project canceled by its existing routing).

Supplemental unscoped `check-xpbadge.js` scans every HTML file and reports missing XP anchors in four existing main design galleries plus this static review gallery. The configured CI badge guard scopes public/game pages and passes (42 files); this documentation page intentionally has no XP runtime or simulated badge. No unrelated gallery/tooling changes were made to silence that diagnostic.

## T004 owner gate — STOP
Presentation and comparison evidence prepared; **visual approval is pending**. Request explicit decision for (1) material realism at normal table scale, especially Neon circuit retention and (2) optional marking style. Recommend material-only A. T005–T007 remain unauthorized and unchecked. Do not treat green CI or this report as GO.

## Revision 2 — owner correction in progress
Owner rejected the gray Neon and weak branding, supplied saturated premium-felt screenshots, and requested corrected versions. Revision stays within T001–T004, Classic/Neon only. Initial appearance and recommendation above are historical and superseded by the new review; no owner GO for rollout.

The original WebP is reused unchanged: compositing caused gray/desaturation, not a missing theme asset. Tile scale is now 128×128 scene CSS px (previously 256), opacity .40 with soft-light inside an isolated felt stacking context; the neutral fibers modulate luminosity instead of an ordinary gray RGB overlay. This makes material finer and preserves the underlying hue. Unsupported soft-light disables only the optional material. Original Classic gradients and all existing theme SVG declarations remain intact. ::before adds translucent theme-colored radial light and optional house artwork; no original background is replaced. Neon becomes saturated violet, Classic keeps emerald. Circuits remain in the shipped SVG, with attenuation under illumination explicitly subject to owner judgment.

New original native vector `poker/assets/scene/felt-house-mark.svg`: 280×128 viewBox, 1,124 bytes, SHA-256 `db14b06391b83ce855b4501d5679db845475bf3e1646db58c64280f0ac49506b`. Hand-authored spade/leaf motif and ARCADE POKER / POKER CLUB typography; no third-party reference artwork, event branding or sponsorship copied. Uses existing native SVG artwork approach. No new raster generation needed, dependencies or scripts. B branding is now the committed two-theme POC, A suppresses the mark only through temporary browser review CSS while retaining the same light/material. This authorization is to revise and review, not to approve the appearance.

Combined artwork is 69,756 bytes (68.12 KiB), two static same-origin files, of which the added SVG is only 1.10 KiB. Portrait uses a compact mark at the upper felt; landscape uses the open right-side field so community cards and pot remain clear. It follows original table perspective. The renderer/state fixtures, viewport sizes, cards/chips/HUD and gameplay controls are unchanged. Actual exact-SHA Preview evidence will be appended before handoff.
