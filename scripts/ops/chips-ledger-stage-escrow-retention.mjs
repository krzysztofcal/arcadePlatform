import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import postgres from "postgres";

import {
  BOT_ONLY_RETENTION_POLICY_ID,
  LEGACY_STAGE_ALLOWLIST_POLICY_ID,
  stringifyJson,
} from "./chips-ledger-archive-export.mjs";
import {
  ARCHIVE_MAX_BYTES,
  ARCHIVE_MIME_TYPE,
  downloadPrivateArchiveObject,
  readPrivateObjectIfExists,
  resolveStorageTarget,
  uploadOrVerifyPrivateObject,
  verifyArchiveBytes,
  verifyArchiveBucket,
} from "./chips-ledger-archive-store.mjs";
import {
  buildPruneEvidence,
  exporterManifestFromDatabase,
  parseManifestRow,
  sqlStateOf,
} from "./chips-ledger-archive-prune.mjs";
import {
  STAGE_AUTOMATION_LOCK_KEY,
  STAGE_PROJECT_REF,
  STAGE_SYSTEM_IDENTIFIER,
  assertDurableRecoveryForEvidence,
  inspectDurableRecoveryState,
  initializeStageConnection,
  validateStageEnvironment,
} from "./chips-ledger-stage-automation.mjs";
import {
  buildLegacyBatchManifest,
  buildLegacyPlan,
  loadFrozenLegacyAllowlist,
} from "./chips-ledger-legacy-stage-allowlist.mjs";

export const ESCROW_ACCOUNT_RETENTION_POLICY_ID = "stage-ledger-escrow-account-retention-v1";
export const ACCOUNT_RECOVERY_SCHEMA_VERSION = 1;
export const ACCOUNT_RECOVERY_MIME_TYPE = ARCHIVE_MIME_TYPE;
export const ACCOUNT_RECOVERY_MAX_BYTES = ARCHIVE_MAX_BYTES;
export const MAX_RETIREMENT_BATCHES_PER_RUN = 10;
export const MAX_RETIREMENT_ACCOUNTS_PER_RUN = 20;
export const MAX_RETIREMENT_EXECUTE_ATTEMPTS = 3;
export const RETRYABLE_RETIREMENT_SQLSTATES = Object.freeze(["40001", "55P03"]);
export const RETIREMENT_PHASES = Object.freeze({
  AUDIT: "audit",
  PREPARE: "prepare",
  RECOVERY: "recovery",
  EXECUTE: "execute",
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const RECOVERY_PATH_RE = /^account-recovery\/v1\/sha256\/([0-9a-f]{64})\.json\.gz$/;
const ACCOUNT_KEY_RE = /^POKER_TABLE:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const RETIREMENT_RECEIPT_FIELDS = Object.freeze([
  "account_retirement_at",
  "account_retirement_account_count",
  "account_retirement_account_ids_sha256",
  "account_retirement_recovery_object_path",
  "account_retirement_recovery_object_sha256",
  "account_retirement_snapshot_sha256",
]);
const ALLOWED_POLICIES = new Set([BOT_ONLY_RETENTION_POLICY_ID, LEGACY_STAGE_ALLOWLIST_POLICY_ID]);
const RETRYABLE_SQLSTATE_SET = new Set(RETRYABLE_RETIREMENT_SQLSTATES);
const RETENTION_CONTROL_PHASES = Object.freeze({
  AUTHORIZE_CANARY: "canary-authorization",
  ACTIVATE: "activation",
});
const ACTIVATION_CONFIRMATION_RE = /^ACTIVATE stage-ledger-escrow-account-retention-v1 CANARY [1-9][0-9]* [0-9a-f]{64}$/;

function text(value) {
  return value == null ? "" : String(value).trim();
}

function nullableText(value) {
  return value == null ? null : String(value);
}

function fail(message, code = null) {
  const error = new Error(message);
  if (code) error.code = code;
  throw error;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalJsonBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

export function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalUuid(value, label = "UUID") {
  const normalized = text(value).toLowerCase();
  if (!UUID_RE.test(normalized)) fail(`${label} is not a canonical UUID`);
  return normalized;
}

export function canonicalAccountIds(ids) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10) {
    fail("account ID set must contain between 1 and 10 UUIDs");
  }
  const normalized = ids.map((id) => canonicalUuid(id, "account ID"));
  const sorted = [...new Set(normalized)].sort();
  if (sorted.length !== normalized.length) fail("account ID set contains duplicates");
  if (canonicalJson(sorted) !== canonicalJson(normalized)) fail("account IDs must be sorted");
  return sorted;
}

function canonicalUuidArray(ids, label, { min = 1, max = 10000 } = {}) {
  if (!Array.isArray(ids) || ids.length < min || ids.length > max) {
    fail(`${label} must contain between ${min} and ${max} UUIDs`);
  }
  const normalized = ids.map((id) => canonicalUuid(id, label));
  const sorted = [...new Set(normalized)].sort();
  if (sorted.length !== normalized.length || canonicalJson(sorted) !== canonicalJson(normalized)) {
    fail(`${label} must be sorted and unique`);
  }
  return sorted;
}

function uuidArraySha256(ids, label, options) {
  const sorted = canonicalUuidArray(ids, label, options);
  return sha256Hex(Buffer.from(`${sorted.join("\n")}\n`, "utf8"));
}

export function accountIdsSha256(ids) {
  const sorted = canonicalAccountIds(ids);
  return sha256Hex(Buffer.from(`${sorted.join("\n")}\n`, "utf8"));
}

export function accountTableIdFromSystemKey(systemKey) {
  const match = ACCOUNT_KEY_RE.exec(text(systemKey));
  return match ? match[1].toLowerCase() : null;
}

function countNonNull(row, fields) {
  return fields.reduce((count, field) => count + (row?.[field] == null ? 0 : 1), 0);
}

export function retirementReceiptState(row) {
  const count = countNonNull(row, RETIREMENT_RECEIPT_FIELDS);
  if (count === 0) return "empty";
  if (count === RETIREMENT_RECEIPT_FIELDS.length) return "complete";
  return "partial";
}

export function archiveBatchTableIds(row, proof = null) {
  if (row?.source_policy_id === BOT_ONLY_RETENTION_POLICY_ID) {
    return row.bot_only_table_id ? [canonicalUuid(row.bot_only_table_id, "bot-only table ID")] : [];
  }
  if (row?.source_policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID) {
    const ids = proof?.batch_table_ids || row.legacy_batch_table_ids || [];
    return Array.isArray(ids) ? canonicalUuidArray(ids, "legacy table ID", { min: 1, max: 10 }) : [];
  }
  return [];
}

export function archiveBatchEvidenceState(row, proof = null, { expectedSystemIdentifier = STAGE_SYSTEM_IDENTIFIER, run = undefined } = {}) {
  if (!row || row.status !== "committed" || text(row.project_ref) !== STAGE_PROJECT_REF || Number(row.format_version) !== 2
    || !SHA256_RE.test(text(row.compressed_sha256))
    || !SHA256_RE.test(text(row.raw_sha256))
    || text(row.object_path) !== `v1/sha256/${text(row.compressed_sha256)}.jsonl.gz`) {
    return { complete: false, reason: "incomplete_archive" };
  }
  if (!ALLOWED_POLICIES.has(row.source_policy_id)) return { complete: false, reason: "unsupported_policy" };
  if (countNonNull(row, ["archived_transaction_ids_sha256", "archived_entry_ids_sha256", "archive_proof_verified_at"]) !== 3) {
    return { complete: false, reason: "incomplete_archive_proof" };
  }
  if (countNonNull(row, ["pruned_at", "pruned_transaction_count", "pruned_entry_count", "pruned_transaction_ids_sha256", "pruned_entry_ids_sha256"]) !== 5) {
    return { complete: false, reason: "incomplete_prune_receipt" };
  }
  if (Number(row.pruned_transaction_count) !== Number(row.transaction_count)
    || Number(row.pruned_entry_count) !== Number(row.entry_count)
    || text(row.pruned_transaction_ids_sha256) !== text(row.archived_transaction_ids_sha256)
    || text(row.pruned_entry_ids_sha256) !== text(row.archived_entry_ids_sha256)) {
    return { complete: false, reason: "mismatched_prune_receipt" };
  }
  if (countNonNull(row, ["registry_cleaned_at", "registry_cleaned_key_count", "registry_cleaned_keys_sha256"]) !== 3) {
    return { complete: false, reason: "incomplete_registry_receipt" };
  }
  if (!SHA256_RE.test(text(row.registry_cleaned_keys_sha256))
    || Number(row.registry_cleaned_key_count) !== Number(row.transaction_count)) {
    return { complete: false, reason: "mismatched_registry_receipt" };
  }
  if (row.destructive_go_at == null || text(row.destructive_go_batch_id) !== text(row.batch_id)) {
    return { complete: false, reason: "incomplete_destructive_go" };
  }
  if (row.source_policy_id === BOT_ONLY_RETENTION_POLICY_ID) {
    if (countNonNull(row, [
      "bot_only_table_id", "bot_only_table_count", "bot_only_newest_created_at",
      "bot_only_registry_keys_sha256", "bot_only_out_of_scope_keys_sha256",
      "bot_only_identity_count", "bot_only_eligible_count",
    ]) !== 7 || Number(row.bot_only_table_count) !== 1
      || Number(row.bot_only_identity_count) !== Number(row.transaction_count)
      || Number(row.bot_only_eligible_count) !== Number(row.transaction_count)
      || text(row.registry_cleaned_keys_sha256) !== text(row.bot_only_registry_keys_sha256)
      || (row.bot_only_table_exists !== false && row.bot_only_retention_complete_at == null)) {
      return { complete: false, reason: "incomplete_bot_only_proof" };
    }
  } else {
    let masterTableIds;
    let batchTableIds;
    let rowMasterTableIds;
    try {
      masterTableIds = canonicalUuidArray(proof?.master_table_ids, "legacy master table IDs", { min: 974, max: 974 });
      batchTableIds = canonicalUuidArray(proof?.batch_table_ids, "legacy batch table IDs", { min: 1, max: 10 });
      rowMasterTableIds = canonicalUuidArray(row.legacy_master_table_ids, "committed legacy master table IDs", { min: 974, max: 974 });
    } catch {
      return { complete: false, reason: "incomplete_legacy_proof" };
    }
    if (!proof
      || text(proof.object_path) !== text(row.object_path)
      || text(proof.project_ref) !== STAGE_PROJECT_REF
      || text(proof.source_policy_id) !== LEGACY_STAGE_ALLOWLIST_POLICY_ID
      || text(proof.postgres_system_identifier) !== expectedSystemIdentifier
      || text(row.legacy_stage_system_identifier) !== expectedSystemIdentifier
      || Number(proof.master_table_count) !== 974
      || canonicalJson(masterTableIds) !== canonicalJson(rowMasterTableIds)
      || text(proof.master_table_ids_sha256) !== text(row.legacy_allowlist_sha256)
      || uuidArraySha256(masterTableIds, "legacy master table IDs", { min: 974, max: 974 }) !== text(proof.master_table_ids_sha256)
      || Number(proof.batch_table_count) !== batchTableIds.length
      || proof.batch_table_count < 1
      || proof.batch_table_count > 10
      || text(proof.batch_id) !== text(row.batch_id)
      || text(row.legacy_batch_table_ids_sha256) !== text(proof.batch_table_ids_sha256)
      || uuidArraySha256(batchTableIds, "legacy batch table IDs", { min: 1, max: 10 }) !== text(proof.batch_table_ids_sha256)
      || text(row.legacy_batch_number) !== text(proof.batch_number)
      || text(proof.source_run) !== text(row.legacy_source_run)
      || text(proof.query_sha256) !== text(row.legacy_query_sha256)
      || text(proof.source_run) === ""
      || !SHA256_RE.test(text(proof.query_sha256))
      || (row.legacy_run_id == null) !== (row.legacy_plan_sha256 == null)) {
      return { complete: false, reason: "incomplete_legacy_proof" };
    }
    if (run !== undefined) {
      const isLegacyBatch13 = text(row.batch_id) === "13";
      const runBound = isLegacyBatch13
        ? row.legacy_run_id == null && row.legacy_plan_sha256 == null
        : run
          && text(run.run_id) === text(row.legacy_run_id)
          && text(run.plan_sha256) === text(row.legacy_plan_sha256)
          && text(run.status) === "authorized"
          && text(run.project_ref) === STAGE_PROJECT_REF
          && text(run.source_policy_id) === LEGACY_STAGE_ALLOWLIST_POLICY_ID
          && text(run.stage_system_identifier) === expectedSystemIdentifier;
      if (!runBound) return { complete: false, reason: "incomplete_legacy_run_binding" };
    }
  }
  let tableIds;
  try {
    tableIds = archiveBatchTableIds(row, proof);
  } catch {
    return { complete: false, reason: "invalid_table_set" };
  }
  if (tableIds.length < 1 || tableIds.length > 10) return { complete: false, reason: "invalid_table_set" };
  return { complete: true, reason: null, tableIds };
}

export function classifyEscrowAccount(account, {
  table = null,
  entryCount = 0,
  snapshotCount = 0,
  registryCount = 0,
  batch = null,
  proof = null,
  matchingBatchCount = null,
  expectedSystemIdentifier = STAGE_SYSTEM_IDENTIFIER,
  run = undefined,
} = {}) {
  const tableId = accountTableIdFromSystemKey(account?.system_key);
  if (text(account?.account_type).toUpperCase() !== "ESCROW"
    || account?.user_id != null
    || !tableId
    || text(account?.system_key) !== `POKER_TABLE:${tableId}`
    || text(account?.status).toLowerCase() !== "active") {
    return { category: "MALFORMED_AMBIGUOUS", tableId, reason: "account_identity_or_status" };
  }
  if (table) {
    const status = text(table.status).toUpperCase();
    if (status === "OPEN") return { category: "OPEN_TABLE", tableId, reason: "table_open" };
    if (status === "CLOSED") return { category: "RETAINED_CLOSED_TABLE", tableId, reason: "table_exists" };
    return { category: "MALFORMED_AMBIGUOUS", tableId, reason: "table_status_ambiguous" };
  }
  if (matchingBatchCount !== 1) return { category: "MALFORMED_AMBIGUOUS", tableId, reason: "archive_binding_ambiguous" };
  const evidence = archiveBatchEvidenceState(batch, proof, { expectedSystemIdentifier, run });
  if (!evidence.complete) return { category: "INCOMPLETE_ARCHIVE", tableId, reason: evidence.reason };
  const receiptState = retirementReceiptState(batch);
  if (receiptState === "partial") return { category: "INCOMPLETE_ARCHIVE", tableId, reason: "partial_account_retirement_receipt" };
  if (receiptState === "complete") return { category: "MALFORMED_AMBIGUOUS", tableId, reason: "retirement_receipt_account_still_present" };
  if (Number(registryCount) !== 0) return { category: "INCOMPLETE_ARCHIVE", tableId, reason: "residual_idempotency_mapping" };
  if (account.balance == null || Number(account.balance) !== 0) return { category: "MISSING_TABLE_NON_ZERO", tableId, reason: "non_zero_balance" };
  if (Number(entryCount) !== 0) return { category: "MISSING_TABLE_HOT_ENTRIES", tableId, reason: "hot_entries" };
  if (Number(snapshotCount) !== 0) return { category: "MISSING_TABLE_ACCOUNT_SNAPSHOT", tableId, reason: "account_snapshot" };
  const category = batch.source_policy_id === BOT_ONLY_RETENTION_POLICY_ID
    ? "SAFE_BOT_ONLY_CANDIDATE"
    : batch.source_policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID
      ? "SAFE_LEGACY_CANDIDATE"
      : "MALFORMED_AMBIGUOUS";
  return { category, tableId, reason: null };
}

export function isRetryableSqlState(errorOrState) {
  const state = sqlStateOf(typeof errorOrState === "string" ? { code: errorOrState } : errorOrState);
  return RETRYABLE_SQLSTATE_SET.has(state);
}

export async function runWithRetirementRetry({
  execute,
  revalidate,
  maxAttempts = MAX_RETIREMENT_EXECUTE_ATTEMPTS,
  onAttempt = null,
  onRetry = null,
} = {}) {
  if (typeof execute !== "function") fail("retirement execute callback is required");
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) fail("retirement retry limit is invalid");
  const attemptLimit = Math.min(maxAttempts, MAX_RETIREMENT_EXECUTE_ATTEMPTS);
  const sqlstates = [];
  let attempts = 0;
  let retryCount = 0;
  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    attempts = attempt;
    if (typeof onAttempt === "function") await onAttempt({ attempt, retryCount, sqlstates: [...sqlstates] });
    try {
      const result = await execute({ attempt, retryCount, sqlstates: [...sqlstates] });
      return { result, attempts, retryCount, sqlstates };
    } catch (error) {
      const state = sqlStateOf(error);
      if (state) sqlstates.push(state);
      Object.assign(error, { executeAttempts: attempts, executeRetryCount: retryCount, executeSqlstates: [...sqlstates] });
      if (!RETRYABLE_SQLSTATE_SET.has(state) || attempt >= attemptLimit) throw error;
      retryCount += 1;
      try {
        if (typeof onRetry === "function") await onRetry({
          attempt,
          nextAttempt: attempt + 1,
          retryCount,
          sqlstate: state,
          sqlstates: [...sqlstates],
        });
        if (typeof revalidate === "function") await revalidate({
          attempt,
          nextAttempt: attempt + 1,
          retryCount,
          sqlstate: state,
          sqlstates: [...sqlstates],
        });
      } catch (revalidationError) {
        Object.assign(revalidationError, {
          executeAttempts: attempts,
          executeRetryCount: retryCount,
          executeSqlstates: [...sqlstates],
          retryCauseSqlstate: state,
          attempt: attempt + 1,
        });
        throw revalidationError;
      }
    }
  }
  fail("retirement retry loop exhausted");
}

