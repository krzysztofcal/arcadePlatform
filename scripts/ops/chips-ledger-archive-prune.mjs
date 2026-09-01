import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  BOT_ONLY_EXPORT_SCHEMA_VERSION,
  BOT_ONLY_RETENTION_POLICY_ID,
  LEGACY_STAGE_ALLOWLIST_POLICY_ID,
  LEGACY_STAGE_ALLOWLIST_TABLE_COUNT,
  assertLegacyStageAllowlistEvidence,
  maxBatchSizeForTarget,
  stringifyJson,
} from "./chips-ledger-archive-export.mjs";
import {
  ARCHIVE_BUCKET,
  buildObjectPath,
  downloadPrivateArchiveObject,
  resolveStorageTarget,
  verifyArchiveBucket,
  verifyArchiveBytes,
} from "./chips-ledger-archive-store.mjs";
import {
  assertPrivateRegularFile,
  ensurePrivateDirectory,
  writeExclusiveFiles,
} from "./_shared/chips-ledger-archive-files.mjs";
import { assertTableBinding } from "./_shared/chips-table-idempotency.mjs";

export const STAGE_SYSTEM_IDENTIFIER = "7656985631720456337";
export const PRODUCTION_SYSTEM_IDENTIFIER = "7575202818581710058";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ENTRY_ID_RE = /^[1-9][0-9]*$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ALLOWED_TX_TYPES = new Set(["TABLE_BUY_IN", "TABLE_CASH_OUT"]);
const MAX_BATCH_SIZE = maxBatchSizeForTarget("stage");
const MAX_EXECUTE_ATTEMPTS = 3;
export const MAX_AUTOMATIC_CLEANUP_ATTEMPTS = 3;
export const AUTOMATIC_CLEANUP_RETRY_BACKOFF_MS = Object.freeze([100, 250]);
const RETRYABLE_CLEANUP_SQLSTATES = new Set(["40001", "55P03"]);
const LEGACY_EXECUTE_RECEIPT_FIELDS = Object.freeze([
  "pruned_at",
  "pruned_transaction_count",
  "pruned_entry_count",
  "pruned_transaction_ids_sha256",
  "pruned_entry_ids_sha256",
  "registry_cleaned_at",
  "registry_cleaned_key_count",
  "registry_cleaned_keys_sha256",
]);

const HELP = `Usage: node scripts/ops/chips-ledger-archive-prune.mjs [options]

Required:
  --target stage|prod            Explicit canonical target; no default.
  --object-path <path>           Committed v1/sha256/<sha>.jsonl.gz object.
  --confirm-sha <sha256>         Explicit compressed object SHA-256 confirmation.

Modes (mutually exclusive):
  default                        Validate Storage and run a database dry-run.
  --register-proof               Persist immutable ordered transaction/entry ID proof.
  --execute                      Prune exact proof-bound IDs after all checks.
  --approved-batch-id <integer> Exact schema-v2 bot-only GO batch (execute only).

Execute-only:
  --recovery-dir <path>          Required private 0700 recovery directory.

The command processes one batch of at most 5000 Stage or 2 Production
transactions, never overwrites recovery files, never changes balances, and
never mutates Storage.
`;

