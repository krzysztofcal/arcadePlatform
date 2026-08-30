import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import {
  aggregatePayload,
  redactedError,
  runStageAutomation,
  STAGE_PROJECT_REF,
  writeAggregateSummary,
} from "../../scripts/ops/chips-ledger-stage-automation.mjs";
import {
  BOT_ONLY_RETENTION_POLICY_ID,
  STAGE_AUTOMATION_POLICY_ID,
} from "../../scripts/ops/chips-ledger-archive-export.mjs";

const root = process.cwd();
const cli = path.join(root, "scripts/ops/chips-ledger-stage-automation.mjs");
const samplePassword = "P@ssw0rd-observability";
const sampleDbUrl = `postgresql://postgres:${samplePassword}@db.${STAGE_PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`;
const sampleJwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature";
const sampleBearer = `Bearer ${sampleJwt}`;
const sampleSecret = "sb_secret_observability-test_123";

function cleanEnv(overrides = {}) {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^SUPABASE_PROD_|^PRODUCTION_/.test(key))),
    SUPABASE_STAGE_DB_URL: sampleDbUrl,
    SUPABASE_STAGE_SERVICE_ROLE_KEY: sampleSecret,
    GITHUB_SHA: "f".repeat(40),
    ...overrides,
  };
}

function parseSingleAggregate(stdout) {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1, "stdout must contain exactly one aggregate JSON line");
  return { line: lines[0], report: JSON.parse(lines[0]) };
}

function parseSummary(summary) {
  const match = summary.match(/```json\n([^\n]+)\n```/);
  assert.ok(match, "Job Summary must contain one JSON code block");
  return match[1];
}

