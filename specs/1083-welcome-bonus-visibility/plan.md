# Implementation Plan: Poker Lobby Welcome Bonus Visibility (#1083)

**Source**: GitHub Issue [#1083](https://github.com/krzysztofcal/arcadePlatform/issues/1083)  
**Baseline**: main (`1ba99776ff427783f858e075d3474e144c3947b3`)  
**Status**: Corrective pass completed and verified against constitution.

---

## 🏛️ Constitution Check

- **I. Simplicity and Existing Mechanisms**: Reuses existing `#pokerWelcomeBonusBanner`, `#pokerWelcomeBonusClaim`, `refreshWelcomeBonusBanner()`, and `ChipsClient.fetchWelcomeBonusStatus()`. Zero new files, frameworks, endpoints, or DB changes.
- **II. Authoritative Runtime Boundaries**: No changes to WebSocket server, Netlify functions, or DB. Preserves existing client routing and account claim flow.
- **III. Fail-Closed Safety & Environment Separation**: No shared environment mutations, migrations, or production operations. Draft PR only.
- **IV. Platform Compatibility, Logging, and Style**: CSS adheres to one-line-per-selector rule in `poker/poker.css`. No console.log. Full JSP compatibility preserved. Responsive rules positioned after baseline rules in stylesheet order without `!important`.
- **V. Fundamental Tests**: In accordance with `agents.md` ("When NOT to write tests: Simple glue code"), no simple glue tests are added for trivial button redirection. Existing deterministic unit tests in `tests/poker-ui.behavior.test.mjs` remain baseline-clean.

---

## 📐 Architecture & Layout Strategy

1. **Orientation Tuning in `poker/poker.css` (Cascaded After Line ~500)**:
   - In mobile portrait (`@media(max-width:600px)`): tune banner margins (`margin: 8px 20px; padding: 10px 14px;`) to reduce vertical pressure on carousel and shortcuts. Placed after the base `body.poker-lobby .poker-bonus-banner` rule so it overrides cleanly without `!important`.
   - In landscape (`@media(orientation:landscape) and (max-height:550px)`): enforce horizontal layout (`flex-direction: row; justify-content: space-between;`), compact padding/margins (`margin: 4px 20px; padding: 6px 14px;`), inline copy, and 44px touch target CTA button (`min-height: 44px; padding: 6px 14px; font-size: 11px; white-space: nowrap;`). This prevents the banner from expanding into a vertical stack and pushing navigation shortcuts below the fold.

2. **Claim Flow & Lifecycle**:
   - Preserves existing `welcomeBonusClaimBtn` click handler routing to `/account.html`.
   - Preserves `refreshWelcomeBonusBanner()` status updates on `chips:tx-complete`, auth change, and visibility change.

3. **Coordination with PR #1084 (Daily Bonus)**:
   - PR #1084 modifies `#dailyDialog` and adds Daily Bonus polling/claiming.
   - Issue #1083 touches only `.poker-bonus-banner` responsive rules in `poker/poker.css`.
   - Zero file overlap in HTML and JS; zero CSS conflicts. Daily Bonus shortcut in the shortcuts bar and dialog remain completely unblocked and functional.
