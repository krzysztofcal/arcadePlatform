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
  assertLegacyStageAllowlistEvidence,
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
import { runLegacyStageAllowlistExecute } from "../../scripts/ops/chips-ledger-legacy-stage-allowlist-execute.mjs";
import { LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13 } from "../../scripts/ops/chips-ledger-legacy-stage-allowlist-audit.mjs";
import { runLegacyStagePrepareOnly } from "../../scripts/ops/chips-ledger-legacy-stage-allowlist.mjs";
import { buildPruneEvidence } from "../../scripts/ops/chips-ledger-archive-prune.mjs";
import { storeArchive, verifyArchiveBytes, verifyLocalArchive } from "../../scripts/ops/chips-ledger-archive-store.mjs";

const migrationPath = "supabase/migrations/20260824120000_chips_ledger_legacy_stage_allowlist.sql";
const freezeMigrationPath = "supabase/migrations/20260824140000_chips_ledger_legacy_stage_allowlist_freeze_guard.sql";
const cleanupMigrationPath = "supabase/migrations/20260825100000_chips_ledger_legacy_stage_allowlist_cleanup_hardening.sql";
const lifecycleCompletionMigrationPath = "supabase/migrations/20260831120000_chips_ledger_legacy_stage_lifecycle_completion.sql";
const normalRetentionHardeningMigrationPath = "supabase/migrations/20260819220000_chips_ledger_bot_only_retention_hardening.sql";
const workflowPath = ".github/workflows/chips-ledger-stage-legacy-allowlist.yml";
const freezeWorkflowPath = ".github/workflows/chips-ledger-stage-legacy-allowlist-freeze.yml";
const migration = fs.readFileSync(migrationPath, "utf8");
const freezeMigration = fs.readFileSync(freezeMigrationPath, "utf8");
const cleanupMigration = fs.readFileSync(cleanupMigrationPath, "utf8");
const lifecycleCompletionMigration = fs.readFileSync(lifecycleCompletionMigrationPath, "utf8");
const normalRetentionHardeningMigration = fs.readFileSync(normalRetentionHardeningMigrationPath, "utf8");
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
  expectedLegacyStageAllowlistEvidence: plan.archiveManifest,
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
    expectedLegacyStageAllowlistEvidence: frozenRunPlan.archiveManifest,
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
    deps: {
      storageTarget,
      fetch: storageFetch,
      manifestStore,
      legacyStageAllowlistPlan: frozenRunPlan,
      emit: false,
    },
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
        expectedLegacyStageAllowlistEvidence: frozenRunPlan.archiveManifest,
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
      expectedLegacyStageAllowlistEvidence: frozenRunPlan.archiveManifest,
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

const runnerEnv = {
  SUPABASE_STAGE_DB_URL: "postgresql://postgres.krydukthwdvccggbyjfw:test@db.krydukthwdvccggbyjfw.supabase.co:5432/postgres",
  SUPABASE_STAGE_URL: "https://krydukthwdvccggbyjfw.supabase.co",
  SUPABASE_STAGE_SERVICE_ROLE_KEY: "runner-test-service-key",
  DEPLOYED_COMMIT_SHA: "a".repeat(40),
};

const runnerStorageTarget = {
  target: "stage",
  projectRef: "krydukthwdvccggbyjfw",
  baseUrl: "https://krydukthwdvccggbyjfw.supabase.co",
  serviceKey: "runner-test-service-key",
};