function fail(message, code = null) {
  const error = new Error(message);
  if (code) error.code = code;
  throw error;
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

export function sqlStateOf(error) {
  const candidates = [
    error?.code,
    error?.sqlstate,
    error?.sqlState,
    error?.cause?.code,
    error?.cause?.sqlstate,
    error?.cause?.sqlState,
  ];
  for (const candidate of candidates) {
    const value = text(candidate).toUpperCase();
    if (/^[0-9A-Z]{5}$/.test(value)) return value;
  }
  return null;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalUuid(value, label) {
  if (typeof value !== "string" || !UUID_RE.test(value)) fail(`${label} must be a lowercase canonical UUID`);
  return value;
}

function canonicalEntryId(value) {
  if (typeof value !== "string" || !ENTRY_ID_RE.test(value) || BigInt(value).toString(10) !== value) {
    fail("entry.id must be a canonical positive decimal bigint string");
  }
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashCanonicalLines(values) {
  return sha256(Buffer.from(values.map((value) => `${value}\n`).join(""), "utf8"));
}

export function computeArchiveIdProofs(records, { maxBatchSize = MAX_BATCH_SIZE } = {}) {
  if (!Array.isArray(records) || records.length < 1 || records.length > maxBatchSize) {
    fail(`archive proof requires 1 to ${maxBatchSize} transaction records`);
  }
  const transactionIds = [];
  const entryIds = [];
  for (const record of records) {
    transactionIds.push(canonicalUuid(record?.transaction?.id, "transaction.id"));
    if (!Array.isArray(record?.entries) || record.entries.length === 0) fail("archive transaction has no entries");
    for (const entry of record.entries) entryIds.push(canonicalEntryId(entry?.id));
  }
  if (new Set(transactionIds).size !== transactionIds.length || new Set(entryIds).size !== entryIds.length) {
    fail("archive proof contains duplicate IDs");
  }
  return {
    transactionIds,
    entryIds,
    transactionIdsSha256: hashCanonicalLines(transactionIds),
    entryIdsSha256: hashCanonicalLines(entryIds),
  };
}

function addTableMarker(markers, value) {
  const marker = text(value).toLowerCase();
  if (!marker) return;
  if (!UUID_RE.test(marker)) fail("archive transaction contains an invalid table marker");
  markers.add(marker);
}

function tableIdForRecord(record) {
  const markers = new Set();
  const metadata = record?.transaction?.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) addTableMarker(markers, metadata.tableId);
  const reference = text(record?.transaction?.reference);
  const normalizedReference = reference.toLowerCase();
  if (normalizedReference.startsWith("table:") || normalizedReference.startsWith("poker-rebuy:")) {
    addTableMarker(markers, reference.split(":")[1]);
  }
  for (const entry of record.entries) {
    const systemKey = text(entry?.account?.system_key);
    if (text(entry?.account?.account_type).toUpperCase() === "ESCROW" && systemKey.toUpperCase().startsWith("POKER_TABLE:")) {
      addTableMarker(markers, systemKey.slice("POKER_TABLE:".length));
    }
  }
  addTableMarker(markers, record?.table_context?.table_id);
  if (markers.size !== 1) fail("archive transaction must have exactly one unambiguous table marker");
  return [...markers][0];
}

export function buildPruneEvidence(localArchive, { maxBatchSize = MAX_BATCH_SIZE } = {}) {
  const proofs = computeArchiveIdProofs(localArchive.records, { maxBatchSize });
  const txTypes = {};
  const tables = new Set();
  let userTransactions = 0;
  let userEntries = 0;
  const registryKeys = [];
  const tableIds = new Set();
  const replayPairs = [];

  for (const record of localArchive.records) {
    const transaction = record.transaction;
    const txType = text(transaction.tx_type);
    if (!ALLOWED_TX_TYPES.has(txType)) fail(`archive tx_type is outside the technical whitelist: ${txType}`);
    if (transaction.user_id !== null) userTransactions += 1;
    const tableId = tableIdForRecord(record);
    tables.add(tableId);
    const isLegacyAllowlist = localArchive.manifest.schema_version === BOT_ONLY_EXPORT_SCHEMA_VERSION
      && localArchive.manifest.source_policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID;
    if (localArchive.manifest.schema_version === BOT_ONLY_EXPORT_SCHEMA_VERSION && !isLegacyAllowlist) {
      const parsedBinding = assertTableBinding({
        idempotencyKey: transaction.idempotency_key,
        metadata: transaction.metadata,
        reference: transaction.reference,
      });
      if (transaction.user_id !== null || record.table_context?.bot_only_proof?.has_human_participant !== false
        || record.table_context?.bot_only_proof?.proof_eligible !== true
        || record.table_context?.bot_only_proof?.table_id_from_key !== tableId
        || parsedBinding.tableId !== tableId
        || record.table_context?.bot_only_proof?.key_format !== parsedBinding.format) {
        fail("schema-v2 archive is not proven bot-only");
      }
      registryKeys.push(text(transaction.idempotency_key));
      tableIds.add(tableId);
    } else if (isLegacyAllowlist) {
      const proof = record.table_context?.legacy_stage_allowlist;
      if (!proof || proof.policy_id !== LEGACY_STAGE_ALLOWLIST_POLICY_ID
        || proof.allowlist_sha256 !== localArchive.manifest.legacy_stage_allowlist?.allowlist_sha256
        || proof.batch_table_ids_sha256 !== localArchive.manifest.legacy_stage_allowlist?.batch_table_ids_sha256
        || proof.source_run !== "32753223679"
        || proof.stage_system_identifier !== "7656985631720456337"
        || proof.master_table_count !== 974
        || transaction.user_id !== null) {
        fail("schema-v2 legacy allowlist proof is incomplete");
      }
      registryKeys.push(text(transaction.idempotency_key));
      tableIds.add(tableId);
      replayPairs.push({
        idempotencyKey: text(transaction.idempotency_key),
        tableId,
        transactionId: text(transaction.id),
      });
    }
    if (record.entries.length !== 2) fail("technical archive transaction must contain exactly two entries");

    const systemEntries = record.entries.filter((entry) => text(entry?.account?.account_type).toUpperCase() === "SYSTEM");
    const escrowEntries = record.entries.filter((entry) => text(entry?.account?.account_type).toUpperCase() === "ESCROW");
    const recordUserEntries = record.entries.filter((entry) => text(entry?.account?.account_type).toUpperCase() === "USER").length;
    userEntries += recordUserEntries;
    if (escrowEntries.length !== 1 || (recordUserEntries === 0 && systemEntries.length !== 1)) {
      fail("technical archive transaction must contain one SYSTEM and one ESCROW entry and no USER entry");
    }
    if (text(escrowEntries[0].account.system_key) !== `POKER_TABLE:${tableId}`) {
      fail("archive escrow entry does not match its table marker");
    }
    if (recordUserEntries === 0) {
      const systemAmount = BigInt(systemEntries[0].amount);
      const escrowAmount = BigInt(escrowEntries[0].amount);
      if (systemAmount + escrowAmount !== 0n) fail("technical archive transaction is not conserved");
      if (txType === "TABLE_BUY_IN" && !(systemAmount < 0n && escrowAmount > 0n)) {
        fail("TABLE_BUY_IN archive entry direction is invalid");
      }
      if (txType === "TABLE_CASH_OUT" && !(escrowAmount < 0n && systemAmount > 0n)) {
        fail("TABLE_CASH_OUT archive entry direction is invalid");
      }
    }
    txTypes[txType] = (txTypes[txType] || 0) + 1;
  }
  if (userTransactions !== 0 || userEntries !== 0) {
    fail(`cannot prune USER ledger history (user_transactions=${userTransactions}, user_entries=${userEntries}, distinct_tables=${tables.size})`);
  }
  if (canonicalJson(txTypes) !== canonicalJson(localArchive.manifest.batch.tx_types)) fail("technical tx_type evidence differs from archive manifest");
  if (localArchive.manifest.schema_version === BOT_ONLY_EXPORT_SCHEMA_VERSION
    && localArchive.manifest.source_policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID) {
    const legacy = localArchive.manifest.legacy_stage_allowlist;
    const masterIds = [...(legacy?.master_table_ids || [])].sort();
    if (masterIds.length !== LEGACY_STAGE_ALLOWLIST_TABLE_COUNT
      || new Set(masterIds).size !== masterIds.length
      || masterIds.some((id) => !UUID_RE.test(id))) {
      fail("legacy allowlist master identity set is incomplete");
    }
    const masterHash = hashCanonicalLines(masterIds);
    if (masterHash !== text(legacy.allowlist_sha256)) fail("legacy allowlist master identity hash differs from the manifest");
    if (tables.size < 1 || tables.size !== [...tableIds].length) fail("legacy allowlist batch table set is empty");
    const batchHash = hashCanonicalLines([...tableIds].sort());
    if (batchHash !== text(legacy.batch_table_ids_sha256)) fail("legacy allowlist batch table identity hash differs from the manifest");
  }
  return {
    ...proofs,
    transactionCount: proofs.transactionIds.length,
    entryCount: proofs.entryIds.length,
    txTypes,
    userTransactions,
    userEntries,
    distinctTables: tables.size,
    credits: localArchive.summary.credits,
    debits: localArchive.summary.debits,
    net: localArchive.summary.netAmount,
    ...(localArchive.manifest.schema_version === BOT_ONLY_EXPORT_SCHEMA_VERSION
      && localArchive.manifest.source_policy_id !== LEGACY_STAGE_ALLOWLIST_POLICY_ID ? {
      registryKeys: [...registryKeys].sort(),
      registryKeysSha256: hashCanonicalLines([...registryKeys].sort()),
      tableId: tableIds.size === 1 ? [...tableIds][0] : null,
      outOfScopeKeysSha256: text(localArchive.manifest.bot_only?.out_of_scope_keys_sha256),
    } : {}),
    ...(localArchive.manifest.schema_version === BOT_ONLY_EXPORT_SCHEMA_VERSION
      && localArchive.manifest.source_policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID ? {
      registryKeys: [...registryKeys].sort(),
      registryKeysSha256: hashCanonicalLines([...registryKeys].sort()),
      legacyTableIds: [...tableIds].sort(),
      legacyTableIdsSha256: hashCanonicalLines([...tableIds].sort()),
      legacyMasterTableIds: [...(localArchive.manifest.legacy_stage_allowlist?.master_table_ids || [])].sort(),
      legacyMasterTableIdsSha256: hashCanonicalLines([...(localArchive.manifest.legacy_stage_allowlist?.master_table_ids || [])].sort()),
      legacyAllowlistSha256: text(localArchive.manifest.legacy_stage_allowlist?.allowlist_sha256),
      legacyBatchTableIdsSha256: text(localArchive.manifest.legacy_stage_allowlist?.batch_table_ids_sha256),
      replayPairs,
      replayPair: replayPairs[0] || null,
    } : {}),
  };
}

function parseArgs(argv) {
  const valueArgs = new Map([
    ["--target", "target"],
    ["--object-path", "objectPath"],
    ["--confirm-sha", "confirmSha"],
    ["--recovery-dir", "recoveryDir"],
    ["--approved-batch-id", "approvedBatchId"],
  ]);
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--register-proof" || token === "--execute" || token === "--automatic") {
      const key = token === "--register-proof" ? "registerProof" : token === "--execute" ? "execute" : "automatic";
      if (args[key]) fail(`${token} was supplied more than once`);
      args[key] = true;
      continue;
    }
    const key = valueArgs.get(token);
    if (!key) fail(`unknown argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${token} requires a value`);
    if (args[key] !== undefined) fail(`${token} was supplied more than once`);
    args[key] = value;
    index += 1;
  }
  if (args.registerProof && args.execute) fail("--register-proof and --execute are mutually exclusive");
  if (args.automatic && !args.execute) fail("--automatic is only valid with --execute");
  return args;
}

function targetPolicy(target) {
  if (target === "stage") {
    return {
      target,
      projectRef: "krydukthwdvccggbyjfw",
      systemIdentifier: STAGE_SYSTEM_IDENTIFIER,
      maxBatchSize: maxBatchSizeForTarget(target),
    };
  }
  if (target === "prod") {
    return {
      target,
      projectRef: "otbqfijerkieoxwpxjnm",
      systemIdentifier: PRODUCTION_SYSTEM_IDENTIFIER,
      maxBatchSize: maxBatchSizeForTarget(target),
    };
  }
  fail("target must be exactly stage or prod");
}

