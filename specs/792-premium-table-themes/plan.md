# Six premium Poker V2 themes Implementation Plan

**Branch**: `design/792-premium-table-themes` | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)
**Baseline**: live `main` at `669cfdb41f98dde8adf179445360c1916e021612`.

> Execute task-by-task after owner approval, using `superpowers:executing-plans`. Follow the repository fundamental-tests-only policy; no UI/glue test suites or generic setup changes.

## Summary

Prepare six complete art directions on the existing Poker V2 layout, obtain owner acceptance, then add a small local catalog and art-only selector inside existing `bindCelebrationPreview()`. Reuse existing elements and CSS hooks; do not create a skin engine, new page runtime, store or backend.

## Technical Context

- **Language/platform**: Existing plain browser JavaScript IIFE, JSP-compatible global scripts; CSS one line per selector. Existing Node verification scripts.
- **Dependencies/storage**: No new dependencies, modules, persistence, backend or configuration system. Runtime selection is a page variable.
- **Presentation hooks**: `.poker-table-screen`, `.poker-table-shell`, `.poker-table-felt`, `#pokerRoomDealer`, `.poker-card`, `.poker-card--back`, `.poker-seat-avatar`; keep `createCard()` rank/suit DOM, `renderCommunityCards()`, `renderHeroCards()` and `renderSeats()` authority intact.
- **Preview UI**: `bindCelebrationPreview()`, `refreshCelebrationPreview()`, `renderSocialPreferences()`, `render()`. Existing `window.BUILD_INFO.context === 'deploy-preview' && isPreview === true` gate stays fail-closed.
- **Performance/export budgets**: Proposed ceilings per alternative: room WebP ≤600 KiB, transparent dealer WebP ≤220 KiB, felt/rail SVG or WebP ≤80 KiB total, face/back/frame SVG ≤40 KiB total. Package ≤940 KiB; only requested package loads, no six-theme preload. Document measured bytes/dimensions after export; reduce dimensions/compression rather than waive budget silently.
- **Scope**: Six initial packages; additional entries later can use the same small catalog and CSS hooks.

## Constitution Check

Pre-design and post-design: PASS for the reviewed design milestone (see review.md). Re-run against the actual product diff before implementation/final review.

- Layer: browser art only; WS state remains authoritative; no protocol, engine, tiers, backend or migration changes. Shared Stage effect: none. WS Preview Deploy is not required for the planned art-only diff; revisit if actual diff crosses that boundary.
- Small existing-file changes; no duplicate UI/runtime, new framework/dependencies, ignore files or tooling cleanup.
- JSP IIFE/globals, `klog(...)`, CSS one line per selector. Keep `poker/table-v2.html` inline scripts/styles unchanged if possible; any necessary inline script change requires matching CSP SHA in `_headers` and `npm run check:csp-inline`.
- Tests: presentation/glue changes must not introduce UI/CSS/layout/JSP/glue suites. Use temporary preview inspection outside the repository and existing checks.
- SpecKit contains paths/functions and no Git commands. No Git shell commands are used; branch/commit/Draft PR operations use GitHub connector.
- Owner visual approval blocks product implementation. Draft PR and Netlify Deploy Preview only; never merge or deploy Production.

## Project Structure

- `specs/792-premium-table-themes/`: spec/plan/tasks, research, data-model, preview contract, quickstart, approval/review and artwork provenance.
- `specs/792-premium-table-themes/design/`: static review boards, detail sheets and unmodified-layout baseline captures; review-only gallery with no gameplay runtime.
- `poker/assets/themes/<theme-id>/`: approved, optimized local layer exports after approval. Classic reuses existing assets explicitly.
- `poker/poker-v2.js`: small catalog `TABLE_THEME_CATALOG`, page variable `previewThemeId`, `applyPreviewTheme(themeId)` and chooser added inside `bindCelebrationPreview()`.
- `poker/poker-v2.css`: scoped presentation rules under the table screen theme attribute; background/decorative face/back/frame overrides only. No geometry or global selectors changed.
- `poker/table-v2.html`: reuse existing elements; no markup changes planned.

## Approach and Alternatives

Recommend complete local art packages applied to existing hooks. CSS-only felt variations do not satisfy the latest brief. A generic skin/config framework and durable user selection add scope owned by #800/#1070 and are rejected for V1. Generate/author original art, export only approved per-layer art, and preserve live text rank/suit rendering rather than generating 52 image cards per theme.

## Execution

1. Prepare SpecKit, six room/wardrobe/material/card/frame directions and unchanged baseline screenshots. Publish a static approval gallery on the Draft PR Deploy Preview; no product theme behavior yet. Record review limitations and owner approval state.
2. After owner acceptance, export five alternative room/dealer sets and deterministic decorative vectors. Match dealer's current normalized hand/card origin at `(0.5, 0.84)` within its unchanged box; compare head/hand registration and `::after` clipping against the existing asset. Keep Classic unchanged. Record origin, terms, dimensions, bytes and hash per exported asset.
3. In `poker/poker-v2.js`, define `TABLE_THEME_CATALOG` with the six exact IDs/labels and required local asset paths. `applyPreviewTheme(themeId)` validates catalog membership/build gate, preloads only the requested required assets and sets one screen `data-preview-theme` attribute after load. A monotonically increasing request token prevents stale commits; Classic cancels pending work and removes the attribute. On failure retain current art and show text feedback; `klog` records cosmetic errors without identity/token data.
4. Add a labeled native Theme select/status inside existing `bindCelebrationPreview()` panel. Make the Preview FX container available on preview for demo/guest/spectator while preserving all existing effect click checks. Audit every assignment to `els.celebrationPreview.hidden` in `render()`, preference rendering and leave paths. Disable unavailable celebration/gift controls separately; theme does not require seating, WS readiness or winner dismissal. No localStorage/API/WS writes.
5. Scope CSS under `#pokerTableScreen[data-preview-theme="..."]`. Decorate existing room, rail/felt, dealer, face/back and frame. Cards retain existing rank/suit text, dimensions, z-order, identity and private reveal rules; Scene dealing/showdown/fold card FX inherits the same art; `.poker-celebration__card` retains its existing celebration treatment and is outside table-deck styling. No changes to `seatSceneGeometry`, `configureSeatHud()`, `syncSceneScale()`, action layout or dealer dimensions/coordinates. Preserve turn/highlight/empty-seat cues and all current motion rules.
6. Verify with the existing syntax/CSP checks and targeted preview scenarios in quickstart. Review actual diff, asset completeness/provenance, native-size card legibility and bounds before final handoff. Stay Draft; report actual Deploy Preview URL, deployed SHA, observed evidence and any pending manual live verification.

