# Plan — authoritative inactivity correction

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


## Constitution Check
Only fundamental authoritative-engine lifecycle/activity regression and existing persistence/JOIN/timeout checks. No scheduler changes, UI tests, new framework/dependencies, writers or Production changes. #1049 remains separate.
