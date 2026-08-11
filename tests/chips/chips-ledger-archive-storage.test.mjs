import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildArchiveBytes,
  buildExportRecord,
  buildManifest,
} from "../../scripts/ops/chips-ledger-archive-export.mjs";
import { ARCHIVE_BUCKET, ARCHIVE_MAX_BYTES, createManifestStore, storeArchive } from "../../scripts/ops/chips-ledger-archive-store.mjs";

const TX_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const SYSTEM_ID = "00000000-0000-4000-8000-000000000003";

const ENV = {
  EXPECTED_SUPABASE_STAGE_PROJECT_REF: "krydukthwdvccggbyjfw",
  EXPECTED_SUPABASE_PROD_PROJECT_REF: "otbqfijerkieoxwpxjnm",
  SUPABASE_STAGE_DB_URL: "postgresql://postgres.krydukthwdvccggbyjfw@db.krydukthwdvccggbyjfw.supabase.co:5432/postgres",
  SUPABASE_PROD_DB_URL: "postgresql://postgres.otbqfijerkieoxwpxjnm@db.otbqfijerkieoxwpxjnm.supabase.co:5432/postgres",
  SUPABASE_URL: "https://krydukthwdvccggbyjfw.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
};

function responseJson(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function bucket() {
  return {
    id: ARCHIVE_BUCKET,
    name: ARCHIVE_BUCKET,
    public: false,
    file_size_limit: ARCHIVE_MAX_BYTES,
    allowed_mime_types: ["application/gzip"],
  };
}

function makeFetch({ initialObject = null, bucketInitiallyExists = false } = {}) {
  let object = initialObject;
  let bucketExists = bucketInitiallyExists;
  const calls = [];
  const fetch = async (url, init = {}) => {
    const requestUrl = new URL(url);
    const method = init.method || "GET";
    calls.push({ method, path: requestUrl.pathname, headers: new Headers(init.headers || {}) });
    if (requestUrl.pathname === `/storage/v1/bucket/${ARCHIVE_BUCKET}` && method === "GET") {
      return bucketExists ? responseJson(bucket()) : responseJson({ message: "not found" }, 404);
    }
    if (requestUrl.pathname === "/storage/v1/bucket" && method === "POST") {
      bucketExists = true;
      return responseJson(bucket(), 200);
    }
    if (requestUrl.pathname.includes(`/storage/v1/object/authenticated/${ARCHIVE_BUCKET}/`) && method === "GET") {
      return object ? new Response(object, { status: 200 }) : new Response(null, { status: 404 });
    }
    if (requestUrl.pathname.includes(`/storage/v1/object/${ARCHIVE_BUCKET}/`) && method === "POST") {
      assert.equal(new Headers(init.headers).get("x-upsert"), "false");
      if (object) return responseJson({ message: "Asset Already Exists" }, 400);
      object = Buffer.from(init.body);
      return responseJson({ Key: requestUrl.pathname }, 200);
    }
    return responseJson({ message: "unexpected fake request" }, 500);
  };
  return { fetch, calls, get object() { return object; } };
}

function makeStore(initial = null) {
  let row = initial;
  let insertCount = 0;
  let commitCount = 0;
  return {
    get: async () => row,
    insertPending: async (expected) => {
      insertCount += 1;
      if (!row) row = { ...expected };
    },
    markCommitted: async () => {
      commitCount += 1;
      if (row?.status === "pending") row = { ...row, status: "committed" };
      return row;
    },
    get insertCount() { return insertCount; },
    get commitCount() { return commitCount; },
    get row() { return row; },
  };
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-storage-test-"));
const artifactPath = path.join(tempDir, "chips-ledger-stage.jsonl.gz");
const manifestPath = path.join(tempDir, "chips-ledger-stage.manifest.json");
const candidate = {
  id: TX_ID,
  sequence: "1",
  tx_type: "BUY_IN",
  idempotency_key: "storage-test:1",
  payload_hash: "hash",
  user_id: USER_ID,
  reference: null,
  description: "storage test",
  metadata: {},
  created_by: USER_ID,
  created_at: "2026-01-01T00:00:00.000000Z",
  entry_count: "2",
  table_related: false,
};
const record = buildExportRecord(candidate, [
  {
    id: "2", transaction_id: TX_ID, account_id: SYSTEM_ID, entry_seq: "2", amount: "-9007199254740993",
    metadata: {}, created_at: "2026-01-01T00:00:00.000000Z", account_row_id: SYSTEM_ID, account_type: "SYSTEM",
    account_user_id: null, account_system_key: "TREASURY", account_status: "active", account_label: null,
  },
  {
    id: "1", transaction_id: TX_ID, account_id: USER_ID, entry_seq: "1", amount: "9007199254740993",
    metadata: {}, created_at: "2026-01-01T00:00:00.000000Z", account_row_id: USER_ID, account_type: "USER",
    account_user_id: USER_ID, account_system_key: null, account_status: "active", account_label: null,
  },
]);
const archive = buildArchiveBytes([record]);
const localManifest = buildManifest({
  target: "stage",
  cutoff: "2026-02-01T00:00:00.000000Z",
  batchSize: 5000,
  cursor: null,
  records: [record],
  archive,
  outputPath: artifactPath,
});
fs.writeFileSync(artifactPath, archive.compressedBytes, { mode: 0o600 });
fs.writeFileSync(manifestPath, `${JSON.stringify(localManifest)}\n`, { mode: 0o600 });

try {
  const firstStorage = makeFetch();
  const firstStore = makeStore();
  const first = await storeArchive({
    argv: ["--target", "stage", "--artifact", artifactPath, "--manifest", manifestPath],
    env: ENV,
    deps: { fetch: firstStorage.fetch, manifestStore: firstStore, emit: false },
  });
  assert.equal(first.manifest.status, "committed");
  assert.equal(first.object.uploaded, true);
  assert.equal(firstStore.insertCount, 1);
  assert.equal(firstStore.commitCount, 1);
  assert.equal(firstStorage.calls.filter((call) => call.method === "POST" && call.path.includes("/object/")).length, 1);

  const sqlCalls = [];
  const sqlAdapter = createManifestStore({
    typed: (value, type) => ({ value, type }),
    unsafe: async (query, values) => { sqlCalls.push({ query, values }); return []; },
  });
  await sqlAdapter.insertPending(firstStore.row);
  assert.equal(typeof sqlCalls[0].values[12], "object");
  assert.deepEqual(sqlCalls[0].values[12], firstStore.row.tx_types);
  assert.deepEqual(sqlCalls[0].values[3], { value: firstStore.row.cutoff, type: 25 });

  const retryStore = makeStore({ ...firstStore.row, status: "pending" });
  const retry = await storeArchive({
    argv: ["--target", "stage", "--artifact", artifactPath, "--manifest", manifestPath],
    env: ENV,
    deps: { fetch: firstStorage.fetch, manifestStore: retryStore, emit: false },
  });
  assert.equal(retry.manifest.status, "committed");
  assert.equal(retry.idempotent, true);
  assert.equal(retry.object.uploaded, false);
  assert.equal(firstStorage.calls.filter((call) => call.method === "POST" && call.path.includes("/object/")).length, 1);

  const mismatchStorage = makeFetch({ initialObject: Buffer.from("different object"), bucketInitiallyExists: true });
  const mismatchStore = makeStore({ ...firstStore.row, status: "pending" });
  await assert.rejects(
    () => storeArchive({
      argv: ["--target", "stage", "--artifact", artifactPath, "--manifest", manifestPath],
      env: ENV,
      deps: { fetch: mismatchStorage.fetch, manifestStore: mismatchStore, emit: false },
    }),
    /does not match the local artifact/,
  );
  assert.equal(mismatchStore.commitCount, 0);
  assert.equal(mismatchStore.row.status, "pending");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

process.stdout.write("chips-ledger-archive-storage tests passed\n");
