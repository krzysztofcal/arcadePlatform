# Tasks: 12-month cap for settled user-linked history (#1157)

**Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

## Phase 0 — Owner decisions (blocking)

- [x] T001 Owner decides D1–D7 in spec.md; record them in research.md (2026-11-05: all recommendations accepted).
- [x] T002 Owner accepts the Stage-only cutoff override (plan "Risks") or an alternative Stage proof.
- [x] T003 Read-only code audit (no DB, Storage, VPS or workflow access): list every reader of `chips_ledger_archive_batches` rows and of `chips-ledger-archive` objects in `scripts/ops/**`, `netlify/functions/**`, `supabase/**` (functions/views) and `.github/workflows/**`. For each one record: file:function, which batches it can reach (latest/active only or any `committed`), whether it downloads or HEADs objects, and what happens when objects are gone (fail closed, no-op, or wrong success). Result: `research.md` table plus a PASS/STOP verdict. STOP when any path can reach a batch with `objects_expired_at` set and would then fail open, retry-loop with Storage GETs (egress), or block normal retention. Fixes become T010/T021 requirements before implementation.

## Phase 1 — Schema (no SQL is applied by the PR; Stage apply is a separate owner `DB Stage Apply PR` dispatch)

- [ ] T010 `supabase/migrations/<ts>_settled_data_retention_12m.sql`: add `objects_expired_at`, policy row (disabled), `public.chips_settled_retention_12m_run(p_limit int)` with the D1 and D6 branches only if approved; ACL `service_role` only.
- [ ] T011 Extend the existing DB migration contract test for the archive tables (`objects_expired_at` column, ACL, function returns counts, limit honoured, younger/non-COMPLETED rows and an old gift on an OPEN table untouched; if D6 is approved: old finished `poker_requests` deleted, old `ACT` with `result_json is null` and younger rows kept; the shared per-run row limit holds across all branches).

## Phase 2 — Script

- [ ] T020 `scripts/ops/chips-ledger-archive-store.mjs`: DELETE support in the existing Storage request helper (single attempt, 200/404 = done, anything else throws).
- [ ] T021 `scripts/ops/chips-ledger-production-automation.mjs`: `retention-12m` policy, `diagnostic` (aggregates only), `canary` (exactly one confirmed batch) and `automatic` (limit 10) modes, `expireArchiveBatches(...)`, fail-closed order from plan.md.
- [ ] T022 Stage wiring in `scripts/ops/chips-ledger-stage-automation.mjs` with the Stage identity and the T002 override.
- [ ] T023 Extend the existing Production automation and archive storage suites: eligible batch expires; pending, unpruned, young, foreign-project and replay-referenced batches untouched, including a replay row appearing after selection (recheck before first DELETE); canary refuses any batch other than the confirmed one; batch pending escrow retirement untouched; escrow selectors skip expired batches; per D7, the next automatic run of each policy still succeeds when its latest completed batch is expired (R-A2) or that batch is never selected (R-A1); lock session lost after the first DELETE stops the remaining DELETEs and leaves `objects_expired_at` NULL; policy disabled between batches stops before the next batch; Storage error keeps `objects_expired_at` NULL; rerun no-op; no GET or list calls issued; limit 10.

## Phase 3 — Workflows (owner push)

- [x] T030 Add `retention-12m` to the policy choices in `.github/workflows/chips-ledger-production-scheduled-automation.yml` (modes `diagnostic`, `canary`, `automatic`; no cutoff). Stage gets its own owner-dispatch workflow `.github/workflows/chips-ledger-stage-settled-retention.yml` in the `chips-ledger-stage-automation` concurrency group: the Stage automation workflow already has 10 dispatch inputs, and a separate job keeps its `stage-archive` condition unchanged. Guard tests extended in `tests/chips/chips-ledger-stage-automation.workflow.guard.test.mjs`.

- [ ] T031 `infra/vps/production-retention/arcade-chips-ledger-production-dispatch.sh`: daily `03:39` slot for `retention-12m`; extend `ws-tests/infra-vps-workflow.guard.test.mjs` (slot selects only `retention-12m`, and other slots are unchanged). Install through root on demand: T032.
- [ ] T032 Separate reviewed PR: VPS Admin operation `ledger-production-dispatcher-install` (see plan). Available after the one-time helper reinstall (`infra/vps/stage-vps-admin.sh`) and the release-agent App activation; it is reusable for later dispatcher changes.

## Phase 4 — Docs and evidence

- [ ] T040 `docs/chips-ledger.md` retention section; Privacy/Data safety evidence list (D1–D7 wording, provider windows).
- [ ] T041 PR egress assessment per agents.md, Codex review, CI.

## Phase 5 — Rollout (each step a separate owner GO)

- [ ] T050 Stage: diagnostic, then one capped automatic run; verify objects absent by HEAD/not-found only.
- [ ] T051 Production: apply the production-migration equivalent, diagnostic, one canary of 1 batch, then enable the policy. Install the T031 dispatcher through the T032 VPS Admin request; the owner's `vps-admin` approval is the GO.
