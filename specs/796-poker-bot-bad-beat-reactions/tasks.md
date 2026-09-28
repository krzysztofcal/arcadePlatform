# Tasks: Poker: Bot Bad-Beat & Lost All-In Reactions (Backend + Poker V2 Catalog #796)

**Branch**: `796-poker-bot-bad-beat-reactions`
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Contracts**: [contracts/settlement-reaction-contract.md](contracts/settlement-reaction-contract.md)

---

## Phase 1: Setup & Scaffolding

**Purpose**: Review existing settlement reaction pathways and catalog fixtures.

- [ ] T001 Review existing settlement reaction classifiers, test fixtures, and catalog lookups in ws-server/poker/handlers/reaction.mjs, ws-server/poker/handlers/reaction.behavior.test.mjs, and poker/poker-v2.js

---

## Phase 2: Foundational (Accounting Context & Catalog Scaffolding)

**Purpose**: Ensure authoritative hand accounting is captured in the detached reaction context without exporting internal helpers, and establish server allowlist keys.

**⚠️ CRITICAL**: Must be completed before wiring the all-in classifier.

- [ ] T002 Update internal `buildDetachedReactionContext(state)` in ws-server/server.mjs to copy and freeze `handStartStacksByUserId` and `contributionsByUserId` (keeping the helper internal and non-exported)
- [ ] T003 [P] Add focused end-to-end server behavior test in ws-server/server.behavior.test.mjs covering authoritative settlement state -> detached context -> classifier -> existing scheduler/broadcast flow (without exporting buildDetachedReactionContext), and verify neither handStartStacksByUserId nor contributionsByUserId is exposed in public room snapshots or WebSocket protocol
- [ ] T004 [P] Define `ALL_IN_LOSS_REACTION_KEYS` tuple, add the 5 new keys to server `REACTION_KEYS` in ws-server/poker/handlers/reaction.mjs (automatically populating `REACTION_KEY_SET`, without adding to `HUMAN_REACTION_KEYS`), and update docs/ws-poker-protocol.md to document the 5 bot-only keys and their exclusion from human `reaction_send` (without creating a new test suite for docs)

---

## Phase 3: User Story 1 - Ordinary Lost All-In Bot Reaction Pool (Priority: P1) 🎯 MVP

**Goal**: Bots losing an all-in confrontation at showdown express defeat using one of five new dedicated loss reactions (broadcast to table), preserving `not_this_time` exclusively for folds.

**Independent Test**: Simulate an all-in loss; verify `classifySettlementReaction` returns one of the 5 new keys without `targetSeatNo`, and never returns `not_this_time`.

### Implementation for User Story 1
- [ ] T005 [US1] Implement `isPlayerAllIn(userId, handStartStacks, contributions)` validation helper with strict uncoerced integer checks (`typeof val === 'number' && Number.isInteger(val)`, `start > 0`, `contrib >= 0`, `contrib === start`) in ws-server/poker/handlers/reaction.mjs
- [ ] T006 [US1] Implement `sampleAllInLossReactionKey(random)` uniform sampler across `ALL_IN_LOSS_REACTION_KEYS` in ws-server/poker/handlers/reaction.mjs for the second draw (selection draw) of the two-draw contract
- [ ] T007 [US1] Add ordinary lost all-in classifier branch in `classifySettlementReaction` implementing the two sequential random draws contract: Draw 1 for frequency gate `samplePasses(random, 1, reactionSettings)`, and Draw 2 for `sampleAllInLossReactionKey(random)` returning a uniformly sampled key from `ALL_IN_LOSS_REACTION_KEYS` (table broadcast, no `targetSeatNo`) for eligible losing all-in bots (requiring bot not in `showdown.winners` and `Number(handSettlement.payouts?.[botUserId] ?? 0) <= 0`) in ws-server/poker/handlers/reaction.mjs
- [ ] T008 [US1] Add deterministic behavior tests in ws-server/poker/handlers/reaction.behavior.test.mjs proving that: (1) qualifying lost all-in selects only from the 5 new keys and never `not_this_time`; (2) existing `FOLD -> not_this_time` remains active without regression; (3) representative injected-random boundaries deterministically map to the 5 keys on the selection draw after a successful frequency gate (`[0.0, 0.2)` → `all_in_oh_no` ... `[0.8, 1.0)` → `all_in_censored`)

