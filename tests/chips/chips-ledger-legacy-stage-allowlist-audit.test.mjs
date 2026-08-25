import crypto from "node:crypto";
import assert from "node:assert/strict";
import fs from "node:fs";
import postgres from "postgres";

import {
  LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13,
  LEGACY_STAGE_ALLOWLIST_AUDIT_MIGRATION,
  LEGACY_STAGE_ALLOWLIST_AUDIT_OLD_PRUNER_SIGNATURE,
  LEGACY_STAGE_ALLOWLIST_AUDIT_PRUNER_SIGNATURE,
  LEGACY_STAGE_ALLOWLIST_AUDIT_READ_ONLY_TRANSACTION_SQL,
  LEGACY_STAGE_ALLOWLIST_AUDIT_SQL,
  assertLegacyStageAuditBatchRow,
  assertLegacyStageAuditPlan,
  assertLegacyStageAuditProofRow,
  assertPrunerOverloads,
  assertAccountRows,
  assertEntryShapeRows,
  assertExactEntryRows,
  assertExactRegistryRows,
  assertExactTransactionRows,
  assertTableRows,
  assertReadOnlyStorageRequest,
  runLegacyStageAllowlistAudit,
} from "../../scripts/ops/chips-ledger-legacy-stage-allowlist-audit.mjs";
import { buildLegacyPlan, loadFrozenLegacyAllowlist } from "../../scripts/ops/chips-ledger-legacy-stage-allowlist.mjs";
import { computeArchiveIdProofs } from "../../scripts/ops/chips-ledger-archive-prune.mjs";
import {
  assertLegacyStageAllowlistRegistryRows,
  hashLegacyStageAllowlistRegistryKeys,
  legacyStageAllowlistRegistryPredicate,
} from "../../scripts/ops/chips-ledger-legacy-stage-allowlist-registry.mjs";

const frozen = loadFrozenLegacyAllowlist({ cwd: process.cwd() });
const plan = buildLegacyPlan(frozen.masterManifest, frozen.batchManifest);
const expected = LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13;

assert.equal(expected.batchId, "13");
assert.equal(expected.objectPath, "v1/sha256/a7ff21fef10b1d22b963793d3cf6efd667319a7211ee47c7e6f755f293155e60.jsonl.gz");
assert.equal(expected.compressedSha256, "a7ff21fef10b1d22b963793d3cf6efd667319a7211ee47c7e6f755f293155e60");
assert.equal(expected.masterAllowlistSha256, "611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05");
assert.equal(expected.batchTableIdsSha256, "ded0a77efe84f56d2f4a9706f9d454a09179f6328098ad60ecf45639b4b75895");
assert.equal(plan.batchTableIds.length, 10);
assert.equal(plan.masterTableIds.length, 974);
assert.deepEqual(assertLegacyStageAuditPlan(plan).batchIds, plan.batchTableIds);

const planTamperCases = [
  ["plan_policy", (candidate) => { candidate.policy_id = "tampered"; }],
  ["plan_proof_basis", (candidate) => { candidate.archiveManifest.proof_basis = "tampered"; }],
  ["plan_query_hash", (candidate) => { candidate.archiveManifest.query_sha256 = "0".repeat(64); }],
  ["plan_generator_hash", (candidate) => { candidate.archiveManifest.generator_sha256 = "0".repeat(64); }],
  ["plan_system_identifier", (candidate) => { candidate.archiveManifest.stage_system_identifier = "0"; }],
  ["plan_archive_master_ids", (candidate) => {
    candidate.archiveManifest.master_table_ids = [...candidate.archiveManifest.master_table_ids];
    candidate.archiveManifest.master_table_ids[0] = candidate.masterTableIds[10];
  }],
  ["plan_archive_batch_ids", (candidate) => {
    candidate.archiveManifest.batch_table_ids = [...candidate.archiveManifest.batch_table_ids];
    candidate.archiveManifest.batch_table_ids[0] = candidate.masterTableIds[10];
  }],
];
for (const [code, mutate] of planTamperCases) {
  const candidate = structuredClone(plan);
  mutate(candidate);
  assert.throws(() => assertLegacyStageAuditPlan(candidate), (error) => error.code === code, code);
}

