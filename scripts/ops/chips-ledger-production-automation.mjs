import fs from "node:fs";
import crypto from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  BOT_ONLY_EXPORT_SCHEMA_VERSION,
  BOT_ONLY_RETENTION_DAYS,
  DEFAULT_CUTOFF_DAYS,
  runExport,
  normalizeTimestamp,
  timestampToMicros,
  PRODUCTION_AUTOMATION_POLICY_ID,
  PRODUCTION_BOT_ONLY_RETENTION_POLICY_ID,
  PRODUCTION_CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID,
  PRODUCTION_ESCROW_RETENTION_POLICY_ID,
} from "./chips-ledger-archive-export.mjs";
import {
  acquireRetentionAdvisoryLock,
  assertRetentionAdvisoryLock,
  assertDurableRecoveryReady,
  assertExactCanaryArgs,
  assertResumeRecoveryState,
  findOwnCycle,
  inspectDurableRecovery,
  inspectDurableRecoveryState,
  persistDurableRecovery,
  releaseRetentionAdvisoryLock,
  runRetentionCycle,
} from "./_shared/chips-ledger-retention-cycle.mjs";
import { validateRetentionEnvironment, resolveProductionAutomaticContext, effectiveProductionCap, assertProductionAutomaticContext } from "./_shared/chips-ledger-retention-profile.mjs";
import {
  canonicalJson,
  accountIdsSha256,
  assertProductionEscrowProfile,
  buildAccountRecoverySnapshot,
  ensureAccountRecoveryObject,
  serializeAccountRecovery,
  runWithEscrowRetry,
} from "./_shared/chips-ledger-escrow-retention.mjs";
import {
  createStorageVerificationContext,
  downloadPrivateArchiveObject,
  readPrivateObjectIfExists,
  uploadOrVerifyPrivateObject,
  verifyArchiveBytes,
  ensureArchiveBucket,
  resolveStorageTarget,
  storeArchive,
} from "./chips-ledger-archive-store.mjs";
import { createPruneStore, pruneArchive, buildPruneEvidence, exporterManifestFromDatabase } from "./chips-ledger-archive-prune.mjs";
import { ensurePrivateDirectory } from "./_shared/chips-ledger-archive-files.mjs";

const PRODUCTION_STATE_SQL = Object.freeze({
  identity: "select system_identifier::text as system_identifier from pg_catalog.pg_control_system();",
  control: `select enabled, max_transactions, activated_at::text as activated_at, existing_30d_canary_batch_id::text as existing_30d_canary_batch_id
      from public.chips_production_retention_control where control_id is true;`,
  fence: `select enforcement_active from public.chips_table_fence_control where control_id is true;`,
  policies: `select policy_id, enabled, canary_batch_id::text as canary_batch_id,
      activated_at::text as activated_at
    from public.chips_production_bot_only_retention_policy
    union all
    select policy_id, enabled, canary_batch_id::text as canary_batch_id,
      activated_at::text as activated_at
    from public.chips_production_closed_human_table_retention_policy
    union all
    select policy_id, enabled, canary_batch_id::text as canary_batch_id,
      activated_at::text as activated_at
    from public.chips_production_escrow_account_retention_policy;`,
});

export const PRODUCTION_POLICIES = Object.freeze({
  "existing-30d": PRODUCTION_AUTOMATION_POLICY_ID,
  "bot-only-7d": PRODUCTION_BOT_ONLY_RETENTION_POLICY_ID,
  "closed-human-30d": PRODUCTION_CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID,
  escrow: PRODUCTION_ESCROW_RETENTION_POLICY_ID,
});
export const PRODUCTION_MODES = Object.freeze(["diagnostic", "prepare", "canary", "automatic", "lifecycle-completion"]);

const SHA256_RE = /^[0-9a-f]{64}$/;

const PRODUCTION_OWN_BATCHES_SQL = `select object_path, source_policy_id, status,
    batch_id::text as batch_id, project_ref,
    transaction_count::text as transaction_count,
    entry_count::text as entry_count,
    compressed_sha256,
    created_at::text as created_at,
    pruned_at::text as pruned_at,
    archive_proof_verified_at::text as archive_proof_verified_at,
    registry_cleaned_at::text as registry_cleaned_at,
    account_retirement_at::text as account_retirement_at,
    account_retirement_account_count, account_retirement_account_ids_sha256,
    account_retirement_recovery_object_path, account_retirement_recovery_object_sha256,
    account_retirement_snapshot_sha256
  from public.chips_ledger_archive_batches
  where project_ref = $1 and source_policy_id = $2
  order by created_at desc, batch_id desc;`;

const PRODUCTION_EXECUTE_RECEIPT_FIELDS = Object.freeze([
  "pruned_at",
  "pruned_transaction_count",
  "pruned_entry_count",
  "pruned_transaction_ids_sha256",
  "pruned_entry_ids_sha256",
  "registry_cleaned_at",
  "registry_cleaned_key_count",
  "registry_cleaned_keys_sha256",
]);

const PRODUCTION_ESCROW_CANDIDATE_SQL = `select batches.*,
    accounts.id::text as account_id,
    accounts.user_id::text as account_user_id,
    accounts.system_key as account_system_key,
    accounts.account_type::text as account_account_type,
    accounts.status::text as account_status,
    accounts.label as account_label,
    accounts.balance::text as account_balance,
    accounts.next_entry_seq::text as account_next_entry_seq,
    accounts.created_at::text as account_created_at,
    accounts.updated_at::text as account_updated_at
  from public.chips_ledger_archive_batches batches
  join public.chips_accounts accounts
    on accounts.system_key = 'POKER_TABLE:' || batches.bot_only_table_id::text
   and accounts.account_type::text = 'ESCROW'
   and accounts.user_id is null
   and lower(accounts.status::text) = 'active'
   and accounts.balance = 0
  where batches.project_ref = $1
    and batches.source_policy_id = $2
    and batches.status = 'committed'
    and batches.pruned_at is not null
    and batches.registry_cleaned_at is not null
    and batches.account_retirement_at is null
    and batches.bot_only_table_id is not null
    and batches.bot_only_table_count = 1
    and not exists (select 1 from public.poker_tables tables where tables.id = batches.bot_only_table_id)
    and not exists (select 1 from public.chips_entries entries where entries.account_id = accounts.id)
    and not exists (select 1 from public.chips_account_snapshot snapshots where snapshots.account_id = accounts.id)
    and not exists (
      select 1 from public.chips_transaction_idempotency registry
      where registry.table_id = batches.bot_only_table_id
         or registry.archive_batch_id = batches.batch_id
    )
    and ($3::bigint is null or batches.batch_id = $3::bigint)
  order by batches.batch_id asc
  limit 2;`;

function text(value) {
  return value == null ? "" : String(value).trim();
}

function fail(message) {
  throw new Error(message);
}

function klog(event, data) {
  process.stdout.write(`${JSON.stringify({ event, ...data })}\n`);
}

function policyKey(policy) {
  const key = text(policy);
  if (!Object.hasOwn(PRODUCTION_POLICIES, key)) fail("Production policy must be existing-30d, bot-only-7d, closed-human-30d, or escrow");
  return key;
}