export const RETENTION_BATCHES_SQL = `
select
  object_path, batch_id::text as batch_id, project_ref, format_version::text as format_version,
  cutoff::text as cutoff, cursor_start_created_at::text as cursor_start_created_at,
  cursor_start_id::text as cursor_start_id, cursor_end_created_at::text as cursor_end_created_at,
  cursor_end_id::text as cursor_end_id, first_created_at::text as first_created_at,
  last_created_at::text as last_created_at, transaction_count::text as transaction_count,
  entry_count::text as entry_count, tx_types, raw_bytes::text as raw_bytes,
  compressed_bytes::text as compressed_bytes, raw_sha256, compressed_sha256,
  credits::text as credits, debits::text as debits, net_amount::text as net_amount,
  status, committed_at::text as committed_at,
  source_policy_id,
  archived_transaction_ids_sha256, archived_entry_ids_sha256,
  archive_proof_verified_at::text as archive_proof_verified_at,
  pruned_at::text as pruned_at, pruned_transaction_count::text as pruned_transaction_count,
  pruned_entry_count::text as pruned_entry_count, pruned_transaction_ids_sha256,
  pruned_entry_ids_sha256,
  bot_only_table_id::text as bot_only_table_id,
  bot_only_table_count::text as bot_only_table_count,
  bot_only_newest_created_at::text as bot_only_newest_created_at,
  bot_only_registry_keys_sha256,
  bot_only_out_of_scope_keys_sha256,
  bot_only_identity_count::text as bot_only_identity_count,
  bot_only_eligible_count::text as bot_only_eligible_count,
  registry_cleaned_at::text as registry_cleaned_at,
  registry_cleaned_key_count::text as registry_cleaned_key_count,
  registry_cleaned_keys_sha256,
  exists (select 1 from public.poker_tables tables where tables.id = batches.bot_only_table_id) as bot_only_table_exists,
  (select tables.status from public.poker_tables tables where tables.id = batches.bot_only_table_id) as bot_only_table_status,
  (select tables.bot_only_retention_complete_at::text from public.poker_tables tables where tables.id = batches.bot_only_table_id) as bot_only_retention_complete_at,
  legacy_allowlist_sha256,
  legacy_batch_table_ids_sha256,
  legacy_master_table_ids,
  legacy_master_table_count::text as legacy_master_table_count,
  legacy_batch_number::text as legacy_batch_number,
  legacy_batch_table_count::text as legacy_batch_table_count,
  legacy_source_run,
  legacy_query_sha256,
  legacy_stage_system_identifier,
  legacy_run_id::text as legacy_run_id,
  legacy_plan_sha256,
  destructive_go_at::text as destructive_go_at,
  destructive_go_batch_id::text as destructive_go_batch_id,
  account_retirement_at::text as account_retirement_at,
  account_retirement_account_count::text as account_retirement_account_count,
  account_retirement_account_ids_sha256,
  account_retirement_recovery_object_path,
  account_retirement_recovery_object_sha256,
  account_retirement_snapshot_sha256
from public.chips_ledger_archive_batches batches
where batches.project_ref = $1
  and batches.source_policy_id = any($2::text[])
order by batches.created_at asc, batches.batch_id asc;`;

export const RETENTION_PROOFS_SQL = `
select proofs.*
from public.chips_legacy_stage_allowlist_proofs proofs
where proofs.batch_id = any($1::bigint[]);`;

export const RETENTION_RUNS_SQL = `
select runs.*
from public.chips_legacy_stage_allowlist_runs runs
where runs.run_id = any($1::bigint[]);`;

export const RETENTION_ACCOUNTS_SQL = `
select
  accounts.id::text as id,
  accounts.user_id::text as user_id,
  accounts.system_key,
  accounts.account_type::text as account_type,
  accounts.status::text as status,
  accounts.label,
  accounts.balance::text as balance,
  accounts.next_entry_seq::text as next_entry_seq,
  accounts.created_at::text as created_at,
  accounts.updated_at::text as updated_at
from public.chips_accounts accounts
where accounts.system_key like 'POKER_TABLE%'
order by accounts.id asc;`;

export const RETENTION_TABLES_SQL = `
select id::text as id, status, created_at::text as created_at, updated_at::text as updated_at
from public.poker_tables
where id = any($1::uuid[]);`;

export const RETENTION_ENTRY_COUNTS_SQL = `
select account_id::text as account_id, count(*)::text as count
from public.chips_entries
where account_id = any($1::uuid[])
group by account_id;`;

export const RETENTION_SNAPSHOT_COUNTS_SQL = `
select account_id::text as account_id, count(*)::text as count
from public.chips_account_snapshot
where account_id = any($1::uuid[])
group by account_id;`;

export const RETENTION_REGISTRY_TABLE_COUNTS_SQL = `
select table_id::text as table_id,
       archive_batch_id::text as archive_batch_id,
       count(*)::text as count
from public.chips_transaction_idempotency
where table_id = any($1::uuid[])
group by table_id, archive_batch_id;`;

export const RETENTION_REGISTRY_BATCH_COUNTS_SQL = `
select table_id::text as table_id,
       archive_batch_id::text as archive_batch_id,
       count(*)::text as count
from public.chips_transaction_idempotency
where archive_batch_id = any($1::bigint[])
  and (table_id is null or not (table_id = any($2::uuid[])))
group by table_id, archive_batch_id;`;

export const RETENTION_UNKNOWN_FK_SQL = `
select
  namespace.nspname as schema_name,
  relation.relname as table_name,
  constraint_name.conname as constraint_name,
  pg_catalog.pg_get_constraintdef(constraint_name.oid) as definition
from pg_catalog.pg_constraint constraint_name
join pg_catalog.pg_class relation on relation.oid = constraint_name.conrelid
join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
where constraint_name.contype = 'f'
  and constraint_name.confrelid = 'public.chips_accounts'::pg_catalog.regclass
  and constraint_name.conrelid not in (
    'public.chips_entries'::pg_catalog.regclass,
    'public.chips_account_snapshot'::pg_catalog.regclass
       );`;

export const RETENTION_UNKNOWN_DELETE_TRIGGER_SQL = `
select trigger_name
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'chips_accounts'
  and event_manipulation = 'DELETE'
  and trigger_name <> 'chips_accounts_escrow_retirement_guard';`;

function normalizeRow(row) {
  if (!row || typeof row !== "object") return {};
  const normalized = { ...row };
  for (const key of [
    "cutoff",
    "cursor_start_created_at",
    "cursor_end_created_at",
    "first_created_at",
    "last_created_at",
    "created_at",
    "committed_at",
    "archive_proof_verified_at",
    "pruned_at",
    "registry_cleaned_at",
    "destructive_go_at",
    "bot_only_newest_created_at",
  ]) {
    if (normalized[key] instanceof Date) normalized[key] = normalized[key].toISOString();
  }
  return normalized;
}

function mapBy(rows, key) {
  const result = new Map();
  for (const row of rows || []) {
    const value = row?.[key];
    if (value != null) result.set(text(value).toLowerCase(), row);
  }
  return result;
}

function mapCountBy(rows) {
  const result = new Map();
  for (const row of rows || []) result.set(text(row.account_id).toLowerCase(), Number(row.count || 0));
  return result;
}

export function registryCountFor(rows, tableId, batchId) {
  const seen = new Set();
  return (rows || []).reduce((total, row) => {
    const sameTable = tableId && text(row.table_id).toLowerCase() === text(tableId).toLowerCase();
    const sameBatch = batchId != null && text(row.archive_batch_id) === text(batchId);
    if (!sameTable && !sameBatch) return total;
    const identity = row.idempotency_key != null
      ? `key:${text(row.idempotency_key)}`
      : `group:${text(row.table_id).toLowerCase()}:${text(row.archive_batch_id)}`;
    if (seen.has(identity)) return total;
    seen.add(identity);
    return total + Number(row.count == null ? 1 : row.count);
  }, 0);
}

function tableIdsForRows(rows, proofByBatch) {
  const ids = new Set();
  for (const row of rows) {
    const proof = proofByBatch.get(text(row.batch_id));
    try {
      for (const id of archiveBatchTableIds(row, proof)) ids.add(id);
    } catch {
      // The account audit reports malformed batches as blockers; it does not
      // turn an invalid historical row into a query-wide outage.
    }
  }
  return [...ids].sort();
}

function completeRetirement(row) {
  return retirementReceiptState(row) === "complete";
}

async function sessionTransaction(sql, run, { phase, telemetry, readOnly, transactionName }) {
  if (typeof sql.begin === "function") return sql.begin(run);
  // postgres.js reserve() pins unsafe() to one connection and exposes release(),
  // but does not expose begin(). Never run this fallback on a pool object.
  if (typeof sql.release !== "function") fail("PostgreSQL audit adapter is required");

  const transactionContext = (queryName) => ({
    phase,
    queryName,
    queryPoint: "transaction",
    attempt: 1,
    readOnly,
  });
  const queryName = (suffix) => `escrow_retention_${transactionName}_${suffix}`;
  let committed = false;
  try {
    await observedQuery(sql, "begin;", [], transactionContext(queryName("begin")), telemetry);
    const result = await run(sql);
    await observedQuery(sql, "commit;", [], transactionContext(queryName("commit")), telemetry);
    committed = true;
    return result;
  } catch (error) {
    if (!committed) {
      try {
        await observedQuery(sql, "rollback;", [], transactionContext(queryName("rollback")), telemetry);
      } catch (rollbackError) {
        Object.assign(error, {
          rollback_error: rollbackError?.message || String(rollbackError),
          rollback_sqlstate: sqlStateOf(rollbackError),
        });
      }
    }
    throw error;
  }
}