function assertTargetIdentity(identity, manifest, target) {
  const policy = targetPolicy(target.target);
  if (identity !== policy.systemIdentifier) fail(`database is not canonical ${target.label}`);
  if (manifest.project_ref !== policy.projectRef) fail(`archive manifest is not canonical ${target.label}`);
}

function parseManifestRow(row) {
  if (!row) fail("archive manifest was not found");
  return {
    ...row,
    format_version: Number(row.format_version),
    transaction_count: Number(row.transaction_count),
    entry_count: Number(row.entry_count),
    tx_types: typeof row.tx_types === "string" ? JSON.parse(row.tx_types) : row.tx_types,
    raw_bytes: Number(row.raw_bytes),
    compressed_bytes: Number(row.compressed_bytes),
    credits: String(row.credits),
    debits: String(row.debits),
    net_amount: String(row.net_amount),
    batch_id: String(row.batch_id),
    bot_only_table_count: row.bot_only_table_count == null ? null : Number(row.bot_only_table_count),
    bot_only_identity_count: row.bot_only_identity_count == null ? null : Number(row.bot_only_identity_count),
    bot_only_eligible_count: row.bot_only_eligible_count == null ? null : Number(row.bot_only_eligible_count),
    registry_cleaned_key_count: row.registry_cleaned_key_count == null ? null : Number(row.registry_cleaned_key_count),
    legacy_master_table_count: row.legacy_master_table_count == null ? null : Number(row.legacy_master_table_count),
    legacy_batch_number: row.legacy_batch_number == null ? null : Number(row.legacy_batch_number),
    legacy_batch_table_count: row.legacy_batch_table_count == null ? null : Number(row.legacy_batch_table_count),
    legacy_run_id: row.legacy_run_id == null ? null : String(row.legacy_run_id),
    destructive_go_batch_id: row.destructive_go_batch_id == null ? null : Number(row.destructive_go_batch_id),
  };
}

function legacyStageAllowlistEvidenceFromDatabaseRow(row, expectedEvidence) {
  if (!expectedEvidence || typeof expectedEvidence !== "object" || Array.isArray(expectedEvidence)) {
    fail("legacy Stage allowlist manifest evidence is incomplete: immutable_plan");
  }
  const reconstructed = {
    ...structuredClone(expectedEvidence),
    // The database persists these fields. They must agree with the immutable
    // plan; proof_basis is derived from the persisted policy identity, never
    // supplied as a default.
    policy_id: row.source_policy_id,
    proof_basis: row.source_policy_id,
    allowlist_sha256: row.legacy_allowlist_sha256,
    batch_table_ids_sha256: row.legacy_batch_table_ids_sha256,
    master_table_ids: row.legacy_master_table_ids,
    master_table_count: Number(row.legacy_master_table_count),
    batch_number: Number(row.legacy_batch_number),
    batch_table_count: Number(row.legacy_batch_table_count),
    source_run: row.legacy_source_run,
    query_sha256: row.legacy_query_sha256,
    stage_system_identifier: row.legacy_stage_system_identifier,
  };
  assertLegacyStageAllowlistEvidence(reconstructed, expectedEvidence);
  return reconstructed;
}

function exporterManifestFromDatabase(row, target, legacyStageAllowlistPlan = null) {
  const ratio = row.raw_bytes === 0 ? null : Number((row.compressed_bytes / row.raw_bytes).toFixed(6));
  const cursorStart = row.cursor_start_created_at ? { created_at: row.cursor_start_created_at, id: row.cursor_start_id } : null;
  const cursorEnd = row.cursor_end_created_at ? { created_at: row.cursor_end_created_at, id: row.cursor_end_id } : null;
  const legacyStageAllowlist = row.format_version === BOT_ONLY_EXPORT_SCHEMA_VERSION
    && row.source_policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID
    ? legacyStageAllowlistEvidenceFromDatabaseRow(row, legacyStageAllowlistPlan?.archiveManifest)
    : null;
  return {
    schema_version: row.format_version,
    artifact_type: "chips_ledger_archive",
    format: "jsonl.gz",
    target: target.target,
    cutoff: { created_at: row.cutoff, rule: "transaction.created_at < cutoff" },
    batch: {
      limit: targetPolicy(target.target).maxBatchSize,
      transactions: row.transaction_count,
      entries: row.entry_count,
      tx_types: row.tx_types,
    },
    amounts: { credits: row.credits, debits: row.debits, net: row.net_amount },
    time_range: { first_created_at: row.first_created_at, last_created_at: row.last_created_at },
    cursor: {
      order: ["transaction.created_at ASC", "transaction.id ASC"],
      start: cursorStart,
      end: cursorEnd,
      next: cursorEnd,
    },
    bytes: {
      raw: row.raw_bytes,
      compressed: row.compressed_bytes,
      compression_ratio_compressed_over_raw: ratio,
    },
    sha256: { raw_jsonl: row.raw_sha256, compressed_artifact: row.compressed_sha256 },
    artifact: path.basename(row.object_path),
    ...(row.source_policy_id ? { source_policy_id: row.source_policy_id } : {}),
    ...(row.format_version === BOT_ONLY_EXPORT_SCHEMA_VERSION
      && row.source_policy_id !== LEGACY_STAGE_ALLOWLIST_POLICY_ID ? {
      bot_only: {
        table_id: row.bot_only_table_id,
        table_count: Number(row.bot_only_table_count),
        newest_created_at: row.bot_only_newest_created_at,
        registry_keys_sha256: row.bot_only_registry_keys_sha256,
        out_of_scope_keys_sha256: row.bot_only_out_of_scope_keys_sha256,
        identity_count: Number(row.bot_only_identity_count),
        eligible_count: Number(row.bot_only_eligible_count),
      },
    } : {}),
    ...(row.format_version === BOT_ONLY_EXPORT_SCHEMA_VERSION
      && row.source_policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID ? {
      legacy_stage_allowlist: legacyStageAllowlist,
    } : {}),
  };
}

export function buildRecoveryManifest(row, identity, evidence, target) {
  return {
    recovery_schema_version: 1,
    artifact_type: "chips_ledger_archive_prune_recovery",
    target: target.target,
    project_ref: row.project_ref,
    source_policy_id: row.source_policy_id || null,
    postgres_system_identifier: identity,
    bucket: ARCHIVE_BUCKET,
    object_path: row.object_path,
    archive: {
      batch_id: row.batch_id,
      format_version: row.format_version,
      cutoff: row.cutoff,
      cursor_start_created_at: row.cursor_start_created_at,
      cursor_start_id: row.cursor_start_id,
      cursor_end_created_at: row.cursor_end_created_at,
      cursor_end_id: row.cursor_end_id,
      first_created_at: row.first_created_at,
      last_created_at: row.last_created_at,
      transaction_count: row.transaction_count,
      entry_count: row.entry_count,
      tx_types: row.tx_types,
      raw_bytes: row.raw_bytes,
      compressed_bytes: row.compressed_bytes,
      raw_sha256: row.raw_sha256,
      compressed_sha256: row.compressed_sha256,
      credits: row.credits,
      debits: row.debits,
      net_amount: row.net_amount,
    },
    id_proof: {
      transaction_ids_sha256: evidence.transactionIdsSha256,
      entry_ids_sha256: evidence.entryIdsSha256,
    },
    ...(row.format_version === BOT_ONLY_EXPORT_SCHEMA_VERSION
      && row.source_policy_id !== LEGACY_STAGE_ALLOWLIST_POLICY_ID ? {
      bot_only: {
        table_id: row.bot_only_table_id || evidence.tableId,
        table_count: row.bot_only_table_count || 1,
        registry_keys_sha256: row.bot_only_registry_keys_sha256 || evidence.registryKeysSha256,
        registry_key_count: evidence.registryKeys?.length || 0,
        out_of_scope_keys_sha256: row.bot_only_out_of_scope_keys_sha256 || evidence.outOfScopeKeysSha256,
      },
    } : {}),
    ...(row.format_version === BOT_ONLY_EXPORT_SCHEMA_VERSION
      && row.source_policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID ? {
      legacy_stage_allowlist: {
        policy_id: LEGACY_STAGE_ALLOWLIST_POLICY_ID,
        allowlist_sha256: row.legacy_allowlist_sha256 || evidence.legacyAllowlistSha256,
        batch_table_ids_sha256: row.legacy_batch_table_ids_sha256 || evidence.legacyBatchTableIdsSha256,
        master_table_ids: row.legacy_master_table_ids || evidence.legacyMasterTableIds,
        master_table_ids_sha256: evidence.legacyMasterTableIdsSha256,
        source_run: row.legacy_source_run,
        query_sha256: row.legacy_query_sha256,
        stage_system_identifier: row.legacy_stage_system_identifier,
        master_table_count: Number(row.legacy_master_table_count),
        batch_number: Number(row.legacy_batch_number),
        batch_table_count: Number(row.legacy_batch_table_count),
      },
    } : {}),
  };
}

