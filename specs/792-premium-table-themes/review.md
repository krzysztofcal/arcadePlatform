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

## Direct design extraction after wardrobe feedback

The earlier generated high-neck costume did not match the approved design. Owner authorized direct design extraction and deterministic enlargement. Export now uses the approved board character itself with an original alpha matte; only dealer.webp changes in deployed presentation, with source/mask/reproduction script recorded in artwork.md. No new generator call, API key, CSS/JS/gameplay change or dependency. Two independent exports produced identical SHA-256 `fbfa14d4c2b4c36f1f40e779dac4a3af24e561524d502310c37a7db92d643aac`; transparent output is 546×640, 46950 bytes, well below 220 KiB. This is a faithful enlarged crop, not recovered high-resolution detail: native-size acceptance remains the owner decision.

Local Chromium rechecked the final extracted sprite at 390×844, 844×390 and 1440×900: 16 selected protected bounds unchanged, no page errors or horizontal overflow; source dress V neckline visible, hands/deck remain registered at the existing anchors. The lower garment uses only a deterministic extension of sampled source dress fabric because the source table obscured the waist. Syntax/CSP checks pass (52 documents). Exact live deploy verification follows publication.

### Extracted dealer — exact live Preview evidence

Browser BUILD_INFO verified runtime `ddf91f671e5306f11cca562976f8617b6eb2b1f7`, Netlify deploy `6ac96fe49a691d00081eadfb`, HTTP 200. Tested URL: https://6ac96fe49a691d00081eadfb--playkcswh.netlify.app/poker/table-v2.html . Mutable PR URL: https://deploy-preview-1076--playkcswh.netlify.app/poker/table-v2.html .

Remote Chromium inspected the extracted Royal Gold dealer at 390×844, 844×390 and 1440×900. Source V neckline and dress cut are visible; alpha removes source room/table; sampled lower fabric bridges the originally occluded waist at the live rail. Sixteen selected protected bounds unchanged, no page errors/horizontal overflow, eight unseated-demo effect controls disabled. Classic/reload, blocked dealer-load retention and delayed Royal→Classic checks pass. Owner final native-size quality acceptance remains pending; source detail is still limited to the original small board crop. Subsequent evidence-only commit changes no runtime asset.

## Owner rejection and high-quality restoration

Owner rejected the deterministic enlarged design crop as unacceptable. Restored original imagegen dealer.webp byte-for-byte from pre-extraction 9df2500: 72,014 bytes, SHA-256 `3eaf2a6f46d8145a6b8dd1d85751c3a06dc2d9e734c265110caa3b8120c9622d`. Current source is the original high-resolution generated sprite export, including the gathered high neckline explicitly restored by the owner. Removed the rejected extraction script and alpha mask. Other art and runtime JS/CSS are unchanged; prior extraction evidence is historical, not current visual acceptance. Live restoration verification follows publication.

### Restored imagegen dealer — live verification

Verified runtime SHA `c8492a6f69f98196d4163b8b1b857a68f43421c1`, Netlify deploy `6ac970c315dedb0008c33aa1`, HTTP 200. Exact tested table: https://6ac970c315dedb0008c33aa1--playkcswh.netlify.app/poker/table-v2.html . Downloaded live dealer.webp has SHA-256 `3eaf2a6f46d8145a6b8dd1d85751c3a06dc2d9e734c265110caa3b8120c9622d`, identical to the original imagegen export.

Remote Chromium rechecked 390×844, 844×390 and 1440×900: Royal Gold loads the restored dealer, 16 protected bounds unchanged, no page errors/horizontal overflow, Classic/reload/error/stale-request retention pass. CSP guard passes for 52 served documents. No regeneration, runtime JS/CSS, Stage, WS or Production change. Following evidence commit changes documentation only. Royal Gold owner checkpoint acceptance remains pending.

## Full lower-torso imagegen repair

