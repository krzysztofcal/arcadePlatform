# Implementation Plan: Production retention, two gated PRs

**Date**: 2026-10-14 (PR B refresh; PR A design retained below) · **Feature**: `004-production-retention`
**Working branch**: `feat/891-production-retention-pr-b` · **Spec**: [spec.md](spec.md)
**Main reviewed**: `2b212b795c1e0648d61ee8d06b1bb3d0b2ff164f`

## Summary

**Current scope (2026-10-15):** approved T020–T022 implementation and Draft PR B handoff. PR A sections are historical; do not repeat them. All canary gates PASS. Implementation does not authorize T023+ operations.

Prepare PR A with one forward-only Production final-schema equivalent, a separately applied TABLE-fence activation migration, minimal shared retention internals and dark Production workflow. Prepare PR B only after fresh Production canaries PASS: one exact-receipt activation migration, policy-bound cap 5000, owner-enabled workflow and dedicated VPS dispatch. Preserve Stage behavior and the existing archive/export/store/prune pipeline. No implementation or Production mutation is performed by this planning session.

## Technical Context

Node.js 20 ESM ops scripts, existing `postgres` package, PostgreSQL 17 Production/Stage, existing disposable PostgreSQL 16 CI contract service, private Supabase Storage, GitHub Actions and Ubuntu/systemd. No new dependencies. PostgreSQL session connection on 5432, max=1, prepare=false for operator orchestration; reject transaction pooling. One Production batch per invocation, no backlog loops; max2 transactions pre-activation, max5000 only for activated policy-bound runs, <=2 escrow accounts. Existing terminal lifecycle, USER-history boundaries, archive format and durable idempotency model remain authoritative. WS remains poker authority.

## Constitution Check (1.1.1, before/after design: PASS)

- Simplicity/reuse: existing pipeline retained; shared extraction limited to genuinely reused cycle/recovery/escrow internals; no policy framework, new migration runner or archive framework.
- Target safety: code/test/Draft PR only. Explicit owner authorization separately required for Production schema, fence, canary, activation, Storage writes and scheduler install. No merge by agent.
- Stage effect: **no shared Stage migration apply intended**. New Production SQL is outside `supabase/migrations/**`; existing migrations and `scripts/stage-db-migrate.mjs` remain untouched. Changes to shared JS must pass Stage fundamental regression suites. No workflow dispatch or live Stage cleanup is required for this implementation task.
- Tests: extend the existing boundary suites listed below, no UI/DOM/CSS/JSP/simple-glue tests, no new framework or speculative matrix.
- Compatibility: no browser change; future JSP JS would require global/IIFE, CSS one line per selector, klog instead of console.log, and script CSP SHA where applicable. None of those presentation files need changes here.
- Runtime evidence: CI is not integration proof. Existing adapters must pass disposable fence-on PostgreSQL tests, deployed sources must match, owner performs relevant manual smoke. If a writer actually changes in later implementation, exact-runtime-SHA WS Preview Deploy and user smoke are required. Docs-only planning requires no deploy/smoke.
- Breaking impacts explicit below. No ignore/config/dependency/setup cleanup beyond specifically named workflow, migration guard and Production scheduler artifacts.

## PR A — catch-up and dark/off automation

### A1. Migration layout and history

Add exactly this Production migration directory in the implementation PR (not now):

- `supabase/production-migrations/manifest.json`: baseline 54 applied versions, all 45 missing source versions/files/SHA256/category/disposition, E1/E2 order, expected target pair and shared-equivalence object checks. This is inventory metadata, not a second applied-history database.
- **E1** `supabase/production-migrations/20260914090000_chips_ledger_production_retention_contract.sql`.
- **E2** `supabase/production-migrations/20260914091000_chips_ledger_production_table_fence_activation.sql`.

Reserve these version names; if upstream already uses a reserved version at implementation start, stop the milestone and update all artifact references together before coding. Extend `scripts/check-db-migrations.mjs` to validate both directories, unique versions, hashes in manifest and exhaustive classification. Do not execute SQL in that guard. Standard Stage validation remains unchanged. Production apply uses individually authorized psql file application with ON_ERROR_STOP and a session lock, not directory globbing. E1/E2 contain BEGIN/COMMIT and strict Production identity assertions before DDL; record their own `schema_migrations` entry in the same successful transaction. History insert/check is conditional on matching own version/name and verified catalog state; unknown/partial existing state aborts. Never repair old Stage versions.

