# Research: Poker: Bot Bad-Beat & Lost All-In Reactions (Backend #796)

**Feature Branch**: `796-poker-bot-bad-beat-reactions`
**Date**: 2026-09-27
**Spec**: [spec.md](spec.md)

---

## 1. Codebase Reconciliation & Current Architecture

### Authoritative Runtime Boundary
- Authoritative poker state resides entirely in the WebSocket server (`ws-server/server.mjs`, `ws-server/poker/`).
- Database and Netlify functions are secondary persistence / HTTP adapters and are **not involved** in real-time reaction evaluation.
- Reactions observe freshly committed settlement state in `observeFreshPokerMutation` in `ws-server/server.mjs`:
  ```javascript
  if (isCompleteReactionSettlement(nextState)
    && evaluatedSettlementReactionHandByTableId.get(tableId) !== handId) {
    evaluatedSettlementReactionHandByTableId.set(tableId, handId);
    scheduleBotReactionCandidate(tableId, () => classifySettlementReaction({
      state: nextState,
      botSeats: availableBotSeatsForReaction(tableId),
      reactionSettings: currentBotReactionSettings()
    }), { handId });
  }
  ```
- Before evaluation, `buildDetachedReactionContext(state)` extracts and freezes the relevant subsets of `state` into an immutable context object.

### Existing Settlement Classifiers (`ws-server/poker/handlers/reaction.mjs`)
The current settlement classifier executes in a specific waterfall:
1. `normalFoldWin`:
   - Winning bot -> `i_was_bluffing` (75%)
   - Losing bot -> `nice_bluff` (75%)
2. `luckyWinner`:
   - Winning bot or human was lucky (kicker, close ranks, or river reversal) -> `lucky` (70%)
3. `strongWinner`:
   - Winner had category >= 4 (three of a kind or better) -> `nice_hand` (90%)
4. `largeWinner`:
   - Bot won >= 20 big blinds -> `wow` (100%)
5. `firstWinner` (generic fallback):
   - Winner -> `congrats` or `well_played` (80%)

### What is Missing
- Issue #796 defines that bots should react when losing an all-in confrontation and when suffering a bad beat.
- While `bad_beat` and `not_this_time` exist in `REACTION_KEYS` and are supported in the frontend (speech bubble + `shake` avatar motion implemented in PR #1020), no classifier on the backend emits `bad_beat` or detects an all-in loss at showdown.

---

## 2. Authoritative All-In Evidence Verification

### Why Stack / Payout Inference is Prohibited
- Payout alone does not prove all-in: a player who folded on the turn has 0 payout but was not in an all-in showdown.
- Current stack size alone (`stack === 0`) is mutable and ambiguous: a player might have won a tiny side pot or have remaining chips from an uncalled bet.
- `lastBettingRoundActionByUserId` is street-local: a preflop or flop all-in is cleared or replaced as subsequent streets advance.

### Proven Authoritative Accounting State
The poker state engine (`ws-server/poker/engine/poker-engine.mjs`, `shared/poker-action-reducer.mjs`) maintains two immutable / cumulative mappings:
1. `handStartStacksByUserId`: Map of user ID to exact starting chip balance before blinds were posted.
2. `contributionsByUserId`: Cumulative chip amount committed by the user across all streets in the hand.

**All-In Validation Invariant**:
A player $U$ participated as an all-in player if and only if:
```javascript
const startStack = Number(state?.handStartStacksByUserId?.[userId]);
const contribution = Number(state?.contributionsByUserId?.[userId]);

const isAllIn = Number.isInteger(startStack)
  && startStack > 0
  && Number.isInteger(contribution)
  && contribution >= startStack; // Exactly committed all available starting chips
```
If either map is missing, corrupted, or contains negative/non-integer values, the classifier must **fail closed** by skipping all-in classification.

---

## 3. Bad Beat vs Lost All-In Classification

### Heads-Up River Reversal (`bad_beat`)
- A "bad beat" in poker occurs when a player gets their money in with a commanding lead, only to be overtaken on the final card.
- In `ws-server/poker/handlers/reaction.mjs`, the helper `deriveRiverChangedWinnerUserIds(state)` already inspects the turn board (cards 1–4) vs final community board (5 cards) and determines which winners only became winners on the river.
- **Rule**:
  If:
  1. The bot is an all-in loser (committed 100% of start stack and is not in `showdown.winners`);
  2. The showdown is strictly **heads-up** (exactly 2 players contested the showdown);
  3. The final winner is in `riverChangedWinnerUserIds`;
  Then: classify as `bad_beat` targeting the winner (`targetSeatNo: winner.seatNo`).

### Multiway / Standard All-In Loss (`not_this_time`)
- In multiway pots (3+ players at showdown), river equity shifts are complex and cannot be unambiguously branded a bad beat without an equity calculator.
- When an all-in bot loses at showdown without qualifying for the narrow heads-up river reversal, it expresses defeat via `not_this_time`.
- This reuses the existing `not_this_time` key without creating new protocol entries.

---

## 4. Classifier Priority Hierarchy

The new branch must be positioned **after** `normalFoldWin` and **before** `luckyWinner`:
```text
1. normalFoldWin (i_was_bluffing / nice_bluff)
   ↓ (no fold win)
2. NEW: lostAllIn / badBeat (bad_beat / not_this_time)
   ↓ (no eligible losing all-in bot)
3. luckyWinner (lucky)
   ↓
4. strongWinner (nice_hand)
   ↓
5. largeWinner (wow)
   ↓
6. genericWinner (congrats / well_played)
```
**Rationale**: When a bot loses all its chips in an all-in confrontation, its emotional state is disappointment or shock. It should not be overridden by a generic `well_played` or `nice_hand` congratulations.

---

## 5. Non-Goals & Deferrals

- **Personality Archetypes (Cowboy, Professor, Robot, Shark)**: Issue #804 ("Poker: Living NPCs") is the designated owner of persistent NPC identities and custom emote repertoires. This increment treats all poker bots uniformly through standard gameplay reactions.
- **Client Protocol / Schemas**: No changes to WebSocket message types, client parsing, or database schemas.
- **Gameplay / Logic Reducers**: No changes to betting rules, turn timers, or rake/accounting logic.
