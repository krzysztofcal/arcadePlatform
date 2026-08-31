import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import postgres from "postgres";
import {
  BOT_ONLY_EXPORT_SCHEMA_VERSION,
  BOT_ONLY_RETENTION_DAYS,
  BOT_ONLY_RETENTION_POLICY_ID,
  runExport,
  STAGE_AUTOMATION_POLICY_ID,
  stringifyJson,
} from "./chips-ledger-archive-export.mjs";
import {
  buildRecoveryArchiveObjectPath,
  buildRecoveryManifestObjectPath,
  downloadPrivateArchiveObject,
  downloadPrivateObjectIfExists,
  ensureArchiveBucket,
  replaceVerifiedPrivateObject,
  resolveStorageTarget,
  storeArchive,
  uploadOrVerifyPrivateObject,
  verifyArchiveBucket,
} from "./chips-ledger-archive-store.mjs";
import {
  buildRecoveryManifest,
  createPruneStore,
  pruneArchive,
  sqlStateOf,
} from "./chips-ledger-archive-prune.mjs";
import {
  assertPrivateRegularFile,
  ensurePrivateDirectory,
  writeExclusiveFiles,
} from "./_shared/chips-ledger-archive-files.mjs";

export const STAGE_PROJECT_REF = "krydukthwdvccggbyjfw";
export const STAGE_SYSTEM_IDENTIFIER = "7656985631720456337";
export const STAGE_MAX_BATCH_SIZE = 5000;
export const STAGE_RETENTION_DAYS = 30;
// Schema-v2 keeps one complete table per archive batch so the lifecycle
// receipt can prove and mark that table atomically.  The scheduler therefore
// needs a bounded multi-batch run: 6 batches every 15 minutes gives a
// theoretical 576-table/day ceiling while keeping a single job within its
// timeout margin.
export const BOT_ONLY_AUTOMATIC_MAX_BATCHES_PER_RUN = 6;
export const BOT_ONLY_AUTOMATIC_MAX_DRY_RUN_ATTEMPTS = 3;
export const STAGE_AUTOMATION_LOCK_KEY = `chips-ledger-stage-automation-v1:${STAGE_PROJECT_REF}`;
export const BOT_ONLY_BATCH_15_RECOVERY_REPAIR = Object.freeze({
  batchId: "15",
  objectPath: "v1/sha256/6f441846a444110656db57993e49c82af778876841e0c93098b3bb79904f6919.jsonl.gz",
  archiveSha256: "6f441846a444110656db57993e49c82af778876841e0c93098b3bb79904f6919",
  recoveryArchivePath: "recovery/v1/sha256/6f441846a444110656db57993e49c82af778876841e0c93098b3bb79904f6919.jsonl.gz",
  recoveryManifestPath: "recovery/v1/sha256/6f441846a444110656db57993e49c82af778876841e0c93098b3bb79904f6919.recovery.json.gz",
  currentRecoveryManifestSha256: "028810c3e0706ddb57ab9a850d308eb9f8236ee648114bd8293b378881cc0df5",
  correctedRecoveryManifestSha256: "3e9939bf31359f8e3d48cdd43270441c2bb90e9f7cf4a57ef8e313cadac5495c",
});

const SHA256_RE = /^[0-9a-f]{64}$/;
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/i;
const PRIVATE_FILE_MODE = 0o600;
const AUTOMATIC_DRY_RUN_RETRYABLE_SQLSTATES = new Set(["40001", "55P03"]);

