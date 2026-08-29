import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BOT_ONLY_RETENTION_POLICY_ID,
  buildArchiveBytes,
  buildExportRecord,
  buildManifest,
} from "../../scripts/ops/chips-ledger-archive-export.mjs";
import {
  buildObjectPath,
  verifyArchiveBytes,
} from "../../scripts/ops/chips-ledger-archive-store.mjs";
import {
  STAGE_SYSTEM_IDENTIFIER,
  buildPruneEvidence,
  computeArchiveIdProofs,
  pruneArchive,
} from "../../scripts/ops/chips-ledger-archive-prune.mjs";

const TX_A = "00000000-0000-4000-8000-00000000000a";
const TX_B = "00000000-0000-4000-8000-00000000000b";
const TABLE_ID = "00000000-0000-4000-8000-000000000020";
const SYSTEM_ID = "00000000-0000-4000-8000-000000000030";
const ESCROW_ID = "00000000-0000-4000-8000-000000000031";

const ENV = {
  EXPECTED_SUPABASE_STAGE_PROJECT_REF: "krydukthwdvccggbyjfw",
  EXPECTED_SUPABASE_PROD_PROJECT_REF: "otbqfijerkieoxwpxjnm",
  SUPABASE_STAGE_DB_URL: "postgresql://postgres.krydukthwdvccggbyjfw@db.krydukthwdvccggbyjfw.supabase.co:5432/postgres",
  SUPABASE_PROD_DB_URL: "postgresql://postgres.otbqfijerkieoxwpxjnm@db.otbqfijerkieoxwpxjnm.supabase.co:5432/postgres",
  SUPABASE_URL: "https://krydukthwdvccggbyjfw.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
};
const PROD_ENV = { ...ENV, SUPABASE_URL: "https://otbqfijerkieoxwpxjnm.supabase.co" };

function candidate(id, createdAt, txType) {
  return {
    id,
    sequence: id === TX_A ? "1" : "2",
    tx_type: txType,
    idempotency_key: `archive-prune:${id}`,
    payload_hash: "a".repeat(64),
    user_id: null,
    reference: `table:${TABLE_ID}`,
    description: "technical table lifecycle",
    metadata: { actor: "BOT", tableId: TABLE_ID },
    created_by: SYSTEM_ID,
    created_at: createdAt,
    entry_count: "2",
    table_related: true,
    table_id: TABLE_ID,
    table_exists: false,
    table_status: null,
    escrow_account_id: ESCROW_ID,
    escrow_status: "active",
    escrow_balance: "0",
  };
}

function entry(id, transactionId, accountId, accountType, systemKey, amount) {
  return {
    id: String(id),
    transaction_id: transactionId,
    account_id: accountId,
    entry_seq: String(id),
    amount: String(amount),
    metadata: {},
    created_at: "2026-01-01T00:00:00.000000Z",
    account_row_id: accountId,
    account_type: accountType,
    account_user_id: null,
    account_system_key: systemKey,
    account_status: "active",
    account_label: null,
  };
}

function record(tx, firstEntryId, amount) {
  const buyIn = tx.tx_type === "TABLE_BUY_IN";
  return buildExportRecord(tx, [
    entry(firstEntryId, tx.id, SYSTEM_ID, "SYSTEM", "POKER_BOT_BANKROLL", buyIn ? -amount : amount),
    entry(firstEntryId + 1, tx.id, ESCROW_ID, "ESCROW", `POKER_TABLE:${TABLE_ID}`, buyIn ? amount : -amount),
  ]);
}

const records = [
  record(candidate(TX_A, "2026-01-01T00:00:00.000001Z", "TABLE_BUY_IN"), 1, 10),
  buildExportRecord(candidate(TX_B, "2026-01-01T00:00:00.000002Z", "TABLE_CASH_OUT"), [
    entry(10, TX_B, SYSTEM_ID, "SYSTEM", "POKER_BOT_BANKROLL", 10),
    entry("9007199254740993", TX_B, ESCROW_ID, "ESCROW", `POKER_TABLE:${TABLE_ID}`, -10),
  ]),
];
const archive = buildArchiveBytes(records);
const localManifest = buildManifest({
  target: "stage",
  cutoff: "2026-02-01T00:00:00.000000Z",
  batchSize: 5000,
  cursor: null,
  records,
  archive,
  outputPath: `/private/${archive.compressedSha256}.jsonl.gz`,
});
const objectPath = buildObjectPath(localManifest);
const proof = computeArchiveIdProofs(records);

