# Contract: Settlement Reactions (Backend + Poker V2 Catalog #796)

**Feature Branch**: `796-poker-bot-bad-beat-reactions`

**Created**: 2026-09-27 | **Revised**: 2026-09-28

**Spec**: [spec.md](../spec.md) | **Plan**: [plan.md](../plan.md)

---

## 1. Context Builder Contract (`ws-server/server.mjs`)

### Function: `buildDetachedReactionContext(state)`

Takes the live internal poker state and generates an immutable, detached snapshot specifically for reaction classifiers.

- **Visibility**: Server-internal only. Must **NOT** be exported for tests or external modules.
- **Preconditions**:
  - `state` is a valid internal poker state object.
- **Postconditions**:
  - Returned object is frozen (`Object.freeze`).
  - Contains `handStartStacksByUserId` as a frozen map of user IDs to integer chip amounts.
  - Contains `contributionsByUserId` as a frozen map of user IDs to integer chip amounts.
  - Does NOT mutate `state`.
  - Is NOT broadcast over WebSocket or exposed in client snapshots (neither `handStartStacksByUserId` nor `contributionsByUserId` is ever exposed).

```javascript
// Internal signature in ws-server/server.mjs (non-exported):
function buildDetachedReactionContext(state): Readonly<DetachedReactionContext>
```

---

## 2. Settlement Classifier Contract (`ws-server/poker/handlers/reaction.mjs`)

### Function: `classifySettlementReaction({ state, botSeats, reactionSettings, random })`

Evaluates settlement context to select at most one bot reaction candidate for the hand.

- **Inputs**:
  - `state`: `DetachedReactionContext` (requires `isCompleteReactionSettlement(state) === true`).
  - `botSeats`: Array of `{ userId: string, seatNo: number }`.
  - `reactionSettings`: `{ enabled?: boolean, frequencyPercent?: number }`.
  - `random`: Pseudo-random number generator function returning `[0, 1)`. Defaults to `Math.random`.
- **Outputs**:
  - `SettlementReactionCandidate | null`:
    ```json
    {
      "botUserId": "bot_123",
      "botSeatNo": 2,
      "reactionKey": "all_in_that_hurts",
      "handId": "hand_abc"
    }
    ```
- **Invariants**:
  - **Deterministic selection**: Bots are sorted in ascending `seatNo` order. When multiple bots qualify, the first eligible bot is selected.
  - **Single emission**: Returns at most one candidate per call.
  - **All-In Qualification**:
    - Raw `handStartStacksByUserId[userId]` and `contributionsByUserId[userId]` must be actual uncoerced integers (`typeof val === 'number' && Number.isInteger(val)`).
    - Starting stack > 0, contribution >= 0, and exact `contribution === startingStack`.
    - Bot is not in `showdown.winners`.
    - Zero payout (`Number(handSettlement.payouts?.[botUserId] ?? 0) <= 0`). Uncalled bet returns refunded to stack strictly disqualify from lost all-in.
  - **Narrow Bad-Beat Heuristic vs Pool**:
    - If showdown is heads-up (`Object.keys(showdown.handsByUserId).length === 2`) and the single winner is in `riverChangedWinnerUserIds`, emits `bad_beat`.
    - Otherwise, uniformly samples from `ALL_IN_LOSS_REACTION_KEYS` (`all_in_oh_no`, `all_in_that_hurts`, `all_in_no_way`, `all_in_come_on`, `all_in_censored`) using injected `random`.
    - `not_this_time` is NEVER emitted from settlement (reserved exclusively for fold).
  - **Fail-closed & Fallthrough**:
    - If `reactionSettings.enabled === false` or settlement state is incomplete (`isCompleteReactionSettlement(state) !== true`, `state.phase !== 'SETTLED'`), the function returns `null`.
    - If all-in accounting maps are missing, invalid, non-integer, or corrupt (`contribution > handStartStack`), the all-in branch is cleanly skipped and the classifier proceeds down the existing waterfall (`lucky`, `nice_hand`, `wow`, `congrats`/`well_played`) without altering existing generic behavior.
  - **Two Sequential Random Draws Contract**:
    - Evaluated with injected `random` without new RNG abstractions:
      - **Draw 1 (Frequency Gate)**: `samplePasses(random, 1, reactionSettings)` consumes one draw from `random`. At `frequencyPercent = 100`, every qualified all-in loss produces a candidate.
      - **Draw 2 (Selection Draw)**: If frequency passes and candidate is an ordinary all-in loser (or multiway reversal), `sampleAllInLossReactionKey(random)` consumes the next draw from `random` for uniform selection across `ALL_IN_LOSS_REACTION_KEYS`:
        - `[0.0, 0.2)` → `all_in_oh_no`
        - `[0.2, 0.4)` → `all_in_that_hurts`
        - `[0.4, 0.6)` → `all_in_no_way`
        - `[0.6, 0.8)` → `all_in_come_on`
        - `[0.8, 1.0)` → `all_in_censored`
      - For `bad_beat` (heads-up river reversal), only Draw 1 is consumed because the reaction key is fixed (`bad_beat`).
  - **Targeting**: Neither `bad_beat` nor any of the 5 all-in loss pool reactions set `targetSeatNo`. Client targeting remains exclusively reserved for `nice_hand`.
  - **Priority**:
    1. Fold win (`i_was_bluffing` / `nice_bluff`)
    2. Lost all-in / bad beat (`bad_beat` / `ALL_IN_LOSS_REACTION_KEYS`)
    3. Lucky win (`lucky`)
    4. Strong winning hand (`nice_hand`)
    5. Large pot win (`wow`)
    6. Generic win (`congrats` / `well_played`)

