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
  runExport,
} from "../../scripts/ops/chips-ledger-archive-export.mjs";
import {
  LEGACY_STAGE_ALLOWLIST_DIAGNOSTIC_SOURCE_RUN,
  LEGACY_STAGE_ALLOWLIST_DIAGNOSTIC_SOURCE_RUN_SHA256,
  LEGACY_STAGE_ALLOWLIST_REPO_RELATIVE_DIR,
  buildLegacyBatchManifest,
  buildLegacyMasterManifest,
  buildLegacyPlan,
  legacyAllowlistQuerySha256,
  loadFrozenLegacyAllowlist,
  readLegacyAllowlist,
  validateFrozenLegacyAllowlistArtifacts,
  writeLegacyPlanFiles,
} from "../../scripts/ops/chips-ledger-legacy-stage-allowlist.mjs";
import { runLegacyStageAllowlistFreeze } from "../../scripts/ops/chips-ledger-legacy-stage-allowlist-freeze.mjs";
import { buildPruneEvidence } from "../../scripts/ops/chips-ledger-archive-prune.mjs";
import { storeArchive, verifyArchiveBytes, verifyLocalArchive } from "../../scripts/ops/chips-ledger-archive-store.mjs";

const migrationPath = "supabase/migrations/20260824120000_chips_ledger_legacy_stage_allowlist.sql";
const freezeMigrationPath = "supabase/migrations/20260824140000_chips_ledger_legacy_stage_allowlist_freeze_guard.sql";
const workflowPath = ".github/workflows/chips-ledger-stage-legacy-allowlist.yml";
const freezeWorkflowPath = ".github/workflows/chips-ledger-stage-legacy-allowlist-freeze.yml";
const migration = fs.readFileSync(migrationPath, "utf8");
const freezeMigration = fs.readFileSync(freezeMigrationPath, "utf8");
const workflow = fs.readFileSync(workflowPath, "utf8");
const freezeWorkflow = fs.readFileSync(freezeWorkflowPath, "utf8");

