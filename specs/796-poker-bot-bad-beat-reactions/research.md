# Research: Poker: Bot Bad-Beat & Lost All-In Reactions (Backend + Poker V2 Catalog #796)

**Feature Branch**: `796-poker-bot-bad-beat-reactions`

**Created**: 2026-09-27 | **Revised**: 2026-09-28

**Spec**: [spec.md](spec.md)

---

## 1. Codebase Reconciliation & Architectural Boundaries

### Authoritative Runtime Boundary
- Real-time poker state and gameplay evaluation reside entirely in `ws-server/server.mjs` and `ws-server/poker/`.
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
- Before evaluation, internal `buildDetachedReactionContext(state)` in `ws-server/server.mjs` extracts and freezes the relevant subsets of `state` into an immutable context object. This helper is **internal** to `server.mjs` and must **not** be exported for tests.

### Server Reaction Keys Boundary (`ws-server/poker/handlers/reaction.mjs`)
- The server does NOT have a `REACTION_CATALOG`.
- The server maintains:
  - `REACTION_KEYS`: frozen array of all valid reaction keys on the server;
  - `REACTION_KEY_SET = new Set(REACTION_KEYS)`: derived set used for lookup and validation;
  - `HUMAN_REACTION_KEYS`: frozen array of reaction keys permitted for human players.
- Adding the 5 new bot-only keys to server `REACTION_KEYS` automatically includes them in `REACTION_KEY_SET` through the existing mechanism, while leaving `HUMAN_REACTION_KEYS` untouched.

### Client Reaction Presentation Boundary (`poker/poker-v2.js`)
- The browser client defines `REACTION_CATALOG` mapping keys to emojis, labels, and `humanSelectable` flags.
- Client helper `resolveBotAvatarReactionMotion(reactionKey)` maps keys to avatar motion classes (e.g. `shake`, `nod`). The implementation will exclusively extend this existing function; no second helper or alias is created.
- PR #1020 established the V1 avatar motion lifecycle (`renderSeats()`, `clearBotAvatarReactions()`, `triggerBotAvatarReaction()`).
- Expanding client catalog with 5 new bot-only keys requires updating `poker/poker-v2.js` `REACTION_CATALOG` to define their emojis/labels with `humanSelectable: false`, and updating `resolveBotAvatarReactionMotion` to map them to `shake`.

---

## 2. Dedicated All-In Loss Reaction Pool

### Why `not_this_time` is Excluded from Lost All-In
- In the existing codebase, `not_this_time` is the bot's reaction upon folding (`FOLD -> not_this_time`).
- Using `not_this_time` for an all-in showdown loss created confusing semantic repetition ("😌 Not this time." on fold vs. on all-in elimination).
- Live GitHub issue #796 explicitly mandates: **`not_this_time` remains exclusively the bot's reaction on FOLD. It must not be used after a lost all-in.**

### The Five New Bot-Only Keys
Issue #796 defines an ordered pool of five distinct reactions for ordinary all-in losses:

| Key | Emoji | Label | Avatar Motion | `humanSelectable` |
|---|---|---|---|---|
| `all_in_oh_no` | 😞 | "Oh no..." | `shake` | `false` |
| `all_in_that_hurts` | 😣 | "That hurts." | `shake` | `false` |
| `all_in_no_way` | 😠 | "No way..." | `shake` | `false` |
| `all_in_come_on` | 😤 | "Come on!" | `shake` | `false` |
| `all_in_censored` | 🤬 | "******!" | `shake` | `false` |

### Two Sequential Random Draws Contract
The new branch reuses the existing injected `random` without introducing any new RNG abstractions, executing up to two sequential draws:

1. **Draw 1 (Frequency Gate)**:
   `samplePasses(random, 1, reactionSettings)` consumes one draw from `random`. At default `frequencyPercent = 100`, any sample `< 1.0` passes.
2. **Draw 2 (Selection Draw)**:
   After passing the frequency gate, if the candidate qualifies for ordinary lost all-in (or multiway river reversal), the classifier calls `sampleAllInLossReactionKey(random)`, which consumes a second draw from `random` for uniform selection across `ALL_IN_LOSS_REACTION_KEYS`:
   ```javascript
   const ALL_IN_LOSS_REACTION_KEYS = Object.freeze([
     'all_in_oh_no',
     'all_in_that_hurts',
     'all_in_no_way',
     'all_in_come_on',
     'all_in_censored'
   ]);

   function sampleAllInLossReactionKey(random = Math.random) {
     const r = typeof random === 'function' ? random() : Math.random();
     const clamped = Math.min(Math.max(Number(r) || 0, 0), 0.999999);
     const index = Math.floor(clamped * ALL_IN_LOSS_REACTION_KEYS.length);
     return ALL_IN_LOSS_REACTION_KEYS[index] || ALL_IN_LOSS_REACTION_KEYS[0];
   }
   ```
- **Boundary Mapping for Tests (Selection Draw)**:
  These uniform boundaries apply strictly to the **second draw (selection draw) after a successful frequency gate**:
  - `[0.0, 0.2)` → `all_in_oh_no`
  - `[0.2, 0.4)` → `all_in_that_hurts`
  - `[0.4, 0.6)` → `all_in_no_way`
  - `[0.6, 0.8)` → `all_in_come_on`
  - `[0.8, 1.0)` → `all_in_censored`
