import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import postgres from "postgres";

import {
  BOT_ONLY_AUTOMATIC_MAX_BATCHES_PER_RUN,
  BOT_ONLY_AUTOMATIC_MAX_DRY_RUN_ATTEMPTS,
  assertAutomaticBotOnlyRecoveryReconstructionState,
  executeVerifiedCycle,
  runAutomaticBotOnlyStageAutomation,
} from "../../scripts/ops/chips-ledger-stage-automation.mjs";
import {
  buildLegacyBatchManifest,
  buildLegacyPlan,
  buildLegacyStageAllowlistRunContract,
  LEGACY_STAGE_ALLOWLIST_BATCH_COUNT,
  LEGACY_STAGE_ALLOWLIST_REMAINING_TABLE_COUNT,
  loadFrozenLegacyAllowlist,
} from "../../scripts/ops/chips-ledger-legacy-stage-allowlist.mjs";
import { runLegacyStageAllowlistOrchestrator } from "../../scripts/ops/chips-ledger-legacy-stage-allowlist-orchestrator.mjs";
import { LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13 } from "../../scripts/ops/chips-ledger-legacy-stage-allowlist-audit.mjs";
import {
  buildRecoveryManifest,
  createPruneStore,
} from "../../scripts/ops/chips-ledger-archive-prune.mjs";

const root = process.cwd();
const workflow = fs.readFileSync(".github/workflows/chips-ledger-stage-automation.yml", "utf8");
const orchestratorSource = fs.readFileSync(
  "scripts/ops/chips-ledger-legacy-stage-allowlist-orchestrator.mjs",
  "utf8",
);
const automationSource = fs.readFileSync(
  "scripts/ops/chips-ledger-stage-automation.mjs",
  "utf8",
);
const orchestrationMigration = fs.readFileSync(
  "supabase/migrations/20260825120000_chips_ledger_stage_cleanup_orchestration.sql",
  "utf8",
);
const lifecycleReceiptMigration = fs.readFileSync(
  "supabase/migrations/20260828100000_chips_ledger_bot_only_lifecycle_receipt_hardening.sql",
  "utf8",
);
const lifecycleMissingTableMigration = fs.readFileSync(
  "supabase/migrations/20260829100000_chips_ledger_bot_only_lifecycle_missing_table_hardening.sql",
  "utf8",
);
const legacyLifecycleCompletionMigration = fs.readFileSync(
  "supabase/migrations/20260831120000_chips_ledger_legacy_stage_lifecycle_completion.sql",
  "utf8",
);

const ENV = Object.freeze({
  SUPABASE_STAGE_DB_URL: "postgresql://postgres.krydukthwdvccggbyjfw:password@aws-0.pooler.supabase.com:5432/postgres",
  SUPABASE_STAGE_URL: "https://krydukthwdvccggbyjfw.supabase.co",
  SUPABASE_STAGE_SERVICE_ROLE_KEY: "stage-test-key",
  DEPLOYED_COMMIT_SHA: "f".repeat(40),
  CHIPS_LEDGER_BOT_ONLY_AUTOMATIC: "1",
});

function manifestSelectRowFromSchedulerRow(row) {
  const asText = (value) => value == null ? null : String(value);
  return {
    object_path: row.object_path,
    batch_id: asText(row.batch_id),
    project_ref: row.project_ref,
    format_version: asText(row.format_version),
    cutoff: asText(row.cutoff),
    cursor_start_created_at: asText(row.cursor_start_created_at),
    cursor_start_id: asText(row.cursor_start_id),
    cursor_end_created_at: asText(row.cursor_end_created_at),
    cursor_end_id: asText(row.cursor_end_id),
    first_created_at: asText(row.first_created_at),
    last_created_at: asText(row.last_created_at),
    transaction_count: asText(row.transaction_count),
    entry_count: asText(row.entry_count),
    tx_types: row.tx_types == null
      ? null
      : typeof row.tx_types === "string" ? row.tx_types : JSON.stringify(row.tx_types),
    raw_bytes: asText(row.raw_bytes),
    compressed_bytes: asText(row.compressed_bytes),
    raw_sha256: row.raw_sha256,
    compressed_sha256: row.compressed_sha256,
    credits: asText(row.credits),
    debits: asText(row.debits),
    net_amount: asText(row.net_amount),
    status: row.status,
    committed_at: asText(row.committed_at),
    source_policy_id: row.source_policy_id,
    archived_transaction_ids_sha256: row.archived_transaction_ids_sha256,
    archived_entry_ids_sha256: row.archived_entry_ids_sha256,
    archive_proof_verified_at: asText(row.archive_proof_verified_at),
    pruned_at: asText(row.pruned_at),
    pruned_transaction_count: asText(row.pruned_transaction_count),
    pruned_entry_count: asText(row.pruned_entry_count),
    pruned_transaction_ids_sha256: row.pruned_transaction_ids_sha256,
    pruned_entry_ids_sha256: row.pruned_entry_ids_sha256,
    bot_only_table_id: asText(row.bot_only_table_id),
    bot_only_table_count: asText(row.bot_only_table_count),
    bot_only_newest_created_at: asText(row.bot_only_newest_created_at),
    bot_only_registry_keys_sha256: row.bot_only_registry_keys_sha256,
    bot_only_out_of_scope_keys_sha256: row.bot_only_out_of_scope_keys_sha256,
    bot_only_identity_count: asText(row.bot_only_identity_count),
    bot_only_eligible_count: asText(row.bot_only_eligible_count),
    registry_cleaned_at: asText(row.registry_cleaned_at),
    registry_cleaned_key_count: asText(row.registry_cleaned_key_count),
    registry_cleaned_keys_sha256: row.registry_cleaned_keys_sha256,
    bot_only_table_exists: row.bot_only_table_exists === true,
    bot_only_retention_complete_at: asText(row.bot_only_retention_complete_at),
    legacy_allowlist_sha256: row.legacy_allowlist_sha256,
    legacy_batch_table_ids_sha256: row.legacy_batch_table_ids_sha256,
    legacy_master_table_ids: row.legacy_master_table_ids ?? null,
    legacy_master_table_count: asText(row.legacy_master_table_count),
    legacy_batch_number: asText(row.legacy_batch_number),
    legacy_batch_table_count: asText(row.legacy_batch_table_count),
    legacy_source_run: row.legacy_source_run,
    legacy_query_sha256: row.legacy_query_sha256,
    legacy_stage_system_identifier: row.legacy_stage_system_identifier,
    legacy_run_id: asText(row.legacy_run_id),
    legacy_plan_sha256: row.legacy_plan_sha256,
    destructive_go_at: asText(row.destructive_go_at),
    destructive_go_batch_id: asText(row.destructive_go_batch_id),
  };
}

function fakeScheduler({
  enabled = true,
  candidateCount = 3,
  blockingAfter = null,
  failExecuteOnce = false,
  failDownloadBeforeRecovery = false,
  realExecute = false,
  initialRows = [],
  initialDurable = new Map(),
  initialArchiveBytes = new Map(),
  inspectRecovery = null,
  mainArchiveMode = "valid",
  dryRunSqlstates = [],
  executeSqlstates = [],
  executeAlreadyCleanedAfterFailure = false,
} = {}) {
  const manifests = new Map(initialRows.map((row) => [row.object_path, row]));
  const ownRows = [...initialRows];
  const durable = new Map(initialDurable);
  const archiveBytesByPath = new Map();
  for (const [objectPath, bytes] of initialArchiveBytes) archiveBytesByPath.set(objectPath, Buffer.from(bytes));
  const executionCounts = new Map();
  const state = {
    candidateCalls: 0,
    storeCalls: 0,
    executeCalls: 0,
    realExecuteCalls: 0,
    executeAttemptCalls: 0,
    executeRetryPreflights: 0,
    executeRetryWaits: 0,
    destructiveSqlMutations: 0,
    advisoryLockChecks: 0,
    failedOnce: false,
    mainArchiveDownloads: 0,
    dryRunArchiveDownloads: 0,
    dryRunManifestReads: 0,
    dryRunCalls: 0,
    activeDryRunArchiveDownloads: 0,
    activeDryRunManifestReads: 0,
    activeDryRunCalls: 0,
    persistCalls: 0,
    proofRegisterCalls: 0,
    recoveryInspections: 0,
  };

  const evidence = (tableId, key) => ({
    transactionCount: 1,
    entryCount: 2,
    transactionIdsSha256: "3".repeat(64),
    entryIdsSha256: "4".repeat(64),
    txTypes: { TABLE_BUY_IN: 1 },
    credits: "100",
    debits: "100",
    net: "0",
    registryKeys: [key],
    registryKeysSha256: "1".repeat(64),
    tableId,
    distinctTables: 1,
    outOfScopeKeysSha256: "2".repeat(64),
  });

  const sql = {
    unsafe: async (query) => {
      if (query.includes("pg_try_advisory_lock")) return [{ backend_pid: "100", acquired: true }];
      if (query.includes("pg_backend_pid")) {
        state.advisoryLockChecks += 1;
        return [{ backend_pid: "100" }];
      }
      if (query.includes("pg_advisory_unlock")) return [{ pg_advisory_unlock: true }];
      if (query.includes("pg_control_system")) return [{ system_identifier: "7656985631720456337" }];
      if (query.includes("chips_table_fence_is_active")) return [{ active: true }];
      if (query.includes("chips_table_fence_control")) return [{ enforcement_active: true }];
      if (query.includes("chips_stage_bot_only_retention_policy")) {
        return enabled
          ? [{ policy_id: "stage-ledger-bot-only-retention-7d-v1", enabled: true, activated_at: "2026-08-25T00:00:00Z", canary_batch_id: "1" }]
          : [{ policy_id: "stage-ledger-bot-only-retention-7d-v1", enabled: false, activated_at: null, canary_batch_id: null }];
      }
      if (query.includes("from public.chips_ledger_archive_batches")) return ownRows;
      throw new Error(`unexpected fake scheduler SQL: ${query}`);
    },
  };

  const manifestSql = {
    unsafe: async (query, values) => {
      if (!query.includes("from public.chips_ledger_archive_batches batches")) {
        throw new Error(`unexpected fake manifest SQL: ${query}`);
      }
      assert.match(
        query,
        /exists\s*\(\s*select 1\s+from public\.poker_tables tables\s+where tables\.id = batches\.bot_only_table_id\s*\)\s+as bot_only_table_exists/s,
      );
      assert.match(query, /where tables\.id = batches\.bot_only_table_id/);
      assert.match(query, /where batches\.object_path = \$1/);
      const row = manifests.get(values?.[0]);
      return row ? [manifestSelectRowFromSchedulerRow(row)] : [];
    },
    begin: async (callback) => callback(manifestSql),
  };
  const productionPruneStore = createPruneStore(manifestSql);
  const pruneStore = {
    getManifest: async (objectPath) => productionPruneStore.getManifest(objectPath),
  };

  const deps = {
    sql,
    pruneStore,
    storageTarget: {
      target: "stage",
      projectRef: "krydukthwdvccggbyjfw",
      baseUrl: "https://storage.example.test",
      serviceKey: "stage-test-key",
    },
    verifyBucket: async () => {},
    ensureArchiveBucket: async () => {},
    exportArchive: async () => {
      if (state.candidateCalls >= candidateCount) {
        return {
          noCandidate: true,
          blockingAnomalies: blockingAfter !== null && state.candidateCalls >= blockingAfter
            ? [{ code: "candidate_anomaly" }]
            : [],
          options: { projectRef: "krydukthwdvccggbyjfw" },
        };
      }
      state.candidateCalls += 1;
      return { noCandidate: false, bytes: { raw: 10 } };
    },
    storeArchive: async () => {
      const index = state.storeCalls;
      state.storeCalls += 1;
      const archiveBytes = Buffer.from(`archive-${index}`);
      const compressedSha = crypto.createHash("sha256").update(archiveBytes).digest("hex");
      const objectPath = `v1/sha256/${compressedSha}.jsonl.gz`;
      const tableId = `00000000-0000-4000-8000-${String(200 + index).padStart(12, "0")}`;
      const row = {
        object_path: objectPath,
        project_ref: "krydukthwdvccggbyjfw",
        source_policy_id: "stage-ledger-bot-only-retention-7d-v1",
        status: "committed",
        batch_id: String(100 + index),
        format_version: 2,
        cutoff: "2026-08-18T00:00:00.000Z",
        cursor_start_created_at: null,
        cursor_start_id: null,
        cursor_end_created_at: null,
        cursor_end_id: null,
        first_created_at: "2026-08-17T00:00:00.000Z",
        last_created_at: "2026-08-17T00:00:00.000Z",
        transaction_count: 1,
        entry_count: 2,
        tx_types: { TABLE_BUY_IN: 1 },
        compressed_sha256: compressedSha,
        compressed_bytes: archiveBytes.length,
        raw_bytes: 10,
        raw_sha256: "d".repeat(64),
        credits: "100",
        debits: "100",
        net_amount: "0",
        committed_at: "2026-08-25T00:00:00Z",
        archived_transaction_ids_sha256: null,
        archived_entry_ids_sha256: null,
        archive_proof_verified_at: null,
        pruned_at: null,
        pruned_transaction_count: null,
        pruned_entry_count: null,
        pruned_transaction_ids_sha256: null,
        pruned_entry_ids_sha256: null,
        registry_cleaned_at: null,
        registry_cleaned_key_count: null,
        registry_cleaned_keys_sha256: null,
        bot_only_table_id: tableId,
        bot_only_table_count: 1,
        bot_only_newest_created_at: "2026-08-17T00:00:00.000Z",
        bot_only_identity_count: 1,
        bot_only_eligible_count: 1,
        bot_only_registry_keys_sha256: "1".repeat(64),
        bot_only_out_of_scope_keys_sha256: "2".repeat(64),
        bot_only_table_exists: true,
        destructive_go_at: null,
        destructive_go_batch_id: null,
      };
      manifests.set(objectPath, row);
      archiveBytesByPath.set(objectPath, archiveBytes);
      ownRows.unshift(row);
      return { objectPath, manifest: row, object: { uploaded: true } };
    },
    pruneArchive: async ({ argv, deps: pruneDeps = {} }) => {
      const objectPath = argv[argv.indexOf("--object-path") + 1];
      const row = manifests.get(objectPath);
      if (argv.includes("--register-proof")) {
        state.proofRegisterCalls += 1;
        row.archived_transaction_ids_sha256 = "3".repeat(64);
        row.archived_entry_ids_sha256 = "4".repeat(64);
        row.archive_proof_verified_at = "2026-08-25T00:00:00Z";
        return { state: "proof_registered" };
      }
      if (!argv.includes("--execute")) {
        state.dryRunCalls += 1;
        state.dryRunManifestReads += 1;
        if (!row.registry_cleaned_at) {
          state.activeDryRunCalls += 1;
          state.activeDryRunManifestReads += 1;
        }
        const freshRow = await deps.pruneStore.getManifest(objectPath);
        assert.equal(freshRow.object_path, objectPath);
        const downloaded = await deps.downloadPrivateArchive(deps.storageTarget, objectPath);
        state.dryRunArchiveDownloads += 1;
        if (!row.registry_cleaned_at) state.activeDryRunArchiveDownloads += 1;
        assert.equal(downloaded.sha256, crypto.createHash("sha256").update(downloaded.bytes).digest("hex"));
        const sqlstate = dryRunSqlstates[state.dryRunCalls - 1];
        if (sqlstate) {
          const error = new Error(`simulated dry-run ${sqlstate}`);
          error.code = sqlstate;
          throw error;
        }
        if (row.registry_cleaned_at) {
          return {
            state: "already_cleaned",
            evidence: evidence(row.bot_only_table_id, "key:" + row.batch_id),
            archiveSha256: downloaded.sha256,
          };
        }
        return {
          state: "ready",
          evidence: evidence(row.bot_only_table_id, "key:" + row.batch_id),
          archiveSha256: downloaded.sha256,
        };
      }
      if (argv.includes("--execute") && realExecute) {
        state.realExecuteCalls += 1;
        let executeAttempts = 0;
        let executeRetryCount = 0;
        const executeSqlstatesSeen = [];
        const metrics = () => ({
          executeAttempts,
          executeRetryCount,
          executeSqlstates: [...executeSqlstatesSeen],
        });
        const annotate = (error) => Object.assign(error, metrics());
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          if (attempt > 1) {
            state.executeRetryPreflights += 1;
            const preflight = await pruneDeps.beforeExecuteRetry?.({
              attempt,
              previousAttempts: executeAttempts,
              executeRetryCount,
              executeSqlstates: [...executeSqlstatesSeen],
              row,
              evidence: evidence(row.bot_only_table_id, "key:" + row.batch_id),
              recoveryBundle: null,
            });
            if (preflight?.state === "already_cleaned") {
              return { ...preflight, ...metrics() };
            }
          }
          executeAttempts += 1;
          state.executeAttemptCalls += 1;
          const sqlstate = executeSqlstates[state.executeAttemptCalls - 1];
          if (sqlstate) {
            executeSqlstatesSeen.push(sqlstate);
            const error = new Error(`simulated execute ${sqlstate}`);
            error.code = sqlstate;
            pruneDeps.onExecuteProgress?.({ ...metrics(), error, row });
            if (executeAlreadyCleanedAfterFailure && !row.registry_cleaned_at) {
              state.destructiveSqlMutations += 1;
              row.pruned_at = "2026-08-25T00:00:01Z";
              row.pruned_transaction_count = "1";
              row.pruned_entry_count = "2";
              row.pruned_transaction_ids_sha256 = row.archived_transaction_ids_sha256;
              row.pruned_entry_ids_sha256 = row.archived_entry_ids_sha256;
              row.registry_cleaned_at = "2026-08-25T00:00:02Z";
              row.registry_cleaned_key_count = "1";
              row.registry_cleaned_keys_sha256 = "1".repeat(64);
              row.bot_only_retention_complete_at = "2026-08-25T00:00:03Z";
              row.destructive_go_at = "2026-08-25T00:00:00Z";
              row.destructive_go_batch_id = row.batch_id;
            }
            if (!["40001", "55P03"].includes(sqlstate) || attempt === 3) {
              throw annotate(error);
            }
            executeRetryCount += 1;
            state.executeRetryWaits += 1;
            await pruneDeps.waitForExecuteRetry?.({
              attempt,
              nextAttempt: attempt + 1,
              delayMs: 0,
              sqlstate,
              ...metrics(),
            });
            continue;
          }
          const wasAlreadyCleaned = Boolean(row.registry_cleaned_at);
          if (!wasAlreadyCleaned) {
            state.destructiveSqlMutations += 1;
            row.pruned_at = "2026-08-25T00:00:01Z";
            row.pruned_transaction_count = "1";
            row.pruned_entry_count = "2";
            row.pruned_transaction_ids_sha256 = row.archived_transaction_ids_sha256;
            row.pruned_entry_ids_sha256 = row.archived_entry_ids_sha256;
            row.registry_cleaned_at = "2026-08-25T00:00:02Z";
            row.registry_cleaned_key_count = "1";
            row.registry_cleaned_keys_sha256 = "1".repeat(64);
            row.bot_only_retention_complete_at = "2026-08-25T00:00:03Z";
            row.destructive_go_at = "2026-08-25T00:00:00Z";
            row.destructive_go_batch_id = row.batch_id;
          }
          const stateValue = wasAlreadyCleaned ? "already_cleaned" : "cleaned";
          pruneDeps.onExecuteProgress?.({
            ...metrics(),
            row,
            result: { state: stateValue },
          });
          return {
            state: stateValue,
            row,
            evidence: evidence(row.bot_only_table_id, "key:" + row.batch_id),
            ...metrics(),
          };
        }
        throw new Error("fake execute retry loop exhausted");
      }
      if (row.registry_cleaned_at) {
        return {
          state: "already_cleaned",
          evidence: evidence(row.bot_only_table_id, "key:" + row.batch_id),
          archiveSha256: row.compressed_sha256,
        };
      }
      return {
        state: "ready",
        evidence: evidence(row.bot_only_table_id, "key:" + row.batch_id),
        archiveSha256: row.compressed_sha256,
      };
    },
    inspectDurableRecovery: inspectRecovery || (async (_target, row) => {
      state.recoveryInspections += 1;
      return durable.get(row.object_path) || null;
    }),
    persistDurableRecovery: async (_target, row, identity, rowEvidence, archiveBytes) => {
      state.persistCalls += 1;
      const recoveryArchivePath = `recovery/v1/sha256/${row.compressed_sha256}.jsonl.gz`;
      const recoveryManifestPath = `recovery/v1/sha256/${row.compressed_sha256}.recovery.json.gz`;
      const manifest = buildRecoveryManifest(row, identity, rowEvidence, { target: "stage" });
      const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
      const manifestGzipBytes = gzipSync(manifestBytes, { level: 9, mtime: 0 });
      const manifestSha256 = crypto.createHash("sha256").update(manifestGzipBytes).digest("hex");
      const archiveSha256 = crypto.createHash("sha256").update(archiveBytes).digest("hex");
      const value = {
        archiveBytes,
        manifestBytes,
        manifestGzipBytes,
        manifest,
        archivePath: recoveryArchivePath,
        manifestPath: recoveryManifestPath,
        archiveSha256,
        manifestSha256,
        recoveryArchive: { objectPath: recoveryArchivePath, uploaded: true, sha256: row.compressed_sha256 },
        recoveryManifest: { objectPath: recoveryManifestPath, uploaded: true, sha256: manifestSha256 },
      };
      durable.set(row.object_path, value);
      return value;
    },
    downloadPrivateArchive: async (_target, objectPath) => {
      state.mainArchiveDownloads += 1;
      if (failDownloadBeforeRecovery) throw new Error("simulated main archive download failure");
      const bytes = archiveBytesByPath.get(objectPath);
      if (!bytes) throw new Error("simulated main archive missing");
      const downloadedBytes = mainArchiveMode === "foreign" ? Buffer.from("foreign main archive") : bytes;
      return {
        bytes: downloadedBytes,
        sha256: crypto.createHash("sha256").update(downloadedBytes).digest("hex"),
        downloadMs: 0,
      };
    },
    executeVerifiedCycle: realExecute ? undefined : async ({ row }) => {
      const storedRow = manifests.get(row.object_path) || row;
      state.executeCalls += 1;
      const count = (executionCounts.get(storedRow.object_path) || 0) + 1;
      executionCounts.set(storedRow.object_path, count);
      if (failExecuteOnce && !state.failedOnce) {
        state.failedOnce = true;
        executionCounts.set(storedRow.object_path, count - 1);
        throw new Error("simulated interruption between batches");
      }
      if (count === 1) {
        storedRow.pruned_at = "2026-08-25T00:00:01Z";
        storedRow.pruned_transaction_count = "1";
        storedRow.pruned_entry_count = "2";
        storedRow.pruned_transaction_ids_sha256 = storedRow.archived_transaction_ids_sha256;
        storedRow.pruned_entry_ids_sha256 = storedRow.archived_entry_ids_sha256;
        storedRow.registry_cleaned_at = "2026-08-25T00:00:02Z";
        storedRow.registry_cleaned_key_count = "1";
        storedRow.registry_cleaned_keys_sha256 = "1".repeat(64);
        storedRow.bot_only_retention_complete_at = "2026-08-25T00:00:03Z";
        storedRow.destructive_go_at = "2026-08-25T00:00:00Z";
        storedRow.destructive_go_batch_id = storedRow.batch_id;
        return {
          state: "cleaned",
          evidence: evidence(storedRow.bot_only_table_id, "key:" + storedRow.batch_id),
          executeAttempts: 1,
          executeRetryCount: 0,
          executeSqlstates: [],
        };
      }
      return {
        state: "already_cleaned",
        evidence: evidence(storedRow.bot_only_table_id, "key:" + storedRow.batch_id),
        executeAttempts: 1,
        executeRetryCount: 0,
        executeSqlstates: [],
      };
    },
  };

  return { env: { ...ENV }, deps, state, manifests, durable, ownRows };
}

