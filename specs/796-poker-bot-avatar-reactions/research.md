# Research: Poker: Bot Avatar Reactions (V1)

**Feature Branch**: `796-poker-bot-avatar-reactions`
**Date**: 2026-09-27
**Spec**: [spec.md](spec.md)

---

## 1. Baseline Reconciliation Against Current `main` & Issue #796 Scope

A detailed inspection of the live GitHub `main` branch reveals that significant parts of issue #796 were already delivered in prior poker updates, while certain broader elements remain intentionally deferred:

### What already exists on `main`:
- **Server Reactions**: `ws-server/poker/handlers/reaction.mjs` already evaluates contextual bot reactions on raises (`classifyRaiseReaction`), folds, showdown settlements (`classifySettlementReaction`), and ambient chat (`classifyAmbientReaction`).
- **Protocol**: The `table_reaction` WebSocket message format `{ seatNo, reactionKey, targetSeatNo? }` is already implemented and broadcast to clients.
- **Client Processing**: `poker/poker-ws-client.js` receives `table_reaction` and calls `onReaction()`, which dispatches to `handleTableReaction(event)` in `poker/poker-v2.js`.
- **UI Elements**: `poker/poker-v2.js` already renders floating speech bubbles (`.poker-seat-reaction-bubble`) and records reactions in history.
- **Preferences**: `socialPreferences.botReactionsEnabled` and `socialPreferences.reactionBubblesEnabled` already exist in Table Settings.
- **Bot Identity**: `renderedSeatAvatars[seatNo]` already references the avatar DOM node of each active seat.

### What is deferred from the broader issue #796:
1. **Personality-Specific Reactions (Cowboy, Professor, Robot, Shark)**:
   - Issue #796 proposed that different personas would react differently.
   - Current repository architecture strictly separates backend play style (`bot_profile`) from presentation personas.
   - Distinct personality-based reactions and emote weighting are deferred to **Issue #804 ("Poker: Living NPCs")**, which governs NPC identities and personality models.
2. **Missing Server-Side Reaction Classifiers (`bad_beat` / Losing All-In)**:
   - While `bad_beat` exists in the reaction catalog and client reaction keys, `ws-server/poker/handlers/reaction.mjs` currently lacks an automated classifier emitting it when a bot suffers a bad beat or loses an all-in confrontation.
   - This missing server-side classifier remains as open backend scope directly in issue #796 to be resolved in a subsequent backend increment.
   - V1 in PR #1020 intentionally bounds itself to browser-only cosmetic avatar reaction motion, ensuring zero WS runtime or deployment risk, and explicitly does NOT close #796.

**Conclusion for V1**: Scope for #796 in PR #1020 delivers the client avatar motion foundation, providing immediate physical presence to all bot emotes emitted by current and future server classifiers.

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
  - *Per-personality custom motions*: Deferred to future identity work (#804); simple motion mapping delivers immediate delight with minimal code.

---

### Decision 2: DOM & Helper Architecture in `poker/poker-v2.js`

- **Decision**: Implement two concise helper functions inside the existing `poker/poker-v2.js` IIFE:
  - `resolveBotAvatarReactionMotion(reactionKey)`: Pure lookup function returning `'bounce'`, `'tilt'`, `'shake'`, or `null`.
  - `triggerBotAvatarReaction(seatNo, reactionKey, senderIsBot)`:
    - Verifies `senderIsBot === true` fail-closed (parameter explicitly passed by caller).
    - Verifies `socialPreferences.botReactionsEnabled === true`.
    - Retrieves avatar element from `renderedSeatAvatars[seatNo]`.
    - Cancels any existing animation timeout for `seatNo` via `clearBotAvatarReaction(seatNo)`.
    - Clears previous motion classes: `.poker-seat-avatar--react-bounce`, `--react-tilt`, `--react-shake`.
    - Applies the new motion class.
    - Sets a single tracked timeout (450 ms) to remove the class and clear tracking state.
- **Lifecycle & `renderSeats()` Interaction**:
  - `handleTableReaction(event)` calls `renderSeats()` to display bubbles or targeted effects. Because `renderSeats()` wipes `els.seatLayer.innerHTML = ''` and creates new avatar DOM nodes, `triggerBotAvatarReaction` MUST execute **after** `renderSeats()` has completed. This ensures the animation class is applied to the live, newly attached DOM element rather than an element about to be discarded.
  - **Handling `reactionBubblesEnabled === false`**: When the user has disabled reaction bubbles, `handleTableReaction` skips bubble creation and does not call `renderSeats()`. In this branch, `triggerBotAvatarReaction(seatNo, reactionKey, senderIsBot)` is called directly on the existing `renderedSeatAvatars[seatNo]` before returning, guaranteeing that avatar motion continues functioning when only bubbles are disabled.
- **Rationale**: Clean, single-rendering-path architecture. Zero timer accumulation, no memory leaks, resilient to node recycling, completely isolated from reaction bubbles and history.

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
