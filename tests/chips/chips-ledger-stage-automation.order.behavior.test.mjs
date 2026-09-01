import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runStageAutomation,
  STAGE_PROJECT_REF,
  STAGE_SYSTEM_IDENTIFIER,
} from "../../scripts/ops/chips-ledger-stage-automation.mjs";
import { STAGE_AUTOMATION_POLICY_ID } from "../../scripts/ops/chips-ledger-archive-export.mjs";
import {
  ARCHIVE_BUCKET,
  buildRecoveryArchiveObjectPath,
  buildRecoveryManifestObjectPath,
} from "../../scripts/ops/chips-ledger-archive-store.mjs";

const STAGE_URL = "https://krydukthwdvccggbyjfw.supabase.co";
const ENV = {
  SUPABASE_STAGE_DB_URL: "postgresql://postgres.krydukthwdvccggbyjfw@db.krydukthwdvccggbyjfw.supabase.co:5432/postgres",
  SUPABASE_STAGE_URL: STAGE_URL,
  SUPABASE_STAGE_SERVICE_ROLE_KEY: "stage-test-key",
};

function response(value, status = 200, headers = {}) {
  if (Buffer.isBuffer(value)) {
    return new Response(value, { status, headers: { "content-type": "application/gzip", ...headers } });
  }
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}

function fakeSql({ unlockError = null } = {}) {
  const calls = [];
  const sql = {
    calls,
    unsafe: async (query, values = []) => {
      calls.push({ query, values });
      if (query.includes("pg_try_advisory_lock")) return [{ acquired: true, backend_pid: "stage-order-session" }];
      if (query.includes("pg_control_system")) return [{ system_identifier: STAGE_SYSTEM_IDENTIFIER }];
      if (query.includes("pg_backend_pid")) return [{ backend_pid: "stage-order-session" }];
      if (query.includes("pg_advisory_unlock")) {
        if (unlockError) throw unlockError;
        return [{ pg_advisory_unlock: true }];
      }
      if (query.includes("from public.chips_ledger_archive_batches")) return [];
      throw new Error(`unexpected SQL: ${query}`);
    },
  };
  return sql;
}