function makeProvenAutomaticRow(batchId = "27", { lifecycle = "open" } = {}) {
  const archiveBytes = Buffer.from(`proven-archive-${batchId}`);
  const compressedSha = crypto.createHash("sha256").update(archiveBytes).digest("hex");
  const tableId = `00000000-0000-4000-8000-${String(batchId).padStart(12, "0")}`;
  const row = {
    object_path: `v1/sha256/${compressedSha}.jsonl.gz`,
    project_ref: "krydukthwdvccggbyjfw",
    source_policy_id: "stage-ledger-bot-only-retention-7d-v1",
    status: "committed",
    batch_id: String(batchId),
    format_version: 2,
    cutoff: "2026-08-18T00:00:00.000Z",
    cursor_start_created_at: null,
    cursor_start_id: null,
    cursor_end_created_at: null,
    cursor_end_id: null,
    first_created_at: "2026-08-17T00:00:00.000Z",
    last_created_at: "2026-08-17T00:00:00.000Z",
    transaction_count: 1,
    entry_count: 2,
    tx_types: { TABLE_BUY_IN: 1 },
    raw_bytes: 10,
    compressed_bytes: archiveBytes.length,
    raw_sha256: "d".repeat(64),
    compressed_sha256: compressedSha,
    credits: "100",
    debits: "100",
    net_amount: "0",
    committed_at: "2026-08-25T00:00:00Z",
    archive_proof_verified_at: "2026-08-25T00:00:00Z",
    archived_transaction_ids_sha256: "3".repeat(64),
    archived_entry_ids_sha256: "4".repeat(64),
    pruned_at: null,
    pruned_transaction_count: null,
    pruned_entry_count: null,
    pruned_transaction_ids_sha256: null,
    pruned_entry_ids_sha256: null,
    bot_only_table_id: tableId,
    bot_only_table_count: 1,
    bot_only_newest_created_at: "2026-08-17T00:00:00.000Z",
    bot_only_registry_keys_sha256: "1".repeat(64),
    bot_only_out_of_scope_keys_sha256: "2".repeat(64),
    bot_only_identity_count: 1,
    bot_only_eligible_count: 1,
    registry_cleaned_at: null,
    registry_cleaned_key_count: null,
    registry_cleaned_keys_sha256: null,
    bot_only_table_exists: true,
    bot_only_retention_complete_at: null,
    destructive_go_at: null,
    destructive_go_batch_id: null,
  };
  if (lifecycle === "go") {
    row.destructive_go_at = "2026-08-25T00:00:00Z";
    row.destructive_go_batch_id = row.batch_id;
  }
  if (lifecycle === "complete") {
    Object.assign(row, {
      pruned_at: "2026-08-25T00:00:01Z",
      pruned_transaction_count: 1,
      pruned_entry_count: 2,
      pruned_transaction_ids_sha256: row.archived_transaction_ids_sha256,
      pruned_entry_ids_sha256: row.archived_entry_ids_sha256,
      registry_cleaned_at: "2026-08-25T00:00:02Z",
      registry_cleaned_key_count: 1,
      registry_cleaned_keys_sha256: row.bot_only_registry_keys_sha256,
      bot_only_retention_complete_at: "2026-08-25T00:00:03Z",
      destructive_go_at: "2026-08-25T00:00:00Z",
      destructive_go_batch_id: row.batch_id,
    });
  }
  return { row, archiveBytes };
}

function makeTestAutomaticEvidence(row) {
  return {
    transactionCount: 1,
    entryCount: 2,
    transactionIdsSha256: row.archived_transaction_ids_sha256,
    entryIdsSha256: row.archived_entry_ids_sha256,
    txTypes: row.tx_types,
    credits: row.credits,
    debits: row.debits,
    net: row.net_amount,
    registryKeys: ["key:" + row.batch_id],
    registryKeysSha256: row.bot_only_registry_keys_sha256,
    tableId: row.bot_only_table_id,
    distinctTables: 1,
    outOfScopeKeysSha256: row.bot_only_out_of_scope_keys_sha256,
  };
}

function makeTestAutomaticDurableRecovery(row, archiveBytes) {
  const evidence = makeTestAutomaticEvidence(row);
  const manifest = buildRecoveryManifest(row, "7656985631720456337", evidence, { target: "stage" });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  const manifestGzipBytes = gzipSync(manifestBytes, { level: 9, mtime: 0 });
  const manifestSha256 = crypto.createHash("sha256").update(manifestGzipBytes).digest("hex");
  const archiveSha256 = crypto.createHash("sha256").update(archiveBytes).digest("hex");
  const archivePath = `recovery/v1/sha256/${row.compressed_sha256}.jsonl.gz`;
  const manifestPath = `recovery/v1/sha256/${row.compressed_sha256}.recovery.json.gz`;
  return {
    archiveBytes,
    manifestBytes,
    manifestGzipBytes,
    manifest,
    archivePath,
    manifestPath,
    archiveSha256,
    manifestSha256,
    recoveryArchive: { objectPath: archivePath, uploaded: true, sha256: archiveSha256 },
    recoveryManifest: { objectPath: manifestPath, uploaded: true, sha256: manifestSha256 },
  };
}

