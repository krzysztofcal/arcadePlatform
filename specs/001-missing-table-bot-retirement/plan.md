# Implementation Plan: Historical Missing-Table Bot Identity Retirement

**Branch**: `agent/001-missing-table-bot-retirement` | **Date**: 2026-09-11 | **Spec**: [spec.md](./spec.md)

**Input**: Accepted feature specification from `specs/001-missing-table-bot-retirement/spec.md`, based on issue #978 and the accepted 2026-09-11 research comment.

## Summary

V1 closes one finite historical gap: registry identities for bot-internal TABLE transactions whose authoritative `poker_tables` row is absent and whose rows already crossed the existing Stage 30-day archive, proof, and prune boundary. The operation is an exact whole `chips_ledger_archive_batches` batch retirement. It removes only the registry rows proven to belong to that batch and records the existing `registry_cleaned_at`, `registry_cleaned_key_count`, and `registry_cleaned_keys_sha256` receipt atomically.

The smallest design is one additive migration, one narrow Stage-only `SECURITY DEFINER` database operator, one manual read-only audit/execute wrapper, one owner-gated manual dispatch path in the existing Stage automation workflow, and one audit document. It reuses the existing archive-pruner role, DB-only Stage assertion, `createPruneStore(sql).getIdentity()`, TABLE parser, canonical text hash, archive/prune receipts, and archive-batch mapping. The wrapper does not require the REST URL or service-role key because it has no Supabase REST or Storage path. It does not reuse the existing #890 cleanup operator as the lifecycle gate because that operator correctly requires a present `CLOSED` bot-only table; this feature requires the opposite state, an absent authoritative table. Ledger pruning is already complete before this operator runs, so the new operator deletes registry rows and writes the cleanup receipt only.

The 2026-09-11 classification is an input and is revalidated by a bounded read-only audit. No generic classifier, TTL, archive registry, tombstone, scheduler, or draining loop is introduced. No runtime, browser, WebSocket, migration execution, Stage database, Storage, or Production action is part of this plan phase; the only workflow change is the manual dispatch wiring described below, and that workflow is not dispatched here.

## Technical Context

**Language/Version**: Existing Supabase PostgreSQL PL/pgSQL and Node.js ESM used by `scripts/ops/`.

**Primary Dependencies**: Existing `postgres` client, `chips_ledger_archive_pruner`, `chips_assert_archive_prune_stage()`, `createPruneStore(sql).getIdentity()`, `chips_table_fence_is_active()`, `chips_parse_table_idempotency_key(text)`, `chips_archive_text_ids_sha256(text[])`, the current effective `chips_guard_archive_batch_mutations()` contract, and the existing cleanup receipt fields/constraint.

**Storage**: Existing PostgreSQL tables and archive batch evidence. No new table, Storage object, registry archive, or tombstone is added. The retirement path consumes an already committed and pruned archive batch; it does not perform archive or Storage writes.

**Testing**: Extend `tests/chips/chips-ledger-bot-only-retention.test.mjs` with static migration contracts and a disposable PostgreSQL contract when `CHIPS_MIGRATIONS_TEST_DB_URL` is available; extend the existing `tests/chips/chips-ledger-stage-automation.workflow.guard.test.mjs` only with the fundamental owner-gate/input/operator contract for the manual mode. Run the existing `node scripts/syntax-check.mjs`, `node scripts/test-all.mjs`, and the workflow guard after implementation; no Stage mutation is a test prerequisite.

**Target Platform**: Canonical Stage database `krydukthwdvccggbyjfw` with PostgreSQL system identifier `7656985631720456337`, invoked manually from the existing Node.js operations environment with `SUPABASE_STAGE_DB_URL`. The wrapper obtains the physical identity through `createPruneStore(sql).getIdentity()` and `chips_assert_archive_prune_stage()`, rejects Production target/credential variables, and neither requires nor reads `SUPABASE_STAGE_URL` or `SUPABASE_STAGE_SERVICE_ROLE_KEY`.

**Project Type**: Database safety boundary plus an internal manual operations CLI and documentation.

