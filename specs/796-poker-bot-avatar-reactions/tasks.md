# Tasks: Poker: Bot Avatar Reactions (V1)

**Branch**: `796-poker-bot-avatar-reactions`
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Contracts**: [contracts/avatar-motion-contract.md](contracts/avatar-motion-contract.md)

---

## Phase 1: Setup (Preparation & Scaffolding)

**Purpose**: Review existing reaction structures and establish tracking state in `poker/poker-v2.js`.

- [x] T001 Initialize `botAvatarReactionTimersBySeatNo` timer tracking map in poker/poker-v2.js
- [x] T002 Implement `clearBotAvatarReaction(seatNo)` and safe timer cleanup in `renderSeats()` in poker/poker-v2.js to prevent memory leaks or manipulating detached nodes during seat re-renders

---

## Phase 2: Foundational (CSS Keyframes & Style Scaffolding)

**Purpose**: Add scoped CSS animation keyframes and modifier classes to `poker/poker-v2.css`.

**⚠️ CRITICAL**: Must be completed before wiring avatar motions.

- [x] T003 Define `@keyframes poker-avatar-bounce`, `@keyframes poker-avatar-tilt`, and `@keyframes poker-avatar-shake` in poker/poker-v2.css
- [x] T004 [P] Add scoped modifier classes `.poker-seat-avatar--react-bounce`, `.poker-seat-avatar--react-tilt`, and `.poker-seat-avatar--react-shake` in poker/poker-v2.css
- [x] T005 [P] Add reduced-motion suppression rule in `@media (prefers-reduced-motion: reduce)` in poker/poker-v2.css

---

## Phase 3: User Story 1 - Bot Avatar Reaction Motion (Priority: P1) 🎯 MVP

**Goal**: Bots execute a short, expressive avatar motion matching the emotional tone of emitted reactions.

**Independent Test**: Trigger a bot reaction on a live or preview table; verify `.poker-seat-avatar` animates with the correct motion class for ~450 ms alongside the speech bubble.

### Implementation for User Story 1
- [x] T006 [US1] Implement `resolveBotAvatarReactionMotion(reactionKey)` mapping reaction keys to `'bounce'`, `'tilt'`, or `'shake'` in poker/poker-v2.js
- [x] T007 [US1] Implement `triggerBotAvatarReaction(seatNo, reactionKey, senderIsBot)` with fail-closed guard `senderIsBot === true`, class toggle, and timer management in poker/poker-v2.js
- [x] T008 [US1] Hook `triggerBotAvatarReaction(seatNo, reactionKey, senderIsBot)` into `handleTableReaction(event)` in poker/poker-v2.js **after** `renderSeats()` (for bubbles/targeted effects) and directly within `reactionBubblesEnabled === false` branch before exiting

---

## Phase 4: User Story 2 - Human Safety & Strict Non-Human Isolation (Priority: P2)

**Goal**: Ensure automated avatar reaction animations apply exclusively to bots and never to human player avatars.

**Independent Test**: Send a reaction as a human player; verify speech bubble renders, but the human avatar remains completely still.

### Implementation for User Story 2
- [x] T009 [US2] Enforce strict fail-closed `if (senderIsBot !== true) return;` guard inside `triggerBotAvatarReaction` in poker/poker-v2.js
- [x] T010 [US2] Add fail-closed guard for missing/unconnected seat elements in `triggerBotAvatarReaction` in poker/poker-v2.js

---

## Phase 5: User Story 3 - Player Preference & Accessibility Compliance (Priority: P3)

**Goal**: Honor Table Settings toggles and reduced motion preferences; ensure zero layout shift.

**Independent Test**: Toggle "Bot reactions" OFF in Table Settings; verify avatar motion is suppressed. Toggle "Reaction bubbles" OFF while bot reactions are ON; verify avatar motion still executes without bubbles. Emulate `prefers-reduced-motion`; verify zero transform animations.

### Implementation for User Story 3
- [x] T011 [US3] Verify `socialPreferences.botReactionsEnabled` gates `triggerBotAvatarReaction`, and ensure motion triggers cleanly when `reactionBubblesEnabled === false` in poker/poker-v2.js
- [x] T012 [US3] Verify zero layout shift (CLS = 0) and responsive stability across breakpoints in poker/poker-v2.css

---

## Phase 6: Polish & Documentation

**Purpose**: Update documentation, run syntax checks, and validate via quickstart runbook.

- [x] T013 Update docs/poker-bots.md to document that bot avatar reaction motion is browser-only and ephemeral, noting that persona profiles are deferred to #804 ("Poker: Living NPCs") and missing server reaction classifiers (e.g. bad-beat) remain as open backend scope in #796
- [x] T014 [P] Run syntax check via `npm run syntax`
- [x] T015 [P] Run repository guard checks via `npm run check:all`
- [x] T016 Execute manual Deploy Preview smoke test checklist from specs/796-poker-bot-avatar-reactions/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies
- **Setup (Phase 1)**: Can start immediately.
- **Foundational (Phase 2)**: Can start in parallel with Phase 1; blocks User Story 1.
- **User Story 1 (Phase 3)**: Depends on Phase 1 and Phase 2. Delivers core MVP.
- **User Story 2 (Phase 4)**: Built into User Story 1 handler logic.
- **User Story 3 (Phase 5)**: Integrates preference and accessibility validation.
- **Polish (Phase 6)**: Final phase after implementation.

---

## Mandatory Project Rules & Notes

- **Deep review**: Perform deep review of `poker/poker-v2.js` and `poker/poker-v2.css` before writing code.
- **Maximum simplicity**: Smallest possible diff; no animation frameworks.
- **Reuse existing**: Reuses `renderedSeatAvatars[seatNo]` and `handleTableReaction`.
- **Zero breaking impact**: Strictly cosmetic passenger.
- **JSP compatibility**: Plain JS IIFE; no imports or modules.
- **CSS style**: One selector per line, declarations inline.
- **Refactor before presenting**: Clean, concise diff.
- **CSP compliance**: No inline scripts; new inline scripts require CSP SHA.
- **Logging**: Exclusively use `klog(...)`; never `console.log(...)`.
- **Fundamental tests only**: No UI, layout, or glue test suites.