---

## Phase 4: User Story 2 - Heads-Up River Reversal Bad Beat Reaction (Priority: P1) 🎯 MVP

**Goal**: Heads-up all-in losses caused by a river card reversal trigger `bad_beat` (broadcast to table without `targetSeatNo`) instead of the 5-item loss pool.

**Independent Test**: Simulate a heads-up showdown where the winner is in `riverChangedWinnerUserIds`; verify reaction key is `bad_beat` (broadcast without `targetSeatNo`).

### Implementation for User Story 2
- [ ] T009 [US2] Extend the all-in classifier in `classifySettlementReaction` in ws-server/poker/handlers/reaction.mjs to detect heads-up river reversal (exactly 2 evaluated hands in `showdown.handsByUserId` with a single winner and winner in `riverChangedWinnerUserIds`) and emit `bad_beat` (table broadcast, no `targetSeatNo`) with base probability = 1.0
- [ ] T010 [US2] Add deterministic behavior test in ws-server/poker/handlers/reaction.behavior.test.mjs for heads-up all-in river reversal -> `bad_beat` (broadcast without `targetSeatNo`), including a test case where 3 players were in `handSeats` but 1 left the table or sat out, resulting in exactly 2 hands in `showdown.handsByUserId` and proving it correctly qualifies as heads-up
- [ ] T011 [US2] Add behavior test in ws-server/poker/handlers/reaction.behavior.test.mjs proving multiway showdown (3+ hands in `showdown.handsByUserId`) with river reversal falls back to the ordinary 5-reaction all-in loss pool (not `bad_beat`)

---

## Phase 5: User Story 3 - Authoritative Evidence & Fail-Closed Safety (Priority: P2)

**Goal**: Guarantee fail-closed safety on corrupt/missing data, uncalled bet returns, and string coercion attempts.

**Independent Test**: Supply missing/corrupted/string accounting maps (`contribution > handStartStack`) or uncalled bet return; verify classifier cleanly falls through to generic reactions without errors.

### Implementation for User Story 3
- [ ] T012 [US3] Enforce strict uncoerced integer checks in `isPlayerAllIn` (raw numbers only, no coercion from strings) and zero payout check (`payouts[botUserId] <= 0`), ensuring positive uncalled returns disqualify the bot from lost all-in in ws-server/poker/handlers/reaction.mjs
- [ ] T013 [US3] Add behavior tests in ws-server/poker/handlers/reaction.behavior.test.mjs verifying: (1) missing/corrupt/string accounting data (`contribution > handStartStack`, missing maps, string numbers) does NOT emit all-in loss or `bad_beat` reactions but cleanly falls through to trigger applicable generic settlement reactions (e.g. `nice_hand` / `congrats`); (2) a bot committing full starting stack but receiving a positive uncalled return (`payouts[botUserId] > 0`) while losing the contested pot is disqualified from lost all-in / bad-beat and falls through to existing generic branches; (3) non-all-in losers and folded bots are excluded

---

## Phase 6: User Story 4 & 5 - Priority, Lifecycle & Poker V2 Client Catalog (Priority: P3)

**Goal**: Ensure lost all-in / bad-beat takes precedence over generic congratulations while honoring cooldowns, and expand client catalog with 5 bot-only keys mapped to `shake`.

**Independent Test**: Verify priority ordering against strong winner / generic cases, and verify Poker V2 live behavior test proves catalog extensions and `humanSelectable: false`.

