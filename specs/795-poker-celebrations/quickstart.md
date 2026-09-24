# Validation and handoff

## Current v4 handoff — 2026-09-24

V4 runtime implementation is `7fd1b5feb8f03a29a25ae89f43a1674ed4f8fa3f`, based on the confirmed PR #1016 v3 HEAD `7245a610923b1ba8a84e42c8b76335971cc70623`. Current PR HEAD before this handoff update is documentation-only `66176b57e68cf7d6572043a479c8d78bc6fdf9c6`; poker runtime files match the tested v4 implementation. V4 preserves v3 result classification, Winner display, animation timing, settings and both visual sizes. Compact animation remains bound to one verified winner `userId + seatNo`; existing layout/render updates move it with that avatar through the ring-only tail. Changed identity clears immediately; temporarily unsafe geometry fades only the compact overlay without extending its original deadline. An invalid starting anchor skips the effect.

PR-only Preview FX retains large self-win and now lets the owner select a specific currently visible opponent/bot for compact Royal Flush, Monster Pot and Win Streak demos. Selection is revalidated for each demo and never silently switches seats. No server, WS, DB, ledger or gameplay change is intended.

Local validation: `node --test tests/poker-settlement-presentation.unit.test.mjs tests/poker-v2-live.behavior.test.mjs` passed **135/135**; `PLAYWRIGHT_BROWSER=chromium npm run test:e2e` passed **66/66** on Chromium; JS syntax and the CSP inline-hash guard passed (52 served documents). GitHub CI on PR HEAD `66176b57e68cf7d6572043a479c8d78bc6fdf9c6` passed Tests, verify/Playwright, ws-harness, actionlint, CodeQL, both analyzers, games catalog and chips-retention. Conditional chips-integration was skipped. Existing project policy excludes new UI/CSS/glue tests.

The automatic Netlify PR Deploy did not pass. The first runtime attempt (`6ab52d78304fa300074e8e3e`) stalled and was canceled without publishing. Retry `6ab5309b2c35ca000837a772` for HEAD `66176b57e68cf7d6572043a479c8d78bc6fdf9c6` failed in `Install dependencies`: Netlify reported “Command did not finish within the time limit.” The canonical `deploy-preview-1016` alias therefore still serves v3 SHA `7245a610923b1ba8a84e42c8b76335971cc70623`; it is not the v4 link.

