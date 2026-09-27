# Feature Specification: Poker: Bot Bad-Beat & Lost All-In Reactions (Backend #796)

**Feature Branch**: `796-poker-bot-bad-beat-reactions`

**Created**: 2026-09-27

**Status**: Draft

**Input**: User description based on GitHub issue #796 ("Poker: Bot Avatar Reactions") — Remaining backend increment: automated settlement classifier for lost all-in and heads-up river reversal bad beat.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Lost All-In Bot Reaction (Priority: P1) 🎯 MVP

When a bot pushes all-in or calls all-in during a hand, reaches showdown, and is eliminated/loses its committed chips to another player, the bot expresses frustration using the existing `not_this_time` reaction key.

**Why this priority**: A lost all-in is a high-stakes, dramatic poker milestone. Having the bot acknowledge the defeat makes the game feel responsive and alive without requiring new assets or keys.

**Independent Test**: Can be tested independently in a simulated or live settlement where a bot commits its entire starting stack (`contribution === handStartStack`), loses at showdown, and emits a `not_this_time` reaction candidate.

**Acceptance Scenarios**:
1. **Given** an active hand where bot B has `handStartStacksByUserId[B] === 100` and `contributionsByUserId[B] === 100`, **When** the hand settles with player P as the sole winner and no river reversal, **Then** bot B is classified with reaction key `not_this_time`.
2. **Given** a multiway showdown where bot B loses all-in against two opponents, **When** the hand settles, **Then** bot B is classified with reaction key `not_this_time`.

---

### User Story 2 - Heads-Up River Reversal Bad Beat Reaction (Priority: P1) 🎯 MVP

When a bot is heads-up in an all-in confrontation, held the winning hand on the turn, but the river card reverses the outcome giving the opponent the winning hand, the bot emits the specific `bad_beat` reaction key targeting the winner.

**Why this priority**: River bad beats are the most memorable emotional moments in poker. Emitting `bad_beat` directly fulfills the explicit bad beat reaction requirement in issue #796.

**Independent Test**: Can be tested independently in a heads-up showdown where a bot lost all-in and the winner appears in authoritative `riverChangedWinnerUserIds`, resulting in reaction key `bad_beat` targeting the winner's seat.

**Acceptance Scenarios**:
1. **Given** a heads-up all-in showdown between bot B and player P where B loses, **When** P is verified in `riverChangedWinnerUserIds`, **Then** bot B is classified with reaction key `bad_beat` targeting player P's seat.
2. **Given** a multiway pot (3+ players at showdown) where the winner caught a river card, **When** bot B loses all-in, **Then** bot B is NOT classified as `bad_beat` (to avoid speculative equity inference); it falls back to `not_this_time`.

---

### User Story 3 - Authoritative Evidence & Fail-Closed Safety (Priority: P2)

The reaction classifier must determine all-in status solely from authoritative ledger/engine state: `handStartStacksByUserId` and `contributionsByUserId`. It must never infer all-in from final payouts, current stack size alone, or street-local action flags.

**Why this priority**: Guarantees funds safety, auditability, and deterministic behavior. Prevents false positive all-in classifications due to temporary client side-effects or partial state resets.

**Independent Test**: Supply corrupt, negative, non-integer, or missing accounting fields; verify the classifier safely fails closed (returns null / skips all-in evaluation without throwing).

**Acceptance Scenarios**:
1. **Given** a settled hand where `handStartStacksByUserId` or `contributionsByUserId` is missing, undefined, or has negative/non-integer values, **When** `classifySettlementReaction` runs, **Then** the lost all-in branch is skipped and the classifier proceeds to standard fallback paths.
2. **Given** a bot that lost a showdown pot but had `contribution < handStartStack` (non-all-in loss), **When** settlement occurs, **Then** the bot is NOT classified for lost all-in or bad beat.

---

### User Story 4 - Classifier Priority & Lifecycle Integration (Priority: P3)

The new lost all-in / bad-beat branch must integrate cleanly into the existing settlement reaction pipeline: executing after normal fold-wins, but before generic `lucky`, `nice_hand`, `well_played`, and `congrats` reactions, while strictly preserving cooldowns, jitter, and frequency controls.

**Why this priority**: Ensures specific player/bot events take priority over generic polite congratulations, while maintaining table civility and rate limits.

**Independent Test**: Run settlement scenarios with overlapping conditions (e.g. lost all-in vs strong winner); verify the losing bot's event takes priority, respects sender cooldown, and emits exactly one reaction candidate per hand.

**Acceptance Scenarios**:
1. **Given** a hand where bot B loses all-in to opponent P who holds a strong hand (category >= 4), **When** settlement evaluates reactions, **Then** bot B's negative reaction takes precedence over a generic `nice_hand` congratulations.
2. **Given** a table where bot reaction settings have `enabled === false`, **When** a bad beat occurs, **Then** no reaction is emitted.
3. **Given** multiple bots qualifying for lost all-in in the same hand, **When** settlement evaluates, **Then** exactly one bot is selected deterministically by seat order.