### A2. E1: final required schema, safe state

Compose final reviewed SQL bodies from the 99-version source-tree contract; do not execute textual patch chains on Production or regenerate SQL from live Stage at apply time. Preserve the source-to-object provenance in manifest. See data-model.md and per-file inventory.

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

**Current status (2026-10-14): all four canary classes PASS.** PR B planning is authorized; implementation T020–T022 and every Production operation still require the separate approvals below. Earlier PR A/no-candidate text is historical evidence, not pending work to repeat.

## PR B implementation plan — T020–T022 (review required)

**Scope now:** planning/documentation only. No SQL/source/unit files are created, no PR is opened, and no activation or install is authorized. `research.md` contains the exact 2/3/4 evidence matrix; the completed batch4 lifecycle gate removes the canary blocker. The live issue body still has an obsolete age BLOCKED paragraph; its 2026-10-14 PASS comment supersedes it. Update that body in the future reviewed T022 handoff, without closing #891.

### T020.1 — freeze exact evidence and E3 contract

Create only `supabase/production-migrations/20260914092000_chips_ledger_production_retention_activation.sql` after plan approval. E1/E2 and historical Stage migrations remain immutable. Current main inventory is 111 source migrations (54 baseline, 57 classified gaps: 20 shared-safe, 4 Stage-only, 33 equivalent-required) and 7 Production replacement files. E3 becomes the eighth replacement; it does not alter the 111 source inventory or fabricate omitted history. Its reserved version is currently unused; a collision or unclassified upstream migration stops implementation until reconciled.

Bind these immutable Production canaries as literals, using all hashes and receipt details in the current research matrix:

- existing-30d: batch2, format1, 2 transactions/4 entries, complete exact GO/proof/prune, two retained registry mappings; no registry cleanup receipt is required.
- bot-only-7d: batch3, format2, table `396a48fd-4b61-4992-8635-0820f3b68c74`, 2/4, complete GO/proof/prune and 2-key registry cleanup. The table is now absent after completed retention, and its escrow was retired; do not incorrectly require a live bot marker/escrow row. Use immutable bot proof, complete cleanup/account receipts and the archived zero-balance account snapshot to validate this terminal state.
- closed-human-30d: batch4, format1, table `7f3d73e4-36c5-4b66-afe6-d1d41bea13e2`, cutoff `2026-09-14T18:39:21.779Z`, 2/4, complete GO/proof/prune, two retained mappings and marker `2026-10-14T20:39:44.985066Z`. Null registry-cleanup receipts are expected.
- escrow: batch3, account `c29325f1-0715-453e-b090-fde88fa2ada7`, count1, exact account-set/recovery-object/snapshot hashes and retirement receipt from research. Require account absent/no hot references and correct recovered zero-balance snapshot, not a replacement human account.

Reject Stage IDs/policies, old manual batch1, changed table/cutoff/ID hashes, partial GO/receipts, missing human marker, hot canary IDs, changed retained binding, unknown history/catalog state and incomplete account recovery. Freshness applies to the preflight attestation, not the age of immutable historical canary receipts: do not require re-running approved canaries.

Before E3 authoring/apply, use existing `verifyArchiveBucket`, `readPrivateObjectIfExists`, `verifyArchiveBytes`, `buildPruneEvidence`, `inspectDurableRecovery` and escrow snapshot verification to download/verify private primary and both recovery copies. Preserve deterministic paths/MIME/bytes/SHA; no overwrite or new archive. SQL cannot verify Storage HTTP bytes, so E3 consumes a reviewed operator preflight attestation bound to the exact hashes, candidate receipts, implementation/runtime identities and observed time. No Storage client inside SQL or new evidence service.

Proposed exact owner interface: `chips_activate_production_retention(p_confirmation text, p_preflight_sha256 text, p_preflight_at timestamptz)`, owner-only, empty search_path and no PUBLIC/anon/authenticated/service_role execution. Confirmation is `ACTIVATE PRODUCTION RETENTION otbqfijerkieoxwpxjnm <preflight-sha256>`. The reviewed digest covers the immutable evidence matrix and current runtime/contract preflight; freshness window is at most 15 minutes and no future timestamp. Missing/expired attestation fails. The E3 file hash and implementation SHA are computed only after implementation; no placeholder is accepted as an operational approval.

E3 applies in one explicit transaction:

