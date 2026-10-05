## Problem

Manual Poker Table smoke on 2026-10-05 exposed two authoritative runtime defects that must not be folded into the HUD/layout scope of #1048/#1049.

### P1 — settled fresh JOIN can remain stuck in WAITING_NEXT_HAND

Observed UI state after a successful fresh JOIN:

- `Seat reserved · Joining next hand`
- hero seat exists and is `NEXT HAND`
- table remains `SETTLED`
- buy-in is funded
- no transition to a new `PREFLOP` hand occurs

This is **not** a reserve-seat failure. The authoritative JOIN has already accepted/funded the player. The failure is the subsequent settled-hand rollover.

PR #1033 intentionally fixed only the status classification/publishing of a fresh SETTLED join and explicitly did **not** claim to fix the previously reported Production rollover stall. Its fixture-backed A/B test proves a valid synthetic SETTLED fixture can roll over, but does not reproduce the real stall.

### P1 — inactivity auto-sitout counter is reset at every hand boundary

The intended policy is two missed timeout turns before auto-sitout.

Current reducer flow increments `missedTurnsByUserId[userId]` on an automatic CHECK/FOLD, but `resetToNextHand()` recreates `missedTurnsByUserId: {}`.

Typical real flow therefore becomes:

1. inactive human times out -> missed turns = 1;
2. hand settles;
3. next hand reset clears missed turns;
4. next timeout -> missed turns = 1 again;
5. threshold 2 is never reached.

Result: an inactive seated human can remain in play for many hands and continue losing blinds.

Existing `tests/poker-sitout-policy.test.mjs` does not catch this because its "second timeout" scenario manually injects `missedTurnsByUserId: { user: 1 }` instead of crossing a real hand reset.

## Scope

Fix these two runtime defects only. Keep #1048/#1049 responsible for Poker Table HUD/presentation.

### A. Preserve inactivity evidence across hand reset

Files/functions to inspect and minimally correct:

- `ws-server/poker/snapshot-runtime/poker-reducer.mjs::resetToNextHand()`
- mirrored `netlify/functions/_shared/poker-reducer.mjs::resetToNextHand()`
- existing inactivity helpers/policy only if required by the smallest fix
- `tests/poker-sitout-policy.test.mjs`

Requirements:

- a missed timeout count for a still-seated, non-left player must survive the next-hand boundary;
- a second missed timeout in a later hand must reach the existing threshold and set `pendingAutoSitOutByUserId`;
- the next safe hand boundary must move that player to `sitOutByUserId` and exclude them from the next hand;
- do not change the existing threshold;
- preserve existing manual-action reset semantics unless the current contract proves they are inconsistent;
- do not add a second inactivity mechanism, wall-clock idle timer, browser-visibility policy or session-presence concept.

Fundamental deterministic regression only: extend the existing sitout policy test so it crosses a real `SETTLED -> resetToNextHand -> next timeout` boundary. Do not manually seed the second missed-turn count for the regression case.

### B. Diagnose and fix the real SETTLED rollover stall

Files/functions to inspect first:

- `ws-server/server.mjs::maybeScheduleSettledRollover()`
- `scheduleSettledRolloverTimer()`
- `scheduleSettledRolloverRetry()`
- `runSettledRolloverCommand()`
- `broadcastStateSnapshots()` / state publication scheduling
- JOIN path around successful authoritative `table_join`
- `ws-server/poker/table/table-manager.mjs::prepareSettledHandRollover()` / `commitSettledHandRollover()`
- persistence/restore path used by settled rollover

Requirements:

1. Reproduce the actual failing lifecycle, not only the existing synthetic happy fixture:
   - table already `SETTLED`;
   - fresh non-participant human joins and is funded;
   - authoritative status becomes `WAITING_NEXT_HAND`;
   - no additional client action/resync/reconnect is required;
   - runtime must deterministically advance to the next legal hand and publish the human as active/in-hand when eligible.
2. Use existing rollover timer/retry/command queue/persistence paths. Do not add a second scheduler.
3. If a retryable dependency is temporarily unknown/fails, the existing bounded retry path must remain responsible and must not lose the settled generation without a future retry.
4. Preserve reveal timing, bot funding, access-policy, persistence CAS, reconnect and settlement guarantees.
5. Add only the smallest deterministic regression that fails on current main and proves the real failure path. Prefer extending the existing real-socket/runtime JOIN test rather than creating a broad new suite.
6. Add/adjust `klog` only if necessary to prove an otherwise unobservable terminal branch. No `console.log`.

