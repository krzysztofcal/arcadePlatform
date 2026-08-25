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
import { validateStageEnvironment } from "./chips-ledger-stage-automation.mjs";

const EXECUTE_GATE = "CHIPS_LEDGER_LEGACY_STAGE_ALLOWLIST_EXECUTE";
const SHA256_RE = /^[0-9a-f]{64}$/;
const POSITIVE_INTEGER_RE = /^[1-9][0-9]*$/;
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

function hashLines(values) {
  return crypto.createHash("sha256").update(`${values.join("\n")}\n`).digest("hex");
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
        pruned_at::text as pruned_at, registry_cleaned_at::text as registry_cleaned_at
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
    if (!batch.committed_at || !batch.archive_proof_verified_at
      || batch.destructive_go_at !== null
      || batch.destructive_go_batch_id !== null
      || batch.pruned_at !== null
      || batch.registry_cleaned_at !== null) {
      fail("preflight batch is not committed and unauthorized");
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

    const registry = await tx.unsafe(`
      select idempotency_key
      from public.chips_transaction_idempotency
      where archive_batch_id = 13
      order by idempotency_key;
    `);
    if (registry.length !== expected.registryCount
      || hashLines(registry.map((row) => text(row.idempotency_key))) !== expected.registryKeysSha256) {
      fail("preflight registry proof mismatch");
    }
    const counts = await tx.unsafe(`
      with registry as (
        select transaction_id
        from public.chips_transaction_idempotency
        where archive_batch_id = 13
      )
      select
        (select count(*) from registry)::text as registry_count,
        (select count(*) from public.chips_transactions transactions
          where exists (select 1 from registry where registry.transaction_id = transactions.id))::text as transaction_count,
        (select count(*) from public.chips_entries entries
          where exists (select 1 from registry where registry.transaction_id = entries.transaction_id))::text as entry_count;
    `);
    const countsRow = counts[0];
    if (text(countsRow?.registry_count) !== String(expected.registryCount)
      || text(countsRow?.transaction_count) !== String(expected.transactionCount)
      || text(countsRow?.entry_count) !== String(expected.entryCount)) {
      fail("preflight hot row counts mismatch");
    }
    return {
      batch: { status: batch.status, committedAt: batch.committed_at },
      proof: { sourceRun: proof.source_run, querySha256: proof.query_sha256 },
      counts: {
        transactions: number(countsRow.transaction_count, "preflight transaction_count"),
        entries: number(countsRow.entry_count, "preflight entry_count"),
        registry: number(countsRow.registry_count, "preflight registry_count"),
      },
    };
  });
  return { ...base, batchId: expected.batchId, readOnlyEvidence: details };
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

async function collectExecutionSnapshot(tx) {
  const accountRows = await tx.unsafe(`
    select id::text as id, balance::text as balance, next_entry_seq::text as next_entry_seq
    from public.chips_accounts
    order by id;
  `);
  const counts = await tx.unsafe(`
    with registry as (
      select transaction_id
      from public.chips_transaction_idempotency
      where archive_batch_id = 13
    )
    select
      (select count(*) from registry)::text as registry_count,
      (select count(*) from public.chips_transactions transactions
        where exists (select 1 from registry where registry.transaction_id = transactions.id))::text as transaction_count,
      (select count(*) from public.chips_entries entries
        where exists (select 1 from registry where registry.transaction_id = entries.transaction_id))::text as entry_count;
  `);
  const conservationRows = await tx.unsafe(`
    select
      count(*)::text as entry_count,
      coalesce(sum(amount), 0)::text as entry_sum,
      coalesce((select sum(balance) from public.chips_accounts), 0)::text as balance_total,
      coalesce((select sum(next_entry_seq) from public.chips_accounts), 0)::text as next_entry_seq_total
    from public.chips_entries;
  `);
  const countsRow = counts[0] || {};
  const conservation = conservationRows[0] || {};
  const accounts = accountRows.map((row) => ({
    id: text(row.id),
    balance: text(row.balance),
    nextEntrySeq: text(row.next_entry_seq),
  }));
  return {
    transactionCount: number(countsRow.transaction_count, "snapshot transaction_count"),
    entryCount: number(countsRow.entry_count, "snapshot entry_count"),
    registryCount: number(countsRow.registry_count, "snapshot registry_count"),
    balances: {
      accountCount: accounts.length,
      total: text(conservation.balance_total),
      sha256: canonicalHash(accounts),
    },
    nextEntrySeq: {
      total: text(conservation.next_entry_seq_total),
      sha256: canonicalHash(accounts),
    },
    conservation: {
      entryCount: number(conservation.entry_count, "snapshot conservation entry_count"),
      entrySum: text(conservation.entry_sum),
    },
  };
}

