# Implementation Plan: Production retention, two gated PRs

**Date**: 2026-09-13 · **Feature**: `004-production-retention`
**Working branch**: `agent/891-production-retention-plan` · **Spec**: [spec.md](spec.md)
**Main reviewed**: `f7983d78333b51a393c0e9a6d3dfe48ce1224c74`

## Summary

Prepare PR A with one forward-only Production final-schema equivalent, a separately applied TABLE-fence activation migration, minimal shared retention internals and dark Production workflow. Prepare PR B only after fresh Production canaries PASS: one exact-receipt activation migration, policy-bound cap 5000, owner-enabled workflow and dedicated VPS dispatch. Preserve Stage behavior and the existing archive/export/store/prune pipeline. No implementation or Production mutation is performed by this planning session.

## Technical Context

Node.js 20 ESM ops scripts, existing `postgres` package, PostgreSQL 17 Production/Stage, existing disposable PostgreSQL 16 CI contract service, private Supabase Storage, GitHub Actions and Ubuntu/systemd. No new dependencies. PostgreSQL session connection on 5432, max=1, prepare=false for operator orchestration; reject transaction pooling. One Production batch per invocation, no backlog loops; max2 transactions pre-activation, max5000 only for activated policy-bound runs, <=2 escrow accounts. Existing terminal lifecycle, USER-history boundaries, archive format and durable idempotency model remain authoritative. WS remains poker authority.

## Constitution Check (1.1.1, before/after design: PASS)

- Simplicity/reuse: existing pipeline retained; shared extraction limited to genuinely reused cycle/recovery/escrow internals; no policy framework, new migration runner or archive framework.
- Target safety: plan-only now. Explicit owner authorization separately required for Production schema, fence, canary, activation, Storage writes and scheduler install. No merge by agent.
- Stage effect: **no shared Stage migration apply intended**. New Production SQL is outside `supabase/migrations/**`; existing migrations and `scripts/stage-db-migrate.mjs` remain untouched. Changes to shared JS must pass Stage fundamental regression suites. No workflow dispatch or live Stage cleanup is required for this planning task.
- Tests: extend the existing boundary suites listed below, no UI/DOM/CSS/JSP/simple-glue tests, no new framework or speculative matrix.
- Compatibility: no browser change; future JSP JS would require global/IIFE, CSS one line per selector, klog instead of console.log, and script CSP SHA where applicable. None of those presentation files need changes here.
- Runtime evidence: CI is not integration proof. Existing adapters must pass disposable fence-on PostgreSQL tests, deployed sources must match, owner performs relevant manual smoke. If a writer actually changes in later implementation, exact-runtime-SHA WS Preview Deploy and user smoke are required. Docs-only planning requires no deploy/smoke.
- Breaking impacts explicit below. No ignore/config/dependency/setup cleanup beyond specifically named workflow, migration guard and Production scheduler artifacts.

## PR A — catch-up and dark/off automation

### A1. Migration layout and history

Add exactly this Production migration directory in the implementation PR (not now):

- `supabase/production-migrations/manifest.json`: baseline 54 applied versions, all 43 missing source versions/files/SHA256/category/disposition, E1/E2 order, expected target pair and shared-equivalence object checks. This is inventory metadata, not a second applied-history database.
- **E1** `supabase/production-migrations/20260914090000_chips_ledger_production_retention_contract.sql`.
- **E2** `supabase/production-migrations/20260914091000_chips_ledger_production_table_fence_activation.sql`.

Reserve these version names; if upstream already uses a reserved version at implementation start, stop the milestone and update all artifact references together before coding. Extend `scripts/check-db-migrations.mjs` to validate both directories, unique versions, hashes in manifest and exhaustive classification. Do not execute SQL in that guard. Standard Stage validation remains unchanged. Production apply uses individually authorized psql file application with ON_ERROR_STOP and a session lock, not directory globbing. E1/E2 contain BEGIN/COMMIT and strict Production identity assertions before DDL; record their own `schema_migrations` entry in the same successful transaction. History insert/check is conditional on matching own version/name and verified catalog state; unknown/partial existing state aborts. Never repair old Stage versions.

### A2. E1: final required schema, safe state