export async function readOnlyEscrowAudit({ sql, expectedSystemIdentifier = STAGE_SYSTEM_IDENTIFIER, telemetry = null, phase = RETIREMENT_PHASES.AUDIT } = {}) {
  if (!sql || typeof sql.unsafe !== "function"
    || (typeof sql.begin !== "function" && typeof sql.release !== "function")) {
    fail("PostgreSQL audit adapter is required");
  }
  const startedAt = Date.now();
  const run = async (tx) => {
    const context = (queryName, queryPoint = "read_only_snapshot") => ({
      phase,
      queryName,
      queryPoint,
      attempt: 1,
      readOnly: true,
    });
    await observedQuery(tx, "set transaction isolation level repeatable read, read only;", [], context("escrow_retention_snapshot_transaction", "transaction"), telemetry);
    const pidRows = await observedQuery(tx, "select pg_catalog.pg_backend_pid()::text as backend_pid;", [], context("escrow_retention_snapshot_backend_pid", "backend_pid"), telemetry);
    const backendPid = text(pidRows[0]?.backend_pid) || null;
    const read = (query, parameters, queryName, queryPoint = "read_only_snapshot") => observedQuery(tx, query, parameters, {
      ...context(queryName, queryPoint),
      backendPid,
    }, telemetry);
    const identityRows = await read("select system_identifier::text as system_identifier from pg_catalog.pg_control_system();", [], "escrow_retention_stage_identity", "stage_identity");
    const fenceRows = await read("select public.chips_table_fence_is_active() as active;", [], "escrow_retention_table_fence", "table_fence");
    const controlRows = await read("select enforcement_active from public.chips_table_fence_control where control_id is true;", [], "escrow_retention_table_fence_control", "table_fence_control");
    const policyRows = await read(
      "select policy_id, enabled, canary_batch_id::text as canary_batch_id, canary_account_ids_sha256, activated_at::text as activated_at from public.chips_stage_escrow_account_retention_policy where policy_id = $1;",
      [ESCROW_ACCOUNT_RETENTION_POLICY_ID],
      "escrow_retention_policy",
    );
    const batchRows = (await read(RETENTION_BATCHES_SQL, [STAGE_PROJECT_REF, [...ALLOWED_POLICIES]], "escrow_retention_archive_batches", "archive_batch")).map(normalizeRow);
    const batchIds = batchRows.map((row) => text(row.batch_id)).filter(Boolean);
    const proofRows = batchIds.length
      ? (await read(RETENTION_PROOFS_SQL, [batchIds], "escrow_retention_legacy_proofs", "proof")).map(normalizeRow)
      : [];
    const proofByBatch = mapBy(proofRows, "batch_id");
    const runIds = batchRows
      .filter((row) => row.source_policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID && row.legacy_run_id != null)
      .map((row) => text(row.legacy_run_id))
      .filter((id) => /^[0-9]+$/.test(id));
    const runRows = runIds.length ? (await read(RETENTION_RUNS_SQL, [runIds], "escrow_retention_legacy_runs", "run_plan_binding")).map(normalizeRow) : [];
    const runById = mapBy(runRows, "run_id");
    const batchTableIds = tableIdsForRows(batchRows, proofByBatch);
    const accountRows = (await read(RETENTION_ACCOUNTS_SQL, [], "escrow_retention_accounts", "account")).map(normalizeRow);
    const accountsIds = accountRows.map((row) => text(row.id).toLowerCase()).filter((id) => UUID_RE.test(id));
    const accountTableIds = accountRows.map((row) => accountTableIdFromSystemKey(row.system_key)).filter(Boolean);
    const tableIds = [...new Set([...batchTableIds, ...accountTableIds])].sort();
    const tables = tableIds.length ? (await read(RETENTION_TABLES_SQL, [tableIds], "escrow_retention_tables", "table_binding")).map(normalizeRow) : [];
    const entries = accountsIds.length ? await read(RETENTION_ENTRY_COUNTS_SQL, [accountsIds], "escrow_retention_entry_counts", "entry_dependency") : [];
    const snapshots = accountsIds.length ? await read(RETENTION_SNAPSHOT_COUNTS_SQL, [accountsIds], "escrow_retention_snapshot_counts", "snapshot_dependency") : [];
    const unknownFks = await read(RETENTION_UNKNOWN_FK_SQL, [], "escrow_retention_unknown_foreign_keys", "catalog_guard");
    const unknownDeleteTriggers = await read(RETENTION_UNKNOWN_DELETE_TRIGGER_SQL, [], "escrow_retention_unknown_delete_triggers", "catalog_guard");
    const identity = text(identityRows[0]?.system_identifier);
    const fenceActive = fenceRows[0]?.active === true || fenceRows[0]?.active === "t";
    const fenceEnforcementActive = controlRows[0]?.enforcement_active === true || controlRows[0]?.enforcement_active === "t";
    const tableById = mapBy(tables, "id");
    const entryCountByAccount = mapCountBy(entries);
    const snapshotCountByAccount = mapCountBy(snapshots);
    const batchMatchesByTable = new Map();
    for (const row of batchRows) {
      const proof = proofByBatch.get(text(row.batch_id));
      let batchTableIds = [];
      try { batchTableIds = archiveBatchTableIds(row, proof); } catch { batchTableIds = []; }
      for (const tableId of batchTableIds) {
        const list = batchMatchesByTable.get(tableId) || [];
        list.push({ row, proof });
        batchMatchesByTable.set(tableId, list);
      }
    }
    // Existing tables and ambiguous archive bindings are classified before the
    // registry guard. Read registry evidence only for missing, exactly bound tables.
    const registryTableIds = [...new Set(accountRows.map((account) => accountTableIdFromSystemKey(account.system_key))
      .filter((id) => id && !tableById.has(id) && batchMatchesByTable.get(id)?.length === 1))].sort();
    const registryBatchIds = [...new Set(registryTableIds.map((id) => text(batchMatchesByTable.get(id)[0].row.batch_id)))].sort();
    if (telemetry !== false) klog("chips_ledger_stage_escrow_registry_scope", {
      registry_table_count: registryTableIds.length,
      registry_batch_count: registryBatchIds.length,
    });
    const registryTableRows = registryTableIds.length
      ? await read(RETENTION_REGISTRY_TABLE_COUNTS_SQL, [registryTableIds], "escrow_retention_registry_table_counts", "registry_dependency")
      : [];
    const registryBatchRows = registryBatchIds.length
      ? await read(RETENTION_REGISTRY_BATCH_COUNTS_SQL, [registryBatchIds, registryTableIds], "escrow_retention_registry_batch_counts", "registry_dependency")
      : [];
    const registry = [...registryTableRows, ...registryBatchRows];
    const accounts = [];
    const candidatesByBatch = new Map();
    const alreadyRetired = [];
    const skippedByReason = {};
    for (const account of accountRows) {
      const tableId = accountTableIdFromSystemKey(account.system_key);
      const matches = tableId ? (batchMatchesByTable.get(tableId) || []) : [];
      const match = matches.length === 1 ? matches[0] : null;
      const run = match?.row?.source_policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID
        ? runById.get(text(match.row.legacy_run_id)) || null
        : undefined;
      const classification = classifyEscrowAccount(account, {
        table: tableId ? tableById.get(tableId) || null : null,
        entryCount: entryCountByAccount.get(text(account.id).toLowerCase()) || 0,
        snapshotCount: snapshotCountByAccount.get(text(account.id).toLowerCase()) || 0,
        registryCount: registryCountFor(registry, tableId, match?.row?.batch_id),
        batch: match?.row || null,
        proof: match?.proof || null,
        matchingBatchCount: matches.length,
        expectedSystemIdentifier,
        run,
      });
      const result = {
        accountId: text(account.id).toLowerCase() || null,
        tableId,
        batchId: match?.row?.batch_id == null ? null : text(match.row.batch_id),
        sourcePolicyId: match?.row?.source_policy_id || null,
        classification: classification.category,
        reason: classification.reason,
        balance: nullableText(account.balance),
        nextEntrySeq: nullableText(account.next_entry_seq),
        entryCount: entryCountByAccount.get(text(account.id).toLowerCase()) || 0,
        snapshotCount: snapshotCountByAccount.get(text(account.id).toLowerCase()) || 0,
        registryCount: registryCountFor(registry, tableId, match?.row?.batch_id),
      };
      accounts.push(result);
      if (classification.category === "SAFE_BOT_ONLY_CANDIDATE" || classification.category === "SAFE_LEGACY_CANDIDATE") {
        const key = text(match.row.batch_id);
        const candidate = candidatesByBatch.get(key) || {
          batchId: key,
          sourcePolicyId: match.row.source_policy_id,
          tableIds: [],
          accountIds: [],
          accounts: [],
        };
        candidate.tableIds = [...new Set([...candidate.tableIds, tableId])].sort();
        candidate.accountIds = [...new Set([...candidate.accountIds, result.accountId])].sort();
        candidate.accounts.push(account);
        candidatesByBatch.set(key, candidate);
      } else if (result.batchId && completeRetirement(match?.row)) {
        alreadyRetired.push({ batchId: result.batchId, accountId: result.accountId, tableId });
      } else {
        const reason = classification.reason || classification.category;
        skippedByReason[reason] = (skippedByReason[reason] || 0) + 1;
      }
    }
    for (const row of batchRows) {
      if (completeRetirement(row)) {
        alreadyRetired.push({ batchId: text(row.batch_id), accountId: null, tableId: null });
      }
    }
    const candidates = [...candidatesByBatch.values()]
      .map((candidate) => {
        const row = rowForBatch({ batches: batchRows }, candidate.batchId);
        const proof = proofForBatch({ proofs: proofRows }, candidate.batchId);
        const expectedTableIds = archiveBatchTableIds(row, proof);
        if (canonicalJson(expectedTableIds) !== canonicalJson(candidate.tableIds)
          || candidate.accountIds.length !== expectedTableIds.length) {
          const reason = "account_table_set_incomplete";
          skippedByReason[reason] = (skippedByReason[reason] || 0) + candidate.accountIds.length;
          return null;
        }
        return {
          ...candidate,
          batchNumber: row?.legacy_batch_number == null ? null : Number(row.legacy_batch_number),
          tableIds: [...candidate.tableIds].sort(),
          accountIds: [...candidate.accountIds].sort(),
          accounts: [...candidate.accounts].sort((left, right) => text(left.id).localeCompare(text(right.id))),
        };
      })
      .filter(Boolean)
      .sort((left, right) => Number(left.batchId) - Number(right.batchId));
    // Keep the audit output bounded while preserving the already verified,
    // deterministic candidate order used by prepare/execute.
    const nextCandidate = summarizeNextCandidate(candidates);
    if (unknownFks.length) skippedByReason.unknown_foreign_key = unknownFks.length;
    if (unknownDeleteTriggers.length) skippedByReason.unknown_delete_trigger = unknownDeleteTriggers.length;
    const result = {
      stageIdentity: identity,
      expectedStageIdentity: expectedSystemIdentifier,
      fenceActive,
      fenceEnforcementActive,
      backendPid,
      policy: policyRows[0] || null,
      batches: batchRows,
      proofs: proofRows,
      runs: runRows,
      accounts,
      candidates,
      nextCandidate,
      alreadyRetired,
      skippedByReason,
      unknownForeignKeys: unknownFks,
      unknownDeleteTriggers,
      scannedBatchCount: batchRows.length,
      scannedAccountCount: accountRows.length,
      candidateAccountCount: candidates.reduce((sum, candidate) => sum + candidate.accountIds.length, 0),
      backlogBatchCount: candidates.length,
      backlogAccountCount: candidates.reduce((sum, candidate) => sum + candidate.accountIds.length, 0),
      durationMs: Date.now() - startedAt,
    };
    if (typeof telemetry === "function") telemetry({
      event: "chips_ledger_stage_escrow_retention_audit",
      phase,
      query_name: "escrow_retention_snapshot",
      query_point: "read_only_snapshot",
      batch_number: null,
      batch_id: null,
      backend_pid: result.backendPid,
      attempt: 1,
      sqlstate: "00000",
      read_only: true,
      scanned_batches: result.scannedBatchCount,
      scanned_accounts: result.scannedAccountCount,
      next_candidate: result.nextCandidate,
    });
    return result;
  };
  return sessionTransaction(sql, run, {
    phase,
    telemetry,
    readOnly: true,
    transactionName: "snapshot",
  });
}

function accountSnapshot(account) {
  return {
    id: canonicalUuid(account.id, "account ID"),
    user_id: account.user_id == null ? null : canonicalUuid(account.user_id, "account user ID"),
    system_key: text(account.system_key),
    account_type: text(account.account_type),
    status: text(account.status),
    label: account.label == null ? null : String(account.label),
    balance: text(account.balance),
    next_entry_seq: text(account.next_entry_seq),
    created_at: text(account.created_at),
    updated_at: text(account.updated_at),
  };
}

export function buildAccountRecoverySnapshot({ batch, proof = null, accounts, tableIds, stageSystemIdentifier = STAGE_SYSTEM_IDENTIFIER } = {}) {
  if (!batch || !ALLOWED_POLICIES.has(batch.source_policy_id)
    || text(batch.project_ref) !== STAGE_PROJECT_REF
    || text(stageSystemIdentifier) !== STAGE_SYSTEM_IDENTIFIER
    || !SHA256_RE.test(text(batch.compressed_sha256))
    || text(batch.object_path) !== `v1/sha256/${text(batch.compressed_sha256)}.jsonl.gz`) {
    fail("account recovery requires a canonical Stage archive batch");
  }
  const normalizedAccounts = (accounts || []).map(accountSnapshot).sort((left, right) => left.id.localeCompare(right.id));
  const accountIds = canonicalAccountIds(normalizedAccounts.map((account) => account.id));
  const normalizedTableIds = [...new Set((tableIds || []).map((id) => canonicalUuid(id, "table ID")))].sort();
  if (normalizedAccounts.length !== normalizedTableIds.length) fail("account recovery account/table cardinality differs");
  const bindings = normalizedTableIds.map((tableId) => {
    const account = normalizedAccounts.find((candidate) => candidate.system_key === `POKER_TABLE:${tableId}`);
    if (!account) fail(`account recovery has no account for table ${tableId}`);
    return { table_id: tableId, account_id: account.id };
  });
  return {
    recovery_schema_version: ACCOUNT_RECOVERY_SCHEMA_VERSION,
    artifact_type: "chips_ledger_escrow_account_recovery",
    target: "stage",
    project_ref: text(batch.project_ref),
    postgres_system_identifier: text(stageSystemIdentifier),
    archive_batch: {
      batch_id: text(batch.batch_id),
      source_policy_id: text(batch.source_policy_id),
      object_path: text(batch.object_path),
      compressed_sha256: text(batch.compressed_sha256),
      raw_sha256: text(batch.raw_sha256),
      format_version: Number(batch.format_version),
      cutoff: text(batch.cutoff),
      transaction_count: text(batch.transaction_count),
      entry_count: text(batch.entry_count),
      table_ids: normalizedTableIds,
      archive_proof: {
        transaction_ids_sha256: text(batch.archived_transaction_ids_sha256),
        entry_ids_sha256: text(batch.archived_entry_ids_sha256),
        verified_at: text(batch.archive_proof_verified_at),
      },
      prune_receipt: {
        at: text(batch.pruned_at),
        transaction_count: text(batch.pruned_transaction_count),
        entry_count: text(batch.pruned_entry_count),
        transaction_ids_sha256: text(batch.pruned_transaction_ids_sha256),
        entry_ids_sha256: text(batch.pruned_entry_ids_sha256),
      },
      registry_cleanup_receipt: {
        at: text(batch.registry_cleaned_at),
        key_count: text(batch.registry_cleaned_key_count),
        keys_sha256: text(batch.registry_cleaned_keys_sha256),
      },
      destructive_go: {
        at: text(batch.destructive_go_at),
        batch_id: text(batch.destructive_go_batch_id),
      },
      run_plan_binding: {
        run_id: batch.legacy_run_id == null ? null : text(batch.legacy_run_id),
        plan_sha256: batch.legacy_plan_sha256 == null ? null : text(batch.legacy_plan_sha256),
      },
      legacy_proof: proof ? {
        master_table_count: Number(proof.master_table_count),
        batch_number: Number(proof.batch_number),
        batch_table_count: Number(proof.batch_table_count),
        batch_table_ids_sha256: text(proof.batch_table_ids_sha256),
        master_table_ids_sha256: text(proof.master_table_ids_sha256),
        source_run: text(proof.source_run),
        query_sha256: text(proof.query_sha256),
      } : null,
      bot_only_proof: batch.source_policy_id === BOT_ONLY_RETENTION_POLICY_ID ? {
        table_id: canonicalUuid(batch.bot_only_table_id, "bot-only table ID"),
        table_count: Number(batch.bot_only_table_count),
        newest_created_at: text(batch.bot_only_newest_created_at),
        registry_keys_sha256: text(batch.bot_only_registry_keys_sha256),
        out_of_scope_keys_sha256: text(batch.bot_only_out_of_scope_keys_sha256),
        identity_count: Number(batch.bot_only_identity_count),
        eligible_count: Number(batch.bot_only_eligible_count),
        table_exists: batch.bot_only_table_exists == null
          ? null
          : batch.bot_only_table_exists === true || batch.bot_only_table_exists === "t",
        retention_complete_at: batch.bot_only_retention_complete_at == null
          ? null
          : text(batch.bot_only_retention_complete_at),
      } : null,
    },
    account_ids: accountIds,
    account_table_bindings: bindings,
    accounts: normalizedAccounts,
  };
}

