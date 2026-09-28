# Feature Specification: Poker: Bot Bad-Beat & Lost All-In Reactions (Backend + Poker V2 Catalog #796)

**Feature Branch**: `796-poker-bot-bad-beat-reactions`

**Created**: 2026-09-27 | **Revised**: 2026-09-28

**Status**: Draft

**Input**: User description based on live GitHub issue #796 ("Poker: Bot Avatar Reactions") — Remaining backend & Poker V2 increment: automated settlement classifier for lost all-in reaction pool and heads-up river reversal bad beat heuristic.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ordinary Lost All-In Bot Reaction Pool (Priority: P1) 🎯 MVP

When a bot pushes all-in or calls all-in during a hand, reaches showdown, commits its entire starting stack, and loses without qualifying for the specific heads-up river reversal heuristic, the bot expresses frustration by selecting uniformly from a new dedicated pool of five bot-only loss reactions:

1. `all_in_oh_no` → 😞 "Oh no..."
2. `all_in_that_hurts` → 😣 "That hurts."
3. `all_in_no_way` → 😠 "No way..."
4. `all_in_come_on` → 😤 "Come on!"
5. `all_in_censored` → 🤬 "******!"

The existing `not_this_time` reaction key is strictly reserved for the bot's fold reaction (`FOLD -> not_this_time`) and MUST NEVER be emitted for a lost all-in. All five new keys reuse the existing avatar `shake` motion, are untargeted table broadcasts (no `targetSeatNo`), and have `humanSelectable: false`.

**Why this priority**: A lost all-in is a dramatic poker milestone. A pool of distinct negative expressions gives bots personality and variety without repeating the fold reaction text or requiring new animations.

**Independent Test**: Simulate an all-in showdown loss (both heads-up non-reversal and multiway); verify the bot emits one of the 5 new keys, never `not_this_time`, with uniform selection across injected random boundaries.

**Acceptance Scenarios**:
1. **Given** an active hand where bot B has `handStartStacksByUserId[B] === 100` and `contributionsByUserId[B] === 100`, **When** the hand settles with player P as the sole winner on a non-reversal runout, **Then** bot B emits one of the five new all-in loss reaction keys (broadcast to table, no `targetSeatNo`), and never `not_this_time`.
2. **Given** a multiway showdown where bot B loses all-in against two opponents, **When** the hand settles, **Then** bot B is classified with a key from the 5-reaction loss pool, and never `bad_beat` or `not_this_time`.
3. **Given** injected `random` values spanning the uniform range `[0, 1)`, **When** settlement evaluates ordinary lost all-in, **Then** following a successful frequency gate draw (`samplePasses(random, 1, reactionSettings)`), the second draw (`sampleAllInLossReactionKey(random)`) deterministically matches the index boundary:
   - `[0.0, 0.2)` → `all_in_oh_no`
   - `[0.2, 0.4)` → `all_in_that_hurts`
   - `[0.4, 0.6)` → `all_in_no_way`
   - `[0.6, 0.8)` → `all_in_come_on`
   - `[0.8, 1.0)` → `all_in_censored`

---

### User Story 2 - Heads-Up River Reversal Bad Beat Reaction (Priority: P1) 🎯 MVP

When a bot is heads-up in an all-in confrontation, held the winning hand on the turn, but the river card reverses the outcome giving the opponent the winning hand, the bot emits the specific `bad_beat` reaction key (😢 "Bad beat", broadcast to table without `targetSeatNo`).

For #796, `bad_beat` is intentionally defined as a **narrow river-reversal heuristic**:
- The bot qualifies as a lost-all-in loser;
- Exactly two actual showdown hands were evaluated (`Object.keys(showdown.handsByUserId).length === 2`);
- There is exactly one final winner (`showdown.winners.length === 1`);
- That winner is present in `riverChangedWinnerUserIds`.

If all conditions hold, the classifier emits `bad_beat` instead of sampling the ordinary all-in-loss pool. This deliberately avoids an equity calculator or probability engine.

**Why this priority**: River bad beats are the most memorable emotional moments in poker. Emitting `bad_beat` directly fulfills the explicit bad beat reaction requirement in issue #796.

**Independent Test**: Simulate a heads-up showdown where a bot lost all-in and the winner appears in `riverChangedWinnerUserIds`; verify reaction key is `bad_beat` (broadcast to table without `targetSeatNo`).

