# Implementation plan — T001–T004

1. T001: inspect `poker/table-v2.html`, `poker/poker-v2.css` orientation/layer rules, `poker/poker-v2.js::TABLE_THEME_CATALOG/resolveTableThemeId/applyTableTheme`, and existing theme SVGs. Record current main and #1077 ownership. Capture unmodified real renderer with isolated identity/WS/CH state fixtures using temporary tooling outside the repository.
2. T002: generate original fine fibrous alpha texture with imagegen; optimize using existing sharp dependency into `poker/assets/scene/felt-weave.webp`. Add scoped noninteractive repeated `::after` in `poker/poker-v2.css` for Classic (absence of theme attribute) and Neon only. Preserve all original rules. Record provenance, dimensions, bytes and SHA-256 in `artwork.md`.
3. T003: compare baseline, texture and optional printed casino variant on identical two-theme scenes in portrait/landscape, plus 568×320. Casino variant uses temporary browser-injected artwork pseudo-element for review only, never a product setting or added JS. Validate asset failure, hit testing, geometry, loading, scroll, CSP and frame timing. Create Draft PR to obtain native Netlify Deploy Preview, verify build SHA and deployed CSS/asset bytes; repeat real deployed captures.
4. T004: document captures/measurements/self-review and breaking impacts in `artwork.md`, link Draft PR/Preview/SHA, request explicit approval of material and marking independently, STOP.

## Constitution / execution rulings
No new UI/CSS tests, TDD, generic setup changes, dependencies or Stage mutation. Reuse installed packages outside this worktree for ad-hoc capture/optimization; no tracked setup change. Worktree isolates #1077; do not edit its files. Independent self-review requested by owner; no delegation needed.