export function serializeAccountRecovery(snapshot) {
  const canonicalBytes = canonicalJsonBytes(snapshot);
  const snapshotSha256 = sha256Hex(canonicalBytes);
  const compressedBytes = gzipSync(canonicalBytes, { level: 9, mtime: 0 });
  const compressedSha256 = sha256Hex(compressedBytes);
  const objectPath = `account-recovery/v1/sha256/${compressedSha256}.json.gz`;
  return {
    snapshot,
    canonicalBytes,
    compressedBytes,
    snapshotSha256,
    compressedSha256,
    objectPath,
    mimeType: ACCOUNT_RECOVERY_MIME_TYPE,
  };
}

export function verifyAccountRecoveryBytes({ bytes, objectPath, mimeType = ACCOUNT_RECOVERY_MIME_TYPE, expectedSnapshot = null, expectedSnapshotSha256 = null, expectedAccountIds = null } = {}) {
  const input = Buffer.from(bytes || []);
  if (mimeType !== ACCOUNT_RECOVERY_MIME_TYPE) fail("account recovery MIME type is not application/gzip");
  if (input.length < 1 || input.length > ACCOUNT_RECOVERY_MAX_BYTES) fail("account recovery object size is invalid");
  const pathMatch = RECOVERY_PATH_RE.exec(text(objectPath));
  if (!pathMatch || pathMatch[1] !== sha256Hex(input)) fail("account recovery object path does not match compressed SHA-256");
  let decoded;
  try {
    decoded = gunzipSync(input);
  } catch {
    fail("account recovery object is not valid gzip");
  }
  let parsed;
  try {
    parsed = JSON.parse(decoded.toString("utf8"));
  } catch {
    fail("account recovery object is not valid JSON");
  }
  if (!parsed || parsed.recovery_schema_version !== ACCOUNT_RECOVERY_SCHEMA_VERSION
    || parsed.artifact_type !== "chips_ledger_escrow_account_recovery"
    || parsed.target !== "stage"
    || parsed.project_ref !== STAGE_PROJECT_REF
    || parsed.postgres_system_identifier !== STAGE_SYSTEM_IDENTIFIER) fail("account recovery schema is not bound to canonical Stage");
  if (!Buffer.from(canonicalJsonBytes(parsed)).equals(decoded)) fail("account recovery JSON is not canonical");
  const snapshotSha256 = sha256Hex(decoded);
  if (expectedSnapshotSha256 != null && text(expectedSnapshotSha256) !== snapshotSha256) fail("account recovery snapshot SHA-256 differs");
  if (expectedSnapshot != null && canonicalJson(parsed) !== canonicalJson(expectedSnapshot)) fail("account recovery snapshot differs");
  const ids = canonicalAccountIds(parsed.account_ids);
  if (!Array.isArray(parsed.accounts) || parsed.accounts.length !== ids.length) fail("account recovery account set is invalid");
  if (expectedAccountIds != null && accountIdsSha256(expectedAccountIds) !== accountIdsSha256(ids)) fail("account recovery account ID set differs");
  if (canonicalJson(parsed.accounts.map((account) => account.id)) !== canonicalJson(ids)) fail("account recovery account IDs are not canonical");
  const archive = parsed.archive_batch;
  if (!archive || !ALLOWED_POLICIES.has(archive.source_policy_id)
    || text(archive.batch_id) === ""
    || Number(archive.format_version) !== 2
    || !SHA256_RE.test(text(archive.compressed_sha256))
    || !SHA256_RE.test(text(archive.raw_sha256))
    || text(archive.object_path) !== `v1/sha256/${text(archive.compressed_sha256)}.jsonl.gz`
    || !Array.isArray(archive.table_ids)
    || archive.table_ids.length !== ids.length
    || !/^[0-9]+$/.test(text(archive.transaction_count))
    || !/^[0-9]+$/.test(text(archive.entry_count))) {
    fail("account recovery archive binding is invalid");
  }
  const tableIds = [...new Set(archive.table_ids.map((id) => canonicalUuid(id, "recovery table ID")))].sort();
  if (tableIds.length !== ids.length || canonicalJson(tableIds) !== canonicalJson(archive.table_ids)) {
    fail("account recovery table ID set is not canonical");
  }
  if (archive.source_policy_id === BOT_ONLY_RETENTION_POLICY_ID) {
    const proof = archive.bot_only_proof;
    if (tableIds.length !== 1
      || !proof
      || canonicalUuid(proof.table_id, "bot-only recovery table ID") !== tableIds[0]
      || Number(proof.table_count) !== 1
      || !text(proof.newest_created_at)
      || !SHA256_RE.test(text(proof.registry_keys_sha256))
      || !SHA256_RE.test(text(proof.out_of_scope_keys_sha256))
      || !Number.isSafeInteger(Number(proof.identity_count))
      || !Number.isSafeInteger(Number(proof.eligible_count))
      || Number(proof.identity_count) !== Number(archive.transaction_count)
      || Number(proof.eligible_count) !== Number(archive.transaction_count)
      || (proof.table_exists !== false && !text(proof.retention_complete_at))) {
      fail("account recovery bot-only proof binding is invalid");
    }
  } else {
    const proof = archive.legacy_proof;
    const run = archive.run_plan_binding;
    if (!proof
      || Number(proof.master_table_count) !== 974
      || Number(proof.batch_table_count) !== tableIds.length
      || !SHA256_RE.test(text(proof.master_table_ids_sha256))
      || !SHA256_RE.test(text(proof.batch_table_ids_sha256))
      || !/^[0-9]+$/.test(text(proof.batch_number))
      || text(proof.source_run) === ""
      || !SHA256_RE.test(text(proof.query_sha256))
      || !run
      || (text(archive.batch_id) === "13"
        ? run.run_id != null || run.plan_sha256 != null
        : text(run.run_id) === "" || !SHA256_RE.test(text(run.plan_sha256)))) {
      fail("account recovery legacy proof binding is invalid");
    }
  }
  const archiveProof = archive.archive_proof;
  const pruneReceipt = archive.prune_receipt;
  const registryReceipt = archive.registry_cleanup_receipt;
  const destructiveGo = archive.destructive_go;
  if (!archiveProof || !SHA256_RE.test(text(archiveProof.transaction_ids_sha256))
    || !SHA256_RE.test(text(archiveProof.entry_ids_sha256))
    || !text(archiveProof.verified_at)
    || !pruneReceipt
    || text(pruneReceipt.transaction_count) !== text(archive.transaction_count)
    || text(pruneReceipt.entry_count) !== text(archive.entry_count)
    || text(pruneReceipt.transaction_ids_sha256) !== text(archiveProof.transaction_ids_sha256)
    || text(pruneReceipt.entry_ids_sha256) !== text(archiveProof.entry_ids_sha256)
    || !text(pruneReceipt.at)
    || !registryReceipt
    || !/^[0-9]+$/.test(text(registryReceipt.key_count))
    || text(registryReceipt.key_count) !== text(archive.transaction_count)
    || !SHA256_RE.test(text(registryReceipt.keys_sha256))
    || !text(registryReceipt.at)
    || !destructiveGo
    || text(destructiveGo.batch_id) !== text(archive.batch_id)
    || !text(destructiveGo.at)) {
    fail("account recovery archive proof or receipt binding is incomplete");
  }
  const normalizedAccounts = parsed.accounts.map((account) => {
    const normalized = accountSnapshot(account);
    if (canonicalJson(normalized) !== canonicalJson(account)
      || normalized.account_type !== "ESCROW"
      || normalized.user_id !== null
      || normalized.status !== "active"
      || normalized.balance !== "0") {
      fail("account recovery contains a non-retirable account snapshot");
    }
    const tableId = accountTableIdFromSystemKey(normalized.system_key);
    if (!tableId || normalized.system_key !== `POKER_TABLE:${tableId}` || !tableIds.includes(tableId)
      || !/^[0-9]+$/.test(normalized.next_entry_seq)
      || normalized.created_at === "" || normalized.updated_at === "") {
      fail("account recovery account key is not bound to its table set");
    }
    return normalized;
  });
  const bindings = parsed.account_table_bindings;
  if (!Array.isArray(bindings) || bindings.length !== tableIds.length
    || canonicalJson(bindings) !== canonicalJson(tableIds.map((tableId) => ({
      table_id: tableId,
      account_id: normalizedAccounts.find((account) => accountTableIdFromSystemKey(account.system_key) === tableId)?.id || null,
    })))) {
    fail("account recovery table/account bindings are invalid");
  }
  return {
    parsed,
    bytes: input,
    decoded,
    size: input.length,
    sha256: pathMatch[1],
    snapshotSha256,
    objectPath,
    mimeType,
  };
}

export const ACCOUNT_RETIREMENT_RECEIPT_SQL = `
select
  batches.batch_id::text as batch_id,
  batches.project_ref,
  batches.source_policy_id,
  batches.object_path,
  batches.compressed_sha256,
  batches.account_retirement_at::text as account_retirement_at,
  batches.account_retirement_account_count::text as account_retirement_account_count,
  batches.account_retirement_account_ids_sha256,
  batches.account_retirement_recovery_object_path,
  batches.account_retirement_recovery_object_sha256,
  batches.account_retirement_snapshot_sha256
from public.chips_ledger_archive_batches batches
where batches.batch_id = $1::bigint;`;

const ACCOUNT_RETIREMENT_ACCOUNT_SQL = `
select
  accounts.id::text as id,
  accounts.user_id::text as user_id,
  accounts.system_key,
  accounts.account_type::text as account_type,
  accounts.status::text as status,
  accounts.label,
  accounts.balance::text as balance,
  accounts.next_entry_seq::text as next_entry_seq,
  accounts.created_at::text as created_at,
  accounts.updated_at::text as updated_at
from public.chips_accounts accounts
where accounts.id = any($1::uuid[])
order by accounts.id;`;

const ACCOUNT_RETIREMENT_DEPENDENCY_SQL = `
select
  (select count(*)::bigint from public.chips_entries entries where entries.account_id = any($1::uuid[])) as entry_count,
  (select count(*)::bigint from public.chips_account_snapshot snapshots where snapshots.account_id = any($1::uuid[])) as snapshot_count;`;

export const ACCOUNT_RETIREMENT_REGISTRY_SQL = `
select count(*)::bigint as registry_count
from public.chips_transaction_idempotency registry
where registry.archive_batch_id = $1::bigint
   or registry.table_id = any($2::uuid[]);`;

export function classifyRecoveryAccountSet(existingAccounts, expectedAccounts) {
  const expected = [...(expectedAccounts || [])].sort((left, right) => text(left?.id).localeCompare(text(right?.id)));
  const expectedById = new Map(expected.map((account) => [text(account?.id).toLowerCase(), account]));
  const existing = [...(existingAccounts || [])].sort((left, right) => text(left?.id).localeCompare(text(right?.id)));
  const seen = new Set();
  for (const account of existing) {
    const id = text(account?.id).toLowerCase();
    const expectedAccount = expectedById.get(id);
    if (!id || seen.has(id) || !expectedAccount || canonicalJson(account) !== canonicalJson(expectedAccount)) {
      return { state: "conflict", existingCount: existing.length, missingCount: null };
    }
    seen.add(id);
  }
  if (existing.length === 0) return { state: "absent", existingCount: 0, missingCount: expected.length };
  if (existing.length === expected.length && seen.size === expected.length) {
    return { state: "identical", existingCount: existing.length, missingCount: 0 };
  }
  return { state: "partial", existingCount: existing.length, missingCount: expected.length - existing.length };
}

export async function verifyAccountRetirementReceipt({ sql, recovery, expectedSystemIdentifier = STAGE_SYSTEM_IDENTIFIER } = {}) {
  if (!sql || typeof sql.begin !== "function" || !recovery?.parsed?.archive_batch) {
    fail("read-only database receipt verifier requires a recovery object and PostgreSQL adapter");
  }
  return sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level repeatable read, read only;");
    const identityRows = await tx.unsafe("select system_identifier::text as system_identifier from pg_catalog.pg_control_system();");
    if (text(identityRows[0]?.system_identifier) !== expectedSystemIdentifier) fail("receipt database is not the expected Stage identity");
    const rows = await tx.unsafe(ACCOUNT_RETIREMENT_RECEIPT_SQL, [recovery.parsed.archive_batch.batch_id]);
    if (rows.length !== 1) fail("account-retirement receipt is missing or ambiguous");
    const row = rows[0];
    const archive = recovery.parsed.archive_batch;
    if (text(row.project_ref) !== STAGE_PROJECT_REF
      || text(row.source_policy_id) !== text(archive.source_policy_id)
      || text(row.object_path) !== text(archive.object_path)
      || text(row.compressed_sha256) !== text(archive.compressed_sha256)
      || text(row.account_retirement_account_count) !== String(recovery.parsed.account_ids.length)
      || text(row.account_retirement_account_ids_sha256) !== accountIdsSha256(recovery.parsed.account_ids)
      || text(row.account_retirement_recovery_object_path) !== recovery.objectPath
      || text(row.account_retirement_recovery_object_sha256) !== recovery.sha256
      || text(row.account_retirement_snapshot_sha256) !== recovery.snapshotSha256
      || row.account_retirement_at == null) {
      fail("account-retirement receipt does not match the verified recovery object");
    }
    const accountRows = await tx.unsafe(ACCOUNT_RETIREMENT_ACCOUNT_SQL, [recovery.parsed.account_ids]);
    const expectedAccounts = [...recovery.parsed.accounts].sort((left, right) => text(left.id).localeCompare(text(right.id)));
    const accountSet = classifyRecoveryAccountSet(accountRows, expectedAccounts);
    if (accountSet.state === "conflict") {
      fail("existing account does not exactly match the recovery snapshot");
    }
    const dependencyRows = await tx.unsafe(ACCOUNT_RETIREMENT_DEPENDENCY_SQL, [recovery.parsed.account_ids]);
    if (Number(dependencyRows[0]?.entry_count || 0) !== 0 || Number(dependencyRows[0]?.snapshot_count || 0) !== 0) {
      fail("account-retirement receipt has surviving ledger dependencies");
    }
    const registryRows = await tx.unsafe(ACCOUNT_RETIREMENT_REGISTRY_SQL, [archive.batch_id, archive.table_ids]);
    if (Number(registryRows[0]?.registry_count || 0) !== 0) {
      fail("account-retirement receipt has surviving idempotency/table mappings");
    }
    return { state: "complete", row, account_state: accountSet.state };
  });
}