**Acceptance Scenarios**:
1. **Given** a heads-up all-in showdown between bot B and player P where B loses, **When** P is verified in `riverChangedWinnerUserIds`, **Then** bot B is classified with reaction key `bad_beat` (broadcast to table, no `targetSeatNo`).
2. **Given** a hand with 3 players in `handSeats`, where 1 player left the table or sat out before showdown, leaving exactly 2 players with hands evaluated in `showdown.handsByUserId`, **When** bot B loses all-in on river reversal, **Then** bot B is correctly recognized as heads-up and classified with `bad_beat`.
3. **Given** a multiway showdown (3+ players evaluated in `showdown.handsByUserId`) where the winner caught a river card, **When** bot B loses all-in, **Then** bot B is NOT classified as `bad_beat`; it falls back to the ordinary 5-reaction all-in loss pool.

---

### User Story 3 - Authoritative Evidence & Fail-Closed Safety (Priority: P2)

The reaction classifier must determine all-in status solely from authoritative ledger/engine state: `handStartStacksByUserId` and `contributionsByUserId`.
- Raw `handStartStack` and `contribution` values must be actual integer numbers;
- No type coercion (`Number(...)`) may occur before validation;
- Must strictly require `handStartStack > 0`, `contribution >= 0`, and exact `contribution === handStartStack`;
- Bot must not be in `showdown.winners`;
- `Number(handSettlement.payouts?.[botUserId] ?? 0) <= 0`.

Any positive payout (including uncalled bet returns refunded from side pots or pot chops) strictly disqualifies the bot from both ordinary all-in-loss reactions and `bad_beat`.

**Fail-Closed Fallthrough**: Missing or corrupt accounting evidence (`contribution > handStartStack`, missing maps, non-integers) skips ONLY the new all-in-loss / bad-beat branch. The classifier DOES NOT return `null` on accounting failure alone, but cleanly continues down the existing settlement reaction waterfall (`lucky`, `nice_hand`, `wow`, `congrats`/`well_played`) without altering existing generic behavior.

**Independent Test**: Supply corrupt, negative, non-integer, missing, or mismatched accounting fields (`contribution > handStartStack`), or simulate uncalled bet return; verify the classifier safely skips all-in evaluation and falls through to generic settlement branches without throwing or returning null.

**Acceptance Scenarios**:
1. **Given** a settled hand where `handStartStacksByUserId` or `contributionsByUserId` is missing, undefined, has non-integer/negative values, or has `contribution > handStartStack`, **When** `classifySettlementReaction` runs, **Then** the all-in branch is skipped and the classifier proceeds down the standard settlement waterfall (e.g. `lucky`, `nice_hand`, `wow`, `congrats`/`well_played`) without returning null or crashing.
2. **Given** a bot that lost a showdown pot but had `contribution < handStartStack` (non-all-in loss), **When** settlement occurs, **Then** the bot is NOT classified for lost all-in or bad beat.
3. **Given** a bot that committed its full starting stack (`contribution === handStartStack`) but received a positive uncalled bet return (`handSettlement.payouts[botUserId] > 0`) while losing the contested pot, **When** settlement occurs, **Then** the bot is NOT classified for lost all-in or bad beat, and the classifier falls through to existing generic settlement branches.

---

### User Story 4 - Classifier Priority, Uniform Selection & Lifecycle Integration (Priority: P3)

The new lost all-in / bad-beat branch must integrate cleanly into the existing settlement reaction pipeline:
- Executing after normal fold-wins (`i_was_bluffing` / `nice_bluff`), but before generic `lucky`, `nice_hand`, `wow`, and `congrats`/`well_played` reactions;
- Evaluated with base probability = 1.0 via `samplePasses(random, 1, reactionSettings)`, ensuring every qualified event reliably triggers under 100% frequency setting;
- Uniform random selection over the 5-item all-in loss pool using injected `random`;
- Preserving 4,000 ms per-sender cooldown, 300–1,200 ms presentation jitter, scheduler, and single-evaluation-per-hand lifecycle;
- Both accounting maps (`handStartStacksByUserId`, `contributionsByUserId`) remain server-internal and are never exposed in public WebSocket room snapshots or protocol messages.

**Acceptance Scenarios**:
1. **Given** a hand where bot B loses all-in to opponent P who holds a strong hand (category >= 4), **When** settlement evaluates reactions, **Then** bot B's negative reaction takes precedence over a generic `nice_hand` congratulations.
2. **Given** a table where bot reaction settings have `enabled === false`, **When** an all-in loss or bad beat occurs, **Then** no reaction is emitted.
3. **Given** multiple bots qualifying for lost all-in in the same hand, **When** settlement evaluates, **Then** exactly one bot is selected deterministically by normalized seat order.

