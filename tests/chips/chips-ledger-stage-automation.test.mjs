import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  BOT_ONLY_EXPORT_SCHEMA_VERSION,
  BOT_ONLY_RETENTION_POLICY_ID,
  CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID,
  readSnapshot,
  STAGE_AUTOMATION_POLICY_ID,
  stringifyJson,
} from "../../scripts/ops/chips-ledger-archive-export.mjs";
import {
  acquireInitialAutomaticLock,
  assertBotOnlyActiveManifestMatch,
  assertBotOnlyExecuteBatch,
  assertClosedHumanAutomaticPolicy,
  assertClosedHumanActiveManifestMatch,
  assertClosedHumanExecuteBatch,
  assertDurableRecoveryReady,
  assertResumeRecoveryState,
  aggregatePayload,
  botOnlyExportArgs,
  botOnlyReport,
  BOT_ONLY_BATCH_15_RECOVERY_REPAIR,
  CLOSED_HUMAN_AUTOMATIC_ACTIVATION,
  CLOSED_HUMAN_AUTOMATIC_MAX_BATCHES_PER_RUN,
  CLOSED_HUMAN_LIFECYCLE_COMPLETION_TARGET,
  findOwnCycle,
  isClosedHumanManualOnlyPolicy,
  persistDurableRecovery,
  runAutomaticClosedHumanStageAutomation,
  runBotOnlyRecoveryRepair,
  runBotOnlyStageAutomation,
  runClosedHumanPolicyDiagnostic,
  runClosedHumanTableRetentionActivation,
  runClosedHumanTableLifecycleCompletion,
  runClosedHumanTableStageCanary,
  runClosedHumanTableStagePrepare,
  runStageAutomation,
  runStageExactRecoveryRepair,
  runStageRecoveryDiagnostic,
  STAGE_PROJECT_REF,
  STAGE_SYSTEM_IDENTIFIER,
  validateStageEnvironment,
} from "../../scripts/ops/chips-ledger-stage-automation.mjs";
import {
  ARCHIVE_BUCKET,
  buildRecoveryArchiveObjectPath,
  buildRecoveryManifestObjectPath,
} from "../../scripts/ops/chips-ledger-archive-store.mjs";
import { buildRecoveryManifest } from "../../scripts/ops/chips-ledger-archive-prune.mjs";

const STAGE_DB_URL = "postgresql://postgres.krydukthwdvccggbyjfw@db.krydukthwdvccggbyjfw.supabase.co:5432/postgres";
const STAGE_URL = "https://krydukthwdvccggbyjfw.supabase.co";
const ENV = {
  SUPABASE_STAGE_DB_URL: STAGE_DB_URL,
  SUPABASE_STAGE_URL: STAGE_URL,
  SUPABASE_STAGE_SERVICE_ROLE_KEY: "stage-test-key",
  GITHUB_SHA: "f".repeat(40),
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "krzysztofcal/arcadePlatform",
  GITHUB_REF: "refs/heads/main",
  GITHUB_REPOSITORY_OWNER: "krzysztofcal",
  GITHUB_ACTOR: "krzysztofcal",
};

const stageOrchestratorSource = fs.readFileSync("scripts/ops/chips-ledger-stage-automation.mjs", "utf8");
assert.match(stageOrchestratorSource, /resumePending[\s\S]*botOnlyExportArgs/);
assert.doesNotMatch(
  stageOrchestratorSource.slice(stageOrchestratorSource.indexOf("export async function runBotOnlyStageAutomation")),
  /activeRows\[0\]\?\.status === "pending"\)\s*fail\(/,
);

function response(value, status = 200, headers = {}) {
  if (Buffer.isBuffer(value)) return new Response(value, { status, headers: { "content-type": "application/gzip", ...headers } });
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}

function fakeSql({ acquired = true, ownRows = [], loseSession = false } = {}) {
  const calls = [];
  const session = { backendPid: "stage-test-session" };
  const sql = {
    calls,
    typed: (value, type) => ({ value, type }),
    unsafe: async (query, values = []) => {
      calls.push({ query, values });
      if (query.includes("pg_try_advisory_lock")) return [{ acquired, backend_pid: session.backendPid }];
      if (query.includes("pg_backend_pid")) {
        if (loseSession) session.backendPid = "lost-stage-session";
        return [{ backend_pid: session.backendPid }];
      }
      if (query.includes("pg_advisory_unlock")) return [{ pg_advisory_unlock: true }];
      if (query.includes("pg_control_system")) return [{ system_identifier: STAGE_SYSTEM_IDENTIFIER }];
      if (query.includes("from public.chips_ledger_archive_batches")) return ownRows;
      throw new Error(`unexpected SQL: ${query}`);
    },
    begin: async (callback) => callback({
      unsafe: async (query, values = []) => {
        calls.push({ query, values });
        if (query.startsWith("set transaction")) return [];
        return [];
      },
    }),
  };
  return sql;
}

assert.throws(
  () => validateStageEnvironment({ ...ENV, SUPABASE_PROD_DB_URL: "forbidden" }),
  /Production credentials are not accepted/,
);

const busySql = fakeSql({ acquired: false });
const busy = await runStageAutomation({
  env: ENV,
  deps: {
    sql: busySql,
    storageTarget: { target: "stage", projectRef: STAGE_PROJECT_REF, baseUrl: STAGE_URL, serviceKey: "stage-test-key" },
    pruneStore: {},
    verifyBucket: async () => { throw new Error("bucket must not be queried while lock is busy"); },
  },
});
assert.equal(busy.state, "no-op");
assert.equal(busy.reason, "advisory_lock_busy");
assert.equal(busySql.calls.filter(({ query }) => query.includes("pg_control_system")).length, 0);

const noCandidateSql = fakeSql();
const noCandidate = await runStageAutomation({
  env: ENV,
  deps: {
    sql: noCandidateSql,
    storageTarget: { target: "stage", projectRef: STAGE_PROJECT_REF, baseUrl: STAGE_URL, serviceKey: "stage-test-key" },
    pruneStore: {},
    verifyBucket: async () => {},
    tempRoot: "/tmp/chips-ledger-stage-automation-test-noop",
  },
});
assert.equal(noCandidate.state, "no-op");
assert.equal(noCandidate.reason, "no_eligible_candidate");
assert.equal(noCandidateSql.calls.some(({ query }) => query.includes("pg_try_advisory_lock")), true);

const policyDiagnosticQueries = [];
const policyDiagnosticSql = {
  begin: async (callback) => callback({
    unsafe: async (query, values = []) => {
      policyDiagnosticQueries.push({ query, values });
      if (query.startsWith("set transaction")) return [];
      if (query.includes("pg_control_system")) return [{ system_identifier: STAGE_SYSTEM_IDENTIFIER }];
      if (query.includes("from public.chips_stage_closed_human_table_retention_policy")) {
        assert.deepEqual(values, [CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID]);
        return [{
          policy_id: CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID,
          enabled: false,
          activated_at: null,
          canary_batch_id: null,
          canary_confirmation: null,
          created_at: "2026-09-04 16:00:00+00",
          updated_at: "2026-09-04 16:00:00+00",
        }];
      }
      throw new Error(`unexpected policy diagnostic SQL: ${query}`);
    },
  }),
};
const policyDiagnostic = await runClosedHumanPolicyDiagnostic({
  env: ENV,
  deps: { sql: policyDiagnosticSql },
});
assert.equal(policyDiagnostic.state, "diagnosed");
assert.equal(policyDiagnostic.policyId, CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID);
assert.equal(policyDiagnostic.enabled, false);
assert.equal(policyDiagnostic.activatedAt, null);
assert.equal(policyDiagnostic.canaryBatchId, null);
assert.equal(policyDiagnostic.canaryConfirmation, null);
assert.equal(policyDiagnostic.readOnly, true);
const policyDiagnosticPayload = aggregatePayload(policyDiagnostic);
assert.equal(policyDiagnosticPayload.policy_id, CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID);
assert.equal(policyDiagnosticPayload.enabled, false);
assert.equal(policyDiagnosticPayload.activated_at, null);
assert.equal(policyDiagnosticPayload.canary_batch_id, null);
assert.equal(policyDiagnosticPayload.canary_confirmation, null);
assert.equal(policyDiagnosticPayload.read_only, true);
assert.equal(policyDiagnosticPayload.writes, false);
assert.equal(
  policyDiagnosticQueries.filter(({ query }) => query.includes("from public.chips_stage_closed_human_table_retention_policy")).length,
  1,
);
const policySelect = policyDiagnosticQueries.find(({ query }) => query.includes("from public.chips_stage_closed_human_table_retention_policy"));
assert.match(policySelect.query, /where policy_id = \$1/);
assert.equal(
  policyDiagnosticQueries.some(({ query }) => /\b(?:insert|update|delete|truncate|alter|drop|create|grant|revoke)\b/i.test(query)),
  false,
);

const lostSessionSql = fakeSql({ loseSession: true });
await assert.rejects(
  runStageAutomation({
    env: ENV,
    deps: {
      sql: lostSessionSql,
      storageTarget: { target: "stage", projectRef: STAGE_PROJECT_REF, baseUrl: STAGE_URL, serviceKey: "stage-test-key" },
      pruneStore: {},
      verifyBucket: async () => { throw new Error("bucket must not be queried after lock loss"); },
    },
  }),
  /advisory lock session was lost/,
);