export function parseProductionAutomationArgs(argv = process.argv.slice(2)) {
  const args = {};
  const valueArgs = new Map([
    ["--policy", "policy"],
    ["--mode", "mode"],
    ["--batch-id", "batchId"],
    ["--confirmation", "confirmation"],
    ["--table-id", "tableId"],
    ["--cutoff", "cutoff"],
    ["--completion-confirmation", "completionConfirmation"],
    ["--account-ids-sha256", "accountIdsSha256"],
    ["--recovery-object-path", "recoveryObjectPath"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") return { help: true };
    const key = valueArgs.get(token);
    if (!key || args[key] !== undefined) fail(`unknown or repeated argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${token} requires a value`);
    args[key] = value;
    index += 1;
  }
  if (!args.policy || !args.mode) fail("--policy and --mode are required");
  policyKey(args.policy);
  if (!PRODUCTION_MODES.includes(args.mode)) fail("Production mode must be diagnostic, prepare, canary, automatic, or lifecycle-completion");
  return args;
}

function selectorForPolicy(policy) {
  switch (policy) {
    case "existing-30d": return "prunable";
    case "bot-only-7d": return "bot-only-7d";
    case "closed-human-30d": return "closed-human-table-30d";
    case "escrow": return "bot-only-7d-discovery";
    default: fail(`unsupported Production policy: ${policy}`);
  }
}

function archivePolicyIdFor(policy) {
  return policy === "escrow"
    ? PRODUCTION_BOT_ONLY_RETENTION_POLICY_ID
    : PRODUCTION_POLICIES[policy];
}

function requireCanaryAuthorization({ mode, env, batchId, confirmation, policy, accountIdsSha256 = null, recoveryObjectPath = null }) {
  if (mode !== "canary") return;
  if (env.CHIPS_LEDGER_PRODUCTION_CANARY !== "1") fail("Production canary requires CHIPS_LEDGER_PRODUCTION_CANARY=1");
  assertExactCanaryArgs({ batchId, confirmation, maxTransactions: 2 });
  if (policy === "escrow") {
    const expectedHash = text(env.CHIPS_LEDGER_PRODUCTION_ACCOUNT_IDS_SHA256);
    if (!SHA256_RE.test(expectedHash) || expectedHash !== expectedHash.toLowerCase()
      || !SHA256_RE.test(text(accountIdsSha256))
      || text(accountIdsSha256) !== expectedHash) {
      fail("Production escrow canary requires the exact account ID SHA-256");
    }
    if (!/^account-recovery\/v1\/sha256\/[0-9a-f]{64}\.json\.gz$/.test(text(recoveryObjectPath))) {
      fail("Production escrow canary requires the exact recovery object path");
    }
  }
}

function requireAutomaticAuthorization({ env, mode }) {
  if (mode !== "automatic") return;
  if (env.CHIPS_LEDGER_PRODUCTION_AUTOMATION_ENABLED !== "1") fail("Production automatic cleanup is disabled");
  const ownerWorkflow = {
    GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
    GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY_OWNER: "krzysztofcal", GITHUB_ACTOR: "krzysztofcal",
  };
  for (const [key, expected] of Object.entries(ownerWorkflow)) {
    if (text(env[key]) !== expected) fail(`Production automatic cleanup requires canonical owner workflow ${key}`);
  }
}

function requireLifecycleAuthorization({ env, mode, policy, batchId, tableId, cutoff, completionConfirmation, confirmation }) {
  if (mode !== "lifecycle-completion") {
    if (tableId != null || cutoff != null || completionConfirmation != null) fail("completion inputs require lifecycle-completion mode");
    return;
  }
  if (policy !== "closed-human-30d" || !/^[1-9][0-9]*$/.test(text(batchId))
    || completionConfirmation !== `COMPLETE HUMAN RETENTION ${batchId}` || confirmation != null
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text(tableId))
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(text(cutoff))
    || !Number.isFinite(Date.parse(cutoff))) fail("exact lifecycle batch, table, cutoff and completion confirmation are required");
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REPOSITORY !== "krzysztofcal/arcadePlatform"
    || env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_REPOSITORY_OWNER !== "krzysztofcal"
    || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER
    || env.GITHUB_SHA !== env.DEPLOYED_COMMIT_SHA) fail("Production lifecycle completion requires exact-SHA owner/main dispatch");
}

function productionExportArgs(policy, outputPath, manifestPath, automaticContext = null) {
  const cutoffDays = policy === "bot-only-7d" || policy === "escrow"
    ? BOT_ONLY_RETENTION_DAYS
    : DEFAULT_CUTOFF_DAYS;
  return ["--target", "prod", "--output", outputPath, "--manifest", manifestPath, "--cutoff-days", String(cutoffDays), "--batch-size", String(effectiveProductionCap(automaticContext))];
}

async function readProductionState({ profile, deps = {}, session = null } = {}) {
  if (typeof deps.sqlRead === "function") return deps.sqlRead({ profile });
  const sql = session || postgres(profile.dbUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 30,
  });
  try {
    return await sql.begin(async (tx) => {
      await tx.unsafe("set transaction isolation level repeatable read, read only;");
      const identityRows = await tx.unsafe(PRODUCTION_STATE_SQL.identity);
      const systemIdentifier = text(identityRows[0]?.system_identifier);
      if (systemIdentifier !== profile.systemIdentifier) fail("database is not canonical Production");
      const controlRows = await tx.unsafe(PRODUCTION_STATE_SQL.control);
      const fenceRows = await tx.unsafe(PRODUCTION_STATE_SQL.fence);
      const policyRows = await tx.unsafe(PRODUCTION_STATE_SQL.policies);
      if (controlRows.length !== 1 || fenceRows.length !== 1 || policyRows.length !== 3) {
        fail("Production retention contract is incomplete or non-singleton");
      }
      return {
        projectRef: profile.projectRef,
        systemIdentifier,
        readOnly: true,
        control: controlRows[0],
        fenceActive: fenceRows[0].enforcement_active === true || fenceRows[0].enforcement_active === "t",
        policies: policyRows,
      };
    });
  } finally {
    if (!session) await sql.end({ timeout: 5 });
  }
}

function productionTargetOptions() {
  return { singleTarget: true };
}

function productionStorageDeps(deps, storageTarget) {
  const storageVerificationContext = deps.storageVerificationContext || createStorageVerificationContext();
  const storageDeps = { ...deps, storageVerificationContext };
  const verifyBucket = deps.verifyBucket || ((target, options = {}) => (
    options.fresh
      ? storageVerificationContext.verifyFresh(target, storageDeps)
      : storageVerificationContext.verify(target, storageDeps)
  ));
  return { storageDeps, verifyBucket, storageTarget };
}

function assertProductionActiveCanaryBatch({ row, batchId, profile, sourcePolicyId }) {
  if (!row
    || text(row.batch_id) !== text(batchId)
    || row.project_ref !== profile.projectRef
    || row.source_policy_id !== sourcePolicyId
    || row.status !== "committed"
    || !row.committed_at
    || row.pruned_at != null) {
    fail("active Production batch manifest does not match the exact prepared batch");
  }
  if (!row.archive_proof_verified_at
    || !SHA256_RE.test(text(row.archived_transaction_ids_sha256))
    || !SHA256_RE.test(text(row.archived_entry_ids_sha256))) {
    fail("active Production batch is missing its immutable archive proof");
  }
  if (PRODUCTION_EXECUTE_RECEIPT_FIELDS.some((field) => row[field] != null)) {
    fail("active Production batch has a partial cleanup receipt");
  }
  if ((row.destructive_go_at == null) !== (row.destructive_go_batch_id == null)
    || (row.destructive_go_batch_id != null && text(row.destructive_go_batch_id) !== text(batchId))) {
    fail("active Production batch has a partial or foreign destructive GO");
  }
  return row;
}

function assertProductionPrepareBatch(row, activeRow, batchId, profile, sourcePolicyId) {
  if (!batchId || !/^[1-9][0-9]*$/.test(text(batchId))
    || text(activeRow?.batch_id) !== text(batchId) || text(row?.batch_id) !== text(batchId)) {
    fail("exact active Production batch ID does not match --batch-id");
  }
  if (row.project_ref !== profile.projectRef || row.source_policy_id !== sourcePolicyId
    || row.status !== "committed" || !row.committed_at
    || activeRow.project_ref !== row.project_ref || activeRow.source_policy_id !== row.source_policy_id
    || activeRow.status !== row.status || activeRow.object_path !== row.object_path
    || activeRow.compressed_sha256 !== row.compressed_sha256
    || !SHA256_RE.test(text(row.compressed_sha256)) || !SHA256_RE.test(text(row.raw_sha256))
    || row.object_path !== `v1/sha256/${row.compressed_sha256}.jsonl.gz`
    || !Number.isInteger(Number(row.transaction_count)) || Number(row.transaction_count) < 1
    || Number(row.transaction_count) > 2 || Number(row.entry_count) !== Number(row.transaction_count) * 2
    || String(activeRow.transaction_count) !== String(row.transaction_count)
    || String(activeRow.entry_count) !== String(row.entry_count)) {
    fail("active Production PREPARE batch identity, archive or cap differs");
  }
  if (PRODUCTION_EXECUTE_RECEIPT_FIELDS.some(field => row[field] != null)
    || row.destructive_go_at != null || row.destructive_go_batch_id != null
    || [row, activeRow].some(manifest => ["account_retirement_at", "account_retirement_account_count",
      "account_retirement_account_ids_sha256", "account_retirement_recovery_object_path",
      "account_retirement_recovery_object_sha256", "account_retirement_snapshot_sha256"]
      .some(field => manifest[field] != null))) {
    fail("active Production PREPARE batch has cleanup receipts or destructive GO");
  }
  const proof = [row.archive_proof_verified_at, row.archived_transaction_ids_sha256, row.archived_entry_ids_sha256];
  if (!proof.every(value => value == null)
    && !(proof[0] && SHA256_RE.test(text(proof[1])) && SHA256_RE.test(text(proof[2])))) {
    fail("active Production PREPARE batch has a partial immutable proof");
  }
}

