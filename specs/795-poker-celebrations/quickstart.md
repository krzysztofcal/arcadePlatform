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