function postgresErrorFields(error) {
  return {
    detail: error?.detail == null ? null : text(error.detail),
    hint: error?.hint == null ? null : text(error.hint),
    context: error?.where == null ? error?.context == null ? null : text(error.context) : text(error.where),
  };
}

function emitTelemetry(telemetry, event) {
  if (typeof telemetry === "function") {
    telemetry({
      event: "chips_ledger_stage_escrow_retention_query",
      phase: event.phase || null,
      query_name: event.queryName || null,
      query_point: event.queryPoint || null,
      batch_number: event.batchNumber ?? null,
      batch_id: event.batchId ?? null,
      account_ids_sha256: event.accountIdsSha256 || null,
      backend_pid: event.backendPid || null,
      attempt: event.attempt ?? null,
      sqlstate: event.sqlstate || "00000",
      detail: event.detail || null,
      hint: event.hint || null,
      context: event.context || null,
      read_only: event.readOnly === true,
      storage_state: event.storageState || null,
      storage_writes: event.storageWrites ?? 0,
    });
  } else if (telemetry !== false) {
    process.stderr.write(`${stringifyJson({
      event: "chips_ledger_stage_escrow_retention_query",
      phase: event.phase || null,
      query_name: event.queryName || null,
      query_point: event.queryPoint || null,
      batch_number: event.batchNumber ?? null,
      batch_id: event.batchId ?? null,
      account_ids_sha256: event.accountIdsSha256 || null,
      backend_pid: event.backendPid || null,
      attempt: event.attempt ?? null,
      sqlstate: event.sqlstate || "00000",
      detail: event.detail || null,
      hint: event.hint || null,
      context: event.context || null,
      read_only: event.readOnly === true,
      storage_state: event.storageState || null,
      storage_writes: event.storageWrites ?? 0,
    })}\n`);
  }
}

function klog(kind, data) {
  try {
    console.log(`[klog] ${kind}`, JSON.stringify(data));
  } catch {
    console.log(`[klog] ${kind}`, data);
  }
}

function annotateQueryError(error, context) {
  const target = error instanceof Error ? error : new Error(text(error));
  const fields = postgresErrorFields(error);
  Object.assign(target, {
    chipsLedgerQueryPhase: context.phase,
    chipsLedgerQueryName: context.queryName,
    chipsLedgerQueryPoint: context.queryPoint,
    chipsLedgerBackendPid: context.backendPid || null,
    chipsLedgerQueryAttempt: context.attempt ?? null,
    chipsLedgerQuerySqlState: sqlStateOf(error),
    phase: context.phase,
    query_name: context.queryName,
    query_point: context.queryPoint,
    backend_pid: context.backendPid || null,
    attempt: context.attempt ?? null,
    detail: fields.detail,
    hint: fields.hint,
    context: fields.context,
  });
  return target;
}

async function observedQuery(tx, query, parameters, context, telemetry) {
  const startedAt = Date.now();
  try {
    const rows = await tx.unsafe(query, parameters);
    emitTelemetry(telemetry, {
      ...context,
      elapsedMs: Date.now() - startedAt,
      sqlstate: "00000",
    });
    return rows;
  } catch (error) {
    const annotated = annotateQueryError(error, context);
    emitTelemetry(telemetry, {
      ...context,
      elapsedMs: Date.now() - startedAt,
      sqlstate: sqlStateOf(error),
      ...postgresErrorFields(error),
    });
    throw annotated;
  }
}

async function acquireAdvisoryLock(sql, telemetry) {
  const rows = await observedQuery(sql,
    "select pg_catalog.pg_backend_pid()::text as backend_pid, pg_catalog.pg_try_advisory_lock(pg_catalog.hashtextextended($1, 0)) as acquired;",
    [STAGE_AUTOMATION_LOCK_KEY],
    { phase: RETIREMENT_PHASES.AUDIT, queryName: "escrow_retention_acquire_lock", queryPoint: "advisory_lock", readOnly: false },
    telemetry);
  if (!(rows[0]?.acquired === true || rows[0]?.acquired === "t")) return null;
  const backendPid = text(rows[0]?.backend_pid);
  if (!backendPid) fail("Stage advisory lock backend PID is unavailable");
  const lockSession = { backendPid };
  await assertAdvisoryLock(sql, lockSession, {
    phase: RETIREMENT_PHASES.AUDIT,
    attempt: 1,
    telemetry,
  });
  return lockSession;
}

export async function assertAdvisoryLock(sql, lockSession, { phase = RETIREMENT_PHASES.AUDIT, batchId = null, attempt = null, telemetry = null } = {}) {
  const rows = await observedQuery(sql,
    `select
       pg_catalog.pg_backend_pid()::text as backend_pid,
       exists (
         select 1
           from pg_catalog.pg_locks locks
          where locks.locktype = 'advisory'
            and locks.pid = pg_catalog.pg_backend_pid()
            and locks.granted
            and locks.mode = 'ExclusiveLock'
            and locks.classid::bigint = ((pg_catalog.hashtextextended($1, 0) >> 32) & 4294967295)
            and locks.objid::bigint = (pg_catalog.hashtextextended($1, 0) & 4294967295)
       ) as lock_held;`,
    [STAGE_AUTOMATION_LOCK_KEY],
    { phase, queryName: "escrow_retention_assert_lock", queryPoint: "backend_pid_and_advisory_lock", batchId, attempt, readOnly: false },
    telemetry);
  const backendPid = text(rows[0]?.backend_pid);
  const lockHeld = rows[0]?.lock_held === true || rows[0]?.lock_held === "t";
  if (!backendPid || backendPid !== text(lockSession?.backendPid) || !lockHeld) {
    const error = new Error("Stage advisory lock session was lost; refusing escrow account retirement");
    error.code = "stage_advisory_lock_lost";
    Object.assign(error, { phase, batch_id: batchId, attempt, backend_pid: backendPid || null, lock_held: lockHeld });
    throw error;
  }
  return backendPid;
}

async function releaseAdvisoryLock(sql, lockSession, telemetry, phase = RETIREMENT_PHASES.EXECUTE) {
  await assertAdvisoryLock(sql, lockSession, { phase, telemetry });
  const rows = await observedQuery(sql,
    "select pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended($1, 0));",
    [STAGE_AUTOMATION_LOCK_KEY],
    { phase, queryName: "escrow_retention_release_lock", queryPoint: "advisory_unlock", readOnly: false },
    telemetry);
  if (!(rows[0]?.pg_advisory_unlock === true || rows[0]?.pg_advisory_unlock === "t")) {
    fail("Stage advisory lock release was not confirmed");
  }
}

function moduleEnvironment(config) {
  return {
    EXPECTED_SUPABASE_STAGE_PROJECT_REF: STAGE_PROJECT_REF,
    SUPABASE_STAGE_DB_URL: config.dbUrl,
    SUPABASE_URL: config.apiUrl,
    SUPABASE_SERVICE_ROLE_KEY: config.serviceKey,
    DEPLOYED_COMMIT_SHA: config.deployedCommitSha || undefined,
  };
}

function rowForBatch(audit, batchId) {
  const id = text(batchId);
  return audit.batches.find((row) => text(row.batch_id) === id) || null;
}

function proofForBatch(audit, batchId) {
  const id = text(batchId);
  return audit.proofs.find((proof) => text(proof.batch_id) === id) || null;
}

function candidateForBatch(audit, candidate) {
  const current = audit.candidates.find((item) => text(item.batchId) === text(candidate.batchId));
  if (!current || canonicalJson(current.accountIds) !== canonicalJson(candidate.accountIds)) {
    fail(`escrow account candidate ${candidate.batchId} changed during read-only revalidation`);
  }
  return current;
}

function accountById(accounts) {
  return new Map((accounts || []).map((account) => [text(account.id).toLowerCase(), account]));
}

function accountRowsForCandidate(audit, candidate) {
  const wanted = new Set(candidate.accountIds.map((id) => text(id).toLowerCase()));
  const rows = audit.accounts
    .filter((account) => wanted.has(text(account.accountId).toLowerCase()))
    .map((account) => accountById(candidate.accounts).get(text(account.accountId).toLowerCase()))
    .filter(Boolean);
  if (rows.length !== candidate.accountIds.length) fail(`escrow account candidate ${candidate.batchId} account set is incomplete`);
  return rows.sort((left, right) => text(left.id).localeCompare(text(right.id)));
}

function buildLegacyStagePlan(row, cwd) {
  if (row.source_policy_id !== LEGACY_STAGE_ALLOWLIST_POLICY_ID) return null;
  const frozen = loadFrozenLegacyAllowlist({ cwd });
  const batchManifest = buildLegacyBatchManifest(frozen.masterManifest, { batchNumber: Number(row.legacy_batch_number) });
  return buildLegacyPlan(frozen.masterManifest, batchManifest, {
    runId: row.legacy_run_id == null ? null : text(row.legacy_run_id),
    runPlanSha256: row.legacy_plan_sha256 || null,
  });
}

export async function verifyPrimaryArchiveAndDurableRecovery({
  sql,
  storageTarget,
  row,
  identity = STAGE_SYSTEM_IDENTIFIER,
  cwd = process.cwd(),
  deps = {},
  telemetry = null,
  phase = RETIREMENT_PHASES.RECOVERY,
  attempt = 1,
} = {}) {
  if (!row?.object_path || !SHA256_RE.test(text(row.compressed_sha256))) fail("archive batch has no valid compressed SHA-256");
  // The archive_batches row is read as raw SQL text (bigint columns arrive as
  // strings and timestamp columns must keep their microsecond text form), while
  // the manifest and durable recovery checks need the same numeric and type
  // normalization that the prune store applies via parseManifestRow.
  row = parseManifestRow(row);
  const batchId = text(row.batch_id);
  const batchNumber = row.legacy_batch_number == null ? null : Number(row.legacy_batch_number);
  const legacyPlan = buildLegacyStagePlan(row, cwd);
  const primaryObject = deps.downloadArchive
    ? await deps.downloadArchive(storageTarget, row.object_path)
    : await downloadPrivateArchiveObject(storageTarget, row.object_path, deps);
  const primaryArchiveSha256 = sha256Hex(primaryObject.bytes);
  if (primaryObject.sha256 != null && text(primaryObject.sha256) !== primaryArchiveSha256) {
    fail(`archive batch ${batchId} primary archive checksum is self-inconsistent`);
  }
  if (primaryArchiveSha256 !== text(row.compressed_sha256)) {
    fail(`archive batch ${batchId} primary archive does not match the committed archive SHA`);
  }
  const target = {
    target: "stage",
    label: "Stage",
    projectRef: STAGE_PROJECT_REF,
    systemIdentifier: identity,
  };
  const archiveManifest = exporterManifestFromDatabase(row, target, legacyPlan);
  const verifiedArchive = verifyArchiveBytes({
    compressedBytes: primaryObject.bytes,
    manifest: archiveManifest,
    target,
    artifactName: path.basename(row.object_path),
    expectedLegacyStageAllowlistEvidence: legacyPlan?.archiveManifest || null,
  });
  const evidence = buildPruneEvidence(verifiedArchive, { maxBatchSize: 5000 });
  if (!row.archive_proof_verified_at
    || row.archived_transaction_ids_sha256 !== evidence.transactionIdsSha256
    || row.archived_entry_ids_sha256 !== evidence.entryIdsSha256
    || Number(row.registry_cleaned_key_count) !== Number(evidence.registryKeys?.length)
    || text(row.registry_cleaned_keys_sha256) !== text(evidence.registryKeysSha256)) {
    fail(`archive batch ${batchId} primary archive proof differs from the committed proof`);
  }
  const primary = { evidence, archiveSha256: primaryArchiveSha256 };
  if (!primary.evidence || primary.archiveSha256 !== row.compressed_sha256) {
    fail(`archive batch ${batchId} primary archive verification differs from manifest`);
  }
  const durableInspection = deps.inspectDurableRecovery
    ? await deps.inspectDurableRecovery(storageTarget, row, deps)
    : await inspectDurableRecoveryState(storageTarget, row, deps);
  if (durableInspection?.state !== "complete" || !durableInspection.durable) {
    const error = new Error(`archive batch ${batchId} requires complete durable recovery before account retirement`);
    error.recoveryState = durableInspection?.state || "unavailable";
    error.storageState = durableInspection?.state || "unavailable";
    error.phase = phase;
    throw error;
  }
  const durable = durableInspection.durable;
  if (!Buffer.from(primaryObject.bytes).equals(Buffer.from(durable.archiveBytes))) {
    fail(`archive batch ${batchId} durable recovery archive differs from primary archive`);
  }
  assertDurableRecoveryForEvidence({
    row,
    identity,
    evidence: primary.evidence,
    durable,
  });
  emitTelemetry(telemetry, {
    phase,
    queryName: "escrow_retention_recovery_verified",
    queryPoint: "primary_and_durable_recovery",
    batchNumber,
    batchId,
    backendPid: null,
    attempt,
    sqlstate: "00000",
    readOnly: true,
    storageState: "complete",
    storageWrites: 0,
  });
  return {
    primary,
    evidence: primary.evidence,
    durable,
    legacyPlan,
    recoveryState: "complete",
    storageState: "complete",
    storageWrites: 0,
  };
}

