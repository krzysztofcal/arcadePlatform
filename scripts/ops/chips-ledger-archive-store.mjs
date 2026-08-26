import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import postgres from "postgres";
import {
  EXPORT_SCHEMA_VERSION,
  BOT_ONLY_EXPORT_SCHEMA_VERSION,
  BOT_ONLY_RETENTION_POLICY_ID,
  LEGACY_STAGE_ALLOWLIST_CUTOFF,
  LEGACY_STAGE_ALLOWLIST_POLICY_ID,
  LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT,
  LEGACY_STAGE_ALLOWLIST_TABLE_COUNT,
  assertLegacyStageAllowlistEvidence,
  compareTransactions,
  maxBatchSizeForTarget,
  parseJsonl,
  STAGE_AUTOMATION_POLICY_ID,
  resolveTarget,
  serializeRecords,
  stringifyJson,
  timestampToMicros,
} from "./chips-ledger-archive-export.mjs";
import { assertTableBinding } from "./_shared/chips-table-idempotency.mjs";

export const ARCHIVE_BUCKET = "chips-ledger-archive";
export const ARCHIVE_MIME_TYPE = "application/gzip";
export const ARCHIVE_MAX_BYTES = 6 * 1024 * 1024;

export const TABLE_IDENTITY_SUMMARY_ERROR_CODES = Object.freeze({
  MISSING: "TABLE_IDENTITY_SUMMARY_MISSING",
  NEWEST_CREATED_AT_INVALID: "TABLE_IDENTITY_SUMMARY_NEWEST_CREATED_AT_INVALID",
  IDENTITY_COUNT_INVALID: "TABLE_IDENTITY_SUMMARY_IDENTITY_COUNT_INVALID",
  IDENTITY_COUNT_MISMATCH: "TABLE_IDENTITY_SUMMARY_IDENTITY_COUNT_MISMATCH",
  ELIGIBLE_COUNT_INVALID: "TABLE_IDENTITY_SUMMARY_ELIGIBLE_COUNT_INVALID",
  ELIGIBLE_COUNT_MISMATCH: "TABLE_IDENTITY_SUMMARY_ELIGIBLE_COUNT_MISMATCH",
  OUT_OF_SCOPE_KEYS_SHA256_INVALID: "TABLE_IDENTITY_SUMMARY_OUT_OF_SCOPE_KEYS_SHA256_INVALID",
  NEWEST_CREATED_AT_REPRESENTATION_ONLY_MISMATCH: "TABLE_IDENTITY_SUMMARY_NEWEST_CREATED_AT_REPRESENTATION_ONLY_MISMATCH",
  NEWEST_CREATED_AT_SEMANTIC_MISMATCH: "TABLE_IDENTITY_SUMMARY_NEWEST_CREATED_AT_SEMANTIC_MISMATCH",
});

const INTEGER_RE = /^-?(?:0|[1-9][0-9]*)$/;
const NON_NEGATIVE_INTEGER_RE = /^(?:0|[1-9][0-9]*)$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR_ORDER = ["transaction.created_at ASC", "transaction.id ASC"];
const LEGACY_STAGE_ALLOWLIST_FROZEN_SHA256 = "611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05";
const LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_IDS_SHA256 = "ded0a77efe84f56d2f4a9706f9d454a09179f6328098ad60ecf45639b4b75895";
const LEGACY_STAGE_ALLOWLIST_QUERY_SHA256 = "9bd27ff7a2749a879707e823982f708e6abf86beffcdf8f97c5deac05f00ca09";
const LEGACY_STAGE_ALLOWLIST_MASTER_MANIFEST_SHA256 = "eb5593bdf5bd7f3c985373e6037a861d999413eae5076b923165c7f8147a79e7";
const LEGACY_STAGE_ALLOWLIST_BATCH_MANIFEST_SHA256 = "6011e3ceb819d2c8f21ed9cdf0904831d408b4b6fd1262c0905c6eeb9b4f59f9";
const LEGACY_STAGE_ALLOWLIST_FREEZE_RUN_ID = "32771521144";
const LEGACY_STAGE_ALLOWLIST_DIAGNOSTIC_SOURCE_RUN = "32753223679";
const LEGACY_STAGE_ALLOWLIST_DIAGNOSTIC_SOURCE_RUN_SHA256 = "aa82076e7e4d7fd1e027889be94868e5662652cc29ae2dc7b55a4196b260ed0e";

const HELP = `Usage: node scripts/ops/chips-ledger-archive-store.mjs [options]

Required:
  --target stage|prod       Explicit target; no default.
  --artifact <path>        Existing .jsonl.gz artifact.
  --manifest <path>        Existing local exporter manifest.

The script creates/verifies a private Storage bucket, uploads without upsert,
verifies a private download, and records pending -> committed metadata. It
does not modify ledger rows and never deletes Storage objects.
`;

