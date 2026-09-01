import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import {
  BOT_ONLY_EXPORT_SCHEMA_VERSION,
  LEGACY_STAGE_ALLOWLIST_POLICY_ID,
  runExport,
  stringifyJson,
} from "./chips-ledger-archive-export.mjs";
import {
  buildRecoveryArchiveObjectPath,
  buildRecoveryManifestObjectPath,
  downloadPrivateArchiveObject,
  resolveStorageTarget,
  verifyArchiveBucket,
} from "./chips-ledger-archive-store.mjs";
import {
  LEGACY_STAGE_PHASES,
  pruneArchive,
  sqlStateOf,
} from "./chips-ledger-archive-prune.mjs";
import {
  assertDurableRecoveryForEvidence,
  STAGE_AUTOMATION_LOCK_KEY,
  STAGE_PROJECT_REF,
  STAGE_SYSTEM_IDENTIFIER,
  assertResumeRecoveryState,
  DURABLE_RECOVERY_STATES,
  inspectDurableRecoveryState,
  persistDurableRecovery,
  redactedError,
  validateStageEnvironment,
} from "./chips-ledger-stage-automation.mjs";
import {
  buildLegacyBatchManifest,
  buildLegacyPlan,
  buildLegacyStageAllowlistRunContract,
  LEGACY_STAGE_ALLOWLIST_BATCH_COUNT,
  LEGACY_STAGE_ALLOWLIST_MAX_BATCHES_PER_RUN,
  LEGACY_STAGE_ALLOWLIST_REMAINING_FIRST_BATCH,
  LEGACY_STAGE_ALLOWLIST_REMAINING_LAST_BATCH,
  loadFrozenLegacyAllowlist,
  readOnlyStagePreflight,
  runLegacyStagePrepareOnly,
} from "./chips-ledger-legacy-stage-allowlist.mjs";
import { LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13 } from "./chips-ledger-legacy-stage-allowlist-audit.mjs";
import { ensurePrivateDirectory } from "./_shared/chips-ledger-archive-files.mjs";

export const LEGACY_STAGE_ALLOWLIST_ORCHESTRATOR_POLICY_ID = LEGACY_STAGE_ALLOWLIST_POLICY_ID;
export const LEGACY_STAGE_ALLOWLIST_ORCHESTRATOR_MAX_BATCHES_PER_RUN = LEGACY_STAGE_ALLOWLIST_MAX_BATCHES_PER_RUN;
export const LEGACY_STAGE_ALLOWLIST_ORCHESTRATOR_LOCK_KEY = STAGE_AUTOMATION_LOCK_KEY;
const LEGACY_ORCHESTRATION_GO_PREFIX = "GO legacy-stage-allowlist-v1 remaining";
const LEGACY_PROOF_FIELDS = Object.freeze([
  "archive_proof_verified_at",
  "archived_transaction_ids_sha256",
  "archived_entry_ids_sha256",
]);
const LEGACY_RECEIPT_FIELDS = Object.freeze([
  "pruned_at",
  "pruned_transaction_count",
  "pruned_entry_count",
  "pruned_transaction_ids_sha256",
  "pruned_entry_ids_sha256",
  "registry_cleaned_at",
  "registry_cleaned_key_count",
  "registry_cleaned_keys_sha256",
]);
const LEGACY_EXECUTE_IMMUTABLE_FIELDS = Object.freeze([
  "object_path",
  "batch_id",
  "project_ref",
  "format_version",
  "cutoff",
  "cursor_start_created_at",
  "cursor_start_id",
  "cursor_end_created_at",
  "cursor_end_id",
  "first_created_at",
  "last_created_at",
  "transaction_count",
  "entry_count",
  "tx_types",
  "raw_bytes",
  "compressed_bytes",
  "raw_sha256",
  "compressed_sha256",
  "credits",
  "debits",
  "net_amount",
  "source_policy_id",
  "committed_at",
  "legacy_allowlist_sha256",
  "legacy_batch_table_ids_sha256",
  "legacy_master_table_ids",
  "legacy_master_table_count",
  "legacy_batch_number",
  "legacy_batch_table_count",
  "legacy_source_run",
  "legacy_query_sha256",
  "legacy_stage_system_identifier",
  "legacy_run_id",
  "legacy_plan_sha256",
  "archive_proof_verified_at",
  "archived_transaction_ids_sha256",
  "archived_entry_ids_sha256",
]);

