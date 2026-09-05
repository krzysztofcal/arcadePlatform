import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
  BOT_ONLY_RETENTION_POLICY_ID,
  buildArchiveBytes,
  buildExportRecord,
  buildManifest,
} from "../../scripts/ops/chips-ledger-archive-export.mjs";
import {
  buildObjectPath,
  buildRecoveryArchiveObjectPath,
  buildRecoveryManifestObjectPath,
  verifyArchiveBytes,
} from "../../scripts/ops/chips-ledger-archive-store.mjs";
import {
  buildPruneEvidence,
  buildRecoveryManifest,
  exporterManifestFromDatabase,
  parseManifestRow,
} from "../../scripts/ops/chips-ledger-archive-prune.mjs";
import {
  ACCOUNT_RECOVERY_MIME_TYPE,
  RETIREMENT_PHASES,
  accountIdsSha256,
  archiveBatchEvidenceState,
  assertAdvisoryLock,
  buildAccountRecoverySnapshot,
  classifyEscrowAccount,
  classifyRecoveryAccountSet,
  ensureAccountRecoveryObject,
  isRetryableSqlState,
  limitRetirementCandidates,
  mergeRegistryAggregateRows,
  parseRetentionArgs,
  readOnlyEscrowAudit,
  registryCountFor,
  RETENTION_REGISTRY_BATCH_COUNTS_SQL,
  RETENTION_REGISTRY_TABLE_COUNTS_SQL,
  RETENTION_BATCHES_SQL,
  RETENTION_LEGACY_BATCHES_SQL,
  RETENTION_LEGACY_PROOFS_FOR_TABLES_SQL,
  reportSummary,
  retirementReceiptState,
  runWithRetirementRetry,
  runStageEscrowAccountRetention,
  runStageEscrowAccountRetentionControl,
  serializeAccountRecovery,
  verifyAccountRecoveryBytes,
  verifyPrimaryArchiveAndDurableRecovery,
} from "../../scripts/ops/chips-ledger-stage-escrow-retention.mjs";
import {
  restoreAccountBatch,
  runRecoveryVerifier,
  verifyRecoveryObject,
} from "../../scripts/ops/chips-ledger-stage-escrow-account-recovery.mjs";

const TABLE_ID = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000101";
const ACCOUNT_ID_2 = "00000000-0000-4000-8000-000000000102";
const HASH = "a".repeat(64);

function uuidIdsSha256(ids) {
  return crypto.createHash("sha256").update(`${ids.join("\n")}\n`, "utf8").digest("hex");
}

function reservedAuditSession({ failOn = null, policyEnabled = false, batchRows = [], legacyBatchRows = [], legacyProofRows = [], accountRows = [], tableRows = [], registryRows = [] } = {}) {
  const queries = [];
  let transactionOpen = false;
  let released = false;
  const session = {
    queries,
    get transactionOpen() { return transactionOpen; },
    get released() { return released; },
    unsafe: async (query, parameters = []) => {
      queries.push({ query, parameters });
      if (failOn && failOn.test(query)) throw new Error("injected audit failure");
      if (/^begin\s*;/i.test(query.trim())) {
        assert.equal(transactionOpen, false);
        transactionOpen = true;
        return [];
      }
      if (/^commit\s*;/i.test(query.trim())) {
        assert.equal(transactionOpen, true);
        transactionOpen = false;
        return [];
      }
      if (/^rollback\s*;/i.test(query.trim())) {
        transactionOpen = false;
        return [];
      }
      if (query.includes("pg_try_advisory_lock")) return [{ backend_pid: "42", acquired: true }];
      if (query.includes("pg_locks")) return [{ backend_pid: "42", lock_held: true }];
      if (query.includes("pg_advisory_unlock")) return [{ pg_advisory_unlock: true }];
      if (query.includes("pg_backend_pid")) return [{ backend_pid: "42" }];
      if (query.includes("pg_control_system")) return [{ system_identifier: "7656985631720456337" }];
      if (query.includes("chips_table_fence_is_active")) return [{ active: true }];
      if (query.includes("chips_table_fence_control")) return [{ enforcement_active: true }];
      if (query.includes("chips_stage_escrow_account_retention_policy")) {
        return [{ policy_id: "stage-ledger-escrow-account-retention-v1", enabled: policyEnabled }];
      }
      if (query === RETENTION_BATCHES_SQL) return batchRows;
      if (query === RETENTION_LEGACY_PROOFS_FOR_TABLES_SQL) return legacyProofRows;
      if (query === RETENTION_LEGACY_BATCHES_SQL) return legacyBatchRows;
      if (query.includes("from public.chips_ledger_archive_batches batches")) return batchRows;
      if (query.includes("from public.chips_accounts accounts")) return accountRows;
      if (query.includes("from public.poker_tables")) return tableRows;
      if (query === RETENTION_REGISTRY_TABLE_COUNTS_SQL) return registryRows;
      return [];
    },
    release: async () => { released = true; },
  };
  return session;
}

function completeBatch(overrides = {}) {
  return {
    batch_id: "101",
    object_path: `v1/sha256/${HASH}.jsonl.gz`,
    project_ref: "krydukthwdvccggbyjfw",
    format_version: "2",
    source_policy_id: "stage-ledger-bot-only-retention-7d-v1",
    status: "committed",
    compressed_sha256: HASH,
    raw_sha256: "b".repeat(64),
    cutoff: "2026-08-01T00:00:00.000Z",
    transaction_count: "2",
    entry_count: "4",
    archived_transaction_ids_sha256: "c".repeat(64),
    archived_entry_ids_sha256: "d".repeat(64),
    archive_proof_verified_at: "2026-08-02T00:00:00.000Z",
    pruned_at: "2026-08-03T00:00:00.000Z",
    pruned_transaction_count: "2",
    pruned_entry_count: "4",
    pruned_transaction_ids_sha256: "c".repeat(64),
    pruned_entry_ids_sha256: "d".repeat(64),
    registry_cleaned_at: "2026-08-04T00:00:00.000Z",
    registry_cleaned_key_count: "2",
    registry_cleaned_keys_sha256: "e".repeat(64),
    destructive_go_at: "2026-08-05T00:00:00.000Z",
    destructive_go_batch_id: "101",
    bot_only_table_id: TABLE_ID,
    bot_only_table_count: "1",
    bot_only_newest_created_at: "2026-08-01T00:00:00.000Z",
    bot_only_registry_keys_sha256: "e".repeat(64),
    bot_only_out_of_scope_keys_sha256: "f".repeat(64),
    bot_only_identity_count: "2",
    bot_only_eligible_count: "2",
    bot_only_table_exists: false,
    ...overrides,
  };
}

function account(id = ACCOUNT_ID, tableId = TABLE_ID, overrides = {}) {
  return {
    id,
    user_id: null,
    system_key: `POKER_TABLE:${tableId}`,
    account_type: "ESCROW",
    status: "active",
    label: null,
    balance: "0",
    next_entry_seq: "8",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-04T00:00:00.000Z",
    ...overrides,
  };
}

