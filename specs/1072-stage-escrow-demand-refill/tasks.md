# Tasks: Stage escrow demand-refill identity

## Setup and foundation

- [x] T001 Verify origin/main, instructions, constitution, failed run and producer in `specs/1072-stage-escrow-demand-refill/spec.md`.
- [x] T002 Define fail-closed exception and intentional shared Stage apply risk in `specs/1072-stage-escrow-demand-refill/plan.md`.

## US1 - Safe historical escrow retirement

- [x] T003 [US1] Extend `assertEscrowAccountRetirementContracts(sql)` in `tests/chips/chips.migration.test.mjs`; reproduce P8964 before migration.
- [x] T004 [US1] Add `supabase/migrations/20261011090000_chips_stage_escrow_demand_refill_identity.sql`, changing only P8964/P8965 text dependence for fully proven live refill MINT; classify it stage-only in `supabase/production-migrations/manifest.json` and update exact inventory counts in `scripts/check-db-migrations.mjs` (existing exhaustive guard requires both).
- [x] T005 [US1] Verify negative real dependencies and refill/accounting preservation in `tests/chips/chips.migration.test.mjs` on isolated database.

## Validation and handoff

- [x] T006 Review effective function, owner/ACLs and regression suites; record in `specs/1072-stage-escrow-demand-refill/verification.md`.
- [x] T007 Create Draft PR, observe automatic shared Stage apply and verify batch 19314 read-only; record risks, outcome and breaking changes in `specs/1072-stage-escrow-demand-refill/verification.md`.

## Dependencies and strategy

T001 → T002 → T003 → T004 → T005 → T006 → T007. One story, sequential minimal fix; no parallel agents or generic setup changes. Shared Stage apply intentionally changes retirement eligibility; active automation can then delete eligible accounts without an agent execute.