- For `bad_beat` (heads-up river reversal), only the first draw (`samplePasses`) is consumed because the reaction key is constant (`bad_beat`).
- Deterministic behavior tests should supply an appropriate sequence of injected random values (e.g. `[0.1, 0.05]`) or directly test `sampleAllInLossReactionKey`.
- Personality-specific weighting (Cowboy, Professor, Robot, Shark) is strictly deferred to #804.

---

## 3. Narrow River-Reversal Bad-Beat Heuristic

### Definition
For #796, `bad_beat` is intentionally a **narrow river-reversal heuristic**, not a mathematically exact poker-equity definition:
1. The bot qualifies as a lost-all-in loser;
2. Exactly two actual showdown hands were evaluated (`Object.keys(state.showdown?.handsByUserId || {}).length === 2`);
3. Exactly one final winner (`state.showdown?.winners?.length === 1`);
4. That final winner appears in existing `riverChangedWinnerUserIds`.

If all conditions hold, the classifier emits existing `bad_beat` (😢 "Bad beat" with `shake` avatar motion, table broadcast without `targetSeatNo`) instead of sampling the 5-item loss pool.

### Why Equity Calculations are Excluded
- Calculating turn equity requires a Monte Carlo or combinatorial poker-equity engine.
- A river reversal (the leader on the turn being overtaken on the 5th street) is an unambiguous, observable historical milestone already computed by `deriveRiverChangedWinnerUserIds(state)`.
- Multiway showdowns (3+ hands in `showdown.handsByUserId`) are complex and do not trigger `bad_beat`; qualifying multiway all-in losers sample from the 5-reaction all-in loss pool.

---

## 4. Authoritative Evidence & Validation Rules

### Uncoerced Integer Accounting
- `handStartStacksByUserId[userId]`: Map of user ID to starting chips when hand was dealt.
- `contributionsByUserId[userId]`: Cumulative chips committed across all streets.
- **Rule**: Raw values must ALREADY be integers. No coercion (`Number(...)`) may be performed before type validation:
  ```javascript
  function isPlayerAllIn(userId, handStartStacks, contributions) {
    const start = handStartStacks?.[userId];
    const contrib = contributions?.[userId];
    if (typeof start !== 'number' || !Number.isInteger(start) || start <= 0) return false;
    if (typeof contrib !== 'number' || !Number.isInteger(contrib) || contrib < 0) return false;
    return contrib === start;
  }
  ```
- If `contrib > start`, data is corrupt/inconsistent and fails closed.
- No `>=` comparisons are permitted in all-in validation.

### Showdown Loser Definition & Uncalled Return Handling
- A bot qualifies as an all-in loser if and only if:
  1. It is not in `showdown.winners`;
  2. `Number(state.handSettlement?.payouts?.[botUserId] ?? 0) <= 0`.
- If an uncalled bet was refunded to the bot's stack via `poker-side-pots.mjs` / `poker-payout.mjs`, `handSettlement.payouts[botUserId] > 0`. This strictly disqualifies the bot from all-in loss reactions and `bad_beat`.
- The classifier cleanly falls through to existing generic settlement branches (`lucky`, `nice_hand`, `wow`, `congrats`/`well_played`).
- Zero changes are made to the settlement/payout engine.

### Fail-Closed Fallthrough
- If accounting maps are missing, undefined, non-integer, or corrupt, the all-in branch is skipped.
- The classifier DOES NOT return `null` on accounting failure alone; it continues down the existing waterfall.

---

## 5. Priority Hierarchy & Base Probability

### Priority Waterfall
```text
1. normalFoldWin (i_was_bluffing / nice_bluff)
   ↓ (no fold win)
2. NEW: lostAllIn / badBeat
   ├── Heads-Up + River Reversal? → bad_beat
   └── Otherwise → sample from ALL_IN_LOSS_REACTION_KEYS (5 keys)
   ↓ (no eligible losing all-in bot)
3. luckyWinner (lucky)
   ↓
4. strongWinner (nice_hand)
   ↓
5. largeWinner (wow)
   ↓
6. genericWinner (congrats / well_played)
```

### Base Probability = 1.0
- Base probability is **1.0** via `samplePasses(random, 1, reactionSettings)`.
- At default `frequencyPercent = 100`, every qualified all-in loss or bad beat reliably generates a reaction candidate.
- Reuses existing 4,000 ms cooldown, 300–1,200 ms jitter, scheduler, and single-evaluation-per-hand lifecycle.
- Untargeted table broadcast: no `targetSeatNo`.

---

## 6. Non-Goals & Testing Constraints

- **No Personality Archetypes**: Cowboy, Professor, Robot, Shark personalities belong strictly to issue #804 ("Poker: Living NPCs").
- **No Real Profanity**: `all_in_censored` uses literal `******!`.
- **Breaking Impact**: Zero WebSocket message-type / payload-shape changes (`table_reaction` payload shape `{ seatNo, reactionKey }` remains identical); semantic `reactionKey` vocabulary expands by five bot-only keys (`all_in_oh_no`, `all_in_that_hurts`, `all_in_no_way`, `all_in_come_on`, `all_in_censored`). `docs/ws-poker-protocol.md` documents these 5 bot-only keys and notes they are not accepted from human `reaction_send`.
- **Dual Accounting Maps Isolation**: `handStartStacksByUserId` and `contributionsByUserId` are server-internal classifier inputs only and are never exposed in public room snapshots or WebSocket messages.