test("normal bot-only batch is classified as a safe candidate", () => {
  const result = classifyEscrowAccount(account(), {
    batch: completeBatch(),
    matchingBatchCount: 1,
  });
  assert.equal(result.category, "SAFE_BOT_ONLY_CANDIDATE");
  assert.equal(archiveBatchEvidenceState(completeBatch()).complete, true);
  assert.equal(archiveBatchEvidenceState(completeBatch({ registry_cleaned_keys_sha256: "0".repeat(64) })).complete, false);
});

test("escrow registry queries merge table and batch matches without double counting", () => {
  assert.doesNotMatch(RETENTION_REGISTRY_TABLE_COUNTS_SQL, /\bor\s+archive_batch_id\s*=\s*any/i);
  assert.doesNotMatch(RETENTION_REGISTRY_BATCH_COUNTS_SQL, /\bor\s+table_id\s*=\s*any/i);
  assert.match(RETENTION_REGISTRY_TABLE_COUNTS_SQL, /count\(\*\).*group by table_id, archive_batch_id/is);
  assert.match(RETENTION_REGISTRY_BATCH_COUNTS_SQL, /count\(\*\).*group by table_id, archive_batch_id/is);
  assert.match(RETENTION_REGISTRY_BATCH_COUNTS_SQL, /archive_batch_id\s*=\s*any\(\$1::bigint\[\]\)/i);
  assert.doesNotMatch(RETENTION_REGISTRY_BATCH_COUNTS_SQL.match(/where([\s\S]*?)group by/i)?.[1] || "", /table_id/i);
  const otherTableId = "00000000-0000-4000-8000-000000000002";
  const physicalRows = [
    { idempotency_key: "shared", table_id: TABLE_ID, archive_batch_id: "101", count: "1" },
    { idempotency_key: "table-only", table_id: TABLE_ID, archive_batch_id: null, count: "1" },
    { idempotency_key: "batch-only", table_id: null, archive_batch_id: "101", count: "1" },
    { idempotency_key: "other-table", table_id: otherTableId, archive_batch_id: "101", count: "1" },
  ];
  const tableRows = [
    { table_id: TABLE_ID, archive_batch_id: "101", count: "1" },
    { table_id: TABLE_ID, archive_batch_id: null, count: "1" },
  ];
  const batchRows = [
    { table_id: TABLE_ID, archive_batch_id: "101", count: "1" },
    { table_id: null, archive_batch_id: "101", count: "1" },
    { table_id: otherTableId, archive_batch_id: "101", count: "1" },
  ];
  const merged = mergeRegistryAggregateRows(tableRows, batchRows);
  assert.equal(registryCountFor(physicalRows, TABLE_ID, "101"), 4);
  assert.equal(registryCountFor(merged, TABLE_ID, "101"), 4);
  assert.equal(merged.filter((row) => row.table_id === TABLE_ID && row.archive_batch_id === "101").length, 1);
  assert.throws(() => mergeRegistryAggregateRows(
    [{ table_id: TABLE_ID, archive_batch_id: "101", count: "1" }],
    [{ table_id: TABLE_ID, archive_batch_id: "101", count: "2" }],
  ), /aggregates disagree/);
  const matchingBatchCount = [{ batch_id: "101", table_id: TABLE_ID }]
    .filter((row) => row.table_id === TABLE_ID && row.batch_id === "101").length;
  assert.equal(matchingBatchCount, 1, "a duplicate registry match must not change the exact batch match count");
  assert.equal(classifyEscrowAccount(account(), {
    batch: completeBatch(),
    matchingBatchCount,
    registryCount: 0,
  }).category, "SAFE_BOT_ONLY_CANDIDATE");
});

test("complete escrow retirement receipt still reports retired", () => {
  // The archive_batches projection must keep the account retirement receipt
  // columns; otherwise a finished batch reads as "empty" instead of "complete"
  // and is never reported through alreadyRetired after the first execute.
  const retired = completeBatch({
    account_retirement_at: "2026-08-06T00:00:00.000000Z",
    account_retirement_account_count: "1",
    account_retirement_account_ids_sha256: "c".repeat(64),
    account_retirement_recovery_object_path: `account-recovery/v1/sha256/${HASH}.json.gz`,
    account_retirement_recovery_object_sha256: HASH,
    account_retirement_snapshot_sha256: HASH,
  });
  assert.equal(retirementReceiptState(retired), "complete");
  assert.equal(archiveBatchEvidenceState(retired).complete, true);
  assert.equal(retirementReceiptState(completeBatch()), "empty");
  assert.equal(retirementReceiptState(completeBatch({ account_retirement_at: "2026-08-06T00:00:00.000000Z" })), "partial");
});

test("legacy multi-table batch remains one bounded candidate unit", () => {
  const tableId2 = "00000000-0000-4000-8000-000000000002";
  const masterTableIds = Array.from({ length: 974 }, (_, index) =>
    `00000000-0000-4000-8000-${String(index + 1000).padStart(12, "0")}`);
  const masterTableIdsSha256 = uuidIdsSha256(masterTableIds);
  const batchTableIdsSha256 = uuidIdsSha256([TABLE_ID, tableId2]);
  const legacy = completeBatch({
    batch_id: "102",
    destructive_go_batch_id: "102",
    source_policy_id: "legacy_stage_allowlist_v1",
    bot_only_table_id: null,
    bot_only_table_count: null,
    bot_only_newest_created_at: null,
    bot_only_registry_keys_sha256: null,
    bot_only_out_of_scope_keys_sha256: null,
    bot_only_identity_count: null,
    bot_only_eligible_count: null,
    object_path: `v1/sha256/${HASH}.jsonl.gz`,
    legacy_allowlist_sha256: masterTableIdsSha256,
    legacy_batch_table_ids_sha256: batchTableIdsSha256,
    legacy_master_table_ids: masterTableIds,
    legacy_master_table_count: "974",
    legacy_batch_table_ids: [TABLE_ID, tableId2],
    legacy_batch_table_count: "2",
    legacy_batch_number: "2",
    legacy_run_id: "77",
    legacy_plan_sha256: "3".repeat(64),
    legacy_source_run: "32753223679",
    legacy_query_sha256: "4".repeat(64),
    legacy_stage_system_identifier: "7656985631720456337",
  });
  const result = classifyEscrowAccount(account(), { batch: legacy, proof: {
    batch_id: "102",
    object_path: `v1/sha256/${HASH}.jsonl.gz`,
    project_ref: "krydukthwdvccggbyjfw",
    source_policy_id: "legacy_stage_allowlist_v1",
    postgres_system_identifier: "7656985631720456337",
    master_table_ids: masterTableIds,
    master_table_count: "974",
    batch_table_ids: [TABLE_ID, tableId2],
    batch_table_count: "2",
    batch_table_ids_sha256: batchTableIdsSha256,
    master_table_ids_sha256: masterTableIdsSha256,
    batch_number: "2",
    source_run: "32753223679",
    query_sha256: "4".repeat(64),
  }, matchingBatchCount: 1 });
  assert.equal(result.category, "SAFE_LEGACY_CANDIDATE");
});

