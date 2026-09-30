# Specification Quality Checklist: NORMAL/SLOW periodic pools with manual RESTRICTED

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
- [x] Automatic NORMAL/SLOW and effective-only FORCE_NORMAL/FORCE_RESTRICTED are separate: threshold still persists automatic SLOW under either override, Return to AUTO uses it immediately without another check, sticky table never resets, and no automatic mechanism produces RESTRICTED. Dynamic threshold, cached settled checks and UNKNOWN payout handling specified.
- [x] Sticky marker, safe owner promotion at JOIN, 4+4 limits/shared lock, accepted human marker and rejoin specified; user-leading active and creator-leading pending indexed count-to-five access paths mandatory, with T027 local SQL/EXPLAIN evidence and no global seat/table scan.
- [x] Exact per-tier NORMAL/SLOW pools, isolated runtime funding, 3h refill, cross-revision bucket guard and operational scheduler specified; RESTRICTED has no bankroll/refill policy and disables new bot funding only.
- [x] Admin authorization/audit/cache propagation, FORCE_RESTRICTED access, WS live inventory with minimal bot occupancy, DB Quick Seat and unchanged managed lifecycle included.
- [x] Edge cases, accepted Sybil/split-wealth risk, breaking cutover and assumptions stated; fresh-only bootstrap separated from owner-approved existing-host install, with no automatic timer start. Required WS/Caddy runtime gate is separated from the explicitly authorized pre-merge owner-only `poker-bot-pool-refill-canary` mode in the registered Stage workflow and Production GO; the standalone refill workflow remains the post-merge dispatcher path.

## Feature Readiness

- [x] 21 FR + 7 SC map the original 29 tasks plus the additive T030–T036 manual RESTRICTED sequence plus T037 pre-merge Stage acceptance; T001–T029 remain historical evidence and T036 is the new exact-SHA WS gate.
- [x] Existing packages/flows reused; only fundamental deterministic tests, one local transaction suite. T016/T019/T020 require small extensions of the existing workflow/VPS guard files for mutation authorization, dispatch-only wake-up, no VPS DB/SQL and fresh-only installation without activation; no new framework or broad suite.
- [x] No stale sync blocker: live sync completed; T001 verifies no drift and separate implementation authority.
- [x] Constitution checked before/after design; implementation remains within the approved scope. The original Stage migration apply completed (97→98, then 98/0; smoke PASS), and the RESTRICTED CHECK extension is forward-only and classified for a new automatic Stage Apply effect; the registered Stage workflow's owner-only refill/MINT canary is **AUTHORIZED FOR PRE-MERGE STAGE ACCEPTANCE / NOT RUN**, while the standalone dispatcher, Production operation and VPS activation remain separately gated.

## Notes

This built-in specify checklist records documentation quality and implementation handoff evidence. [finance.md](finance.md) remains reviewer-owned; its unchecked items are review attestations, not deployment authorization. T027/T028 and the original T029 evidence are complete; T030–T035 are locally implemented and T036 remains the final exact-SHA WS gate. No automatic merge.

## Manual RESTRICTED amendment

- [x] `FORCE_RESTRICTED` is Admin-only effective state; automatic normalization remains NORMAL/SLOW and threshold evidence remains durable under the override.
- [x] Fresh restricted admission is ordinary, bot-free STANDARD-only with zero new bot funding; financed rejoin, settlement, leave and cash-out remain legal.
- [x] Existing lobby/Quick Seat paths use minimal bot occupancy compatibility; CONTINUOUS_BOT remains NORMAL and is not a fresh restricted target.
- [x] Applied migration `20260927100000...` is immutable; `20260927110000_poker_force_restricted.sql` is the only forward-only schema extension and is in the exhaustive manifest as `needs-production-equivalent`.
- [ ] New exact-SHA WS Preview/runtime smoke (T036) and the pre-merge Stage acceptance refill/retest (T037) are still required after the runtime amendment, while VPS activation, Production and merge remain separate unauthorized gates.