1. Check hardcoded project/system pair before changes, confirm actual E1/E2 history and tested contract/catalog/ACLs, and acquire the existing Production advisory lock. Busy/identity/history uncertainty aborts, not success no-op.
2. Lock global control, all three singleton policies, canary batches and applicable live human table/registry bindings in a fixed order. Require fenceON/globalOFF/cap2/policiesOFF and the exact existing canary pointers; revalidate attestation freshness and all immutable receipt/hash literals under lock.
3. Install only the narrowly required activation/automatic-cap routines below; preserve ownership, RLS, private internal-prune execution denials and existing economic/lifecycle predicates.
4. Set each existing policy's activation_go_at/activation_confirmation/activated_at using its current contract (bot CANARY3, human CANARY4, escrow CANARY3 plus account-set hash); retain original canary GO fields. Set global enabled=true/max_transactions=5000 and its activation evidence in the same transaction. Keep GitHub switch0 and timer uninstalled/disabled.
5. Record only E3 version in `supabase_migrations.schema_migrations` atomically. No old version repair or checksum-table bootstrap. A repeated applied E3 must validate its exact installed catalog/history and return verification only; it must not re-enable a subsequently disabled control. Reactivation requires another explicit owner approval/preflight.

Existing `chips_set_production_retention_enabled(false,2,'DISABLE PRODUCTION RETENTION')` remains the emergency disable path. Do not make ordinary manual enable requests bypass E3 evidence. No ledger/account/registry/receipt/table-cleanup mutation belongs to activation itself.

### T020.2 — resolve 5000 only in activated automatic context

Audit found actual blockers on main: `chips_assert_archive_prune_target(text,bigint)` and proof registration cap2; target-only JS export/store/prune caps2; Production export args/summary and human lifecycle validator hardcode2. Global enabled state alone currently lifts one SQL control check, which is too broad. Updating a single constant is unsafe and insufficient.

Keep Production `RETENTION_TARGETS.production.maxBatchSize/maxCanaryBatchSize=2` as the manual default. Add one small resolver in `scripts/ops/_shared/chips-ledger-retention-profile.mjs`, provisionally `resolveProductionAutomaticContext(profile,state,policyId)`, that validates canonical identity, E3/control5000, fence and selected policy activation. `runProductionArchiveCycle` reads that state through its established SQL session under the existing held lock (adapt `readProductionState` to reuse it); the resolver stays pure and does not create a profile/cycle circular dependency. Carry explicit mode/policy/target/bound through internal calls; it is not an env/arbitrary CLI cap override. Recheck it before DB writes and execute/retry. Missing or disabled state returns the existing disabled no-op before selection, or fails closed if a cycle is already partially prepared. Escrow remains one batch and at most2 accounts.

Required existing files/methods:

| File | Methods / minimal change |
|---|---|
| `scripts/ops/_shared/chips-ledger-retention-profile.mjs` | Keep manual defaults; resolve verified automatic policy context and effective bound. |
| `scripts/ops/chips-ledger-archive-export.mjs` | `maxBatchSizeForTarget`, `resolveOptions`, `readSnapshot`, `runExport`: accept only trusted automatic context5000; keep existing selectors/order/age/full-table checks and standalone manual2. |
| `scripts/ops/chips-ledger-archive-store.mjs` | `verifyLocalArchive`, `loadOrCreatePendingBatch`, `storeArchive`: carry the same bound/policy into byte/content validation and manifest registration; reject context/archive policy mismatch. |
| `scripts/ops/chips-ledger-archive-prune.mjs` | `targetPolicy`, `verifyRecoveryBundle`, `buildPruneEvidence`, `createPruneStore`, `pruneArchive`, `executeArchivePrune`: validate the same effective bound at proof/dry-run/recovery/execute/post-check; admit Production existing-30d automatic only via the protected adapter below. Preserve Stage behavior. |
| `scripts/ops/chips-ledger-production-automation.mjs` | `readProductionState`, `productionExportArgs`, `buildProductionExportInvocation`, `runProductionArchiveCycle`, active-batch assertion/resume helper, `assertProductionHumanPrunedBatch`, `finalizeProductionHumanLifecycle`, summary in `runProductionAutomation`: propagate actual automatic bound; manual prepare/canary/lifecycle stay2. Automatic human finalization/recovery must work above2, still requiring exact complete GO/proof/prune and marker. |
| `scripts/ops/_shared/chips-ledger-retention-cycle.mjs` | Only if needed to carry explicit context through existing recovery inspection/verification; no new cycle engine or changes to Stage defaults. |

