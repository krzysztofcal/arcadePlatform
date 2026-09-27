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
function triggerBotAvatarReaction(seatNo: number, reactionKey: string): void
```

- **Preconditions**:
  - `seatNo` must be an integer ≥ 1.
  - Calling context must have verified `senderIsBot === true`.
  - `renderedSeatAvatars[seatNo]` must exist and be connected to the DOM.
  - `socialPreferences.botReactionsEnabled` must be `true`.
- **Behavior**:
  - Clears any existing timeout and motion classes on `renderedSeatAvatars[seatNo]`.
  - Adds the class modifier corresponding to `resolveBotAvatarReactionMotion(reactionKey)`.
  - Sets a single timeout to remove the class after 450 ms and clear tracking state.
- **Fail-Closed**: If `renderedSeatAvatars[seatNo]` does not exist, exits silently.

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
