import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT,
  LEGACY_STAGE_ALLOWLIST_CUTOFF,
  LEGACY_STAGE_ALLOWLIST_GENERATOR_SQL,
  LEGACY_STAGE_ALLOWLIST_POLICY_ID,
  LEGACY_STAGE_ALLOWLIST_SOURCE_RUN,
  LEGACY_STAGE_ALLOWLIST_TABLE_COUNT,
  LEGACY_STAGE_ALLOWLIST_CANDIDATE_SQL,
  buildArchiveBytes,
  buildExportRecord,
  buildManifest,
} from "../../scripts/ops/chips-ledger-archive-export.mjs";
import {
  buildLegacyBatchManifest,
  buildLegacyMasterManifest,
  buildLegacyPlan,
  legacyAllowlistQuerySha256,
  readLegacyAllowlist,
  writeLegacyPlanFiles,
} from "../../scripts/ops/chips-ledger-legacy-stage-allowlist.mjs";
import { buildPruneEvidence } from "../../scripts/ops/chips-ledger-archive-prune.mjs";
import { verifyArchiveBytes } from "../../scripts/ops/chips-ledger-archive-store.mjs";

const migrationPath = "supabase/migrations/20260824120000_chips_ledger_legacy_stage_allowlist.sql";
const workflowPath = ".github/workflows/chips-ledger-stage-legacy-allowlist.yml";
const migration = fs.readFileSync(migrationPath, "utf8");
const workflow = fs.readFileSync(workflowPath, "utf8");