For Android presentation review, a separate Netlify draft alias is ready: [v4 draft preview](https://poker-v4-1016--playkcswh.netlify.app/poker/) (deploy `6ab5345f1ed8411e1c5a9b7c`, [Netlify deploy details](https://app.netlify.com/projects/playkcswh/deploys/6ab5345f1ed8411e1c5a9b7c)). Its served `BUILD_INFO` reports exact runtime SHA `66176b57e68cf7d6572043a479c8d78bc6fdf9c6`, `context: deploy-preview`, `isPreview: true`, review `1016`, and the preview WebSocket URL. Netlify's deploy record classifies this CLI-created alias as `branch-deploy` with no `review_id` or `commit_ref`; treat it as an isolated draft UI preview, not a successful automatic PR Deploy. The canonical Netlify check remains failed, so the PR is not ready for merge. The branch-deploy context may use different server-function environment variables; the smoke below used only a guest bot table and visual previews, with no account or wallet actions.

Chromium smoke on the draft alias returned HTTP 200, joined a guest bot table, and showed no console errors. The exact selected visible bot appeared beside compact Royal Flush (real 10–A spades), Monster Pot (demo 1,250 CH), and Win Streak ×7. Rotating from 390×844 to 844×390 moved the compact overlay; forcing 390×100 added the anchor-lost fade class and cleared the overlay within the short fade. The large five-card preview also remained available. This is browser evidence, not physical Android acceptance.

The GitHub test and analysis workflows are green; the Netlify dependency-install timeout is the only failed check. The owner performs Android acceptance; PR #1016 remains draft. No merge or Production deployment was performed.

## Current v3 handoff — 2026-09-24

V3 continues PR #1016 from v2 HEAD `36929e216d3919266a20fe29310ed7bb7f0f4c1d`. This section supersedes earlier v2 pacing and preview-only streak statements below; those are retained as history. The existing large and small effects, Winner display, settings, hand flow, and PR-only preview gate remain.

For the current preview, exercise Royal Flush, Monster Pot and Win Streak ×5/×6/×7/×8/×12 in both size modes. Live Royal art now uses only the exact five verified same-suit cards visible to that player; live Monster Pot shows the player's exact main/side awards and excludes returns. Win Streak increments once per newly observed complete hand result, counts split awards, treats folded/in-pot losers as losses, ignores sit-outs, and resets on reconnect/resync/rejoin, identity/seat/table changes or uncertain hand order. Its state exists only in page memory, so a reconnect or refresh never restores a run.

Each effect runs a 1600 ms hero and a 400 ms decorative exit, about 2 seconds total. A new hand, turn or action dims a running effect and does not cut it short. OFF, reduced motion, navigation and unsafe session/identity changes still clear it immediately. Winner timing and snapshot deferral remain unchanged.

The prior red Playwright step was the existing `e2e-ui.spec.ts` file-URL navigation timing out after 30 seconds while `page.goto()` waited for the full `load` event. Those checks only need the document DOM, so both navigations now use `domcontentloaded`. The separate `libgraphene`/GTK warnings came from `scripts/prepare-playwright.js` installing every browser after CI had already installed Chromium with `--with-deps`; the helper now installs only `PLAYWRIGHT_BROWSER` when supplied. That warning was noisy but was not the timed-out test's cause.

V3 local verification so far: settlement + V2 live behavior suites **135/135 pass**; the existing Chromium Playwright file **2/2 pass**; JS syntax and CSP inline hash guard pass for **52 served documents**. This is local evidence only. Record the exact new PR SHA, GitHub CI, matching successful Netlify PR Deploy and real-device Android outcome below before handoff. The physical Android test is intentionally pending the owner.

### V3 release evidence

- V3 runtime implementation SHA: `ee01b6a35c0f6e1a449a82bb3810efb698c371a5`.
- Working [PR Deploy](https://deploy-preview-1016--playkcswh.netlify.app/poker/) succeeded for that SHA (Netlify deploy `6ab51eca95ae8a0008ada9e5`). Deployed `build-info.js` confirmed the full commit hash, `context: deploy-preview`, `isPreview: true`, and review `1016`.
- [GitHub Tests workflow](https://github.com/krzysztofcal/arcadePlatform/actions/runs/36002675335) and [CI workflow](https://github.com/krzysztofcal/arcadePlatform/actions/runs/36002675323) succeeded for that SHA. `tests` (including its Playwright step), `verify` (including Playwright), actionlint, JavaScript/Actions analysis, WS harness, chips-retention integration, games catalog validation and CodeQL succeeded. The conditional chips-integration job was skipped; Netlify deploy-preview succeeded. No failing checks remain.
- Android physical-device acceptance: pending owner test.
- No Production deployment, WS/backend change or merge was performed.

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

### V2 deployed browser smoke

Runtime revision: `28d7fce457122cf6988362049918c5eb046bb212`. Netlify `netlify/playkcswh/deploy-preview` succeeded for this exact SHA and the served `/js/build-info.js` confirmed it, with `context: deploy-preview`, `isPreview: true`, review 1016. Deploy: https://deploy-preview-1016--playkcswh.netlify.app/poker/ (Netlify deploy ID `6ab4cd34e301eb0008b23944`). Later documentation-only handoff commits do not change these runtime files; final PR HEAD/deploy status is reported in the PR.

Unmodified real transport, Chromium touch landscape 844×390: Play as Guest joined a real bot table; Royal Flush, Monster Pot and Win Streak ×5 each displayed in both large and compact modes. Screenshots verified large art above the table and compact art beside a bot. Guest OFF persisted on actual deploy reload, then preference restored. Left through normal UI. No authenticated wallet/paid chips used. This verifies touch preview availability and integration, not physical Android performance or naturally occurring rare winning hands. No WS deployment was needed/performed.