SQL changes belong to E3, not edited E1:

- Preserve the existing two-argument target assertion and old public/manual proof/prune signatures as strict cap2 delegates. Add explicit automatic context to private/overloaded forms of `chips_assert_production_retention_control`, target assertion, `chips_register_archive_id_proof`, bot proof registration and internal prune; propagate it from protected automatic wrappers to the actual batch's source_policy_id. Do not let global enabled, an arbitrary policy string or a caller GUC alone lift manual cap. A null source policy is never coalesced into an automatic policy. API roles still cannot execute private/automatic financial routines, even after spoofing session settings.
- Keep one shared economic/prune implementation: if an overload is necessary, old signature delegates with automatic=false to the same core. Do not copy the financial logic into another framework. Reconcile all callers and ACLs in the existing disposable PostgreSQL fixture.
- Add the missing narrow `chips_auto_prune_production_existing_30d_archive_batch` adapter, analogous to existing bot/human adapters. It verifies canonical policy/activation/lock/exact IDs and complete proof, establishes the exact immutable batch GO through a narrow `chips_guard_archive_batch_mutations` transition, and delegates to the existing generic pruner. Current main has neither a valid existing-30d `--automatic` admission nor its automatic GO adapter; both must be fixed together.
- `createPruneStore().prune()` routes only verified Production existing-30d automatic context to that adapter. Existing manual/null-policy/canary entrypoints remain capped2. Keep bot/human automatic GO and lifecycle semantics; account retirement still caps2 accounts, not5000.

### T020.3 — bounded resume and finalization

Current `cycle.active` rejects automatic mode. Refactor the existing active assertion and `resumeProductionCanaryBatch` only enough to support activated automatic resume of one exact committed/proven/unpruned own batch with complete durable recovery. Reuse `inspectDurableRecovery`, `assertResumeRecoveryState`, exact dry-run proof checks, lock/identity/control revalidation and existing SQL adapters. Automatic skips owner `authorizeProductionBatch`; its protected SQL adapter establishes/verifies its own exact GO.

Resume does not export/store/register another proof, upload missing recovery or select a replacement batch. Pending, missing proof, partial/unknown recovery or receipt, foreign GO, multiple active batches and unknown commit outcome stop; diagnose the same receipt rather than repeat or create a batch. Known rollback SQLSTATE retries remain bounded by the existing helper. A partially prepared >2 automatic batch does not gain a manual cap bypass: any further repair needs a separate reviewed recovery authorization/design.

After human execute or resume, call `finalizeProductionHumanLifecycle` with the verified automatic bound. Already-pruned/missing-marker automatic resume completes only that marker and returns before new selection. Manual `lifecycle-completion` remains owner-gated/cap2 and explicit; completed manual CANARY retry never repeats pruning. One invocation processes at most one batch including recovery/resume.

### T020.4 — manifest and non-application guarantees

Update `supabase/production-migrations/manifest.json` with E3 file/version/actual SHA/prerequisites and evidence provenance; keep all earlier hashes immutable. Extend the existing `scripts/check-db-migrations.mjs` replacement allowlist from7 to8 without changing source categories/counts or executing SQL. Run it after rebasing on any newer main.

`.github/workflows/tests.yml` may apply E3 only to its existing disposable PostgreSQL fixture, with test-local identity substitution; no Production credentials or workflow dispatch. Production SQL stays outside `supabase/migrations/**`; `scripts/stage-db-migrate.mjs` and Stage apply workflow remain untouched. `.github/workflows/infra-vps.yml`, `infra/vps/bootstrap.sh` and install paths must never apply E3 or install/enable the new scheduler. Production workflow remains workflow_dispatch-only. A PR, CI or merge therefore cannot apply E3 or activate retention.

### T021 — one default-off Production scheduler

Add exactly these three deployable artifacts:

- `infra/vps/production-retention/arcade-chips-ledger-production-dispatch.sh`;
- `infra/vps/production-retention/arcade-chips-ledger-production-dispatch.service`;
- `infra/vps/production-retention/arcade-chips-ledger-production-dispatch.timer`.

No new package, broker, queue, config framework, installer, env-example or separate scheduler test suite. Put operator installation/token/disable instructions in existing quickstart.md. Do not change `infra/vps/stage-dispatch/*`, Stage cron/timer, bootstrap installation or automatic Infra apply.

