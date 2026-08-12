import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { stringifyJson } from "./chips-ledger-archive-export.mjs";
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

export const STAGE_SYSTEM_IDENTIFIER = "7656985631720456337";
export const PRODUCTION_SYSTEM_IDENTIFIER = "7575202818581710058";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ENTRY_ID_RE = /^[1-9][0-9]*$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ALLOWED_TX_TYPES = new Set(["TABLE_BUY_IN", "TABLE_CASH_OUT"]);
const MAX_BATCH_SIZE = 5000;
const MAX_EXECUTE_ATTEMPTS = 3;

const HELP = `Usage: node scripts/ops/chips-ledger-archive-prune.mjs [options]

Required:
  --target stage                 Canonical Stage only; Production is rejected.
  --object-path <path>           Committed v1/sha256/<sha>.jsonl.gz object.
  --confirm-sha <sha256>         Explicit compressed object SHA-256 confirmation.

Modes (mutually exclusive):
  default                        Validate Storage and run a database dry-run.
  --register-proof               Persist immutable ordered transaction/entry ID proof.
  --execute                      Prune exact proof-bound IDs after all checks.

Execute-only:
  --recovery-dir <path>          Required private 0700 recovery directory.

The command is Stage-only, processes one batch of at most 5000 transactions,
never overwrites recovery files, never changes balances, and never mutates Storage.
`;

function fail(message, code = null) {
  const error = new Error(message);
  if (code) error.code = code;
  throw error;
}