test("USER, SYSTEM, OPEN/CLOSED, non-zero, hot entries, snapshots and incomplete evidence fail closed", () => {
  assert.equal(classifyEscrowAccount(account(ACCOUNT_ID, TABLE_ID, { user_id: ACCOUNT_ID_2 }), { batch: completeBatch(), matchingBatchCount: 1 }).category, "MALFORMED_AMBIGUOUS");
  assert.equal(classifyEscrowAccount(account(ACCOUNT_ID, TABLE_ID, { account_type: "SYSTEM" }), { batch: completeBatch(), matchingBatchCount: 1 }).category, "MALFORMED_AMBIGUOUS");
  assert.equal(classifyEscrowAccount(account(ACCOUNT_ID, TABLE_ID, { system_key: "POKER_TABLE:not-a-uuid" }), { batch: completeBatch(), matchingBatchCount: 1 }).category, "MALFORMED_AMBIGUOUS");
  assert.equal(classifyEscrowAccount(account(), { table: { status: "OPEN" }, batch: completeBatch(), matchingBatchCount: 1 }).category, "OPEN_TABLE");
  assert.equal(classifyEscrowAccount(account(), { table: { status: "CLOSED" }, batch: completeBatch(), matchingBatchCount: 1 }).category, "RETAINED_CLOSED_TABLE");
  assert.equal(classifyEscrowAccount(account(), { table: { status: "SETTLED" }, batch: completeBatch(), matchingBatchCount: 1 }).category, "MALFORMED_AMBIGUOUS");
  assert.equal(classifyEscrowAccount(account(ACCOUNT_ID, TABLE_ID, { balance: "1" }), { batch: completeBatch(), matchingBatchCount: 1 }).category, "MISSING_TABLE_NON_ZERO");
  assert.equal(classifyEscrowAccount(account(ACCOUNT_ID, TABLE_ID, { balance: null }), { batch: completeBatch(), matchingBatchCount: 1 }).category, "MISSING_TABLE_NON_ZERO");
  assert.equal(classifyEscrowAccount(account(), { batch: completeBatch(), entryCount: 1, matchingBatchCount: 1 }).category, "MISSING_TABLE_HOT_ENTRIES");
  assert.equal(classifyEscrowAccount(account(), { batch: completeBatch(), snapshotCount: 1, matchingBatchCount: 1 }).category, "MISSING_TABLE_ACCOUNT_SNAPSHOT");
  assert.equal(classifyEscrowAccount(account(), { batch: completeBatch({ pruned_at: null }), matchingBatchCount: 1 }).category, "INCOMPLETE_ARCHIVE");
  assert.equal(classifyEscrowAccount(account(), { batch: completeBatch({ account_retirement_at: "x" }), matchingBatchCount: 1 }).category, "INCOMPLETE_ARCHIVE");
});

test("account recovery is canonical, content-addressed and restores exact ID/sequence data", async () => {
  const snapshot = buildAccountRecoverySnapshot({
    batch: completeBatch(),
    tableIds: [TABLE_ID],
    accounts: [account()],
  });
  const recovery = serializeAccountRecovery(snapshot);
  const verified = verifyAccountRecoveryBytes({
    bytes: recovery.compressedBytes,
    objectPath: recovery.objectPath,
    mimeType: ACCOUNT_RECOVERY_MIME_TYPE,
    expectedSnapshot: snapshot,
    expectedSnapshotSha256: recovery.snapshotSha256,
    expectedAccountIds: [ACCOUNT_ID],
  });
  assert.equal(verified.parsed.accounts[0].id, ACCOUNT_ID);
  assert.equal(verified.parsed.accounts[0].next_entry_seq, "8");
  assert.equal(accountIdsSha256([ACCOUNT_ID]), accountIdsSha256(recovery.snapshot.account_ids));
  await verifyRecoveryObject({
    bytes: recovery.compressedBytes,
    objectPath: recovery.objectPath,
  }).then((offlineVerified) => assert.equal(offlineVerified.parsed.accounts[0].id, ACCOUNT_ID));
  const incompleteSnapshot = {
    ...snapshot,
    archive_batch: { ...snapshot.archive_batch, archive_proof: null },
  };
  const incompleteRecovery = serializeAccountRecovery(incompleteSnapshot);
  await assert.rejects(
    () => verifyRecoveryObject({ bytes: incompleteRecovery.compressedBytes, objectPath: incompleteRecovery.objectPath }),
    /archive proof or receipt binding is incomplete/,
  );
  const productionSnapshot = { ...snapshot, postgres_system_identifier: "7575202818581710058" };
  const productionRecovery = serializeAccountRecovery(productionSnapshot);
  await assert.rejects(
    () => verifyRecoveryObject({ bytes: productionRecovery.compressedBytes, objectPath: productionRecovery.objectPath }),
    /canonical Stage/,
  );
  assert.throws(() => verifyAccountRecoveryBytes({ bytes: Buffer.from("not-gzip"), objectPath: recovery.objectPath }), /gzip|SHA-256/);
  assert.throws(() => verifyAccountRecoveryBytes({ bytes: recovery.compressedBytes, objectPath: recovery.objectPath, expectedSnapshotSha256: "0".repeat(64) }), /SHA-256 differs/);
});