function validBatchRow() {
  return {
    object_path: expected.objectPath,
    batch_id: expected.batchId,
    project_ref: expected.projectRef,
    format_version: "2",
    cutoff: expected.cutoff,
    cursor_start_created_at: null,
    cursor_start_id: null,
    cursor_end_created_at: null,
    cursor_end_id: null,
    first_created_at: "2026-07-01T00:00:00.000000Z",
    last_created_at: "2026-07-01T00:00:29.000000Z",
    transaction_count: "60",
    entry_count: "120",
    tx_types: JSON.stringify(expected.txTypes),
    raw_bytes: "158056",
    compressed_bytes: "10476",
    raw_sha256: expected.rawSha256,
    compressed_sha256: expected.compressedSha256,
    credits: "6000",
    debits: "6000",
    net_amount: "0",
    status: "committed",
    committed_at: "2026-08-24T20:58:36.692320Z",
    source_policy_id: "legacy_stage_allowlist_v1",
    archived_transaction_ids_sha256: expected.txIdsSha256,
    archived_entry_ids_sha256: expected.entryIdsSha256,
    archive_proof_verified_at: "2026-08-25T08:03:29.227434Z",
    pruned_at: null,
    registry_cleaned_at: null,
    legacy_allowlist_sha256: expected.masterAllowlistSha256,
    legacy_batch_table_ids_sha256: expected.batchTableIdsSha256,
    legacy_master_table_ids: plan.masterTableIds,
    legacy_master_table_count: "974",
    legacy_batch_number: "1",
    legacy_batch_table_count: "10",
    legacy_source_run: "32753223679",
    legacy_query_sha256: expected.querySha256,
    legacy_stage_system_identifier: expected.systemIdentifier,
    destructive_go_at: null,
    destructive_go_batch_id: null,
  };
}

function validProofRow() {
  return {
    batch_id: expected.batchId,
    object_path: expected.objectPath,
    project_ref: expected.projectRef,
    source_policy_id: "legacy_stage_allowlist_v1",
    cutoff: expected.cutoff,
    source_run: "32753223679",
    query_sha256: expected.querySha256,
    postgres_system_identifier: expected.systemIdentifier,
    master_table_count: "974",
    master_table_ids: plan.masterTableIds,
    master_table_ids_sha256: expected.masterAllowlistSha256,
    batch_number: "1",
    batch_table_count: "10",
    batch_table_ids: plan.batchTableIds,
    batch_table_ids_sha256: expected.batchTableIdsSha256,
  };
}

assert.doesNotThrow(() => assertLegacyStageAuditBatchRow(validBatchRow(), plan));
assert.doesNotThrow(() => assertLegacyStageAuditProofRow(validProofRow(), plan));

const authorizedBatchRow = validBatchRow();
authorizedBatchRow.destructive_go_at = "2026-08-25T16:08:01.000000Z";
authorizedBatchRow.destructive_go_batch_id = expected.batchId;
assert.doesNotThrow(
  () => assertLegacyStageAuditBatchRow(authorizedBatchRow, plan),
  "audit must accept an exact batch 13 GO while the batch remains unpruned",
);

const batchTamperCases = [
  ["batch_object_path", "object_path", `${expected.objectPath}.tampered`],
  ["batch_id", "batch_id", "14"],
  ["batch_project_ref", "project_ref", "other-project"],
  ["batch_cutoff", "cutoff", "2026-08-17T16:51:28.075Z"],
  ["transaction_count", "transaction_count", "59"],
  ["entry_count", "entry_count", "119"],
  ["raw_sha256", "raw_sha256", "0".repeat(64)],
  ["compressed_sha256", "compressed_sha256", "0".repeat(64)],
  ["batch_transaction_ids_hash", "archived_transaction_ids_sha256", "0".repeat(64)],
  ["batch_entry_ids_hash", "archived_entry_ids_sha256", "0".repeat(64)],
  ["batch_status", "status", "pending"],
  ["destructive_go", "destructive_go_at", "2026-08-25T00:00:00Z"],
  ["destructive_go", "destructive_go_batch_id", expected.batchId],
  ["destructive_go", "destructive_go_batch_id", "14"],
  ["cleanup_receipts", "pruned_at", "2026-08-25T00:00:00Z"],
  ["batch_master_hash", "legacy_allowlist_sha256", "0".repeat(64)],
  ["batch_table_hash", "legacy_batch_table_ids_sha256", "0".repeat(64)],
  ["batch_source_run", "legacy_source_run", "tampered"],
];
for (const [code, field, value] of batchTamperCases) {
  const row = validBatchRow();
  row[field] = value;
  assert.throws(() => assertLegacyStageAuditBatchRow(row, plan), (error) => error.code === code, code);
}