const selectorQueries = [];
const selectorSql = {
  typed: (value, type) => ({ value, type }),
  begin: async (callback) => callback({
    unsafe: async (query, values = []) => {
      selectorQueries.push({ query, values });
      if (query.startsWith("set transaction")) return [];
      if (query.includes("archive_batch_id is null")) return [{
        id: "00000000-0000-4000-8000-000000000001",
        tx_type: "TABLE_BUY_IN",
      }];
      return [];
    },
  }),
};
const selected = await readSnapshot(selectorSql, {
  selector: "prunable",
  cutoff: "2026-08-13T00:00:00.000000Z",
  batchSize: 5000,
  cursor: null,
});
const selectorPage = selectorQueries.find(({ values }) => values.length === 4);
assert.match(selectorPage.query, /TABLE_BUY_IN/);
assert.match(selectorPage.query, /TABLE_CASH_OUT/);
assert.match(selectorPage.query, /c\.tx_type::text in \('TABLE_BUY_IN', 'TABLE_CASH_OUT'\)/);
assert.match(selectorPage.query, /c\.user_id is null/);
assert.match(selectorPage.query, /upper\(p\.status::text\) = 'CLOSED'/);
assert.match(selectorPage.query, /ea\.status::text = 'active'/);
assert.match(selectorPage.query, /ea\.balance = 0/);
assert.match(selectorPage.query, /archive_batch_id is null/);
assert.match(selectorPage.query, /not exists \(/);
assert.match(selectorPage.query, /accounts\.system_key = 'POKER_TABLE:'/);
assert.match(selectorPage.query, /accounts\.account_type::text = 'SYSTEM'/);
assert.match(selectorPage.query, /count\(\*\) = 2/);
assert.match(selectorPage.query, /count\(\*\) filter \(where accounts\.account_type::text = 'USER'\) = 0/);
assert.match(selectorPage.query, /sum\(entries\.amount\) = 0/);
assert.match(selectorPage.query, /order by e\.created_at asc, e\.id asc/);
assert.match(selectorPage.query, /\$3::timestamptz is null/);
assert.deepEqual(selectorPage.values, [
  { value: "2026-08-13T00:00:00.000000Z", type: 25 },
  5000,
  null,
  null,
]);
assert.equal(selected.candidates.length, 1);

const completedRow = {
  status: "committed",
  source_policy_id: STAGE_AUTOMATION_POLICY_ID,
  pruned_at: "2026-08-13T00:00:00Z",
  pruned_transaction_count: "1",
  pruned_entry_count: "2",
  pruned_transaction_ids_sha256: "a".repeat(64),
  pruned_entry_ids_sha256: "b".repeat(64),
  archive_proof_verified_at: "2026-08-13T00:00:00Z",
  archived_transaction_ids_sha256: "a".repeat(64),
  archived_entry_ids_sha256: "b".repeat(64),
};
assert.equal(findOwnCycle([]).active, null);
assert.equal(findOwnCycle([completedRow]).latestCompleted, completedRow);
const resumableRow = {
  ...completedRow,
  pruned_at: null,
  pruned_transaction_count: null,
  pruned_entry_count: null,
  pruned_transaction_ids_sha256: null,
  pruned_entry_ids_sha256: null,
};
assert.equal(findOwnCycle([resumableRow]).active, resumableRow);
assert.throws(
  () => findOwnCycle([resumableRow, { ...resumableRow }]),
  /multiple incomplete/,
);
assert.throws(
  () => findOwnCycle([{ ...completedRow, pruned_entry_ids_sha256: null }]),
  /receipt is partial/,
);
assert.throws(() => findOwnCycle([{ ...completedRow, status: "pending" }]), /pending/);
const pendingBotRow = {
  status: "pending",
  cutoff: "2026-08-12T00:00:00.000000Z",
  cursor_start_created_at: "2026-07-01T00:00:00.000000Z",
  cursor_start_id: "00000000-0000-4000-8000-000000000001",
};
assert.deepEqual(botOnlyExportArgs(pendingBotRow, "/tmp/bot.archive.gz", "/tmp/bot.manifest.json"), [
  "--target", "stage",
  "--cutoff", pendingBotRow.cutoff,
  "--batch-size", "5000",
  "--after-created-at", pendingBotRow.cursor_start_created_at,
  "--after-id", pendingBotRow.cursor_start_id,
  "--output", "/tmp/bot.archive.gz",
  "--manifest", "/tmp/bot.manifest.json",
]);
const preparedBotReport = botOnlyReport({
  row: {
    ...pendingBotRow,
    project_ref: STAGE_PROJECT_REF,
    batch_id: "12",
    object_path: "v1/sha256/" + "a".repeat(64) + ".jsonl.gz",
    bot_only_table_id: "00000000-0000-4000-8000-000000000020",
    bot_only_table_count: "1",
    bot_only_identity_count: "2",
    bot_only_eligible_count: "2",
    bot_only_registry_keys_sha256: "b".repeat(64),
    bot_only_out_of_scope_keys_sha256: "c".repeat(64),
    compressed_sha256: "a".repeat(64),
  },
  identity: STAGE_SYSTEM_IDENTIFIER,
  dry: { evidence: {
    transactionCount: 2,
    entryCount: 4,
    txTypes: { TABLE_BUY_IN: 2 },
    credits: "200",
    debits: "200",
    net: "0",
    registryKeys: ["one", "two"],
  } },
  durable: {
    recoveryArchive: { sha256: "d".repeat(64) },
    recoveryManifest: { sha256: "e".repeat(64) },
  },
  state: "prepared",
  mode: "prepare-only",
  deployedCommitSha: "f".repeat(40),
});
assert.deepEqual({
  batchId: preparedBotReport.batchId,
  objectPath: preparedBotReport.objectPath,
  tableId: preparedBotReport.tableId,
  registryKeyCount: preparedBotReport.registryKeyCount,
  registryKeysSha256: preparedBotReport.registryKeysSha256,
  stageSystemIdentifier: preparedBotReport.stageSystemIdentifier,
  recoveryArchiveSha256: preparedBotReport.recoveryArchiveSha256,
  recoveryManifestSha256: preparedBotReport.recoveryManifestSha256,
  deployedCommitSha: preparedBotReport.deployedCommitSha,
}, {
  batchId: "12",
  objectPath: "v1/sha256/" + "a".repeat(64) + ".jsonl.gz",
  tableId: "00000000-0000-4000-8000-000000000020",
  registryKeyCount: 2,
  registryKeysSha256: "b".repeat(64),
  stageSystemIdentifier: STAGE_SYSTEM_IDENTIFIER,
  recoveryArchiveSha256: "d".repeat(64),
  recoveryManifestSha256: "e".repeat(64),
  deployedCommitSha: "f".repeat(40),
});
const storageTarget = {
  target: "stage",
  projectRef: STAGE_PROJECT_REF,
  baseUrl: STAGE_URL,
  serviceKey: "stage-test-key",
};
const pendingAutomationRow = {
  status: "pending",
  project_ref: STAGE_PROJECT_REF,
  source_policy_id: "stage-ledger-bot-only-retention-7d-v1",
  batch_id: "13",
  object_path: "v1/sha256/" + "f".repeat(64) + ".jsonl.gz",
  cutoff: "2026-08-12T00:00:00.000000Z",
  cursor_start_created_at: "2026-07-01T00:00:00.000000Z",
  cursor_start_id: "00000000-0000-4000-8000-000000000001",
  bot_only_table_id: "00000000-0000-4000-8000-000000000020",
  bot_only_table_count: "1",
  bot_only_identity_count: "1",
  bot_only_eligible_count: "1",
  bot_only_registry_keys_sha256: "1".repeat(64),
  bot_only_out_of_scope_keys_sha256: "2".repeat(64),
  compressed_sha256: "f".repeat(64),
  archive_proof_verified_at: "2026-08-13T00:00:00.000000Z",
};
const committedPendingRow = {
  ...pendingAutomationRow,
  status: "committed",
  registry_cleaned_at: "2026-08-13T00:01:00.000000Z",
};
const botOnlySqlCalls = [];
const botOnlySql = {
  unsafe: async (query, values = []) => {
    botOnlySqlCalls.push({ query, values });
    if (query.includes("pg_try_advisory_lock")) return [{ acquired: true, backend_pid: "bot-only-session" }];
    if (query.includes("pg_backend_pid")) return [{ backend_pid: "bot-only-session" }];
    if (query.includes("pg_advisory_unlock")) return [{ pg_advisory_unlock: true }];
    if (query.includes("pg_control_system")) return [{ system_identifier: STAGE_SYSTEM_IDENTIFIER }];
    if (query.includes("from public.chips_ledger_archive_batches")) return [pendingAutomationRow];
    throw new Error(`unexpected bot-only SQL: ${query}`);
  },
};
const pendingExportCalls = [];
const pendingStoreCalls = [];
const pendingPruneCalls = [];
const pendingAutomationResult = await runBotOnlyStageAutomation({
  env: ENV,
  deps: {
    sql: botOnlySql,
    storageTarget,
    tempRoot: fs.mkdtempSync("/tmp/chips-ledger-stage-bot-only-pending-"),
    pruneStore: { getManifest: async () => committedPendingRow },
    verifyBucket: async () => {},
    exportArchive: async ({ argv }) => {
      pendingExportCalls.push(argv);
      return { noCandidate: false };
    },
    storeArchive: async (args) => {
      pendingStoreCalls.push(args);
      return { objectPath: pendingAutomationRow.object_path };
    },
    pruneArchive: async ({ argv }) => {
      pendingPruneCalls.push(argv);
      return {
        state: "already_cleaned",
        evidence: {
          transactionCount: 1,
          entryCount: 2,
          txTypes: { TABLE_BUY_IN: 1 },
          credits: "100",
          debits: "100",
          net: "0",
        },
      };
    },
  },
});
assert.equal(pendingAutomationResult.state, "already_cleaned");
const expectedPendingArgs = botOnlyExportArgs(pendingAutomationRow, "artifact", "manifest");
assert.deepEqual(pendingExportCalls[0].slice(0, 10), expectedPendingArgs.slice(0, 10));
assert.equal(pendingExportCalls[0][10], "--output");
assert.equal(pendingExportCalls[0][12], "--manifest");
assert.equal(pendingStoreCalls.length, 1, "a pending bot-only batch must be retried through Storage");
assert.equal(pendingStoreCalls[0].argv.includes("--artifact"), true);
assert.equal(pendingPruneCalls.length, 1, "the retried committed batch must continue through the existing prune runner");
assert.equal(botOnlySqlCalls.some(({ query }) => query.includes("pg_try_advisory_lock")), true);

const noCandidateBotSql = fakeSql();
const noCandidateBotOnly = await runBotOnlyStageAutomation({
  env: ENV,
  deps: {
    sql: noCandidateBotSql,
    storageTarget,
    tempRoot: fs.mkdtempSync("/tmp/chips-ledger-stage-bot-only-no-candidate-"),
    verifyBucket: async () => {},
    exportArchive: async () => ({
      noCandidate: true,
      options: {
        projectRef: STAGE_PROJECT_REF,
        cutoff: "2026-08-14T00:00:00.000Z",
        cursor: null,
      },
      blockingAnomalies: [{ code: "younger_table_identity", transaction_count: "2", table_count: "1" }],
    }),
  },
});
assert.equal(noCandidateBotOnly.reason, "blocking_anomalies");
assert.deepEqual(noCandidateBotOnly.blockingAnomalies, [{ code: "younger_table_identity", transaction_count: "2", table_count: "1" }]);
assert.equal(noCandidateBotOnly.cutoff, "2026-08-14T00:00:00.000Z");
assert.equal(noCandidateBotOnly.deployedCommitSha, "f".repeat(40));

const canaryEvidence = {
  transactionIdsSha256: "b".repeat(64),
  entryIdsSha256: "c".repeat(64),
  transactionCount: 1,
  entryCount: 2,
  txTypes: { TABLE_BUY_IN: 1 },
  credits: "100",
  debits: "100",
  net: "0",
  tableId: "00000000-0000-4000-8000-000000000020",
  registryKeys: ["bot-seed-buyin:00000000-0000-4000-8000-000000000020:1"],
  registryKeysSha256: "d".repeat(64),
  outOfScopeKeysSha256: "e".repeat(64),
};
const canaryArchiveBytes = Buffer.from("exact bot-only canary recovery archive");
const canaryCompressedSha = crypto.createHash("sha256").update(canaryArchiveBytes).digest("hex");

function makeCanaryRow({ go = false, cleaned = false, partialGo = false } = {}) {
  return {
    object_path: `v1/sha256/${canaryCompressedSha}.jsonl.gz`,
    project_ref: STAGE_PROJECT_REF,
    source_policy_id: BOT_ONLY_RETENTION_POLICY_ID,
    status: "committed",
    batch_id: "42",
    format_version: BOT_ONLY_EXPORT_SCHEMA_VERSION,
    cutoff: "2026-08-12T00:00:00.000000Z",
    cursor_start_created_at: null,
    cursor_start_id: null,
    cursor_end_created_at: "2026-07-01T00:00:00.000000Z",
    cursor_end_id: "00000000-0000-4000-8000-000000000021",
    first_created_at: "2026-07-01T00:00:00.000000Z",
    last_created_at: "2026-07-01T00:00:00.000000Z",
    transaction_count: 1,
    entry_count: 2,
    tx_types: { TABLE_BUY_IN: 1 },
    raw_bytes: 100,
    compressed_bytes: canaryArchiveBytes.length,
    raw_sha256: "a".repeat(64),
    compressed_sha256: canaryCompressedSha,
    credits: "100",
    debits: "100",
    net_amount: "0",
    committed_at: "2026-08-13T00:00:00.000000Z",
    archive_proof_verified_at: "2026-08-13T00:01:00.000000Z",
    archived_transaction_ids_sha256: canaryEvidence.transactionIdsSha256,
    archived_entry_ids_sha256: canaryEvidence.entryIdsSha256,
    bot_only_table_id: canaryEvidence.tableId,
    bot_only_table_count: 1,
    bot_only_newest_created_at: "2026-07-01T00:00:00.000000Z",
    bot_only_registry_keys_sha256: canaryEvidence.registryKeysSha256,
    bot_only_out_of_scope_keys_sha256: canaryEvidence.outOfScopeKeysSha256,
    bot_only_identity_count: 1,
    bot_only_eligible_count: 1,
    pruned_at: cleaned ? "2026-08-13T00:02:00.000000Z" : null,
    pruned_transaction_count: cleaned ? 1 : null,
    pruned_entry_count: cleaned ? 2 : null,
    pruned_transaction_ids_sha256: cleaned ? canaryEvidence.transactionIdsSha256 : null,
    pruned_entry_ids_sha256: cleaned ? canaryEvidence.entryIdsSha256 : null,
    registry_cleaned_at: cleaned ? "2026-08-13T00:03:00.000000Z" : null,
    registry_cleaned_key_count: cleaned ? 1 : null,
    registry_cleaned_keys_sha256: cleaned ? canaryEvidence.registryKeysSha256 : null,
    destructive_go_at: go || partialGo ? "2026-08-13T00:02:30.000000Z" : null,
    destructive_go_batch_id: go ? "42" : null,
  };
}

function makeCanaryHarness(row, { exactBatch = true } = {}) {
  const calls = { auth: 0, execute: 0, export: 0, store: 0, proof: 0, verifyBucket: 0 };
  const pruneCalls = [];
  const durable = {
    archiveBytes: canaryArchiveBytes,
    manifestGzipBytes: Buffer.from("compressed recovery manifest"),
    manifestBytes: Buffer.from("recovery manifest"),
    manifest: buildRecoveryManifest(row, STAGE_SYSTEM_IDENTIFIER, canaryEvidence, { target: "stage" }),
    archivePath: buildRecoveryArchiveObjectPath(canaryCompressedSha),
    manifestPath: buildRecoveryManifestObjectPath(canaryCompressedSha),
    recoveryArchive: { sha256: canaryCompressedSha },
    recoveryManifest: { sha256: "f".repeat(64) },
  };
  const sqlCalls = [];
  const session = { backendPid: "exact-canary-session" };
  const sql = {
    calls: sqlCalls,
    unsafe: async (query, values = []) => {
      sqlCalls.push({ query, values });
      if (query.includes("pg_try_advisory_lock")) return [{ acquired: true, backend_pid: session.backendPid }];
      if (query.includes("pg_backend_pid")) return [{ backend_pid: session.backendPid }];
      if (query.includes("pg_advisory_unlock")) return [{ pg_advisory_unlock: true }];
      if (query.includes("pg_control_system")) return [{ system_identifier: STAGE_SYSTEM_IDENTIFIER }];
      if (query.includes("where batch_id = $1")) return exactBatch ? [row] : [];
      if (query.includes("where project_ref = $1")) return [row];
      throw new Error(`unexpected exact canary SQL: ${query}`);
    },
    begin: async (callback) => callback({
      unsafe: async (query, values = []) => {
        if (query.startsWith("set transaction")) return [];
        return sql.unsafe(query, values);
      },
    }),
  };
  const pruneStore = {
    getManifest: async () => row,
    async authorizeBotOnlyBatch(batchId, confirmation) {
      calls.auth += 1;
      assert.equal(String(batchId), "42");
      assert.equal(confirmation, "GO 42");
      row.destructive_go_at = "2026-08-13T00:02:30.000000Z";
      row.destructive_go_batch_id = "42";
      return { state: "authorized", batch_id: "42" };
    },
  };
  const deps = {
    sql,
    storageTarget,
    tempRoot: fs.mkdtempSync("/tmp/chips-ledger-stage-bot-only-exact-"),
    pruneStore,
    verifyBucket: async () => { calls.verifyBucket += 1; },
    inspectDurableRecovery: async () => durable,
    exportArchive: async () => { calls.export += 1; throw new Error("exact execute must not export"); },
    ensureArchiveBucket: async () => { calls.store += 1; throw new Error("exact execute must not prepare Storage"); },
    storeArchive: async () => { calls.store += 1; throw new Error("exact execute must not store a new manifest"); },
    pruneArchive: async ({ argv }) => {
      const execute = argv.includes("--execute");
      pruneCalls.push({ argv: [...argv], execute });
      if (!execute) {
        return {
          state: row.registry_cleaned_at ? "already_cleaned" : "ready",
          evidence: canaryEvidence,
        };
      }
      calls.execute += 1;
      row.pruned_at = "2026-08-13T00:02:00.000000Z";
      row.pruned_transaction_count = 1;
      row.pruned_entry_count = 2;
      row.pruned_transaction_ids_sha256 = canaryEvidence.transactionIdsSha256;
      row.pruned_entry_ids_sha256 = canaryEvidence.entryIdsSha256;
      row.registry_cleaned_at = "2026-08-13T00:03:00.000000Z";
      row.registry_cleaned_key_count = 1;
      row.registry_cleaned_keys_sha256 = canaryEvidence.registryKeysSha256;
      return { state: "cleaned", evidence: canaryEvidence };
    },
  };
  return { deps, calls, pruneCalls, durable };
}

const preparedCanaryRow = makeCanaryRow();
const preparedHarness = makeCanaryHarness(preparedCanaryRow);
const preparedCanary = await runBotOnlyStageAutomation({
  env: ENV,
  deps: preparedHarness.deps,
  prepareOnly: true,
});
assert.equal(preparedCanary.state, "prepared", "prepare-only must produce the exact canary input");
assert.equal(preparedHarness.calls.auth, 0, "prepare-only must not write a destructive GO");
assert.equal(preparedHarness.calls.execute, 0, "prepare-only must not execute cleanup");

const exactCanary = await runBotOnlyStageAutomation({
  env: { ...ENV, CHIPS_LEDGER_BOT_ONLY_EXECUTE: "1" },
  deps: preparedHarness.deps,
  prepareOnly: false,
  approvedBatchId: "42",
  approvedBatchConfirmation: "GO 42",
});
assert.equal(exactCanary.state, "cleaned");
assert.equal(preparedHarness.calls.auth, 1, "first exact execute must persist one owner-only GO");
assert.equal(preparedHarness.calls.execute, 1, "first exact execute must prune the approved batch");
assert.equal(preparedHarness.pruneCalls.at(-1).argv.includes("--approved-batch-id"), true);
assert.equal(preparedHarness.pruneCalls.at(-1).argv.includes("42"), true);
assert.equal(preparedCanaryRow.destructive_go_at != null, true);
assert.equal(preparedCanaryRow.destructive_go_batch_id, "42");
assert.equal(preparedHarness.calls.export, 0, "exact execute must not export a candidate");
assert.equal(preparedHarness.calls.store, 0, "exact execute must not write Storage or a new manifest");

const exactGoRow = makeCanaryRow({ go: true });
const exactGoHarness = makeCanaryHarness(exactGoRow);
const exactGoResume = await runBotOnlyStageAutomation({
  env: { ...ENV, CHIPS_LEDGER_BOT_ONLY_EXECUTE: "1" },
  deps: exactGoHarness.deps,
  prepareOnly: false,
  approvedBatchId: "42",
  approvedBatchConfirmation: "GO 42",
});
assert.equal(exactGoResume.state, "cleaned");
assert.equal(exactGoHarness.calls.auth, 0, "an existing exact GO must be reused");
assert.equal(exactGoHarness.calls.execute, 1, "an existing exact GO must resume the exact batch");

const cleanedRow = makeCanaryRow({ go: true, cleaned: true });
const cleanedHarness = makeCanaryHarness(cleanedRow);
const cleanedRetry = await runBotOnlyStageAutomation({
  env: { ...ENV, CHIPS_LEDGER_BOT_ONLY_EXECUTE: "1" },
  deps: cleanedHarness.deps,
  prepareOnly: false,
  approvedBatchId: "42",
  approvedBatchConfirmation: "GO 42",
});
assert.equal(cleanedRetry.state, "already_cleaned", "a completed exact batch must be idempotent");
assert.equal(cleanedHarness.calls.auth, 0);
assert.equal(cleanedHarness.calls.execute, 0, "completed retry must not execute or choose a next candidate");
assert.equal(cleanedHarness.calls.export, 0);
assert.equal(cleanedHarness.calls.store, 0);

const wrongIdHarness = makeCanaryHarness(makeCanaryRow(), { exactBatch: false });
await assert.rejects(
  runBotOnlyStageAutomation({
    env: { ...ENV, CHIPS_LEDGER_BOT_ONLY_EXECUTE: "1" },
    deps: wrongIdHarness.deps,
    prepareOnly: false,
    approvedBatchId: "999",
    approvedBatchConfirmation: "GO 999",
  }),
  /was not found/,
);
assert.deepEqual(wrongIdHarness.calls, { auth: 0, execute: 0, export: 0, store: 0, proof: 0, verifyBucket: 0 });

const wrongConfirmationHarness = makeCanaryHarness(makeCanaryRow());
await assert.rejects(
  runBotOnlyStageAutomation({
    env: { ...ENV, CHIPS_LEDGER_BOT_ONLY_EXECUTE: "1" },
    deps: wrongConfirmationHarness.deps,
    prepareOnly: false,
    approvedBatchId: "42",
    approvedBatchConfirmation: "GO 41",
  }),
  /exact GO <batch_id>/,
);
assert.deepEqual(wrongConfirmationHarness.calls, { auth: 0, execute: 0, export: 0, store: 0, proof: 0, verifyBucket: 0 });

const partialGoHarness = makeCanaryHarness(makeCanaryRow({ partialGo: true }));
await assert.rejects(
  runBotOnlyStageAutomation({
    env: { ...ENV, CHIPS_LEDGER_BOT_ONLY_EXECUTE: "1" },
    deps: partialGoHarness.deps,
    prepareOnly: false,
    approvedBatchId: "42",
    approvedBatchConfirmation: "GO 42",
  }),
  /partial destructive GO/,
);
assert.deepEqual(partialGoHarness.calls, { auth: 0, execute: 0, export: 0, store: 0, proof: 0, verifyBucket: 0 });
const missingRecoveryHarness = makeCanaryHarness(makeCanaryRow());
missingRecoveryHarness.deps.inspectDurableRecovery = async () => null;
await assert.rejects(
  runBotOnlyStageAutomation({
    env: { ...ENV, CHIPS_LEDGER_BOT_ONLY_EXECUTE: "1" },
    deps: missingRecoveryHarness.deps,
    prepareOnly: false,
    approvedBatchId: "42",
    approvedBatchConfirmation: "GO 42",
  }),
  /no durable recovery/,
);
assert.equal(missingRecoveryHarness.calls.auth, 0, "missing recovery must block authorization");
assert.equal(missingRecoveryHarness.calls.execute, 0, "missing recovery must block execute");
assert.throws(
  () => assertBotOnlyExecuteBatch({ ...makeCanaryRow(), source_policy_id: STAGE_AUTOMATION_POLICY_ID }, "42"),
  /policy mismatch/,
);
assert.throws(
  () => assertBotOnlyActiveManifestMatch(makeCanaryRow(), { ...makeCanaryRow(), compressed_sha256: "9".repeat(64) }, "42"),
  /active manifest.*compressed_sha256/,
);
assert.throws(
  () => assertBotOnlyExecuteBatch({ ...makeCanaryRow(), archived_entry_ids_sha256: null }, "42"),
  /complete archive proof/,
);
assert.throws(
  () => assertBotOnlyExecuteBatch({ ...makeCanaryRow(), object_path: "v1/sha256/" + "9".repeat(64) + ".jsonl.gz" }, "42"),
  /object path/,
);
assert.throws(
  () => assertBotOnlyExecuteBatch({ ...makeCanaryRow(), registry_cleaned_at: "now" }, "42"),
  /partial registry cleanup receipt/,
);

assert.throws(() => assertDurableRecoveryReady({ archiveBytes: Buffer.from("archive") }), /both durable recovery copies/);
assert.throws(
  () => assertResumeRecoveryState({ archive_proof_verified_at: "now", pruned_at: null }, null),
  /no durable recovery/,
);
assert.throws(
  () => assertResumeRecoveryState({ archive_proof_verified_at: null, pruned_at: null }, { archiveBytes: Buffer.from("x") }),
  /without an immutable proof/,
);
assert.equal(assertResumeRecoveryState({ archive_proof_verified_at: "now", pruned_at: null }, { archiveBytes: Buffer.from("x") }), true);
assert.equal(assertResumeRecoveryState({ archive_proof_verified_at: "now", pruned_at: "now" }, { archiveBytes: Buffer.from("x") }), true);

const archiveBytes = Buffer.from("verified gzip archive copy");
const compressedSha = crypto.createHash("sha256").update(archiveBytes).digest("hex");
const recoveryRow = {
  object_path: `v1/sha256/${compressedSha}.jsonl.gz`,
  batch_id: "7",
  project_ref: STAGE_PROJECT_REF,
  source_policy_id: STAGE_AUTOMATION_POLICY_ID,
  format_version: 1,
  cutoff: "2026-08-01T00:00:00.000000Z",
  cursor_start_created_at: null,
  cursor_start_id: null,
  cursor_end_created_at: "2026-07-01T00:00:00.000000Z",
  cursor_end_id: "00000000-0000-4000-8000-000000000001",
  first_created_at: "2026-07-01T00:00:00.000000Z",
  last_created_at: "2026-07-01T00:00:00.000000Z",
  transaction_count: 1,
  entry_count: 2,
  tx_types: { TABLE_BUY_IN: 1 },
  raw_bytes: 1,
  compressed_bytes: archiveBytes.length,
  raw_sha256: "c".repeat(64),
  compressed_sha256: compressedSha,
  credits: "10",
  debits: "10",
  net_amount: "0",
};
const evidence = {
  transactionIdsSha256: "d".repeat(64),
  entryIdsSha256: "e".repeat(64),
  transactionCount: 1,
  entryCount: 2,
  txTypes: { TABLE_BUY_IN: 1 },
  credits: "10",
  debits: "10",
  net: "0",
};
const durableObjects = new Map();
const storageCalls = [];
const fetch = async (url, init = {}) => {
  const requestUrl = new URL(url);
  const objectPath = decodeURIComponent(requestUrl.pathname.split(`/storage/v1/object/authenticated/${ARCHIVE_BUCKET}/`)[1] || requestUrl.pathname.split(`/storage/v1/object/${ARCHIVE_BUCKET}/`)[1] || "");
  const method = init.method || "GET";
  storageCalls.push({ method, objectPath, headers: new Headers(init.headers || {}) });
  if (method === "GET") {
    const value = durableObjects.get(objectPath);
    return value ? response(value) : response({ message: "not found" }, 404);
  }
  if (method === "POST") {
    assert.equal(new Headers(init.headers).get("x-upsert"), "false");
    assert.equal(new Headers(init.headers).get("content-type"), "application/gzip");
    durableObjects.set(objectPath, Buffer.from(init.body));
    return response({ ok: true });
  }
  return response({ message: "unexpected" }, 500);
};
const durable = await persistDurableRecovery(
  storageTarget,
  recoveryRow,
  STAGE_SYSTEM_IDENTIFIER,
  evidence,
  archiveBytes,
  { fetch },
);
assert.equal(durable.archiveBytes.equals(archiveBytes), true);
assert.equal(durableObjects.has(buildRecoveryArchiveObjectPath(compressedSha)), true);
assert.equal(durableObjects.has(buildRecoveryManifestObjectPath(compressedSha)), true);
assert.equal(storageCalls.filter(({ method }) => method === "POST").length, 2);
assert.equal(storageCalls.filter(({ method }) => method === "GET").length >= 6, true);
assert.equal(durable.manifestGzipBytes.length > 0, true);
assert.equal(durable.recoveryArchive.sha256, compressedSha);
assert.equal(durable.recoveryManifest.sha256, crypto.createHash("sha256").update(durable.manifestGzipBytes).digest("hex"));

function exactSqlTextRow(row) {
  const textFields = [
    "batch_id",
    "format_version",
    "transaction_count",
    "entry_count",
    "raw_bytes",
    "compressed_bytes",
    "bot_only_table_count",
    "bot_only_identity_count",
    "bot_only_eligible_count",
    "registry_cleaned_key_count",
    "destructive_go_batch_id",
  ];
  return {
    ...row,
    ...Object.fromEntries(textFields.map((field) => [field, row[field] == null ? null : String(row[field])])),
    tx_types: JSON.stringify(row.tx_types),
  };
}

const repairRow = { ...makeCanaryRow(), batch_id: "15" };
const repairExactSqlRow = exactSqlTextRow(repairRow);
const repairObjects = new Map();
const repairStorageCalls = [];
const repairFetch = async (url, init = {}) => {
  const requestUrl = new URL(url);
  const objectPath = decodeURIComponent(
    requestUrl.pathname.split(`/storage/v1/object/authenticated/${ARCHIVE_BUCKET}/`)[1]
      || requestUrl.pathname.split(`/storage/v1/object/${ARCHIVE_BUCKET}/`)[1]
      || "",
  );
  const method = init.method || "GET";
  repairStorageCalls.push({ method, objectPath, headers: new Headers(init.headers || {}) });
  if (method === "GET") {
    if (objectPath === repairRow.object_path) return response(canaryArchiveBytes);
    const value = repairObjects.get(objectPath);
    return value ? response(value) : response({ message: "not found" }, 404);
  }
  if (method === "POST") {
    assert.equal(new Headers(init.headers).get("x-upsert"), "false");
    assert.equal(new Headers(init.headers).get("content-type"), "application/gzip");
    repairObjects.set(objectPath, Buffer.from(init.body));
    return response({ ok: true });
  }
  return response({ message: "unexpected" }, 500);
};
const repairSqlCalls = [];
const repairSession = { backendPid: "recovery-repair-session" };
const repairSql = {
  typed: (value, type) => ({ value, type }),
  unsafe: async (query, values = []) => {
    repairSqlCalls.push({ query, values });
    if (query.includes("pg_try_advisory_lock")) return [{ acquired: true, backend_pid: repairSession.backendPid }];
    if (query.includes("pg_backend_pid")) return [{ backend_pid: repairSession.backendPid }];
    if (query.includes("pg_advisory_unlock")) return [{ pg_advisory_unlock: true }];
    if (query.includes("pg_control_system")) return [{ system_identifier: STAGE_SYSTEM_IDENTIFIER }];
    if (query.includes("where batch_id = $1")) return [repairExactSqlRow];
    throw new Error(`unexpected recovery repair SQL: ${query}`);
  },
  begin: async (callback) => callback({
    unsafe: async (query, values = []) => {
      if (query.startsWith("set transaction")) return [];
      return repairSql.unsafe(query, values);
    },
  }),
};
const repairPruneCalls = [];
const repairTempRoot = fs.mkdtempSync("/tmp/chips-ledger-stage-recovery-repair-");
let repairManifestReads = 0;
const repairDeps = {
  sql: repairSql,
  storageTarget,
  tempRoot: repairTempRoot,
  pruneStore: {
    getIdentity: async () => STAGE_SYSTEM_IDENTIFIER,
    getManifest: async () => {
      repairManifestReads += 1;
      return repairRow;
    },
  },
  verifyBucket: async () => {},
  pruneArchive: async ({ argv }) => {
    repairPruneCalls.push([...argv]);
    assert.equal(argv.includes("--execute"), false);
    assert.equal(argv.includes("--register-proof"), false);
    assert.equal(argv.includes("--automatic"), false);
    return { state: "ready", evidence: canaryEvidence };
  },
  fetch: repairFetch,
};
await assert.rejects(
  runBotOnlyRecoveryRepair({ env: ENV, deps: repairDeps, batchId: "15" }),
  /target path or archive SHA is not approved/,
);
assert.equal(repairManifestReads, 1, "repair must read the normalized manifest after the exact SQL row");
assert.equal(repairObjects.size, 0, "a foreign batch-15 target must not create recovery objects");
assert.equal(repairStorageCalls.length, 0, "a foreign batch-15 target must fail before Storage");
assert.equal(repairPruneCalls.length, 0, "a foreign batch-15 target must fail before prune");
assert.equal(repairSqlCalls.some(({ query }) => /\b(?:insert|update|delete|truncate)\b/i.test(query)), false);
await assert.rejects(
  runBotOnlyRecoveryRepair({ env: ENV, deps: repairDeps, batchId: "15" }),
  /target path or archive SHA is not approved/,
);
assert.equal(repairStorageCalls.length, 0);
await assert.rejects(
  runBotOnlyRecoveryRepair({ env: ENV, deps: repairDeps, batchId: "14" }),
  /pinned to batch 15/,
);
await assert.rejects(
  runBotOnlyRecoveryRepair({
    env: { ...ENV, CHIPS_LEDGER_BOT_ONLY_EXECUTE: "1" },
    deps: repairDeps,
    batchId: "15",
  }),
  /cannot run with execute or automatic gates/,
);

function gzipRecoveryManifestForTest(manifest) {
  return gzipSync(Buffer.from(`${stringifyJson(manifest)}\n`, "utf8"), { level: 9, mtime: 0 });
}

const batch15Evidence = {
  transactionIdsSha256: "0fb56b4c43ef22e40ce5809c4c77cda4647c994e5843836d5c69b109bbd58cad",
  entryIdsSha256: "43d49cfe54188b518d72e2cf9b8965c90577f8e98da188f06ffa0f236343fd7a",
  transactionCount: 6,
  entryCount: 12,
  txTypes: { TABLE_BUY_IN: 3, TABLE_CASH_OUT: 3 },
  credits: "600",
  debits: "600",
  net: "0",
  tableId: "0055442d-225f-44ce-bd97-d3edb4a4db35",
  registryKeys: ["batch-15-key-1", "batch-15-key-2", "batch-15-key-3", "batch-15-key-4", "batch-15-key-5", "batch-15-key-6"],
  registryKeysSha256: "b169f4aff0cc31ed1d5372c562821580224829d1df6438e35b400b22fff81c2a",
  outOfScopeKeysSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
};
const batch15Row = {
  ...makeCanaryRow(),
  object_path: BOT_ONLY_BATCH_15_RECOVERY_REPAIR.objectPath,
  batch_id: "15",
  cutoff: "2026-08-19 12:08:30.872+00",
  cursor_start_created_at: null,
  cursor_start_id: null,
  cursor_end_created_at: "2026-08-19 05:16:15.263652+00",
  cursor_end_id: "b8705d34-8f4a-4d30-b29b-3454ea77085d",
  first_created_at: "2026-08-19 05:00:39.619093+00",
  last_created_at: "2026-08-19 05:16:15.263652+00",
  transaction_count: 6,
  entry_count: 12,
  tx_types: { TABLE_BUY_IN: 3, TABLE_CASH_OUT: 3 },
  raw_bytes: 13382,
  compressed_bytes: 1757,
  raw_sha256: "764e5cc7682e23be5692c574be97cfed0b08a98db336559e724773d8e7bae16e",
  compressed_sha256: BOT_ONLY_BATCH_15_RECOVERY_REPAIR.archiveSha256,
  archived_transaction_ids_sha256: batch15Evidence.transactionIdsSha256,
  archived_entry_ids_sha256: batch15Evidence.entryIdsSha256,
  credits: "600",
  debits: "600",
  net_amount: "0",
  bot_only_table_id: batch15Evidence.tableId,
  bot_only_table_count: 1,
  bot_only_newest_created_at: "2026-08-19 05:16:15.263652+00",
  bot_only_registry_keys_sha256: batch15Evidence.registryKeysSha256,
  bot_only_out_of_scope_keys_sha256: batch15Evidence.outOfScopeKeysSha256,
  bot_only_identity_count: 6,
  bot_only_eligible_count: 6,
};
const batch15ExactSqlRow = {
  ...exactSqlTextRow(batch15Row),
  tx_types: '{"TABLE_BUY_IN": 3, "TABLE_CASH_OUT": 3}',
};
const knownBadBatch15Manifest = buildRecoveryManifest(
  batch15ExactSqlRow,
  STAGE_SYSTEM_IDENTIFIER,
  batch15Evidence,
  { target: "stage" },
);
const knownBadBatch15ManifestGzip = gzipRecoveryManifestForTest(knownBadBatch15Manifest);
assert.equal(Object.hasOwn(knownBadBatch15Manifest, "bot_only"), false);
assert.equal(
  crypto.createHash("sha256").update(knownBadBatch15ManifestGzip).digest("hex"),
  BOT_ONLY_BATCH_15_RECOVERY_REPAIR.currentRecoveryManifestSha256,
);
const correctedBatch15Manifest = buildRecoveryManifest(
  batch15Row,
  STAGE_SYSTEM_IDENTIFIER,
  batch15Evidence,
  { target: "stage" },
);
const correctedBatch15ManifestGzip = gzipRecoveryManifestForTest(correctedBatch15Manifest);
assert.equal(
  crypto.createHash("sha256").update(correctedBatch15ManifestGzip).digest("hex"),
  BOT_ONLY_BATCH_15_RECOVERY_REPAIR.correctedRecoveryManifestSha256,
);
assert.equal(correctedBatch15Manifest.archive.format_version, 2);
assert.equal(correctedBatch15Manifest.archive.transaction_count, 6);
assert.equal(correctedBatch15Manifest.archive.entry_count, 12);
assert.equal(correctedBatch15Manifest.archive.raw_bytes, 13382);
assert.equal(correctedBatch15Manifest.archive.compressed_bytes, 1757);
assert.deepEqual(correctedBatch15Manifest.archive.tx_types, batch15Evidence.txTypes);
assert.deepEqual(correctedBatch15Manifest.bot_only, {
  table_id: batch15Evidence.tableId,
  table_count: 1,
  registry_keys_sha256: batch15Evidence.registryKeysSha256,
  registry_key_count: batch15Evidence.registryKeys.length,
  out_of_scope_keys_sha256: batch15Evidence.outOfScopeKeysSha256,
});

const futureBotArchiveBytes = Buffer.from("future bot-only recovery archive");
const futureBotArchiveSha256 = crypto.createHash("sha256").update(futureBotArchiveBytes).digest("hex");
const futureBotRow = {
  ...batch15Row,
  batch_id: "16",
  object_path: `v1/sha256/${futureBotArchiveSha256}.jsonl.gz`,
  compressed_sha256: futureBotArchiveSha256,
  compressed_bytes: futureBotArchiveBytes.length,
};
const futureBotObjects = new Map();
const futureBotStorageCalls = [];
const futureBotFetch = async (url, init = {}) => {
  const requestUrl = new URL(url);
  const authenticatedPrefix = `/storage/v1/object/authenticated/${ARCHIVE_BUCKET}/`;
  const uploadPrefix = `/storage/v1/object/${ARCHIVE_BUCKET}/`;
  const prefix = requestUrl.pathname.startsWith(authenticatedPrefix) ? authenticatedPrefix : uploadPrefix;
  const objectPath = decodeURIComponent(requestUrl.pathname.slice(prefix.length));
  const method = init.method || "GET";
  futureBotStorageCalls.push({ method, objectPath });
  if (method === "GET") {
    const value = futureBotObjects.get(objectPath);
    return value ? response(value) : response({ message: "not found" }, 404);
  }
  if (method === "POST") {
    futureBotObjects.set(objectPath, Buffer.from(init.body));
    return response({ ok: true });
  }
  return response({ message: "unexpected future bot-only method" }, 500);
};
const futureBotDurable = await persistDurableRecovery(
  storageTarget,
  futureBotRow,
  STAGE_SYSTEM_IDENTIFIER,
  batch15Evidence,
  futureBotArchiveBytes,
  { fetch: futureBotFetch },
);
const futureBotManifest = JSON.parse(gunzipSync(futureBotDurable.manifestGzipBytes).toString("utf8"));
assert.equal(typeof futureBotManifest.archive.format_version, "number");
assert.equal(typeof futureBotManifest.archive.transaction_count, "number");
assert.equal(typeof futureBotManifest.archive.entry_count, "number");
assert.equal(typeof futureBotManifest.archive.raw_bytes, "number");
assert.equal(typeof futureBotManifest.archive.compressed_bytes, "number");
assert.deepEqual(futureBotManifest.archive.tx_types, futureBotRow.tx_types);
assert.deepEqual(futureBotManifest.bot_only, {
  table_id: batch15Evidence.tableId,
  table_count: 1,
  registry_keys_sha256: batch15Evidence.registryKeysSha256,
  registry_key_count: batch15Evidence.registryKeys.length,
  out_of_scope_keys_sha256: batch15Evidence.outOfScopeKeysSha256,
});
assert.equal(futureBotStorageCalls.filter(({ method }) => method === "POST").length, 2);

const correctionArchiveBytes = Buffer.alloc(1757, 0x61);
const correctionArchiveBefore = Buffer.from(correctionArchiveBytes);
let correctionManifestGzipBytes = Buffer.from(knownBadBatch15ManifestGzip);
let correctionSqlRow = batch15ExactSqlRow;
let correctionActiveRow = batch15Row;
let correctionPutCompleted = false;
let correctionVerificationResponses = [];
let correctionPreconditionResponses = [];
let correctionInspectManifestResponses = [];
const correctionStorageCalls = [];
const correctionFetch = async (url, init = {}) => {
  const requestUrl = new URL(url);
  const authenticatedPrefix = `/storage/v1/object/authenticated/${ARCHIVE_BUCKET}/`;
  const uploadPrefix = `/storage/v1/object/${ARCHIVE_BUCKET}/`;
  const prefix = requestUrl.pathname.startsWith(authenticatedPrefix) ? authenticatedPrefix : uploadPrefix;
  const objectPath = decodeURIComponent(requestUrl.pathname.slice(prefix.length));
  const method = init.method || "GET";
  correctionStorageCalls.push({ method, objectPath });
  assert.equal(objectPath, BOT_ONLY_BATCH_15_RECOVERY_REPAIR.recoveryManifestPath);
  if (method === "GET") {
    if (!correctionPutCompleted && correctionPreconditionResponses.length > 0) {
      return response(correctionPreconditionResponses.shift());
    }
    if (correctionPutCompleted && correctionVerificationResponses.length > 0) {
      return response(correctionVerificationResponses.shift());
    }
    return response(correctionManifestGzipBytes);
  }
  if (method === "PUT") {
    correctionManifestGzipBytes = Buffer.from(init.body);
    correctionPutCompleted = true;
    return response({ ok: true });
  }
  return response({ message: "unexpected correction method" }, 500);
};
const correctionInspectCalls = [];
const inspectCorrection = async () => {
  correctionInspectCalls.push(true);
  const inspectedManifestGzipBytes = correctionInspectManifestResponses.length > 0
    ? Buffer.from(correctionInspectManifestResponses.shift())
    : correctionManifestGzipBytes;
  const manifestBytes = gunzipSync(inspectedManifestGzipBytes);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  return {
    archivePath: BOT_ONLY_BATCH_15_RECOVERY_REPAIR.recoveryArchivePath,
    manifestPath: BOT_ONLY_BATCH_15_RECOVERY_REPAIR.recoveryManifestPath,
    archiveBytes: correctionArchiveBytes,
    manifestGzipBytes: inspectedManifestGzipBytes,
    manifestBytes,
    manifest,
    archiveSha256: BOT_ONLY_BATCH_15_RECOVERY_REPAIR.archiveSha256,
    manifestSha256: crypto.createHash("sha256").update(inspectedManifestGzipBytes).digest("hex"),
  };
};
const correctionSqlCalls = [];
const correctionSession = { backendPid: "batch-15-correction-session" };
const correctionSql = {
  typed: (value, type) => ({ value, type }),
  unsafe: async (query, values = []) => {
    correctionSqlCalls.push({ query, values });
    if (query.includes("pg_try_advisory_lock")) return [{ acquired: true, backend_pid: correctionSession.backendPid }];
    if (query.includes("pg_backend_pid")) return [{ backend_pid: correctionSession.backendPid }];
    if (query.includes("pg_advisory_unlock")) return [{ pg_advisory_unlock: true }];
    if (query.includes("pg_control_system")) return [{ system_identifier: STAGE_SYSTEM_IDENTIFIER }];
    if (query.includes("where batch_id = $1")) return [correctionSqlRow];
    throw new Error(`unexpected batch 15 correction SQL: ${query}`);
  },
  begin: async (callback) => callback({
    unsafe: async (query, values = []) => {
      if (query.startsWith("set transaction")) return [];
      return correctionSql.unsafe(query, values);
    },
  }),
};
let correctionManifestReads = 0;
const correctionPruneCalls = [];
const correctionTempRoot = fs.mkdtempSync("/tmp/chips-ledger-stage-batch-15-correction-");
const correctionDeps = {
  sql: correctionSql,
  storageTarget,
  tempRoot: correctionTempRoot,
  pruneStore: {
    getIdentity: async () => STAGE_SYSTEM_IDENTIFIER,
    getManifest: async (objectPath) => {
      correctionManifestReads += 1;
      assert.equal(objectPath, correctionActiveRow.object_path);
      return correctionActiveRow;
    },
  },
  verifyBucket: async () => {},
  inspectDurableRecovery: inspectCorrection,
  pruneArchive: async ({ argv }) => {
    correctionPruneCalls.push([...argv]);
    assert.equal(argv.includes("--execute"), false);
    assert.equal(argv.includes("--register-proof"), false);
    assert.equal(argv.includes("--automatic"), false);
    return { state: "ready", evidence: batch15Evidence };
  },
  fetch: correctionFetch,
};
correctionVerificationResponses = [knownBadBatch15ManifestGzip, correctedBatch15ManifestGzip];
const repairedBatch15 = await runBotOnlyRecoveryRepair({ env: ENV, deps: correctionDeps, batchId: "15" });
assert.equal(repairedBatch15.state, "recovery_repaired");
assert.equal(repairedBatch15.batchId, "15");
assert.equal(repairedBatch15.receipt, "recovery-manifest-repair-only");
assert.equal(repairedBatch15.initialRecoveryObjectsAbsent, false);
assert.equal(repairedBatch15.recoveryVerified, true);
assert.equal(repairedBatch15.storageModified, true);
assert.equal(repairedBatch15.recoveryManifestSha256, BOT_ONLY_BATCH_15_RECOVERY_REPAIR.correctedRecoveryManifestSha256);
assert.equal(correctionManifestReads, 1);
assert.equal(correctionInspectCalls.length, 2);
assert.equal(correctionPruneCalls.length, 1);
assert.deepEqual(correctionStorageCalls.map(({ method }) => method), ["GET", "PUT", "GET", "GET"]);
assert.equal(correctionStorageCalls.filter(({ method }) => method === "PUT").length, 1);
assert.equal(correctionStorageCalls.every(({ objectPath }) => objectPath === BOT_ONLY_BATCH_15_RECOVERY_REPAIR.recoveryManifestPath), true);
assert.equal(correctionArchiveBytes.equals(correctionArchiveBefore), true);
assert.equal(correctionSqlCalls.some(({ query }) => /\b(?:insert|update|delete|truncate)\b/i.test(query)), false);
const repairedBatch15Manifest = JSON.parse(gunzipSync(correctionManifestGzipBytes).toString("utf8"));
assert.deepEqual(repairedBatch15Manifest, correctedBatch15Manifest);
assert.equal(
  crypto.createHash("sha256").update(correctionManifestGzipBytes).digest("hex"),
  BOT_ONLY_BATCH_15_RECOVERY_REPAIR.correctedRecoveryManifestSha256,
);

const correctedStorageCallCount = correctionStorageCalls.length;
const correctedPutCount = correctionStorageCalls.filter(({ method }) => method === "PUT").length;
correctionPutCompleted = false;
correctionVerificationResponses = [];
correctionInspectManifestResponses = [correctedBatch15ManifestGzip, knownBadBatch15ManifestGzip];
const alreadyRepairedBatch15 = await runBotOnlyRecoveryRepair({ env: ENV, deps: correctionDeps, batchId: "15" });
assert.equal(alreadyRepairedBatch15.state, "recovery_already_repaired");
assert.equal(alreadyRepairedBatch15.receipt, "recovery-already-repaired-read-only");
assert.equal(alreadyRepairedBatch15.storageModified, false);
assert.equal(alreadyRepairedBatch15.recoveryVerified, true);
assert.equal(correctionStorageCalls.length, correctedStorageCallCount, "already corrected recovery must not access Storage for a PUT");
assert.equal(correctionStorageCalls.filter(({ method }) => method === "PUT").length, correctedPutCount);
assert.equal(correctionPruneCalls.length, 2, "already corrected recovery must still run the read-only dry-run");
assert.equal(correctionArchiveBytes.equals(correctionArchiveBefore), true);

correctionManifestGzipBytes = Buffer.from(knownBadBatch15ManifestGzip);
correctionPutCompleted = false;
correctionVerificationResponses = [];
correctionPreconditionResponses = [correctedBatch15ManifestGzip];
correctionInspectManifestResponses = [knownBadBatch15ManifestGzip, knownBadBatch15ManifestGzip];
const alreadyReplacedPutCount = correctionStorageCalls.filter(({ method }) => method === "PUT").length;
const alreadyReplacedBatch15 = await runBotOnlyRecoveryRepair({ env: ENV, deps: correctionDeps, batchId: "15" });
assert.equal(alreadyReplacedBatch15.state, "recovery_already_repaired");
assert.equal(alreadyReplacedBatch15.receipt, "recovery-already-repaired-read-only");
assert.equal(alreadyReplacedBatch15.storageModified, false);
assert.equal(alreadyReplacedBatch15.recoveryVerified, true);
assert.equal(alreadyReplacedBatch15.recoveryManifestSha256, BOT_ONLY_BATCH_15_RECOVERY_REPAIR.correctedRecoveryManifestSha256);
assert.equal(correctionStorageCalls.filter(({ method }) => method === "PUT").length, alreadyReplacedPutCount);
assert.deepEqual(correctionStorageCalls.slice(-1).map(({ method }) => method), ["GET"]);
assert.equal(correctionArchiveBytes.equals(correctionArchiveBefore), true);

const foreignManifest = gzipRecoveryManifestForTest({ foreign: true });
const foreignManifestSha = crypto.createHash("sha256").update(foreignManifest).digest("hex");
correctionManifestGzipBytes = Buffer.from(foreignManifest);
correctionPutCompleted = false;
correctionVerificationResponses = [];
correctionPreconditionResponses = [];
correctionInspectManifestResponses = [];
const correctionPutCountBeforeForeignContent = correctionStorageCalls.filter(({ method }) => method === "PUT").length;
await assert.rejects(
  runBotOnlyRecoveryRepair({ env: ENV, deps: correctionDeps, batchId: "15" }),
  new RegExp(`current object content is not the approved known state.*observed manifest SHA-256: ${foreignManifestSha}`),
);
assert.equal(correctionStorageCalls.filter(({ method }) => method === "PUT").length, correctionPutCountBeforeForeignContent);
assert.equal(correctionArchiveBytes.equals(correctionArchiveBefore), true);

correctionSqlRow = batch15ExactSqlRow;
correctionActiveRow = batch15Row;
correctionManifestGzipBytes = Buffer.from(knownBadBatch15ManifestGzip);
correctionPutCompleted = false;
correctionVerificationResponses = [knownBadBatch15ManifestGzip, knownBadBatch15ManifestGzip];
const correctionPutCountBeforeStale = correctionStorageCalls.filter(({ method }) => method === "PUT").length;
await assert.rejects(
  runBotOnlyRecoveryRepair({ env: ENV, deps: correctionDeps, batchId: "15" }),
  new RegExp(`did not become visible.*observed SHA-256: ${BOT_ONLY_BATCH_15_RECOVERY_REPAIR.currentRecoveryManifestSha256}`),
);
assert.equal(correctionStorageCalls.filter(({ method }) => method === "PUT").length, correctionPutCountBeforeStale + 1);
assert.equal(correctionStorageCalls.filter(({ method }) => method === "PUT").length, correctionPutCountBeforeStale + 1, "stale reads must never trigger a second PUT");
assert.deepEqual(correctionStorageCalls.slice(-4).map(({ method }) => method), ["GET", "PUT", "GET", "GET"]);
assert.equal(correctionArchiveBytes.equals(correctionArchiveBefore), true);

const thirdManifest = gzipRecoveryManifestForTest({ third: true });
const thirdManifestSha = crypto.createHash("sha256").update(thirdManifest).digest("hex");
correctionManifestGzipBytes = Buffer.from(knownBadBatch15ManifestGzip);
correctionPutCompleted = false;
correctionVerificationResponses = [thirdManifest];
const correctionPutCountBeforeThirdSha = correctionStorageCalls.filter(({ method }) => method === "PUT").length;
await assert.rejects(
  runBotOnlyRecoveryRepair({ env: ENV, deps: correctionDeps, batchId: "15" }),
  new RegExp(`unapproved content.*observed SHA-256: ${thirdManifestSha}`),
);
assert.equal(correctionStorageCalls.filter(({ method }) => method === "PUT").length, correctionPutCountBeforeThirdSha + 1);
assert.deepEqual(correctionStorageCalls.slice(-3).map(({ method }) => method), ["GET", "PUT", "GET"]);
assert.equal(correctionArchiveBytes.equals(correctionArchiveBefore), true);
assert.equal(correctionSqlCalls.some(({ query }) => /\b(?:insert|update|delete|truncate)\b/i.test(query)), false);
fs.rmSync(correctionTempRoot, { recursive: true, force: true });
fs.rmSync(repairTempRoot, { recursive: true, force: true });

// Stage 30-day proven/unpruned recovery repair (fundamental read-only repair cases).
const stage30ArchiveBytes = Buffer.from("stage 30-day proven recovery archive");
const stage30CompressedSha = crypto.createHash("sha256").update(stage30ArchiveBytes).digest("hex");

function makeStage30Row(overrides = {}) {
  return {
    object_path: `v1/sha256/${stage30CompressedSha}.jsonl.gz`,
    project_ref: STAGE_PROJECT_REF,
    source_policy_id: STAGE_AUTOMATION_POLICY_ID,
    status: "committed",
    batch_id: "33",
    format_version: 1,
    cutoff: "2026-08-01T00:00:00.000000Z",
    cursor_start_created_at: null,
    cursor_start_id: null,
    cursor_end_created_at: "2026-07-01T00:00:00.000000Z",
    cursor_end_id: "00000000-0000-4000-8000-000000000033",
    first_created_at: "2026-07-01T00:00:00.000000Z",
    last_created_at: "2026-07-01T00:00:00.000000Z",
    transaction_count: 1,
    entry_count: 2,
    tx_types: { TABLE_BUY_IN: 1 },
    raw_bytes: 100,
    compressed_bytes: stage30ArchiveBytes.length,
    raw_sha256: "a".repeat(64),
    compressed_sha256: stage30CompressedSha,
    credits: "100",
    debits: "100",
    net_amount: "0",
    committed_at: "2026-08-13T00:00:00.000000Z",
    archive_proof_verified_at: "2026-08-13T00:01:00.000000Z",
    archived_transaction_ids_sha256: evidence.transactionIdsSha256,
    archived_entry_ids_sha256: evidence.entryIdsSha256,
    pruned_at: null,
    pruned_transaction_count: null,
    pruned_entry_count: null,
    pruned_transaction_ids_sha256: null,
    pruned_entry_ids_sha256: null,
    registry_cleaned_at: null,
    registry_cleaned_key_count: null,
    registry_cleaned_keys_sha256: null,
    destructive_go_at: null,
    destructive_go_batch_id: null,
    ...overrides,
  };
}

function makeStage30Harness({ row = makeStage30Row(), objects = new Map(), exactRows = undefined } = {}) {
  const stage30Objects = objects;
  const stage30StorageCalls = [];
  const stage30PruneCalls = [];
  const stage30SqlCalls = [];
  const stage30Session = { backendPid: "stage-30d-recovery-session" };
  const stage30Fetch = async (url, init = {}) => {
    const requestUrl = new URL(url);
    const authenticatedPrefix = `/storage/v1/object/authenticated/${ARCHIVE_BUCKET}/`;
    const uploadPrefix = `/storage/v1/object/${ARCHIVE_BUCKET}/`;
    const prefix = requestUrl.pathname.startsWith(authenticatedPrefix) ? authenticatedPrefix : uploadPrefix;
    const objectPath = decodeURIComponent(requestUrl.pathname.slice(prefix.length));
    const method = init.method || "GET";
    stage30StorageCalls.push({ method, objectPath, headers: new Headers(init.headers || {}) });
    if (method === "GET") {
      if (objectPath === row.object_path) return response(stage30ArchiveBytes);
      const value = stage30Objects.get(objectPath);
      return value ? response(value) : response({ message: "not found" }, 404);
    }
    if (method === "POST") {
      assert.equal(new Headers(init.headers).get("x-upsert"), "false");
      assert.equal(new Headers(init.headers).get("content-type"), "application/gzip");
      stage30Objects.set(objectPath, Buffer.from(init.body));
      return response({ ok: true });
    }
    return response({ message: "unexpected stage-30d method" }, 500);
  };
  const exactReturn = exactRows === undefined ? [exactSqlTextRow(row)] : exactRows;
  const stage30Sql = {
    typed: (value, type) => ({ value, type }),
    unsafe: async (query, values = []) => {
      stage30SqlCalls.push({ query, values });
      if (query.includes("pg_try_advisory_lock")) return [{ acquired: true, backend_pid: stage30Session.backendPid }];
      if (query.includes("pg_backend_pid")) return [{ backend_pid: stage30Session.backendPid }];
      if (query.includes("pg_advisory_unlock")) return [{ pg_advisory_unlock: true }];
      if (query.includes("pg_control_system")) return [{ system_identifier: STAGE_SYSTEM_IDENTIFIER }];
      if (query.includes("where batch_id = $1")) return exactReturn;
      throw new Error(`unexpected stage-30d SQL: ${query}`);
    },
    begin: async (callback) => callback({
      unsafe: async (query, values = []) => {
        if (query.startsWith("set transaction")) return [];
        return stage30Sql.unsafe(query, values);
      },
    }),
  };
  const tempRoot = fs.mkdtempSync("/tmp/chips-ledger-stage-30d-repair-test-");
  const stage30Deps = {
    sql: stage30Sql,
    storageTarget,
    tempRoot,
    pruneStore: {
      getManifest: async () => row,
    },
    verifyBucket: async () => {},
    pruneArchive: async ({ argv }) => {
      stage30PruneCalls.push([...argv]);
      assert.equal(argv.includes("--execute"), false);
      assert.equal(argv.includes("--register-proof"), false);
      assert.equal(argv.includes("--automatic"), false);
      return { state: "ready", evidence, archiveSha256: stage30CompressedSha };
    },
    fetch: stage30Fetch,
  };
  return {
    deps: stage30Deps,
    row,
    objects: stage30Objects,
    storageCalls: stage30StorageCalls,
    pruneCalls: stage30PruneCalls,
    sqlCalls: stage30SqlCalls,
    tempRoot,
  };
}

const stage30HappyHarness = makeStage30Harness();
const stage30Happy = await runStageExactRecoveryRepair({
  env: ENV,
  deps: stage30HappyHarness.deps,
  batchId: "33",
});
assert.equal(stage30Happy.state, "recovery_repaired");
assert.equal(stage30Happy.batchId, "33");
assert.equal(stage30Happy.objectPath, stage30HappyHarness.row.object_path);
assert.equal(stage30Happy.compressedSha256, stage30CompressedSha);
assert.equal(stage30Happy.initialRecoveryState, "both_missing");
assert.equal(stage30Happy.recoveryState, "complete");
assert.equal(stage30Happy.recoveryVerified, true);
assert.equal(stage30Happy.storageModified, true);
assert.equal(stage30HappyHarness.objects.has(buildRecoveryArchiveObjectPath(stage30CompressedSha)), true);
assert.equal(stage30HappyHarness.objects.has(buildRecoveryManifestObjectPath(stage30CompressedSha)), true);
assert.equal(stage30HappyHarness.storageCalls.filter(({ method }) => method === "POST").length, 2);
assert.equal(stage30HappyHarness.storageCalls.filter(({ method }) => method === "PUT").length, 0);
assert.equal(stage30HappyHarness.pruneCalls.length, 1);
assert.equal(stage30HappyHarness.pruneCalls[0].includes("--execute"), false);
assert.equal(
  stage30HappyHarness.sqlCalls.filter(({ query }) => query.includes("where batch_id = $1")).length,
  2,
  "repair must re-load the exact batch from DB after the dry-run and before the first Storage write",
);
assert.equal(stage30HappyHarness.sqlCalls.some(({ query }) => /\b(?:insert|update|delete|truncate)\b/i.test(query)), false);
assert.equal(stage30HappyHarness.row.pruned_at, null);
assert.equal(stage30HappyHarness.row.registry_cleaned_at, null);
assert.equal(stage30HappyHarness.row.destructive_go_at, null);

const closedHumanStage30HappyHarness = makeStage30Harness({
  row: makeStage30Row({ source_policy_id: CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID }),
});
const closedHumanStage30Happy = await runStageExactRecoveryRepair({
  env: ENV,
  deps: closedHumanStage30HappyHarness.deps,
  batchId: "33",
  sourcePolicyId: CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID,
});
assert.equal(closedHumanStage30Happy.state, "recovery_repaired");
assert.equal(closedHumanStage30Happy.sourcePolicyId, CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID);
assert.equal(closedHumanStage30Happy.batchId, "33");
assert.equal(closedHumanStage30Happy.objectPath, closedHumanStage30HappyHarness.row.object_path);
assert.equal(closedHumanStage30Happy.initialRecoveryState, "both_missing");
assert.equal(closedHumanStage30Happy.recoveryState, "complete");
assert.equal(closedHumanStage30Happy.recoveryVerified, true);
assert.equal(closedHumanStage30Happy.storageModified, true);
assert.equal(closedHumanStage30HappyHarness.objects.has(buildRecoveryArchiveObjectPath(stage30CompressedSha)), true);
assert.equal(closedHumanStage30HappyHarness.objects.has(buildRecoveryManifestObjectPath(stage30CompressedSha)), true);
assert.equal(closedHumanStage30HappyHarness.storageCalls.filter(({ method }) => method === "POST").length, 2);
assert.equal(closedHumanStage30HappyHarness.storageCalls.filter(({ method }) => method === "PUT").length, 0);
assert.equal(closedHumanStage30HappyHarness.pruneCalls.length, 1);
assert.equal(closedHumanStage30HappyHarness.pruneCalls[0].includes("--execute"), false);
assert.equal(closedHumanStage30HappyHarness.row.pruned_at, null);
assert.equal(closedHumanStage30HappyHarness.row.registry_cleaned_at, null);
assert.equal(closedHumanStage30HappyHarness.row.destructive_go_at, null);

const closedHumanWrongPolicyHarness = makeStage30Harness();
await assert.rejects(
  runStageExactRecoveryRepair({
    env: ENV,
    deps: closedHumanWrongPolicyHarness.deps,
    batchId: "33",
    sourcePolicyId: CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID,
  }),
  /policy mismatch/,
);
assert.equal(closedHumanWrongPolicyHarness.storageCalls.length, 0);

const closedHumanWrongBatchHarness = makeStage30Harness({
  row: makeStage30Row({ source_policy_id: CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID, batch_id: "34" }),
});
await assert.rejects(
  runStageExactRecoveryRepair({
    env: ENV,
    deps: closedHumanWrongBatchHarness.deps,
    batchId: "33",
    sourcePolicyId: CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID,
  }),
  /identity mismatch/,
);
assert.equal(closedHumanWrongBatchHarness.storageCalls.length, 0);

const closedHumanWrongObjectHarness = makeStage30Harness({
  row: makeStage30Row({
    source_policy_id: CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID,
    object_path: `v1/sha256/${"f".repeat(64)}.jsonl.gz`,
  }),
});
await assert.rejects(
  runStageExactRecoveryRepair({
    env: ENV,
    deps: closedHumanWrongObjectHarness.deps,
    batchId: "33",
    sourcePolicyId: CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID,
  }),
  /object path does not match its compressed hash/,
);
assert.equal(closedHumanWrongObjectHarness.storageCalls.length, 0);

const stage30PartialHarness = makeStage30Harness({
  objects: new Map([[buildRecoveryArchiveObjectPath(stage30CompressedSha), stage30ArchiveBytes]]),
});
await assert.rejects(
  runStageExactRecoveryRepair({ env: ENV, deps: stage30PartialHarness.deps, batchId: "33" }),
  /partial/,
);
assert.equal(stage30PartialHarness.pruneCalls.length, 0, "partial recovery must fail before dry-run");
assert.equal(stage30PartialHarness.storageCalls.filter(({ method }) => method === "POST").length, 0);
const stage30MismatchHarness = makeStage30Harness({
  objects: new Map([
    [buildRecoveryArchiveObjectPath(stage30CompressedSha), stage30ArchiveBytes],
    [buildRecoveryManifestObjectPath(stage30CompressedSha), gzipRecoveryManifestForTest({ foreign: true })],
  ]),
});
await assert.rejects(
  runStageExactRecoveryRepair({ env: ENV, deps: stage30MismatchHarness.deps, batchId: "33" }),
  /manifest differs|state is mismatch/,
);
assert.equal(stage30MismatchHarness.pruneCalls.length, 0, "mismatched recovery must fail before dry-run");
assert.equal(stage30MismatchHarness.storageCalls.filter(({ method }) => method === "POST").length, 0);

const stage30PrunedRow = makeStage30Row({
  pruned_at: "2026-08-13T00:02:00.000000Z",
  pruned_transaction_count: 1,
  pruned_entry_count: 2,
  pruned_transaction_ids_sha256: evidence.transactionIdsSha256,
  pruned_entry_ids_sha256: evidence.entryIdsSha256,
});
const stage30PrunedHarness = makeStage30Harness({ row: stage30PrunedRow });
await assert.rejects(
  runStageExactRecoveryRepair({ env: ENV, deps: stage30PrunedHarness.deps, batchId: "33" }),
  /requires an unpruned/,
);
assert.equal(stage30PrunedHarness.storageCalls.length, 0);
assert.equal(stage30PrunedHarness.pruneCalls.length, 0);

const stage30NotFoundHarness = makeStage30Harness({ exactRows: [] });
await assert.rejects(
  runStageExactRecoveryRepair({ env: ENV, deps: stage30NotFoundHarness.deps, batchId: "99" }),
  /was not found/,
);
assert.equal(stage30NotFoundHarness.storageCalls.length, 0);
const stage30WrongPolicyHarness = makeStage30Harness({
  row: makeStage30Row({ source_policy_id: BOT_ONLY_RETENTION_POLICY_ID }),
});
await assert.rejects(
  runStageExactRecoveryRepair({ env: ENV, deps: stage30WrongPolicyHarness.deps, batchId: "33" }),
  /policy mismatch/,
);
assert.equal(stage30WrongPolicyHarness.storageCalls.length, 0);
const stage30WrongShaHarness = makeStage30Harness({
  row: makeStage30Row({ compressed_sha256: "f".repeat(64) }),
});
await assert.rejects(
  runStageExactRecoveryRepair({ env: ENV, deps: stage30WrongShaHarness.deps, batchId: "33" }),
  /object path does not match its compressed hash/,
);
assert.equal(stage30WrongShaHarness.storageCalls.length, 0);

const stage30DiagnosticHarness = makeStage30Harness();
const stage30Diagnostic = await runStageRecoveryDiagnostic({
  env: ENV,
  deps: stage30DiagnosticHarness.deps,
  batchId: "33",
});
assert.equal(stage30Diagnostic.state, "diagnosed");
assert.equal(stage30Diagnostic.batch_id, "33");
assert.equal(stage30Diagnostic.compressed_sha256, stage30CompressedSha);
assert.equal(stage30Diagnostic.recovery.state, "both_missing");
assert.equal(stage30Diagnostic.recovery_archive_path, buildRecoveryArchiveObjectPath(stage30CompressedSha));
assert.equal(stage30Diagnostic.recovery_manifest_path, buildRecoveryManifestObjectPath(stage30CompressedSha));
assert.equal(stage30Diagnostic.main_archive.present, true);
assert.equal(stage30Diagnostic.main_archive.sha256_matches, true);
assert.equal(stage30Diagnostic.assert_resume_recovery_state.ok, false);
assert.equal(stage30Diagnostic.read_only, true);
assert.equal(stage30DiagnosticHarness.storageCalls.filter(({ method }) => method === "POST").length, 0);
assert.equal(stage30DiagnosticHarness.storageCalls.filter(({ method }) => method === "PUT").length, 0);

const ambiguousDiagnosticRows = [
  makeStage30Row({ batch_id: "34" }),
  makeStage30Row({ batch_id: "35" }),
];
const ambiguousDiagnosticSql = fakeSql({ ownRows: ambiguousDiagnosticRows });
const ambiguousDiagnostic = await runStageRecoveryDiagnostic({
  env: ENV,
  deps: {
    sql: ambiguousDiagnosticSql,
    storageTarget,
    pruneStore: {},
    verifyBucket: async () => { throw new Error("ambiguous diagnostic must not access Storage"); },
  },
});
assert.equal(ambiguousDiagnostic.state, "ambiguous");
assert.equal(ambiguousDiagnostic.reason, "multiple_incomplete_30d_cycles");
assert.deepEqual(ambiguousDiagnostic.batch_ids, ["34", "35"]);
assert.equal(ambiguousDiagnostic.repair_target_suggested, false);
assert.equal(ambiguousDiagnostic.candidate_batches.length, 2);
assert.equal(ambiguousDiagnostic.read_only, true);

for (const harness of [
  stage30HappyHarness,
  stage30PartialHarness,
  stage30MismatchHarness,
  stage30PrunedHarness,
  stage30NotFoundHarness,
  stage30WrongPolicyHarness,
  stage30WrongShaHarness,
  stage30DiagnosticHarness,
]) {
  fs.rmSync(harness.tempRoot, { recursive: true, force: true });
}

const resumeCycleRow = {
  ...recoveryRow,
  status: "committed",
  committed_at: "2026-08-13T00:00:00.000000Z",
  archive_proof_verified_at: "2026-08-13T00:01:00.000000Z",
  archived_transaction_ids_sha256: evidence.transactionIdsSha256,
  archived_entry_ids_sha256: evidence.entryIdsSha256,
  pruned_at: null,
  pruned_transaction_count: null,
  pruned_entry_count: null,
  pruned_transaction_ids_sha256: null,
  pruned_entry_ids_sha256: null,
};
const resumeCalls = [];
const resumeSql = fakeSql({ ownRows: [resumeCycleRow] });
const resumeResult = await runStageAutomation({
  env: ENV,
  deps: {
    sql: resumeSql,
    fetch,
    storageTarget,
    pruneStore: { getManifest: async () => resumeCycleRow },
    verifyBucket: async () => {},
    tempRoot: fs.mkdtempSync("/tmp/chips-ledger-stage-automation-resume-"),
    pruneArchive: async ({ argv }) => {
      const mode = argv.includes("--execute") ? "execute" : argv.includes("--register-proof") ? "register-proof" : "dry-run";
      resumeCalls.push(mode);
      if (mode === "register-proof") throw new Error("proof must not be re-registered on a proven resume");
      return { state: "already_pruned", evidence };
    },
  },
});
assert.equal(resumeResult.state, "already_pruned");
assert.deepEqual(resumeCalls, ["dry-run", "execute"]);

const closedHumanResumeRow = {
  ...resumeCycleRow,
  source_policy_id: CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID,
};
durableObjects.set(
  buildRecoveryManifestObjectPath(compressedSha),
  gzipRecoveryManifestForTest(buildRecoveryManifest(closedHumanResumeRow, STAGE_SYSTEM_IDENTIFIER, evidence, { target: "stage" })),
);
const closedHumanResumeCalls = [];
const closedHumanResumeResult = await runClosedHumanTableStagePrepare({
  env: ENV,
  deps: {
    sql: fakeSql({ ownRows: [closedHumanResumeRow] }),
    fetch,
    storageTarget,
    pruneStore: { getManifest: async () => closedHumanResumeRow },
    verifyBucket: async () => {},
    tempRoot: fs.mkdtempSync("/tmp/chips-ledger-stage-automation-closed-human-resume-"),
    pruneArchive: async ({ argv }) => {
      const mode = argv.includes("--execute") ? "execute" : argv.includes("--register-proof") ? "register-proof" : "dry-run";
      closedHumanResumeCalls.push(mode);
      assert.equal(mode, "dry-run");
      return { state: "already_pruned", evidence };
    },
  },
});
assert.equal(closedHumanResumeResult.state, "prepared", "closed-human prepare must stay recovery-only while resuming an own cycle");
assert.equal(closedHumanResumeResult.sourcePolicyId, CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID);
assert.deepEqual(closedHumanResumeCalls, ["dry-run"]);
assert.equal(closedHumanResumeRow.pruned_at, null);
assert.equal(closedHumanResumeRow.registry_cleaned_at ?? null, null);
assert.equal(closedHumanResumeRow.destructive_go_at ?? null, null);

const closedHumanCanaryArchiveBytes = Buffer.from("exact closed-human canary recovery archive");
const closedHumanCanaryCompressedSha = crypto.createHash("sha256").update(closedHumanCanaryArchiveBytes).digest("hex");
const closedHumanCanaryEvidence = {
  transactionIdsSha256: "1".repeat(64),
  entryIdsSha256: "2".repeat(64),
  transactionCount: 2,
  entryCount: 4,
  txTypes: { TABLE_BUY_IN: 1, TABLE_CASH_OUT: 1 },
  credits: "200",
  debits: "200",
  net: "0",
  userTransactions: 2,
  userEntries: 2,
  distinctTables: 1,
  closedHumanTableId: "00000000-0000-4000-8000-000000000034",
};

function makeClosedHumanCanaryRow(overrides = {}) {
  return {
    object_path: `v1/sha256/${closedHumanCanaryCompressedSha}.jsonl.gz`,
    project_ref: STAGE_PROJECT_REF,
    source_policy_id: CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID,
    status: "committed",
    batch_id: "334",
    format_version: 1,
    cutoff: "2026-08-13T00:00:00.000000Z",
    cursor_start_created_at: null,
    cursor_start_id: null,
    cursor_end_created_at: "2026-08-12T00:00:00.000000Z",
    cursor_end_id: "00000000-0000-4000-8000-000000000033",
    first_created_at: "2026-08-12T00:00:00.000000Z",
    last_created_at: "2026-08-12T00:00:00.000000Z",
    transaction_count: 2,
    entry_count: 4,
    tx_types: { TABLE_BUY_IN: 1, TABLE_CASH_OUT: 1 },
    raw_bytes: 200,
    compressed_bytes: closedHumanCanaryArchiveBytes.length,
    raw_sha256: "3".repeat(64),
    compressed_sha256: closedHumanCanaryCompressedSha,
    credits: "200",
    debits: "200",
    net_amount: "0",
    committed_at: "2026-08-13T00:01:00.000000Z",
    archive_proof_verified_at: "2026-08-13T00:02:00.000000Z",
    archived_transaction_ids_sha256: closedHumanCanaryEvidence.transactionIdsSha256,
    archived_entry_ids_sha256: closedHumanCanaryEvidence.entryIdsSha256,
    pruned_at: null,
    pruned_transaction_count: null,
    pruned_entry_count: null,
    pruned_transaction_ids_sha256: null,
    pruned_entry_ids_sha256: null,
    registry_cleaned_at: null,
    registry_cleaned_key_count: null,
    registry_cleaned_keys_sha256: null,
    destructive_go_at: null,
    destructive_go_batch_id: null,
    ...overrides,
  };
}

function makeClosedHumanCanaryHarness({ row = makeClosedHumanCanaryRow(), exactRows = undefined, recovery = true } = {}) {
  const calls = {
    authorization: 0,
    execute: 0,
    lifecycle: 0,
    recoveryInspection: 0,
    verifyBucket: 0,
    export: 0,
    store: 0,
  };
  const pruneCalls = [];
  const manifest = buildRecoveryManifest(row, STAGE_SYSTEM_IDENTIFIER, closedHumanCanaryEvidence, { target: "stage" });
  const manifestBytes = Buffer.from(`${stringifyJson(manifest)}\n`, "utf8");
  const manifestGzipBytes = gzipRecoveryManifestForTest(manifest);
  const durable = {
    archiveBytes: closedHumanCanaryArchiveBytes,
    manifestGzipBytes,
    manifestBytes,
    manifest,
    archivePath: buildRecoveryArchiveObjectPath(closedHumanCanaryCompressedSha),
    manifestPath: buildRecoveryManifestObjectPath(closedHumanCanaryCompressedSha),
    archiveSha256: closedHumanCanaryCompressedSha,
    manifestSha256: crypto.createHash("sha256").update(manifestGzipBytes).digest("hex"),
    recoveryArchive: { sha256: closedHumanCanaryCompressedSha },
    recoveryManifest: { sha256: crypto.createHash("sha256").update(manifestGzipBytes).digest("hex") },
  };
  const exactReturn = exactRows === undefined ? [exactSqlTextRow(row)] : exactRows;
  const session = { backendPid: "closed-human-canary-session" };
  const sql = {
    typed: (value, type) => ({ value, type }),
    unsafe: async (query, values = []) => {
      if (query.includes("pg_try_advisory_lock")) return [{ acquired: true, backend_pid: session.backendPid }];
      if (query.includes("pg_backend_pid")) return [{ backend_pid: session.backendPid }];
      if (query.includes("pg_advisory_unlock")) return [{ pg_advisory_unlock: true }];
      if (query.includes("pg_control_system")) return [{ system_identifier: STAGE_SYSTEM_IDENTIFIER }];
      if (query.includes("where batch_id = $1")) return exactReturn;
      throw new Error(`unexpected closed-human canary SQL: ${query}`);
    },
    begin: async (callback) => callback({
      unsafe: async (query, values = []) => {
        if (query.startsWith("set transaction")) return [];
        return sql.unsafe(query, values);
      },
    }),
  };
  const pruneStore = {
    getManifest: async () => row,
    async authorizeClosedHumanBatch(batchId, confirmation) {
      calls.authorization += 1;
      assert.equal(String(batchId), "334");
      assert.equal(confirmation, "GO 334");
      row.destructive_go_at = "2026-08-13T00:03:00.000000Z";
      row.destructive_go_batch_id = "334";
      return {
        state: "authorized",
        batch_id: "334",
        object_path: row.object_path,
        source_policy_id: CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID,
      };
    },
    async assertClosedHumanLifecycle(tableId, cutoff, batchId) {
      calls.lifecycle += 1;
      assert.equal(tableId, closedHumanCanaryEvidence.closedHumanTableId);
      assert.equal(cutoff, row.cutoff);
      assert.equal(String(batchId), "334");
      return { state: "verified", table_id: tableId, batch_id: "334" };
    },
  };
  const deps = {
    sql,
    storageTarget,
    tempRoot: fs.mkdtempSync("/tmp/chips-ledger-stage-closed-human-canary-test-"),
    pruneStore,
    verifyBucket: async () => { calls.verifyBucket += 1; },
    inspectDurableRecovery: async () => {
      calls.recoveryInspection += 1;
      return recovery ? durable : null;
    },
    exportArchive: async () => { calls.export += 1; throw new Error("exact closed-human execute must not export"); },
    ensureArchiveBucket: async () => { calls.store += 1; throw new Error("exact closed-human execute must not prepare Storage"); },
    storeArchive: async () => { calls.store += 1; throw new Error("exact closed-human execute must not store a new manifest"); },
    pruneArchive: async ({ argv }) => {
      const execute = argv.includes("--execute");
      pruneCalls.push({ argv: [...argv], execute });
      assert.equal(argv.includes("--automatic"), false);
      if (!execute) return { state: "ready", evidence: closedHumanCanaryEvidence, archiveSha256: closedHumanCanaryCompressedSha };
      calls.execute += 1;
      row.pruned_at = "2026-08-13T00:04:00.000000Z";
      row.pruned_transaction_count = 2;
      row.pruned_entry_count = 4;
      row.pruned_transaction_ids_sha256 = closedHumanCanaryEvidence.transactionIdsSha256;
      row.pruned_entry_ids_sha256 = closedHumanCanaryEvidence.entryIdsSha256;
      return { state: "pruned", evidence: closedHumanCanaryEvidence };
    },
  };
  return { deps, row, durable, calls, pruneCalls };
}

const closedHumanCanaryHarness = makeClosedHumanCanaryHarness();
assert.equal(assertClosedHumanExecuteBatch(closedHumanCanaryHarness.row, "334", STAGE_SYSTEM_IDENTIFIER).hasExactGo, false);
assert.equal(assertClosedHumanActiveManifestMatch(
  closedHumanCanaryHarness.row,
  closedHumanCanaryHarness.row,
  "334",
), true);
const closedHumanCanaryResult = await runClosedHumanTableStageCanary({
  env: { ...ENV, CHIPS_LEDGER_CLOSED_HUMAN_EXECUTE: "1" },
  deps: closedHumanCanaryHarness.deps,
  approvedBatchId: "334",
  approvedBatchConfirmation: "GO 334",
});
assert.equal(closedHumanCanaryResult.state, "pruned");
assert.equal(closedHumanCanaryResult.batchId, "334");
assert.equal(closedHumanCanaryResult.sourcePolicyId, CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID);
assert.equal(closedHumanCanaryResult.dryRun, "ready");
assert.equal(closedHumanCanaryResult.proof, "verified");
assert.equal(closedHumanCanaryResult.humanIdempotencyRegistryPreserved, true);
assert.equal(closedHumanCanaryResult.automaticActivation, false);
assert.equal(closedHumanCanaryHarness.calls.authorization, 1);
assert.equal(closedHumanCanaryHarness.calls.execute, 1);
assert.equal(closedHumanCanaryHarness.calls.recoveryInspection, 1);
assert.equal(closedHumanCanaryHarness.calls.lifecycle, 1);
assert.equal(closedHumanCanaryHarness.calls.export, 0);
assert.equal(closedHumanCanaryHarness.calls.store, 0);
assert.deepEqual(closedHumanCanaryHarness.pruneCalls.map(({ execute }) => execute), [false, true]);
assert.equal(closedHumanCanaryHarness.pruneCalls[1].argv.includes("--approved-batch-id"), true);
assert.equal(closedHumanCanaryHarness.pruneCalls[1].argv.includes("334"), true);
assert.equal(closedHumanCanaryHarness.row.registry_cleaned_at, null);

const closedHumanCanaryWrongBatchHarness = makeClosedHumanCanaryHarness({ exactRows: [] });
await assert.rejects(
  runClosedHumanTableStageCanary({
    env: { ...ENV, CHIPS_LEDGER_CLOSED_HUMAN_EXECUTE: "1" },
    deps: closedHumanCanaryWrongBatchHarness.deps,
    approvedBatchId: "334",
    approvedBatchConfirmation: "GO 334",
  }),
  /was not found/,
);
assert.equal(closedHumanCanaryWrongBatchHarness.calls.authorization, 0);
assert.equal(closedHumanCanaryWrongBatchHarness.calls.execute, 0);
assert.equal(closedHumanCanaryWrongBatchHarness.calls.verifyBucket, 0);

const closedHumanCanaryWrongPolicyHarness = makeClosedHumanCanaryHarness({
  row: makeClosedHumanCanaryRow({ source_policy_id: BOT_ONLY_RETENTION_POLICY_ID }),
});
await assert.rejects(
  runClosedHumanTableStageCanary({
    env: { ...ENV, CHIPS_LEDGER_CLOSED_HUMAN_EXECUTE: "1" },
    deps: closedHumanCanaryWrongPolicyHarness.deps,
    approvedBatchId: "334",
    approvedBatchConfirmation: "GO 334",
  }),
  /policy mismatch/,
);
assert.equal(closedHumanCanaryWrongPolicyHarness.calls.authorization, 0);
assert.equal(closedHumanCanaryWrongPolicyHarness.calls.execute, 0);

const closedHumanCanaryWrongObjectHarness = makeClosedHumanCanaryHarness({
  row: makeClosedHumanCanaryRow({ object_path: `v1/sha256/${"f".repeat(64)}.jsonl.gz` }),
});
await assert.rejects(
  runClosedHumanTableStageCanary({
    env: { ...ENV, CHIPS_LEDGER_CLOSED_HUMAN_EXECUTE: "1" },
    deps: closedHumanCanaryWrongObjectHarness.deps,
    approvedBatchId: "334",
    approvedBatchConfirmation: "GO 334",
  }),
  /object path does not match its compressed hash/,
);
assert.equal(closedHumanCanaryWrongObjectHarness.calls.authorization, 0);
assert.equal(closedHumanCanaryWrongObjectHarness.calls.execute, 0);

const closedHumanWrongGoHarness = makeClosedHumanCanaryHarness({
  row: makeClosedHumanCanaryRow({
    destructive_go_at: "2026-08-13T00:03:00.000000Z",
    destructive_go_batch_id: "335",
  }),
});
await assert.rejects(
  runClosedHumanTableStageCanary({
    env: { ...ENV, CHIPS_LEDGER_CLOSED_HUMAN_EXECUTE: "1" },
    deps: closedHumanWrongGoHarness.deps,
    approvedBatchId: "334",
    approvedBatchConfirmation: "GO 334",
  }),
  /foreign destructive GO/,
);
assert.equal(closedHumanWrongGoHarness.calls.authorization, 0);
assert.equal(closedHumanWrongGoHarness.calls.execute, 0);

const closedHumanMissingRecoveryHarness = makeClosedHumanCanaryHarness({ recovery: false });
await assert.rejects(
  runClosedHumanTableStageCanary({
    env: { ...ENV, CHIPS_LEDGER_CLOSED_HUMAN_EXECUTE: "1" },
    deps: closedHumanMissingRecoveryHarness.deps,
    approvedBatchId: "334",
    approvedBatchConfirmation: "GO 334",
  }),
  /no durable recovery/,
);
assert.equal(closedHumanMissingRecoveryHarness.calls.authorization, 0);
assert.equal(closedHumanMissingRecoveryHarness.calls.execute, 0);
assert.equal(closedHumanMissingRecoveryHarness.pruneCalls.length, 1, "missing recovery may dry-run but must not authorize or execute");

const closedHumanWrongConfirmationHarness = makeClosedHumanCanaryHarness();
await assert.rejects(
  runClosedHumanTableStageCanary({
    env: { ...ENV, CHIPS_LEDGER_CLOSED_HUMAN_EXECUTE: "1" },
    deps: closedHumanWrongConfirmationHarness.deps,
    approvedBatchId: "334",
    approvedBatchConfirmation: "GO 335",
  }),
  /exact GO <batch_id>/,
);
assert.equal(closedHumanWrongConfirmationHarness.calls.authorization, 0);
assert.equal(closedHumanWrongConfirmationHarness.calls.execute, 0);

const lifecycleEvidence = {
  ...closedHumanCanaryEvidence,
  closedHumanTableId: CLOSED_HUMAN_LIFECYCLE_COMPLETION_TARGET.tableId,
};

function makeClosedHumanLifecycleRow(overrides = {}) {
  const row = makeClosedHumanCanaryRow({
    cutoff: CLOSED_HUMAN_LIFECYCLE_COMPLETION_TARGET.cutoff,
    destructive_go_at: "2026-08-13T00:03:00.000000Z",
    destructive_go_batch_id: "334",
    pruned_at: "2026-08-13T00:04:00.000000Z",
    pruned_transaction_count: 2,
    pruned_entry_count: 4,
    pruned_transaction_ids_sha256: lifecycleEvidence.transactionIdsSha256,
    pruned_entry_ids_sha256: lifecycleEvidence.entryIdsSha256,
    ...overrides,
  });
  return row;
}

function makeClosedHumanLifecycleHarness({ row = makeClosedHumanLifecycleRow(), recovery = true } = {}) {
  const calls = {
    completion: 0,
    lifecycleGate: 0,
    recoveryInspection: 0,
    verifyBucket: 0,
  };
  const pruneCalls = [];
  const state = { marker: null };
  const manifest = buildRecoveryManifest(row, STAGE_SYSTEM_IDENTIFIER, lifecycleEvidence, { target: "stage" });
  const manifestBytes = Buffer.from(`${stringifyJson(manifest)}\n`, "utf8");
  const manifestGzipBytes = gzipRecoveryManifestForTest(manifest);
  const compressedSha = row.compressed_sha256;
  const durable = {
    archiveBytes: closedHumanCanaryArchiveBytes,
    manifestGzipBytes,
    manifestBytes,
    manifest,
    archivePath: buildRecoveryArchiveObjectPath(compressedSha),
    manifestPath: buildRecoveryManifestObjectPath(compressedSha),
    archiveSha256: compressedSha,
    manifestSha256: crypto.createHash("sha256").update(manifestGzipBytes).digest("hex"),
    recoveryArchive: { sha256: compressedSha },
    recoveryManifest: { sha256: crypto.createHash("sha256").update(manifestGzipBytes).digest("hex") },
  };
  const exactReturn = [exactSqlTextRow(row)];
  const session = { backendPid: "closed-human-lifecycle-session" };
  const sql = {
    unsafe: async (query, values = []) => {
      if (query.includes("pg_try_advisory_lock")) return [{ acquired: true, backend_pid: session.backendPid }];
      if (query.includes("pg_backend_pid")) return [{ backend_pid: session.backendPid }];
      if (query.includes("pg_advisory_unlock")) return [{ pg_advisory_unlock: true }];
      if (query.includes("pg_control_system")) return [{ system_identifier: STAGE_SYSTEM_IDENTIFIER }];
      if (query.startsWith("set local")) return [];
      if (query.includes("from public.chips_ledger_archive_batches")) return exactReturn;
      if (query.includes("from public.poker_tables")) {
        return [{ table_id: CLOSED_HUMAN_LIFECYCLE_COMPLETION_TARGET.tableId, human_retention_complete_at: state.marker }];
      }
      if (query.includes("chips_assert_closed_human_table_lifecycle_gate")) {
        calls.lifecycleGate += 1;
        return [];
      }
      if (query.includes("chips_complete_closed_human_table_retention")) {
        calls.completion += 1;
        if (state.marker == null) state.marker = "2026-09-05 00:00:00+00";
        return [{
          result: {
            state: "human_retention_complete",
            table_id: CLOSED_HUMAN_LIFECYCLE_COMPLETION_TARGET.tableId,
          },
        }];
      }
      throw new Error(`unexpected lifecycle completion SQL: ${query}`);
    },
    begin: async (callback) => callback({
      unsafe: async (query, values = []) => {
        if (query.startsWith("set transaction")) return [];
        return sql.unsafe(query, values);
      },
    }),
  };
  const deps = {
    sql,
    storageTarget,
    tempRoot: fs.mkdtempSync("/tmp/chips-ledger-stage-closed-human-lifecycle-test-"),
    pruneStore: {
      getManifest: async () => row,
    },
    verifyBucket: async () => { calls.verifyBucket += 1; },
    inspectDurableRecovery: async () => {
      calls.recoveryInspection += 1;
      return recovery ? durable : null;
    },
    pruneArchive: async ({ argv }) => {
      pruneCalls.push([...argv]);
      assert.equal(argv.includes("--execute"), false);
      assert.equal(argv.includes("--automatic"), false);
      return {
        state: "already_pruned",
        evidence: lifecycleEvidence,
        archiveSha256: compressedSha,
      };
    },
  };
  return { deps, row, durable, calls, pruneCalls, state };
}

const lifecycleHarness = makeClosedHumanLifecycleHarness();
const lifecycleResult = await runClosedHumanTableLifecycleCompletion({
  env: ENV,
  deps: lifecycleHarness.deps,
  ...CLOSED_HUMAN_LIFECYCLE_COMPLETION_TARGET,
});
assert.equal(lifecycleResult.state, "completed");
assert.equal(lifecycleResult.batchId, CLOSED_HUMAN_LIFECYCLE_COMPLETION_TARGET.batchId);
assert.equal(lifecycleResult.tableId, CLOSED_HUMAN_LIFECYCLE_COMPLETION_TARGET.tableId);
assert.equal(lifecycleResult.cutoff, CLOSED_HUMAN_LIFECYCLE_COMPLETION_TARGET.cutoff);
assert.equal(lifecycleResult.proof, "verified");
assert.equal(lifecycleResult.dryRun, "already_pruned");
assert.equal(lifecycleResult.recoveryState, "complete");
assert.equal(lifecycleResult.lifecycleBefore, "passed");
assert.equal(lifecycleResult.lifecycleAfter, "passed");
assert.equal(lifecycleResult.markerBefore, null);
assert.equal(lifecycleResult.markerAfter, lifecycleHarness.state.marker);
assert.equal(lifecycleResult.writePerformed, true);
assert.equal(lifecycleHarness.calls.completion, 1);
assert.equal(lifecycleHarness.calls.lifecycleGate, 2);
assert.equal(lifecycleHarness.calls.recoveryInspection, 1);
assert.deepEqual(lifecycleHarness.pruneCalls.map((argv) => argv.includes("--execute")), [false]);

const lifecycleRetryResult = await runClosedHumanTableLifecycleCompletion({
  env: ENV,
  deps: lifecycleHarness.deps,
  ...CLOSED_HUMAN_LIFECYCLE_COMPLETION_TARGET,
});
assert.equal(lifecycleRetryResult.state, "already_complete");
assert.equal(lifecycleRetryResult.markerBefore, lifecycleHarness.state.marker);
assert.equal(lifecycleRetryResult.markerAfter, lifecycleHarness.state.marker);
assert.equal(lifecycleRetryResult.writePerformed, false);
assert.equal(lifecycleRetryResult.retryIdempotent, true);
assert.equal(lifecycleHarness.calls.completion, 2);
assert.equal(lifecycleHarness.calls.lifecycleGate, 4);
assert.deepEqual(lifecycleHarness.pruneCalls.map((argv) => argv.includes("--execute")), [false, false]);

await assert.rejects(
  runClosedHumanTableLifecycleCompletion({
    env: ENV,
    deps: makeClosedHumanLifecycleHarness().deps,
    batchId: "335",
    tableId: CLOSED_HUMAN_LIFECYCLE_COMPLETION_TARGET.tableId,
    cutoff: CLOSED_HUMAN_LIFECYCLE_COMPLETION_TARGET.cutoff,
  }),
  /exact approved batch, table and cutoff/,
);

const lifecycleWrongPolicyHarness = makeClosedHumanLifecycleHarness({
  row: makeClosedHumanLifecycleRow({ source_policy_id: BOT_ONLY_RETENTION_POLICY_ID }),
});
await assert.rejects(
  runClosedHumanTableLifecycleCompletion({
    env: ENV,
    deps: lifecycleWrongPolicyHarness.deps,
    ...CLOSED_HUMAN_LIFECYCLE_COMPLETION_TARGET,
  }),
  /policy mismatch/,
);
assert.equal(lifecycleWrongPolicyHarness.calls.completion, 0);

const lifecycleWrongTableHarness = makeClosedHumanLifecycleHarness();
await assert.rejects(
  runClosedHumanTableLifecycleCompletion({
    env: ENV,
    deps: lifecycleWrongTableHarness.deps,
    ...CLOSED_HUMAN_LIFECYCLE_COMPLETION_TARGET,
    tableId: "00000000-0000-4000-8000-000000000099",
  }),
  /exact approved batch, table and cutoff/,
);
assert.equal(lifecycleWrongTableHarness.calls.completion, 0);

const lifecycleMissingRecoveryHarness = makeClosedHumanLifecycleHarness({ recovery: false });
await assert.rejects(
  runClosedHumanTableLifecycleCompletion({
    env: ENV,
    deps: lifecycleMissingRecoveryHarness.deps,
    ...CLOSED_HUMAN_LIFECYCLE_COMPLETION_TARGET,
  }),
  /no durable recovery/,
);
assert.equal(lifecycleMissingRecoveryHarness.calls.completion, 0);
assert.deepEqual(lifecycleMissingRecoveryHarness.pruneCalls.map((argv) => argv.includes("--execute")), [false]);

for (const harness of [
  lifecycleHarness,
  lifecycleWrongPolicyHarness,
  lifecycleWrongTableHarness,
  lifecycleMissingRecoveryHarness,
]) {
  fs.rmSync(harness.deps.tempRoot, { recursive: true, force: true });
}

for (const harness of [
  closedHumanCanaryHarness,
  closedHumanCanaryWrongBatchHarness,
  closedHumanCanaryWrongPolicyHarness,
  closedHumanCanaryWrongObjectHarness,
  closedHumanWrongGoHarness,
  closedHumanMissingRecoveryHarness,
  closedHumanWrongConfirmationHarness,
]) {
  fs.rmSync(harness.deps.tempRoot, { recursive: true, force: true });
}

// Closed-human automatic Stage rollout is deliberately tested with a fully
// mocked Stage boundary: the test proves orchestration order and exact gates
// without activating policy or touching the shared Stage database.
const automaticStageEnv = {
  ...ENV,
  GITHUB_EVENT_NAME: "schedule",
  CHIPS_LEDGER_CLOSED_HUMAN_AUTOMATIC: "1",
};
const automaticCanaryEvidence = {
  ...closedHumanCanaryEvidence,
  closedHumanTableId: CLOSED_HUMAN_AUTOMATIC_ACTIVATION.tableId,
};
const automaticCandidateArchiveBytes = Buffer.from("exact closed-human automatic candidate archive");
const automaticCandidateCompressedSha = crypto.createHash("sha256")
  .update(automaticCandidateArchiveBytes)
  .digest("hex");
const automaticCandidateEvidence = {
  transactionIdsSha256: "3".repeat(64),
  entryIdsSha256: "4".repeat(64),
  transactionCount: 1,
  entryCount: 2,
  txTypes: { TABLE_BUY_IN: 1 },
  credits: "100",
  debits: "100",
  net: "0",
  distinctTables: 1,
  closedHumanTableId: "00000000-0000-4000-8000-000000000035",
  userTransactions: 1,
  userEntries: 1,
};

function automaticDurable(row, evidenceForManifest, archiveBytes, { uploaded = false } = {}) {
  const manifest = buildRecoveryManifest(row, STAGE_SYSTEM_IDENTIFIER, evidenceForManifest, { target: "stage" });
  const manifestBytes = Buffer.from(`${stringifyJson(manifest)}\n`, "utf8");
  const manifestGzipBytes = gzipRecoveryManifestForTest(manifest);
  const archiveSha256 = crypto.createHash("sha256").update(archiveBytes).digest("hex");
  const manifestSha256 = crypto.createHash("sha256").update(manifestGzipBytes).digest("hex");
  return {
    archiveBytes,
    manifestGzipBytes,
    manifestBytes,
    manifest,
    archivePath: buildRecoveryArchiveObjectPath(archiveSha256),
    manifestPath: buildRecoveryManifestObjectPath(archiveSha256),
    archiveSha256,
    manifestSha256,
    recoveryArchive: { objectPath: buildRecoveryArchiveObjectPath(archiveSha256), uploaded, sha256: archiveSha256 },
    recoveryManifest: { objectPath: buildRecoveryManifestObjectPath(archiveSha256), uploaded, sha256: manifestSha256 },
  };
}

function makeAutomaticClosedHumanHarness({ policyEnabled = true, invalidCandidateEvidence = false } = {}) {
  const canaryRow = makeClosedHumanCanaryRow({
    ...CLOSED_HUMAN_AUTOMATIC_ACTIVATION,
    object_path: `v1/sha256/${closedHumanCanaryCompressedSha}.jsonl.gz`,
    compressed_sha256: closedHumanCanaryCompressedSha,
    pruned_at: "2026-08-13T00:04:00.000000Z",
    pruned_transaction_count: 2,
    pruned_entry_count: 4,
    pruned_transaction_ids_sha256: automaticCanaryEvidence.transactionIdsSha256,
    pruned_entry_ids_sha256: automaticCanaryEvidence.entryIdsSha256,
    destructive_go_at: "2026-08-13T00:03:00.000000Z",
    destructive_go_batch_id: "334",
  });
  const candidateRow = makeClosedHumanCanaryRow({
    batch_id: "335",
    object_path: `v1/sha256/${automaticCandidateCompressedSha}.jsonl.gz`,
    cutoff: "2026-08-14T00:00:00.000000Z",
    cursor_end_created_at: "2026-08-13T00:00:00.000000Z",
    cursor_end_id: "00000000-0000-4000-8000-000000000035",
    first_created_at: "2026-08-13T00:00:00.000000Z",
    last_created_at: "2026-08-13T00:00:00.000000Z",
    transaction_count: 1,
    entry_count: 2,
    tx_types: { TABLE_BUY_IN: 1 },
    raw_bytes: 100,
    compressed_bytes: automaticCandidateArchiveBytes.length,
    raw_sha256: "5".repeat(64),
    compressed_sha256: automaticCandidateCompressedSha,
    credits: "100",
    debits: "100",
    net_amount: "0",
    committed_at: "2026-08-14T00:01:00.000000Z",
    archive_proof_verified_at: null,
    archived_transaction_ids_sha256: null,
    archived_entry_ids_sha256: null,
    pruned_at: null,
    pruned_transaction_count: null,
    pruned_entry_count: null,
    pruned_transaction_ids_sha256: null,
    pruned_entry_ids_sha256: null,
    registry_cleaned_at: null,
    registry_cleaned_key_count: null,
    registry_cleaned_keys_sha256: null,
    destructive_go_at: null,
    destructive_go_batch_id: null,
  });
  const canaryDurable = automaticDurable(canaryRow, automaticCanaryEvidence, closedHumanCanaryArchiveBytes);
  const candidateDurable = automaticDurable(candidateRow, automaticCandidateEvidence, automaticCandidateArchiveBytes, { uploaded: true });
  const state = {
    candidateStored: false,
    recoveryStored: false,
    markers: new Map([[CLOSED_HUMAN_AUTOMATIC_ACTIVATION.tableId, "2026-09-05 00:00:00+00"]]),
    exportCalls: 0,
    storeCalls: 0,
    proofCalls: 0,
    executeCalls: 0,
    lifecycleCalls: 0,
    recoveryInspections: 0,
    verifyBucketCalls: 0,
    pruneCalls: [],
    sqlCalls: [],
  };
  const policyRow = {
    policy_id: CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID,
    enabled: policyEnabled,
    activation_go_at: policyEnabled ? "2026-09-05 00:00:00+00" : null,
    activation_confirmation: policyEnabled ? CLOSED_HUMAN_AUTOMATIC_ACTIVATION.activationConfirmation : null,
    activated_at: policyEnabled ? "2026-09-05 00:00:00+00" : null,
    canary_batch_id: policyEnabled ? "334" : null,
    canary_confirmation: policyEnabled ? "GO 334" : null,
  };
  const session = { backendPid: "closed-human-automatic-session" };
  const ownRows = () => state.candidateStored ? [candidateRow, canaryRow] : [canaryRow];
  const sql = {
    calls: state.sqlCalls,
    typed: (value, type) => ({ value, type }),
    unsafe: async (query, values = []) => {
      state.sqlCalls.push({ query, values });
      if (query.includes("pg_try_advisory_lock")) return [{ acquired: true, backend_pid: session.backendPid }];
      if (query.includes("pg_backend_pid")) return [{ backend_pid: session.backendPid }];
      if (query.includes("pg_advisory_unlock")) return [{ pg_advisory_unlock: true }];
      if (query.includes("pg_control_system")) return [{ system_identifier: STAGE_SYSTEM_IDENTIFIER }];
      if (query.includes("chips_table_fence_is_active")) return [{ active: true }];
      if (query.includes("chips_table_fence_control")) return [{ enforcement_active: true }];
      if (query.includes("where batch_id = $1")) return [exactSqlTextRow(canaryRow)];
      if (query.includes("from public.chips_ledger_archive_batches")) return ownRows();
      if (query.includes("from public.chips_stage_closed_human_table_retention_policy")) return [policyRow];
      if (query.includes("from public.poker_tables")) {
        const tableId = String(values[0]);
        return [{ table_id: tableId, human_retention_complete_at: state.markers.get(tableId) || null }];
      }
      throw new Error(`unexpected closed-human automatic SQL: ${query}`);
    },
    begin: async (callback) => callback({
      unsafe: async (query, values = []) => {
        if (query.startsWith("set transaction")) return [];
        return sql.unsafe(query, values);
      },
    }),
  };
  const pruneStore = {
    getManifest: async (objectPath) => {
      if (objectPath === canaryRow.object_path) return canaryRow;
      if (objectPath === candidateRow.object_path) return candidateRow;
      throw new Error(`unexpected manifest object path: ${objectPath}`);
    },
    async assertClosedHumanLifecycle(tableId, cutoff, batchId) {
      assert.ok(tableId);
      assert.ok(cutoff);
      assert.ok(batchId);
      return { state: "verified" };
    },
  };
  const deps = {
    sql,
    storageTarget,
    tempRoot: fs.mkdtempSync("/tmp/chips-ledger-stage-closed-human-automatic-test-"),
    pruneStore,
    verifyBucket: async () => { state.verifyBucketCalls += 1; },
    inspectDurableRecovery: async (_target, row) => {
      state.recoveryInspections += 1;
      if (String(row?.batch_id) === "334") return canaryDurable;
      return state.recoveryStored ? candidateDurable : null;
    },
    downloadPrivateArchive: async (_target, objectPath) => {
      assert.equal(objectPath, candidateRow.object_path);
      return { bytes: automaticCandidateArchiveBytes, downloadMs: 1 };
    },
    persistDurableRecovery: async () => {
      state.recoveryStored = true;
      return candidateDurable;
    },
    exportArchive: async () => {
      state.exportCalls += 1;
      return state.exportCalls === 1
        ? { noCandidate: false }
        : { noCandidate: true };
    },
    ensureArchiveBucket: async () => {},
    storeArchive: async () => {
      state.storeCalls += 1;
      state.candidateStored = true;
      return { objectPath: candidateRow.object_path, object: { uploaded: true } };
    },
    pruneArchive: async ({ argv }) => {
      const objectPath = argv[argv.indexOf("--object-path") + 1];
      const row = objectPath === canaryRow.object_path ? canaryRow : candidateRow;
      const isExecute = argv.includes("--execute");
      const isProof = argv.includes("--register-proof");
      state.pruneCalls.push([...argv]);
      assert.equal(argv.includes("--target") && argv.includes("stage"), true);
      if (isProof) {
        assert.equal(row, candidateRow);
        state.proofCalls += 1;
        candidateRow.archive_proof_verified_at = "2026-08-14T00:02:00.000000Z";
        candidateRow.archived_transaction_ids_sha256 = automaticCandidateEvidence.transactionIdsSha256;
        candidateRow.archived_entry_ids_sha256 = automaticCandidateEvidence.entryIdsSha256;
        return { state: "proof_registered", row, evidence: automaticCandidateEvidence };
      }
      if (!isExecute) {
        const evidenceForDry = row === candidateRow && invalidCandidateEvidence
          ? { ...automaticCandidateEvidence, transactionIdsSha256: "9".repeat(64) }
          : row === canaryRow ? automaticCanaryEvidence : automaticCandidateEvidence;
        return {
          state: row === canaryRow || candidateRow.pruned_at ? "already_pruned" : "ready",
          evidence: evidenceForDry,
          archiveSha256: row.compressed_sha256,
        };
      }
      assert.equal(row, candidateRow);
      assert.equal(argv.includes("--automatic"), true, "closed-human automatic execute must use the explicit automatic adapter");
      assert.equal(argv.includes("--approved-batch-id"), false);
      state.executeCalls += 1;
      candidateRow.destructive_go_at = "2026-08-14T00:03:00.000000Z";
      candidateRow.destructive_go_batch_id = "335";
      candidateRow.pruned_at = "2026-08-14T00:04:00.000000Z";
      candidateRow.pruned_transaction_count = 1;
      candidateRow.pruned_entry_count = 2;
      candidateRow.pruned_transaction_ids_sha256 = automaticCandidateEvidence.transactionIdsSha256;
      candidateRow.pruned_entry_ids_sha256 = automaticCandidateEvidence.entryIdsSha256;
      return { state: "pruned", row, evidence: automaticCandidateEvidence };
    },
    completeClosedHumanLifecycle: async ({ batchId, tableId, cutoff }) => {
      state.lifecycleCalls += 1;
      const markerBefore = state.markers.get(String(tableId)) || null;
      const markerAfter = markerBefore || "2026-09-05 00:05:00+00";
      state.markers.set(String(tableId), markerAfter);
      return {
        exactRow: candidateRow,
        markerBefore,
        markerAfter,
        completion: { state: "human_retention_complete", batch_id: String(batchId), table_id: tableId, cutoff },
      };
    },
  };
  return { deps, state, canaryRow, candidateRow, canaryDurable, candidateDurable, policyRow };
}

const activePolicyContract = {
  policy_id: CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID,
  enabled: true,
  activation_go_at: "2026-09-05 00:00:00+00",
  activated_at: "2026-09-05 00:00:00+00",
  canary_batch_id: "334",
  canary_confirmation: "GO 334",
  activation_confirmation: CLOSED_HUMAN_AUTOMATIC_ACTIVATION.activationConfirmation,
};
assertClosedHumanAutomaticPolicy(activePolicyContract);
assert.equal(isClosedHumanManualOnlyPolicy({
  policy_id: CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID,
  enabled: false,
  activation_go_at: null,
  activation_confirmation: null,
  activated_at: null,
  canary_batch_id: "334",
  canary_confirmation: "GO 334",
}), true, "manual-only policy may retain the exact successful canary latch");
assert.equal(isClosedHumanManualOnlyPolicy({
  policy_id: CLOSED_HUMAN_TABLE_RETENTION_POLICY_ID,
  enabled: false,
  activation_go_at: "2026-09-05 00:00:00+00",
  activation_confirmation: null,
  activated_at: null,
  canary_batch_id: "334",
  canary_confirmation: "GO 334",
}), false, "partial activation state is not manual-only");
assert.throws(
  () => assertClosedHumanAutomaticPolicy({ ...activePolicyContract, canary_batch_id: "335" }),
  /exact canary 334/,
  "automatic policy activation must remain bound to canary 334",
);

const activationHarness = makeAutomaticClosedHumanHarness({ policyEnabled: false });
let activationCalls = 0;
activationHarness.deps.pruneStore.activateClosedHumanPolicy = async (batchId, confirmation) => {
  activationCalls += 1;
  assert.equal(String(batchId), "334");
  assert.equal(confirmation, CLOSED_HUMAN_AUTOMATIC_ACTIVATION.activationConfirmation);
  activationHarness.policyRow.enabled = true;
  activationHarness.policyRow.activation_go_at = "2026-09-05 00:00:00+00";
  activationHarness.policyRow.activated_at = "2026-09-05 00:00:00+00";
  activationHarness.policyRow.canary_batch_id = "334";
  activationHarness.policyRow.canary_confirmation = "GO 334";
  activationHarness.policyRow.activation_confirmation = confirmation;
  return { state: "active" };
};
const activationResult = await runClosedHumanTableRetentionActivation({
  env: ENV,
  deps: activationHarness.deps,
  canaryBatchId: "334",
  activationConfirmation: CLOSED_HUMAN_AUTOMATIC_ACTIVATION.activationConfirmation,
});
assert.equal(activationResult.state, "active");
assert.equal(activationResult.batchId, "334");
assert.equal(activationResult.tableId, CLOSED_HUMAN_AUTOMATIC_ACTIVATION.tableId);
assert.equal(activationResult.proof, "verified");
assert.equal(activationResult.dryRun, "already_pruned");
assert.equal(activationResult.recoveryState, "complete");
assert.equal(activationResult.writePerformed, true);
assert.equal(activationCalls, 1, "activation must persist only after exact canary and marker evidence");

const activationNoMarkerHarness = makeAutomaticClosedHumanHarness({ policyEnabled: false });
activationNoMarkerHarness.state.markers.delete(CLOSED_HUMAN_AUTOMATIC_ACTIVATION.tableId);
activationNoMarkerHarness.deps.pruneStore.activateClosedHumanPolicy = async () => {
  throw new Error("activation must not write without the canary lifecycle marker");
};
await assert.rejects(
  runClosedHumanTableRetentionActivation({
    env: ENV,
    deps: activationNoMarkerHarness.deps,
    canaryBatchId: "334",
    activationConfirmation: CLOSED_HUMAN_AUTOMATIC_ACTIVATION.activationConfirmation,
  }),
  /lifecycle marker is missing/,
);

await assert.rejects(
  runClosedHumanTableRetentionActivation({
    env: ENV,
    deps: makeAutomaticClosedHumanHarness({ policyEnabled: false }).deps,
    canaryBatchId: "335",
    activationConfirmation: CLOSED_HUMAN_AUTOMATIC_ACTIVATION.activationConfirmation,
  }),
  /exact canary 334/,
);

const automaticHarness = makeAutomaticClosedHumanHarness();
const automaticResult = await runAutomaticClosedHumanStageAutomation({
  env: automaticStageEnv,
  deps: automaticHarness.deps,
});
assert.equal(automaticResult.state, "completed");
assert.equal(automaticResult.boundedBatchLimit, CLOSED_HUMAN_AUTOMATIC_MAX_BATCHES_PER_RUN);
assert.equal(automaticResult.boundedBatchLimit, 1);
assert.equal(automaticResult.processed.length, 1, "automatic closed-human Stage run must process one table maximum");
assert.equal(automaticResult.processed[0].batchId, "335");
assert.equal(automaticResult.processed[0].receipt, "pruned");
assert.equal(automaticResult.processed[0].lifecycleState, "human_retention_complete");
assert.equal(automaticResult.processed[0].lifecycleWritePerformed, true);
assert.equal(automaticHarness.state.exportCalls, 1);
assert.equal(automaticHarness.state.storeCalls, 1);
assert.equal(automaticHarness.state.proofCalls, 1);
assert.equal(automaticHarness.state.executeCalls, 1);
assert.equal(automaticHarness.state.lifecycleCalls, 1);
assert.equal(automaticHarness.state.pruneCalls.some((argv) => argv.includes("--execute")), true);
assert.equal(automaticHarness.state.pruneCalls.some((argv) => argv.includes("--register-proof")), true);
assert.equal(automaticHarness.candidateRow.registry_cleaned_at, null, "human idempotency registry must not be retired");
assert.equal(automaticHarness.candidateRow.destructive_go_batch_id, "335");

const automaticRetry = await runAutomaticClosedHumanStageAutomation({
  env: automaticStageEnv,
  deps: automaticHarness.deps,
});
assert.equal(automaticRetry.state, "completed");
assert.equal(automaticRetry.processed.length, 0, "completed automatic retry must not process a second table");
assert.equal(automaticRetry.stopReason, "no_eligible_closed_human_table");
assert.equal(automaticHarness.state.executeCalls, 1, "automatic retry must be idempotent");
assert.equal(automaticHarness.state.lifecycleCalls, 1, "automatic retry must not rewrite the lifecycle marker");

const incompleteAutomaticHarness = makeAutomaticClosedHumanHarness({ invalidCandidateEvidence: true });
await assert.rejects(
  runAutomaticClosedHumanStageAutomation({ env: automaticStageEnv, deps: incompleteAutomaticHarness.deps }),
  /differs from the immutable proof/,
  "incomplete automatic evidence must fail before execute/lifecycle completion",
);
assert.equal(incompleteAutomaticHarness.state.executeCalls, 0);
assert.equal(incompleteAutomaticHarness.state.lifecycleCalls, 0);
assert.equal(incompleteAutomaticHarness.candidateRow.human_retention_complete_at ?? null, null);

const manualOnlyAutomaticHarness = makeAutomaticClosedHumanHarness({ policyEnabled: false });
manualOnlyAutomaticHarness.policyRow.canary_batch_id = "334";
manualOnlyAutomaticHarness.policyRow.canary_confirmation = "GO 334";
const manualOnlyAutomaticResult = await runAutomaticClosedHumanStageAutomation({
  env: automaticStageEnv,
  deps: manualOnlyAutomaticHarness.deps,
});
assert.equal(manualOnlyAutomaticResult.state, "no-op");
assert.equal(manualOnlyAutomaticResult.stopReason, "closed_human_policy_manual_only");
assert.equal(manualOnlyAutomaticResult.processed.length, 0);
assert.equal(manualOnlyAutomaticHarness.state.exportCalls, 0);
assert.equal(manualOnlyAutomaticHarness.state.storeCalls, 0);
assert.equal(manualOnlyAutomaticHarness.state.proofCalls, 0);
assert.equal(manualOnlyAutomaticHarness.state.executeCalls, 0);
assert.equal(manualOnlyAutomaticHarness.state.lifecycleCalls, 0);
assert.equal(manualOnlyAutomaticHarness.state.verifyBucketCalls, 0);

const partialActiveAutomaticHarness = makeAutomaticClosedHumanHarness();
partialActiveAutomaticHarness.policyRow.activation_confirmation = null;
await assert.rejects(
  runAutomaticClosedHumanStageAutomation({
    env: automaticStageEnv,
    deps: partialActiveAutomaticHarness.deps,
  }),
  /not activated by the exact canary 334/,
  "partial active policy must fail closed before automatic work",
);
assert.equal(partialActiveAutomaticHarness.state.exportCalls, 0);
assert.equal(partialActiveAutomaticHarness.state.storeCalls, 0);
assert.equal(partialActiveAutomaticHarness.state.executeCalls, 0);
assert.equal(partialActiveAutomaticHarness.state.lifecycleCalls, 0);
await assert.rejects(
  runAutomaticClosedHumanStageAutomation({
    env: { ...automaticStageEnv, SUPABASE_PROD_DB_URL: "forbidden" },
    deps: makeAutomaticClosedHumanHarness().deps,
  }),
  /Production credentials are not accepted/,
  "Production credentials must fail closed",
);

for (const harness of [
  activationHarness,
  activationNoMarkerHarness,
  automaticHarness,
  incompleteAutomaticHarness,
  manualOnlyAutomaticHarness,
  partialActiveAutomaticHarness,
]) {
  fs.rmSync(harness.deps.tempRoot, { recursive: true, force: true });
}

const noRecoveryCalls = [];
const noRecoverySql = fakeSql({ ownRows: [resumeCycleRow] });
await assert.rejects(
  runStageAutomation({
    env: ENV,
    deps: {
      sql: noRecoverySql,
      fetch: async () => response({ message: "not found" }, 404),
      storageTarget,
      pruneStore: { getManifest: async () => resumeCycleRow },
      verifyBucket: async () => {},
      tempRoot: fs.mkdtempSync("/tmp/chips-ledger-stage-automation-no-recovery-"),
      pruneArchive: async () => {
        noRecoveryCalls.push(true);
        return { state: "ready", evidence };
      },
    },
  }),
  /no durable recovery/,
);
assert.equal(noRecoveryCalls.length, 0);

for (const scenario of ["transient", "busy", "exhausted", "sql-timeout"]) {
  const sessions = [];
  const delays = [];
  const acquire = () => acquireInitialAutomaticLock(() => {
    const index = sessions.length;
    const session = {
      closed: false,
      unsafe: async (query) => {
        assert.match(query, /pg_try_advisory_lock/);
        if (scenario === "exhausted" || (scenario === "transient" && index === 0)) {
          throw Object.assign(new Error("connect timeout"), { code: "CONNECT_TIMEOUT" });
        }
        if (scenario === "sql-timeout") throw Object.assign(new Error("statement timeout"), { code: "57014" });
        return [{ backend_pid: "42", acquired: scenario !== "busy" }];
      },
      end: async () => { session.closed = true; },
    };
    assert.ok(sessions.every((previous) => previous.closed), "failed session must close before a fresh attempt");
    sessions.push(session);
    return session;
  }, async (ms) => { delays.push(ms); });
  if (scenario === "exhausted" || scenario === "sql-timeout") {
    await assert.rejects(acquire, { code: scenario === "exhausted" ? "CONNECT_TIMEOUT" : "57014" });
    assert.equal(sessions.length, scenario === "exhausted" ? 3 : 1);
    assert.ok(sessions.every((session) => session.closed));
  } else {
    const result = await acquire();
    assert.equal(result.sql, sessions.at(-1));
    assert.deepEqual(result.lockSession, scenario === "busy" ? null : { backendPid: "42" });
    assert.equal(sessions.length, scenario === "busy" ? 1 : 2);
    assert.equal(result.sql.closed, false);
  }
  assert.deepEqual(delays, scenario === "exhausted" ? [250, 1000] : scenario === "transient" ? [250] : []);
}

process.stdout.write("chips-ledger-stage-automation tests passed\n");