function fail(message) {
  throw new Error(message);
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

export function resolveDeployedCommitSha(env = process.env, { required = true } = {}) {
  const rawCommitSha = text(env.DEPLOYED_COMMIT_SHA || env.GITHUB_SHA);
  if (!rawCommitSha && !required) return null;
  const commitSha = rawCommitSha.toLowerCase();
  if (!COMMIT_SHA_RE.test(commitSha)) fail("a 40-character deployed commit SHA is required");
  return commitSha;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function redactedError(error) {
  const message = text(error?.message || error);
  return (message || "Stage automation failed")
    .replace(/postgres(?:ql)?:\/\/[^\s"'`<>]+/gi, "[redacted-db-url]")
    .replace(/\bBearer\s+[^\s,;)}\]"']+/gi, "Bearer [redacted]")
    .replace(/\bsb_secret_[a-zA-Z0-9_-]+/gi, "[redacted-supabase-secret]")
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, "[redacted-token]")
    .replace(/\b(?:password|passwd|secret|token|api[_-]?key|service[-_ ]?role[-_ ]?key)\s*[:=]\s*[^\s,;)}\]"']+/gi, "[redacted-secret]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[redacted-record-id]")
    .replace(/\b(?:entry|transaction|account|table)[-_ ]?\d+\b/gi, "[redacted-record]");
}

function aggregateBatchPayload(batch, { automatic = false } = {}) {
  const payload = {
    batch_id: batch.batchId ?? null,
    state: batch.state ?? null,
    retry: batch.retry ?? null,
    object_path: batch.objectPath || null,
    transactions: batch.transactions ?? null,
    entries: batch.entries ?? null,
    compressed_sha256: batch.compressedSha256 || null,
    recovery_archive_sha256: batch.recoveryArchiveSha256 || null,
    recovery_manifest_sha256: batch.recoveryManifestSha256 || null,
    proof: batch.proof || null,
    dry_run: batch.dryRun || null,
    archive_storage_modified: batch.archiveStorageModified ?? null,
    recovery_storage_modified: batch.recoveryStorageModified ?? null,
    storage_modified: batch.storageModified ?? null,
    prune_receipt: batch.pruneReceipt || null,
    cleanup_receipt: batch.cleanupReceipt || null,
    destructive_go_batch_id: batch.destructiveGoBatchId ?? null,
  };
  if (Object.hasOwn(batch, "recoveryArchivePath")) {
    payload.recovery_archive_path = batch.recoveryArchivePath || null;
  }
  if (Object.hasOwn(batch, "recoveryManifestPath")) {
    payload.recovery_manifest_path = batch.recoveryManifestPath || null;
  }
  if (automatic || Object.hasOwn(batch, "executeState")) {
    payload.execute_state = batch.executeState || null;
  }
  if (automatic || Object.hasOwn(batch, "executeConfirmed")) {
    payload.execute_confirmed = batch.executeConfirmed === true;
  }
  if (automatic || Object.hasOwn(batch, "dbMutationConfirmed")) {
    payload.db_mutation_confirmed = batch.dbMutationConfirmed === true;
  }
  if (automatic || Object.hasOwn(batch, "retryState")) {
    payload.retry_state = batch.retryState || null;
  }
  if (automatic || Object.hasOwn(batch, "dryRunAttempts")) {
    payload.dry_run_attempts = batch.dryRunAttempts ?? null;
  }
  if (automatic || Object.hasOwn(batch, "dryRunRetryCount")) {
    payload.dry_run_retry_count = batch.dryRunRetryCount ?? null;
  }
  if (automatic || Object.hasOwn(batch, "dryRunSqlstates")) {
    payload.dry_run_sqlstates = Array.isArray(batch.dryRunSqlstates)
      ? [...batch.dryRunSqlstates]
      : null;
  }
  if (automatic || Object.hasOwn(batch, "executeAttempts")) {
    payload.execute_attempts = batch.executeAttempts ?? 0;
  }
  if (automatic || Object.hasOwn(batch, "executeRetryCount")) {
    payload.execute_retry_count = batch.executeRetryCount ?? 0;
  }
  if (automatic || Object.hasOwn(batch, "executeSqlstates")) {
    payload.execute_sqlstates = Array.isArray(batch.executeSqlstates)
      ? [...batch.executeSqlstates]
      : [];
  }
  return payload;
}

function aggregateAutomaticBatchPayload(batch) {
  return {
    batch_id: batch.batchId ?? null,
    state: batch.state ?? null,
    object_path: batch.objectPath || null,
    transactions: batch.transactions ?? null,
    entries: batch.entries ?? null,
    compressed_sha256: batch.compressedSha256 || null,
    recovery_archive_sha256: batch.recoveryArchiveSha256 || null,
    recovery_manifest_sha256: batch.recoveryManifestSha256 || null,
    recovery_archive_path: batch.recoveryArchivePath || null,
    recovery_manifest_path: batch.recoveryManifestPath || null,
    proof: batch.proof || null,
    dry_run: batch.dryRun || null,
    dry_run_attempts: batch.dryRunAttempts ?? null,
    dry_run_retry_count: batch.dryRunRetryCount ?? null,
    dry_run_sqlstates: Array.isArray(batch.dryRunSqlstates)
      ? [...batch.dryRunSqlstates]
      : [],
    archive_storage_modified: batch.archiveStorageModified ?? null,
    recovery_storage_modified: batch.recoveryStorageModified ?? null,
    storage_modified: batch.storageModified ?? null,
    prune_receipt: batch.pruneReceipt || null,
    cleanup_receipt: batch.cleanupReceipt || null,
    destructive_go_batch_id: batch.destructiveGoBatchId ?? null,
    execute_state: batch.executeState || null,
    execute_confirmed: batch.executeConfirmed === true,
    db_mutation_confirmed: batch.dbMutationConfirmed === true,
    retry_state: batch.retryState || batch.retry || null,
    execute_attempts: batch.executeAttempts ?? 0,
    execute_retry_count: batch.executeRetryCount ?? 0,
    execute_sqlstates: Array.isArray(batch.executeSqlstates)
      ? [...batch.executeSqlstates]
      : [],
  };
}

function aggregateAutomaticSuccessPayload(result) {
  const processed = Array.isArray(result.processed) ? result.processed : [];
  const policy = result.policy
    ? {
      enabled: result.policy.enabled === true || result.policy.enabled === "t",
      canary_batch_id: result.policy.canaryBatchId ?? result.policy.canary_batch_id ?? null,
      activated_at: result.policy.activatedAt ?? result.policy.activated_at ?? null,
    }
    : null;
  return {
    event: "chips_ledger_stage_automation",
    target: "stage",
    project_ref: STAGE_PROJECT_REF,
    source_policy_id: result.sourcePolicyId || BOT_ONLY_RETENTION_POLICY_ID,
    state: result.state,
    mode: "automatic",
    deployed_commit_sha: result.deployedCommitSha || null,
    stage_system_identifier: result.stageSystemIdentifier || null,
    policy,
    bounded_batch_limit: result.boundedBatchLimit ?? BOT_ONLY_AUTOMATIC_MAX_BATCHES_PER_RUN,
    processed_batch_count: processed.length,
    processed_batches: processed.map(aggregateAutomaticBatchPayload),
    stop_reason: result.stopReason || result.reason || null,
  };
}

export function aggregatePayload(result) {
  const base = {
    event: "chips_ledger_stage_automation",
    target: "stage",
    project_ref: STAGE_PROJECT_REF,
    source_policy_id: result.sourcePolicyId || STAGE_AUTOMATION_POLICY_ID,
    state: result.state,
    deployed_commit_sha: result.deployedCommitSha || null,
  };
  if (result.state === "error") {
    const sqlstate = result.sqlstate || sqlStateOf(result.reason);
    const automatic = result.mode === "automatic";
    const reason = redactedError(result.reason);
    return {
      ...base,
      ...(result.mode ? { mode: result.mode } : {}),
      ...(result.batchId != null ? { batch_id: result.batchId } : {}),
      ...(result.objectPath ? { object_path: result.objectPath } : {}),
      ...(automatic
        ? { phase: result.phase || null, sqlstate: sqlstate || null }
        : {}),
      ...(automatic
        ? {
          processed_batches: Array.isArray(result.processed)
            ? result.processed.map((batch) => aggregateBatchPayload(batch, { automatic: true }))
            : [],
          current_batch: result.currentBatch
            ? aggregateBatchPayload(result.currentBatch, { automatic: true })
            : null,
          stop_reason: result.stopReason || reason || null,
        }
        : {
          ...(result.phase ? { phase: result.phase } : {}),
          ...(sqlstate ? { sqlstate } : {}),
          ...(Array.isArray(result.processed) ? {
            processed_batches: result.processed.map(aggregateBatchPayload),
          } : {}),
          ...(result.currentBatch ? { current_batch: aggregateBatchPayload(result.currentBatch) } : {}),
        }),
      reason,
    };
  }
  if (result.mode === "automatic") return aggregateAutomaticSuccessPayload(result);
  return {
    ...base,
    mode: result.mode || null,
    batch_id: result.batchId ?? null,
    format_version: result.formatVersion ?? null,
    object_path: result.objectPath || null,
    cutoff: result.cutoff || null,
    cursor_start: result.cursorStart || null,
    cursor_end: result.cursorEnd || null,
    stage_system_identifier: result.stageSystemIdentifier || null,
    table_id: result.tableId || null,
    table_count: result.tableCount ?? null,
    registry_key_count: result.registryKeyCount ?? null,
    registry_keys_sha256: result.registryKeysSha256 || null,
    out_of_scope_keys_sha256: result.outOfScopeKeysSha256 || null,
    identity_count: result.identityCount ?? null,
    eligible_count: result.eligibleCount ?? null,
    transactions: result.transactions ?? null,
    entries: result.entries ?? null,
    tx_types: result.txTypes || null,
    amounts: result.amounts || null,
    raw_bytes: result.rawBytes ?? null,
    compressed_bytes: result.compressedBytes ?? null,
    raw_sha256: result.rawSha256 || null,
    compressed_sha256: result.compressedSha256 || null,
    archive_proof_transaction_ids_sha256: result.archiveProofTransactionIdsSha256 || null,
    archive_proof_entry_ids_sha256: result.archiveProofEntryIdsSha256 || null,
    prune_receipt: result.pruneReceipt || null,
    cleanup_receipt: result.cleanupReceipt || null,
    recovery_archive_sha256: result.recoveryArchiveSha256 || null,
    recovery_manifest_sha256: result.recoveryManifestSha256 || null,
    recovery_archive_path: result.recoveryArchivePath || null,
    recovery_manifest_path: result.recoveryManifestPath || null,
    dry_run: result.dryRun || null,
    initial_recovery_objects_absent: result.initialRecoveryObjectsAbsent ?? null,
    recovery_verified: result.recoveryVerified ?? null,
    storage_modified: result.storageModified ?? null,
    proof: result.proof || null,
    receipt: result.receipt || null,
    mappings: result.mappings ?? null,
    blocking_anomalies: result.blockingAnomalies || null,
    destructive_go_batch_id: result.destructiveGoBatchId ?? null,
    destructive_go_at: result.destructiveGoAt || null,
    reason: result.reason || null,
  };
}

export function writeAggregateSummary(result) {
  const safe = stringifyJson(aggregatePayload(result));
  process.stdout.write(`${safe}\n`);
  const summaryPath = text(process.env.GITHUB_STEP_SUMMARY);
  if (summaryPath) {
    try {
      fs.appendFileSync(summaryPath, `\n\`\`\`json\n${safe}\n\`\`\`\n`, { mode: PRIVATE_FILE_MODE });
    } catch {
      // Job Summary is best-effort; stdout remains the authoritative report.
    }
  }
  return safe;
}

function emitAggregateError(error, context = {}) {
  try {
    writeAggregateSummary({
      state: "error",
      reason: error,
      phase: context.phase || error?.chipsLedgerQueryPhase || null,
      sqlstate: context.sqlstate || error?.chipsLedgerQuerySqlState || sqlStateOf(error),
      ...context,
    });
  } catch {
    // Preserve the original orchestration error if reporting itself fails.
  }
}

export function validateStageEnvironment(env = process.env, { requireCommitSha = false } = {}) {
  for (const key of Object.keys(env)) {
    if (/^SUPABASE_PROD_|^PRODUCTION_/.test(key)) fail("Production credentials are not accepted by the Stage orchestrator");
  }
  const dbUrl = text(env.SUPABASE_STAGE_DB_URL);
  const apiUrl = text(env.SUPABASE_STAGE_URL);
  const serviceKey = text(env.SUPABASE_STAGE_SERVICE_ROLE_KEY);
  if (!dbUrl || !apiUrl || !serviceKey) fail("Stage DB URL, Supabase URL and service key are required");
  const deployedCommitSha = resolveDeployedCommitSha(env, { required: requireCommitSha });
  let parsedDb;
  let parsedApi;
  try {
    parsedDb = new URL(dbUrl);
    parsedApi = new URL(apiUrl);
  } catch {
    fail("Stage connection configuration is invalid");
  }
  if (parsedDb.protocol !== "postgres:" && parsedDb.protocol !== "postgresql:") fail("Stage DB URL must be PostgreSQL");
  if (parsedApi.protocol !== "https:" || parsedApi.pathname !== "/" || parsedApi.search || parsedApi.hash) {
    fail("Stage Supabase URL must be an HTTPS origin");
  }
  if (parsedApi.hostname.toLowerCase() !== `${STAGE_PROJECT_REF}.supabase.co`) {
    fail("Stage Supabase URL does not match the canonical Stage project ref");
  }
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/i.exec(parsedDb.hostname);
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/i.test(parsedDb.hostname);
  const user = /^postgres\.([a-z0-9]{20})$/i.exec(decodeURIComponent(parsedDb.username || ""));
  const dbProjectRef = (direct?.[1] || (pooler ? user?.[1] : ""))?.toLowerCase();
  if (dbProjectRef !== STAGE_PROJECT_REF) fail("Stage DB URL does not match the canonical Stage project ref");
  return {
    dbUrl,
    apiUrl: parsedApi.origin,
    serviceKey,
    deployedCommitSha,
    moduleEnv: {
      EXPECTED_SUPABASE_STAGE_PROJECT_REF: STAGE_PROJECT_REF,
      SUPABASE_STAGE_DB_URL: dbUrl,
      SUPABASE_URL: parsedApi.origin,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      ...(deployedCommitSha ? { DEPLOYED_COMMIT_SHA: deployedCommitSha } : {}),
    },
  };
}

async function acquireAdvisoryLock(sql) {
  const rows = await sql.unsafe(
    "select pg_catalog.pg_backend_pid()::text as backend_pid, pg_catalog.pg_try_advisory_lock(pg_catalog.hashtextextended($1, 0)) as acquired;",
    [STAGE_AUTOMATION_LOCK_KEY],
  );
  if (!(rows[0]?.acquired === true || rows[0]?.acquired === "t")) return null;
  const backendPid = text(rows[0]?.backend_pid);
  if (!backendPid) fail("Stage advisory lock session identity is unavailable");
  return { backendPid };
}

async function assertAdvisoryLock(sql, lockSession) {
  const rows = await sql.unsafe("select pg_catalog.pg_backend_pid()::text as backend_pid;");
  if (text(rows[0]?.backend_pid) !== lockSession?.backendPid) {
    fail("Stage advisory lock session was lost; aborting the cycle");
  }
}

async function releaseAdvisoryLock(sql) {
  await sql.unsafe(
    "select pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended($1, 0));",
    [STAGE_AUTOMATION_LOCK_KEY],
  );
}

async function assertIdentity(sql) {
  const rows = await sql.unsafe("select system_identifier::text as system_identifier from pg_catalog.pg_control_system();");
  const identity = text(rows[0]?.system_identifier);
  if (identity !== STAGE_SYSTEM_IDENTIFIER) fail("database is not canonical Stage");
  return identity;
}

export const STAGE_OWN_BATCHES_SQL = `select
    object_path,
    project_ref,
    source_policy_id,
    status,
    batch_id::text as batch_id,
    format_version::text as format_version,
    cutoff::text as cutoff,
    cursor_start_created_at::text as cursor_start_created_at,
    cursor_start_id,
    transaction_count::text as transaction_count,
    entry_count::text as entry_count,
    raw_bytes::text as raw_bytes,
    compressed_bytes::text as compressed_bytes,
    raw_sha256,
    compressed_sha256,
    credits::text as credits,
    debits::text as debits,
    net_amount::text as net_amount,
    committed_at::text as committed_at,
    archive_proof_verified_at::text as archive_proof_verified_at,
    archived_transaction_ids_sha256,
    archived_entry_ids_sha256,
    pruned_at::text as pruned_at,
    pruned_transaction_count::text as pruned_transaction_count,
    pruned_entry_count::text as pruned_entry_count,
    pruned_transaction_ids_sha256,
    pruned_entry_ids_sha256,
    bot_only_table_id,
    bot_only_table_count::text as bot_only_table_count,
    bot_only_newest_created_at::text as bot_only_newest_created_at,
    bot_only_registry_keys_sha256,
    bot_only_out_of_scope_keys_sha256,
    bot_only_identity_count::text as bot_only_identity_count,
    bot_only_eligible_count::text as bot_only_eligible_count,
    registry_cleaned_at::text as registry_cleaned_at,
    registry_cleaned_key_count::text as registry_cleaned_key_count,
    registry_cleaned_keys_sha256,
    exists (
      select 1
        from public.poker_tables tables
       where tables.id = chips_ledger_archive_batches.bot_only_table_id
    ) as bot_only_table_exists,
    (select tables.bot_only_retention_complete_at::text
       from public.poker_tables tables
      where tables.id = chips_ledger_archive_batches.bot_only_table_id) as bot_only_retention_complete_at,
    destructive_go_at::text as destructive_go_at,
    destructive_go_batch_id::text as destructive_go_batch_id
  from public.chips_ledger_archive_batches
  where project_ref = $1
  and source_policy_id = $2
  order by created_at desc, object_path desc;`;

export const STAGE_EXACT_BATCH_SQL = `select
    object_path,
    project_ref,
    source_policy_id,
    status,
    batch_id::text as batch_id,
    format_version::text as format_version,
    cutoff::text as cutoff,
    cursor_start_created_at::text as cursor_start_created_at,
    cursor_start_id::text as cursor_start_id,
    cursor_end_created_at::text as cursor_end_created_at,
    cursor_end_id::text as cursor_end_id,
    first_created_at::text as first_created_at,
    last_created_at::text as last_created_at,
    transaction_count::text as transaction_count,
    entry_count::text as entry_count,
    tx_types::text as tx_types,
    raw_bytes::text as raw_bytes,
    compressed_bytes::text as compressed_bytes,
    raw_sha256,
    compressed_sha256,
    credits::text as credits,
    debits::text as debits,
    net_amount::text as net_amount,
    committed_at::text as committed_at,
    archive_proof_verified_at::text as archive_proof_verified_at,
    archived_transaction_ids_sha256,
    archived_entry_ids_sha256,
    pruned_at::text as pruned_at,
    pruned_transaction_count::text as pruned_transaction_count,
    pruned_entry_count::text as pruned_entry_count,
    pruned_transaction_ids_sha256,
    pruned_entry_ids_sha256,
    bot_only_table_id,
    bot_only_table_count::text as bot_only_table_count,
    bot_only_newest_created_at::text as bot_only_newest_created_at,
    bot_only_registry_keys_sha256,
    bot_only_out_of_scope_keys_sha256,
    bot_only_identity_count::text as bot_only_identity_count,
    bot_only_eligible_count::text as bot_only_eligible_count,
    registry_cleaned_at::text as registry_cleaned_at,
    registry_cleaned_key_count::text as registry_cleaned_key_count,
    registry_cleaned_keys_sha256,
    exists (
      select 1
        from public.poker_tables tables
       where tables.id = chips_ledger_archive_batches.bot_only_table_id
    ) as bot_only_table_exists,
    (select tables.bot_only_retention_complete_at::text
       from public.poker_tables tables
      where tables.id = chips_ledger_archive_batches.bot_only_table_id) as bot_only_retention_complete_at,
    destructive_go_at::text as destructive_go_at,
    destructive_go_batch_id::text as destructive_go_batch_id
  from public.chips_ledger_archive_batches
  where batch_id = $1;`;

async function loadOwnBatches(sql, sourcePolicyId = STAGE_AUTOMATION_POLICY_ID) {
  return sql.unsafe(STAGE_OWN_BATCHES_SQL, [STAGE_PROJECT_REF, sourcePolicyId]);
}

export function botOnlyExportArgs(row, artifactPath, manifestPath) {
  if (!row?.cutoff) fail("pending bot-only manifest has no immutable cutoff");
  const args = [
    "--target", "stage",
    "--cutoff", row.cutoff,
    "--batch-size", String(STAGE_MAX_BATCH_SIZE),
    "--output", artifactPath,
    "--manifest", manifestPath,
  ];
  if (row.cursor_start_created_at || row.cursor_start_id) {
    if (!row.cursor_start_created_at || !row.cursor_start_id) fail("pending bot-only manifest has a partial cursor");
    args.splice(6, 0, "--after-created-at", row.cursor_start_created_at, "--after-id", row.cursor_start_id);
  }
  return args;
}

export function botOnlyReport({ row, identity, dry, durable, state, mode, deployedCommitSha = null, blockingAnomalies = [] }) {
  const evidence = dry?.evidence || null;
  const recoveryArchiveSha256 = durable?.recoveryArchive?.sha256 || durable?.archiveSha256 || null;
  const recoveryManifestSha256 = durable?.recoveryManifest?.sha256 || durable?.manifestSha256 || null;
  return {
    state,
    mode,
    sourcePolicyId: BOT_ONLY_RETENTION_POLICY_ID,
    projectRef: row?.project_ref || STAGE_PROJECT_REF,
    deployedCommitSha,
    formatVersion: row?.format_version == null ? null : Number(row.format_version),
    stageSystemIdentifier: identity,
    batchId: row?.batch_id || null,
    objectPath: row?.object_path || null,
    cutoff: row?.cutoff || null,
    cursorStart: row?.cursor_start_created_at || row?.cursor_start_id
      ? { created_at: row.cursor_start_created_at || null, id: row.cursor_start_id || null }
      : null,
    cursorEnd: row?.cursor_end_created_at || row?.cursor_end_id
      ? { created_at: row.cursor_end_created_at || null, id: row.cursor_end_id || null }
      : null,
    tableId: row?.bot_only_table_id || evidence?.tableId || null,
    tableCount: row?.bot_only_table_count || (evidence?.tableId ? 1 : null),
    transactions: evidence?.transactionCount ?? (row?.transaction_count == null ? null : Number(row.transaction_count)),
    entries: evidence?.entryCount ?? (row?.entry_count == null ? null : Number(row.entry_count)),
    txTypes: evidence?.txTypes || null,
    amounts: evidence ? { credits: evidence.credits, debits: evidence.debits, net: evidence.net } : null,
    identityCount: row?.bot_only_identity_count || null,
    eligibleCount: row?.bot_only_eligible_count || null,
    registryKeyCount: evidence?.registryKeys?.length ?? row?.bot_only_identity_count ?? null,
    registryKeysSha256: row?.bot_only_registry_keys_sha256 || evidence?.registryKeysSha256 || null,
    outOfScopeKeysSha256: row?.bot_only_out_of_scope_keys_sha256 || evidence?.outOfScopeKeysSha256 || null,
    rawBytes: row?.raw_bytes == null ? null : Number(row.raw_bytes),
    rawSha256: row?.raw_sha256 || null,
    compressedBytes: row?.compressed_bytes == null ? null : Number(row.compressed_bytes),
    compressedSha256: row?.compressed_sha256 || null,
    archiveProofTransactionIdsSha256: row?.archived_transaction_ids_sha256 || null,
    archiveProofEntryIdsSha256: row?.archived_entry_ids_sha256 || null,
    pruneReceipt: row?.pruned_at ? {
      at: row.pruned_at,
      transaction_count: row.pruned_transaction_count,
      entry_count: row.pruned_entry_count,
      transaction_ids_sha256: row.pruned_transaction_ids_sha256,
      entry_ids_sha256: row.pruned_entry_ids_sha256,
    } : null,
    cleanupReceipt: row?.registry_cleaned_at ? {
      at: row.registry_cleaned_at,
      key_count: row.registry_cleaned_key_count,
      keys_sha256: row.registry_cleaned_keys_sha256,
    } : null,
    recoveryArchiveSha256,
    recoveryManifestSha256,
    recoveryArchivePath: durable?.archivePath || null,
    recoveryManifestPath: durable?.manifestPath || null,
    dryRun: dry?.state || null,
    proof: row?.archive_proof_verified_at ? "verified" : null,
    receipt: row?.registry_cleaned_at ? "cleaned" : state === "prepared" ? "prepare-only" : null,
    destructiveGoBatchId: row?.destructive_go_batch_id || null,
    destructiveGoAt: row?.destructive_go_at || null,
    mappings: evidence?.transactionCount ?? null,
    blockingAnomalies,
  };
}

function automaticRecoveryStorageModified(durable) {
  return durable?.recoveryArchive?.uploaded === true
    || durable?.recoveryManifest?.uploaded === true;
}

function automaticStorageMutation({ archiveStorageModified, recoveryStorageModified }) {
  const archiveModified = archiveStorageModified == null ? null : archiveStorageModified === true;
  const recoveryModified = recoveryStorageModified == null ? null : recoveryStorageModified === true;
  const storageModified = archiveModified === true || recoveryModified === true
    ? true
    : archiveModified === false && recoveryModified === false
      ? false
      : null;
  return {
    archiveStorageModified: archiveModified,
    recoveryStorageModified: recoveryModified,
    storageModified,
  };
}

function automaticDryRunObservability({ attempts = 0, retryCount = 0, sqlstates = [] } = {}) {
  return {
    dryRunAttempts: attempts,
    dryRunRetryCount: retryCount,
    dryRunSqlstates: Array.isArray(sqlstates) ? [...sqlstates] : [],
  };
}

function automaticExecuteObservability({ attempts = 0, retryCount = 0, sqlstates = [] } = {}) {
  return {
    executeAttempts: attempts,
    executeRetryCount: retryCount,
    executeSqlstates: Array.isArray(sqlstates) ? [...sqlstates] : [],
  };
}

function automaticBatchProgress({
  row,
  identity,
  dry,
  durable,
  state,
  deployedCommitSha,
  archiveStorageModified = false,
  recoveryStorageModified = automaticRecoveryStorageModified(durable),
  executeState = null,
  executeConfirmed = false,
  dbMutationConfirmed = false,
  retryState = null,
  dryRunAttempts = 0,
  dryRunRetryCount = 0,
  dryRunSqlstates = [],
  executeAttempts = 0,
  executeRetryCount = 0,
  executeSqlstates = [],
}) {
  return {
    ...botOnlyReport({
      row,
      identity,
      dry,
      durable,
      state,
      mode: "automatic",
      deployedCommitSha,
    }),
    ...automaticStorageMutation({ archiveStorageModified, recoveryStorageModified }),
    executeState,
    executeConfirmed,
    dbMutationConfirmed,
    retryState,
    ...automaticDryRunObservability({
      attempts: dryRunAttempts,
      retryCount: dryRunRetryCount,
      sqlstates: dryRunSqlstates,
    }),
    ...automaticExecuteObservability({
      attempts: executeAttempts,
      retryCount: executeRetryCount,
      sqlstates: executeSqlstates,
    }),
  };
}

function botOnlyNoCandidateReport({ exported, identity, deployedCommitSha }) {
  const blockingAnomalies = exported.blockingAnomalies || [];
  return {
    state: "no-op",
    mode: "prepare-only",
    sourcePolicyId: BOT_ONLY_RETENTION_POLICY_ID,
    projectRef: exported.options?.projectRef || STAGE_PROJECT_REF,
    deployedCommitSha,
    formatVersion: BOT_ONLY_EXPORT_SCHEMA_VERSION,
    stageSystemIdentifier: identity,
    batchId: null,
    objectPath: null,
    cutoff: exported.options?.cutoff || null,
    cursorStart: exported.options?.cursor || null,
    cursorEnd: null,
    blockingAnomalies,
    reason: blockingAnomalies.length ? "blocking_anomalies" : "no_eligible_bot_only_table",
  };
}

function receiptFieldCount(row) {
  return [
    row.pruned_at,
    row.pruned_transaction_count,
    row.pruned_entry_count,
    row.pruned_transaction_ids_sha256,
    row.pruned_entry_ids_sha256,
  ].filter((value) => value != null).length;
}

function proofFieldCount(row) {
  return [
    row.archive_proof_verified_at,
    row.archived_transaction_ids_sha256,
    row.archived_entry_ids_sha256,
  ].filter((value) => value != null).length;
}

const BOT_ONLY_PROOF_FIELDS = [
  "bot_only_table_id",
  "bot_only_table_count",
  "bot_only_newest_created_at",
  "bot_only_registry_keys_sha256",
  "bot_only_out_of_scope_keys_sha256",
  "bot_only_identity_count",
  "bot_only_eligible_count",
];

const BOT_ONLY_EXECUTE_MANIFEST_FIELDS = [
  "object_path",
  "project_ref",
  "source_policy_id",
  "status",
  "batch_id",
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
  "committed_at",
  "archive_proof_verified_at",
  "archived_transaction_ids_sha256",
  "archived_entry_ids_sha256",
  ...BOT_ONLY_PROOF_FIELDS,
  "pruned_at",
  "pruned_transaction_count",
  "pruned_entry_count",
  "pruned_transaction_ids_sha256",
  "pruned_entry_ids_sha256",
  "registry_cleaned_at",
  "registry_cleaned_key_count",
  "registry_cleaned_keys_sha256",
  "destructive_go_at",
  "destructive_go_batch_id",
];

function nonNullFieldCount(row, fields) {
  return fields.filter((field) => row?.[field] != null).length;
}

function validSha256(value) {
  return SHA256_RE.test(text(value));
}

function assertExactReceiptFields(row, batchId) {
  const receiptCount = receiptFieldCount(row);
  if (receiptCount !== 0 && receiptCount !== 5) {
    fail(`exact bot-only batch ${batchId} has a partial prune receipt`);
  }
  if (receiptCount === 5) {
    if (Number(row.pruned_transaction_count) !== Number(row.transaction_count)
      || Number(row.pruned_entry_count) !== Number(row.entry_count)
      || row.pruned_transaction_ids_sha256 !== row.archived_transaction_ids_sha256
      || row.pruned_entry_ids_sha256 !== row.archived_entry_ids_sha256) {
      fail(`exact bot-only batch ${batchId} has a mismatched prune receipt`);
    }
  }

  const cleanupCount = cleanupReceiptFieldCount(row);
  if (cleanupCount !== 0 && cleanupCount !== 3) {
    fail(`exact bot-only batch ${batchId} has a partial registry cleanup receipt`);
  }
  if (cleanupCount === 3 && (receiptCount !== 5
    || Number(row.registry_cleaned_key_count) !== Number(row.transaction_count)
    || row.registry_cleaned_keys_sha256 !== row.bot_only_registry_keys_sha256)) {
    fail(`exact bot-only batch ${batchId} has an invalid registry cleanup receipt`);
  }
  return { receiptCount, cleanupCount };
}

export function assertBotOnlyExecuteBatch(row, approvedBatchId, identity = STAGE_SYSTEM_IDENTIFIER) {
  const batchId = String(approvedBatchId);
  if (!row) fail(`exact approved bot-only batch ${batchId} was not found`);
  if (text(row.batch_id) !== batchId) fail(`exact approved bot-only batch ${batchId} identity mismatch`);
  if (text(identity) !== STAGE_SYSTEM_IDENTIFIER) fail("exact bot-only batch Stage identity mismatch");
  if (text(row.project_ref) !== STAGE_PROJECT_REF) fail("exact bot-only batch project mismatch");
  if (text(row.source_policy_id) !== BOT_ONLY_RETENTION_POLICY_ID) fail("exact bot-only batch policy mismatch");
  if (Number(row.format_version) !== BOT_ONLY_EXPORT_SCHEMA_VERSION) fail("exact bot-only batch schema version mismatch");
  if (text(row.status) !== "committed" || !text(row.committed_at)) fail("exact bot-only batch is not committed");
  if (!validSha256(row.raw_sha256) || !validSha256(row.compressed_sha256)) fail("exact bot-only batch has an invalid archive hash");
  if (text(row.object_path) !== `v1/sha256/${text(row.compressed_sha256)}.jsonl.gz`) {
    fail("exact bot-only batch object path does not match its compressed hash");
  }
  if (Number(row.transaction_count) < 1 || Number(row.transaction_count) > STAGE_MAX_BATCH_SIZE
    || Number(row.entry_count) < 1) {
    fail("exact bot-only batch has invalid archive counts");
  }

  if (proofFieldCount(row) !== 3
    || !validSha256(row.archived_transaction_ids_sha256)
    || !validSha256(row.archived_entry_ids_sha256)) {
    fail(`exact bot-only batch ${batchId} is missing a complete archive proof`);
  }
  if (nonNullFieldCount(row, BOT_ONLY_PROOF_FIELDS) !== BOT_ONLY_PROOF_FIELDS.length
    || text(row.bot_only_table_id) === ""
    || Number(row.bot_only_table_count) !== 1
    || !text(row.bot_only_newest_created_at)
    || !validSha256(row.bot_only_registry_keys_sha256)
    || !validSha256(row.bot_only_out_of_scope_keys_sha256)
    || Number(row.bot_only_identity_count) !== Number(row.transaction_count)
    || Number(row.bot_only_eligible_count) !== Number(row.transaction_count)) {
    fail(`exact bot-only batch ${batchId} has incomplete or invalid schema-v2 proof`);
  }

  const receipts = assertExactReceiptFields(row, batchId);
  const goCount = nonNullFieldCount(row, ["destructive_go_at", "destructive_go_batch_id"]);
  if (goCount !== 0 && goCount !== 2) fail(`exact bot-only batch ${batchId} has a partial destructive GO`);
  if (goCount === 2 && text(row.destructive_go_batch_id) !== batchId) {
    fail(`exact bot-only batch ${batchId} has a foreign destructive GO`);
  }
  if (receipts.receiptCount === 5 && goCount !== 2) {
    fail(`exact bot-only batch ${batchId} is pruned without its exact destructive GO`);
  }
  return { ...receipts, hasExactGo: goCount === 2 };
}

function normalizedManifestValue(field, value) {
  if (value == null) return null;
  if (field === "tx_types") {
    try {
      return canonicalJson(typeof value === "string" ? JSON.parse(value) : value);
    } catch {
      return text(value);
    }
  }
  return String(value);
}

export function assertBotOnlyActiveManifestMatch(exactRow, activeRow, approvedBatchId) {
  for (const field of BOT_ONLY_EXECUTE_MANIFEST_FIELDS) {
    if (normalizedManifestValue(field, exactRow?.[field]) !== normalizedManifestValue(field, activeRow?.[field])) {
      fail(`exact approved bot-only batch ${approvedBatchId} does not match the active manifest (${field})`);
    }
  }
  return true;
}

async function loadExactBatch(sql, approvedBatchId) {
  const readExact = async (tx) => {
    await tx.unsafe("set transaction isolation level repeatable read, read only;");
    return tx.unsafe(STAGE_EXACT_BATCH_SQL, [approvedBatchId]);
  };
  const rows = typeof sql.begin === "function"
    ? await sql.begin(readExact)
    : await sql.unsafe(STAGE_EXACT_BATCH_SQL, [approvedBatchId]);
  if (rows.length !== 1) {
    if (rows.length === 0) fail(`exact approved bot-only batch ${approvedBatchId} was not found`);
    fail(`exact approved bot-only batch ${approvedBatchId} is duplicated`);
  }
  return rows[0];
}

export function findOwnCycle(rows) {
  const active = rows.filter((row) => row.status === "pending"
    || (row.status === "committed" && receiptFieldCount(row) !== 5));
  if (active.length > 1) fail("multiple incomplete Stage automation manifests; refusing to choose one");
  if (active[0]?.status === "pending") fail("Stage automation manifest is pending; refusing a blind resume");
  if (active[0] && active[0].source_policy_id !== STAGE_AUTOMATION_POLICY_ID) {
    fail("Stage automation manifest policy mismatch");
  }
  for (const row of rows) {
    if (row.status !== "pending" && row.status !== "committed") fail("Stage automation manifest has an invalid state");
    if (row.source_policy_id !== STAGE_AUTOMATION_POLICY_ID) fail("Stage automation manifest policy mismatch");
    if (receiptFieldCount(row) !== 0 && receiptFieldCount(row) !== 5) fail("Stage automation receipt is partial");
    if (proofFieldCount(row) !== 0 && proofFieldCount(row) !== 3) fail("Stage automation proof is partial");
  }
  return {
    active: active[0] || null,
    latestCompleted: rows.find((row) => row.status === "committed" && receiptFieldCount(row) === 5) || null,
  };
}

function assertRecoveryManifestMatches(actual, expected) {
  if (canonicalJson(actual) !== canonicalJson(expected)) fail("durable recovery manifest differs from verified evidence");
}

export function assertResumeRecoveryState(row, durable) {
  if (row.pruned_at && !durable) fail("pruned Stage automation cycle has no durable recovery copies");
  if (row.archive_proof_verified_at && !row.pruned_at && !durable) {
    fail("proven Stage automation cycle has no durable recovery; refusing a blind Storage retry");
  }
  if (!row.archive_proof_verified_at && durable) {
    fail("Stage automation recovery exists without an immutable proof; refusing an ambiguous resume");
  }
  return true;
}

function assertAutomaticBotOnlyProofEvidence(row, evidence, batchId) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    fail(`automatic bot-only batch ${batchId} has no verified dry-run evidence`);
  }
  const evidenceShaFields = [
    "transactionIdsSha256",
    "entryIdsSha256",
    "registryKeysSha256",
    "outOfScopeKeysSha256",
  ];
  if (evidenceShaFields.some((field) => !validSha256(evidence[field]))) {
    fail(`automatic bot-only batch ${batchId} dry-run evidence has incomplete SHA-256 proof`);
  }
  if (!["transactionCount", "entryCount", "distinctTables"].every((field) => Number.isSafeInteger(Number(evidence[field])))
    || !Number.isSafeInteger(Number(row.transaction_count))
    || !Number.isSafeInteger(Number(row.entry_count))
    || !Number.isSafeInteger(Number(row.bot_only_identity_count))
    || !Number.isSafeInteger(Number(row.bot_only_eligible_count))
    || !evidence.txTypes
    || typeof evidence.txTypes !== "object"
    || Array.isArray(evidence.txTypes)
    || !text(evidence.tableId)
    || !Array.isArray(evidence.registryKeys)
    || evidence.registryKeys.some((key) => typeof key !== "string")) {
    fail(`automatic bot-only batch ${batchId} dry-run evidence is incomplete`);
  }
  const sortedRegistryKeys = [...evidence.registryKeys].sort();
  if (canonicalJson(sortedRegistryKeys) !== canonicalJson(evidence.registryKeys)) {
    fail(`automatic bot-only batch ${batchId} dry-run registry proof is not canonical`);
  }
  const mismatches = [];
  if (row.archived_transaction_ids_sha256 !== evidence.transactionIdsSha256) mismatches.push("transaction ID proof");
  if (row.archived_entry_ids_sha256 !== evidence.entryIdsSha256) mismatches.push("entry ID proof");
  if (Number(row.transaction_count) !== Number(evidence.transactionCount)) mismatches.push("transaction count");
  if (Number(row.entry_count) !== Number(evidence.entryCount)) mismatches.push("entry count");
  if (canonicalJson(row.tx_types) !== canonicalJson(evidence.txTypes)) mismatches.push("transaction types");
  if (text(row.credits) !== text(evidence.credits)) mismatches.push("credits");
  if (text(row.debits) !== text(evidence.debits)) mismatches.push("debits");
  if (text(row.net_amount) !== text(evidence.net)) mismatches.push("net amount");
  if (text(row.bot_only_table_id).toLowerCase() !== text(evidence.tableId).toLowerCase()) mismatches.push("TABLE identity");
  if (Number(row.bot_only_table_count) !== 1 || Number(evidence.distinctTables) !== 1) mismatches.push("TABLE count");
  if (!Array.isArray(evidence.registryKeys)
    || Number(row.bot_only_identity_count) !== evidence.registryKeys.length
    || Number(row.bot_only_eligible_count) !== evidence.registryKeys.length) {
    mismatches.push("registry identity count");
  }
  if (row.bot_only_registry_keys_sha256 !== evidence.registryKeysSha256) mismatches.push("registry key proof");
  if (row.bot_only_out_of_scope_keys_sha256 !== evidence.outOfScopeKeysSha256) mismatches.push("out-of-scope key proof");
  if (mismatches.length) {
    fail(`automatic bot-only batch ${batchId} dry-run evidence differs from immutable proof: ${mismatches.join(", ")}`);
  }
  return true;
}