function makeLegacyRunnerAdapters() {
  const storageObjects = new Map();
  const storageCalls = [];
  let storedManifestRow = null;
  let manifestInsertCalls = 0;
  let proofCalls = 0;
  let planUploadCalls = 0;
  let executeCleanupCalls = 0;

  async function executeSql(query) {
    if (/^\s*set transaction isolation level repeatable read, read only;/i.test(query)) return [];
    if (/pg_control_system/i.test(query)) return [{ system_identifier: "7656985631720456337" }];
    if (/chips_table_fence_is_active/i.test(query)) return [{ active: true }];
    if (/chips_table_fence_control/i.test(query)) return [{ enforcement_active: true }];
    if (query === LEGACY_STAGE_ALLOWLIST_CANDIDATE_SQL) return fixtureCandidates;
    if (/from public\.chips_entries/i.test(query)) return fixtureEntries;
    throw new Error(`unexpected runner SQL: ${query.slice(0, 80)}`);
  }

  const sql = {
    typed: (value, type) => ({ value, type }),
    async begin(callback) {
      return callback({ unsafe: executeSql });
    },
    async unsafe(query) {
      if (/pg_try_advisory_lock/i.test(query)) return [{ backend_pid: "7001", acquired: true }];
      if (/pg_backend_pid/i.test(query)) return [{ backend_pid: "7001" }];
      if (/pg_advisory_unlock/i.test(query)) return [{ unlocked: true }];
      return executeSql(query);
    },
  };

  function objectPathFromRequest(pathname, prefix) {
    return decodeURIComponent(pathname.slice(prefix.length));
  }

  const fetch = async (url, init = {}) => {
    const requestUrl = new URL(url);
    const method = init.method || "GET";
    const pathname = requestUrl.pathname;
    storageCalls.push({ method, kind: pathname.includes("/bucket/") ? "bucket" : "object" });
    if (pathname === "/storage/v1/bucket/chips-ledger-archive" && method === "GET") {
      return new Response(JSON.stringify({
        id: "chips-ledger-archive",
        name: "chips-ledger-archive",
        public: false,
        file_size_limit: 6 * 1024 * 1024,
        allowed_mime_types: ["application/gzip"],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const downloadPrefix = "/storage/v1/object/authenticated/chips-ledger-archive/";
    const uploadPrefix = "/storage/v1/object/chips-ledger-archive/";
    if (pathname.startsWith(downloadPrefix) && method === "GET") {
      const objectPath = objectPathFromRequest(pathname, downloadPrefix);
      const bytes = storageObjects.get(objectPath);
      if (!bytes) return new Response(JSON.stringify({ message: "not found" }), { status: 400 });
      return new Response(bytes, { status: 200, headers: { "content-type": "application/gzip" } });
    }
    if (pathname.startsWith(uploadPrefix) && method === "POST") {
      const objectPath = objectPathFromRequest(pathname, uploadPrefix);
      if (storageObjects.has(objectPath)) return new Response(JSON.stringify({ message: "Asset Already Exists" }), { status: 400 });
      storageObjects.set(objectPath, Buffer.from(init.body));
      return new Response(JSON.stringify({ Key: objectPath }), { status: 200 });
    }
    throw new Error(`unexpected runner Storage request: ${method} ${pathname}`);
  };

  const manifestStore = {
    async get() { return storedManifestRow; },
    async insertPending(row) {
      manifestInsertCalls += 1;
      storedManifestRow = { ...row, batch_id: "9001" };
    },
    async markCommitted() {
      storedManifestRow = {
        ...storedManifestRow,
        status: "committed",
        committed_at: "2026-08-24T00:00:00.000000Z",
      };
      return storedManifestRow;
    },
  };

  const pruneStore = {
    async getIdentity() { return "7656985631720456337"; },
    async getManifest() {
      return storedManifestRow
        ? {
          ...storedManifestRow,
          format_version: Number(storedManifestRow.format_version),
          transaction_count: Number(storedManifestRow.transaction_count),
          entry_count: Number(storedManifestRow.entry_count),
          raw_bytes: Number(storedManifestRow.raw_bytes),
          compressed_bytes: Number(storedManifestRow.compressed_bytes),
        }
        : null;
    },
    async registerLegacyStageAllowlistProof() {
      proofCalls += 1;
      storedManifestRow = {
        ...storedManifestRow,
        archive_proof_verified_at: "2026-08-24T00:01:00.000000Z",
        archived_transaction_ids_sha256: fixtureEvidence.transactionIdsSha256,
        archived_entry_ids_sha256: fixtureEvidence.entryIdsSha256,
      };
      return { state: "proof_registered" };
    },
    async cleanupLegacyStageAllowlist(_objectPath, evidence, execute, approvedBatchId) {
      if (!execute) return { state: "ready" };
      executeCleanupCalls += 1;
      assert.equal(approvedBatchId, "9001");
      storedManifestRow = {
        ...storedManifestRow,
        pruned_at: "2026-08-24T00:02:00.000000Z",
        pruned_transaction_count: String(evidence.transactionCount),
        pruned_entry_count: String(evidence.entryCount),
        pruned_transaction_ids_sha256: evidence.transactionIdsSha256,
        pruned_entry_ids_sha256: evidence.entryIdsSha256,
        registry_cleaned_at: "2026-08-24T00:02:00.000000Z",
        registry_cleaned_key_count: String(evidence.registryKeys.length),
        registry_cleaned_keys_sha256: evidence.registryKeysSha256,
      };
      return {
        state: executeCleanupCalls === 1 ? "pruned" : "already_pruned",
        registry_keys: evidence.registryKeys.length,
        registry_keys_sha256: evidence.registryKeysSha256,
        remaining_registry_count: 0,
      };
    },
    async verifyCommitted(_row, evidence) {
      return {
        pruned_at: "2026-08-24T00:02:00.000000Z",
        pruned_transaction_count: String(evidence.transactionCount),
        pruned_entry_count: String(evidence.entryCount),
        pruned_transaction_ids_sha256: evidence.transactionIdsSha256,
        pruned_entry_ids_sha256: evidence.entryIdsSha256,
        registry_cleaned_at: "2026-08-24T00:02:00.000000Z",
        registry_cleaned_key_count: String(evidence.registryKeys.length),
        registry_cleaned_keys_sha256: evidence.registryKeysSha256,
        mapping_count: "0",
        extra_mapping_count: "0",
        remaining_mapping_count: "0",
        hot_transaction_count: "0",
        hot_entry_count: "0",
      };
    },
  };

  return {
    sql,
    fetch,
    manifestStore,
    pruneStore,
    storageObjects,
    storageCalls,
    get manifestInsertCalls() { return manifestInsertCalls; },
    get proofCalls() { return proofCalls; },
    get planUploadCalls() { return planUploadCalls; },
    get executeCleanupCalls() { return executeCleanupCalls; },
    incrementPlanUploadCalls() { planUploadCalls += 1; },
  };
}

async function runRealLegacyRunnerContract(mutateManifest = null) {
  const adapters = makeLegacyRunnerAdapters();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-stage-runner-contract-"));
  let exportedManifest = null;
  let storedLocal = null;
  let result = null;
  let error = null;
  try {
    result = await runLegacyStagePrepareOnly({
      env: runnerEnv,
      cwd: process.cwd(),
      deps: {
        sql: adapters.sql,
        tempRoot,
        storageTarget: runnerStorageTarget,
        verifyBucket: async () => {},
        fetch: adapters.fetch,
        manifestStore: adapters.manifestStore,
        pruneStore: adapters.pruneStore,
        uploadPlan: async ({ objectPath }) => {
          adapters.incrementPlanUploadCalls();
          return { objectPath };
        },
        exportArchive: async (options) => {
          exportedManifest = await runExport(options);
          if (mutateManifest) {
            const manifestPath = options.argv.at(-1);
            const mutated = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            mutateManifest(mutated.legacy_stage_allowlist);
            fs.writeFileSync(manifestPath, `${JSON.stringify(mutated)}\n`, { mode: 0o600 });
          }
          return exportedManifest;
        },
        storeArchive: async (options) => {
          const stored = await storeArchive(options);
          storedLocal = stored.local;
          return stored;
        },
        downloadArchive: async (_storageTarget, objectPath) => ({
          bytes: adapters.storageObjects.get(objectPath),
          downloadMs: 1,
        }),
        emit: false,
      },
    });
  } catch (caught) {
    error = caught;
  }
  return {
    adapters,
    tempRoot,
    exportedManifest,
    storedLocal,
    result,
    error,
  };
}

const validRunnerContract = await runRealLegacyRunnerContract();
try {
  assert.equal(validRunnerContract.error, null);
  assert.equal(validRunnerContract.result.state, "prepared");
  assert.equal(validRunnerContract.exportedManifest.legacy_stage_allowlist.proof_basis, LEGACY_STAGE_ALLOWLIST_POLICY_ID);
  const runnerManifestPath = path.join(validRunnerContract.tempRoot, "legacy-stage-batch-001.archive.manifest.json");
  const runnerFileManifest = JSON.parse(fs.readFileSync(runnerManifestPath, "utf8"));
  assert.equal(runnerFileManifest.legacy_stage_allowlist.proof_basis, LEGACY_STAGE_ALLOWLIST_POLICY_ID);
  assert.equal(validRunnerContract.storedLocal.manifest.legacy_stage_allowlist.proof_basis, LEGACY_STAGE_ALLOWLIST_POLICY_ID);
  assertLegacyStageAllowlistEvidence(validRunnerContract.exportedManifest.legacy_stage_allowlist, plan.archiveManifest);
  assertLegacyStageAllowlistEvidence(runnerFileManifest.legacy_stage_allowlist, plan.archiveManifest);
  assertLegacyStageAllowlistEvidence(validRunnerContract.storedLocal.manifest.legacy_stage_allowlist, plan.archiveManifest);
  assert.equal(validRunnerContract.adapters.manifestInsertCalls, 1);
  assert.equal(validRunnerContract.adapters.proofCalls, 1);
  assert.match(
    validRunnerContract.result.humanGo.executeAfterAuthorization,
    /^CHIPS_LEDGER_LEGACY_STAGE_ALLOWLIST_EXECUTE=1 node scripts\/ops\/chips-ledger-legacy-stage-allowlist-execute\.mjs --batch-id <exact batch_id> --object-path <exact object_path> --confirm-sha <exact compressed_sha256> --recovery-dir <private dir>$/,
  );
} finally {
  fs.rmSync(validRunnerContract.tempRoot, { recursive: true, force: true });
}

const executeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-stage-execute-contract-"));
const executeRecoveryDir = path.join(executeRoot, "recovery");
const executeEnv = {
  ...runnerEnv,
  CHIPS_LEDGER_LEGACY_STAGE_ALLOWLIST_EXECUTE: "1",
};
const executeArgs = [
  "--batch-id", LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.batchId,
  "--object-path", LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.objectPath,
  "--confirm-sha", LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.compressedSha256,
  "--recovery-dir", executeRecoveryDir,
];
try {
  await assert.rejects(
    () => runLegacyStageAllowlistExecute({
      argv: executeArgs,
      env: runnerEnv,
      cwd: process.cwd(),
      deps: { storageTarget: runnerStorageTarget },
    }),
    /CHIPS_LEDGER_LEGACY_STAGE_ALLOWLIST_EXECUTE=1 is required/,
    "execution runner must remain hard-gated",
  );
  await assert.rejects(
    () => runLegacyStageAllowlistExecute({
      argv: [
        "--batch-id", LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.batchId,
        "--object-path", `${LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.objectPath}.tampered`,
        "--confirm-sha", LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.compressedSha256,
        "--recovery-dir", executeRecoveryDir,
      ],
      env: executeEnv,
      cwd: process.cwd(),
      deps: { storageTarget: runnerStorageTarget },
    }),
    /--object-path does not match --confirm-sha/,
    "execution runner must reject an object path that is not bound to the supplied archive hash",
  );
  await assert.rejects(
    () => runLegacyStageAllowlistExecute({
      argv: [
        "--batch-id", "12",
        "--object-path", LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.objectPath,
        "--confirm-sha", LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.compressedSha256,
        "--recovery-dir", executeRecoveryDir,
      ],
      env: executeEnv,
      cwd: process.cwd(),
      deps: { storageTarget: runnerStorageTarget },
    }),
    /approved batch 13/,
    "execution runner must reject every batch other than hardcoded batch 13",
  );

  const executeEvidence = {
    transactionIds: Array.from({ length: 60 }, (_, index) => tableId(0xd400 + index)),
    entryIds: Array.from({ length: 120 }, (_, index) => String(5000 + index)),
    registryKeys: Array.from({ length: 60 }, (_, index) => `legacy-batch-13-key-${String(index).padStart(2, "0")}`),
    legacyTableIds: plan.batchTableIds,
    transactionCount: 60,
    entryCount: 120,
    transactionIdsSha256: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.txIdsSha256,
    entryIdsSha256: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.entryIdsSha256,
    registryKeysSha256: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.registryKeysSha256,
    legacyAllowlistSha256: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.masterAllowlistSha256,
    legacyBatchTableIdsSha256: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.batchTableIdsSha256,
  };
  const replayPair = {
    idempotencyKey: executeEvidence.registryKeys[17],
    tableId: plan.batchTableIds[4],
    transactionId: executeEvidence.transactionIds[17],
  };
  const escrowAccountIds = Array.from({ length: 10 }, (_, index) => tableId(0xe001 + index));
  executeEvidence.replayPairs = [replayPair];
  executeEvidence.replayPair = replayPair;
  const beforeExecuteSnapshot = {
    accountIds: escrowAccountIds,
    accountScope: "ESCROW_TABLES",
    transactionCount: 60,
    entryCount: 120,
    registryCount: 60,
    balances: { accountCount: 20, total: "1000000", sha256: "1".repeat(64) },
    nextEntrySeq: { total: "240", sha256: "2".repeat(64) },
    conservation: { entryCount: 120, entrySum: "0" },
  };
  const afterExecuteSnapshot = {
    ...beforeExecuteSnapshot,
    transactionCount: 0,
    entryCount: 0,
    registryCount: 0,
  };
  let pruneCalls = 0;
  let snapshotCalls = 0;
  const lifecycle = [];
  const executeDeps = {
    storageTarget: runnerStorageTarget,
    pruneStore: validRunnerContract.adapters.pruneStore,
    preflight: async () => {
      lifecycle.push("preflight");
      return {
        projectRef: "krydukthwdvccggbyjfw",
        systemIdentifier: "7656985631720456337",
        fenceActive: true,
        enforcementActive: true,
        readOnly: true,
        destructiveGoAt: null,
        destructiveGoBatchId: null,
        escrowAccountIds,
        replayPair,
        replayTransactionIdCollision: false,
      };
    },
    verifyBucket: async () => {},
    downloadArchive: async (_storageTarget, objectPath) => ({
      bytes: validRunnerContract.adapters.storageObjects.get(objectPath),
      downloadMs: 1,
    }),
    authorize: async () => {
      lifecycle.push("authorize");
      return {
        result: { state: "authorized", batch_id: "13" },
        destructiveGoAt: "2026-08-25T00:00:00.000000Z",
        destructiveGoBatchId: "13",
      };
    },
    readExecutionSnapshot: async () => {
      lifecycle.push("snapshot");
      snapshotCalls += 1;
      return snapshotCalls === 1 ? beforeExecuteSnapshot : afterExecuteSnapshot;
    },
    pruneArchive: async (pruneArgs) => {
      lifecycle.push("prune");
      pruneCalls += 1;
      await pruneArgs.deps.beforeCleanup({ evidence: executeEvidence });
      return {
        state: pruneCalls === 1 ? "pruned" : "already_pruned",
        mode: "execute",
        evidence: executeEvidence,
        recoveryBundle: {
          artifactPath: executeRecoveryDir,
          manifestPath: `${executeRecoveryDir}/manifest.json`,
          reused: pruneCalls > 1,
        },
      };
    },
    verifyPostExecute: async (_sql, _plan, before, evidence) => {
      lifecycle.push("post-verify");
      assert.deepEqual(before, beforeExecuteSnapshot);
      assert.deepEqual(evidence, executeEvidence);
      return {
        state: "verified",
        snapshot: afterExecuteSnapshot,
        receipt: {
          prunedAt: "2026-08-25T00:01:00.000000Z",
          registryCleanedAt: "2026-08-25T00:01:00.000000Z",
          prunedTransactionCount: 60,
          prunedEntryCount: 120,
          registryCleanedKeyCount: 60,
          remainingRegistryCount: 0,
          transactionIdsSha256: executeEvidence.transactionIdsSha256,
          entryIdsSha256: executeEvidence.entryIdsSha256,
          registryKeysSha256: executeEvidence.registryKeysSha256,
        },
      };
    },
    replayOldRegistryKey: async (_sql, evidence, before, pair) => {
      lifecycle.push("replay");
      assert.equal(evidence, executeEvidence);
      assert.equal(before, beforeExecuteSnapshot);
      assert.deepEqual(pair, replayPair);
      return { rejected: true, sqlstate: "P8903" };
    },
  };
  await assert.rejects(
    () => runLegacyStageAllowlistExecute({
      argv: executeArgs,
      env: executeEnv,
      cwd: process.cwd(),
      deps: {
        ...executeDeps,
        preflight: async () => ({
          projectRef: "krydukthwdvccggbyjfw",
          systemIdentifier: "7656985631720456337",
          fenceActive: false,
          enforcementActive: false,
          readOnly: true,
        }),
      },
    }),
    /active TABLE fence/i,
    "execution runner must fail closed before entering the pruner when the TABLE fence is inactive",
  );
  assert.equal(validRunnerContract.adapters.executeCleanupCalls, 0);
  for (const invalidGo of [
    { destructiveGoAt: "2026-08-25T00:00:00.000000Z", destructiveGoBatchId: null },
    { destructiveGoAt: "2026-08-25T00:00:00.000000Z", destructiveGoBatchId: "12" },
  ]) {
    await assert.rejects(
      () => runLegacyStageAllowlistExecute({
        argv: executeArgs,
        env: executeEnv,
        cwd: process.cwd(),
        deps: {
          ...executeDeps,
          preflight: async () => ({
            projectRef: "krydukthwdvccggbyjfw",
            systemIdentifier: "7656985631720456337",
            fenceActive: true,
            enforcementActive: true,
            readOnly: true,
            ...invalidGo,
            replayPair,
            replayTransactionIdCollision: false,
          }),
        },
      }),
      /partial or not bound to batch 13/i,
      "partial or foreign GO must fail closed before authorization",
    );
  }
  const firstExecute = await runLegacyStageAllowlistExecute({
    argv: executeArgs,
    env: executeEnv,
    cwd: process.cwd(),
    deps: executeDeps,
  });
  assert.equal(firstExecute.state, "pruned");
  assert.equal(firstExecute.mode, "execute");
  assert.equal(firstExecute.batchId, LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.batchId);
  assert.equal(firstExecute.objectPath, LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.objectPath);
  assert.equal(firstExecute.compressedSha256, LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.compressedSha256);
  assert.equal(firstExecute.allowlistSha256, plan.allowlistSha256);
  assert.equal(firstExecute.preflight.fenceActive, true);
  assert.equal(firstExecute.preflight.enforcementActive, true);
  assert.equal(firstExecute.transactions, 60);
  assert.equal(firstExecute.entries, 120);
  assert.deepEqual(firstExecute.proof, {
    transactionIdsSha256: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.txIdsSha256,
    entryIdsSha256: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.entryIdsSha256,
  });
  assert.equal(firstExecute.recovery.reused, false);
  assert.equal(firstExecute.authorization.destructiveGoBatchId, "13");
  assert.equal(firstExecute.postExecute.receipt.remainingRegistryCount, 0);
  assert.equal(firstExecute.retry.state, "already_pruned");
  assert.equal(firstExecute.retry.recovery.reused, true);
  assert.equal(firstExecute.replay.rejected, true);
  assert.equal(firstExecute.replay.sqlstate, "P8903");
  assert.equal(pruneCalls, 2, "execute path must perform exactly one idempotent retry");
  assert.deepEqual(lifecycle, [
    "preflight", "authorize", "snapshot", "prune", "post-verify", "prune", "snapshot", "replay",
  ]);

  const resumeBefore = {
    ...beforeExecuteSnapshot,
    unrelatedAccount: { balance: "700", nextEntrySeq: "9" },
  };
  const resumeAfter = {
    ...afterExecuteSnapshot,
    unrelatedAccount: { balance: "701", nextEntrySeq: "10" },
  };
  const goState = { destructiveGoAt: null, destructiveGoBatchId: null };
  let resumeAuthorizeCalls = 0;
  let resumePruneCalls = 0;
  let resumeSnapshotCalls = 0;
  const resumeDeps = {
    storageTarget: runnerStorageTarget,
    preflight: async () => ({
      projectRef: "krydukthwdvccggbyjfw",
      systemIdentifier: "7656985631720456337",
      fenceActive: true,
      enforcementActive: true,
      readOnly: true,
      ...goState,
      escrowAccountIds,
      replayPair,
      replayTransactionIdCollision: false,
    }),
    authorize: async () => {
      resumeAuthorizeCalls += 1;
      goState.destructiveGoAt = "2026-08-25T00:02:00.000000Z";
      goState.destructiveGoBatchId = "13";
      return {
        result: { state: "authorized", batch_id: "13" },
        destructiveGoAt: goState.destructiveGoAt,
        destructiveGoBatchId: goState.destructiveGoBatchId,
      };
    },
    readExecutionSnapshot: async () => {
      resumeSnapshotCalls += 1;
      return resumeSnapshotCalls <= 2 ? resumeBefore : resumeAfter;
    },
    pruneArchive: async (pruneArgs) => {
      resumePruneCalls += 1;
      if (resumePruneCalls === 1) throw new Error("simulated crash after authorization");
      await pruneArgs.deps.beforeCleanup({ evidence: executeEvidence });
      return {
        state: resumePruneCalls === 2 ? "pruned" : "already_pruned",
        mode: "execute",
        evidence: executeEvidence,
        recoveryBundle: { artifactPath: executeRecoveryDir, manifestPath: `${executeRecoveryDir}/manifest.json` },
      };
    },
    verifyPostExecute: async () => ({
      state: "verified",
      snapshot: resumeAfter,
      receipt: { remainingRegistryCount: 0 },
    }),
    replayOldRegistryKey: async (_sql, evidence, before, pair) => {
      assert.equal(evidence, executeEvidence);
      assert.equal(before, resumeBefore);
      assert.deepEqual(pair, replayPair);
      return { rejected: true, sqlstate: "P8903" };
    },
  };
  await assert.rejects(
    () => runLegacyStageAllowlistExecute({ argv: executeArgs, env: executeEnv, cwd: process.cwd(), deps: resumeDeps }),
    /simulated crash after authorization/,
    "a failure after authorization must leave an exact durable GO for resume",
  );
  assert.equal(resumeAuthorizeCalls, 1);
  assert.deepEqual(goState, {
    destructiveGoAt: "2026-08-25T00:02:00.000000Z",
    destructiveGoBatchId: "13",
  });
  const resumedExecute = await runLegacyStageAllowlistExecute({
    argv: executeArgs,
    env: executeEnv,
    cwd: process.cwd(),
    deps: resumeDeps,
  });
  assert.equal(resumedExecute.authorization.resumed, true, "resume must reuse the exact existing GO");
  assert.equal(resumeAuthorizeCalls, 1, "resume must not authorize a second time");
  assert.equal(resumePruneCalls, 3, "resumed execute must perform one prune and one retry");
  assert.equal(resumedExecute.replay.sqlstate, "P8903");
  assert.equal(resumeAfter.unrelatedAccount.balance, "701", "unrelated activity fixture must differ");

  const prunedSnapshot = {
    ...afterExecuteSnapshot,
    accountIds: escrowAccountIds,
    accountScope: "ESCROW_TABLES",
  };
  let prunedAuthorizeCalls = 0;
  let prunedPruneCalls = 0;
  let prunedPostVerifyCalls = 0;
  const prunedDeps = {
    storageTarget: runnerStorageTarget,
    preflight: async () => ({
      projectRef: "krydukthwdvccggbyjfw",
      systemIdentifier: "7656985631720456337",
      fenceActive: true,
      enforcementActive: true,
      readOnly: true,
      batchState: "pruned",
      destructiveGoAt: "2026-08-25T00:03:00.000000Z",
      destructiveGoBatchId: "13",
      escrowAccountIds,
      replayPair: null,
      replayTransactionIdCollision: false,
      prunedReceipt: {
        prunedAt: "2026-08-25T00:02:00.000000Z",
        registryCleanedAt: "2026-08-25T00:02:00.000000Z",
        prunedTransactionCount: 60,
        prunedEntryCount: 120,
        registryCleanedKeyCount: 60,
        transactionIdsSha256: executeEvidence.transactionIdsSha256,
        entryIdsSha256: executeEvidence.entryIdsSha256,
        registryKeysSha256: executeEvidence.registryKeysSha256,
      },
    }),
    authorize: async () => {
      prunedAuthorizeCalls += 1;
      throw new Error("complete pruned batch must not authorize again");
    },
    readExecutionSnapshot: async () => prunedSnapshot,
    pruneArchive: async (pruneArgs) => {
      prunedPruneCalls += 1;
      await pruneArgs.deps.beforeCleanup({ evidence: executeEvidence });
      return {
        state: "already_pruned",
        mode: "execute",
        evidence: executeEvidence,
        recoveryBundle: { artifactPath: executeRecoveryDir, manifestPath: `${executeRecoveryDir}/manifest.json`, reused: true },
      };
    },
    verifyPostExecute: async (_sql, _plan, before, evidence) => {
      prunedPostVerifyCalls += 1;
      assert.equal(before, prunedSnapshot);
      assert.equal(evidence, executeEvidence);
      return {
        state: "verified",
        snapshot: prunedSnapshot,
        receipt: {
          prunedAt: "2026-08-25T00:02:00.000000Z",
          registryCleanedAt: "2026-08-25T00:02:00.000000Z",
          prunedTransactionCount: 60,
          prunedEntryCount: 120,
          registryCleanedKeyCount: 60,
          remainingRegistryCount: 0,
          transactionIdsSha256: executeEvidence.transactionIdsSha256,
          entryIdsSha256: executeEvidence.entryIdsSha256,
          registryKeysSha256: executeEvidence.registryKeysSha256,
        },
      };
    },
    replayOldRegistryKey: async (_sql, evidence, before, pair) => {
      assert.equal(evidence, executeEvidence);
      assert.equal(before, prunedSnapshot);
      assert.deepEqual(pair, replayPair);
      return { rejected: true, sqlstate: "P8903" };
    },
  };
  const prunedExecute = await runLegacyStageAllowlistExecute({
    argv: executeArgs,
    env: executeEnv,
    cwd: process.cwd(),
    deps: prunedDeps,
  });
  assert.equal(prunedExecute.state, "already_pruned");
  assert.equal(prunedExecute.authorization.resumed, true);
  assert.equal(prunedAuthorizeCalls, 0);
  assert.equal(prunedPruneCalls, 2, "pruned resume must perform the retry and its idempotent retry");
  assert.equal(prunedPostVerifyCalls, 1);
  assert.equal(prunedExecute.replay.sqlstate, "P8903");

  let collisionPruneCalls = 0;
  await assert.rejects(
    () => runLegacyStageAllowlistExecute({
      argv: executeArgs,
      env: executeEnv,
      cwd: process.cwd(),
      deps: {
        ...resumeDeps,
        preflight: async () => ({
          projectRef: "krydukthwdvccggbyjfw",
          systemIdentifier: "7656985631720456337",
          fenceActive: true,
          enforcementActive: true,
          readOnly: true,
          destructiveGoAt: null,
          destructiveGoBatchId: null,
          escrowAccountIds,
          replayPair,
          replayTransactionIdCollision: true,
        }),
        pruneArchive: async () => {
          collisionPruneCalls += 1;
          return { state: "pruned", evidence: executeEvidence };
        },
      },
    }),
    /replay transaction ID collision/i,
    "a deterministic replay transaction ID collision must fail before cleanup",
  );
  assert.equal(collisionPruneCalls, 0, "replay ID collision must not enter the pruner");
} finally {
  fs.rmSync(executeRoot, { recursive: true, force: true });
}

for (const mutate of [
  (legacy) => { delete legacy.proof_basis; },
  (legacy) => { legacy.proof_basis = "tampered"; },
]) {
  const tamperedRunnerContract = await runRealLegacyRunnerContract(mutate);
  try {
    assert.match(tamperedRunnerContract.error?.message || "", /legacy Stage allowlist manifest evidence is incomplete: proof_basis/);
    assert.equal(tamperedRunnerContract.adapters.planUploadCalls, 0);
    assert.equal(tamperedRunnerContract.adapters.manifestInsertCalls, 0);
    assert.equal(tamperedRunnerContract.adapters.proofCalls, 0);
    assert.equal(tamperedRunnerContract.adapters.storageCalls.length, 0);
  } finally {
    fs.rmSync(tamperedRunnerContract.tempRoot, { recursive: true, force: true });
  }
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
assert.match(cleanupMigration, /drop function public\.chips_prune_legacy_stage_allowlist_batch/);
assert.match(cleanupMigration, /p_registry_keys text\[\]/);
assert.match(cleanupMigration, /chips_table_fence_is_active/);
assert.match(cleanupMigration, /chips_lock_table_fence_for_legacy_cleanup/);
assert.match(cleanupMigration, /P8937/);
assert.match(cleanupMigration, /chips\.legacy_stage_cleanup/);
assert.match(cleanupMigration, /chips\.bot_registry_cleanup/);
assert.match(cleanupMigration, /remaining_registry_count/);
assert.match(cleanupMigration, /source_policy_id = 'legacy_stage_allowlist_v1'/);
assert.match(freezeMigration, /chips_assert_legacy_stage_allowlist_master_hash/);
assert.match(freezeMigration, /611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05/);
assert.match(freezeMigration, /P8936/);
assert.match(freezeMigration, /chips_ledger_archive_batches_legacy_master_allowlist_sha256_check/);
assert.match(freezeMigration, /chips_legacy_stage_allowlist_proofs_master_allowlist_sha256_check/);

assert.match(lifecycleCompletionMigration, /create or replace function public\.chips_guard_poker_table_mutations/);
assert.match(lifecycleCompletionMigration, /source_policy_id = 'legacy_stage_allowlist_v1'/);
assert.match(lifecycleCompletionMigration, /batch_id = 13/);
assert.match(lifecycleCompletionMigration, /legacy_batch_number between 2 and 98/);
assert.match(lifecycleCompletionMigration, /destructive_go_confirmation = 'GO legacy-stage-allowlist-v1 remaining 2-98 '/);
assert.match(lifecycleCompletionMigration, /chips\.legacy_stage_cleanup/);
assert.match(lifecycleCompletionMigration, /chips\.bot_only_lifecycle/);
assert.match(lifecycleCompletionMigration, /chips\.legacy_registry_keys_sha256/);
assert.match(lifecycleCompletionMigration, /public\.chips_table_fence_is_active\(\)/);
assert.match(lifecycleCompletionMigration, /chips_lock_table_fence_for_legacy_cleanup/);
assert.match(lifecycleCompletionMigration, /chips_archive_uuid_ids_sha256\(proofs\.batch_table_ids\)/);
assert.match(lifecycleCompletionMigration, /create or replace function public\.chips_prune_legacy_stage_allowlist_batch/);
assert.match(lifecycleCompletionMigration, /state', 'already_pruned'/);
assert.match(lifecycleCompletionMigration, /if unmarked_table_count > 0/);
assert.match(lifecycleCompletionMigration, /where tables\.id = any\(p_batch_table_ids\)/);
assert.match(lifecycleCompletionMigration, /Legacy Stage lifecycle marker verification failed/);
assert.doesNotMatch(lifecycleCompletionMigration, /delete\s+from\s+public\.poker_tables/i);
assert.doesNotMatch(lifecycleCompletionMigration, /delete\s+from\s+public\.chips_accounts/i);
const cleanupReceiptTransitionOffset = lifecycleCompletionMigration.indexOf(
  "update public.chips_ledger_archive_batches batches\n     set registry_cleaned_at",
);
const lifecycleMarkerTransitionOffset = lifecycleCompletionMigration.indexOf(
  "update public.poker_tables tables\n     set bot_only_retention_complete_at",
);
assert.ok(cleanupReceiptTransitionOffset >= 0, "legacy cleanup must persist the registry receipt");
assert.ok(lifecycleMarkerTransitionOffset > cleanupReceiptTransitionOffset, "legacy lifecycle marker must follow the complete registry receipt");
for (const normalContract of [
  "current_setting('chips.bot_only_lifecycle', true)",
  "source_policy_id = 'stage-ledger-bot-only-retention-7d-v1'",
  "batches.archive_proof_verified_at is not null",
  "batches.registry_cleaned_at is not null",
  "registry_cleaned_keys_sha256 = batches.bot_only_registry_keys_sha256",
]) {
  assert.match(normalRetentionHardeningMigration, new RegExp(normalContract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(lifecycleCompletionMigration, new RegExp(normalContract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

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
const executeRunnerSource = fs.readFileSync("scripts/ops/chips-ledger-legacy-stage-allowlist-execute.mjs", "utf8");
const prepareStart = runnerSource.indexOf("export async function runLegacyStagePrepareOnly");
assert.ok(prepareStart >= 0, "prepare runner must be present");
assert.match(runnerSource.slice(prepareStart), /loadFrozenLegacyAllowlist/);
assert.doesNotMatch(runnerSource.slice(prepareStart), /readLegacyAllowlist\(/);
assert.match(runnerSource.slice(prepareStart), /legacyStageAllowlistPlan: plan/);
assert.doesNotMatch(runnerSource.slice(prepareStart), /legacyStageAllowlist: plan\.archiveManifest/);
assert.match(executeRunnerSource, /loadFrozenLegacyAllowlist/);
assert.match(executeRunnerSource, /legacyStageAllowlistPlan: plan/);
assert.match(executeRunnerSource, /--approved-batch-id/);
assert.match(executeRunnerSource, /--object-path does not match --confirm-sha/);
assert.match(executeRunnerSource, /CHIPS_LEDGER_LEGACY_STAGE_ALLOWLIST_EXECUTE/);
assert.match(LEGACY_STAGE_ALLOWLIST_REPO_RELATIVE_DIR, /^data\/chips-ledger\/legacy-stage-allowlist-v1$/);

process.stdout.write("chips-ledger-legacy-stage-allowlist contract passed\n");