export async function ensureAccountRecoveryObject({
  storageTarget,
  recovery,
  deps = {},
  expectedSnapshot = null,
  expectedAccountIds = null,
  allowCreate = true,
} = {}) {
  const read = deps.readPrivateObject || readPrivateObjectIfExists;
  const upload = deps.uploadPrivateObject || uploadOrVerifyPrivateObject;
  let object = await read(storageTarget, recovery.objectPath, deps);
  let uploaded = false;
  if (object) {
    verifyAccountRecoveryBytes({
      bytes: object.bytes,
      objectPath: recovery.objectPath,
      mimeType: object.mimeType,
      expectedSnapshot,
      expectedSnapshotSha256: recovery.snapshotSha256,
      expectedAccountIds,
    });
  } else {
    if (!allowCreate) {
      const error = new Error(`account recovery object is absent; execute requires the prepared durable object: ${recovery.objectPath}`);
      error.recoveryState = "unavailable";
      error.storageState = "absent";
      error.storageWrites = 0;
      throw error;
    }
    const result = await upload({
      storageTarget,
      objectPath: recovery.objectPath,
      bytes: recovery.compressedBytes,
      mimeType: ACCOUNT_RECOVERY_MIME_TYPE,
      deps,
    });
    uploaded = result?.uploaded === true;
  }
  object = await read(storageTarget, recovery.objectPath, deps);
  if (!object) {
    const error = new Error(`account recovery object is not visible after create-only write: ${recovery.objectPath}`);
    error.recoveryState = "write_not_visible";
    error.storageState = "write_not_visible";
    error.storageWrites = uploaded ? 1 : 0;
    throw error;
  }
  const verified = verifyAccountRecoveryBytes({
    bytes: object.bytes,
    objectPath: recovery.objectPath,
    mimeType: object.mimeType,
    expectedSnapshot,
    expectedSnapshotSha256: recovery.snapshotSha256,
    expectedAccountIds,
  });
  return {
    ...recovery,
    object: verified,
    uploaded,
    storageState: "complete",
    storageWrites: uploaded ? 1 : 0,
  };
}

async function runRetirementDatabaseFunction({ sql, candidate, recovery, execute, confirmation, telemetry, attempt, backendPid, phase = null }) {
  const readOnly = !execute;
  const operationPhase = phase || (execute ? RETIREMENT_PHASES.EXECUTE : RETIREMENT_PHASES.PREPARE);
  return sessionTransaction(sql, async (tx) => {
    const isolation = readOnly
      ? "set transaction isolation level repeatable read, read only;"
      : "set transaction isolation level serializable;";
    await observedQuery(tx, isolation, [], {
      phase: operationPhase,
      queryName: execute ? "escrow_retirement_execute_transaction" : "escrow_retirement_prepare_transaction",
      queryPoint: "transaction",
      batchId: candidate.batchId,
      batchNumber: candidate.batchNumber ?? null,
      attempt,
      backendPid,
      readOnly,
    }, telemetry);
    if (!readOnly) {
      await observedQuery(tx, "set local lock_timeout = '5s';", [], {
        phase: operationPhase,
        queryName: "escrow_retirement_lock_timeout",
        queryPoint: "lock_timeout",
        batchId: candidate.batchId,
        attempt,
        backendPid,
        readOnly: false,
      }, telemetry);
      await observedQuery(tx, "set local statement_timeout = '30s';", [], {
        phase: operationPhase,
        queryName: "escrow_retirement_statement_timeout",
        queryPoint: "statement_timeout",
        batchId: candidate.batchId,
        attempt,
        backendPid,
        readOnly: false,
      }, telemetry);
    }
    const pidRows = await observedQuery(tx, "select pg_catalog.pg_backend_pid()::text as backend_pid;", [], {
      phase: operationPhase,
      queryName: "escrow_retirement_database_backend_pid",
      queryPoint: "backend_pid",
      batchId: candidate.batchId,
      attempt,
      backendPid,
      readOnly,
    }, telemetry);
    const txBackendPid = text(pidRows[0]?.backend_pid);
    const rows = await observedQuery(tx, `select public.chips_retire_stage_escrow_accounts(
      $1::bigint, $2::uuid[], $3::text, $4::text, $5::text, $6::boolean, $7::text
    ) as result;`, [
      candidate.batchId,
      candidate.accountIds,
      recovery.objectPath,
      recovery.compressedSha256,
      recovery.snapshotSha256,
      execute,
      confirmation,
    ], {
      phase: operationPhase,
      queryName: execute ? "escrow_retirement_execute" : "escrow_retirement_prepare",
      queryPoint: execute ? "validated_delete_and_receipt" : "read_only_validation",
      batchId: candidate.batchId,
      batchNumber: candidate.batchNumber ?? null,
      accountIdsSha256: accountIdsSha256(candidate.accountIds),
      attempt,
      backendPid: txBackendPid,
      readOnly,
    }, telemetry);
    return { result: rows[0]?.result, backendPid: txBackendPid };
  }, {
    phase: operationPhase,
    telemetry,
    readOnly,
    transactionName: execute ? "execute" : "prepare",
  }).catch((error) => {
    throw annotateQueryError(error, {
      phase: operationPhase,
      queryName: execute ? "escrow_retirement_execute" : "escrow_retirement_prepare",
      queryPoint: execute ? "validated_delete_and_receipt" : "read_only_validation",
      batchId: candidate.batchId,
      batchNumber: candidate.batchNumber ?? null,
      attempt,
      backendPid,
    });
  });
}

function summarizeCandidate(candidate, row, recovery = null) {
  return {
    batch_number: candidate.batchNumber ?? null,
    batch_id: candidate.batchId,
    source_policy_id: candidate.sourcePolicyId,
    table_ids: [...candidate.tableIds],
    account_ids: [...candidate.accountIds],
    account_ids_sha256: accountIdsSha256(candidate.accountIds),
    recovery_object_path: recovery?.objectPath || null,
    recovery_object_sha256: recovery?.compressedSha256 || null,
    account_snapshot_sha256: recovery?.snapshotSha256 || null,
    archive_object_path: row?.object_path || null,
    archive_compressed_sha256: row?.compressed_sha256 || null,
  };
}

function summarizeNextCandidate(candidates) {
  const candidate = Array.isArray(candidates) ? candidates[0] : null;
  if (!candidate) return null;
  return {
    batch_number: candidate.batchNumber ?? null,
    batch_id: candidate.batchId,
    source_policy_id: candidate.sourcePolicyId,
    table_count: candidate.tableIds.length,
    account_count: candidate.accountIds.length,
    account_ids_sha256: accountIdsSha256(candidate.accountIds),
  };
}

function validateFreshCandidate(audit, candidate) {
  if (audit.stageIdentity !== STAGE_SYSTEM_IDENTIFIER) fail("escrow retention requires canonical Stage identity");
  if (!audit.fenceActive || !audit.fenceEnforcementActive) fail("escrow retention requires an active TABLE fence");
  if (audit.unknownForeignKeys?.length) fail("unknown foreign key dependency blocks escrow account retirement");
  if (audit.unknownDeleteTriggers?.length) fail("unknown DELETE trigger dependency blocks escrow account retirement");
  const current = candidateForBatch(audit, candidate);
  const row = rowForBatch(audit, current.batchId);
  const proof = proofForBatch(audit, current.batchId);
  const run = row?.source_policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID
    ? audit.runs.find((item) => text(item.run_id) === text(row.legacy_run_id)) || null
    : undefined;
  const evidence = archiveBatchEvidenceState(row, proof, {
    expectedSystemIdentifier: audit.stageIdentity,
    run,
  });
  if (!evidence.complete) fail(`escrow retention batch ${current.batchId} evidence is incomplete: ${evidence.reason}`);
  if (canonicalJson(evidence.tableIds) !== canonicalJson(current.tableIds)) fail(`escrow retention batch ${current.batchId} table binding changed`);
  const rows = accountRowsForCandidate(audit, current);
  const auditedAccountsById = new Map(
    audit.accounts.map((item) => [text(item.accountId).toLowerCase(), item]),
  );
  for (const account of rows) {
    const audited = auditedAccountsById.get(text(account.id).toLowerCase());
    if (!audited) fail(`escrow retention batch ${current.batchId} account audit row is missing`);
    const classification = classifyEscrowAccount(account, {
      table: null,
      entryCount: audited.entryCount,
      snapshotCount: audited.snapshotCount,
      registryCount: audited.registryCount,
      batch: row,
      proof,
      matchingBatchCount: 1,
      expectedSystemIdentifier: audit.stageIdentity,
      run,
    });
    if (classification.category !== "SAFE_BOT_ONLY_CANDIDATE" && classification.category !== "SAFE_LEGACY_CANDIDATE") {
      fail(`escrow retention batch ${current.batchId} candidate changed: ${classification.reason || classification.category}`);
    }
  }
  return { candidate: current, row, proof, accounts: rows };
}

async function fullyRevalidateCandidate({
  sql,
  lockSession,
  candidate,
  storageTarget,
  moduleEnv,
  cwd,
  deps,
  telemetry,
  expectedRecovery,
  phase = RETIREMENT_PHASES.RECOVERY,
  attempt = 1,
} = {}) {
  await assertAdvisoryLock(sql, lockSession, { phase, batchId: candidate.batchId, attempt, telemetry });
  const audit = await readOnlyEscrowAudit({ sql, telemetry, phase });
  const current = validateFreshCandidate(audit, candidate);
  let verified;
  try {
    verified = await verifyPrimaryArchiveAndDurableRecovery({
      sql,
      storageTarget,
      row: current.row,
      identity: audit.stageIdentity,
      cwd,
      deps: { ...deps, moduleEnv },
      telemetry,
      phase,
      attempt,
    });
  } catch (error) {
    Object.assign(error, {
      phase: error?.phase || phase,
      batch_id: error?.batch_id || current.candidate.batchId,
      batch_number: error?.batch_number ?? current.candidate.batchNumber ?? null,
    });
    throw error;
  }
  const snapshot = buildAccountRecoverySnapshot({
    batch: current.row,
    proof: current.proof,
    accounts: current.accounts,
    tableIds: current.candidate.tableIds,
    stageSystemIdentifier: audit.stageIdentity,
  });
  const recovery = serializeAccountRecovery(snapshot);
  if (expectedRecovery && (
    canonicalJson(recovery.snapshot) !== canonicalJson(expectedRecovery.snapshot)
    || recovery.snapshotSha256 !== expectedRecovery.snapshotSha256
    || recovery.compressedSha256 !== expectedRecovery.compressedSha256
    || recovery.objectPath !== expectedRecovery.objectPath
  )) {
    fail(`escrow retention batch ${candidate.batchId} account recovery changed during revalidation`);
  }
  // The first prepare is deliberately allowed to establish the account
  // recovery object immediately after this read-only revalidation.  Every
  // later revalidation (including execute retries) must find and verify the
  // already durable object before it can continue.
  if (expectedRecovery) {
    const existing = await readPrivateObjectIfExists(storageTarget, recovery.objectPath, deps);
    if (!existing) {
      const error = new Error(`escrow retention batch ${candidate.batchId} account recovery is unavailable during revalidation`);
      error.recoveryState = "unavailable";
      error.storageState = "unavailable";
      throw error;
    }
    verifyAccountRecoveryBytes({
      bytes: existing.bytes,
      objectPath: recovery.objectPath,
      mimeType: existing.mimeType,
      expectedSnapshot: recovery.snapshot,
      expectedSnapshotSha256: recovery.snapshotSha256,
      expectedAccountIds: recovery.snapshot.account_ids,
    });
  }
  return { ...current, ...verified, recovery, audit };
}

async function revalidateCanaryAuthorization({
  sql,
  lockSession,
  storageTarget,
  moduleEnv,
  cwd,
  deps,
  telemetry,
  batchId,
  expectedAccountIdsSha256,
} = {}) {
  const phase = RETENTION_CONTROL_PHASES.AUTHORIZE_CANARY;
  if (typeof deps.revalidateCanary === "function") {
    return deps.revalidateCanary({
      sql,
      lockSession,
      storageTarget,
      moduleEnv,
      cwd,
      telemetry,
      batchId,
      expectedAccountIdsSha256,
    });
  }
  const audit = await readOnlyEscrowAudit({ sql, telemetry, phase });
  if (audit.stageIdentity !== STAGE_SYSTEM_IDENTIFIER
    || !audit.fenceActive
    || !audit.fenceEnforcementActive) {
    fail("canary authorization requires the canonical Stage identity and active TABLE fence");
  }
  const candidate = audit.candidates.find((item) => text(item.batchId) === text(batchId));
  if (!candidate) fail(`exact canary batch ${batchId} is not a current safe candidate`);
  const currentHash = accountIdsSha256(candidate.accountIds);
  if (currentHash !== text(expectedAccountIdsSha256).toLowerCase()) {
    fail(`escrow canary batch ${batchId} account ID SHA-256 changed during authorization revalidation`);
  }
  const current = await fullyRevalidateCandidate({
    sql,
    lockSession,
    candidate,
    storageTarget,
    moduleEnv,
    cwd,
    deps,
    telemetry,
    expectedRecovery: null,
    phase,
    attempt: 1,
  });
  const storedRecovery = await ensureAccountRecoveryObject({
    storageTarget,
    recovery: current.recovery,
    deps,
    expectedSnapshot: current.recovery.snapshot,
    expectedAccountIds: current.candidate.accountIds,
    allowCreate: false,
  });
  emitTelemetry(telemetry, {
    phase,
    queryName: "escrow_retention_canary_recovery_verified",
    queryPoint: "prepared_account_recovery",
    batchNumber: current.candidate.batchNumber,
    batchId: current.candidate.batchId,
    accountIdsSha256: currentHash,
    attempt: 1,
    sqlstate: "00000",
    readOnly: true,
    storageState: storedRecovery.storageState,
    storageWrites: 0,
  });
  const dry = await runRetirementDatabaseFunction({
    sql,
    candidate: current.candidate,
    recovery: storedRecovery,
    execute: false,
    confirmation: null,
    telemetry,
    attempt: 1,
    backendPid: lockSession.backendPid,
    phase,
  });
  if (dry?.result?.state !== "eligible") {
    fail(`escrow canary batch ${batchId} did not pass read-only authorization revalidation`);
  }
  return { candidate: current.candidate, recovery: storedRecovery };
}

export function limitRetirementCandidates(candidates, maxBatches = MAX_RETIREMENT_BATCHES_PER_RUN, maxAccounts = MAX_RETIREMENT_ACCOUNTS_PER_RUN) {
  const selected = [];
  let accountCount = 0;
  for (const candidate of candidates) {
    if (selected.length >= maxBatches) break;
    if (candidate.accountIds.length > 10 || accountCount + candidate.accountIds.length > maxAccounts) break;
    selected.push(candidate);
    accountCount += candidate.accountIds.length;
  }
  return selected;
}

