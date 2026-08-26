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
  resolveStorageTarget,
  storeArchive,
  uploadOrVerifyPrivateObject,
  verifyArchiveBucket,
} from "./chips-ledger-archive-store.mjs";
import {
  buildRecoveryManifest,
  createPruneStore,
  pruneArchive,
} from "./chips-ledger-archive-prune.mjs";
import {
  ensurePrivateDirectory,
  writeExclusiveFiles,
} from "./_shared/chips-ledger-archive-files.mjs";

export const STAGE_PROJECT_REF = "krydukthwdvccggbyjfw";
export const STAGE_SYSTEM_IDENTIFIER = "7656985631720456337";
export const STAGE_MAX_BATCH_SIZE = 5000;
export const STAGE_RETENTION_DAYS = 30;
// Schema-v2 keeps one complete table per archive batch so the lifecycle
// receipt can prove and mark that table atomically.  The scheduler therefore
// needs a bounded multi-batch run: 25 batches every 15 minutes gives a
// theoretical 2,400-table/day ceiling, comfortably above the observed Stage
// bot-table creation rate while keeping a single job within its timeout.
export const BOT_ONLY_AUTOMATIC_MAX_BATCHES_PER_RUN = 25;
export const STAGE_AUTOMATION_LOCK_KEY = `chips-ledger-stage-automation-v1:${STAGE_PROJECT_REF}`;

const SHA256_RE = /^[0-9a-f]{64}$/;
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/i;
const PRIVATE_FILE_MODE = 0o600;

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

function aggregatePayload(result) {
  const base = {
    event: "chips_ledger_stage_automation",
    target: "stage",
    project_ref: STAGE_PROJECT_REF,
    source_policy_id: result.sourcePolicyId || STAGE_AUTOMATION_POLICY_ID,
    state: result.state,
    deployed_commit_sha: result.deployedCommitSha || null,
  };
  if (result.state === "error") {
    return {
      ...base,
      ...(result.phase ? { phase: result.phase } : {}),
      ...(result.sqlstate ? { sqlstate: result.sqlstate } : {}),
      reason: redactedError(result.reason),
    };
  }
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
    proof: result.proof || null,
    receipt: result.receipt || null,
    mappings: result.mappings ?? null,
    blocking_anomalies: result.blockingAnomalies || null,
    destructive_go_batch_id: result.destructiveGoBatchId ?? null,
    destructive_go_at: result.destructiveGoAt || null,
    reason: result.reason || null,
  };
}

