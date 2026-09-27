# Tasks: Poker: Bot Bad-Beat & Lost All-In Reactions (Backend #796)

**Branch**: `796-poker-bot-bad-beat-reactions`
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Contracts**: [contracts/settlement-reaction-contract.md](contracts/settlement-reaction-contract.md)

---

## Phase 1: Setup & Scaffolding

**Purpose**: Review existing settlement reaction pathways and establish baseline tests.

- [ ] T001 Review existing settlement reaction classifiers and test fixtures in ws-server/poker/handlers/reaction.mjs and ws-server/poker/handlers/reaction.behavior.test.mjs

---

## Phase 2: Foundational (Accounting Context Preservation)

**Purpose**: Ensure authoritative hand accounting is captured in the detached reaction context.

**⚠️ CRITICAL**: Must be completed before wiring the all-in classifier.

- [ ] T002 Update `buildDetachedReactionContext(state)` in ws-server/server.mjs to copy and freeze `handStartStacksByUserId` and `contributionsByUserId`
- [ ] T003 [P] Add focused assertion in ws-server/server.behavior.test.mjs verifying that `buildDetachedReactionContext` retains frozen accounting maps without exposing them over client WebSocket protocol

---

## Phase 3: User Story 1 - Lost All-In Bot Reaction (Priority: P1) 🎯 MVP

**Goal**: Bots losing an all-in confrontation at showdown express frustration via `not_this_time`.

**Independent Test**: Simulate an all-in loss; verify `classifySettlementReaction` returns `{ reactionKey: 'not_this_time' }`.

### Implementation for User Story 1
- [ ] T004 [US1] Implement `isAllInParticipant(userId, handStartStacks, contributions)` validation helper in ws-server/poker/handlers/reaction.mjs
- [ ] T005 [US1] Add lost all-in classifier branch in `classifySettlementReaction` returning `not_this_time` for eligible losing all-in bots in ws-server/poker/handlers/reaction.mjs
- [ ] T006 [US1] Add deterministic behavior test in ws-server/poker/handlers/reaction.behavior.test.mjs proving that a losing all-in bot emits `not_this_time`

---

## Phase 4: User Story 2 - Heads-Up River Reversal Bad Beat Reaction (Priority: P1) 🎯 MVP

**Goal**: Heads-up all-in losses caused by a river card reversal trigger `bad_beat` targeting the winner.

**Independent Test**: Simulate a heads-up showdown where the winner is in `riverChangedWinnerUserIds`; verify reaction key is `bad_beat` targeting the winner seat.

### Implementation for User Story 2
- [ ] T007 [US2] Extend the all-in classifier in `classifySettlementReaction` in ws-server/poker/handlers/reaction.mjs to detect heads-up showdown with winner in `riverChangedWinnerUserIds` and emit `bad_beat` targeting `winner.seatNo`
- [ ] T008 [US2] Add deterministic behavior test in ws-server/poker/handlers/reaction.behavior.test.mjs for heads-up all-in river reversal -> `bad_beat`
- [ ] T009 [US2] Add behavior test in ws-server/poker/handlers/reaction.behavior.test.mjs proving multiway river reversal falls back to `not_this_time`

---

## Phase 5: User Story 3 - Authoritative Evidence & Fail-Closed Safety (Priority: P2)

**Goal**: Guarantee fail-closed safety on corrupt/missing data and prevent false positive classifications.

**Independent Test**: Supply missing/corrupted accounting maps; verify classifier cleanly falls through without errors.

### Implementation for User Story 3
- [ ] T010 [US3] Enforce strict fail-closed checks in `isAllInParticipant` (positive integer start stack, non-negative contribution, exact match) in ws-server/poker/handlers/reaction.mjs
- [ ] T011 [US3] Add behavior tests in ws-server/poker/handlers/reaction.behavior.test.mjs verifying non-all-in losers, folded bots, and corrupt accounting data fail closed and skip the all-in branch

---

## Phase 6: User Story 4 - Classifier Priority & Lifecycle Integration (Priority: P3)

**Goal**: Ensure lost all-in / bad-beat takes precedence over generic congratulations while honoring cooldowns and settings.

**Independent Test**: Verify priority ordering against strong winner / generic cases, and verify `reactionSettings.enabled === false` suppresses candidate generation.

### Implementation for User Story 4
- [ ] T012 [US4] Position the lost all-in / bad-beat branch directly after `normalFoldWin` and before `luckyWinner` in ws-server/poker/handlers/reaction.mjs
- [ ] T013 [US4] Add behavior tests in ws-server/poker/handlers/reaction.behavior.test.mjs verifying priority over `nice_hand` and `well_played`, deterministic bot selection by seat order, and suppression when reactions are disabled

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
- **Fail-closed**: Any corrupt or missing accounting evidence safely skips all-in evaluation.
- **Exact-SHA WS Deploy**: Because `ws-server/**` changes, `WS Preview Deploy` is mandatory before merge readiness.
- **Fundamental tests only**: No UI, layout, or glue test suites.
