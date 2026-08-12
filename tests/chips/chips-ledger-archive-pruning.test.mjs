import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildArchiveBytes,
  buildExportRecord,
  buildManifest,
} from "../../scripts/ops/chips-ledger-archive-export.mjs";
import { buildObjectPath } from "../../scripts/ops/chips-ledger-archive-store.mjs";
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
  SUPABASE_URL: "https://krydukthwdvccggbyjfw.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
};

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

function manifestRow(overrides = {}) {
  return {
    object_path: objectPath,
    batch_id: "1",
    project_ref: "krydukthwdvccggbyjfw",
    format_version: 1,
    cutoff: localManifest.cutoff.created_at,
    cursor_start_created_at: null,
    cursor_start_id: null,
    cursor_end_created_at: localManifest.cursor.end.created_at,
    cursor_end_id: localManifest.cursor.end.id,
    first_created_at: localManifest.time_range.first_created_at,
    last_created_at: localManifest.time_range.last_created_at,
    transaction_count: localManifest.batch.transactions,
    entry_count: localManifest.batch.entries,
    tx_types: localManifest.batch.tx_types,
    raw_bytes: localManifest.bytes.raw,
    compressed_bytes: localManifest.bytes.compressed,
    raw_sha256: localManifest.sha256.raw_jsonl,
    compressed_sha256: localManifest.sha256.compressed_artifact,
    credits: localManifest.amounts.credits,
    debits: localManifest.amounts.debits,
    net_amount: localManifest.amounts.net,
    status: "committed",
    committed_at: "2026-01-02T00:00:00.000000Z",
    archived_transaction_ids_sha256: proof.transactionIdsSha256,
    archived_entry_ids_sha256: proof.entryIdsSha256,
    archive_proof_verified_at: "2026-01-02T00:01:00.000000Z",
    pruned_at: null,
    pruned_transaction_count: null,
    pruned_entry_count: null,
    pruned_transaction_ids_sha256: null,
    pruned_entry_ids_sha256: null,
    ...overrides,
  };
}

function fakeStore(row, states = ["pruned"]) {
  let pruneCalls = 0;
  return {
    getIdentity: async () => STAGE_SYSTEM_IDENTIFIER,
    getManifest: async () => row,
    registerProof: async () => ({ state: "proof_registered" }),
    prune: async (_path, _evidence, execute) => {
      assert.equal(execute, true);
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
    env: ENV,
    deps: { emit: false },
  }),
  /explicitly set to stage/,
);
await assert.rejects(
  () => pruneArchive({ argv: baseArgs, env: ENV, deps: { emit: false } }),
  /--recovery-dir is required/,
);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-prune-test-"));
const recoveryDir = path.join(tempRoot, "recovery");
const store = fakeStore(manifestRow(), ["pruned", "already_pruned"]);
const downloadArchive = async () => ({ bytes: archive.compressedBytes, downloadMs: 1 });

try {
  const first = await pruneArchive({
    argv: [...baseArgs, "--recovery-dir", recoveryDir],
    env: ENV,
    deps: { pruneStore: store, downloadArchive, emit: false },
  });
  assert.equal(first.state, "pruned");
  assert.equal(first.evidence.userTransactions, 0);
  assert.equal(first.evidence.userEntries, 0);
  assert.equal(first.evidence.distinctTables, 1);
  assert.equal(fs.statSync(recoveryDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(first.recoveryBundle.artifactPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(first.recoveryBundle.manifestPath).mode & 0o777, 0o600);

  const retry = await pruneArchive({
    argv: [...baseArgs, "--recovery-dir", recoveryDir],
    env: ENV,
    deps: { pruneStore: store, downloadArchive, emit: false },
  });
  assert.equal(retry.state, "already_pruned");
  assert.equal(retry.recoveryBundle.reused, true);
  assert.equal(store.pruneCalls, 2);

  const failedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-prune-postcommit-"));
  const failedRecovery = path.join(failedRoot, "recovery");
  let downloads = 0;
  await assert.rejects(
    () => pruneArchive({
      argv: [...baseArgs, "--recovery-dir", failedRecovery],
      env: ENV,
      deps: {
        pruneStore: fakeStore(manifestRow()),
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
