import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

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
  parseRetentionArgs,
  runWithRetirementRetry,
  runStageEscrowAccountRetentionControl,
  serializeAccountRecovery,
  verifyAccountRecoveryBytes,
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

test("owner retention control keeps acquire, assertions, function and release on one session", async () => {
  const queries = [];
  const events = [];
  let revalidated = null;
  const session = {
    unsafe: async (query) => {
      queries.push(query);
      if (query.includes("pg_try_advisory_lock")) return [{ backend_pid: "42", acquired: true }];
      if (query.includes("pg_locks")) return [{ backend_pid: "42", lock_held: true }];
      if (query.includes("chips_authorize_stage_escrow_account_retirement_canary")) {
        events.push("authorize");
        return [{ result: { state: "canary_authorized", batch_id: "101", account_ids_sha256: HASH, confirmation: "GO 101" } }];
      }
      if (query.includes("pg_advisory_unlock")) return [{ pg_advisory_unlock: true }];
      return [];
    },
    begin: async (callback) => callback(session),
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
  assert.deepEqual(events, ["revalidate", "authorize"]);
});
