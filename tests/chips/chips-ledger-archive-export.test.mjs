import assert from "node:assert/strict";
import {
  buildArchiveBytes,
  buildExportRecord,
  buildManifest,
  evaluateTableEligibility,
  readSnapshot,
  runExport,
  serializeRecords,
  resolveTarget,
  sortRecords,
  stringifyJson,
  validateBatch,
} from "../../scripts/ops/chips-ledger-archive-export.mjs";

const TX_A = "00000000-0000-4000-8000-00000000000a";
const TX_B = "00000000-0000-4000-8000-00000000000b";
const USER = "00000000-0000-4000-8000-000000000010";
const SYSTEM = "00000000-0000-4000-8000-000000000011";

function candidate(id, createdAt, overrides = {}) {
  return {
    id,
    sequence: "100",
    tx_type: "BUY_IN",
    idempotency_key: `test:${id}`,
    payload_hash: "hash",
    user_id: USER,
    reference: null,
    description: "test",
    metadata: {},
    created_by: USER,
    created_at: createdAt,
    entry_count: "2",
    table_related: false,
    ...overrides,
  };
}

function entry(id, transactionId, amount, accountId) {
  return {
    id: String(id),
    transaction_id: transactionId,
    account_id: accountId,
    entry_seq: String(id),
    amount: String(amount),
    metadata: {},
    created_at: "2026-01-01T00:00:00.000000Z",
    account_row_id: accountId,
    account_type: accountId === USER ? "USER" : "SYSTEM",
    account_user_id: accountId === USER ? USER : null,
    account_system_key: accountId === SYSTEM ? "TREASURY" : null,
    account_status: "active",
    account_label: null,
  };
}

function makeRecord(tx, firstEntryId = 1, amount = 10) {
  const positiveAmount = String(amount).replace(/^-/, "");
  return buildExportRecord(tx, [
    entry(firstEntryId + 1, tx.id, `-${positiveAmount}`, SYSTEM),
    entry(firstEntryId, tx.id, positiveAmount, USER),
  ]);
}

const candidateA = candidate(TX_A, "2026-01-01T00:00:00.000001Z");
const candidateB = candidate(TX_B, "2026-01-01T00:00:00.000001Z");
const recordA = makeRecord(candidateA, 1);
const recordB = makeRecord(candidateB, 3);

async function assertSnapshotTimestampBindings() {
  const queries = [];
  const sql = {
    typed: (value, type) => ({ value, type }),
    begin: async (callback) => callback({
      unsafe: async (query, parameters = []) => {
        queries.push({ query, parameters });
        return [];
      },
    }),
  };
  const cutoff = "2026-08-07T03:32:29.388506Z";
  const cursorCreatedAt = "2026-08-07T03:32:24.544123Z";
  const cursor = { created_at: cursorCreatedAt, id: TX_A };

  await readSnapshot(sql, { cutoff, batchSize: 2, cursor });
  const boundPage = queries.find(({ parameters }) => parameters.length === 4);
  assert.deepEqual(boundPage?.parameters, [
    { value: cutoff, type: 25 },
    2,
    { value: cursorCreatedAt, type: 25 },
    TX_A,
  ]);

  queries.length = 0;
  await readSnapshot(sql, { cutoff, batchSize: 2, cursor: null });
  const unboundedPage = queries.find(({ parameters }) => parameters.length === 4);
  assert.equal(unboundedPage?.parameters[2], null);
  assert.equal(unboundedPage?.parameters[3], null);
}

await assertSnapshotTimestampBindings();

async function assertBotOnlyPlannerGuardScope() {
  const cutoff = "2026-08-07T03:32:29.388506Z";
  const runWith = async (selector) => {
    const queries = [];
    const sql = {
      typed: (value, type) => ({ value, type }),
      begin: async (callback) => callback({
        unsafe: async (query, parameters = []) => {
          queries.push({ query, parameters });
          return [];
        },
      }),
    };
    await readSnapshot(sql, { cutoff, batchSize: 5000, selector });
    return queries;
  };

  const botOnlyQueries = await runWith("bot-only-7d");
  assert.equal(
    botOnlyQueries.some(({ query }) => query === "set local enable_nestloop = off;"),
    true,
    "bot-only-7d snapshot must disable nested loops for the candidate selector",
  );

  for (const selector of ["standard", "prunable"]) {
    const queries = await runWith(selector);
    assert.equal(
      queries.some(({ query }) => /enable_nestloop/i.test(query)),
      false,
      `${selector} snapshot must not apply the bot-only planner guard`,
    );
  }
}

await assertBotOnlyPlannerGuardScope();

async function assertSnapshotQueryTelemetry() {
  const telemetry = [];
  const sql = {
    typed: (value, type) => ({ value, type }),
    begin: async (callback) => callback({
      unsafe: async (query, parameters = []) => {
        if (parameters.length === 4) {
          const error = new Error("canceling statement due to statement timeout");
          error.code = "57014";
          throw error;
        }
        return [];
      },
    }),
  };

  await assert.rejects(
    () => readSnapshot(sql, {
      cutoff: "2026-08-07T03:32:29.388506Z",
      batchSize: 5000,
      selector: "bot-only-7d",
      telemetry: (event) => telemetry.push(event),
    }),
    /statement timeout/,
  );
  const failed = telemetry.find((event) => event.sqlstate === "57014");
  assert.equal(failed?.phase, "snapshot.candidate_selector");
  assert.equal(failed?.query_name, "bot_only_candidate_selector");
  assert.match(failed?.sql_sha256 || "", /^[0-9a-f]{64}$/);
  assert.equal(failed?.read_only, true);
  assert.equal(Object.hasOwn(failed || {}, "parameters"), false);
  assert.equal(Object.hasOwn(failed || {}, "rows"), false);
}