Compose final reviewed SQL bodies from the 97-migration contract; do not execute textual patch chains on Production or regenerate SQL from live Stage at apply time. Preserve the source-to-object provenance in manifest. See data-model.md and per-file inventory.

Required groups:

1. `chips_ledger_archive_batches`: source policy immutability, bot schema-v2 fields, registry-cleaned/GO fields, account recovery/retirement receipt fields and final constraints/indexes. No legacy allowlist/run fields or tables are needed by the Production final functions. Preserve existing v1 manual batch with null policy. Every constraint/trigger copied from mixed migrations must remove only unreachable legacy branches, retaining human GO and complete receipt states.
2. `chips_transaction_idempotency`: table_id/key-format fields and capture/immutable guards. Historical rows remain unknown; do not infer table_id or bot eligibility from incomplete old keys. Preserve old registry mappings/transaction snapshot.
3. `poker_tables`: bot_only_proof_eligible=false for existing **and newly created pre-fence** tables; bot/human completion markers initially null. This conservatively differs from Stage's original install-default-true timing. E2 changes the default for future tables only after fence activation. No mass historical qualification.
4. `chips_table_fence_control`: one OFF row; final `chips_table_fence_is_active`, owner-gated `chips_set_table_fence_active`, `chips_guard_table_fence_control`; final parse/normalize/binding triggers and poker/idempotency guards. Introduce `chips_lock_table_fence_for_retention()` as the minimal Production counterpart of legacy-named lock helper: same row-lock semantics, no legacy authorization.
5. Three explicitly Production-named retention policy singleton tables and one minimal Production automation control row (data-model.md), all disabled and cap2. Reuse final bot/human policy gate/activation function signatures where environment-neutral; Production escrow functions use `_production_` rather than `_stage_` names. No generic multi-environment SQL policy engine.
6. Final proof/prune/lifecycle bodies: `chips_register_archive_id_proof`, `chips_prune_committed_archive_batch[_internal]`, `chips_authorize_production_existing_30d_canary` with exact existing30d GO guard (data-model.md), bot authorize/proof/scoped lifecycle/prune/automatic wrapper, human authorize/lifecycle/prune/automatic wrapper/completion, escrow authorize/retire/activate. Preserve final function owner, SECURITY DEFINER, empty search_path, minimal RLS and no EXECUTE for PUBLIC/anon/authenticated/service_role.
7. Keep final shared indexes from inventory, including registry archive_batch_id, (transaction_id,table_id), closed-human table access, table_id, trigram transaction-reference/metadata and account system_key pattern. Omit rolled-back candidate-selector index and seqscan override. Do not add speculative indexes.
8. Retain #981 receipt-backed already_pruned behavior for exact Production existing-30d policy, with all receipt/hash/count/zero-mapping checks. Do not add a Production equivalent of the **one-off** `chips_retire_missing_table_bot_registry_batch` API: its shared guard contribution is retained, operation stays Stage-only. Escrow scope remains freshly cleaned bot-only batches, no closed-human expansion.

New owner-only `chips_assert_production_retention_control(p_policy_id,p_transaction_count,p_execute)` checks system/ref, known policy, cap and mode before mutation, used by **all** policy-bound proof/prune/cleanup wrappers and low-level destructive internal paths. Existing manual null-policy path retains cap2. Before activation max2 everywhere; after activation max5000 only for activated Production policies and enabled automation control. Low-level public direct calls cannot bypass the policy gate. Canary execute requires exact GO on its batch and global automatic control still OFF. RLS/ownership prevents unprivileged clients from setting latches to gain authority.

E1 must commit with automation enabled=false, policy enabled=false, cap2, fence OFF, no canary IDs/activation timestamps, no deletion and original balance/sequence/archive evidence unchanged. Adding lifecycle columns can restore the currently failing WS janitor query; default-null markers prevent deletion of unproved tables.

### A3. E2: TABLE fence activation, separate authorization

Do not apply E2 automatically after E1. Required evidence: read-only deployed Netlify/WS revision and writer-file digest comparison, existing `postTransaction` integration cases against E1 with fence active on disposable DB, owner-reported correct human/bot buy-in/cash-out/retry/lifecycle scenario using the target-compatible runtime, and no remaining writer relying on malformed table metadata. Audit actual Production TABLE producers in `ws-server/poker/persistence/chips-ledger.mjs`, `netlify/functions/_shared/chips-ledger.mjs` and callers; preserve error causes/ledger-proven funding.

