# Quickstart: Poker: Bot Avatar Reactions (V1)

**Feature Branch**: `796-poker-bot-avatar-reactions`
**Date**: 2026-09-27
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Contracts**: [contracts/avatar-motion-contract.md](contracts/avatar-motion-contract.md)

---

## Overview

This guide describes the verification procedure for V1 of Poker: Bot Avatar Reactions.
Because this feature is strictly client-side presentation (UI/CSS) and glue logic, repository policy (Arcade Constitution Principle V) dictates **no UI rendering, CSS, or layout test suites**. Verification is conducted via static checks and a manual browser Deploy Preview smoke test.

---

## 1. Automated Guard & Syntax Checks

Before previewing, verify code syntax and repository integrity:

```bash
# Verify JavaScript syntax across modified files
npm run syntax

# Run repository integrity checks (lifecycle, XP badges, game hooks)
npm run check:all
```

---

## 2. Manual Browser Deploy Preview Smoke Test

Open the Netlify Deploy Preview URL generated for the pull request and navigate to `poker/table-v2.html` (e.g. `https://deploy-preview-XXXX--kcswh.netlify.app/poker/table-v2.html`).

### Scenario 1: Bot Reaction Motion & Bubble Continuity
1. Join or observe a table with active bots.
2. Wait for a bot to emit an automatic reaction (e.g. on fold, raise, or showdown).
3. **Verify**:
   - The bot's speech bubble appears as before.
   - The bot's avatar element (`.poker-seat-avatar`) performs a short, smooth motion (`bounce`, `tilt`, or `shake`) matching the emotional tone.
   - The motion completes in ~450 ms and leaves no lingering visual artifacts.

### Scenario 2: Human Player Safety (Strict Non-Human Isolation)
1. Sit at the table as a human player.
2. Open the reaction menu and send a reaction (e.g. `hello` or `nice_hand`).
3. **Verify**:
   - The reaction bubble renders over the human seat.
   - The human avatar **DOES NOT** perform any automated motion animation.

### Scenario 3: Consecutive Reaction Reset (No Timer Accumulation)
1. Observe a bot reacting multiple times in rapid succession or across consecutive hands.
2. **Verify**:
   - The animation restarts cleanly on new reactions without jerky restarts or stuck classes.
   - Inspecting the DOM confirms `.poker-seat-avatar--react-*` is removed after animation completion.

### Scenario 4: User Preference Toggle
1. Open Table Settings (`#pokerSocialSettingsPanel`).
2. Uncheck "Bot reactions" (or "Reaction bubbles").
3. **Verify**:
   - When bots emit reactions, zero reaction bubbles and zero avatar reaction animations occur on screen.
   - Re-checking restores normal behavior.

### Scenario 5: Accessibility (`prefers-reduced-motion`)
1. In browser DevTools (Rendering tab), emulate `prefers-reduced-motion: reduce`.
2. Observe bot reactions.
3. **Verify**:
   - Reaction bubbles may display, but bot avatar motion animations are completely suppressed (`animation: none !important`).

### Scenario 6: Desktop & Responsive Mobile Layout
1. Test on standard desktop resolution (≥ 1280px).
2. Test on narrow mobile portrait resolution (~375px) and landscape (~640px).
3. **Verify**:
   - Zero layout shift (CLS = 0) occurs during avatar motion.
   - Seat dimensions and avatar sizes remain perfectly constant.

### Scenario 7: Independent Gameplay & Turn Clocks
1. Observe betting rounds while avatar animations trigger.
2. **Verify**:
   - The turn clock countdown border on the active player/bot continues seamlessly.
   - Betting actions, calls, raises, auto-folds, and chip animations are completely unaffected by avatar reactions.

---

## 3. Mandatory Project Rules & Notes

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