function assertAutomaticBotOnlyDryRunArchive(row, dry, batchId) {
  if (!validSha256(dry?.archiveSha256) || dry.archiveSha256 !== row.compressed_sha256) {
    fail(`automatic bot-only batch ${batchId} dry-run archive checksum differs from the committed archive SHA`);
  }
  return true;
}

export function assertAutomaticBotOnlyRecoveryReconstructionState({
  row,
  identity,
  evidence,
  dryRunState,
  durable,
} = {}) {
  const batchId = text(row?.batch_id);
  if (dryRunState !== "ready") {
    fail(`automatic bot-only batch ${batchId} recovery reconstruction requires a ready dry-run`);
  }
  if (durable !== null) {
    fail(`automatic bot-only batch ${batchId} recovery reconstruction requires both recovery objects to be confirmed absent`);
  }
  const lifecycle = assertBotOnlyExecuteBatch(row, batchId, identity);
  if (lifecycle.receiptCount !== 0
    || lifecycle.cleanupCount !== 0
    || lifecycle.hasExactGo
    || row.bot_only_table_exists !== true
    || row.bot_only_retention_complete_at != null) {
    fail(`automatic bot-only batch ${batchId} recovery reconstruction requires an unpruned, uncleaned batch without destructive GO`);
  }
  assertAutomaticBotOnlyProofEvidence(row, evidence, batchId);
  return true;
}

function assertAutomaticBotOnlyDurableRecovery({ row, identity, evidence, durable }) {
  const batchId = text(row?.batch_id);
  if (durable === null || durable === undefined) {
    fail(`automatic bot-only batch ${batchId} has no durable recovery copies`);
  }
  assertDurableRecoveryReady(durable);
  const expectedArchivePath = buildRecoveryArchiveObjectPath(row.compressed_sha256);
  const expectedManifestPath = buildRecoveryManifestObjectPath(row.compressed_sha256);
  if (durable.archivePath !== expectedArchivePath || durable.manifestPath !== expectedManifestPath) {
    fail(`automatic bot-only batch ${batchId} recovery paths are not derived from the committed archive SHA`);
  }
  const archiveSha256 = sha256(durable.archiveBytes);
  if (archiveSha256 !== row.compressed_sha256
    || durable.archiveSha256 !== archiveSha256
    || (durable.recoveryArchive?.objectPath != null && durable.recoveryArchive.objectPath !== expectedArchivePath)
    || (durable.recoveryArchive?.sha256 != null && durable.recoveryArchive.sha256 !== archiveSha256)) {
    fail(`automatic bot-only batch ${batchId} recovery archive checksum differs`);
  }

  let manifestBytes;
  try {
    manifestBytes = gunzipSync(durable.manifestGzipBytes);
  } catch {
    fail(`automatic bot-only batch ${batchId} recovery manifest is not valid gzip`);
  }
  if (!manifestBytes.equals(durable.manifestBytes)) {
    fail(`automatic bot-only batch ${batchId} recovery manifest bytes are inconsistent`);
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    fail(`automatic bot-only batch ${batchId} recovery manifest is invalid JSON`);
  }
  const canonical = gzipRecoveryManifest(
    buildCanonicalBotOnlyRecoveryManifest(row, identity, evidence, batchId),
  );
  if (!manifestBytes.equals(canonical.manifestBytes)
    || !durable.manifestGzipBytes.equals(canonical.manifestGzipBytes)) {
    fail(`automatic bot-only batch ${batchId} recovery manifest is not canonical`);
  }
  assertBotOnlyRecoveryManifest(manifest, batchId);
  assertRecoveryManifestMatches(manifest, canonical.manifest);
  const manifestSha256 = sha256(durable.manifestGzipBytes);
  if (durable.manifestSha256 !== manifestSha256
    || (durable.recoveryManifest?.objectPath != null && durable.recoveryManifest.objectPath !== expectedManifestPath)
    || (durable.recoveryManifest?.sha256 != null && durable.recoveryManifest.sha256 !== manifestSha256)) {
    fail(`automatic bot-only batch ${batchId} recovery manifest checksum differs`);
  }
  return durable;
}

function assertAutomaticBotOnlyMainArchive(row, mainArchive, dry, batchId) {
  if (!Buffer.isBuffer(mainArchive?.bytes)) {
    fail(`automatic bot-only batch ${batchId} main archive download is missing`);
  }
  const archiveSha256 = sha256(mainArchive.bytes);
  if (mainArchive.sha256 != null && mainArchive.sha256 !== archiveSha256) {
    fail(`automatic bot-only batch ${batchId} main archive download checksum is self-inconsistent`);
  }
  if (archiveSha256 !== row.compressed_sha256) {
    fail(`automatic bot-only batch ${batchId} main archive does not match the committed archive SHA`);
  }
  if (dry?.archiveSha256 != null && dry.archiveSha256 !== archiveSha256) {
    fail(`automatic bot-only batch ${batchId} main archive differs from the verified dry-run archive`);
  }
  return archiveSha256;
}

export async function inspectDurableRecovery(storageTarget, row, deps = {}) {
  const archivePath = buildRecoveryArchiveObjectPath(row.compressed_sha256);
  const manifestPath = buildRecoveryManifestObjectPath(row.compressed_sha256);
  const [archiveBytes, manifestGzipBytes] = await Promise.all([
    downloadPrivateObjectIfExists(storageTarget, archivePath, deps),
    downloadPrivateObjectIfExists(storageTarget, manifestPath, deps),
  ]);
  if (archiveBytes == null && manifestGzipBytes == null) return null;
  if (archiveBytes == null || manifestGzipBytes == null) fail("durable recovery copy is partial");
  if (!SHA256_RE.test(row.compressed_sha256) || sha256(archiveBytes) !== row.compressed_sha256) {
    fail("durable recovery archive copy checksum differs");
  }
  let manifestBytes;
  try {
    manifestBytes = gunzipSync(manifestGzipBytes);
  } catch {
    fail("durable recovery manifest is not valid gzip");
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    fail("durable recovery manifest is invalid JSON");
  }
  return {
    archivePath,
    manifestPath,
    archiveBytes,
    manifestGzipBytes,
    manifestBytes,
    manifest,
    archiveSha256: sha256(archiveBytes),
    manifestSha256: sha256(manifestGzipBytes),
  };
}

function isBotOnlyRetentionBatch(row) {
  return Number(row?.format_version) === BOT_ONLY_EXPORT_SCHEMA_VERSION
    && text(row?.source_policy_id) === BOT_ONLY_RETENTION_POLICY_ID;
}