Root cause: the restored sprite central dress ends around row 575 of 640 (90%), leaving transparent waist before the existing rail covers it. New high-quality imagegen edit fills central lower dress through the bottom; same 546×640 canvas and reference identity/pose/hands/deck. Old ::after clip would redraw the new lower dress over the rail; a Royal-only normalized foreground polygon follows arms/hands/deck and keeps the torso behind the rail. Classic unchanged.

Final export 79,894 bytes, SHA-256 `48373c618583ef00ad102da90a28b24a8e1d01ac742eb4ff58de3389d7f1f8ba`; decoded lower-center alpha minimum 252/255 through rows 576–639. Local Chromium at 390×844, 844×390, 1440×900 shows continuous waist hidden by rail, hands/deck foreground, 16 protected bounds identical, no page errors/overflow. High-DPI waist close-up inspected; source cutoff/gap no longer visible. Classic/error/race/reload and build gates pass. Existing syntax/CSP checks follow before publication; exact live repair verification follows publication.

Independent final repair reviewer inspected all three native-size captures and the high-DPI waist close-up: no critical/important findings; arms/hands/deck visible, torso behind rail and no conspicuous clipping. Inventory/provenance and changed foreground clipping documentation updated as requested. Syntax and CSP guard PASS (52 served documents).

### Complete torso — exact live Preview evidence

Verified runtime SHA `859f8b41dd67a5a9e8d941eab126d52389de27f5`, Netlify deploy `6ac974057df72c0008598b58`, HTTP 200. Tested table: https://6ac974057df72c0008598b58--playkcswh.netlify.app/poker/table-v2.html . Live asset SHA-256 matches export `48373c618583ef00ad102da90a28b24a8e1d01ac742eb4ff58de3389d7f1f8ba`.

Remote Chromium at 390×844, 844×390 and 1440×900: 16 protected bounds unchanged, no page errors or horizontal overflow, eight unseated-demo FX buttons disabled, Classic/reload and blocked/stale art-load retention pass. Inspected the published mobile waist at deviceScaleFactor 3 using a crop from its complete screenshot: continuous dress behind rail, no horizontal source cutoff/transparency gap, hands/deck in foreground. Independent final repair review found no critical/important issue. Syntax/CSP guard PASS (52 documents). No backend/WS/Stage/Production change; subsequent evidence commit changes docs only.

## Remaining four packages completed — 2026-10-09

Owner accepted Royal Gold full-torso repair and authorized all remaining themes on the same PR. Added 28 complete local art files for Neon Vegas, Midnight Sapphire, Crimson Velvet and Emerald Palace; all six chooser entries enabled without pending labels. Existing atomic loader, preview gate, gameplay/celebration restrictions and Classic default remain. Every export is documented in artwork.md with dimensions/bytes/SHA and exact built-in imagegen prompts; SVG motifs follow reviewed detail directions. Dealer canvas registration and full-torso masking visually checked against accepted Royal Gold. Packages 471772/395441/375353/515928 bytes fit budgets.

Existing checks: `node --check poker/poker-v2.js` exits 0; `npm run check:csp-inline` passes for 52 documents. Temporary ad-hoc Chromium inspection outside the repository covered all six × 390×844/844×390/1440×900: 16 protected bounds unchanged, live card text unchanged, no overflow/page errors, no unselected package requests, failed load retains Royal Gold, delayed Neon cannot overwrite Emerald/Classic, reload Classic. Cached non-default switches 1.6–12.9 ms (target <100 ms). Native keyboard traverses all five alternatives while retaining focus; reduced motion; three absent/non-preview gate cases expose no chooser. Eight effect controls remain disabled in demo. All 18 scene screenshots captured; native hero/board/best-hand cards and active/folded/frame cues inspected, representative captures independently reviewed.

Independent requesting-code-review follow-up: no critical/important findings in JS/CSS/contracts/art; all four dealer exports preserve identity/head/hands/deck and continuous torso behind the rail. Optional minor warm cutout fringe also exists on accepted Royal; unobtrusive at native scene size. No source geometry/motion/private-card/WS/account mutation changes.