**Performance Goals**: Read-only audit uses a bounded aggregate inventory over the full `chips_transaction_idempotency` registry and existing indexed `archive_batch_id` access paths for candidate discovery; it does not loop as a persistent classifier. A mutation handles one exact archive batch at a time and inherits the existing Stage batch ceiling of 5,000 transaction identities. There is no user-request latency or continuous throughput goal.

**Constraints**: Fail closed on every missing, conflicting, stale, or ambiguous predicate; serializable execute transaction; short existing lock and statement timeout pattern; active and enforced TABLE fence; exact Stage identity; exact policy and format; all-or-nothing batch deletion; no balance or ledger mutation; no Production target; no automatic scheduling; no `console.log`.

**Scale/Scope**: Historical cohort only. The research baseline estimated about 10,080 whole-batch eligible identities, but that number is not authorization and is not hard-coded. The current count must be measured again by the read-only Stage audit immediately before any owner-confirmed execution.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Before Phase 0 research: PASS

- **I — Simplicity and existing mechanisms**: The design starts from the existing archive/prune/receipt/fence path and adds one narrow policy branch. It does not add a generic framework or parallel scheduler.
- **II — Authoritative runtime boundaries**: No `ws-server/`, browser, or poker runtime behavior changes. The database fence remains the existing rejection boundary for a reused missing TABLE identity.
- **III — Fail-closed safety and environment separation**: Stage identity, exact policy, exact batch, active fence, complete proof/prune evidence, and explicit confirmation are mandatory. No Production path is planned, and no balances are touched.
- **IV — Compatibility, logging, and style**: The only new JavaScript is an internal Node.js operations wrapper. It emits structured `klog` events, uses no JSP/browser code, and requires no CSS or CSP change.
- **V — Fundamental tests and concrete plans**: The plan names concrete files, functions, fields, constraints, and deterministic critical cases. It extends an existing retention test file and contains no Git commands or full implementation code.
- **Deployment gates**: No WebSocket or browser protocol paths are affected, so the WS Preview Deploy gate does not apply. Any later destructive action is Stage-only.

## Phase 0 — Research and resolved design decisions

The detailed evidence and alternatives are in [research.md](./research.md). The live repository was checked at `25d5a7b9c5b13caf6948e97c4435d065c5d76e02`, the merge commit for PR #979. The relevant code paths did not differ from the code state used by the research comment. The current Stage candidate count was not remeasured because this workspace has no Stage PostgreSQL credentials; the historical count remains a planning baseline only.

The research resolves the main design questions as follows:

1. The existing `chips_transaction_idempotency.archive_batch_id` mapping is the batch boundary. It is write-once under the current registry guard, so the operator derives the sorted key set from the exact locked batch instead of introducing a second registry of retired keys.
2. The operator receives the audited `registry_key_count` and `registry_keys_sha256`, recomputes the sorted set with `chips_archive_text_ids_sha256(text[])`, and rejects any mismatch. After deletion, the immutable `registry_cleaned_*` receipt is the retry evidence.
3. The current effective archive-batch contract includes more than the schema-v2 #890 path: the all-null receipt state, the unchanged schema-v2 bot-only receipt state, the unchanged `format_version = 2`/`legacy_stage_allowlist_v1` receipt state, and the later `chips.closed_human_go` alternative added to the existing `chips.bot_only_go` guard. The new migration adds only a v1/source-policy branch. It derives the guard from `pg_get_functiondef('public.chips_guard_archive_batch_mutations()'::regprocedure)` after all prior migrations, verifies the legacy and both GO anchors, and fails closed if the effective shape is not present; it never copies an older guard definition.
4. `chips_prune_committed_archive_batch(...)` and `chips_prune_and_cleanup_bot_only_archive_batch(...)` are not called for V1 execution. The first would repeat an already completed ledger prune; the second requires an existing `CLOSED` bot-only table and remains owned by #890.
5. The manual wrapper uses only `SUPABASE_STAGE_DB_URL`, canonical Stage project/system constants, `createPruneStore(sql).getIdentity()`, and `chips_assert_archive_prune_stage()`. A small local DB-only preflight rejects Production target/credential variables. It does not call `validateStageEnvironment()` merely to obtain a DB-only check, does not modify that broader automation helper, does not call scheduled automation, and does not add a scheduler.
6. The issue-978 classification was already performed by the accepted 2026-09-11 research. The audit documents and revalidates that finite historical classification against current Stage/live data; it does not introduce a generic or persistent classifier, archive registry, tombstone, scheduler, or draining loop.