## Review Focus

- Delayed/failed art or rapid selection retains a coherent scene and cannot overwrite a newer choice.
- Non-preview/missing build metadata never exposes or applies alternative art.
- Guest/spectator/reconnect access exposes only art selection; celebration and gameplay restrictions remain.
- Small showdown cards, made-hand/turn indicators and avatar states remain legible across all six designs.
- Dealer hand registration, `::after` clipping and card-flight origin match in portrait/landscape; art changes do not shift hit targets.

## Validation

After implementation: `node --check poker/poker-v2.js`; `npm run check:csp-inline`; inspect local asset presence/bytes and review the diff. Targeted Deploy Preview checks: six selections, Classic/reset, cached/failed/rapid loading, keyboard, reduced motion, both mobile orientations and desktop; exact protected bounds captured before/after. Use existing demo for art smoke and a live preview table for dealing/showdown without introducing a new test suite. Current phase review verifies documentation and static gallery only, not runtime theme behavior.

## Breaking Impact

No intended breaking API, schema, gameplay, tier, layout or default presentation changes. Preview FX visibility expands for art review; existing celebration execution permissions are preserved. No Stage mutation, WS deployment, merge or Production rollout.

## Implementation checkpoint ruling

Execute the approval.md checkpoint before completing the entire Phase 3: Royal Gold assets and reusable catalog/chooser/CSS first; the other four non-default entries are disabled and explicitly labeled pending review until their complete packages exist. This avoids presenting placeholders as approved final art. Full T007–T017 remain incomplete. The existing authority/gameplay boundaries and Stage effects are unchanged. Actual diff Constitution Check: PASS; only poker presentation assets, existing JS/CSS and feature evidence change; no new suites, dependencies, inline scripts, backend/WS, migrations or generic setup changes.

## Superseded deterministic dealer extraction

Replace only Royal Gold dealer.webp with pixels isolated from the already approved concept board. Keep a feature-local alpha mask and reproducible extraction script beside that source in design/, using existing Sharp/Lanczos3 without dependencies or image synthesis. Preserve existing runtime/CSS/box geometry, document source-resolution limits and check native-size Preview. This resolves the wardrobe substitution rather than generating another interpretation. No generic tooling/configuration or maintained test suites.

## Current restoration scope

Owner rejected the deterministic extraction. Restore only the original generated Royal Gold dealer asset byte-for-byte; remove the feature-local extraction script/mask and record the rejection/restoration. Existing JS/CSS/layout/gameplay and all other theme layers remain unchanged. Verify the restored export on the PR Deploy Preview; stay Draft.

## Full-torso repair on the accepted generated direction

Regenerate only Royal Gold dealer art as a high-fidelity edit of the restored sprite, extending central lower dress to the bottom in the same 546×640 registration. Update only its scoped .poker-room-dealer::after foreground clip to exclude the filled torso while keeping hands/deck in front of the existing rail. No changes to dealer dimensions/anchors, table geometry, card flight origin, JS, Classic or other layers. Inspect portrait/landscape/desktop and a high-DPI close-up of the waist/rail; record new bytes/hash/provenance. No new dependencies, tests or tooling.

## Complete six-package implementation

Royal Gold checkpoint accepted by owner; RG06 satisfied. Complete four remaining packages using separate built-in imagegen dealer edits/empty rooms and original approved circuit/diamond/damask/jade-lattice vectors. All six catalog entries enabled; Classic remains unchanged. Reuse existing requested-only atomic loader/chooser and scoped CSS, including the full-torso foreground clip. Constitution Check against final runtime paths: PASS — browser art only, no geometry, new suites, dependencies/config, backend/WS/protocol, Stage or Production changes. Exact Preview and manual live limits recorded in review.md.

## Floor-plane correction — images only

Five room.webp replacements only under existing poker/assets/themes IDs. Compare source floor/wall junction estimates and exact center/cover projection against Classic1600×900; use its16:9 composition with a rear transition target around33–36% of image height and coherent receding foreground floor. These are visual registration estimates, not recovered physical camera calibration. Validate Royal first before editing the other rooms with built-in imagegen (Classic composition reference + existing room edit target). Remove foreground oval rug/step contours that imply a second table/raised platform. Encode existing local paths1600×900 WebP within600KiB; inspect every output in all three target viewports. No geometry/CSS/JS/Classic/dealer/vector/configuration/backend edits. Retain original images outside repository for before/after comparison. Constitution Check: PASS; temporary ad-hoc inspection outside repository, existing syntax/CSP checks, no new suites/dependencies/Stage effect. Record exact-room dimensions/hash/bytes/prompts and measured before/after floor rows, then verify same-PR exact-SHA Preview and independent review.