export function writeRecoveryBundle({ recoveryDir, archiveBytes, row, identity, evidence, target }) {
  const directory = ensurePrivateDirectory(recoveryDir);
  const baseName = `chips-ledger-${row.compressed_sha256}`;
  const artifactPath = path.join(directory, `${baseName}.jsonl.gz`);
  const manifestPath = path.join(directory, `${baseName}.recovery.json`);
  const manifest = buildRecoveryManifest(row, identity, evidence, target);
  const manifestBytes = Buffer.from(`${stringifyJson(manifest)}\n`, "utf8");
  const artifactExists = fs.existsSync(artifactPath);
  const manifestExists = fs.existsSync(manifestPath);
  if (artifactExists !== manifestExists) fail("recovery bundle is partial; refusing to overwrite it");
  let reused = false;
  if (artifactExists) {
    assertPrivateRegularFile(artifactPath);
    assertPrivateRegularFile(manifestPath);
    if (!fs.readFileSync(artifactPath).equals(archiveBytes) || !fs.readFileSync(manifestPath).equals(manifestBytes)) {
      fail("existing recovery bundle differs from the verified archive");
    }
    reused = true;
  } else {
    writeExclusiveFiles([
      { path: artifactPath, data: archiveBytes },
      { path: manifestPath, data: manifestBytes },
    ], { createDirectories: false });
  }
  assertPrivateRegularFile(artifactPath);
  assertPrivateRegularFile(manifestPath);
  return { directory, artifactPath, manifestPath, manifest, reused };
}

export function verifyRecoveryBundle({
  bundle,
  row,
  target,
  identity,
  expectedEvidence,
  expectedLegacyStageAllowlistEvidence = null,
}) {
  ensurePrivateDirectory(bundle.directory);
  assertPrivateRegularFile(bundle.artifactPath);
  assertPrivateRegularFile(bundle.manifestPath);
  const manifest = JSON.parse(fs.readFileSync(bundle.manifestPath, "utf8"));
  const expectedManifest = buildRecoveryManifest(row, identity, expectedEvidence, target);
  if (canonicalJson(manifest) !== canonicalJson(expectedManifest)) fail("recovery manifest no longer matches archive evidence");
  const verified = verifyArchiveBytes({
    compressedBytes: fs.readFileSync(bundle.artifactPath),
    manifest: exporterManifestFromDatabase(row, target, expectedLegacyStageAllowlistEvidence
      ? { archiveManifest: expectedLegacyStageAllowlistEvidence }
      : null),
    target,
    artifactName: path.basename(row.object_path),
    expectedLegacyStageAllowlistEvidence,
  });
  const evidence = buildPruneEvidence(verified, { maxBatchSize: targetPolicy(target.target).maxBatchSize });
  if (evidence.transactionIdsSha256 !== expectedEvidence.transactionIdsSha256
    || evidence.entryIdsSha256 !== expectedEvidence.entryIdsSha256) {
    fail("recovery archive ID proof no longer matches");
  }
  return { verified, evidence };
}

function manifestSelectSql() {
  return `select
    object_path, batch_id::text as batch_id, project_ref, format_version::text as format_version,
    cutoff::text as cutoff, cursor_start_created_at::text as cursor_start_created_at,
    cursor_start_id::text as cursor_start_id, cursor_end_created_at::text as cursor_end_created_at,
    cursor_end_id::text as cursor_end_id, first_created_at::text as first_created_at,
    last_created_at::text as last_created_at, transaction_count::text as transaction_count,
    entry_count::text as entry_count, tx_types::text as tx_types, raw_bytes::text as raw_bytes,
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
    exists (
      select 1
        from public.poker_tables tables
       where tables.id = batches.bot_only_table_id
    ) as bot_only_table_exists,
    (select tables.bot_only_retention_complete_at::text
       from public.poker_tables tables
      where tables.id = batches.bot_only_table_id) as bot_only_retention_complete_at,
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
    destructive_go_batch_id::text as destructive_go_batch_id
  from public.chips_ledger_archive_batches batches where batches.object_path = $1;`;
}