await assertSnapshotQueryTelemetry();

assert.throws(() => resolveTarget("unknown", {}), /target must be exactly stage or prod/);
await assert.rejects(
  () => runExport({ argv: ["--target", "stage"], env: {}, cwd: "/tmp" }),
  /--output is required/,
);
await assert.rejects(
  () => runExport({ argv: ["--output", "/tmp/chips-ledger-review.jsonl.gz"], env: { LEDGER_ARCHIVE_TARGET: "prod" }, cwd: "/tmp" }),
  /target must be exactly stage or prod/,
);
await assert.rejects(
  () => runExport({
    argv: ["--target", "prod", "--batch-size", "3", "--output", "/tmp/chips-ledger-prod-too-large.jsonl.gz"],
    env: {
      EXPECTED_SUPABASE_STAGE_PROJECT_REF: "krydukthwdvccggbyjfw",
      EXPECTED_SUPABASE_PROD_PROJECT_REF: "otbqfijerkieoxwpxjnm",
      SUPABASE_PROD_DB_URL: "postgresql://postgres.otbqfijerkieoxwpxjnm@db.otbqfijerkieoxwpxjnm.supabase.co:5432/postgres",
    },
    cwd: "/tmp",
  }),
  /--batch-size must be between 1 and 2/,
);
assert.equal(stringifyJson({ id: 123n, amount: -7n }), '{"id":"123","amount":"-7"}');
assert.equal(recordA.entries[0].amount, "10");
assert.equal(recordA.entries[1].amount, "-10");

const ordered = sortRecords([recordB, recordA]);
assert.deepEqual(ordered.map((record) => record.transaction.id), [TX_A, TX_B]);
assert.equal(serializeRecords(sortRecords([recordA, recordB])), serializeRecords(sortRecords([recordB, recordA])));

const validBatch = validateBatch({
  candidates: [candidateB, candidateA],
  records: ordered,
  cutoff: "2026-02-01T00:00:00Z",
});
assert.deepEqual(validBatch.txTypeCounts, { BUY_IN: 2 });
assert.equal(validBatch.entryCount, 4);
assert.equal(validBatch.credits, "20");
assert.equal(validBatch.debits, "20");
assert.equal(validBatch.netAmount, "0");
const hugeBatch = validateBatch({
  candidates: [candidateA],
  records: [makeRecord(candidateA, 5, "9007199254740993")],
  cutoff: "2026-02-01T00:00:00Z",
});
assert.equal(hugeBatch.credits, "9007199254740993");
assert.equal(hugeBatch.debits, "9007199254740993");
assert.equal(hugeBatch.netAmount, "0");
const archiveOne = buildArchiveBytes(ordered);
const archiveTwo = buildArchiveBytes(sortRecords([recordB, recordA]));
assert.equal(archiveOne.rawSha256, archiveTwo.rawSha256);
assert.equal(archiveOne.compressedSha256, archiveTwo.compressedSha256);
const manifest = buildManifest({
  target: "stage",
  cutoff: "2026-02-01T00:00:00Z",
  batchSize: 5000,
  cursor: null,
  records: ordered,
  archive: archiveOne,
  outputPath: "/private/chips-ledger-stage.jsonl.gz",
});
assert.deepEqual(manifest.amounts, { credits: "20", debits: "20", net: "0" });

assert.throws(
  () => validateBatch({
    candidates: [candidateA],
    records: [buildExportRecord(candidateA, [entry(1, TX_A, 10, USER)])],
    cutoff: "2026-02-01T00:00:00Z",
  }),
  /incomplete entry set/,
);

assert.throws(
  () => validateBatch({
    candidates: [candidateA],
    records: [buildExportRecord(candidateA, [entry(1, TX_A, 10, USER), entry(2, TX_A, -9, SYSTEM)])],
    cutoff: "2026-02-01T00:00:00Z",
  }),
  /not conserved/,
);

const tableId = "00000000-0000-4000-8000-000000000020";
const tableCandidate = {
  table_related: true,
  table_id: tableId,
  escrow_account_id: "00000000-0000-4000-8000-000000000021",
  escrow_balance: "0",
  table_exists: true,
  table_status: "OPEN",
};
assert.equal(evaluateTableEligibility(tableCandidate).eligible, false);
assert.equal(evaluateTableEligibility({ ...tableCandidate, table_status: "CLOSED" }).eligible, true);
assert.equal(evaluateTableEligibility({ ...tableCandidate, table_exists: false, table_status: null }).eligible, true);
assert.equal(evaluateTableEligibility({ ...tableCandidate, table_exists: false, escrow_balance: "1" }).eligible, false);
assert.equal(evaluateTableEligibility({ table_related: false }).eligible, true);

process.stdout.write("chips-ledger-archive-export tests passed\n");
