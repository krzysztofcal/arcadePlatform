# Implementation Plan: Poker cinematic celebrations

**Branch**: `795-poker-celebrations` | **Date**: 2026-09-23 | **Spec**: [spec.md](spec.md)

## Summary and technical context

Extend the existing plain JS IIFE, HTML and scoped CSS in `poker/poker-v2.js`, `poker/table-v2.html`, `poker/poker-v2.css`. No dependency/configuration/backend changes. Reuse `evaluateViewerBestHand`, `buildSettlementPresentation`, `currentTableBuyIn`, existing preference normalization and build metadata. One overlay, one lifecycle timer, ≤18 decorative particles; CSS transforms/opacity. Browser-local storage only.

## Constitution Check — before implementation and post-design: PASS

- Existing-mechanism reuse, JSP IIFE, klog, external JS/CSP and one-line CSS retained.
- WS owns gameplay; no runtime/protocol/migration change or Stage/Production effect. Netlify PR browser deploy only.
- No ignore/tooling/dependency/setup cleanup changes. Feature metadata is Spec Kit-local only.
- Test tasks limited to critical pure classification, monotonic dedupe and deadline contracts in existing `tests/poker-settlement-presentation.unit.test.mjs`. Existing V2 behavior tests protect timing/reconnect. No added UI/CSS/JSP/simple-glue suites; manual browser checks for presentation.
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
