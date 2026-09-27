# Research: Poker: Bot Avatar Reactions (V1)

**Feature Branch**: `796-poker-bot-avatar-reactions`
**Date**: 2026-09-27
**Spec**: [spec.md](spec.md)

---

## 1. Baseline Reconciliation Against Current `main`

A detailed inspection of the live GitHub `main` branch reveals that significant parts of issue #796 were already delivered in prior poker updates:
- **Server Reactions**: `ws-server/poker/handlers/reaction.mjs` already evaluates contextual bot reactions on raises (`classifyRaiseReaction`), folds, showdown settlements (`classifySettlementReaction`), and ambient chat (`classifyAmbientReaction`).
- **Protocol**: The `table_reaction` WebSocket message format `{ seatNo, reactionKey, targetSeatNo? }` is already implemented and broadcast to clients.
- **Client Processing**: `poker/poker-ws-client.js` receives `table_reaction` and calls `onReaction()`, which dispatches to `handleTableReaction(event)` in `poker/poker-v2.js`.
- **UI Elements**: `poker/poker-v2.js` already renders floating speech bubbles (`.poker-seat-reaction-bubble`) and records reactions in history.
- **Preferences**: `socialPreferences.botReactionsEnabled` and `socialPreferences.reactionBubblesEnabled` already exist in Table Settings.
- **Bot Identity**: `renderedSeatAvatars[seatNo]` already references the avatar DOM node of each active seat.

**Conclusion**: Zero server, protocol, database, or network changes are required for V1. The remaining delta is exclusively client-side: giving the bot's avatar physical motion when it reacts.

---

## 2. Technical Decisions

### Decision 1: Motion Mapping Taxonomy (3 Simple Motion Types)

- **Decision**: Map all existing reaction keys to three lightweight CSS transform motions:
  1. `bounce` (positive / celebratory / confident):
     Keys: `hello`, `nice_hand`, `well_played`, `haha`, `wow`, `good_luck`, `thanks`, `cheers`, `gg`, `congrats`, `i_was_bluffing`.
     Motion: Gentle vertical spring pop (`translateY(-6px) scale(1.04)`).
  2. `tilt` (teasing / playful / contemplative):
     Keys: `nice_bluff`, `you_are_bluffing`, `lucky`, `thinking`, `ambient_*`.
     Motion: Subtle rotational wobble (`rotate(-6deg)` then `rotate(4deg)`).
  3. `shake` (frustrated / negative / impatient):
     Keys: `bad_beat`, `hurry_up`, `not_this_time`.
     Motion: Quick horizontal quiver (`translateX(-4px)` then `translateX(4px)`).
- **Rationale**: Keeps implementation trivial, avoids building a generic animation framework, and covers all emotional tones with high fidelity.
- **Alternatives Considered**:
  - *Full character sprite animation*: Rejected as disproportionate; avatars are static WebP images.
  - *Per-personality custom motions*: Deferred to future identity work; simple motion mapping delivers immediate delight with minimal code.

---

### Decision 2: DOM & Helper Architecture in `poker/poker-v2.js`

- **Decision**: Implement two concise helper functions inside the existing `poker/poker-v2.js` IIFE:
  - `resolveBotAvatarReactionMotion(reactionKey)`: Pure lookup function returning `'bounce'`, `'tilt'`, `'shake'`, or `null`.
  - `triggerBotAvatarReaction(seatNo, reactionKey)`:
    - Verifies avatar element exists in `renderedSeatAvatars[seatNo]`.
    - Cancels any existing animation timeout for `seatNo`.
    - Clears previous motion classes: `.poker-seat-avatar--react-bounce`, `--react-tilt`, `--react-shake`.
    - Forces reflow (void `el.offsetWidth`) and applies the new class.
    - Sets a single timeout (e.g. 500 ms) to remove the class and clear tracking state.
- **Rationale**: Zero timer accumulation, no memory leaks, resilient to node recycling, completely isolated from reaction bubbles and history.

---

### Decision 3: CSS Scoping and Layout Safety in `poker/poker-v2.css`

- **Decision**: Define animation keyframes and modifier classes strictly on `.poker-seat-avatar`:
  - Uses CSS `transform` only (GPU-accelerated, zero reflow, zero Cumulative Layout Shift).
  - Uses fixed duration: 450 ms with `cubic-bezier(0.2, 0.8, 0.2, 1)`.
  - Formatted with exactly one selector per line per repository rules.
  - Disables animations under `@media (prefers-reduced-motion: reduce)`.
- **Rationale**: Respects repository styling constraints and ensures zero layout shift across all responsive breakpoints.

---

### Decision 4: Human Safety Contract

- **Decision**: Hard check `if (senderIsBot !== true) return;` inside `triggerBotAvatarReaction`.
- **Rationale**: Human players must never have their avatars animated automatically. Player reactions only show the chosen reaction bubble.

---

### Decision 5: Testing & Deployment Policy

- **Decision**:
  - No new unit, UI, or CSS test suites (Constitution Principle V: strictly fundamental tests; presentation/glue code is excluded).
  - Verification relies on manual Netlify Deploy Preview smoke across desktop, narrow mobile, and reduced-motion environments.
  - No WS Preview Deploy required because no WS server, protocol, or shared dependencies are touched.

---

## 3. Breaking Impact Assessment

- **Expected breaking impact**: None.
- **DB / Stage mutation**: None.
- **Production mutation**: None.
- **WS protocol change**: None.
- **Economy / accounting impact**: None.
- **Gameplay impact**: None.

---

## 4. Mandatory Project Rules & Notes

- **Deep review**: Inspect `poker/poker-v2.js` and `poker/poker-v2.css` before writing code.
- **Maximum simplicity**: Smallest possible diff; no animation libraries.
- **Existing mechanisms**: Reuses `renderedSeatAvatars[seatNo]` and `handleTableReaction`.
- **Zero breaking impact**: Strictly cosmetic passenger.
- **JSP compatibility**: Vanilla JS IIFE only.
- **CSS style**: One selector per line, declarations inline.
- **Refactor before presenting**: Clean, concise diff.
- **CSP compliance**: No inline scripts.
- **Logging**: Use `klog(...)`; never `console.log(...)`.
- **Fundamental tests only**: No UI, layout, or glue tests.