## Phase 1 — Implementation design

### 1. Add one additive database migration

Create `supabase/migrations/20260911100000_chips_ledger_missing_table_bot_registry_retirement.sql` after the latest existing migration. The migration must be additive and forward-only.

It will:

- preserve the current `chips_ledger_archive_batches_cleanup_receipt_check` states exactly: all three `registry_cleaned_*` fields null; the `format_version = 2`, `source_policy_id = 'stage-ledger-bot-only-retention-7d-v1'` receipt with complete proof/prune evidence and matching `bot_only_registry_keys_sha256`; and the `format_version = 2`, `source_policy_id = 'legacy_stage_allowlist_v1'` receipt with its existing complete proof/prune/count/hash conditions. It then adds only one additional state requiring `format_version = 1` and `source_policy_id = 'stage-ledger-auto-retention-30d-v1'`, complete archive proof, complete exact prune receipt, positive `registry_cleaned_key_count = transaction_count`, and a 64-character `registry_cleaned_keys_sha256`;
- obtain the current effective `chips_guard_archive_batch_mutations()` body with `pg_get_functiondef(...)` at migration time, require anchors for the legacy proof/receipt branch, `chips.bot_only_go`, and `chips.closed_human_go`, and fail closed if any anchor or expected replacement point is absent. Patch only the narrow v1 cleanup-proof branch. Preserve the current write-once fields, separate proof/prune/cleanup transitions, schema-v2 exact bot-only GO, closed-human GO via `chips.closed_human_go`, role checks, and `chips.bot_cleanup_receipt = '1'` latch. Do not copy an older migration's guard body;
- leave `chips_guard_idempotency_mutations()` and the existing legacy cleanup operator as the direct-delete boundaries for their current paths, including the `chips.legacy_stage_cleanup` behavior, and rely on the existing `current_user = 'chips_ledger_archive_pruner'` plus `chips.bot_registry_cleanup = '1'` condition for the new registry delete;
- define `public.chips_retire_missing_table_bot_registry_batch(p_batch_id bigint, p_registry_key_count bigint, p_registry_keys_sha256 text, p_execute boolean default false, p_confirmation text default null) returns jsonb` as a narrow `SECURITY DEFINER` function with `set search_path = ''`, owned by `chips_ledger_archive_pruner`, with `EXECUTE` revoked from public/anon/authenticated/service roles and granted only to the existing operator role (`postgres`);
- require `p_batch_id`, a positive expected count, a lowercase 64-character expected hash, and no implicit default that can execute a mutation;
- call `chips_assert_archive_prune_stage()` and require the batch project ref to be `krydukthwdvccggbyjfw`; reject every non-canonical physical database before a mutation;
- lock the selected batch only in execute mode and require this complete eligibility conjunction for every candidate/batch: committed archive status with non-null `committed_at`; exactly `format_version = 1`; exactly `source_policy_id = 'stage-ledger-auto-retention-30d-v1'`; verified complete archive proof; complete/exact prune receipt; active and enforced TABLE transaction fence immediately before mutation; non-empty whole-batch registry mapping; `registry_count = transaction_count`; supported bot-internal TABLE key family; successful parser extraction of `tableId`; parsed `tableId = stored table_id`; no hot `chips_transactions` or `chips_entries`; absent authoritative `poker_tables` rows; and one exact sorted identity set/count/hash computed by `chips_archive_text_ids_sha256(text[])` and matching the operator input;
- validate every derived registry row as `TABLE_BUY_IN` or `TABLE_CASH_OUT`, `user_id is null`, `key_format_version = 1`, and one of the four accepted bot-internal families: `managed-bot-seed-buyin`, `bot-seed-buyin`, `poker:bot-replacement-buyin:v1`, or `poker:bot-terminal-cashout:v1`. A single unsupported, malformed, protected, mixed, stale, present-table, hot, or ambiguous row rejects the whole batch;
- invoke `chips_parse_table_idempotency_key()` for every key and require a successful version-1 parse, a parsed `table_id`, a parsed table ID equal to stored `registry.table_id`, and the stored format to agree with the parser result;
- require `chips_table_fence_is_active()` and the singleton `chips_table_fence_control.enforcement_active` to be true immediately before the execute delete; require no authoritative `poker_tables` row for any derived table ID;
- require no hot `chips_transactions` row and no hot `chips_entries` row for any derived transaction ID. A missing binding, present table, parser error, proof/prune mismatch, count/hash mismatch, or any other ambiguity aborts the whole operation;
- in `p_execute = false`, return `ready` with batch ID, count, hash, table/membership summary, and evidence state without deleting or updating any row;
- in `p_execute = true`, require `p_confirmation` to equal exactly `GO <batch_id>`, set the existing transaction-local cleanup latch, delete all and only registry rows for the locked batch, verify the affected-row count equals the derived count, set the existing receipt latch, and write `registry_cleaned_at`, `registry_cleaned_key_count`, and `registry_cleaned_keys_sha256` in the same transaction;
- support an exact retry only when the stored receipt is complete, the supplied count/hash match that receipt, and no residual registry mapping remains. Return `already_retired` without mutation. Any partial receipt, mismatching count/hash, residual mapping, or changed batch evidence fails closed;
- never update `chips_accounts`, `chips_transactions`, `chips_entries`, `poker_tables`, balances, replay snapshots, or Storage objects.