export function reportSummary(result, env = process.env) {
  const safe = stringifyJson({
    event: "chips_ledger_stage_escrow_account_retention",
    target: "stage",
    project_ref: STAGE_PROJECT_REF,
    stage_system_identifier: result.stageSystemIdentifier || null,
    mode: result.mode || null,
    state: result.state || null,
    policy_id: ESCROW_ACCOUNT_RETENTION_POLICY_ID,
    policy_enabled: result.policyEnabled === true,
    phase: result.phase || null,
    batch_number: result.batchNumber ?? null,
    batch_id: result.batchId ?? null,
    account_ids_sha256: result.accountIdsSha256 || result.canaryAccountIdsSha256 || null,
    query_name: result.queryName || null,
    query_point: result.queryPoint || null,
    attempt: result.attempt ?? null,
    sqlstate: result.sqlstate || null,
    recovery_state: result.recoveryState || null,
    storage_state: result.storageState || null,
    storage_writes: result.storageWrites ?? 0,
    execute_attempts: result.executeAttempts ?? 0,
    execute_retry_count: result.executeRetryCount ?? 0,
    execute_sqlstates: result.executeSqlstates || [],
    scanned_batches: result.scannedBatchCount ?? null,
    scanned_accounts: result.scannedAccountCount ?? null,
    candidate_batches: result.candidateBatchCount ?? null,
    candidate_accounts: result.candidateAccountCount ?? null,
    eligible: result.eligible ?? null,
    retired: result.retired ?? null,
    already_retired: result.alreadyRetired ?? null,
    skipped_by_reason: result.skippedByReason || {},
    backlog_batches: result.backlogBatchCount ?? null,
    backlog_accounts: result.backlogAccountCount ?? null,
    next_candidate: result.nextCandidate || null,
    duration_ms: result.durationMs ?? null,
    lock_backend_pid: result.lockBackendPid || null,
    batches: result.batches || [],
    deployed_commit_sha: env.DEPLOYED_COMMIT_SHA || env.GITHUB_SHA || null,
  });
  process.stdout.write(`${safe}\n`);
  const summaryPath = env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      fs.appendFileSync(summaryPath, `\n### Stage escrow account retention\n\n\`\`\`json\n${safe}\n\`\`\`\n`, { mode: 0o600 });
    } catch {
      // stdout remains authoritative if the optional summary file is unavailable.
    }
  }
  return safe;
}

function createStagePool(config, postgresImpl = postgres) {
  return postgresImpl(config.dbUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    // The advisory lock is session-scoped.  Do not let a long Storage read or
    // archive verification rotate the one reserved connection.
    idle_timeout: 0,
    max_lifetime: 0,
  });
}

export async function runStageEscrowAccountRetention({
  env = process.env,
  deps = {},
  mode = "automatic",
  batchId = null,
  expectedAccountIdsSha256 = null,
  confirmation = null,
  cwd = process.cwd(),
} = {}) {
  const startedAt = Date.now();
  if (!["audit", "prepare-only", "automatic", "execute"].includes(mode)) {
    fail(`unsupported escrow account-retention mode: ${mode}`);
  }
  if (mode === "execute" && env.CHIPS_LEDGER_ESCROW_ACCOUNT_RETENTION_EXECUTE !== "1") {
    fail("manual escrow account execute requires CHIPS_LEDGER_ESCROW_ACCOUNT_RETENTION_EXECUTE=1");
  }
  if ((mode === "prepare-only" || mode === "execute") && !batchId) {
    fail(`${mode} requires an exact --batch-id`);
  }
  if (mode === "execute" && (!expectedAccountIdsSha256 || confirmation !== `GO ${batchId}`)) {
    fail("execute requires the exact account ID SHA-256 and GO <batch_id> confirmation");
  }
  const config = deps.config || validateStageEnvironment(env, { requireCommitSha: true });
  const moduleEnv = deps.moduleEnv || moduleEnvironment(config);
  let pool = deps.pool || null;
  let sql = deps.sql || null;
  const telemetry = deps.telemetry === undefined ? undefined : deps.telemetry;
  const log = deps.klog || klog;
  let lockSession = null;
  let failed = null;
  let result = null;
  let currentPhase = RETIREMENT_PHASES.AUDIT;
  let currentBatchId = null;
  let currentBatchNumber = null;
  try {
    if (deps.sql || deps.pool) {
      sql = deps.sql || (typeof pool.reserve === "function" ? await pool.reserve() : pool);
      lockSession = await acquireAdvisoryLock(sql, telemetry);
    } else {
      const initial = await initializeStageConnection(
        () => createStagePool(config, deps.postgres || postgres),
        async (client) => {
          // Establish the connection with a real query before reserve(). A cold
          // reserve timeout can throw inside postgres.js queryError (no origin).
          await client.unsafe("select 1;");
          const session = await client.reserve();
          return { session, lockSession: await acquireAdvisoryLock(session, telemetry) };
        },
        deps.sleep,
      );
      pool = initial.sql;
      sql = initial.value.session;
      lockSession = initial.value.lockSession;
    }
    if (!lockSession) {
      result = {
        state: "busy",
        mode,
        stageSystemIdentifier: null,
        policyEnabled: false,
        scannedBatchCount: 0,
        scannedAccountCount: 0,
        candidateBatchCount: 0,
        candidateAccountCount: 0,
        eligible: 0,
        retired: 0,
        alreadyRetired: 0,
        skippedByReason: { advisory_lock_busy: 1 },
        backlogBatchCount: null,
        backlogAccountCount: null,
        nextCandidate: null,
        durationMs: Date.now() - startedAt,
        lockBackendPid: null,
        batches: [],
      };
      return result;
    }
    currentPhase = RETIREMENT_PHASES.AUDIT;
    const audit = await readOnlyEscrowAudit({ sql, telemetry, phase: currentPhase });
    log("chips_ledger_stage_escrow_account_retention_audit", {
      stage_system_identifier: audit.stageIdentity,
      backend_pid: audit.backendPid,
      scanned_batches: audit.scannedBatchCount,
      scanned_accounts: audit.scannedAccountCount,
      candidates: audit.candidateAccountCount,
      backlog_batches: audit.backlogBatchCount,
      backlog_accounts: audit.backlogAccountCount,
      next_candidate: audit.nextCandidate,
      skipped_by_reason: audit.skippedByReason,
    });
    if (audit.stageIdentity !== STAGE_SYSTEM_IDENTIFIER) fail("escrow account retention is restricted to canonical Stage");
    if (!audit.fenceActive || !audit.fenceEnforcementActive) fail("escrow account retention requires the active TABLE fence");
    const policy = audit.policy || {};
    const policyEnabled = policy.enabled === true || policy.enabled === "t";
    const base = {
      state: policyEnabled ? "ready" : "disabled",
      mode,
      stageSystemIdentifier: audit.stageIdentity,
      policyEnabled,
      scannedBatchCount: audit.scannedBatchCount,
      scannedAccountCount: audit.scannedAccountCount,
      candidateBatchCount: audit.candidates.length,
      candidateAccountCount: audit.candidateAccountCount,
      eligible: 0,
      retired: 0,
      alreadyRetired: audit.alreadyRetired.length,
      skippedByReason: { ...audit.skippedByReason },
      backlogBatchCount: audit.backlogBatchCount,
      backlogAccountCount: audit.backlogAccountCount,
      nextCandidate: audit.nextCandidate,
      durationMs: null,
      lockBackendPid: lockSession.backendPid,
      batches: [],
    };
    if (mode === "audit" || (!policyEnabled && mode === "automatic")) {
      result = { ...base, state: mode === "audit" ? "audit" : "disabled", durationMs: Date.now() - startedAt };
      return result;
    }
    if (audit.unknownForeignKeys?.length) fail("unknown foreign key dependency blocks escrow account retirement");
    if (audit.unknownDeleteTriggers?.length) fail("unknown DELETE trigger dependency blocks escrow account retirement");
    const storageTarget = deps.storageTarget || resolveStorageTarget("stage", moduleEnv, { singleTarget: true });
    if (deps.verifyBucket) await deps.verifyBucket(storageTarget);
    else await verifyArchiveBucket(storageTarget, deps);
    const candidatePool = batchId
      ? audit.candidates.filter((candidate) => text(candidate.batchId) === text(batchId))
      : audit.candidates;
    if (batchId && candidatePool.length !== 1) {
      fail(`exact escrow account-retirement batch ${batchId} is not a current safe candidate`);
    }
    if (expectedAccountIdsSha256 && candidatePool.length === 1
      && accountIdsSha256(candidatePool[0].accountIds) !== text(expectedAccountIdsSha256).toLowerCase()) {
      fail(`escrow account-retirement batch ${batchId} account ID SHA-256 changed`);
    }
    const selected = limitRetirementCandidates(candidatePool, MAX_RETIREMENT_BATCHES_PER_RUN, MAX_RETIREMENT_ACCOUNTS_PER_RUN);
    base.eligible = selected.reduce((sum, candidate) => sum + candidate.accountIds.length, 0);
    for (const initialCandidate of selected) {
      currentBatchId = initialCandidate.batchId;
      currentBatchNumber = initialCandidate.batchNumber ?? null;
      currentPhase = RETIREMENT_PHASES.PREPARE;
      const prepared = await fullyRevalidateCandidate({
        sql,
        lockSession,
        candidate: initialCandidate,
        storageTarget,
        moduleEnv,
        cwd,
        deps,
        telemetry,
        expectedRecovery: null,
        phase: RETIREMENT_PHASES.PREPARE,
        attempt: 1,
      });
      currentBatchId = prepared.candidate.batchId;
      currentBatchNumber = prepared.candidate.batchNumber ?? null;
      currentPhase = RETIREMENT_PHASES.RECOVERY;
      const snapshot = buildAccountRecoverySnapshot({
        batch: prepared.row,
        proof: prepared.proof,
        accounts: prepared.accounts,
        tableIds: prepared.candidate.tableIds,
        stageSystemIdentifier: prepared.audit.stageIdentity,
      });
      const recovery = serializeAccountRecovery(snapshot);
      const storedRecovery = await ensureAccountRecoveryObject({
        storageTarget,
        recovery,
        deps,
        expectedSnapshot: snapshot,
        expectedAccountIds: prepared.candidate.accountIds,
        allowCreate: mode !== "execute",
      });
      emitTelemetry(telemetry, {
        phase: RETIREMENT_PHASES.RECOVERY,
        queryName: "escrow_retention_account_recovery",
        queryPoint: "create_only_verify",
        batchNumber: prepared.candidate.batchNumber,
        batchId: prepared.candidate.batchId,
        accountIdsSha256: accountIdsSha256(prepared.candidate.accountIds),
        attempt: 1,
        sqlstate: "00000",
        readOnly: false,
        storageState: storedRecovery.storageState,
        storageWrites: storedRecovery.storageWrites,
      });
      currentPhase = RETIREMENT_PHASES.RECOVERY;
      const preparedWithDurableRecovery = await fullyRevalidateCandidate({
        sql,
        lockSession,
        candidate: prepared.candidate,
        storageTarget,
        moduleEnv,
        cwd,
        deps,
        telemetry,
        expectedRecovery: storedRecovery,
        phase: RETIREMENT_PHASES.RECOVERY,
        attempt: 1,
      });
      const preparedCandidate = preparedWithDurableRecovery.candidate;
      currentBatchId = preparedCandidate.batchId;
      currentBatchNumber = preparedCandidate.batchNumber ?? null;
      currentPhase = RETIREMENT_PHASES.PREPARE;
      const dry = await runRetirementDatabaseFunction({
        sql,
        candidate: preparedCandidate,
        recovery: storedRecovery,
        execute: false,
        confirmation: null,
        telemetry,
        attempt: 1,
        backendPid: lockSession.backendPid,
      });
      if (dry?.result?.state !== "eligible") fail(`escrow retention batch ${preparedCandidate.batchId} did not pass read-only prepare`);
      if (mode === "prepare-only") {
        base.batches.push({ ...summarizeCandidate(preparedCandidate, preparedWithDurableRecovery.row, storedRecovery), state: "prepared", storage_state: storedRecovery.storageState, storage_writes: storedRecovery.storageWrites, execute_attempts: 0, execute_sqlstates: [] });
        continue;
      }
      currentPhase = RETIREMENT_PHASES.EXECUTE;
      const executeState = await runWithRetirementRetry({
        onAttempt: async ({ attempt }) => {
          await assertAdvisoryLock(sql, lockSession, { phase: RETIREMENT_PHASES.EXECUTE, batchId: preparedCandidate.batchId, attempt, telemetry });
        },
        execute: async ({ attempt }) => {
          const current = await fullyRevalidateCandidate({
            sql,
            lockSession,
            candidate: preparedCandidate,
            storageTarget,
            moduleEnv,
            cwd,
            deps,
            telemetry,
            expectedRecovery: recovery,
            phase: RETIREMENT_PHASES.EXECUTE,
            attempt,
          });
          const returned = await runRetirementDatabaseFunction({
            sql,
            candidate: current.candidate,
            recovery,
            execute: true,
            confirmation: mode === "execute" ? confirmation : `GO ${current.candidate.batchId}`,
            telemetry,
            attempt,
            backendPid: lockSession.backendPid,
          });
          return { ...returned, current };
        },
        revalidate: async ({ nextAttempt, sqlstate }) => {
          emitTelemetry(telemetry, {
            phase: RETIREMENT_PHASES.RECOVERY,
            queryName: "escrow_retention_retry_revalidation",
            queryPoint: "before_execute_retry",
            batchNumber: preparedCandidate.batchNumber,
            batchId: preparedCandidate.batchId,
            accountIdsSha256: accountIdsSha256(preparedCandidate.accountIds),
            attempt: nextAttempt,
            sqlstate,
            readOnly: true,
            storageState: "complete",
            storageWrites: 0,
          });
          await fullyRevalidateCandidate({
            sql,
            lockSession,
            candidate: preparedCandidate,
            storageTarget,
            moduleEnv,
            cwd,
            deps,
            telemetry,
            expectedRecovery: recovery,
            phase: RETIREMENT_PHASES.RECOVERY,
            attempt: nextAttempt,
          });
        },
      });
      base.retired += executeState.result?.result?.state === "retired" ? preparedCandidate.accountIds.length : 0;
      base.alreadyRetired += executeState.result?.result?.state === "already_retired" ? preparedCandidate.accountIds.length : 0;
      base.batches.push({
        ...summarizeCandidate(preparedCandidate, preparedWithDurableRecovery.row, storedRecovery),
        state: executeState.result?.result?.state || "unknown",
        storage_state: storedRecovery.storageState,
        storage_writes: storedRecovery.storageWrites,
        execute_attempts: executeState.attempts,
        execute_retry_count: executeState.retryCount,
        execute_sqlstates: executeState.sqlstates,
      });
      log("chips_ledger_stage_escrow_account_retention_batch", {
        ...summarizeCandidate(preparedCandidate, preparedWithDurableRecovery.row, storedRecovery),
        state: executeState.result?.result?.state || "unknown",
        execute_attempts: executeState.attempts,
        execute_retry_count: executeState.retryCount,
        execute_sqlstates: executeState.sqlstates,
        storage_state: storedRecovery.storageState,
        storage_writes: storedRecovery.storageWrites,
      });
    }
    result = { ...base, state: "complete", durationMs: Date.now() - startedAt };
    return result;
  } catch (error) {
    failed = error;
    Object.assign(error, {
      phase: error?.phase || currentPhase,
      batch_id: error?.batch_id || currentBatchId,
      batch_number: error?.batch_number ?? currentBatchNumber,
      recoveryState: error?.recoveryState || null,
      storageState: error?.storageState || null,
      storageWrites: error?.storageWrites || 0,
      lockBackendPid: lockSession?.backendPid || null,
    });
    log("chips_ledger_stage_escrow_account_retention_failed", {
      phase: error.phase,
      batch_number: error.batch_number ?? null,
      batch_id: error.batch_id || null,
      attempt: error.attempt ?? null,
      execute_attempts: error.executeAttempts ?? 0,
      execute_retry_count: error.executeRetryCount ?? 0,
      execute_sqlstates: error.executeSqlstates || [],
      sqlstate: sqlStateOf(error),
      detail: error.detail || null,
      hint: error.hint || null,
      context: error.context || null,
      backend_pid: error.backend_pid || error.lockBackendPid || null,
      recovery_state: error.recoveryState || null,
      storage_state: error.storageState || null,
      storage_writes: error.storageWrites || 0,
    });
    throw error;
  } finally {
    if (lockSession && sql) {
      try {
        await releaseAdvisoryLock(sql, lockSession, telemetry);
      } catch (releaseError) {
        if (!failed) throw releaseError;
      }
    }
    if (deps.sql == null && sql && typeof sql.release === "function") {
      try { await sql.release(); } catch { /* connection close below is authoritative */ }
    }
    if (pool && typeof pool.end === "function") {
      try { await pool.end({ timeout: 5 }); } catch { /* do not hide the operation result */ }
    }
  }
}

