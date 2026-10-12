# Implementation Plan: Poker V2 UI: Luxury Casino Poker Hands quick-reference panel (#1093)

**Source**: GitHub Issue [#1093](https://github.com/krzysztofcal/arcadePlatform/issues/1093)  
**Baseline**: main (`8f691d65`)  
**Status**: Implementation planned and verified against constitution.

---

## 🏛️ Constitution Check

- **I. Simplicity and Existing Mechanisms**: Reuses existing Poker Table V2 DOM patterns and styling conventions. Modifies `poker/table-v2.html`, `poker/poker-v2.css`, and `poker/poker-v2.js`. Zero new external libraries, images, or redundant state machines.
- **II. Authoritative Runtime Boundaries**: UI-only reference display. Zero changes to WebSocket runtime (`ws-server/**`), Netlify functions, database schemas, migrations, or game engine reducers.
- **III. Fail-Closed Safety & Scope Isolation**: Fully isolated client presentation. Leaves Single Player (#1077) and animated Join (#1092) untouched. No Stage database mutations.
- **IV. Platform Compatibility, Logging, and Style**:
  - CSS: Strictly one physical line per selector in `poker/poker-v2.css`.
  - JS: JSP-compatible plain JavaScript, no ES imports in browser bundle, `klog` for logging if needed.
  - CSP: No inline script additions, maintaining CSP allowlist integrity.
- **V. Fundamental Tests**: Static reference UI and simple toggle glue. In accordance with `agents.md` ("When NOT to write tests: UI rendering, CSS/layout, simple glue code"), verified via deterministic Playwright layout verification across key viewports rather than speculative UI test suites.

---

## 📐 Architecture & Layout Strategy

1. **Markup (`poker/table-v2.html`)**:
   - Insert `#pokerHandInfoToggle` inside `.poker-top-right-rail > .poker-top-right-reactions` after existing reaction buttons.
   - Insert non-modal `#pokerHandInfoPanel` inside `#pokerTableScreen` with accessible heading, sticky Close button (`#pokerHandInfoClose`), 10 static ranking rows with 5 example cards each, and Hold'em rules note.

2. **Styling (`poker/poker-v2.css`)**:
   - Scoped `.poker-hand-info*` selectors formatted one line per selector.
   - Luxury Casino theme: charcoal/deep midnight background, thin warm gold border (`rgba(223, 188, 110, 0.35)`), emerald accents, crisp card faces with red/black contrast.
   - Bounded geometry: `top: calc(max(8px, env(safe-area-inset-top, 0px)) + 36px + 6px)`, `right: max(8px, env(safe-area-inset-right, 0px))`, `max-height: calc(100dvh - ...)` with internal scroll and sticky header.
   - Join button clearance: Panel is placed below the top action bar so `#pokerV2JoinBtn` remains visible, accessible, and clickable at all times.

3. **Interaction (`poker/poker-v2.js`)**:
   - Cache elements in `selectElements()`.
   - Wire toggle and close handlers in `bindControls()`: toggle `hidden`, manage `aria-expanded`, focus restore to toggle on Close/Escape.
   - Global click listener closes panel when clicked outside without stopping event propagation.
   - Global Escape key listener closes panel.
   - Mutual exclusion: closing when table menu or social settings open.
