import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  BOT_ONLY_EXPORT_SCHEMA_VERSION,
  BOT_ONLY_RETENTION_POLICY_ID,
  readSnapshot,
  STAGE_AUTOMATION_POLICY_ID,
  stringifyJson,
} from "../../scripts/ops/chips-ledger-archive-export.mjs";
import {
  assertBotOnlyActiveManifestMatch,
  assertBotOnlyExecuteBatch,
  assertDurableRecoveryReady,
  assertResumeRecoveryState,
  botOnlyExportArgs,
  botOnlyReport,
  BOT_ONLY_BATCH_15_RECOVERY_REPAIR,
  findOwnCycle,
  persistDurableRecovery,
  runBotOnlyRecoveryRepair,
  runBotOnlyStageAutomation,
  runStageAutomation,
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

process.stdout.write("chips-ledger-stage-automation tests passed\n");
