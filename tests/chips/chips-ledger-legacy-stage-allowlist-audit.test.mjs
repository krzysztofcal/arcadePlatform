import assert from "node:assert/strict";
import fs from "node:fs";

import {
  LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13,
  LEGACY_STAGE_ALLOWLIST_AUDIT_MIGRATION,
  LEGACY_STAGE_ALLOWLIST_AUDIT_READ_ONLY_TRANSACTION_SQL,
  LEGACY_STAGE_ALLOWLIST_AUDIT_SQL,
  assertLegacyStageAuditBatchRow,
  assertLegacyStageAuditPlan,
  assertLegacyStageAuditProofRow,
  assertReadOnlyStorageRequest,
  runLegacyStageAllowlistAudit,
} from "../../scripts/ops/chips-ledger-legacy-stage-allowlist-audit.mjs";
import { buildLegacyPlan, loadFrozenLegacyAllowlist } from "../../scripts/ops/chips-ledger-legacy-stage-allowlist.mjs";

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
assert.match(LEGACY_STAGE_ALLOWLIST_AUDIT_SQL.registry, /transaction_id = any\(\$1::uuid\[\]\)/);

const auditSource = fs.readFileSync("scripts/ops/chips-ledger-legacy-stage-allowlist-audit.mjs", "utf8");
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
