# Validation and handoff

Run `node --test tests/poker-settlement-presentation.unit.test.mjs tests/poker-v2-live.behavior.test.mjs` and `node --check poker/poker-v2.js`.

On the PR deploy, open Poker V2 and join a real guest or signed-in table. Tap Preview FX, then Royal Flush, Monster Pot or Win Streak ×5. Repeat during play and check normal cards, turn, controls, payout, leave and rebuy visibility. A real settlement/turn must immediately dismiss demo hero; at most 400 ms faint ring remains. Use portrait/landscape Android and desktop.

Toggle Celebration animations OFF in existing Table settings during FX; it must vanish immediately. Refresh and check guest persistence. Sign in/out and check isolated settings. Enable OS reduced motion; no animation should start, including preview. Reconnect or return to a hidden tab: no result replay.

Check Production/branch/missing/inconsistent build metadata: no Preview FX controls or global preview entrypoint. Verify server results unchanged and one prioritized live effect per hand. For Monster Pot verify 5× authoritative buy-in against a single player's contested awards, excluding returns. Live streak intentionally deferred.

Record actual browser, deterministic and live-runtime results here before handoff; do not infer live smoke from CI. Final artistic acceptance and physical Android smoke belong to owner.

## Evidence — 2026-09-23

- Draft PR: https://github.com/krzysztofcal/arcadePlatform/pull/1016
- Actual Netlify PR deploy: https://deploy-preview-1016--playkcswh.netlify.app/poker/
- Final implementation revision: `aa54d3f1` (later documentation-only revisions do not change browser code).
- 127/127 tests pass across existing settlement and V2 behavior suites, including four added critical contract tests. JS syntax and CSP inline hash guard pass (52 served documents). No UI/CSS/glue suites added.
- Chromium touch emulation: 390×844 portrait, 844×390 landscape, plus 1280×900 desktop visual inspection. All three manual variants render; gameplay layers remain above FX. Measured first three full sequences: hero 1801/1801/1801 ms, total 2202/2201/2201 ms; ring-only residue 401/400/400 ms. No animation scheduler or gameplay wait.
- Controlled browser transport: automatic royal from complete live settlement; next-hand incoming snapshot strips all hero/text synchronously before the existing reveal deferral, hidden after 450 ms observation. Manual preview interrupted by live turn update. OFF immediately clears; signed-in and guest preferences survive reload independently; reduced motion skips. Missing metadata, production, branch-deploy with inconsistent preview flag, and deploy-preview with false preview flag create no preview controls. These are simulated contract checks, not real WS smoke.
- Real deployed browser with unmodified transport: Play as Guest creates/joins a bot table; Preview FX exposes Royal Flush, Monster Pot and Win Streak ×5 during PREFLOP. All three rendered with live actions visible. Guest OFF survived actual preview reload. Left the smoke table through normal leave UI. No authenticated account/paid chips used.
- Independent code review found and resolved invalid-result cleanup, premature reconnect preview access and malformed-status cosmetic coupling. Motion preference changes now clear only when reduced motion becomes enabled.

## Remaining owner acceptance and impacts

Implementation ready, awaiting manual runtime verification of rare natural automatic Royal Flush/Monster Pot settlements and physical Android play. Browser touch emulation is not a physical-device frame-rate measurement. Final visual taste/threshold acceptance remains with the owner; the threshold stays 5×, with 8× only a proposed alternative if frequency is excessive. Live Win Streak is intentionally deferred: current snapshots cannot establish uninterrupted per-user results across reconnect.

Possible regression surfaces are table-layer stacking on untested viewport/seat combinations, preference identity handoff/local-storage availability, and cosmetic snapshot lifecycle observers. No breaking protocol/schema/API change, engine/payout/ledger modification, reveal duration change, extra snapshot deferral or new dependency is introduced. Normal payout/chip-fly and outcome rendering stay independent of the preference. No WS deployment or Production deployment is required/performed. PR remains draft for owner acceptance and merge.

## V2 Android acceptance (pending owner)

Open the updated PR deploy → join a table → Preview FX → My win (large) → choose Royal Flush, Monster Pot, Win Streak ×5. Repeat with Other player/bot (small near avatar); join a table with a visible opponent/bot if that choice is disabled. Check both orientations, centered large art, correct compact anchor and unobscured identity, touch actions/settings while FX runs, immediate OFF and no delayed next hand. Ordinary Winner and special-hand Winner must retain their original single lifecycle. Physical-device performance and rare natural automatic triggers are not proven by browser emulation or green CI.

## V2 evidence — 2026-09-24

- Incremental change from exact v1 `f7155980a8176e0caaa6cba0dc05065a797c1dae`, same draft #1016. One existing overlay now outside transformed scene, scene isolated; FX layer 24 is above all scene chips/reactions and below controls/menus/dialogs. No Winner/timing/WS/engine changes.
- `npm test`: PASS after installing existing locked root and WS dependencies locally (initial attempts failed on missing `acorn`, then missing `ws`; no source failure or dependency manifest change). Existing environment-gated PostgreSQL checks skip when unavailable. Targeted settlement + V2 suites: **128/128 pass**. Added one critical multi-winner selection test, observed failing before implementation and passing afterward. JS syntax, whitespace and CSP hash guard pass (52 served documents).
- Chromium touch inspection: **390×844, 844×390, 320×740, 1280×900**, all **six** kind/size combinations. Own art centered in viewport, compact beside real avatar; controls remain interactive. No additional repository UI tests. Screenshots inspected from temporary browser tooling.
- Held local seat fixed and checked five nonlocal settled seat positions in each viewport (**20 layouts**). Initial inspection reproduced compact art covering central payout summary at lower edge seats; positioning now avoids it. Repeated measurements: **0 overlaps, 0 skipped effects**. Missing/ambiguous/stale avatar ownership fails closed. Rotation refreshes the current anchor.
- Controlled browser transport: actual live-hook inputs for local royal, opponent royal and ordinary result; large/compact routing correct, ordinary result has no extra effect. Winner remains present after FX, deadline unchanged; repeated result does not replay. Manual preview leaves game state/dedupe unchanged and sends no command. No-opponent mode disabled with explanation. Existing regression inspection covers immediate hero removal on next-hand/turn, 400 ms ring-only exit, OFF, isolated guest/auth persistence, reduced motion and four invalid/non-PR metadata gates.
- Existing duration retained: **1800 ms main + 400 ms decorative exit**, roughly 2.2 s overall. This deliberately preserves v1 pacing while meeting the requested roughly 2 s main phase. No timer extension or added snapshot delay.
- Fresh read-only review checked the entire v2 diff. Its edge-overlap hypothesis was reproduced and fixed as above; no deferred code findings. Physical Android, taste/performance and natural rare trigger acceptance remain with the owner. Final deployed SHA/CI/real-transport smoke are recorded in the PR handoff.

V2 risk surfaces: ancestor stacking isolation on untested screens, compact placement on unusual seat layouts, browser viewport changes, identity/preference handoff. No breaking API/schema/protocol or payout change. If safe avatar geometry is unavailable the compact FX is skipped. Win Streak remains preview-only; Monster Pot remains 5× contested awards. Retain draft status; do not merge.
