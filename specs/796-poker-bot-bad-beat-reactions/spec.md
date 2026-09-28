# Feature Specification: Poker: Bot Bad-Beat & Lost All-In Reactions (Backend #796)

**Feature Branch**: `796-poker-bot-bad-beat-reactions`

**Created**: 2026-09-27

**Status**: Draft

**Input**: User description based on GitHub issue #796 ("Poker: Bot Avatar Reactions") — Remaining backend increment: automated settlement classifier for lost all-in and heads-up river reversal bad beat.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Lost All-In Bot Reaction (Priority: P1) 🎯 MVP

When a bot pushes all-in or calls all-in during a hand, reaches showdown, and is eliminated/loses its committed chips to another player, the bot expresses frustration using the existing `not_this_time` reaction key (broadcast to the table without target).

**Why this priority**: A lost all-in is a high-stakes, dramatic poker milestone. Having the bot acknowledge the defeat makes the game feel responsive and alive without requiring new assets, keys, or protocol changes.

**Independent Test**: Can be tested independently in a simulated or live settlement where a bot commits its entire starting stack (`contribution === handStartStack`), loses at showdown, and emits a `not_this_time` reaction candidate.

**Acceptance Scenarios**:
1. **Given** an active hand where bot B has `handStartStacksByUserId[B] === 100` and `contributionsByUserId[B] === 100`, **When** the hand settles with player P as the sole winner and no river reversal, **Then** bot B is classified with reaction key `not_this_time` (broadcast to table, no `targetSeatNo`).
2. **Given** a multiway showdown where bot B loses all-in against two opponents, **When** the hand settles, **Then** bot B is classified with reaction key `not_this_time` (broadcast to table, no `targetSeatNo`).

---

### User Story 2 - Heads-Up River Reversal Bad Beat Reaction (Priority: P1) 🎯 MVP

When a bot is heads-up in an all-in confrontation, held the winning hand on the turn, but the river card reverses the outcome giving the opponent the winning hand, the bot emits the specific `bad_beat` reaction key (broadcast to the table without target).

**Why this priority**: River bad beats are the most memorable emotional moments in poker. Emitting `bad_beat` directly fulfills the explicit bad beat reaction requirement in issue #796 without changing the frontend targeting contract (which remains reserved for `nice_hand`).

**Independent Test**: Can be tested independently in a heads-up showdown where a bot lost all-in and the winner appears in authoritative `riverChangedWinnerUserIds`, resulting in reaction key `bad_beat` broadcast to the table.

**Acceptance Scenarios**:
1. **Given** a heads-up all-in showdown between bot B and player P where B loses, **When** P is verified in `riverChangedWinnerUserIds`, **Then** bot B is classified with reaction key `bad_beat` (broadcast to table, no `targetSeatNo`).
2. **Given** a multiway pot (3+ players at showdown) where the winner caught a river card, **When** bot B loses all-in, **Then** bot B is NOT classified as `bad_beat` (to avoid speculative equity inference); it falls back to `not_this_time`.

---

### User Story 3 - Authoritative Evidence & Fail-Closed Safety (Priority: P2)

The reaction classifier must determine all-in status solely from authoritative ledger/engine state: `handStartStacksByUserId` and `contributionsByUserId`. It must strictly require `contribution === handStartStack` with `handStartStack > 0`, absence from `showdown.winners`, and zero payout (`Number(handSettlement.payouts?.[botUserId] ?? 0) <= 0`). Any discrepancy (including `contribution > handStartStack`), missing values, or non-integer amounts must fail closed for the all-in branch without aborting subsequent generic settlement reactions.

**Why this priority**: Guarantees funds safety, auditability, and deterministic behavior. Prevents false positive all-in classifications due to temporary client side-effects, uncalled bet returns, or partial state resets.

**Independent Test**: Supply corrupt, negative, non-integer, missing, or mismatched accounting fields (`contribution > handStartStack` or `contribution < handStartStack`), or simulate uncalled bet return; verify the classifier safely skips all-in evaluation and falls through to generic settlement branches without throwing or returning null.

**Acceptance Scenarios**:
1. **Given** a settled hand where `handStartStacksByUserId` or `contributionsByUserId` is missing, undefined, has negative/non-integer values, or has `contribution > handStartStack`, **When** `classifySettlementReaction` runs, **Then** the lost all-in branch is skipped and the classifier proceeds down the standard settlement waterfall (e.g. `lucky`, `nice_hand`, `wow`, `congrats`/`well_played`) without returning null or crashing.
2. **Given** a bot that lost a showdown pot but had `contribution < handStartStack` (non-all-in loss), **When** settlement occurs, **Then** the bot is NOT classified for lost all-in or bad beat.
3. **Given** a bot that committed its full starting stack (`contribution === handStartStack`) but received a positive uncalled bet return (`handSettlement.payouts[botUserId] > 0`) while losing the contested pot, **When** settlement occurs, **Then** the bot is NOT classified for lost all-in or bad beat, and the classifier falls through to existing generic settlement branches.

---

### User Story 4 - Classifier Priority & Lifecycle Integration (Priority: P3)

The new lost all-in / bad-beat branch must integrate cleanly into the existing settlement reaction pipeline: executing after normal fold-wins, but before generic `lucky`, `nice_hand`, `well_played`, and `congrats` reactions, using base probability = 1.0 (`samplePasses(random, 1, reactionSettings)`), while strictly preserving cooldowns, jitter, and frequency controls.

**Why this priority**: Ensures specific player/bot events take priority over generic polite congratulations, while maintaining table civility and rate limits. At 100% frequency setting, every qualified case reliably triggers.

