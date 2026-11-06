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

- [x] T031 `infra/vps/production-retention/arcade-chips-ledger-production-dispatch.sh`: daily `03:39` slot for `retention-12m`, before `??:39`; escrow skips only that hour and keeps its other 23 hourly runs. The existing Production slot test lives in `tests/chips/chips-ledger-stage-automation.workflow.guard.test.mjs` (it asserted `03:39` = escrow), so it is extended there instead of adding a second one to `ws-tests/infra-vps-workflow.guard.test.mjs`: `03:39` selects `retention-12m`, `02:39`/`04:39` still escrow, other slots unchanged. Not active on the VPS until installed through root on demand: T032.
- [ ] T032 Separate reviewed PR: VPS Admin operation `ledger-production-dispatcher-install` (see plan). Available after the one-time helper reinstall (`infra/vps/stage-vps-admin.sh`) and the release-agent App activation; it is reusable for later dispatcher changes.

## Phase 4 — Docs and evidence

- [ ] T040 `docs/chips-ledger.md` retention section; Privacy/Data safety evidence list (D1–D7 wording, provider windows).
- [ ] T041 PR egress assessment per agents.md, Codex review, CI.

## Phase 5 — Rollout (each step a separate owner GO)

- [x] T050 Stage: diagnostic, then one capped automatic run; verify objects absent by HEAD/not-found only. Done 2026-11-05 (owner: T050 Stage PASS); every step was an owner dispatch or owner SQL with a separate GO. **Owner exception:** no HEAD/not-found request was made; the evidence of absence is the metadata check and the DELETE result below.
  - **Apply source.** The Stage history held three profile migrations from the open Draft PRs #1155/#1160 that `main` lacks, and the unchanged executor fails closed on them (`unknown_remote_migration`). Owner decision: apply from the Draft PR #1201, which carries byte-identical copies of only those three files, verified against the Stage history SHA-256 values. The approval listed only `20261105160000`. #1201 is closed without merge once this record is accepted, and the copies never reach `main`.
  - **Apply 1** (run `42110915806`): `stage_sql_failed`, rolled back. Inspect `42111502460` showed Stage unchanged. Cause: the pruner ownership transfer needs a temporary delegation for the non-superuser Supabase `postgres`. Fixed in #1202, which also ran the function ACL before the delegation ends and applies the same fix to the Production contract; a non-superuser regression test was added.
  - **Apply 2** (run `42116230654`, source `ab5430c4`, migration SHA-256 `f63cd59a…45f0`): `COMMITTED_OR_VERIFIED_NOOP`, history 121 → 122 rows (`329ed7b7…fc8b`, the expected fingerprint). Inspect `42116598479`: nothing pending.
  - **Diagnostic.**
    - Default 12-month cutoff (run `42116637584`): 0 batches, 0 table rows.
    - Stage-only cutoff `2026-11-01` (run `42116948845`): 10 batches (capped), 1,661,897 B; 83 gifts, 529 poker requests, 2 deletion requests.
  - **Canary.**
    - Canary 1 (run `42117647674`) failed before any DELETE: the Stage Storage target lacked the DB URL. Fixed in #1203.
    - Canary 2 (run `42119577000`, batch `6`, cutoff `2026-11-01`): 3 objects deleted, 2 registry rows deleted, `objects_expired_at` set.
    - Supporting check only, not the required HEAD/not-found: a read-only `storage.objects` metadata query shows 0 of 3 objects for batch 6, while batch 7 (control) still has 3 of 3. Together with the canary's DELETE result (`objectsDeleted: 3`) this is consistent with the deletion, but it does not replace the HEAD/not-found responses.
    - **Owner decision (2026-11-05):** T050 Stage PASS without a separate HEAD request. The agent holds no Stage service-role key, and the owner accepted the metadata check and the DELETE result as sufficient.
  - **Capped automatic run** (one-off). The owner enabled the control by SQL at 22:53 UTC. Run `42125480846` (`automatic`, default cutoff, no override) returned `complete`, `expired: []`, tables 0/0/0. The control was disabled again at 22:58 UTC.
    - Read-only check afterwards: control OFF (`activated_at` null), still 1 expired batch, 0 eligible, oldest data unchanged.
  - **Follow-up (separate task).** Reconcile the `main` migration catalog with the Stage history permanently, by merging #1155/#1160 or by an owner decision. Until then every Stage apply from `main` hits the same block.
- [ ] T051 Production: apply the production-migration equivalent, diagnostic, one canary of 1 batch, then enable the policy. Install the T031 dispatcher through the T032 VPS Admin request; the owner's `vps-admin` approval is the GO.
  - **Apply** (2026-11-06 00:03 UTC, owner `psql` on the VPS, `ON_ERROR_STOP`): `20261105160500_chips_settled_retention_12m_production_contract.sql` from `main` `8a536d4e`, SHA-256 `ef87c295…1db8` checked first, with the owner confirmation settings. An earlier agent attempt through the Supabase MCP was interrupted; a read-only check showed nothing applied (69 history rows, no control table) before the owner run. Result `COMMIT`. Read-only check: history 69 → 70 rows with `20261105160500`; control `enabled=false`, `activated_at` null; the four functions have the expected owners, `SECURITY DEFINER` flags and `EXECUTE` grants (none for `public`, `anon`, `authenticated`, `service_role`); the temporary pruner delegation and schema `CREATE` are revoked again.
  - **Diagnostic** (run `42141537560`, `main` `8a536d4e`): `diagnosed`, `controlEnabled: false`, 0 archive batches, 0 B; gifts 0, poker requests 0, deletion requests 0 (cutoff `2025-11-06`).
  - **Canary not run.** No Production batch is older than 12 months, so there was no batch for a canary with a real DELETE. **Owner decision (2026-11-06):** enable without a Production canary. The first real expiry will therefore be an automatic run; the Stage canary (T050) is the only DELETE evidence.
  - **Activation:** the owner enabled the control by SQL under the Production retention advisory lock at 2026-11-06 01:10:56 UTC (`enabled=true`, `activated_at` set; verified read-only).
  - **Automatic** (run `42185756097`): PASS, `complete`, `expired: []`, tables `executed` 0/0/0.
  - **Open:** the `03:39` dispatcher slot (T031) is not installed on the VPS yet; until the T032 install, `retention-12m` runs only on an owner dispatch.
