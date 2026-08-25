import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import {
  stringifyJson,
} from "./chips-ledger-archive-export.mjs";
import {
  buildObjectPath,
  resolveStorageTarget,
} from "./chips-ledger-archive-store.mjs";
import { LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13 } from "./chips-ledger-legacy-stage-allowlist-audit.mjs";
import { pruneArchive as runArchivePrune } from "./chips-ledger-archive-prune.mjs";
import {
  buildLegacyPlan,
  loadFrozenLegacyAllowlist,
  readOnlyStagePreflight,
} from "./chips-ledger-legacy-stage-allowlist.mjs";
import {
  assertLegacyStageAllowlistRegistryRows,
  legacyStageAllowlistRegistryPredicate,
} from "./chips-ledger-legacy-stage-allowlist-registry.mjs";
import { validateStageEnvironment } from "./chips-ledger-stage-automation.mjs";

const EXECUTE_GATE = "CHIPS_LEDGER_LEGACY_STAGE_ALLOWLIST_EXECUTE";
const SHA256_RE = /^[0-9a-f]{64}$/;
const POSITIVE_INTEGER_RE = /^[1-9][0-9]*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EXECUTE_BATCH_13 = LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13;
const REPLAY_TRANSACTION_ID = "00000000-0000-4000-8000-00000000d313";

const HELP = `Usage: ${EXECUTE_GATE}=1 node scripts/ops/chips-ledger-legacy-stage-allowlist-execute.mjs \
  --batch-id <exact batch_id> \
  --object-path <exact object_path> \
  --confirm-sha <exact compressed_sha256> \
  --recovery-dir <private directory>

This Stage-only runner loads the checked-in legacy_stage_allowlist_v1 plan and
executes exactly one previously authorized batch. The database GO function
remains the final authorization gate.
`;

function fail(message) {
  throw new Error(message);
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function number(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(`invalid numeric ${field}`);
  return parsed;
}

function normalizeTimestamp(value) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "" : timestamp.toISOString();
}

function canonicalHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseJsonb(value, field) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      fail(`${field} is not valid JSON`);
    }
  }
  return value;
}

function normalizeMetadataObject(value, field) {
  let parsed = parseJsonb(value, field);
  if (typeof parsed === "string") parsed = parseJsonb(parsed, field);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`${field} is not a JSON object`);
  }
  return parsed;
}

function assertReplayPair(pair, plan, evidence = null) {
  if (!pair || typeof pair !== "object") fail("legacy replay pair is missing");
  const idempotencyKey = text(pair.idempotencyKey);
  const tableId = text(pair.tableId).toLowerCase();
  const transactionId = text(pair.transactionId).toLowerCase();
  const batchTableIds = new Set((plan?.batchTableIds || []).map((id) => text(id).toLowerCase()));
  if (!idempotencyKey || !UUID_RE.test(tableId) || !batchTableIds.has(tableId)
    || !UUID_RE.test(transactionId) || transactionId === REPLAY_TRANSACTION_ID) {
    fail("legacy replay pair is not bound to the immutable batch");
  }
  if (evidence) {
    const boundPairs = Array.isArray(evidence.replayPairs) && evidence.replayPairs.length > 0
      ? evidence.replayPairs
      : evidence.replayPair ? [evidence.replayPair] : [];
    const bound = boundPairs.some((candidate) => text(candidate?.idempotencyKey) === idempotencyKey
      && text(candidate?.tableId).toLowerCase() === tableId
      && text(candidate?.transactionId).toLowerCase() === transactionId);
    const notPresentInEvidence = !evidence.registryKeys?.includes(idempotencyKey)
      || !evidence.legacyTableIds?.some((id) => text(id).toLowerCase() === tableId)
      || !evidence.transactionIds?.some((id) => text(id).toLowerCase() === transactionId);
    if (boundPairs.length > 0 ? !bound : notPresentInEvidence) {
      fail("legacy replay pair is not present in immutable archive evidence");
    }
  }
  return { idempotencyKey, tableId, transactionId };
}

function existingBatchAuthorization(preflight) {
  const destructiveGoAt = preflight?.destructiveGoAt ?? null;
  const destructiveGoBatchId = preflight?.destructiveGoBatchId == null
    ? null
    : text(preflight.destructiveGoBatchId);
  const noGo = destructiveGoAt === null && destructiveGoBatchId === null;
  const exactGo = destructiveGoAt !== null
    && destructiveGoBatchId === EXECUTE_BATCH_13.batchId;
  if (!noGo && !exactGo) fail("preflight GO is partial or not bound to batch 13");
  return exactGo ? { destructiveGoAt, destructiveGoBatchId } : null;
}

function assertEscrowAccountScope(accountIds) {
  if (!Array.isArray(accountIds) || accountIds.length !== 10
    || new Set(accountIds.map((id) => text(id).toLowerCase())).size !== 10
    || accountIds.some((id) => !UUID_RE.test(text(id).toLowerCase()))) {
    fail("preflight did not provide the exact ten-account ESCROW scope");
  }
  return accountIds.map((id) => text(id).toLowerCase());
}