function tableId(number) {
  return `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
}

const frozenArtifacts = loadFrozenLegacyAllowlist({ cwd: process.cwd() });
const ids = frozenArtifacts.masterTableIds;
const master = frozenArtifacts.masterManifest;
const batch = frozenArtifacts.batchManifest;
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

const frozenRunPlan = plan;
const frozenRunTableId = frozenRunPlan.batchTableIds[0];
const frozenRunCandidate = {
  ...fixtureCandidates[0],
  idempotency_key: `bot-seed-buyin:${frozenRunTableId}:legacy-fixture`,
  reference: `BOT_SEED_BUY_IN:${frozenRunTableId}:1`,
  table_id: frozenRunTableId,
  key_table_id: frozenRunTableId,
  legacy_allowlist_sha256: frozenRunPlan.allowlistSha256,
  legacy_batch_table_ids_sha256: frozenRunPlan.batchTableIdsSha256,
  legacy_source_run: frozenRunPlan.sourceRun,
  legacy_query_sha256: frozenRunPlan.querySha256,
  legacy_stage_system_identifier: frozenRunPlan.stageSystemIdentifier,
  legacy_master_table_count: frozenRunPlan.masterTableCount,
  legacy_batch_number: frozenRunPlan.batchNumber,
  legacy_batch_table_count: frozenRunPlan.batchTableCount,
};
const frozenRunEntries = fixtureEntries.slice(0, 2).map((entry) => entry.account_type === "ESCROW"
  ? { ...entry, account_system_key: `POKER_TABLE:${frozenRunTableId}` }
  : entry);

const runExportTemp = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-stage-run-export-test-"));
try {
  const observedQueries = [];
  const integrationSql = {
    typed: (value, type) => ({ value, type }),
    async begin(callback) {
      return callback({
        async unsafe(query, parameters = []) {
          observedQueries.push({ query, parameters });
          if (/^\s*set transaction isolation level repeatable read, read only;/i.test(query)) return [];
          if (query === LEGACY_STAGE_ALLOWLIST_CANDIDATE_SQL) return [frozenRunCandidate];
          if (/from public\.chips_entries/i.test(query)) return frozenRunEntries;
          throw new Error(`unexpected integration SQL: ${query.slice(0, 80)}`);
        },
      });
    },
  };
  const integrationEnv = {
    EXPECTED_SUPABASE_STAGE_PROJECT_REF: "krydukthwdvccggbyjfw",
    SUPABASE_STAGE_DB_URL: "postgresql://postgres.krydukthwdvccggbyjfw:test@db.krydukthwdvccggbyjfw.supabase.co:5432/postgres",
  };
  const integrationResult = await runExport({
    argv: [
      "--target", "stage",
      "--cutoff", frozenRunPlan.cutoff,
      "--batch-size", "5000",
      "--output", "legacy.archive.jsonl.gz",
      "--manifest", "legacy.manifest.json",
    ],
    env: integrationEnv,
    cwd: runExportTemp,
    deps: {
      sql: integrationSql,
      selector: "legacy-stage-allowlist-v1",
      schemaVersion: 2,
      sourcePolicyId: LEGACY_STAGE_ALLOWLIST_POLICY_ID,
      legacyStageAllowlistPlan: frozenRunPlan,
      targetOptions: { singleTarget: true },
      emit: false,
    },
  });
  const candidateQuery = observedQueries.find(({ query }) => query === LEGACY_STAGE_ALLOWLIST_CANDIDATE_SQL);
  assert.deepEqual(candidateQuery?.parameters, [
    { value: frozenRunPlan.cutoff, type: 25 },
    frozenRunPlan.batchTableIds,
    5000,
    frozenRunPlan.allowlistSha256,
    frozenRunPlan.batchTableIdsSha256,
    frozenRunPlan.sourceRun,
    frozenRunPlan.querySha256,
    frozenRunPlan.stageSystemIdentifier,
    frozenRunPlan.masterTableCount,
    frozenRunPlan.batchNumber,
    frozenRunPlan.batchTableCount,
    LEGACY_STAGE_ALLOWLIST_BATCH_TABLE_LIMIT,
  ], "runExport must bind the full immutable plan to the legacy selector");
  assert.equal(integrationResult.schema_version, 2);
  assert.deepEqual(integrationResult.legacy_stage_allowlist, frozenRunPlan.archiveManifest);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(runExportTemp, "legacy.manifest.json"), "utf8")),
    integrationResult,
    "runExport must create the manifest from the same plan used by the selector",
  );
  const verifiedRunExport = verifyLocalArchive({
    artifactPath: path.join(runExportTemp, "legacy.archive.jsonl.gz"),
    manifestPath: path.join(runExportTemp, "legacy.manifest.json"),
    target: { target: "stage" },
  });
  assert.equal(verifiedRunExport.manifest.legacy_stage_allowlist.allowlist_sha256, frozenRunPlan.allowlistSha256);

  let storedBytes = null;
  let storedManifestRow = null;
  const storageCalls = [];
  const storageTarget = {
    target: "stage",
    projectRef: "krydukthwdvccggbyjfw",
    baseUrl: "https://krydukthwdvccggbyjfw.supabase.co",
    serviceKey: "local-test-service-key",
  };
  const storageFetch = async (url, init = {}) => {
    const requestUrl = new URL(url);
    const method = init.method || "GET";
    storageCalls.push({ method, path: requestUrl.pathname });
    if (requestUrl.pathname === "/storage/v1/bucket/chips-ledger-archive" && method === "GET") {
      return new Response(JSON.stringify({
        id: "chips-ledger-archive",
        name: "chips-ledger-archive",
        public: false,
        file_size_limit: 6 * 1024 * 1024,
        allowed_mime_types: ["application/gzip"],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (requestUrl.pathname.includes("/storage/v1/object/authenticated/chips-ledger-archive/") && method === "GET") {
      if (!storedBytes) return new Response(JSON.stringify({ message: "not found" }), { status: 400 });
      return new Response(storedBytes, { status: 200, headers: { "content-type": "application/gzip" } });
    }
    if (requestUrl.pathname.includes("/storage/v1/object/chips-ledger-archive/") && method === "POST") {
      assert.equal(new Headers(init.headers).get("x-upsert"), "false");
      if (storedBytes) return new Response(JSON.stringify({ message: "Asset Already Exists" }), { status: 400 });
      storedBytes = Buffer.from(init.body);
      return new Response(JSON.stringify({ Key: requestUrl.pathname }), { status: 200 });
    }
    return new Response(JSON.stringify({ message: "unexpected fake request" }), { status: 500 });
  };
  const manifestStore = {
    async get() { return storedManifestRow; },
    async insertPending(row) { storedManifestRow = { ...row }; },
    async markCommitted() {
      storedManifestRow = { ...storedManifestRow, status: "committed" };
      return storedManifestRow;
    },
  };
  const storedRunExport = await storeArchive({
    argv: [
      "--target", "stage",
      "--artifact", path.join(runExportTemp, "legacy.archive.jsonl.gz"),
      "--manifest", path.join(runExportTemp, "legacy.manifest.json"),
    ],
    cwd: runExportTemp,
    deps: { storageTarget, fetch: storageFetch, manifestStore, emit: false },
  });
  assert.equal(storedRunExport.manifest.status, "committed");
  assert.equal(storedRunExport.object.uploaded, true);
  assert.equal(storedRunExport.local.manifest.legacy_stage_allowlist.allowlist_sha256, frozenRunPlan.allowlistSha256);
  assert.equal(storageCalls.some(({ method, path: requestPath }) => method === "POST" && requestPath.includes("/object/chips-ledger-archive/")), true);

  const validRunManifest = JSON.parse(fs.readFileSync(path.join(runExportTemp, "legacy.manifest.json"), "utf8"));
  const manifestTamperCases = [
    ["proof_basis", (legacy) => { delete legacy.proof_basis; }],
    ["allowlist_sha256", (legacy) => { legacy.allowlist_sha256 = "0".repeat(64); }],
    ["batch_table_ids_sha256", (legacy) => { legacy.batch_table_ids_sha256 = "0".repeat(64); }],
    ["query_sha256", (legacy) => { legacy.query_sha256 = "0".repeat(64); }],
    ["generator_sha256", (legacy) => { legacy.generator_sha256 = "0".repeat(64); }],
    ["source_run", (legacy) => { legacy.source_run = "tampered"; }],
    ["stage_system_identifier", (legacy) => { legacy.stage_system_identifier = "0"; }],
    ["master_table_count", (legacy) => { delete legacy.master_table_count; }],
    ["master_manifest_sha256", (legacy) => { legacy.master_manifest_sha256 = "0".repeat(64); }],
    ["batch_manifest_sha256", (legacy) => { legacy.batch_manifest_sha256 = "0".repeat(64); }],
    ["freeze_run_id", (legacy) => { delete legacy.freeze_run_id; }],
    ["diagnostic_source_run", (legacy) => { legacy.diagnostic_source_run = "tampered"; }],
    ["diagnostic_source_run_sha256", (legacy) => { legacy.diagnostic_source_run_sha256 = "0".repeat(64); }],
    ["master_table_ids_count", (legacy) => { legacy.master_table_ids.pop(); }],
    ["master_table_ids_uuid", (legacy) => { legacy.master_table_ids[0] = "not-a-uuid"; }],
    ["master_table_ids_hash", (legacy) => { legacy.master_table_ids[0] = "00000000-0000-4000-8000-000000000000"; }],
    ["batch_number", (legacy) => { legacy.batch_number = 2; }],
    ["batch_table_count", (legacy) => { legacy.batch_table_count = 9; }],
    ["batch_table_ids_count", (legacy) => { legacy.batch_table_ids.pop(); }],
    ["batch_table_ids_uuid", (legacy) => { legacy.batch_table_ids[0] = "not-a-uuid"; }],
    ["batch_table_ids_membership", (legacy) => { legacy.batch_table_ids[0] = "00000000-0000-4000-8000-000000000000"; }],
    ["batch_table_ids_hash", (legacy) => { legacy.batch_table_ids[9] = legacy.master_table_ids[10]; }],
  ];
  for (const [code, mutate] of manifestTamperCases) {
    const mutatedManifest = JSON.parse(JSON.stringify(validRunManifest));
    mutate(mutatedManifest.legacy_stage_allowlist);
    fs.writeFileSync(path.join(runExportTemp, "legacy.manifest.json"), `${JSON.stringify(mutatedManifest)}\n`, { mode: 0o600 });
    assert.throws(
      () => verifyLocalArchive({
        artifactPath: path.join(runExportTemp, "legacy.archive.jsonl.gz"),
        manifestPath: path.join(runExportTemp, "legacy.manifest.json"),
        target: { target: "stage" },
      }),
      new RegExp(`legacy Stage allowlist manifest evidence is incomplete: ${code}`),
      `manifest tamper must fail closed with ${code}`,
    );
    fs.writeFileSync(path.join(runExportTemp, "legacy.manifest.json"), `${JSON.stringify(validRunManifest)}\n`, { mode: 0o600 });
  }
  const cutoffTamperedManifest = JSON.parse(JSON.stringify(validRunManifest));
  cutoffTamperedManifest.cutoff.created_at = "2026-08-17T16:51:28.075Z";
  fs.writeFileSync(path.join(runExportTemp, "legacy.manifest.json"), `${JSON.stringify(cutoffTamperedManifest)}\n`, { mode: 0o600 });
  assert.throws(
    () => verifyLocalArchive({
      artifactPath: path.join(runExportTemp, "legacy.archive.jsonl.gz"),
      manifestPath: path.join(runExportTemp, "legacy.manifest.json"),
      target: { target: "stage" },
    }),
    /legacy Stage allowlist manifest evidence is incomplete: cutoff/,
    "root cutoff tamper must fail closed",
  );
  fs.writeFileSync(path.join(runExportTemp, "legacy.manifest.json"), `${JSON.stringify(validRunManifest)}\n`, { mode: 0o600 });

  const missingPlanSql = {
    async begin() {
      throw new Error("missing plan must fail before opening the snapshot transaction");
    },
  };
  await assert.rejects(
    () => runExport({
      argv: ["--target", "stage", "--cutoff", frozenRunPlan.cutoff, "--output", "missing.archive.gz"],
      env: integrationEnv,
      cwd: runExportTemp,
      deps: {
        sql: missingPlanSql,
        selector: "legacy-stage-allowlist-v1",
        schemaVersion: 2,
        sourcePolicyId: LEGACY_STAGE_ALLOWLIST_POLICY_ID,
        targetOptions: { singleTarget: true },
        emit: false,
      },
    }),
    /requires an immutable plan/,
  );

  const substitutedPlan = {
    ...frozenRunPlan,
    batchTableIds: ["00000000-0000-4000-8000-000000000000", ...frozenRunPlan.batchTableIds.slice(1)],
  };
  await assert.rejects(
    () => runExport({
      argv: ["--target", "stage", "--cutoff", frozenRunPlan.cutoff, "--output", "substituted.archive.gz"],
      env: integrationEnv,
      cwd: runExportTemp,
      deps: {
        sql: missingPlanSql,
        selector: "legacy-stage-allowlist-v1",
        schemaVersion: 2,
        sourcePolicyId: LEGACY_STAGE_ALLOWLIST_POLICY_ID,
        legacyStageAllowlistPlan: substitutedPlan,
        targetOptions: { singleTarget: true },
        emit: false,
      },
    }),
    /hash or count binding|not bound to the immutable legacy plan|immutable plan evidence/i,
  );
} finally {
  fs.rmSync(runExportTemp, { recursive: true, force: true });
}

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

const checkedInFrozen = loadFrozenLegacyAllowlist({ cwd: process.cwd() });
assert.equal(checkedInFrozen.masterManifest.freeze_run_id, "32771521144");
assert.equal(checkedInFrozen.masterManifest.generator_sha256, legacyAllowlistQuerySha256());
assert.equal(checkedInFrozen.masterManifest.diagnostic_source_run_sha256, LEGACY_STAGE_ALLOWLIST_DIAGNOSTIC_SOURCE_RUN_SHA256);
assert.equal(checkedInFrozen.masterManifest.allowlist_sha256, "611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05");
assert.equal(checkedInFrozen.masterManifest.table_count, LEGACY_STAGE_ALLOWLIST_TABLE_COUNT);

const mutatedIds = [...checkedInFrozen.masterTableIds];
mutatedIds[mutatedIds.length - 1] = "ffffffff-ffff-4fff-8fff-ffffffffffff";
assert.throws(
  () => validateFrozenLegacyAllowlistArtifacts({
    masterIds: mutatedIds,
    masterManifest: checkedInFrozen.masterManifest,
    batchIds: checkedInFrozen.batchTableIds,
    batchManifest: checkedInFrozen.batchManifest,
  }),
  /master manifest evidence|does not match the UUID file/i,
  "runner must reject a one-UUID replacement even when the count remains 974",
);

const freezeTemp = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-allowlist-freeze-test-"));
try {
  let readAllowlistCalls = 0;
  const freezeEnv = {
    SUPABASE_STAGE_DB_URL: "postgresql://postgres.krydukthwdvccggbyjfw:secret@db.krydukthwdvccggbyjfw.supabase.co:5432/postgres",
    SUPABASE_STAGE_URL: "https://krydukthwdvccggbyjfw.supabase.co",
    SUPABASE_STAGE_SERVICE_ROLE_KEY: "test-service-role",
    DEPLOYED_COMMIT_SHA: "a".repeat(40),
    FREEZE_RUN_ID: "32770000002",
    FREEZE_OUTPUT_DIR: freezeTemp,
  };
  const freezeResult = await runLegacyStageAllowlistFreeze({
    env: freezeEnv,
    deps: {
      sql: {},
      preflight: async () => ({ readOnly: true, fenceActive: true, enforcementActive: true }),
      readAllowlist: async (_sql, options) => {
        readAllowlistCalls += 1;
        assert.equal(options.freezeRunId, "32770000002");
        assert.equal(options.diagnosticSourceRunSha256, LEGACY_STAGE_ALLOWLIST_DIAGNOSTIC_SOURCE_RUN_SHA256);
        const runMaster = buildLegacyMasterManifest({
          tableIds: ids,
          freezeRunId: options.freezeRunId,
          diagnosticSourceRun: options.diagnosticSourceRun,
          diagnosticSourceRunSha256: options.diagnosticSourceRunSha256,
        });
        const runBatch = buildLegacyBatchManifest(runMaster, { batchNumber: 1 });
        return { masterManifest: runMaster, batchManifest: runBatch };
      },
    },
  });
  assert.equal(readAllowlistCalls, 1, "freeze must execute the generator exactly once");
  assert.equal(freezeResult.readOnly, true);
  assert.equal(freezeResult.databaseWrites, false);
  assert.equal(freezeResult.archiveWrites, false);
  assert.equal(freezeResult.proofWrites, false);
  assert.deepEqual(
    fs.readdirSync(freezeTemp).sort(),
    [
      "legacy-stage-allowlist-v1.batch-001.ids",
      "legacy-stage-allowlist-v1.batch-001.manifest.json",
      "legacy-stage-allowlist-v1.master.ids",
      "legacy-stage-allowlist-v1.master.manifest.json",
    ],
  );
} finally {
  fs.rmSync(freezeTemp, { recursive: true, force: true });
}

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
assert.match(freezeMigration, /chips_assert_legacy_stage_allowlist_master_hash/);
assert.match(freezeMigration, /611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05/);
assert.match(freezeMigration, /P8936/);
assert.match(freezeMigration, /chips_ledger_archive_batches_legacy_master_allowlist_sha256_check/);
assert.match(freezeMigration, /chips_legacy_stage_allowlist_proofs_master_allowlist_sha256_check/);

assert.equal(checkedInFrozen.masterManifest.diagnostic_source_run, "32753223679");
assert.equal(
  checkedInFrozen.masterManifest.diagnostic_source_run_sha256,
  "aa82076e7e4d7fd1e027889be94868e5662652cc29ae2dc7b55a4196b260ed0e",
);

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

assert.match(freezeWorkflow, /^on:\n\s+workflow_dispatch:/m);
assert.doesNotMatch(freezeWorkflow, /^\s+- cron:/m);
assert.match(freezeWorkflow, /CHIPS_LEDGER_STAGE_AUTOMATION_ENABLED == '1'/);
assert.match(freezeWorkflow, /FREEZE_RUN_ID: \$\{\{ github\.run_id \}\}/);
assert.match(freezeWorkflow, /FREEZE_OUTPUT_DIR/);
assert.match(freezeWorkflow, /chips-ledger-legacy-stage-allowlist-freeze\.mjs/);
assert.match(freezeWorkflow, /actions\/upload-artifact@v4/);
assert.doesNotMatch(freezeWorkflow, /--prepare-only|--execute|CHIPS_LEDGER_BOT_ONLY_EXECUTE|SUPABASE_PROD_|PRODUCTION/);

const runnerSource = fs.readFileSync("scripts/ops/chips-ledger-legacy-stage-allowlist.mjs", "utf8");
const prepareStart = runnerSource.indexOf("export async function runLegacyStagePrepareOnly");
assert.ok(prepareStart >= 0, "prepare runner must be present");
assert.match(runnerSource.slice(prepareStart), /loadFrozenLegacyAllowlist/);
assert.doesNotMatch(runnerSource.slice(prepareStart), /readLegacyAllowlist\(/);
assert.match(runnerSource.slice(prepareStart), /legacyStageAllowlistPlan: plan/);
assert.doesNotMatch(runnerSource.slice(prepareStart), /legacyStageAllowlist: plan\.archiveManifest/);
assert.match(LEGACY_STAGE_ALLOWLIST_REPO_RELATIVE_DIR, /^data\/chips-ledger\/legacy-stage-allowlist-v1$/);

process.stdout.write("chips-ledger-legacy-stage-allowlist contract passed\n");