Dispatcher contract:

1. Fixed repo `krzysztofcal/arcadePlatform`, workflow `chips-ledger-production-scheduled-automation.yml`, ref `main`, mode `automatic`. Only one policy selected from current UTC slot: daily02:09 existing-30d; hourly:09 bot-only except02; hourly:24 closed-human; hourly:39 escrow. Off-slot invocation is no-op; no missed-slot/backlog replay. 72 normal dispatch opportunities/day.
2. Missing/non-1 local `CHIPS_LEDGER_PRODUCTION_AUTOMATION_ENABLED` is OFF before API access. Remote workflow switch and DB activation are independent gates. Token/config provisioning happens only under T024 owner approval.
3. Service uses the existing copilot operator identity, root-protected external EnvironmentFile `/etc/arcadeplatform/production-retention-dispatch.env` (absent by default), isolated private `GH_CONFIG_DIR`, and explicit dedicated `GH_TOKEN`; never fall back to shared ambient gh login. Validate token actor is exactly `arcade-production-dispatch`. Token grants repo Actions write/read and metadata only, with no DB/Storage/WS secrets or administrative write scope. Do not print token/env or use shell tracing.
4. Hold nonblocking local flock in a dedicated RuntimeDirectory across guard and one dispatch request. Held lock or any active workflow yields a logged skip, without dispatch. Query the fixed workflow across all branches/modes/policies, not only automatic/selected policy. GitHub concurrency `cancel-in-progress:false` and the shared DB lock remain independent cross-host/manual safeguards.
5. Use bounded GET queries for each documented nonterminal status (`requested`, `waiting`, `pending`, `queued`, `in_progress`), checking validated total_count and workflow_runs. With per_page=1, zero requires count0 plus an empty array; nonzero always blocks, so pagination cannot hide an active run and scanning completed history is unnecessary. API/schema/auth/version/timeout uncertainty fails closed. Pin the currently documented Actions API version `2026-03-10`; no repeated POST after uncertain dispatch outcome. The [GitHub Actions API contract](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow) supplies these status semantics.
6. Recheck current UTC slot before the single dispatch after guards; if delayed out of slot, skip. Fixed argv supplies only policy and mode=automatic; no batch/confirmation/completion inputs. No DB operation in the dispatcher. Finite request/service timeouts; sanitized aggregate logs only.

Unit contract: oneshot service, external EnvironmentFile, fixed absolute ExecStart `/usr/local/bin/arcade-chips-ledger-production-dispatch.sh`, dedicated RuntimeDirectory/lock and private gh configuration. Timer `OnCalendar=*-*-* *:09,24,39:00 UTC`, `AccuracySec=1s`, no randomized delay, `Persistent=false`. T021 files are shipped but not installed/enabled by PR or CI. Operator separately installs this sole scheduling owner after E3/credentials approval.

Do not claim the active-run API guard eliminates every cross-host/eventual-consistency race. Single approved timer ownership, no retry, GitHub concurrency and receipt/DB-lock idempotency jointly limit risk. Long/incomplete runs intentionally skip later slots; no catch-up loop. A dispatcher API200/204 alone is not a completed retention run—T025 verifies exact dispatched SHA/job/receipt.

### T022 — fundamental validation and reviewed handoff

Extend existing suites only:

- `tests/chips/chips.migration.test.mjs`: disposable baseline+E1/E2/E3 activation success and whole-transaction rollback on wrong identity/GO/proof/hash/human marker/escrow snapshot/expired attestation; owners/search_path/ACL/RLS/history/no automatic apply. Real boundaries: manual3 denied before and after E3; automatic3/5000 admitted only for exact enabled policy/control;5001 denied; null/unknown policy and API GUC spoof denied. SQL adapters produce complete exact GO and immutable receipts without changing balances/sequences.
- `tests/chips/chips-ledger-archive-export.test.mjs`, `chips-ledger-archive-storage.test.mjs`, `chips-ledger-archive-pruning.test.mjs`: context propagation at all bounds, full-table no truncation, existing-30d automatic admission and protected routing, immutable bytes/SHA/recovery, disabled/mismatched context denial. No object-size or policy eligibility relaxation.
- `tests/chips/chips-ledger-stage-automation.test.mjs`: activated automatic limit/results, known safe same-batch resume without export/upload/new batch, missing/ambiguous recovery denial, control disable/lock loss, existing-30d GO, human lifecycle above2 and complete receipts before success; Stage/manual regression. Escrow existing suite retains account bound2/zero-balance/no-reference and exact recovery checks.
- `tests/chips/chips-ledger-stage-automation.workflow.guard.test.mjs`: read the three scheduler files and extend its current guards with focused fake-gh/date/lock cases for UTC02:09 vs other:09/:24/:39/off-slot, defaultOFF, token actor, held lock, each active status, malformed/failed API and uncertain dispatch (one attempt only). Assert no native cron, wrong repo/ref/mode, extra inputs, Stage scheduler changes or auto install through Infra/bootstrap. No UI/DOM/CSS/broad browser suite.
- Existing `.github/workflows/tests.yml` PostgreSQL contract step is sufficient; modify that step only if the E3 fixture invocation requires it. No new remote secrets/framework/CI deployment job.