function assertBatch13Plan(plan) {
  const expected = EXECUTE_BATCH_13;
  const fields = {
    allowlistSha256: expected.masterAllowlistSha256,
    batchTableIdsSha256: expected.batchTableIdsSha256,
    sourceRun: expected.diagnosticSourceRun,
    querySha256: expected.querySha256,
    stageSystemIdentifier: expected.systemIdentifier,
    masterManifestSha256: expected.masterManifestSha256,
    batchManifestSha256: expected.batchManifestSha256,
    masterTableCount: 974,
    batchNumber: 1,
    batchTableCount: 10,
  };
  for (const [field, expectedValue] of Object.entries(fields)) {
    if (text(plan[field]) !== text(expectedValue)) fail(`immutable plan ${field} mismatch`);
  }
  if (normalizeTimestamp(plan.cutoff) !== expected.cutoff) fail("immutable plan cutoff mismatch");
  if (plan.batchTableIds.length !== 10
    || plan.masterTableIds.length !== 974
    || plan.archiveManifest?.proof_basis !== "legacy_stage_allowlist_v1"
    || plan.archiveManifest?.allowlist_sha256 !== expected.masterAllowlistSha256
    || plan.archiveManifest?.batch_table_ids_sha256 !== expected.batchTableIdsSha256
    || plan.archiveManifest?.master_manifest_sha256 !== expected.masterManifestSha256
    || plan.archiveManifest?.batch_manifest_sha256 !== expected.batchManifestSha256
    || plan.archiveManifest?.master_table_count !== 974
    || plan.archiveManifest?.batch_number !== 1
    || plan.archiveManifest?.batch_table_count !== 10
    || plan.archiveManifest?.freeze_run_id !== expected.freezeRunId
    || plan.archiveManifest?.diagnostic_source_run_sha256 !== expected.diagnosticSourceRunSha256) {
    fail("immutable plan evidence mismatch");
  }
}

function assertBatch13Args(args) {
  const expected = EXECUTE_BATCH_13;
  if (args.batchId !== expected.batchId) fail("--batch-id is not the approved batch 13");
  if (args.objectPath !== expected.objectPath) fail("--object-path is not the approved batch 13 archive");
  if (args.confirmSha !== expected.compressedSha256) fail("--confirm-sha is not the approved batch 13 archive");
}

function assertBatch13Evidence(evidence) {
  const expected = EXECUTE_BATCH_13;
  if (!evidence || number(evidence.transactionCount, "transaction_count") !== expected.transactionCount
    || number(evidence.entryCount, "entry_count") !== expected.entryCount
    || number(evidence.transactionIds?.length, "transaction_ids_count") !== expected.transactionCount
    || number(evidence.entryIds?.length, "entry_ids_count") !== expected.entryCount
    || number(evidence.registryKeys?.length, "registry_count") !== expected.registryCount
    || number(evidence.legacyTableIds?.length, "batch_table_count") !== 10
    || evidence.transactionIdsSha256 !== expected.txIdsSha256
    || evidence.entryIdsSha256 !== expected.entryIdsSha256
    || evidence.registryKeysSha256 !== expected.registryKeysSha256
    || evidence.legacyAllowlistSha256 !== expected.masterAllowlistSha256
    || evidence.legacyBatchTableIdsSha256 !== expected.batchTableIdsSha256) {
    fail("archive evidence is not the immutable batch 13 evidence");
  }
}

function assertBatch13PrunedReceipt(receipt) {
  const expected = EXECUTE_BATCH_13;
  if (!receipt || !text(receipt.prunedAt) || !text(receipt.registryCleanedAt)
    || number(receipt.prunedTransactionCount, "pruned_transaction_count") !== expected.transactionCount
    || number(receipt.prunedEntryCount, "pruned_entry_count") !== expected.entryCount
    || number(receipt.registryCleanedKeyCount, "registry_cleaned_key_count") !== expected.registryCount
    || receipt.transactionIdsSha256 !== expected.txIdsSha256
    || receipt.entryIdsSha256 !== expected.entryIdsSha256
    || receipt.registryKeysSha256 !== expected.registryKeysSha256
    || (receipt.remainingRegistryCount != null && number(receipt.remainingRegistryCount, "remaining_registry_count") !== 0)) {
    fail("preflight pruned batch receipt is not the immutable batch 13 receipt");
  }
  return receipt;
}