E2 requires a session-scoped exact owner confirmation tied to Production identity and approved runtime evidence SHA, takes the Production advisory lock, verifies E1 catalog state/control OFF, activates through `chips_set_table_fence_active(true)`, then changes default bot_only_proof_eligible to true for **future** tables only. It records only its own migration version. Table insertion and the default transition share the migration transaction's table lock. Existing false values never become true. Owner checks relevant live scenario after activation and bounded journald; failed scenario blocks canary. No fallback disabling fence while destructive automation runs.

### A4. Reuse implementation boundaries

New `_shared/chips-ledger-retention-profile.mjs`: two frozen target profiles (identity, policy map, SQL routine/table names, lock key, per-run bounds), `resolveRetentionProfile`, `validateRetentionEnvironment`. Production is explicit, no generic env fallback. Stage public `validateStageEnvironment` still rejects Production credentials. Profile IDs are never inferred from arbitrary user strings; unsupported target/policy fails.

New `_shared/chips-ledger-retention-cycle.mjs`: move reusable implementations and their private dependency closure from Stage automation: `findOwnCycle`, `inspectDurableRecoveryState`, `persistDurableRecovery`, `assertDurableRecoveryReady`, `assertDurableRecoveryForEvidence`, `assertResumeRecoveryState`, `executeVerifiedCycle`, `resumeOwnCycle`, lock/identity helpers, `runAutomaticDryRunWithRetry`, `processClosedHumanAutomaticCycle` and its generic lifecycle verification, common bot automatic cycle/revalidation. Add a single `runRetentionCycle({profile,policy,mode,...})` dispatcher with at most one Production batch. Stage wrappers pass unchanged Stage profile/bounds and re-export existing public helper names for callers/tests. Keep `runBotOnlyRecoveryRepair`, batch15 constants, legacy modes and fixed Stage334 manual activation exclusively in Stage entry point; a Production import must not execute that CLI.

New `_shared/chips-ledger-escrow-retention.mjs`: move existing generic `classifyEscrowAccount`, `runWithRetirementRetry`, candidate validation, recovery snapshot/hash/verification, `verifyPrimaryArchiveAndDurableRecovery`, `ensureAccountRecoveryObject`, `runRetirementDatabaseFunction`, `fullyRevalidateCandidate` and bounded retirement loop from Stage escrow module. Pass profile and exact policy/canary state instead of Stage constants; preserve Stage wrapper exports and limits. Production uses bot-only allowed batch policy, 1 batch/2 accounts and Production lock/SQL names. Stage recovery CLI remains Stage-only; Production diagnostic verifies accounts through the same shared code.

New thin `scripts/ops/chips-ledger-production-automation.mjs`: exports `runProductionAutomation` and guarded CLI supporting `--policy existing-30d|bot-only-7d|closed-human-30d|escrow`, `--mode diagnostic|prepare|canary|automatic`, exact batch/account evidence arguments. `diagnostic` is read-only; `prepare` includes explicitly authorized Storage/proof writes, never implied by diagnostic. All mutations require scoped owner authorization; automated mode additionally requires enabled workflow/control/policy gates. No legacy, batch15 repair, arbitrary SQL or missing-table retirement mode.

Extend the **existing** three core scripts:

- Export: `resolveTarget`, `maxBatchSizeForTarget`, `resolveOptions`, `readSnapshot`, `runExport`, `buildManifest`; resolve target-bound policy constants/selector arguments. Retain SQL selection predicates, ordering/cursor and v1/v2 serialization. Policy literals in candidate SQL become bound approved profile parameters. Cap override cannot be arbitrary CLI/env; it comes from fresh verified activated DB control and Production profile hard ceiling. Manual default remains2.
- Store: `resolveStorageTarget`, `verifyLocalArchive`, `loadOrCreatePendingBatch`, `storeArchive`; allow Production policy manifest only with matching Production target, same bytes/object paths/immutable writes. No format fork or broad bucket allowlist.
- Prune: `targetPolicy`, `parseManifestRow`, `assertTargetIdentity`, `buildPruneEvidence`, `createPruneStore`, `pruneArchive`, `executeArchivePrune`; route approved Production bot/human policy to same safe algorithm/equivalent SQL, bind cap/control and reject cross-environment IDs before Storage writes/proof. Preserve manual cap2 and existing Stage APIs.