async function resumeProductionPrepareBatch({ activeRow, profile, env, policy, batchId,
  sql, lockSession, pruneStore, storageTarget, verifyBucket, storageDeps, tempRoot, deps }) {
  const sourcePolicyId = PRODUCTION_POLICIES[policy];
  let row = await pruneStore.getManifest(activeRow.object_path);
  assertProductionPrepareBatch(row, activeRow, batchId, profile, sourcePolicyId);
  await verifyBucket(storageTarget);
  const inspect = deps.inspectDurableRecoveryState || inspectDurableRecoveryState;
  const recovery = await inspect(storageTarget, row, profile, null, storageDeps);
  if (!["both_missing", "complete"].includes(recovery?.state)) fail("active Production PREPARE recovery is partial or unknown");
  const main = await (deps.downloadPrivateArchiveObject || downloadPrivateArchiveObject)(storageTarget, row.object_path, storageDeps);
  if (crypto.createHash("sha256").update(main.bytes).digest("hex") !== row.compressed_sha256) {
    fail("active Production PREPARE archive SHA differs");
  }
  const runPrune = deps.pruneArchive || pruneArchive;
  const pruneDeps = { ...storageDeps, sql, pruneStore, storageTarget,
    targetOptions: productionTargetOptions(), verifyBucket, emit: false };
  const args = ["--target", "prod", "--object-path", row.object_path, "--confirm-sha", row.compressed_sha256];
  await assertRetentionAdvisoryLock(sql, lockSession);
  if (!row.archive_proof_verified_at) {
    await runPrune({ argv: [...args, "--register-proof"], env, cwd: tempRoot, deps: pruneDeps });
  }
  row = await pruneStore.getManifest(activeRow.object_path);
  assertProductionPrepareBatch(row, activeRow, batchId, profile, sourcePolicyId);
  if (!row.archive_proof_verified_at) fail("active Production PREPARE proof registration is incomplete");
  await assertRetentionAdvisoryLock(sql, lockSession);
  const dry = await runPrune({ argv: args, env, cwd: tempRoot, deps: pruneDeps });
  if (dry?.state !== "ready" || dry.read_only !== true || !dry.evidence
    || dry.evidence.transactionCount !== Number(row.transaction_count)
    || dry.evidence.entryCount !== Number(row.entry_count)
    || dry.evidence.transactionIdsSha256 !== row.archived_transaction_ids_sha256
    || dry.evidence.entryIdsSha256 !== row.archived_entry_ids_sha256) {
    fail("active Production PREPARE dry-run evidence differs from immutable proof");
  }
  await assertRetentionAdvisoryLock(sql, lockSession);
  const durable = await (deps.persistDurableRecovery || persistDurableRecovery)(storageTarget, row, profile, dry.evidence, main.bytes, storageDeps);
  assertDurableRecoveryReady(durable);
  await assertRetentionAdvisoryLock(sql, lockSession);
  assertProductionPrepareBatch(await pruneStore.getManifest(activeRow.object_path), activeRow, batchId, profile, sourcePolicyId);
  return { state: "prepared", resumed: true, batchId: String(row.batch_id),
    transactions: dry.evidence.transactionCount, entries: dry.evidence.entryCount,
    compressedSha256: row.compressed_sha256, recoveryArchiveSha256: durable.recoveryArchive.sha256,
    recoveryManifestSha256: durable.recoveryManifest.sha256 };
}

function assertProductionHumanPrunedBatch(row, batchId, cutoff = null, automaticContext = null) {
  if (!row || text(row.batch_id) !== text(batchId) || row.project_ref !== "otbqfijerkieoxwpxjnm"
    || row.source_policy_id !== PRODUCTION_POLICIES["closed-human-30d"] || row.status !== "committed"
    || Number(row.format_version) !== 1 || !row.committed_at || !row.cutoff || !Number.isFinite(new Date(row.cutoff).getTime())
    || (cutoff != null && new Date(row.cutoff).getTime() !== Date.parse(cutoff))
    || !row.archive_proof_verified_at || !SHA256_RE.test(text(row.compressed_sha256))
    || !SHA256_RE.test(text(row.archived_transaction_ids_sha256)) || !SHA256_RE.test(text(row.archived_entry_ids_sha256))
    || row.object_path !== `v1/sha256/${row.compressed_sha256}.jsonl.gz`
    || !Number.isSafeInteger(Number(row.transaction_count)) || Number(row.transaction_count) < 1 || Number(row.transaction_count) > effectiveProductionCap(automaticContext, row.source_policy_id)
    || Number(row.entry_count) !== Number(row.transaction_count) * 2
    || !row.pruned_at || Number(row.pruned_transaction_count) !== Number(row.transaction_count)
    || Number(row.pruned_entry_count) !== Number(row.entry_count)
    || row.pruned_transaction_ids_sha256 !== row.archived_transaction_ids_sha256
    || row.pruned_entry_ids_sha256 !== row.archived_entry_ids_sha256
    || [row.registry_cleaned_at, row.registry_cleaned_key_count, row.registry_cleaned_keys_sha256].some(value => value != null)
    || row.destructive_go_at == null
    || text(row.destructive_go_batch_id) !== text(batchId)) fail("closed-human lifecycle batch identity, cutoff, proof or prune receipt differs");
}

// A completed archive has durable financial evidence, but its live table may
// have been removed by marker-gated WS cleanup. Never replay its policy SQL.
async function verifyProductionHumanCompletedEvidence({ row, profile, storageTarget, pruneStore, storageDeps }) {
  const downloaded = await (storageDeps.downloadArchive || downloadPrivateArchiveObject)(storageTarget, row.object_path, storageDeps);
  const bytes = Buffer.from(downloaded.bytes);
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== row.compressed_sha256) fail("completed human archive SHA differs");
  const archive = (storageDeps.verifyArchiveBytes || verifyArchiveBytes)({ compressedBytes: bytes,
    manifest: exporterManifestFromDatabase(row, storageTarget), target: storageTarget, artifactName: path.basename(row.object_path) });
  const evidence = (storageDeps.buildPruneEvidence || buildPruneEvidence)(archive, { maxBatchSize: effectiveProductionCap(storageTarget.automaticContext, row.source_policy_id) });
  if (!evidence.closedHumanTableId || evidence.transactionCount !== Number(row.transaction_count)
    || evidence.entryCount !== Number(row.entry_count) || evidence.transactionIdsSha256 !== row.archived_transaction_ids_sha256
    || evidence.entryIdsSha256 !== row.archived_entry_ids_sha256) fail("completed human archive proof differs");
  const durable = await (storageDeps.inspectDurableRecovery || inspectDurableRecovery)(storageTarget, row, profile, evidence, storageDeps);
  assertResumeRecoveryState(row, durable, profile);
  const committed = await pruneStore.verifyCommitted(row, evidence);
  if (!committed?.pruned_at || Number(committed.pruned_transaction_count) !== evidence.transactionCount
    || Number(committed.pruned_entry_count) !== evidence.entryCount
    || committed.pruned_transaction_ids_sha256 !== evidence.transactionIdsSha256
    || committed.pruned_entry_ids_sha256 !== evidence.entryIdsSha256
    || Number(committed.mapping_count) !== evidence.transactionCount || Number(committed.remaining_mapping_count) !== evidence.transactionCount
    || String(committed.extra_mapping_count) !== "0" || String(committed.hot_transaction_count) !== "0"
    || String(committed.hot_entry_count) !== "0") fail("completed human receipt, registry or hot rows differ");
  return { state: "already_pruned", read_only: true, archiveSha256: row.compressed_sha256, evidence, durable };
}

function humanLifecycleReceipt(row, profile, tableId, marker) {
  const markerAt = normalizeTimestamp(marker, "human completion marker");
  if (timestampToMicros(markerAt) < timestampToMicros(row.pruned_at) || Date.parse(markerAt) > Date.now()) fail("human lifecycle receipt marker time is invalid");
  return { schema_version: 1, artifact_type: "production_closed_human_lifecycle", project_ref: profile.projectRef,
    system_identifier: profile.systemIdentifier, policy_id: row.source_policy_id, batch_id: String(row.batch_id), table_id: tableId,
    cutoff: normalizeTimestamp(row.cutoff), archive_sha256: row.compressed_sha256, raw_sha256: row.raw_sha256,
    transaction_ids_sha256: row.archived_transaction_ids_sha256, entry_ids_sha256: row.archived_entry_ids_sha256,
    transactions: Number(row.transaction_count), entries: Number(row.entry_count), destructive_go_at: normalizeTimestamp(row.destructive_go_at),
    pruned_at: normalizeTimestamp(row.pruned_at), marker_at: markerAt };
}

function humanLifecycleReceiptPath(row) {
  return `recovery/v1/sha256/${row.compressed_sha256}.human-lifecycle.json.gz`;
}