### Implementation for User Story 4 & 5
- [ ] T014 [US4] Position the all-in loss / bad-beat branch directly after `normalFoldWin` and before `luckyWinner` in ws-server/poker/handlers/reaction.mjs, and add behavior tests in ws-server/poker/handlers/reaction.behavior.test.mjs verifying priority over `nice_hand` and `well_played`, deterministic bot selection by seat order, base probability 1.0, and suppression when reactions are disabled
- [ ] T015 [P] [US5] Extend `REACTION_CATALOG` in poker/poker-v2.js with the 5 new bot-only keys (`all_in_oh_no`, `all_in_that_hurts`, `all_in_no_way`, `all_in_come_on`, `all_in_censored`) with exact emoji/labels and `humanSelectable: false`, and map all 5 keys to `shake` by extending existing `resolveBotAvatarReactionMotion` helper directly (without creating aliases or secondary helpers)
- [ ] T016 [P] [US5] Add tests in tests/poker-v2-live.behavior.test.mjs verifying that each of the 5 new keys resolves its exact emoji/label, has `humanSelectable: false`, and maps to `shake` motion in `resolveBotAvatarReactionMotion`

---

## Phase 7: Polish & Deployment Gate

**Purpose**: Code quality, test suite execution, exact-SHA WS Preview deployment, and smoke validation.

- [ ] T017 Run syntax check (`npm run syntax`) and repository guard checks (`npm run check:all`)
- [ ] T018 [P] Run full reaction behavior suite (`node --test ws-server/poker/handlers/reaction.behavior.test.mjs`), server integration tests (`node --test ws-server/server.behavior.test.mjs`), and client live tests (`node --test tests/poker-v2-live.behavior.test.mjs`)
- [ ] T019 Execute exact-SHA manual `WS Preview Deploy` workflow (`--ref main -f ref=<SHA>`) and perform Netlify Deploy Preview manual smoke per quickstart.md

---

## Mandatory Project Rules & Notes

- **Authoritative boundary**: Real-time reaction classification runs strictly within `ws-server`; client presents via `REACTION_CATALOG` and `resolveBotAvatarReactionMotion`.
- **Dedicated 5-key loss pool**: `not_this_time` is exclusively for folds; lost all-in uses `all_in_oh_no`, `all_in_that_hurts`, `all_in_no_way`, `all_in_come_on`, or `all_in_censored`.
- **Heads-up bad beat heuristic**: `bad_beat` is evaluated only for heads-up showdowns (exactly 2 hands in `showdown.handsByUserId` with a single winner) where the winner took the lead on the river.
- **Fail-closed & fallthrough**: Any corrupt or missing accounting evidence (`contribution > handStartStack`, missing maps, string numbers) safely skips the lost all-in branch and falls through to existing generic reactions; does not return null on accounting errors alone.
- **Uncalled return exclusion**: Any positive payout (`payouts[botUserId] > 0`), including uncalled bet returns, disqualifies bot from lost all-in / bad-beat, falling through to existing generic settlement branches.
- **Dual accounting maps isolation**: Neither `handStartStacksByUserId` nor `contributionsByUserId` is ever exposed in client snapshots or WebSocket protocol frames.
- **No client targeting**: `bad_beat` and the 5 all-in loss pool reactions are table broadcasts without `targetSeatNo`. Client targeting remains reserved for `nice_hand`.
- **No test-only exports**: `buildDetachedReactionContext` is not exported; server tests validate the end-to-end integration flow.
- **Two sequential random draws**: Draw 1 for `samplePasses(random, 1, reactionSettings)` frequency gate; Draw 2 for `sampleAllInLossReactionKey(random)` selection draw from `ALL_IN_LOSS_REACTION_KEYS`.
- **Protocol docs**: Zero message-type / payload-shape changes; semantic vocabulary expands by 5 bot-only keys, documented in `docs/ws-poker-protocol.md`.
- **Base probability = 1.0**: Qualified events reliably trigger under 100% frequency setting.
- **Exact-SHA WS Deploy**: Because `ws-server/**` changes, `WS Preview Deploy` is mandatory before merge readiness.
- **Fundamental tests only**: No UI, layout, or glue test suites.