function fail(message, code = null) {
  const error = new Error(code ? `${message}: ${code}` : message);
  if (code) error.code = code;
  throw error;
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function hasOwn(value, key) {
  return value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative integer`);
  return value;
}

function assertIntegerString(value, label, { nonNegative = false } = {}) {
  if (typeof value !== "string") fail(`${label} must be serialized as a string`);
  const pattern = nonNegative ? NON_NEGATIVE_INTEGER_RE : INTEGER_RE;
  if (!pattern.test(value)) fail(`${label} must be an integer string`);
  return value;
}

function assertSha(value, label) {
  if (typeof value !== "string" || !SHA256_RE.test(value)) fail(`${label} must be a lowercase SHA-256`);
  return value;
}

function assertLegacyManifestEvidence(condition, code) {
  if (!condition) fail(`legacy Stage allowlist manifest evidence is incomplete: ${code}`);
}

function hashCanonicalLines(values) {
  return crypto.createHash("sha256").update(`${values.join("\n")}\n`, "utf8").digest("hex");
}

export function sameTimestamp(left, right) {
  if (left == null || right == null) return left == null && right == null;
  return timestampToMicros(left) === timestampToMicros(right);
}

function sameValue(left, right, field) {
  if (field.endsWith("_at") || field === "cutoff") return sameTimestamp(left, right);
  if (field === "tx_types") return canonicalJson(left) === canonicalJson(right);
  if (field === "legacy_master_table_ids") return canonicalJson(left) === canonicalJson(right);
  return String(left ?? "") === String(right ?? "");
}

function sameCursor(left, right) {
  if (left == null || right == null) return left == null && right == null;
  return sameTimestamp(left.created_at, right.created_at) && text(left.id).toLowerCase() === text(right.id).toLowerCase();
}

function parseArgs(argv) {
  const keyMap = { target: "target", artifact: "artifact", manifest: "manifest" };
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    const key = token.startsWith("--") ? keyMap[token.slice(2)] : null;
    if (!key) fail(`unknown argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${token} requires a value`);
    if (args[key] !== undefined) fail(`${token} was supplied more than once`);
    args[key] = value;
    index += 1;
  }
  return args;
}

export function resolveStorageTarget(targetValue, env = process.env, targetOptions = {}) {
  const target = resolveTarget(targetValue, env, targetOptions);
  const rawUrl = text(env.SUPABASE_URL);
  if (!rawUrl) fail("SUPABASE_URL is required");
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail("SUPABASE_URL is invalid");
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    fail("SUPABASE_URL must be an HTTPS Supabase origin");
  }
  const projectMatch = /^([a-z0-9]{20})\.supabase\.co$/i.exec(url.hostname);
  if (!projectMatch) fail("SUPABASE_URL must expose a supported Supabase project ref");
  const apiProjectRef = projectMatch[1].toLowerCase();
  if (apiProjectRef !== target.projectRef) fail(`SUPABASE_URL does not match the canonical ${target.target} project ref`);
  const serviceKey = text(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!serviceKey) fail("SUPABASE_SERVICE_ROLE_KEY is required");
  return {
    ...target,
    baseUrl: url.origin,
    apiProjectRef,
    serviceKey,
  };
}

function verifyCursor(cursor, label) {
  if (cursor == null) return null;
  if (!cursor || typeof cursor !== "object" || !UUID_RE.test(text(cursor.id))) fail(`${label} is invalid`);
  timestampToMicros(cursor.created_at);
  return { created_at: text(cursor.created_at), id: text(cursor.id).toLowerCase() };
}

function verifyManifestShape(manifest, artifactName, target, expectedLegacyStageAllowlistEvidence = null) {
  if (!manifest || typeof manifest !== "object") fail("local manifest must be an object");
  if (![EXPORT_SCHEMA_VERSION, BOT_ONLY_EXPORT_SCHEMA_VERSION].includes(manifest.schema_version)
    || manifest.artifact_type !== "chips_ledger_archive" || manifest.format !== "jsonl.gz") {
    fail("local manifest has an unsupported archive format");
  }
  if (manifest.target !== target.target) fail("local manifest target does not match --target");
  if (manifest.source_policy_id !== undefined
    && manifest.source_policy_id !== null
    && manifest.source_policy_id !== STAGE_AUTOMATION_POLICY_ID
    && manifest.source_policy_id !== BOT_ONLY_RETENTION_POLICY_ID
    && manifest.source_policy_id !== LEGACY_STAGE_ALLOWLIST_POLICY_ID) {
    fail("local manifest source policy is unsupported");
  }
  if (manifest.source_policy_id === STAGE_AUTOMATION_POLICY_ID && target.target !== "stage") {
    fail("Stage automation policy cannot be stored for a non-Stage target");
  }
  if (manifest.schema_version === BOT_ONLY_EXPORT_SCHEMA_VERSION
    && (![BOT_ONLY_RETENTION_POLICY_ID, LEGACY_STAGE_ALLOWLIST_POLICY_ID].includes(manifest.source_policy_id)
      || target.target !== "stage")) {
    fail("schema-v2 archive requires the Stage bot-only retention policy");
  }
  if (manifest.source_policy_id === BOT_ONLY_RETENTION_POLICY_ID && manifest.schema_version !== BOT_ONLY_EXPORT_SCHEMA_VERSION) {
    fail("bot-only retention policy requires schema-v2 archive evidence");
  }
  if (manifest.source_policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID
    && (manifest.schema_version !== BOT_ONLY_EXPORT_SCHEMA_VERSION || target.target !== "stage")) {
    fail("legacy Stage allowlist policy requires a Stage schema-v2 archive");
  }
  if (manifest.artifact !== artifactName) fail("local manifest artifact name does not match the archive");
  if (!manifest.cutoff || typeof manifest.cutoff.created_at !== "string") fail("local manifest cutoff is missing");
  timestampToMicros(manifest.cutoff.created_at);
  if (manifest.cutoff.rule !== "transaction.created_at < cutoff") fail("local manifest cutoff rule is unsupported");

  const batch = manifest.batch;
  const maxBatchSize = maxBatchSizeForTarget(target.target);
  if (!batch || !Number.isSafeInteger(batch.limit) || batch.limit < 1 || batch.limit > maxBatchSize) fail("local manifest batch limit is invalid for target");
  assertSafeInteger(batch.transactions, "batch.transactions");
  assertSafeInteger(batch.entries, "batch.entries");
  if (batch.transactions > batch.limit) fail("local manifest transaction count exceeds target batch limit");
  if (!batch.tx_types || typeof batch.tx_types !== "object" || Array.isArray(batch.tx_types)) fail("local manifest tx_types is invalid");
  let txTypeTotal = 0;
  for (const [txType, count] of Object.entries(batch.tx_types)) {
    if (!txType || !Number.isSafeInteger(count) || count < 0) fail("local manifest tx_types is invalid");
    txTypeTotal += count;
  }
  if (txTypeTotal !== batch.transactions) fail("local manifest tx_types count mismatch");

  if (manifest.schema_version === BOT_ONLY_EXPORT_SCHEMA_VERSION && manifest.source_policy_id === BOT_ONLY_RETENTION_POLICY_ID) {
    const botOnly = manifest.bot_only;
    if (!botOnly || !UUID_RE.test(text(botOnly.table_id)) || botOnly.table_count !== 1
      || !timestampValue(botOnly.newest_created_at)
      || !SHA256_RE.test(text(botOnly.registry_keys_sha256))
      || !SHA256_RE.test(text(botOnly.out_of_scope_keys_sha256))
      || !Number.isSafeInteger(botOnly.identity_count) || botOnly.identity_count < 1
      || botOnly.identity_count !== batch.transactions
      || botOnly.eligible_count !== batch.transactions) {
      fail("schema-v2 bot-only manifest evidence is incomplete");
    }
  }
  if (manifest.schema_version === BOT_ONLY_EXPORT_SCHEMA_VERSION && manifest.source_policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID) {
    const legacy = manifest.legacy_stage_allowlist;
    assertLegacyManifestEvidence(sameTimestamp(manifest.cutoff.created_at, LEGACY_STAGE_ALLOWLIST_CUTOFF), "cutoff");
    assertLegacyManifestEvidence(legacy && typeof legacy === "object" && !Array.isArray(legacy), "missing");
    assertLegacyManifestEvidence(legacy.policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID, "policy_id");
    assertLegacyManifestEvidence(legacy.proof_basis === LEGACY_STAGE_ALLOWLIST_POLICY_ID, "proof_basis");
    assertLegacyManifestEvidence(legacy.allowlist_sha256 === LEGACY_STAGE_ALLOWLIST_FROZEN_SHA256, "allowlist_sha256");
    assertLegacyManifestEvidence(legacy.batch_table_ids_sha256 === LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_IDS_SHA256, "batch_table_ids_sha256");
    assertLegacyManifestEvidence(legacy.query_sha256 === LEGACY_STAGE_ALLOWLIST_QUERY_SHA256, "query_sha256");
    assertLegacyManifestEvidence(legacy.generator_sha256 === LEGACY_STAGE_ALLOWLIST_QUERY_SHA256, "generator_sha256");
    assertLegacyManifestEvidence(legacy.source_run === LEGACY_STAGE_ALLOWLIST_DIAGNOSTIC_SOURCE_RUN, "source_run");
    assertLegacyManifestEvidence(legacy.stage_system_identifier === "7656985631720456337", "stage_system_identifier");
    assertLegacyManifestEvidence(legacy.master_table_count === LEGACY_STAGE_ALLOWLIST_TABLE_COUNT, "master_table_count");
    assertLegacyManifestEvidence(legacy.master_manifest_sha256 === LEGACY_STAGE_ALLOWLIST_MASTER_MANIFEST_SHA256, "master_manifest_sha256");
    assertLegacyManifestEvidence(legacy.batch_manifest_sha256 === LEGACY_STAGE_ALLOWLIST_BATCH_MANIFEST_SHA256, "batch_manifest_sha256");
    assertLegacyManifestEvidence(legacy.freeze_run_id === LEGACY_STAGE_ALLOWLIST_FREEZE_RUN_ID, "freeze_run_id");
    assertLegacyManifestEvidence(legacy.diagnostic_source_run === LEGACY_STAGE_ALLOWLIST_DIAGNOSTIC_SOURCE_RUN, "diagnostic_source_run");
    assertLegacyManifestEvidence(legacy.diagnostic_source_run_sha256 === LEGACY_STAGE_ALLOWLIST_DIAGNOSTIC_SOURCE_RUN_SHA256, "diagnostic_source_run_sha256");

    const masterIds = Array.isArray(legacy.master_table_ids)
      ? legacy.master_table_ids.map((id) => text(id).toLowerCase())
      : [];
    assertLegacyManifestEvidence(masterIds.length === LEGACY_STAGE_ALLOWLIST_TABLE_COUNT, "master_table_ids_count");
    assertLegacyManifestEvidence(masterIds.every((id) => UUID_RE.test(id)), "master_table_ids_uuid");
    assertLegacyManifestEvidence(new Set(masterIds).size === masterIds.length, "master_table_ids_unique");
    const sortedMasterIds = [...masterIds].sort();
    assertLegacyManifestEvidence(masterIds.every((id, index) => id === sortedMasterIds[index]), "master_table_ids_order");
    assertLegacyManifestEvidence(hashCanonicalLines(masterIds) === legacy.allowlist_sha256, "master_table_ids_hash");

    assertLegacyManifestEvidence(legacy.batch_number === 1, "batch_number");
    assertLegacyManifestEvidence(legacy.batch_table_count === LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT, "batch_table_count");
    assertLegacyManifestEvidence(Array.isArray(legacy.batch_table_ids), "batch_table_ids");
    const batchIds = legacy.batch_table_ids.map((id) => text(id).toLowerCase());
    assertLegacyManifestEvidence(batchIds.length === legacy.batch_table_count, "batch_table_ids_count");
    assertLegacyManifestEvidence(batchIds.every((id) => UUID_RE.test(id)), "batch_table_ids_uuid");
    assertLegacyManifestEvidence(new Set(batchIds).size === batchIds.length, "batch_table_ids_unique");
    const sortedBatchIds = [...batchIds].sort();
    assertLegacyManifestEvidence(batchIds.every((id, index) => id === sortedBatchIds[index]), "batch_table_ids_order");
    assertLegacyManifestEvidence(batchIds.every((id) => masterIds.includes(id)), "batch_table_ids_membership");
    assertLegacyManifestEvidence(hashCanonicalLines(batchIds) === legacy.batch_table_ids_sha256, "batch_table_ids_hash");
    if (expectedLegacyStageAllowlistEvidence) {
      assertLegacyStageAllowlistEvidence(legacy, expectedLegacyStageAllowlistEvidence);
    }
  }

  const amounts = manifest.amounts;
  if (!amounts) fail("local manifest amounts are missing");
  assertIntegerString(amounts.credits, "amounts.credits", { nonNegative: true });
  assertIntegerString(amounts.debits, "amounts.debits", { nonNegative: true });
  if (assertIntegerString(amounts.net, "amounts.net") !== "0") fail("local manifest net amount is not zero");
  if (amounts.credits !== amounts.debits) fail("local manifest credits and debits differ");

  const bytes = manifest.bytes;
  if (!bytes || !Number.isSafeInteger(bytes.raw) || bytes.raw < 0 || !Number.isSafeInteger(bytes.compressed) || bytes.compressed < 0 || bytes.compressed > ARCHIVE_MAX_BYTES) {
    fail("local manifest byte counts are invalid");
  }
  if (!manifest.sha256) fail("local manifest checksums are missing");
  assertSha(manifest.sha256.raw_jsonl, "raw_jsonl SHA-256");
  assertSha(manifest.sha256.compressed_artifact, "compressed_artifact SHA-256");
  if (!manifest.time_range || !manifest.cursor || canonicalJson(manifest.cursor.order) !== canonicalJson(CURSOR_ORDER)) {
    fail("local manifest cursor is invalid");
  }
  const cursorStart = verifyCursor(manifest.cursor.start, "cursor.start");
  const cursorEnd = verifyCursor(manifest.cursor.end, "cursor.end");
  const cursorNext = verifyCursor(manifest.cursor.next, "cursor.next");
  if (!sameCursor(cursorEnd, cursorNext)) fail("cursor.next does not match cursor.end");
  return { cursorStart, cursorEnd };
}

function timestampValue(value) {
  if (typeof value !== "string") return false;
  try {
    timestampToMicros(value);
    return true;
  } catch {
    return false;
  }
}

function summaryFailure(checks, field, code, details = {}) {
  return {
    ok: false,
    code,
    field,
    checks: [...checks, { field, code, ok: false }],
    ...details,
  };
}

export function diagnoseTableIdentitySummary(summary, manifestBotOnly) {
  const checks = [];
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return summaryFailure(checks, "summary", TABLE_IDENTITY_SUMMARY_ERROR_CODES.MISSING);
  }
  checks.push({ field: "summary", code: TABLE_IDENTITY_SUMMARY_ERROR_CODES.MISSING, ok: true });

  if (!timestampValue(summary.newest_created_at)) {
    return summaryFailure(checks, "newest_created_at", TABLE_IDENTITY_SUMMARY_ERROR_CODES.NEWEST_CREATED_AT_INVALID);
  }
  checks.push({ field: "newest_created_at.format", code: TABLE_IDENTITY_SUMMARY_ERROR_CODES.NEWEST_CREATED_AT_INVALID, ok: true });

  if (!/^[0-9]+$/.test(text(summary.identity_count))) {
    return summaryFailure(checks, "identity_count.format", TABLE_IDENTITY_SUMMARY_ERROR_CODES.IDENTITY_COUNT_INVALID);
  }
  checks.push({ field: "identity_count.format", code: TABLE_IDENTITY_SUMMARY_ERROR_CODES.IDENTITY_COUNT_INVALID, ok: true });
  if (text(summary.identity_count) !== String(manifestBotOnly?.identity_count)) {
    return summaryFailure(checks, "identity_count", TABLE_IDENTITY_SUMMARY_ERROR_CODES.IDENTITY_COUNT_MISMATCH);
  }
  checks.push({ field: "identity_count", code: TABLE_IDENTITY_SUMMARY_ERROR_CODES.IDENTITY_COUNT_MISMATCH, ok: true });

  if (!/^[0-9]+$/.test(text(summary.eligible_count))) {
    return summaryFailure(checks, "eligible_count.format", TABLE_IDENTITY_SUMMARY_ERROR_CODES.ELIGIBLE_COUNT_INVALID);
  }
  checks.push({ field: "eligible_count.format", code: TABLE_IDENTITY_SUMMARY_ERROR_CODES.ELIGIBLE_COUNT_INVALID, ok: true });
  if (text(summary.eligible_count) !== String(manifestBotOnly?.eligible_count)) {
    return summaryFailure(checks, "eligible_count", TABLE_IDENTITY_SUMMARY_ERROR_CODES.ELIGIBLE_COUNT_MISMATCH);
  }
  checks.push({ field: "eligible_count", code: TABLE_IDENTITY_SUMMARY_ERROR_CODES.ELIGIBLE_COUNT_MISMATCH, ok: true });

  if (!SHA256_RE.test(text(summary.out_of_scope_keys_sha256))) {
    return summaryFailure(checks, "out_of_scope_keys_sha256", TABLE_IDENTITY_SUMMARY_ERROR_CODES.OUT_OF_SCOPE_KEYS_SHA256_INVALID);
  }
  checks.push({ field: "out_of_scope_keys_sha256", code: TABLE_IDENTITY_SUMMARY_ERROR_CODES.OUT_OF_SCOPE_KEYS_SHA256_INVALID, ok: true });

  const strictTimestampEqual = summary.newest_created_at === manifestBotOnly?.newest_created_at;
  let semanticTimestampEqual = false;
  try {
    semanticTimestampEqual = sameTimestamp(summary.newest_created_at, manifestBotOnly?.newest_created_at);
  } catch {
    semanticTimestampEqual = false;
  }
  if (!semanticTimestampEqual) {
    return summaryFailure(checks, "newest_created_at", TABLE_IDENTITY_SUMMARY_ERROR_CODES.NEWEST_CREATED_AT_SEMANTIC_MISMATCH, {
      strict_timestamp_equal: strictTimestampEqual,
      semantic_timestamp_equal: false,
    });
  }
  const timestampCode = strictTimestampEqual
    ? null
    : TABLE_IDENTITY_SUMMARY_ERROR_CODES.NEWEST_CREATED_AT_REPRESENTATION_ONLY_MISMATCH;
  checks.push({
    field: "newest_created_at",
    code: timestampCode,
    ok: true,
    ...(timestampCode ? { representation_only: true } : {}),
  });
  return {
    ok: true,
    code: timestampCode,
    field: timestampCode ? "newest_created_at" : null,
    checks,
    strict_timestamp_equal: strictTimestampEqual,
    semantic_timestamp_equal: true,
    ...(timestampCode ? { representation_only: true } : {}),
  };
}

export function assertTableIdentitySummary(summary, manifestBotOnly) {
  const diagnosis = diagnoseTableIdentitySummary(summary, manifestBotOnly);
  if (!diagnosis.ok) fail("schema-v2 artifact table summary is invalid", diagnosis.code);
  return diagnosis;
}

function summarizeRecords(records, manifest) {
  if (!Array.isArray(records)) fail("JSONL artifact must contain records");
  const sorted = [...records].sort(compareTransactions);
  const seenTransactions = new Set();
  const seenEntries = new Set();
  const txTypes = {};
  let entryCount = 0;
  let credits = 0n;
  let debits = 0n;
  let netAmount = 0n;
  const cutoff = timestampToMicros(manifest.cutoff.created_at);

  records.forEach((record, recordIndex) => {
    if (record !== sorted[recordIndex]) fail("JSONL transaction order is not deterministic");
    const transaction = record?.transaction;
    const transactionId = text(transaction?.id).toLowerCase();
    if (record?.schema_version !== manifest.schema_version || record?.record_type !== "chips_transaction" || !UUID_RE.test(transactionId)) {
      fail("JSONL artifact contains a malformed transaction");
    }
    if (seenTransactions.has(transactionId)) fail("JSONL artifact contains duplicate transactions");
    seenTransactions.add(transactionId);
    const createdAt = text(transaction.created_at);
    if (timestampToMicros(createdAt) >= cutoff) fail("JSONL artifact contains a transaction at or after cutoff");
    const txType = text(transaction.tx_type);
    if (!txType) fail("JSONL artifact contains a transaction without tx_type");
    txTypes[txType] = (txTypes[txType] || 0) + 1;

    if (!Array.isArray(record.entries)) fail(`JSONL artifact has no entries array for ${transactionId}`);
    const isLegacyAllowlist = manifest.schema_version === BOT_ONLY_EXPORT_SCHEMA_VERSION
      && manifest.source_policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID;
    if (isLegacyAllowlist) {
      const context = record.table_context;
      const proof = context?.legacy_stage_allowlist;
      const legacy = manifest.legacy_stage_allowlist;
      const tableId = text(context?.table_id).toLowerCase();
      const masterIds = legacy.master_table_ids.map((id) => text(id).toLowerCase());
      const batchIds = Array.isArray(legacy.batch_table_ids)
        ? legacy.batch_table_ids.map((id) => text(id).toLowerCase())
        : null;
      if (transaction.tx_type !== "TABLE_BUY_IN" && transaction.tx_type !== "TABLE_CASH_OUT") fail("legacy Stage artifact contains a non-TABLE transaction");
      if (!UUID_RE.test(tableId) || !masterIds.includes(tableId)
        || (batchIds !== null && !batchIds.includes(tableId))
        || transaction.user_id != null
        || context?.table_exists !== true || context?.table_status !== "CLOSED"
        || !context?.escrow_account_id || context?.escrow_status !== "active" || context?.escrow_balance !== "0"
        || context?.bot_only_proof?.has_human_participant !== false
        || context?.bot_only_proof?.proof_eligible === true
        || !proof || proof.policy_id !== LEGACY_STAGE_ALLOWLIST_POLICY_ID
        || proof.allowlist_sha256 !== legacy.allowlist_sha256
        || proof.batch_table_ids_sha256 !== legacy.batch_table_ids_sha256
        || proof.source_run !== legacy.source_run
        || proof.query_sha256 !== legacy.query_sha256
        || proof.stage_system_identifier !== legacy.stage_system_identifier
        || proof.master_table_count !== legacy.master_table_count
        || proof.batch_number !== legacy.batch_number
        || proof.batch_table_count !== legacy.batch_table_count) {
        fail("legacy Stage artifact proof or lifecycle evidence is invalid");
      }
      const escrowEntries = record.entries.filter((entry) => entry.account?.account_type === "ESCROW");
      const systemEntries = record.entries.filter((entry) => entry.account?.account_type === "SYSTEM");
      if (record.entries.length !== 2 || escrowEntries.length !== 1 || systemEntries.length !== 1
        || record.entries.some((entry) => entry.account?.account_type === "USER")
        || escrowEntries[0]?.account?.system_key !== `POKER_TABLE:${tableId}`
        || (transaction.tx_type === "TABLE_BUY_IN" && !(BigInt(escrowEntries[0].amount) > 0n && BigInt(systemEntries[0].amount) < 0n))
        || (transaction.tx_type === "TABLE_CASH_OUT" && !(BigInt(escrowEntries[0].amount) < 0n && BigInt(systemEntries[0].amount) > 0n))) {
        fail("legacy Stage artifact entry binding is invalid");
      }
    } else if (manifest.schema_version === BOT_ONLY_EXPORT_SCHEMA_VERSION) {
      const context = record.table_context;
      const proof = context?.bot_only_proof;
      const summary = context?.table_identity_summary;
      if (transaction.tx_type !== "TABLE_BUY_IN" && transaction.tx_type !== "TABLE_CASH_OUT") fail("schema-v2 artifact contains a non-TABLE transaction");
      if (transaction.user_id != null || context?.table_exists !== true || context?.table_status !== "CLOSED"
        || !context?.escrow_account_id || context?.escrow_status !== "active" || context?.escrow_balance !== "0"
        || context?.table_id !== manifest.bot_only?.table_id) fail("schema-v2 artifact lifecycle evidence is invalid");
      if (!proof || proof.has_human_participant !== false || proof.proof_eligible !== true
        || proof.table_id_from_key !== context.table_id || proof.key_format_version !== 1 || !text(proof.key_format)) {
        fail("schema-v2 artifact bot-only proof is invalid");
      }
      assertTableIdentitySummary(summary, manifest.bot_only);
      const parsedBinding = assertTableBinding({
        idempotencyKey: transaction.idempotency_key,
        metadata: transaction.metadata,
        reference: transaction.reference,
      });
      if (parsedBinding.tableId !== context.table_id || parsedBinding.format !== proof.key_format) fail("schema-v2 artifact idempotency binding is invalid");
      const escrowEntries = record.entries.filter((entry) => entry.account?.account_type === "ESCROW");
      const systemEntries = record.entries.filter((entry) => entry.account?.account_type === "SYSTEM");
      if (escrowEntries.length !== 1 || systemEntries.length !== 1 || record.entries.some((entry) => entry.account?.account_type === "USER")
        || escrowEntries[0]?.account?.system_key !== `POKER_TABLE:${context.table_id}`
        || (transaction.tx_type === "TABLE_BUY_IN" && !(BigInt(escrowEntries[0].amount) > 0n && BigInt(systemEntries[0].amount) < 0n))
        || (transaction.tx_type === "TABLE_CASH_OUT" && !(BigInt(escrowEntries[0].amount) < 0n && BigInt(systemEntries[0].amount) > 0n))) {
        fail("schema-v2 artifact entry binding is invalid");
      }
    }
    const sortedEntries = [...record.entries].sort((left, right) => {
      const leftId = BigInt(assertIntegerString(left?.id, "entry.id", { nonNegative: true }));
      const rightId = BigInt(assertIntegerString(right?.id, "entry.id", { nonNegative: true }));
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });
    if (record.entries.some((entry, entryIndex) => entry !== sortedEntries[entryIndex])) {
      fail(`JSONL entry order is not deterministic for ${transactionId}`);
    }
    let transactionTotal = 0n;
    for (const entry of record.entries) {
      const entryId = assertIntegerString(entry?.id, "entry.id", { nonNegative: true });
      if (seenEntries.has(entryId)) fail(`JSONL artifact contains duplicate entry ${entryId}`);
      seenEntries.add(entryId);
      if (text(entry.transaction_id).toLowerCase() !== transactionId || text(entry.account_id) !== text(entry.account?.id)) {
        fail(`JSONL entry identity mismatch for ${transactionId}`);
      }
      if (!entry.account || !text(entry.account.account_type) || !hasOwn(entry.account, "user_id") || !hasOwn(entry.account, "system_key")) {
        fail(`JSONL entry account context is incomplete for ${transactionId}`);
      }
      assertIntegerString(entry.entry_seq, "entry.entry_seq", { nonNegative: true });
      timestampToMicros(entry.created_at);
      const amount = BigInt(assertIntegerString(entry.amount, "entry.amount"));
      transactionTotal += amount;
      netAmount += amount;
      if (amount > 0n) credits += amount;
      if (amount < 0n) debits -= amount;
    }
    if (transactionTotal !== 0n) fail(`JSONL transaction is not conserved: ${transactionId}`);
    entryCount += record.entries.length;
  });

  if (netAmount !== 0n || credits !== debits) fail("JSONL batch is not conserved");
  const first = records[0]?.transaction?.created_at || null;
  const last = records.at(-1)?.transaction?.created_at || null;
  const expectedEnd = last ? { created_at: last, id: records.at(-1).transaction.id.toLowerCase() } : null;
  if (!sameTimestamp(first, manifest.time_range.first_created_at) || !sameTimestamp(last, manifest.time_range.last_created_at)) {
    fail("local manifest time range does not match JSONL");
  }
  if (!sameCursor(expectedEnd, manifest.cursor.end)) fail("local manifest cursor end does not match JSONL");
  if (manifest.cursor.next && !sameCursor(expectedEnd, manifest.cursor.next)) fail("local manifest cursor next does not match JSONL");
  if (records.length !== manifest.batch.transactions || entryCount !== manifest.batch.entries) fail("local manifest counts do not match JSONL");
  if (canonicalJson(Object.fromEntries(Object.entries(txTypes).sort(([left], [right]) => left.localeCompare(right)))) !== canonicalJson(manifest.batch.tx_types)) {
    fail("local manifest tx_types do not match JSONL");
  }
  if (credits.toString() !== manifest.amounts.credits || debits.toString() !== manifest.amounts.debits || netAmount.toString() !== manifest.amounts.net) {
    fail("local manifest amounts do not match JSONL");
  }
  return { transactionCount: records.length, entryCount, txTypes, credits: credits.toString(), debits: debits.toString(), netAmount: netAmount.toString() };
}

export function buildObjectPath(manifestOrSha) {
  const sha = typeof manifestOrSha === "string" ? manifestOrSha : manifestOrSha?.sha256?.compressed_artifact;
  assertSha(sha, "compressed_artifact SHA-256");
  return `v1/sha256/${sha}.jsonl.gz`;
}

export function verifyArchiveBytes({ compressedBytes: inputBytes, manifest, target, artifactName, expectedLegacyStageAllowlistEvidence = null }) {
  const compressedBytes = Buffer.from(inputBytes || []);
  if (compressedBytes.length > ARCHIVE_MAX_BYTES) fail("artifact exceeds the 6 MiB Storage limit");
  const { cursorStart, cursorEnd } = verifyManifestShape(
    manifest,
    artifactName,
    target,
    expectedLegacyStageAllowlistEvidence,
  );
  const compressedSha256 = crypto.createHash("sha256").update(compressedBytes).digest("hex");
  if (compressedBytes.length !== manifest.bytes.compressed || compressedSha256 !== manifest.sha256.compressed_artifact) {
    fail("local compressed artifact does not match its manifest");
  }
  let rawBytes;
  try {
    rawBytes = gunzipSync(compressedBytes);
  } catch {
    fail("local artifact is not a valid gzip stream");
  }
  const rawSha256 = crypto.createHash("sha256").update(rawBytes).digest("hex");
  if (rawBytes.length !== manifest.bytes.raw || rawSha256 !== manifest.sha256.raw_jsonl) fail("local raw JSONL does not match its manifest");
  const rawText = rawBytes.toString("utf8");
  const records = parseJsonl(rawText);
  if (serializeRecords(records) !== rawText) fail("local JSONL round-trip verification failed");
  const summary = summarizeRecords(records, manifest);
  const expectedRatio = rawBytes.length === 0 ? null : Number((compressedBytes.length / rawBytes.length).toFixed(6));
  if (manifest.bytes.compression_ratio_compressed_over_raw !== expectedRatio) fail("local compression ratio does not match its manifest");
  return {
    manifest,
    compressedBytes,
    rawBytes,
    records,
    objectPath: buildObjectPath(manifest),
    cursorStart,
    cursorEnd,
    summary,
  };
}

export function verifyLocalArchive({ artifactPath, manifestPath, target, expectedLegacyStageAllowlistEvidence = null, requireLegacyStageAllowlistPlan = false }) {
  if (!artifactPath || !manifestPath) fail("--artifact and --manifest are required");
  const artifact = path.resolve(artifactPath);
  const manifestFile = path.resolve(manifestPath);
  const stat = fs.statSync(artifact);
  if (!stat.isFile()) fail("artifact must be a regular file");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (requireLegacyStageAllowlistPlan
    && manifest.source_policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID
    && !expectedLegacyStageAllowlistEvidence) {
    fail("legacy Stage allowlist manifest evidence is incomplete: immutable_plan");
  }
  return {
    artifactPath: artifact,
    manifestPath: manifestFile,
    ...verifyArchiveBytes({
      compressedBytes: fs.readFileSync(artifact),
      manifest,
      target,
      artifactName: path.basename(artifact),
      expectedLegacyStageAllowlistEvidence,
    }),
  };
}

function bucketRequestPath() {
  return `/storage/v1/bucket/${encodeURIComponent(ARCHIVE_BUCKET)}`;
}

function objectRequestPath(objectPath, mode = "authenticated") {
  const accessSegment = mode ? `/${mode}` : "";
  return `/storage/v1/object${accessSegment}/${encodeURIComponent(ARCHIVE_BUCKET)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
}

export function buildRecoveryArchiveObjectPath(manifestOrSha) {
  const sha = typeof manifestOrSha === "string" ? manifestOrSha : manifestOrSha?.sha256?.compressed_artifact;
  assertSha(sha, "compressed_artifact SHA-256");
  return `recovery/v1/sha256/${sha}.jsonl.gz`;
}

export function buildRecoveryManifestObjectPath(manifestOrSha) {
  const sha = typeof manifestOrSha === "string" ? manifestOrSha : manifestOrSha?.sha256?.compressed_artifact;
  assertSha(sha, "compressed_artifact SHA-256");
  return `recovery/v1/sha256/${sha}.recovery.json.gz`;
}

async function storageRequest(storageTarget, requestPath, options = {}, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  return fetchImpl(`${storageTarget.baseUrl}${requestPath}`, {
    ...options,
    headers: {
      apikey: storageTarget.serviceKey,
      Authorization: `Bearer ${storageTarget.serviceKey}`,
      ...(options.headers || {}),
    },
  });
}

function storageFailure(operation, response) {
  fail(`Storage API ${operation} failed with HTTP ${response.status}`);
}

async function readJsonResponse(response, operation) {
  try {
    return await response.json();
  } catch {
    fail(`Storage API ${operation} returned invalid JSON`);
  }
}

async function isMissingStorageResponse(response) {
  if (response.status === 404) return true;
  if (response.status !== 400) return false;
  const body = await response.text().catch(() => "");
  return /not found|does not exist/i.test(body);
}

function verifyBucket(bucket) {
  if (!bucket || bucket.id !== ARCHIVE_BUCKET || bucket.name !== ARCHIVE_BUCKET) {
    fail("Storage archive bucket has an unexpected name");
  }
  if (bucket.public !== false) fail("Storage archive bucket must be private");
  if (Number(bucket.file_size_limit) !== ARCHIVE_MAX_BYTES) fail("Storage archive bucket has an unexpected file size limit");
  if (!Array.isArray(bucket.allowed_mime_types) || bucket.allowed_mime_types.length !== 1 || bucket.allowed_mime_types[0] !== ARCHIVE_MIME_TYPE) {
    fail("Storage archive bucket has an unexpected MIME policy");
  }
  return bucket;
}

export async function verifyArchiveBucket(storageTarget, deps = {}) {
  const response = await storageRequest(storageTarget, bucketRequestPath(), { method: "GET" }, deps);
  if (!response.ok) storageFailure("bucket verification", response);
  return verifyBucket(await readJsonResponse(response, "bucket verification"));
}

export async function ensureArchiveBucket(storageTarget, deps = {}) {
  let response = await storageRequest(storageTarget, bucketRequestPath(), { method: "GET" }, deps);
  if (await isMissingStorageResponse(response)) {
    const createResponse = await storageRequest(storageTarget, "/storage/v1/bucket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: ARCHIVE_BUCKET,
        name: ARCHIVE_BUCKET,
        public: false,
        allowed_mime_types: [ARCHIVE_MIME_TYPE],
        file_size_limit: ARCHIVE_MAX_BYTES,
      }),
    }, deps);
    if (!createResponse.ok && createResponse.status !== 409) storageFailure("bucket creation", createResponse);
    response = await storageRequest(storageTarget, bucketRequestPath(), { method: "GET" }, deps);
  }
  if (!response.ok) storageFailure("bucket verification/creation", response);
  return verifyBucket(await readJsonResponse(response, "bucket verification/creation"));
}