export function createPruneStore(sql) {
  if (!sql || typeof sql.unsafe !== "function" || typeof sql.begin !== "function") fail("PostgreSQL prune adapter is required");
  const timestampParam = (value) => value == null || typeof sql.typed !== "function" ? value : sql.typed(value, 25);
  return {
    async getIdentity() {
      const rows = await sql.unsafe("select system_identifier::text as system_identifier from pg_catalog.pg_control_system();");
      return text(rows[0]?.system_identifier);
    },
    async getManifest(objectPath) {
      const rows = await sql.unsafe(manifestSelectSql(), [objectPath]);
      return parseManifestRow(rows[0]);
    },
    async registerProof(row, evidence) {
      return sql.begin(async (tx) => {
        await tx.unsafe("set transaction isolation level repeatable read;");
        const rows = await tx.unsafe(`select public.chips_register_archive_id_proof(
          $1, $2::uuid[], $3::bigint[], $4, $5::integer, $6::timestamptz,
          $7::timestamptz, $8::uuid, $9::timestamptz, $10::uuid,
          $11::timestamptz, $12::timestamptz, $13::jsonb, $14::bigint,
          $15::bigint, $16, $17, $18::numeric, $19::numeric, $20::numeric
        ) as result;`, [
          row.object_path, evidence.transactionIds, evidence.entryIds, row.project_ref,
          row.format_version, timestampParam(row.cutoff), timestampParam(row.cursor_start_created_at), row.cursor_start_id,
          timestampParam(row.cursor_end_created_at), row.cursor_end_id, timestampParam(row.first_created_at), timestampParam(row.last_created_at),
          row.tx_types, row.raw_bytes, row.compressed_bytes, row.raw_sha256, row.compressed_sha256,
          row.credits, row.debits, row.net_amount,
        ]);
        return rows[0]?.result;
      });
    },
    async registerBotOnlyProof(row, evidence) {
      return sql.begin(async (tx) => {
        await tx.unsafe("set transaction isolation level repeatable read;");
        const rows = await tx.unsafe(`select public.chips_register_bot_only_archive_proof(
          $1, $2::uuid[], $3::bigint[], $4::uuid, $5::text[]
        ) as result;`, [
          row.object_path,
          evidence.transactionIds,
          evidence.entryIds,
          evidence.tableId,
          evidence.registryKeys,
        ]);
        return rows[0]?.result;
      });
    },
    // The database function is deliberately owner-only (EXECUTE is granted to
    // postgres only).  Keep the authorization as a separate transaction from
    // the later prune call so the persisted GO receipt is independently
    // observable and can be safely reused by an exact-batch retry.
    async authorizeBotOnlyBatch(batchId, confirmation) {
      return sql.begin(async (tx) => {
        await tx.unsafe("set transaction isolation level serializable;");
        await tx.unsafe("set local lock_timeout = '5s';");
        await tx.unsafe("set local statement_timeout = '120s';");
        const rows = await tx.unsafe(`select public.chips_authorize_bot_only_archive_batch(
          $1::bigint, $2::text
        ) as result;`, [batchId, confirmation]);
        return rows[0]?.result;
      });
    },
    async registerLegacyStageAllowlistProof(row, evidence) {
      return sql.begin(async (tx) => {
        await tx.unsafe("set transaction isolation level repeatable read;");
        const rows = await tx.unsafe(`select public.chips_register_legacy_stage_allowlist_proof(
          $1, $2::uuid[], $3::bigint[], $4::uuid[], $5::uuid[], $6::text, $7::text,
          $8::bigint, $9::bigint, $10::text, $11::text, $12::text, $13::timestamptz
        ) as result;`, [
          row.object_path,
          evidence.transactionIds,
          evidence.entryIds,
          evidence.legacyTableIds,
          evidence.legacyMasterTableIds,
          evidence.legacyAllowlistSha256,
          evidence.legacyBatchTableIdsSha256,
          Number(row.legacy_master_table_count),
          Number(row.legacy_batch_number),
          row.legacy_source_run,
          row.legacy_query_sha256,
          row.legacy_stage_system_identifier,
          timestampParam(row.cutoff),
        ]);
        return rows[0]?.result;
      });
    },
    async prune(objectPath, evidence, execute) {
      return sql.begin(async (tx) => {
        await tx.unsafe("set transaction isolation level serializable;");
        await tx.unsafe("set local lock_timeout = '5s';");
        await tx.unsafe("set local statement_timeout = '120s';");
        const rows = await tx.unsafe(`select public.chips_prune_committed_archive_batch(
          $1, $2::uuid[], $3::bigint[], $4::boolean
        ) as result;`, [objectPath, evidence.transactionIds, evidence.entryIds, execute]);
        return rows[0]?.result;
      });
    },
    async cleanupBotOnly(objectPath, evidence, execute, approvedBatchId = null, automatic = false) {
      return sql.begin(async (tx) => {
        await tx.unsafe("set transaction isolation level serializable;");
        await tx.unsafe("set local lock_timeout = '5s';");
        await tx.unsafe("set local statement_timeout = '120s';");
        const rows = automatic
          ? await tx.unsafe(`select public.chips_auto_prune_and_cleanup_bot_only_archive_batch(
            $1, $2::uuid[], $3::bigint[], $4::text[], $5::uuid
          ) as result;`, [
            objectPath,
            evidence.transactionIds,
            evidence.entryIds,
            evidence.registryKeys,
            evidence.tableId,
          ])
          : await tx.unsafe(`select public.chips_prune_and_cleanup_bot_only_archive_batch(
            $1, $2::uuid[], $3::bigint[], $4::text[], $5::uuid, $6::boolean, $7::bigint
          ) as result;`, [
            objectPath,
            evidence.transactionIds,
            evidence.entryIds,
            evidence.registryKeys,
            evidence.tableId,
            execute,
            approvedBatchId,
          ]);
        return rows[0]?.result;
      });
    },
    async cleanupLegacyStageAllowlist(objectPath, evidence, execute, approvedBatchId = null, orchestration = null) {
      return sql.begin(async (tx) => {
        await tx.unsafe("set transaction isolation level serializable;");
        await tx.unsafe("set local lock_timeout = '5s';");
        await tx.unsafe("set local statement_timeout = '120s';");
        const rows = orchestration
          ? await tx.unsafe(`select public.chips_prune_legacy_stage_allowlist_orchestrated_batch(
            $1::bigint, $2, $3, $4::uuid[], $5::bigint[], $6::uuid[], $7::text, $8::text,
            $9::text[], $10::boolean
          ) as result;`, [
            orchestration.runId,
            orchestration.planSha256,
            objectPath,
            evidence.transactionIds,
            evidence.entryIds,
            evidence.legacyTableIds,
            evidence.legacyAllowlistSha256,
            evidence.legacyBatchTableIdsSha256,
            evidence.registryKeys,
            execute,
          ])
          : await tx.unsafe(`select public.chips_prune_legacy_stage_allowlist_batch(
            $1, $2::uuid[], $3::bigint[], $4::uuid[], $5::text, $6::text, $7::text[],
            $8::boolean, $9::bigint
          ) as result;`, [
            objectPath,
            evidence.transactionIds,
            evidence.entryIds,
            evidence.legacyTableIds,
            evidence.legacyAllowlistSha256,
            evidence.legacyBatchTableIdsSha256,
            evidence.registryKeys,
            execute,
            approvedBatchId,
          ]);
        return rows[0]?.result;
      });
    },
    async verifyCommitted(row, evidence) {
      const rows = await sql.unsafe(`select
        batches.pruned_at::text as pruned_at,
        batches.pruned_transaction_count::text as pruned_transaction_count,
        batches.pruned_entry_count::text as pruned_entry_count,
        batches.pruned_transaction_ids_sha256,
        batches.pruned_entry_ids_sha256,
        batches.registry_cleaned_at::text as registry_cleaned_at,
        batches.registry_cleaned_key_count::text as registry_cleaned_key_count,
        batches.registry_cleaned_keys_sha256,
        (select count(*)::text from public.chips_transaction_idempotency registry
          where registry.transaction_id = any($2::uuid[]) and registry.archive_batch_id = batches.batch_id) as mapping_count,
        (select count(*)::text from public.chips_transaction_idempotency registry
          where registry.archive_batch_id = batches.batch_id and not (registry.transaction_id = any($2::uuid[]))) as extra_mapping_count,
        (select count(*)::text from public.chips_transaction_idempotency registry
          where registry.archive_batch_id = batches.batch_id) as remaining_mapping_count,
        (select count(*)::text from public.chips_transactions transactions where transactions.id = any($2::uuid[])) as hot_transaction_count,
        (select count(*)::text from public.chips_entries entries
          where entries.transaction_id = any($2::uuid[]) or entries.id = any($3::bigint[])) as hot_entry_count
      from public.chips_ledger_archive_batches batches where batches.object_path = $1;`, [
        row.object_path, evidence.transactionIds, evidence.entryIds,
      ]);
      return rows[0] || null;
    },
    async verifyBotOnlyCommitted(row, evidence) {
      const rows = await sql.unsafe(`select
        batches.pruned_at::text as pruned_at,
        batches.pruned_transaction_count::text as pruned_transaction_count,
        batches.pruned_entry_count::text as pruned_entry_count,
        batches.pruned_transaction_ids_sha256,
        batches.pruned_entry_ids_sha256,
        batches.registry_cleaned_at::text as registry_cleaned_at,
        batches.registry_cleaned_key_count::text as registry_cleaned_key_count,
        batches.registry_cleaned_keys_sha256,
        (select count(*)::text from public.chips_transaction_idempotency registry
          where registry.archive_batch_id = batches.batch_id) as remaining_mapping_count,
        (select count(*)::text from public.chips_transactions transactions where transactions.id = any($2::uuid[])) as hot_transaction_count,
        (select count(*)::text from public.chips_entries entries
          where entries.transaction_id = any($2::uuid[]) or entries.id = any($3::bigint[])) as hot_entry_count
      from public.chips_ledger_archive_batches batches where batches.object_path = $1;`, [
        row.object_path, evidence.transactionIds, evidence.entryIds,
      ]);
      return rows[0] || null;
    },
  };
}

export async function executeArchivePrune({ store, objectPath, evidence, execute, beforeAttempt = null }) {
  const attempts = execute ? MAX_EXECUTE_ATTEMPTS : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (beforeAttempt) await beforeAttempt();
    try {
      return await store.prune(objectPath, evidence, execute);
    } catch (error) {
      if (!execute || attempt === attempts || (error?.code !== "40001" && error?.code !== "55P03")) throw error;
    }
  }
  fail("archive pruning retry budget was exhausted");
}

