import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildArchiveBytes,
  buildExportRecord,
  buildManifest,
  runExport,
} from "../../scripts/ops/chips-ledger-archive-export.mjs";
import {
  ARCHIVE_BUCKET,
  ARCHIVE_MAX_BYTES,
  downloadPrivateArchiveObject,
  TABLE_IDENTITY_SUMMARY_ERROR_CODES,
  assertTableIdentitySummary,
  createManifestStore,
  diagnoseTableIdentitySummary,
  resolveStorageTarget,
  replaceVerifiedPrivateObject,
  storeArchive,
  uploadOrVerifyPrivateObject,
  verifyArchiveBucket,
  verifyLocalArchive,
} from "../../scripts/ops/chips-ledger-archive-store.mjs";

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

function makeFetch({ initialObject = null, bucketInitiallyExists = false, bucketValue = bucket() } = {}) {
  let object = initialObject;
  let bucketExists = bucketInitiallyExists;
  const calls = [];
  const fetch = async (url, init = {}) => {
    const requestUrl = new URL(url);
    const method = init.method || "GET";
    calls.push({ method, path: requestUrl.pathname, headers: new Headers(init.headers || {}) });
    if (requestUrl.pathname === `/storage/v1/bucket/${ARCHIVE_BUCKET}` && method === "GET") {
      return bucketExists ? responseJson(bucketValue) : responseJson({ message: "not found" }, 400);
    }
    if (requestUrl.pathname === "/storage/v1/bucket" && method === "POST") {
      bucketExists = true;
      return responseJson(bucket(), 200);
    }
    if (requestUrl.pathname.includes(`/storage/v1/object/authenticated/${ARCHIVE_BUCKET}/`) && method === "GET") {
      return object
        ? new Response(object, { status: 200, headers: { "content-type": "application/gzip" } })
        : responseJson({ message: "not found" }, 400);
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

const BOT_TABLE_ID = "00000000-0000-4000-8000-000000000010";
const BOT_TX_ID = "00000000-0000-4000-8000-000000000011";
const BOT_SYSTEM_ID = "00000000-0000-4000-8000-000000000012";
const BOT_ESCROW_ID = "00000000-0000-4000-8000-000000000013";
const BOT_CREATED_AT = "2026-07-01T00:00:00.123456Z";

function botExportCandidate() {
  return {
    id: BOT_TX_ID,
    sequence: "1",
    tx_type: "TABLE_BUY_IN",
    idempotency_key: `bot-seed-buyin:${BOT_TABLE_ID}:1`,
    payload_hash: "a".repeat(64),
    user_id: null,
    reference: `BOT_SEED_BUY_IN:${BOT_TABLE_ID}:1`,
    description: "bot-only storage regression",
    metadata: { tableId: BOT_TABLE_ID },
    created_by: BOT_SYSTEM_ID,
    created_at: BOT_CREATED_AT,
    entry_count: "2",
    table_related: true,
    table_id: BOT_TABLE_ID,
    table_exists: true,
    table_status: "CLOSED",
    escrow_account_id: BOT_ESCROW_ID,
    escrow_status: "active",
    escrow_balance: "0",
    has_human_participant: false,
    bot_only_proof_eligible: true,
    key_table_id: BOT_TABLE_ID,
    key_format_version: 1,
    key_format: "bot-seed-buyin",
    table_newest_created_at: BOT_CREATED_AT,
    table_identity_count: "1",
    table_eligible_count: "1",
    table_out_of_scope_keys_sha256: "b".repeat(64),
  };
}

function botExportEntries() {
  return [
    {
      id: "1", transaction_id: BOT_TX_ID, account_id: BOT_ESCROW_ID, entry_seq: "1", amount: "100",
      metadata: {}, created_at: BOT_CREATED_AT, account_row_id: BOT_ESCROW_ID, account_type: "ESCROW",
      account_user_id: null, account_system_key: `POKER_TABLE:${BOT_TABLE_ID}`, account_status: "active", account_label: null,
    },
    {
      id: "2", transaction_id: BOT_TX_ID, account_id: BOT_SYSTEM_ID, entry_seq: "2", amount: "-100",
      metadata: {}, created_at: BOT_CREATED_AT, account_row_id: BOT_SYSTEM_ID, account_type: "SYSTEM",
      account_user_id: null, account_system_key: "TREASURY", account_status: "active", account_label: null,
    },
  ];
}

function makeExportSql(candidateRow, entryRows) {
  return {
    typed: (value, type) => ({ value, type }),
    begin: async (callback) => callback({
      unsafe: async (query, parameters = []) => {
        if (/set transaction isolation level repeatable read, read only/i.test(query)) return [];
        if (parameters.length === 4) return [candidateRow];
        if (parameters.length === 1 && Array.isArray(parameters[0])) return entryRows;
        throw new Error(`unexpected runExport query: ${query}`);
      },
    }),
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

const validSummary = {
  newest_created_at: "2026-07-01T00:00:00.000000Z",
  identity_count: "1",
  eligible_count: "1",
  out_of_scope_keys_sha256: "b".repeat(64),
};
const validBotOnlyManifest = {
  newest_created_at: "2026-07-01T00:00:00.000000Z",
  identity_count: 1,
  eligible_count: 1,
};
assert.equal(diagnoseTableIdentitySummary(validSummary, validBotOnlyManifest).ok, true);
assert.deepEqual(
  [
    [null, TABLE_IDENTITY_SUMMARY_ERROR_CODES.MISSING],
    [{ ...validSummary, newest_created_at: "invalid" }, TABLE_IDENTITY_SUMMARY_ERROR_CODES.NEWEST_CREATED_AT_INVALID],
    [{ ...validSummary, identity_count: "not-a-count" }, TABLE_IDENTITY_SUMMARY_ERROR_CODES.IDENTITY_COUNT_INVALID],
    [validSummary, TABLE_IDENTITY_SUMMARY_ERROR_CODES.IDENTITY_COUNT_MISMATCH],
    [{ ...validSummary, eligible_count: "not-a-count" }, TABLE_IDENTITY_SUMMARY_ERROR_CODES.ELIGIBLE_COUNT_INVALID],
    [validSummary, TABLE_IDENTITY_SUMMARY_ERROR_CODES.ELIGIBLE_COUNT_MISMATCH],
    [{ ...validSummary, out_of_scope_keys_sha256: "B".repeat(64) }, TABLE_IDENTITY_SUMMARY_ERROR_CODES.OUT_OF_SCOPE_KEYS_SHA256_INVALID],
    [{ ...validSummary, newest_created_at: "2026-07-01T00:00:01.000000Z" }, TABLE_IDENTITY_SUMMARY_ERROR_CODES.NEWEST_CREATED_AT_SEMANTIC_MISMATCH],
  ].map(([summaryValue, code], index) => {
    const manifestValue = index === 3
      ? { ...validBotOnlyManifest, identity_count: 2 }
      : index === 5
        ? { ...validBotOnlyManifest, eligible_count: 2 }
        : validBotOnlyManifest;
    return [diagnoseTableIdentitySummary(summaryValue, manifestValue).code, code];
  }),
  [
    [TABLE_IDENTITY_SUMMARY_ERROR_CODES.MISSING, TABLE_IDENTITY_SUMMARY_ERROR_CODES.MISSING],
    [TABLE_IDENTITY_SUMMARY_ERROR_CODES.NEWEST_CREATED_AT_INVALID, TABLE_IDENTITY_SUMMARY_ERROR_CODES.NEWEST_CREATED_AT_INVALID],
    [TABLE_IDENTITY_SUMMARY_ERROR_CODES.IDENTITY_COUNT_INVALID, TABLE_IDENTITY_SUMMARY_ERROR_CODES.IDENTITY_COUNT_INVALID],
    [TABLE_IDENTITY_SUMMARY_ERROR_CODES.IDENTITY_COUNT_MISMATCH, TABLE_IDENTITY_SUMMARY_ERROR_CODES.IDENTITY_COUNT_MISMATCH],
    [TABLE_IDENTITY_SUMMARY_ERROR_CODES.ELIGIBLE_COUNT_INVALID, TABLE_IDENTITY_SUMMARY_ERROR_CODES.ELIGIBLE_COUNT_INVALID],
    [TABLE_IDENTITY_SUMMARY_ERROR_CODES.ELIGIBLE_COUNT_MISMATCH, TABLE_IDENTITY_SUMMARY_ERROR_CODES.ELIGIBLE_COUNT_MISMATCH],
    [TABLE_IDENTITY_SUMMARY_ERROR_CODES.OUT_OF_SCOPE_KEYS_SHA256_INVALID, TABLE_IDENTITY_SUMMARY_ERROR_CODES.OUT_OF_SCOPE_KEYS_SHA256_INVALID],
    [TABLE_IDENTITY_SUMMARY_ERROR_CODES.NEWEST_CREATED_AT_SEMANTIC_MISMATCH, TABLE_IDENTITY_SUMMARY_ERROR_CODES.NEWEST_CREATED_AT_SEMANTIC_MISMATCH],
  ],
);
for (const [actual, expected] of [
  ["2026-07-01T00:00:00Z", "2026-07-01T00:00:00Z"],
  ["2026-07-01T00:00:00Z", "2026-07-01T00:00:00+00"],
  ["2026-07-01T00:00:00.123456Z", "2026-07-01T00:00:00.123456+00"],
]) {
  const timestampDiagnosis = diagnoseTableIdentitySummary(
    { ...validSummary, newest_created_at: actual },
    { ...validBotOnlyManifest, newest_created_at: expected },
  );
  assert.equal(timestampDiagnosis.ok, true);
  assert.equal(timestampDiagnosis.strict_timestamp_equal, actual === expected);
  assert.equal(timestampDiagnosis.semantic_timestamp_equal, true);
  if (actual !== expected) {
    assert.equal(timestampDiagnosis.code, TABLE_IDENTITY_SUMMARY_ERROR_CODES.NEWEST_CREATED_AT_REPRESENTATION_ONLY_MISMATCH);
  }
}
assert.equal(
  assertTableIdentitySummary(
    { ...validSummary, newest_created_at: "2026-07-01T00:00:00.123456Z" },
    { ...validBotOnlyManifest, newest_created_at: "2026-07-01 00:00:00.123456+00" },
  ).semantic_timestamp_equal,
  true,
);
assert.throws(
  () => assertTableIdentitySummary(validSummary, { ...validBotOnlyManifest, newest_created_at: "2026-07-01T00:00:01.000000Z" }),
  (error) => error?.code === TABLE_IDENTITY_SUMMARY_ERROR_CODES.NEWEST_CREATED_AT_SEMANTIC_MISMATCH,
);

try {
  const flowDir = fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-export-local-verify-flow-"));
  try {
    const flowArtifactPath = path.join(flowDir, "bot-only.archive.jsonl.gz");
    const flowManifestPath = path.join(flowDir, "bot-only.archive.manifest.json");
    const flowCutoff = "2026-07-08T00:00:00.000000Z";
    const exported = await runExport({
      argv: [
        "--target", "stage",
        "--cutoff", flowCutoff,
        "--batch-size", "5000",
        "--output", flowArtifactPath,
        "--manifest", flowManifestPath,
      ],
      env: ENV,
      cwd: flowDir,
      now: new Date(flowCutoff),
      deps: {
        sql: makeExportSql(botExportCandidate(), botExportEntries()),
        selector: "bot-only-7d",
        schemaVersion: 2,
        sourcePolicyId: "stage-ledger-bot-only-retention-7d-v1",
        targetOptions: { singleTarget: true },
        emit: false,
      },
    });
    assert.equal(exported.batch.transactions, 1);
    assert.equal(exported.batch.entries, 2);

    const equivalentManifest = JSON.parse(fs.readFileSync(flowManifestPath, "utf8"));
    equivalentManifest.bot_only.newest_created_at = "2026-07-01 00:00:00.123456+00";
    fs.writeFileSync(flowManifestPath, `${JSON.stringify(equivalentManifest)}\n`);
    const verifiedEquivalent = verifyLocalArchive({
      artifactPath: flowArtifactPath,
      manifestPath: flowManifestPath,
      target: resolveStorageTarget("stage", ENV),
    });
    assert.equal(verifiedEquivalent.records.length, 1);
    assert.equal(verifiedEquivalent.summary.transactionCount, 1);
    assert.equal(verifiedEquivalent.summary.entryCount, 2);

    equivalentManifest.bot_only.newest_created_at = "2026-07-01T00:00:00.123457Z";
    fs.writeFileSync(flowManifestPath, `${JSON.stringify(equivalentManifest)}\n`);
    await assert.rejects(
      () => Promise.resolve().then(() => verifyLocalArchive({
        artifactPath: flowArtifactPath,
        manifestPath: flowManifestPath,
        target: resolveStorageTarget("stage", ENV),
      })),
      (error) => error?.code === TABLE_IDENTITY_SUMMARY_ERROR_CODES.NEWEST_CREATED_AT_SEMANTIC_MISMATCH,
    );
  } finally {
    fs.rmSync(flowDir, { recursive: true, force: true });
  }

  const publicBucketStorage = makeFetch({
    bucketInitiallyExists: true,
    bucketValue: { ...bucket(), public: true },
  });
  await assert.rejects(
    () => verifyArchiveBucket(resolveStorageTarget("stage", ENV), { fetch: publicBucketStorage.fetch }),
    /must be private/,
  );
  assert.deepEqual(
    publicBucketStorage.calls.map(({ method, path: requestPath }) => [method, requestPath]),
    [["GET", `/storage/v1/bucket/${ARCHIVE_BUCKET}`]],
    "read-only bucket verification must never create or update a bucket",
  );

  const privateObjectPath = `v1/sha256/${"a".repeat(64)}.jsonl.gz`;
  const privateObjectBytes = Buffer.from("verified private archive");
  const runPrivateGetScenario = async (outcomes) => {
    const calls = [];
    const sleeps = [];
    const fetch = async (_url, init = {}) => {
      const method = init.method || "GET";
      calls.push({ method, headers: new Headers(init.headers || {}) });
      const outcome = outcomes[calls.length - 1];
      if (outcome instanceof Error) throw outcome;
      if (outcome === 200) {
        return new Response(privateObjectBytes, {
          status: 200,
          headers: { "content-type": "application/gzip" },
        });
      }
      return new Response("temporary Storage failure", { status: outcome });
    };
    const value = await downloadPrivateArchiveObject(
      resolveStorageTarget("stage", ENV),
      privateObjectPath,
      {
        fetch,
        sleep: (milliseconds) => { sleeps.push(milliseconds); },
      },
    );
    return { value, calls, sleeps };
  };

  const recoveredAfter544 = await runPrivateGetScenario([544, 200]);
  assert.equal(recoveredAfter544.calls.length, 2, "HTTP 544 may have one bounded retry");
  assert.deepEqual(recoveredAfter544.sleeps, [50]);
  assert.equal(recoveredAfter544.calls.every(({ method }) => method === "GET"), true);
  assert.equal(recoveredAfter544.calls[0].headers.get("authorization"), `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
  assert.equal(recoveredAfter544.value.bytes.equals(privateObjectBytes), true);
  assert.equal(recoveredAfter544.value.sha256, crypto.createHash("sha256").update(privateObjectBytes).digest("hex"));

  const exhausted544Calls = [];
  const exhausted544Sleeps = [];
  await assert.rejects(
    () => downloadPrivateArchiveObject(resolveStorageTarget("stage", ENV), privateObjectPath, {
      fetch: async (_url, init = {}) => {
        exhausted544Calls.push(init.method || "GET");
        return new Response("persistent Storage failure", { status: 544 });
      },
      sleep: (milliseconds) => { exhausted544Sleeps.push(milliseconds); },
    }),
    /HTTP 544/,
  );
  assert.deepEqual(exhausted544Calls, ["GET", "GET", "GET"]);
  assert.deepEqual(exhausted544Sleeps, [50, 100]);

  for (const status of [400, 401, 402, 403, 404]) {
    const calls = [];
    const sleeps = [];
    await assert.rejects(
      () => downloadPrivateArchiveObject(resolveStorageTarget("stage", ENV), privateObjectPath, {
        fetch: async (_url, init = {}) => {
          calls.push(init.method || "GET");
          return new Response("non-retryable Storage failure", { status });
        },
        sleep: (milliseconds) => { sleeps.push(milliseconds); },
      }),
      new RegExp(`HTTP ${status}`),
    );
    assert.deepEqual(calls, ["GET"]);
    assert.deepEqual(sleeps, []);
  }

  const nonRetryableWriteCalls = [];
  await assert.rejects(
    () => uploadOrVerifyPrivateObject({
      storageTarget: resolveStorageTarget("stage", ENV),
      objectPath: `recovery/v1/sha256/${"b".repeat(64)}.jsonl.gz`,
      bytes: privateObjectBytes,
      deps: {
        fetch: async (_url, init = {}) => {
          const method = init.method || "GET";
          nonRetryableWriteCalls.push(method);
          if (method === "GET") return new Response("missing", { status: 404 });
          return new Response("write failure", { status: 500 });
        },
        sleep: () => { throw new Error("Storage writes must never be retried"); },
      },
    }),
    /HTTP 500/,
  );
  assert.deepEqual(nonRetryableWriteCalls, ["GET", "POST"]);

  const racedObjectPath = `recovery/v1/sha256/${"c".repeat(64)}.jsonl.gz`;
  const racedBytes = Buffer.from("recovery bytes written by the concurrent worker");
  let racedObject = null;
  const racedCalls = [];
  const racedFetch = async (url, init = {}) => {
    const method = init.method || "GET";
    racedCalls.push({ method, headers: new Headers(init.headers || {}) });
    if (method === "GET") {
      return racedObject
        ? new Response(racedObject, { status: 200, headers: { "content-type": "application/gzip" } })
        : new Response("missing", { status: 404 });
    }
    assert.equal(method, "POST");
    assert.equal(new Headers(init.headers).get("x-upsert"), "false");
    racedObject = Buffer.from(init.body);
    return responseJson({ message: "Asset Already Exists" }, 409);
  };
  const raced = await uploadOrVerifyPrivateObject({
    storageTarget: resolveStorageTarget("stage", ENV),
    objectPath: racedObjectPath,
    bytes: racedBytes,
    deps: { fetch: racedFetch },
  });
  assert.equal(raced.objectExisted, true, "a concurrent identical object is treated as pre-existing");
  assert.equal(raced.uploaded, false, "a concurrent identical object is not reported as uploaded");
  assert.equal(raced.sha256, crypto.createHash("sha256").update(racedBytes).digest("hex"));
  assert.deepEqual(racedCalls.map(({ method }) => method), ["GET", "POST", "GET"]);

  let foreignRacedObject = null;
  const foreignRacedCalls = [];
  const foreignRacedFetch = async (_url, init = {}) => {
    const method = init.method || "GET";
    foreignRacedCalls.push(method);
    if (method === "GET") {
      return foreignRacedObject
        ? new Response(foreignRacedObject, { status: 200, headers: { "content-type": "application/gzip" } })
        : new Response("missing", { status: 404 });
    }
    foreignRacedObject = Buffer.from("foreign recovery bytes");
    return responseJson({ message: "Asset Already Exists" }, 409);
  };
  await assert.rejects(
    () => uploadOrVerifyPrivateObject({
      storageTarget: resolveStorageTarget("stage", ENV),
      objectPath: `recovery/v1/sha256/${"d".repeat(64)}.jsonl.gz`,
      bytes: racedBytes,
      deps: { fetch: foreignRacedFetch },
    }),
    /verification differs/,
  );
  assert.deepEqual(foreignRacedCalls, ["GET", "POST", "GET"], "foreign race content must fail closed without a retry write");

  const transientNetworkError = Object.assign(new TypeError("temporary network failure"), { code: "ECONNRESET" });
  const recoveredAfterNetwork = await runPrivateGetScenario([transientNetworkError, 200]);
  assert.equal(recoveredAfterNetwork.calls.length, 2);
  assert.deepEqual(recoveredAfterNetwork.sleeps, [50]);

  await assert.rejects(
    () => downloadPrivateArchiveObject(resolveStorageTarget("stage", ENV), privateObjectPath, {
      fetch: async () => new Response(privateObjectBytes, {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
      sleep: () => { throw new Error("MIME verification must not retry"); },
    }),
    /unexpected MIME type/,
  );

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

  const replacementPath = "recovery/v1/sha256/" + "f".repeat(64) + ".recovery.json.gz";
  const originalManifest = Buffer.from("original recovery manifest");
  const correctedManifest = Buffer.from("corrected recovery manifest");
  let replacementObject = originalManifest;
  let returnStaleReadAfterPut = true;
  const replacementCalls = [];
  const replacementFetch = async (url, init = {}) => {
    const requestUrl = new URL(url);
    const method = init.method || "GET";
    const authenticatedPrefix = `/storage/v1/object/authenticated/${ARCHIVE_BUCKET}/`;
    const uploadPrefix = `/storage/v1/object/${ARCHIVE_BUCKET}/`;
    const prefix = requestUrl.pathname.startsWith(authenticatedPrefix) ? authenticatedPrefix : uploadPrefix;
    const objectPath = decodeURIComponent(requestUrl.pathname.slice(prefix.length));
    replacementCalls.push({ method, objectPath });
    assert.equal(objectPath, replacementPath);
    if (method === "GET") {
      if (replacementObject.equals(correctedManifest) && returnStaleReadAfterPut) {
        returnStaleReadAfterPut = false;
        return new Response(originalManifest, { status: 200, headers: { "content-type": "application/gzip" } });
      }
      return new Response(replacementObject, { status: 200, headers: { "content-type": "application/gzip" } });
    }
    if (method === "PUT") {
      assert.equal(new Headers(init.headers).get("content-type"), "application/gzip");
      replacementObject = Buffer.from(init.body);
      return responseJson({ ok: true });
    }
    return responseJson({ message: "unexpected replacement method" }, 500);
  };
  const replaced = await replaceVerifiedPrivateObject({
    storageTarget: resolveStorageTarget("stage", ENV),
    objectPath: replacementPath,
    expectedCurrentBytes: originalManifest,
    bytes: correctedManifest,
    deps: { fetch: replacementFetch },
  });
  assert.equal(replaced.replaced, true);
  assert.equal(replaced.sha256, crypto.createHash("sha256").update(correctedManifest).digest("hex"));
  assert.equal(replacementObject.equals(correctedManifest), true);
  assert.deepEqual(replacementCalls.map(({ method }) => method), ["GET", "PUT", "GET", "GET"]);
  const alreadyReplaced = await replaceVerifiedPrivateObject({
    storageTarget: resolveStorageTarget("stage", ENV),
    objectPath: replacementPath,
    expectedCurrentBytes: originalManifest,
    bytes: correctedManifest,
    deps: { fetch: replacementFetch },
  });
  assert.equal(alreadyReplaced.alreadyReplaced, true);
  assert.equal(alreadyReplaced.replaced, false);
  assert.equal(alreadyReplaced.bytes, correctedManifest.length);
  assert.equal(alreadyReplaced.sha256, crypto.createHash("sha256").update(correctedManifest).digest("hex"));
  assert.equal(alreadyReplaced.verifiedBytes.equals(correctedManifest), true);
  assert.deepEqual(replacementCalls.slice(-1).map(({ method }) => method), ["GET"]);
  await assert.rejects(
    () => replaceVerifiedPrivateObject({
      storageTarget: resolveStorageTarget("stage", ENV),
      objectPath: replacementPath,
      expectedCurrentBytes: originalManifest,
      bytes: Buffer.from("second replacement"),
      deps: { fetch: replacementFetch },
    }),
    /precondition differs/,
  );
  assert.equal(replacementCalls.filter(({ method }) => method === "PUT").length, 1);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

process.stdout.write("chips-ledger-archive-storage tests passed\n");
