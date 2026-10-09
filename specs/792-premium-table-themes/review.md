# Review — #792 design approval milestone

Date: 2026-10-09. Baseline main: `669cfdb41f98dde8adf179445360c1916e021612`. Draft PR: https://github.com/krzysztofcal/arcadePlatform/pull/1076

## Independent review

A separate reviewer inspected SpecKit, existing Poker V2 integration, the six-theme concept board, baseline captures, gallery and six SVG detail sheets.

Findings resolved:
- Clarified card-art inheritance: scene dealing/showdown/fold FX uses `createCard()`; separate celebration cards retain existing treatment.
- Added stable-state geometry measurement selectors to quickstart; pre-design/post-design governance status is explicit.
- Added six original vector face/back/frame/material detail sheets to establish theme-specific face art, beyond plain generated face samples.
- Explicitly stated generated Classic ornaments do not replace shipped default art.

Final assessment: no remaining critical or important design-stage findings; suitable for owner review of six complete art directions. Owner approval remains pending.

## Evidence

- SpecKit check: exactly six stable IDs, 17 ordered tasks, complete required artifacts, no unresolved requirement markers or Git commands.
- Existing source: `node --check poker/poker-v2.js` exited 0; `npm run check:csp-inline` passed for 52 served documents. No product runtime or CSP changes are included in this milestone.
- Local Chromium, desktop 1440×900 and mobile 390×844: six theme sections, 36 component descriptions, all nine image/detail resources loaded, zero scripts, no page errors, no horizontal overflow.
- All six SVG detail sheets parsed as XML; Royal rendered and visually inspected. Current-size samples demonstrate rank/suit sizing; final decorated-card native-size checks remain pending.
- Baseline captures from unchanged demo: landscape 1440×900, portrait 390×844. Generated board 1536×1024; SVG details 1200×410. Provenance, bytes and hashes are in artwork.md.

## Deploy Preview

Target: https://deploy-preview-1076--playkcswh.netlify.app/specs/792-premium-table-themes/design/

Verified gallery revision: `447eafbd1de24e4b8fd9935bad6019289a6762a4`. Netlify `netlify/playkcswh/deploy-preview` reported “Deploy Preview ready!”. Remote Chromium checks at 1440×900 and 390×844 returned HTTP 200: six theme sections, 36 component descriptions, all nine image/detail resources loaded, no page errors and no horizontal overflow. A screenshot of the deployed desktop gallery was visually inspected. Netlify injects its preview helper; the source gallery contains no scripts. This URL serves a static review gallery at this milestone, not implemented runtime theme switching.

GitHub comparison against baseline confirmed all 22 changed files are under `specs/792-premium-table-themes/`; product runtime and layout are unchanged. The final evidence/task update modifies Markdown only, preserving the verified gallery artifacts.

## Scope and limits

Only `specs/792-premium-table-themes/**` is changed. No breaking runtime/API/schema/layout changes, Stage effect, WS/protocol changes, dependencies or Production deployment. PR stays Draft; issue remains open.

Concept illustrations redraw geometry and omit parts of action/HUD composition; they are approval references, not geometry evidence. Final per-layer exports, native-size readability/contrast, dealer head/hand registration, zero-displacement comparisons, Preview FX switching, live game smoke and final code review remain T007–T017 after owner approval. No completed-feature or merge-ready claim is made.

## Royal Gold implementation checkpoint

Scope: seven complete Royal Gold layers, a six-ID catalog with four pending alternatives disabled, and existing Preview FX extended for page-local art selection. Classic defaults remain inherited and reload/reset removes overrides. Full six-package completion is not claimed.

Local Chromium with actual Poker V2 demo, temporary tooling outside the repository:
- 390×844, 844×390, 1440×900: 16 selected protected element bounds before/after are identical (0 CSS-pixel displacement); no horizontal document overflow or page errors. Dealer hands/deck visually inspected against the unchanged default. Cards retain live rank/suit text and made-hand/turn cues.
- Failed dealer request retains Classic and reports failure. Delayed Royal→Classic cannot apply stale artwork. Reload restores Classic. Missing BUILD_INFO, Production and false isPreview all omit the chooser.
- Eight effect demo buttons remain disabled in unseated demo; existing effect click checks and gift eligibility remain unchanged. Theme selection creates only local static-art image loads; code has no storage, API, WS or account writes. Guest/live reconnect/dealing/showdown validation remains pending.
- Native keyboard ArrowDown/Enter selects Royal Gold through Menu → Table settings → Preview FX at 390×844; chooser stays focused and live status announces application. Reduced-motion smoke completed with the same static switch.
- Visual finding fixed: default SVG aspect-ratio letterboxing produced rectangular felt patches; felt/rail now stretch their surface texture inside the existing CSS border radii without changing DOM bounds.

Existing checks: node --check poker/poker-v2.js PASS; npm run check:csp-inline PASS for 52 served documents. No new maintained test suite. Independent reviewer compared JS/CSS with live 5eef334f and found no critical/important issue; requested export inventory was completed in artwork.md. All seven assets total 247,295 bytes. No Stage/WS/Production changes.

Owner must inspect final Royal Gold on Deploy Preview before other dealer variants are produced. Exact deployed revision, live verification and final acceptance are recorded separately below; final all-six native-size/contrast/live gameplay review remains pending.

### Exact-revision Deploy Preview verification

Verified browser BUILD_INFO.commitHash = `78d591a0fb4e7e7ed87f6aaa299277830726ec0f`, Netlify deploy `6ac96b190a75ee0008661864`, HTTP 200. Table URL: https://deploy-preview-1076--playkcswh.netlify.app/poker/table-v2.html ; immutable tested deploy: https://6ac96b190a75ee0008661864--playkcswh.netlify.app/poker/table-v2.html .

Remote Chromium repeated demo checks on the actual Deploy Preview with its real build metadata (no injected preview gate): all three target viewports show Royal Gold, 16 protected bounds remain unchanged, no page errors or horizontal overflow, eight effect buttons remain disabled for unseated demo. Blocked dealer load retains Classic; delayed Royal→Classic retains Classic; reload restores Classic. Native mobile keyboard chooser works with reduced motion and retained focus. Cached Royal Gold application measured **1.5 ms** on this Chromium runner (target ≤100 ms); this is a runner result, not a guarantee on all devices.

RG05 is complete for this art-only checkpoint; RG06 owner acceptance and full live guest/reconnect/dealing/showdown/contrast/all-six validation remain pending. A following docs-only evidence commit does not alter any deployable presentation artifact; the verified runtime SHA above remains the checkpoint revision.