function parseArgs(argv) {
  const valueArgs = new Map([
    ["--batch-id", "batchId"],
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
    const key = valueArgs.get(token);
    if (!key) fail(`unknown argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${token} requires a value`);
    if (args[key] !== undefined) fail(`${token} was supplied more than once`);
    args[key] = value;
    index += 1;
  }
  if (args.help) return args;
  for (const [key, option] of Object.entries({
    batchId: "--batch-id",
    objectPath: "--object-path",
    confirmSha: "--confirm-sha",
    recoveryDir: "--recovery-dir",
  })) {
    if (!args[key]) fail(`${option} is required`);
  }
  if (!POSITIVE_INTEGER_RE.test(args.batchId)) fail("--batch-id must be a positive canonical integer");
  if (!SHA256_RE.test(args.confirmSha)) fail("--confirm-sha must be a lowercase SHA-256");
  if (args.objectPath !== buildObjectPath(args.confirmSha)) fail("--object-path does not match --confirm-sha");
  return args;
}

function buildFrozenPlan(cwd, deps) {
  const generated = (deps.readFrozenAllowlist || loadFrozenLegacyAllowlist)({ cwd });
  const plan = buildLegacyPlan(generated.masterManifest, generated.batchManifest);
  plan.masterManifest = generated.masterManifest;
  plan.batchManifest = generated.batchManifest;
  return plan;
}

async function readOnlyBatch13Preflight(sql, plan) {
  const base = await readOnlyStagePreflight(sql);
  const expected = EXECUTE_BATCH_13;
  const details = await sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level repeatable read, read only;");
    const batches = await tx.unsafe(`
      select
        object_path, batch_id::text as batch_id, project_ref,
        format_version::text as format_version, source_policy_id,
        cutoff::text as cutoff, transaction_count::text as transaction_count,
        entry_count::text as entry_count, compressed_sha256,
        legacy_allowlist_sha256, legacy_batch_table_ids_sha256,
        archived_transaction_ids_sha256, archived_entry_ids_sha256,
        archive_proof_verified_at::text as archive_proof_verified_at,
        status, committed_at::text as committed_at,
        destructive_go_at::text as destructive_go_at,
        destructive_go_batch_id::text as destructive_go_batch_id,
        pruned_at::text as pruned_at, registry_cleaned_at::text as registry_cleaned_at,
        pruned_transaction_count::text as pruned_transaction_count,
        pruned_entry_count::text as pruned_entry_count,
        pruned_transaction_ids_sha256, pruned_entry_ids_sha256,
        registry_cleaned_key_count::text as registry_cleaned_key_count,
        registry_cleaned_keys_sha256
      from public.chips_ledger_archive_batches
      where batch_id = 13
        and object_path = 'v1/sha256/a7ff21fef10b1d22b963793d3cf6efd667319a7211ee47c7e6f755f293155e60.jsonl.gz';
    `);
    if (batches.length !== 1) fail("batch 13 is missing or duplicated");
    const batch = batches[0];
    const expectedBatchFields = {
      batch_id: expected.batchId,
      object_path: expected.objectPath,
      project_ref: expected.projectRef,
      format_version: "2",
      source_policy_id: "legacy_stage_allowlist_v1",
      cutoff: expected.cutoff,
      transaction_count: String(expected.transactionCount),
      entry_count: String(expected.entryCount),
      compressed_sha256: expected.compressedSha256,
      legacy_allowlist_sha256: expected.masterAllowlistSha256,
      legacy_batch_table_ids_sha256: expected.batchTableIdsSha256,
      archived_transaction_ids_sha256: expected.txIdsSha256,
      archived_entry_ids_sha256: expected.entryIdsSha256,
      status: "committed",
    };
    for (const [field, expectedValue] of Object.entries(expectedBatchFields)) {
      const actual = field === "cutoff" ? normalizeTimestamp(batch[field]) : text(batch[field]);
      if (actual !== expectedValue) fail(`preflight batch ${field} mismatch`);
    }
    if (!batch.committed_at || !batch.archive_proof_verified_at) {
      fail("preflight batch is not committed and proof-verified");
    }
    const unpruned = batch.pruned_at === null && batch.registry_cleaned_at === null;
    const pruned = batch.pruned_at !== null && batch.registry_cleaned_at !== null;
    if (!unpruned && !pruned) fail("preflight batch has a partial prune receipt");
    const noGo = batch.destructive_go_at === null && batch.destructive_go_batch_id === null;
    const exactGo = batch.destructive_go_at !== null
      && text(batch.destructive_go_batch_id) === expected.batchId;
    if (!noGo && !exactGo) fail("preflight GO is partial or not bound to batch 13");
    if (pruned && !exactGo) fail("preflight pruned batch is missing the exact batch 13 GO");
    if (pruned) {
      for (const [field, expectedValue] of Object.entries({
        pruned_transaction_count: String(expected.transactionCount),
        pruned_entry_count: String(expected.entryCount),
        pruned_transaction_ids_sha256: expected.txIdsSha256,
        pruned_entry_ids_sha256: expected.entryIdsSha256,
        registry_cleaned_key_count: String(expected.registryCount),
        registry_cleaned_keys_sha256: expected.registryKeysSha256,
      })) {
        if (text(batch[field]) !== expectedValue) fail(`preflight receipt ${field} mismatch`);
      }
    }

    const proofs = await tx.unsafe(`
      select
        batch_id::text as batch_id, object_path, project_ref, source_policy_id,
        cutoff::text as cutoff, source_run, query_sha256,
        postgres_system_identifier, master_table_count::text as master_table_count,
        master_table_ids_sha256, batch_number::text as batch_number,
        batch_table_count::text as batch_table_count, batch_table_ids_sha256,
        batch_table_ids
      from public.chips_legacy_stage_allowlist_proofs
      where batch_id = 13
        and object_path = 'v1/sha256/a7ff21fef10b1d22b963793d3cf6efd667319a7211ee47c7e6f755f293155e60.jsonl.gz';
    `);
    if (proofs.length !== 1) fail("batch 13 immutable proof is missing or duplicated");
    const proof = proofs[0];
    const expectedProofFields = {
      batch_id: expected.batchId,
      object_path: expected.objectPath,
      project_ref: expected.projectRef,
      source_policy_id: "legacy_stage_allowlist_v1",
      cutoff: expected.cutoff,
      source_run: expected.diagnosticSourceRun,
      query_sha256: expected.querySha256,
      postgres_system_identifier: expected.systemIdentifier,
      master_table_count: "974",
      master_table_ids_sha256: expected.masterAllowlistSha256,
      batch_number: "1",
      batch_table_count: "10",
      batch_table_ids_sha256: expected.batchTableIdsSha256,
    };
    for (const [field, expectedValue] of Object.entries(expectedProofFields)) {
      const actual = field === "cutoff" ? normalizeTimestamp(proof[field]) : text(proof[field]);
      if (actual !== expectedValue) fail(`preflight proof ${field} mismatch`);
    }
    if (JSON.stringify(proof.batch_table_ids || []) !== JSON.stringify(plan.batchTableIds)) {
      fail("preflight proof batch table IDs mismatch");
    }

    const escrowAccounts = await tx.unsafe(`
      select id::text as account_id, account_type::text as account_type,
             system_key, status::text as status, balance::text as balance
      from public.chips_accounts
      where account_type::text = 'ESCROW'
        and system_key = any($1::text[])
      order by system_key;
    `, [plan.batchTableIds.map((tableId) => `POKER_TABLE:${tableId}`)]);
    if (escrowAccounts.length !== plan.batchTableIds.length
      || escrowAccounts.some((row) => text(row.account_type).toUpperCase() !== "ESCROW"
        || text(row.status).toLowerCase() !== "active"
        || text(row.balance) !== "0"
        || !plan.batchTableIds.includes(text(row.system_key).slice("POKER_TABLE:".length)))) {
      fail("preflight ESCROW account scope is incomplete or changed");
    }
    const escrowAccountIds = escrowAccounts.map((row) => text(row.account_id).toLowerCase());
    if (new Set(escrowAccountIds).size !== plan.batchTableIds.length
      || escrowAccountIds.some((id) => !UUID_RE.test(id))) {
      fail("preflight ESCROW account identity is incomplete");
    }

    const registry = pruned ? [] : await tx.unsafe(`
      select
        registry.idempotency_key,
        registry.table_id::text as table_id,
        registry.transaction_id::text as transaction_id,
        registry.tx_type::text as tx_type,
        transactions.tx_type::text as transaction_tx_type,
        transactions.user_id::text as user_id,
        transactions.metadata,
        transactions.reference,
        registry.archive_batch_id::text as archive_batch_id
      from public.chips_transaction_idempotency registry
      join public.chips_transactions transactions on transactions.id = registry.transaction_id
      where ${legacyStageAllowlistRegistryPredicate("$1")}
      order by registry.idempotency_key;
    `, [plan.batchTableIds]);
    if (!pruned) {
      assertLegacyStageAllowlistRegistryRows(registry, {
        tableIds: plan.batchTableIds,
        expectedCount: expected.registryCount,
        expectedKeysSha256: expected.registryKeysSha256,
        fail: (code) => fail(`preflight ${code}`),
      });
    }
    const batchTableIds = new Set(plan.batchTableIds.map((id) => text(id).toLowerCase()));
    for (const row of registry) {
      const tableId = text(row.table_id).toLowerCase();
      if (!UUID_RE.test(tableId) || !batchTableIds.has(tableId)
        || !UUID_RE.test(text(row.transaction_id).toLowerCase())
        || text(row.transaction_tx_type) !== text(row.tx_type)
        || row.user_id !== null) {
        fail("preflight replay pair identity is incomplete");
      }
      const metadata = normalizeMetadataObject(row.metadata, "preflight transaction metadata");
      if (metadata.tableId !== undefined
        && text(metadata.tableId).toLowerCase() !== tableId) {
        fail("preflight replay pair metadata tableId mismatch");
      }
      const reference = text(row.reference);
      if (/^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):/i.test(reference)) {
        const referenceTableId = text(reference.split(":")[1]).toLowerCase();
        if (!UUID_RE.test(referenceTableId) || referenceTableId !== tableId) {
          fail("preflight replay pair reference tableId mismatch");
        }
      }
    }
    const replayPair = pruned ? null : assertReplayPair({
      idempotencyKey: registry[0]?.idempotency_key,
      tableId: registry[0]?.table_id,
      transactionId: registry[0]?.transaction_id,
    }, plan);
    const replayCollision = await tx.unsafe(`
      select count(*)::text as collision_count
      from public.chips_transactions
      where id = $1::uuid;
    `, [REPLAY_TRANSACTION_ID]);
    if (text(replayCollision[0]?.collision_count) !== "0") {
      fail("replay transaction ID collision");
    }
    const counts = await tx.unsafe(`
      with registry as (
        select transaction_id
        from public.chips_transaction_idempotency registry
        where ${pruned
          ? "archive_batch_id = 13"
          : legacyStageAllowlistRegistryPredicate("$1")}
      )
      select
        (select count(*) from registry)::text as registry_count,
        (select count(*) from public.chips_transactions transactions
          where exists (select 1 from registry where registry.transaction_id = transactions.id))::text as transaction_count,
        (select count(*) from public.chips_entries entries
          where exists (select 1 from registry where registry.transaction_id = entries.transaction_id))::text as entry_count;
    `, pruned ? [] : [plan.batchTableIds]);
    const countsRow = counts[0];
    const expectedCounts = pruned
      ? { registry: "0", transactions: "0", entries: "0" }
      : {
        registry: String(expected.registryCount),
        transactions: String(expected.transactionCount),
        entries: String(expected.entryCount),
      };
    if (text(countsRow?.registry_count) !== expectedCounts.registry
      || text(countsRow?.transaction_count) !== expectedCounts.transactions
      || text(countsRow?.entry_count) !== expectedCounts.entries) {
      fail("preflight hot row counts mismatch");
    }
    return {
      batch: {
        status: batch.status,
        committedAt: batch.committed_at,
        destructiveGoAt: batch.destructive_go_at,
        destructiveGoBatchId: batch.destructive_go_batch_id,
        state: pruned ? "pruned" : "unpruned",
        receipt: pruned ? {
          prunedAt: batch.pruned_at,
          registryCleanedAt: batch.registry_cleaned_at,
          prunedTransactionCount: number(batch.pruned_transaction_count, "preflight receipt transaction_count"),
          prunedEntryCount: number(batch.pruned_entry_count, "preflight receipt entry_count"),
          registryCleanedKeyCount: number(batch.registry_cleaned_key_count, "preflight receipt registry_count"),
          remainingRegistryCount: 0,
          transactionIdsSha256: batch.pruned_transaction_ids_sha256,
          entryIdsSha256: batch.pruned_entry_ids_sha256,
          registryKeysSha256: batch.registry_cleaned_keys_sha256,
        } : null,
      },
      proof: { sourceRun: proof.source_run, querySha256: proof.query_sha256 },
      replayPair,
      replayTransactionIdCollision: false,
      escrowAccountIds,
      counts: {
        transactions: number(countsRow.transaction_count, "preflight transaction_count"),
        entries: number(countsRow.entry_count, "preflight entry_count"),
        registry: number(countsRow.registry_count, "preflight registry_count"),
      },
    };
  });
  return {
    ...base,
    batchId: expected.batchId,
    destructiveGoAt: details.batch.destructiveGoAt,
    destructiveGoBatchId: details.batch.destructiveGoBatchId == null
      ? null
      : text(details.batch.destructiveGoBatchId),
    batchState: details.batch.state,
    prunedReceipt: details.batch.receipt,
    escrowAccountIds: details.escrowAccountIds,
    replayPair: details.replayPair,
    replayTransactionIdCollision: details.replayTransactionIdCollision,
    readOnlyEvidence: details,
  };
}

