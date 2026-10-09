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