---

### User Story 5 - Client Catalog & Motion Consistency (Poker V2) (Priority: P3)

The browser client (`poker/poker-v2.js`) defines the reaction catalog `REACTION_CATALOG` and avatar motion lookup helper `resolveBotAvatarReactionMotion`.
- The client catalog is extended with the five new bot-only reaction entries:
  - `all_in_oh_no`: emoji `😞`, label `Oh no...`, `humanSelectable: false`
  - `all_in_that_hurts`: emoji `😣`, label `That hurts.`, `humanSelectable: false`
  - `all_in_no_way`: emoji `😠`, label `No way...`, `humanSelectable: false`
  - `all_in_come_on`: emoji `😤`, label `Come on!`, `humanSelectable: false`
  - `all_in_censored`: emoji `🤬`, label `******!`, `humanSelectable: false`
- Each of the five new keys maps to the existing avatar motion `shake` in the existing `resolveBotAvatarReactionMotion` helper (which is extended without creating aliases or secondary helpers).
- None of the five new keys appear in the human reaction selector/bar (`humanSelectable: false`).
- Zero new CSS animation keyframes, layout changes, or timer maps are introduced.

**Acceptance Scenarios**:
1. **Given** an incoming `table_reaction` WebSocket message containing one of the 5 new keys, **When** Poker V2 handles the reaction, **Then** it renders a speech bubble with the exact emoji and label and triggers the `shake` avatar motion on the bot's avatar node via `resolveBotAvatarReactionMotion`.
2. **Given** a human player opening the reaction menu, **When** options are rendered, **Then** none of the 5 bot-only keys are visible or selectable.

---

### Edge Cases

- **Split pot / partial chop / uncalled bet return**: Any positive payout (`Number(handSettlement.payouts?.[botUserId] ?? 0) > 0`) strictly disqualifies the bot from all-in loss reactions and `bad_beat`.
- **Bot folded earlier in hand**: If the bot folded on preflop, flop, or turn, its fold was already processed (emitting `not_this_time` on fold if rolled). At settlement, `state.foldedByUserId[bot.userId] === true` excludes it from showdown settlement reactions.
- **Bot left table or sat out**: If `state.leftTableByUserId[bot.userId] === true` or `state.sitOutByUserId[bot.userId] === true`, the bot cannot speak at settlement.
- **Multiway river reversal**: If 3 or more players have evaluated hands in `showdown.handsByUserId`, river suckouts are complex multiway equity shifts. `bad_beat` is restricted to heads-up showdowns (`Object.keys(showdown.handsByUserId).length === 2`); multiway all-in losers select from the 5-reaction all-in loss pool.
- **Corrupt or non-integer accounting**: If `handStartStack` or `contribution` are strings, non-integers, negative, or `contribution > handStartStack`, all-in validation fails closed (skips branch, continues generic waterfall).

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST determine bot all-in participation exclusively from uncoerced integer accounting fields: `handStartStacksByUserId` and `contributionsByUserId` (`typeof val === 'number' && Number.isInteger(val)`, `handStartStack > 0`, `contribution >= 0`, `contribution === handStartStack`). If types are non-integer, negative, or `contribution > handStartStack`, system MUST treat this as corrupt accounting evidence and fail closed on this branch.
- **FR-002**: System MUST require `Number(handSettlement.payouts?.[botUserId] ?? 0) <= 0` and absence from `showdown.winners`. Any positive payout (including uncalled bet returns) strictly disqualifies the bot from the lost all-in branch.
- **FR-003**: System MUST classify an eligible losing all-in bot as `bad_beat` (broadcast to table, without `targetSeatNo`) when the showdown is heads-up (exactly 2 actual showdown participants evaluated in `showdown.handsByUserId` with a single winner) and the winner is present in `riverChangedWinnerUserIds`.
- **FR-004**: System MUST classify an eligible losing all-in bot not meeting the heads-up river reversal condition by uniformly selecting from the 5-item bot-only all-in loss pool (`all_in_oh_no`, `all_in_that_hurts`, `all_in_no_way`, `all_in_come_on`, `all_in_censored`) using injected `random`.
- **FR-005**: System MUST NOT emit `not_this_time` for any lost all-in confrontation; `not_this_time` MUST remain exclusively reserved for bot fold reactions.
- **FR-006**: System MUST position the lost all-in / bad-beat classifier in `classifySettlementReaction` after the normal fold-win branch, but before generic `lucky`, `nice_hand`, `wow`, and `congrats`/`well_played` branches.
- **FR-007**: System MUST fail closed on the lost all-in / bad-beat branch (skipping the branch and proceeding to standard generic settlement branches) if accounting maps are missing, undefined, inconsistent, non-integer, negative, or show `contribution !== handStartStack`. The classifier MUST NOT return null on accounting discrepancy alone.
- **FR-008**: System MUST evaluate the lost all-in / bad-beat branch using base probability = 1.0 via `samplePasses(random, 1, reactionSettings)`, ensuring every qualified event produces a candidate at 100% frequency setting.
- **FR-009**: System MUST enforce the existing 4,000 ms per-sender cooldown and apply 300–1,200 ms presentation jitter to scheduled reaction candidates, emitting at most one settlement reaction candidate per completed hand.
- **FR-010**: System MUST include the five new keys in the server `REACTION_KEYS` array in `ws-server/poker/handlers/reaction.mjs` (automatically accepted by `REACTION_KEY_SET`), but MUST NOT include them in `HUMAN_REACTION_KEYS`.
- **FR-011**: Client (`poker/poker-v2.js`) MUST define the five new keys in `REACTION_CATALOG` with exact emoji/labels and `humanSelectable: false`, and map them to the existing `shake` avatar motion in `resolveBotAvatarReactionMotion`.
- **FR-012**: System MUST preserve server-internal isolation: neither `handStartStacksByUserId` nor `contributionsByUserId` may be exposed to clients over WebSocket or public room snapshots.
- **FR-013**: System MUST NOT modify database schema, Supabase migrations, gameplay state reducers, pot settlement accounting, payouts, or bot decision strategy.

