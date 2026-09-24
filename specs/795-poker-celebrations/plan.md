# Implementation Plan: Poker cinematic celebrations

**Branch**: `795-poker-celebrations` | **Date**: 2026-09-23 | **Spec**: [spec.md](spec.md)

## Summary and technical context

Extend the existing plain JS IIFE, HTML and scoped CSS in `poker/poker-v2.js`, `poker/table-v2.html`, `poker/poker-v2.css`. V3 also updates the existing poker unit suite, the localized Win amount strings, the failing E2E navigation wait and Playwright browser preparation. No application dependencies, poker backend, WS, DB or schema changes. Reuse `evaluateViewerBestHand`, `buildSettlementPresentation`, `currentTableBuyIn`, existing preference normalization and build metadata. One overlay, one bounded lifecycle timer, ≤18 decorative particles; CSS transforms/opacity. The Win Streak is page-memory only.

## Constitution Check — before implementation and post-design: PASS

- Existing-mechanism reuse, JSP IIFE, klog, external JS/CSP and one-line CSS retained.
- WS owns gameplay; no runtime/protocol/migration change or Stage/Production effect. Netlify PR browser deploy only.
- No ignore/tooling/dependency/setup cleanup changes. Feature metadata is Spec Kit-local only.
- Tests stay in existing suites: critical card proof, exact award amount, local result counting/dedupe/reset, and the animation lifetime contract in `tests/poker-settlement-presentation.unit.test.mjs`; the existing `tests/e2e-ui.spec.ts` keeps its button checks while navigation waits only for DOM readiness. No added UI/CSS/JSP/simple-glue suite. Manual/PR-preview checks cover visual behavior.
- Owner performs final artistic/Android acceptance and merge. Outstanding runtime verification must be disclosed.

## Source reconciliation

Baseline current main `f75bacf4`. Issue entrypoints still exist. Current responsive CSS includes landscape maps after the original portrait rules: protect both. Guest preferences previously do not load/persist (null identity early return); initialize identity with undefined and use a dedicated guest celebration key. Table buy-in already comes from authoritative snapshot/access preflight. `showdown.revealedShowdownParticipants` provides legal opponent cards; private opponent state is never inspected. No settled-hand history/continuity after reconnect, so live streak deferred.

## Implementation

1. `table-v2.html`: checkbox in `#pokerSocialSettingsPanel`, empty aria-hidden celebration overlay inside `.poker-scene`. Construct preview controls only in valid PR context in JS, with touch-sized controls away from bottom actions.
2. `poker-v2.js`: local `showCelebration`, `startCelebrationExit`, `clearCelebration`; preview listeners scoped to build gate and actual joined live seat. Demo flag selects synthetic art only. Royal first, then pot chips and streak avatar energy. One active effect, no queue. Exit strips hero/text/particles, retains only low-opacity ring for 400 ms, then removes nodes.
3. Extend preferences without resetting old keys. Guest stores only celebrationsEnabled; signed-in model stays per-user. OFF and reduced-motion changes clear immediately.
4. Pure `selectCelebrationForSettlement` verifies identity, complete presentation, winner legal cards, per-user contested awards. `claimCelebrationTransition` consumes same-hand SETTLED transitions, marks initial results consumed, requires strictly newer versions and tracks highest observed version across reconnect. Deadline is min(sticky visibleUntilMs, state/sticky authoritative deadline, credible settledAt+3500); no invented extension. Skip if <2200 ms; dramatic 1800 ms + ring exit 400 ms.
5. Integrate after `syncStickyWinnerReveal`; observe incoming accepted next-hand/turn before existing snapshot deferral. Clear at reveal end, invalid settlement, status loss, identity, navigation, pagehide/visibility hidden. Never modify existing reveal/snapshot/auto-join/chip-fly behavior.

## Verification

`node --test tests/poker-settlement-presentation.unit.test.mjs tests/poker-v2-live.behavior.test.mjs`; `node --check poker/poker-v2.js`; existing CSP checks. Inspect actual preview and locally emulate mobile/desktop with existing Playwright if available. Record real vs simulated evidence separately in quickstart. No external interfaces or migrations.

## V3 incremental plan — 2026-09-24

The v1 and v2 implementation steps above are complete history. Continue from the exact v2 PR HEAD `36929e216d3919266a20fe29310ed7bb7f0f4c1d`; do not rebuild either version.

Constitution Check before v3: PASS. Keep the accepted two-size art, settings, `Winner`, settlement/deferred-snapshot schedule, server authority and preview gate. Keep all CSS additions scoped and one selector per line. No WS/backend/DB or Production change. Add only fundamental deterministic cases to the existing settlement unit suite.