Limit: demo/static inspection does not prove authenticated live guest/spectator/reconnect/dealing/showdown/fold or comprehensive contrast in those live states; manual runtime verification remains pending (T011/T013). Implementation ready, awaiting manual runtime verification; Draft retained. Exact-SHA Deploy Preview evidence follows below after publishing.

## Exact-revision six-theme Deploy Preview evidence

Runtime SHA **0d5b818532d16c684c1072df8a3b7683257f7c2a**. BUILD_INFO.commitHash matched at all three target viewports; context deploy-preview/isPreview true; HTTP 200. Deploy ID **6ac976c5dd8c1e0008c5b89a**; Netlify preview status success. Stable exact deploy: https://6ac976c5dd8c1e0008c5b89a--playkcswh.netlify.app/poker/table-v2.html . PR alias: https://deploy-preview-1076--playkcswh.netlify.app/poker/table-v2.html .

All six selections × 390×844, 844×390, 1440×900 passed actual Preview Chromium inspection with no metadata spoof: 16 protected bounds and card text unchanged, no page errors/overflow/unselected art requests. Failed Neon asset retains complete Royal and restores selector; delayed Neon cannot override Emerald or Classic; reload resets Classic. Keyboard traverses all five alternatives with focus retained under reduced motion. Eight gated demo effects remain disabled. Cached non-default switches 1.5–32.1 ms, below 100 ms target. Native scene screenshots and 3×-DPI waist/rail crops inspected for all four added dealers: continuous dress behind rail, hands/deck foreground, no horizontal source cutoff/gap. Eight served room/dealer SHA-256 values match local exports. Existing light card face #fffdf6 gives red #c82323 contrast **5.55:1** and black #111827 **17.43:1**; normal ranks/suits remain live text. Comprehensive authenticated live-state contrast remains pending.

Temporary evidence remains outside repository: /tmp/1076-local-all-report.json, /tmp/1076-remote-all-report.json, scene screenshots and waist crops. No maintained UI/CSS/glue suite was added. Independent final review is documented above; no critical/important issue.

The following evidence commit changes only feature documentation/task status; verified commit paths contain no deployable runtime/configuration change, so the exact runtime Preview evidence remains valid. T017 satisfied; T011/T013 only retain manual authenticated live scope. Implementation ready, awaiting manual runtime verification; PR stays Draft.

## Five background floor-plane corrections — 2026-10-10

Scope: exactly five existing room.webp files plus feature documentation. Classic1600×900 has a visually estimated central floor junction near38.9%; original alternatives1536×1024 had near40–59%. Exact cover mapping at portrait gave≈328px Classic vs338–495px alternatives. Royal already had similar centralrow, so its correction also addresses architectural scale/depth/contact cues and reflection length. These visual estimates do not recover a physical camera calibration. Measurements, uncertainty, chosen proportions and exact prompts are in perspective.md.

Built-in imagegen edits preserve each room’s identity and produce continuous receding foreground floors without competing oval rugs/raised platforms. Royal first candidate inspected in all three viewports before other edits. Final local rooms1600×900, approximate rear-floor rows310–320/900 (34–36%), within all budgets. All non-room files byte-identical; local inventory SHA audit found exactly five changed runtime assets and33unchanged inventoried files, including JS/CSS/Classic/dealers/vectors. No background-position/size or scene geometry edits.

Temporary Chromium before/after capture18scenes (all six choices×390×844/844×390/1440×900):18protected bounds exactly equal, card text unchanged, no overflow/page errors; CSS background-position/size identical. Existing node syntax check exits0; CSP guard52served documents passes. Temporary static inspection tools/captures remain outside repository. Final independent review inspected all five corrected rooms at all three targets, confirmed improved grounding/style/no obstruction/budget compliance; no critical/important findings. Exact published Preview validation follows after push. Existing live authenticated dealing/showdown/reconnect limits remain pending; Draft retained.