assert.equal(proof.transactionIdsSha256, "726400e7a16ea9e7ca71ee707fb025934613059de29366a5ae7f626256b688fa");
assert.equal(proof.entryIdsSha256, "58eb8c6b6deb82261f809eb3277a61b010224ae0fe568f199ced00f51f7dd8ac");

function manifestRow(overrides = {}, sourceManifest = localManifest, sourceProof = proof) {
  const sourceObjectPath = buildObjectPath(sourceManifest);
  return {
    object_path: sourceObjectPath,
    batch_id: "1",
    project_ref: "krydukthwdvccggbyjfw",
    format_version: 1,
    cutoff: sourceManifest.cutoff.created_at,
    cursor_start_created_at: null,
    cursor_start_id: null,
    cursor_end_created_at: sourceManifest.cursor.end.created_at,
    cursor_end_id: sourceManifest.cursor.end.id,
    first_created_at: sourceManifest.time_range.first_created_at,
    last_created_at: sourceManifest.time_range.last_created_at,
    transaction_count: sourceManifest.batch.transactions,
    entry_count: sourceManifest.batch.entries,
    tx_types: sourceManifest.batch.tx_types,
    raw_bytes: sourceManifest.bytes.raw,
    compressed_bytes: sourceManifest.bytes.compressed,
    raw_sha256: sourceManifest.sha256.raw_jsonl,
    compressed_sha256: sourceManifest.sha256.compressed_artifact,
    credits: sourceManifest.amounts.credits,
    debits: sourceManifest.amounts.debits,
    net_amount: sourceManifest.amounts.net,
    status: "committed",
    committed_at: "2026-01-02T00:00:00.000000Z",
    archived_transaction_ids_sha256: sourceProof.transactionIdsSha256,
    archived_entry_ids_sha256: sourceProof.entryIdsSha256,
    archive_proof_verified_at: "2026-01-02T00:01:00.000000Z",
    pruned_at: null,
    pruned_transaction_count: null,
    pruned_entry_count: null,
    pruned_transaction_ids_sha256: null,
    pruned_entry_ids_sha256: null,
    ...overrides,
  };
}

const BOT_TABLE_ID = "00000000-0000-4000-8000-000000000040";
const BOT_TX_ID = "00000000-0000-4000-8000-000000000041";
const BOT_SYSTEM_ID = "00000000-0000-4000-8000-000000000042";
const BOT_ESCROW_ID = "00000000-0000-4000-8000-000000000043";
const BOT_CREATED_AT = "2026-01-01T00:00:00.000003Z";

function botOnlyFixture() {
  const botCandidate = {
    id: BOT_TX_ID,
    sequence: "1",
    tx_type: "TABLE_BUY_IN",
    idempotency_key: `bot-seed-buyin:${BOT_TABLE_ID}:1`,
    payload_hash: "b".repeat(64),
    user_id: null,
    reference: `BOT_SEED_BUY_IN:${BOT_TABLE_ID}:1`,
    description: "automatic cleanup retry contract",
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
    table_out_of_scope_keys_sha256: "c".repeat(64),
  };
  const botRecord = buildExportRecord(botCandidate, [
    {
      id: "100", transaction_id: BOT_TX_ID, account_id: BOT_ESCROW_ID, entry_seq: "1", amount: "100",
      metadata: {}, created_at: BOT_CREATED_AT, account_row_id: BOT_ESCROW_ID, account_type: "ESCROW",
      account_user_id: null, account_system_key: `POKER_TABLE:${BOT_TABLE_ID}`, account_status: "active", account_label: null,
    },
    {
      id: "101", transaction_id: BOT_TX_ID, account_id: BOT_SYSTEM_ID, entry_seq: "2", amount: "-100",
      metadata: {}, created_at: BOT_CREATED_AT, account_row_id: BOT_SYSTEM_ID, account_type: "SYSTEM",
      account_user_id: null, account_system_key: "TREASURY", account_status: "active", account_label: null,
    },
  ], { schemaVersion: 2 });
  const botArchive = buildArchiveBytes([botRecord]);
  const botManifest = buildManifest({
    target: "stage",
    cutoff: "2026-02-01T00:00:00.000000Z",
    batchSize: 5000,
    cursor: null,
    records: [botRecord],
    archive: botArchive,
    outputPath: `/private/${botArchive.compressedSha256}.jsonl.gz`,
    sourcePolicyId: BOT_ONLY_RETENTION_POLICY_ID,
    schemaVersion: 2,
  });
  const botVerified = verifyArchiveBytes({
    compressedBytes: botArchive.compressedBytes,
    manifest: botManifest,
    target: { target: "stage", projectRef: ENV.EXPECTED_SUPABASE_STAGE_PROJECT_REF },
    artifactName: `${botArchive.compressedSha256}.jsonl.gz`,
  });
  const botEvidence = buildPruneEvidence(botVerified);
  const botRow = manifestRow({
    batch_id: "17",
    format_version: 2,
    source_policy_id: BOT_ONLY_RETENTION_POLICY_ID,
    bot_only_table_id: botManifest.bot_only.table_id,
    bot_only_table_count: botManifest.bot_only.table_count,
    bot_only_newest_created_at: botManifest.bot_only.newest_created_at,
    bot_only_registry_keys_sha256: botManifest.bot_only.registry_keys_sha256,
    bot_only_out_of_scope_keys_sha256: botManifest.bot_only.out_of_scope_keys_sha256,
    bot_only_identity_count: botManifest.bot_only.identity_count,
    bot_only_eligible_count: botManifest.bot_only.eligible_count,
  }, botManifest, botEvidence);
  return { archive: botArchive, manifest: botManifest, evidence: botEvidence, row: botRow };
}

