# Poker Table Felt V2 — approved two-theme POC

Authority: [issue #1086, Owner-approved checkpoint 2026-10-11](https://github.com/krzysztofcal/arcadePlatform/issues/1086). Baseline main: `97f8b8e521871548270db0f779ee3d87e67412c6`.

## Authorized scope
T001–T004 only: original shared static alpha WebP felt material, scoped to Classic Casino and Neon Vegas; actual browser renders before/after at 390×844 and 844×390 with cards, chips and HUD; compare texture alone with optional restrained casino marking. Preserve gradients, SVG ornaments, DOM, geometry, theme assignment and fallback. Deliver Draft PR and exact-SHA Netlify Preview evidence where available. Owner visual approval remains mandatory; CI cannot supply it.

## Acceptance
One repeated texture, initially ≤100 KiB, same origin; no stretching to fit the table, shaders, filters, animation or new runtime code. Pseudo-elements must inherit the felt radius and ignore pointer events. Optional marking stays behind gameplay, and requires separate approval. Distinguish real deployed renderer with isolated state fixtures from authenticated gameplay and physical-device testing.

## Exclusions and constitution check
No T005–T007 or four-theme rollout. No room/rail/dealer/card asset changes, lobby, theme catalog/resolver/loader, poker behavior, WS, backend, SQL, CH, Stage/Production, merge, new dependencies/configuration/ignore files or CSS/UI tests. Existing syntax/CSP/guards and targeted visual inspection suffice. One physical CSS line per selector; no JS planned. No third-party brand or sponsorship. Follow agents.md, skills.md and constitution v1.1.1. Shared Stage mutation: none.

## Owner-requested revision 2
Owner rejected gray/desaturated Neon and weak branding, provided saturated premium-table references, and explicitly requested corrected versions. Authorized: revise the same Classic/Neon POC, preserve original backgrounds/ornaments but add restrained theme-colored illumination, hue-preserving material blend, finer repeat scale and an original native SVG house emblem/typography. Compare material-only A with branded B again on actual deployed renderer. B may be the default two-theme POC for review; neither B nor the other four themes is final-approved. No copying reference brands/art; no gameplay/geometry/JS/backend/config changes. No T005–T007 GO.

## Owner steering — centered large premium imprint
Owner explicitly requests geometric centering on the felt, accepts natural occlusion by cards/chips, and wants a larger, more premium Arcade logo. Supersedes previous attempts to place the logo in spare space. Use a larger original medallion/spade/leaf seal with ARCADE as principal serif wordmark, POKER CLUB secondary. Position 50% 50% in both orientations, print follows unchanged physical table perspective. Compare active-hand and board-clear browser-fixture renders so complete emblem can be reviewed without moving gameplay elements. Still only Classic/Neon POC and STOP for visual approval; no T005–T007 authorization.

## Owner approval and portrait correction
Owner approved saturated material and branded B. Additionally authorized leveling portrait table in this PR so centered lettering is horizontal relative to screen. Remove existing rotateZ(-3deg) for Classic/Neon only, preserve perspective(900px) rotateX(12deg), sizing, content and landscape. Projected shell/felt bounds necessarily change with removal of rotation; validate surrounding cards/chips/HUD and hit tests. This is no authorization for T005–T007 or remaining themes.