async function authorizeBatch13(sql) {
  const expected = EXECUTE_BATCH_13;
  return sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level repeatable read;");
    const authorizationRows = await tx.unsafe(
      "select public.chips_authorize_legacy_stage_allowlist_batch(13, 'GO 13', '611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05') as result;",
    );
    const result = parseJsonb(authorizationRows[0]?.result, "authorization result");
    if (result?.state !== "authorized" || text(result.batch_id) !== expected.batchId) {
      fail("exact batch 13 authorization was not accepted");
    }
    const rows = await tx.unsafe(`
      select destructive_go_at::text as destructive_go_at,
             destructive_go_batch_id::text as destructive_go_batch_id
      from public.chips_ledger_archive_batches
      where batch_id = 13
        and object_path = 'v1/sha256/a7ff21fef10b1d22b963793d3cf6efd667319a7211ee47c7e6f755f293155e60.jsonl.gz';
    `);
    if (rows.length !== 1 || !rows[0].destructive_go_at
      || text(rows[0].destructive_go_batch_id) !== expected.batchId) {
      fail("authorized batch 13 GO receipt is missing");
    }
    return {
      result,
      destructiveGoAt: rows[0].destructive_go_at,
      destructiveGoBatchId: text(rows[0].destructive_go_batch_id),
    };
  });
}

