# Tasks: Poker cinematic celebrations

## Foundation

- [x] T001 Reconcile current main and issue #795, record spec/plan/research/data/contracts/quickstart and Constitution Check in `specs/795-poker-celebrations/`.

## US1 — Royal first

- [x] T002 [US1] Add scoped overlay and private Royal Flush presentation plus gated touch Preview FX controls in `poker/table-v2.html`, `poker/poker-v2.js`, `poker/poker-v2.css`; inspect mobile stacking.

## US2 — Preferences and remaining previews

- [x] T003 [US2] Extend existing settings and isolated guest persistence; immediate OFF/reduced-motion cleanup; implement pot and streak previews in the same three poker files.

## US3 — Live effects

- [x] T004 [US3] Add critical deterministic classification/dedupe/deadline tests in `tests/poker-settlement-presentation.unit.test.mjs`; implement live hooks and lifecycle cleanup in `poker/poker-v2.js`, preserving reveal/transport unchanged.

## Validation and delivery

- [x] T005 Run relevant existing tests/checks; inspect actual PR browser deploy; document timings, preview gates, persistence, limitations and pending owner smoke in `specs/795-poker-celebrations/quickstart.md`.
- [x] T006 Review scoped diff; publish one draft PR linked to #795 and actual Netlify preview, Android instructions and breaking-impact disclosure.

Implementation/handoff complete; physical Android, final artistic acceptance and rare natural live-trigger acceptance remain owner checks, not claims of completed smoke. See quickstart evidence.

Dependencies: T001 → T002 → T003 → T004 → T005 → T006. Shared files require sequential implementation; independent read-only review/checks can run in parallel. Royal is visual baseline; continue through remaining variants within this issue.

## V2 delta (v1 tasks above remain complete)

- [x] V2-01 Verify exact v1 baseline and update existing Spec Kit; Constitution Check.
- [x] V2-02 Own-win viewport-centered responsive bumper, same overlay/art.
- [x] V2-03 Viewer-prioritized classification and compact real-avatar presentation.
- [x] V2-04 Preserve Winner lifecycle/deadlines and decorative-only exit.
- [x] V2-05 Both touch preview modes; fundamental checks and browser inspection.
- [x] V2-06 Update draft PR #1016; matching new SHA deploy and owner Android handoff.

V2-02/V2-05 browser implementation/inspection complete; physical Android portrait/landscape and natural rare triggers remain explicitly pending owner acceptance.

## V3 delta (continues the existing PR; do not redo T001–T006 or V2-01–V2-06)

- [x] V3-01 Update existing Spec Kit and reconcile v3 against PR #1016 HEAD `36929e216d3919266a20fe29310ed7bb7f0f4c1d`; preserve approved v2 variants, preferences, previews and game flow.
- [x] V3-02 Complete both FX variants in about 2000 ms total (1600 ms hero + 400 ms exit); remove routine hand/reveal/turn/action interruption and dim rather than hide on resumed gameplay.
- [x] V3-03 Pass exact verified same-suit Royal cards through selection and renderer; suppress live cards when proof is unavailable; keep synthetic cards preview-only.
- [x] V3-04 Pass the selected user's exact summed main/side awards to both Monster Pot variants; exclude returns and display localized `WIN {amount} CH`, including all-folded main awards and split shares.
- [x] V3-05 Implement exact-once page-local Win Streak ×5/×6/×7… from complete newly observed outcomes for each `tableId + userId`; reset on reconnect/resync/reload/rejoin/table/identity change or uncertain sequence; keep demo counts synthetic.
- [x] V3-06 Resolve the v2 CI failure: scope browser preparation to the requested browser, make the existing UI test wait only for DOM readiness, rerun Playwright and relevant checks, and record the actual root cause/evidence.
- [x] V3-07 Update this Spec Kit, existing draft PR description and quickstart evidence; verify matching PR Deploy and report pending owner Android smoke.

Rules for V3-05: main/side award recipients win (every split recipient counts); eligible non-recipients and folded seats lose; sit-outs have no result; a return-only payout is not a win. Any incomplete/out-of-order result clears counts. No persisted history, backend changes or replayed initial settlement.

## V4 delta — continue the same draft PR; do not rebuild v1–v3

- [x] V4-01 Update existing Spec Kit requirements, plan, contract, transient data model, tasks and validation handoff for fixed compact winner anchoring, safe loss fade and explicit preview target selection.
- [x] V4-02 In `poker/poker-v2.js` and `poker/poker-v2.css`, reposition compact FX beside the same `userId + seatNo` on existing layout/render updates through the decorative tail; clear on identity/seat replacement; fade and clean up promptly on temporary unsafe placement without exceeding the original lifetime.
- [x] V4-03 Extend the existing PR-only preview panel to select an exact currently visible nonlocal player/bot for all three compact demos; preserve a still-valid selection and fail safely without fallback when it goes stale. Keep the large demo and build gate.
- [ ] V4-04 Run existing relevant deterministic suites, Playwright, syntax/CSP and full PR CI; verify new PR Deploy/metadata and compact reflow/selection behavior; update the same draft PR body and Spec Kit evidence. Report physical Android acceptance pending; do not merge or deploy Production.

V4 checks must not add a separate UI/CSS/layout/simple-glue test suite. Any fade timer is scoped to the current single overlay and bounded by its original expiration; no polling, new queue, server state or gameplay mutation.