const proofTamperCases = [
  ["proof_object_path", "object_path", `${expected.objectPath}.tampered`],
  ["proof_cutoff", "cutoff", "2026-08-17T16:51:28.075Z"],
  ["proof_source_run", "source_run", "tampered"],
  ["proof_master_hash", "master_table_ids_sha256", "0".repeat(64)],
  ["proof_batch_number", "batch_number", "2"],
  ["proof_batch_ids", "batch_table_ids", [plan.masterTableIds[10], ...plan.batchTableIds.slice(1)]],
  ["proof_batch_hash", "batch_table_ids_sha256", "0".repeat(64)],
];
for (const [code, field, value] of proofTamperCases) {
  const row = validProofRow();
  row[field] = value;
  assert.throws(() => assertLegacyStageAuditProofRow(row, plan), (error) => error.code === code, code);
}

assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.registry, /table_id::text as table_id/);
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.registry, /table_id = any\(\$1::uuid\[\]\)/);
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.registry, /TABLE_BUY_IN.*TABLE_CASH_OUT/s);
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.entryShapes, /matching_escrow_count/);
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.entryShapes, /active_entry_count/);
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.tables, /bot_only_proof_eligible/);
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.accounts, /account_type/);
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.overloads, /to_regprocedure/);
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.overloads, /pg_get_function_identity_arguments/);
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.overloads, /jsonb_agg/);
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.overloads, new RegExp(LEGACY_STAGE_ALLOWLIST_AUDIT_PRUNER_SIGNATURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.overloads, new RegExp(LEGACY_STAGE_ALLOWLIST_AUDIT_OLD_PRUNER_SIGNATURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

function makeAuditRecord({ id, tableId, txType, entryIds, index }) {
  const systemAccountId = `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  const escrowAccountId = `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  const createdAt = `2026-08-17T00:00:0${index}.000000Z`;
  const systemAmount = txType === "TABLE_BUY_IN" ? "-100" : "100";
  const escrowAmount = txType === "TABLE_BUY_IN" ? "100" : "-100";
  const transaction = {
    id, sequence: String(index + 1), tx_type: txType,
    idempotency_key: `legacy-fixture:${tableId}:${index}`,
    payload_hash: "a".repeat(64), user_id: null,
    reference: `BOT_SEED_BUY_IN:${tableId}:${index}`,
    description: null, metadata: { tableId }, created_by: null, created_at: createdAt,
  };
  return {
    transaction,
    table_context: {
      table_id: tableId, table_exists: true, table_status: "CLOSED",
      escrow_account_id: escrowAccountId, escrow_status: "active", escrow_balance: "0",
    },
    entries: [
      {
        id: entryIds[0], transaction_id: id, account_id: systemAccountId, entry_seq: "1",
        amount: systemAmount, metadata: {}, created_at: createdAt,
        account: { id: systemAccountId, account_type: "SYSTEM", user_id: null, system_key: `SYSTEM_FIXTURE:${index}`, status: "active" },
      },
      {
        id: entryIds[1], transaction_id: id, account_id: escrowAccountId, entry_seq: "1",
        amount: escrowAmount, metadata: {}, created_at: createdAt,
        account: { id: escrowAccountId, account_type: "ESCROW", user_id: null, system_key: `POKER_TABLE:${tableId}`, status: "active" },
      },
    ],
  };
}

const fixtureTableIds = plan.batchTableIds.slice(0, 2);
const archiveOrderRecords = [
  makeAuditRecord({
    id: "f0000000-0000-4000-8000-000000000001", tableId: fixtureTableIds[0],
    txType: "TABLE_BUY_IN", entryIds: ["900", "901"], index: 0,
  }),
  makeAuditRecord({
    id: "00000000-0000-4000-8000-000000000002", tableId: fixtureTableIds[1],
    txType: "TABLE_CASH_OUT", entryIds: ["2", "3"], index: 1,
  }),
];
const archiveOrderProofs = computeArchiveIdProofs(archiveOrderRecords);
const hashLines = (values) => crypto.createHash("sha256").update(`${values.join("\n")}\n`).digest("hex");
assert.notEqual(archiveOrderProofs.transactionIdsSha256, hashLines([...archiveOrderProofs.transactionIds].sort()));
assert.notEqual(archiveOrderProofs.entryIdsSha256, hashLines([...archiveOrderProofs.entryIds].sort()));
assert.equal(
  assertExactTransactionRows(archiveOrderRecords.slice().reverse().map(({ transaction }) => transaction), archiveOrderRecords),
  archiveOrderProofs.transactionIdsSha256,
);
assert.equal(
  assertExactEntryRows(archiveOrderRecords.slice().reverse().flatMap(({ entries }) => entries), archiveOrderRecords),
  archiveOrderProofs.entryIdsSha256,
);

const registryRows = archiveOrderRecords.slice().reverse().map(({ transaction, table_context }) => ({
  idempotency_key: transaction.idempotency_key, transaction_id: transaction.id,
  table_id: table_context.table_id, payload_hash: transaction.payload_hash,
  tx_type: transaction.tx_type, user_id: null, transaction_created_at: transaction.created_at,
  archive_batch_id: null,
}));
assert.doesNotThrow(() => assertExactRegistryRows(registryRows, archiveOrderRecords, fixtureTableIds));
assert.throws(
  () => assertExactRegistryRows([
    ...registryRows,
    { ...registryRows[0], idempotency_key: `extra:${fixtureTableIds[0]}` },
  ], archiveOrderRecords, fixtureTableIds),
  (error) => error.code === "registry_rows_count",
);

assert.match(legacyStageAllowlistRegistryPredicate("$1"), /table_id = any\(\$1::uuid\[\]\)/);
assert.match(legacyStageAllowlistRegistryPredicate("$1"), /TABLE_BUY_IN.*TABLE_CASH_OUT/s);
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.registry, /archive_batch_id::text as archive_batch_id/);

// This mirrors the approved unpruned batch shape: all 60 TABLE_* registry
// rows belong to the exact ten tables and remain unassigned to an archive.
const unprunedRegistryRows = Array.from({ length: 60 }, (_, index) => ({
  idempotency_key: `batch-13-unpruned:${plan.batchTableIds[index % 10]}:${String(index).padStart(2, "0")}`,
  transaction_id: `00000000-0000-4000-8000-${String(0xd600 + index).padStart(12, "0")}`,
  table_id: plan.batchTableIds[index % 10],
  tx_type: index % 2 === 0 ? "TABLE_BUY_IN" : "TABLE_CASH_OUT",
  user_id: null,
  archive_batch_id: null,
}));
const unprunedRegistryHash = hashLegacyStageAllowlistRegistryKeys(
  unprunedRegistryRows.map((row) => row.idempotency_key).sort(),
);
assert.doesNotThrow(() => assertLegacyStageAllowlistRegistryRows(unprunedRegistryRows, {
  tableIds: plan.batchTableIds,
  expectedCount: 60,
  expectedKeysSha256: unprunedRegistryHash,
}));
assert.throws(
  () => assertLegacyStageAllowlistRegistryRows(
    unprunedRegistryRows.map((row, index) => index === 0 ? { ...row, archive_batch_id: 13 } : row),
    { tableIds: plan.batchTableIds, expectedCount: 60, expectedKeysSha256: unprunedRegistryHash },
  ),
  (error) => error.code === "registry_archive_batch_id",
);
assert.throws(
  () => assertLegacyStageAllowlistRegistryRows(
    [...unprunedRegistryRows, { ...unprunedRegistryRows[0], idempotency_key: "batch-13-extra" }],
    { tableIds: plan.batchTableIds, expectedCount: 60, expectedKeysSha256: unprunedRegistryHash },
  ),
  (error) => error.code === "registry_rows_count",
);
assert.throws(
  () => assertLegacyStageAllowlistRegistryRows(
    unprunedRegistryRows.map((row, index) => index === 0 ? { ...row, idempotency_key: "batch-13-replaced" } : row),
    { tableIds: plan.batchTableIds, expectedCount: 60, expectedKeysSha256: unprunedRegistryHash },
  ),
  (error) => error.code === "registry_keys_hash",
);

const tableRows = archiveOrderRecords.map(({ table_context }) => ({
  table_id: table_context.table_id, status: "CLOSED", has_human_participant: false,
  bot_only_proof_eligible: false, escrow_account_id: table_context.escrow_account_id,
  escrow_account_type: "ESCROW", escrow_system_key: `POKER_TABLE:${table_context.table_id}`,
  escrow_status: "active", escrow_balance: "0", escrow_next_entry_seq: "2",
}));
assert.doesNotThrow(() => assertTableRows(tableRows, fixtureTableIds));
assert.throws(
  () => assertTableRows([{ ...tableRows[0], bot_only_proof_eligible: true }, tableRows[1]], fixtureTableIds),
  (error) => error.code === "table_bot_only_proof_eligible",
);

const accountRows = archiveOrderRecords.flatMap(({ entries }) => entries).map((entry) => ({
  account_id: entry.account.id, user_id: null, account_type: entry.account.account_type,
  system_key: entry.account.system_key, balance: "0", next_entry_seq: "2", status: "active",
}));
const accountIds = accountRows.map((row) => row.account_id);
assert.doesNotThrow(() => assertAccountRows(accountRows, accountIds, archiveOrderRecords));
assert.throws(
  () => assertAccountRows([{ ...accountRows[0], account_type: "ESCROW" }, ...accountRows.slice(1)], accountIds, archiveOrderRecords),
  (error) => error.code === "account_snapshot_account_type",
);

const entryShapeRows = archiveOrderRecords.map(({ transaction, table_context }) => ({
  transaction_id: transaction.id, tx_type: transaction.tx_type, user_id: null,
  table_id: table_context.table_id, entry_count: "2", user_entry_count: "0",
  system_entry_count: "1", escrow_entry_count: "1", matching_escrow_count: "1",
  active_entry_count: "2", net_amount: "0",
  system_amount: transaction.tx_type === "TABLE_BUY_IN" ? "-100" : "100",
  escrow_amount: transaction.tx_type === "TABLE_BUY_IN" ? "100" : "-100",
}));
assert.doesNotThrow(() => assertEntryShapeRows(entryShapeRows, archiveOrderRecords));
assert.throws(
  () => assertEntryShapeRows([{ ...entryShapeRows[0], matching_escrow_count: "0" }, entryShapeRows[1]], archiveOrderRecords),
  (error) => error.code === "entry_shape",
);

const postgresNamedIdentityArgs = "p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_batch_table_ids uuid[], p_allowlist_sha256 text, p_batch_table_ids_sha256 text, p_registry_keys text[], p_execute boolean, p_approved_batch_id bigint";
const validPrunerOverloads = assertPrunerOverloads({
  expected_oid: "123456",
  legacy_oid: null,
  overload_count: "1",
  expected_count: "1",
  legacy_count: "0",
  overloads: JSON.stringify([{ oid: "123456", identity_args: postgresNamedIdentityArgs }]),
});
assert.equal(validPrunerOverloads.expectedOid, "123456");
assert.equal(validPrunerOverloads.overloads[0].identity_args, postgresNamedIdentityArgs);
assert.throws(
  () => assertPrunerOverloads({
    expected_oid: "123456", legacy_oid: null, overload_count: "2", expected_count: "1", legacy_count: "0",
    overloads: [{ oid: "123456", identity_args: postgresNamedIdentityArgs }, { oid: "123457", identity_args: "extra text" }],
  }),
  (error) => error.code === "pruner_overload",
);
assert.throws(
  () => assertPrunerOverloads({
    expected_oid: "123456", legacy_oid: "123455", overload_count: "2", expected_count: "1", legacy_count: "1",
    overloads: [{ oid: "123455", identity_args: "legacy args" }, { oid: "123456", identity_args: postgresNamedIdentityArgs }],
  }),
  (error) => error.code === "pruner_overload",
);

async function runPostgresPrunerOverloadContract() {
  const dbUrl = process.env.CHIPS_MIGRATIONS_TEST_DB_URL;
  if (!dbUrl) {
    console.log("Skipping legacy Stage allowlist PostgreSQL overload contract: CHIPS_MIGRATIONS_TEST_DB_URL not set.");
    return;
  }

  const sql = postgres(dbUrl, { max: 1, prepare: false, idle_timeout: 5 });
  try {
    const databaseRows = await sql`select current_database() as name;`;
    assert.ok(
      /(?:_test|reset_contract)$/i.test(databaseRows[0]?.name || ""),
      "legacy Stage allowlist overload contract requires a disposable database",
    );

    const [row] = await sql.unsafe(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.overloads);
    const overloads = assertPrunerOverloads(row);
    assert.equal(overloads.overloadCount, 1);
    assert.equal(overloads.legacyOid, null);

    const [actual] = await sql.unsafe(`
      select
        p.oid::text as actual_oid,
        pg_catalog.to_regprocedure($1)::oid::text as resolved_oid,
        pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_args
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.oid = pg_catalog.to_regprocedure($1)::oid;
    `, [LEGACY_STAGE_ALLOWLIST_AUDIT_PRUNER_SIGNATURE]);
    assert.equal(actual?.actual_oid, row.expected_oid, "catalog OID must match to_regprocedure OID");
    assert.equal(actual?.resolved_oid, row.expected_oid, "to_regprocedure must return the numeric OID text");
    assert.equal(
      actual?.identity_args,
      "p_object_path text, p_transaction_ids uuid[], p_entry_ids bigint[], p_batch_table_ids uuid[], p_allowlist_sha256 text, p_batch_table_ids_sha256 text, p_registry_keys text[], p_execute boolean, p_approved_batch_id bigint",
      "PostgreSQL identity arguments must retain the named-parameter format",
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await runPostgresPrunerOverloadContract();

assert.equal(assertReadOnlyStorageRequest(), "GET");
for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
  assert.throws(() => assertReadOnlyStorageRequest({ method }), (error) => error.code === "storage_method");
}

assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_READ_ONLY_TRANSACTION_SQL, /repeatable read, read only/i);
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.migration, /schema_migration_files/);
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.fence, /chips_table_fence_is_active/);
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.enforcement, /enforcement_active/);
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.batch, /batch_id = \$1/);
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.entries, /transaction_id = any\(\$1::uuid\[\]\)/);
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.registry, /table_id = any\(\$1::uuid\[\]\)/);
assert.doesNotMatch(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.registry, /or transaction_id = any/);

const auditSource = fs.readFileSync("scripts/ops/chips-ledger-legacy-stage-allowlist-audit.mjs", "utf8");
assert.match(auditSource, /row\.archive_batch_id !== null/);
assert.doesNotMatch(auditSource, /runLegacyStagePrepareOnly|storeArchive|pruneArchive|--execute|CHIPS_LEDGER_BOT_ONLY_EXECUTE/);
assert.doesNotMatch(auditSource, /\b(?:insert|update|delete)\s+into\b/i);
assert.doesNotMatch(auditSource, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
assert.match(auditSource, /set local statement_timeout/);
assert.match(auditSource, /Promise\.race/);
assert.match(auditSource, new RegExp(`version: "${LEGACY_STAGE_ALLOWLIST_AUDIT_MIGRATION.version}"`));

await assert.rejects(
  () => runLegacyStageAllowlistAudit({ argv: ["--batch-id", "14"] }),
  (error) => error.code === "arguments_not_allowed",
);

process.stdout.write("chips-ledger-legacy-stage-allowlist audit contract passed\n");