export async function collectExecutionSnapshot(tx, plan, accountIds = null, batchState = "pruned") {
  if (!Array.isArray(accountIds)) fail("batch economic snapshot requires the immutable ESCROW account scope");
  if (batchState !== "unpruned" && batchState !== "pruned") {
    fail("batch economic snapshot requires an exact batch state");
  }
  if (batchState === "unpruned" && !Array.isArray(plan?.batchTableIds)) {
    fail("unpruned batch economic snapshot requires the immutable table scope");
  }
  const scopedAccountIds = accountIds.map((id) => text(id).toLowerCase());
  if (new Set(scopedAccountIds).size !== scopedAccountIds.length
    || scopedAccountIds.length !== 10
    || scopedAccountIds.some((id) => !UUID_RE.test(id))) {
    fail("batch economic snapshot scope is not the exact ten-account ESCROW set");
  }
  const accountRows = await tx.unsafe(`
    select id::text as id, account_type::text as account_type,
           system_key, status::text as status,
           balance::text as balance, next_entry_seq::text as next_entry_seq
    from public.chips_accounts
    where id = any($1::uuid[])
    order by id;
  `, [scopedAccountIds]);
  if (accountRows.length !== scopedAccountIds.length
    || accountRows.some((row) => text(row.account_type).toUpperCase() !== "ESCROW"
      || text(row.status).toLowerCase() !== "active"
      || !/^POKER_TABLE:[0-9a-f-]{36}$/i.test(text(row.system_key)))) {
    fail("batch economic snapshot contains a non-ESCROW account");
  }
  const registryScope = batchState === "pruned"
    ? "archive_batch_id = 13"
    : legacyStageAllowlistRegistryPredicate("$1");
  const registryParameters = batchState === "pruned"
    ? []
    : [plan.batchTableIds];
  const counts = await tx.unsafe(`
    with registry as (
      select transaction_id
      from public.chips_transaction_idempotency registry
      where ${registryScope}
    )
    select
      (select count(*) from registry)::text as registry_count,
      (select count(*) from public.chips_transactions transactions
        where exists (select 1 from registry where registry.transaction_id = transactions.id))::text as transaction_count,
      (select count(*) from public.chips_entries entries
        where exists (select 1 from registry where registry.transaction_id = entries.transaction_id))::text as entry_count;
  `, registryParameters);
  const conservationRows = await tx.unsafe(`
    with batch_transactions as (
      select transaction_id
      from public.chips_transaction_idempotency registry
      where ${registryScope}
    )
    select
      count(entries.id)::text as entry_count,
      coalesce(sum(entries.amount), 0)::text as entry_sum
    from public.chips_entries entries
    join batch_transactions on batch_transactions.transaction_id = entries.transaction_id;
  `, registryParameters);
  const scopedEconomics = await tx.unsafe(`
    select
      coalesce(sum(balance), 0)::text as balance_total,
      coalesce(sum(next_entry_seq), 0)::text as next_entry_seq_total
    from public.chips_accounts
    where id = any($1::uuid[]);
  `, [scopedAccountIds]);
  const countsRow = counts[0] || {};
  const conservation = conservationRows[0] || {};
  const economics = scopedEconomics[0] || {};
  const accounts = accountRows.map((row) => ({
    id: text(row.id),
    balance: text(row.balance),
    nextEntrySeq: text(row.next_entry_seq),
  }));
  return {
    accountIds: scopedAccountIds,
    accountScope: "ESCROW_TABLES",
    transactionCount: number(countsRow.transaction_count, "snapshot transaction_count"),
    entryCount: number(countsRow.entry_count, "snapshot entry_count"),
    registryCount: number(countsRow.registry_count, "snapshot registry_count"),
    balances: {
      accountCount: accounts.length,
      total: text(economics.balance_total),
      sha256: canonicalHash(accounts),
    },
    nextEntrySeq: {
      total: text(economics.next_entry_seq_total),
      sha256: canonicalHash(accounts),
    },
    conservation: {
      entryCount: number(conservation.entry_count, "snapshot conservation entry_count"),
      entrySum: text(conservation.entry_sum),
    },
  };
}

