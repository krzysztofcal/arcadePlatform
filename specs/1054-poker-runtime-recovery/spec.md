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


## Owner correction after Codex discovery + Stage evidence (2026-10-05)

This section **supersedes the earlier rollover diagnosis/tasks where they conflict**.

### 1. The current smoke did NOT reproduce a SETTLED rollover stall

The owner smoke can now be tied to exact shared-Stage evidence:

- environment: Netlify Deploy Preview #1049 -> `wss://ws-preview.kcswh.pl/ws` -> shared Stage DB `krydukthwdvccggbyjfw`;
- table: `13eb6933-31ba-4aa2-9338-06138b3fdd5a`;
- lifecycle: `CONTINUOUS_BOT / CONTINUOUS_BOT_DEFAULT`;
- hand `..._133_3` reached `SETTLED` at `2026-10-05T19:06:00.816569Z`;
- the human TABLE_BUY_IN committed at `2026-10-05T19:06:00.967030Z`;
- the same human is an authoritative participant in the immediately following hand `..._144_5`, later settling at `2026-10-05T19:07:24.169697Z` with seat 4 / starting stack 100.

Therefore the observed `Seat reserved · Joining next hand` / `WAITING_NEXT_HAND` state was a valid transient join-at-SETTLED state for this incident, not proof that reserve-seat or rollover failed. The contradictory rebuy/bust presentation remains a #1048/#1049 UI bug.

The historical Production rollover concern from #1033 remains historical/unproven here. Do **not** change rollover scheduling from this issue unless a separate deterministic/current reproduction proves an actual current defect.

Earlier T002/T003/T005 and the rollover part of T008 are withdrawn from the active implementation scope of #1054.

### 2. Authoritative inactivity root cause is deeper than the legacy reducer reset

Codex correctly found that current live WS gameplay does not use `ws-server/poker/snapshot-runtime/poker-reducer.mjs::resetToNextHand()` as the authoritative action/timeout path.

Current authoritative path is:

- `ws-server/poker/table/table-manager.mjs`;
- `ws-server/poker/engine/poker-engine.mjs::applyCoreStateTurnTimeout()`;
- `ws-server/poker/engine/poker-engine.mjs::applyCoreStateAction()`;
- `ws-server/poker/shared/poker-action-reducer.mjs`;
- `ws-server/poker/engine/poker-engine.mjs::buildNextHandStateFromSettled()`;
- persistence through the existing `ws-server/poker/handlers/turn-timeout.mjs::handleTurnTimeoutCommand()` -> `persistMutatedState()` path.

The authoritative engine currently does not maintain `missedTurnsByUserId`, `pendingAutoSitOutByUserId` or `sitOutByUserId` across the live timeout/action/next-hand lifecycle. Fixing only the snapshot-runtime/Netlify reducer mirrors is therefore insufficient.

Historical intended contract from PRs #323/#325/#327/#329 must be preserved:

- threshold remains exactly **2 missed timeout turns**;
- timeout accounting is authoritative and deterministic;
- successful manual activity clears stale missed-turn penalty;
- join/rejoin clears stale missed-turn penalty;
- auto-sitout affects future participation, not the current hand and not chips/cash-out;
- sit-out player is skipped by future hand/turn eligibility;
- do not remove the seat merely because of auto-sitout.

### 3. Exact Stage evidence for the inactivity failure

Same table and human show the production-like bug directly:

Human: `7339c05e-5068-4ad1-a449-5f7b3bb8f2e0`.

Later inactivity segment:

- timeout FOLD at `2026-10-05T19:11:23.714907Z`, hand `..._225_5`;
- timeout FOLD at `2026-10-05T19:12:37.349654Z`, different hand `..._244_5`;
- no manual human action between those two timeout events;
- after the second timeout, `HAND_SETTLED` v263 at `2026-10-05T19:13:22.654549Z` still lists the human as seat 4 participant with starting stack 98, ending stack 97 and contribution 1.