The exact GO is a transient exact-batch input to this one manual operator. The existing `destructive_go_*` columns remain coupled to the current policy-specific owner authorization paths; no new authorization table or generic GO state is added. The cleanup receipt is the durable V1 outcome.

### 2. Add one manual Stage audit/operator wrapper

Create `scripts/ops/chips-ledger-missing-table-bot-retirement.mjs`.

The wrapper will:

- require `--target stage` and reject any Production target or Production credential variable;
- use only `SUPABASE_STAGE_DB_URL`, canonical Stage project/system constants, the existing `postgres` connection style, `createPruneStore(sql).getIdentity()`, and `chips_assert_archive_prune_stage()`. The wrapper has a small local DB-only preflight, rejects `SUPABASE_PROD_*`/`PRODUCTION_*` target or credential variables, and does not require or read `SUPABASE_STAGE_URL` or `SUPABASE_STAGE_SERVICE_ROLE_KEY`; it must not expand `validateStageEnvironment()`;
- expose only `--mode audit` and `--mode execute`; audit is the safe default only when explicitly named, and execute requires `--batch-id`, `--registry-count`, `--registry-sha256`, and `--confirmation "GO <batch_id>"`;
- in audit mode first use a bounded aggregate query over the full `chips_transaction_idempotency` registry, including mapped, unmapped, and material hot identities, and use existing `archive_batch_id` mappings for exact whole-batch candidate discovery. Revalidate the accepted classification and report unsupported or malformed keys as rejected/unknown candidates without a fallback classification or mutation;
- after the T011 database function exists, re-read each discovered exact candidate in a repeatable read-only transaction and call the new SQL function with `p_execute = false` for strict per-batch validation. Report only batches that pass every V1 guard as `ready`, emit `klog` events containing policy, batch ID, count, hash, table/missing-table summary, proof/prune state, and residual class metrics, and never call a mutation function from audit;
- in execute mode re-read the exact batch evidence and call the SQL function in a serializable transaction with the exact count/hash and GO. It must not trust a stale audit file or a client-supplied key list;
- emit only aggregate, copyable structured `klog` output and a nonzero failure for any rejected or ambiguous execution;
- contain no cron entry, workflow dispatch, automatic loop, Storage write, archive export, or call to `runAutomaticBotOnlyStageAutomation()`.

### 3. Extend the existing workflow with one owner-gated manual canary path

Extend `.github/workflows/chips-ledger-stage-scheduled-automation.yml` without creating another workflow or scheduler. Add the `workflow_dispatch` mode `missing-table-bot-retirement-canary` and only its four conditional string inputs: `missing_table_retirement_batch_id`, `missing_table_retirement_registry_count`, `missing_table_retirement_registry_sha256`, and `missing_table_retirement_confirmation`; these inputs have no destructive defaults and are required by the canary step when that mode is selected.