test("recovery verifier accepts a local file and derives its content-addressed object path", async () => {
  const recovery = serializeAccountRecovery(buildAccountRecoverySnapshot({
    batch: completeBatch(),
    tableIds: [TABLE_ID],
    accounts: [account()],
  }));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chips-account-recovery-"));
  const filePath = path.join(directory, "recovery.json.gz");
  await fs.writeFile(filePath, recovery.compressedBytes, { mode: 0o600 });
  try {
    const derived = await runRecoveryVerifier({ argv: ["--file", filePath], env: {} });
    assert.equal(derived.state, "verified");
    assert.equal(derived.object_path, recovery.objectPath);
    const explicit = await runRecoveryVerifier({ argv: ["--file", filePath, "--object-path", recovery.objectPath], env: {} });
    assert.equal(explicit.object_path, recovery.objectPath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("batch restore requires range-scoped confirmation rather than a single-account GO", async () => {
  const recovery = serializeAccountRecovery(buildAccountRecoverySnapshot({
    batch: completeBatch(),
    tableIds: [TABLE_ID],
    accounts: [account()],
  }));
  const hash = accountIdsSha256(recovery.snapshot.account_ids);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chips-account-recovery-confirmation-"));
  const filePath = path.join(directory, "recovery.json.gz");
  await fs.writeFile(filePath, recovery.compressedBytes, { mode: 0o600 });
  try {
    await assert.rejects(
      () => runRecoveryVerifier({
        argv: [
          "--file", filePath,
          "--restore", "--execute",
          "--batch-id", "101",
          "--account-ids-sha256", hash,
          "--confirmation", `GO ${ACCOUNT_ID}`,
        ],
        env: {},
      }),
      /RESTORE <batch_id> <account_ids_sha256>/,
    );
    await assert.rejects(
      () => runRecoveryVerifier({
        argv: ["--file", filePath, "--restore", "--execute", "--go-account-id", ACCOUNT_ID],
        env: {},
      }),
      /unknown recovery verifier option/,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("multi-account recovery classifies absent, partial, identical and conflicting sets", () => {
  const secondTableId = "00000000-0000-4000-8000-000000000002";
  const expected = [account(), account(ACCOUNT_ID_2, secondTableId)];
  const first = expected[0];
  const second = expected[1];
  assert.deepEqual(classifyRecoveryAccountSet([], expected), { state: "absent", existingCount: 0, missingCount: 2 });
  assert.deepEqual(classifyRecoveryAccountSet([first], expected), { state: "partial", existingCount: 1, missingCount: 1 });
  assert.deepEqual(classifyRecoveryAccountSet([second, first], expected), { state: "identical", existingCount: 2, missingCount: 0 });
  assert.equal(classifyRecoveryAccountSet([{ ...first, balance: "1" }], expected).state, "conflict");
});

test("multi-account recovery completes an identical partial set in one transaction", async () => {
  const secondTableId = "00000000-0000-4000-8000-000000000002";
  const accounts = [account(), account(ACCOUNT_ID_2, secondTableId)];
  const existing = [accounts[0]];
  const queries = [];
  const session = {
    unsafe: async (query, parameters = []) => {
      queries.push({ query, parameters });
      if (query.includes("pg_try_advisory_lock")) return [{ backend_pid: "42", acquired: true }];
      if (query.includes("pg_locks")) return [{ backend_pid: "42", lock_held: true }];
      if (query.includes("pg_advisory_unlock")) return [{ pg_advisory_unlock: true }];
      if (query.includes("pg_control_system")) return [{ system_identifier: "7656985631720456337" }];
      if (query.includes("chips_table_fence_is_active")) return [{ active: true }];
      if (query.includes("from public.poker_tables")) return [];
      if (query.includes("from public.chips_entries")) return [];
      if (query.includes("from public.chips_account_snapshot")) return [];
      if (query.includes("chips_transaction_idempotency")) return [{ registry_count: 0 }];
      if (query.includes("system_key = any")) return [];
      if (query.startsWith("insert into public.chips_accounts")) {
        existing.push({
          id: parameters[0],
          user_id: parameters[1],
          system_key: parameters[2],
          account_type: parameters[3],
          status: parameters[4],
          label: parameters[5],
          balance: String(parameters[6]),
          next_entry_seq: String(parameters[7]),
          created_at: parameters[8],
          updated_at: parameters[9],
        });
        return [];
      }
      if (query.includes("from public.chips_accounts")) return [...existing].sort((left, right) => left.id.localeCompare(right.id));
      return [];
    },
    begin: async (callback) => callback(session),
    release: async () => {},
  };
  const pool = {
    reserve: async () => session,
    end: async () => {},
  };
  const recovery = {
    parsed: {
      postgres_system_identifier: "7656985631720456337",
      project_ref: "krydukthwdvccggbyjfw",
      archive_batch: { batch_id: "103", table_ids: [TABLE_ID, secondTableId] },
      account_ids: accounts.map((item) => item.id).sort(),
      accounts,
    },
  };
  const result = await restoreAccountBatch({
    recovery,
    args: {
      batchId: "103",
      accountIdsSha256: accountIdsSha256(accounts.map((item) => item.id)),
      confirmation: `RESTORE 103 ${accountIdsSha256(accounts.map((item) => item.id))}`,
    },
    config: { dbUrl: "postgres://stage.example.invalid/db" },
    env: { CHIPS_LEDGER_ESCROW_RECOVERY_RESTORE_EXECUTE: "1" },
    postgresImpl: () => pool,
  });
  assert.equal(result.state, "restored");
  assert.equal(result.account_count, 2);
  assert.equal(result.repaired_existing_accounts, 1);
  assert.deepEqual(existing.map((item) => item.id).sort(), [ACCOUNT_ID, ACCOUNT_ID_2].sort());
  assert.equal(queries.filter(({ query }) => query.startsWith("insert into public.chips_accounts")).length, 1);
});

test("create-only account recovery reuses equal object and never overwrites it", async () => {
  const recovery = serializeAccountRecovery(buildAccountRecoverySnapshot({ batch: completeBatch(), tableIds: [TABLE_ID], accounts: [account()] }));
  let stored = null;
  let uploadCalls = 0;
  const deps = {
    readPrivateObject: async (_target, objectPath) => stored && { objectPath, mimeType: ACCOUNT_RECOVERY_MIME_TYPE, bytes: stored },
    uploadPrivateObject: async ({ bytes, mimeType }) => {
      uploadCalls += 1;
      assert.equal(mimeType, ACCOUNT_RECOVERY_MIME_TYPE);
      stored = Buffer.from(bytes);
      return { uploaded: true };
    },
  };
  const first = await ensureAccountRecoveryObject({ storageTarget: {}, recovery, deps, expectedSnapshot: recovery.snapshot, expectedAccountIds: [ACCOUNT_ID] });
  const second = await ensureAccountRecoveryObject({ storageTarget: {}, recovery, deps, expectedSnapshot: recovery.snapshot, expectedAccountIds: [ACCOUNT_ID] });
  assert.equal(first.storageWrites, 1);
  assert.equal(second.storageWrites, 0);
  assert.equal(uploadCalls, 1);
  stored = Buffer.from(stored).subarray(0, stored.length - 1);
  await assert.rejects(() => ensureAccountRecoveryObject({ storageTarget: {}, recovery, deps, expectedSnapshot: recovery.snapshot, expectedAccountIds: [ACCOUNT_ID] }), /differs|gzip|SHA|canonical/);
  stored = null;
  await assert.rejects(
    () => ensureAccountRecoveryObject({
      storageTarget: {},
      recovery,
      deps,
      expectedSnapshot: recovery.snapshot,
      expectedAccountIds: [ACCOUNT_ID],
      allowCreate: false,
    }),
    /prepared durable object/,
  );
  assert.equal(uploadCalls, 1, "execute-style reuse must not issue a Storage POST");

  stored = null;
  let racedUploadCalls = 0;
  const racedDeps = {
    readPrivateObject: async (_target, objectPath) => stored && { objectPath, mimeType: ACCOUNT_RECOVERY_MIME_TYPE, bytes: stored },
    uploadPrivateObject: async ({ bytes }) => {
      racedUploadCalls += 1;
      stored = Buffer.from(bytes);
      return { uploaded: false, raced: true };
    },
  };
  const raced = await ensureAccountRecoveryObject({
    storageTarget: {},
    recovery,
    deps: racedDeps,
    expectedSnapshot: recovery.snapshot,
    expectedAccountIds: [ACCOUNT_ID],
  });
  assert.equal(raced.storageWrites, 0, "a create-only race must reuse the object created by the winner");
  assert.equal(racedUploadCalls, 1);
});

test("retry is only 40001/55P03 and stops at three attempts", async () => {
  assert.equal(isRetryableSqlState("40001"), true);
  assert.equal(isRetryableSqlState("55P03"), true);
  assert.equal(isRetryableSqlState("23505"), false);
  let attempts = 0;
  let revalidations = 0;
  const result = await runWithRetirementRetry({
    execute: async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("serialization"), { code: attempts === 1 ? "40001" : "55P03" });
      return "retired";
    },
    revalidate: async () => { revalidations += 1; },
  });
  assert.equal(result.result, "retired");
  assert.equal(result.attempts, 3);
  assert.equal(result.retryCount, 2);
  assert.deepEqual(result.sqlstates, ["40001", "55P03"]);
  assert.equal(revalidations, 2);

  attempts = 0;
  await assert.rejects(() => runWithRetirementRetry({
    execute: async () => {
      attempts += 1;
      throw Object.assign(new Error("serialization"), { code: "40001" });
    },
  }), (error) => error.executeAttempts === 3 && error.executeRetryCount === 2);
  assert.equal(attempts, 3);

  attempts = 0;
  await assert.rejects(() => runWithRetirementRetry({
    execute: async () => {
      attempts += 1;
      throw Object.assign(new Error("serialization"), { code: "40001" });
    },
    revalidate: async () => {
      throw Object.assign(new Error("candidate changed"), { code: "P8969" });
    },
  }), (error) => error.code === "P8969"
    && error.executeAttempts === 1
    && error.executeRetryCount === 1
    && error.executeSqlstates[0] === "40001"
    && error.retryCauseSqlstate === "40001");
  assert.equal(attempts, 1, "changed state must stop before a second execute attempt");

  attempts = 0;
  await assert.rejects(() => runWithRetirementRetry({
    execute: async () => {
      attempts += 1;
      throw Object.assign(new Error("conflict"), { code: "23505" });
    },
  }), /conflict/);
  assert.equal(attempts, 1);

  attempts = 0;
  await assert.rejects(() => runWithRetirementRetry({
    maxAttempts: 99,
    execute: async () => {
      attempts += 1;
      throw Object.assign(new Error("serialization"), { code: "40001" });
    },
  }), (error) => error.executeAttempts === 3 && error.executeRetryCount === 2);
  assert.equal(attempts, 3, "caller cannot raise the retry limit above three");
});

test("automatic retention is bounded to ten archive batches and twenty accounts", () => {
  const batches = Array.from({ length: 12 }, (_, index) => ({
    batchId: String(index + 1),
    accountIds: [String(index + 1)],
  }));
  assert.equal(limitRetirementCandidates(batches).length, 10);
  assert.equal(limitRetirementCandidates(batches, 20, 5).length, 5);
  assert.equal(limitRetirementCandidates([
    { batchId: "1", accountIds: ["1", "2"] },
    { batchId: "2", accountIds: ["3", "4"] },
    { batchId: "3", accountIds: ["5", "6"] },
  ], 10, 4).length, 2);
});

test("retirement telemetry uses separate prepare, recovery and execute phases", () => {
  assert.deepEqual(Object.values(RETIREMENT_PHASES), ["audit", "prepare", "recovery", "execute"]);
});

test("manual rollout arguments require an exact batch, account hash and GO", () => {
  assert.deepEqual(parseRetentionArgs(["--prepare-only", "--batch-id", "101"]), {
    mode: "prepare-only",
    batchId: "101",
    accountIdsSha256: null,
    confirmation: null,
  });
  assert.deepEqual(parseRetentionArgs([
    "--execute",
    "--batch-id", "101",
    "--account-ids-sha256", HASH,
    "--confirmation", "GO 101",
  ]), {
    mode: "execute",
    batchId: "101",
    accountIdsSha256: HASH,
    confirmation: "GO 101",
  });
  assert.throws(() => parseRetentionArgs(["--prepare-only"]), /exact --batch-id/);
  assert.throws(() => parseRetentionArgs(["--execute", "--batch-id", "101", "--confirmation", "GO 101"]), /account-ids-sha256/);
  assert.throws(() => parseRetentionArgs(["--execute", "--batch-id", "101", "--account-ids-sha256", HASH, "--confirmation", "GO 102"]), /exactly GO/);
  assert.deepEqual(parseRetentionArgs([
    "--authorize-canary",
    "--batch-id", "101",
    "--account-ids-sha256", HASH,
    "--confirmation", "GO 101",
  ]), {
    mode: "authorize-canary",
    batchId: "101",
    accountIdsSha256: HASH,
    confirmation: "GO 101",
  });
  assert.deepEqual(parseRetentionArgs([
    "--activate",
    "--confirmation", `ACTIVATE stage-ledger-escrow-account-retention-v1 CANARY 101 ${HASH}`,
  ]), {
    mode: "activate",
    batchId: null,
    accountIdsSha256: null,
    confirmation: `ACTIVATE stage-ledger-escrow-account-retention-v1 CANARY 101 ${HASH}`,
  });
  assert.throws(() => parseRetentionArgs(["--prepare-only", "--batch-id", "101", "--confirmation", "GO 101"]), /only an exact --batch-id/);
  assert.throws(() => parseRetentionArgs(["--authorize-canary", "--batch-id", "101", "--account-ids-sha256", HASH, "--confirmation", "GO 102"]), /exactly GO/);
  assert.throws(() => parseRetentionArgs(["--activate", "--confirmation", "GO 101"]), /exact ACTIVATE/);
});

test("advisory lock assertion requires the reserved session PID and the exact held lock", async () => {
  let lost = false;
  const queries = [];
  const sql = {
    unsafe: async (query, parameters) => {
      queries.push({ query, parameters });
      return [{ backend_pid: lost ? "43" : "42", lock_held: !lost }];
    },
  };
  await assertAdvisoryLock(sql, { backendPid: "42" }, { batchId: "101", attempt: 1, telemetry: false });
  assert.match(queries[0].query, /pg_locks/);
  assert.match(queries[0].query, /hashtextextended/);
  lost = true;
  await assert.rejects(
    () => assertAdvisoryLock(sql, { backendPid: "42" }, { batchId: "101", attempt: 2, telemetry: false }),
    /advisory lock session was lost/,
  );
});

test("reserved postgres.js audit adapter without begin uses one explicit read-only transaction", async () => {
  const session = reservedAuditSession();
  assert.equal(typeof session.begin, "undefined");
  const result = await readOnlyEscrowAudit({
    sql: session,
    expectedSystemIdentifier: "7656985631720456337",
    telemetry: false,
  });
  assert.equal(result.backendPid, "42");
  assert.equal(session.transactionOpen, false);
  assert.deepEqual(session.queries.filter(({ query }) => /^(begin|commit|rollback)\s*;/i.test(query.trim())).map(({ query }) => query), [
    "begin;",
    "commit;",
  ]);
  assert.ok(session.queries.some(({ query }) => /set transaction isolation level repeatable read, read only/i.test(query)));
  assert.equal(session.queries.some(({ query }) => /^rollback\s*;/i.test(query.trim())), false);
});

test("reserved audit rolls back after an audit error and leaves no open transaction", async () => {
  const session = reservedAuditSession({ failOn: /pg_control_system/ });
  await assert.rejects(
    () => readOnlyEscrowAudit({ sql: session, expectedSystemIdentifier: "7656985631720456337", telemetry: false }),
    /injected audit failure/,
  );
  assert.equal(session.transactionOpen, false);
  assert.equal(session.queries.some(({ query }) => /^rollback\s*;/i.test(query.trim())), true);
});

test("audit reports the first deterministically sorted bounded next candidate and hash", async () => {
  const tableId2 = "00000000-0000-4000-8000-000000000002";
  const firstBatch = completeBatch({ batch_id: "101", legacy_batch_number: "1" });
  const secondBatch = completeBatch({
    batch_id: "102",
    bot_only_table_id: tableId2,
    legacy_batch_number: "2",
  });
  const events = [];
  const session = reservedAuditSession({
    // Deliberately return rows in the opposite order; readOnlyEscrowAudit
    // must report the first item from its verified sorted candidates list.
    batchRows: [secondBatch, firstBatch],
    accountRows: [account(ACCOUNT_ID_2, tableId2), account()],
  });
  const result = await readOnlyEscrowAudit({
    sql: session,
    expectedSystemIdentifier: "7656985631720456337",
    telemetry: (event) => events.push(event),
  });
  const expected = {
    batch_number: 1,
    batch_id: "101",
    source_policy_id: "stage-ledger-bot-only-retention-7d-v1",
    table_count: 1,
    account_count: 1,
    account_ids_sha256: accountIdsSha256([ACCOUNT_ID]),
  };
  assert.deepEqual(result.nextCandidate, expected);
  assert.deepEqual(events.find((event) => event.event === "chips_ledger_stage_escrow_retention_audit")?.next_candidate, expected);
  const originalStdoutWrite = process.stdout.write;
  let stdout = "";
  process.stdout.write = (chunk) => {
    stdout += String(chunk);
    return true;
  };
  try {
    reportSummary({ mode: "audit", state: "audit", nextCandidate: result.nextCandidate }, { GITHUB_STEP_SUMMARY: "" });
  } finally {
    process.stdout.write = originalStdoutWrite;
  }
  assert.deepEqual(JSON.parse(stdout.trim()).next_candidate, expected);
});

test("registry scope excludes existing tables and preserves the missing-table residual guard", async () => {
  const openId = "00000000-0000-4000-8000-000000000002";
  const closedId = "00000000-0000-4000-8000-000000000003";
  for (const missing of [false, true]) {
    const session = reservedAuditSession({
      batchRows: [completeBatch(), completeBatch({ batch_id: "102", bot_only_table_id: openId }), completeBatch({ batch_id: "103", bot_only_table_id: closedId })],
      accountRows: [account(ACCOUNT_ID_2, openId), account("00000000-0000-4000-8000-000000000103", closedId), ...(missing ? [account()] : [])],
      tableRows: [{ id: openId, status: "OPEN" }, { id: closedId, status: "CLOSED" }],
      registryRows: [{ table_id: TABLE_ID, archive_batch_id: "101", count: "2" }],
    });
    const result = await readOnlyEscrowAudit({ sql: session, telemetry: false });
    const archiveBatchQueries = session.queries.filter(({ query }) => query === RETENTION_BATCHES_SQL);
    assert.equal(archiveBatchQueries.length, missing ? 1 : 0, "archive lookup must be scoped to missing table IDs");
    if (missing) assert.deepEqual(archiveBatchQueries[0].parameters, [
      "krydukthwdvccggbyjfw",
      "stage-ledger-bot-only-retention-7d-v1",
      [TABLE_ID],
    ]);
    const tableQueries = session.queries.filter(({ query }) => query === RETENTION_REGISTRY_TABLE_COUNTS_SQL);
    const batchQueries = session.queries.filter(({ query }) => query === RETENTION_REGISTRY_BATCH_COUNTS_SQL);
    assert.equal(tableQueries.length, missing ? 1 : 0);
    assert.equal(batchQueries.length, missing ? 1 : 0);
    if (missing) {
      assert.deepEqual(tableQueries[0].parameters, [[TABLE_ID]]);
      assert.deepEqual(batchQueries[0].parameters, [["101"]]);
      const residual = result.accounts.find((row) => row.tableId === TABLE_ID);
      assert.equal(residual.reason, "residual_idempotency_mapping");
      assert.equal(residual.registryCount, 2);
    }
  }
});

test("missing legacy tables use proof overlap before bounded batch and run lookups", async () => {
  const legacyBatchId = "202";
  const session = reservedAuditSession({
    legacyProofRows: [{ batch_id: legacyBatchId, batch_table_ids: [TABLE_ID] }],
    legacyBatchRows: [{ batch_id: legacyBatchId, source_policy_id: "legacy_stage_allowlist_v1" }],
    accountRows: [account()],
  });
  await readOnlyEscrowAudit({ sql: session, telemetry: false });
  const botBatchQueries = session.queries.filter(({ query }) => query === RETENTION_BATCHES_SQL);
  assert.equal(botBatchQueries.length, 1);
  assert.deepEqual(botBatchQueries[0].parameters, [
    "krydukthwdvccggbyjfw",
    "stage-ledger-bot-only-retention-7d-v1",
    [TABLE_ID],
  ]);
  const proofQueries = session.queries.filter(({ query }) => query === RETENTION_LEGACY_PROOFS_FOR_TABLES_SQL);
  assert.equal(proofQueries.length, 1);
  assert.deepEqual(proofQueries[0].parameters, [[TABLE_ID]]);
  const batchQueries = session.queries.filter(({ query }) => query === RETENTION_LEGACY_BATCHES_SQL);
  assert.equal(batchQueries.length, 1);
  assert.deepEqual(batchQueries[0].parameters, [
    "krydukthwdvccggbyjfw",
    "legacy_stage_allowlist_v1",
    [legacyBatchId],
  ]);
});

test("audit reports null next_candidate for an empty backlog", async () => {
  const events = [];
  const result = await readOnlyEscrowAudit({
    sql: reservedAuditSession(),
    expectedSystemIdentifier: "7656985631720456337",
    telemetry: (event) => events.push(event),
  });
  assert.equal(result.nextCandidate, null);
  assert.equal(events.find((event) => event.event === "chips_ledger_stage_escrow_retention_audit")?.next_candidate, null);
});

test("automatic disabled policy audits on the reserved session and releases its advisory lock", async () => {
  const session = reservedAuditSession();
  let poolEnded = false;
  const pool = {
    reserve: async () => session,
    end: async () => { poolEnded = true; },
  };
  const result = await runStageEscrowAccountRetention({
    mode: "automatic",
    deps: {
      pool,
      config: { dbUrl: "postgres://stage.example.invalid/db" },
      telemetry: false,
    },
  });
  assert.equal(result.state, "disabled");
  assert.equal(result.policyEnabled, false);
  assert.equal(result.lockBackendPid, "42");
  assert.equal(session.transactionOpen, false);
  assert.equal(session.released, true);
  assert.equal(poolEnded, true);
  const acquireIndex = session.queries.findIndex(({ query }) => query.includes("pg_try_advisory_lock"));
  const beginIndex = session.queries.findIndex(({ query }) => /^begin\s*;/i.test(query.trim()));
  const commitIndex = session.queries.findIndex(({ query }) => /^commit\s*;/i.test(query.trim()));
  const releaseIndex = session.queries.findIndex(({ query }) => query.includes("pg_advisory_unlock"));
  assert.ok(acquireIndex >= 0 && acquireIndex < beginIndex);
  assert.ok(beginIndex < commitIndex && commitIndex < releaseIndex);
  assert.equal(session.queries.some(({ query }) => query.includes("pg_advisory_unlock")), true);
});

test("initial escrow connection retries a fresh client only for transient failures", async () => {
  for (const code of ["CONNECT_TIMEOUT", "57014", "42501"]) {
    const clients = [];
    const delays = [];
    const session = reservedAuditSession();
    const run = () => runStageEscrowAccountRetention({
      mode: "audit",
      deps: {
        config: { dbUrl: "postgres://stage.example.invalid/db" },
        telemetry: false,
        klog: () => {},
        sleep: async (ms) => delays.push(ms),
        postgres: () => {
          assert.ok(clients.every((client) => client.closed));
          const index = clients.length;
          const client = {
            closed: false,
            connected: false,
            unsafe: async (query) => {
              assert.equal(query, "select 1;");
              if (index === 0) throw Object.assign(new Error("initial connection failure"), { code });
              client.connected = true;
              return [{ "?column?": 1 }];
            },
            reserve: async () => {
              assert.equal(client.connected, true, "reserve must never initiate the cold connection");
              return session;
            },
            end: async () => { client.closed = true; },
          };
          clients.push(client);
          return client;
        },
      },
    });
    if (code === "CONNECT_TIMEOUT") {
      const result = await run();
      assert.equal(result.state, "audit");
      assert.equal(result.lockBackendPid, "42");
      assert.equal(session.released, true);
      assert.equal(clients.length, 2);
      assert.deepEqual(delays, [250]);
    } else {
      await assert.rejects(run, { code });
      assert.equal(clients.length, 1);
      assert.deepEqual(delays, []);
      assert.equal(session.queries.length, 0);
    }
    assert.ok(clients.every((client) => client.closed));
  }
});

test("manual escrow-retention-audit completes on the reserved adapter", async () => {
  const session = reservedAuditSession();
  const result = await runStageEscrowAccountRetention({
    mode: "audit",
    deps: {
      sql: session,
      config: { dbUrl: "postgres://stage.example.invalid/db" },
      telemetry: false,
    },
  });
  assert.equal(result.state, "audit");
  assert.equal(result.lockBackendPid, "42");
  assert.equal(session.transactionOpen, false);
});

test("owner retention control keeps acquire, assertions, function and release on one session", async () => {
  const queries = [];
  const events = [];
  let revalidated = null;
  let transactionOpen = false;
  const session = {
    unsafe: async (query) => {
      queries.push(query);
      if (/^begin\s*;/i.test(query.trim())) {
        assert.equal(transactionOpen, false);
        transactionOpen = true;
        return [];
      }
      if (/^commit\s*;/i.test(query.trim())) {
        assert.equal(transactionOpen, true);
        transactionOpen = false;
        return [];
      }
      if (/^rollback\s*;/i.test(query.trim())) {
        transactionOpen = false;
        return [];
      }
      if (query.includes("pg_try_advisory_lock")) return [{ backend_pid: "42", acquired: true }];
      if (query.includes("pg_locks")) return [{ backend_pid: "42", lock_held: true }];
      if (query.includes("chips_authorize_stage_escrow_account_retirement_canary")) {
        events.push("authorize");
        return [{ result: { state: "canary_authorized", batch_id: "101", account_ids_sha256: HASH, confirmation: "GO 101" } }];
      }
      if (query.includes("pg_advisory_unlock")) return [{ pg_advisory_unlock: true }];
      return [];
    },
    release: async () => {},
  };
  const result = await runStageEscrowAccountRetentionControl({
    mode: "authorize-canary",
    batchId: "101",
    expectedAccountIdsSha256: HASH,
    confirmation: "GO 101",
    env: { CHIPS_LEDGER_ESCROW_ACCOUNT_RETENTION_AUTHORIZE_CANARY: "1" },
    deps: {
      sql: session,
      config: { dbUrl: "postgres://stage.example.invalid/db" },
      telemetry: false,
      revalidateCanary: async (context) => {
        events.push("revalidate");
        revalidated = context;
      },
    },
  });
  assert.equal(result.state, "canary_authorized");
  assert.equal(result.lockBackendPid, "42");
  assert.equal(queries.filter((query) => query.includes("pg_locks")).length, 6);
  assert.equal(queries.filter((query) => query.includes("chips_authorize_stage_escrow_account_retirement_canary")).length, 1);
  assert.equal(queries.filter((query) => query.includes("pg_advisory_unlock")).length, 1);
  assert.equal(revalidated.batchId, "101");
  assert.equal(revalidated.expectedAccountIdsSha256, HASH);
  assert.equal(revalidated.lockSession.backendPid, "42");
  assert.equal(transactionOpen, false);
  assert.deepEqual(events, ["revalidate", "authorize"]);
});

test("prepare archive verification accepts raw SQL text archive_batches rows", async () => {
  // The chips_ledger_archive_batches.batches.* row is returned by postgres.js
  // with bigint columns as strings.  exporterManifestFromDatabase expects the
  // numeric normalization that parseManifestRow applies, so a raw row must not
  // reach verifyArchiveBytes unparsed (regression for run 33689857907).
  const SYSTEM_ID = "00000000-0000-4000-8000-00000000000e";
  const BOT_TX_ID = "00000000-0000-4000-8000-0000000000f1";
  const CREATED_AT = "2026-07-01T00:00:00.123456Z";
  const CUTOFF = "2026-08-01T00:00:00.000000Z";
  const OUT_OF_SCOPE_SHA = "f".repeat(64);
  const batchId = "15";
  const botCandidate = {
    id: BOT_TX_ID,
    sequence: "1",
    tx_type: "TABLE_BUY_IN",
    idempotency_key: `bot-seed-buyin:${TABLE_ID}:1`,
    payload_hash: "b".repeat(64),
    user_id: null,
    reference: `BOT_SEED_BUY_IN:${TABLE_ID}:1`,
    description: "escrow retention regression fixture",
    metadata: { tableId: TABLE_ID },
    created_by: SYSTEM_ID,
    created_at: CREATED_AT,
    entry_count: "2",
    table_related: true,
    table_id: TABLE_ID,
    table_exists: true,
    table_status: "CLOSED",
    escrow_account_id: ACCOUNT_ID,
    escrow_status: "active",
    escrow_balance: "0",
    has_human_participant: false,
    bot_only_proof_eligible: true,
    key_table_id: TABLE_ID,
    key_format_version: 1,
    key_format: "bot-seed-buyin",
    table_newest_created_at: CREATED_AT,
    table_identity_count: "1",
    table_eligible_count: "1",
    table_out_of_scope_keys_sha256: OUT_OF_SCOPE_SHA,
  };
  const entry = (id, accountId, accountType, systemKey, amount) => ({
    id: String(id),
    transaction_id: BOT_TX_ID,
    account_id: accountId,
    entry_seq: String(id),
    amount: String(amount),
    metadata: {},
    created_at: CREATED_AT,
    account_row_id: accountId,
    account_type: accountType,
    account_user_id: null,
    account_system_key: systemKey,
    account_status: "active",
    account_label: null,
  });
  const record = buildExportRecord(botCandidate, [
    entry(1, ACCOUNT_ID, "ESCROW", `POKER_TABLE:${TABLE_ID}`, 100),
    entry(2, SYSTEM_ID, "SYSTEM", "TREASURY", -100),
  ], { schemaVersion: 2 });
  const archive = buildArchiveBytes([record]);
  const canonicalManifest = buildManifest({
    target: "stage",
    cutoff: CUTOFF,
    batchSize: 5000,
    cursor: null,
    records: [record],
    archive,
    outputPath: `/private/${archive.compressedSha256}.jsonl.gz`,
    sourcePolicyId: BOT_ONLY_RETENTION_POLICY_ID,
    schemaVersion: 2,
  });
  const objectPath = buildObjectPath(canonicalManifest);
  const stageTarget = {
    target: "stage",
    label: "Stage",
    projectRef: "krydukthwdvccggbyjfw",
    systemIdentifier: "7656985631720456337",
  };
  const canonicalVerified = verifyArchiveBytes({
    compressedBytes: archive.compressedBytes,
    manifest: canonicalManifest,
    target: { target: "stage", projectRef: "krydukthwdvccggbyjfw" },
    artifactName: path.basename(objectPath),
  });
  const evidence = buildPruneEvidence(canonicalVerified, { maxBatchSize: 5000 });
  const row = {
    object_path: objectPath,
    batch_id: batchId,
    project_ref: "krydukthwdvccggbyjfw",
    format_version: 2,
    source_policy_id: BOT_ONLY_RETENTION_POLICY_ID,
    status: "committed",
    cutoff: canonicalManifest.cutoff.created_at,
    cursor_start_created_at: null,
    cursor_start_id: null,
    cursor_end_created_at: canonicalManifest.cursor.end?.created_at || null,
    cursor_end_id: canonicalManifest.cursor.end?.id || null,
    first_created_at: canonicalManifest.time_range.first_created_at,
    last_created_at: canonicalManifest.time_range.last_created_at,
    transaction_count: String(canonicalManifest.batch.transactions),
    entry_count: String(canonicalManifest.batch.entries),
    tx_types: canonicalManifest.batch.tx_types,
    raw_bytes: String(canonicalManifest.bytes.raw),
    compressed_bytes: String(canonicalManifest.bytes.compressed),
    raw_sha256: canonicalManifest.sha256.raw_jsonl,
    compressed_sha256: canonicalManifest.sha256.compressed_artifact,
    credits: canonicalManifest.amounts.credits,
    debits: canonicalManifest.amounts.debits,
    net_amount: canonicalManifest.amounts.net,
    committed_at: "2026-08-02T00:00:00.000000Z",
    archived_transaction_ids_sha256: evidence.transactionIdsSha256,
    archived_entry_ids_sha256: evidence.entryIdsSha256,
    archive_proof_verified_at: "2026-08-02T00:00:01.000000Z",
    pruned_at: "2026-08-03T00:00:00.000000Z",
    pruned_transaction_count: String(canonicalManifest.batch.transactions),
    pruned_entry_count: String(canonicalManifest.batch.entries),
    pruned_transaction_ids_sha256: evidence.transactionIdsSha256,
    pruned_entry_ids_sha256: evidence.entryIdsSha256,
    bot_only_table_id: TABLE_ID,
    bot_only_table_count: "1",
    bot_only_newest_created_at: canonicalManifest.bot_only?.newest_created_at || CREATED_AT,
    bot_only_registry_keys_sha256: evidence.registryKeysSha256,
    bot_only_out_of_scope_keys_sha256: evidence.outOfScopeKeysSha256,
    bot_only_identity_count: String(canonicalManifest.batch.transactions),
    bot_only_eligible_count: String(canonicalManifest.batch.transactions),
    registry_cleaned_at: "2026-08-04T00:00:00.000000Z",
    registry_cleaned_key_count: String(evidence.registryKeys?.length),
    registry_cleaned_keys_sha256: evidence.registryKeysSha256,
    destructive_go_at: "2026-08-05T00:00:00.000000Z",
    destructive_go_batch_id: batchId,
  };

  // Pre-fix behavior: the unparsed raw row is rejected by the manifest gate
  // with the exact production error.
  assert.throws(
    () => verifyArchiveBytes({
      compressedBytes: archive.compressedBytes,
      manifest: exporterManifestFromDatabase(row, stageTarget, null),
      target: stageTarget,
      artifactName: path.basename(objectPath),
    }),
    /batch\.transactions must be a non-negative integer/,
  );

  // The fixed path normalizes the raw row before building the manifest.
  const normalizedManifest = exporterManifestFromDatabase(parseManifestRow(row), stageTarget, null);
  assert.equal(Number.isSafeInteger(normalizedManifest.batch.transactions), true);
  assert.equal(Number.isSafeInteger(normalizedManifest.batch.entries), true);
  assert.equal(Number.isSafeInteger(normalizedManifest.bytes.raw), true);
  assert.equal(Number.isSafeInteger(normalizedManifest.bytes.compressed), true);

  // Regression for run 33735273784: a timestamp truncated to milliseconds (as
  // postgres.js Date parsing does) must not leak into the reconstructed schema-v2
  // manifest, otherwise the artifact table summary check fails semantically.
  const truncatedNewest = row.bot_only_newest_created_at.replace(/\.(\d{3})\d{3}Z$/, ".$1Z");
  assert.notEqual(truncatedNewest, row.bot_only_newest_created_at);
  assert.throws(
    () => verifyArchiveBytes({
      compressedBytes: archive.compressedBytes,
      manifest: exporterManifestFromDatabase(parseManifestRow({ ...row, bot_only_newest_created_at: truncatedNewest }), stageTarget, null),
      target: stageTarget,
      artifactName: path.basename(objectPath),
    }),
    /TABLE_IDENTITY_SUMMARY_NEWEST_CREATED_AT_SEMANTIC_MISMATCH/,
  );

  // Durable recovery copy shaped like inspectDurableRecoveryState reports it.
  // The prune store writes these from a parseManifestRow-normalized row, so the
  // expected manifest must be derived from the same normalized representation.
  const recoveryManifest = buildRecoveryManifest(parseManifestRow(row), stageTarget.systemIdentifier, evidence, stageTarget);
  const manifestBytes = Buffer.from(`${JSON.stringify(recoveryManifest)}\n`, "utf8");
  const manifestGzipBytes = gzipSync(manifestBytes, { level: 9, mtime: 0 });
  const durable = {
    archivePath: buildRecoveryArchiveObjectPath(row.compressed_sha256),
    manifestPath: buildRecoveryManifestObjectPath(row.compressed_sha256),
    archiveBytes: archive.compressedBytes,
    archiveSha256: archive.compressedSha256,
    manifestBytes,
    manifestGzipBytes,
    manifestSha256: crypto.createHash("sha256").update(manifestGzipBytes).digest("hex"),
    manifest: recoveryManifest,
  };
  const verified = await verifyPrimaryArchiveAndDurableRecovery({
    sql: null,
    storageTarget: {},
    row,
    identity: stageTarget.systemIdentifier,
    cwd: process.cwd(),
    deps: {
      downloadArchive: async () => ({ bytes: archive.compressedBytes, sha256: archive.compressedSha256 }),
      inspectDurableRecovery: async () => ({ state: "complete", durable }),
    },
    telemetry: false,
    phase: RETIREMENT_PHASES.PREPARE,
    attempt: 1,
  });
  assert.equal(verified.recoveryState, "complete");
  assert.equal(verified.primary.archiveSha256, row.compressed_sha256);
  assert.equal(verified.evidence.transactionIdsSha256, evidence.transactionIdsSha256);
});
