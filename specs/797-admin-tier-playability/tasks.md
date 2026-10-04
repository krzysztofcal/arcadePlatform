# Tasks: Admin tier playability

## Setup and design
- [x] T001 Read live #1038/main and instructions; create spec, plan, research, contracts and constitution check.

## Shared gate (US1/US2)
- [x] T002 Extend `shared/poker-domain/bot-access.behavior.test.mjs` and progression tests for full/sparse activation, missing/stale evidence, exact pools, bankroll thresholds and uncapped highest active tier.
- [x] T003 Implement batched snapshot reader/activation in `bot-access.mjs`; remove ENV resolver and replace progression/access with snapshot-driven availability in `poker-progression.mjs`.

## Authoritative admission (US1)
- [x] T004 Extend existing JOIN/Create/Quick Seat/endpoint fundamental suites, including financed rejoin and fail-closed activation.
- [x] T005 Reuse snapshot in `join.mjs::resolveJoinAccess`; check manual Create activation; propagate snapshot into Quick Seat access, keep preflight/progression agreement.

## Existing cache and funding (US2)
- [x] T006 Extend table-manager funding snapshot tests for canonical 1000 with no existing table and live refresh/expiry; preserve exact-tier/class funding and Admin audit/provision tests.
- [x] T007 Delegate WS funding reader to shared snapshot, preserving existing refresh path; deny missing-schema funding fallback.

## Handoff
- [x] T008 Replace deployment ENV instructions and document breaking impacts.
- [x] T009 Run targeted fundamental tests and required CI; review whole diff, simplify and record all departures from #1038.
- [x] T010 Create draft PR/Netlify Preview; exact-SHA WS Preview deploy, verify metadata and focused Stage smoke through existing Admin live toggle; Stage rollout target only. No Production change/deploy/merge.

Evidence and departures: [review.md](review.md). Production rollout intentionally remains pending separate authorization.

## P1 review correction
- [x] T011 Reproduce legacy [100,500] ENV blocking Enabled 1000 in existing reader/JOIN fundamental suites.
- [x] T012 Make catalog canonical-only; remove obsolete ENV parsing/dead validation and deployment instruction.
- [x] T013 Run targeted fundamental tests under legacy ENV, full suite and re-review the whole diff against #1038.
- [x] T014 Record new exact-SHA WS Preview deploy, narrow regression smoke and required CI; update existing draft PR only.
