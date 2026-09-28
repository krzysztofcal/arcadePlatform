# Tasks: Poker: Bot Bad-Beat & Lost All-In Reactions (Backend #796)

**Branch**: `796-poker-bot-bad-beat-reactions`
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Contracts**: [contracts/settlement-reaction-contract.md](contracts/settlement-reaction-contract.md)

---

## Phase 1: Setup & Scaffolding

**Purpose**: Review existing settlement reaction pathways and establish baseline tests.

- [ ] T001 Review existing settlement reaction classifiers and test fixtures in ws-server/poker/handlers/reaction.mjs and ws-server/poker/handlers/reaction.behavior.test.mjs

---

## Phase 2: Foundational (Accounting Context Preservation)

**Purpose**: Ensure authoritative hand accounting is captured in the detached reaction context without exporting internal helpers.

**⚠️ CRITICAL**: Must be completed before wiring the all-in classifier.

- [ ] T002 Update internal `buildDetachedReactionContext(state)` in ws-server/server.mjs to copy and freeze `handStartStacksByUserId` and `contributionsByUserId` (keeping the helper internal and non-exported)
- [ ] T003 [P] Add focused end-to-end server behavior test in ws-server/server.behavior.test.mjs covering authoritative settlement state -> detached context -> classifier -> existing scheduler/broadcast flow (without exporting buildDetachedReactionContext), and verify neither handStartStacksByUserId nor contributionsByUserId is exposed in public room snapshots or WebSocket protocol

---

## Phase 3: User Story 1 - Lost All-In Bot Reaction (Priority: P1) 🎯 MVP

**Goal**: Bots losing an all-in confrontation at showdown express frustration via `not_this_time` (broadcast to table).

**Independent Test**: Simulate an all-in loss; verify `classifySettlementReaction` returns `{ reactionKey: 'not_this_time' }` without `targetSeatNo`.

### Implementation for User Story 1
- [ ] T004 [US1] Implement `isAllInParticipant(userId, handStartStacks, contributions)` validation helper requiring exact `contribution === handStartStack && handStartStack > 0` in ws-server/poker/handlers/reaction.mjs
- [ ] T005 [US1] Add lost all-in classifier branch in `classifySettlementReaction` returning `not_this_time` (table broadcast, no `targetSeatNo`) with base probability = 1.0 (`samplePasses(random, 1, reactionSettings)`) for eligible losing all-in bots (requiring bot not in `showdown.winners` and `Number(handSettlement.payouts?.[botUserId] ?? 0) <= 0`) in ws-server/poker/handlers/reaction.mjs
- [ ] T006 [US1] Add deterministic behavior test in ws-server/poker/handlers/reaction.behavior.test.mjs proving that a losing all-in bot emits `not_this_time` (broadcast without `targetSeatNo`)

---

## Phase 4: User Story 2 - Heads-Up River Reversal Bad Beat Reaction (Priority: P1) 🎯 MVP

**Goal**: Heads-up all-in losses caused by a river card reversal trigger `bad_beat` (broadcast to table without `targetSeatNo`).

**Independent Test**: Simulate a heads-up showdown where the winner is in `riverChangedWinnerUserIds`; verify reaction key is `bad_beat` (broadcast without `targetSeatNo`).

### Implementation for User Story 2
- [ ] T007 [US2] Extend the all-in classifier in `classifySettlementReaction` in ws-server/poker/handlers/reaction.mjs to detect heads-up showdown with winner in `riverChangedWinnerUserIds` and emit `bad_beat` (table broadcast, no `targetSeatNo`) with base probability = 1.0
- [ ] T008 [US2] Add deterministic behavior test in ws-server/poker/handlers/reaction.behavior.test.mjs for heads-up all-in river reversal -> `bad_beat` (broadcast without `targetSeatNo`)
- [ ] T009 [US2] Add behavior test in ws-server/poker/handlers/reaction.behavior.test.mjs proving multiway river reversal falls back to `not_this_time`

---

## Phase 5: User Story 3 - Authoritative Evidence & Fail-Closed Safety (Priority: P2)

**Goal**: Guarantee fail-closed safety on corrupt/missing data and prevent false positive classifications.