The mode is admitted only for the canonical `krzysztofcal/arcadePlatform` repository, a non-fork run, and the repository owner. The existing checkout is pinned to the selected workflow commit (`github.sha`) and keeps the existing `git rev-parse HEAD`/`GITHUB_SHA` assertion. The existing read-only Stage identity/TABLE-fence preflight runs before the canary step. The canary step exposes only `SUPABASE_STAGE_DB_URL` and the four workflow inputs, invokes `node scripts/ops/chips-ledger-missing-table-bot-retirement.mjs --target stage --mode execute ...` exactly once for the supplied batch/count/hash/confirmation, and has no retry, next-batch path, Storage, service-role, or scheduler behavior. The mode is excluded from the generic automation gate and all existing automatic/resource-health paths. The existing workflow guard test receives only the corresponding static contract. No workflow dispatch is performed during implementation.

### 4. Add the operator/audit documentation

Create `docs/issue-978-idempotency-retention-audit.md` with:

- the accepted 2026-09-11 classification and a clear distinction between historical baseline and current Stage measurement;
- the four V1 bot-internal key families and the explicit protected classes: human TABLE, full replay, legacy/unknown, existing/open/closed table states, hot rows, and #890 normal CLOSED bot-only ownership;
- the complete eligibility checklist, including exact policy/version, parser-to-stored-table binding, active/enforced fence, committed archive, verified proof, exact prune, count/hash, absence of `poker_tables`, and no hot rows/entries;
- the audit-only, exact-batch GO, execute, receipt verification, and replay-probe flow;
- Stage canary selection and abort criteria; no Production step;
- the breaking semantic impact: a very old retired bot-internal retry can return terminal `table_closed`/retired rejection, while the existing fence must prevent a second transaction, entry, balance change, or provenance change;
- residual rows/day, bytes/day, 30-day, and one-year measurements by class, without claiming a full registry plateau.

### 5. Add only fundamental deterministic coverage

Extend `tests/chips/chips-ledger-bot-only-retention.test.mjs`, which already contains the parser/hash/role/receipt fixtures and disposable PostgreSQL contract, with one small static guard regression contract and three fundamental behavioral groups:

- `effectiveArchiveGuardRegressionContract()` reads the legacy cleanup migration, the closed-human canary patch, and the planned migration. It minimally asserts that the all-null, schema-v2 bot-only, and `legacy_stage_allowlist_v1` receipt branches remain represented; that the current guard retains both `chips.bot_only_go` and `chips.closed_human_go`; and that the new migration derives/checks the effective guard rather than copying an older body. Where the existing disposable PostgreSQL harness is available, the same contract exercises the existing legacy receipt fixture and closed-human authorization/GO fixture; otherwise the source anchors remain the static safety check. It does not assert every implementation fragment;
- **Group 1 — happy path and replay**: one fully pruned, missing-table v1 batch returns `ready`, execute deletes exactly the whole mapped batch, writes the three existing receipt fields, preserves balances/ledger/hot-row counts, and a retired-key replay receives the allowed terminal result with zero second economic effect;
- **Group 2 — compact fail-closed matrix**: one table-driven matrix covers protected human, full-replay, and legacy/unknown identities; an existing table; a hot transaction or entry; unsupported/malformed key; mixed batch; proof/prune mismatch; and wrong Stage identity. Every case rejects the complete batch with no mutation;
- **Group 3 — exact retry**: a matching complete receipt with no residual mapping returns `already_retired` without mutation, while a partial receipt or mismatching batch/count/hash is rejected. Existing critical assertions for the direct-delete latch and the `SECURITY DEFINER`/ACL boundary remain minimal and shared.

No new broad UI, CSS, JSP, glue, scheduler, or generic classification test suite is planned. `scripts/test-all.mjs` already runs the extended file, so no test-runner registration change is needed.

## Audit, exact-batch GO, and Stage canary flow

The later implementation/rollout must follow this order:

