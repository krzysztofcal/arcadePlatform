# Implementation Plan: 12-month cap for settled user-linked history (#1157)

**Spec**: [spec.md](spec.md) · **Inventory**: [research.md](research.md) · **Baseline main**: `bce85654`

## Summary

Add one dark-by-default retention class, `retention-12m`, to the existing ledger automation. It expires old archive objects (US1) and runs one bounded SQL function for the small tables (US2). It reuses the existing script, lock, target checks, environments, workflows and schedulers. No new service, timer or bucket.

## Affected layers

| Layer | Change |
|---|---|
| DB (Stage) | `supabase/migrations/<ts>_settled_data_retention_12m.sql`: add `chips_ledger_archive_batches.objects_expired_at timestamptz` (status and its constraints unchanged); `public.chips_settled_retention_12m_run(p_limit int)` (security definer, `service_role` only) for gifts and deletion-request minimization, returning counts; `chips_settled_retention_12m_policy` row (enabled false). Auto-applies to shared Stage on PR (intended). |
| DB (Production) | `supabase/production-migrations/<ts>_settled_data_retention_12m_production_contract.sql`: same contract with the canonical Production identity guard. Applied only with a separate owner GO via the existing operator route. |
| Ops script | `scripts/ops/chips-ledger-production-automation.mjs`: add `retention-12m` to `PRODUCTION_POLICIES` and `selectorForPolicy`; modes `diagnostic` (counts only), `canary` (exactly one confirmed `batch_id`, reusing `requireCanaryAuthorization`) and `automatic` (limit 10). New function `expireArchiveBatches({ sql, storageTarget, storageDeps, limit })` reusing `productionStorageDeps` and the request helper in `scripts/ops/chips-ledger-archive-store.mjs` (add `method: "DELETE"`, single attempt, treat 200/404 as done). |
| Stage | Stage profile through `scripts/ops/chips-ledger-stage-automation.mjs` calling the same `expireArchiveBatches` and SQL function with the Stage identity. |
| Workflows | `.github/workflows/chips-ledger-production-scheduled-automation.yml`: add `retention-12m` to the `policy` choice. The Stage workflow likewise. Workflow edits need an owner push (the App has no Workflows permission). |
| Docs | `docs/chips-ledger.md` retention section; Privacy/Data safety evidence list in `specs/1157-settled-data-retention/research.md`. No legal text is published. |

T003 (research.md) adds the following:
- `PRODUCTION_ESCROW_CANDIDATE_SQL` and the Stage escrow selector get `objects_expired_at is null`.
- Per D7: R-A2 adds a skip of the download for `objects_expired_at` batches in the `cycle.latestCompleted` branches of `chips-ledger-production-automation.mjs` (including the closed-human `finalize`) and of `chips-ledger-stage-automation.mjs`; R-A1 adds a latest-per-policy exclusion to the selector instead.

The D1 idempotency branch is added to `chips_settled_retention_12m_run` only if the owner chooses "expire". It needs the same guards plus the FR-004 interaction. The D6 branch (delete `poker_requests` older than 12 months except `kind = 'ACT' and result_json is null`) is added only if the owner chooses "delete". All branches share the single per-run row limit.

## Selection and egress

- Archive candidates: `select object_path, ... from chips_ledger_archive_batches where status='committed' and pruned_at is not null and objects_expired_at is null and project_ref=$1 and last_created_at < now() - interval '12 months' and not (b.bot_only_table_id is not null and b.account_retirement_at is null) and not exists (select 1 from chips_transaction_idempotency i where i.archive_batch_id = b.batch_id and i.replay_transaction is not null) order by last_created_at limit $2 for update`. A few small metadata rows per run.
- Storage: up to 4 DELETE requests per batch, i.e. at most 40 requests per run, with no object bodies. Expected egress per run is a few KB (request/response overhead). Not Shared Pooler egress.
- SQL function: deletes in-database with `limit` via CTE and returns `{gifts_deleted, requests_minimized}`. No rows cross the wire.
- Frequency: existing Production dispatcher cadence, one class invocation per run. Daily transfer stays in the KB range regardless of backlog size; a backlog drains at 10 batches per run.
- Diagnostic mode uses `count(*)` and `sum(compressed_bytes)` aggregates only.

## Fail-closed order per batch

Global advisory lock (also held by prune writers) → re-check policy enabled, canonical target and the replay `not exists` for this batch → DELETE the known paths → all 200/404 → `update ... set objects_expired_at=now() where batch_id=$1 and objects_expired_at is null` → commit. Before **each** Storage DELETE, call the existing `assertRetentionAdvisoryLock(sql, lockSession)`; if not, stop at once (no further DELETE) and leave `objects_expired_at` NULL. Policy enablement and canonical target are rechecked before each batch. Any error: stop the run and leave `objects_expired_at` NULL. Objects already deleted are not restorable; a retry repeats the DELETEs idempotently (404 = done) and then sets the marker.

## Constitution Check

- **I Simplicity**: extends the existing automation script, policy pattern, lock, workflow and dispatcher. One SQL function, one nullable column. No new bucket, timer or service. PASS
- **II Runtime boundaries**: no WS or table lifecycle change. Gifts are deleted only when older than 12 months and their table is gone or `CLOSED`, so live dedupe and seat summaries are unaffected. PASS
- **III Fail-closed / environments**: canonical identity checks, dark default, Stage first, Production by separate GO, no partial status transition. PASS
- **IV Logging/style**: `klog` in the script, counts only. No browser JS or CSS. PASS
- **V Tests**: extend only existing fundamental suites (see tasks). No UI tests. PASS
- **Gates**: the migration auto-applies to Stage (recorded as intended). No Production apply, Play or legal publication from merge.

## Risks

- Irreversible loss of >12-month recovery ability (intended; owner-accepted via spec).
- The D1 choice changes replay semantics for very old client keys.
- The ledger exists since 2025-12-18 and archives since 2026-08, so likely no batch anywhere is older than 12 months yet; the first Production candidates are expected from about 2026-12. Diagnostic counts confirm this before activation. The Stage canary therefore needs a test cutoff. **Open**: allow `p_cutoff_override` for Stage only, never Production.