function fail(message) {
  throw new Error(message);
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function isTrue(value) {
  return value === true || value === "t";
}

function batchNumberOf(row) {
  const value = text(row?.legacy_batch_number);
  return /^\d+$/.test(value) ? Number(value) : null;
}

function annotateLegacyPhaseError(error, {
  phase = null,
  row = null,
  batchNumber = null,
  batchId = null,
  attempts = null,
  sqlstates = null,
  recoveryAttempts = null,
  recoveryState = null,
  storage = null,
} = {}) {
  if (!error || typeof error !== "object") return error;
  const observedSqlstates = Array.isArray(sqlstates)
    ? [...sqlstates]
    : Array.isArray(error.executeSqlstates)
      ? [...error.executeSqlstates]
      : [];
  const sqlstate = sqlStateOf(error) || observedSqlstates.at(-1) || null;
  const observedRecoveryAttempts = recoveryAttempts ?? error.recoveryAttempts ?? error.storageAttempts ?? null;
  const storageMutation = error.storageMutation?.recoveryStorageModified;
  Object.assign(error, {
    batch_number: batchNumber ?? batchNumberOf(row) ?? error.batch_number ?? null,
    batch_id: batchId ?? (row?.batch_id == null ? error.batch_id ?? null : text(row.batch_id)),
    phase: phase || error.phase || null,
    attempts: phase === LEGACY_STAGE_PHASES.RECOVERY
      ? observedRecoveryAttempts ?? attempts ?? error.attempts ?? error.executeAttempts ?? 0
      : attempts ?? error.attempts ?? error.storageAttempts ?? error.executeAttempts ?? 0,
    sqlstate,
    sqlstates: observedSqlstates,
    recoveryAttempts: observedRecoveryAttempts,
    storageAttempts: error.storageAttempts ?? null,
    recoveryState: recoveryState || error.recoveryState || null,
    storageState: error.storageState
      || recoveryState
      || error.recoveryState
      || (storageMutation === true ? "modified" : storageMutation === false ? "unchanged" : storageMutation === null ? "unknown" : null),
    storage: storage || error.storage || null,
  });
  return error;
}

function phaseFailure(message, metadata = {}) {
  const error = new Error(message);
  throw annotateLegacyPhaseError(error, metadata);
}

function comparableManifestValue(value) {
  if (Array.isArray(value)) return `[${value.map(comparableManifestValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${comparableManifestValue(value[key])}`).join(",")}}`;
  }
  return value == null ? "<null>" : String(value);
}

function legacyErrorReport(error) {
  const sqlstates = Array.isArray(error?.sqlstates)
    ? [...error.sqlstates]
    : Array.isArray(error?.executeSqlstates)
      ? [...error.executeSqlstates]
      : [];
  const sqlstate = sqlStateOf(error) || sqlstates.at(-1) || null;
  return {
    batch_number: error?.batch_number ?? null,
    batch_id: error?.batch_id ?? null,
    phase: error?.phase || error?.chipsLedgerQueryPhase || LEGACY_STAGE_PHASES.PREPARE_MANIFEST,
    attempts: error?.attempts ?? error?.executeAttempts ?? 0,
    sqlstate,
    sqlstates,
    executeAttempts: error?.executeAttempts ?? 0,
    executeRetryCount: error?.executeRetryCount ?? 0,
    executeSqlstates: Array.isArray(error?.executeSqlstates)
      ? [...error.executeSqlstates]
      : [],
    recoveryAttempts: error?.recoveryAttempts ?? null,
    storageAttempts: error?.storageAttempts ?? null,
    recoveryState: error?.recoveryState ?? null,
    storageState: error?.storageState ?? error?.recoveryState ?? null,
    storage: error?.storage || null,
    reason: redactedError(error),
  };
}

function readOnlyQuery(sql, query, parameters = []) {
  return sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level repeatable read, read only;");
    return tx.unsafe(query, parameters);
  });
}

async function acquireOrchestratorLock(sql) {
  const rows = await sql.unsafe(
    "select pg_catalog.pg_backend_pid()::text as backend_pid, pg_catalog.pg_try_advisory_lock(pg_catalog.hashtextextended($1, 0)) as acquired;",
    [LEGACY_STAGE_ALLOWLIST_ORCHESTRATOR_LOCK_KEY],
  );
  if (!isTrue(rows[0]?.acquired)) return null;
  return text(rows[0]?.backend_pid) || fail("legacy allowlist orchestrator lock session is unavailable");
}

async function assertOrchestratorLock(sql, backendPid) {
  const rows = await sql.unsafe(`
    select
      pg_catalog.pg_backend_pid()::text as backend_pid,
      exists (
        select 1
          from pg_catalog.pg_locks
         where pid = pg_catalog.pg_backend_pid()
           and locktype = 'advisory'
           and mode = 'ExclusiveLock'
           and granted
           and classid::bigint = ((pg_catalog.hashtextextended($1, 0) >> 32) & 4294967295)
           and objid::bigint = (pg_catalog.hashtextextended($1, 0) & 4294967295)
      ) as lock_held;
  `, [LEGACY_STAGE_ALLOWLIST_ORCHESTRATOR_LOCK_KEY]);
  if (text(rows[0]?.backend_pid) !== backendPid || !isTrue(rows[0]?.lock_held)) {
    fail("legacy allowlist orchestrator advisory lock session was lost");
  }
}

async function releaseOrchestratorLock(sql) {
  await sql.unsafe(
    "select pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended($1, 0));",
    [LEGACY_STAGE_ALLOWLIST_ORCHESTRATOR_LOCK_KEY],
  );
}

function addReservedTransactionSupport(reserved) {
  // postgres.js reserve() returns a scoped client; keep transaction control on
  // that same reserved connection when the client does not expose begin().
  if (typeof reserved.begin === "function") return reserved;
  reserved.begin = async (options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = "";
    }
    if (typeof callback !== "function") fail("reserved PostgreSQL session transaction callback is required");
    const transactionOptions = typeof options === "string"
      ? options.replace(/[^a-z ]/gi, "")
      : "";
    await reserved.unsafe(`begin ${transactionOptions}`.trim());
    try {
      const callbackResult = callback(reserved);
      const result = Array.isArray(callbackResult)
        ? await Promise.all(callbackResult)
        : await callbackResult;
      await reserved.unsafe("commit");
      return result;
    } catch (error) {
      try { await reserved.unsafe("rollback"); } catch { /* preserve the transaction error */ }
      throw error;
    }
  };
  return reserved;
}

async function reserveOrchestratorSession(pool) {
  if (!pool || typeof pool.reserve !== "function") {
    fail("legacy allowlist orchestrator requires postgres.js reserve() for its advisory lock session");
  }
  const reserved = await pool.reserve();
  if (!reserved || typeof reserved.unsafe !== "function" || typeof reserved.release !== "function") {
    fail("legacy allowlist orchestrator reserved advisory lock session is invalid");
  }
  return addReservedTransactionSupport(reserved);
}

function assertBatch13AlreadyComplete(row) {
  if (!row
    || text(row.batch_id) !== LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.batchId
    || text(row.object_path) !== LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.objectPath
    || text(row.status) !== "committed"
    || text(row.source_policy_id) !== LEGACY_STAGE_ALLOWLIST_POLICY_ID
    || text(row.legacy_allowlist_sha256) !== LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.masterAllowlistSha256
    || text(row.legacy_batch_number) !== "1"
    || text(row.legacy_batch_table_count) !== "10"
    || !row.archive_proof_verified_at
    || !row.pruned_at
    || !row.registry_cleaned_at
    || text(row.pruned_transaction_count) !== String(LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.transactionCount)
    || text(row.pruned_entry_count) !== String(LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.entryCount)
    || text(row.registry_cleaned_key_count) !== String(LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.registryCount)
    || text(row.pruned_transaction_ids_sha256) !== LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.txIdsSha256
    || text(row.pruned_entry_ids_sha256) !== LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.entryIdsSha256
    || text(row.registry_cleaned_keys_sha256) !== LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.registryKeysSha256) {
    fail("deterministic legacy batch 13 completion is missing or differs");
  }
  return row;
}

async function loadAuthorization(sql, contract) {
  const rows = await readOnlyQuery(sql, `
    select
      run_id::text as run_id,
      project_ref,
      source_policy_id,
      stage_system_identifier,
      cutoff::text as cutoff,
      master_allowlist_sha256,
      master_manifest_sha256,
      remaining_table_ids_sha256,
      remaining_table_count::text as remaining_table_count,
      first_batch_number::text as first_batch_number,
      last_batch_number::text as last_batch_number,
      batch_count::text as batch_count,
      plan_sha256,
      status,
      destructive_go_at::text as destructive_go_at,
      destructive_go_confirmation
    from public.chips_legacy_stage_allowlist_runs
    where project_ref = $1
      and source_policy_id = $2
      and stage_system_identifier = $3
      and cutoff = $4::timestamptz
      and master_allowlist_sha256 = $5
      and master_manifest_sha256 = $6
      and remaining_table_ids_sha256 = $7
      and remaining_table_count = $8::bigint
      and first_batch_number = $9::bigint
      and last_batch_number = $10::bigint
      and batch_count = $11::bigint
      and plan_sha256 = $12
      and status = 'authorized';
  `, [
    contract.projectRef,
    contract.policyId,
    contract.systemIdentifier,
    contract.cutoff,
    contract.masterAllowlistSha256,
    contract.masterManifestSha256,
    contract.remainingTableIdsSha256,
    contract.remainingTableCount,
    contract.firstBatchNumber,
    contract.lastBatchNumber,
    contract.batchCount,
    contract.planSha256,
  ]);
  const expectedConfirmation = `${LEGACY_ORCHESTRATION_GO_PREFIX} ${contract.firstBatchNumber}-${contract.lastBatchNumber} ${contract.planSha256}`;
  if (rows.length !== 1
    || !rows[0].destructive_go_at
    || text(rows[0].destructive_go_confirmation) !== expectedConfirmation) {
    fail("one exact human GO for the frozen remaining legacy allowlist is required");
  }
  return rows[0];
}

async function loadLegacyBatchRows(sql, run) {
  return readOnlyQuery(sql, `
    select
      object_path,
      batch_id::text as batch_id,
      status,
      source_policy_id,
      legacy_run_id::text as legacy_run_id,
      legacy_plan_sha256,
      legacy_batch_number::text as legacy_batch_number,
      legacy_batch_table_count::text as legacy_batch_table_count,
      legacy_allowlist_sha256,
      legacy_batch_table_ids_sha256,
      archived_transaction_ids_sha256,
      archived_entry_ids_sha256,
      archive_proof_verified_at::text as archive_proof_verified_at,
      pruned_at::text as pruned_at,
      registry_cleaned_at::text as registry_cleaned_at,
      pruned_transaction_count::text as pruned_transaction_count,
      pruned_entry_count::text as pruned_entry_count,
      registry_cleaned_key_count::text as registry_cleaned_key_count,
      pruned_transaction_ids_sha256,
      pruned_entry_ids_sha256,
      registry_cleaned_keys_sha256,
      compressed_sha256,
      compressed_bytes::text as compressed_bytes,
      committed_at::text as committed_at,
      destructive_go_at::text as destructive_go_at,
      destructive_go_batch_id::text as destructive_go_batch_id
    from public.chips_ledger_archive_batches
    where source_policy_id = $1
      and legacy_run_id = $2::bigint
      and legacy_plan_sha256 = $3
    order by legacy_batch_number asc, object_path asc;
  `, [LEGACY_STAGE_ALLOWLIST_POLICY_ID, run.run_id, run.plan_sha256]);
}

function isCompleteLegacyBatch(row) {
  return Boolean(row?.status === "committed"
    && row.committed_at
    && row.archive_proof_verified_at
    && row.pruned_at
    && row.registry_cleaned_at
    && row.pruned_transaction_count
    && row.pruned_entry_count
    && row.registry_cleaned_key_count
    && row.pruned_transaction_ids_sha256
    && row.pruned_entry_ids_sha256
    && row.registry_cleaned_keys_sha256);
}

function assertLegacyBatchRows(rows) {
  const seen = new Set();
  for (const row of rows) {
    const batchNumber = Number(row.legacy_batch_number);
    if (!Number.isSafeInteger(batchNumber)
      || batchNumber < LEGACY_STAGE_ALLOWLIST_REMAINING_FIRST_BATCH
      || batchNumber > LEGACY_STAGE_ALLOWLIST_REMAINING_LAST_BATCH) {
      fail("legacy orchestration contains a batch outside the frozen remaining range");
    }
    if (seen.has(batchNumber)) fail("legacy orchestration contains duplicate manifests for one batch");
    seen.add(batchNumber);
    if (row.status !== "pending" && row.status !== "committed") {
      fail("legacy orchestration contains a manifest with an invalid state");
    }
    const proofCount = [
      row.archive_proof_verified_at,
      row.archived_transaction_ids_sha256,
      row.archived_entry_ids_sha256,
    ].filter((value) => value != null).length;
    const pruneCount = [
      row.pruned_at,
      row.pruned_transaction_count,
      row.pruned_entry_count,
      row.pruned_transaction_ids_sha256,
      row.pruned_entry_ids_sha256,
    ].filter((value) => value != null).length;
    const cleanupCount = [
      row.registry_cleaned_at,
      row.registry_cleaned_key_count,
      row.registry_cleaned_keys_sha256,
    ].filter((value) => value != null).length;
    if (proofCount !== 0 && proofCount !== 3) fail("legacy orchestration contains a partial archive proof");
    if (pruneCount !== 0 && pruneCount !== 5) fail("legacy orchestration contains a partial prune receipt");
    if (cleanupCount !== 0 && cleanupCount !== 3) fail("legacy orchestration contains a partial registry receipt");
    if (cleanupCount !== 0 && pruneCount !== 5) fail("legacy orchestration contains cleanup without a complete prune receipt");
    if (row.status === "pending" && (proofCount !== 0 || pruneCount !== 0 || cleanupCount !== 0)) {
      fail("legacy orchestration contains a pending manifest with lifecycle fields");
    }
  }
}

function lifecycleState(row, fields, label) {
  const present = fields.filter((field) => row[field] != null).length;
  if (present !== 0 && present !== fields.length) {
    fail(`legacy orchestration contains a partial ${label}`);
  }
  return present === fields.length ? "complete" : "empty";
}

function assertLegacyExecuteRetryBatch(row, plan, run, previousRow = null, expectedEvidence = null) {
  if (!row) fail(`legacy batch ${plan.batchNumber} manifest is missing during execute retry preflight`);
  if (previousRow) {
    for (const field of LEGACY_EXECUTE_IMMUTABLE_FIELDS) {
      if (comparableManifestValue(row[field]) !== comparableManifestValue(previousRow[field])) {
        fail(`legacy execute retry ${field} changed`);
      }
    }
  }
  if (row.status !== "committed"
    || !row.committed_at
    || text(row.project_ref) !== text(run.project_ref)
    || text(row.format_version) !== String(BOT_ONLY_EXPORT_SCHEMA_VERSION)
    || text(row.cutoff) !== text(run.cutoff)
    || text(row.legacy_stage_system_identifier) !== text(run.stage_system_identifier)) {
    fail(`legacy batch ${plan.batchNumber} manifest is not committed during execute retry`);
  }
  if (text(row.batch_id) === ""
    || text(row.source_policy_id) !== LEGACY_STAGE_ALLOWLIST_POLICY_ID
    || text(row.legacy_run_id) !== text(run.run_id)
    || text(row.legacy_plan_sha256) !== text(run.plan_sha256)
    || text(row.legacy_batch_number) !== String(plan.batchNumber)
    || text(row.legacy_allowlist_sha256) !== text(plan.allowlistSha256)) {
    fail(`legacy batch ${plan.batchNumber} is not bound to the authorized frozen run during execute retry`);
  }
  const proofState = lifecycleState(row, LEGACY_PROOF_FIELDS, "archive proof");
  if (proofState !== "complete") {
    fail(`legacy batch ${plan.batchNumber} execute retry requires complete archive proof`);
  }
  if (!expectedEvidence
    || text(row.transaction_count) !== String(expectedEvidence.transactionCount)
    || text(row.entry_count) !== String(expectedEvidence.entryCount)
    || text(row.archived_transaction_ids_sha256) !== text(expectedEvidence.transactionIdsSha256)
    || text(row.archived_entry_ids_sha256) !== text(expectedEvidence.entryIdsSha256)) {
    fail(`legacy batch ${plan.batchNumber} execute retry proof/evidence changed`);
  }
  const receiptState = lifecycleState(row, LEGACY_RECEIPT_FIELDS, "cleanup receipt");
  const hasGo = row.destructive_go_at != null;
  const hasGoBatch = row.destructive_go_batch_id != null;
  if (hasGo !== hasGoBatch || (hasGo && text(row.destructive_go_batch_id) !== text(row.batch_id))) {
    fail(`legacy batch ${plan.batchNumber} has a partial or foreign GO during execute retry`);
  }
  if (receiptState === "complete" && !hasGo) {
    fail(`legacy batch ${plan.batchNumber} has a complete receipt without its exact GO`);
  }
  if (receiptState === "complete"
    && (text(row.pruned_transaction_count) !== String(expectedEvidence.transactionCount)
      || text(row.pruned_entry_count) !== String(expectedEvidence.entryCount)
      || text(row.pruned_transaction_ids_sha256) !== text(expectedEvidence.transactionIdsSha256)
      || text(row.pruned_entry_ids_sha256) !== text(expectedEvidence.entryIdsSha256)
      || text(row.registry_cleaned_key_count) !== String(expectedEvidence.registryKeys.length)
      || text(row.registry_cleaned_keys_sha256) !== text(expectedEvidence.registryKeysSha256))) {
    fail(`legacy batch ${plan.batchNumber} complete receipt differs from current evidence`);
  }
  return { proofState, receiptState };
}

async function revalidateLegacyOrchestrationBeforeRetry({
  sql,
  lockPid,
  contract,
  run,
  plan,
  pruneStore,
  previousRow,
  evidence,
}) {
  if (!lockPid) fail(`legacy batch ${plan.batchNumber} execute retry advisory lock session is unavailable`);
  await assertOrchestratorLock(sql, lockPid);
  const refreshedRun = await loadAuthorization(sql, contract);
  if (text(refreshedRun.run_id) !== text(run.run_id)
    || text(refreshedRun.plan_sha256) !== text(run.plan_sha256)) {
    fail(`legacy batch ${plan.batchNumber} run binding changed during execute retry`);
  }
  const refreshedRow = await pruneStore.getManifest(previousRow.object_path);
  assertLegacyExecuteRetryBatch(refreshedRow, plan, refreshedRun, previousRow, evidence);
  await assertOrchestratorLock(sql, lockPid);
  return { row: refreshedRow };
}

async function inspectLegacyRecovery({ storageTarget, row, deps }) {
  if (typeof deps.inspectDurableRecoveryState === "function") {
    return deps.inspectDurableRecoveryState(storageTarget, row, deps);
  }
  if (typeof deps.inspectDurableRecovery === "function") {
    try {
      const durable = await deps.inspectDurableRecovery(storageTarget, row, deps);
      return {
        state: durable ? DURABLE_RECOVERY_STATES.COMPLETE : DURABLE_RECOVERY_STATES.BOTH_MISSING,
        durable: durable || null,
        attempts: durable?.recoveryAttempts || 1,
        storage: durable?.storage || null,
      };
    } catch (error) {
      return {
        state: error?.recoveryState || error?.storageState || DURABLE_RECOVERY_STATES.UNAVAILABLE,
        durable: null,
        attempts: error?.recoveryAttempts || 1,
        storage: error?.storage || null,
        error,
      };
    }
  }
  return inspectDurableRecoveryState(storageTarget, row, deps);
}

function assertLegacyRecoveryLifecycle(row, plan, run, evidence) {
  const lifecycle = assertLegacyExecuteRetryBatch(row, plan, run, null, evidence);
  if (lifecycle.receiptState !== "empty"
    || row.destructive_go_at != null
    || row.destructive_go_batch_id != null) {
    fail(`legacy batch ${plan.batchNumber} recovery requires no destructive GO or cleanup receipt`);
  }
  return lifecycle;
}

async function revalidateLegacyRecoveryReconstruction({
  sql,
  lockPid,
  contract,
  run,
  plan,
  pruneStore,
  previousRow,
  evidence,
}) {
  await assertOrchestratorLock(sql, lockPid);
  const refreshedRun = await loadAuthorization(sql, contract);
  if (text(refreshedRun.run_id) !== text(run.run_id)
    || text(refreshedRun.plan_sha256) !== text(run.plan_sha256)) {
    fail(`legacy batch ${plan.batchNumber} recovery run binding changed`);
  }
  const refreshedRow = await pruneStore.getManifest(previousRow.object_path);
  assertLegacyExecuteRetryBatch(refreshedRow, plan, refreshedRun, previousRow, evidence);
  assertLegacyRecoveryLifecycle(refreshedRow, plan, refreshedRun, evidence);
  await assertOrchestratorLock(sql, lockPid);
  return { row: refreshedRow, run: refreshedRun };
}

function buildPlanForBatch(masterManifest, contract, batchNumber) {
  const batchManifest = buildLegacyBatchManifest(masterManifest, { batchNumber });
  return buildLegacyPlan(masterManifest, batchManifest, {
    runId: contract.runId,
    runPlanSha256: contract.planSha256,
  });
}

function pruneDependencies({ deps, sql, pruneStore, storageTarget, plan, run }) {
  return {
    ...deps,
    sql,
    pruneStore,
    storageTarget,
    targetOptions: { singleTarget: true },
    legacyStageAllowlistPlan: plan,
    legacyStageAllowlistOrchestration: {
      runId: run.run_id,
      planSha256: run.plan_sha256,
    },
    emit: false,
  };
}

async function executeLegacyBatch({
  row,
  plan,
  contract,
  run,
  env,
  cwd,
  tempRoot,
  sql,
  pruneStore,
  storageTarget,
  lockPid,
  deps,
  preparedRecovery = null,
}) {
  const storageDeps = pruneDependencies({ deps, sql, pruneStore, storageTarget, plan, run });
  let currentRow;
  try {
    currentRow = await pruneStore.getManifest(row.object_path);
  } catch (error) {
    throw annotateLegacyPhaseError(error, {
      phase: LEGACY_STAGE_PHASES.PREPARE_MANIFEST,
      row,
      batchNumber: plan.batchNumber,
      batchId: row.batch_id,
      attempts: 1,
    });
  }
  if (!currentRow) {
    phaseFailure(`legacy batch ${plan.batchNumber} manifest disappeared`, {
      phase: LEGACY_STAGE_PHASES.PREPARE_MANIFEST,
      row,
      batchNumber: plan.batchNumber,
      batchId: row.batch_id,
      attempts: 1,
    });
  }
  if (currentRow.source_policy_id !== LEGACY_STAGE_ALLOWLIST_POLICY_ID
    || text(currentRow.legacy_run_id) !== text(run.run_id)
    || text(currentRow.legacy_plan_sha256) !== text(run.plan_sha256)
    || text(currentRow.legacy_batch_number) !== String(plan.batchNumber)) {
    phaseFailure(`legacy batch ${plan.batchNumber} is not bound to the authorized frozen run`, {
      phase: LEGACY_STAGE_PHASES.PREPARE_MANIFEST,
      row: currentRow,
      batchNumber: plan.batchNumber,
      batchId: currentRow.batch_id,
      attempts: 1,
    });
  }

  const prune = deps.pruneArchive || pruneArchive;
  if (!currentRow.archive_proof_verified_at) {
    try {
      await prune({
        argv: ["--target", "stage", "--object-path", currentRow.object_path, "--confirm-sha", currentRow.compressed_sha256, "--register-proof"],
        env,
        cwd,
        deps: {
          ...storageDeps,
          verifyBucket: deps.verifyBucket,
        },
      });
    } catch (error) {
      throw annotateLegacyPhaseError(error, {
        phase: LEGACY_STAGE_PHASES.PROOF_REGISTRATION,
        row: currentRow,
        batchNumber: plan.batchNumber,
        batchId: currentRow.batch_id,
        attempts: 1,
      });
    }
    try {
      currentRow = await pruneStore.getManifest(currentRow.object_path);
    } catch (error) {
      throw annotateLegacyPhaseError(error, {
        phase: LEGACY_STAGE_PHASES.PROOF_REGISTRATION,
        row: currentRow,
        batchNumber: plan.batchNumber,
        batchId: currentRow.batch_id,
        attempts: 1,
      });
    }
    if (!currentRow) {
      phaseFailure(`legacy batch ${plan.batchNumber} manifest disappeared after proof registration`, {
        phase: LEGACY_STAGE_PHASES.PROOF_REGISTRATION,
        row,
        batchNumber: plan.batchNumber,
        batchId: row.batch_id,
        attempts: 1,
      });
    }
  }

  let dryRun;
  try {
    dryRun = await prune({
      argv: ["--target", "stage", "--object-path", currentRow.object_path, "--confirm-sha", currentRow.compressed_sha256],
      env,
      cwd,
      deps: {
        ...storageDeps,
        verifyBucket: deps.verifyBucket,
      },
    });
  } catch (error) {
    throw annotateLegacyPhaseError(error, {
      phase: LEGACY_STAGE_PHASES.DRY_RUN,
      row: currentRow,
      batchNumber: plan.batchNumber,
      batchId: currentRow.batch_id,
      attempts: 1,
    });
  }
  if (dryRun.state === "already_pruned") {
    if (!isCompleteLegacyBatch(currentRow)) {
      phaseFailure(`legacy batch ${plan.batchNumber} has a partial cleanup receipt`, {
        phase: LEGACY_STAGE_PHASES.DRY_RUN,
        row: currentRow,
        batchNumber: plan.batchNumber,
        batchId: currentRow.batch_id,
        attempts: 1,
      });
    }
    return {
      state: "skipped",
      phase: LEGACY_STAGE_PHASES.DRY_RUN,
      attempts: 1,
      batch_number: plan.batchNumber,
      batch_id: currentRow.batch_id,
      batchNumber: plan.batchNumber,
      batchId: currentRow.batch_id,
    };
  }
  if (dryRun.state !== "ready") {
    phaseFailure(`legacy batch ${plan.batchNumber} dry-run returned ${dryRun.state}`, {
      phase: LEGACY_STAGE_PHASES.DRY_RUN,
      row: currentRow,
      batchNumber: plan.batchNumber,
      batchId: currentRow.batch_id,
      attempts: 1,
    });
  }

  const persistRecovery = deps.persistDurableRecovery || persistDurableRecovery;
  let verifiedDurable = preparedRecovery;
  let recoveryAttempts = preparedRecovery?.recoveryAttempts || 0;
  let recoveryState = preparedRecovery ? DURABLE_RECOVERY_STATES.COMPLETE : null;
  let storageState = preparedRecovery ? DURABLE_RECOVERY_STATES.COMPLETE : null;
  let storage = preparedRecovery?.storage || null;
  try {
    assertLegacyRecoveryLifecycle(currentRow, plan, run, dryRun.evidence);
    await assertOrchestratorLock(sql, lockPid);
    if (verifiedDurable) {
      recoveryAttempts = Math.max(1, recoveryAttempts);
      assertResumeRecoveryState(currentRow, verifiedDurable);
      assertDurableRecoveryForEvidence({
        row: currentRow,
        identity: STAGE_SYSTEM_IDENTIFIER,
        evidence: dryRun.evidence,
        durable: verifiedDurable,
      });
    } else {
      const inspected = await inspectLegacyRecovery({ storageTarget, row: currentRow, deps });
      recoveryAttempts = inspected.attempts || 1;
      storage = inspected.storage || null;
      recoveryState = inspected.state;
      storageState = inspected.state;
      if (inspected.state === DURABLE_RECOVERY_STATES.COMPLETE) {
        verifiedDurable = inspected.durable;
        assertResumeRecoveryState(currentRow, verifiedDurable);
        assertDurableRecoveryForEvidence({
          row: currentRow,
          identity: STAGE_SYSTEM_IDENTIFIER,
          evidence: dryRun.evidence,
          durable: verifiedDurable,
        });
      } else if (inspected.state === DURABLE_RECOVERY_STATES.BOTH_MISSING) {
        const revalidated = await revalidateLegacyRecoveryReconstruction({
          sql,
          lockPid,
          contract,
          run,
          plan,
          pruneStore,
          previousRow: currentRow,
          evidence: dryRun.evidence,
        });
        currentRow = revalidated.row;
        await assertOrchestratorLock(sql, lockPid);
        const reconstructionDryRun = await prune({
          argv: ["--target", "stage", "--object-path", currentRow.object_path, "--confirm-sha", currentRow.compressed_sha256],
          env,
          cwd,
          deps: {
            ...storageDeps,
            verifyBucket: deps.verifyBucket,
          },
        });
        if (reconstructionDryRun.state !== "ready") {
          fail(`legacy batch ${plan.batchNumber} recovery revalidation returned ${reconstructionDryRun.state}`);
        }
        const postDryRunRow = await pruneStore.getManifest(currentRow.object_path);
        assertLegacyExecuteRetryBatch(
          postDryRunRow,
          plan,
          revalidated.run,
          currentRow,
          reconstructionDryRun.evidence,
        );
        assertLegacyRecoveryLifecycle(postDryRunRow, plan, revalidated.run, reconstructionDryRun.evidence);
        currentRow = postDryRunRow;
        await assertOrchestratorLock(sql, lockPid);
        const main = await (deps.downloadPrivateArchive || downloadPrivateArchiveObject)(storageTarget, currentRow.object_path, deps);
        verifiedDurable = await persistRecovery(
          storageTarget,
          currentRow,
          STAGE_SYSTEM_IDENTIFIER,
          reconstructionDryRun.evidence,
          main.bytes,
          deps,
        );
        assertDurableRecoveryForEvidence({
          row: currentRow,
          identity: STAGE_SYSTEM_IDENTIFIER,
          evidence: reconstructionDryRun.evidence,
          durable: verifiedDurable,
        });
        recoveryState = "reconstructed";
        storageState = DURABLE_RECOVERY_STATES.COMPLETE;
        storage = verifiedDurable.storage || null;
        recoveryAttempts += verifiedDurable.recoveryAttempts || 1;
      } else {
        throw inspected.error || new Error(`legacy batch ${plan.batchNumber} recovery state is ${inspected.state}`);
      }
    }
    await assertOrchestratorLock(sql, lockPid);
  } catch (error) {
    const observedRecoveryAttempts = error?.recoveryAttempts
      ?? error?.storageAttempts
      ?? recoveryAttempts
      ?? 1;
    throw annotateLegacyPhaseError(error, {
      phase: LEGACY_STAGE_PHASES.RECOVERY,
      row: currentRow,
      batchNumber: plan.batchNumber,
      batchId: currentRow.batch_id,
      attempts: error?.attempts ?? observedRecoveryAttempts,
      recoveryAttempts: observedRecoveryAttempts,
      recoveryState: error?.recoveryState || recoveryState || DURABLE_RECOVERY_STATES.BLOCKED,
      storage: error?.storage || storage,
    });
  }

  const recoveryDir = path.join(tempRoot, `recovery-batch-${String(plan.batchNumber).padStart(3, "0")}`);
  ensurePrivateDirectory(recoveryDir);
  const executeArgs = [
    "--target", "stage",
    "--object-path", currentRow.object_path,
    "--confirm-sha", currentRow.compressed_sha256,
    "--execute",
    "--recovery-dir", recoveryDir,
  ];
  let executeResult;
  try {
    executeResult = await prune({
      argv: executeArgs,
      env,
      cwd,
      deps: {
        ...storageDeps,
        verifyBucket: deps.verifyBucket,
        beforeExecuteRetry: ({ row: retryRow, evidence: retryEvidence }) => revalidateLegacyOrchestrationBeforeRetry({
          sql,
          lockPid,
          contract,
          run,
          plan,
          pruneStore,
          previousRow: retryRow,
          evidence: retryEvidence,
        }),
        downloadArchive: async () => ({ bytes: verifiedDurable.archiveBytes, downloadMs: 0 }),
      },
    });
  } catch (error) {
    throw annotateLegacyPhaseError(error, {
      phase: LEGACY_STAGE_PHASES.EXECUTE,
      row: currentRow,
      batchNumber: plan.batchNumber,
      batchId: currentRow.batch_id,
      attempts: error?.executeAttempts ?? 0,
      sqlstates: error?.executeSqlstates || null,
    });
  }
  if (executeResult.state !== "pruned" && executeResult.state !== "already_pruned") {
    phaseFailure(`legacy batch ${plan.batchNumber} execute returned ${executeResult.state}`, {
      phase: LEGACY_STAGE_PHASES.EXECUTE,
      row: currentRow,
      batchNumber: plan.batchNumber,
      batchId: currentRow.batch_id,
      attempts: executeResult.executeAttempts ?? 1,
      sqlstates: executeResult.executeSqlstates || null,
    });
  }
  return {
    state: executeResult.state,
    phase: LEGACY_STAGE_PHASES.EXECUTE,
    attempts: executeResult.executeAttempts ?? 1,
    sqlstate: executeResult.sqlstate || executeResult.executeSqlstates?.at(-1) || null,
    sqlstates: executeResult.executeSqlstates || [],
    executeAttempts: executeResult.executeAttempts ?? 1,
    executeRetryCount: executeResult.executeRetryCount ?? 0,
    executeSqlstates: executeResult.executeSqlstates || [],
    recoveryAttempts,
    recoveryState,
    storageState,
    storage,
    batch_number: plan.batchNumber,
    batch_id: currentRow.batch_id,
    batchNumber: plan.batchNumber,
    batchId: currentRow.batch_id,
    transactions: executeResult.evidence?.transactionCount ?? null,
    entries: executeResult.evidence?.entryCount ?? null,
    receipt: executeResult.pruneResult || null,
  };
}

export async function runLegacyStageAllowlistOrchestrator({
  env = process.env,
  cwd = process.cwd(),
  now = new Date(),
  deps = {},
} = {}) {
  if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    && process.argv.slice(2).length !== 0) {
    fail("legacy Stage allowlist orchestrator accepts no arguments");
  }
  const config = validateStageEnvironment(env, { requireCommitSha: true });
  const sqlPool = deps.sql || postgres(config.dbUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 0,
    max_lifetime: 0,
  });
  const ownsSql = !deps.sql;
  const tempRoot = deps.tempRoot || fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-stage-legacy-orchestrator-"));
  ensurePrivateDirectory(tempRoot);
  const storageTarget = deps.storageTarget || resolveStorageTarget("stage", config.moduleEnv, { singleTarget: true });
  const verifyBucket = deps.verifyBucket || ((target) => verifyArchiveBucket(target, deps));
  let sql = null;
  let reservedSession = null;
  let lockPid = null;
  let activeBatch = null;
  try {
    reservedSession = await reserveOrchestratorSession(sqlPool);
    sql = reservedSession;
    const pruneStore = deps.pruneStore || (await import("./chips-ledger-archive-prune.mjs")).createPruneStore(sql);
    const preflight = await (deps.preflight || readOnlyStagePreflight)(sql);
    lockPid = await acquireOrchestratorLock(sql);
    if (!lockPid) return { state: "no-op", reason: "advisory_lock_busy", deployedCommitSha: config.deployedCommitSha, preflight };
    await assertOrchestratorLock(sql, lockPid);
    await verifyBucket(storageTarget);

    const generated = (deps.readFrozenAllowlist || loadFrozenLegacyAllowlist)({ cwd });
    const contract = buildLegacyStageAllowlistRunContract(generated.masterManifest);
    const run = await loadAuthorization(sql, contract);
    contract.runId = run.run_id;
    const batch13Rows = await readOnlyQuery(sql, `
      select object_path, batch_id::text as batch_id, status, source_policy_id,
             legacy_allowlist_sha256, legacy_batch_number::text as legacy_batch_number,
             legacy_batch_table_count::text as legacy_batch_table_count,
             archive_proof_verified_at::text as archive_proof_verified_at,
             pruned_at::text as pruned_at, registry_cleaned_at::text as registry_cleaned_at,
             pruned_transaction_count::text as pruned_transaction_count,
             pruned_entry_count::text as pruned_entry_count,
             registry_cleaned_key_count::text as registry_cleaned_key_count,
             pruned_transaction_ids_sha256, pruned_entry_ids_sha256,
             registry_cleaned_keys_sha256
        from public.chips_ledger_archive_batches
       where batch_id = 13
         and object_path = $1;
    `, [LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.objectPath]);
    assertBatch13AlreadyComplete(batch13Rows[0]);

    const maxBatches = Number.isSafeInteger(deps.maxBatchesPerRun)
      ? Math.min(Math.max(1, deps.maxBatchesPerRun), LEGACY_STAGE_ALLOWLIST_ORCHESTRATOR_MAX_BATCHES_PER_RUN)
      : LEGACY_STAGE_ALLOWLIST_ORCHESTRATOR_MAX_BATCHES_PER_RUN;
    const processed = [];
    let consumedBatchCount = 0;
    let rows = await loadLegacyBatchRows(sql, run);
    assertLegacyBatchRows(rows);
    const planMaster = generated.masterManifest;
    for (let batchNumber = LEGACY_STAGE_ALLOWLIST_REMAINING_FIRST_BATCH;
      batchNumber <= LEGACY_STAGE_ALLOWLIST_REMAINING_LAST_BATCH && consumedBatchCount < maxBatches;
      batchNumber += 1) {
      activeBatch = { batchNumber };
      await assertOrchestratorLock(sql, lockPid);
      const plan = buildPlanForBatch(planMaster, contract, batchNumber);
      const existing = rows.find((row) => text(row.legacy_batch_number) === String(batchNumber));
      activeBatch = { batchNumber, batchId: existing?.batch_id ?? null, row: existing };
      if (existing && isCompleteLegacyBatch(existing)) {
        const result = await executeLegacyBatch({
          row: existing,
          plan,
          contract,
          run,
          env: config.moduleEnv,
          cwd,
          tempRoot,
          sql,
          pruneStore,
          storageTarget,
          lockPid,
          deps: { ...deps, verifyBucket },
        });
        processed.push(result);
        rows = await loadLegacyBatchRows(sql, run);
        assertLegacyBatchRows(rows);
        continue;
      }

      // A completed batch is only a verification/skip operation. It must not
      // consume the bounded work budget, otherwise every resumed run can get
      // trapped re-scanning the first maxBatchesPerRun completed batches.
      consumedBatchCount += 1;
      let row = existing;
      let preparedRecovery = null;
      if (!row) {
        const batchTempRoot = fs.mkdtempSync(path.join(
          tempRoot,
          `legacy-stage-batch-${String(batchNumber).padStart(3, "0")}-`,
        ));
        ensurePrivateDirectory(batchTempRoot);
        let prepared;
        try {
          prepared = await runLegacyStagePrepareOnly({
            env,
            cwd,
            batchNumber,
            orchestration: { runId: run.run_id, planSha256: run.plan_sha256 },
            returnDurableRecovery: true,
            deps: {
              ...deps,
              sql,
              tempRoot: batchTempRoot,
              storageTarget,
              pruneStore,
              verifyBucket,
              lockAlreadyHeld: lockPid,
            },
          });
        } catch (error) {
          throw annotateLegacyPhaseError(error, {
            phase: error?.phase || (error?.recoveryState
              ? LEGACY_STAGE_PHASES.RECOVERY
              : LEGACY_STAGE_PHASES.PREPARE_MANIFEST),
            row,
            batchNumber,
            attempts: 1,
            recoveryAttempts: error?.recoveryAttempts || null,
            recoveryState: error?.recoveryState || null,
            storage: error?.storage || null,
          });
        }
        if (prepared.state !== "prepared") {
          phaseFailure(`legacy batch ${batchNumber} did not produce a prepared manifest: ${prepared.state}`, {
            phase: LEGACY_STAGE_PHASES.PREPARE_MANIFEST,
            batchNumber,
            attempts: 1,
          });
        }
        try {
          row = await pruneStore.getManifest(prepared.objectPath);
        } catch (error) {
          throw annotateLegacyPhaseError(error, {
            phase: LEGACY_STAGE_PHASES.PREPARE_MANIFEST,
            batchNumber,
            attempts: 1,
          });
        }
        preparedRecovery = prepared.durableRecovery || null;
      }
      if (!row) {
        phaseFailure(`legacy batch ${batchNumber} manifest is missing after preparation`, {
          phase: LEGACY_STAGE_PHASES.PREPARE_MANIFEST,
          batchNumber,
          attempts: 1,
        });
      }
      activeBatch = { batchNumber, batchId: row.batch_id, row };
      const result = await executeLegacyBatch({
        row,
        plan,
        contract,
        run,
        env: config.moduleEnv,
        cwd,
        tempRoot,
        sql,
        pruneStore,
        storageTarget,
        lockPid,
        deps: { ...deps, verifyBucket },
        preparedRecovery,
      });
      processed.push(result);
      rows = await loadLegacyBatchRows(sql, run);
      assertLegacyBatchRows(rows);
    }
    const completedBatchNumbers = new Set(
      rows
        .filter((row) => isCompleteLegacyBatch(row))
        .map((row) => Number(row.legacy_batch_number))
        .filter((batchNumber) => batchNumber >= LEGACY_STAGE_ALLOWLIST_REMAINING_FIRST_BATCH
          && batchNumber <= LEGACY_STAGE_ALLOWLIST_REMAINING_LAST_BATCH),
    );
    const remaining = Math.max(0, contract.batchCount - completedBatchNumbers.size);
    return {
      state: "completed",
      mode: "orchestrate",
      sourcePolicyId: LEGACY_STAGE_ALLOWLIST_POLICY_ID,
      deployedCommitSha: config.deployedCommitSha,
      preflight,
      run: {
        runId: run.run_id,
        planSha256: run.plan_sha256,
        masterAllowlistSha256: contract.masterAllowlistSha256,
        remainingTableIdsSha256: contract.remainingTableIdsSha256,
        cutoff: contract.cutoff,
        firstBatchNumber: contract.firstBatchNumber,
        lastBatchNumber: contract.lastBatchNumber,
      },
      batch13: "skipped-already-pruned-and-cleaned",
      processed,
      boundedBatchLimit: maxBatches,
      consumedBatchCount,
      remainingBatchCount: remaining,
    };
  } catch (error) {
    const failurePhase = error?.phase || LEGACY_STAGE_PHASES.PREPARE_MANIFEST;
    const failureAttempts = failurePhase === LEGACY_STAGE_PHASES.RECOVERY
      ? error?.recoveryAttempts ?? error?.storageAttempts ?? error?.attempts ?? 1
      : error?.executeAttempts ?? error?.attempts ?? 1;
    throw annotateLegacyPhaseError(error, {
      phase: failurePhase,
      row: activeBatch?.row || null,
      batchNumber: activeBatch?.batchNumber ?? null,
      batchId: activeBatch?.batchId ?? null,
      attempts: failureAttempts,
      sqlstates: error?.executeSqlstates || null,
    });
  } finally {
    if (lockPid && sql) {
      try { await releaseOrchestratorLock(sql); } catch { /* closing the owned client releases the session lock */ }
    }
    if (reservedSession) {
      try { await reservedSession.release(); } catch { /* ending the owned pool closes the session */ }
    }
    if (ownsSql) await sqlPool.end({ timeout: 5 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLegacyStageAllowlistOrchestrator().then((result) => {
    process.stdout.write(`${stringifyJson({ event: "chips_ledger_legacy_stage_allowlist_orchestrator", ...result })}\n`);
  }).catch((error) => {
    process.stderr.write(`${stringifyJson({
      event: "chips_ledger_legacy_stage_allowlist_orchestrator",
      state: "error",
      ...legacyErrorReport(error),
    })}\n`);
    process.exitCode = 1;
  });
}