function fakeBotOnlyAutomaticStore(fixture, outcomes, { onCleanup = null } = {}) {
  let cleanupCalls = 0;
  let persistedMutations = 0;
  let proofCalls = 0;
  const verification = {
    pruned_at: "2026-01-02T00:02:00.000000Z",
    pruned_transaction_count: String(fixture.evidence.transactionCount),
    pruned_entry_count: String(fixture.evidence.entryCount),
    pruned_transaction_ids_sha256: fixture.evidence.transactionIdsSha256,
    pruned_entry_ids_sha256: fixture.evidence.entryIdsSha256,
    registry_cleaned_at: "2026-01-02T00:02:01.000000Z",
    registry_cleaned_key_count: String(fixture.evidence.registryKeys.length),
    registry_cleaned_keys_sha256: fixture.evidence.registryKeysSha256,
    remaining_mapping_count: "0",
    hot_transaction_count: "0",
    hot_entry_count: "0",
  };
  return {
    getIdentity: async () => STAGE_SYSTEM_IDENTIFIER,
    getManifest: async () => fixture.row,
    registerBotOnlyProof: async () => {
      proofCalls += 1;
      return { state: "proof_registered" };
    },
    cleanupBotOnly: async () => {
      cleanupCalls += 1;
      await onCleanup?.(cleanupCalls);
      const sqlstate = outcomes[cleanupCalls - 1];
      if (sqlstate) {
        const error = new Error(`simulated cleanup failure (${sqlstate})`);
        error.code = sqlstate;
        throw error;
      }
      persistedMutations += 1;
      return { state: "cleaned" };
    },
    verifyBotOnlyCommitted: async () => verification,
    get cleanupCalls() { return cleanupCalls; },
    get persistedMutations() { return persistedMutations; },
    get proofCalls() { return proofCalls; },
  };
}

function fakeStore(row, states = ["pruned"], { identity = STAGE_SYSTEM_IDENTIFIER, expectedExecute = true } = {}) {
  let pruneCalls = 0;
  return {
    getIdentity: async () => identity,
    getManifest: async () => row,
    registerProof: async () => ({ state: "proof_registered" }),
    prune: async (_path, _evidence, execute) => {
      assert.equal(execute, expectedExecute);
      const state = states[Math.min(pruneCalls, states.length - 1)];
      pruneCalls += 1;
      return { state };
    },
    verifyCommitted: async () => ({
      pruned_at: "2026-01-02T00:02:00.000000Z",
      pruned_transaction_count: "2",
      pruned_entry_count: "4",
      pruned_transaction_ids_sha256: proof.transactionIdsSha256,
      pruned_entry_ids_sha256: proof.entryIdsSha256,
      mapping_count: "2",
      extra_mapping_count: "0",
      hot_transaction_count: "0",
      hot_entry_count: "0",
    }),
    get pruneCalls() { return pruneCalls; },
  };
}