function captureAggregateSummary(result) {
  const originalStdoutWrite = process.stdout.write;
  const originalSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-stage-observability-success-"));
  const summaryPath = path.join(temp, "summary.md");
  let stdout = "";
  process.stdout.write = (chunk) => {
    stdout += String(chunk);
    return true;
  };
  process.env.GITHUB_STEP_SUMMARY = summaryPath;
  try {
    writeAggregateSummary(result);
  } finally {
    process.stdout.write = originalStdoutWrite;
    if (originalSummaryPath === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = originalSummaryPath;
  }
  const summary = fs.readFileSync(summaryPath, "utf8");
  fs.rmSync(temp, { recursive: true, force: true });
  return { line: stdout.trim(), report: JSON.parse(stdout), summary };
}

function runInvalidConfigurationCli(summaryPath) {
  return spawnSync(process.execPath, [cli], {
    cwd: root,
    env: cleanEnv({
      SUPABASE_STAGE_URL: "",
      GITHUB_STEP_SUMMARY: summaryPath,
    }),
    encoding: "utf8",
  });
}

const cliTemp = fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-stage-observability-cli-"));
try {
  const summaryPath = path.join(cliTemp, "summary.md");
  const child = runInvalidConfigurationCli(summaryPath);
  assert.equal(child.status, 1);
  assert.equal(child.signal, null);
  assert.equal(child.stderr, "");
  const { line, report } = parseSingleAggregate(child.stdout);
  assert.deepEqual(Object.keys(report).sort(), [
    "deployed_commit_sha",
    "event",
    "project_ref",
    "reason",
    "source_policy_id",
    "state",
    "target",
  ]);
  assert.equal(report.state, "error");
  assert.equal(report.project_ref, STAGE_PROJECT_REF);
  assert.equal(report.source_policy_id, STAGE_AUTOMATION_POLICY_ID);
  assert.match(report.reason, /Stage DB URL, Supabase URL and service key are required/);
  assert.equal(parseSummary(fs.readFileSync(summaryPath, "utf8")), line);
  for (const secret of [sampleDbUrl, samplePassword, sampleJwt, sampleBearer, sampleSecret]) {
    assert.equal(child.stdout.includes(secret), false, `stdout leaked ${secret}`);
    assert.equal(fs.readFileSync(summaryPath, "utf8").includes(secret), false, `summary leaked ${secret}`);
  }
} finally {
  fs.rmSync(cliTemp, { recursive: true, force: true });
}

const summaryFailureTemp = fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-stage-observability-summary-failure-"));
try {
  const summaryPath = path.join(summaryFailureTemp, "missing", "summary.md");
  const child = runInvalidConfigurationCli(summaryPath);
  assert.equal(child.status, 1);
  const { report } = parseSingleAggregate(child.stdout);
  assert.equal(report.state, "error");
  assert.equal(fs.existsSync(summaryPath), false);
  assert.equal(child.stdout.includes(sampleDbUrl), false);
  assert.equal(child.stdout.includes(samplePassword), false);
  assert.equal(child.stdout.includes(sampleJwt), false);
  assert.equal(child.stdout.includes(sampleSecret), false);
} finally {
  fs.rmSync(summaryFailureTemp, { recursive: true, force: true });
}

const originalConnect = net.Socket.prototype.connect;
const originalTlsConnect = tls.connect;
const originalFetch = globalThis.fetch;
const originalStdoutWrite = process.stdout.write;
const originalSummaryPath = process.env.GITHUB_STEP_SUMMARY;
let tcpCalls = 0;
let tlsCalls = 0;
let fetchCalls = 0;
let dbCalls = 0;
let storageCalls = 0;
let capturedStdout = "";
net.Socket.prototype.connect = function blockedTcp(...args) {
  tcpCalls += 1;
  throw new Error("unexpected TCP call");
};
tls.connect = function blockedTls(...args) {
  tlsCalls += 1;
  throw new Error("unexpected TLS call");
};
globalThis.fetch = async function blockedFetch(...args) {
  fetchCalls += 1;
  throw new Error("unexpected fetch call");
};
process.stdout.write = (chunk) => {
  capturedStdout += String(chunk);
  return true;
};
const directTemp = fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-stage-observability-direct-"));
process.env.GITHUB_STEP_SUMMARY = path.join(directTemp, "summary.md");
try {
  const invalidEnv = cleanEnv({ SUPABASE_STAGE_URL: "" });
  const sql = {
    unsafe: async () => {
      dbCalls += 1;
      throw new Error("unexpected DB call");
    },
    begin: async () => {
      dbCalls += 1;
      throw new Error("unexpected DB transaction");
    },
  };
  await assert.rejects(
    runStageAutomation({
      env: invalidEnv,
      deps: {
        sql,
        verifyBucket: async () => { storageCalls += 1; },
        storageTarget: {},
      },
    }),
    /Stage DB URL, Supabase URL and service key are required/,
  );
  const { report } = parseSingleAggregate(capturedStdout);
  assert.equal(report.state, "error");
  assert.equal(tcpCalls, 0);
  assert.equal(tlsCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(dbCalls, 0);
  assert.equal(storageCalls, 0);
} finally {
  fs.rmSync(directTemp, { recursive: true, force: true });
  process.stdout.write = originalStdoutWrite;
  if (originalSummaryPath === undefined) delete process.env.GITHUB_STEP_SUMMARY;
  else process.env.GITHUB_STEP_SUMMARY = originalSummaryPath;
  net.Socket.prototype.connect = originalConnect;
  tls.connect = originalTlsConnect;
  globalThis.fetch = originalFetch;
}

const redacted = redactedError(new Error(
  `failed with ${sampleDbUrl} password=${samplePassword} ${sampleBearer} ${sampleJwt} key=${sampleSecret} transaction-123`,
));
for (const secret of [sampleDbUrl, samplePassword, sampleJwt, sampleBearer, sampleSecret]) {
  assert.equal(redacted.includes(secret), false, `redacted reason leaked ${secret}`);
}
assert.match(redacted, /\[redacted-db-url\]/);
assert.match(redacted, /Bearer \[redacted\]/);
assert.match(redacted, /\[redacted-supabase-secret\]/);
assert.match(redacted, /\[redacted-token\]/);
assert.match(redacted, /\[redacted-record\]/);

const bearerStdout = [];
const bearerOriginalStdoutWrite = process.stdout.write;
const bearerOriginalSummaryPath = process.env.GITHUB_STEP_SUMMARY;
process.stdout.write = (chunk) => {
  bearerStdout.push(String(chunk));
  return true;
};
delete process.env.GITHUB_STEP_SUMMARY;
try {
  const bearerSql = {
    unsafe: async () => { throw new Error(sampleBearer); },
    begin: async () => { throw new Error("unexpected DB transaction"); },
  };
  await assert.rejects(
    runStageAutomation({
      env: cleanEnv({ SUPABASE_STAGE_URL: `https://${STAGE_PROJECT_REF}.supabase.co` }),
      deps: {
        sql: bearerSql,
        storageTarget: { target: "stage", projectRef: STAGE_PROJECT_REF, baseUrl: `https://${STAGE_PROJECT_REF}.supabase.co`, serviceKey: sampleSecret },
        pruneStore: {},
      },
    }),
    /Bearer/,
  );
} finally {
  process.stdout.write = bearerOriginalStdoutWrite;
  if (bearerOriginalSummaryPath === undefined) delete process.env.GITHUB_STEP_SUMMARY;
  else process.env.GITHUB_STEP_SUMMARY = bearerOriginalSummaryPath;
}
const bearerReport = parseSingleAggregate(bearerStdout.join("")).report;
assert.equal(bearerReport.reason, "Bearer [redacted]");

const automaticError = aggregatePayload({
  state: "error",
  sourcePolicyId: BOT_ONLY_RETENTION_POLICY_ID,
  mode: "automatic",
  phase: "automatic.execute",
  batchId: "16",
  objectPath: "v1/sha256/" + "a".repeat(64) + ".jsonl.gz",
  reason: Object.assign(new Error("serialization failure"), { code: "40001" }),
  deployedCommitSha: "f".repeat(40),
  currentBatch: {
    batchId: "16",
    state: "in_progress",
    objectPath: "v1/sha256/" + "a".repeat(64) + ".jsonl.gz",
    compressedSha256: "a".repeat(64),
    proof: "verified",
    dryRun: "ready",
    archiveStorageModified: true,
    recoveryStorageModified: false,
    storageModified: true,
    dbMutationConfirmed: false,
    dryRunAttempts: 2,
    dryRunRetryCount: 1,
    dryRunSqlstates: ["40001"],
  },
  processed: [{
    batchId: "17",
    state: "cleaned",
    retry: "already_cleaned",
    objectPath: "v1/sha256/" + "b".repeat(64) + ".jsonl.gz",
    compressedSha256: "c".repeat(64),
    recoveryArchiveSha256: "d".repeat(64),
    recoveryManifestSha256: "e".repeat(64),
    proof: null,
    dryRun: null,
    archiveStorageModified: null,
    recoveryStorageModified: null,
    storageModified: true,
    pruneReceipt: "prune-17",
    cleanupReceipt: "cleanup-17",
    destructiveGoBatchId: "17",
    dryRunAttempts: 1,
    dryRunRetryCount: 0,
    dryRunSqlstates: [],
    executeAttempts: 3,
    executeRetryCount: 2,
    executeSqlstates: ["40001", "40001", "55P03"],
  }],
});
assert.equal(automaticError.source_policy_id, BOT_ONLY_RETENTION_POLICY_ID);
assert.equal(automaticError.mode, "automatic");
assert.equal(automaticError.phase, "automatic.execute");
assert.equal(automaticError.batch_id, "16");
assert.equal(automaticError.object_path, "v1/sha256/" + "a".repeat(64) + ".jsonl.gz");
assert.equal(automaticError.sqlstate, "40001");
assert.equal(automaticError.stop_reason, "serialization failure");
assert.deepEqual(automaticError.processed_batches[0].execute_sqlstates, ["40001", "40001", "55P03"]);
assert.equal(automaticError.processed_batches[0].execute_attempts, 3);
assert.equal(automaticError.processed_batches[0].execute_retry_count, 2);
assert.deepEqual(automaticError.processed_batches, [{
  batch_id: "17",
  state: "cleaned",
  retry: "already_cleaned",
  object_path: "v1/sha256/" + "b".repeat(64) + ".jsonl.gz",
  transactions: null,
  entries: null,
  compressed_sha256: "c".repeat(64),
  recovery_archive_sha256: "d".repeat(64),
  recovery_manifest_sha256: "e".repeat(64),
  proof: null,
  dry_run: null,
  archive_storage_modified: null,
  recovery_storage_modified: null,
  storage_modified: true,
  prune_receipt: "prune-17",
  cleanup_receipt: "cleanup-17",
  destructive_go_batch_id: "17",
  dry_run_attempts: 1,
  dry_run_retry_count: 0,
  dry_run_sqlstates: [],
  execute_state: null,
  execute_confirmed: false,
  db_mutation_confirmed: false,
  retry_state: null,
  execute_attempts: 3,
  execute_retry_count: 2,
  execute_sqlstates: ["40001", "40001", "55P03"],
}]);
assert.equal(automaticError.current_batch.batch_id, "16");
assert.equal(automaticError.current_batch.object_path, "v1/sha256/" + "a".repeat(64) + ".jsonl.gz");
assert.equal(automaticError.current_batch.compressed_sha256, "a".repeat(64));
assert.equal(automaticError.current_batch.proof, "verified");
assert.equal(automaticError.current_batch.dry_run, "ready");
assert.equal(automaticError.current_batch.archive_storage_modified, true);
assert.equal(automaticError.current_batch.recovery_storage_modified, false);
assert.equal(automaticError.current_batch.storage_modified, true);
assert.equal(automaticError.current_batch.db_mutation_confirmed, false);
assert.equal(automaticError.current_batch.dry_run_attempts, 2);
assert.equal(automaticError.current_batch.dry_run_retry_count, 1);
assert.deepEqual(automaticError.current_batch.dry_run_sqlstates, ["40001"]);
assert.equal(automaticError.current_batch.execute_attempts, 0);
assert.equal(automaticError.current_batch.execute_retry_count, 0);
assert.deepEqual(automaticError.current_batch.execute_sqlstates, []);

const capturedAutomaticError = captureAggregateSummary(automaticError);
assert.equal(capturedAutomaticError.report.stop_reason, "serialization failure");
assert.equal(capturedAutomaticError.summary.includes('"stop_reason":"serialization failure"'), true);
for (const secret of [sampleDbUrl, samplePassword, sampleJwt, sampleSecret]) {
  assert.equal(capturedAutomaticError.summary.includes(secret), false);
}

const automaticProcessedBatch = {
  batchId: "batch-a",
  state: "cleaned",
  objectPath: "v1/sha256/" + "a".repeat(64) + ".jsonl.gz",
  transactions: 4,
  entries: 7,
  compressedSha256: "a".repeat(64),
  recoveryArchiveSha256: "b".repeat(64),
  recoveryManifestSha256: "c".repeat(64),
  recoveryArchivePath: "recovery/v1/sha256/" + "a".repeat(64) + ".jsonl.gz",
  recoveryManifestPath: "recovery/v1/sha256/" + "a".repeat(64) + ".recovery.json.gz",
  proof: "verified",
  dryRun: "ready",
  dryRunAttempts: 2,
  dryRunRetryCount: 1,
  dryRunSqlstates: ["40001"],
  archiveStorageModified: false,
  recoveryStorageModified: true,
  storageModified: true,
  pruneReceipt: { at: "2026-08-25T00:00:01Z", transaction_count: 4, entry_count: 7 },
  cleanupReceipt: { at: "2026-08-25T00:00:02Z", key_count: 1 },
  destructiveGoBatchId: "batch-a",
  executeState: "cleaned",
  executeConfirmed: true,
  dbMutationConfirmed: true,
  retryState: "already_cleaned",
  retry: "already_cleaned",
  executeAttempts: 3,
  executeRetryCount: 2,
  executeSqlstates: ["40001", "40001", "55P03"],
  tableId: "00000000-0000-4000-8000-000000000001",
  amounts: { credits: "100", debits: "100" },
};
const automaticSuccess = aggregatePayload({
  state: "completed",
  mode: "automatic",
  sourcePolicyId: BOT_ONLY_RETENTION_POLICY_ID,
  projectRef: STAGE_PROJECT_REF,
  stageSystemIdentifier: "7656985631720456337",
  deployedCommitSha: "f".repeat(40),
  policy: {
    enabled: true,
    canaryBatchId: "canary-a",
    activatedAt: "2026-08-25T00:00:00Z",
  },
  boundedBatchLimit: 8,
  processed: [automaticProcessedBatch, { ...automaticProcessedBatch, batchId: "batch-b" }],
  stopReason: "no_eligible_bot_only_table",
});
assert.deepEqual(Object.keys(automaticSuccess).sort(), [
  "bounded_batch_limit",
  "deployed_commit_sha",
  "event",
  "mode",
  "policy",
  "processed_batch_count",
  "processed_batches",
  "project_ref",
  "source_policy_id",
  "stage_system_identifier",
  "state",
  "stop_reason",
  "target",
]);
assert.equal(automaticSuccess.state, "completed");
assert.equal(automaticSuccess.mode, "automatic");
assert.equal(automaticSuccess.project_ref, STAGE_PROJECT_REF);
assert.equal(automaticSuccess.stage_system_identifier, "7656985631720456337");
assert.deepEqual(automaticSuccess.policy, {
  enabled: true,
  canary_batch_id: "canary-a",
  activated_at: "2026-08-25T00:00:00Z",
});
assert.equal(automaticSuccess.bounded_batch_limit, 8);
assert.equal(automaticSuccess.processed_batch_count, 2);
assert.equal(automaticSuccess.stop_reason, "no_eligible_bot_only_table");
assert.equal(Object.hasOwn(automaticSuccess, "current_batch"), false);
assert.deepEqual(Object.keys(automaticSuccess.processed_batches[0]).sort(), [
  "archive_storage_modified",
  "batch_id",
  "cleanup_receipt",
  "compressed_sha256",
  "db_mutation_confirmed",
  "destructive_go_batch_id",
  "dry_run",
  "dry_run_attempts",
  "dry_run_retry_count",
  "dry_run_sqlstates",
  "entries",
  "execute_attempts",
  "execute_confirmed",
  "execute_retry_count",
  "execute_sqlstates",
  "execute_state",
  "object_path",
  "proof",
  "prune_receipt",
  "recovery_archive_path",
  "recovery_archive_sha256",
  "recovery_manifest_path",
  "recovery_manifest_sha256",
  "recovery_storage_modified",
  "retry_state",
  "state",
  "storage_modified",
  "transactions",
]);
assert.equal(automaticSuccess.processed_batches[0].batch_id, "batch-a");
assert.equal(automaticSuccess.processed_batches[0].transactions, 4);
assert.equal(automaticSuccess.processed_batches[0].entries, 7);
assert.equal(automaticSuccess.processed_batches[0].compressed_sha256, "a".repeat(64));
assert.equal(automaticSuccess.processed_batches[0].recovery_archive_sha256, "b".repeat(64));
assert.equal(automaticSuccess.processed_batches[0].recovery_manifest_sha256, "c".repeat(64));
assert.equal(automaticSuccess.processed_batches[0].recovery_archive_path.endsWith(".jsonl.gz"), true);
assert.equal(automaticSuccess.processed_batches[0].recovery_manifest_path.endsWith(".recovery.json.gz"), true);
assert.equal(automaticSuccess.processed_batches[0].proof, "verified");
assert.equal(automaticSuccess.processed_batches[0].dry_run, "ready");
assert.equal(automaticSuccess.processed_batches[0].dry_run_attempts, 2);
assert.equal(automaticSuccess.processed_batches[0].dry_run_retry_count, 1);
assert.deepEqual(automaticSuccess.processed_batches[0].dry_run_sqlstates, ["40001"]);
assert.equal(automaticSuccess.processed_batches[0].archive_storage_modified, false);
assert.equal(automaticSuccess.processed_batches[0].recovery_storage_modified, true);
assert.equal(automaticSuccess.processed_batches[0].storage_modified, true);
assert.equal(automaticSuccess.processed_batches[0].execute_state, "cleaned");
assert.equal(automaticSuccess.processed_batches[0].execute_confirmed, true);
assert.equal(automaticSuccess.processed_batches[0].db_mutation_confirmed, true);
assert.equal(automaticSuccess.processed_batches[0].retry_state, "already_cleaned");
assert.equal(automaticSuccess.processed_batches[0].execute_attempts, 3);
assert.equal(automaticSuccess.processed_batches[0].execute_retry_count, 2);
assert.deepEqual(automaticSuccess.processed_batches[0].execute_sqlstates, ["40001", "40001", "55P03"]);
assert.equal(Object.hasOwn(automaticSuccess.processed_batches[0], "table_id"), false);
assert.equal(Object.hasOwn(automaticSuccess.processed_batches[0], "amounts"), false);

const capturedAutomaticSuccess = captureAggregateSummary({
  ...automaticSuccess,
  processed: [automaticProcessedBatch, { ...automaticProcessedBatch, batchId: "batch-b" }],
});
assert.equal(capturedAutomaticSuccess.report.processed_batch_count, 2);
assert.equal(capturedAutomaticSuccess.report.processed_batches.length, 2);
assert.equal(parseSummary(capturedAutomaticSuccess.summary), capturedAutomaticSuccess.line);
assert.equal(capturedAutomaticSuccess.summary.includes(sampleDbUrl), false);
assert.equal(capturedAutomaticSuccess.summary.includes(samplePassword), false);
assert.equal(capturedAutomaticSuccess.summary.includes(sampleJwt), false);
assert.equal(capturedAutomaticSuccess.summary.includes(sampleSecret), false);
assert.equal(capturedAutomaticSuccess.summary.includes(automaticProcessedBatch.tableId), false);

const eightBatchSuccess = aggregatePayload({
  ...automaticSuccess,
  processed: Array.from({ length: 8 }, (_, index) => ({
    ...automaticProcessedBatch,
    batchId: `batch-${index}`,
  })),
  stopReason: "batch_limit_reached",
});
assert.equal(eightBatchSuccess.processed_batch_count, 8);
assert.equal(eightBatchSuccess.processed_batches.length, 8);
assert.equal(eightBatchSuccess.stop_reason, "batch_limit_reached");

const noCandidateSuccess = aggregatePayload({
  ...automaticSuccess,
  processed: [],
  stopReason: "no_eligible_bot_only_table",
});
assert.equal(noCandidateSuccess.processed_batch_count, 0);
assert.deepEqual(noCandidateSuccess.processed_batches, []);
assert.equal(noCandidateSuccess.stop_reason, "no_eligible_bot_only_table");

const initFailureTemp = fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-stage-observability-init-"));
try {
  let capturedInitStdout = "";
  process.stdout.write = (chunk) => {
    capturedInitStdout += String(chunk);
    return true;
  };
  process.env.GITHUB_STEP_SUMMARY = path.join(initFailureTemp, "summary.md");
  const initError = new Error(
    `initialization failed for ${sampleDbUrl} ${sampleBearer} ${sampleSecret} transaction-123`,
  );
  const deps = {};
  Object.defineProperty(deps, "sql", {
    get() {
      throw initError;
    },
  });
  await assert.rejects(
    runStageAutomation({ env: cleanEnv({ SUPABASE_STAGE_URL: `https://${STAGE_PROJECT_REF}.supabase.co` }), deps }),
    (error) => error === initError,
  );
  const { report } = parseSingleAggregate(capturedInitStdout);
  assert.equal(report.state, "error");
  assert.equal(parseSummary(fs.readFileSync(process.env.GITHUB_STEP_SUMMARY, "utf8")), capturedInitStdout.trim());
  for (const secret of [sampleDbUrl, samplePassword, sampleJwt, sampleBearer, sampleSecret]) {
    assert.equal(capturedInitStdout.includes(secret), false, `aggregate leaked ${secret}`);
  }
} finally {
  fs.rmSync(initFailureTemp, { recursive: true, force: true });
  process.stdout.write = originalStdoutWrite;
  if (originalSummaryPath === undefined) delete process.env.GITHUB_STEP_SUMMARY;
  else process.env.GITHUB_STEP_SUMMARY = originalSummaryPath;
}

process.stdout.write("chips-ledger-stage-automation observability behavior passed\n");