### A5. Workflow dark/off and credential isolation

Add `.github/workflows/chips-ledger-production-scheduled-automation.yml`, workflow_dispatch only, inputs policy/mode plus exact canary confirmation fields. No push/pull_request/schedule trigger. Checkout exact dispatch SHA; require main, canonical repository, no fork, protected `production-ledger` environment. Manual mutations: github.actor repository owner; scheduled automatic mode: owner or dedicated `CHIPS_LEDGER_PRODUCTION_DISPATCH_ACTOR`, only with enabled gate and fixed policy inputs. The dispatcher principal gets Actions write only, no DB/Storage credentials on VPS.

Production job secrets: `SUPABASE_PROD_DB_URL`, `SUPABASE_PROD_URL`, `SUPABASE_PROD_SERVICE_ROLE_KEY`. Expected project ref is versioned constant. Workflow variable `CHIPS_LEDGER_PRODUCTION_AUTOMATION_ENABLED` absent/0 denies automatic job before secrets, and is also passed to JS. No Stage keys, generic fallback creds or Stage management token. `DEPLOYED_COMMIT_SHA` must equal checked-out SHA. Concurrency `chips-ledger-production-automation`, cancel-in-progress=false, timeout60min; session lock is authoritative across external/manual entry points. No broad Production resource-monitoring framework is introduced; DB identity, bounded read-only baseline and query timeouts gate work.

Canary mode stays available only to owner with exact authorization while automatic variable is OFF. Off cannot mean canary mode silently performs generic scheduled work. Prepare cannot execute; diagnostic cannot persist proof/Storage/history.

## Between PR A and PR B — fresh evidence gate

See quickstart.md. Owner authorizes E1, then E2 after compatibility evidence, then each prepare and exact canary execute. All automatic controls stay OFF; cap2. Existing30d can use newly archived old eligible data (current selection count68). Bot/human canaries must respect complete-table/retention/fence facts; no historical bot backfill. Escrow canary uses fresh bot receipt with separate account set/hash authorization. Capture immutable archive/recovery proofs, no balance/sequence change, exact deletion deltas, retained idempotency replay or fenced replay denial, terminal marker and account receipt.

**PR B is blocked until every class PASS.** If no <=2 eligible table exists, wait for naturally aged fenced data. Do not create synthetic financial transactions or infer an owner authorization to create/age fixtures on Production.

## PR B — cap and activation, followed by authorized scheduler install

Add **E3** `supabase/production-migrations/20260914092000_chips_ledger_production_retention_activation.sql` and update manifest. Author its immutable expected canary IDs/table IDs/archive and recovery hashes from completed Production evidence, not placeholders. Under Production lock, validate E1/E2, fence active, current compatible runtime attestation, every fresh receipt and per-class GO; reject old batch1, Stage artifacts, partial receipt or changed account set. Activate Production singleton policies through owner-only functions, set automation control enabled=true/max_transactions=5000 atomically. The GitHub variable remains0 until owner separately enables scheduling. CLI reads fresh DB state; never simply change global `PRODUCTION_MAX_BATCH_SIZE` to5000 for arbitrary manual commands. Existing manual null-policy SQL calls remain2 through their wrapper/internal gate.

Add checked-in `infra/vps/production-retention/arcade-chips-ledger-production-dispatch.{sh,service,timer}`. These new files are not added to automatic installation by `infra-vps.yml`; existing infra merge may run its ordinary Caddy synchronization but must not activate retention. Dispatcher is installed to `/usr/local/bin/arcade-chips-ledger-production-dispatch.sh`, unit `arcade-chips-ledger-production-dispatch.timer`, copilot service. Use workflow file name, main ref and exact policy/mode, dedicated GitHub token outside repo; refuse disabled switch, unexpected workflow/main, non-successful activation state as reported by job. Check queued/in-progress jobs and local flock; uncertain API response logs failure and never loops/re-dispatches to drain backlog. Slots: daily02:09 existing, hourly:09 bot except02, :24 human, :39 escrow. Persistent=false (no catch-up runs), AccuracySec=1s. Only this timer schedules Production; Stage timer/cron untouched.