function assertNormalizedBotOnlyManifestRow(row, batchId) {
  const numericFields = [
    "format_version",
    "transaction_count",
    "entry_count",
    "raw_bytes",
    "compressed_bytes",
    "bot_only_table_count",
    "bot_only_identity_count",
    "bot_only_eligible_count",
  ];
  for (const field of numericFields) {
    if (!Number.isSafeInteger(row?.[field]) || row[field] < 0) {
      fail(`exact bot-only batch ${batchId} recovery manifest has a non-native numeric field: ${field}`);
    }
  }
  if (!row?.tx_types || typeof row.tx_types !== "object" || Array.isArray(row.tx_types)) {
    fail(`exact bot-only batch ${batchId} recovery manifest has non-object tx_types`);
  }
  return row;
}

function assertBotOnlyRecoveryManifest(manifest, batchId) {
  const archive = manifest?.archive;
  const numericFields = ["format_version", "transaction_count", "entry_count", "raw_bytes", "compressed_bytes"];
  if (!archive || typeof archive !== "object" || Array.isArray(archive)
    || numericFields.some((field) => !Number.isSafeInteger(archive[field]) || archive[field] < 0)
    || !archive.tx_types || typeof archive.tx_types !== "object" || Array.isArray(archive.tx_types)) {
    fail(`exact bot-only batch ${batchId} recovery manifest has non-canonical archive fields`);
  }
  const botOnly = manifest?.bot_only;
  const requiredFields = [
    "table_id",
    "table_count",
    "registry_keys_sha256",
    "registry_key_count",
    "out_of_scope_keys_sha256",
  ];
  if (!botOnly || typeof botOnly !== "object" || Array.isArray(botOnly)
    || requiredFields.some((field) => botOnly[field] == null)
    || typeof botOnly.table_id !== "string"
    || !Number.isSafeInteger(botOnly.table_count) || botOnly.table_count < 0
    || !Number.isSafeInteger(botOnly.registry_key_count) || botOnly.registry_key_count < 0
    || !SHA256_RE.test(botOnly.registry_keys_sha256)
    || !SHA256_RE.test(botOnly.out_of_scope_keys_sha256)) {
    fail(`exact bot-only batch ${batchId} recovery manifest is missing bot_only`);
  }
  return manifest;
}

function buildCanonicalBotOnlyRecoveryManifest(row, identity, evidence, batchId) {
  assertNormalizedBotOnlyManifestRow(row, batchId);
  const manifest = buildRecoveryManifest(row, identity, evidence, { target: "stage" });
  return assertBotOnlyRecoveryManifest(manifest, batchId);
}

function gzipRecoveryManifest(manifest) {
  const manifestBytes = Buffer.from(`${stringifyJson(manifest)}\n`, "utf8");
  const manifestGzipBytes = gzipSync(manifestBytes, { level: 9, mtime: 0 });
  return {
    manifest,
    manifestBytes,
    manifestGzipBytes,
    manifestSha256: sha256(manifestGzipBytes),
  };
}

function assertKnownBatch15RecoveryBatch(row) {
  const expected = BOT_ONLY_BATCH_15_RECOVERY_REPAIR;
  if (text(row?.batch_id) !== expected.batchId
    || text(row?.object_path) !== expected.objectPath
    || text(row?.compressed_sha256) !== expected.archiveSha256) {
    fail("bot-only batch 15 recovery repair target path or archive SHA is not approved");
  }
  return true;
}

function assertKnownBatch15RecoveryRepairTarget(row, durable) {
  assertKnownBatch15RecoveryBatch(row);
  const expected = BOT_ONLY_BATCH_15_RECOVERY_REPAIR;
  const manifestSha256 = durable?.manifestGzipBytes ? sha256(durable.manifestGzipBytes) : null;
  if (!durable
    || durable.archivePath !== expected.recoveryArchivePath
    || durable.manifestPath !== expected.recoveryManifestPath
    || durable.archiveSha256 !== expected.archiveSha256
    || !Buffer.isBuffer(durable.archiveBytes)
    || !Buffer.isBuffer(durable.manifestGzipBytes)
    || ![expected.currentRecoveryManifestSha256, expected.correctedRecoveryManifestSha256].includes(manifestSha256)) {
    fail(`bot-only batch 15 recovery repair current object content is not the approved known state; observed manifest SHA-256: ${manifestSha256 || "missing"}`);
  }
  return manifestSha256 === expected.currentRecoveryManifestSha256 ? "needs_repair" : "already_repaired";
}

function assertCanonicalBotOnlyRecovery(durable, canonical, batchId) {
  if (!durable
    || !Buffer.isBuffer(durable.archiveBytes)
    || !Buffer.isBuffer(durable.manifestGzipBytes)
    || !Buffer.isBuffer(durable.manifestBytes)) {
    fail(`exact bot-only batch ${batchId} recovery verification is incomplete`);
  }

  let manifestBytes;
  try {
    manifestBytes = gunzipSync(durable.manifestGzipBytes);
  } catch {
    fail(`exact bot-only batch ${batchId} recovery manifest is not valid gzip`);
  }
  if (!manifestBytes.equals(durable.manifestBytes)) {
    fail(`exact bot-only batch ${batchId} recovery manifest bytes are inconsistent`);
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    fail(`exact bot-only batch ${batchId} recovery manifest is invalid JSON`);
  }
  if (!durable.manifestGzipBytes.equals(canonical.manifestGzipBytes)
    || !manifestBytes.equals(canonical.manifestBytes)) {
    fail(`exact bot-only batch ${batchId} recovery manifest is not canonical`);
  }
  assertBotOnlyRecoveryManifest(manifest, batchId);
  assertRecoveryManifestMatches(manifest, canonical.manifest);
  return {
    ...durable,
    manifestBytes,
    manifest,
    manifestSha256: sha256(durable.manifestGzipBytes),
  };
}

export async function persistDurableRecovery(storageTarget, row, identity, evidence, archiveBytes, deps = {}) {
  if (sha256(archiveBytes) !== row.compressed_sha256) fail("verified archive checksum differs before recovery copy");
  const manifest = isBotOnlyRetentionBatch(row)
    ? buildCanonicalBotOnlyRecoveryManifest(row, identity, evidence, text(row.batch_id))
    : buildRecoveryManifest(row, identity, evidence, { target: "stage" });
  const manifestBytes = Buffer.from(`${stringifyJson(manifest)}\n`, "utf8");
  const manifestGzipBytes = gzipSync(manifestBytes, { level: 9, mtime: 0 });
  let recoveryArchive = null;
  let recoveryManifest = null;
  try {
    recoveryArchive = await uploadOrVerifyPrivateObject({
      storageTarget,
      objectPath: buildRecoveryArchiveObjectPath(row.compressed_sha256),
      bytes: archiveBytes,
      deps,
    });
    recoveryManifest = await uploadOrVerifyPrivateObject({
      storageTarget,
      objectPath: buildRecoveryManifestObjectPath(row.compressed_sha256),
      bytes: manifestGzipBytes,
      deps,
    });
    const verified = await inspectDurableRecovery(storageTarget, row, deps);
    if (!verified) fail("durable recovery copies disappeared after upload");
    if (isBotOnlyRetentionBatch(row)) assertBotOnlyRecoveryManifest(verified.manifest, text(row.batch_id));
    assertRecoveryManifestMatches(verified.manifest, manifest);
    return {
      ...verified,
      recoveryArchive,
      recoveryManifest,
    };
  } catch (error) {
    const recoveryStorageModified = recoveryArchive?.uploaded === true || recoveryManifest?.uploaded === true
      ? true
      : recoveryArchive && recoveryManifest
        ? false
        : null;
    error.storageMutation = { recoveryStorageModified };
    throw error;
  }
}

export async function runBotOnlyRecoveryRepair({ env = process.env, deps = {}, batchId = "15" } = {}) {
  const exactBatchId = String(batchId);
  if (exactBatchId !== "15") fail("bot-only recovery repair is pinned to batch 15");
  if (text(env.CHIPS_LEDGER_BOT_ONLY_EXECUTE) !== ""
    || text(env.CHIPS_LEDGER_BOT_ONLY_AUTOMATIC) !== "") {
    fail("bot-only recovery repair cannot run with execute or automatic gates");
  }

  let sql = null;
  let lockSession = null;
  let tempRoot = null;
  let ownsSql = false;
  let result = null;
  let deployedCommitSha = null;
  let failed = false;
  let failure = null;

  try {
    const config = validateStageEnvironment(env, { requireCommitSha: true });
    deployedCommitSha = config.deployedCommitSha;
    const moduleEnv = config.moduleEnv;
    if (deps.sql) sql = deps.sql;
    else {
      sql = postgres(config.dbUrl, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 0 });
      ownsSql = true;
    }
    tempRoot = deps.tempRoot || fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-stage-recovery-repair-"));
    ensurePrivateDirectory(tempRoot);
    const storageTarget = deps.storageTarget || resolveStorageTarget("stage", moduleEnv, { singleTarget: true });
    const pruneStore = deps.pruneStore || createPruneStore(sql);
    const verifyBucket = deps.verifyBucket || ((target) => verifyArchiveBucket(target, deps));
    const inspectRecovery = deps.inspectDurableRecovery || inspectDurableRecovery;
    const persistRecovery = deps.persistDurableRecovery || persistDurableRecovery;
    const replaceRecoveryManifest = deps.replaceVerifiedPrivateObject || replaceVerifiedPrivateObject;

    lockSession = await acquireAdvisoryLock(sql);
    if (!lockSession) fail("bot-only batch 15 recovery repair requires the Stage advisory lock");

    const identity = await assertIdentity(sql);
    await assertAdvisoryLock(sql, lockSession);
    const exactRow = await loadExactBatch(sql, exactBatchId);
    assertBotOnlyExecuteBatch(exactRow, exactBatchId, identity);
    const row = await pruneStore.getManifest(exactRow.object_path);
    if (!row) fail("bot-only batch 15 normalized recovery manifest was not found");
    assertBotOnlyActiveManifestMatch(exactRow, row, exactBatchId);
    assertBotOnlyExecuteBatch(row, exactBatchId, identity);
    assertKnownBatch15RecoveryBatch(row);
    if (row.pruned_at || row.registry_cleaned_at || row.destructive_go_at || row.destructive_go_batch_id) {
      fail("bot-only batch 15 recovery repair requires an unpruned, uncleaned batch without destructive GO");
    }

    await verifyBucket(storageTarget);
    const existing = await inspectRecovery(storageTarget, row, deps);
    const initialRecoveryState = existing === null
      ? null
      : assertKnownBatch15RecoveryRepairTarget(row, existing);
    await assertAdvisoryLock(sql, lockSession);

    const dry = await runPruneStep({
      row,
      mode: "dry-run",
      env: moduleEnv,
      cwd: tempRoot,
      sql,
      pruneStore,
      storageTarget,
      verifyBucket,
      storageDeps: deps,
    });
    if (dry.state !== "ready") fail(`bot-only batch 15 recovery archive verification did not become ready: ${dry.state}`);
    await assertAdvisoryLock(sql, lockSession);

    let durable;
    let state = "recovery_repaired";
    let receipt = "recovery-only";
    let storageModified = false;
    if (initialRecoveryState === null) {
      const main = await (deps.downloadPrivateArchive || downloadPrivateArchiveObject)(storageTarget, row.object_path, deps);
      durable = await persistRecovery(storageTarget, row, identity, dry.evidence, main.bytes, deps);
      if (durable.recoveryArchive?.uploaded !== true || durable.recoveryManifest?.uploaded !== true) {
        fail("bot-only batch 15 recovery repair did not create both previously missing objects");
      }
      if (durable.archiveSha256 !== row.compressed_sha256
        || durable.recoveryArchive.sha256 !== row.compressed_sha256
        || durable.manifestSha256 !== durable.recoveryManifest.sha256) {
        fail("bot-only batch 15 recovery repair checksum verification failed");
      }
      storageModified = true;
    } else {
      const canonical = gzipRecoveryManifest(
        buildCanonicalBotOnlyRecoveryManifest(row, identity, dry.evidence, exactBatchId),
      );
      if (canonical.manifestSha256 !== BOT_ONLY_BATCH_15_RECOVERY_REPAIR.correctedRecoveryManifestSha256) {
        fail("bot-only batch 15 recovery repair produced an unexpected canonical manifest SHA");
      }

      await assertAdvisoryLock(sql, lockSession);
      const current = await inspectRecovery(storageTarget, row, deps);
      const currentRecoveryState = assertKnownBatch15RecoveryRepairTarget(row, current);
      if (!current.archiveBytes.equals(existing.archiveBytes)) {
        fail("bot-only batch 15 recovery repair changed the recovery archive while verifying the manifest");
      }

      const correctedRecovery = initialRecoveryState === "already_repaired"
        ? existing
        : currentRecoveryState === "already_repaired"
          ? current
          : null;
      if (correctedRecovery) {
        durable = assertCanonicalBotOnlyRecovery(correctedRecovery, canonical, exactBatchId);
        state = "recovery_already_repaired";
        receipt = "recovery-already-repaired-read-only";
      } else {
        const replacement = await replaceRecoveryManifest({
          storageTarget,
          objectPath: BOT_ONLY_BATCH_15_RECOVERY_REPAIR.recoveryManifestPath,
          expectedCurrentBytes: current.manifestGzipBytes,
          bytes: canonical.manifestGzipBytes,
          deps,
        });
        const replacementAlreadyReplaced = replacement.alreadyReplaced === true;
        const replacementApplied = replacement.replaced === true;
        if (replacement.objectPath !== BOT_ONLY_BATCH_15_RECOVERY_REPAIR.recoveryManifestPath
          || replacementAlreadyReplaced === replacementApplied
          || !Buffer.isBuffer(replacement.verifiedBytes)
          || replacement.bytes !== canonical.manifestGzipBytes.length
          || replacement.sha256 !== canonical.manifestSha256
          || !replacement.verifiedBytes.equals(canonical.manifestGzipBytes)) {
          fail("bot-only batch 15 recovery manifest replacement verification failed");
        }
        await assertAdvisoryLock(sql, lockSession);
        const verifiedManifestGzipBytes = Buffer.from(replacement.verifiedBytes);
        const verified = assertCanonicalBotOnlyRecovery({
          ...current,
          manifestGzipBytes: verifiedManifestGzipBytes,
          manifestBytes: gunzipSync(verifiedManifestGzipBytes),
        }, canonical, exactBatchId);
        durable = {
          ...verified,
          recoveryArchive: {
            objectPath: verified.archivePath,
            objectExisted: true,
            uploaded: false,
            bytes: verified.archiveBytes.length,
            sha256: verified.archiveSha256,
          },
          recoveryManifest: {
            ...replacement,
            bytes: verified.manifestGzipBytes.length,
            sha256: verified.manifestSha256,
          },
        };
        if (replacementAlreadyReplaced) {
          state = "recovery_already_repaired";
          receipt = "recovery-already-repaired-read-only";
        } else {
          storageModified = true;
          receipt = "recovery-manifest-repair-only";
        }
      }
    }
    result = {
      ...botOnlyReport({
        row,
        identity,
        dry,
        durable,
        state: "prepared",
        mode: "recovery-repair",
        deployedCommitSha,
      }),
      state,
      receipt,
      dryRun: dry.state,
      initialRecoveryObjectsAbsent: existing === null,
      recoveryVerified: true,
      storageModified,
    };
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    if (lockSession && sql) {
      try { await releaseAdvisoryLock(sql); } catch { /* owned session close releases it */ }
    }
    if (sql && ownsSql) {
      try { await sql.end({ timeout: 5 }); } catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  }
  if (failed) {
    emitAggregateError(failure, { deployedCommitSha, phase: "recovery-repair" });
    throw failure;
  }
  if (result && deployedCommitSha) result = { ...result, deployedCommitSha };
  writeAggregateSummary(result);
  return result;
}