function tableId(number) {
  return `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
}

const ids = Array.from({ length: LEGACY_STAGE_ALLOWLIST_TABLE_COUNT }, (_, index) => tableId(index + 1));

const master = buildLegacyMasterManifest({
  tableIds: ids,
  cutoff: LEGACY_STAGE_ALLOWLIST_CUTOFF,
  querySha256: legacyAllowlistQuerySha256(),
  sourceRun: LEGACY_STAGE_ALLOWLIST_SOURCE_RUN,
  stageSystemIdentifier: "7656985631720456337",
  projectRef: "krydukthwdvccggbyjfw",
});
const batch = buildLegacyBatchManifest(master, { batchNumber: 1 });
const plan = buildLegacyPlan(master, batch);

const fixtureCandidates = plan.batchTableIds.map((fixtureTableId, index) => ({
  id: tableId(0xf001 + index),
  sequence: String(index + 1),
  tx_type: "TABLE_BUY_IN",
  idempotency_key: `bot-seed-buyin:${fixtureTableId}:legacy-fixture`,
  payload_hash: `${"a".repeat(63)}${index.toString(16)}`,
  user_id: null,
  reference: `BOT_SEED_BUY_IN:${fixtureTableId}:${index + 1}`,
  description: null,
  metadata: { tableId: fixtureTableId },
  created_by: tableId(0xf101 + index),
  created_at: `2026-07-01T00:00:0${index}.000000Z`,
  entry_count: "2",
  table_related: true,
  table_id: fixtureTableId,
  table_exists: true,
  table_status: "CLOSED",
  escrow_account_id: tableId(0xf201 + index),
  escrow_status: "active",
  escrow_balance: "0",
  has_human_participant: false,
  bot_only_proof_eligible: false,
  key_table_id: fixtureTableId,
  key_format_version: 1,
  key_format: "bot-seed-buyin",
  table_newest_created_at: `2026-07-01T00:00:0${index}.000000Z`,
  table_identity_count: "1",
  table_eligible_count: "1",
  table_out_of_scope_keys_sha256: "b".repeat(64),
  legacy_allowlist_sha256: plan.allowlistSha256,
  legacy_batch_table_ids_sha256: plan.batchTableIdsSha256,
  legacy_source_run: LEGACY_STAGE_ALLOWLIST_SOURCE_RUN,
  legacy_query_sha256: plan.querySha256,
  legacy_stage_system_identifier: "7656985631720456337",
  legacy_master_table_count: LEGACY_STAGE_ALLOWLIST_TABLE_COUNT,
  legacy_batch_number: 1,
  legacy_batch_table_count: LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT,
}));
const fixtureEntries = fixtureCandidates.flatMap((fixtureCandidate, index) => {
  const systemAccountId = tableId(0xf301 + index);
  return [
    {
      id: String(101 + index * 2),
      transaction_id: fixtureCandidate.id,
      account_id: systemAccountId,
      entry_seq: "1",
      amount: "-100",
      metadata: {},
      created_at: fixtureCandidate.created_at,
      account_row_id: systemAccountId,
      account_type: "SYSTEM",
      account_user_id: null,
      account_system_key: "TREASURY",
      account_status: "active",
      account_label: null,
    },
    {
      id: String(102 + index * 2),
      transaction_id: fixtureCandidate.id,
      account_id: fixtureCandidate.escrow_account_id,
      entry_seq: "2",
      amount: "100",
      metadata: {},
      created_at: fixtureCandidate.created_at,
      account_row_id: fixtureCandidate.escrow_account_id,
      account_type: "ESCROW",
      account_user_id: null,
      account_system_key: `POKER_TABLE:${fixtureCandidate.table_id}`,
      account_status: "active",
      account_label: null,
    },
  ];
});
const fixtureRecords = fixtureCandidates.map((fixtureCandidate, index) => buildExportRecord(
  fixtureCandidate,
  fixtureEntries.slice(index * 2, index * 2 + 2),
  { schemaVersion: 2 },
));
const fixtureArchive = buildArchiveBytes(fixtureRecords);
const fixtureManifest = buildManifest({
  target: "stage",
  cutoff: LEGACY_STAGE_ALLOWLIST_CUTOFF,
  batchSize: 5000,
  cursor: null,
  records: fixtureRecords,
  archive: fixtureArchive,
  outputPath: "/private/legacy-stage-batch-001.archive.jsonl.gz",
  sourcePolicyId: LEGACY_STAGE_ALLOWLIST_POLICY_ID,
  schemaVersion: 2,
  legacyStageAllowlist: plan.archiveManifest,
});
const verifiedFixture = verifyArchiveBytes({
  compressedBytes: fixtureArchive.compressedBytes,
  manifest: fixtureManifest,
  target: { target: "stage" },
  artifactName: "legacy-stage-batch-001.archive.jsonl.gz",
});
const fixtureEvidence = buildPruneEvidence(verifiedFixture);
assert.equal(fixtureManifest.schema_version, 2);
assert.equal(fixtureManifest.source_policy_id, LEGACY_STAGE_ALLOWLIST_POLICY_ID);
assert.equal(fixtureEvidence.legacyTableIds.length, LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT);
assert.deepEqual(fixtureEvidence.legacyTableIds, plan.batchTableIds);
assert.equal(fixtureEvidence.legacyMasterTableIds.length, LEGACY_STAGE_ALLOWLIST_TABLE_COUNT);
assert.equal(fixtureEvidence.legacyAllowlistSha256, plan.allowlistSha256);

assert.equal(master.policy_id, LEGACY_STAGE_ALLOWLIST_POLICY_ID);
assert.equal(master.proof_basis, LEGACY_STAGE_ALLOWLIST_POLICY_ID);
assert.equal(master.table_count, LEGACY_STAGE_ALLOWLIST_TABLE_COUNT);
assert.equal(master.table_ids.length, LEGACY_STAGE_ALLOWLIST_TABLE_COUNT);
assert.equal(batch.batch_table_count, LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT);
assert.deepEqual(batch.batch_table_ids, ids.slice(0, LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT));
assert.equal(plan.masterTableIds.length, LEGACY_STAGE_ALLOWLIST_TABLE_COUNT);
assert.equal(plan.batchTableIds.length, LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT);
assert.equal(plan.archiveManifest.master_table_ids.length, LEGACY_STAGE_ALLOWLIST_TABLE_COUNT);
assert.equal(buildLegacyBatchManifest(master, { batchNumber: 1 }).manifest_sha256, batch.manifest_sha256);
assert.throws(() => buildLegacyMasterManifest({ tableIds: ids.slice(1) }), /exactly 974/);

assert.doesNotMatch(LEGACY_STAGE_ALLOWLIST_GENERATOR_SQL, /repeatable/i);
assert.match(LEGACY_STAGE_ALLOWLIST_GENERATOR_SQL, /CLOSED/);
assert.match(LEGACY_STAGE_ALLOWLIST_GENERATOR_SQL, /has_human_participant is false/);
assert.match(LEGACY_STAGE_ALLOWLIST_GENERATOR_SQL, /bot_only_proof_eligible is not true/);
assert.match(LEGACY_STAGE_ALLOWLIST_GENERATOR_SQL, /stats\.newest_created_at < \$1/);
assert.match(LEGACY_STAGE_ALLOWLIST_GENERATOR_SQL, /marker_issue_transaction_count = 0/);
assert.match(LEGACY_STAGE_ALLOWLIST_CANDIDATE_SQL, /batch_gate/);
assert.match(LEGACY_STAGE_ALLOWLIST_CANDIDATE_SQL, /gate\.table_count = pg_catalog\.cardinality\(\$2::uuid\[\]\)/);
assert.doesNotMatch(LEGACY_STAGE_ALLOWLIST_CANDIDATE_SQL, /limit\s+\$[0-9]+::int/i);

let beginCalls = 0;
let generatorParameters = null;
const mockSql = {
  async begin(callback) {
    beginCalls += 1;
    return callback({
      async unsafe(sql, parameters = []) {
        if (/set transaction/i.test(sql)) return [];
        if (/pg_control_system/i.test(sql)) return [{ system_identifier: "7656985631720456337" }];
        generatorParameters = parameters;
        return ids.map((table_id) => ({ table_id }));
      },
    });
  },
};
const generated = await readLegacyAllowlist(mockSql);
assert.equal(beginCalls, 1);
assert.deepEqual(generatorParameters, [LEGACY_STAGE_ALLOWLIST_CUTOFF]);
assert.equal(generated.masterManifest.table_count, 974);
assert.equal(generated.batchManifest.batch_table_count, 10);
assert.equal(generated.querySha256, legacyAllowlistQuerySha256());

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-allowlist-test-"));
try {
  const files = writeLegacyPlanFiles(temp, plan);
  assert.equal(files.paths.length, 4);
  assert.ok(fs.statSync(files.paths[0]).isFile());
  assert.match(fs.readFileSync(files.paths[1], "utf8"), /legacy_stage_allowlist_v1/);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

assert.match(migration, /archive_schema_version.*schema v2|schema v2.*legacy_stage_allowlist_v1/i);
assert.match(migration, /legacy_stage_allowlist_v1/);
assert.match(migration, /chips_legacy_stage_allowlist_proofs/);
assert.match(migration, /pg_input_is_valid[\s\S]*jsonb_typeof/i);
assert.match(migration, /chips_assert_legacy_stage_allowlist_batch/);
assert.match(migration, /chips_authorize_legacy_stage_allowlist_batch/);
assert.match(migration, /Exact legacy Stage batch GO/);
assert.match(migration, /chips_prune_legacy_stage_allowlist_batch/);
assert.match(migration, /P8902/);

assert.match(workflow, /^on:\n\s+workflow_dispatch:/m);
assert.doesNotMatch(workflow, /^\s+- cron:/m);
assert.match(workflow, /CHIPS_LEDGER_STAGE_AUTOMATION_ENABLED == '1'/);
assert.match(workflow, /SUPABASE_STAGE_DB_URL: \$\{\{ secrets\.SUPABASE_STAGE_DB_URL \}\}/);
assert.match(workflow, /SUPABASE_STAGE_URL: \$\{\{ secrets\.SUPABASE_STAGE_URL \}\}/);
assert.match(workflow, /SUPABASE_STAGE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_STAGE_SERVICE_ROLE_KEY \}\}/);
assert.match(workflow, /set transaction isolation level repeatable read, read only/);
assert.match(workflow, /7656985631720456337/);
assert.match(workflow, /chips_table_fence_is_active/);
assert.match(workflow, /enforcement_active/);
assert.match(workflow, /DEPLOYED_COMMIT_SHA: \$\{\{ steps\.checkout-sha\.outputs\.sha \}\}/);
assert.match(workflow, /node scripts\/ops\/chips-ledger-legacy-stage-allowlist\.mjs/);
assert.doesNotMatch(workflow, /--execute|CHIPS_LEDGER_BOT_ONLY_EXECUTE|SUPABASE_PROD_|PRODUCTION|inputs:/);

process.stdout.write("chips-ledger-legacy-stage-allowlist contract passed\n");