function assertProofMatches(row, evidence) {
  if (!row.archive_proof_verified_at) fail("immutable archive ID proof is not registered");
  if (row.archived_transaction_ids_sha256 !== evidence.transactionIdsSha256
    || row.archived_entry_ids_sha256 !== evidence.entryIdsSha256) {
    fail("local archive IDs do not match immutable database proof");
  }
}

function assertPostCommitVerification(verification, evidence) {
  if (!verification?.pruned_at
    || Number(verification.pruned_transaction_count) !== evidence.transactionCount
    || Number(verification.pruned_entry_count) !== evidence.entryCount
    || verification.pruned_transaction_ids_sha256 !== evidence.transactionIdsSha256
    || verification.pruned_entry_ids_sha256 !== evidence.entryIdsSha256
    || Number(verification.mapping_count) !== evidence.transactionCount
    || Number(verification.extra_mapping_count) !== 0
    || Number(verification.hot_transaction_count) !== 0
    || Number(verification.hot_entry_count) !== 0) {
    fail("post-commit database verification failed", "post_commit_verification_failed");
  }
}

function assertLegacyPostCommitVerification(verification, evidence) {
  if (!verification?.pruned_at
    || Number(verification.pruned_transaction_count) !== evidence.transactionCount
    || Number(verification.pruned_entry_count) !== evidence.entryCount
    || verification.pruned_transaction_ids_sha256 !== evidence.transactionIdsSha256
    || verification.pruned_entry_ids_sha256 !== evidence.entryIdsSha256
    || !verification.registry_cleaned_at
    || Number(verification.registry_cleaned_key_count) !== evidence.registryKeys.length
    || verification.registry_cleaned_keys_sha256 !== evidence.registryKeysSha256
    || Number(verification.mapping_count) !== 0
    || Number(verification.extra_mapping_count) !== 0
    || Number(verification.remaining_mapping_count) !== 0
    || Number(verification.hot_transaction_count) !== 0
    || Number(verification.hot_entry_count) !== 0) {
    fail("post-commit legacy cleanup verification failed", "post_commit_verification_failed");
  }
}

function legacyExecuteReceiptState(row) {
  const present = LEGACY_EXECUTE_RECEIPT_FIELDS.filter((field) => row[field] != null).length;
  if (present === 0) return "ready";
  if (present === LEGACY_EXECUTE_RECEIPT_FIELDS.length) return "already_pruned";
  fail("legacy execute retry found a partial cleanup receipt");
}

function assertLegacyExecuteRetryManifest(row, previousRow, target, identity) {
  assertTargetIdentity(identity, row, target);
  if (row.status !== "committed" || !row.committed_at) fail("legacy execute retry manifest is not committed");
  if (row.format_version !== BOT_ONLY_EXPORT_SCHEMA_VERSION
    || row.source_policy_id !== LEGACY_STAGE_ALLOWLIST_POLICY_ID) {
    fail("legacy execute retry manifest policy changed");
  }
  const bindingFields = [
    "object_path",
    "batch_id",
    "legacy_run_id",
    "legacy_plan_sha256",
    "legacy_batch_number",
    "legacy_batch_table_count",
    "legacy_allowlist_sha256",
    "legacy_batch_table_ids_sha256",
    "legacy_source_run",
    "legacy_query_sha256",
    "legacy_stage_system_identifier",
    "archive_proof_verified_at",
    "archived_transaction_ids_sha256",
    "archived_entry_ids_sha256",
    "compressed_sha256",
  ];
  for (const field of bindingFields) {
    if (text(row[field]) !== text(previousRow[field])) fail(`legacy execute retry ${field} changed`);
  }
  if ((row.destructive_go_at == null) !== (row.destructive_go_batch_id == null)
    || (row.destructive_go_at != null && text(row.destructive_go_batch_id) !== text(row.batch_id))) {
    fail("legacy execute retry found a partial or foreign destructive GO");
  }
}

async function revalidateLegacyExecuteAttempt({
  store,
  previousRow,
  target,
  identity,
  recoveryBundle,
  deps,
}) {
  const row = await store.getManifest(previousRow.object_path);
  if (!row) fail("legacy execute retry manifest is missing");
  assertLegacyExecuteRetryManifest(row, previousRow, target, identity);
  const downloaded = deps.downloadArchive
    ? await deps.downloadArchive(target, row.object_path)
    : await downloadPrivateArchiveObject(target, row.object_path, deps);
  if (!downloaded || downloaded.bytes == null) fail("legacy execute retry archive is unavailable");
  const archiveBytes = Buffer.from(downloaded.bytes);
  const archiveSha256 = crypto.createHash("sha256").update(archiveBytes).digest("hex");
  if (downloaded.sha256 != null && downloaded.sha256 !== archiveSha256) {
    fail("legacy execute retry archive checksum is self-inconsistent");
  }
  if (archiveSha256 !== row.compressed_sha256) fail("legacy execute retry archive differs from the committed manifest");
  const archiveManifest = exporterManifestFromDatabase(row, target, deps.legacyStageAllowlistPlan);
  const localArchive = verifyArchiveBytes({
    compressedBytes: archiveBytes,
    manifest: archiveManifest,
    target,
    artifactName: path.basename(row.object_path),
    expectedLegacyStageAllowlistEvidence: deps.legacyStageAllowlistPlan?.archiveManifest || null,
  });
  const evidence = buildPruneEvidence(localArchive, { maxBatchSize: targetPolicy(target.target).maxBatchSize });
  assertProofMatches(row, evidence);
  if (!recoveryBundle) fail("legacy execute retry recovery bundle is unavailable");
  verifyRecoveryBundle({
    bundle: recoveryBundle,
    row,
    target,
    identity,
    expectedEvidence: evidence,
    expectedLegacyStageAllowlistEvidence: deps.legacyStageAllowlistPlan?.archiveManifest || null,
  });
  if (!fs.readFileSync(recoveryBundle.artifactPath).equals(archiveBytes)) {
    fail("legacy execute retry recovery archive differs from the committed archive");
  }
  const receiptState = legacyExecuteReceiptState(row);
  if (receiptState === "already_pruned") {
    if (typeof store.verifyCommitted !== "function") fail("legacy execute retry post-commit verifier is unavailable");
    const verification = await store.verifyCommitted(row, evidence);
    assertLegacyPostCommitVerification(verification, evidence);
  }
  return { state: receiptState, row, evidence };
}