async function readHumanLifecycleReceipt({ row, profile, tableId, storageTarget, storageDeps }) {
  const object = await (storageDeps.readPrivateObjectIfExists || readPrivateObjectIfExists)(storageTarget, humanLifecycleReceiptPath(row), storageDeps);
  if (!object) return null;
  if (object.mimeType !== "application/gzip" || object.bytes.length > 16384
    || object.sha256 !== crypto.createHash("sha256").update(object.bytes).digest("hex")) fail("human lifecycle receipt MIME, size or SHA differs");
  let receipt;
  try { receipt = JSON.parse(gunzipSync(object.bytes, { maxOutputLength: 16384 }).toString("utf8")); }
  catch { fail("human lifecycle receipt gzip/JSON is invalid"); }
  if (canonicalJson(receipt) !== canonicalJson(humanLifecycleReceipt(row, profile, tableId, receipt?.marker_at))) fail("human lifecycle receipt binding differs");
  return receipt;
}

async function persistHumanLifecycleReceipt({ row, profile, tableId, marker, storageTarget, storageDeps }) {
  const receipt = humanLifecycleReceipt(row, profile, tableId, marker);
  const existing = await readHumanLifecycleReceipt({ row, profile, tableId, storageTarget, storageDeps });
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(receipt)) fail("human lifecycle receipt marker differs");
    return 0;
  }
  const bytes = gzipSync(Buffer.from(`${JSON.stringify(receipt)}\n`), { level: 9, mtime: 0 });
  const uploaded = await (storageDeps.uploadOrVerifyPrivateObject || uploadOrVerifyPrivateObject)({
    storageTarget, objectPath: humanLifecycleReceiptPath(row), bytes, deps: storageDeps });
  const verified = await readHumanLifecycleReceipt({ row, profile, tableId, storageTarget, storageDeps });
  if (!verified || canonicalJson(verified) !== canonicalJson(receipt)) fail("human lifecycle receipt persistence is incomplete");
  return uploaded.uploaded ? 1 : 0;
}

async function verifyAbsentHumanLifecycle({ tx, row, profile, tableId, cutoff, storageTarget, storageDeps }) {
  // Mirror the table-independent half of the SQL lifecycle gate; additionally
  // require exact GO and no remaining entries in the table's zero escrow.
  const history = await tx.unsafe(`select count(*)::text as invalid from public.chips_transaction_idempotency r
    left join public.chips_ledger_archive_batches b on b.batch_id = r.archive_batch_id
    where r.table_id = $1::uuid and (r.transaction_created_at >= $2::timestamptz or r.archive_batch_id is null
      or not coalesce(b.status = 'committed' and b.archive_proof_verified_at is not null and b.pruned_at is not null
        and b.destructive_go_at is not null and b.destructive_go_batch_id = b.batch_id
        and b.pruned_transaction_count = b.transaction_count and b.pruned_entry_count = b.entry_count
        and b.pruned_transaction_ids_sha256 = b.archived_transaction_ids_sha256 and b.pruned_entry_ids_sha256 = b.archived_entry_ids_sha256
        and b.source_policy_id in ('production-ledger-auto-retention-30d-v1', 'production-ledger-closed-human-table-retention-30d-v1'), false));`, [tableId, cutoff]);
  const escrow = await tx.unsafe(`select a.id, a.status, a.balance::text,
    (select count(*)::text from public.chips_entries e where e.account_id = a.id) as hot_entries
    from public.chips_accounts a where a.account_type = 'ESCROW' and a.system_key = $1 for update;`, [`POKER_TABLE:${tableId}`]);
  if (history.length !== 1 || history[0].invalid !== "0" || escrow.length !== 1 || escrow[0].status !== "active"
    || escrow[0].balance !== "0" || escrow[0].hot_entries !== "0") fail("absent human table history or escrow is incomplete");
  const receipt = await readHumanLifecycleReceipt({ row, profile, tableId, storageTarget, storageDeps });
  if (receipt) return { state: "already_pruned_table_absent", marker: receipt.marker_at, completionEvidence: "immutable_lifecycle_receipt" };
  // E3 checked the exact historical canary marker before atomically activating
  // this immutable canary binding. It cannot prove completion of any other batch.
  const activation = await tx.unsafe(`select p.canary_batch_id::text, p.canary_confirmation, p.activated_at::text,
      c.activated_at::text as control_activated_at, c.activation_confirmation
    from public.chips_production_closed_human_table_retention_policy p cross join public.chips_production_retention_control c
    where p.policy_id = $1 and p.canary_batch_id = $2::bigint and p.canary_batch_id = 4 and p.canary_confirmation = 'GO 4'
      and p.enabled is true and p.activated_at is not null and c.enabled is true and c.max_transactions = 5000 and c.activated_at is not null
      and exists(select 1 from supabase_migrations.schema_migrations where version = '20260914092000');`, [row.source_policy_id, row.batch_id]);
  const anchor = activation[0];
  if (activation.length !== 1 || String(row.batch_id) !== "4" || anchor.canary_batch_id !== "4" || anchor.canary_confirmation !== "GO 4"
    || tableId !== "7f3d73e4-36c5-4b66-afe6-d1d41bea13e2"
    || !/^ACTIVATE PRODUCTION RETENTION otbqfijerkieoxwpxjnm [0-9a-f]{64}$/.test(anchor.activation_confirmation)
    || !(timestampToMicros(anchor.activated_at) >= timestampToMicros(row.pruned_at))
    || !(timestampToMicros(anchor.control_activated_at) >= timestampToMicros(row.pruned_at))) fail("absent human table has no durable lifecycle completion evidence");
  return { state: "already_pruned_table_absent", marker: null, completionEvidence: "e3_activation_canary" };
}