function manifestRow(manifest, storageTarget, objectPath, legacyStageAllowlistPlan = null) {
  const start = manifest.cursor.start;
  const end = manifest.cursor.end;
  return {
    object_path: objectPath,
    project_ref: storageTarget.projectRef,
    format_version: String(manifest.schema_version),
    cutoff: manifest.cutoff.created_at,
    cursor_start_created_at: start?.created_at || null,
    cursor_start_id: start?.id || null,
    cursor_end_created_at: end?.created_at || null,
    cursor_end_id: end?.id || null,
    first_created_at: manifest.time_range.first_created_at || null,
    last_created_at: manifest.time_range.last_created_at || null,
    transaction_count: String(manifest.batch.transactions),
    entry_count: String(manifest.batch.entries),
    tx_types: manifest.batch.tx_types,
    raw_bytes: String(manifest.bytes.raw),
    compressed_bytes: String(manifest.bytes.compressed),
    raw_sha256: manifest.sha256.raw_jsonl,
    compressed_sha256: manifest.sha256.compressed_artifact,
    credits: manifest.amounts.credits,
    debits: manifest.amounts.debits,
    net_amount: manifest.amounts.net,
    source_policy_id: manifest.source_policy_id || null,
    bot_only_table_id: manifest.bot_only?.table_id || null,
    bot_only_table_count: manifest.bot_only?.table_count == null ? null : String(manifest.bot_only.table_count),
    bot_only_newest_created_at: manifest.bot_only?.newest_created_at || null,
    bot_only_registry_keys_sha256: manifest.bot_only?.registry_keys_sha256 || null,
    bot_only_out_of_scope_keys_sha256: manifest.bot_only?.out_of_scope_keys_sha256 || null,
    bot_only_identity_count: manifest.bot_only?.identity_count == null ? null : String(manifest.bot_only.identity_count),
    bot_only_eligible_count: manifest.bot_only?.eligible_count == null ? null : String(manifest.bot_only.eligible_count),
    legacy_allowlist_sha256: manifest.legacy_stage_allowlist?.allowlist_sha256 || null,
    legacy_batch_table_ids_sha256: manifest.legacy_stage_allowlist?.batch_table_ids_sha256 || null,
    legacy_master_table_ids: manifest.legacy_stage_allowlist?.master_table_ids || null,
    legacy_master_table_count: manifest.legacy_stage_allowlist?.master_table_count == null ? null : String(manifest.legacy_stage_allowlist.master_table_count),
    legacy_batch_number: manifest.legacy_stage_allowlist?.batch_number == null ? null : String(manifest.legacy_stage_allowlist.batch_number),
    legacy_batch_table_count: manifest.legacy_stage_allowlist?.batch_table_count == null ? null : String(manifest.legacy_stage_allowlist.batch_table_count),
    legacy_source_run: manifest.legacy_stage_allowlist?.source_run || null,
    legacy_query_sha256: manifest.legacy_stage_allowlist?.query_sha256 || null,
    legacy_stage_system_identifier: manifest.legacy_stage_allowlist?.stage_system_identifier || null,
    legacy_run_id: legacyStageAllowlistPlan?.runId == null ? null : String(legacyStageAllowlistPlan.runId),
    legacy_plan_sha256: legacyStageAllowlistPlan?.runPlanSha256 || null,
    status: "pending",
  };
}

