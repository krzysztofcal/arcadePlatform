# Poker mobile payout panel fix plan

## Metadata

- Issue: `#723` — Poker: reduce winner payout panel width on mobile
- Analyzed revision: `origin/main` at `ea48a0eeab9901c7d405e440eef426ad73928604`
- Analysis date: 2026-07-26
- Scope: responsive presentation of the completed-hand payout summary
- Delivery scope: this document only; no runtime or UI behavior is changed by the planning PR

## Current behavior and confirmed cause

The live table page `poker/table-v2.html` loads `poker/poker-v2.css` and renders the payout summary inside `.poker-center-layer`. `renderSettlementSummary()` in `poker/poker-v2.js` creates one `.poker-settlement-summary__row` for each main-pot, side-pot, or returned-chip entry.

The relevant layout is:

- `.poker-center-layer` has `width:min(86%, 350px)`;
- `.poker-settlement-summary` has `width:min(100%, 330px)`;
- the existing `@media (max-width:420px)` rule reduces the summary height and font size and changes each row to a one-column layout, but does not reduce the summary width.

Consequently, the summary remains approximately 86% of a 360 px viewport and approximately 85% of a 390 px viewport. Its centered overlay can obscure seats and table information even though the individual rows already wrap vertically.

The issue is therefore valid and remains present at the analyzed revision. The payout data, labels, settlement projection, and DOM structure do not need to change.

## Implementation approach

Implement one small CSS-only change in the existing `@media (max-width:420px)` block in `poker/poker-v2.css`:

1. Set `.poker-settlement-summary` to `width:min(72vw, 270px)` while retaining its existing mobile `max-height` and font size.
2. Keep the existing one-column row layout and left-aligned, wrapping recipient text. These rules preserve readability after narrowing the container.
3. Keep the existing desktop declaration unchanged. The new width applies only at or below 420 px.
4. Preserve the repository's one-line-per-selector CSS format.

This produces a panel of approximately 230 px at a 320 px viewport, 259 px at 360 px, 270 px at 390 px, and 270 px at 420 px. It is materially narrower than the current panel without requiring abbreviated labels or a new presentation component.

Do not change:

- `renderSettlementSummary()` or other code in `poker/poker-v2.js`;
- payout ordering, amounts, labels, translations, or recipient names;
- settlement timing, animation, seat badges, poker state, or accounting;
- `poker/table-v2.html`, JSP-compatible JavaScript, CSP, or deployment configuration;
- desktop and tablet styling above the existing 420 px breakpoint.

No CSP SHA update is required because the implementation adds no script or inline style.

## Implementation tasks

### Task 1: Narrow the mobile summary

- File: `poker/poker-v2.css`
- Selector: `.poker-settlement-summary` inside `@media (max-width:420px)`
- Change: add the bounded mobile width while preserving `max-height:132px` and `font-size:0.6rem`.
- Reuse: the existing breakpoint, overflow behavior, one-column row layout, and `overflow-wrap:anywhere`.
- Boundary conditions:
  - the panel must fit at a 320 px viewport without horizontal overflow;
  - multiple recipients and translated labels must wrap rather than be truncated;
  - a long list may scroll within the existing maximum height;
  - widths above 420 px must continue to use the current desktop/tablet rule.

### Task 2: Keep the existing presentation contract intact

- File: `tests/poker-v2-live.behavior.test.mjs`
- Existing scenario: `poker v2 renders per-pot settlement summary and seat-level award badges`
- Action: run this test unchanged to confirm that main-pot, side-pot, and returned-chip rows and their recipient content remain intact.
- Do not add JavaScript behavior solely to make the visual rule testable.

If a focused automated guard is considered necessary during implementation, extend the existing CSS-reading setup in `tests/poker-v2-live.behavior.test.mjs` with one assertion for the bounded width inside the existing mobile media query. Do not introduce a new test framework, snapshot the stylesheet, or duplicate the settlement behavior assertions.

## Verification strategy

### Automated checks

Run:

```text
node tests/poker-v2-live.behavior.test.mjs
node tests/static-html.behavior.test.mjs
git diff --check
```

These checks cover the existing settlement DOM/content contract, the static live-table assets, and formatting. They do not replace visual verification because the behavior harness does not perform browser layout.

### Deploy Preview visual smoke test

Verify the implementation on a Netlify Deploy Preview using a completed hand that displays at least Main pot, Side pot 1, and Returned:

1. At viewport widths 320, 360, 390, and 420 px, confirm the panel is centered, noticeably narrower, and does not overflow horizontally.
2. Confirm all payout amounts and recipients remain readable, including a long display name or multiple recipients.
3. Confirm a list exceeding the existing maximum height scrolls inside the panel.
4. Confirm surrounding seats and table information have materially more horizontal visibility than before.
5. At 421 px and representative desktop widths such as 768 and 1280 px, confirm the existing layout and maximum width are unchanged.
6. Check both Polish and English presentation where practical; do not shorten translations as part of this fix.

No WS Preview Deploy is required because the proposed implementation does not touch `ws-server/**`.

## Risks and breaking impact

- Breaking impact: none expected for poker state, protocol, settlement, or accounting; this is a presentation-only change.
- Narrower content can wrap onto more lines and consume more vertical space. The existing maximum height and overflow scrolling bound that effect.
- Very long names can produce taller rows. Existing `overflow-wrap:anywhere` must remain in place.
- A rule applied outside the intended media query could alter desktop presentation. Keep the override inside `@media (max-width:420px)` and verify the 421 px boundary.

## Rollback

Revert the single mobile width declaration. No data migration, server rollback, cache framework, or recovery action is involved.

## Out of scope

- payout or side-pot calculation;
- settlement and animation logic;
- label shortening or translation changes;
- seat placement or a broader mobile poker-table redesign;
- changes to JavaScript, JSP pages, CSP, WebSocket runtime, persistence, ledger, or accounting;
- a new responsive-layout abstraction or test framework.

## Acceptance mapping

- Noticeably narrower on mobile: the explicit `72vw`/`270px` bound replaces the effective 79–86% viewport width at the affected sizes.
- Important table information remains visible: the overlay releases horizontal space on both sides; visual verification covers representative mobile widths.
- Multiple entries remain readable: the existing one-column rows, wrapping recipients, bounded height, and scrolling remain unchanged.
- Desktop is unaffected: the override is scoped to the existing `max-width:420px` media query and is checked immediately above the breakpoint and at desktop widths.
