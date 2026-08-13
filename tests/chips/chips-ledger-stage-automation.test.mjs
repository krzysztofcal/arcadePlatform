import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { readSnapshot, STAGE_AUTOMATION_POLICY_ID } from "../../scripts/ops/chips-ledger-archive-export.mjs";
import {
  assertDurableRecoveryReady,
  assertResumeRecoveryState,
  findOwnCycle,
  persistDurableRecovery,
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

const STAGE_DB_URL = "postgresql://postgres.krydukthwdvccggbyjfw@db.krydukthwdvccggbyjfw.supabase.co:5432/postgres";
const STAGE_URL = "https://krydukthwdvccggbyjfw.supabase.co";
const ENV = {
  SUPABASE_STAGE_DB_URL: STAGE_DB_URL,
  SUPABASE_STAGE_URL: STAGE_URL,
  SUPABASE_STAGE_SERVICE_ROLE_KEY: "stage-test-key",
};

const stageOrchestratorSource = fs.readFileSync("scripts/ops/chips-ledger-stage-automation.mjs", "utf8");
assert.doesNotMatch(stageOrchestratorSource, /--after-(?:created-at|id)/);

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
const storageTarget = {
  target: "stage",
  projectRef: STAGE_PROJECT_REF,
  baseUrl: STAGE_URL,
  serviceKey: "stage-test-key",
};
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

process.stdout.write("chips-ledger-stage-automation tests passed\n");
