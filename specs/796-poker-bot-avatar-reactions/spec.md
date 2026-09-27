# Feature Specification: Poker: Bot Avatar Reactions (V1)

**Feature Branch**: `796-poker-bot-avatar-reactions`
**Created**: 2026-09-27
**Status**: Plan / Spec Kit (Draft)
**Input**: Issue #796 "Poker: Bot Avatar Reactions" (https://github.com/krzysztofcal/arcadePlatform/issues/796)

---

## Baseline Reconciliation & Scope Boundaries

### What Already Exists on `main`
Issue #796 is partially realized by later changes on `main`. The live repository already implements:
- Server-authoritative contextual bot reactions (`ws-server/poker/handlers/reaction.mjs`).
- Bot-only reaction keys (`you_are_bluffing`, `i_was_bluffing`, `lucky`, `congrats`, `not_this_time`, `ambient_*`).
- Trigger evaluation after raises, folds, wins, and showdown beats.
- Player greeting and ambient table chat.
- Independent cooldowns (4,000 ms) and presentation jitter (300–1,200 ms) via `createReactionTimers`.
- Existing speech/reaction bubble UI (`poker-seat-reaction-bubble`).
- Reaction history log panel (`poker-reaction-history`).
- User preference to hide bot reactions or all reaction bubbles (`socialPreferences.botReactionsEnabled`, `reactionBubblesEnabled`).

**Do not re-plan or duplicate functionality that already exists.**

### Scope V1 for Issue #796
The remaining V1 scope is deliberately **small, browser-only, and purely cosmetic**:
- Add a short, lightweight visual motion animation to the bot's avatar (`.poker-seat-avatar`) whenever that bot emits an existing `table_reaction`.
- Zero changes to the WebSocket protocol, server reaction events, classifiers, probabilities, or timing.
- Reuse the existing client pipeline: `poker-ws-client.js -> onReaction -> poker-v2.js::handleTableReaction(event)`.
- Use existing seat and avatar references: `handleTableReaction` already knows `senderIsBot`, `seatNo`, and has access to `renderedSeatAvatars[seatNo]`.

### Explicit Out of Scope
- No new reaction keys or emojis.
- No new WebSocket messages or protocol fields.
- No new server-side reaction classifiers or probability tweaks.
- No new admin controls.
- No AI or free-form generated text reactions.
- No Supabase migrations or database persistence.
- No changes to ledger, chip accounting, bot autoplay, or turn timers.
- No generic animation framework.
- No coupling between `bot_profile` (betting policy) and presentation identity (avatar/name).
- Personality-specific reaction weighting matrices (e.g. Cowboy, Professor, Robot, Shark) are deferred to a separate future identity project.

---

## User Scenarios & Testing

### User Story 1 — Bot Avatar Reaction Motion (Priority: P1) 🎯 MVP

As a poker player watching a bot react at the table, I want the bot's avatar to perform a subtle, short visual motion (such as a bounce, tilt, or shake) accompanying its existing reaction bubble, so that the bot feels more lively, expressive, and physically grounded at the table.

**Why this priority**: Core deliverable of V1. Brings physical presence to bot emotes without changing game logic.

**Independent Test**: Connect to a table with bots; observe a bot emitting a reaction; verify the bot's avatar element briefly animates alongside the reaction bubble.

**Acceptance Scenarios**:
1. **Given** a bot emits a positive or celebratory reaction (e.g. `nice_hand`, `well_played`, `haha`, `wow`, `congrats`), **When** the reaction is processed, **Then** the bot's avatar executes a short bounce/pop motion.
2. **Given** a bot emits a playful or teasing reaction (e.g. `nice_bluff`, `you_are_bluffing`, `lucky`), **When** the reaction is processed, **Then** the bot's avatar executes a subtle tilt motion.
3. **Given** a bot emits a frustrated, negative, or impatient reaction (e.g. `bad_beat`, `hurry_up`, `not_this_time`), **When** the reaction is processed, **Then** the bot's avatar executes a brief shake motion.
4. **Given** multiple consecutive reactions arrive for the same bot over time, **When** a new reaction arrives, **Then** any active animation state/timer is cleanly reset without timer accumulation or visual glitches.

---

### User Story 2 — Human Safety & Strict Non-Human Isolation (Priority: P2)

As a human poker player, I want automatic avatar animations to apply exclusively to bots, so that my own avatar never moves automatically or expresses emotions without my explicit intent.

**Why this priority**: Essential behavior contract. Human player avatars must never express involuntary emotions.

**Independent Test**: Send a human reaction via the reaction menu; verify that the reaction bubble appears over the player's seat, but the human avatar never performs an automatic reaction motion.

**Acceptance Scenarios**:
1. **Given** a seated human player sends a reaction, **When** `handleTableReaction` runs, **Then** `senderIsBot` is `false`, and no avatar reaction motion class or timer is applied to the human seat.
2. **Given** spectator view or empty seat, **When** a reaction event references an empty seat or missing avatar, **Then** the handler safely exits without errors.

---

### User Story 3 — Player Preference & Accessibility Compliance (Priority: P3)

As a player using reduced motion or preferring minimal visual effects, I want avatar reaction animations to respect `prefers-reduced-motion` and Table Settings toggles.

**Why this priority**: Ensures accessibility, performance on low-end devices, and player agency.

**Independent Test**: Enable `prefers-reduced-motion: reduce` in browser or OS; verify zero avatar reaction animations run. Toggle "Bot reactions" OFF in Table Settings; verify neither bubbles nor avatar motion trigger.