const IMMUTABLE_FIELDS = [
  "object_path", "project_ref", "format_version", "cutoff", "cursor_start_created_at", "cursor_start_id",
  "cursor_end_created_at", "cursor_end_id", "first_created_at", "last_created_at", "transaction_count",
  "entry_count", "tx_types", "raw_bytes", "compressed_bytes", "raw_sha256", "compressed_sha256", "credits", "debits", "net_amount", "source_policy_id",
  "bot_only_table_id", "bot_only_table_count", "bot_only_newest_created_at", "bot_only_registry_keys_sha256",
  "bot_only_out_of_scope_keys_sha256", "bot_only_identity_count", "bot_only_eligible_count",
  "legacy_allowlist_sha256", "legacy_batch_table_ids_sha256", "legacy_master_table_ids", "legacy_master_table_count", "legacy_batch_number",
  "legacy_batch_table_count", "legacy_source_run", "legacy_query_sha256", "legacy_stage_system_identifier",
  "legacy_run_id", "legacy_plan_sha256",
];

function assertSameManifest(existing, expected) {
  if (!existing) fail("archive manifest disappeared during storage operation");
  if (existing.status !== "pending" && existing.status !== "committed") fail("archive manifest has an invalid state");
  for (const field of IMMUTABLE_FIELDS) {
    if (!sameValue(existing[field], expected[field], field)) fail(`archive manifest differs in immutable field: ${field}`);
  }
  return existing;
}