const baseArgs = ["--target", "stage", "--object-path", objectPath, "--confirm-sha", archive.compressedSha256, "--execute"];
await assert.rejects(
  () => pruneArchive({
    argv: ["--target", "prod", "--object-path", objectPath, "--confirm-sha", archive.compressedSha256],
    env: PROD_ENV,
    deps: {
      pruneStore: fakeStore(manifestRow(), ["ready"], { identity: STAGE_SYSTEM_IDENTIFIER, expectedExecute: false }),
      verifyBucket: async () => {},
      downloadArchive: async () => ({ bytes: archive.compressedBytes, downloadMs: 1 }),
      emit: false,
    },
  }),
  /database is not canonical Production/,
);
await assert.rejects(
  () => pruneArchive({ argv: baseArgs, env: ENV, deps: { emit: false } }),
  /--recovery-dir is required/,
);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-prune-test-"));
const recoveryDir = path.join(tempRoot, "recovery");
const store = fakeStore(manifestRow(), ["pruned", "already_pruned"]);
let archiveDownloads = 0;
let bucketChecks = 0;
const downloadArchive = async () => {
  archiveDownloads += 1;
  return { bytes: archive.compressedBytes, downloadMs: 1 };
};
const verifyBucket = async () => { bucketChecks += 1; };