## Verification

- focused fundamental inactivity test;
- focused real-socket/runtime settled JOIN rollover regression;
- existing relevant JOIN/rollover/reconnect tests;
- required repo checks;
- because this changes `ws-server/**`, deploy the exact latest runtime-affecting SHA with **WS Preview Deploy** before merge-ready;
- perform one narrow authenticated Preview/Stage smoke:
  1. join a table while it is SETTLED;
  2. observe `WAITING_NEXT_HAND`;
  3. verify automatic transition to new hand without refresh/resync;
  4. leave a human inactive across two missed turns in separate hands and verify they are sat out and stop participating in later hands.

No Production mutation/deploy is authorized by this issue.

## Breaking impact

Intentional behavior change: after the existing two-missed-turn threshold is genuinely reached across hands, an inactive human will actually be auto-sat-out and excluded from subsequent hands, so they will stop continuously paying blinds while unattended.

No intended breaking impact to JOIN funding, ledger/accounting, settlement, bot funding, reconnect or table lifecycle semantics.

## Implementation notes

- Follow live `agents.md` and `skills.md`.
- Keep the fix simple and condensed; reuse existing classes/functions and scheduler paths.
- Only fundamental deterministic tests.
- Browser JS, if unexpectedly touched, must remain JSP-compatible.
- CSS is not expected.
- Use `klog`, never `console.log`.
- Any new inline script would require CSP SHA allowlisting.
- Double-check/refactor before handoff and report any additional breaking impact.


## SpecKit implementation plan

### Phase 1 — establish failing regressions before runtime changes

- **T001 — Cross-hand inactivity regression**
  - File: `tests/poker-sitout-policy.test.mjs`.
  - Use the existing reducer/timeout helpers; do not create a new harness.
  - Add one fundamental deterministic scenario that starts from a real hand, applies one timeout, crosses an actual `SETTLED -> advanceIfNeeded/resetToNextHand` boundary, then applies the next timeout in a later hand.
  - The test must fail on current main because the first missed-turn count is lost.
  - Assert only the contract: the existing threshold is reached, `pendingAutoSitOutByUserId[userId]` is set, and the next safe boundary converts it to `sitOutByUserId[userId] = true` so the player is excluded from later hand participation.
  - Do not manually inject the second-hand starting count.

- **T002 — Settled fresh-JOIN rollover regression**
  - Primary file: `ws-tests/ws-join-runtime.behavior.test.mjs` or the smallest existing real-socket runtime test that already owns the SETTLED fresh-JOIN scenario.
  - Reuse the existing fixture-backed real WS server/client path from #1033.
  - Extend/adjust one scenario only after tracing the real failure so it reproduces the missing transition, rather than adding another synthetic happy-path duplicate.
  - Required observable contract: fresh JOIN on `SETTLED` is acknowledged/published as `WAITING_NEXT_HAND`, then advances without any extra subscription/resync/reconnect/client command to a new hand where the human is `ACTIVE`/participating when eligible.
  - If the current deterministic fixture cannot reproduce the real stall, do not guess at a fix: proceed to T003 and capture the exact runtime branch that stalls, then encode that branch in this same fundamental test.

### Phase 2 — diagnose the real rollover stall at the existing ownership boundary

- **T003 — Trace existing scheduling and persistence ownership**
  - File: `ws-server/server.mjs`.
  - Trace only the existing chain:
    - `broadcastStateSnapshots()` / state publication;
    - `preparePublishedSettlementReveal()`;
    - `maybeScheduleSettledRollover()`;
    - `scheduleSettledRolloverTimer()`;
    - `scheduleSettledRolloverRetry()`;
    - `runSettledRolloverCommand()`;
    - `persistMutatedState()` / conflict restore;
    - `tableManager.prepareSettledHandRollover()` and `commitSettledHandRollover()`.
  - Trace the successful authoritative JOIN path that inserts/funds the fresh human while the table is already `SETTLED`.
  - Verify which exact branch can leave the same settled generation with no future timer/retry or with a retry tied to a stale generation key.
  - Use existing `ws_settled_rollover_*` klog events. Add one narrowly scoped klog only if an otherwise terminal branch cannot be distinguished; no broad INFO logging.
  - Do not introduce a second scheduler, polling loop, browser-triggered start-hand workaround, DB cron, or forced resync.

### Phase 3 — minimal runtime fixes