export async function loadOrCreatePendingBatch(localArchive, storageTarget, deps = {}) {
  const store = deps.manifestStore;
  if (!store || typeof store.get !== "function" || typeof store.insertPending !== "function") fail("manifest store adapter is required");
  const expected = manifestRow(
    localArchive.manifest,
    storageTarget,
    localArchive.objectPath,
    deps.legacyStageAllowlistPlan || null,
  );
  const existing = await store.get(expected.object_path);
  if (existing) return { row: assertSameManifest(existing, expected), created: false, expected };
  await store.insertPending(expected);
  const current = await store.get(expected.object_path);
  return { row: assertSameManifest(current, expected), created: true, expected };
}

function verifyDownloadedBytes(localArchive, downloaded) {
  if (downloaded.length !== localArchive.compressedBytes.length || !downloaded.equals(localArchive.compressedBytes)) {
    fail("downloaded Storage object does not match the local artifact");
  }
  return {
    compressedBytes: downloaded.length,
    compressedSha256: crypto.createHash("sha256").update(downloaded).digest("hex"),
  };
}

async function downloadObject(localArchive, storageTarget, deps = {}) {
  const response = await storageRequest(storageTarget, objectRequestPath(localArchive.objectPath), { method: "GET" }, deps);
  if (!response.ok) return { response, downloaded: null };
  return { response, downloaded: Buffer.from(await response.arrayBuffer()) };
}