Owner separately authorizes E3, Production environment secrets/principal configuration, workflow switch=1 and timer installation/start. Observe one normal scheduled run per class (at most one batch each), verify exact target/SHA/receipts/locks and aggregate accounting. A no-candidate scheduled run proves delivery, not destructive canary behavior. Keep full data private; summary logs use klog with aggregate numbers and evidence hashes.

## Verification boundaries

Extend only existing suites:

- `tests/chips/chips.migration.test.mjs`: separate disposable Production-baseline+equivalent fixture, catalog/ACL/RLS + OFF/fence/cap gates + intentional history gaps. Never point mutation tests at Stage/Production. Local fixture may stub identity only in test setup; shipped SQL always calls real pg_control_system.
- `tests/chips/chips-ledger-table-metadata-fence.test.mjs`: current WS/Netlify writer compatibility, mismatched TABLE binding and closed/missing replay denial.
- `tests/chips/chips-ledger-archive-export.test.mjs`, `chips-ledger-archive-storage.test.mjs`, `chips-ledger-archive-pruning.test.mjs`: target/policy/cap2→5000 boundary, exact selection/immutable private recovery and already_pruned/unknown-result fail-closed.
- `tests/chips/chips-ledger-bot-only-retention.test.mjs`, `chips-ledger-closed-human-retention.test.mjs`, `chips-ledger-stage-escrow-retention.test.mjs`: reuse existing scenarios with Production profile for whole-table proof, USER exclusion/retention and empty escrow deletion/recovery, plus Stage remains isolated.
- `tests/chips/chips-ledger-stage-automation.test.mjs`, `chips-ledger-stage-automation.workflow.guard.test.mjs`: shared cycle single-flight/OFF/no-candidate/ambiguity and Production workflow credential/concurrency/one-policy gates. Extend existing workflow guard to read Production dispatcher files for unique scheduling ownership; no separate scheduler suite.

Use the existing `.github/workflows/tests.yml` PostgreSQL contract job for Production-equivalent fixture without external secrets; extend its existing migration-contract step as needed, no new integration framework. Required implementation checks: relevant existing fundamental suites with disposable DB env set (a skip is not PASS), `npm run syntax`, `npm test`, `npm run ci:guards`, `npm run check:all`, `npm run check:csp-inline`, `node scripts/check-db-migrations.mjs`, and diff whitespace check. No broad authenticated smoke by agent. Owner runs focused real scenario. Planning-only verification checks artifact completeness, inventory coverage/hashes, cross-artifact consistency and docs-only diff.

## Breaking impacts and recovery

- E1 changes Production schema/triggers/security contracts; incorrect SQL could block financial writes. Install fence OFF, inspect exact default/marker behavior and preserved history.
- E2 deliberately rejects invalid TABLE metadata/entry binding, and closed/missing-table replay; gate on actual deployed producers and owner runtime verification. New schema alone is not proof.
- E3 enables bounded irreversible deletion and cap2→5000 for policy-bound automation, including closed-human hot-history retention. Ledger economics and balances do not change.
- Scheduler activation is an explicit Production operational mutation, not implied by merge. Own concurrency/lock prevent overlapping classes and external manual operations.
- Emergency: set workflow switch0, disable timer, then owner-authorized DB control disable under lock. Allow in-flight atomic transaction to settle and inspect receipts; no forceful blind retry. Preserve fence while any cleanup can execute. If disabling fence is necessary to restore writers, disable all cleanup first and set new-table bot eligibility default false; reactivation requires another separately reviewed forward correction and fresh compatibility evidence.
- Do not down-migrate, restore stale balance snapshots, resurrect retired accounts or clear receipts. Recover exact archive into isolated diagnostic/recovery environment first; live restore is separate owner-authorized work.

## Review outcome

All architectural choices fixed. No new runtime/UI layer, generic migration runner, fake history repair, legacy Production cleanup API, extra Storage namespace or duplicate scheduler. Scope is larger than copying one Stage workflow because the 43-file migration gap contains security/lifecycle changes, but final apply is three explicit forward migrations across two PRs. Implementation agent may begin PR A; Production operations and PR B activation remain gated by fresh evidence and authorization.
