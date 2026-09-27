# Data Model: Poker: Bot Avatar Reactions (V1)

**Feature Branch**: `796-poker-bot-avatar-reactions`
**Date**: 2026-09-27
**Spec**: [spec.md](spec.md)

---

## 1. Domain Entities & In-Memory State

This feature is entirely browser-side and ephemeral. It introduces zero database entities, schema migrations, or persistent records.

---

### `BotAvatarMotionType`

Enum of client-side animation motion styles applied to `.poker-seat-avatar`:

| Motion Type | CSS Class Modifier | Keyframe Name | Intended Tone | Example Keys |
|---|---|---|---|---|
| `'bounce'` | `.poker-seat-avatar--react-bounce` | `poker-avatar-bounce` | Positive, confident, celebratory | `nice_hand`, `well_played`, `haha`, `wow`, `congrats`, `i_was_bluffing` |
| `'tilt'` | `.poker-seat-avatar--react-tilt` | `poker-avatar-tilt` | Playful, teasing, contemplative | `nice_bluff`, `you_are_bluffing`, `lucky`, `thinking`, `ambient_*` |
| `'shake'` | `.poker-seat-avatar--react-shake` | `poker-avatar-shake` | Frustrated, impatient, negative | `bad_beat`, `hurry_up`, `not_this_time` |

---

### `BotAvatarReactionState` (Page Memory)

Tracked inside the `poker/poker-v2.js` closure:

```javascript
// Map of active animation timer handles keyed by seat number
// Cleared on animation completion, rapid re-triggering, or seat re-render
var botAvatarReactionTimersBySeatNo = {};
```

- **Lifecycle & Execution Flow**:
  1. Triggered on valid incoming `table_reaction` via `triggerBotAvatarReaction(seatNo, reactionKey, senderIsBot)`.
  2. Guard: Immediately returns if `senderIsBot !== true` or `!socialPreferences.botReactionsEnabled`.
  3. **Timing relative to `renderSeats()`**:
     - When bubbles or targeted effects are active, `handleTableReaction()` invokes `renderSeats()`, which clears `els.seatLayer.innerHTML` and rebuilds `renderedSeatAvatars`. `triggerBotAvatarReaction` is executed **after** `renderSeats()` completes, ensuring the motion class and timer are bound to the live avatar DOM element.
     - When `reactionBubblesEnabled === false`, no bubble or targeted effect is created and `renderSeats()` is skipped. `triggerBotAvatarReaction` executes directly on the existing `renderedSeatAvatars[seatNo]` without rebuilding the DOM.
  4. If an existing timer is active for `seatNo`, `clearBotAvatarReaction(seatNo)` cancels it via `window.clearTimeout`, removes previous motion classes, and resets the slot.
  5. Timeout fires after animation completion (450 ms), removes CSS class, and deletes entry from `botAvatarReactionTimersBySeatNo`.
  6. If an unrelated gameplay update triggers `renderSeats()` during in-flight animation, stale timer callbacks safely check node validity or clear active timers.

---

### Reaction Key to Motion Mapping Matrix

| Existing Reaction Key | Motion Type | CSS Animation Trigger |
|---|---|---|
| `hello` | `bounce` | `.poker-seat-avatar--react-bounce` |
| `nice_hand` | `bounce` | `.poker-seat-avatar--react-bounce` |
| `well_played` | `bounce` | `.poker-seat-avatar--react-bounce` |
| `haha` | `bounce` | `.poker-seat-avatar--react-bounce` |
| `wow` | `bounce` | `.poker-seat-avatar--react-bounce` |
| `good_luck` | `bounce` | `.poker-seat-avatar--react-bounce` |
| `thanks` | `bounce` | `.poker-seat-avatar--react-bounce` |
| `cheers` | `bounce` | `.poker-seat-avatar--react-bounce` |
| `gg` | `bounce` | `.poker-seat-avatar--react-bounce` |
| `congrats` | `bounce` | `.poker-seat-avatar--react-bounce` |
| `i_was_bluffing` | `bounce` | `.poker-seat-avatar--react-bounce` |
| `nice_bluff` | `tilt` | `.poker-seat-avatar--react-tilt` |
| `you_are_bluffing` | `tilt` | `.poker-seat-avatar--react-tilt` |
| `lucky` | `tilt` | `.poker-seat-avatar--react-tilt` |
| `thinking` | `tilt` | `.poker-seat-avatar--react-tilt` |
| `ambient_*` (all ambient chat) | `tilt` | `.poker-seat-avatar--react-tilt` |
| `bad_beat` | `shake` | `.poker-seat-avatar--react-shake` |
| `hurry_up` | `shake` | `.poker-seat-avatar--react-shake` |
| `not_this_time` | `shake` | `.poker-seat-avatar--react-shake` |

---

## 2. Mandatory Project Rules & Notes

- **Deep review**: Perform deep review before implementing.
- **Maximum simplicity**: Use lightweight dictionary lookup and CSS class toggle.
- **Reuse existing**: Reuses `renderedSeatAvatars[seatNo]` and `socialPreferences.botReactionsEnabled`.
- **Zero breaking impact**: Strictly cosmetic passenger.
- **JSP compatibility**: Plain JS IIFE; no imports or modules.
- **CSS style**: One selector per line.
- **Refactor before presenting**: Ensure clean code formatting.
- **CSP compliance**: No inline scripts.
- **Logging**: Use `klog(...)`; never `console.log(...)`.
- **Fundamental tests only**: No UI/CSS test suites.