Checks after implementation: these relevant existing suites with disposable DB env set (skip is not PASS for activation contracts), full npm test, syntax, CI guards, check:all, CSP check, migration hash inventory and whitespace. Current five unrelated XP-anchor failures remain a known baseline limitation if still reproducible; do not broaden PR B into UI fixes. T022 records actual pass/skip/failure, exact implementation/E3 hashes and separate pending operations; green CI is not rollout PASS.

T022 updates research.md/quickstart.md/tasks.md/plan.md (and current spec/data-model inventory/context as needed), removes current T018 BLOCKED while retaining dated failure evidence, and updates stale #891 body/status after the approved PR review handoff. Do not close #891: T023–T025 rollout/observation are still pending. Only after plan approval, implementation/tests and review, prepare Draft PR B. No agent merge.

### Owner gates and dependency order

| Gate | Required review / authorization | Permitted effect |
|---|---|---|
| P — approve this plan | Explicit approval of T020–T022 scope/files/tests | Implement/test and prepare Draft PR B only; no remote mutation. |
| M — PR B review/owner merge | Exact final code/E3 SHA, test evidence, impact and deployment-independent CI | Owner integrates code; neither merge nor CI applies E3. |
| T023 — exact E3 apply | Fresh <=15min target/history/catalog/runtime/control/canary/Storage preflight and exact file/hash/SHA confirmation | Apply only E3 under lock; verify policies/control5000, unchanged accounting/history. GitHub/local scheduler switches remain0. |
| T024-A — credential/principal provisioning | Protected production-ledger environment, dedicated actor/token and permissions reviewed | Configure dedicated Actions-only identity; no DB/Storage token on VPS dispatcher. |
| T024-B — scheduler install/enable | Separately reviewed script/unit hashes, single scheduling owner, E3 verified, Stage unchanged | Explicit install, local switch1, GitHub switch1 and timer start; observe normal slots. No native cron. |
| T025 — observe rollout | Normal scheduled invocation of each class, exact workflow SHA/identity/one-batch receipts and independent accounting checks | Record scheduling/destructive results and disable procedure; no backlog drain or implied additional smoke. |
| #992 — cleanup | Independent #992 pre-enable audit/deployed revision/review and fresh explicit owner GO | Only that separate issue may remove cleanup=0; not part of PR B activation. |

Dependencies: frozen PASS matrix → T020 SQL/context/pipeline + disposable tests → T021 static dispatcher/unit contracts → T022 validation/docs/Draft → owner M → T023 → T024-A/B → T025. Scheduler files can be authored after workflow/cap contract is fixed, but installation is never an implementation task. No T023+ work is implicitly authorized by T020–T022.

### Financial / breaking impact and limits

Activation widens destructive automatic scope from2 to5000 exact proven transactions, enables ledger/registry/empty-escrow cleanup under existing policies and intentionally shortens closed-human hot USER history. Incorrect role/cap/policy propagation can prune unauthorized financial history or block lawful transactions; account balances/entry sequences and conservation must remain invariant. Complete-table eligibility and durable recovery remain mandatory; private archive recovery is not automatic restoration to hot ledger.

Escrow scheduling preserves `PRODUCTION_ESCROW_CANDIDATE_SQL`: the bot table must be absent before retirement. Bot pruning marks completion but does not remove `poker_tables`; with #992 cleanup=0, new completed bot tables may remain and escrow runs may correctly report no-candidate. T025 records this dependency/backlog rather than weakening the selector or claiming new retirement PASS. Existing batch3 retirement remains valid. Any later table cleanup enabling is exclusively the separately authorized #992 gate.