Final persisted state also has no authoritative inactivity maps (`missedTurnsByUserId`, `pendingAutoSitOutByUserId`, `sitOutByUserId` absent/null).

This is sufficient to treat authoritative auto-sitout as the active P1. No new owner reproduction is required before implementation.

### 4. Revised active implementation plan

- **T101 — Keep/adjust the legacy mirror regression only as compatibility evidence.**
  - Review local commit `320c8a9a` once published in a Draft PR.
  - Keep the two `resetToNextHand()` mirror changes only if they remain correct for code paths/tests that still use those reducers.
  - Do not describe them as the runtime fix.

- **T102 — Implement missed-turn accounting in the authoritative timeout path.**
  - Primary: `ws-server/poker/engine/poker-engine.mjs::applyCoreStateTurnTimeout()` and existing engine state.
  - After an accepted automatic timeout action, increment that actor's authoritative missed-turn count exactly once.
  - Reuse the existing timeout command/idempotency boundary; replay must not increment twice.
  - When the count reaches 2, mark the existing future-hand auto-sitout intent; do not alter the already-running hand merely because threshold was reached.

- **T103 — Preserve/reset authoritative inactivity state with existing lifecycle rules.**
  - `buildBootstrappedPokerState()` / `buildNextHandStateFromSettled()` and smallest related engine helpers must preserve only valid seated-user inactivity state across hand boundaries.
  - At the safe next-hand boundary, pending auto-sitout becomes effective `sitOutByUserId` and that user is excluded from the new hand/dealer/turn/card participation while retaining their table seat/stack.
  - Successful non-timeout human activity clears stale missed-turn penalty according to #325/#327 semantics.
  - Existing authoritative JOIN/rejoin path must clear stale missed-turn/auto-sitout state for an actually returning player according to #327. Reuse the current JOIN state mutation boundary; do not add a second API or browser state.

- **T104 — Fundamental authoritative-engine regression.**
  - Add/extend the smallest current `ws-server/poker/engine` or `table-manager` behavior test, not only legacy reducer tests.
  - Scenario: timeout in hand A -> count 1 -> real settled rollover -> timeout in hand B -> threshold 2/pending -> next hand boundary -> user excluded/sat out while seat and chips remain.
  - Also verify one successful manual action clears a prior count so a later timeout starts again at 1.
  - Use existing table-manager/engine harness; no broad suite/new framework.

- **T105 — Persistence/runtime verification.**
  - Existing `handleTurnTimeoutCommand()` / `persistMutatedState()` remains the persistence owner; no new writer.
  - Verify persisted Poker state contains the inactivity evidence across timeout and rollover and restores correctly after runtime restore/reconnect.
  - Only add a focused persistence/reconnect assertion if the existing fundamental engine test cannot prove this boundary.

- **T106 — Exact-SHA Preview gate.**
  - Publish the implementation as a Draft PR so the diff is reviewable.
  - Run focused fundamental tests and required repo checks.
  - Because the authoritative WS runtime changes, deploy the exact latest runtime-affecting SHA via existing **WS Preview Deploy**.
  - Narrow authenticated smoke: leave a human unattended for two turns across different hands; after the safe boundary verify they stop participating/paying later blinds. Manual activity/rejoin must reset the penalty as specified.
  - No Production mutation/deploy without separate owner authorization.

### 5. #1048/#1049 ownership

The fresh JOIN presentation bug remains in #1048/#1049:

- plain fresh-JOIN `WAITING_NEXT_HAND` must not open the bust/rebuy panel;
- remove contradictory `Sitting out`, `Buy-in confirmed`, stale `Buy-in: Loading…` and duplicate funded messaging for a normal join;
- preserve actual OUT_OF_CHIPS/rebuy recovery behavior.

This simple UI correction is separate from #1054 authoritative inactivity work.