function text(value) {
  return value == null ? "" : String(value).trim();
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

export function computeArchiveIdProofs(records) {
  if (!Array.isArray(records) || records.length < 1 || records.length > MAX_BATCH_SIZE) {
    fail("archive proof requires 1 to 5000 transaction records");
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

export function buildPruneEvidence(localArchive) {
  const proofs = computeArchiveIdProofs(localArchive.records);
  const txTypes = {};
  const tables = new Set();
  let userTransactions = 0;
  let userEntries = 0;

  for (const record of localArchive.records) {
    const transaction = record.transaction;
    const txType = text(transaction.tx_type);
    if (!ALLOWED_TX_TYPES.has(txType)) fail(`archive tx_type is outside the Stage 2B.4 whitelist: ${txType}`);
    if (transaction.user_id !== null) userTransactions += 1;
    const tableId = tableIdForRecord(record);
    tables.add(tableId);
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
    fail(`Stage 2B.4 cannot prune USER ledger history (user_transactions=${userTransactions}, user_entries=${userEntries}, distinct_tables=${tables.size})`);
  }
  if (canonicalJson(txTypes) !== canonicalJson(localArchive.manifest.batch.tx_types)) fail("technical tx_type evidence differs from archive manifest");
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
  };
}

function parseArgs(argv) {
  const valueArgs = new Map([
    ["--target", "target"],
    ["--object-path", "objectPath"],
    ["--confirm-sha", "confirmSha"],
    ["--recovery-dir", "recoveryDir"],
  ]);
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--register-proof" || token === "--execute") {
      const key = token === "--register-proof" ? "registerProof" : "execute";
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
  return args;
}

function assertStageIdentity(identity, manifest) {
  if (identity === PRODUCTION_SYSTEM_IDENTIFIER) fail("Production database is forbidden");
  if (identity !== STAGE_SYSTEM_IDENTIFIER) fail("database is not canonical Stage");
  if (manifest.project_ref !== "krydukthwdvccggbyjfw") fail("archive manifest is not canonical Stage");
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
  };
}

function exporterManifestFromDatabase(row, target) {
  const ratio = row.raw_bytes === 0 ? null : Number((row.compressed_bytes / row.raw_bytes).toFixed(6));
  const cursorStart = row.cursor_start_created_at ? { created_at: row.cursor_start_created_at, id: row.cursor_start_id } : null;
  const cursorEnd = row.cursor_end_created_at ? { created_at: row.cursor_end_created_at, id: row.cursor_end_id } : null;
  return {
    schema_version: row.format_version,
    artifact_type: "chips_ledger_archive",
    format: "jsonl.gz",
    target: target.target,
    cutoff: { created_at: row.cutoff, rule: "transaction.created_at < cutoff" },
    batch: {
      limit: MAX_BATCH_SIZE,
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
  };
}

function recoveryManifest(row, identity, evidence) {
  return {
    recovery_schema_version: 1,
    artifact_type: "chips_ledger_archive_prune_recovery",
    target: "stage",
    project_ref: row.project_ref,
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
  };
}

export function writeRecoveryBundle({ recoveryDir, archiveBytes, row, identity, evidence }) {
  const directory = ensurePrivateDirectory(recoveryDir);
  const baseName = `chips-ledger-${row.compressed_sha256}`;
  const artifactPath = path.join(directory, `${baseName}.jsonl.gz`);
  const manifestPath = path.join(directory, `${baseName}.recovery.json`);
  const manifest = recoveryManifest(row, identity, evidence);
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

export function verifyRecoveryBundle({ bundle, row, target, identity, expectedEvidence }) {
  ensurePrivateDirectory(bundle.directory);
  assertPrivateRegularFile(bundle.artifactPath);
  assertPrivateRegularFile(bundle.manifestPath);
  const manifest = JSON.parse(fs.readFileSync(bundle.manifestPath, "utf8"));
  const expectedManifest = recoveryManifest(row, identity, expectedEvidence);
  if (canonicalJson(manifest) !== canonicalJson(expectedManifest)) fail("recovery manifest no longer matches archive evidence");
  const verified = verifyArchiveBytes({
    compressedBytes: fs.readFileSync(bundle.artifactPath),
    manifest: exporterManifestFromDatabase(row, target),
    target,
    artifactName: path.basename(row.object_path),
  });
  const evidence = buildPruneEvidence(verified);
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
    archived_transaction_ids_sha256, archived_entry_ids_sha256,
    archive_proof_verified_at::text as archive_proof_verified_at,
    pruned_at::text as pruned_at, pruned_transaction_count::text as pruned_transaction_count,
    pruned_entry_count::text as pruned_entry_count, pruned_transaction_ids_sha256,
    pruned_entry_ids_sha256
  from public.chips_ledger_archive_batches where object_path = $1;`;
}

export function createPruneStore(sql) {
  if (!sql || typeof sql.unsafe !== "function" || typeof sql.begin !== "function") fail("PostgreSQL prune adapter is required");
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
          row.format_version, row.cutoff, row.cursor_start_created_at, row.cursor_start_id,
          row.cursor_end_created_at, row.cursor_end_id, row.first_created_at, row.last_created_at,
          row.tx_types, row.raw_bytes, row.compressed_bytes, row.raw_sha256, row.compressed_sha256,
          row.credits, row.debits, row.net_amount,
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
    async verifyCommitted(row, evidence) {
      const rows = await sql.unsafe(`select
        batches.pruned_at::text as pruned_at,
        batches.pruned_transaction_count::text as pruned_transaction_count,
        batches.pruned_entry_count::text as pruned_entry_count,
        batches.pruned_transaction_ids_sha256,
        batches.pruned_entry_ids_sha256,
        (select count(*)::text from public.chips_transaction_idempotency registry
          where registry.transaction_id = any($2::uuid[]) and registry.archive_batch_id = batches.batch_id) as mapping_count,
        (select count(*)::text from public.chips_transaction_idempotency registry
          where registry.archive_batch_id = batches.batch_id and not (registry.transaction_id = any($2::uuid[]))) as extra_mapping_count,
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

function outputResult(result) {
  process.stdout.write(`${stringifyJson({
    event: "chips_ledger_archive_prune",
    target: "stage",
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
  if (args.target !== "stage") fail("--target must be explicitly set to stage; Production is unsupported");
  if (!args.objectPath) fail("--object-path is required");
  if (!SHA256_RE.test(text(args.confirmSha))) fail("--confirm-sha must be a lowercase SHA-256");
  if (args.objectPath !== buildObjectPath(args.confirmSha)) fail("--object-path does not match --confirm-sha");
  if (args.execute && !args.recoveryDir) fail("--recovery-dir is required with --execute");
  if (!args.execute && args.recoveryDir) fail("--recovery-dir is only valid with --execute");

  const target = resolveStorageTarget(args.target, env);
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
    assertStageIdentity(identity, row);
    if (row.status !== "committed" || !row.committed_at) fail("archive manifest is not committed");
    if (row.compressed_sha256 !== args.confirmSha) fail("--confirm-sha does not match committed manifest");

    const downloaded = deps.downloadArchive
      ? await deps.downloadArchive(target, row.object_path)
      : await downloadPrivateArchiveObject(target, row.object_path, deps);
    const archiveBytes = Buffer.from(downloaded.bytes);
    const archiveManifest = exporterManifestFromDatabase(row, target);
    const localArchive = verifyArchiveBytes({
      compressedBytes: archiveBytes,
      manifest: archiveManifest,
      target,
      artifactName: path.basename(row.object_path),
    });
    const evidence = buildPruneEvidence(localArchive);

    if (args.registerProof) {
      const proof = await store.registerProof(row, evidence);
      const result = {
        row,
        identity,
        evidence,
        mode: "register-proof",
        state: proof?.state || "proof_registered",
        storageDownloadMs: downloaded.downloadMs,
      };
      if (deps.emit !== false) outputResult(result);
      return result;
    }

    if (args.execute) assertProofMatches(row, evidence);
    let recoveryBundle = null;
    if (args.execute) {
      recoveryBundle = writeRecoveryBundle({
        recoveryDir: path.resolve(cwd, args.recoveryDir),
        archiveBytes,
        row,
        identity,
        evidence,
      });
    }

    const pruneResult = await executeArchivePrune({
      store,
      objectPath: row.object_path,
      evidence,
      execute: Boolean(args.execute),
      beforeAttempt: recoveryBundle
        ? () => verifyRecoveryBundle({ bundle: recoveryBundle, row, target, identity, expectedEvidence: evidence })
        : null,
    });

    let postCommitDownloadMs = null;
    if (args.execute) {
      try {
        await verifyBucket(target);
        const postCommitDownload = deps.downloadArchive
          ? await deps.downloadArchive(target, row.object_path)
          : await downloadPrivateArchiveObject(target, row.object_path, deps);
        postCommitDownloadMs = postCommitDownload.downloadMs;
        verifyArchiveBytes({
          compressedBytes: postCommitDownload.bytes,
          manifest: archiveManifest,
          target,
          artifactName: path.basename(row.object_path),
        });
        assertPostCommitVerification(await store.verifyCommitted(row, evidence), evidence);
      } catch (error) {
        if (error?.code === "post_commit_verification_failed") throw error;
        fail(`post-commit verification failed: ${error?.message || error}`, "post_commit_verification_failed");
      }
    }

    const result = {
      row,
      identity,
      evidence,
      mode: args.execute ? "execute" : "dry-run",
      state: pruneResult?.state || "unknown",
      storageDownloadMs: downloaded.downloadMs,
      postCommitDownloadMs,
      recoveryBundle,
    };
    if (deps.emit !== false) outputResult(result);
    return result;
  } finally {
    if (sql) await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  pruneArchive().catch((error) => {
    process.stderr.write(`chips-ledger-archive-prune failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
