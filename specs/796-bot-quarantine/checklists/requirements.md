# Specification Quality Checklist: NORMAL/SLOW periodic pools

**Purpose**: Validate requirements completeness before implementation review.
**Created**: 2026-09-26
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] Focused on economic containment and player/operator outcomes; detailed methods stay in plan/contracts/tasks.
- [x] All active spec-template mandatory sections completed, with independently testable prioritized user stories.
- [x] Named fields/platform constraints in spec are explicit live #1018 requirements, not inherited #1019 architecture.
- [x] Live #1018 alone supplies feature requirements; snapshot refreshed, old source-override annotation removed.

## Requirement Completeness

- [x] No unresolved clarification or template placeholders; deterministic acceptance cases and measurable outcomes.
- [x] NORMAL/SLOW and effective-only FORCE_NORMAL are separate: threshold still persists automatic SLOW under override, Return to AUTO uses it immediately without another check, sticky table never resets. Dynamic threshold, cached settled checks and UNKNOWN payout handling specified.
- [x] Sticky marker, safe owner promotion at JOIN, 4+4 limits/shared lock, accepted human marker and rejoin specified; user-leading active and creator-leading pending indexed count-to-five access paths mandatory, with T027 local SQL/EXPLAIN evidence and no global seat/table scan.
- [x] Exact per-tier pools, isolated runtime funding, 3h refill, cross-revision bucket guard and operational scheduler specified.
- [x] Admin authorization/audit/cache propagation, WS live inventory, DB Quick Seat and managed lifecycle included.
- [x] Edge cases, accepted Sybil/split-wealth risk, breaking cutover and assumptions stated; fresh-only bootstrap separated from owner-approved existing-host install, with no automatic timer start. Required WS runtime gate separated from conditional explicitly authorized Stage MINT canary and Production GO.

## Feature Readiness

- [x] 21 FR + 6 SC mapped to 29 concrete tasks; T001–T026 are checked with local implementation/evidence, while T027–T029 remain explicit gates in dependency order.
- [x] Existing packages/flows reused; only fundamental deterministic tests, one local transaction suite. T016/T019/T020 require small extensions of the existing workflow/VPS guard files for mutation authorization, dispatch-only wake-up, no VPS DB/SQL and fresh-only installation without activation; no new framework or broad suite.
- [x] No stale sync blocker: live sync completed; T001 verifies no drift and separate implementation authority.
- [x] Constitution checked before/after design; implementation remains within the approved scope and no Stage/Production apply, real ledger MINT or deploy has been performed.

## Notes

This built-in specify checklist records documentation quality and implementation handoff evidence. [finance.md](finance.md) remains reviewer-owned; its unchecked items are review attestations, not deployment authorization. T027 and T029 remain open. No automatic merge.