function lstatRecoveryMember(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function restoreLocalRecovery(directory, durable) {
  ensurePrivateDirectory(directory);
  const base = `chips-ledger-${sha256(durable.archiveBytes)}`;
  const artifactPath = path.join(directory, `${base}.jsonl.gz`);
  const manifestPath = path.join(directory, `${base}.recovery.json`);
  const artifactExists = lstatRecoveryMember(artifactPath);
  const manifestExists = lstatRecoveryMember(manifestPath);
  if (artifactExists !== manifestExists) fail("local recovery bundle is partial; refusing to overwrite it");
  if (!artifactExists) {
    writeExclusiveFiles([
      { path: artifactPath, data: durable.archiveBytes },
      { path: manifestPath, data: durable.manifestBytes },
    ], { createDirectories: false });
  } else {
    assertPrivateRegularFile(artifactPath);
    assertPrivateRegularFile(manifestPath);
    if (!fs.readFileSync(artifactPath).equals(durable.archiveBytes)
      || !fs.readFileSync(manifestPath).equals(durable.manifestBytes)) {
      fail("existing local recovery bundle differs from the verified recovery bytes");
    }
  }
  assertPrivateRegularFile(artifactPath);
  assertPrivateRegularFile(manifestPath);
  return { directory, artifactPath, manifestPath };
}

export function assertDurableRecoveryReady(durable) {
  if (!Buffer.isBuffer(durable?.archiveBytes)
    || !Buffer.isBuffer(durable?.manifestGzipBytes)
    || !Buffer.isBuffer(durable?.manifestBytes)) {
    fail("execute requires both durable recovery copies");
  }
  return true;
}

function pruneArgs(row, mode, recoveryDir = null, approvedBatchId = null, automatic = false) {
  const args = [
    "--target", "stage",
    "--object-path", row.object_path,
    "--confirm-sha", row.compressed_sha256,
  ];
  if (mode === "register-proof") args.push("--register-proof");
  if (mode === "execute") args.push("--execute", "--recovery-dir", recoveryDir);
  if (approvedBatchId != null) args.push("--approved-batch-id", String(approvedBatchId));
  if (automatic) args.push("--automatic");
  return args;
}

async function runPruneStep({
  row,
  mode,
  env,
  cwd,
  sql,
  pruneStore,
  storageTarget,
  downloadArchive = null,
  recoveryDir = null,
  approvedBatchId = null,
  automatic = false,
  verifyBucket = null,
  storageDeps = {},
}) {
  const deps = {
    ...storageDeps,
    sql,
    pruneStore,
    storageTarget,
    emit: false,
  };
  if (downloadArchive) deps.downloadArchive = downloadArchive;
  if (verifyBucket) deps.verifyBucket = verifyBucket;
  const pruneRunner = storageDeps.pruneArchive || pruneArchive;
  return pruneRunner({
    argv: pruneArgs(row, mode, mode === "execute" ? recoveryDir : null, approvedBatchId, automatic),
    env,
    cwd,
    deps,
  });
}

async function verifyCompletedCycle({ row, identity, env, tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps = {} }) {
  const durable = await inspectDurableRecovery(storageTarget, row, storageDeps);
  assertResumeRecoveryState(row, durable);
  if (!durable) fail("completed Stage automation cycle has no durable recovery copies");
  const dry = await runPruneStep({
    row,
    mode: "dry-run",
    env,
    cwd: tempRoot,
    sql,
    pruneStore,
    storageTarget,
    verifyBucket,
    storageDeps,
    downloadArchive: async () => ({ bytes: durable.archiveBytes, downloadMs: 0 }),
  });
  if (dry.state !== "already_pruned") fail(`completed Stage automation cycle did not revalidate as already_pruned: ${dry.state}`);
  assertRecoveryManifestMatches(
    durable.manifest,
    buildRecoveryManifest(row, identity, dry.evidence, { target: "stage" }),
  );
  return { durable, dry };
}

async function refreshPolicyRow(pruneStore, objectPath, sourcePolicyId = STAGE_AUTOMATION_POLICY_ID) {
  const row = await pruneStore.getManifest(objectPath);
  if (!row || row.source_policy_id !== sourcePolicyId) fail("Stage automation manifest policy mismatch");
  return row;
}

async function runAutomaticDryRunWithRetry({
  row,
  identity,
  env,
  cwd,
  sql,
  lockSession,
  pruneStore,
  storageTarget,
  verifyBucket,
  storageDeps = {},
  onProgress = null,
}) {
  const dryRunSqlstates = [];
  let attemptRow = row;
  for (let attempt = 1; attempt <= BOT_ONLY_AUTOMATIC_MAX_DRY_RUN_ATTEMPTS; attempt += 1) {
    const observability = automaticDryRunObservability({
      attempts: attempt,
      retryCount: attempt - 1,
      sqlstates: dryRunSqlstates,
    });
    try {
      // Every retry starts from a fresh lock check and manifest read.  The
      // prune step itself then performs its complete archive/evidence
      // verification and opens a new SERIALIZABLE DB transaction.
      await assertAdvisoryLock(sql, lockSession);
      attemptRow = await refreshPolicyRow(pruneStore, row.object_path, BOT_ONLY_RETENTION_POLICY_ID);
      if (typeof onProgress === "function") onProgress({ row: attemptRow, dry: null, ...observability });
      const batchId = text(attemptRow.batch_id);
      assertBotOnlyExecuteBatch(attemptRow, batchId, identity);
      const dry = await runPruneStep({
        row: attemptRow,
        mode: "dry-run",
        env,
        cwd,
        sql,
        pruneStore,
        storageTarget,
        verifyBucket,
        storageDeps,
      });
      await assertAdvisoryLock(sql, lockSession);
      const verifiedRow = dry?.row || attemptRow;
      assertBotOnlyExecuteBatch(verifiedRow, batchId, identity);
      assertAutomaticBotOnlyDryRunArchive(verifiedRow, dry, batchId);
      assertAutomaticBotOnlyProofEvidence(verifiedRow, dry?.evidence, batchId);
      return {
        row: verifiedRow,
        dry,
        ...observability,
      };
    } catch (error) {
      const sqlstate = sqlStateOf(error);
      if (sqlstate) dryRunSqlstates.push(sqlstate);
      const failedObservability = automaticDryRunObservability({
        attempts: attempt,
        retryCount: attempt - 1,
        sqlstates: dryRunSqlstates,
      });
      if (typeof onProgress === "function") {
        onProgress({ row: attemptRow, dry: null, ...failedObservability });
      }
      if (!AUTOMATIC_DRY_RUN_RETRYABLE_SQLSTATES.has(sqlstate)
        || attempt === BOT_ONLY_AUTOMATIC_MAX_DRY_RUN_ATTEMPTS) {
        throw error;
      }
    }
  }
  fail("automatic bot-only dry-run retry budget was exhausted");
}

async function refreshRow(pruneStore, objectPath) {
  return refreshPolicyRow(pruneStore, objectPath, STAGE_AUTOMATION_POLICY_ID);
}

export async function executeVerifiedCycle({
  row,
  identity,
  durable,
  env,
  tempRoot,
  sql,
  pruneStore,
  storageTarget,
  approvedBatchId = null,
  automatic = false,
  verifyBucket,
  storageDeps = {},
  lockSession = null,
  onExecuteProgress = null,
  waitForExecuteRetry = null,
}) {
  assertDurableRecoveryReady(durable);
  const recoveryDir = path.join(tempRoot, "recovery");
  restoreLocalRecovery(recoveryDir, durable);
  const executeStorageDeps = automatic
    ? {
      ...storageDeps,
      beforeExecuteRetry: async ({ row: retryRow }) => {
        if (!lockSession) fail("automatic cleanup retry advisory lock session is unavailable");
        // Re-run the complete read-only preflight through the same bounded
        // retry policy as the initial automatic dry-run.  Each attempt checks
        // the lock, refreshes the manifest, validates the archive/evidence,
        // and opens a fresh SERIALIZABLE DB transaction.  It never exports,
        // registers proof, or writes Storage.  These attempts intentionally
        // remain separate from execute retry observability.
        const refreshedDryRun = await runAutomaticDryRunWithRetry({
          row: retryRow || row,
          identity,
          env,
          cwd: tempRoot,
          sql,
          lockSession,
          pruneStore,
          storageTarget,
          verifyBucket,
          storageDeps,
        });
        let refreshedRow = refreshedDryRun.row;
        const refreshedDry = refreshedDryRun.dry;
        const batchId = text(refreshedRow.batch_id);
        assertBotOnlyExecuteBatch(refreshedRow, batchId, identity);
        if (refreshedDry.state !== "ready" && refreshedDry.state !== "already_cleaned") {
          fail(`automatic bot-only batch ${batchId} retry preflight did not become ready: ${refreshedDry.state}`);
        }
        const refreshedEvidence = refreshedDry.evidence;
        assertBotOnlyExecuteBatch(refreshedRow, batchId, identity);
        assertAutomaticBotOnlyDryRunArchive(refreshedRow, refreshedDry, batchId);
        assertAutomaticBotOnlyProofEvidence(refreshedRow, refreshedEvidence, batchId);
        await assertAdvisoryLock(sql, lockSession);
        const lifecycle = assertBotOnlyExecuteBatch(refreshedRow, batchId, identity);
        if (lifecycle.receiptCount === 0 && lifecycle.cleanupCount === 0
          && refreshedRow.bot_only_table_exists !== true) {
          fail(`automatic bot-only batch ${batchId} has no live TABLE for a cleanup retry`);
        }
        if (lifecycle.receiptCount === 5 && lifecycle.cleanupCount === 3
          && refreshedRow.bot_only_table_exists === true
          && refreshedRow.bot_only_retention_complete_at == null) {
          fail(`automatic bot-only batch ${batchId} has an incomplete TABLE lifecycle marker after cleanup retry`);
        }
        const inspectRecovery = storageDeps.inspectDurableRecovery || inspectDurableRecovery;
        if (typeof verifyBucket === "function") await verifyBucket(storageTarget);
        const refreshedDurable = await inspectRecovery(storageTarget, refreshedRow, storageDeps);
        assertResumeRecoveryState(refreshedRow, refreshedDurable);
        assertAutomaticBotOnlyDurableRecovery({
          row: refreshedRow,
          identity,
          evidence: refreshedEvidence,
          durable: refreshedDurable,
        });
        if (!Buffer.isBuffer(refreshedDurable.archiveBytes)
          || !refreshedDurable.archiveBytes.equals(durable.archiveBytes)) {
          fail(`automatic bot-only batch ${batchId} recovery archive changed between cleanup attempts`);
        }

        await assertAdvisoryLock(sql, lockSession);
        if (lifecycle.receiptCount === 5 && lifecycle.cleanupCount === 3) {
          return {
            state: "already_cleaned",
            row: refreshedRow,
            evidence: refreshedEvidence,
            durable: refreshedDurable,
          };
        }
        if (lifecycle.receiptCount !== 0 || lifecycle.cleanupCount !== 0) {
          fail(`automatic bot-only batch ${batchId} has an unexpected partial lifecycle after cleanup retry`);
        }
        return { row: refreshedRow, evidence: refreshedEvidence, durable: refreshedDurable };
      },
      ...(onExecuteProgress ? { onExecuteProgress } : {}),
      ...(waitForExecuteRetry ? { waitForExecuteRetry } : {}),
    }
    : storageDeps;
  const result = await runPruneStep({
    row,
    mode: "execute",
    env,
    cwd: tempRoot,
    sql,
    pruneStore,
    storageTarget,
    verifyBucket,
    recoveryDir,
    approvedBatchId,
    automatic,
    downloadArchive: async () => ({ bytes: durable.archiveBytes, downloadMs: 0 }),
    storageDeps: executeStorageDeps,
  });
  if (result.state !== "pruned" && result.state !== "already_pruned" && result.state !== "cleaned" && result.state !== "already_cleaned") {
    fail(`unexpected prune state: ${result.state}`);
  }
  return result;
}

async function executeApprovedBotOnlyCanary({
  approvedBatchId,
  approvedBatchConfirmation,
  identity,
  env,
  tempRoot,
  sql,
  pruneStore,
  storageTarget,
  verifyBucket,
  storageDeps = {},
  assertLock,
}) {
  // Execute mode never enumerates own batches and never invokes the exporter.
  // The dispatch-selected ID is the only possible input to this path.
  const exactRow = await loadExactBatch(sql, approvedBatchId);
  assertBotOnlyExecuteBatch(exactRow, approvedBatchId, identity);
  let row = await refreshPolicyRow(pruneStore, exactRow.object_path, BOT_ONLY_RETENTION_POLICY_ID);
  assertBotOnlyExecuteBatch(row, approvedBatchId, identity);
  assertBotOnlyActiveManifestMatch(exactRow, row, approvedBatchId);
  await assertLock();

  // The dry-run is read-only: it validates the primary object and immutable
  // proof/receipt evidence without registering proof or deleting anything.
  await verifyBucket(storageTarget);
  const dry = await runPruneStep({
    row,
    mode: "dry-run",
    env,
    cwd: tempRoot,
    sql,
    pruneStore,
    storageTarget,
    verifyBucket,
    storageDeps,
  });
  if (dry.state !== "ready" && dry.state !== "already_cleaned") {
    fail(`exact bot-only Stage dry-run did not become ready: ${dry.state}`);
  }
  await assertLock();

  row = await refreshPolicyRow(pruneStore, exactRow.object_path, BOT_ONLY_RETENTION_POLICY_ID);
  assertBotOnlyExecuteBatch(row, approvedBatchId, identity);
  const durable = await (storageDeps.inspectDurableRecovery || inspectDurableRecovery)(storageTarget, row, storageDeps);
  assertResumeRecoveryState(row, durable);
  assertDurableRecoveryReady(durable);
  assertRecoveryManifestMatches(
    durable.manifest,
    buildRecoveryManifest(row, identity, dry.evidence, { target: "stage" }),
  );

  if (dry.state === "already_cleaned") {
    if (cleanupReceiptFieldCount(row) !== 3) {
      fail(`exact bot-only batch ${approvedBatchId} did not verify a complete cleanup receipt`);
    }
    return { row, dry, durable, executed: null };
  }

  const state = assertBotOnlyExecuteBatch(row, approvedBatchId, identity);
  if (state.cleanupCount !== 0 || state.receiptCount !== 0) {
    fail(`exact bot-only batch ${approvedBatchId} has an unexpected partial lifecycle state`);
  }

  if (!state.hasExactGo) {
    const authorize = pruneStore.authorizeBotOnlyBatch;
    if (typeof authorize !== "function") fail("owner-only bot-only batch authorization adapter is unavailable");
    await assertLock();
    const authorization = await authorize.call(pruneStore, approvedBatchId, approvedBatchConfirmation);
    if (!authorization
      || text(authorization.state) !== "authorized"
      || text(authorization.batch_id) !== String(approvedBatchId)) {
      fail(`owner-only authorization did not persist exact bot-only batch ${approvedBatchId}`);
    }
    await assertLock();
    row = await refreshPolicyRow(pruneStore, exactRow.object_path, BOT_ONLY_RETENTION_POLICY_ID);
    const authorized = assertBotOnlyExecuteBatch(row, approvedBatchId, identity);
    if (!authorized.hasExactGo) {
      fail(`exact bot-only batch ${approvedBatchId} authorization did not persist destructive_go_at and destructive_go_batch_id`);
    }
  }

  if (text(row.destructive_go_batch_id) !== String(approvedBatchId) || !text(row.destructive_go_at)) {
    fail(`exact bot-only batch ${approvedBatchId} is missing its persisted destructive GO`);
  }
  await assertLock();
  const executeCycle = storageDeps.executeVerifiedCycle || executeVerifiedCycle;
  const executed = await executeCycle({
    row,
    identity,
    durable,
    env,
    tempRoot,
    sql,
    pruneStore,
    storageTarget,
    approvedBatchId,
    verifyBucket,
    storageDeps,
  });
  await assertLock();
  row = await refreshPolicyRow(pruneStore, exactRow.object_path, BOT_ONLY_RETENTION_POLICY_ID);
  assertBotOnlyExecuteBatch(row, approvedBatchId, identity);
  return { row, dry, durable, executed };
}

async function resumeOwnCycle({ row, identity, env, tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps = {} }) {
  const durableBefore = await inspectDurableRecovery(storageTarget, row, storageDeps);
  assertResumeRecoveryState(row, durableBefore);
  if (!row.archive_proof_verified_at) {
    await runPruneStep({ row, mode: "register-proof", env, cwd: tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps, downloadArchive: durableBefore ? async () => ({ bytes: durableBefore.archiveBytes, downloadMs: 0 }) : null });
    row = await refreshRow(pruneStore, row.object_path);
  }
  const dry = await runPruneStep({
    row,
    mode: "dry-run",
    env,
    cwd: tempRoot,
    sql,
    pruneStore,
    storageTarget,
    verifyBucket,
    storageDeps,
    downloadArchive: durableBefore ? async () => ({ bytes: durableBefore.archiveBytes, downloadMs: 0 }) : null,
  });
  if (durableBefore) {
    assertRecoveryManifestMatches(
      durableBefore.manifest,
      buildRecoveryManifest(row, identity, dry.evidence, { target: "stage" }),
    );
  }
  if (dry.state === "already_pruned") {
    return executeVerifiedCycle({ row, identity, durable: durableBefore, env, tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps });
  }
  if (dry.state !== "ready") fail(`Stage automation dry-run did not become ready: ${dry.state}`);
  let durable = durableBefore;
  if (!durable) {
    const main = await downloadPrivateArchiveObject(storageTarget, row.object_path, storageDeps);
    durable = await persistDurableRecovery(storageTarget, row, identity, dry.evidence, main.bytes, storageDeps);
  }
  return executeVerifiedCycle({ row, identity, durable, env, tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps });
}

export async function runStageAutomation({ env = process.env, now = new Date(), deps = {} } = {}) {
  let sql = null;
  let lockSession = null;
  let tempRoot = null;
  let ownsSql = false;
  let result = null;
  let deployedCommitSha = null;
  let failed = false;
  let failure = null;

  try {
    const config = validateStageEnvironment(env);
    deployedCommitSha = config.deployedCommitSha;
    const moduleEnv = config.moduleEnv;
    const providedSql = deps.sql;
    if (providedSql) {
      sql = providedSql;
    } else {
      sql = postgres(config.dbUrl, {
        max: 1,
        prepare: false,
        connect_timeout: 10,
        idle_timeout: 0,
      });
      ownsSql = true;
    }
    tempRoot = deps.tempRoot || fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-stage-automation-"));
    ensurePrivateDirectory(tempRoot);
    const storageTarget = deps.storageTarget || resolveStorageTarget("stage", moduleEnv, { singleTarget: true });
    const pruneStore = deps.pruneStore || createPruneStore(sql);
    const verifyBucket = deps.verifyBucket || ((target) => verifyArchiveBucket(target, deps));

    lockSession = await acquireAdvisoryLock(sql);
    if (!lockSession) {
      result = { state: "no-op", reason: "advisory_lock_busy" };
    } else {
      const identity = await assertIdentity(sql);
      await assertAdvisoryLock(sql, lockSession);
      await verifyBucket(storageTarget);
      const ownRows = await loadOwnBatches(sql);
      await assertAdvisoryLock(sql, lockSession);
      const ownCycle = findOwnCycle(ownRows);
      if (ownCycle.active) {
        const resumed = await resumeOwnCycle({ row: await refreshRow(pruneStore, ownCycle.active.object_path), identity, env: moduleEnv, tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps: deps });
        await assertAdvisoryLock(sql, lockSession);
        result = {
          state: resumed.state,
          mode: "resume",
          transactions: resumed.evidence.transactionCount,
          entries: resumed.evidence.entryCount,
          txTypes: resumed.evidence.txTypes,
          amounts: { credits: resumed.evidence.credits, debits: resumed.evidence.debits, net: resumed.evidence.net },
          compressedSha256: ownCycle.active.compressed_sha256,
        };
      } else {
        if (ownCycle.latestCompleted) {
          await verifyCompletedCycle({
            row: await refreshRow(pruneStore, ownCycle.latestCompleted.object_path),
            identity,
            env: moduleEnv,
            tempRoot,
            sql,
            pruneStore,
            storageTarget,
            verifyBucket,
            storageDeps: deps,
          });
          await assertAdvisoryLock(sql, lockSession);
        }

        const artifactPath = path.join(tempRoot, "archive.jsonl.gz");
        const manifestPath = path.join(tempRoot, "archive.manifest.json");
        const exportArchive = deps.exportArchive || runExport;
        const exported = await exportArchive({
          argv: [
            "--target", "stage",
            "--cutoff-days", String(STAGE_RETENTION_DAYS),
            "--batch-size", String(STAGE_MAX_BATCH_SIZE),
            "--output", artifactPath,
            "--manifest", manifestPath,
          ],
          env: moduleEnv,
          cwd: tempRoot,
          now,
          deps: {
            sql,
            selector: "prunable",
            sourcePolicyId: STAGE_AUTOMATION_POLICY_ID,
            targetOptions: { singleTarget: true },
            noCandidateIfEmpty: true,
            emit: false,
          },
        });
        await assertAdvisoryLock(sql, lockSession);
        if (exported.noCandidate) {
          result = { state: "no-op", reason: "no_eligible_candidate" };
        } else {
          const ensureBucket = deps.ensureArchiveBucket || ensureArchiveBucket;
          await ensureBucket(storageTarget, deps);
          await assertAdvisoryLock(sql, lockSession);
          const store = deps.storeArchive || storeArchive;
          const stored = await store({
            argv: ["--target", "stage", "--artifact", artifactPath, "--manifest", manifestPath],
            env: moduleEnv,
            cwd: tempRoot,
            deps: { ...deps, sql, storageTarget, targetOptions: { singleTarget: true }, emit: false },
          });
          let row = await refreshRow(pruneStore, stored.objectPath);
          await assertAdvisoryLock(sql, lockSession);
          await runPruneStep({ row, mode: "register-proof", env: moduleEnv, cwd: tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps: deps });
          row = await refreshRow(pruneStore, row.object_path);
          await assertAdvisoryLock(sql, lockSession);
          const dry = await runPruneStep({ row, mode: "dry-run", env: moduleEnv, cwd: tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps: deps });
          if (dry.state !== "ready") fail(`Stage automation dry-run did not become ready: ${dry.state}`);
          await assertAdvisoryLock(sql, lockSession);
          const downloadMain = deps.downloadPrivateArchive || downloadPrivateArchiveObject;
          const main = await downloadMain(storageTarget, row.object_path, deps);
          const durable = await persistDurableRecovery(storageTarget, row, identity, dry.evidence, main.bytes, deps);
          await assertAdvisoryLock(sql, lockSession);
          const executed = await executeVerifiedCycle({ row, identity, durable, env: moduleEnv, tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps: deps });
          await assertAdvisoryLock(sql, lockSession);
          result = {
            state: executed.state,
            mode: "new",
            transactions: executed.evidence.transactionCount,
            entries: executed.evidence.entryCount,
            txTypes: executed.evidence.txTypes,
            amounts: { credits: executed.evidence.credits, debits: executed.evidence.debits, net: executed.evidence.net },
            rawBytes: exported.bytes?.raw || null,
            compressedBytes: row.compressed_bytes,
            compressedSha256: row.compressed_sha256,
            recoveryArchiveSha256: durable.recoveryArchive.sha256,
            recoveryManifestSha256: durable.recoveryManifest.sha256,
            proof: executed.state === "pruned" ? "verified" : null,
            receipt: executed.state,
            mappings: executed.evidence.transactionCount,
          };
        }
      }
    }
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    if (lockSession && sql) {
      try {
        await releaseAdvisoryLock(sql);
      } catch {
        // Closing an owned client below releases the session-scoped lock; preserve the cycle result.
      }
    }
    if (sql && ownsSql) {
      try {
        await sql.end({ timeout: 5 });
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
  }
  if (failed) {
    emitAggregateError(failure, { deployedCommitSha });
    throw failure;
  }
  if (result && deployedCommitSha) result = { ...result, deployedCommitSha };
  writeAggregateSummary(result);
  return result;
}

// Issue #890 uses the same Stage runner, Storage bucket, proof store, prune
// store, recovery copies, and advisory lock.  Its default is deliberately
// prepare-only: no call reaches the destructive DB operator unless the caller
// explicitly supplies one exact approved batch id and opts into execution.
export async function runBotOnlyStageAutomation({
  env = process.env,
  now = new Date(),
  deps = {},
  prepareOnly = true,
  approvedBatchId = null,
  approvedBatchConfirmation = null,
  automatic = false,
} = {}) {
  if (automatic) {
    if (prepareOnly !== false) fail("automatic bot-only retention requires destructive execution mode");
    if (approvedBatchId != null) fail("automatic bot-only retention does not accept a per-batch human GO");
    if (approvedBatchConfirmation != null) fail("automatic bot-only retention does not accept a per-batch human confirmation");
    return runAutomaticBotOnlyStageAutomation({ env, now, deps });
  }
  const approvedBatchIdText = approvedBatchId == null ? null : String(approvedBatchId);
  const approvedBatchConfirmationText = approvedBatchConfirmation == null ? null : String(approvedBatchConfirmation);
  if (prepareOnly !== true && (approvedBatchIdText == null || !/^[1-9][0-9]*$/.test(approvedBatchIdText))) {
    fail("bot-only destructive execution requires one exact approved batch id");
  }
  if (prepareOnly !== true && text(env.CHIPS_LEDGER_BOT_ONLY_EXECUTE) !== "1") {
    fail("bot-only destructive execution requires the explicit default-off execution gate");
  }
  if (prepareOnly !== true && approvedBatchConfirmationText !== `GO ${approvedBatchIdText}`) {
    fail("bot-only destructive execution requires the exact GO <batch_id> confirmation");
  }
  if (prepareOnly === true && (approvedBatchId != null || approvedBatchConfirmation != null)) {
    fail("approved bot-only batch id and confirmation are only valid with destructive execution");
  }
  let sql = null;
  let lockSession = null;
  let tempRoot = null;
  let ownsSql = false;
  let result = null;
  let deployedCommitSha = null;
  let failed = false;
  let failure = null;
  try {
    const config = validateStageEnvironment(env, { requireCommitSha: true });
    deployedCommitSha = config.deployedCommitSha;
    const moduleEnv = config.moduleEnv;
    if (deps.sql) sql = deps.sql;
    else {
      sql = postgres(config.dbUrl, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 0 });
      ownsSql = true;
    }
    tempRoot = deps.tempRoot || fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-stage-bot-only-"));
    ensurePrivateDirectory(tempRoot);
    const storageTarget = deps.storageTarget || resolveStorageTarget("stage", moduleEnv, { singleTarget: true });
    const pruneStore = deps.pruneStore || createPruneStore(sql);
    const verifyBucket = deps.verifyBucket || ((target) => verifyArchiveBucket(target, deps));
    const inspectRecovery = deps.inspectDurableRecovery || inspectDurableRecovery;
    const persistRecovery = deps.persistDurableRecovery || persistDurableRecovery;
    lockSession = await acquireAdvisoryLock(sql);
    if (!lockSession) result = { state: "no-op", reason: "advisory_lock_busy", sourcePolicyId: BOT_ONLY_RETENTION_POLICY_ID };
    else {
      const identity = await assertIdentity(sql);
      await assertAdvisoryLock(sql, lockSession);
      if (!prepareOnly) {
        const cycle = await executeApprovedBotOnlyCanary({
          approvedBatchId: approvedBatchIdText,
          approvedBatchConfirmation: approvedBatchConfirmationText,
          identity,
          env: moduleEnv,
          tempRoot,
          sql,
          pruneStore,
          storageTarget,
          verifyBucket,
          storageDeps: deps,
          assertLock: () => assertAdvisoryLock(sql, lockSession),
        });
        result = botOnlyReport({
          row: cycle.row,
          identity,
          dry: cycle.dry,
          durable: cycle.durable,
          state: cycle.executed?.state || "already_cleaned",
          mode: "execute",
          deployedCommitSha,
        });
      } else {
        await verifyBucket(storageTarget);
        const ownRows = await loadOwnBatches(sql, BOT_ONLY_RETENTION_POLICY_ID);
        const activeRows = ownRows.filter((row) => row.status === "pending" || (row.status === "committed" && !row.registry_cleaned_at));
        if (activeRows.length > 1) fail("multiple incomplete bot-only Stage manifests; refusing to choose one");

      const resumePending = async (row) => {
        const artifactPath = path.join(tempRoot, "pending-bot-only.archive.jsonl.gz");
        const manifestPath = path.join(tempRoot, "pending-bot-only.archive.manifest.json");
        const exported = await (deps.exportArchive || runExport)({
          argv: botOnlyExportArgs(row, artifactPath, manifestPath),
          env: moduleEnv,
          cwd: tempRoot,
          now,
          deps: {
            sql,
            selector: "bot-only-7d",
            schemaVersion: BOT_ONLY_EXPORT_SCHEMA_VERSION,
            sourcePolicyId: BOT_ONLY_RETENTION_POLICY_ID,
            targetOptions: { singleTarget: true },
            noCandidateIfEmpty: true,
            emit: false,
          },
        });
        if (exported.noCandidate) fail("pending bot-only Stage manifest cannot be reproduced at its immutable cutoff");
        const stored = await (deps.storeArchive || storeArchive)({
          argv: ["--target", "stage", "--artifact", artifactPath, "--manifest", manifestPath],
          env: moduleEnv,
          cwd: tempRoot,
          deps: { ...deps, sql, storageTarget, targetOptions: { singleTarget: true }, emit: false },
        });
        if (stored.objectPath !== row.object_path) fail("pending bot-only manifest object path differs from the reproduced artifact");
        const refreshed = await refreshPolicyRow(pruneStore, row.object_path, BOT_ONLY_RETENTION_POLICY_ID);
        if (refreshed.status !== "committed") fail("pending bot-only Stage manifest was not committed during retry");
        return refreshed;
      };

      let activeRow = activeRows[0] || null;
      if (activeRow?.status === "pending") {
        activeRow = await resumePending(activeRow);
        await assertAdvisoryLock(sql, lockSession);
      }

      const prepareExisting = async (row) => {
        row = await refreshPolicyRow(pruneStore, row.object_path, BOT_ONLY_RETENTION_POLICY_ID);
        if (!row.archive_proof_verified_at) {
          await runPruneStep({ row, mode: "register-proof", env: moduleEnv, cwd: tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps: deps });
          row = await refreshPolicyRow(pruneStore, row.object_path, BOT_ONLY_RETENTION_POLICY_ID);
        }
        const dry = await runPruneStep({ row, mode: "dry-run", env: moduleEnv, cwd: tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps: deps });
        if (dry.state === "already_cleaned") return { row, dry, durable: null };
        if (dry.state !== "ready") fail(`bot-only Stage dry-run did not become ready: ${dry.state}`);
        const existing = await inspectRecovery(storageTarget, row, deps);
        assertResumeRecoveryState(row, existing);
        let durable = existing;
        if (!durable) {
          const mainArchive = await (deps.downloadPrivateArchive || downloadPrivateArchiveObject)(storageTarget, row.object_path, deps);
          durable = await persistRecovery(
            storageTarget,
            row,
            identity,
            dry.evidence,
            mainArchive.bytes,
            deps,
          );
        }
        return { row, dry, durable, executed: null };
      };

      if (activeRow) {
        const cycle = await prepareExisting(activeRow);
        result = botOnlyReport({
          row: cycle.row,
          identity,
          dry: cycle.dry,
          durable: cycle.durable,
          state: cycle.executed?.state || (cycle.dry.state === "already_cleaned" ? "already_cleaned" : "prepared"),
          mode: "prepare-only",
          deployedCommitSha,
        });
      } else {
        const latestCompleted = ownRows.find((row) => row.status === "committed" && row.registry_cleaned_at);
        if (latestCompleted) {
          const completed = await runPruneStep({
            row: await refreshPolicyRow(pruneStore, latestCompleted.object_path, BOT_ONLY_RETENTION_POLICY_ID),
            mode: "dry-run",
            env: moduleEnv,
            cwd: tempRoot,
            sql,
            pruneStore,
            storageTarget,
            verifyBucket,
            storageDeps: deps,
          });
          if (completed.state !== "already_cleaned") fail(`completed bot-only Stage cycle did not revalidate as already_cleaned: ${completed.state}`);
        }
        const artifactPath = path.join(tempRoot, "archive.jsonl.gz");
        const manifestPath = path.join(tempRoot, "archive.manifest.json");
        const exported = await (deps.exportArchive || runExport)({
          argv: ["--target", "stage", "--cutoff-days", String(BOT_ONLY_RETENTION_DAYS), "--batch-size", String(STAGE_MAX_BATCH_SIZE), "--output", artifactPath, "--manifest", manifestPath],
          env: moduleEnv,
          cwd: tempRoot,
          now,
          deps: {
            sql,
            selector: "bot-only-7d",
            schemaVersion: BOT_ONLY_EXPORT_SCHEMA_VERSION,
            sourcePolicyId: BOT_ONLY_RETENTION_POLICY_ID,
            targetOptions: { singleTarget: true },
            noCandidateIfEmpty: true,
            emit: false,
          },
        });
        if (exported.noCandidate) {
          result = botOnlyNoCandidateReport({ exported, identity, deployedCommitSha });
        }
        else {
          await (deps.ensureArchiveBucket || ensureArchiveBucket)(storageTarget, deps);
          const stored = await (deps.storeArchive || storeArchive)({
            argv: ["--target", "stage", "--artifact", artifactPath, "--manifest", manifestPath],
            env: moduleEnv,
            cwd: tempRoot,
            deps: { ...deps, sql, storageTarget, targetOptions: { singleTarget: true }, emit: false },
          });
          let row = await refreshPolicyRow(pruneStore, stored.objectPath, BOT_ONLY_RETENTION_POLICY_ID);
          await runPruneStep({ row, mode: "register-proof", env: moduleEnv, cwd: tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps: deps });
          row = await refreshPolicyRow(pruneStore, row.object_path, BOT_ONLY_RETENTION_POLICY_ID);
          const dry = await runPruneStep({ row, mode: "dry-run", env: moduleEnv, cwd: tempRoot, sql, pruneStore, storageTarget, verifyBucket, storageDeps: deps });
          if (dry.state !== "ready") fail(`new bot-only Stage dry-run did not become ready: ${dry.state}`);
          const main = await (deps.downloadPrivateArchive || downloadPrivateArchiveObject)(storageTarget, row.object_path, deps);
          const durable = await persistDurableRecovery(storageTarget, row, identity, dry.evidence, main.bytes, deps);
          result = botOnlyReport({
            row,
            identity,
            dry,
            durable,
            state: "prepared",
            mode: "prepare-only",
            deployedCommitSha,
          });
        }
      }
      }
    }
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    if (lockSession && sql) {
      try { await releaseAdvisoryLock(sql); } catch { /* owned session close releases it */ }
    }
    if (sql && ownsSql) {
      try { await sql.end({ timeout: 5 }); } catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  }
  if (failed) {
    emitAggregateError(failure, { deployedCommitSha });
    throw failure;
  }
  if (result && deployedCommitSha) result = { ...result, deployedCommitSha };
  writeAggregateSummary(result);
  return result;
}

function cleanupReceiptFieldCount(row) {
  return [
    row.registry_cleaned_at,
    row.registry_cleaned_key_count,
    row.registry_cleaned_keys_sha256,
  ].filter((value) => value != null).length;
}

function assertAutomaticBotOnlyRows(rows) {
  const active = rows.filter((row) => row.status === "pending"
    || receiptFieldCount(row) !== 5
    || cleanupReceiptFieldCount(row) !== 3);
  if (active.length > 1) fail("multiple incomplete automatic bot-only Stage manifests; refusing to choose one");
  for (const row of rows) {
    if (row.status !== "pending" && row.status !== "committed") {
      fail("automatic bot-only Stage manifest has an invalid state");
    }
    if (row.source_policy_id !== BOT_ONLY_RETENTION_POLICY_ID) {
      fail("automatic bot-only Stage manifest policy mismatch");
    }
    const proofCount = proofFieldCount(row);
    if (proofCount !== 0 && proofCount !== 3) {
      fail("automatic bot-only Stage proof is partial");
    }
    const receiptCount = receiptFieldCount(row);
    if (receiptCount !== 0 && receiptCount !== 5) {
      fail("automatic bot-only Stage prune receipt is partial");
    }
    const cleanupCount = cleanupReceiptFieldCount(row);
    if (cleanupCount !== 0 && cleanupCount !== 3) {
      fail("automatic bot-only Stage cleanup receipt is partial");
    }
  }
  return active[0] || null;
}

async function verifyAutomaticCompletedBatch({
  row,
  identity,
  env,
  cwd,
  sql,
  lockSession,
  pruneStore,
  storageTarget,
  verifyBucket,
  storageDeps,
  inspectRecovery,
  onProgress = null,
}) {
  const dryRunResult = await runAutomaticDryRunWithRetry({
    row,
    identity,
    env,
    cwd,
    sql,
    lockSession,
    pruneStore,
    storageTarget,
    verifyBucket,
    storageDeps,
    onProgress,
  });
  const refreshed = dryRunResult.row;
  const dry = dryRunResult.dry;
  if (typeof onProgress === "function") {
    onProgress({
      row: refreshed,
      dry,
      dryRunAttempts: dryRunResult.dryRunAttempts,
      dryRunRetryCount: dryRunResult.dryRunRetryCount,
      dryRunSqlstates: dryRunResult.dryRunSqlstates,
    });
  }
  if (dry.state !== "already_cleaned") {
    fail(`automatic bot-only completed batch ${row.batch_id} did not revalidate as already_cleaned: ${dry.state}`);
  }
  assertBotOnlyExecuteBatch(refreshed, text(refreshed.batch_id), identity);
  assertAutomaticBotOnlyDryRunArchive(refreshed, dry, text(refreshed.batch_id));
  assertAutomaticBotOnlyProofEvidence(refreshed, dry.evidence, text(refreshed.batch_id));
  if (refreshed.bot_only_table_exists === true && refreshed.bot_only_retention_complete_at == null) {
    fail(`automatic bot-only completed batch ${refreshed.batch_id} has an empty TABLE lifecycle marker`);
  }
  const durable = await inspectRecovery(storageTarget, refreshed, storageDeps);
  assertResumeRecoveryState(refreshed, durable);
  assertAutomaticBotOnlyDurableRecovery({
    row: refreshed,
    identity,
    evidence: dry.evidence,
    durable,
  });
  return {
    row: refreshed,
    dry,
    durable,
    dryRunAttempts: dryRunResult.dryRunAttempts,
    dryRunRetryCount: dryRunResult.dryRunRetryCount,
    dryRunSqlstates: dryRunResult.dryRunSqlstates,
  };
}

async function assertAutomaticStageFence(sql) {
  const activeRows = await sql.unsafe("select public.chips_table_fence_is_active() as active;");
  const controlRows = await sql.unsafe(
    "select enforcement_active from public.chips_table_fence_control where control_id is true;",
  );
  const active = activeRows[0]?.active === true || activeRows[0]?.active === "t";
  const enforcement = controlRows.length === 1
    && (controlRows[0]?.enforcement_active === true || controlRows[0]?.enforcement_active === "t");
  if (!active || !enforcement) fail("automatic bot-only Stage retention requires an active fence and enforcement");
}

export async function runAutomaticBotOnlyStageAutomation({
  env = process.env,
  now = new Date(),
  deps = {},
} = {}) {
  if (text(env.CHIPS_LEDGER_BOT_ONLY_AUTOMATIC) !== "1") {
    fail("automatic bot-only retention requires the explicit default-off scheduler gate");
  }
  let sql = null;
  let lockSession = null;
  let tempRoot = null;
  let ownsSql = false;
  let result = null;
  let deployedCommitSha = null;
  let failed = false;
  let failure = null;
  const processed = [];
  let currentBatch = null;
  const automaticErrorContext = {
    sourcePolicyId: BOT_ONLY_RETENTION_POLICY_ID,
    mode: "automatic",
    phase: "automatic.preflight",
    batchId: null,
    objectPath: null,
  };
  const markAutomaticPhase = (phase, row = null) => {
    automaticErrorContext.phase = phase;
    automaticErrorContext.batchId = row?.batch_id ?? null;
    automaticErrorContext.objectPath = row?.object_path ?? null;
  };
  try {
    const config = validateStageEnvironment(env, { requireCommitSha: true });
    deployedCommitSha = config.deployedCommitSha;
    const moduleEnv = config.moduleEnv;
    if (deps.sql) sql = deps.sql;
    else {
      sql = postgres(config.dbUrl, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 0 });
      ownsSql = true;
    }
    tempRoot = deps.tempRoot || fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-stage-bot-only-automatic-"));
    ensurePrivateDirectory(tempRoot);
    const storageTarget = deps.storageTarget || resolveStorageTarget("stage", moduleEnv, { singleTarget: true });
    const pruneStore = deps.pruneStore || createPruneStore(sql);
    const verifyBucket = deps.verifyBucket || ((target) => verifyArchiveBucket(target, deps));
    const inspectRecovery = deps.inspectDurableRecovery || inspectDurableRecovery;
    const persistRecovery = deps.persistDurableRecovery || persistDurableRecovery;
    const executeCycle = deps.executeVerifiedCycle || executeVerifiedCycle;
    markAutomaticPhase("automatic.lock");
    lockSession = await acquireAdvisoryLock(sql);
    if (!lockSession) {
      result = {
        state: "no-op",
        mode: "automatic",
        sourcePolicyId: BOT_ONLY_RETENTION_POLICY_ID,
        boundedBatchLimit: BOT_ONLY_AUTOMATIC_MAX_BATCHES_PER_RUN,
        processed: [],
        stopReason: "advisory_lock_busy",
        reason: "advisory_lock_busy",
      };
    } else {
      markAutomaticPhase("automatic.identity");
      const identity = await assertIdentity(sql);
      await assertAdvisoryLock(sql, lockSession);
      markAutomaticPhase("automatic.fence");
      await assertAutomaticStageFence(sql);
      markAutomaticPhase("automatic.storage-preflight");
      await verifyBucket(storageTarget);
      markAutomaticPhase("automatic.policy");
      const policyRows = await sql.unsafe(
        "select policy_id, enabled, activated_at::text as activated_at, canary_batch_id::text as canary_batch_id from public.chips_stage_bot_only_retention_policy where policy_id = $1;",
        [BOT_ONLY_RETENTION_POLICY_ID],
      );
      if (policyRows.length !== 1) fail("automatic bot-only Stage policy row is missing or duplicated");
      if (!(policyRows[0].enabled === true || policyRows[0].enabled === "t")) {
        result = {
          state: "no-op",
          mode: "automatic",
          sourcePolicyId: BOT_ONLY_RETENTION_POLICY_ID,
          projectRef: STAGE_PROJECT_REF,
          stageSystemIdentifier: identity,
          policy: {
            enabled: false,
            canaryBatchId: policyRows[0].canary_batch_id,
            activatedAt: policyRows[0].activated_at,
          },
          boundedBatchLimit: BOT_ONLY_AUTOMATIC_MAX_BATCHES_PER_RUN,
          processed: [],
          stopReason: "automatic_policy_disabled",
          reason: "automatic_policy_disabled",
        };
      } else {
        let stopReason = null;
        const completedRecoveryChecked = new Set();
        for (let index = 0; index < BOT_ONLY_AUTOMATIC_MAX_BATCHES_PER_RUN; index += 1) {
          markAutomaticPhase("automatic.select");
          await assertAdvisoryLock(sql, lockSession);
          const ownRows = await loadOwnBatches(sql, BOT_ONLY_RETENTION_POLICY_ID);
          // The query is newest-first and only the latest completed manifest can
          // affect selection. Keep this recovery revalidation bounded; older
          // completed manifests are immutable and never selected for execution.
          const completedRow = ownRows.find((candidate) => candidate.status === "committed"
            && receiptFieldCount(candidate) === 5
            && cleanupReceiptFieldCount(candidate) === 3);
          if (completedRow && !completedRecoveryChecked.has(completedRow.object_path)) {
            markAutomaticPhase("automatic.completed-recovery", completedRow);
            await verifyAutomaticCompletedBatch({
              row: completedRow,
              identity,
              env: moduleEnv,
              cwd: tempRoot,
              sql,
              lockSession,
              pruneStore,
              storageTarget,
              verifyBucket,
              storageDeps: deps,
              inspectRecovery,
              onProgress: ({ row: progressRow, dry: progressDry, ...dryRunProgress }) => {
                currentBatch = automaticBatchProgress({
                  row: progressRow,
                  identity,
                  dry: progressDry,
                  durable: null,
                  state: progressDry?.state === "already_cleaned" ? "already_cleaned" : "in_progress",
                  deployedCommitSha,
                  archiveStorageModified: false,
                  recoveryStorageModified: false,
                  ...dryRunProgress,
                });
              },
            });
            completedRecoveryChecked.add(completedRow.object_path);
            currentBatch = null;
          }
          let activeRow = assertAutomaticBotOnlyRows(ownRows);
          if (activeRow) markAutomaticPhase("automatic.manifest", activeRow);

          let activeArchiveStorageModified = false;
          if (activeRow) {
            currentBatch = automaticBatchProgress({
              row: activeRow,
              identity,
              dry: null,
              durable: null,
              state: "in_progress",
              deployedCommitSha,
              archiveStorageModified: false,
              recoveryStorageModified: false,
            });
          }

          const resumePending = async (row) => {
            markAutomaticPhase("automatic.resume", row);
            const artifactPath = path.join(tempRoot, "pending-bot-only-" + String(index) + ".archive.jsonl.gz");
            const manifestPath = path.join(tempRoot, "pending-bot-only-" + String(index) + ".archive.manifest.json");
            const exported = await (deps.exportArchive || runExport)({
              argv: botOnlyExportArgs(row, artifactPath, manifestPath),
              env: moduleEnv,
              cwd: tempRoot,
              now,
              deps: {
                sql,
                selector: "bot-only-7d",
                schemaVersion: BOT_ONLY_EXPORT_SCHEMA_VERSION,
                sourcePolicyId: BOT_ONLY_RETENTION_POLICY_ID,
                targetOptions: { singleTarget: true },
                noCandidateIfEmpty: true,
                emit: false,
              },
            });
            if (exported.noCandidate) fail("incomplete automatic bot-only manifest cannot be reproduced");
            const stored = await (deps.storeArchive || storeArchive)({
              argv: ["--target", "stage", "--artifact", artifactPath, "--manifest", manifestPath],
              env: moduleEnv,
              cwd: tempRoot,
              deps: { ...deps, sql, storageTarget, targetOptions: { singleTarget: true }, emit: false },
            });
            if (stored.objectPath !== row.object_path) fail("incomplete automatic bot-only manifest changed its object path");
            activeArchiveStorageModified = stored.object?.uploaded === true;
            currentBatch = automaticBatchProgress({
              row: stored.manifest || row,
              identity,
              dry: null,
              durable: null,
              state: "in_progress",
              deployedCommitSha,
              archiveStorageModified: activeArchiveStorageModified,
              recoveryStorageModified: false,
            });
            const refreshed = await refreshPolicyRow(pruneStore, row.object_path, BOT_ONLY_RETENTION_POLICY_ID);
            if (refreshed.status !== "committed") fail("incomplete automatic bot-only manifest was not committed");
            return refreshed;
          };

          if (activeRow?.status === "pending") {
            activeRow = await resumePending(activeRow);
            await assertAdvisoryLock(sql, lockSession);
          }

          const prepareAndExecute = async (row, { archiveStorageModified = false } = {}) => {
            markAutomaticPhase("automatic.manifest", row);
            currentBatch = automaticBatchProgress({
              row,
              identity,
              dry: null,
              durable: null,
              state: "in_progress",
              deployedCommitSha,
              archiveStorageModified,
              recoveryStorageModified: false,
            });
            row = await refreshPolicyRow(pruneStore, row.object_path, BOT_ONLY_RETENTION_POLICY_ID);
            markAutomaticPhase("automatic.manifest", row);
            currentBatch = automaticBatchProgress({
              row,
              identity,
              dry: null,
              durable: null,
              state: "in_progress",
              deployedCommitSha,
              archiveStorageModified,
              recoveryStorageModified: false,
            });
            const proofWasPresentBeforeResume = Boolean(row.archive_proof_verified_at);
            if (!row.archive_proof_verified_at) {
              markAutomaticPhase("automatic.recovery", row);
              const recoveryBeforeProof = await inspectRecovery(storageTarget, row, deps);
              if (recoveryBeforeProof === undefined) {
                fail(`automatic bot-only batch ${row.batch_id} recovery absence was not confirmed by Storage`);
              }
              if (recoveryBeforeProof !== null) assertResumeRecoveryState(row, recoveryBeforeProof);
              markAutomaticPhase("automatic.proof", row);
              await runPruneStep({
                row,
                mode: "register-proof",
                env: moduleEnv,
                cwd: tempRoot,
                sql,
                pruneStore,
                storageTarget,
                verifyBucket,
                storageDeps: deps,
              });
              row = await refreshPolicyRow(pruneStore, row.object_path, BOT_ONLY_RETENTION_POLICY_ID);
              markAutomaticPhase("automatic.manifest", row);
              currentBatch = automaticBatchProgress({
                row,
                identity,
                dry: null,
                durable: null,
                state: "in_progress",
                deployedCommitSha,
                archiveStorageModified,
                recoveryStorageModified: false,
              });
            }
            markAutomaticPhase("automatic.dry-run", row);
            const dryRunResult = await runAutomaticDryRunWithRetry({
              row,
              identity,
              env: moduleEnv,
              cwd: tempRoot,
              sql,
              lockSession,
              pruneStore,
              storageTarget,
              verifyBucket,
              storageDeps: deps,
              onProgress: ({ row: progressRow, dry: progressDry, ...dryRunProgress }) => {
                currentBatch = automaticBatchProgress({
                  row: progressRow,
                  identity,
                  dry: progressDry,
                  durable: null,
                  state: progressDry?.state === "already_cleaned" ? "already_cleaned" : "in_progress",
                  deployedCommitSha,
                  archiveStorageModified,
                  recoveryStorageModified: false,
                  ...dryRunProgress,
                });
              },
            });
            row = dryRunResult.row;
            const dry = dryRunResult.dry;
            currentBatch = automaticBatchProgress({
              row,
              identity,
              dry,
              durable: null,
              state: dry.state === "already_cleaned" ? "already_cleaned" : "in_progress",
              deployedCommitSha,
              archiveStorageModified,
              recoveryStorageModified: false,
              dryRunAttempts: dryRunResult.dryRunAttempts,
              dryRunRetryCount: dryRunResult.dryRunRetryCount,
              dryRunSqlstates: dryRunResult.dryRunSqlstates,
            });
            const batchId = text(row.batch_id);
            const lifecycle = assertBotOnlyExecuteBatch(row, batchId, identity);
            if (dry.state === "already_cleaned") {
              if (lifecycle.cleanupCount !== 3) fail("automatic bot-only manifest has a partial completed receipt");
              markAutomaticPhase("automatic.recovery", row);
              const durable = await inspectRecovery(storageTarget, row, deps);
              assertResumeRecoveryState(row, durable);
              assertAutomaticBotOnlyDurableRecovery({
                row,
                identity,
                evidence: dry.evidence,
                durable,
              });
              currentBatch = automaticBatchProgress({
                row,
                identity,
                dry,
                durable,
                state: "already_cleaned",
                deployedCommitSha,
                archiveStorageModified,
                recoveryStorageModified: false,
                dryRunAttempts: dryRunResult.dryRunAttempts,
                dryRunRetryCount: dryRunResult.dryRunRetryCount,
                dryRunSqlstates: dryRunResult.dryRunSqlstates,
              });
              return {
                row,
                dry,
                durable,
                executed: { state: "already_cleaned" },
                retry: null,
                dryRunAttempts: dryRunResult.dryRunAttempts,
                dryRunRetryCount: dryRunResult.dryRunRetryCount,
                dryRunSqlstates: dryRunResult.dryRunSqlstates,
                archiveStorageModified,
                storageMutation: automaticStorageMutation({
                  archiveStorageModified,
                  recoveryStorageModified: false,
                }),
              };
            }
            if (dry.state !== "ready") fail("automatic bot-only Stage dry-run did not become ready: " + dry.state);
            markAutomaticPhase("automatic.recovery", row);
            const existing = await inspectRecovery(storageTarget, row, deps);
            if (existing === undefined) {
              fail(`automatic bot-only batch ${batchId} recovery state was not confirmed by Storage`);
            }
            if (!proofWasPresentBeforeResume && existing !== null) {
              fail(`automatic bot-only batch ${batchId} recovery appeared without an immutable proof`);
            }
            let durable = existing;
            if (existing === null) {
              assertAutomaticBotOnlyRecoveryReconstructionState({
                row,
                identity,
                evidence: dry.evidence,
                dryRunState: dry.state,
                durable: existing,
              });
              const mainArchive = await (deps.downloadPrivateArchive || downloadPrivateArchiveObject)(storageTarget, row.object_path, deps);
              assertAutomaticBotOnlyMainArchive(row, mainArchive, dry, batchId);
              try {
                durable = await persistRecovery(storageTarget, row, identity, dry.evidence, mainArchive.bytes, deps);
              } catch (error) {
                const recoveryStorageModified = Object.hasOwn(error?.storageMutation || {}, "recoveryStorageModified")
                  ? error.storageMutation.recoveryStorageModified
                  : null;
                currentBatch = automaticBatchProgress({
                  row,
                  identity,
                  dry,
                  durable: null,
                  state: "in_progress",
                  deployedCommitSha,
                  archiveStorageModified,
                  recoveryStorageModified,
                  dryRunAttempts: dryRunResult.dryRunAttempts,
                  dryRunRetryCount: dryRunResult.dryRunRetryCount,
                  dryRunSqlstates: dryRunResult.dryRunSqlstates,
                });
                throw error;
              }
              assertAutomaticBotOnlyDurableRecovery({
                row,
                identity,
                evidence: dry.evidence,
                durable,
              });
            } else {
              assertResumeRecoveryState(row, existing);
              assertAutomaticBotOnlyDurableRecovery({
                row,
                identity,
                evidence: dry.evidence,
                durable: existing,
              });
            }
            currentBatch = automaticBatchProgress({
              row,
              identity,
              dry,
              durable,
              state: "in_progress",
              deployedCommitSha,
              archiveStorageModified,
              dryRunAttempts: dryRunResult.dryRunAttempts,
              dryRunRetryCount: dryRunResult.dryRunRetryCount,
              dryRunSqlstates: dryRunResult.dryRunSqlstates,
            });
            let executeProgress = automaticExecuteObservability();
            const onExecuteProgress = ({
              row: progressRow,
              executeAttempts = 0,
              executeRetryCount = 0,
              executeSqlstates = [],
            } = {}) => {
              executeProgress = automaticExecuteObservability({
                attempts: executeAttempts,
                retryCount: executeRetryCount,
                sqlstates: executeSqlstates,
              });
              currentBatch = automaticBatchProgress({
                row: progressRow || row,
                identity,
                dry,
                durable,
                state: "in_progress",
                deployedCommitSha,
                archiveStorageModified,
                recoveryStorageModified: currentBatch?.recoveryStorageModified
                  ?? automaticRecoveryStorageModified(durable),
                dryRunAttempts: dryRunResult.dryRunAttempts,
                dryRunRetryCount: dryRunResult.dryRunRetryCount,
                dryRunSqlstates: dryRunResult.dryRunSqlstates,
                executeAttempts: executeProgress.executeAttempts,
                executeRetryCount: executeProgress.executeRetryCount,
                executeSqlstates: executeProgress.executeSqlstates,
              });
            };
            await assertAdvisoryLock(sql, lockSession);
            markAutomaticPhase("automatic.execute", row);
            const executed = await executeCycle({
              row,
              identity,
              durable,
              env: moduleEnv,
              tempRoot,
              sql,
              pruneStore,
              storageTarget,
              automatic: true,
              verifyBucket,
              storageDeps: deps,
              lockSession,
              onExecuteProgress,
              waitForExecuteRetry: deps.waitForExecuteRetry || null,
            });
            executeProgress = automaticExecuteObservability({
              attempts: executed.executeAttempts ?? executeProgress.executeAttempts,
              retryCount: executed.executeRetryCount ?? executeProgress.executeRetryCount,
              sqlstates: executed.executeSqlstates ?? executeProgress.executeSqlstates,
            });
            currentBatch = automaticBatchProgress({
              row,
              identity,
              dry,
              durable,
              state: executed.state,
              deployedCommitSha,
              archiveStorageModified,
              dryRunAttempts: dryRunResult.dryRunAttempts,
              dryRunRetryCount: dryRunResult.dryRunRetryCount,
              dryRunSqlstates: dryRunResult.dryRunSqlstates,
              executeState: executed.state,
              executeConfirmed: executed.state === "cleaned",
              dbMutationConfirmed: executed.state === "cleaned",
              executeAttempts: executeProgress.executeAttempts,
              executeRetryCount: executeProgress.executeRetryCount,
              executeSqlstates: executeProgress.executeSqlstates,
            });
            markAutomaticPhase("automatic.execute-refresh", row);
            const refreshed = await refreshPolicyRow(pruneStore, row.object_path, BOT_ONLY_RETENTION_POLICY_ID);
            currentBatch = automaticBatchProgress({
              row: refreshed,
              identity,
              dry,
              durable,
              state: executed.state,
              deployedCommitSha,
              archiveStorageModified,
              dryRunAttempts: dryRunResult.dryRunAttempts,
              dryRunRetryCount: dryRunResult.dryRunRetryCount,
              dryRunSqlstates: dryRunResult.dryRunSqlstates,
              executeState: executed.state,
              executeConfirmed: currentBatch.executeConfirmed,
              dbMutationConfirmed: currentBatch.dbMutationConfirmed,
              executeAttempts: executeProgress.executeAttempts,
              executeRetryCount: executeProgress.executeRetryCount,
              executeSqlstates: executeProgress.executeSqlstates,
            });
            markAutomaticPhase("automatic.execute-retry", refreshed);
            const retry = await executeCycle({
              row: refreshed,
              identity,
              durable,
              env: moduleEnv,
              tempRoot,
              sql,
              pruneStore,
              storageTarget,
              automatic: true,
              verifyBucket,
              storageDeps: deps,
              lockSession,
              waitForExecuteRetry: deps.waitForExecuteRetry || null,
            });
            currentBatch = {
              ...currentBatch,
              retryState: retry.state,
            };
            if (retry.state !== "already_cleaned") {
              fail("automatic bot-only retry did not return already_cleaned");
            }
            const finalRow = await refreshPolicyRow(pruneStore, row.object_path, BOT_ONLY_RETENTION_POLICY_ID);
            currentBatch = automaticBatchProgress({
              row: finalRow,
              identity,
              dry,
              durable,
              state: executed.state,
              deployedCommitSha,
              archiveStorageModified,
              dryRunAttempts: dryRunResult.dryRunAttempts,
              dryRunRetryCount: dryRunResult.dryRunRetryCount,
              dryRunSqlstates: dryRunResult.dryRunSqlstates,
              executeState: executed.state,
              executeConfirmed: currentBatch.executeConfirmed,
              dbMutationConfirmed: currentBatch.dbMutationConfirmed,
              executeAttempts: executeProgress.executeAttempts,
              executeRetryCount: executeProgress.executeRetryCount,
              executeSqlstates: executeProgress.executeSqlstates,
              retryState: retry.state,
            });
            return {
              row: finalRow,
              dry,
              durable,
              executed,
              retry,
              dryRunAttempts: dryRunResult.dryRunAttempts,
              dryRunRetryCount: dryRunResult.dryRunRetryCount,
              dryRunSqlstates: dryRunResult.dryRunSqlstates,
              executeAttempts: executeProgress.executeAttempts,
              executeRetryCount: executeProgress.executeRetryCount,
              executeSqlstates: executeProgress.executeSqlstates,
              archiveStorageModified,
              storageMutation: automaticStorageMutation({
                archiveStorageModified,
                recoveryStorageModified: currentBatch.recoveryStorageModified,
              }),
            };
          };

          if (activeRow) {
            const cycle = await prepareAndExecute(activeRow, {
              archiveStorageModified: activeArchiveStorageModified,
            });
            processed.push({
              ...botOnlyReport({
                row: cycle.row,
                identity,
                dry: cycle.dry,
                durable: cycle.durable,
                state: cycle.executed.state,
                mode: "automatic",
                deployedCommitSha,
              }),
              ...automaticDryRunObservability({
                attempts: cycle.dryRunAttempts,
                retryCount: cycle.dryRunRetryCount,
                sqlstates: cycle.dryRunSqlstates,
              }),
              ...automaticExecuteObservability({
                attempts: cycle.executeAttempts,
                retryCount: cycle.executeRetryCount,
                sqlstates: cycle.executeSqlstates,
              }),
              ...(cycle.storageMutation || automaticStorageMutation({
                archiveStorageModified: cycle.archiveStorageModified,
                recoveryStorageModified: automaticRecoveryStorageModified(cycle.durable),
              })),
              executeState: cycle.executed?.state || null,
              executeConfirmed: cycle.executed?.state === "cleaned",
              dbMutationConfirmed: cycle.executed?.state === "cleaned",
              retryState: cycle.retry?.state || null,
              retry: cycle.retry?.state || null,
            });
            currentBatch = null;
            continue;
          }

          const artifactPath = path.join(tempRoot, "automatic-" + String(index) + ".archive.jsonl.gz");
          const manifestPath = path.join(tempRoot, "automatic-" + String(index) + ".archive.manifest.json");
          markAutomaticPhase("automatic.export");
          const exported = await (deps.exportArchive || runExport)({
            argv: [
              "--target", "stage", "--cutoff-days", String(BOT_ONLY_RETENTION_DAYS),
              "--batch-size", String(STAGE_MAX_BATCH_SIZE), "--output", artifactPath, "--manifest", manifestPath,
            ],
            env: moduleEnv,
            cwd: tempRoot,
            now,
            deps: {
              sql,
              selector: "bot-only-7d",
              schemaVersion: BOT_ONLY_EXPORT_SCHEMA_VERSION,
              sourcePolicyId: BOT_ONLY_RETENTION_POLICY_ID,
              targetOptions: { singleTarget: true },
              noCandidateIfEmpty: true,
              emit: false,
            },
          });
          if (exported.noCandidate) {
            if ((exported.blockingAnomalies || []).length) {
              fail("automatic bot-only selector reported a blocking anomaly");
            }
            stopReason = "no_eligible_bot_only_table";
            break;
          }
          markAutomaticPhase("automatic.storage");
          await (deps.ensureArchiveBucket || ensureArchiveBucket)(storageTarget, deps);
          const stored = await (deps.storeArchive || storeArchive)({
            argv: ["--target", "stage", "--artifact", artifactPath, "--manifest", manifestPath],
            env: moduleEnv,
            cwd: tempRoot,
            deps: { ...deps, sql, storageTarget, targetOptions: { singleTarget: true }, emit: false },
          });
          const archiveStorageModified = stored.object?.uploaded === true;
          if (stored.manifest) {
            currentBatch = automaticBatchProgress({
              row: stored.manifest,
              identity,
              dry: null,
              durable: null,
              state: "in_progress",
              deployedCommitSha,
              archiveStorageModified,
              recoveryStorageModified: false,
            });
          }
          const row = await refreshPolicyRow(pruneStore, stored.objectPath, BOT_ONLY_RETENTION_POLICY_ID);
          markAutomaticPhase("automatic.manifest", row);
          const cycle = await prepareAndExecute(row, { archiveStorageModified });
          processed.push({
            ...botOnlyReport({
              row: cycle.row,
              identity,
              dry: cycle.dry,
              durable: cycle.durable,
              state: cycle.executed.state,
              mode: "automatic",
              deployedCommitSha,
            }),
            ...automaticDryRunObservability({
              attempts: cycle.dryRunAttempts,
              retryCount: cycle.dryRunRetryCount,
              sqlstates: cycle.dryRunSqlstates,
            }),
            ...automaticExecuteObservability({
              attempts: cycle.executeAttempts,
              retryCount: cycle.executeRetryCount,
              sqlstates: cycle.executeSqlstates,
            }),
            ...(cycle.storageMutation || automaticStorageMutation({
              archiveStorageModified: cycle.archiveStorageModified,
              recoveryStorageModified: automaticRecoveryStorageModified(cycle.durable),
            })),
            executeState: cycle.executed?.state || null,
            executeConfirmed: cycle.executed?.state === "cleaned",
            dbMutationConfirmed: cycle.executed?.state === "cleaned",
            retryState: cycle.retry?.state || null,
            retry: cycle.retry?.state || null,
          });
          currentBatch = null;
        }
        if (stopReason === null) stopReason = "batch_limit_reached";
        result = {
          state: "completed",
          mode: "automatic",
          sourcePolicyId: BOT_ONLY_RETENTION_POLICY_ID,
          projectRef: STAGE_PROJECT_REF,
          stageSystemIdentifier: identity,
          policy: {
            enabled: true,
            canaryBatchId: policyRows[0].canary_batch_id,
            activatedAt: policyRows[0].activated_at,
          },
          boundedBatchLimit: BOT_ONLY_AUTOMATIC_MAX_BATCHES_PER_RUN,
          processed,
          stopReason,
        };
      }
    }
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    if (lockSession && sql) {
      try { await releaseAdvisoryLock(sql); } catch { /* owned session close releases it */ }
    }
    if (sql && ownsSql) {
      try { await sql.end({ timeout: 5 }); } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
  }
  if (failed) {
    emitAggregateError(failure, { deployedCommitSha, ...automaticErrorContext, processed, currentBatch });
    throw failure;
  }
  if (result && deployedCommitSha) result = { ...result, deployedCommitSha };
  writeAggregateSummary(result);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    runStageAutomation().catch(() => {
      process.exitCode = 1;
    });
  } else if (argv[0] === "--policy" && argv[1] === "bot-only-7d" && argv[2] === "--repair-recovery") {
    if (argv.length !== 5 || argv[3] !== "--batch-id" || argv[4] !== "15") {
      throw new Error("--repair-recovery is pinned to --batch-id 15");
    }
    runBotOnlyRecoveryRepair({ batchId: "15" }).catch(() => {
      process.exitCode = 1;
    });
  } else if (argv[0] === "--policy" && argv[1] === "bot-only-7d") {
    let prepareOnly = true;
    let prepareOnlyRequested = false;
    let executeRequested = false;
    let automaticRequested = false;
    let approvedBatchId = null;
    let approvedBatchConfirmation = null;
    for (let index = 2; index < argv.length; index += 1) {
      if (argv[index] === "--prepare-only") {
        if (prepareOnlyRequested || executeRequested || automaticRequested) throw new Error("--prepare-only, --execute and --automatic are mutually exclusive or duplicated");
        prepareOnlyRequested = true;
        prepareOnly = true;
      } else if (argv[index] === "--execute") {
        if (executeRequested || prepareOnlyRequested || automaticRequested) throw new Error("--prepare-only, --execute and --automatic are mutually exclusive or duplicated");
        executeRequested = true;
        prepareOnly = false;
      } else if (argv[index] === "--automatic") {
        if (automaticRequested || prepareOnlyRequested || executeRequested || approvedBatchId !== null || approvedBatchConfirmation !== null) {
          throw new Error("--automatic is a standalone automatic execution mode");
        }
        automaticRequested = true;
        prepareOnly = false;
      } else if (argv[index] === "--approved-batch-id") {
        const value = argv[index + 1];
        if (!value || value.startsWith("--")) throw new Error("--approved-batch-id requires a value");
        if (approvedBatchId !== null || automaticRequested) throw new Error("--approved-batch-id is not valid for automatic execution");
        approvedBatchId = value;
        index += 1;
      } else if (argv[index] === "--approved-batch-confirmation") {
        const value = argv[index + 1];
        if (!value || value.startsWith("--")) throw new Error("--approved-batch-confirmation requires a value");
        if (approvedBatchConfirmation !== null || automaticRequested) {
          throw new Error("--approved-batch-confirmation is not valid for automatic execution");
        }
        approvedBatchConfirmation = value;
        index += 1;
      } else {
        throw new Error(`unknown Stage bot-only option: ${argv[index]}`);
      }
    }
    runBotOnlyStageAutomation({ prepareOnly, approvedBatchId, approvedBatchConfirmation, automatic: automaticRequested }).catch(() => {
      process.exitCode = 1;
    });
  } else {
    process.stderr.write("usage: node scripts/ops/chips-ledger-stage-automation.mjs [--policy bot-only-7d [--prepare-only|--repair-recovery --batch-id 15|--execute --approved-batch-id <id> --approved-batch-confirmation 'GO <id>'|--automatic]]\n");
    process.exitCode = 1;
  }
}
