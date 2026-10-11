# Implementation Plan: Stage escrow demand-refill identity

**Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

## Summary and Technical Context

PostgreSQL 17 / PL/pgSQL, existing Node assert/postgres harness. Patch the effective `public.chips_retire_stage_escrow_accounts(...)` definition with exact-match prerequisites, following `20260912083727_chips_archive_prune_registry_cleaned_retry.sql`. Compute verified transaction IDs once and exclude them only from text branches in P8964/P8965. Recompute the producer payload hash from live SYSTEM accounting; retain direct mappings unconditionally. No helper API or dependency.

## Constitution Check

PASS before and after design: minimal database-layer fix; no runtime ownership change; Stage-only function and fail-closed evidence; fundamental tests in existing file only; no JSP/CSS/CSP/logging changes; no setup/configuration cleanup; required existing manifest/validator inventory update only; no merge. Intended shared Stage mutation and subsequent destructive automation risk explicitly authorized by FR-005 before push. Production untouched.

## Project Structure and Validation

- `supabase/migrations/20261011090000_chips_stage_escrow_demand_refill_identity.sql`: exact effective-definition patch, preserving owner/ACL/config and all unrelated text.
- `supabase/production-migrations/manifest.json` and `scripts/check-db-migrations.mjs`: required stage-only inventory entry and exact expected counts; no Production SQL changes.
- `tests/chips/chips.migration.test.mjs`: real producer fixture; positive prepare/retirement preservation and negative dependency/evidence cases.
- `specs/1072-stage-escrow-demand-refill/`: minimal spec/plan/tasks and operational evidence.

Verify regression without migration; then migration chain and existing Stage escrow/retention fundamental tests on disposable localhost PostgreSQL. Review normalized effective function and catalog permissions. Create Draft PR, observe automatic shared Stage apply, and inspect batch 19314 only read-only. Do not run manual cleanup execute. No Production deployment.

## Complexity Tracking

No new abstractions, helper functions, frameworks, configuration or subsystem edits.