try {
  const bucketRejectedStore = fakeStore(manifestRow());
  await assert.rejects(
    () => pruneArchive({
      argv: baseArgs.slice(0, -1),
      env: ENV,
      deps: {
        pruneStore: bucketRejectedStore,
        verifyBucket: async () => { throw new Error("Storage archive bucket must be private"); },
        downloadArchive: async () => { throw new Error("archive download must not run"); },
        emit: false,
      },
    }),
    /must be private/,
  );
  assert.equal(bucketRejectedStore.pruneCalls, 0);

  const first = await pruneArchive({
    argv: [...baseArgs, "--recovery-dir", recoveryDir],
    env: ENV,
    deps: { pruneStore: store, downloadArchive, verifyBucket, emit: false },
  });
  assert.equal(first.state, "pruned");
  assert.equal(first.evidence.userTransactions, 0);
  assert.equal(first.evidence.userEntries, 0);
  assert.equal(first.evidence.distinctTables, 1);
  assert.equal(fs.statSync(recoveryDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(first.recoveryBundle.artifactPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(first.recoveryBundle.manifestPath).mode & 0o777, 0o600);
  assert.equal(bucketChecks, 2, "execute must verify bucket configuration before and after commit");
  assert.equal(archiveDownloads, 2, "execute must download the private archive before and after commit");

  const retry = await pruneArchive({
    argv: [...baseArgs, "--recovery-dir", recoveryDir],
    env: ENV,
    deps: { pruneStore: store, downloadArchive, verifyBucket, emit: false },
  });
  assert.equal(retry.state, "already_pruned");
  assert.equal(retry.recoveryBundle.reused, true);
  assert.equal(store.pruneCalls, 2);
  assert.equal(bucketChecks, 4);
  assert.equal(archiveDownloads, 4);

  const failedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-prune-postcommit-"));
  const failedRecovery = path.join(failedRoot, "recovery");
  let downloads = 0;
  await assert.rejects(
    () => pruneArchive({
      argv: [...baseArgs, "--recovery-dir", failedRecovery],
      env: ENV,
      deps: {
        pruneStore: fakeStore(manifestRow()),
        verifyBucket,
        downloadArchive: async () => {
          downloads += 1;
          return { bytes: downloads === 1 ? archive.compressedBytes : Buffer.from("corrupt"), downloadMs: 1 };
        },
        emit: false,
      },
    }),
    (error) => error?.code === "post_commit_verification_failed",
  );
  assert.equal(fs.readdirSync(failedRecovery).length, 2, "post-commit failure must retain the recovery bundle");
  fs.rmSync(failedRoot, { recursive: true, force: true });
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

const productionManifest = buildManifest({
  target: "prod",
  cutoff: localManifest.cutoff.created_at,
  batchSize: 2,
  cursor: null,
  records,
  archive,
  outputPath: "/private/chips-ledger-prod.jsonl.gz",
});
const productionRow = manifestRow({
  project_ref: "otbqfijerkieoxwpxjnm",
}, productionManifest);
const productionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-prune-prod-test-"));
const productionRecovery = path.join(productionRoot, "recovery");
try {
  const productionStore = fakeStore(productionRow, ["pruned"], {
    identity: "7575202818581710058",
    expectedExecute: true,
  });
  let productionOutput = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => { productionOutput += String(chunk); return true; };
  let productionResult;
  try {
    productionResult = await pruneArchive({
      argv: ["--target", "prod", "--object-path", objectPath, "--confirm-sha", archive.compressedSha256, "--execute", "--recovery-dir", productionRecovery],
      env: PROD_ENV,
      deps: { pruneStore: productionStore, downloadArchive, verifyBucket },
    });
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.equal(productionResult.state, "pruned");
  assert.equal(productionResult.evidence.transactionCount, 2);
  assert.equal(JSON.parse(productionOutput).target, "prod");
  assert.equal(JSON.parse(fs.readFileSync(productionResult.recoveryBundle.manifestPath, "utf8")).target, "prod");

  const thirdTx = candidate("00000000-0000-4000-8000-00000000000c", "2026-01-01T00:00:00.000003Z", "TABLE_BUY_IN");
  const threeRecords = [...records, record(thirdTx, 20, 10)];
  const threeArchive = buildArchiveBytes(threeRecords);
  const threeManifest = buildManifest({
    target: "prod",
    cutoff: localManifest.cutoff.created_at,
    batchSize: 2,
    cursor: null,
    records: threeRecords,
    archive: threeArchive,
    outputPath: "/private/chips-ledger-prod-three.jsonl.gz",
  });
  const threeRow = manifestRow({ project_ref: "otbqfijerkieoxwpxjnm" }, threeManifest, computeArchiveIdProofs(threeRecords));
  await assert.rejects(
    () => pruneArchive({
      argv: ["--target", "prod", "--object-path", buildObjectPath(threeManifest), "--confirm-sha", threeManifest.sha256.compressed_artifact],
      env: PROD_ENV,
      deps: {
        pruneStore: fakeStore(threeRow, ["ready"], { identity: "7575202818581710058", expectedExecute: false }),
        verifyBucket,
        downloadArchive: async () => ({ bytes: threeArchive.compressedBytes, downloadMs: 1 }),
        emit: false,
      },
    }),
    /exceeds target batch limit|archive proof requires 1 to 2 transaction records/,
  );
} finally {
  fs.rmSync(productionRoot, { recursive: true, force: true });
}

const botFixture = botOnlyFixture();
const botRetryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-bot-only-retry-test-"));
try {
  for (const sqlstate of ["40001", "55P03"]) {
    const recoveryDir = path.join(botRetryRoot, `recovery-${sqlstate}`);
    const store = fakeBotOnlyAutomaticStore(botFixture, [sqlstate, null]);
    let storageReads = 0;
    let bucketChecks = 0;
    const result = await pruneArchive({
      argv: [
        "--target", "stage",
        "--object-path", botFixture.row.object_path,
        "--confirm-sha", botFixture.archive.compressedSha256,
        "--execute", "--automatic", "--recovery-dir", recoveryDir,
      ],
      env: ENV,
      deps: {
        pruneStore: store,
        verifyBucket: async () => { bucketChecks += 1; },
        downloadArchive: async () => {
          storageReads += 1;
          return { bytes: botFixture.archive.compressedBytes, downloadMs: 1 };
        },
        emit: false,
      },
    });
    assert.equal(result.state, "cleaned");
    assert.equal(store.cleanupCalls, 2, `${sqlstate} must retry the atomic cleanup once`);
    assert.equal(store.persistedMutations, 1, `${sqlstate} must persist one successful cleanup`);
    assert.equal(store.proofCalls, 0, `${sqlstate} retry must not repeat proof registration`);
    assert.equal(storageReads, 2, `${sqlstate} retry must only perform initial and post-commit Storage reads`);
    assert.equal(bucketChecks, 2, `${sqlstate} retry must not re-run Storage preflight per attempt`);
  }

  const exhaustedStore = fakeBotOnlyAutomaticStore(botFixture, ["40001", "40001", "40001"]);
  let exhaustedReads = 0;
  await assert.rejects(
    () => pruneArchive({
      argv: [
        "--target", "stage",
        "--object-path", botFixture.row.object_path,
        "--confirm-sha", botFixture.archive.compressedSha256,
        "--execute", "--automatic", "--recovery-dir", path.join(botRetryRoot, "recovery-exhausted"),
      ],
      env: ENV,
      deps: {
        pruneStore: exhaustedStore,
        verifyBucket: async () => {},
        downloadArchive: async () => {
          exhaustedReads += 1;
          return { bytes: botFixture.archive.compressedBytes, downloadMs: 1 };
        },
        emit: false,
      },
    }),
    (error) => error?.code === "40001",
  );
  assert.equal(exhaustedStore.cleanupCalls, 3, "automatic cleanup retry budget is exactly three attempts");
  assert.equal(exhaustedStore.persistedMutations, 0, "exhausted cleanup must not report a persisted mutation");
  assert.equal(exhaustedStore.proofCalls, 0, "exhausted cleanup must not repeat proof registration");
  assert.equal(exhaustedReads, 1, "exhausted cleanup must not perform post-commit Storage verification");

  const recoveryDir = path.join(botRetryRoot, "recovery-tampered-between-attempts");
  const tamperedManifestPath = path.join(
    recoveryDir,
    `chips-ledger-${botFixture.row.compressed_sha256}.recovery.json`,
  );
  const tamperedStore = fakeBotOnlyAutomaticStore(botFixture, ["40001", null], {
    onCleanup: async (call) => {
      if (call === 1) fs.writeFileSync(tamperedManifestPath, "{}\n");
    },
  });
  let tamperedReads = 0;
  await assert.rejects(
    () => pruneArchive({
      argv: [
        "--target", "stage",
        "--object-path", botFixture.row.object_path,
        "--confirm-sha", botFixture.archive.compressedSha256,
        "--execute", "--automatic", "--recovery-dir", recoveryDir,
      ],
      env: ENV,
      deps: {
        pruneStore: tamperedStore,
        verifyBucket: async () => {},
        downloadArchive: async () => {
          tamperedReads += 1;
          return { bytes: botFixture.archive.compressedBytes, downloadMs: 1 };
        },
        emit: false,
      },
    }),
    /recovery manifest no longer matches archive evidence/,
  );
  assert.equal(tamperedStore.cleanupCalls, 1, "a changed recovery bundle must block the next SQL attempt");
  assert.equal(tamperedStore.persistedMutations, 0);
  assert.equal(tamperedStore.proofCalls, 0);
  assert.equal(tamperedReads, 1, "a changed recovery bundle must block post-commit Storage verification");

  const nonRetryableStore = fakeBotOnlyAutomaticStore(botFixture, ["23505"]);
  let nonRetryableReads = 0;
  await assert.rejects(
    () => pruneArchive({
      argv: [
        "--target", "stage",
        "--object-path", botFixture.row.object_path,
        "--confirm-sha", botFixture.archive.compressedSha256,
        "--execute", "--automatic", "--recovery-dir", path.join(botRetryRoot, "recovery-non-retryable"),
      ],
      env: ENV,
      deps: {
        pruneStore: nonRetryableStore,
        verifyBucket: async () => {},
        downloadArchive: async () => {
          nonRetryableReads += 1;
          return { bytes: botFixture.archive.compressedBytes, downloadMs: 1 };
        },
        emit: false,
      },
    }),
    (error) => error?.code === "23505",
  );
  assert.equal(nonRetryableStore.cleanupCalls, 1, "non-retryable SQLSTATE must fail closed immediately");
  assert.equal(nonRetryableStore.persistedMutations, 0);
  assert.equal(nonRetryableStore.proofCalls, 0);
  assert.equal(nonRetryableReads, 1, "non-retryable cleanup must not perform post-commit Storage verification");
} finally {
  fs.rmSync(botRetryRoot, { recursive: true, force: true });
}

const localEvidence = buildPruneEvidence({ records, manifest: localManifest, summary: {
  credits: localManifest.amounts.credits,
  debits: localManifest.amounts.debits,
  netAmount: localManifest.amounts.net,
} });
assert.deepEqual(localEvidence.txTypes, { TABLE_BUY_IN: 1, TABLE_CASH_OUT: 1 });

const userRecords = structuredClone(records);
userRecords[0].transaction.user_id = "00000000-0000-4000-8000-000000000099";
userRecords[0].entries[0].account.account_type = "USER";
userRecords[0].entries[0].account.user_id = userRecords[0].transaction.user_id;
userRecords[0].entries[0].account.system_key = null;
assert.throws(
  () => buildPruneEvidence({ records: userRecords, manifest: localManifest, summary: localEvidence }),
  /cannot prune USER ledger history \(user_transactions=1, user_entries=1, distinct_tables=1\)/,
);

process.stdout.write("chips-ledger-archive-pruning tests passed\n");