async function readExecutionSnapshot(sql, plan, accountIds = null, batchState = "pruned") {
  return sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level repeatable read, read only;");
    return collectExecutionSnapshot(tx, plan, accountIds, batchState);
  });
}

function assertEconomicSnapshotUnchanged(before, after, label) {
  if (before.accountScope !== "ESCROW_TABLES"
    || after.accountScope !== "ESCROW_TABLES"
    || canonicalHash(before.accountIds || []) !== canonicalHash(after.accountIds || [])
    || before.balances.accountCount !== after.balances.accountCount
    || before.balances.total !== after.balances.total
    || before.balances.sha256 !== after.balances.sha256
    || before.nextEntrySeq.total !== after.nextEntrySeq.total
    || before.nextEntrySeq.sha256 !== after.nextEntrySeq.sha256
    || before.conservation.entrySum !== after.conservation.entrySum) {
    fail(`${label} changed balances, next_entry_seq or conservation`);
  }
}

async function verifyBatch13PostExecute(sql, plan, before, evidence) {
  const expected = EXECUTE_BATCH_13;
  assertBatch13Evidence(evidence);
  return sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level repeatable read, read only;");
    const snapshot = await collectExecutionSnapshot(tx, plan, before.accountIds, "pruned");
    if (snapshot.transactionCount !== 0 || snapshot.entryCount !== 0 || snapshot.registryCount !== 0) {
      fail("post-execute hot rows or registry mappings remain");
    }
    const hotRows = await tx.unsafe(`
      select
        (select count(*) from public.chips_transactions
          where id = any($1::uuid[]))::text as hot_transaction_count,
        (select count(*) from public.chips_entries
          where transaction_id = any($1::uuid[]) or id = any($2::bigint[]))::text as hot_entry_count,
        (select count(*) from public.chips_transaction_idempotency
          where archive_batch_id = 13)::text as remaining_registry_count;
    `, [evidence.transactionIds, evidence.entryIds]);
    if (text(hotRows[0]?.hot_transaction_count) !== "0"
      || text(hotRows[0]?.hot_entry_count) !== "0"
      || text(hotRows[0]?.remaining_registry_count) !== "0") {
      fail("post-execute exact hot row verification failed");
    }
    assertEconomicSnapshotUnchanged(before, snapshot, "post-execute snapshot");
    const rows = await tx.unsafe(`
      select
        pruned_at::text as pruned_at,
        registry_cleaned_at::text as registry_cleaned_at,
        pruned_transaction_count::text as pruned_transaction_count,
        pruned_entry_count::text as pruned_entry_count,
        pruned_transaction_ids_sha256,
        pruned_entry_ids_sha256,
        registry_cleaned_key_count::text as registry_cleaned_key_count,
        registry_cleaned_keys_sha256,
        (select count(*) from public.chips_transaction_idempotency
          where archive_batch_id = 13)::text as remaining_registry_count
      from public.chips_ledger_archive_batches
      where batch_id = 13
        and object_path = 'v1/sha256/a7ff21fef10b1d22b963793d3cf6efd667319a7211ee47c7e6f755f293155e60.jsonl.gz';
    `);
    if (rows.length !== 1) fail("post-execute batch receipt is missing");
    const receipt = rows[0];
    for (const [field, expectedValue] of Object.entries({
      pruned_transaction_count: String(expected.transactionCount),
      pruned_entry_count: String(expected.entryCount),
      pruned_transaction_ids_sha256: expected.txIdsSha256,
      pruned_entry_ids_sha256: expected.entryIdsSha256,
      registry_cleaned_key_count: String(expected.registryCount),
      registry_cleaned_keys_sha256: expected.registryKeysSha256,
      remaining_registry_count: "0",
    })) {
      if (text(receipt[field]) !== expectedValue) fail(`post-execute receipt ${field} mismatch`);
    }
    if (!receipt.pruned_at || !receipt.registry_cleaned_at) {
      fail("post-execute receipt timestamps are incomplete");
    }
    return {
      state: "verified",
      snapshot,
      receipt: {
        prunedAt: receipt.pruned_at,
        registryCleanedAt: receipt.registry_cleaned_at,
        prunedTransactionCount: number(receipt.pruned_transaction_count, "receipt transaction_count"),
        prunedEntryCount: number(receipt.pruned_entry_count, "receipt entry_count"),
        registryCleanedKeyCount: number(receipt.registry_cleaned_key_count, "receipt registry_count"),
        remainingRegistryCount: number(receipt.remaining_registry_count, "receipt remaining_registry_count"),
        transactionIdsSha256: receipt.pruned_transaction_ids_sha256,
        entryIdsSha256: receipt.pruned_entry_ids_sha256,
        registryKeysSha256: receipt.registry_cleaned_keys_sha256,
      },
    };
  });
}

