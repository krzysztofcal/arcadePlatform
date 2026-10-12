# Implementation Plan: Poker V2 UX: Animated Spectator Join Introduction (#1092)

**Source**: GitHub Issue [#1092](https://github.com/krzysztofcal/arcadePlatform/issues/1092)  
**Baseline**: main (`d45756dc`)  
**Status**: Implementation planned and verified against constitution.

---

## 🏛️ Constitution Check

- **I. Simplicity and Existing Mechanisms**: Reuses existing Poker Table V2 controls and join mechanism (`beginJoinOperation`, `buildJoinPayloadWithOptions`). Modifies `poker/table-v2.html`, `poker/poker-v2.css`, and `poker/poker-v2.js`. Zero new libraries, SVG image files, or parallel state machines.
- **II. Authoritative Runtime Boundaries**: Client presentation and attention UX only. Zero changes to WebSocket runtime (`ws-server/**`), Netlify functions, database schemas, migrations, or game engine reducers.
- **III. Fail-Closed Safety & Scope Isolation**: Strict eligibility gates (`canJoin` authoritative checks). Automatically cancels intro if table closes, seats fill, or user disconnects. Preserves Single Player (#1077) and Poker Hands (#1093) untouched.
- **IV. Platform Compatibility, Logging, and Style**:
  - CSS: Strictly one physical line per selector in `poker/poker-v2.css`.
  - JS: JSP-compatible plain JavaScript, no ES imports in browser bundle, `klog` for logging if needed.
  - CSP: No inline script additions, maintaining CSP allowlist integrity.
- **V. Fundamental Tests**:
  - Extend `tests/poker-v2-live.behavior.test.mjs` with targeted behavioral tests:
    1. Spectator join intro triggers for authenticated spectator with actionable live table.
    2. Spectator join intro does NOT trigger for seated player, unauthenticated guest, `shouldAutoJoin`, or reconnect seat resumption.
    3. Spectator join intro plays once per session entry and does not replay on subsequent snapshots or reconnects.
    4. Spectator join intro is immediately cancelled if join eligibility is lost while active.
    5. Clicking the intro CTA executes the standard manual Join operation once and clears the intro.
    6. Respects `prefers-reduced-motion` by skipping intro animation and rendering static `#pokerV2JoinBtn`.

---

## 📐 Architecture & Layout Strategy

1. **Markup (`poker/table-v2.html`)**:
   - Insert `#pokerSpectatorJoinIntro` inside `#pokerTableScreen`.
   - Card layout contains `#pokerSpectatorJoinIntroBtn` with Luxury Casino styling (`♠ JOIN TABLE`) and supporting copy paragraph (`poker-spectator-join-intro__hint`: `"Join to play · Or keep watching"`).
   - Outer wrapper has `pointer-events: none` so watch mode and table controls remain unobstructed.

2. **Styling (`poker/poker-v2.css`)**:
   - Scoped `.poker-spectator-join-intro*` and `.poker-join-btn--*` selectors formatted strictly one line per selector.
   - Luxury Casino theme: Gold gradient button, metallic border, gold glow, deep obsidian glass card backing, subtle wobble/pulse attention keyframes.
   - Rail target placeholder: `.poker-top-right-rail > #pokerV2JoinBtn.poker-join-btn--intro-target` maintains geometry in `.poker-top-right-rail` with `opacity: 0; pointer-events: none;` to avoid layout jitter on adjacent controls (Gift 🎁, Reaction 🙂, History 💬, Poker Hands 🂠).
   - Landing settle: `.poker-join-btn--settled` produces a brief, crisp highlight on `#pokerV2JoinBtn` upon arrival.
   - Reduced motion: `@media (prefers-reduced-motion: reduce)` immediately hides the intro container.

3. **Interaction & State (`poker/poker-v2.js`)**:
   - Cache elements in `selectElements()`.
   - Track session state: `spectatorJoinIntroShown`, `spectatorJoinIntroActive`, `spectatorJoinIntroPhase`, `spectatorJoinIntroTimer`.
   - Gate in `syncJoinVisibility()`: checks `canJoin && !spectatorJoinIntroShown && !shouldAutoJoin && !Number.isInteger(reconnectSeatNo) && !autoJoinAttempted && !isJoinOperationPending()`.
   - Stage 1: Attention wobble / shimmer (1800ms).
   - Stage 2: Flight transition (550ms): dynamically computes `getBoundingClientRect()` delta from intro button to `#pokerV2JoinBtn`, applies transform translate & scale.
   - Completion: hides intro container, restores `#pokerV2JoinBtn` visibility and interactivity.
   - Click handler on both `#pokerSpectatorJoinIntroBtn` and `#pokerV2JoinBtn` routes through unified `handleManualJoinClick()`, canceling intro and starting join without duplicate calls.
   - Cancellation: `cancelSpectatorJoinIntro()` immediately invoked if `canJoin` becomes false.