const archiveBytes = Buffer.from("verified gzip archive copy");
const compressedSha = crypto.createHash("sha256").update(archiveBytes).digest("hex");
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
const row = {
  status: "pending",
  batch_id: "7",
  object_path: `v1/sha256/${compressedSha}.jsonl.gz`,
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

const events = [];
const durableObjects = new Map();
const storageTarget = {
  target: "stage",
  projectRef: STAGE_PROJECT_REF,
  baseUrl: STAGE_URL,
  serviceKey: "stage-test-key",
};
const recoveryPathFromUrl = (url) => {
  const pathname = new URL(url).pathname;
  const authenticatedPrefix = `/storage/v1/object/authenticated/${ARCHIVE_BUCKET}/`;
  const uploadPrefix = `/storage/v1/object/${ARCHIVE_BUCKET}/`;
  const prefix = pathname.startsWith(authenticatedPrefix) ? authenticatedPrefix : uploadPrefix;
  return decodeURIComponent(pathname.slice(prefix.length));
};
const fetch = async (url, init = {}) => {
  const method = init.method || "GET";
  const objectPath = recoveryPathFromUrl(url);
  if (method === "GET") {
    events.push({ type: "recovery-download", objectPath, private: new URL(url).pathname.includes("/authenticated/") });
    const value = durableObjects.get(objectPath);
    return value ? response(value) : response({ message: "not found" }, 404);
  }
  if (method === "POST") {
    const headers = new Headers(init.headers || {});
    assert.equal(headers.get("x-upsert"), "false");
    assert.equal(headers.get("content-type"), "application/gzip");
    events.push({ type: "recovery-upload", objectPath });
    durableObjects.set(objectPath, Buffer.from(init.body));
    return response({ ok: true });
  }
  return response({ message: "unexpected method" }, 500);
};

let rowState = { ...row };
const pruneModes = [];
const unlockError = new Error("advisory unlock failed after successful cycle");
const cycleSql = fakeSql({ unlockError });
const result = await runStageAutomation({
  env: ENV,
  deps: {
    sql: cycleSql,
    fetch,
    storageTarget,
    tempRoot: fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-stage-order-")),
    verifyBucket: async () => events.push({ type: "bucket-verified" }),
    ensureArchiveBucket: async () => events.push({ type: "bucket-ensured" }),
    exportArchive: async ({ argv }) => {
      events.push({ type: "export" });
      assert.equal(argv.includes("--batch-size"), true);
      return { bytes: { raw: 1 } };
    },
    storeArchive: async () => {
      events.push({ type: "archive-upload" });
      return { objectPath: row.object_path };
    },
    pruneStore: {
      getManifest: async () => rowState,
    },
    pruneArchive: async ({ argv }) => {
      const mode = argv.includes("--execute") ? "execute" : argv.includes("--register-proof") ? "register-proof" : "dry-run";
      pruneModes.push({ mode, argv });
      events.push({ type: mode });
      if (mode === "register-proof") {
        rowState = {
          ...rowState,
          status: "committed",
          archive_proof_verified_at: "2026-08-13T00:01:00.000000Z",
          archived_transaction_ids_sha256: evidence.transactionIdsSha256,
          archived_entry_ids_sha256: evidence.entryIdsSha256,
        };
        return { state: "proof_registered", evidence };
      }
      return { state: mode === "dry-run" ? "ready" : "pruned", evidence };
    },
    downloadPrivateArchive: async () => {
      events.push({ type: "primary-download" });
      return { bytes: archiveBytes, downloadMs: 0 };
    },
  },
});

assert.equal(result.state, "pruned");
assert.equal(cycleSql.calls.filter(({ query }) => query.includes("pg_advisory_unlock")).length, 1);
assert.deepEqual(pruneModes.map(({ mode }) => mode), ["register-proof", "dry-run", "execute"]);
assert.equal(pruneModes.at(-1).argv.includes("--execute"), true);

const executeIndex = events.findIndex(({ type }) => type === "execute");
assert.notEqual(executeIndex, -1);
assert.ok(events.findIndex(({ type }) => type === "primary-download") < executeIndex);
const recoveryUploads = events.filter(({ type }) => type === "recovery-upload");
const recoveryDownloads = events.filter(({ type }) => type === "recovery-download");
const recoveryPaths = [
  buildRecoveryArchiveObjectPath(compressedSha),
  buildRecoveryManifestObjectPath(compressedSha),
];
assert.equal(recoveryUploads.length, 2);
assert.deepEqual(recoveryUploads.map(({ objectPath }) => objectPath), recoveryPaths);
assert.equal(recoveryDownloads.length, 8, "pre-write recovery inspection adds two read-only object checks");
assert.equal(recoveryDownloads.every(({ private: isPrivate }) => isPrivate), true);
assert.equal(new Set(recoveryDownloads.map(({ objectPath }) => objectPath)).size, 2);
for (const objectPath of recoveryPaths) {
  const uploadIndex = events.findIndex(({ type, objectPath: pathValue }) => type === "recovery-upload" && pathValue === objectPath);
  const downloadIndexes = events.flatMap((event, index) => event.type === "recovery-download" && event.objectPath === objectPath ? [index] : []);
  assert.equal(downloadIndexes.length, 4);
  assert.ok(uploadIndex >= 0);
  assert.equal(downloadIndexes.some((index) => index > uploadIndex && index < executeIndex), true);
  assert.equal(downloadIndexes.every((index) => index < executeIndex), true);
}
assert.equal(Math.max(...events.map((event, index) => event.type === "recovery-download" ? index : -1)) < executeIndex, true);

process.stdout.write("chips-ledger-stage-automation order behavior passed\n");