async function readExecutionSnapshot(sql) {
  return sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level repeatable read, read only;");
    return collectExecutionSnapshot(tx);
  });
}

function assertEconomicSnapshotUnchanged(before, after, label) {
  if (before.balances.total !== after.balances.total
    || before.balances.sha256 !== after.balances.sha256
    || before.nextEntrySeq.total !== after.nextEntrySeq.total
    || before.nextEntrySeq.sha256 !== after.nextEntrySeq.sha256
    || before.conservation.entrySum !== after.conservation.entrySum) {
    fail(`${label} changed balances, next_entry_seq or conservation`);
  }
}

async function verifyBatch13PostExecute(sql, before, evidence) {
  const expected = EXECUTE_BATCH_13;
  assertBatch13Evidence(evidence);
  return sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level repeatable read, read only;");
    const snapshot = await collectExecutionSnapshot(tx);
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

async function replayOldRegistryKey(sql, evidence, before) {
  const tableId = evidence.legacyTableIds?.[0];
  const registryKey = evidence.registryKeys?.[0];
  if (!tableId || !registryKey) fail("legacy replay proof is incomplete");
  return sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level repeatable read;");
    const beforeReplay = await collectExecutionSnapshot(tx);
    await tx.unsafe("savepoint legacy_stage_batch_13_replay;");
    let rejection = null;
    try {
      await tx.unsafe(`
        insert into public.chips_transactions (
          id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id, created_at
        ) values ($1::uuid, $2, $3::jsonb, $4, $5, 'TABLE_BUY_IN', null, $6::timestamptz);
      `, [
        REPLAY_TRANSACTION_ID,
        `table:${tableId}`,
        { tableId },
        registryKey,
        "f".repeat(64),
        "2026-08-17T00:00:00.000003Z",
      ]);
    } catch (error) {
      rejection = error;
      await tx.unsafe("rollback to savepoint legacy_stage_batch_13_replay;");
    }
    if (!rejection) {
      await tx.unsafe("rollback to savepoint legacy_stage_batch_13_replay;");
      fail("legacy registry key replay was accepted");
    }
    if (rejection.code !== "P8903") {
      fail(`legacy registry key replay returned unexpected SQLSTATE ${rejection.code || "unknown"}`);
    }
    await tx.unsafe("release savepoint legacy_stage_batch_13_replay;");
    const afterReplay = await collectExecutionSnapshot(tx);
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
    const authorization = await (deps.authorize || authorizeBatch13)(sql, plan);
    if (authorization?.destructiveGoBatchId !== EXECUTE_BATCH_13.batchId
      || !authorization?.destructiveGoAt) {
      fail("legacy Stage batch 13 authorization receipt is incomplete");
    }
    const readSnapshot = deps.readExecutionSnapshot || readExecutionSnapshot;
    const beforeExecuteSnapshot = await readSnapshot(sql, plan);
    if (beforeExecuteSnapshot.transactionCount !== EXECUTE_BATCH_13.transactionCount
      || beforeExecuteSnapshot.entryCount !== EXECUTE_BATCH_13.entryCount
      || beforeExecuteSnapshot.registryCount !== EXECUTE_BATCH_13.registryCount) {
      fail("batch 13 pre-execute snapshot counts are not exact");
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
        emit: false,
      },
    };
    const result = await prune(pruneArgs);
    const postExecute = await (deps.verifyPostExecute || verifyBatch13PostExecute)(
      sql,
      beforeExecuteSnapshot,
      result.evidence,
    );
    const retryResult = await prune(pruneArgs);
    if (retryResult?.state !== "already_pruned") {
      fail(`batch 13 retry returned ${retryResult?.state || "unknown"}, expected already_pruned`);
    }
    assertBatch13Evidence(retryResult.evidence || result.evidence);
    const retrySnapshot = await readSnapshot(sql, plan);
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