async function finalizeProductionHumanLifecycle({ sql, lockSession, pruneStore, storageTarget,
  verifyBucket, storageDeps, env, profile, row, batchId, tableId = null, cutoff = null,
  tempRoot, deps, allowComplete = true, manualOnly = false, automaticContext = null }) {
  row = await pruneStore.getManifest(row.object_path);
  assertProductionHumanPrunedBatch(row, batchId, cutoff, automaticContext);
  await assertRetentionAdvisoryLock(sql, lockSession);
  await verifyBucket(storageTarget);
  const dry = automaticContext
    ? await verifyProductionHumanCompletedEvidence({ row, profile, storageTarget, pruneStore, storageDeps })
    : await (deps.pruneArchive || pruneArchive)({
    argv: ["--target", "prod", "--object-path", row.object_path, "--confirm-sha", row.compressed_sha256],
    env, cwd: tempRoot, deps: { ...storageDeps, sql, pruneStore, storageTarget,
      targetOptions: productionTargetOptions(), verifyBucket, emit: false, automaticContext } });
  const evidence = dry?.evidence;
  if (dry?.state !== "already_pruned" || dry.read_only !== true || dry.archiveSha256 !== row.compressed_sha256
    || !evidence || evidence.transactionCount !== Number(row.transaction_count) || evidence.entryCount !== Number(row.entry_count)
    || evidence.transactionIdsSha256 !== row.archived_transaction_ids_sha256 || evidence.entryIdsSha256 !== row.archived_entry_ids_sha256
    || !evidence.closedHumanTableId || (tableId != null && evidence.closedHumanTableId !== tableId)) {
    fail("closed-human lifecycle dry-run archive, table or proof differs");
  }
  tableId = evidence.closedHumanTableId;
  cutoff ||= row.cutoff;
  const timestampValue = typeof sql.typed === "function" ? sql.typed(cutoff, 25) : cutoff;
  const durable = dry.durable || await (deps.inspectDurableRecovery || inspectDurableRecovery)(storageTarget, row, profile, evidence, storageDeps);
  assertResumeRecoveryState(row, durable, profile);
  await assertRetentionAdvisoryLock(sql, lockSession);
  const lifecycle = await sql.begin(async tx => {
    await tx.unsafe("set transaction isolation level serializable;");
    await tx.unsafe("set local lock_timeout = '5s';");
    await tx.unsafe("set local statement_timeout = '120s';");
    const identity = await tx.unsafe("select system_identifier::text as system_identifier from pg_catalog.pg_control_system();");
    if (text(identity[0]?.system_identifier) !== profile.systemIdentifier) fail("lifecycle database is not canonical Production");
    if (manualOnly) {
      const controls = await tx.unsafe(PRODUCTION_STATE_SQL.control);
      const fences = await tx.unsafe(PRODUCTION_STATE_SQL.fence);
      const policies = await tx.unsafe(PRODUCTION_STATE_SQL.policies);
      if (controls.length !== 1 || controls[0].enabled !== false || Number(controls[0].max_transactions) !== 2
        || fences.length !== 1 || fences[0].enforcement_active !== true
        || policies.length !== 3 || policies.some(p => p.enabled !== false)) {
        fail("locked manual completion requires fence ON, policies/control OFF and cap 2");
      }
    }
    await assertProductionAutomaticContext(tx, automaticContext, PRODUCTION_POLICIES["closed-human-30d"], Number(row.transaction_count));
    const locked = await tx.unsafe("select * from public.chips_ledger_archive_batches where batch_id = $1::bigint and cutoff = $2::timestamptz for update;", [batchId, timestampValue]);
    if (locked.length !== 1) fail("exact lifecycle batch/cutoff is missing or ambiguous");
    assertProductionHumanPrunedBatch(locked[0], batchId, cutoff, automaticContext);
    for (const field of ["object_path", "compressed_sha256", "raw_sha256", "archived_transaction_ids_sha256", "archived_entry_ids_sha256"]) {
      if (locked[0][field] !== row[field]) fail("lifecycle locked manifest differs from verified archive");
    }
    const markerQuery = "select id::text, status::text, has_human_participant, human_retention_complete_at::text from public.poker_tables where id = $1::uuid";
    const marker = await tx.unsafe(`${markerQuery} for update;`, [tableId]);
    if (marker.length > 1 || (marker.length === 1 && (marker[0].id !== tableId || marker[0].status !== "CLOSED" || marker[0].has_human_participant !== true))
      || (marker.length === 0 && !automaticContext)) fail("lifecycle table identity differs");
    const registry = await tx.unsafe("select transaction_id::text, archive_batch_id::text, table_id::text from public.chips_transaction_idempotency where table_id = $1::uuid order by transaction_id;", [tableId]);
    const bound = registry.filter(r => evidence.transactionIds.includes(r.transaction_id));
    if (bound.length !== evidence.transactionCount || bound.some(r => r.archive_batch_id !== String(batchId) || r.table_id !== tableId)
      || new Set(bound.map(r => r.transaction_id)).size !== evidence.transactionCount) fail("lifecycle retained registry binding differs");
    if (marker.length === 0) return verifyAbsentHumanLifecycle({ tx, row, profile, tableId, cutoff: timestampValue, storageTarget, storageDeps });
    await tx.unsafe("select public.chips_assert_closed_human_table_lifecycle_gate($1::uuid, $2::timestamptz, null);", [tableId, timestampValue]);
    const markerBefore = marker[0].human_retention_complete_at;
    if (!markerBefore) {
      if (!allowComplete) fail("closed-human lifecycle marker is missing; use separately authorized lifecycle-completion");
      await assertRetentionAdvisoryLock(tx, lockSession);
      const completed = await tx.unsafe("select public.chips_complete_closed_human_table_retention($1::uuid, $2::timestamptz) as result;", [tableId, timestampValue]);
      if (completed.length !== 1 || completed[0].result?.state !== "human_retention_complete"
        || completed[0].result?.table_id !== tableId) fail("lifecycle completion returned an unexpected result");
    }
    await tx.unsafe("select public.chips_assert_closed_human_table_lifecycle_gate($1::uuid, $2::timestamptz, null);", [tableId, timestampValue]);
    const after = await tx.unsafe(markerQuery, [tableId]);
    if (after.length !== 1 || !after[0].human_retention_complete_at
      || (markerBefore && after[0].human_retention_complete_at !== markerBefore)) fail("lifecycle marker was not persisted or changed");
    return { state: markerBefore ? "already_complete" : "completed", marker: after[0].human_retention_complete_at };
  });
  await assertRetentionAdvisoryLock(sql, lockSession);
  const receiptWrites = automaticContext && lifecycle.state !== "already_pruned_table_absent"
    ? await persistHumanLifecycleReceipt({ row, profile, tableId, marker: lifecycle.marker, storageTarget, storageDeps }) : 0;
  await assertRetentionAdvisoryLock(sql, lockSession);
  return { ...lifecycle, maxTransactions: effectiveProductionCap(automaticContext), batchId: String(batchId), tableId, cutoff, dryRun: automaticContext ? "verified_completed_evidence" : "already_pruned",
    transactions: evidence.transactionCount, entries: evidence.entryCount, compressedSha256: row.compressed_sha256,
    transactionProofSha256: row.archived_transaction_ids_sha256, entryProofSha256: row.archived_entry_ids_sha256,
    pruneReceipt: { at: row.pruned_at, transactions: Number(row.pruned_transaction_count), entries: Number(row.pruned_entry_count) },
    storageWrites: receiptWrites, databaseWrites: lifecycle.state === "completed" ? 1 : 0,
    recoveryArchiveSha256: durable.recoveryArchive.sha256, recoveryManifestSha256: durable.recoveryManifest.sha256 };
}

async function resumeProductionCanaryBatch({
  activeRow,
  profile,
  env,
  policy,
  mode,
  batchId,
  confirmation,
  sql,
  lockSession,
  pruneStore,
  storageTarget,
  verifyBucket,
  storageDeps,
  tempRoot,
  deps,
  automaticContext = null,
}) {
  const sourcePolicyId = PRODUCTION_POLICIES[policy];
  if (mode !== "canary" && mode !== "automatic") fail("only Production canary or activated automatic may resume an active batch");
  if (text(activeRow?.batch_id) !== text(batchId)) {
    fail("exact active Production batch ID does not match --batch-id");
  }
  if (activeRow?.project_ref !== profile.projectRef
    || activeRow?.source_policy_id !== sourcePolicyId
    || activeRow?.status !== "committed"
    || activeRow?.pruned_at != null) {
    fail("active Production batch summary does not match the exact prepared batch");
  }
  let row = await pruneStore.getManifest(activeRow.object_path);
  assertProductionActiveCanaryBatch({ row, batchId, profile, sourcePolicyId });
  await verifyBucket(storageTarget);

  const runPrune = deps.pruneArchive || pruneArchive;
  const pruneDeps = {
    ...storageDeps,
    sql,
    pruneStore,
    storageTarget,
    targetOptions: productionTargetOptions(),
    verifyBucket,
    emit: false,
    automaticContext,
  };
  const dry = await runPrune({
    argv: ["--target", "prod", "--object-path", row.object_path, "--confirm-sha", row.compressed_sha256],
    env,
    cwd: tempRoot,
    deps: pruneDeps,
  });
  if (dry?.state !== "ready") fail(`active Production canary dry-run did not become ready: ${dry?.state || "unknown"}`);
  if (!dry.evidence
    || dry.evidence.transactionIdsSha256 !== row.archived_transaction_ids_sha256
    || dry.evidence.entryIdsSha256 !== row.archived_entry_ids_sha256) {
    fail("active Production canary dry-run evidence does not match the committed proof");
  }

  row = await pruneStore.getManifest(activeRow.object_path);
  assertProductionActiveCanaryBatch({ row, batchId, profile, sourcePolicyId });
  const inspectRecovery = storageDeps.inspectDurableRecovery || inspectDurableRecovery;
  const durable = await inspectRecovery(storageTarget, row, profile, dry.evidence, storageDeps);
  assertResumeRecoveryState(row, durable, profile);
  assertDurableRecoveryReady(durable);

  await assertRetentionAdvisoryLock(sql, lockSession);
  if (mode === "canary") {
    const authorization = await authorizeProductionBatch({ sql, policy, batchId, confirmation, deps });
    if (!authorization
      || text(authorization.state) !== "authorized"
      || text(authorization.batch_id) !== text(batchId)) {
      fail("Production canary authorization did not persist the exact batch GO");
    }
    row = await pruneStore.getManifest(activeRow.object_path);
    assertProductionActiveCanaryBatch({ row, batchId, profile, sourcePolicyId });
    if (!row.destructive_go_at || text(row.destructive_go_batch_id) !== text(batchId)) {
      fail("Production canary authorization did not persist the exact destructive GO");
    }
  }
  await assertProductionAutomaticContext(sql, automaticContext, sourcePolicyId, Number(row.transaction_count));
  await assertRetentionAdvisoryLock(sql, lockSession);
  const recoveryDir = archiveRecoveryDir(tempRoot);
  const executed = await runPrune({
    argv: [
      "--target", "prod",
      "--object-path", row.object_path,
      "--confirm-sha", row.compressed_sha256,
      "--execute",
      "--recovery-dir", recoveryDir,
      ...(mode === "automatic" ? ["--automatic"] : ["--approved-batch-id", String(batchId)]),
    ],
    env,
    cwd: tempRoot,
    deps: {
      ...pruneDeps,
      downloadArchive: async () => ({ bytes: durable.archiveBytes, downloadMs: 0 }),
    },
  });
  return {
    maxTransactions: effectiveProductionCap(automaticContext),
    state: executed?.state || "unknown",
    receipt: executed?.state || "unknown",
    projectRef: profile.projectRef,
    systemIdentifier: profile.systemIdentifier,
    batchId: String(batchId),
    transactions: dry.evidence.transactionCount,
    entries: dry.evidence.entryCount,
    compressedSha256: row.compressed_sha256,
    recoveryArchiveSha256: durable.recoveryArchive.sha256,
    recoveryManifestSha256: durable.recoveryManifest.sha256,
    storageWrites: 0,
    databaseWrites: 2,
  };
}