1. `poker/poker-v2.js`: render only five verified real royal cards for automatic events; permit fixed spades only behind `demo: true`. Add the recipient's exact safe-integer contested award sum to Monster Pot selection and show a localized `WIN {amount} CH` in both sizes.
2. `poker/poker-v2.js`: track complete newly observed settled results in memory by `tableId + userId`, dedupe hand IDs, count split awards, reset known losers, and show live ×5, ×6, ×7… after higher-priority selections. Treat folded seats as losses, sit-outs as no result, and returns as non-wins. Reset the cursor and counts on reconnect/resync, identity/seat/table change, rejoin, initial/recovery snapshot, stale/missing result or broken hand sequence. Do not persist/reconstruct history.
3. `poker/poker-v2.js` and `poker/poker-v2.css`: use one 1600 ms hero plus one 400 ms ring-only exit for a 2000 ms total. Remove routine transition/reveal/action interruption. Dim an active effect as soon as a new hand, live turn or action appears, but let its animation and timer finish. Keep immediate cleanup only for OFF, reduced motion, navigation/unmount, identity/seat change and unsafe session loss. Ordinary state updates never mutate poker behavior.
4. `bindCelebrationPreview()` and the existing dynamic preview panel: retain both size modes and all effect demos; add synthetic selectable ×5, ×6, ×7, ×8 and ×12 streak counts and a labeled synthetic pot amount. Demo actions never touch live counters or state.
5. CI root cause: `tests.yml` already installs Chromium with `--with-deps`, while `scripts/test-all.mjs` later invoked `scripts/prepare-playwright.js`, whose bare `playwright install` downloaded Firefox/WebKit too and warned about unused `libgraphene`/GTK libraries. The red check itself was a 30-second timeout waiting for `load` in `tests/e2e-ui.spec.ts`; its controls require the DOM, not remote resource completion. Restrict the helper to `PLAYWRIGHT_BROWSER` when set, and make the existing test wait for `domcontentloaded`. Keep Chromium's `--with-deps` CI install.
6. Update this Spec Kit, existing PR description and quickstart evidence. Run the existing critical suites and full PR CI; verify the exact new PR Deploy. The owner will perform physical Android acceptance. No WS preview deploy is needed because no WS/protocol runtime changes are made.

V3 validation: `node --test tests/poker-settlement-presentation.unit.test.mjs tests/poker-v2-live.behavior.test.mjs`; the existing Playwright job; `node --check poker/poker-v2.js`; `npm run check:csp-inline`. Browser/CI output and user-only Android smoke must be recorded separately. Pending Android smoke means the draft is awaiting owner verification and is not merge-ready.

## V4 incremental plan — 2026-09-24

Continue from current draft PR #1016 HEAD `7245a610923b1ba8a84e42c8b76335971cc70623`. Preserve the complete v3 behavior and two visual sizes. Client-only change in the existing IIFE and scoped CSS; no new overlay, interval, animation engine, dependency, UI test suite, server/protocol/DB/ledger change or Production effect.

1. In `positionCelebration()`, keep the compact target identity and seat number fixed from `showCelebration()`. Re-read that same seat on every existing render/layout reposition, including the decorative exit; move the effect when its current visible avatar moves. Clear on actual winner/seat replacement. If the identity is unchanged but a fresh measurement, viewport fit or summary-safe placement is unavailable after start, add a scoped short opacity fade and clear with the existing lifecycle timer, capped by the remaining original `duration + celebrationExitDuration()` deadline. Initial invalid anchors still skip. Keep the large self-win path, Winner and all gameplay timing untouched.
2. In `bindCelebrationPreview()`, populate an accessible native selector with currently visible nonlocal humans/bots. Retain only a still-visible selected `userId`; if it disappears, show an empty choice and explanatory hint rather than selecting a replacement. Each of the three compact demo buttons revalidates the exact selected `userId` immediately before calling the existing overlay. The large demo stays available and all demos remain synthetic and behind existing preview metadata gates.
3. Update this Spec Kit and PR handoff. Follow `agents.md` testing policy: no UI/CSS/glue test additions; run existing critical settlement/V2 tests, Chromium Playwright, syntax/CSP checks and the complete PR workflows. Verify target selection and reflow/fade on the actual deploy; report that physical Android acceptance remains with the owner.

V4 Constitution Check: reuse the current single overlay and render/layout hooks; preserve pointer-events, control/Winner layering, existing exact live result data, settings, two-second lifetime and game flow. Temporary anchor loss affects only compact FX. No backend/WS deploy is required. Verify the automatic Netlify PR Deploy against the new PR SHA; if Netlify fails before build due to dependency installation, record the failure and any isolated draft alias separately, without calling it a successful PR Deploy. Keep #1016 as draft and do not merge or deploy Production.

## V5 incremental plan — same draft PR #1016

Continue from the current v4 PR HEAD `94c90f5a513626fe2cde0a560101a5e4f0baf31d`. Preserve the complete v4 compact identity and explicit-target fixes. Do not change settlement authority, awards, Winner, streak accounting, preferences, hand timing, animation duration or transport.

### Constitution Check — PASS