export async function replayOldRegistryKey(sql, evidence, before, replayPair, plan) {
  const pair = assertReplayPair(replayPair, plan, evidence);
  return sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level repeatable read;");
    const collisionRows = await tx.unsafe(`
      select count(*)::text as collision_count
      from public.chips_transactions
      where id = $1::uuid;
    `, [REPLAY_TRANSACTION_ID]);
    if (text(collisionRows[0]?.collision_count) !== "0") {
      fail("replay transaction ID collision");
    }
    const beforeReplay = await collectExecutionSnapshot(tx, plan, before.accountIds, "pruned");
    let rejection = null;
    try {
      await tx.savepoint("legacy_stage_batch_13_replay", async (replayTx) => {
        await replayTx.unsafe(`
          insert into public.chips_transactions (
            id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id, created_at
          ) values ($1::uuid, $2, $3::jsonb, $4, $5, 'TABLE_BUY_IN', null, $6::timestamptz);
        `, [
          REPLAY_TRANSACTION_ID,
          `table:${pair.tableId}`,
          { tableId: pair.tableId },
          pair.idempotencyKey,
          "f".repeat(64),
          "2026-08-17T00:00:00.000003Z",
        ]);
        // Flush any deferred trigger in the same nested scope so an expected
        // P8903 cannot escape the local savepoint catch at transaction commit.
        await replayTx.unsafe("set constraints all immediate;");
      });
    } catch (error) {
      rejection = error;
    }
    if (!rejection) {
      fail("legacy registry key replay was accepted");
    }
    if (rejection.code !== "P8903") {
      fail(`legacy registry key replay returned unexpected SQLSTATE ${rejection.code || "unknown"}`);
    }
    const afterReplay = await collectExecutionSnapshot(tx, plan, beforeReplay.accountIds, "pruned");
    assertEconomicSnapshotUnchanged(beforeReplay, afterReplay, "legacy replay");
    if (afterReplay.transactionCount !== 0 || afterReplay.entryCount !== 0 || afterReplay.registryCount !== 0) {
      fail("legacy replay changed hot rows or registry mappings");
    }
    if (before && (beforeReplay.balances.sha256 !== before.balances.sha256
      || beforeReplay.nextEntrySeq.sha256 !== before.nextEntrySeq.sha256)) {
      fail("legacy replay precondition snapshot differs");
    }
    return { rejected: true, sqlstate: rejection.code || null };
  });
}

function summarizeExecution({
  result,
  args,
  plan,
  deployedCommitSha,
  preflight,
  authorization,
  beforeExecuteSnapshot,
  postExecute,
  retry,
  replay,
}) {
  return {
    state: result.state,
    mode: result.mode,
    reason: result.state === "already_pruned" ? "legacy_batch_already_pruned" : "legacy_batch_executed",
    deployedCommitSha,
    target: "stage",
    projectRef: result.target?.projectRef || null,
    postgresSystemIdentifier: result.identity || null,
    preflight,
    batchId: args.batchId,
    objectPath: args.objectPath,
    compressedSha256: args.confirmSha,
    allowlistSha256: plan.allowlistSha256,
    authorization,
    beforeExecuteSnapshot,
    postExecute,
    retry,
    replay,
    transactions: result.evidence?.transactionCount ?? null,
    entries: result.evidence?.entryCount ?? null,
    proof: result.evidence ? {
      transactionIdsSha256: result.evidence.transactionIdsSha256,
      entryIdsSha256: result.evidence.entryIdsSha256,
    } : null,
    recovery: result.recoveryBundle ? {
      artifactPath: result.recoveryBundle.artifactPath,
      manifestPath: result.recoveryBundle.manifestPath,
      reused: result.recoveryBundle.reused,
    } : null,
  };
}

