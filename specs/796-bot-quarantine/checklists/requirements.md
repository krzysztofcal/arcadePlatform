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
- [x] Exact per-tier NORMAL/SLOW pools, isolated runtime funding, hourly refill, cross-revision bucket guard and one future Supabase Cron job specified; RESTRICTED has no bankroll/refill policy and disables new bot funding only.
- [x] Admin authorization/audit/cache propagation, FORCE_RESTRICTED access, WS live inventory with minimal bot occupancy, DB Quick Seat and unchanged managed lifecycle included.
- [x] Edge cases, accepted Sybil/split-wealth risk, breaking cutover and assumptions stated; §29 explicitly replaces the old VPS/GitHub scheduler. The shared Stage migration effect is limited to an economically dark disabled control/function; the Production equivalent is prepared but unapplied. Cron activation, live VPS cleanup, bootstrap, profile/table activation and Production remain separate owner-GO actions.

## Feature Readiness

- [x] 21 FR + 7 SC map the original 29 tasks plus the additive T030–T036 manual RESTRICTED sequence plus T037 pre-merge Stage acceptance; T001–T029 remain historical evidence and T036 is the new exact-SHA WS gate.
- [x] Existing packages/flows reused; only fundamental deterministic tests, one local transaction suite. §29 extends existing workflow/VPS guards to prove the retired refill artifacts/canary are absent and the chips cleanup dispatcher/auth remains unchanged; no new framework or broad suite.
- [x] No stale sync blocker: live sync completed; T001 verifies no drift and separate implementation authority.
- [x] Constitution checked before/after design; implementation remains within the approved scope. Earlier Stage migrations are forward-only and applied. The §29 refill migration may apply automatically but leaves Stage economically dark (`enabled=false`, no pg_cron/job/MINT). The P2 Production equivalent is prepared only. Live VPS cleanup and Stage/Production Cron activation remain separately gated.

## Notes

This built-in specify checklist records documentation quality and implementation handoff evidence. [finance.md](finance.md) remains reviewer-owned; its unchecked items are review attestations, not deployment authorization. This checklist describes requirement quality. The §29 implementation/handoff tasks T093–T099 supersede older scheduler/checklist text. No automatic merge.

## Manual RESTRICTED amendment

- [x] `FORCE_RESTRICTED` is Admin-only effective state; automatic normalization remains NORMAL/SLOW and threshold evidence remains durable under the override.
- [x] Fresh restricted admission is ordinary, bot-free STANDARD-only with zero new bot funding; financed rejoin, settlement, leave and cash-out remain legal.
- [x] Existing lobby/Quick Seat paths use minimal bot occupancy compatibility; CONTINUOUS_BOT remains NORMAL and is not a fresh restricted target.
- [x] Applied migration `20260927100000...` is immutable; `20260927110000_poker_force_restricted.sql` is the only forward-only schema extension and is in the exhaustive manifest as `needs-production-equivalent`.
- [ ] Historical T036/T037 runtime and Stage acceptance evidence remains recorded. §29 is DB-only and adds no WS runtime change; its Cron, live VPS cleanup, Production and merge gates remain separate.