function writeAggregateSummary(result) {
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
      sqlstate: context.sqlstate || error?.chipsLedgerQuerySqlState || null,
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
    proof: row?.archive_proof_verified_at ? "verified" : null,
    receipt: row?.registry_cleaned_at ? "cleaned" : state === "prepared" ? "prepare-only" : null,
    destructiveGoBatchId: row?.destructive_go_batch_id || null,
    destructiveGoAt: row?.destructive_go_at || null,
    mappings: evidence?.transactionCount ?? null,
    blockingAnomalies,
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

export async function persistDurableRecovery(storageTarget, row, identity, evidence, archiveBytes, deps = {}) {
  if (sha256(archiveBytes) !== row.compressed_sha256) fail("verified archive checksum differs before recovery copy");
  const manifest = buildRecoveryManifest(row, identity, evidence, { target: "stage" });
  const manifestBytes = Buffer.from(`${stringifyJson(manifest)}\n`, "utf8");
  const manifestGzipBytes = gzipSync(manifestBytes, { level: 9, mtime: 0 });
  const recoveryArchive = await uploadOrVerifyPrivateObject({
    storageTarget,
    objectPath: buildRecoveryArchiveObjectPath(row.compressed_sha256),
    bytes: archiveBytes,
    deps,
  });
  const recoveryManifest = await uploadOrVerifyPrivateObject({
    storageTarget,
    objectPath: buildRecoveryManifestObjectPath(row.compressed_sha256),
    bytes: manifestGzipBytes,
    deps,
  });
  const verified = await inspectDurableRecovery(storageTarget, row, deps);
  if (!verified) fail("durable recovery copies disappeared after upload");
  assertRecoveryManifestMatches(verified.manifest, manifest);
  return {
    ...verified,
    recoveryArchive,
    recoveryManifest,
  };
}

function restoreLocalRecovery(directory, durable) {
  ensurePrivateDirectory(directory);
  const base = `chips-ledger-${sha256(durable.archiveBytes)}`;
  const artifactPath = path.join(directory, `${base}.jsonl.gz`);
  const manifestPath = path.join(directory, `${base}.recovery.json`);
  writeExclusiveFiles([
    { path: artifactPath, data: durable.archiveBytes },
    { path: manifestPath, data: durable.manifestBytes },
  ]);
  return { directory, artifactPath, manifestPath };
}

export function assertDurableRecoveryReady(durable) {
  if (!durable?.archiveBytes || !durable?.manifestGzipBytes || !durable?.manifestBytes) {
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

async function refreshRow(pruneStore, objectPath) {
  return refreshPolicyRow(pruneStore, objectPath, STAGE_AUTOMATION_POLICY_ID);
}

async function executeVerifiedCycle({
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
}) {
  assertDurableRecoveryReady(durable);
  const recoveryDir = path.join(tempRoot, "recovery");
  restoreLocalRecovery(recoveryDir, durable);
  const result = await runPruneStep({
    row,
    mode: "execute",
    env,
    cwd: tempRoot,
    sql,
    pruneStore,
    storageTarget,
    verifyBucket,
    storageDeps,
    recoveryDir,
    approvedBatchId,
    automatic,
    downloadArchive: async () => ({ bytes: durable.archiveBytes, downloadMs: 0 }),
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
    lockSession = await acquireAdvisoryLock(sql);
    if (!lockSession) {
      result = {
        state: "no-op",
        mode: "automatic",
        sourcePolicyId: BOT_ONLY_RETENTION_POLICY_ID,
        reason: "advisory_lock_busy",
      };
    } else {
      const identity = await assertIdentity(sql);
      await assertAdvisoryLock(sql, lockSession);
      await assertAutomaticStageFence(sql);
      await verifyBucket(storageTarget);
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
          reason: "automatic_policy_disabled",
        };
      } else {
        const processed = [];
        let stopReason = null;
        for (let index = 0; index < BOT_ONLY_AUTOMATIC_MAX_BATCHES_PER_RUN; index += 1) {
          await assertAdvisoryLock(sql, lockSession);
          const ownRows = await loadOwnBatches(sql, BOT_ONLY_RETENTION_POLICY_ID);
          let activeRow = assertAutomaticBotOnlyRows(ownRows);

          const resumePending = async (row) => {
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
            const refreshed = await refreshPolicyRow(pruneStore, row.object_path, BOT_ONLY_RETENTION_POLICY_ID);
            if (refreshed.status !== "committed") fail("incomplete automatic bot-only manifest was not committed");
            return refreshed;
          };

          if (activeRow?.status === "pending") {
            activeRow = await resumePending(activeRow);
            await assertAdvisoryLock(sql, lockSession);
          }

          const prepareAndExecute = async (row) => {
            row = await refreshPolicyRow(pruneStore, row.object_path, BOT_ONLY_RETENTION_POLICY_ID);
            const hadProofBeforeResume = Boolean(row.archive_proof_verified_at);
            if (!row.archive_proof_verified_at) {
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
            }
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
            if (dry.state === "already_cleaned") {
              if (cleanupReceiptFieldCount(row) !== 3) fail("automatic bot-only manifest has a partial completed receipt");
              return { row, dry, durable: null, executed: { state: "already_cleaned" }, retry: null };
            }
            if (dry.state !== "ready") fail("automatic bot-only Stage dry-run did not become ready: " + dry.state);
            const existing = await inspectRecovery(storageTarget, row, deps);
            if (hadProofBeforeResume || existing) assertResumeRecoveryState(row, existing);
            let durable = existing;
            if (!durable) {
              const mainArchive = await (deps.downloadPrivateArchive || downloadPrivateArchiveObject)(storageTarget, row.object_path, deps);
              durable = await persistRecovery(storageTarget, row, identity, dry.evidence, mainArchive.bytes, deps);
            }
            await assertAdvisoryLock(sql, lockSession);
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
            });
            const refreshed = await refreshPolicyRow(pruneStore, row.object_path, BOT_ONLY_RETENTION_POLICY_ID);
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
            });
            if (retry.state !== "already_cleaned") {
              fail("automatic bot-only retry did not return already_cleaned");
            }
            return {
              row: await refreshPolicyRow(pruneStore, row.object_path, BOT_ONLY_RETENTION_POLICY_ID),
              dry,
              durable,
              executed,
              retry,
            };
          };

          if (activeRow) {
            const cycle = await prepareAndExecute(activeRow);
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
              retry: cycle.retry?.state || null,
            });
            continue;
          }

          const artifactPath = path.join(tempRoot, "automatic-" + String(index) + ".archive.jsonl.gz");
          const manifestPath = path.join(tempRoot, "automatic-" + String(index) + ".archive.manifest.json");
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
          await (deps.ensureArchiveBucket || ensureArchiveBucket)(storageTarget, deps);
          const stored = await (deps.storeArchive || storeArchive)({
            argv: ["--target", "stage", "--artifact", artifactPath, "--manifest", manifestPath],
            env: moduleEnv,
            cwd: tempRoot,
            deps: { ...deps, sql, storageTarget, targetOptions: { singleTarget: true }, emit: false },
          });
          const row = await refreshPolicyRow(pruneStore, stored.objectPath, BOT_ONLY_RETENTION_POLICY_ID);
          const cycle = await prepareAndExecute(row);
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
            retry: cycle.retry?.state || null,
          });
        }
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
    emitAggregateError(failure, { deployedCommitSha });
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
    process.stderr.write("usage: node scripts/ops/chips-ledger-stage-automation.mjs [--policy bot-only-7d [--prepare-only|--execute --approved-batch-id <id> --approved-batch-confirmation 'GO <id>'|--automatic]]\n");
    process.exitCode = 1;
  }
}