async function authorizeProductionBatch({ sql, policy, batchId, confirmation, accountIdsSha256: expectedAccountIdsSha256 = null, deps = {} }) {
  if (typeof deps.authorize === "function") return deps.authorize({ sql, policy, batchId, confirmation, accountIdsSha256: expectedAccountIdsSha256 });
  return sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level serializable;");
    await tx.unsafe("set local lock_timeout = '5s';");
    await tx.unsafe("set local statement_timeout = '120s';");
    const functions = {
      "existing-30d": "chips_authorize_production_existing_30d_canary",
      "bot-only-7d": "chips_authorize_bot_only_archive_batch",
      "closed-human-30d": "chips_authorize_closed_human_table_retention_canary",
    };
    if (policy === "escrow") {
      if (!SHA256_RE.test(text(expectedAccountIdsSha256))) fail("Production escrow canary requires the exact account ID SHA-256");
      const rows = await tx.unsafe(`select public.chips_authorize_production_escrow_account_retirement_canary(
        $1::bigint, $2::text, $3::text
      ) as result;`, [batchId, expectedAccountIdsSha256, confirmation]);
      return rows[0]?.result;
    }
    const routine = functions[policy];
    if (!routine) fail("Production policy authorization routine is unavailable");
    const rows = await tx.unsafe(`select public.${routine}($1::bigint, $2::text) as result;`, [batchId, confirmation]);
    return rows[0]?.result;
  });
}

function archiveRecoveryDir(tempRoot) {
  const recoveryDir = path.join(tempRoot, "recovery");
  ensurePrivateDirectory(recoveryDir);
  return recoveryDir;
}

function productionEscrowAccountFromRow(row) {
  return {
    id: row.account_id,
    user_id: row.account_user_id,
    system_key: row.account_system_key,
    account_type: row.account_account_type,
    status: row.account_status,
    label: row.account_label,
    balance: row.account_balance,
    next_entry_seq: row.account_next_entry_seq,
    created_at: row.account_created_at,
    updated_at: row.account_updated_at,
  };
}

async function runProductionEscrowDatabaseFunction({ sql, candidate, recovery, execute, confirmation, canary = false, automatic = false }) {
  return sql.begin(async (tx) => {
    await tx.unsafe(execute ? "set transaction isolation level serializable;" : "set transaction isolation level repeatable read, read only;");
    await tx.unsafe("set local lock_timeout = '5s';");
    await tx.unsafe("set local statement_timeout = '30s';");
    if (canary) await tx.unsafe("set local chips.production_canary = '1';");
    if (automatic) {
      await tx.unsafe("select public.chips_assert_production_retention_control($1::text, $2::bigint, true, true);", [PRODUCTION_POLICIES.escrow, candidate.accountIds.length]);
      await tx.unsafe("set local chips.production_automatic = '1';");
    }
    const rows = await tx.unsafe(`select public.chips_retire_production_escrow_accounts(
      $1::bigint, $2::uuid[], $3::text, $4::text, $5::text, $6::boolean, $7::text
    ) as result;`, [
      candidate.batchId,
      candidate.accountIds,
      recovery.objectPath,
      recovery.compressedSha256,
      recovery.snapshotSha256,
      execute,
      confirmation,
    ]);
    return rows[0]?.result;
  });
}

