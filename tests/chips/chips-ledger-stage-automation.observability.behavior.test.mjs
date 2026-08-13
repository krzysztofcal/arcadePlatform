import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import {
  redactedError,
  runStageAutomation,
  STAGE_PROJECT_REF,
} from "../../scripts/ops/chips-ledger-stage-automation.mjs";
import { STAGE_AUTOMATION_POLICY_ID } from "../../scripts/ops/chips-ledger-archive-export.mjs";

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
