# #1092 — Poker V2 UX: Animated Spectator Join Introduction

**Source**: GitHub Issue [#1092](https://github.com/krzysztofcal/arcadePlatform/issues/1092)  
**Baseline**: main (`d45756dc`)  
**Status**: Implementation planned and ready

---

## 🎯 Goal

When an authenticated user opens an active poker table as a spectator and has confirmed eligibility to join, clearly draw their attention to the Join action with a prominent, luxury casino-styled **JOIN TABLE** call-to-action and reassuring helper copy (**"Join to play · Or keep watching"**), then smoothly animate and fly the button into the permanent `#pokerV2JoinBtn` slot in the top-right rail, without auto-joining, blocking watch mode, or recurring on snapshots or reconnects.

---

## 📋 Requirements & Acceptance Criteria

### Functional Requirements
- **FR-001 (Eligibility Gate)**: The animated introduction triggers only when the user is:
  1. Signed in (`isSignedIn() && !isGuestMode`),
  2. Not seated at the table (`!deriveCurrentSeat()`),
  3. Actionable Join is confirmed (`canJoin === true` in `syncJoinVisibility()`),
  4. Not automatically joining (`!shouldAutoJoin`, `!autoJoinAttempted`, `!autoJoinRetryTimer`),
  5. Not resuming a seat from reconnect (`!Number.isInteger(reconnectSeatNo)`),
  6. No join operation is pending or active (`!isJoinOperationPending()`, `joinOperation.phase === 'idle'`),
  7. WebSocket is ready, authoritative snapshot applied, and reconnect gate is inactive.
- **FR-002 (Once Per Session Entry)**: The introduction plays at most once per table entry. Subsequent state snapshots, hand transitions, window resizes, and technical reconnects never replay the large introduction.
- **FR-003 (Luxury Casino CTA Presentation)**: Displays a large, premium gold CTA button (`#pokerSpectatorJoinIntroBtn`) reading **JOIN TABLE** with subtle luxury gold shimmer and wobble/pulse attention treatment inspired by daily/welcome bonus effects.
- **FR-004 (Supporting Copy)**: Accompanied by prominent, reassuring helper text: **"Join to play · Or keep watching"**, making it completely clear that spectating requires no action.
- **FR-005 (Flight Transition to Rail)**: After an introductory attention period (~1.8s), the CTA button smoothly transitions (shrinks and translates) to land precisely on the `#pokerV2JoinBtn` position in `.poker-top-right-rail`, then seamlessly resolves into the standard interactive `#pokerV2JoinBtn` with a gentle settling pulse.
- **FR-006 (Non-Intrusive Watch Mode)**: The introduction overlay has `pointer-events: none` on its container so watching the game and tapping other controls (menu, reactions, history, poker hands) is never obstructed or trapped. Spectating requires zero interaction.
- **FR-007 (Clickable Large CTA & Idempotency)**: Clicking the large CTA button triggers the exact same manual Join operation (`beginJoinOperation(buildJoinPayloadWithOptions({ autoSeat: true }), { source: 'manual' })`), instantly stops the intro, and prevents duplicate submissions.
- **FR-008 (Immediate Cancellation on State Change)**: If join eligibility is lost at any point during the intro (e.g., table closes, seats fill up, user becomes seated, socket disconnects, or join starts), the introduction is immediately aborted and removed from view.
- **FR-009 (Accessibility & Reduced Motion)**: When `prefers-reduced-motion` is active, the wobble and flight animations are completely omitted, rendering the normal static `#pokerV2JoinBtn` immediately.
- **FR-010 (Responsive Geometry & Rail Stability)**: Coordinates for the flight are dynamically computed relative to `#pokerV2JoinBtn` across 390×844, 320×568, 844×390, and 568×320 viewports. The layout slot for `#pokerV2JoinBtn` is preserved during the intro to prevent layout shift of adjacent rail buttons.

---

## 🚫 Operational Boundaries

- **Zero backend/WS/DB changes**: No changes to WebSocket server, Netlify functions, database schemas, migrations, or game rules.
- **No external dependencies**: Zero new libraries, SVG assets, or animation frameworks.
- **Preserve companion features**: Does not displace or obstruct Gift Shop, Reactions, Reaction History, or Poker Hands (#1093).
- **No production deployment or merge**: Branch development leading to Draft PR for owner approval.