- **T004 — Preserve missed-turn evidence across hand boundaries**
  - Files:
    - `ws-server/poker/snapshot-runtime/poker-reducer.mjs::resetToNextHand()`;
    - mirrored `netlify/functions/_shared/poker-reducer.mjs::resetToNextHand()`.
  - Replace the unconditional next-hand `missedTurnsByUserId: {}` behavior with the smallest seat-scoped preservation needed for the existing inactivity policy.
  - Keep entries only for users still in the authoritative seat universe; do not retain arbitrary stale user IDs.
  - Preserve the current threshold and current manual-action reset semantics.
  - When pending auto-sitout is committed at the safe hand boundary, the player's participation must remain excluded exactly through the existing `sitOutByUserId` mechanism; do not invent an eviction/cash-out path.
  - Keep the mirrored reducer implementations behaviorally equivalent.

- **T005 — Fix only the proven rollover ownership defect**
  - Files determined by T003, expected to remain inside existing `ws-server/server.mjs` scheduling/retry code and/or the existing table-manager/persistence boundary.
  - Preserve one settled-rollover scheduler and one per-table command queue.
  - A retryable failure/unknown dependency must leave a future retry for the same still-current settled generation.
  - A successful persisted/committed rollover must still publish once and schedule existing bot autoplay normally.
  - Preserve settlement reveal delay, bot funding/access decisions, CAS conflict recovery, reconnect behavior and ledger semantics.
  - Do not change JOIN funding merely to mask a rollover scheduling defect.

### Phase 4 — Poker Table presentation correction remains in #1048/#1049

- **T006 — Remove false rebuy presentation for ordinary fresh JOIN waiting**
  - File: `poker/poker-v2.js::renderRebuyPanel()` in PR #1049 / #1048 scope.
  - A plain `WAITING_NEXT_HAND` produced by fresh JOIN must not by itself show the rebuy panel.
  - Keep the normal live banner/seat status (`Seat reserved · Joining next hand`, `NEXT HAND`).
  - Preserve actual `OUT_OF_CHIPS` and pending/recovered rebuy behavior.
  - Do not add a new UI rendering test for this simple glue; verify through the required manual Deploy Preview smoke.
  - Do not mix T004/T005 runtime changes into the HUD PR; integrate #1049 with corrected main after #1054.

### Phase 5 — verification and handoff

- **T007 — Focused verification**
  - Run the changed fundamental inactivity test.
  - Run the existing relevant sitout/timeout reducer tests.
  - Run the focused real-socket SETTLED JOIN/rollover regression plus existing relevant JOIN/reconnect/rollover tests.
  - Run required repository checks only; do not add broad suites or UI/CSS tests.

- **T008 — Exact-SHA runtime verification**
  - Because T004/T005 affect `ws-server/**` / authoritative poker runtime, deploy the exact latest runtime-affecting SHA using the existing manual **WS Preview Deploy** gate.
  - Verify deployed SHA and health before calling the runtime fix ready.
  - Perform one narrow authenticated Preview/Stage smoke for the exact two user-visible defects: fresh SETTLED JOIN advances automatically to the next hand; two missed turns across separate hands cause auto-sitout and later hands no longer consume blinds from that player.
  - No Production mutation/deploy without separate owner authorization.

- **T009 — Final review**
  - Re-review the complete diff against current main and #1054.
  - Confirm no duplicate scheduler, second state source, wall-clock idle mechanism, DB cron, direct balance/table mutation or unrelated refactor was introduced.
  - Report exact files changed, focused tests, exact WS Preview SHA/run, smoke result, and all breaking impacts.
  - Keep #1049 draft until its separate owner visual smoke and the #1054 dependency are both satisfied.

### SpecKit notes

- This is a complex task: use deep reasoning and ensure every requirement above is fulfilled completely.
- Keep code as simple and condensed as possible; eliminate unnecessary complexity without changing required behavior.
- Unless explicitly required, reuse existing packages, classes, functions, helpers, reducers, command queues, scheduler paths and test harnesses.
- Explicitly highlight any breaking impact on another part of the system in the final handoff.
- Any browser JavaScript must remain JSP-compatible.
- Any CSS, if unexpectedly required, must keep one physical line per selector with no hard returns inside declarations.
- Take time to double-check the whole diff and refactor before presenting the final implementation.
- Write only fundamental deterministic tests; no broad UI/layout/JSP/simple-glue test expansion.
- Use `klog`, never `console.log`.
- If any inline script is added, add its SHA to the CSP allowlist. No inline script is expected for this fix.
- Do not include Production mutation/deploy, schema migration, new scheduler, or unrelated cleanup in this work.
