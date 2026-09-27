# Contract: Poker Bot Avatar Reaction Motion (V1)

**Feature Branch**: `796-poker-bot-avatar-reactions`
**Date**: 2026-09-27
**Spec**: [spec.md](../spec.md)

---

## 1. Client Helper Signatures (`poker/poker-v2.js`)

The feature defines two browser-scoped helper functions within `poker/poker-v2.js`:

### `resolveBotAvatarReactionMotion`

```typescript
function resolveBotAvatarReactionMotion(reactionKey: string): 'bounce' | 'tilt' | 'shake' | null
```

- **Input**: `reactionKey` (string matching an entry in `REACTION_CATALOG`).
- **Output**: Motion type name or `null` if the reaction key does not warrant motion.
- **Contract**: Pure, deterministic, no side effects, no persistent state.

### `triggerBotAvatarReaction`

```typescript
function triggerBotAvatarReaction(seatNo: number, reactionKey: string, senderIsBot: boolean): void
```

- **Parameters**:
  - `seatNo`: integer representing seat number (≥ 1).
  - `reactionKey`: string matching a reaction catalog entry.
  - `senderIsBot`: boolean flag computed by caller (`senderSeat && senderSeat.isBot === true`).
- **Internal Guards (Fail-Closed)**:
  - If `senderIsBot !== true`, return immediately (human safety contract).
  - If `!socialPreferences.botReactionsEnabled`, return immediately.
  - If `!Number.isInteger(seatNo)` or `seatNo < 1`, return immediately.
  - If `resolveBotAvatarReactionMotion(reactionKey)` returns `null`, return immediately.
  - If `renderedSeatAvatars[seatNo]` does not exist or has no `classList`, return immediately.
- **Execution Order in `handleTableReaction(event)`**:
  - `renderSeats()` completely empties `els.seatLayer.innerHTML` and reinstantiates `renderedSeatAvatars`. Therefore, whenever `renderSeats()` is invoked by `handleTableReaction`, `triggerBotAvatarReaction` MUST be called **after** `renderSeats()` completes, ensuring the motion class is attached to the newly created, live avatar DOM element.
  - **Branch: `reactionBubblesEnabled === false`**: When the user has disabled reaction bubbles, the handler skips bubble creation and does not call `renderSeats()`. In this branch, `triggerBotAvatarReaction(seatNo, reactionKey, senderIsBot)` is called directly on the existing `renderedSeatAvatars[seatNo]` before returning.
  - **Branch: Targeted reaction (`nice_hand`)**: Sets targeted reaction effect, calls `renderSeats()`, then immediately calls `triggerBotAvatarReaction(seatNo, reactionKey, senderIsBot)` and returns.
  - **Branch: Regular reaction bubble**: Sets regular bubble, calls `renderSeats()`, then immediately calls `triggerBotAvatarReaction(seatNo, reactionKey, senderIsBot)`.
- **Behavior**:
  - Cancels any existing timeout for `seatNo` via `clearBotAvatarReaction(seatNo)`.
  - Attaches the specific CSS motion modifier (`.poker-seat-avatar--react-{motion}`).
  - Sets a tracked timer (`botAvatarReactionTimersBySeatNo[seatNo]`) to remove the class after 450 ms and clean up state.
  - If an unrelated table re-render runs `renderSeats()` during the animation, `clearBotAvatarReaction(seatNo)` or safe node validation prevents manipulating detached DOM nodes.

---

## 2. CSS Animation Contract (`poker/poker-v2.css`)

All animation classes attach strictly to `.poker-seat-avatar` without modifying seat positioning or surrounding elements.

```css
.poker-seat-avatar--react-bounce{animation:poker-avatar-bounce 450ms cubic-bezier(0.2,0.8,0.2,1);}
.poker-seat-avatar--react-tilt{animation:poker-avatar-tilt 450ms ease-in-out;}
.poker-seat-avatar--react-shake{animation:poker-avatar-shake 450ms ease-in-out;}
```

### Constraints:
- **No Layout Shift**: Only `transform` (`translateY`, `translateX`, `rotate`, `scale`) is manipulated. `width`, `height`, `margin`, `padding`, and `border` remain untouched.
- **One selector per line**: Strictly follows repo CSS conventions.
- **Reduced Motion**: Under `@media (prefers-reduced-motion: reduce)`, all three classes specify `animation: none !important`.

---

## 3. WebSocket Consumer Contract (Reused Unchanged)

The browser continues consuming the existing, unmodified server frame:

```json
{
  "version": "1.0",
  "type": "table_reaction",
  "payload": {
    "seatNo": 2,
    "reactionKey": "wow"
  }
}
```

- **Behavior**: Received via `poker-ws-client.js -> onReaction` and processed by `handleTableReaction(event)` in `poker/poker-v2.js`.
- **Zero Protocol Changes**: No new fields, frame types, or WS server changes.

---

## 4. Mandatory Project Rules & Notes

- **Deep review**: Perform deep review of `poker/poker-v2.js` and `poker/poker-v2.css` before writing code.
- **Maximum simplicity**: Smallest possible diff; no animation frameworks.
- **Reuse existing**: Reuses `renderedSeatAvatars[seatNo]` and `handleTableReaction`.
- **Zero breaking impact**: Strictly cosmetic passenger.
- **JSP compatibility**: Plain JS IIFE; no imports or modules.
- **CSS style**: One selector per line, declarations inline.
- **Refactor before presenting**: Clean, concise diff.
- **CSP compliance**: No inline scripts.
- **Logging**: Use `klog(...)`; never `console.log(...)`.
- **Fundamental tests only**: No UI, layout, or glue tests.
