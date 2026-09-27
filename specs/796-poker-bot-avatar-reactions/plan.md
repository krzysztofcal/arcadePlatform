# Implementation Plan: Poker: Bot Avatar Reactions (V1)

**Branch**: `796-poker-bot-avatar-reactions` | **Date**: 2026-09-27 | **Spec**: [spec.md](spec.md)

---

## 1. Summary & Technical Context

Add a short, purely cosmetic visual motion animation to poker bot avatars (`.poker-seat-avatar`) when bots emit existing contextual reactions.

- **Baseline Reconciliation**:
  Live `main` already includes contextual bot reaction evaluation in `ws-server/`, the `table_reaction` WebSocket message, speech bubble rendering, reaction history, and user privacy toggles. The remaining V1 scope is deliberately minimal: browser-only avatar motion.
- **Tech Stack**: Vanilla JavaScript IIFE (`poker/poker-v2.js`), scoped CSS (`poker/poker-v2.css`), Markdown documentation (`docs/poker-bots.md`).
- **Dependencies**: None. Zero external libraries, zero animation frameworks.
- **Storage**: In-memory page state only. Zero database/Supabase tables, columns, or migrations.
- **Breaking Impact**: Expected breaking impact: **None**. Zero protocol changes, zero DB/Stage mutations, zero Production effects, zero accounting/gameplay impact.
- **Deployment**: Browser-only. Standard Netlify Deploy Preview + manual smoke test. No "WS Preview Deploy" required because no WebSocket runtime, protocol, or shared dependencies are modified. *(Note: If subsequent scope changes touch WS/runtime/protocol, exact-SHA WS Preview Deploy will be required).*

---

## 2. Constitution Check

*GATE: Must pass before implementation. Re-checked post-design: PASS.*

1. **Principle I (Simplicity and Existing Mechanisms)**: PASS. Reuses existing `poker-ws-client.js -> onReaction -> poker-v2.js::handleTableReaction(event)`, `renderedSeatAvatars[seatNo]`, and `socialPreferences.botReactionsEnabled`. No duplicate logic paths, no generic animation frameworks.
2. **Principle II (Authoritative Runtime Boundaries)**: PASS. The WebSocket server remains the sole authority for game state and reaction events. The client strictly acts as a cosmetic passenger displaying ephemeral animations.
3. **Principle III (Fail-Closed Safety and Environment Separation)**: PASS. Pure presentation; no financial, accounting, or game state changes. Strict `senderIsBot === true` contract prevents automated emotions on human player avatars. Zero Stage or Production mutations.
4. **Principle IV (Platform Compatibility, Logging, Style)**: PASS. JSP-compatible vanilla JS IIFE; no browser modules or imports; `klog` used for any diagnostic logging; zero `console.log`; CSS formatted with exactly one selector per line, declarations inline.
5. **Principle V (Fundamental Tests and Concrete Plans)**: PASS. Because this V1 is purely presentation/UI/CSS, no broad UI or layout test suites are added (prohibited by Constitution V). Verification is carried out via static syntax/guard checks and manual Deploy Preview smoke.

---

## 3. Implementation Details

### A. Frontend Logic (`poker/poker-v2.js`)

Implement two lightweight helper functions inside the `poker-v2.js` closure:

1. **`resolveBotAvatarReactionMotion(reactionKey)`**:
   - Maps reaction keys to 3 motion types:
     - `'bounce'` (positive/confident): `hello`, `nice_hand`, `well_played`, `haha`, `wow`, `good_luck`, `thanks`, `cheers`, `gg`, `congrats`, `i_was_bluffing`.
     - `'tilt'` (playful/sassy/contemplative): `nice_bluff`, `you_are_bluffing`, `lucky`, `thinking`, `ambient_*`.
     - `'shake'` (negative/frustrated/impatient): `bad_beat`, `hurry_up`, `not_this_time`.
   - Returns string or `null` if unmapped.

2. **`triggerBotAvatarReaction(seatNo, reactionKey, senderIsBot)`**:
   - Checks `senderIsBot === true` fail-closed (`if (senderIsBot !== true) return;`) using value passed from caller.
   - Checks `socialPreferences.botReactionsEnabled !== false`.
   - Locates target element via `renderedSeatAvatars[seatNo]`. If absent or disconnected, returns immediately.
   - Clears existing animation timer for `seatNo` from `botAvatarReactionTimersBySeatNo[seatNo]` via `clearBotAvatarReaction(seatNo)`.
   - Removes any existing motion classes (`.poker-seat-avatar--react-bounce`, `--react-tilt`, `--react-shake`).
   - Applies the resolved motion class.
   - Sets a 450 ms timeout to strip the class and clean up the timer entry.

3. **Execution Order & Lifecycle in `handleTableReaction(event)`**:
   - `renderSeats()` completely empties `els.seatLayer.innerHTML = ''` and instantiates new avatar DOM elements. Therefore, `triggerBotAvatarReaction` MUST execute **after** `renderSeats()` finishes, binding to the live element rather than an element about to be destroyed.
   - **When `reactionBubblesEnabled === false`**: The handler skips bubble creation and does not call `renderSeats()`. In this branch, `triggerBotAvatarReaction(seatNo, reactionKey, senderIsBot)` executes directly on the existing `renderedSeatAvatars[seatNo]` node before returning, ensuring avatar motion is not suppressed when only bubbles are turned off.
   - **Targeted reactions (`nice_hand`)**: Sets targeted effect, calls `renderSeats()`, then immediately calls `triggerBotAvatarReaction(seatNo, reactionKey, senderIsBot)` and returns.
   - **Regular reaction bubbles**: Sets bubble, calls `renderSeats()`, then immediately calls `triggerBotAvatarReaction(seatNo, reactionKey, senderIsBot)`.