---

### Edge Cases

- **Split pot / partial chop**: If a bot receives any share of the main or side pot (listed in `showdown.winners` or positive payout), the bot is not a loser and MUST NOT emit a lost all-in or bad beat reaction.
- **Bot folded earlier in hand**: If the bot folded on preflop, flop, or turn, its fold was already processed (emitting `not_this_time` on fold if rolled). At settlement, `state.foldedByUserId[bot.userId] === true` excludes it from showdown settlement reactions.
- **Bot left table or sat out**: If `state.leftTableByUserId[bot.userId] === true` or `state.sitOutByUserId[bot.userId] === true`, the bot cannot speak at settlement.
- **Multiway river reversal**: If 3 or more players are involved at showdown, river suckouts are complex multiway equity shifts. To keep behavior predictable without an equity engine, `bad_beat` is restricted to heads-up showdowns; multiway all-in losers receive `not_this_time`.
- **Zero starting stack**: If `handStartStack === 0`, all-in validation fails closed (must have `handStartStack > 0`).

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST determine bot all-in participation exclusively from `handStartStacksByUserId` and `contributionsByUserId` (`contribution === handStartStack && handStartStack > 0`).
- **FR-002**: System MUST classify an eligible losing all-in bot as `bad_beat` targeting the winner when the showdown is heads-up and the winner is present in `riverChangedWinnerUserIds`.
- **FR-003**: System MUST classify an eligible losing all-in bot not meeting the heads-up river reversal condition as `not_this_time`.
- **FR-004**: System MUST position the lost all-in / bad-beat classifier in `classifySettlementReaction` after the normal fold-win branch, but before generic `lucky`, `nice_hand`, `well_played`, and `congrats` branches.
- **FR-005**: System MUST fail closed (skipping the lost all-in branch) if accounting maps are missing, undefined, inconsistent, non-integer, or negative.
- **FR-006**: System MUST pass all reaction candidates through existing `samplePasses(random, probability, reactionSettings)` using configured frequency percentages.
- **FR-007**: System MUST enforce the existing 4,000 ms per-sender cooldown and apply 300–1,200 ms presentation jitter to scheduled reaction candidates.
- **FR-008**: System MUST preserve single-evaluation-per-hand lifecycle in `ws-server/server.mjs`, scheduling at most one settlement reaction candidate per completed hand.
- **FR-009**: System MUST preserve server-internal isolation: `handStartStacksByUserId` and `contributionsByUserId` are classifier inputs only and MUST NOT be exposed to clients over WebSocket or API responses.
- **FR-010**: System MUST NOT modify database schema, Supabase migrations, gameplay state reducers, pot settlement accounting, payouts, or bot decision strategy.

### Key Entities

- **AuthoritativeHandAccounting**: Server-internal state maps (`handStartStacksByUserId: Record<string, number>`, `contributionsByUserId: Record<string, number>`) recording exact starting chips and cumulative contributions for the hand.
- **SettlementReactionCandidate**: Ephemeral reaction structure `{ botUserId: string, botSeatNo: number, targetSeatNo?: number, reactionKey: string, handId: string }` passed to reservation, jitter, and broadcast.
- **RiverChangedWinnerEvidence**: String array of user IDs whose winning status was caused by the 5th community card reversing the turn hand leader.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of simulated heads-up all-in losses with river reversal produce `bad_beat` candidates (with 100% frequency setting).
- **SC-002**: 100% of other simulated all-in showdown losses produce `not_this_time` candidates (with 100% frequency setting).
- **SC-003**: 0 non-all-in hands trigger lost all-in or bad beat reactions.
- **SC-004**: 0 database migrations, 0 protocol schema modifications, and 0 ledger discrepancies introduced.
- **SC-005**: Automated unit & behavior tests in `ws-server/poker/handlers/reaction.behavior.test.mjs` and `ws-server/server.behavior.test.mjs` pass deterministically with 100% success.

---

## Assumptions

- **Existing Client Support**: The browser client (PR #1020) already defines `{ key: 'bad_beat', emoji: '😢', label: 'Bad beat' }` and `{ key: 'not_this_time', ... }`, mapping both to the `shake` avatar motion. No client-side changes are required.
- **Personality Deferral**: Distinct personality profiles (Cowboy, Professor, Robot, Shark) belong strictly to issue #804 ("Poker: Living NPCs") and are not implemented in this increment.
- **Human Isolation**: Automated reactions are exclusively generated for bots (`isBot === true`); real players never have automated reaction events.
- **Deployment Requirement**: Because changes affect `ws-server/**`, merge readiness requires an exact-SHA manual `WS Preview Deploy` and runtime verification.
