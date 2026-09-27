# Contract: Settlement Reactions (Backend #796)

**Feature Branch**: `796-poker-bot-bad-beat-reactions`
**Date**: 2026-09-27
**Spec**: [spec.md](../spec.md) | **Plan**: [plan.md](../plan.md)

---

## 1. Context Builder Contract (`ws-server/server.mjs`)

### Function: `buildDetachedReactionContext(state)`

Takes the live internal poker state and generates an immutable, detached snapshot specifically for reaction classifiers.

- **Preconditions**:
  - `state` is a valid internal poker state object.
- **Postconditions**:
  - Returned object is frozen (`Object.freeze`).
  - Contains `handStartStacksByUserId` as a frozen map of user IDs to integer chip amounts.
  - Contains `contributionsByUserId` as a frozen map of user IDs to integer chip amounts.
  - Does NOT mutate `state`.
  - Is NOT broadcast over WebSocket or exposed to clients.

```javascript
// Excerpt of expected signature:
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
      "targetSeatNo": 4,
      "reactionKey": "bad_beat",
      "handId": "hand_abc"
    }
    ```
- **Invariants**:
  - **Deterministic selection**: Bots are sorted in ascending `seatNo` order. When multiple bots qualify, the first eligible bot is selected.
  - **Single emission**: Returns at most one candidate per call.
  - **Fail-closed**: If `reactionSettings.enabled === false`, `state.phase !== 'SETTLED'`, or state is incomplete, returns `null`.
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
    "targetSeatNo": 4,
    "reactionKey": "bad_beat"
  }
}
```

- `seatNo`: Integer, positive seat number of the speaking bot.
- `reactionKey`: String, matching existing `REACTION_KEYS` (`"bad_beat"` or `"not_this_time"`).
- `targetSeatNo`: Optional integer, seat number of the recipient (included for `bad_beat` targeting the winning player; omitted for `not_this_time`).