export async function runStageEscrowAccountRetentionControl({
  env = process.env,
  deps = {},
  mode,
  batchId = null,
  expectedAccountIdsSha256 = null,
  confirmation = null,
  cwd = process.cwd(),
} = {}) {
  const isAuthorization = mode === "authorize-canary";
  const isActivation = mode === "activate";
  if (!isAuthorization && !isActivation) fail(`unsupported escrow account-retention control mode: ${mode}`);
  const phase = isAuthorization ? RETENTION_CONTROL_PHASES.AUTHORIZE_CANARY : RETENTION_CONTROL_PHASES.ACTIVATE;
  const gate = isAuthorization
    ? "CHIPS_LEDGER_ESCROW_ACCOUNT_RETENTION_AUTHORIZE_CANARY"
    : "CHIPS_LEDGER_ESCROW_ACCOUNT_RETENTION_ACTIVATE";
  if (env[gate] !== "1") fail(`${mode} requires ${gate}=1`);
  if (isAuthorization && (!/^[1-9][0-9]*$/.test(text(batchId))
    || !SHA256_RE.test(text(expectedAccountIdsSha256))
    || confirmation !== `GO ${batchId}`)) {
    fail("canary authorization requires an exact batch ID, account ID SHA-256 and GO <batch_id> confirmation");
  }
  if (isActivation && !ACTIVATION_CONFIRMATION_RE.test(text(confirmation))) {
    fail("activation requires the exact ACTIVATE ... CANARY <batch_id> <account_ids_sha256> confirmation");
  }
  const config = deps.config || validateStageEnvironment(env, { requireCommitSha: true });
  const moduleEnv = deps.moduleEnv || moduleEnvironment(config);
  const pool = deps.pool || (deps.sql ? null : createStagePool(config, deps.postgres || postgres));
  const sql = deps.sql || (pool && typeof pool.reserve === "function" ? await pool.reserve() : pool);
  if (!sql) fail("Stage PostgreSQL session is required");
  const telemetry = deps.telemetry === undefined ? undefined : deps.telemetry;
  const queryContext = {
    phase,
    batchId: isAuthorization ? batchId : null,
    attempt: 1,
    readOnly: false,
  };
  let lockSession = null;
  let failed = null;
  try {
    lockSession = await acquireAdvisoryLock(sql, telemetry);
    if (!lockSession) {
      const error = new Error("Stage automation advisory lock is busy; refusing escrow account-retention control change");
      error.code = "stage_advisory_lock_busy";
      error.phase = phase;
      error.batch_id = isAuthorization ? batchId : null;
      throw error;
    }
    await assertAdvisoryLock(sql, lockSession, { ...queryContext, telemetry });
    if (isAuthorization) {
      const storageTarget = deps.storageTarget || (typeof deps.revalidateCanary === "function"
        ? null
        : resolveStorageTarget("stage", moduleEnv, { singleTarget: true }));
      if (storageTarget && deps.verifyBucket) await deps.verifyBucket(storageTarget);
      else if (storageTarget) await verifyArchiveBucket(storageTarget, deps);
      await revalidateCanaryAuthorization({
        sql,
        lockSession,
        storageTarget,
        moduleEnv,
        cwd,
        deps,
        telemetry,
        batchId,
        expectedAccountIdsSha256,
      });
    }
    const controlResult = await sessionTransaction(sql, async (tx) => {
      await observedQuery(tx, "set transaction isolation level serializable;", [], {
        ...queryContext,
        queryName: "escrow_retention_control_transaction",
        queryPoint: "transaction",
        backendPid: lockSession.backendPid,
      }, telemetry);
      await observedQuery(tx, "set local lock_timeout = '5s';", [], {
        ...queryContext,
        queryName: "escrow_retention_control_lock_timeout",
        queryPoint: "lock_timeout",
        backendPid: lockSession.backendPid,
      }, telemetry);
      await observedQuery(tx, "set local statement_timeout = '30s';", [], {
        ...queryContext,
        queryName: "escrow_retention_control_statement_timeout",
        queryPoint: "statement_timeout",
        backendPid: lockSession.backendPid,
      }, telemetry);
      await assertAdvisoryLock(tx, lockSession, { ...queryContext, telemetry });
      const query = isAuthorization
        ? "select public.chips_authorize_stage_escrow_account_retirement_canary($1::bigint, $2::text, $3::text) as result;"
        : "select public.chips_activate_stage_escrow_account_retention($1::text) as result;";
      const parameters = isAuthorization
        ? [batchId, expectedAccountIdsSha256, confirmation]
        : [confirmation];
      const rows = await observedQuery(tx, query, parameters, {
        ...queryContext,
        queryName: isAuthorization ? "escrow_retention_authorize_canary" : "escrow_retention_activate",
        queryPoint: "owner_control_function",
        backendPid: lockSession.backendPid,
      }, telemetry);
      await assertAdvisoryLock(tx, lockSession, { ...queryContext, telemetry });
      return rows[0]?.result || null;
    }, { phase, telemetry, readOnly: false, transactionName: "control" });
    await assertAdvisoryLock(sql, lockSession, { ...queryContext, telemetry });
    return {
      state: text(controlResult?.state) || (isAuthorization ? "canary_authorized" : "active"),
      mode,
      phase,
      batchId: controlResult?.batch_id ?? controlResult?.canary_batch_id ?? (isAuthorization ? batchId : null),
      accountIdsSha256: controlResult?.account_ids_sha256
        ?? controlResult?.canary_account_ids_sha256
        ?? (isAuthorization ? expectedAccountIdsSha256 : null),
      confirmation: controlResult?.confirmation ?? null,
      stageSystemIdentifier: STAGE_SYSTEM_IDENTIFIER,
      lockBackendPid: lockSession.backendPid,
    };
  } catch (error) {
    failed = error;
    Object.assign(error, {
      phase: error?.phase || phase,
      batch_id: error?.batch_id || (isAuthorization ? batchId : null),
      lockBackendPid: lockSession?.backendPid || null,
    });
    throw error;
  } finally {
    if (lockSession && sql) {
      try {
        await releaseAdvisoryLock(sql, lockSession, telemetry, phase);
      } catch (releaseError) {
        if (!failed) throw releaseError;
      }
    }
    if (deps.sql == null && sql && typeof sql.release === "function") {
      try { await sql.release(); } catch { /* connection close below is authoritative */ }
    }
    if (pool && typeof pool.end === "function") {
      try { await pool.end({ timeout: 5 }); } catch { /* do not hide the operation result */ }
    }
  }
}

export function parseRetentionArgs(argv = process.argv.slice(2)) {
  const args = { mode: null, batchId: null, accountIdsSha256: null, confirmation: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--automatic" || token === "--audit" || token === "--prepare-only" || token === "--execute"
      || token === "--authorize-canary" || token === "--activate") {
      if (args.mode) fail("retention mode was supplied more than once");
      args.mode = token.slice(2);
    } else if (token === "--batch-id" || token === "--account-ids-sha256" || token === "--confirmation") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${token} requires a value`);
      const key = token === "--batch-id" ? "batchId" : token === "--account-ids-sha256" ? "accountIdsSha256" : "confirmation";
      if (args[key] !== null) fail(`${token} was supplied more than once`);
      args[key] = value;
      index += 1;
    } else if (token === "--help" || token === "-h") {
      args.mode = "help";
    } else {
      fail(`unknown retention option: ${token}`);
    }
  }
  if (!args.mode) args.mode = "audit";
  if (args.mode === "automatic" && (args.batchId || args.accountIdsSha256 || args.confirmation)) {
    fail("automatic retention does not accept a manual batch authorization");
  }
  if (args.mode === "audit" && (args.batchId || args.accountIdsSha256 || args.confirmation)) {
    fail("audit mode does not accept a batch authorization");
  }
  if (args.mode === "prepare-only" && (!args.batchId || args.accountIdsSha256 || args.confirmation)) {
    fail("prepare-only requires only an exact --batch-id");
  }
  if (args.mode === "execute" && (!args.batchId || !args.accountIdsSha256 || !args.confirmation)) {
    fail("execute requires --batch-id, --account-ids-sha256 and --confirmation 'GO <batch_id>'");
  }
  if (args.mode === "authorize-canary" && (!args.batchId || !args.accountIdsSha256 || !args.confirmation)) {
    fail("authorize-canary requires --batch-id, --account-ids-sha256 and --confirmation 'GO <batch_id>'");
  }
  if (args.mode === "activate" && (!args.confirmation || !ACTIVATION_CONFIRMATION_RE.test(args.confirmation)
    || args.batchId || args.accountIdsSha256)) {
    fail("activate requires only the exact ACTIVATE ... CANARY <batch_id> <account_ids_sha256> confirmation");
  }
  if (args.batchId != null && !/^[1-9][0-9]*$/.test(args.batchId)) fail("retention batch ID is invalid");
  if (args.accountIdsSha256 != null && !SHA256_RE.test(args.accountIdsSha256)) fail("retention account ID SHA-256 is invalid");
  if (args.confirmation != null && args.batchId != null && args.confirmation !== `GO ${args.batchId}`) {
    fail("retention confirmation must be exactly GO <batch_id>");
  }
  return args;
}

const HELP = `Usage: node scripts/ops/chips-ledger-stage-escrow-retention.mjs [--audit|--prepare-only|--automatic|--execute|--authorize-canary|--activate]\n\n--audit is read-only. --prepare-only requires --batch-id and only prepares that\nexact candidate. --execute additionally requires --batch-id,\n--account-ids-sha256, --confirmation "GO <batch_id>" and the explicit\nCHIPS_LEDGER_ESCROW_ACCOUNT_RETENTION_EXECUTE=1 gate. --authorize-canary uses\nthe same exact batch/hash/GO values and the owner-only\nCHIPS_LEDGER_ESCROW_ACCOUNT_RETENTION_AUTHORIZE_CANARY=1 gate. --activate\nrequires the exact owner confirmation\n"ACTIVATE stage-ledger-escrow-account-retention-v1 CANARY <batch_id> <account_ids_sha256>"\nand CHIPS_LEDGER_ESCROW_ACCOUNT_RETENTION_ACTIVATE=1. The scheduled\n--automatic mode is Stage-only and remains disabled until owner-controlled\ncanary activation.\n`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let args;
  try {
    args = parseRetentionArgs();
    if (args.mode === "help") {
      process.stdout.write(HELP);
    } else {
      const operation = args.mode === "authorize-canary" || args.mode === "activate"
        ? runStageEscrowAccountRetentionControl({
          mode: args.mode,
          batchId: args.batchId,
          expectedAccountIdsSha256: args.accountIdsSha256,
          confirmation: args.confirmation,
        })
        : runStageEscrowAccountRetention({
          mode: args.mode === "prepare-only" ? "prepare-only" : args.mode,
          batchId: args.batchId,
          expectedAccountIdsSha256: args.accountIdsSha256,
          confirmation: args.confirmation,
        });
      operation.then((result) => reportSummary(result)).catch((error) => {
        reportSummary({
          mode: args.mode,
          state: "error",
          phase: error?.phase || RETIREMENT_PHASES.AUDIT,
          batchNumber: error?.batch_number ?? null,
          batchId: error?.batch_id || null,
          queryName: error?.query_name || null,
          queryPoint: error?.query_point || null,
          attempt: error?.attempt ?? null,
          sqlstate: sqlStateOf(error),
          recoveryState: error?.recoveryState || null,
          storageState: error?.storageState || null,
          storageWrites: error?.storageWrites || 0,
          executeAttempts: error?.executeAttempts ?? 0,
          executeRetryCount: error?.executeRetryCount ?? 0,
          executeSqlstates: error?.executeSqlstates || [],
          stageSystemIdentifier: error?.stageSystemIdentifier || null,
          skippedByReason: {},
          batches: [],
          durationMs: null,
          lockBackendPid: error?.lockBackendPid || error?.backend_pid || null,
        });
        const payload = {
          event: "chips_ledger_stage_escrow_account_retention",
          target: "stage",
          state: "error",
          phase: error?.phase || RETIREMENT_PHASES.AUDIT,
          batch_number: error?.batch_number ?? null,
          batch_id: error?.batch_id || null,
          attempt: error?.attempt ?? null,
          executeAttempts: error?.executeAttempts ?? 0,
          executeRetryCount: error?.executeRetryCount ?? 0,
          executeSqlstates: error?.executeSqlstates || [],
          sqlstate: sqlStateOf(error),
          query_name: error?.query_name || null,
          query_point: error?.query_point || null,
          recoveryState: error?.recoveryState || null,
          storageState: error?.storageState || null,
          storage_writes: error?.storageWrites || 0,
          backend_pid: error?.backend_pid || error?.lockBackendPid || null,
          detail: error?.detail || null,
          hint: error?.hint || null,
          context: error?.context || null,
          reason: error?.message || String(error),
        };
        process.stderr.write(`${stringifyJson(payload)}\n`);
        process.exitCode = 1;
      });
    }
  } catch (error) {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exitCode = 1;
  }
}
