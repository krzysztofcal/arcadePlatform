# Contract: Settlement Reactions (Backend #796)

**Feature Branch**: `796-poker-bot-bad-beat-reactions`
**Date**: 2026-09-27
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
      "reactionKey": "bad_beat",
      "handId": "hand_abc"
    }
    ```
- **Invariants**:
  - **Deterministic selection**: Bots are sorted in ascending `seatNo` order. When multiple bots qualify, the first eligible bot is selected.
  - **Single emission**: Returns at most one candidate per call.
  - **Fail-closed & Fallthrough**:
    - If `reactionSettings.enabled === false` or settlement state is incomplete (`isCompleteReactionSettlement(state) !== true`, `state.phase !== 'SETTLED'`), the function returns `null`.
    - If all-in accounting maps (`handStartStacksByUserId`, `contributionsByUserId`) are missing, invalid, or corrupt (`contribution > handStartStack`), the all-in branch is cleanly skipped and the classifier proceeds down the existing waterfall (`lucky`, `nice_hand`, `wow`, `congrats`/`well_played`) without altering existing generic behavior.
    - A positive payout (`Number(handSettlement.payouts?.[botUserId] ?? 0) > 0`), including uncalled bet returns, strictly disqualifies the bot from the lost all-in branch, falling through to subsequent settlement branches.
  - **Heads-Up Showdown Qualification**: `bad_beat` is evaluated only when `showdown.handsByUserId` contains exactly 2 evaluated player hands and `showdown.winners` contains exactly 1 winner. If 3 or more hands were evaluated in `showdown.handsByUserId`, the losing all-in bot falls back to `not_this_time`.
  - **Base Probability**: Evaluated with `samplePasses(random, 1, reactionSettings)`. At `frequencyPercent = 100`, every qualified all-in loss produces a candidate.
  - **Targeting**: Neither `bad_beat` nor `not_this_time` sets `targetSeatNo`. Client targeting remains exclusively reserved for `nice_hand`.
  - **Priority**:
    1. Fold win (`i_was_bluffing` / `nice_bluff`)
    2. Lost all-in / bad beat (`bad_beat` / `not_this_time`)
    3. Lucky win (`lucky`)
    4. Strong winning hand (`nice_hand`)
    5. Large pot win (`wow`)
    6. Generic win (`congrats` / `well_played`)

---

## 3. Client Broadcast Protocol Contract

The outgoing WebSocket event remains the authoritative `table_reaction` payload. **Zero protocol changes** are introduced.

### Event Name: `table_reaction`

```json
{
  "type": "table_reaction",
  "payload": {
    "seatNo": 2,
    "reactionKey": "bad_beat"
  }
}
```

- `seatNo`: Integer, positive seat number of the speaking bot.
- `reactionKey`: String, matching existing `REACTION_KEYS` (`"bad_beat"` or `"not_this_time"`).
- `targetSeatNo`: Omitted for `bad_beat` and `not_this_time`.