async function executeLegacyStageAllowlistWithRetry({
  store,
  row,
  evidence,
  target,
  identity,
  recoveryBundle,
  approvedBatchId = null,
  orchestration = null,
  deps,
}) {
  let currentRow = row;
  let currentEvidence = evidence;
  let currentRecoveryBundle = recoveryBundle;
  let executeAttempts = 0;
  let executeRetryCount = 0;
  const executeSqlstates = [];
  const metrics = () => ({
    executeAttempts,
    executeRetryCount,
    executeSqlstates: [...executeSqlstates],
  });
  const reportProgress = (extra = {}) => {
    if (typeof deps.onExecuteProgress === "function") {
      deps.onExecuteProgress({ ...metrics(), row: currentRow, ...extra });
    }
  };
  const annotate = (error) => {
    if (error && typeof error === "object") Object.assign(error, metrics());
    return error;
  };
  const wait = deps.waitForExecuteRetry || (async ({ delayMs }) => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  });

  for (let attempt = 1; attempt <= MAX_EXECUTE_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      reportProgress({ retry_preflight: true });
      let preflight;
      try {
        preflight = await revalidateLegacyExecuteAttempt({
          store,
          previousRow: currentRow,
          target,
          identity,
          recoveryBundle: currentRecoveryBundle,
          deps,
        });
      } catch (error) {
        reportProgress({ error });
        throw annotate(error);
      }
      if (preflight.state === "already_pruned") {
        reportProgress({ row: preflight.row, result: preflight });
        return { ...preflight, recoveryBundle: currentRecoveryBundle, ...metrics() };
      }
      currentRow = preflight.row;
      currentEvidence = preflight.evidence;
    }

    executeAttempts += 1;
    reportProgress({ attempt });
    try {
      const result = await store.cleanupLegacyStageAllowlist(
        currentRow.object_path,
        currentEvidence,
        true,
        approvedBatchId,
        orchestration,
      );
      reportProgress({ result });
      return {
        ...result,
        row: currentRow,
        evidence: currentEvidence,
        recoveryBundle: currentRecoveryBundle,
        ...metrics(),
      };
    } catch (error) {
      const sqlstate = sqlStateOf(error);
      if (sqlstate) executeSqlstates.push(sqlstate);
      reportProgress({ error });
      if (attempt === MAX_EXECUTE_ATTEMPTS || !RETRYABLE_CLEANUP_SQLSTATES.has(sqlstate)) {
        throw annotate(error);
      }
      executeRetryCount += 1;
      const delayMs = AUTOMATIC_CLEANUP_RETRY_BACKOFF_MS[Math.min(
        executeRetryCount - 1,
        AUTOMATIC_CLEANUP_RETRY_BACKOFF_MS.length - 1,
      )];
      reportProgress({ retry_wait: true, delayMs });
      try {
        await wait({
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          sqlstate,
          ...metrics(),
        });
      } catch (waitError) {
        throw annotate(waitError);
      }
    }
  }
  fail("legacy Stage allowlist execute retry budget was exhausted");
}

async function executeBotOnlyCleanupWithRetry({
  store,
  row,
  evidence,
  target,
  identity,
  recoveryBundle,
  approvedBatchId = null,
  execute,
  automatic,
  beforeRetry = null,
  onProgress = null,
  waitForRetry = null,
}) {
  const attempts = automatic && execute ? MAX_AUTOMATIC_CLEANUP_ATTEMPTS : 1;
  let currentRow = row;
  let currentEvidence = evidence;
  let currentRecoveryBundle = recoveryBundle;
  let executeAttempts = 0;
  let executeRetryCount = 0;
  const executeSqlstates = [];
  const metrics = () => ({
    executeAttempts,
    executeRetryCount,
    executeSqlstates: [...executeSqlstates],
  });
  const reportProgress = (extra = {}) => {
    if (typeof onProgress === "function") onProgress({ ...metrics(), row: currentRow, ...extra });
  };
  const annotate = (error) => {
    if (error && typeof error === "object") Object.assign(error, metrics());
    return error;
  };
  const wait = waitForRetry || (async ({ delayMs }) => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  });

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      if (automatic && typeof beforeRetry !== "function") {
        const error = new Error("automatic cleanup retry preflight is unavailable");
        reportProgress({ error });
        throw annotate(error);
      }
      if (typeof beforeRetry === "function") {
        reportProgress({ retry_preflight: true });
        let preflight;
        try {
          preflight = await beforeRetry({
            attempt,
            previousAttempts: executeAttempts,
            executeRetryCount,
            executeSqlstates: [...executeSqlstates],
            row: currentRow,
            evidence: currentEvidence,
            recoveryBundle: currentRecoveryBundle,
          });
        } catch (error) {
          reportProgress({ error });
          throw annotate(error);
        }
        if (preflight?.state === "already_cleaned") {
          reportProgress({ row: preflight.row || currentRow, result: preflight });
          return { ...preflight, ...metrics() };
        }
        currentRow = preflight?.row || currentRow;
        currentEvidence = preflight?.evidence || currentEvidence;
        currentRecoveryBundle = preflight?.recoveryBundle || currentRecoveryBundle;
      }
    }

    executeAttempts += 1;
    reportProgress({ attempt });
    if (currentRecoveryBundle) {
      try {
        verifyRecoveryBundle({
          bundle: currentRecoveryBundle,
          row: currentRow,
          target,
          identity,
          expectedEvidence: currentEvidence,
        });
      } catch (error) {
        reportProgress({ error });
        throw annotate(error);
      }
    }
    try {
      const result = await store.cleanupBotOnly(
        currentRow.object_path,
        currentEvidence,
        execute,
        approvedBatchId,
        automatic,
      );
      reportProgress({ result });
      return {
        ...result,
        row: currentRow,
        evidence: currentEvidence,
        ...metrics(),
      };
    } catch (error) {
      const sqlstate = sqlStateOf(error);
      if (sqlstate) executeSqlstates.push(sqlstate);
      reportProgress({ error });
      if (!automatic
        || attempt === attempts
        || !RETRYABLE_CLEANUP_SQLSTATES.has(sqlstate)) {
        throw annotate(error);
      }
      executeRetryCount += 1;
      const delayMs = AUTOMATIC_CLEANUP_RETRY_BACKOFF_MS[Math.min(
        executeRetryCount - 1,
        AUTOMATIC_CLEANUP_RETRY_BACKOFF_MS.length - 1,
      )];
      reportProgress({ retry_wait: true, delayMs });
      try {
        await wait({
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          sqlstate,
          ...metrics(),
        });
      } catch (waitError) {
        throw annotate(waitError);
      }
    }
  }
  fail("automatic bot-only cleanup retry budget was exhausted");
}

function outputResult(result) {
  process.stdout.write(`${stringifyJson({
    event: "chips_ledger_archive_prune",
    target: result.target.target,
    project_ref: result.row.project_ref,
    postgres_system_identifier: result.identity,
    bucket: ARCHIVE_BUCKET,
    object_path: result.row.object_path,
    mode: result.mode,
    state: result.state,
    transactions: result.evidence.transactionCount,
    entries: result.evidence.entryCount,
    tx_types: result.evidence.txTypes,
    amounts: { credits: result.evidence.credits, debits: result.evidence.debits, net: result.evidence.net },
    user_transactions: result.evidence.userTransactions,
    user_entries: result.evidence.userEntries,
    distinct_tables: result.evidence.distinctTables,
    id_proof: {
      transaction_ids_sha256: result.evidence.transactionIdsSha256,
      entry_ids_sha256: result.evidence.entryIdsSha256,
    },
    storage_download_ms: result.storageDownloadMs,
    post_commit_download_ms: result.postCommitDownloadMs ?? null,
    recovery_bundle_reused: result.recoveryBundle?.reused ?? null,
  })}\n`);
}