export async function runLegacyStageAllowlistExecute({
  argv = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
  deps = {},
} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return null;
  }
  if (text(env[EXECUTE_GATE]) !== "1") fail(`${EXECUTE_GATE}=1 is required for legacy Stage allowlist execution`);

  const config = validateStageEnvironment(env, { requireCommitSha: true });
  const plan = buildFrozenPlan(cwd, deps);
  assertBatch13Plan(plan);
  assertBatch13Args(args);
  const storageTarget = deps.storageTarget
    || resolveStorageTarget("stage", config.moduleEnv, { singleTarget: true });
  let sql = deps.sql || null;
  let ownsSql = false;
  const needsSql = !deps.preflight
    || !deps.authorize
    || !deps.readExecutionSnapshot
    || !deps.verifyPostExecute
    || !deps.replayOldRegistryKey;
  if (!sql && needsSql) {
    sql = postgres(config.dbUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 30,
    });
    ownsSql = true;
  }
  try {
    const preflight = await (deps.preflight || readOnlyBatch13Preflight)(sql, plan);
    if (preflight?.fenceActive !== true || preflight?.enforcementActive !== true) {
      fail("legacy Stage execution requires the active TABLE fence");
    }
    const existingAuthorization = existingBatchAuthorization(preflight);
    const batchState = preflight?.batchState
      || preflight?.readOnlyEvidence?.batch?.state
      || "unpruned";
    if (batchState !== "unpruned" && batchState !== "pruned") {
      fail("preflight batch state is not fail-closed");
    }
    const escrowAccountIds = assertEscrowAccountScope(preflight?.escrowAccountIds);
    let replayPair = preflight?.replayPair
      ? assertReplayPair(preflight.replayPair, plan)
      : null;
    if (!replayPair && batchState !== "pruned") {
      fail("preflight replay pair is missing for an unpruned batch");
    }
    if (preflight?.replayTransactionIdCollision !== false) {
      fail("preflight replay transaction ID collision check is incomplete");
    }
    if (batchState === "pruned") assertBatch13PrunedReceipt(preflight?.prunedReceipt);
    if (batchState === "pruned" && !existingAuthorization) {
      fail("preflight pruned batch requires the exact existing batch 13 GO");
    }
    const authorization = existingAuthorization
      ? {
        resumed: true,
        result: { state: "authorized", batch_id: EXECUTE_BATCH_13.batchId, resumed: true },
        destructiveGoAt: existingAuthorization.destructiveGoAt,
        destructiveGoBatchId: existingAuthorization.destructiveGoBatchId,
      }
      : await (deps.authorize || authorizeBatch13)(sql, plan);
    if (authorization?.destructiveGoBatchId !== EXECUTE_BATCH_13.batchId
      || !authorization?.destructiveGoAt) {
      fail("legacy Stage batch 13 authorization receipt is incomplete");
    }
    const readSnapshot = deps.readExecutionSnapshot || readExecutionSnapshot;
    const beforeExecuteSnapshot = await readSnapshot(sql, plan, escrowAccountIds, batchState);
    if (batchState === "unpruned" && (beforeExecuteSnapshot.transactionCount !== EXECUTE_BATCH_13.transactionCount
      || beforeExecuteSnapshot.entryCount !== EXECUTE_BATCH_13.entryCount
      || beforeExecuteSnapshot.registryCount !== EXECUTE_BATCH_13.registryCount)) {
      fail("batch 13 pre-execute snapshot counts are not exact");
    }
    if (batchState === "pruned" && (beforeExecuteSnapshot.transactionCount !== 0
      || beforeExecuteSnapshot.entryCount !== 0
      || beforeExecuteSnapshot.registryCount !== 0)) {
      fail("preflight pruned batch still has hot rows");
    }
    const prune = deps.pruneArchive || runArchivePrune;
    const pruneArgs = {
      argv: [
        "--target", "stage",
        "--object-path", args.objectPath,
        "--confirm-sha", args.confirmSha,
        "--execute",
        "--approved-batch-id", args.batchId,
        "--recovery-dir", args.recoveryDir,
      ],
      env: config.moduleEnv,
      cwd,
      deps: {
        ...deps,
        ...(sql ? { sql } : {}),
        storageTarget,
        targetOptions: { singleTarget: true },
        legacyStageAllowlistPlan: plan,
        beforeCleanup: async ({ evidence }) => {
          const candidate = replayPair || evidence?.replayPair;
          replayPair = assertReplayPair(candidate, plan, evidence);
        },
        emit: false,
      },
    };
    const result = await prune(pruneArgs);
    if (batchState === "unpruned" && result?.state !== "pruned") {
      fail(`batch 13 execute returned ${result?.state || "unknown"}, expected pruned`);
    }
    if (batchState === "pruned" && result?.state !== "already_pruned") {
      fail(`batch 13 resume returned ${result?.state || "unknown"}, expected already_pruned`);
    }
    assertBatch13Evidence(result.evidence);
    replayPair = assertReplayPair(replayPair || result.evidence.replayPair, plan, result.evidence);
    const postExecute = await (deps.verifyPostExecute || verifyBatch13PostExecute)(
      sql,
      plan,
      beforeExecuteSnapshot,
      result.evidence,
    );
    const retryResult = await prune(pruneArgs);
    if (retryResult?.state !== "already_pruned") {
      fail(`batch 13 retry returned ${retryResult?.state || "unknown"}, expected already_pruned`);
    }
    assertBatch13Evidence(retryResult.evidence || result.evidence);
    replayPair = assertReplayPair(replayPair, plan, retryResult.evidence || result.evidence);
    const retrySnapshot = await readSnapshot(sql, plan, beforeExecuteSnapshot.accountIds, "pruned");
    if (retrySnapshot.transactionCount !== 0
      || retrySnapshot.entryCount !== 0
      || retrySnapshot.registryCount !== 0) {
      fail("batch 13 retry changed the cleaned state");
    }
    assertEconomicSnapshotUnchanged(postExecute.snapshot, retrySnapshot, "batch 13 retry");
    const replay = await (deps.replayOldRegistryKey || replayOldRegistryKey)(
      sql,
      result.evidence,
      beforeExecuteSnapshot,
      replayPair,
      plan,
    );
    return summarizeExecution({
      result,
      args,
      plan,
      deployedCommitSha: config.deployedCommitSha,
      preflight,
      authorization,
      beforeExecuteSnapshot,
      postExecute,
      retry: {
        state: retryResult.state,
        recovery: retryResult.recoveryBundle ? {
          artifactPath: retryResult.recoveryBundle.artifactPath,
          manifestPath: retryResult.recoveryBundle.manifestPath,
          reused: retryResult.recoveryBundle.reused,
        } : null,
        snapshot: retrySnapshot,
      },
      replay,
    });
  } finally {
    if (ownsSql) await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLegacyStageAllowlistExecute().then((result) => {
    process.stdout.write(`${stringifyJson({ event: "chips_ledger_legacy_stage_allowlist_execute", ...result })}\n`);
  }).catch((error) => {
    process.stderr.write(`chips-ledger-legacy-stage-allowlist-execute failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