Extend the existing `tests/poker-settlement-presentation.unit.test.mjs` only for the critical winner/category/card/priority decision. No new test file, runner registration, UI/CSS/layout/JSP or simple-glue suite. Reuse the current IIFE, best-hand evaluator, one celebration overlay, Royal Flush card renderer and Preview FX build gate. No backend, protocol, DB, migration, dependency, CSP or Production change.

### Implementation

1. In `poker/poker-v2.js`, map only evaluated best categories Straight, Flush, Full House, Quads, Straight Flush and Royal Flush to one hand-effect selection. Carry a stable display title and the evaluator's exact five normalized cards. Keep the evaluator's best-category result; do not search for a lower qualifying combination.
2. In `selectCelebrationForSettlement()`, retain verified positive main/side recipients and viewer-first recipient traversal. Use exactly two viewer hole cards or two publicly revealed opponent cards with the board. Without both cards, allow only a board Royal Flush, the sole category whose exact best five cannot be improved by hidden cards. Unknown/nonqualifying card hands fall through to the unchanged Monster Pot selection and then Win Streak.
3. In `showCelebration()`, render `kind: hand` through the same card nodes, `poker-celebration--royal` style, viewer-size selection and existing 1600 ms + 400 ms lifecycle. Vary only title and card faces. Leave `poker/poker-v2.css` and game timing unchanged.
4. Extend the current `bindCelebrationPreview()` button list with legal synthetic five-card examples for all six hand categories. Keep the existing mode selector and exact `userId + seatNo` opponent validation for every button; preserve Monster Pot/Win Streak demos and the build gate.
5. Update this Spec Kit, PR description and `quickstart.md`. Run the existing settlement/V2 tests, syntax, CSP, Chromium and required PR CI. Verify the matching automatic Netlify PR Deploy metadata. Physical Android visual/runtime acceptance remains with the owner; do not merge or deploy Production.

V5 review risks: newly qualifying hands can take the single effect slot ahead of Monster Pot/Win Streak, reducing the times those effects are seen without changing their calculations. Opponent card art is skipped when the exact best five cannot be established from visible cards. The larger preview panel already has bounded vertical scrolling; inspect it on the current Deploy Preview and retain the exact selected seat through all demo buttons.

## V2 incremental plan — 2026-09-24

Verified existing clean worktree and live PR HEAD equal v1 `f7155980a8176e0caaa6cba0dc05065a797c1dae`. Baseline 127/127 relevant tests pass. The v1 steps above are history, not work to repeat.

Constitution Check before v2 implementation: PASS. Reuse existing IIFE/overlay/assets; no dependencies, configuration, ignores, WS/protocol/DB/Stage/Production effects. Only extend existing deterministic selection test for multi-winner priority; no presentation test suites. Use temporary browser inspection and owner Android acceptance for visual work.

- V2-01: update existing spec/plan/tasks/quickstart, preserve v1 evidence.
- V2-02: move `#pokerCelebration` to `.poker-table-screen` outside transformed `.poker-scene`; isolate the scene stacking context. Scoped CSS gives FX layer 24, below action bar 25, preview 29, menus 30–32 and dialogs 60+. Large responsive art centered in viewport; retain one overlay.
- V2-03: `selectCelebrationForSettlement` orders confirmed winners viewer-first, still scans all royals before pots. `showCelebration` compares stable current user ID, resolves compact anchors from `state.seats` and `renderedSeatAvatars`, positions beside the avatar within viewport. Refresh in existing render/layout path; skip/clear missing anchors. Place beside the whole seat; choose the nearest bounded position above/below the central payout summary when necessary, skipping if neither fits.
- V2-04: preserve duration/claim/observe/Winner functions; retain presentation class during 400 ms empty decorative exit. No timer or render deferral changes.
- V2-05: `bindCelebrationPreview` adds one native touch mode selector and unavailable-opponent hint, refreshes availability when opening and rendering. Explicit demo flag only, all three kinds. Inspect portrait/landscape/desktop, edge seats, changes in layout, interruption, OFF/reduced motion, build gates and unchanged Winner; rerun existing critical tests, syntax and CSP.
- V2-06: fresh whole-diff review, publish same draft PR, verify exact new HEAD deploy success and actual build metadata. Record emulator vs real transport vs owner-only physical Android evidence separately.

Shared interfaces: selection.userId feeds presentation size; preview supplies a real nonlocal user ID only for compact anchoring. Render rebuilds avatars, so positioning must resolve fresh nodes, never retain a stale avatar reference. Overlay leaves transformed scene, so coordinates are viewport pixels. Exit retains size/position but strips all art immediately.

Post-implementation Constitution Check: PASS. Eight existing files changed; one critical selection test added. No UI suite, dependency/lockfile/configuration/ignore, runtime, protocol or migration changes. Existing locked root/WS dependencies installed locally only to run the full pre-existing suite.