### Key Entities

- **AuthoritativeHandAccounting**: Server-internal state maps (`handStartStacksByUserId: Record<string, number>`, `contributionsByUserId: Record<string, number>`) recording exact starting chips and cumulative contributions for the hand.
- **AllInLossReactionPool**: Ordered tuple of five bot-only reaction keys: `['all_in_oh_no', 'all_in_that_hurts', 'all_in_no_way', 'all_in_come_on', 'all_in_censored']`.
- **SettlementReactionCandidate**: Ephemeral reaction structure `{ botUserId: string, botSeatNo: number, reactionKey: string, handId: string }` passed to reservation, jitter, and broadcast. Both `bad_beat` and all-in loss reactions omit `targetSeatNo`.
- **RiverChangedWinnerEvidence**: String array of user IDs whose winning status was caused by the 5th community card reversing the turn hand leader.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of simulated heads-up all-in losses with river reversal produce `bad_beat` candidates (with 100% frequency setting).
- **SC-002**: 100% of other simulated all-in showdown losses produce one of the 5 new pool keys uniformly; exactly 0% produce `not_this_time`.
- **SC-003**: 0 non-all-in hands or hands with uncalled bet returns trigger all-in loss or bad beat reactions.
- **SC-004**: 0 human reaction menus display the 5 bot-only keys (`humanSelectable: false` verified).
- **SC-005**: 100% of the 5 new reaction keys render their exact emoji and label and trigger the `shake` avatar motion in Poker V2 without new CSS.
- **SC-006**: 0 database migrations, 0 WebSocket message-type / payload-shape changes (semantic reactionKey vocabulary expands by five bot-only keys; `docs/ws-poker-protocol.md` updated), and 0 exposure of accounting maps to clients.
- **SC-007**: Automated unit & behavior tests pass deterministically with 100% success.

---

## Assumptions & Boundaries

- **Breaking Impact**: Zero WebSocket message-type / payload-shape changes (`table_reaction` payload shape `{ seatNo, reactionKey }` remains identical); semantic `reactionKey` vocabulary expands by five bot-only keys (`all_in_oh_no`, `all_in_that_hurts`, `all_in_no_way`, `all_in_come_on`, `all_in_censored`). `docs/ws-poker-protocol.md` documents these 5 bot-only keys and notes they are not accepted from human `reaction_send`.
- **Personality Deferral**: Distinct personality profiles (Cowboy, Professor, Robot, Shark) belong strictly to issue #804 ("Poker: Living NPCs") and are not implemented in this increment. In #796, pool selection is strictly uniform.
- **Human Isolation**: Automated reactions are exclusively generated for bots (`isBot === true`); real players never have automated reaction events.
- **Deployment Requirement**: Because changes affect `ws-server/**`, merge readiness requires an exact-SHA manual `WS Preview Deploy` and runtime verification.