async function captureAutomaticFailure(scheduler) {
  const originalStdoutWrite = process.stdout.write;
  const originalSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  let output = "";
  delete process.env.GITHUB_STEP_SUMMARY;
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  let error = null;
  try {
    await runAutomaticBotOnlyStageAutomation(scheduler);
  } catch (caught) {
    error = caught;
  } finally {
    process.stdout.write = originalStdoutWrite;
    if (originalSummaryPath === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = originalSummaryPath;
  }
  assert.ok(error, "automatic scheduler must fail");
  return { error, report: JSON.parse(output.trim()) };
}

function staticOrchestrationContract() {
  const frozen = loadFrozenLegacyAllowlist({ cwd: root });
  const contract = buildLegacyStageAllowlistRunContract(frozen.masterManifest);
  assert.equal(LEGACY_STAGE_ALLOWLIST_BATCH_COUNT, 98);
  assert.equal(contract.remainingTableCount, LEGACY_STAGE_ALLOWLIST_REMAINING_TABLE_COUNT);
  assert.equal(contract.remainingTableCount, 964);
  assert.equal(contract.firstBatchNumber, 2);
  assert.equal(contract.lastBatchNumber, 98);
  assert.equal(contract.batchCount, 97);
  assert.equal(contract.masterAllowlistSha256, "611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05");
  assert.equal(contract.planSha256, "f6521e7bb892c1ea3ddb566bed86bf7cac48cb305823c4c682957ef6db2d100b");
  assert.equal(contract.remainingTableIdsSha256, "a7bd1aea6bfe0435609cce6ccbe78f9ba55cab062e3cf55fd933fade5f029fc8");
  assert.equal(buildLegacyBatchManifest(frozen.masterManifest, { batchNumber: 2 }).batch_table_count, 10);
  assert.equal(buildLegacyBatchManifest(frozen.masterManifest, { batchNumber: 98 }).batch_table_count, 4);
  const batchPlan = buildLegacyPlan(
    frozen.masterManifest,
    buildLegacyBatchManifest(frozen.masterManifest, { batchNumber: 2 }),
    { runId: "7", runPlanSha256: contract.planSha256 },
  );
  assert.equal(batchPlan.batchNumber, 2);
  assert.equal(batchPlan.runId, "7");
  assert.equal(batchPlan.runPlanSha256, contract.planSha256);
  assert.throws(
    () => buildLegacyBatchManifest(frozen.masterManifest, { batchNumber: 99 }),
    /legacy batch number is invalid/,
  );
  const substitutedIds = [...frozen.masterManifest.table_ids];
  substitutedIds[substitutedIds.length - 1] = `${substitutedIds[substitutedIds.length - 1].slice(0, -1)}${substitutedIds[substitutedIds.length - 1].endsWith("f") ? "e" : "f"}`;
  substitutedIds.sort();
  assert.throws(
    () => buildLegacyStageAllowlistRunContract({ ...frozen.masterManifest, table_ids: substitutedIds }),
    /canonical Stage evidence/,
  );
  assert.throws(
    () => buildLegacyStageAllowlistRunContract({ ...frozen.masterManifest, cutoff: "2026-08-18T16:51:28.074Z" }),
    /canonical Stage evidence/,
  );
  assert.throws(
    () => buildLegacyStageAllowlistRunContract({ ...frozen.masterManifest, manifest_sha256: "0".repeat(64) }),
    /canonical Stage evidence/,
  );
  const reorderedBatch = {
    ...buildLegacyBatchManifest(frozen.masterManifest, { batchNumber: 2 }),
    batch_number: 3,
  };
  assert.throws(
    () => buildLegacyPlan(frozen.masterManifest, reorderedBatch),
    /canonical frozen order/,
  );
  assert.throws(
    () => buildLegacyPlan(frozen.masterManifest, buildLegacyBatchManifest(frozen.masterManifest, { batchNumber: 2 }), {
      runId: "7",
      runPlanSha256: "0".repeat(64),
    }),
    /canonical orchestration contract/,
  );
}

async function schedulerContracts() {
  const disabled = fakeScheduler({ enabled: false });
  const disabledResult = await runAutomaticBotOnlyStageAutomation(disabled);
  assert.equal(disabledResult.state, "no-op");
  assert.equal(disabledResult.reason, "automatic_policy_disabled");
  assert.equal(disabled.state.storeCalls, 0);

  const enabled = fakeScheduler({ enabled: true, candidateCount: 3 });
  const enabledResult = await runAutomaticBotOnlyStageAutomation(enabled);
  assert.equal(enabledResult.state, "completed");
  assert.equal(enabledResult.processed.length, 3);
  assert.equal(enabledResult.boundedBatchLimit, BOT_ONLY_AUTOMATIC_MAX_BATCHES_PER_RUN);
  assert.deepEqual(enabledResult.processed.map((row) => row.retry), ["already_cleaned", "already_cleaned", "already_cleaned"]);
  assert.deepEqual(enabledResult.processed.map((row) => row.executeState), ["cleaned", "cleaned", "cleaned"]);
  assert.deepEqual(enabledResult.processed.map((row) => row.executeConfirmed), [true, true, true]);
  assert.deepEqual(enabledResult.processed.map((row) => row.dbMutationConfirmed), [true, true, true]);
  assert.deepEqual(enabledResult.processed.map((row) => row.retryState), ["already_cleaned", "already_cleaned", "already_cleaned"]);
  assert.equal(enabledResult.stopReason, "no_eligible_bot_only_table");
  assert.equal(enabled.state.storeCalls, 3);

  const noCandidate = fakeScheduler({ enabled: true, candidateCount: 0 });
  const noCandidateResult = await runAutomaticBotOnlyStageAutomation(noCandidate);
  assert.equal(noCandidateResult.state, "completed");
  assert.deepEqual(noCandidateResult.processed, []);
  assert.equal(noCandidateResult.stopReason, "no_eligible_bot_only_table");

  const proven = makeProvenAutomaticRow("27");
  const legalRestart = fakeScheduler({
    enabled: true,
    candidateCount: 0,
    initialRows: [proven.row],
    initialArchiveBytes: new Map([[proven.row.object_path, proven.archiveBytes]]),
  });
  const refreshedProven = await legalRestart.deps.pruneStore.getManifest(proven.row.object_path);
  assert.equal(refreshedProven.bot_only_table_exists, true);
  assert.equal(refreshedProven.bot_only_retention_complete_at, null);
  assert.equal(assertAutomaticBotOnlyRecoveryReconstructionState({
    row: refreshedProven,
    identity: "7656985631720456337",
    evidence: {
      transactionCount: refreshedProven.transaction_count,
      entryCount: refreshedProven.entry_count,
      transactionIdsSha256: refreshedProven.archived_transaction_ids_sha256,
      entryIdsSha256: refreshedProven.archived_entry_ids_sha256,
      txTypes: refreshedProven.tx_types,
      credits: refreshedProven.credits,
      debits: refreshedProven.debits,
      net: refreshedProven.net_amount,
      registryKeys: ["key:27"],
      registryKeysSha256: refreshedProven.bot_only_registry_keys_sha256,
      tableId: refreshedProven.bot_only_table_id,
      distinctTables: 1,
      outOfScopeKeysSha256: refreshedProven.bot_only_out_of_scope_keys_sha256,
    },
    dryRunState: "ready",
    durable: null,
  }), true);
  const legalRestartResult = await runAutomaticBotOnlyStageAutomation(legalRestart);
  assert.equal(legalRestartResult.processed.length, 1);
  assert.equal(legalRestartResult.processed[0].batchId, "27");
  assert.equal(legalRestartResult.processed[0].state, "cleaned");
  assert.equal(legalRestartResult.processed[0].retry, "already_cleaned");
  assert.equal(legalRestartResult.processed[0].executeState, "cleaned");
  assert.equal(legalRestartResult.processed[0].executeConfirmed, true);
  assert.equal(legalRestartResult.processed[0].dbMutationConfirmed, true);
  assert.equal(legalRestartResult.processed[0].retryState, "already_cleaned");
  assert.equal(legalRestart.state.proofRegisterCalls, 0, "a complete proof must not be re-registered");
  assert.equal(legalRestart.state.persistCalls, 1, "the missing recovery pair must be created once");
  assert.equal(legalRestart.state.executeCalls, 2, "the restart must complete the destructive double-cycle");
  assert.equal(legalRestart.ownRows[0].registry_cleaned_at !== null, true);
  assert.equal(legalRestartResult.processed[0].archiveStorageModified, false);
  assert.equal(legalRestartResult.processed[0].recoveryStorageModified, true);
  assert.equal(legalRestartResult.processed[0].storageModified, true);
  assert.equal(legalRestartResult.processed[0].recoveryArchivePath, legalRestart.durable.get(proven.row.object_path).archivePath);
  assert.equal(legalRestartResult.processed[0].recoveryManifestPath, legalRestart.durable.get(proven.row.object_path).manifestPath);
  assert.equal(legalRestartResult.processed[0].recoveryArchiveSha256, legalRestart.durable.get(proven.row.object_path).archiveSha256);
  assert.equal(legalRestartResult.processed[0].recoveryManifestSha256, legalRestart.durable.get(proven.row.object_path).manifestSha256);

  for (const retryableSqlstate of ["40001", "55P03"]) {
    const retryable = makeProvenAutomaticRow("27");
    const retryableRun = fakeScheduler({
      enabled: true,
      candidateCount: 0,
      initialRows: [retryable.row],
      initialArchiveBytes: new Map([[retryable.row.object_path, retryable.archiveBytes]]),
      dryRunSqlstates: [retryableSqlstate],
    });
    const retryableResult = await runAutomaticBotOnlyStageAutomation(retryableRun);
    assert.equal(retryableResult.processed.length, 1);
    assert.equal(retryableResult.processed[0].state, "cleaned");
    assert.equal(retryableResult.processed[0].retry, "already_cleaned");
    assert.equal(retryableResult.processed[0].dryRunAttempts, 2);
    assert.equal(retryableResult.processed[0].dryRunRetryCount, 1);
    assert.deepEqual(retryableResult.processed[0].dryRunSqlstates, [retryableSqlstate]);
    assert.equal(retryableRun.state.activeDryRunCalls, 2);
    assert.equal(retryableRun.state.activeDryRunManifestReads, 2, "each dry-run attempt must refresh its manifest");
    assert.equal(retryableRun.state.activeDryRunArchiveDownloads, 2, "each dry-run attempt must download the archive");
    assert.equal(retryableRun.state.advisoryLockChecks >= 4, true, "each dry-run attempt must recheck the advisory lock");
    assert.equal(retryableRun.state.proofRegisterCalls, 0, "an existing proof must not be registered again");
    assert.equal(retryableRun.state.persistCalls, 1, "recovery starts only after the retry succeeds");
    assert.equal(retryableRun.state.executeCalls, 2, "execute remains the unchanged cleaned/already_cleaned double-cycle");
  }

  for (const retryableSqlstate of ["40001", "55P03"]) {
    const completed = makeProvenAutomaticRow("27", { lifecycle: "complete" });
    const completedRun = fakeScheduler({
      enabled: true,
      candidateCount: 0,
      initialRows: [completed.row],
      initialDurable: new Map([[
        completed.row.object_path,
        makeTestAutomaticDurableRecovery(completed.row, completed.archiveBytes),
      ]]),
      initialArchiveBytes: new Map([[completed.row.object_path, completed.archiveBytes]]),
      dryRunSqlstates: [retryableSqlstate],
    });
    const completedResult = await runAutomaticBotOnlyStageAutomation(completedRun);
    assert.deepEqual(completedResult.processed, [], "completed batch revalidation must not add a second processed entry");
    assert.equal(completedRun.state.dryRunCalls, 2);
    assert.equal(completedRun.state.dryRunManifestReads, 2, "completed dry-run retry must refresh its manifest each time");
    assert.equal(completedRun.state.dryRunArchiveDownloads, 2, "completed dry-run retry must download the archive each time");
    assert.equal(completedRun.state.advisoryLockChecks >= 4, true, "completed dry-run retry must recheck the advisory lock");
    assert.equal(completedRun.state.persistCalls, 0, "completed revalidation must not write recovery Storage");
    assert.equal(completedRun.state.storeCalls, 0, "completed revalidation must not write the main archive");
    assert.equal(completedRun.state.executeCalls, 0, "completed revalidation must not execute prune or cleanup");
    assert.equal(completedRun.state.destructiveSqlMutations, 0);
    assert.equal(completedRun.state.proofRegisterCalls, 0, "completed revalidation must not register proof");
    assert.equal(completedRun.ownRows[0].destructive_go_batch_id, "27");
    assert.equal(completedRun.ownRows[0].bot_only_retention_complete_at !== null, true);
  }

  const exhaustedDryRun = makeProvenAutomaticRow("27");
  const exhaustedDryRunRun = fakeScheduler({
    enabled: true,
    candidateCount: 0,
    initialRows: [exhaustedDryRun.row],
    initialArchiveBytes: new Map([[exhaustedDryRun.row.object_path, exhaustedDryRun.archiveBytes]]),
    dryRunSqlstates: ["40001", "40001", "40001"],
  });
  const exhaustedFailure = await captureAutomaticFailure(exhaustedDryRunRun);
  assert.equal(exhaustedFailure.error.code, "40001");
  assert.equal(exhaustedDryRunRun.state.activeDryRunCalls, BOT_ONLY_AUTOMATIC_MAX_DRY_RUN_ATTEMPTS);
  assert.equal(exhaustedDryRunRun.state.activeDryRunManifestReads, BOT_ONLY_AUTOMATIC_MAX_DRY_RUN_ATTEMPTS);
  assert.equal(exhaustedDryRunRun.state.activeDryRunArchiveDownloads, BOT_ONLY_AUTOMATIC_MAX_DRY_RUN_ATTEMPTS);
  assert.equal(exhaustedDryRunRun.state.persistCalls, 0, "exhausted dry-run must not write recovery Storage");
  assert.equal(exhaustedDryRunRun.state.executeCalls, 0, "exhausted dry-run must not execute DB cleanup");
  assert.equal(exhaustedDryRunRun.state.destructiveSqlMutations, 0);
  assert.equal(exhaustedDryRunRun.state.proofRegisterCalls, 0, "an existing proof must not be registered during dry-run retry");
  assert.equal(exhaustedDryRunRun.state.storeCalls, 0);
  assert.deepEqual(exhaustedFailure.report.processed_batches, []);
  assert.equal(exhaustedFailure.report.current_batch.dry_run_attempts, 3);
  assert.equal(exhaustedFailure.report.current_batch.dry_run_retry_count, 2);
  assert.deepEqual(exhaustedFailure.report.current_batch.dry_run_sqlstates, ["40001", "40001", "40001"]);
  assert.equal(exhaustedFailure.report.current_batch.dry_run, null);
  assert.equal(exhaustedFailure.report.current_batch.archive_storage_modified, false);
  assert.equal(exhaustedFailure.report.current_batch.recovery_storage_modified, false);
  assert.equal(exhaustedFailure.report.current_batch.storage_modified, false);
  assert.equal(exhaustedFailure.report.current_batch.execute_state, null);
  assert.equal(exhaustedFailure.report.current_batch.execute_confirmed, false);
  assert.equal(exhaustedFailure.report.current_batch.db_mutation_confirmed, false);

  const foreignDryRun = makeProvenAutomaticRow("27");
  const foreignDryRunRun = fakeScheduler({
    enabled: true,
    candidateCount: 0,
    initialRows: [foreignDryRun.row],
    initialArchiveBytes: new Map([[foreignDryRun.row.object_path, foreignDryRun.archiveBytes]]),
    dryRunSqlstates: ["XX000"],
  });
  const foreignFailure = await captureAutomaticFailure(foreignDryRunRun);
  assert.equal(foreignFailure.error.code, "XX000");
  assert.equal(foreignDryRunRun.state.activeDryRunCalls, 1, "a non-retryable SQLSTATE must fail immediately");
  assert.equal(foreignDryRunRun.state.activeDryRunManifestReads, 1);
  assert.equal(foreignDryRunRun.state.activeDryRunArchiveDownloads, 1);
  assert.equal(foreignDryRunRun.state.persistCalls, 0);
  assert.equal(foreignDryRunRun.state.executeCalls, 0);
  assert.equal(foreignDryRunRun.state.proofRegisterCalls, 0);
  assert.equal(foreignFailure.report.current_batch.dry_run_attempts, 1);
  assert.equal(foreignFailure.report.current_batch.dry_run_retry_count, 0);
  assert.deepEqual(foreignFailure.report.current_batch.dry_run_sqlstates, ["XX000"]);

  const completedExhausted = makeProvenAutomaticRow("27", { lifecycle: "complete" });
  const completedExhaustedRun = fakeScheduler({
    enabled: true,
    candidateCount: 0,
    initialRows: [completedExhausted.row],
    initialDurable: new Map([[
      completedExhausted.row.object_path,
      makeTestAutomaticDurableRecovery(completedExhausted.row, completedExhausted.archiveBytes),
    ]]),
    initialArchiveBytes: new Map([[completedExhausted.row.object_path, completedExhausted.archiveBytes]]),
    dryRunSqlstates: ["40001", "40001", "40001"],
  });
  const completedExhaustedFailure = await captureAutomaticFailure(completedExhaustedRun);
  assert.equal(completedExhaustedFailure.error.code, "40001");
  assert.equal(completedExhaustedRun.state.dryRunCalls, BOT_ONLY_AUTOMATIC_MAX_DRY_RUN_ATTEMPTS);
  assert.equal(completedExhaustedRun.state.dryRunManifestReads, BOT_ONLY_AUTOMATIC_MAX_DRY_RUN_ATTEMPTS);
  assert.equal(completedExhaustedRun.state.dryRunArchiveDownloads, BOT_ONLY_AUTOMATIC_MAX_DRY_RUN_ATTEMPTS);
  assert.equal(completedExhaustedRun.state.persistCalls, 0);
  assert.equal(completedExhaustedRun.state.storeCalls, 0);
  assert.equal(completedExhaustedRun.state.executeCalls, 0);
  assert.equal(completedExhaustedRun.state.destructiveSqlMutations, 0);
  assert.equal(completedExhaustedRun.state.proofRegisterCalls, 0);
  assert.deepEqual(completedExhaustedFailure.report.processed_batches, []);
  assert.equal(completedExhaustedFailure.report.phase, "automatic.completed-recovery");
  assert.equal(completedExhaustedFailure.report.batch_id, "27");
  assert.equal(completedExhaustedFailure.report.current_batch.batch_id, "27");
  assert.equal(completedExhaustedFailure.report.current_batch.dry_run_attempts, 3);
  assert.equal(completedExhaustedFailure.report.current_batch.dry_run_retry_count, 2);
  assert.deepEqual(completedExhaustedFailure.report.current_batch.dry_run_sqlstates, ["40001", "40001", "40001"]);
  assert.equal(completedExhaustedFailure.report.current_batch.dry_run, null);
  assert.equal(completedExhaustedFailure.report.current_batch.archive_storage_modified, false);
  assert.equal(completedExhaustedFailure.report.current_batch.recovery_storage_modified, false);
  assert.equal(completedExhaustedFailure.report.current_batch.storage_modified, false);
  assert.equal(completedExhaustedFailure.report.current_batch.execute_state, null);
  assert.equal(completedExhaustedFailure.report.current_batch.execute_confirmed, false);
  assert.equal(completedExhaustedFailure.report.current_batch.db_mutation_confirmed, false);

  const completedForeign = makeProvenAutomaticRow("27", { lifecycle: "complete" });
  const completedForeignRun = fakeScheduler({
    enabled: true,
    candidateCount: 0,
    initialRows: [completedForeign.row],
    initialDurable: new Map([[
      completedForeign.row.object_path,
      makeTestAutomaticDurableRecovery(completedForeign.row, completedForeign.archiveBytes),
    ]]),
    initialArchiveBytes: new Map([[completedForeign.row.object_path, completedForeign.archiveBytes]]),
    dryRunSqlstates: ["XX000"],
  });
  const completedForeignFailure = await captureAutomaticFailure(completedForeignRun);
  assert.equal(completedForeignFailure.error.code, "XX000");
  assert.equal(completedForeignRun.state.dryRunCalls, 1);
  assert.equal(completedForeignRun.state.dryRunManifestReads, 1);
  assert.equal(completedForeignRun.state.dryRunArchiveDownloads, 1);
  assert.equal(completedForeignRun.state.persistCalls, 0);
  assert.equal(completedForeignRun.state.storeCalls, 0);
  assert.equal(completedForeignRun.state.executeCalls, 0);
  assert.equal(completedForeignRun.state.proofRegisterCalls, 0);
  assert.equal(completedForeignFailure.report.phase, "automatic.completed-recovery");
  assert.equal(completedForeignFailure.report.batch_id, "27");
  assert.equal(completedForeignFailure.report.current_batch.dry_run_attempts, 1);
  assert.equal(completedForeignFailure.report.current_batch.dry_run_retry_count, 0);
  assert.deepEqual(completedForeignFailure.report.current_batch.dry_run_sqlstates, ["XX000"]);

  const partialRecovery = makeProvenAutomaticRow("27");
  const partialRecoveryRun = fakeScheduler({
    enabled: true,
    candidateCount: 0,
    initialRows: [partialRecovery.row],
    initialArchiveBytes: new Map([[partialRecovery.row.object_path, partialRecovery.archiveBytes]]),
    inspectRecovery: async () => { throw new Error("durable recovery copy is partial"); },
  });
  await assert.rejects(
    runAutomaticBotOnlyStageAutomation(partialRecoveryRun),
    /durable recovery copy is partial/,
  );
  assert.equal(partialRecoveryRun.state.persistCalls, 0, "partial recovery must fail before Storage writes");
  assert.equal(partialRecoveryRun.state.executeCalls, 0, "partial recovery must fail before DB lifecycle writes");
  assert.equal(partialRecoveryRun.state.proofRegisterCalls, 0);

  const recoveryWithoutProof = makeProvenAutomaticRow("27");
  recoveryWithoutProof.row.archive_proof_verified_at = null;
  recoveryWithoutProof.row.archived_transaction_ids_sha256 = null;
  recoveryWithoutProof.row.archived_entry_ids_sha256 = null;
  const recoveryWithoutProofRun = fakeScheduler({
    enabled: true,
    candidateCount: 0,
    initialRows: [recoveryWithoutProof.row],
    initialDurable: new Map([[recoveryWithoutProof.row.object_path, {}]]),
    initialArchiveBytes: new Map([[recoveryWithoutProof.row.object_path, recoveryWithoutProof.archiveBytes]]),
  });
  await assert.rejects(
    runAutomaticBotOnlyStageAutomation(recoveryWithoutProofRun),
    /without an immutable proof/,
  );
  assert.equal(recoveryWithoutProofRun.state.proofRegisterCalls, 0);
  assert.equal(recoveryWithoutProofRun.state.persistCalls, 0);
  assert.equal(recoveryWithoutProofRun.state.executeCalls, 0);

  const goWithoutRecovery = makeProvenAutomaticRow("27", { lifecycle: "go" });
  const goWithoutRecoveryRun = fakeScheduler({
    enabled: true,
    candidateCount: 0,
    initialRows: [goWithoutRecovery.row],
    initialArchiveBytes: new Map([[goWithoutRecovery.row.object_path, goWithoutRecovery.archiveBytes]]),
  });
  await assert.rejects(
    runAutomaticBotOnlyStageAutomation(goWithoutRecoveryRun),
    /unpruned, uncleaned batch without destructive GO/,
  );
  assert.equal(goWithoutRecoveryRun.state.mainArchiveDownloads, 1, "read-only dry-run may inspect the archive before the fail-closed lifecycle guard");
  assert.equal(goWithoutRecoveryRun.state.persistCalls, 0);
  assert.equal(goWithoutRecoveryRun.state.executeCalls, 0);

  const completedWithoutRecovery = makeProvenAutomaticRow("27", { lifecycle: "complete" });
  const completedWithoutRecoveryRun = fakeScheduler({
    enabled: true,
    candidateCount: 0,
    initialRows: [completedWithoutRecovery.row],
    initialArchiveBytes: new Map([[completedWithoutRecovery.row.object_path, completedWithoutRecovery.archiveBytes]]),
  });
  await assert.rejects(
    runAutomaticBotOnlyStageAutomation(completedWithoutRecoveryRun),
    /no durable recovery/,
  );
  assert.equal(completedWithoutRecoveryRun.state.persistCalls, 0);
  assert.equal(completedWithoutRecoveryRun.state.executeCalls, 0);

  for (const mainArchiveMode of ["missing", "foreign"]) {
  const unavailableMain = makeProvenAutomaticRow("27");
    const unavailableMainRun = fakeScheduler({
      enabled: true,
      candidateCount: 0,
      initialRows: [unavailableMain.row],
      initialArchiveBytes: new Map([[unavailableMain.row.object_path, unavailableMain.archiveBytes]]),
      failDownloadBeforeRecovery: mainArchiveMode === "missing",
      mainArchiveMode: mainArchiveMode === "foreign" ? "foreign" : "valid",
    });
    await assert.rejects(
      runAutomaticBotOnlyStageAutomation(unavailableMainRun),
      mainArchiveMode === "missing" ? /simulated main archive download failure/ : /dry-run archive checksum differs from the committed archive SHA/,
    );
    assert.equal(unavailableMainRun.state.persistCalls, 0);
    assert.equal(unavailableMainRun.state.executeCalls, 0);
  }

  const controlCycleFailure = fakeScheduler({ enabled: true, candidateCount: 1 });
  const originalControlExecuteCycle = controlCycleFailure.deps.executeVerifiedCycle;
  let controlExecuteCalls = 0;
  controlCycleFailure.deps.executeVerifiedCycle = async (args) => {
    controlExecuteCalls += 1;
    if (controlExecuteCalls === 2) {
      const error = new Error("control cycle failed after first cleanup");
      error.code = "XX000";
      throw error;
    }
    return originalControlExecuteCycle(args);
  };
  const controlOriginalStdoutWrite = process.stdout.write;
  const controlOriginalSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  let controlFailureOutput = "";
  delete process.env.GITHUB_STEP_SUMMARY;
  process.stdout.write = (chunk) => {
    controlFailureOutput += String(chunk);
    return true;
  };
  try {
    await assert.rejects(
      runAutomaticBotOnlyStageAutomation(controlCycleFailure),
      (error) => error?.code === "XX000",
    );
  } finally {
    process.stdout.write = controlOriginalStdoutWrite;
    if (controlOriginalSummaryPath === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = controlOriginalSummaryPath;
  }
  const controlFailureReport = JSON.parse(controlFailureOutput.trim());
  const controlRow = controlCycleFailure.ownRows[0];
  const controlDurable = controlCycleFailure.durable.get(controlRow.object_path);
  assert.equal(controlFailureReport.processed_batches.length, 0, "the in-progress batch must not be marked processed before already_cleaned");
  assert.equal(controlFailureReport.current_batch.batch_id, "100");
  assert.equal(controlFailureReport.current_batch.state, "cleaned");
  assert.equal(controlFailureReport.current_batch.execute_state, "cleaned");
  assert.equal(controlFailureReport.current_batch.execute_confirmed, true);
  assert.equal(controlFailureReport.current_batch.db_mutation_confirmed, true);
  assert.equal(controlFailureReport.current_batch.retry_state, null);
  assert.equal(controlFailureReport.current_batch.proof, "verified");
  assert.equal(controlFailureReport.current_batch.dry_run, "ready");
  assert.equal(controlFailureReport.current_batch.archive_storage_modified, true);
  assert.equal(controlFailureReport.current_batch.recovery_storage_modified, true);
  assert.equal(controlFailureReport.current_batch.storage_modified, true);
  assert.equal(controlFailureReport.current_batch.recovery_archive_sha256, controlDurable.archiveSha256);
  assert.equal(controlFailureReport.current_batch.recovery_manifest_sha256, controlDurable.manifestSha256);
  assert.equal(controlFailureReport.current_batch.destructive_go_batch_id, 100);
  assert.deepEqual(controlFailureReport.current_batch.prune_receipt, {
    at: "2026-08-25T00:00:01Z",
    transaction_count: "1",
    entry_count: "2",
    transaction_ids_sha256: "3".repeat(64),
    entry_ids_sha256: "4".repeat(64),
  });
  assert.deepEqual(controlFailureReport.current_batch.cleanup_receipt, {
    at: "2026-08-25T00:00:02Z",
    key_count: 1,
    keys_sha256: "1".repeat(64),
  });

  const recoveryBeforeExecuteFailure = fakeScheduler({ enabled: true, candidateCount: 1, failExecuteOnce: true });
  const recoveryOriginalStdoutWrite = process.stdout.write;
  const recoveryOriginalSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  let recoveryFailureOutput = "";
  delete process.env.GITHUB_STEP_SUMMARY;
  process.stdout.write = (chunk) => {
    recoveryFailureOutput += String(chunk);
    return true;
  };
  try {
    await assert.rejects(
      runAutomaticBotOnlyStageAutomation(recoveryBeforeExecuteFailure),
      /simulated interruption between batches/,
    );
  } finally {
    process.stdout.write = recoveryOriginalStdoutWrite;
    if (recoveryOriginalSummaryPath === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = recoveryOriginalSummaryPath;
  }
  const recoveryFailureReport = JSON.parse(recoveryFailureOutput.trim());
  const recoveryRow = recoveryBeforeExecuteFailure.ownRows[0];
  const recoveryDurable = recoveryBeforeExecuteFailure.durable.get(recoveryRow.object_path);
  assert.equal(recoveryFailureReport.processed_batches.length, 0);
  assert.equal(recoveryFailureReport.current_batch.batch_id, "100");
  assert.equal(recoveryFailureReport.current_batch.state, "in_progress");
  assert.equal(recoveryFailureReport.current_batch.execute_state, null);
  assert.equal(recoveryFailureReport.current_batch.execute_confirmed, false);
  assert.equal(recoveryFailureReport.current_batch.db_mutation_confirmed, false);
  assert.equal(recoveryFailureReport.current_batch.proof, "verified");
  assert.equal(recoveryFailureReport.current_batch.dry_run, "ready");
  assert.equal(recoveryFailureReport.current_batch.archive_storage_modified, true);
  assert.equal(recoveryFailureReport.current_batch.recovery_storage_modified, true);
  assert.equal(recoveryFailureReport.current_batch.storage_modified, true);
  assert.equal(recoveryFailureReport.current_batch.recovery_archive_sha256, recoveryDurable.archiveSha256);
  assert.equal(recoveryFailureReport.current_batch.recovery_manifest_sha256, recoveryDurable.manifestSha256);
  assert.equal(
    recoveryFailureReport.current_batch.recovery_archive_path,
    recoveryDurable.archivePath,
  );
  assert.equal(
    recoveryFailureReport.current_batch.recovery_manifest_path,
    recoveryDurable.manifestPath,
  );

  const earlyRecoveryFailure = fakeScheduler({ enabled: true, candidateCount: 1, failDownloadBeforeRecovery: true });
  const earlyOriginalStdoutWrite = process.stdout.write;
  const earlyOriginalSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  let earlyFailureOutput = "";
  delete process.env.GITHUB_STEP_SUMMARY;
  process.stdout.write = (chunk) => {
    earlyFailureOutput += String(chunk);
    return true;
  };
  try {
    await assert.rejects(
      runAutomaticBotOnlyStageAutomation(earlyRecoveryFailure),
      /simulated main archive download failure/,
    );
  } finally {
    process.stdout.write = earlyOriginalStdoutWrite;
    if (earlyOriginalSummaryPath === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = earlyOriginalSummaryPath;
  }
  const earlyFailureReport = JSON.parse(earlyFailureOutput.trim());
  const earlyRow = earlyRecoveryFailure.ownRows[0];
  assert.equal(earlyFailureReport.processed_batches.length, 0);
  assert.equal(earlyFailureReport.current_batch.batch_id, "100");
  assert.equal(earlyFailureReport.current_batch.object_path, earlyRow.object_path);
  assert.equal(earlyFailureReport.current_batch.compressed_sha256, earlyRow.compressed_sha256);
  assert.equal(earlyFailureReport.current_batch.proof, "verified");
  assert.equal(earlyFailureReport.current_batch.dry_run, null);
  assert.equal(earlyFailureReport.current_batch.archive_storage_modified, true);
  assert.equal(earlyFailureReport.current_batch.recovery_storage_modified, false);
  assert.equal(earlyFailureReport.current_batch.storage_modified, true);
  assert.equal(earlyFailureReport.current_batch.recovery_archive_sha256, null);
  assert.equal(earlyFailureReport.current_batch.recovery_manifest_sha256, null);
  assert.equal(earlyFailureReport.current_batch.db_mutation_confirmed, false);

  const laterBatchFailure = fakeScheduler({ enabled: true, candidateCount: 2 });
  const originalExecuteCycle = laterBatchFailure.deps.executeVerifiedCycle;
  let laterExecuteCalls = 0;
  laterBatchFailure.deps.executeVerifiedCycle = async (args) => {
    laterExecuteCalls += 1;
    if (laterExecuteCalls === 3) {
      const error = new Error("serialization failure in later batch");
      error.code = "40001";
      throw error;
    }
    return originalExecuteCycle(args);
  };
  const originalAutomaticStdoutWrite = process.stdout.write;
  const originalAutomaticSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  let automaticFailureOutput = "";
  delete process.env.GITHUB_STEP_SUMMARY;
  process.stdout.write = (chunk) => {
    automaticFailureOutput += String(chunk);
    return true;
  };
  try {
    await assert.rejects(
      runAutomaticBotOnlyStageAutomation(laterBatchFailure),
      (error) => error?.code === "40001",
    );
  } finally {
    process.stdout.write = originalAutomaticStdoutWrite;
    if (originalAutomaticSummaryPath === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = originalAutomaticSummaryPath;
  }
  const laterFailureReport = JSON.parse(automaticFailureOutput.trim());
  const laterRow = laterBatchFailure.ownRows.find((row) => row.batch_id === "100");
  const laterDurable = laterBatchFailure.durable.get(laterRow.object_path);
  assert.equal(laterFailureReport.sqlstate, "40001");
  assert.equal(laterFailureReport.processed_batches.length, 1, "completed batch observability must survive a later failure");
  assert.equal(laterFailureReport.processed_batches[0].batch_id, "100");
  assert.equal(laterFailureReport.processed_batches[0].recovery_archive_sha256, laterDurable.archiveSha256);
  assert.equal(laterFailureReport.processed_batches[0].recovery_manifest_sha256, laterDurable.manifestSha256);
  assert.equal(laterFailureReport.processed_batches[0].storage_modified, true);

  const realCycle = fakeScheduler({ enabled: true, candidateCount: 1, realExecute: true });
  const realCycleTempRoot = fs.mkdtempSync("/tmp/chips-ledger-stage-automation-real-double-cycle-");
  realCycle.deps.tempRoot = realCycleTempRoot;
  try {
    const realCycleResult = await runAutomaticBotOnlyStageAutomation(realCycle);
    assert.equal(realCycleResult.processed.length, 1);
    assert.equal(realCycleResult.processed[0].state, "cleaned");
    assert.equal(realCycleResult.processed[0].retry, "already_cleaned");
    assert.equal(realCycle.state.executeCalls, 0, "the regression contract must not use the fake executor");
    assert.equal(realCycle.state.realExecuteCalls, 2, "both real execute cycles must reach the SQL runner");
    assert.equal(realCycle.state.destructiveSqlMutations, 1, "only the first SQL cycle may mutate destructively");
    assert.equal(realCycle.state.storeCalls, 1, "the idempotency cycle must not create a second Storage manifest");
    assert.equal(fs.readdirSync(`${realCycleTempRoot}/recovery`).length, 2);

    const realRow = realCycle.ownRows[0];
    const realDurable = realCycle.durable.get(realRow.object_path);
    const invokeRealCycle = (tempRoot) => executeVerifiedCycle({
      row: realRow,
      identity: "7656985631720456337",
      durable: realDurable,
      env: realCycle.env,
      tempRoot,
      sql: realCycle.deps.sql,
      pruneStore: realCycle.deps.pruneStore,
      storageTarget: realCycle.deps.storageTarget,
      verifyBucket: realCycle.deps.verifyBucket,
      automatic: true,
      storageDeps: { pruneArchive: async () => { throw new Error("SQL runner must not be reached after local bundle rejection"); } },
    });
    const recoveryMembers = fs.readdirSync(`${realCycleTempRoot}/recovery`);
    const manifestMember = recoveryMembers.find((name) => name.endsWith(".recovery.json"));
    fs.unlinkSync(`${realCycleTempRoot}/recovery/${manifestMember}`);
    await assert.rejects(
      invokeRealCycle(realCycleTempRoot),
      /local recovery bundle is partial/,
    );

    const differentTempRoot = fs.mkdtempSync("/tmp/chips-ledger-stage-automation-different-bundle-");
    try {
      const differentRecoveryDir = `${differentTempRoot}/recovery`;
      fs.mkdirSync(differentRecoveryDir, { mode: 0o700 });
      fs.chmodSync(differentRecoveryDir, 0o700);
      const archiveSha = crypto.createHash("sha256").update(realDurable.archiveBytes).digest("hex");
      fs.writeFileSync(`${differentRecoveryDir}/chips-ledger-${archiveSha}.jsonl.gz`, Buffer.from("different"));
      fs.writeFileSync(`${differentRecoveryDir}/chips-ledger-${archiveSha}.recovery.json`, realDurable.manifestBytes);
      fs.chmodSync(`${differentRecoveryDir}/chips-ledger-${archiveSha}.jsonl.gz`, 0o600);
      fs.chmodSync(`${differentRecoveryDir}/chips-ledger-${archiveSha}.recovery.json`, 0o600);
      await assert.rejects(
        invokeRealCycle(differentTempRoot),
        /existing local recovery bundle differs from the verified recovery bytes/,
      );
    } finally {
      fs.rmSync(differentTempRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(realCycleTempRoot, { recursive: true, force: true });
  }

  for (const retryableSqlstate of ["40001", "55P03"]) {
    const preflightRetry = makeProvenAutomaticRow("27");
    const preflightRetryRun = fakeScheduler({
      enabled: true,
      candidateCount: 0,
      realExecute: true,
      // The initial dry-run succeeds; the first execute retry preflight
      // fails once and then succeeds on its second bounded attempt.
      dryRunSqlstates: [null, retryableSqlstate, null],
      executeSqlstates: [retryableSqlstate, null],
      initialRows: [preflightRetry.row],
      initialDurable: new Map([[
        preflightRetry.row.object_path,
        makeTestAutomaticDurableRecovery(preflightRetry.row, preflightRetry.archiveBytes),
      ]]),
      initialArchiveBytes: new Map([[preflightRetry.row.object_path, preflightRetry.archiveBytes]]),
    });
    const preflightRetryWaits = [];
    preflightRetryRun.deps.waitForExecuteRetry = async (details) => preflightRetryWaits.push(details);
    const preflightRetryTempRoot = fs.mkdtempSync(`/tmp/chips-ledger-stage-automation-execute-preflight-${retryableSqlstate}-`);
    preflightRetryRun.deps.tempRoot = preflightRetryTempRoot;
    try {
      const result = await runAutomaticBotOnlyStageAutomation(preflightRetryRun);
      const report = result.processed[0];
      assert.equal(report.state, "cleaned");
      assert.equal(report.executeAttempts, 2);
      assert.equal(report.executeRetryCount, 1);
      assert.deepEqual(report.executeSqlstates, [retryableSqlstate]);
      assert.equal(report.dryRunAttempts, 1, "execute retry preflight must remain separate from initial dry-run metrics");
      assert.equal(report.dryRunRetryCount, 0);
      assert.deepEqual(report.dryRunSqlstates, []);
      assert.equal(report.retryState, "already_cleaned");
      assert.equal(preflightRetryRun.state.dryRunCalls, 4, "a failed preflight must receive its own bounded retry");
      assert.equal(preflightRetryRun.state.dryRunManifestReads, 4);
      assert.equal(preflightRetryRun.state.dryRunArchiveDownloads, 4);
      assert.equal(preflightRetryRun.state.realExecuteCalls, 2);
      assert.equal(preflightRetryRun.state.executeAttemptCalls, 3, "the control cycle remains separate from SQL retries");
      assert.equal(preflightRetryRun.state.executeRetryPreflights, 1);
      assert.equal(preflightRetryRun.state.executeRetryWaits, 1);
      assert.equal(preflightRetryWaits.length, 1);
      assert.equal(preflightRetryWaits[0].sqlstate, retryableSqlstate);
      assert.equal(preflightRetryRun.state.proofRegisterCalls, 0);
      assert.equal(preflightRetryRun.state.persistCalls, 0);
      assert.equal(preflightRetryRun.state.storeCalls, 0);
      assert.equal(preflightRetryRun.state.destructiveSqlMutations, 1);
    } finally {
      fs.rmSync(preflightRetryTempRoot, { recursive: true, force: true });
    }
  }

  const exhaustedPreflight = makeProvenAutomaticRow("27");
  const exhaustedPreflightRun = fakeScheduler({
    enabled: true,
    candidateCount: 0,
    realExecute: true,
    // The initial dry-run succeeds; all three attempts of the execute retry
    // preflight fail, so no second execute may begin.
    dryRunSqlstates: [null, "40001", "40001", "40001"],
    executeSqlstates: ["40001", null],
    initialRows: [exhaustedPreflight.row],
    initialDurable: new Map([[
      exhaustedPreflight.row.object_path,
      makeTestAutomaticDurableRecovery(exhaustedPreflight.row, exhaustedPreflight.archiveBytes),
    ]]),
    initialArchiveBytes: new Map([[exhaustedPreflight.row.object_path, exhaustedPreflight.archiveBytes]]),
  });
  const exhaustedPreflightWaits = [];
  exhaustedPreflightRun.deps.waitForExecuteRetry = async (details) => exhaustedPreflightWaits.push(details);
  const exhaustedPreflightTempRoot = fs.mkdtempSync("/tmp/chips-ledger-stage-automation-execute-preflight-exhausted-");
  exhaustedPreflightRun.deps.tempRoot = exhaustedPreflightTempRoot;
  try {
    const failure = await captureAutomaticFailure(exhaustedPreflightRun);
    assert.equal(failure.error.code, "40001");
    assert.equal(exhaustedPreflightRun.state.dryRunCalls, 4, "preflight retry budget must be exactly three attempts");
    assert.equal(exhaustedPreflightRun.state.dryRunManifestReads, 4);
    assert.equal(exhaustedPreflightRun.state.dryRunArchiveDownloads, 4);
    assert.equal(exhaustedPreflightRun.state.executeAttemptCalls, 1, "a failed preflight must block the next execute");
    assert.equal(exhaustedPreflightRun.state.executeRetryPreflights, 1);
    assert.equal(exhaustedPreflightRun.state.executeRetryWaits, 1);
    assert.equal(exhaustedPreflightWaits.length, 1);
    assert.equal(exhaustedPreflightRun.state.proofRegisterCalls, 0);
    assert.equal(exhaustedPreflightRun.state.persistCalls, 0);
    assert.equal(exhaustedPreflightRun.state.storeCalls, 0);
    assert.equal(exhaustedPreflightRun.state.destructiveSqlMutations, 0);
    assert.deepEqual(failure.report.processed_batches, []);
    assert.equal(failure.report.phase, "automatic.execute");
    assert.equal(failure.report.batch_id, "27");
    assert.equal(failure.report.current_batch.execute_attempts, 1);
    assert.deepEqual(failure.report.current_batch.execute_sqlstates, ["40001"]);
    assert.equal(failure.report.current_batch.dry_run_attempts, 1, "execute preflight retry must not alter initial dry-run metrics");
    assert.equal(failure.report.current_batch.dry_run_retry_count, 0);
    assert.deepEqual(failure.report.current_batch.dry_run_sqlstates, []);
  } finally {
    fs.rmSync(exhaustedPreflightTempRoot, { recursive: true, force: true });
  }

  for (const retryableSqlstate of ["40001", "55P03"]) {
    const provenRetry = makeProvenAutomaticRow("27");
    const provenRetryRun = fakeScheduler({
      enabled: true,
      candidateCount: 0,
      realExecute: true,
      executeSqlstates: [retryableSqlstate, null],
      initialRows: [provenRetry.row],
      initialDurable: new Map([[
        provenRetry.row.object_path,
        makeTestAutomaticDurableRecovery(provenRetry.row, provenRetry.archiveBytes),
      ]]),
      initialArchiveBytes: new Map([[provenRetry.row.object_path, provenRetry.archiveBytes]]),
    });
    const executeWaits = [];
    provenRetryRun.deps.waitForExecuteRetry = async (details) => executeWaits.push(details);
    const provenRetryTempRoot = fs.mkdtempSync(`/tmp/chips-ledger-stage-automation-execute-retry-${retryableSqlstate}-`);
    provenRetryRun.deps.tempRoot = provenRetryTempRoot;
    try {
      const retryResult = await runAutomaticBotOnlyStageAutomation(provenRetryRun);
      const report = retryResult.processed[0];
      assert.equal(report.state, "cleaned");
      assert.equal(report.executeAttempts, 2);
      assert.equal(report.executeRetryCount, 1);
      assert.deepEqual(report.executeSqlstates, [retryableSqlstate]);
      assert.equal(report.dryRunAttempts, 1, "execute retry must not be folded into dry-run metrics");
      assert.equal(report.dryRunRetryCount, 0);
      assert.deepEqual(report.dryRunSqlstates, []);
      assert.equal(report.retryState, "already_cleaned");
      assert.equal(provenRetryRun.state.realExecuteCalls, 2, "the second idempotency cycle is separate from SQL retries");
      assert.equal(provenRetryRun.state.executeAttemptCalls, 3, "two first-cycle attempts plus one idempotency check");
      assert.equal(provenRetryRun.state.executeRetryPreflights, 1);
      assert.equal(provenRetryRun.state.executeRetryWaits, 1);
      assert.equal(executeWaits.length, 1);
      assert.equal(executeWaits[0].sqlstate, retryableSqlstate);
      assert.equal(provenRetryRun.state.recoveryInspections >= 2, true, "recovery must be revalidated before the retry");
      assert.equal(provenRetryRun.state.proofRegisterCalls, 0, "a proven batch must not register proof again");
      assert.equal(provenRetryRun.state.persistCalls, 0, "an existing recovery pair must not be rewritten");
      assert.equal(provenRetryRun.state.storeCalls, 0, "an existing archive must not be rewritten");
      assert.equal(provenRetryRun.state.destructiveSqlMutations, 1);
    } finally {
      fs.rmSync(provenRetryTempRoot, { recursive: true, force: true });
    }
  }

  const exhaustedExecute = makeProvenAutomaticRow("27");
  const exhaustedExecuteRun = fakeScheduler({
    enabled: true,
    candidateCount: 0,
    realExecute: true,
    executeSqlstates: ["40001", "40001", "40001"],
    initialRows: [exhaustedExecute.row],
    initialDurable: new Map([[
      exhaustedExecute.row.object_path,
      makeTestAutomaticDurableRecovery(exhaustedExecute.row, exhaustedExecute.archiveBytes),
    ]]),
    initialArchiveBytes: new Map([[exhaustedExecute.row.object_path, exhaustedExecute.archiveBytes]]),
  });
  const exhaustedExecuteWaits = [];
  exhaustedExecuteRun.deps.waitForExecuteRetry = async (details) => exhaustedExecuteWaits.push(details);
  const exhaustedExecuteTempRoot = fs.mkdtempSync("/tmp/chips-ledger-stage-automation-execute-exhausted-");
  exhaustedExecuteRun.deps.tempRoot = exhaustedExecuteTempRoot;
  try {
    const failure = await captureAutomaticFailure(exhaustedExecuteRun);
    assert.equal(failure.error.code, "40001");
    assert.equal(exhaustedExecuteRun.state.executeAttemptCalls, 3);
    assert.equal(exhaustedExecuteRun.state.executeRetryPreflights, 2);
    assert.equal(exhaustedExecuteRun.state.executeRetryWaits, 2);
    assert.equal(exhaustedExecuteWaits.length, 2);
    assert.equal(exhaustedExecuteRun.state.dryRunCalls, 3, "each execute retry must run a fresh dry-run preflight");
    assert.equal(exhaustedExecuteRun.state.dryRunManifestReads, 3);
    assert.equal(exhaustedExecuteRun.state.dryRunArchiveDownloads, 3);
    assert.equal(exhaustedExecuteRun.state.recoveryInspections, 3);
    assert.equal(exhaustedExecuteRun.state.proofRegisterCalls, 0);
    assert.equal(exhaustedExecuteRun.state.persistCalls, 0);
    assert.equal(exhaustedExecuteRun.state.storeCalls, 0);
    assert.equal(exhaustedExecuteRun.state.destructiveSqlMutations, 0);
    assert.deepEqual(failure.report.processed_batches, []);
    assert.equal(failure.report.phase, "automatic.execute");
    assert.equal(failure.report.batch_id, "27");
    assert.equal(failure.report.current_batch.execute_attempts, 3);
    assert.equal(failure.report.current_batch.execute_retry_count, 2);
    assert.deepEqual(failure.report.current_batch.execute_sqlstates, ["40001", "40001", "40001"]);
    assert.equal(failure.report.current_batch.dry_run_attempts, 1);
    assert.equal(failure.report.current_batch.dry_run_retry_count, 0);
    assert.deepEqual(failure.report.current_batch.dry_run_sqlstates, []);
  } finally {
    fs.rmSync(exhaustedExecuteTempRoot, { recursive: true, force: true });
  }

  const nonRetryableExecute = makeProvenAutomaticRow("27");
  const nonRetryableExecuteRun = fakeScheduler({
    enabled: true,
    candidateCount: 0,
    realExecute: true,
    executeSqlstates: ["23505"],
    initialRows: [nonRetryableExecute.row],
    initialDurable: new Map([[
      nonRetryableExecute.row.object_path,
      makeTestAutomaticDurableRecovery(nonRetryableExecute.row, nonRetryableExecute.archiveBytes),
    ]]),
    initialArchiveBytes: new Map([[nonRetryableExecute.row.object_path, nonRetryableExecute.archiveBytes]]),
  });
  const nonRetryableExecuteTempRoot = fs.mkdtempSync("/tmp/chips-ledger-stage-automation-execute-nonretryable-");
  nonRetryableExecuteRun.deps.tempRoot = nonRetryableExecuteTempRoot;
  try {
    const failure = await captureAutomaticFailure(nonRetryableExecuteRun);
    assert.equal(failure.error.code, "23505");
    assert.equal(nonRetryableExecuteRun.state.executeAttemptCalls, 1);
    assert.equal(nonRetryableExecuteRun.state.executeRetryPreflights, 0);
    assert.equal(nonRetryableExecuteRun.state.executeRetryWaits, 0);
    assert.equal(nonRetryableExecuteRun.state.destructiveSqlMutations, 0);
    assert.equal(failure.report.current_batch.execute_attempts, 1);
    assert.equal(failure.report.current_batch.execute_retry_count, 0);
    assert.deepEqual(failure.report.current_batch.execute_sqlstates, ["23505"]);
  } finally {
    fs.rmSync(nonRetryableExecuteTempRoot, { recursive: true, force: true });
  }

  const alreadyCleanedAfterFailure = makeProvenAutomaticRow("27");
  const alreadyCleanedAfterFailureRun = fakeScheduler({
    enabled: true,
    candidateCount: 0,
    realExecute: true,
    executeSqlstates: ["40001"],
    executeAlreadyCleanedAfterFailure: true,
    initialRows: [alreadyCleanedAfterFailure.row],
    initialDurable: new Map([[
      alreadyCleanedAfterFailure.row.object_path,
      makeTestAutomaticDurableRecovery(alreadyCleanedAfterFailure.row, alreadyCleanedAfterFailure.archiveBytes),
    ]]),
    initialArchiveBytes: new Map([[
      alreadyCleanedAfterFailure.row.object_path,
      alreadyCleanedAfterFailure.archiveBytes,
    ]]),
  });
  const alreadyCleanedTempRoot = fs.mkdtempSync("/tmp/chips-ledger-stage-automation-execute-already-cleaned-");
  alreadyCleanedAfterFailureRun.deps.tempRoot = alreadyCleanedTempRoot;
  try {
    const result = await runAutomaticBotOnlyStageAutomation(alreadyCleanedAfterFailureRun);
    assert.equal(result.processed[0].executeAttempts, 1);
    assert.equal(result.processed[0].executeRetryCount, 1);
    assert.deepEqual(result.processed[0].executeSqlstates, ["40001"]);
    assert.equal(result.processed[0].executeState, "already_cleaned");
    assert.equal(result.processed[0].retryState, "already_cleaned");
    assert.equal(alreadyCleanedAfterFailureRun.state.executeRetryPreflights, 1);
    assert.equal(alreadyCleanedAfterFailureRun.state.executeAttemptCalls, 2, "already_cleaned must avoid a retry cleanup but still run the idempotency check");
    assert.equal(alreadyCleanedAfterFailureRun.state.destructiveSqlMutations, 1);
  } finally {
    fs.rmSync(alreadyCleanedTempRoot, { recursive: true, force: true });
  }

  const capacity = fakeScheduler({ enabled: true, candidateCount: BOT_ONLY_AUTOMATIC_MAX_BATCHES_PER_RUN + 5 });
  const capacityResult = await runAutomaticBotOnlyStageAutomation(capacity);
  assert.equal(capacityResult.processed.length, BOT_ONLY_AUTOMATIC_MAX_BATCHES_PER_RUN);
  assert.equal(capacity.state.storeCalls, BOT_ONLY_AUTOMATIC_MAX_BATCHES_PER_RUN);
  assert.equal(capacityResult.stopReason, "batch_limit_reached", "the bounded run must report its full capacity");

  const anomaly = fakeScheduler({ enabled: true, candidateCount: 1, blockingAfter: 1 });
  await assert.rejects(
    runAutomaticBotOnlyStageAutomation(anomaly),
    /blocking anomaly/,
  );
  assert.equal(anomaly.state.storeCalls, 1, "anomaly must stop before the next batch");

  const interrupted = fakeScheduler({ enabled: true, candidateCount: 1, failExecuteOnce: true });
  await assert.rejects(runAutomaticBotOnlyStageAutomation(interrupted), /simulated interruption/);
  const resumed = await runAutomaticBotOnlyStageAutomation(interrupted);
  assert.equal(resumed.processed.length, 1);
  assert.equal(interrupted.state.candidateCalls, 1, "resume must start from the incomplete manifest");
  assert.equal(interrupted.state.storeCalls, 1, "resume must not create a second manifest");
}

async function legacyOrchestratorContracts() {
  const frozen = loadFrozenLegacyAllowlist({ cwd: root });
  const contract = buildLegacyStageAllowlistRunContract(frozen.masterManifest);
  const batch13 = {
    object_path: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.objectPath,
    batch_id: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.batchId,
    status: "committed",
    source_policy_id: "legacy_stage_allowlist_v1",
    legacy_allowlist_sha256: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.masterAllowlistSha256,
    legacy_batch_number: "1",
    legacy_batch_table_count: "10",
    archive_proof_verified_at: "2026-08-18T00:00:00Z",
    pruned_at: "2026-08-18T00:00:01Z",
    registry_cleaned_at: "2026-08-18T00:00:02Z",
    pruned_transaction_count: "60",
    pruned_entry_count: "120",
    registry_cleaned_key_count: "60",
    pruned_transaction_ids_sha256: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.txIdsSha256,
    pruned_entry_ids_sha256: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.entryIdsSha256,
    registry_cleaned_keys_sha256: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.registryKeysSha256,
  };
  const makeLegacyRow = (batchNumber, { complete = true } = {}) => {
    const digest = `${batchNumber.toString(16).padStart(2, "0")}${"a".repeat(62)}`;
    const row = {
      object_path: `v1/sha256/${digest}.jsonl.gz`,
      batch_id: String(2000 + batchNumber),
      status: "committed",
      source_policy_id: "legacy_stage_allowlist_v1",
      legacy_run_id: "41",
      legacy_plan_sha256: contract.planSha256,
      legacy_batch_number: String(batchNumber),
      legacy_batch_table_count: "10",
      legacy_allowlist_sha256: contract.masterAllowlistSha256,
      legacy_batch_table_ids_sha256: "c".repeat(64),
      compressed_sha256: digest,
      compressed_bytes: "10",
    };
    if (complete) {
      Object.assign(row, {
        archive_proof_verified_at: "2026-08-25T00:00:00Z",
        archived_transaction_ids_sha256: "d".repeat(64),
        archived_entry_ids_sha256: "e".repeat(64),
        pruned_at: "2026-08-25T00:00:01Z",
        registry_cleaned_at: "2026-08-25T00:00:02Z",
        pruned_transaction_count: "1",
        pruned_entry_count: "2",
        registry_cleaned_key_count: "1",
        pruned_transaction_ids_sha256: "d".repeat(64),
        pruned_entry_ids_sha256: "e".repeat(64),
        registry_cleaned_keys_sha256: "f".repeat(64),
      });
    }
    return row;
  };
  const rows = [
    ...Array.from({ length: 10 }, (_, index) => makeLegacyRow(index + 2)),
    makeLegacyRow(12, { complete: false }),
  ];
  const manifests = new Map(rows.map((row) => [row.object_path, row]));
  const sql = {
    begin: async (callback) => callback(sql),
    unsafe: async (query) => {
      if (query.includes("set transaction")) return [];
      if (query.includes("pg_try_advisory_lock")) return [{ backend_pid: "41", acquired: true }];
      if (query.includes("pg_backend_pid")) return [{ backend_pid: "41" }];
      if (query.includes("pg_advisory_unlock")) return [{ pg_advisory_unlock: true }];
      if (query.includes("from public.chips_legacy_stage_allowlist_runs")) return [{
        run_id: "41",
        project_ref: "krydukthwdvccggbyjfw",
        source_policy_id: "legacy_stage_allowlist_v1",
        stage_system_identifier: "7656985631720456337",
        cutoff: "2026-08-17T16:51:28.074Z",
        master_allowlist_sha256: contract.masterAllowlistSha256,
        master_manifest_sha256: "eb5593bdf5bd7f3c985373e6037a861d999413eae5076b923165c7f8147a79e7",
        remaining_table_ids_sha256: contract.remainingTableIdsSha256,
        remaining_table_count: "964",
        first_batch_number: "2",
        last_batch_number: "98",
        batch_count: "97",
        plan_sha256: contract.planSha256,
        status: "authorized",
        destructive_go_at: "2026-08-25T00:00:00Z",
      }];
      if (query.includes("where batch_id = 13")) return [batch13];
      if (query.includes("from public.chips_ledger_archive_batches")) return rows;
      throw new Error("unexpected legacy orchestrator SQL: " + query);
    },
  };
  const calls = [];
  const evidence = {
    transactionCount: 1,
    entryCount: 2,
    txTypes: { TABLE_BUY_IN: 1 },
    credits: "100",
    debits: "100",
    net: "0",
  };
  const result = await runLegacyStageAllowlistOrchestrator({
    env: { ...ENV },
    cwd: root,
    deps: {
      sql,
      maxBatchesPerRun: 1,
      preflight: async () => ({ systemIdentifier: "7656985631720456337", enforcementActive: true }),
      storageTarget: { target: "stage", projectRef: "krydukthwdvccggbyjfw" },
      verifyBucket: async () => {},
      pruneStore: { getManifest: async (objectPath) => manifests.get(objectPath) || null },
      inspectDurableRecovery: async () => null,
      downloadPrivateArchive: async () => ({ bytes: Buffer.from("legacy archive"), downloadMs: 0 }),
      persistDurableRecovery: async () => ({
        archiveBytes: Buffer.from("legacy archive"),
        manifestBytes: Buffer.from("{}"),
        manifestGzipBytes: Buffer.from("gzip"),
      }),
      pruneArchive: async ({ argv }) => {
        calls.push(argv);
        const objectPath = argv[argv.indexOf("--object-path") + 1];
        const row = manifests.get(objectPath);
        assert.ok(row, "legacy orchestrator must name a known manifest");
        if (argv.includes("--register-proof")) {
          row.archive_proof_verified_at = "2026-08-25T00:00:00Z";
          row.archived_transaction_ids_sha256 = "d".repeat(64);
          row.archived_entry_ids_sha256 = "e".repeat(64);
          return { state: "proof_registered" };
        }
        if (argv.includes("--execute")) {
          if (row.registry_cleaned_at) return { state: "already_pruned", evidence };
          row.pruned_at = "2026-08-25T00:00:01Z";
          row.registry_cleaned_at = "2026-08-25T00:00:02Z";
          row.pruned_transaction_count = "1";
          row.pruned_entry_count = "2";
          row.registry_cleaned_key_count = "1";
          row.pruned_transaction_ids_sha256 = "d".repeat(64);
          row.pruned_entry_ids_sha256 = "e".repeat(64);
          row.registry_cleaned_keys_sha256 = "f".repeat(64);
          return { state: "pruned", evidence };
        }
        return row.legacy_batch_number === "12"
          ? { state: "ready", evidence }
          : { state: "already_pruned" };
      },
    },
  });
  assert.equal(result.batch13, "skipped-already-pruned-and-cleaned");
  assert.deepEqual(result.processed.map((row) => row.batchNumber), Array.from({ length: 11 }, (_, index) => index + 2));
  assert.equal(result.processed.slice(0, 10).every((row) => row.state === "skipped"), true);
  assert.equal(result.processed.at(-1).state, "pruned");
  assert.equal(result.consumedBatchCount, 1);
  assert.equal(result.remainingBatchCount, 86);
  assert.equal(calls.filter((argv) => argv.includes("--execute")).length, 2, "batch 12 must execute and retry after completed batches are skipped");
}

function staticWorkflowContracts() {
  assert.match(workflow, /bot-only-7d-automatic/);
  assert.match(workflow, /legacy-stage-allowlist-orchestrate/);
  assert.match(workflow, /github\.event_name == 'schedule' && github\.event\.schedule == '\*\/15 \* \* \* \*'/);
  assert.match(workflow, /--policy bot-only-7d --automatic/);
  assert.match(workflow, /CHIPS_LEDGER_BOT_ONLY_AUTOMATIC: "1"/);
  assert.match(workflow, /node scripts\/ops\/chips-ledger-legacy-stage-allowlist-orchestrator\.mjs/);
  assert.doesNotMatch(workflow, /SUPABASE_PROD_|PRODUCTION|--target\\s+prod/i);
  assert.match(orchestratorSource, /batch13: "skipped-already-pruned-and-cleaned"/);
  assert.match(orchestratorSource, /LEGACY_STAGE_ALLOWLIST_ORCHESTRATOR_MAX_BATCHES_PER_RUN/);
  assert.match(orchestratorSource, /assertLegacyBatchRows/);
  assert.match(orchestratorSource, /process\.argv\.slice\(2\)\.length !== 0/);
  assert.equal(BOT_ONLY_AUTOMATIC_MAX_BATCHES_PER_RUN, 6);
  assert.match(automationSource, /BOT_ONLY_AUTOMATIC_MAX_BATCHES_PER_RUN = 6/);
  assert.match(workflow, /- cron: "\*\/15 \* \* \* \*"/);
  assert.match(automationSource, /automatic_policy_disabled/);
  assert.match(automationSource, /automatic bot-only Stage retention requires an active fence and enforcement/);
  assert.match(orchestrationMigration, /chips_authorize_legacy_stage_allowlist_run/);
  assert.match(orchestrationMigration, /chips_activate_bot_only_retention_policy/);
  assert.match(orchestrationMigration, /chips_auto_prune_and_cleanup_bot_only_archive_batch/);
  assert.match(orchestrationMigration, /P894[0-6]/);
  assert.match(orchestrationMigration, /P895[0-6]/);
  assert.match(lifecycleReceiptMigration, /create or replace function public\.chips_prune_and_cleanup_bot_only_archive_batch/);
  assert.match(lifecycleReceiptMigration, /P8925/);
  assert.match(lifecycleReceiptMigration, /already_cleaned[\s\S]*poker_tables/);
  assert.match(lifecycleReceiptMigration, /lifecycle completion marker was not persisted/);
  assert.match(lifecycleMissingTableMigration, /create or replace function public\.chips_prune_and_cleanup_bot_only_archive_batch/);
  assert.match(lifecycleMissingTableMigration, /if found and lifecycle_marker is null/);
  assert.match(lifecycleMissingTableMigration, /if not found or lifecycle_marker is null/);
  assert.match(legacyLifecycleCompletionMigration, /source_policy_id = 'legacy_stage_allowlist_v1'/);
  assert.match(legacyLifecycleCompletionMigration, /bot_only_retention_complete_at/);
  assert.match(legacyLifecycleCompletionMigration, /state', 'already_pruned'/);
}

staticOrchestrationContract();
staticWorkflowContracts();
await schedulerContracts();
await legacyOrchestratorContracts();

const dbUrl = process.env.CHIPS_MIGRATIONS_TEST_DB_URL;
if (!dbUrl) {
  process.stdout.write("Skipping disposable PostgreSQL Stage cleanup contracts: CHIPS_MIGRATIONS_TEST_DB_URL not set.\n");
  process.exit(0);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ROLLBACK = new Error("stage-cleanup-orchestration-contract-rollback");

async function disposableBotFixture(tx, { objectHex = "9", lifecycleMarker = null } = {}) {
  await tx.unsafe("set constraints all deferred;");
  await tx.unsafe("select public.chips_set_table_fence_active(true);");
  const systemRows = await tx.unsafe(
    "select id from public.chips_accounts where account_type::text = 'SYSTEM' and system_key = 'GENESIS' limit 1;",
  );
  assert.ok(systemRows[0]?.id, "disposable fixture requires the GENESIS account");
  const tableId = randomUUID();
  const escrowAccountId = randomUUID();
  if (lifecycleMarker == null) {
    await tx.unsafe(
      "insert into public.poker_tables (id, status, has_human_participant, bot_only_proof_eligible) values ($1::uuid, 'OPEN', false, true);",
      [tableId],
    );
  } else {
    await tx.unsafe(
      "insert into public.poker_tables (id, status, has_human_participant, bot_only_proof_eligible, bot_only_retention_complete_at) values ($1::uuid, 'OPEN', false, true, $2::timestamptz);",
      [tableId, lifecycleMarker],
    );
  }
  await tx.unsafe(
    "insert into public.chips_accounts (id, account_type, system_key, status, balance) values ($1::uuid, 'ESCROW', $2, 'active', 0);",
    [escrowAccountId, `POKER_TABLE:${tableId}`],
  );
  const transactionId = randomUUID();
  const key = `bot-seed-buyin:${tableId}:stage-cleanup-contract`;
  const compressedSha = objectHex.repeat(64);
  const createdAt = new Date(Date.now() - (10 * DAY_MS)).toISOString();
  const cutoff = new Date().toISOString();
  await tx.unsafe(`
    insert into public.chips_transactions
      (id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id, created_at)
    values ($1::uuid, $2, $3::jsonb, $4, $5, 'TABLE_BUY_IN', null, $6::timestamptz);
  `, [
    transactionId,
    `BOT_SEED_BUY_IN:${tableId}:1`,
    JSON.stringify({ tableId }),
    key,
    "a".repeat(64),
    createdAt,
  ]);
  const entries = await tx.unsafe(`
    insert into public.chips_entries (transaction_id, account_id, amount, metadata)
    values ($1::uuid, $2::uuid, -100, '{}'::jsonb), ($1::uuid, $3::uuid, 100, '{}'::jsonb)
    returning id;
  `, [transactionId, systemRows[0].id, escrowAccountId]);
  await tx.unsafe("update public.poker_tables set status = 'CLOSED' where id = $1::uuid;", [tableId]);
  await tx.unsafe("set constraints all immediate;");
  const hashes = await tx.unsafe(
    "select public.chips_archive_text_ids_sha256($1::text[]) as registry_hash, public.chips_archive_text_ids_sha256(array[]::text[]) as empty_hash;",
    [[key]],
  );
  await tx.unsafe(`
    insert into public.chips_ledger_archive_batches (
      object_path, project_ref, format_version, cutoff, first_created_at, last_created_at,
      cursor_end_created_at, cursor_end_id,
      transaction_count, entry_count, tx_types, raw_bytes, compressed_bytes, raw_sha256,
      compressed_sha256, credits, debits, net_amount, source_policy_id, bot_only_table_id,
      bot_only_table_count, bot_only_newest_created_at, bot_only_registry_keys_sha256,
      bot_only_out_of_scope_keys_sha256, bot_only_identity_count, bot_only_eligible_count,
      status, committed_at
    ) values (
      $1, 'krydukthwdvccggbyjfw', 2, $2::timestamptz, $3::timestamptz, $3::timestamptz,
      $3::timestamptz, $9::uuid,
      1, 2, '{"TABLE_BUY_IN":1}'::jsonb, 10, 10, $4, $5, 100, 100, 0,
      'stage-ledger-bot-only-retention-7d-v1', $6::uuid, 1, $3::timestamptz, $7, $8, 1, 1,
      'committed', now()
    );
  `, [
    "v1/sha256/" + objectHex.repeat(64) + ".jsonl.gz",
    cutoff,
    createdAt,
    "a".repeat(64),
    compressedSha,
    tableId,
    hashes[0].registry_hash,
    hashes[0].empty_hash,
    transactionId,
  ]);
  return {
    tableId,
    systemAccountId: systemRows[0].id,
    escrowAccountId,
    transactionId,
    entryIds: entries.map((row) => String(row.id)),
    key,
    objectPath: "v1/sha256/" + objectHex.repeat(64) + ".jsonl.gz",
    compressedSha,
    createdAt,
  };
}

async function disposableLegacyFixture(tx, { objectHex = "f", batchId = 13 } = {}) {
  const frozen = loadFrozenLegacyAllowlist({ cwd: root });
  const legacyPlan = buildLegacyPlan(
    frozen.masterManifest,
    buildLegacyBatchManifest(frozen.masterManifest, { batchNumber: 1 }),
  );
  const tableIds = legacyPlan.batchTableIds;
  const masterTableIds = legacyPlan.masterTableIds;
  const cutoff = legacyPlan.cutoff;
  const systemAccountId = randomUUID();
  const transactionIds = [];
  const entryIds = [];
  const keys = [];
  const escrowAccountIds = [];
  const createdAt = tableIds.map((_, index) => `2026-08-01T00:00:${String(index).padStart(2, "0")}.000Z`);

  await tx.unsafe("set constraints all deferred;");
  await tx.unsafe(
    "insert into public.chips_accounts (id, account_type, system_key, status, balance) values ($1::uuid, 'SYSTEM', $2, 'active', 0);",
    [systemAccountId, `LEGACY_STAGE_TEST_SYSTEM:${systemAccountId}`],
  );

  for (const [index, tableId] of tableIds.entries()) {
    const escrowAccountId = randomUUID();
    const transactionId = randomUUID();
    const key = `bot-seed-buyin:${tableId}:legacy-lifecycle-contract-${index}`;
    await tx.unsafe(
      "insert into public.poker_tables (id, status, has_human_participant, bot_only_proof_eligible) values ($1::uuid, 'OPEN', false, false);",
      [tableId],
    );
    await tx.unsafe(
      "insert into public.chips_accounts (id, account_type, system_key, status, balance) values ($1::uuid, 'ESCROW', $2, 'active', 0);",
      [escrowAccountId, `POKER_TABLE:${tableId}`],
    );
    await tx.unsafe(`
      insert into public.chips_transactions
        (id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id, created_at)
      values ($1::uuid, $2, $3::jsonb, $4, $5, 'TABLE_BUY_IN', null, $6::timestamptz);
    `, [
      transactionId,
      `BOT_SEED_BUY_IN:${tableId}:${index + 1}`,
      JSON.stringify({ tableId }),
      key,
      `${"a".repeat(63)}${index.toString(16)}`,
      createdAt[index],
    ]);
    const entries = await tx.unsafe(`
      insert into public.chips_entries (transaction_id, account_id, amount, metadata)
      values ($1::uuid, $2::uuid, -100, '{}'::jsonb), ($1::uuid, $3::uuid, 100, '{}'::jsonb)
      returning id;
    `, [transactionId, systemAccountId, escrowAccountId]);
    await tx.unsafe("update public.poker_tables set status = 'CLOSED' where id = $1::uuid;", [tableId]);
    await tx.unsafe(`
      update public.chips_transaction_idempotency
         set table_id = $2::uuid, key_format_version = 1, key_format = 'bot-seed-buyin'
       where transaction_id = $1::uuid;
    `, [transactionId, tableId]);
    transactionIds.push(transactionId);
    entryIds.push(...entries.map((row) => String(row.id)));
    keys.push(key);
    escrowAccountIds.push(escrowAccountId);
  }
  await tx.unsafe("set constraints all immediate;");

  const compressedSha = objectHex.repeat(64);
  const objectPath = `v1/sha256/${compressedSha}.jsonl.gz`;
  await tx.unsafe(`
    insert into public.chips_ledger_archive_batches (
      batch_id, object_path, project_ref, format_version, cutoff,
      first_created_at, last_created_at, cursor_end_created_at, cursor_end_id,
      transaction_count, entry_count, tx_types, raw_bytes, compressed_bytes,
      raw_sha256, compressed_sha256, credits, debits, net_amount, source_policy_id,
      legacy_allowlist_sha256, legacy_batch_table_ids_sha256, legacy_master_table_ids,
      legacy_master_table_count, legacy_batch_number, legacy_batch_table_count,
      legacy_source_run, legacy_query_sha256, legacy_stage_system_identifier,
      status, committed_at
    ) overriding system value values (
      $1::bigint, $2, 'krydukthwdvccggbyjfw', 2, $3::timestamptz,
      $4::timestamptz, $5::timestamptz, $5::timestamptz, $6::uuid,
      10, 20, '{"TABLE_BUY_IN":10}'::jsonb, 1000, 1000,
      $7, $8, 1000, 1000, 0, 'legacy_stage_allowlist_v1',
      $9, $10, $11::uuid[], 974, 1, 10, $12, $13,
      '7656985631720456337', 'committed', now()
    );
  `, [
    batchId,
    objectPath,
    cutoff,
    createdAt[0],
    createdAt[createdAt.length - 1],
    transactionIds[transactionIds.length - 1],
    "b".repeat(64),
    compressedSha,
    legacyPlan.allowlistSha256,
    legacyPlan.batchTableIdsSha256,
    masterTableIds,
    legacyPlan.sourceRun,
    legacyPlan.querySha256,
  ]);

  return {
    batchId,
    objectPath,
    cutoff,
    tableIds,
    masterTableIds,
    transactionIds,
    entryIds,
    keys: keys.sort(),
    escrowAccountIds,
    allowlistSha256: legacyPlan.allowlistSha256,
    batchTableIdsSha256: legacyPlan.batchTableIdsSha256,
    sourceRun: legacyPlan.sourceRun,
    querySha256: legacyPlan.querySha256,
    systemIdentifier: legacyPlan.stageSystemIdentifier,
    systemAccountId,
  };
}

async function legacyPrune(tx, fixture, {
  batchTableIds = fixture.tableIds,
  batchTableIdsSha256 = fixture.batchTableIdsSha256,
  execute = true,
  approvedBatchId = fixture.batchId,
} = {}) {
  const rows = await tx.unsafe(`
    select public.chips_prune_legacy_stage_allowlist_batch(
      $1, $2::uuid[], $3::bigint[], $4::uuid[], $5, $6, $7::text[], $8, $9::bigint
    ) as result;
  `, [
    fixture.objectPath,
    fixture.transactionIds,
    fixture.entryIds,
    batchTableIds,
    fixture.allowlistSha256,
    batchTableIdsSha256,
    fixture.keys,
    execute,
    approvedBatchId,
  ]);
  return rows[0].result;
}

async function legacyState(tx, fixture) {
  const rows = await tx.unsafe(`
    select
      (select count(*) from public.chips_transactions where id = any($1::uuid[])) as hot_transactions,
      (select count(*) from public.chips_entries where id = any($2::bigint[])) as hot_entries,
      (select count(*) from public.chips_transaction_idempotency where idempotency_key = any($3::text[])) as registry_rows,
      (select count(*) from public.poker_tables where id = any($4::uuid[])) as table_rows,
      (select count(*) from public.poker_tables where id = any($4::uuid[]) and bot_only_retention_complete_at is not null) as marked_tables,
      (select pruned_at from public.chips_ledger_archive_batches where batch_id = $5::bigint) as pruned_at,
      (select registry_cleaned_at from public.chips_ledger_archive_batches where batch_id = $5::bigint) as registry_cleaned_at;
  `, [fixture.transactionIds, fixture.entryIds, fixture.keys, fixture.tableIds, fixture.batchId]);
  return rows[0];
}

async function registerCompleteCleanupReceipt(tx, fixture, { removeTable = false } = {}) {
  const proof = await tx.unsafe(`
    select public.chips_register_bot_only_archive_proof(
      $1, $2::uuid[], $3::bigint[], $4::uuid, $5::text[]
    ) as result;
  `, [fixture.objectPath, [fixture.transactionId], fixture.entryIds, fixture.tableId, [fixture.key]]);
  assert.equal(proof[0].result.state, "proof_registered");
  const proofRows = await tx.unsafe(`
    select archived_transaction_ids_sha256, archived_entry_ids_sha256
      from public.chips_ledger_archive_batches
     where object_path = $1;
  `, [fixture.objectPath]);
  assert.equal(proofRows.length, 1);

  if (removeTable) {
    const cleaned = await automaticCleanup(tx, fixture);
    assert.equal(cleaned.state, "cleaned");
    await tx.unsafe("delete from public.poker_tables where id = $1::uuid;", [fixture.tableId]);
    return;
  }

  await tx.unsafe("select set_config('chips.bot_only_go', '1', true);");
  await tx.unsafe(`
    update public.chips_ledger_archive_batches
       set destructive_go_at = now(), destructive_go_batch_id = batch_id
     where object_path = $1;
  `, [fixture.objectPath]);
  await tx.unsafe("set local role chips_ledger_archive_pruner;");
  await tx.unsafe("select set_config('chips.bot_only_prune', '1', true);");
  await tx.unsafe(`
    update public.chips_ledger_archive_batches
       set pruned_at = now(),
           pruned_transaction_count = 1,
           pruned_entry_count = 2,
           pruned_transaction_ids_sha256 = $2,
           pruned_entry_ids_sha256 = $3
     where object_path = $1;
  `, [fixture.objectPath, proofRows[0].archived_transaction_ids_sha256, proofRows[0].archived_entry_ids_sha256]);
  const registryHash = await tx.unsafe(
    "select public.chips_archive_text_ids_sha256($1::text[]) as hash;",
    [[fixture.key]],
  );
  await tx.unsafe("select set_config('chips.bot_cleanup_receipt', '1', true);");
  await tx.unsafe(`
    update public.chips_ledger_archive_batches
       set registry_cleaned_at = now(),
           registry_cleaned_key_count = 1,
           registry_cleaned_keys_sha256 = $2
     where object_path = $1;
  `, [fixture.objectPath, registryHash[0].hash]);
  await tx.unsafe("reset role;");
}

async function automaticCleanup(tx, fixture) {
  const rows = await tx.unsafe(`
    select public.chips_auto_prune_and_cleanup_bot_only_archive_batch(
      $1, $2::uuid[], $3::bigint[], $4::text[], $5::uuid
    ) as result;
  `, [fixture.objectPath, [fixture.transactionId], fixture.entryIds, [fixture.key], fixture.tableId]);
  return rows[0].result;
}

async function accountingSnapshot(tx, fixture) {
  const accounts = await tx.unsafe(`
    select id::text as id, balance::text as balance, next_entry_seq::text as next_entry_seq
      from public.chips_accounts
     where id = any($1::uuid[])
     order by id;
  `, [[fixture.systemAccountId, fixture.escrowAccountId]]);
  const totals = await tx.unsafe("select coalesce(sum(amount), 0)::text as conservation from public.chips_entries;");
  return { accounts, conservation: totals[0].conservation };
}

async function insertCanary(tx) {
  const canarySha = "8".repeat(64);
  const canaryPath = "v1/sha256/" + canarySha + ".jsonl.gz";
  const keysHash = await tx.unsafe(
    "select public.chips_archive_text_ids_sha256(array['canary-key']::text[]) as hash;",
  );
  const emptyHash = await tx.unsafe(
    "select public.chips_archive_text_ids_sha256(array[]::text[]) as hash;",
  );
  const inserted = await tx.unsafe(`
    insert into public.chips_ledger_archive_batches (
      object_path, project_ref, format_version, cutoff, transaction_count, entry_count, tx_types,
      raw_bytes, compressed_bytes, raw_sha256, compressed_sha256, credits, debits, net_amount,
      source_policy_id, bot_only_table_id, bot_only_table_count, bot_only_newest_created_at,
      bot_only_registry_keys_sha256, bot_only_out_of_scope_keys_sha256, bot_only_identity_count,
      bot_only_eligible_count, archived_transaction_ids_sha256, archived_entry_ids_sha256,
      archive_proof_verified_at, pruned_at, pruned_transaction_count, pruned_entry_count,
      pruned_transaction_ids_sha256, pruned_entry_ids_sha256, registry_cleaned_at,
      registry_cleaned_key_count, registry_cleaned_keys_sha256, destructive_go_at,
      destructive_go_batch_id, status, committed_at
    ) values (
      $1, 'krydukthwdvccggbyjfw', 2, now(), 1, 2, '{"TABLE_BUY_IN":1}'::jsonb,
      10, 10, $2, $3, 100, 100, 0,
      'stage-ledger-bot-only-retention-7d-v1', $4::uuid, 1, now(), $5, $6, 1, 1,
      $7, $8, now(), now(), 1, 2, $7, $8, now(), 1, $5, null, null,
      'committed', now()
    ) returning batch_id::text as batch_id;
  `, [
    canaryPath,
    "1".repeat(64),
    canarySha,
    randomUUID(),
    keysHash[0].hash,
    emptyHash[0].hash,
    "3".repeat(64),
    "4".repeat(64),
  ]);
  const batchId = inserted[0].batch_id;
  await tx.unsafe("select set_config('chips.bot_only_go', '1', true);");
  await tx.unsafe(
    "update public.chips_ledger_archive_batches set destructive_go_at = now(), destructive_go_batch_id = $1::bigint where batch_id = $1::bigint;",
    [batchId],
  );
  const activated = await tx.unsafe(
    "select public.chips_activate_bot_only_retention_policy($1::bigint, $2) as result;",
    [batchId, `ACTIVATE stage-ledger-bot-only-retention-7d-v1 CANARY ${batchId}`],
  );
  assert.equal(activated[0].result.state, "active");
  return batchId;
}

async function disposablePostgresContract() {
  const sql = postgres(dbUrl, { max: 1, prepare: false, idle_timeout: 5 });
  const gateRows = await sql.unsafe(`
    select
      pg_get_functiondef('public.chips_assert_archive_prune_stage()'::regprocedure) as stage_definition,
      pg_get_functiondef('public.chips_assert_archive_prune_target(text,bigint)'::regprocedure) as target_definition;
  `);
  try {
    await sql.unsafe(`
      create or replace function public.chips_assert_archive_prune_stage()
      returns text language sql security definer set search_path = ''
      as $stage_cleanup_test_stage$ select '7656985631720456337'::text $stage_cleanup_test_stage$;
    `);
    await sql.unsafe(`
      create or replace function public.chips_assert_archive_prune_target(p_project_ref text, p_transaction_count bigint)
      returns text language plpgsql security definer set search_path = ''
      as $stage_cleanup_test_target$
      begin
        if p_project_ref = 'krydukthwdvccggbyjfw' and p_transaction_count between 1 and 5000 then
          return '7656985631720456337';
        end if;
        raise exception 'test target gate rejected request';
      end
      $stage_cleanup_test_target$;
    `);

    await sql.begin(async (tx) => {
      await tx.unsafe("set transaction isolation level serializable;");
      const sqlPlan = await tx.unsafe(`
        select public.chips_legacy_stage_allowlist_run_plan_sha256(
          1, $1, $2, $3, $4::timestamptz, $5, $6, $7, 964, 2, 98, 97
        ) as plan_sha256;
      `, [
        "legacy_stage_allowlist_v1",
        "krydukthwdvccggbyjfw",
        "7656985631720456337",
        "2026-08-17T16:51:28.074Z",
        "611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05",
        "eb5593bdf5bd7f3c985373e6037a861d999413eae5076b923165c7f8147a79e7",
        "a7bd1aea6bfe0435609cce6ccbe78f9ba55cab062e3cf55fd933fade5f029fc8",
      ]);
      assert.equal(sqlPlan[0].plan_sha256, buildLegacyStageAllowlistRunContract(loadFrozenLegacyAllowlist({ cwd: root }).masterManifest).planSha256);
      const inactive = await tx.unsafe("select public.chips_bot_only_retention_automatic_active() as active;");
      assert.equal(inactive[0].active, false, "automatic policy must be disabled before activation");
      const legacyFixture = await disposableLegacyFixture(tx);
      await tx.unsafe(`
        select setval(
          pg_get_serial_sequence('public.chips_ledger_archive_batches', 'batch_id'),
          greatest(1000, (select coalesce(max(batch_id), 0) from public.chips_ledger_archive_batches)),
          false
        );
      `);
      const canaryBatchId = await insertCanary(tx);
      const fixture = await disposableBotFixture(tx);
      const before = await accountingSnapshot(tx, fixture);
      const proof = await tx.unsafe(`
        select public.chips_register_bot_only_archive_proof(
          $1, $2::uuid[], $3::bigint[], $4::uuid, $5::text[]
        ) as result;
      `, [
        fixture.objectPath,
        [fixture.transactionId],
        fixture.entryIds,
        fixture.tableId,
        [fixture.key],
      ]);
      assert.equal(proof[0].result.state, "proof_registered");

      const manifestStore = createPruneStore({
        unsafe: (...args) => tx.unsafe(...args),
        begin: async (callback) => callback(tx),
      });
      const refreshedManifest = await manifestStore.getManifest(fixture.objectPath);
      assert.equal(refreshedManifest.bot_only_table_exists, true);
      assert.equal(refreshedManifest.bot_only_retention_complete_at, null);
      const hashLines = (values) => crypto.createHash("sha256")
        .update(values.map((value) => `${value}\n`).join(""), "utf8")
        .digest("hex");
      const reconstructionEvidence = {
        transactionCount: refreshedManifest.transaction_count,
        entryCount: refreshedManifest.entry_count,
        transactionIdsSha256: hashLines([fixture.transactionId]),
        entryIdsSha256: hashLines(fixture.entryIds),
        txTypes: refreshedManifest.tx_types,
        credits: refreshedManifest.credits,
        debits: refreshedManifest.debits,
        net: refreshedManifest.net_amount,
        registryKeys: [fixture.key],
        registryKeysSha256: refreshedManifest.bot_only_registry_keys_sha256,
        tableId: refreshedManifest.bot_only_table_id,
        distinctTables: 1,
        outOfScopeKeysSha256: refreshedManifest.bot_only_out_of_scope_keys_sha256,
      };
      assert.equal(refreshedManifest.archived_transaction_ids_sha256, reconstructionEvidence.transactionIdsSha256);
      assert.equal(refreshedManifest.archived_entry_ids_sha256, reconstructionEvidence.entryIdsSha256);
      assert.equal(assertAutomaticBotOnlyRecoveryReconstructionState({
        row: refreshedManifest,
        identity: "7656985631720456337",
        evidence: reconstructionEvidence,
        dryRunState: "ready",
        durable: null,
      }), true);

      const automatic = await tx.unsafe(`
        select public.chips_auto_prune_and_cleanup_bot_only_archive_batch(
          $1, $2::uuid[], $3::bigint[], $4::text[], $5::uuid
        ) as result;
      `, [fixture.objectPath, [fixture.transactionId], fixture.entryIds, [fixture.key], fixture.tableId]);
      assert.equal(automatic[0].result.state, "cleaned");
      const after = await accountingSnapshot(tx, fixture);
      assert.deepEqual(after.accounts, before.accounts, "automatic cleanup must preserve balances and next_entry_seq");
      assert.equal(after.conservation, before.conservation, "automatic cleanup must preserve conservation");

      const receipt = await tx.unsafe(`
        select
          pruned_at, registry_cleaned_at,
          pruned_transaction_count, pruned_entry_count, registry_cleaned_key_count,
          (select count(*) from public.chips_transactions where id = $1::uuid) as hot_transactions,
          (select count(*) from public.chips_entries where id = any($2::bigint[])) as hot_entries,
          (select count(*) from public.chips_transaction_idempotency where archive_batch_id = batches.batch_id) as remaining_registry_count,
          (select bot_only_retention_complete_at from public.poker_tables where id = $3::uuid) as table_complete
        from public.chips_ledger_archive_batches batches
        where object_path = $4;
      `, [fixture.transactionId, fixture.entryIds, fixture.tableId, fixture.objectPath]);
      assert.ok(receipt[0].pruned_at);
      assert.ok(receipt[0].registry_cleaned_at);
      assert.equal(Number(receipt[0].pruned_transaction_count), 1);
      assert.equal(Number(receipt[0].pruned_entry_count), 2);
      assert.equal(Number(receipt[0].registry_cleaned_key_count), 1);
      assert.equal(Number(receipt[0].hot_transactions), 0);
      assert.equal(Number(receipt[0].hot_entries), 0);
      assert.equal(Number(receipt[0].remaining_registry_count), 0);
      assert.ok(receipt[0].table_complete);

      const retry = await tx.unsafe(`
        select public.chips_auto_prune_and_cleanup_bot_only_archive_batch(
          $1, $2::uuid[], $3::bigint[], $4::text[], $5::uuid
        ) as result;
      `, [fixture.objectPath, [fixture.transactionId], fixture.entryIds, [fixture.key], fixture.tableId]);
      assert.equal(retry[0].result.state, "already_cleaned");

      const missingTableFixture = await disposableBotFixture(tx, { objectHex: "a" });
      await registerCompleteCleanupReceipt(tx, missingTableFixture, { removeTable: true });
      assert.equal((await automaticCleanup(tx, missingTableFixture)).state, "already_cleaned");

      const markedTableFixture = await disposableBotFixture(tx, {
        objectHex: "b",
        lifecycleMarker: "2026-08-28T00:00:00Z",
      });
      await registerCompleteCleanupReceipt(tx, markedTableFixture);
      assert.equal((await automaticCleanup(tx, markedTableFixture)).state, "already_cleaned");

      const emptyMarkerFixture = await disposableBotFixture(tx, { objectHex: "c" });
      await registerCompleteCleanupReceipt(tx, emptyMarkerFixture);
      await tx.unsafe("savepoint empty_lifecycle_marker_replay;");
      let emptyMarkerError = null;
      try {
        await automaticCleanup(tx, emptyMarkerFixture);
      } catch (error) {
        emptyMarkerError = error;
      }
      await tx.unsafe("rollback to savepoint empty_lifecycle_marker_replay;");
      await tx.unsafe("release savepoint empty_lifecycle_marker_replay;");
      assert.equal(emptyMarkerError?.code, "P8925");

      const vanishedTableFixture = await disposableBotFixture(tx, { objectHex: "e" });
      const vanishedProof = await tx.unsafe(`
        select public.chips_register_bot_only_archive_proof(
          $1, $2::uuid[], $3::bigint[], $4::uuid, $5::text[]
        ) as result;
      `, [vanishedTableFixture.objectPath, [vanishedTableFixture.transactionId], vanishedTableFixture.entryIds, vanishedTableFixture.tableId, [vanishedTableFixture.key]]);
      assert.equal(vanishedProof[0].result.state, "proof_registered");
      const vanishedBatchRows = await tx.unsafe(
        "select batch_id::text as batch_id from public.chips_ledger_archive_batches where object_path = $1;",
        [vanishedTableFixture.objectPath],
      );
      const vanishedBatchId = vanishedBatchRows[0].batch_id;
      const vanishedAuthorization = await tx.unsafe(
        "select public.chips_authorize_bot_only_archive_batch($1::bigint, $2) as result;",
        [vanishedBatchId, `GO ${vanishedBatchId}`],
      );
      assert.equal(vanishedAuthorization[0].result.state, "authorized");
      await tx.unsafe(`
        create or replace function public.chips_stage_cleanup_test_remove_table_after_receipt()
        returns trigger language plpgsql security definer set search_path = ''
        as $stage_cleanup_test_remove_table$
        begin
          delete from public.poker_tables
           where id = pg_catalog.current_setting('chips.stage_cleanup_test_table')::uuid;
          return new;
        end
        $stage_cleanup_test_remove_table$;
        drop trigger if exists aaa_stage_cleanup_test_remove_table_after_receipt on public.chips_ledger_archive_batches;
        create trigger aaa_stage_cleanup_test_remove_table_after_receipt
        after update of registry_cleaned_at on public.chips_ledger_archive_batches
        for each row
        when (new.registry_cleaned_at is distinct from old.registry_cleaned_at)
        execute function public.chips_stage_cleanup_test_remove_table_after_receipt();
      `);
      await tx.unsafe("savepoint lifecycle_missing_table_rollback;");
      await tx.unsafe("select set_config('chips.stage_cleanup_test_table', $1, true);", [vanishedTableFixture.tableId]);
      let vanishedTableError = null;
      try {
        await tx.unsafe(`
          select public.chips_prune_and_cleanup_bot_only_archive_batch(
            $1, $2::uuid[], $3::bigint[], $4::text[], $5::uuid, true, $6::bigint
          ) as result;
        `, [vanishedTableFixture.objectPath, [vanishedTableFixture.transactionId], vanishedTableFixture.entryIds, [vanishedTableFixture.key], vanishedTableFixture.tableId, vanishedBatchId]);
      } catch (error) {
        vanishedTableError = error;
      }
      await tx.unsafe("rollback to savepoint lifecycle_missing_table_rollback;");
      await tx.unsafe("release savepoint lifecycle_missing_table_rollback;");
      assert.equal(vanishedTableError?.code, "P8925");
      const vanishedState = await tx.unsafe(`
        select
          (select count(*) from public.poker_tables where id = $1::uuid) as table_exists,
          (select count(*) from public.chips_transactions where id = $2::uuid) as hot_transactions,
          (select count(*) from public.chips_entries where id = any($3::bigint[])) as hot_entries,
          (select count(*) from public.chips_transaction_idempotency where idempotency_key = $4) as registry_rows,
          (select pruned_at from public.chips_ledger_archive_batches where batch_id = $5::bigint) as pruned_at,
          (select registry_cleaned_at from public.chips_ledger_archive_batches where batch_id = $5::bigint) as cleaned_at,
          (select bot_only_retention_complete_at from public.poker_tables where id = $1::uuid) as lifecycle_marker;
      `, [vanishedTableFixture.tableId, vanishedTableFixture.transactionId, vanishedTableFixture.entryIds, vanishedTableFixture.key, vanishedBatchId]);
      assert.equal(Number(vanishedState[0].table_exists), 1);
      assert.equal(Number(vanishedState[0].hot_transactions), 1);
      assert.equal(Number(vanishedState[0].hot_entries), 2);
      assert.equal(Number(vanishedState[0].registry_rows), 1);
      assert.equal(vanishedState[0].pruned_at, null);
      assert.equal(vanishedState[0].cleaned_at, null);
      assert.equal(vanishedState[0].lifecycle_marker, null);
      await tx.unsafe("drop trigger aaa_stage_cleanup_test_remove_table_after_receipt on public.chips_ledger_archive_batches;");
      await tx.unsafe("drop function public.chips_stage_cleanup_test_remove_table_after_receipt();");

      const rollbackFixture = await disposableBotFixture(tx, { objectHex: "d" });
      const rollbackProof = await tx.unsafe(`
        select public.chips_register_bot_only_archive_proof(
          $1, $2::uuid[], $3::bigint[], $4::uuid, $5::text[]
        ) as result;
      `, [rollbackFixture.objectPath, [rollbackFixture.transactionId], rollbackFixture.entryIds, rollbackFixture.tableId, [rollbackFixture.key]]);
      assert.equal(rollbackProof[0].result.state, "proof_registered");
      const rollbackBatchRows = await tx.unsafe(
        "select batch_id::text as batch_id from public.chips_ledger_archive_batches where object_path = $1;",
        [rollbackFixture.objectPath],
      );
      const rollbackBatchId = rollbackBatchRows[0].batch_id;
      const rollbackAuthorization = await tx.unsafe(
        "select public.chips_authorize_bot_only_archive_batch($1::bigint, $2) as result;",
        [rollbackBatchId, `GO ${rollbackBatchId}`],
      );
      assert.equal(rollbackAuthorization[0].result.state, "authorized");
      await tx.unsafe(`
        create or replace function public.chips_stage_cleanup_test_suppress_lifecycle()
        returns trigger language plpgsql set search_path = ''
        as $stage_cleanup_test_suppress$
        begin
          return null;
        end
        $stage_cleanup_test_suppress$;
        drop trigger if exists aaa_stage_cleanup_test_suppress_lifecycle on public.poker_tables;
        create trigger aaa_stage_cleanup_test_suppress_lifecycle
        before update of bot_only_retention_complete_at on public.poker_tables
        for each row execute function public.chips_stage_cleanup_test_suppress_lifecycle();
      `);
      await tx.unsafe("savepoint lifecycle_transition_rollback;");
      let lifecycleTransitionError = null;
      try {
        await tx.unsafe(`
          select public.chips_prune_and_cleanup_bot_only_archive_batch(
            $1, $2::uuid[], $3::bigint[], $4::text[], $5::uuid, true, $6::bigint
          ) as result;
        `, [rollbackFixture.objectPath, [rollbackFixture.transactionId], rollbackFixture.entryIds, [rollbackFixture.key], rollbackFixture.tableId, rollbackBatchId]);
      } catch (error) {
        lifecycleTransitionError = error;
      }
      await tx.unsafe("rollback to savepoint lifecycle_transition_rollback;");
      await tx.unsafe("release savepoint lifecycle_transition_rollback;");
      assert.equal(lifecycleTransitionError?.code, "P8925");
      const rollbackState = await tx.unsafe(`
        select
          (select count(*) from public.chips_transactions where id = $1::uuid) as hot_transactions,
          (select count(*) from public.chips_entries where id = any($2::bigint[])) as hot_entries,
          (select count(*) from public.chips_transaction_idempotency where idempotency_key = $3) as registry_rows,
          (select pruned_at from public.chips_ledger_archive_batches where batch_id = $4::bigint) as pruned_at,
          (select registry_cleaned_at from public.chips_ledger_archive_batches where batch_id = $4::bigint) as cleaned_at,
          (select bot_only_retention_complete_at from public.poker_tables where id = $5::uuid) as lifecycle_marker;
      `, [rollbackFixture.transactionId, rollbackFixture.entryIds, rollbackFixture.key, rollbackBatchId, rollbackFixture.tableId]);
      assert.equal(Number(rollbackState[0].hot_transactions), 1);
      assert.equal(Number(rollbackState[0].hot_entries), 2);
      assert.equal(Number(rollbackState[0].registry_rows), 1);
      assert.equal(rollbackState[0].pruned_at, null);
      assert.equal(rollbackState[0].cleaned_at, null);
      assert.equal(rollbackState[0].lifecycle_marker, null);
      await tx.unsafe("drop trigger aaa_stage_cleanup_test_suppress_lifecycle on public.poker_tables;");
      await tx.unsafe("drop function public.chips_stage_cleanup_test_suppress_lifecycle();");

      await tx.unsafe("savepoint replay_old_registry_key;");
      let replayError = null;
      try {
        await tx.unsafe(`
          insert into public.chips_transactions
            (id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id)
          values ($1::uuid, $2, $3::jsonb, $4, $5, 'TABLE_BUY_IN', null);
        `, [
          randomUUID(),
          `BOT_SEED_BUY_IN:${fixture.tableId}:replay`,
          JSON.stringify({ tableId: fixture.tableId }),
          fixture.key,
          "f".repeat(64),
        ]);
      } catch (error) {
        replayError = error;
      }
      await tx.unsafe("rollback to savepoint replay_old_registry_key;");
      await tx.unsafe("release savepoint replay_old_registry_key;");
      assert.equal(replayError?.code, "P8903");
      assert.match(replayError?.message || "", /closed or missing/);

      const assertLegacyUnchanged = async (label) => {
        const state = await legacyState(tx, legacyFixture);
        assert.equal(Number(state.hot_transactions), 10, `${label}: transactions must remain hot`);
        assert.equal(Number(state.hot_entries), 20, `${label}: entries must remain hot`);
        assert.equal(Number(state.registry_rows), 10, `${label}: registry must remain`);
        assert.equal(Number(state.table_rows), 10, `${label}: tables must remain`);
        assert.equal(Number(state.marked_tables), 0, `${label}: no lifecycle marker may be left`);
        assert.equal(state.pruned_at, null, `${label}: prune receipt must not be left`);
        assert.equal(state.registry_cleaned_at, null, `${label}: registry receipt must not be left`);
      };
      const expectLegacyFailure = async (savepoint, action, code, label) => {
        await tx.unsafe(`savepoint ${savepoint};`);
        let failure = null;
        try {
          await action();
        } catch (error) {
          failure = error;
        }
        await tx.unsafe(`rollback to savepoint ${savepoint};`);
        await tx.unsafe(`release savepoint ${savepoint};`);
        assert.equal(failure?.code, code, `${label} must fail closed`);
        await assertLegacyUnchanged(label);
      };

      await expectLegacyFailure(
        "legacy_missing_proof",
        () => legacyPrune(tx, legacyFixture),
        "P8934",
        "missing legacy proof",
      );

      const legacyProof = await tx.unsafe(`
        select public.chips_register_legacy_stage_allowlist_proof(
          $1, $2::uuid[], $3::bigint[], $4::uuid[], $5::uuid[], $6, $7,
          974, 1, $8, $9, $10, $11::timestamptz
        ) as result;
      `, [
        legacyFixture.objectPath,
        legacyFixture.transactionIds,
        legacyFixture.entryIds,
        legacyFixture.tableIds,
        legacyFixture.masterTableIds,
        legacyFixture.allowlistSha256,
        legacyFixture.batchTableIdsSha256,
        legacyFixture.sourceRun,
        legacyFixture.querySha256,
        legacyFixture.systemIdentifier,
        legacyFixture.cutoff,
      ]);
      assert.equal(legacyProof[0].result.state, "proof_registered");

      await expectLegacyFailure(
        "legacy_missing_go",
        () => legacyPrune(tx, legacyFixture),
        "P8935",
        "missing legacy GO",
      );

      const legacyAuthorization = await tx.unsafe(
        "select public.chips_authorize_legacy_stage_allowlist_batch($1::bigint, $2, $3) as result;",
        [legacyFixture.batchId, `GO ${legacyFixture.batchId}`, legacyFixture.allowlistSha256],
      );
      assert.equal(legacyAuthorization[0].result.state, "authorized");

      await expectLegacyFailure(
        "legacy_open_table",
        async () => {
          await tx.unsafe("update public.poker_tables set status = 'OPEN' where id = $1::uuid;", [legacyFixture.tableIds[0]]);
          await legacyPrune(tx, legacyFixture);
        },
        "P8930",
        "OPEN legacy table",
      );
      await expectLegacyFailure(
        "legacy_human_table",
        async () => {
          await tx.unsafe("update public.poker_tables set has_human_participant = true where id = $1::uuid;", [legacyFixture.tableIds[0]]);
          await legacyPrune(tx, legacyFixture);
        },
        "P8930",
        "human-participant legacy table",
      );
      await expectLegacyFailure(
        "legacy_nonzero_escrow",
        async () => {
          await tx.unsafe("update public.chips_accounts set balance = 1 where id = $1::uuid;", [legacyFixture.escrowAccountIds[0]]);
          await legacyPrune(tx, legacyFixture);
        },
        "P8930",
        "non-zero legacy escrow",
      );

      const foreignTableIds = [randomUUID(), ...legacyFixture.tableIds.slice(1)];
      await expectLegacyFailure(
        "legacy_foreign_table",
        () => legacyPrune(tx, legacyFixture, { batchTableIds: foreignTableIds }),
        "P8938",
        "foreign legacy table ID",
      );

      await expectLegacyFailure(
        "legacy_hot_rows",
        async () => {
          const hotTransactionId = randomUUID();
          const hotKey = `bot-seed-buyin:${legacyFixture.tableIds[0]}:legacy-hot-row`;
          await tx.unsafe("set constraints all deferred;");
          await tx.unsafe("update public.poker_tables set status = 'OPEN' where id = $1::uuid;", [legacyFixture.tableIds[0]]);
          await tx.unsafe(`
            insert into public.chips_transactions
              (id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id, created_at)
            values ($1::uuid, $2, $3::jsonb, $4, $5, 'TABLE_BUY_IN', null, '2026-08-01T00:00:30Z'::timestamptz);
          `, [
            hotTransactionId,
            `BOT_SEED_BUY_IN:${legacyFixture.tableIds[0]}:hot`,
            JSON.stringify({ tableId: legacyFixture.tableIds[0] }),
            hotKey,
            "e".repeat(64),
          ]);
          await tx.unsafe(`
            insert into public.chips_entries (transaction_id, account_id, amount, metadata)
            values ($1::uuid, $2::uuid, -100, '{}'::jsonb), ($1::uuid, $3::uuid, 100, '{}'::jsonb);
          `, [hotTransactionId, legacyFixture.systemAccountId, legacyFixture.escrowAccountIds[0]]);
          await tx.unsafe("update public.poker_tables set status = 'CLOSED' where id = $1::uuid;", [legacyFixture.tableIds[0]]);
          await tx.unsafe("set constraints all immediate;");
          await legacyPrune(tx, legacyFixture);
        },
        "P8930",
        "remaining hot legacy rows",
      );

      const legacyAccountIds = [legacyFixture.systemAccountId, ...legacyFixture.escrowAccountIds];
      const legacyAccountsBefore = await tx.unsafe(`
        select id::text as id, balance::text as balance, next_entry_seq::text as next_entry_seq
          from public.chips_accounts
         where id = any($1::uuid[])
         order by id;
      `, [legacyAccountIds]);
      const legacyExecute = await legacyPrune(tx, legacyFixture);
      assert.equal(legacyExecute.state, "pruned");
      assert.equal(Number(legacyExecute.lifecycle_table_count), 10);
      const legacyAccountsAfter = await tx.unsafe(`
        select id::text as id, balance::text as balance, next_entry_seq::text as next_entry_seq
          from public.chips_accounts
         where id = any($1::uuid[])
         order by id;
      `, [legacyAccountIds]);
      assert.deepEqual(legacyAccountsAfter, legacyAccountsBefore, "legacy prune must preserve balances and next_entry_seq");
      const legacyCompleteState = await legacyState(tx, legacyFixture);
      assert.equal(Number(legacyCompleteState.hot_transactions), 0);
      assert.equal(Number(legacyCompleteState.hot_entries), 0);
      assert.equal(Number(legacyCompleteState.registry_rows), 0);
      assert.equal(Number(legacyCompleteState.table_rows), 10);
      assert.equal(Number(legacyCompleteState.marked_tables), 10);
      assert.ok(legacyCompleteState.pruned_at);
      assert.ok(legacyCompleteState.registry_cleaned_at);
      const legacyReceipt = await tx.unsafe(`
        select pruned_transaction_count, pruned_entry_count, registry_cleaned_key_count,
               registry_cleaned_keys_sha256
          from public.chips_ledger_archive_batches
         where batch_id = $1::bigint;
      `, [legacyFixture.batchId]);
      const expectedLegacyRegistryHash = await tx.unsafe(
        "select public.chips_archive_text_ids_sha256($1::text[]) as hash;",
        [legacyFixture.keys],
      );
      assert.equal(Number(legacyReceipt[0].pruned_transaction_count), 10);
      assert.equal(Number(legacyReceipt[0].pruned_entry_count), 20);
      assert.equal(Number(legacyReceipt[0].registry_cleaned_key_count), 10);
      assert.equal(legacyReceipt[0].registry_cleaned_keys_sha256, expectedLegacyRegistryHash[0].hash);

      await tx.unsafe("delete from public.poker_tables where id = any($1::uuid[]);", [legacyFixture.tableIds]);
      for (const tableId of legacyFixture.tableIds) {
        await tx.unsafe(
          "insert into public.poker_tables (id, status, has_human_participant, bot_only_proof_eligible) values ($1::uuid, 'CLOSED', false, false);",
          [tableId],
        );
      }
      const legacyRepair = await legacyPrune(tx, legacyFixture);
      assert.equal(legacyRepair.state, "already_pruned");
      assert.equal(Number((await legacyState(tx, legacyFixture)).marked_tables), 10);
      const markersBeforeRetry = await tx.unsafe(
        "select id::text as id, bot_only_retention_complete_at from public.poker_tables where id = any($1::uuid[]) order by id;",
        [legacyFixture.tableIds],
      );
      const legacyIdempotentRetry = await legacyPrune(tx, legacyFixture);
      assert.equal(legacyIdempotentRetry.state, "already_pruned");
      const markersAfterRetry = await tx.unsafe(
        "select id::text as id, bot_only_retention_complete_at from public.poker_tables where id = any($1::uuid[]) order by id;",
        [legacyFixture.tableIds],
      );
      assert.deepEqual(markersAfterRetry, markersBeforeRetry, "marked legacy retry must be idempotent");
      await tx.unsafe("delete from public.poker_tables where id = any($1::uuid[]);", [legacyFixture.tableIds]);
      assert.equal((await legacyPrune(tx, legacyFixture)).state, "already_pruned");

      const policy = await tx.unsafe(
        "select public.chips_bot_only_retention_automatic_active() as active;",
      );
      assert.equal(policy[0].active, true);
      assert.equal(canaryBatchId !== null, true);
      throw ROLLBACK;
    }).catch((error) => {
      if (error !== ROLLBACK) throw error;
    });
  } finally {
    await sql.unsafe(gateRows[0].stage_definition);
    await sql.unsafe(gateRows[0].target_definition);
    await sql.end({ timeout: 5 });
  }
}

await disposablePostgresContract();
process.stdout.write("chips-ledger-stage-cleanup orchestration contracts passed\n");