1. Confirm the deployed migration and current live code correspond to this feature. Use the wrapper's DB-only preflight with `SUPABASE_STAGE_DB_URL`, `createPruneStore(sql).getIdentity()`, and `chips_assert_archive_prune_stage()`; no REST URL or service-role key is required, and Production target/credential variables must be absent.
2. Run the wrapper in read-only `audit` mode. Re-measure the complete identity classification and current missing-table whole-batch set. Compare the result with the research estimate of about 10,080 identities and report every difference; never treat the estimate as authorization.
3. Select one smallest exact batch that is fully `ready`, capture its batch ID, derived registry count, identity-set SHA, policy, proof/prune evidence, and missing-table summary, then independently review the report.
4. Before the canary, verify the active/enforced TABLE fence, zero hot rows/entries for the exact batch, absent authoritative tables, account balances, ledger conservation, and the absence of human/full-replay/legacy/unknown identities. Run the minimal effective-guard regression contract confirming that the legacy receipt branch and closed-human `chips.closed_human_go`/bot-only GO behavior remain intact.
5. Provide explicit owner confirmation in the exact form `GO <batch_id>` and, when the later owner-authorized canary is approved, dispatch the existing workflow's `missing-table-bot-retirement-canary` mode with the same batch ID, count, and SHA. That mode invokes the existing operator once after the read-only preflight; the database function repeats every guard in the serializable transaction. This plan/implementation does not dispatch the workflow.
6. Verify the committed receipt, exact registry count decrease, zero residual batch mappings, unchanged balances/`next_entry_seq`/ledger conservation, and no Storage or table mutation.
7. Run a bounded deleted-key retry probe. It must receive the documented terminal `table_closed`/retired result and create no transaction, entry, balance, or provenance effect.
8. Re-run the read-only class and residual-horizon audit. Stop on any new missing-table class, mixed batch, count/hash drift, or indefinite growth signal; do not add a scheduler or automatic drain under this feature.

This plan phase performs none of these Stage mutations or canary steps.

## Constitution Check — post-design re-evaluation

**PASS.** The design remains within the constitution after Phase 1:

- It adds one policy-specific migration branch and one narrow operator, while retaining existing archive/prune/fence/parser/hash/role mechanisms and deriving the archive-batch guard from its latest effective definition.
- It does not alter the WebSocket authoritative runtime or introduce another poker-state source.
- It is Stage-only, serializable, exact-batch, fail-closed, and has no balance, ledger, Production, or automatic-scheduler path.
- It extends only the existing Stage workflow with an owner-gated manual dispatch path; it adds no workflow, scheduler, automatic drain, or Production path.
- The wrapper uses `klog`, a DB-only Stage preflight, introduces no JSP/browser/CSS/CSP surface, and adds no dependency.
- Tests cover only critical retirement/retry/safety boundaries in an existing chips retention test file, with one minimal regression contract for legacy receipt and closed-human GO preservation.
- All plan artifacts name concrete paths, procedures, fields, and constraints and contain no Git commands.

## Project Structure

### Documentation (this feature)

```text
specs/001-missing-table-bot-retirement/
├── spec.md
├── checklists/requirements.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── missing-table-bot-retirement-operator.md
```

`tasks.md` contains the dependency-ordered implementation tasks generated by `$speckit-tasks`.

### Source and test changes planned for the later implementation

```text
supabase/
└── migrations/
    └── 20260911100000_chips_ledger_missing_table_bot_registry_retirement.sql

scripts/ops/
└── chips-ledger-missing-table-bot-retirement.mjs

docs/
└── issue-978-idempotency-retention-audit.md

tests/chips/
├── chips-ledger-bot-only-retention.test.mjs  # extend existing fundamental contracts
└── chips-ledger-stage-automation.workflow.guard.test.mjs  # extend existing manual-path guard

.github/workflows/
└── chips-ledger-stage-scheduled-automation.yml  # extend existing dispatch only
```

**Structure Decision**: Keep the database boundary in the existing chronological migration stream, keep the operator beside the existing Stage ledger tools, keep audit/runbook material in `docs/`, and extend the existing bot-only retention and workflow guard tests because they already own the relevant fixtures and safety contracts. No browser, WebSocket, runtime, new workflow, scheduler, or generic setup path is added; the existing Stage workflow receives one manual owner-gated dispatch path.

## Complexity Tracking

No constitution violations require justification. The additional migration definition of the existing archive-batch guard is required to preserve the current receipt protection while admitting exactly one new v1/source-policy receipt state; a new generic abstraction would be more complex and less constrained.