**Acceptance Scenarios**:
1. **Given** the user has `prefers-reduced-motion: reduce` enabled, **When** a bot reacts, **Then** CSS media query completely disables avatar reaction keyframe transforms.
2. **Given** the user has unchecked "Bot reactions" in Table Settings, **When** a bot reacts, **Then** `socialPreferences.botReactionsEnabled` is `false` and avatar motion is not triggered.
3. **Given** narrow mobile or desktop viewports, **When** avatar reaction motions execute, **Then** no layout shifts (CLS), seat resizing, or table overflow occur.

---

## Edge Cases

- **Rapid successive reactions**: Reset animation classes cleanly before re-applying, using a single tracking timer or animationend cleanup.
- **Seat unmounting / Table re-render**: If `renderSeats()` runs while an avatar motion is active, DOM nodes are replaced; motion state must not hold stale element references or leak timers.
- **Missing avatar element**: If `renderedSeatAvatars[seatNo]` is null or disconnected, the motion trigger fails closed silently.
- **Table navigation / page unload**: Lifecycle cleanup removes any active animation timers.

---

## Requirements

### Functional Requirements

- **FR-001**: Avatar reaction motion MUST ONLY execute when `senderIsBot === true`. Human player seats MUST NEVER receive automated avatar reaction animations.
- **FR-002**: Avatar reaction motion MUST be triggered within the existing client handler `handleTableReaction(event)` in `poker/poker-v2.js`, using the existing `renderedSeatAvatars[seatNo]` reference.
- **FR-003**: The system MUST map existing reaction keys to at most 2–3 motion types:
  - `bounce` (positive/confident): `nice_hand`, `well_played`, `haha`, `wow`, `good_luck`, `thanks`, `cheers`, `gg`, `congrats`, `hello`, `i_was_bluffing`.
  - `tilt` (teasing/playful): `nice_bluff`, `you_are_bluffing`, `lucky`, `thinking`, `ambient_*`.
  - `shake` (frustrated/negative): `bad_beat`, `hurry_up`, `not_this_time`.
- **FR-004**: Each animation MUST be short (duration ≤ 600 ms) and purely visual (using CSS `transform`), causing 0 px layout shift, 0 px change in seat dimensions, and 0 px change in avatar size.
- **FR-005**: All avatar reaction CSS classes in `poker/poker-v2.css` MUST be scoped to `.poker-seat-avatar` and formatted with exactly one selector per line, adhering to repository style.
- **FR-006**: `@media (prefers-reduced-motion: reduce)` in `poker/poker-v2.css` MUST completely disable avatar reaction animations (`animation: none !important`).
- **FR-007**: When `socialPreferences.botReactionsEnabled === false`, bot avatar reaction motions MUST NOT be triggered.
- **FR-008**: Bot avatar reaction motion MUST NOT alter poker engine state, betting turn clocks, showdown timing, pot awards, chip counts, or WebSocket communication.

---

## Key Entities

- **`BotAvatarMotionType`**: Client-side motion classification (`'bounce'`, `'tilt'`, `'shake'`).
- **`BotAvatarAnimationState`**: Lightweight per-seat tracking in `poker/poker-v2.js` storing active timer IDs for cleanup, preventing timer accumulation.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of avatar reaction animations occur on verified bot seats (`senderIsBot === true`); 0 automated avatar reaction animations occur on human seats.
- **SC-002**: Zero Cumulative Layout Shift (CLS = 0) during avatar reaction animations across desktop, tablet, and narrow mobile viewports.
- **SC-003**: Avatar reaction motion ends within 600 ms, leaving no lingering classes, styles, or orphaned timers.
- **SC-004**: When `prefers-reduced-motion: reduce` is active, 0 transform animations execute on bot avatars.
- **SC-005**: Disabling "Bot reactions" in Table Settings completely suppresses both reaction bubbles and avatar motions for bots.
- **SC-006**: Poker betting timers, chip animations, and showdown reveals proceed with 0 ms variance introduced by avatar motion.

---

## Assumptions

- Scope is strictly client-side (frontend JS and CSS only); no backend WebSocket server or Netlify Functions changes are required.
- Standard Netlify Deploy Preview is sufficient for verification; no WS Preview Deploy is required because no WS runtime/protocol files are altered.
- Testing follows the repository's fundamental-tests-only policy: no UI rendering or CSS layout test suites; verification is conducted via manual Deploy Preview smoke.

---

## Mandatory Project Rules & Notes

- **Deep review**: Perform deep code review of `poker/poker-v2.js` and `poker/poker-v2.css` before implementation.
- **Maximum simplicity**: Keep changes minimal; no generic animation engines or external libraries.
- **Existing mechanisms**: Reuse `renderedSeatAvatars`, `handleTableReaction`, and existing preference flags.
- **Zero breaking impact**: No protocol changes, no database mutations, no Stage/Production effects.
- **JSP compatibility**: Vanilla JavaScript IIFE only; no ES modules or browser imports in frontend files.
- **CSS style**: Exactly one selector per line in `poker/poker-v2.css`, no multi-line declaration blocks.
- **Refactor before presenting**: Review and refactor diff for conciseness before submitting.
- **CSP compliance**: No inline scripts; any new inline script requires CSP SHA update.
- **Logging**: Exclusively use `klog(...)`; never use `console.log(...)`.
- **Fundamental tests only**: No UI, CSS, layout, or simple glue test suites.