**Independent Test**: Run settlement scenarios with overlapping conditions (e.g. lost all-in vs strong winner); verify the losing bot's event takes priority, respects sender cooldown, and emits exactly one reaction candidate per hand.

**Acceptance Scenarios**:
1. **Given** a hand where bot B loses all-in to opponent P who holds a strong hand (category >= 4), **When** settlement evaluates reactions, **Then** bot B's negative reaction takes precedence over a generic `nice_hand` congratulations.
2. **Given** a table where bot reaction settings have `enabled === false`, **When** a bad beat occurs, **Then** no reaction is emitted.
3. **Given** a table with default 100% frequency setting, **When** an eligible lost all-in or bad beat occurs, **Then** a reaction candidate is generated with 100% certainty (base probability = 1.0).
4. **Given** multiple bots qualifying for lost all-in in the same hand, **When** settlement evaluates, **Then** exactly one bot is selected deterministically by seat order.

---

### Edge Cases

- **Split pot / partial chop / uncalled bet return**: If a bot receives any share of the pot or an uncalled bet return (`Number(handSettlement.payouts?.[botUserId] ?? 0) > 0`), the bot is not a lost all-in loser and MUST NOT emit `bad_beat` or `not_this_time`. Even if absent from `showdown.winners`, any positive payout strictly disqualifies the bot from the lost all-in branch.
- **Bot folded earlier in hand**: If the bot folded on preflop, flop, or turn, its fold was already processed (emitting `not_this_time` on fold if rolled). At settlement, `state.foldedByUserId[bot.userId] === true` excludes it from showdown settlement reactions.
- **Bot left table or sat out**: If `state.leftTableByUserId[bot.userId] === true` or `state.sitOutByUserId[bot.userId] === true`, the bot cannot speak at settlement.
- **Multiway river reversal**: If 3 or more players are involved at showdown, river suckouts are complex multiway equity shifts. To keep behavior predictable without an equity engine, `bad_beat` is restricted to heads-up showdowns; multiway all-in losers receive `not_this_time`.
- **Zero starting stack or corrupt contribution**: If `handStartStack === 0` or `contribution > handStartStack`, all-in validation fails closed (must have `handStartStack > 0 && contribution === handStartStack`).

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST determine bot all-in participation exclusively from `handStartStacksByUserId` and `contributionsByUserId` requiring exact equality (`contribution === handStartStack && handStartStack > 0`), and MUST require `Number(handSettlement.payouts?.[botUserId] ?? 0) <= 0` and absence from `showdown.winners`. If `contribution > handStartStack`, values are non-integer/negative, or payout is positive (including uncalled bet returns), system MUST treat this as not qualifying for lost all-in.
- **FR-002**: System MUST classify an eligible losing all-in bot as `bad_beat` (broadcast to table, without `targetSeatNo`) when the showdown is heads-up and the winner is present in `riverChangedWinnerUserIds`.
- **FR-003**: System MUST classify an eligible losing all-in bot not meeting the heads-up river reversal condition as `not_this_time` (broadcast to table, without `targetSeatNo`).
- **FR-004**: System MUST position the lost all-in / bad-beat classifier in `classifySettlementReaction` after the normal fold-win branch, but before generic `lucky`, `nice_hand`, `well_played`, and `congrats` branches.
- **FR-005**: System MUST fail closed on the lost all-in / bad-beat branch (skipping the branch and proceeding to standard generic settlement branches) if accounting maps are missing, undefined, inconsistent, non-integer, negative, or show `contribution !== handStartStack`. The classifier MUST NOT return null on accounting discrepancy alone, preserving existing generic reaction waterfall.
- **FR-006**: System MUST evaluate the lost all-in / bad-beat branch using base probability = 1.0 via `samplePasses(random, 1, reactionSettings)`, ensuring every qualified event produces a candidate at 100% frequency setting.
- **FR-007**: System MUST enforce the existing 4,000 ms per-sender cooldown and apply 300–1,200 ms presentation jitter to scheduled reaction candidates.
- **FR-008**: System MUST preserve single-evaluation-per-hand lifecycle in `ws-server/server.mjs`, scheduling at most one settlement reaction candidate per completed hand.
- **FR-009**: System MUST preserve server-internal isolation: neither `handStartStacksByUserId` nor `contributionsByUserId` may be exposed to clients over WebSocket or public room snapshots.
- **FR-010**: System MUST NOT modify database schema, Supabase migrations, gameplay state reducers, pot settlement accounting, payouts, or bot decision strategy.

### Key Entities

- **AuthoritativeHandAccounting**: Server-internal state maps (`handStartStacksByUserId: Record<string, number>`, `contributionsByUserId: Record<string, number>`) recording exact starting chips and cumulative contributions for the hand.
- **SettlementReactionCandidate**: Ephemeral reaction structure `{ botUserId: string, botSeatNo: number, reactionKey: string, handId: string }` passed to reservation, jitter, and broadcast. Both `bad_beat` and `not_this_time` omit `targetSeatNo`.
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
- **Non-Targeted Broadcast**: Client targeting (`targetSeatNo`) remains exclusively reserved for `nice_hand`. Reactions `bad_beat` and `not_this_time` are table broadcasts without `targetSeatNo`.
- **Personality Deferral**: Distinct personality profiles (Cowboy, Professor, Robot, Shark) belong strictly to issue #804 ("Poker: Living NPCs") and are not implemented in this increment.
- **Human Isolation**: Automated reactions are exclusively generated for bots (`isBot === true`); real players never have automated reaction events.
- **Deployment Requirement**: Because changes affect `ws-server/**`, merge readiness requires an exact-SHA manual `WS Preview Deploy` and runtime verification.