export async function pruneArchive({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), deps = {} } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return null;
  }
  if (args.target !== "stage" && args.target !== "prod") fail("--target must be explicitly set to stage or prod");
  if (!args.objectPath) fail("--object-path is required");
  if (!SHA256_RE.test(text(args.confirmSha))) fail("--confirm-sha must be a lowercase SHA-256");
  if (args.objectPath !== buildObjectPath(args.confirmSha)) fail("--object-path does not match --confirm-sha");
  if (args.execute && !args.recoveryDir) fail("--recovery-dir is required with --execute");
  if (!args.execute && args.recoveryDir) fail("--recovery-dir is only valid with --execute");
  if (args.approvedBatchId != null && !args.execute) fail("--approved-batch-id is only valid with --execute");
  if (args.approvedBatchId != null && !/^[1-9][0-9]*$/.test(args.approvedBatchId)) fail("--approved-batch-id must be a positive integer");
  if (args.automatic && args.approvedBatchId != null) fail("--automatic cannot be combined with --approved-batch-id");

  const target = deps.storageTarget || resolveStorageTarget(args.target, env, deps.targetOptions || {});
  const sql = deps.sql || (deps.pruneStore ? null : postgres(target.dbUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 30,
  }));
  const store = deps.pruneStore || createPruneStore(sql);
  const verifyBucket = deps.verifyBucket
    || ((storageTarget) => verifyArchiveBucket(storageTarget, deps));
  try {
    await verifyBucket(target);
    const identity = await store.getIdentity();
    const row = await store.getManifest(args.objectPath);
    assertTargetIdentity(identity, row, target);
    if (row.status !== "committed" || !row.committed_at) fail("archive manifest is not committed");
    if (row.compressed_sha256 !== args.confirmSha) fail("--confirm-sha does not match committed manifest");

    const downloaded = deps.downloadArchive
      ? await deps.downloadArchive(target, row.object_path)
      : await downloadPrivateArchiveObject(target, row.object_path, deps);
    const archiveBytes = Buffer.from(downloaded.bytes);
    const archiveSha256 = crypto.createHash("sha256").update(archiveBytes).digest("hex");
    if (downloaded.sha256 != null && downloaded.sha256 !== archiveSha256) {
      fail("downloaded archive checksum is self-inconsistent");
    }
    const archiveManifest = exporterManifestFromDatabase(row, target, deps.legacyStageAllowlistPlan);
    const localArchive = verifyArchiveBytes({
      compressedBytes: archiveBytes,
      manifest: archiveManifest,
      target,
      artifactName: path.basename(row.object_path),
      expectedLegacyStageAllowlistEvidence: deps.legacyStageAllowlistPlan?.archiveManifest || null,
    });
    const evidence = buildPruneEvidence(localArchive, { maxBatchSize: targetPolicy(target.target).maxBatchSize });

    if (args.automatic && (row.format_version !== BOT_ONLY_EXPORT_SCHEMA_VERSION
      || row.source_policy_id !== "stage-ledger-bot-only-retention-7d-v1")) {
      fail("--automatic is only valid for the Stage bot-only 7-day policy");
    }

    if (args.registerProof) {
      const proof = row.format_version === BOT_ONLY_EXPORT_SCHEMA_VERSION
        ? row.source_policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID
          ? await store.registerLegacyStageAllowlistProof(row, evidence)
          : await store.registerBotOnlyProof(row, evidence)
        : await store.registerProof(row, evidence);
      const refreshedRow = await store.getManifest(row.object_path);
      const result = {
        row: refreshedRow,
        identity,
        evidence,
        target,
        mode: "register-proof",
        state: proof?.state || "proof_registered",
        storageDownloadMs: downloaded.downloadMs,
        archiveSha256,
      };
      if (deps.emit !== false) outputResult(result);
      return result;
    }

    if (args.execute) assertProofMatches(await store.getManifest(row.object_path), evidence);
    let recoveryBundle = null;
    if (args.execute) {
      recoveryBundle = writeRecoveryBundle({
        recoveryDir: path.resolve(cwd, args.recoveryDir),
        archiveBytes,
        row,
        identity,
        evidence,
        target,
      });
    }
    if (args.execute && typeof deps.beforeCleanup === "function") {
      await deps.beforeCleanup({ row, evidence, identity, target, recoveryBundle });
    }

    const pruneResult = row.format_version === BOT_ONLY_EXPORT_SCHEMA_VERSION
      ? row.source_policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID
        ? args.execute
          ? await executeLegacyStageAllowlistWithRetry({
            store,
            row,
            evidence,
            target,
            identity,
            recoveryBundle,
            approvedBatchId: args.approvedBatchId,
            orchestration: deps.legacyStageAllowlistOrchestration || null,
            deps,
          })
          : await store.cleanupLegacyStageAllowlist(
            row.object_path,
            evidence,
            false,
            args.approvedBatchId,
            deps.legacyStageAllowlistOrchestration || null,
          )
        : await executeBotOnlyCleanupWithRetry({
          store,
          row,
          evidence,
          target,
          identity,
          recoveryBundle,
          approvedBatchId: args.approvedBatchId,
          execute: Boolean(args.execute),
          automatic: Boolean(args.automatic),
          beforeRetry: deps.beforeExecuteRetry || null,
          onProgress: deps.onExecuteProgress || null,
          waitForRetry: deps.waitForExecuteRetry || null,
        })
      : await executeArchivePrune({
        store,
        objectPath: row.object_path,
        evidence,
        execute: Boolean(args.execute),
        beforeAttempt: recoveryBundle
          ? () => verifyRecoveryBundle({ bundle: recoveryBundle, row, target, identity, expectedEvidence: evidence })
          : null,
      });

    const resultRow = pruneResult?.row || row;
    const resultEvidence = pruneResult?.evidence || evidence;
    let postCommitDownloadMs = null;
    if (args.execute) {
      try {
        await verifyBucket(target);
        const postCommitDownload = deps.downloadArchive
          ? await deps.downloadArchive(target, resultRow.object_path)
          : await downloadPrivateArchiveObject(target, resultRow.object_path, deps);
        postCommitDownloadMs = postCommitDownload.downloadMs;
        verifyArchiveBytes({
          compressedBytes: postCommitDownload.bytes,
          manifest: exporterManifestFromDatabase(resultRow, target, deps.legacyStageAllowlistPlan),
          target,
          artifactName: path.basename(resultRow.object_path),
          expectedLegacyStageAllowlistEvidence: deps.legacyStageAllowlistPlan?.archiveManifest || null,
        });
        const verification = resultRow.format_version === BOT_ONLY_EXPORT_SCHEMA_VERSION
          && resultRow.source_policy_id !== LEGACY_STAGE_ALLOWLIST_POLICY_ID
          ? await store.verifyBotOnlyCommitted(resultRow, resultEvidence)
          : await store.verifyCommitted(resultRow, resultEvidence);
        if (resultRow.format_version === BOT_ONLY_EXPORT_SCHEMA_VERSION
          && resultRow.source_policy_id !== LEGACY_STAGE_ALLOWLIST_POLICY_ID) {
          if (!verification?.pruned_at
            || Number(verification.pruned_transaction_count) !== resultEvidence.transactionCount
            || Number(verification.pruned_entry_count) !== resultEvidence.entryCount
            || verification.pruned_transaction_ids_sha256 !== resultEvidence.transactionIdsSha256
            || verification.pruned_entry_ids_sha256 !== resultEvidence.entryIdsSha256
            || !verification.registry_cleaned_at
            || Number(verification.registry_cleaned_key_count) !== resultEvidence.registryKeys.length
            || verification.registry_cleaned_keys_sha256 !== resultEvidence.registryKeysSha256
            || Number(verification.remaining_mapping_count) !== 0
            || Number(verification.hot_transaction_count) !== 0
            || Number(verification.hot_entry_count) !== 0) {
            fail("post-commit bot-only cleanup verification failed", "post_commit_verification_failed");
          }
        } else if (resultRow.format_version === BOT_ONLY_EXPORT_SCHEMA_VERSION
          && resultRow.source_policy_id === LEGACY_STAGE_ALLOWLIST_POLICY_ID) {
          assertLegacyPostCommitVerification(verification, resultEvidence);
        } else {
          assertPostCommitVerification(verification, resultEvidence);
        }
      } catch (error) {
        if (error?.code === "post_commit_verification_failed") throw error;
        fail(`post-commit verification failed: ${error?.message || error}`, "post_commit_verification_failed");
      }
    }

    const result = {
      row: resultRow,
      identity,
      target,
      evidence: resultEvidence,
      mode: args.execute ? "execute" : "dry-run",
      state: pruneResult?.state || "unknown",
      storageDownloadMs: downloaded.downloadMs,
      postCommitDownloadMs,
      recoveryBundle,
      archiveSha256,
      executeAttempts: pruneResult?.executeAttempts ?? null,
      executeRetryCount: pruneResult?.executeRetryCount ?? null,
      executeSqlstates: Array.isArray(pruneResult?.executeSqlstates)
        ? [...pruneResult.executeSqlstates]
        : null,
    };
    if (deps.emit !== false) outputResult(result);
    return result;
  } finally {
    if (sql && !deps.sql) await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  pruneArchive().catch((error) => {
    process.stderr.write(`chips-ledger-archive-prune failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