async function runProductionEscrowCycle({
  profile,
  env,
  mode,
  batchId = null,
  confirmation = null,
  accountIdsSha256: expectedAccountIdsSha256 = null,
  recoveryObjectPath: expectedRecoveryObjectPath = null,
  deps = {},
  cwd = process.cwd(),
  identity,
} = {}) {
  let sql = deps.sql || postgres(profile.dbUrl, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 30 });
  const ownsSql = !deps.sql;
  let lockSession = null;
  const tempRoot = deps.tempRoot || fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-production-escrow-"));
  ensurePrivateDirectory(tempRoot);
  const storageTarget = deps.storageTarget || resolveStorageTarget("prod", env, productionTargetOptions());
  const { storageDeps, verifyBucket } = productionStorageDeps(deps, storageTarget);
  try {
    if (mode === "automatic") {
      const controlEnabled = identity?.control?.enabled === true || identity?.control?.enabled === "t";
      const policyEnabled = identity?.policies?.some((row) => row.policy_id === PRODUCTION_POLICIES.escrow
        && (row.enabled === true || row.enabled === "t"));
      if (!controlEnabled || !policyEnabled) {
        return {
          state: "disabled",
          mode,
          policy: "escrow",
          policyId: PRODUCTION_POLICIES.escrow,
          reason: !controlEnabled ? "production_control_disabled" : "production_policy_disabled",
          processed: 0,
        };
      }
    }
    lockSession = await acquireRetentionAdvisoryLock(sql, profile);
    if (!lockSession) return { state: "no-op", mode, policy: "escrow", policyId: PRODUCTION_POLICIES.escrow, reason: "advisory_lock_busy", processed: 0 };
    const identityRows = await sql.unsafe("select system_identifier::text as system_identifier from pg_catalog.pg_control_system();");
    if (text(identityRows[0]?.system_identifier) !== profile.systemIdentifier) fail("database is not canonical Production");
    if (mode === "automatic") {
      const state = await readProductionState({ profile, deps, session: sql });
      const context = resolveProductionAutomaticContext(state, PRODUCTION_POLICIES.escrow);
      await assertProductionAutomaticContext(sql, context, PRODUCTION_POLICIES.escrow);
    }
    const candidates = await sql.unsafe(PRODUCTION_ESCROW_CANDIDATE_SQL, [
      profile.projectRef,
      PRODUCTION_BOT_ONLY_RETENTION_POLICY_ID,
      batchId || null,
    ]);
    if (batchId && candidates.length !== 1) fail(`exact Production escrow batch ${batchId} is not a current safe candidate`);
    if (candidates.length === 0) return { state: "no-op", mode, policy: "escrow", policyId: PRODUCTION_POLICIES.escrow, reason: "no_eligible_candidate", processed: 0 };
    const row = candidates[0];
    const account = productionEscrowAccountFromRow(row);
    const candidate = {
      batchId: String(row.batch_id),
      accountIds: [String(row.account_id).toLowerCase()],
      tableIds: [String(row.bot_only_table_id).toLowerCase()],
    };
    const actualAccountIdsSha256 = accountIdsSha256(candidate.accountIds);
    if (expectedAccountIdsSha256 != null && text(expectedAccountIdsSha256) !== actualAccountIdsSha256) {
      fail("Production escrow account ID evidence differs from the current candidate");
    }
    await verifyBucket(storageTarget);
    const snapshot = buildAccountRecoverySnapshot({
      profile,
      batch: row,
      accounts: [account],
      tableIds: candidate.tableIds,
    });
    const recovery = serializeAccountRecovery(snapshot);
    if (expectedRecoveryObjectPath != null && text(expectedRecoveryObjectPath) !== recovery.objectPath) {
      fail("Production escrow recovery object evidence differs from the current candidate");
    }
    const storedRecovery = await ensureAccountRecoveryObject({
      profile,
      storageTarget,
      recovery,
      deps: storageDeps,
      expectedSnapshot: snapshot,
      expectedAccountIds: candidate.accountIds,
      allowCreate: true,
    });
    const dry = await runProductionEscrowDatabaseFunction({
      sql,
      candidate,
      recovery: storedRecovery,
      execute: false,
      confirmation: null,
    });
    if (dry?.state !== "eligible") fail(`Production escrow dry-run did not become eligible: ${dry?.state || "unknown"}`);
    const prepared = {
      maxTransactions: 2,
      state: "prepared",
      mode,
      policy: "escrow",
      policyId: PRODUCTION_POLICIES.escrow,
      projectRef: profile.projectRef,
      systemIdentifier: identity?.systemIdentifier || profile.systemIdentifier,
      batchId: candidate.batchId,
      accountCount: candidate.accountIds.length,
      accountIdsSha256: actualAccountIdsSha256,
      recoveryObjectPath: storedRecovery.objectPath,
      recoveryObjectSha256: storedRecovery.compressedSha256,
      snapshotSha256: storedRecovery.snapshotSha256,
      storageWrites: storedRecovery.storageWrites,
      databaseWrites: 1,
    };
    if (mode === "prepare") return prepared;
    if (mode === "canary") {
      await authorizeProductionBatch({
        sql,
        policy: "escrow",
        batchId: candidate.batchId,
        confirmation,
        accountIdsSha256: actualAccountIdsSha256,
        deps,
      });
    }
    const executed = await runWithEscrowRetry({
      onAttempt: async () => {
        await assertRetentionAdvisoryLock(sql, lockSession);
      },
      revalidate: async () => {
        await assertRetentionAdvisoryLock(sql, lockSession);
      },
      execute: async () => runProductionEscrowDatabaseFunction({
        sql,
        candidate,
        recovery: storedRecovery,
        execute: true,
        confirmation: mode === "canary" ? confirmation : `GO ${candidate.batchId}`,
        canary: mode === "canary",
        automatic: mode === "automatic",
      }),
      sleep: deps.sleep,
    });
    return {
      ...prepared,
      state: executed.result?.state || "unknown",
      receipt: executed.result?.state || "unknown",
      executeAttempts: executed.attempts,
      executeRetryCount: executed.retryCount,
      executeSqlstates: executed.sqlstates,
      databaseWrites: 2,
    };
  } finally {
    if (lockSession) await releaseRetentionAdvisoryLock(sql, lockSession);
    if (ownsSql) await sql.end({ timeout: 5 });
    if (!deps.tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function runProductionArchiveCycle({
  profile,
  env,
  policy,
  mode,
  batchId = null,
  confirmation = null,
  tableId = null,
  cutoff = null,
  completionConfirmation = null,
  accountIdsSha256 = null,
  recoveryObjectPath = null,
  deps = {},
  now = new Date(),
  cwd = process.cwd(),
  identity,
} = {}) {
  if (policy === "escrow") {
    if (typeof deps.escrow === "function") return deps.escrow({ profile, env, mode, batchId, confirmation, accountIdsSha256, recoveryObjectPath, identity });
    return runProductionEscrowCycle({
      profile,
      env,
      mode,
      batchId,
      confirmation,
      accountIdsSha256,
      recoveryObjectPath,
      deps,
      cwd,
      identity,
    });
  }
  let sql = deps.sql || postgres(profile.dbUrl, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 30 });
  const ownsSql = !deps.sql;
  let lockSession = null;
  const tempRoot = deps.tempRoot || fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-production-automation-"));
  ensurePrivateDirectory(tempRoot);
  const moduleEnv = env;
  let storageTarget = deps.storageTarget || resolveStorageTarget("prod", moduleEnv, productionTargetOptions());
  const { storageDeps, verifyBucket } = productionStorageDeps(deps, storageTarget);
  let pruneStore = deps.pruneStore || createPruneStore(sql, storageTarget.target);
  let automaticContext = null;
  const sourcePolicyId = PRODUCTION_POLICIES[policy];
  try {
    if (mode === "automatic") {
      const controlEnabled = identity?.control?.enabled === true || identity?.control?.enabled === "t";
      const policyEnabled = policy === "existing-30d"
        ? controlEnabled
        : identity?.policies?.some((row) => row.policy_id === sourcePolicyId
          && (row.enabled === true || row.enabled === "t"));
      if (!controlEnabled || !policyEnabled) {
        return {
          state: "disabled",
          mode,
          policy,
          policyId: sourcePolicyId,
          reason: !controlEnabled ? "production_control_disabled" : "production_policy_disabled",
          processed: 0,
        };
      }
    }
    lockSession = await acquireRetentionAdvisoryLock(sql, profile);
    if (!lockSession) {
      if (mode === "lifecycle-completion") fail("Production lifecycle completion advisory lock is busy");
      return { state: "no-op", mode, policy, policyId: sourcePolicyId, reason: "advisory_lock_busy", processed: 0 };
    }
    const identityRows = await sql.unsafe("select system_identifier::text as system_identifier from pg_catalog.pg_control_system();");
    if (text(identityRows[0]?.system_identifier) !== profile.systemIdentifier) fail("database is not canonical Production");
    if (mode === "automatic") {
      identity = await readProductionState({ profile, deps, session: sql });
      automaticContext = resolveProductionAutomaticContext(identity, sourcePolicyId);
      storageTarget = { ...storageTarget, automaticContext };
      storageDeps.automaticContext = automaticContext;
      pruneStore = deps.pruneStore || createPruneStore(sql, storageTarget.target, automaticContext);
    }
    const ownRows = await sql.unsafe(PRODUCTION_OWN_BATCHES_SQL, [profile.projectRef, sourcePolicyId]);
    const finalize = (row, extra = {}) => finalizeProductionHumanLifecycle({ sql, lockSession, pruneStore,
      storageTarget, verifyBucket, storageDeps, env: moduleEnv, profile, row, batchId: row.batch_id, tempRoot, deps, automaticContext, ...extra });
    if (mode === "lifecycle-completion") {
      if (identity?.control?.enabled !== false || Number(identity.control.max_transactions) !== 2
        || identity.fenceActive !== true || identity.policies?.length !== 3 || identity.policies.some(p => p.enabled !== false)) {
        fail("manual lifecycle completion requires fence ON, policies/control OFF and cap 2");
      }
      if (ownRows.some(r => r.pruned_at == null)) fail("lifecycle policy has an incomplete batch; refusing ambiguous completion");
      const exact = ownRows.filter(r => text(r.batch_id) === text(batchId));
      if (exact.length !== 1 || !exact[0].pruned_at) fail("exact pruned lifecycle batch is missing or ambiguous");
      return { ...(await finalize(exact[0], { tableId, cutoff, manualOnly: true })), mode, policy, policyId: sourcePolicyId };
    }
    if (policy === "closed-human-30d" && mode === "canary" && ownRows.some(r => text(r.batch_id) === text(batchId) && r.pruned_at)) {
      const exact = ownRows.filter(r => text(r.batch_id) === text(batchId));
      if (exact.length !== 1) fail("exact completed canary is ambiguous");
      return { ...(await finalize(exact[0], { allowComplete: false })), state: "already_pruned", mode, policy, policyId: sourcePolicyId };
    }
    const cycle = findOwnCycle(ownRows, sourcePolicyId);
    if (cycle.active) {
      if (mode !== "canary" && mode !== "prepare" && mode !== "automatic") {
        fail("Production retention has an incomplete active batch; resume it through the reviewed recovery path");
      }
      const resume = mode === "prepare" ? resumeProductionPrepareBatch : resumeProductionCanaryBatch;
      const resumed = await resume({
        activeRow: cycle.active,
        profile,
        env: moduleEnv,
        policy,
        mode,
        batchId: mode === "automatic" ? cycle.active.batch_id : batchId,
        confirmation,
        automaticContext,
        sql,
        lockSession,
        pruneStore,
        storageTarget,
        verifyBucket,
        storageDeps,
        tempRoot,
        deps,
      });
      if (policy === "closed-human-30d" && (mode === "canary" || mode === "automatic")) {
        const lifecycle = await finalize(cycle.active);
        return { ...resumed, mode, policy, policyId: sourcePolicyId, lifecycle, storageWrites: (resumed.storageWrites || 0) + lifecycle.storageWrites, databaseWrites: resumed.databaseWrites + lifecycle.databaseWrites };
      }
      return { state: resumed.state, mode, policy, policyId: sourcePolicyId, ...resumed };
    }
    if (mode === "prepare" && batchId != null) fail("exact active Production batch ID is not available for PREPARE");
    let completedLifecycle = null;
    if (cycle.latestCompleted && policy === "closed-human-30d") {
      completedLifecycle = await finalize(cycle.latestCompleted, { allowComplete: mode === "automatic" });
      if (completedLifecycle.state === "completed") return { ...completedLifecycle, mode, policy, policyId: sourcePolicyId, resumed: true };
    }
    if (cycle.latestCompleted && policy !== "closed-human-30d") {
      const completed = await (deps.pruneArchive || pruneArchive)({
        argv: ["--target", "prod", "--object-path", cycle.latestCompleted.object_path, "--confirm-sha", cycle.latestCompleted.compressed_sha256],
        env: moduleEnv,
        cwd: tempRoot,
        deps: { ...storageDeps, sql, pruneStore, storageTarget, targetOptions: productionTargetOptions(), verifyBucket, emit: false },
      });
      const expectedTerminal = policy === "bot-only-7d" ? "already_cleaned" : "already_pruned";
      if (completed.state !== expectedTerminal) {
        fail(`completed Production cycle did not revalidate as terminal: ${completed.state}`);
      }
      const terminalRow = await pruneStore.getManifest(cycle.latestCompleted.object_path);
      const durable = await (deps.inspectDurableRecovery || inspectDurableRecovery)(storageTarget, terminalRow, profile, completed.evidence, storageDeps);
      assertResumeRecoveryState(terminalRow, durable, profile);
    }
    await verifyBucket(storageTarget);
    const outputPath = path.join(tempRoot, "archive.jsonl.gz");
    const manifestPath = path.join(tempRoot, "archive.manifest.json");
    const invocation = buildProductionExportInvocation(policy, { outputPath, manifestPath, automaticContext });
    const exported = await invocation.run({
      env: moduleEnv,
      cwd: tempRoot,
      now,
      deps: {
        sql,
        noCandidateIfEmpty: true,
        emit: false,
      },
    });
    if (exported.noCandidate) return { state: "no-op", mode, policy, policyId: sourcePolicyId, maxTransactions: effectiveProductionCap(automaticContext), reason: "no_eligible_candidate", processed: 0, ...(completedLifecycle ? { completedLifecycle, storageWrites: completedLifecycle.storageWrites, databaseWrites: completedLifecycle.databaseWrites } : {}) };
    await ensureArchiveBucket(storageTarget, storageDeps);
    const stored = await storeArchive({
      argv: ["--target", "prod", "--artifact", outputPath, "--manifest", manifestPath],
      env: moduleEnv,
      cwd: tempRoot,
      deps: { ...storageDeps, sql, storageTarget, targetOptions: productionTargetOptions(), emit: false },
    });
    let row = await pruneStore.getManifest(stored.objectPath);
    if (!row) fail("stored Production archive manifest is missing");
    await pruneArchive({
      argv: ["--target", "prod", "--object-path", row.object_path, "--confirm-sha", row.compressed_sha256, "--register-proof"],
      env: moduleEnv,
      cwd: tempRoot,
      deps: { ...storageDeps, sql, pruneStore, storageTarget, targetOptions: productionTargetOptions(), verifyBucket, emit: false },
    });
    row = await pruneStore.getManifest(row.object_path);
    const dry = await pruneArchive({
      argv: ["--target", "prod", "--object-path", row.object_path, "--confirm-sha", row.compressed_sha256],
      env: moduleEnv,
      cwd: tempRoot,
      deps: { ...storageDeps, sql, pruneStore, storageTarget, targetOptions: productionTargetOptions(), verifyBucket, emit: false },
    });
    if (dry.state !== "ready") fail(`Production ${policy} dry-run did not become ready: ${dry.state}`);
    const main = await downloadPrivateArchiveObject(storageTarget, row.object_path, storageDeps);
    const durable = await persistDurableRecovery(storageTarget, row, profile, dry.evidence, main.bytes, storageDeps);
    const prepared = {
      maxTransactions: effectiveProductionCap(automaticContext),
      state: "prepared",
      mode,
      policy,
      policyId: sourcePolicyId,
      projectRef: profile.projectRef,
      systemIdentifier: identity?.systemIdentifier || profile.systemIdentifier,
      batchId: String(row.batch_id),
      transactions: dry.evidence.transactionCount,
      entries: dry.evidence.entryCount,
      compressedSha256: row.compressed_sha256,
      recoveryArchiveSha256: durable.recoveryArchive.sha256,
      recoveryManifestSha256: durable.recoveryManifest.sha256,
      storageWrites: 2 + (completedLifecycle?.storageWrites || 0),
      databaseWrites: 2,
      ...(completedLifecycle ? { completedLifecycle } : {}),
    };
    if (mode === "prepare") return prepared;
    if (mode === "canary") {
      if (String(batchId) !== String(row.batch_id)) fail("exact Production canary batch does not match the selected fresh batch");
      await authorizeProductionBatch({ sql, policy, batchId, confirmation, deps });
    }
    const recoveryDir = archiveRecoveryDir(tempRoot);
    const executeArgs = ["--target", "prod", "--object-path", row.object_path, "--confirm-sha", row.compressed_sha256, "--execute", "--recovery-dir", recoveryDir];
    if (mode === "canary") executeArgs.push("--approved-batch-id", String(batchId));
    if (mode === "automatic") executeArgs.push("--automatic");
    const executed = await pruneArchive({
      argv: executeArgs,
      env: moduleEnv,
      cwd: tempRoot,
      deps: {
        ...storageDeps,
        sql,
        pruneStore,
        storageTarget,
        targetOptions: productionTargetOptions(),
        verifyBucket,
        downloadArchive: async () => ({ bytes: durable.archiveBytes, downloadMs: 0 }),
        emit: false,
      },
    });
    const lifecycle = policy === "closed-human-30d" ? await finalize(row) : null;
    return { ...prepared, state: executed.state, receipt: executed.state, storageWrites: prepared.storageWrites + (lifecycle?.storageWrites || 0), databaseWrites: 3 + (lifecycle?.databaseWrites || 0), ...(lifecycle ? { lifecycle } : {}) };
  } finally {
    if (lockSession) await releaseRetentionAdvisoryLock(sql, lockSession);
    if (ownsSql) await sql.end({ timeout: 5 });
    if (!deps.tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

export async function runProductionAutomation({
  env = process.env,
  deps = {},
  policy,
  mode,
  batchId = null,
  confirmation = null,
  tableId = null,
  cutoff = null,
  completionConfirmation = null,
  accountIdsSha256 = null,
  recoveryObjectPath = null,
  cwd = process.cwd(),
} = {}) {
  const selectedPolicy = policyKey(policy);
  if (!PRODUCTION_MODES.includes(mode)) fail("Production mode must be diagnostic, prepare, canary, automatic, or lifecycle-completion");
  const profile = deps.profile || validateRetentionEnvironment("production", env, { requireCommitSha: true });
  if (selectedPolicy === "escrow") assertProductionEscrowProfile(profile);
  const sourcePolicyId = PRODUCTION_POLICIES[selectedPolicy];
  if (mode === "automatic" && !profile.automationEnabled) {
    return { state: "disabled", mode, policy: selectedPolicy, policyId: sourcePolicyId, processed: 0 };
  }
  requireCanaryAuthorization({
    mode,
    env,
    batchId,
    confirmation,
    accountIdsSha256,
    recoveryObjectPath,
    policy: selectedPolicy,
  });
  requireAutomaticAuthorization({ env, mode });

  requireLifecycleAuthorization({ env, mode, policy: selectedPolicy, batchId, tableId, cutoff, completionConfirmation, confirmation });

  const read = deps.read || (({ profile: activeProfile }) => readProductionState({ profile: activeProfile, deps }));
  const execute = deps.execute || (({ profile: activeProfile, identity: activeIdentity }) => runProductionArchiveCycle({
    profile: activeProfile,
    env,
    policy: selectedPolicy,
    mode,
    batchId,
    confirmation,
    tableId,
    cutoff,
    completionConfirmation,
    deps,
    cwd,
    accountIdsSha256,
    recoveryObjectPath,
    identity: activeIdentity,
  }));
  const prepare = deps.prepare || (({ profile: activeProfile, identity: activeIdentity }) => runProductionArchiveCycle({
    profile: activeProfile,
    env,
    policy: selectedPolicy,
    mode: "prepare",
    batchId,
    deps,
    cwd,
    accountIdsSha256,
    recoveryObjectPath,
    identity: activeIdentity,
  }));

  const cycle = await runRetentionCycle({
    target: "production",
    env,
    mode,
    policyId: sourcePolicyId,
    deps: { ...deps, profile, read, prepare, execute },
    automatic: mode === "automatic",
  });
  const result = {
    ...cycle,
    mode,
    policy: selectedPolicy,
    policyId: sourcePolicyId,
    projectRef: profile.projectRef,
    systemIdentifier: profile.systemIdentifier,
    maxTransactions: cycle.maxTransactions || 2,
    accountIdsSha256: accountIdsSha256 || null,
    recoveryObjectPath: recoveryObjectPath || null,
  };
  klog("chips_ledger_production_automation", result);
  return result;
}

export function buildProductionExportInvocation(policy, { outputPath, manifestPath, automaticContext = null }) {
  const selectedPolicy = policyKey(policy);
  if (!outputPath || !manifestPath) fail("Production export requires private output and manifest paths");
  const archivePolicyId = archivePolicyIdFor(selectedPolicy);
  return {
    policy: selectedPolicy,
    policyId: PRODUCTION_POLICIES[selectedPolicy],
    archivePolicyId,
    selector: selectorForPolicy(selectedPolicy),
    schemaVersion: selectedPolicy === "bot-only-7d" || selectedPolicy === "escrow" ? BOT_ONLY_EXPORT_SCHEMA_VERSION : 1,
    argv: productionExportArgs(selectedPolicy, outputPath, manifestPath, automaticContext),
    run: (deps = {}) => runExport({
      argv: productionExportArgs(selectedPolicy, outputPath, manifestPath, automaticContext),
      ...deps,
      deps: {
        ...(deps.deps || {}),
        targetOptions: { singleTarget: true, ...(deps.deps?.targetOptions || {}) },
        selector: selectorForPolicy(selectedPolicy),
        schemaVersion: selectedPolicy === "bot-only-7d" || selectedPolicy === "escrow" ? BOT_ONLY_EXPORT_SCHEMA_VERSION : 1,
        sourcePolicyId: archivePolicyId,
        automaticContext,
      },
    }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseProductionAutomationArgs();
  if (args.help) {
    process.stdout.write("Usage: node scripts/ops/chips-ledger-production-automation.mjs --policy <existing-30d|bot-only-7d|closed-human-30d|escrow> --mode <diagnostic|prepare|canary|automatic|lifecycle-completion>\n");
  } else {
    runProductionAutomation({ ...args }).catch((error) => {
      process.stderr.write(`chips-ledger-production-automation failed: ${error?.message || error}\n`);
      process.exitCode = 1;
    });
  }
}