4. **Safety & Node Recycling in `renderSeats()`**:
   - Stale timers from preceding reactions safely validate node references or clean up without error if an unrelated table re-render occurs mid-animation.

### B. Styling & Animation (`poker/poker-v2.css`)

Add scoped keyframes and modifier classes to `poker/poker-v2.css` (formatted one selector per line):

```css
@keyframes poker-avatar-bounce{0%{transform:translateY(0) scale(1);}40%{transform:translateY(-6px) scale(1.04);}100%{transform:translateY(0) scale(1);}}
@keyframes poker-avatar-tilt{0%{transform:rotate(0deg);}30%{transform:rotate(-6deg);}70%{transform:rotate(4deg);}100%{transform:rotate(0deg);}}
@keyframes poker-avatar-shake{0%,100%{transform:translateX(0);}25%{transform:translateX(-4px);}50%{transform:translateX(4px);}75%{transform:translateX(-2px);}}
.poker-seat-avatar--react-bounce{animation:poker-avatar-bounce 450ms cubic-bezier(0.2,0.8,0.2,1);}
.poker-seat-avatar--react-tilt{animation:poker-avatar-tilt 450ms ease-in-out;}
.poker-seat-avatar--react-shake{animation:poker-avatar-shake 450ms ease-in-out;}
```

- Update `@media (prefers-reduced-motion: reduce)` block to include `.poker-seat-avatar--react-bounce, .poker-seat-avatar--react-tilt, .poker-seat-avatar--react-shake` with `animation: none !important`.
- Zero Cumulative Layout Shift (CLS): animations use only GPU `transform`.

### C. Documentation (`docs/poker-bots.md`)

Update `docs/poker-bots.md` to document:
- Avatar reaction motion is browser-only and ephemeral.
- Purely cosmetic visual enhancement triggered from authoritative `table_reaction` frames.
- Does not modify gameplay, turn clocks, auto-actions, settlement, or accounting.
- Strictly isolated to bot avatars; human avatars are never automatically animated.

---

## 4. Human Safety / Behavior Contract

- Automated avatar reaction motion applies **EXCLUSIVELY to bots**.
- Human player reactions continue to display the chosen speech bubble, but **NEVER animate the human avatar automatically**.
- If `senderIsBot !== true`, avatar reaction motion logic is completely bypassed.

---

## 5. Explicit Out of Scope & Deferred Follow-Ups

- **Deferred to Issue #804 ("Poker: Living NPCs")**: Personality-specific reaction weighting and emote behavior (e.g. Cowboy, Professor, Robot, Shark reacting differently). Current architecture keeps `bot_profile` (play style) cleanly decoupled from presentation personas; full persona models belong to #804.
- **Open Backend Scope in #796**: While `bad_beat` is already defined as a reaction key, `ws-server/poker/handlers/reaction.mjs` currently lacks an automated classifier for bad-beat or losing-all-in scenarios. This classifier remains as open backend scope in issue #796 to be addressed in a future backend increment, ensuring this V1 remains purely frontend and zero-risk for WS runtime. PR #1020 does NOT close #796.
- No new reaction keys or emojis in V1.
- No new WebSocket messages or protocol fields.
- No new server-side reaction classifiers or probability changes in V1.
- No new Admin controls.
- No AI or free-form text reactions.
- No Supabase migrations or database persistence.
- No changes to ledger, chip accounting, bot autoplay, or turn timers.
- No generic animation framework.

---

## 6. Verification Plan

1. **Static Validation**:
   - `npm run syntax` — ensure modified files parse cleanly.
   - `npm run check:all` — ensure guard scripts and lifecycle checks pass.
   - CSP review: confirm zero inline scripts added.
2. **Manual Deploy Preview Smoke** (detailed in [quickstart.md](quickstart.md)):
   - Bot reaction triggers motion + bubble simultaneously.
   - Human reaction triggers bubble only (no avatar motion).
   - Rapid reactions reset cleanly without timer leaks.
   - "Bot reactions" toggle in Table Settings suppresses motion.
   - `prefers-reduced-motion: reduce` completely disables animation.
   - Desktop and narrow mobile responsive checks confirm zero layout shift.
   - Turn clocks and betting proceed unaffected.

---

## 7. Mandatory Project Rules & Notes

- **Deep review**: Perform deep review of `poker/poker-v2.js` and `poker/poker-v2.css` before implementing.
- **Maximum simplicity**: Smallest possible diff; no animation frameworks.
- **Reuse existing**: Reuses `renderedSeatAvatars[seatNo]` and `handleTableReaction`.
- **Zero breaking impact**: Strictly cosmetic passenger.
- **JSP compatibility**: Plain JS IIFE; no imports or modules.
- **CSS style**: One selector per line, declarations inline.
- **Refactor before presenting**: Clean, concise diff.
- **CSP compliance**: No inline scripts; new inline scripts require CSP SHA.
- **Logging**: Exclusively use `klog(...)`; never `console.log(...)`.
- **Fundamental tests only**: No UI, layout, or glue test suites.