**Independent Test**: Supply missing/corrupted accounting maps (`contribution > handStartStack` or `contribution < handStartStack`) or uncalled bet return; verify classifier cleanly falls through to generic reactions without errors.

### Implementation for User Story 3
- [ ] T010 [US3] Enforce strict fail-closed checks in `isAllInParticipant` (positive integer start stack, non-negative contribution, exact equality `contribution === handStartStack`; `contribution > handStartStack` fails closed) and verify zero payout (`payouts[botUserId] <= 0`), ensuring positive uncalled returns disqualify the bot from lost all-in in ws-server/poker/handlers/reaction.mjs
- [ ] T011 [US3] Add behavior tests in ws-server/poker/handlers/reaction.behavior.test.mjs verifying: (1) missing/corrupt accounting data (`contribution > handStartStack`, missing maps) does NOT emit `bad_beat`/`not_this_time` but cleanly falls through to trigger applicable generic settlement reactions (e.g. `nice_hand` / `congrats`); (2) a bot committing full starting stack but receiving a positive uncalled return (`payouts[botUserId] > 0`) while losing the contested pot is disqualified from lost all-in / bad-beat and falls through to existing generic branches; (3) non-all-in losers and folded bots are excluded

---

## Phase 6: User Story 4 - Classifier Priority & Lifecycle Integration (Priority: P3)

**Goal**: Ensure lost all-in / bad-beat takes precedence over generic congratulations while honoring cooldowns and settings.

**Independent Test**: Verify priority ordering against strong winner / generic cases, and verify `reactionSettings.enabled === false` suppresses candidate generation.

### Implementation for User Story 4
- [ ] T012 [US4] Position the lost all-in / bad-beat branch directly after `normalFoldWin` and before `luckyWinner` in ws-server/poker/handlers/reaction.mjs
- [ ] T013 [US4] Add behavior tests in ws-server/poker/handlers/reaction.behavior.test.mjs verifying priority over `nice_hand` and `well_played`, deterministic bot selection by seat order, base probability 1.0, and suppression when reactions are disabled

---

## Phase 7: Polish & Deployment Gate

**Purpose**: Code quality, test suite execution, exact-SHA WS Preview deployment, and smoke validation.

- [ ] T014 Run syntax check (`npm run syntax`) and repository guard checks (`npm run check:all`)
- [ ] T015 [P] Run full reaction behavior suite (`node --test ws-server/poker/handlers/reaction.behavior.test.mjs`) and server integration tests (`node --test ws-server/server.behavior.test.mjs`)
- [ ] T016 Execute exact-SHA manual `WS Preview Deploy` workflow (`--ref main -f ref=<SHA>`) and perform Netlify Deploy Preview manual smoke per quickstart.md

---

## Mandatory Project Rules & Notes

- **Authoritative boundary**: Real-time reaction classification runs strictly within `ws-server`.
- **Zero DB/protocol mutations**: No new tables, migrations, WebSocket event names, or reaction keys.
- **Fail-closed & fallthrough**: Any corrupt or missing accounting evidence (`contribution > handStartStack`, missing maps) safely skips the lost all-in branch and falls through to existing generic reactions; does not return null on accounting errors alone.
- **Uncalled return exclusion**: Any positive payout (`payouts[botUserId] > 0`), including uncalled bet returns, disqualifies bot from lost all-in / bad-beat, falling through to existing generic settlement branches.
- **Dual accounting maps isolation**: Neither `handStartStacksByUserId` nor `contributionsByUserId` is ever exposed in client snapshots or WebSocket protocol frames.
- **No client targeting**: `bad_beat` and `not_this_time` are table broadcasts without `targetSeatNo`. Client targeting remains reserved for `nice_hand`.
- **No test-only exports**: `buildDetachedReactionContext` is not exported; server tests validate the end-to-end integration flow.
- **Base probability = 1.0**: Qualified events reliably trigger under 100% frequency setting.
- **Exact-SHA WS Deploy**: Because `ws-server/**` changes, `WS Preview Deploy` is mandatory before merge readiness.
- **Fundamental tests only**: No UI, layout, or glue test suites.