---

## 3. Server Reaction Keys & Client Catalog Contract

### Server Allowlist (`ws-server/poker/handlers/reaction.mjs`)
The server does NOT have a `REACTION_CATALOG`. The server maintains:
- `REACTION_KEYS`: extended with the 5 new bot-only keys, automatically populating `REACTION_KEY_SET = new Set(REACTION_KEYS)`;
- `HUMAN_REACTION_KEYS`: strictly unchanged (the 5 new keys are NOT added here, ensuring human `reaction_send` rejects them).

### WebSocket Wire Contract: `table_reaction`
Zero WebSocket message-type / payload-shape changes. The outgoing WebSocket event remains the authoritative `table_reaction` payload, while the semantic `reactionKey` vocabulary expands by five bot-only keys (documented in `docs/ws-poker-protocol.md`):

```json
{
  "type": "table_reaction",
  "payload": {
    "seatNo": 2,
    "reactionKey": "all_in_that_hurts"
  }
}
```

- `seatNo`: Integer, positive seat number of the speaking bot.
- `reactionKey`: String, matching one of the 5 new keys or existing keys.
- `targetSeatNo`: Omitted for all-in loss reactions and `bad_beat`.

### Extended Catalog Entries in Client `REACTION_CATALOG` (`poker/poker-v2.js`)

```javascript
// Additions to REACTION_CATALOG in poker/poker-v2.js:
{ key: 'all_in_oh_no', emoji: '😞', label: 'Oh no...', humanSelectable: false },
{ key: 'all_in_that_hurts', emoji: '😣', label: 'That hurts.', humanSelectable: false },
{ key: 'all_in_no_way', emoji: '😠', label: 'No way...', humanSelectable: false },
{ key: 'all_in_come_on', emoji: '😤', label: 'Come on!', humanSelectable: false },
{ key: 'all_in_censored', emoji: '🤬', label: '******!', humanSelectable: false }
```

### Avatar Motion Mapping (`poker/poker-v2.js`)

All five new keys map to the existing `shake` motion in the existing helper `resolveBotAvatarReactionMotion` (extended directly without creating aliases or secondary helpers):
- `all_in_oh_no` → `'shake'`
- `all_in_that_hurts` → `'shake'`
- `all_in_no_way` → `'shake'`
- `all_in_come_on` → `'shake'`
- `all_in_censored` → `'shake'`

### Breaking Impact
Zero WebSocket message-type / payload-shape changes (`table_reaction` payload `{ seatNo, reactionKey }` remains identical); semantic `reactionKey` vocabulary expands by five bot-only keys. Human reaction UI and options remain completely unchanged. Documented in `docs/ws-poker-protocol.md`.