Large archives can exceed current bucket size limits or hold locks longer. Do not increase object-size limits, split tables or relax retention to force progress. API outages, token expiry, ambiguous batches and missed slots stop/skip safely; capacity monitoring must distinguish these from true no-candidate runs. Only the four proven classes are covered; #889 broader ledger classes stay excluded, so bounded growth of all ledger history is not claimed.

Disable: owner-approved workflow/local switches0 and timer stop, then existing DB disable under the same lock/receipt review. Do not cancel/retry an uncertain commit blindly, alter proof/receipts, undo pruning or disable TABLE fence/reenable #992 cleanup. Preserve archives/registry and fix forward. Reactivation needs a new reviewed gate.

No WS/browser/protocol change is planned, so no WS deployment is required for code review. Any later expansion into those runtime files requires revised scope and exact-SHA runtime verification. PR B ships E3 and three scheduler artifacts for later owner review/application; it adds no dependency and performs no Production mutation.

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

All architectural choices fixed. No new runtime/UI layer, generic migration runner, fake history repair, legacy Production cleanup API, extra Storage namespace or duplicate scheduler. PR A already supplied the security/lifecycle equivalents; the current inventory classifies all57 gaps. PR B adds only E3, making three explicit forward migrations across the two PRs. PR A and the canary gates are complete. T020–T022 implementation was approved with the two P1 constraints below; T023+ Production operations remain separate owner gates.

## Approved review constraints — 2026-10-14

Implementation T020–T022 is authorized; Draft PR B only. No Production writes or T023+ operations.

**Effective cap:** manual remains maximum2 before and after E3, including exporter/store/pruner and the lowest SQL guards (`chips_assert_production_retention_control`). Automatic allows maximum5000 only with canonical Production identity, actual E3 activation, enabled global control, active TABLE fence, the exact enabled/authorized policy and privileged routine admission. GUC/env alone never authorize the higher cap. Fundamental tests cover2/5000/5001, manual after E3 and API/GUC spoofing.

**Storage evidence:** operator read-only preflight downloads the private immutable primary archive and both durable recovery objects (plus escrow snapshot), verifies bytes/SHA/privacy and binds them to exact DB identity/batch/proof/receipts. PL/pgSQL does not access Storage. E3 atomically revalidates DB pins under lock and accepts only a reviewed <=15min attestation; recheck Storage immediately before apply. This bounds but cannot eliminate external Storage TOCTOU; immutable no-overwrite paths and restricted credentials remain prerequisites. Any Storage unavailability or identity/hash/receipt drift invalidates the attestation and stops apply. Attestation is owner evidence, not a cryptographic claim that SQL fetched Storage.

## Implementation outcome — 2026-10-15

T020/T021 code is implemented using the existing pipeline and packages. E3 replaces financial method bodies with explicit-context overloads and strict manual delegates, so there remains one economic/prune core per method. Immutable E1/E2 are unchanged. Existing-30d receives the missing protected automatic GO adapter. Human resume/finalization confirms the lifecycle marker before success, including batches above2. Escrow account limit remains2 and its eligibility is unchanged.

E3 also fixes the existing disable-only function to clear activation fields when switching OFF (required by the original control CHECK), under the shared lock. Reapplying E3 never re-enables disabled control. Reviewed existing/new method source fingerprints stop contract drift before DDL; the existing disposable fixture substitutes only system identity.

Fundamental verification: 147 repository suites through `npm test` PASS; disposable real PostgreSQL migration/E3 suite PASS, including exact pins, stale attestation, proof/cutoff/recovery/marker/GO drift rollback, manual2/automatic5000/5001, actual automatic3 pruning with unchanged balances/sequences/retained mappings and replay. Relevant exporter/storage/pruner/automation/scheduler suites PASS. Syntax, CI guards, CSP, migration inventory and whitespace PASS. `check:all` retains five baseline XP-anchor violations in three luxury-lobby HTML designs and two design-spec HTML files; no UI fix is included. Separate authoritative-transport guard PASS. Remote PR CI results belong to the Draft PR; green CI never authorizes activation.

Whole-branch independent review found no P1; logged scheduler suppression reasons were added for lock/active-run/stale-slot cases. No WS/runtime/protocol changes, Stage migrations/scheduler edits, live dispatch, deployment or Production access/write was required during implementation.