export async function downloadPrivateArchiveObject(storageTarget, objectPath, deps = {}) {
  const startedAt = Date.now();
  const response = await storageRequest(storageTarget, objectRequestPath(objectPath), { method: "GET" }, deps);
  if (!response.ok) storageFailure("private object download", response);
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    downloadMs: Date.now() - startedAt,
  };
}

export async function downloadPrivateObjectIfExists(storageTarget, objectPath, deps = {}) {
  const response = await storageRequest(storageTarget, objectRequestPath(objectPath), { method: "GET" }, deps);
  if (await isMissingStorageResponse(response)) return null;
  if (!response.ok) storageFailure("private object download", response);
  if ((response.headers.get("content-type") || "").split(";", 1)[0].trim() !== ARCHIVE_MIME_TYPE) {
    fail(`private recovery object has an unexpected MIME type: ${objectPath}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function uploadOrVerifyPrivateObject({ storageTarget, objectPath, bytes, mimeType = ARCHIVE_MIME_TYPE, deps = {} }) {
  const expected = Buffer.from(bytes || []);
  if (expected.length < 1 || expected.length > ARCHIVE_MAX_BYTES) fail("private recovery object has an invalid size");
  const initial = await storageRequest(storageTarget, objectRequestPath(objectPath), { method: "GET" }, deps);
  let objectExisted = false;
  let uploaded = false;
  if (initial.ok) {
    objectExisted = true;
    if ((initial.headers.get("content-type") || "").split(";", 1)[0].trim() !== mimeType) {
      fail(`private recovery object has an unexpected MIME type: ${objectPath}`);
    }
    const downloaded = Buffer.from(await initial.arrayBuffer());
    if (!downloaded.equals(expected)) fail(`private recovery object differs: ${objectPath}`);
  } else {
    if (!(await isMissingStorageResponse(initial))) storageFailure("private recovery object lookup", initial);
    const upload = await storageRequest(storageTarget, objectRequestPath(objectPath, ""), {
      method: "POST",
      headers: { "content-type": mimeType, "x-upsert": "false" },
      body: expected,
    }, deps);
    if (!upload.ok && upload.status !== 400 && upload.status !== 409) {
      storageFailure("private recovery object upload", upload);
    }
    uploaded = upload.ok;
    objectExisted = !uploaded;
  }
  const verified = await storageRequest(storageTarget, objectRequestPath(objectPath), { method: "GET" }, deps);
  if (!verified.ok) storageFailure("private recovery object verification", verified);
  if ((verified.headers.get("content-type") || "").split(";", 1)[0].trim() !== mimeType) {
    fail(`private recovery object verification has an unexpected MIME type: ${objectPath}`);
  }
  const downloaded = Buffer.from(await verified.arrayBuffer());
  if (!downloaded.equals(expected)) fail(`private recovery object verification differs: ${objectPath}`);
  return {
    objectPath,
    objectExisted,
    uploaded,
    bytes: downloaded.length,
    sha256: crypto.createHash("sha256").update(downloaded).digest("hex"),
  };
}

export async function uploadOrVerifyObject(localArchive, storageTarget, deps = {}) {
  const initialDownloadStarted = Date.now();
  const existing = await downloadObject(localArchive, storageTarget, deps);
  const initialDownloadMs = Date.now() - initialDownloadStarted;
  let objectExisted = false;
  let uploaded = false;
  let uploadMs = 0;
  if (existing.response.ok) {
    objectExisted = true;
    const verified = verifyDownloadedBytes(localArchive, existing.downloaded);
    return { objectExisted, uploaded, uploadMs, downloadMs: initialDownloadMs, ...verified };
  }
  if (!(await isMissingStorageResponse(existing.response))) storageFailure("object lookup", existing.response);
  if (deps.manifestStatus === "committed") fail("committed archive object is missing");
  const uploadStarted = Date.now();
  const uploadResponse = await storageRequest(storageTarget, objectRequestPath(localArchive.objectPath, ""), {
    method: "POST",
    headers: { "content-type": ARCHIVE_MIME_TYPE, "x-upsert": "false" },
    body: localArchive.compressedBytes,
  }, deps);
  uploadMs = Date.now() - uploadStarted;
  if (!uploadResponse.ok && uploadResponse.status !== 400 && uploadResponse.status !== 409) {
    storageFailure("object upload", uploadResponse);
  }
  uploaded = uploadResponse.ok;
  objectExisted = !uploaded;
  const downloadStarted = Date.now();
  const downloaded = await downloadObject(localArchive, storageTarget, deps);
  const downloadMs = Date.now() - downloadStarted;
  if (!downloaded.response.ok) storageFailure("object download", downloaded.response);
  const verified = verifyDownloadedBytes(localArchive, downloaded.downloaded);
  return { objectExisted, uploaded, uploadMs, downloadMs, ...verified };
}

export async function markBatchCommitted(batch, deps = {}) {
  const store = deps.manifestStore;
  if (!store || typeof store.markCommitted !== "function") fail("manifest store adapter is required");
  const committed = await store.markCommitted(batch.expected.object_path);
  const row = assertSameManifest(committed, batch.expected);
  if (row.status !== "committed") fail("archive manifest was not committed");
  return row;
}

function selectManifestSql() {
  return `select
    object_path,
    project_ref,
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
    source_policy_id,
    batch_id::text as batch_id,
    archived_transaction_ids_sha256,
    archived_entry_ids_sha256,
    archive_proof_verified_at::text as archive_proof_verified_at,
    pruned_at::text as pruned_at,
    pruned_transaction_count::text as pruned_transaction_count,
    pruned_entry_count::text as pruned_entry_count,
    pruned_transaction_ids_sha256,
    pruned_entry_ids_sha256,
    bot_only_table_id::text as bot_only_table_id,
    bot_only_table_count::text as bot_only_table_count,
    bot_only_newest_created_at::text as bot_only_newest_created_at,
    bot_only_registry_keys_sha256,
    bot_only_out_of_scope_keys_sha256,
    bot_only_identity_count::text as bot_only_identity_count,
    bot_only_eligible_count::text as bot_only_eligible_count,
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
    registry_cleaned_at::text as registry_cleaned_at,
    registry_cleaned_key_count::text as registry_cleaned_key_count,
    registry_cleaned_keys_sha256,
    destructive_go_at::text as destructive_go_at,
    destructive_go_batch_id::text as destructive_go_batch_id,
    status
  from public.chips_ledger_archive_batches
  where object_path = $1;`;
}

function normalizeManifestRow(row) {
  if (!row) return null;
  return {
    ...row,
    format_version: String(row.format_version),
    tx_types: typeof row.tx_types === "string" ? JSON.parse(row.tx_types) : row.tx_types,
    transaction_count: String(row.transaction_count),
    entry_count: String(row.entry_count),
    raw_bytes: String(row.raw_bytes),
    compressed_bytes: String(row.compressed_bytes),
    credits: String(row.credits),
    debits: String(row.debits),
    net_amount: String(row.net_amount),
    source_policy_id: row.source_policy_id || null,
    batch_id: row.batch_id == null ? null : String(row.batch_id),
    bot_only_table_count: row.bot_only_table_count == null ? null : String(row.bot_only_table_count),
    bot_only_identity_count: row.bot_only_identity_count == null ? null : String(row.bot_only_identity_count),
    bot_only_eligible_count: row.bot_only_eligible_count == null ? null : String(row.bot_only_eligible_count),
    legacy_master_table_count: row.legacy_master_table_count == null ? null : String(row.legacy_master_table_count),
    legacy_batch_number: row.legacy_batch_number == null ? null : String(row.legacy_batch_number),
    legacy_batch_table_count: row.legacy_batch_table_count == null ? null : String(row.legacy_batch_table_count),
    legacy_run_id: row.legacy_run_id == null ? null : String(row.legacy_run_id),
    legacy_plan_sha256: row.legacy_plan_sha256 == null ? null : String(row.legacy_plan_sha256),
    registry_cleaned_key_count: row.registry_cleaned_key_count == null ? null : String(row.registry_cleaned_key_count),
    destructive_go_batch_id: row.destructive_go_batch_id == null ? null : String(row.destructive_go_batch_id),
  };
}

export function createManifestStore(sql) {
  if (!sql || typeof sql.unsafe !== "function") fail("postgres manifest adapter is required");
  const timestampParam = (value) => value == null || typeof sql.typed !== "function" ? value : sql.typed(value, 25);
  const get = async (objectPath) => {
    const rows = await sql.unsafe(selectManifestSql(), [objectPath]);
    return normalizeManifestRow(rows[0]);
  };
  return {
    get,
    async insertPending(row) {
      await sql.unsafe(`insert into public.chips_ledger_archive_batches
        (object_path, project_ref, format_version, cutoff, cursor_start_created_at, cursor_start_id,
         cursor_end_created_at, cursor_end_id, first_created_at, last_created_at, transaction_count,
         entry_count, tx_types, raw_bytes, compressed_bytes, raw_sha256, compressed_sha256,
         credits, debits, net_amount, source_policy_id,
         bot_only_table_id, bot_only_table_count, bot_only_newest_created_at,
         bot_only_registry_keys_sha256, bot_only_out_of_scope_keys_sha256,
         bot_only_identity_count, bot_only_eligible_count,
         legacy_allowlist_sha256, legacy_batch_table_ids_sha256, legacy_master_table_ids,
         legacy_master_table_count, legacy_batch_number, legacy_batch_table_count, legacy_source_run, legacy_query_sha256,
         legacy_stage_system_identifier, legacy_run_id, legacy_plan_sha256, status)
        values ($1, $2, $3::integer, $4::timestamptz, $5::timestamptz, $6::uuid,
                $7::timestamptz, $8::uuid, $9::timestamptz, $10::timestamptz, $11::bigint,
                $12::bigint, $13::jsonb, $14::bigint, $15::bigint, $16, $17,
                $18::numeric, $19::numeric, $20::numeric, $21,
                $22::uuid, $23::bigint, $24::timestamptz, $25, $26, $27::bigint, $28::bigint,
                $29, $30, $31::uuid[], $32::bigint, $33::bigint, $34::bigint, $35, $36, $37, $38::bigint, $39, 'pending')
        on conflict (object_path) do nothing;`, [
        row.object_path, row.project_ref, row.format_version, timestampParam(row.cutoff), timestampParam(row.cursor_start_created_at), row.cursor_start_id,
        timestampParam(row.cursor_end_created_at), row.cursor_end_id, timestampParam(row.first_created_at), timestampParam(row.last_created_at), row.transaction_count,
        row.entry_count, row.tx_types, row.raw_bytes, row.compressed_bytes, row.raw_sha256, row.compressed_sha256,
        row.credits, row.debits, row.net_amount, row.source_policy_id,
        row.bot_only_table_id, row.bot_only_table_count, timestampParam(row.bot_only_newest_created_at),
        row.bot_only_registry_keys_sha256, row.bot_only_out_of_scope_keys_sha256,
        row.bot_only_identity_count, row.bot_only_eligible_count,
        row.legacy_allowlist_sha256, row.legacy_batch_table_ids_sha256, row.legacy_master_table_ids,
        row.legacy_master_table_count, row.legacy_batch_number, row.legacy_batch_table_count,
        row.legacy_source_run, row.legacy_query_sha256, row.legacy_stage_system_identifier,
        row.legacy_run_id, row.legacy_plan_sha256,
      ]);
    },
    async markCommitted(objectPath) {
      const rows = await sql.unsafe(`update public.chips_ledger_archive_batches
        set status = 'committed', committed_at = timezone('utc', now())
        where object_path = $1 and status = 'pending'
        returning object_path;`, [objectPath]);
      if (!rows.length) return get(objectPath);
      return get(objectPath);
    },
  };
}

function outputMetrics(result) {
  process.stdout.write(`${stringifyJson({
    event: "chips_ledger_archive_store",
    read_only_ledger: true,
    target: result.target,
    project_ref: result.projectRef,
    bucket: ARCHIVE_BUCKET,
    object_path: result.objectPath,
    status: result.manifest.status,
    idempotent: result.idempotent,
    transactions: result.local.summary.transactionCount,
    entries: result.local.summary.entryCount,
    tx_types: result.local.manifest.batch.tx_types,
    amounts: result.local.manifest.amounts,
    raw_bytes: result.local.manifest.bytes.raw,
    compressed_bytes: result.local.manifest.bytes.compressed,
    sha256: result.local.manifest.sha256,
    uploaded: result.object.uploaded,
    object_existed: result.object.objectExisted,
    upload_ms: result.object.uploadMs,
    download_ms: result.object.downloadMs,
  })}\n`);
}

export async function storeArchive({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), deps = {} } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return null;
  }
  if (!args.target) fail("--target is required; no default target is allowed");
  if (!args.artifact) fail("--artifact is required; no default path is allowed");
  if (!args.manifest) fail("--manifest is required; no default path is allowed");
  const storageTarget = deps.storageTarget || resolveStorageTarget(args.target, env, deps.targetOptions || {});
  const expectedLegacyStageAllowlistEvidence = deps.legacyStageAllowlistPlan?.archiveManifest
    ? structuredClone(deps.legacyStageAllowlistPlan.archiveManifest)
    : null;
  const local = verifyLocalArchive({
    artifactPath: path.resolve(cwd, args.artifact),
    manifestPath: path.resolve(cwd, args.manifest),
    target: storageTarget,
    expectedLegacyStageAllowlistEvidence,
    requireLegacyStageAllowlistPlan: true,
  });
  const sql = deps.sql || (deps.manifestStore ? null : postgres(storageTarget.dbUrl, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 30 }));
  const manifestStore = deps.manifestStore || createManifestStore(sql);
  const adapterDeps = { ...deps, manifestStore };
  try {
    const batch = await loadOrCreatePendingBatch(local, storageTarget, adapterDeps);
    await ensureArchiveBucket(storageTarget, deps);
    const object = await uploadOrVerifyObject(local, storageTarget, { ...deps, manifestStatus: batch.row.status });
    const manifest = await markBatchCommitted(batch, adapterDeps);
    const result = {
      target: storageTarget.target,
      projectRef: storageTarget.projectRef,
      objectPath: local.objectPath,
      local,
      object,
      manifest,
      idempotent: manifest.status === "committed" && !object.uploaded,
    };
    if (deps.emit !== false) outputMetrics(result);
    return result;
  } finally {
    if (sql && !deps.sql) await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  storeArchive().catch((error) => {
    process.stderr.write(`chips-ledger-archive-store failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
