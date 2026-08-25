import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

import {
  BOT_ONLY_AUTOMATIC_MAX_BATCHES_PER_RUN,
  runAutomaticBotOnlyStageAutomation,
} from "../../scripts/ops/chips-ledger-stage-automation.mjs";
import {
  buildLegacyBatchManifest,
  buildLegacyPlan,
  buildLegacyStageAllowlistRunContract,
  LEGACY_STAGE_ALLOWLIST_BATCH_COUNT,
  LEGACY_STAGE_ALLOWLIST_REMAINING_TABLE_COUNT,
  loadFrozenLegacyAllowlist,
} from "../../scripts/ops/chips-ledger-legacy-stage-allowlist.mjs";
import { runLegacyStageAllowlistOrchestrator } from "../../scripts/ops/chips-ledger-legacy-stage-allowlist-orchestrator.mjs";
import { LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13 } from "../../scripts/ops/chips-ledger-legacy-stage-allowlist-audit.mjs";

const root = process.cwd();
const workflow = fs.readFileSync(".github/workflows/chips-ledger-stage-automation.yml", "utf8");
const orchestratorSource = fs.readFileSync(
  "scripts/ops/chips-ledger-legacy-stage-allowlist-orchestrator.mjs",
  "utf8",
);
const automationSource = fs.readFileSync(
  "scripts/ops/chips-ledger-stage-automation.mjs",
  "utf8",
);
const orchestrationMigration = fs.readFileSync(
  "supabase/migrations/20260825120000_chips_ledger_stage_cleanup_orchestration.sql",
  "utf8",
);

const ENV = Object.freeze({
  SUPABASE_STAGE_DB_URL: "postgresql://postgres.krydukthwdvccggbyjfw:password@aws-0.pooler.supabase.com:5432/postgres",
  SUPABASE_STAGE_URL: "https://krydukthwdvccggbyjfw.supabase.co",
  SUPABASE_STAGE_SERVICE_ROLE_KEY: "stage-test-key",
  DEPLOYED_COMMIT_SHA: "f".repeat(40),
  CHIPS_LEDGER_BOT_ONLY_AUTOMATIC: "1",
});

function fakeScheduler({
  enabled = true,
  candidateCount = 3,
  blockingAfter = null,
  failExecuteOnce = false,
} = {}) {
  const manifests = new Map();
  const ownRows = [];
  const durable = new Map();
  const executionCounts = new Map();
  const state = {
    candidateCalls: 0,
    storeCalls: 0,
    executeCalls: 0,
    failedOnce: false,
  };

  const evidence = (tableId, key) => ({
    transactionCount: 1,
    entryCount: 2,
    txTypes: { TABLE_BUY_IN: 1 },
    credits: "100",
    debits: "100",
    net: "0",
    registryKeys: [key],
    registryKeysSha256: "1".repeat(64),
    tableId,
  });

  const sql = {
    unsafe: async (query) => {
      if (query.includes("pg_try_advisory_lock")) return [{ backend_pid: "100", acquired: true }];
      if (query.includes("pg_backend_pid")) return [{ backend_pid: "100" }];
      if (query.includes("pg_advisory_unlock")) return [{ pg_advisory_unlock: true }];
      if (query.includes("pg_control_system")) return [{ system_identifier: "7656985631720456337" }];
      if (query.includes("chips_table_fence_is_active")) return [{ active: true }];
      if (query.includes("chips_table_fence_control")) return [{ enforcement_active: true }];
      if (query.includes("chips_stage_bot_only_retention_policy")) {
        return enabled
          ? [{ policy_id: "stage-ledger-bot-only-retention-7d-v1", enabled: true, activated_at: "2026-08-25T00:00:00Z", canary_batch_id: "1" }]
          : [{ policy_id: "stage-ledger-bot-only-retention-7d-v1", enabled: false, activated_at: null, canary_batch_id: null }];
      }
      if (query.includes("from public.chips_ledger_archive_batches")) return ownRows;
      throw new Error(`unexpected fake scheduler SQL: ${query}`);
    },
  };

  const pruneStore = {
    getManifest: async (objectPath) => manifests.get(objectPath) || null,
  };

  const deps = {
    sql,
    pruneStore,
    storageTarget: {
      target: "stage",
      projectRef: "krydukthwdvccggbyjfw",
      baseUrl: "https://storage.example.test",
      serviceKey: "stage-test-key",
    },
    verifyBucket: async () => {},
    ensureArchiveBucket: async () => {},
    exportArchive: async () => {
      if (state.candidateCalls >= candidateCount) {
        return {
          noCandidate: true,
          blockingAnomalies: blockingAfter !== null && state.candidateCalls >= blockingAfter
            ? [{ code: "candidate_anomaly" }]
            : [],
          options: { projectRef: "krydukthwdvccggbyjfw" },
        };
      }
      state.candidateCalls += 1;
      return { noCandidate: false, bytes: { raw: 10 } };
    },
    storeArchive: async () => {
      const index = state.storeCalls;
      state.storeCalls += 1;
      const letter = String.fromCharCode(97 + index);
      const compressedSha = letter.repeat(64);
      const objectPath = `v1/sha256/${compressedSha}.jsonl.gz`;
      const tableId = `00000000-0000-4000-8000-${String(200 + index).padStart(12, "0")}`;
      const row = {
        object_path: objectPath,
        project_ref: "krydukthwdvccggbyjfw",
        source_policy_id: "stage-ledger-bot-only-retention-7d-v1",
        status: "committed",
        batch_id: String(100 + index),
        format_version: "2",
        cutoff: "2026-08-18T00:00:00.000Z",
        transaction_count: "1",
        entry_count: "2",
        compressed_sha256: compressedSha,
        compressed_bytes: "10",
        raw_bytes: "10",
        raw_sha256: "d".repeat(64),
        archived_transaction_ids_sha256: null,
        archived_entry_ids_sha256: null,
        archive_proof_verified_at: null,
        pruned_at: null,
        pruned_transaction_count: null,
        pruned_entry_count: null,
        pruned_transaction_ids_sha256: null,
        pruned_entry_ids_sha256: null,
        registry_cleaned_at: null,
        registry_cleaned_key_count: null,
        registry_cleaned_keys_sha256: null,
        bot_only_table_id: tableId,
        bot_only_table_count: "1",
        bot_only_identity_count: "1",
        bot_only_eligible_count: "1",
        bot_only_registry_keys_sha256: "1".repeat(64),
        bot_only_out_of_scope_keys_sha256: "2".repeat(64),
        destructive_go_at: null,
        destructive_go_batch_id: null,
      };
      manifests.set(objectPath, row);
      ownRows.unshift(row);
      return { objectPath };
    },
    pruneArchive: async ({ argv }) => {
      const objectPath = argv[argv.indexOf("--object-path") + 1];
      const row = manifests.get(objectPath);
      if (argv.includes("--register-proof")) {
        row.archived_transaction_ids_sha256 = "3".repeat(64);
        row.archived_entry_ids_sha256 = "4".repeat(64);
        row.archive_proof_verified_at = "2026-08-25T00:00:00Z";
        return { state: "proof_registered" };
      }
      return {
        state: "ready",
        evidence: evidence(row.bot_only_table_id, "key:" + row.batch_id),
      };
    },
    inspectDurableRecovery: async (_target, row) => durable.get(row.object_path) || null,
    persistDurableRecovery: async (_target, row, _identity, _evidence, archiveBytes) => {
      const value = {
        archiveBytes,
        manifestBytes: Buffer.from("{}"),
        manifestGzipBytes: Buffer.from("gzip"),
        archiveSha256: row.compressed_sha256,
        manifestSha256: "5".repeat(64),
        recoveryArchive: { sha256: row.compressed_sha256 },
        recoveryManifest: { sha256: "5".repeat(64) },
      };
      durable.set(row.object_path, value);
      return value;
    },
    downloadPrivateArchive: async () => ({ bytes: Buffer.from("archive"), downloadMs: 0 }),
    executeVerifiedCycle: async ({ row }) => {
      state.executeCalls += 1;
      const count = (executionCounts.get(row.object_path) || 0) + 1;
      executionCounts.set(row.object_path, count);
      if (failExecuteOnce && !state.failedOnce) {
        state.failedOnce = true;
        executionCounts.set(row.object_path, count - 1);
        throw new Error("simulated interruption between batches");
      }
      if (count === 1) {
        row.pruned_at = "2026-08-25T00:00:01Z";
        row.pruned_transaction_count = "1";
        row.pruned_entry_count = "2";
        row.pruned_transaction_ids_sha256 = row.archived_transaction_ids_sha256;
        row.pruned_entry_ids_sha256 = row.archived_entry_ids_sha256;
        row.registry_cleaned_at = "2026-08-25T00:00:02Z";
        row.registry_cleaned_key_count = "1";
        row.registry_cleaned_keys_sha256 = "1".repeat(64);
        row.destructive_go_at = "2026-08-25T00:00:00Z";
        row.destructive_go_batch_id = row.batch_id;
        return { state: "cleaned", evidence: evidence(row.bot_only_table_id, "key:" + row.batch_id) };
      }
      return { state: "already_cleaned", evidence: evidence(row.bot_only_table_id, "key:" + row.batch_id) };
    },
  };

  return { env: { ...ENV }, deps, state, manifests, ownRows };
}

function staticOrchestrationContract() {
  const frozen = loadFrozenLegacyAllowlist({ cwd: root });
  const contract = buildLegacyStageAllowlistRunContract(frozen.masterManifest);
  assert.equal(LEGACY_STAGE_ALLOWLIST_BATCH_COUNT, 98);
  assert.equal(contract.remainingTableCount, LEGACY_STAGE_ALLOWLIST_REMAINING_TABLE_COUNT);
  assert.equal(contract.remainingTableCount, 964);
  assert.equal(contract.firstBatchNumber, 2);
  assert.equal(contract.lastBatchNumber, 98);
  assert.equal(contract.batchCount, 97);
  assert.equal(contract.masterAllowlistSha256, "611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05");
  assert.equal(contract.planSha256, "f6521e7bb892c1ea3ddb566bed86bf7cac48cb305823c4c682957ef6db2d100b");
  assert.equal(contract.remainingTableIdsSha256, "a7bd1aea6bfe0435609cce6ccbe78f9ba55cab062e3cf55fd933fade5f029fc8");
  assert.equal(buildLegacyBatchManifest(frozen.masterManifest, { batchNumber: 2 }).batch_table_count, 10);
  assert.equal(buildLegacyBatchManifest(frozen.masterManifest, { batchNumber: 98 }).batch_table_count, 4);
  const batchPlan = buildLegacyPlan(
    frozen.masterManifest,
    buildLegacyBatchManifest(frozen.masterManifest, { batchNumber: 2 }),
    { runId: "7", runPlanSha256: contract.planSha256 },
  );
  assert.equal(batchPlan.batchNumber, 2);
  assert.equal(batchPlan.runId, "7");
  assert.equal(batchPlan.runPlanSha256, contract.planSha256);
  assert.throws(
    () => buildLegacyBatchManifest(frozen.masterManifest, { batchNumber: 99 }),
    /legacy batch number is invalid/,
  );
  const substitutedIds = [...frozen.masterManifest.table_ids];
  substitutedIds[substitutedIds.length - 1] = `${substitutedIds[substitutedIds.length - 1].slice(0, -1)}${substitutedIds[substitutedIds.length - 1].endsWith("f") ? "e" : "f"}`;
  substitutedIds.sort();
  assert.throws(
    () => buildLegacyStageAllowlistRunContract({ ...frozen.masterManifest, table_ids: substitutedIds }),
    /canonical Stage evidence/,
  );
  assert.throws(
    () => buildLegacyStageAllowlistRunContract({ ...frozen.masterManifest, cutoff: "2026-08-18T16:51:28.074Z" }),
    /canonical Stage evidence/,
  );
  assert.throws(
    () => buildLegacyStageAllowlistRunContract({ ...frozen.masterManifest, manifest_sha256: "0".repeat(64) }),
    /canonical Stage evidence/,
  );
  const reorderedBatch = {
    ...buildLegacyBatchManifest(frozen.masterManifest, { batchNumber: 2 }),
    batch_number: 3,
  };
  assert.throws(
    () => buildLegacyPlan(frozen.masterManifest, reorderedBatch),
    /canonical frozen order/,
  );
  assert.throws(
    () => buildLegacyPlan(frozen.masterManifest, buildLegacyBatchManifest(frozen.masterManifest, { batchNumber: 2 }), {
      runId: "7",
      runPlanSha256: "0".repeat(64),
    }),
    /canonical orchestration contract/,
  );
}

async function schedulerContracts() {
  const disabled = fakeScheduler({ enabled: false });
  const disabledResult = await runAutomaticBotOnlyStageAutomation(disabled);
  assert.equal(disabledResult.state, "no-op");
  assert.equal(disabledResult.reason, "automatic_policy_disabled");
  assert.equal(disabled.state.storeCalls, 0);

  const enabled = fakeScheduler({ enabled: true, candidateCount: 3 });
  const enabledResult = await runAutomaticBotOnlyStageAutomation(enabled);
  assert.equal(enabledResult.state, "completed");
  assert.equal(enabledResult.processed.length, 3);
  assert.equal(enabledResult.boundedBatchLimit, BOT_ONLY_AUTOMATIC_MAX_BATCHES_PER_RUN);
  assert.deepEqual(enabledResult.processed.map((row) => row.retry), ["already_cleaned", "already_cleaned", "already_cleaned"]);
  assert.equal(enabled.state.storeCalls, 3);

  const anomaly = fakeScheduler({ enabled: true, candidateCount: 1, blockingAfter: 1 });
  await assert.rejects(
    runAutomaticBotOnlyStageAutomation(anomaly),
    /blocking anomaly/,
  );
  assert.equal(anomaly.state.storeCalls, 1, "anomaly must stop before the next batch");

  const interrupted = fakeScheduler({ enabled: true, candidateCount: 1, failExecuteOnce: true });
  await assert.rejects(runAutomaticBotOnlyStageAutomation(interrupted), /simulated interruption/);
  const resumed = await runAutomaticBotOnlyStageAutomation(interrupted);
  assert.equal(resumed.processed.length, 1);
  assert.equal(interrupted.state.candidateCalls, 1, "resume must start from the incomplete manifest");
  assert.equal(interrupted.state.storeCalls, 1, "resume must not create a second manifest");
}

async function legacyOrchestratorContracts() {
  const frozen = loadFrozenLegacyAllowlist({ cwd: root });
  const contract = buildLegacyStageAllowlistRunContract(frozen.masterManifest);
  const batch13 = {
    object_path: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.objectPath,
    batch_id: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.batchId,
    status: "committed",
    source_policy_id: "legacy_stage_allowlist_v1",
    legacy_allowlist_sha256: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.masterAllowlistSha256,
    legacy_batch_number: "1",
    legacy_batch_table_count: "10",
    archive_proof_verified_at: "2026-08-18T00:00:00Z",
    pruned_at: "2026-08-18T00:00:01Z",
    registry_cleaned_at: "2026-08-18T00:00:02Z",
    pruned_transaction_count: "60",
    pruned_entry_count: "120",
    registry_cleaned_key_count: "60",
    pruned_transaction_ids_sha256: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.txIdsSha256,
    pruned_entry_ids_sha256: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.entryIdsSha256,
    registry_cleaned_keys_sha256: LEGACY_STAGE_ALLOWLIST_AUDIT_BATCH_13.registryKeysSha256,
  };
  const batch2 = {
    object_path: "v1/sha256/" + "b".repeat(64) + ".jsonl.gz",
    batch_id: "2002",
    status: "committed",
    source_policy_id: "legacy_stage_allowlist_v1",
    legacy_run_id: "41",
    legacy_plan_sha256: contract.planSha256,
    legacy_batch_number: "2",
    legacy_batch_table_count: "10",
    legacy_allowlist_sha256: contract.masterAllowlistSha256,
    legacy_batch_table_ids_sha256: "c".repeat(64),
    archive_proof_verified_at: "2026-08-25T00:00:00Z",
    archived_transaction_ids_sha256: "d".repeat(64),
    archived_entry_ids_sha256: "e".repeat(64),
    pruned_at: "2026-08-25T00:00:01Z",
    registry_cleaned_at: "2026-08-25T00:00:02Z",
    pruned_transaction_count: "1",
    pruned_entry_count: "2",
    registry_cleaned_key_count: "1",
    pruned_transaction_ids_sha256: "d".repeat(64),
    pruned_entry_ids_sha256: "e".repeat(64),
    registry_cleaned_keys_sha256: "f".repeat(64),
    compressed_sha256: "b".repeat(64),
    compressed_bytes: "10",
  };
  const rows = [batch2];
  const sql = {
    begin: async (callback) => callback(sql),
    unsafe: async (query) => {
      if (query.includes("set transaction")) return [];
      if (query.includes("pg_try_advisory_lock")) return [{ backend_pid: "41", acquired: true }];
      if (query.includes("pg_backend_pid")) return [{ backend_pid: "41" }];
      if (query.includes("pg_advisory_unlock")) return [{ pg_advisory_unlock: true }];
      if (query.includes("from public.chips_legacy_stage_allowlist_runs")) return [{
        run_id: "41",
        project_ref: "krydukthwdvccggbyjfw",
        source_policy_id: "legacy_stage_allowlist_v1",
        stage_system_identifier: "7656985631720456337",
        cutoff: "2026-08-17T16:51:28.074Z",
        master_allowlist_sha256: contract.masterAllowlistSha256,
        master_manifest_sha256: "eb5593bdf5bd7f3c985373e6037a861d999413eae5076b923165c7f8147a79e7",
        remaining_table_ids_sha256: contract.remainingTableIdsSha256,
        remaining_table_count: "964",
        first_batch_number: "2",
        last_batch_number: "98",
        batch_count: "97",
        plan_sha256: contract.planSha256,
        status: "authorized",
        destructive_go_at: "2026-08-25T00:00:00Z",
      }];
      if (query.includes("where batch_id = 13")) return [batch13];
      if (query.includes("from public.chips_ledger_archive_batches")) return rows;
      throw new Error("unexpected legacy orchestrator SQL: " + query);
    },
  };
  const calls = [];
  const result = await runLegacyStageAllowlistOrchestrator({
    env: { ...ENV },
    cwd: root,
    deps: {
      sql,
      maxBatchesPerRun: 1,
      preflight: async () => ({ systemIdentifier: "7656985631720456337", enforcementActive: true }),
      storageTarget: { target: "stage", projectRef: "krydukthwdvccggbyjfw" },
      verifyBucket: async () => {},
      pruneStore: { getManifest: async () => batch2 },
      pruneArchive: async ({ argv }) => {
        calls.push(argv);
        assert.equal(argv.includes("--execute"), false, "completed batch skip must remain non-destructive");
        return { state: "already_pruned" };
      },
    },
  });
  assert.equal(result.batch13, "skipped-already-pruned-and-cleaned");
  assert.deepEqual(result.processed.map((row) => row.batchNumber), [2]);
  assert.equal(result.processed[0].state, "skipped");
  assert.equal(result.remainingBatchCount, 96);
  assert.equal(calls.length, 1);
}

function staticWorkflowContracts() {
  assert.match(workflow, /bot-only-7d-automatic/);
  assert.match(workflow, /legacy-stage-allowlist-orchestrate/);
  assert.match(workflow, /github\.event_name == 'schedule' \|\| .*bot-only-7d-automatic/);
  assert.match(workflow, /--policy bot-only-7d --automatic/);
  assert.match(workflow, /CHIPS_LEDGER_BOT_ONLY_AUTOMATIC: "1"/);
  assert.match(workflow, /node scripts\/ops\/chips-ledger-legacy-stage-allowlist-orchestrator\.mjs/);
  assert.doesNotMatch(workflow, /SUPABASE_PROD_|PRODUCTION|--target\\s+prod/i);
  assert.match(orchestratorSource, /batch13: "skipped-already-pruned-and-cleaned"/);
  assert.match(orchestratorSource, /LEGACY_STAGE_ALLOWLIST_ORCHESTRATOR_MAX_BATCHES_PER_RUN/);
  assert.match(orchestratorSource, /assertLegacyBatchRows/);
  assert.match(orchestratorSource, /process\.argv\.slice\(2\)\.length !== 0/);
  assert.match(automationSource, /BOT_ONLY_AUTOMATIC_MAX_BATCHES_PER_RUN = 10/);
  assert.match(automationSource, /automatic_policy_disabled/);
  assert.match(automationSource, /automatic bot-only Stage retention requires an active fence and enforcement/);
  assert.match(orchestrationMigration, /chips_authorize_legacy_stage_allowlist_run/);
  assert.match(orchestrationMigration, /chips_activate_bot_only_retention_policy/);
  assert.match(orchestrationMigration, /chips_auto_prune_and_cleanup_bot_only_archive_batch/);
  assert.match(orchestrationMigration, /P894[0-6]/);
  assert.match(orchestrationMigration, /P895[0-6]/);
}

staticOrchestrationContract();
staticWorkflowContracts();
await schedulerContracts();
await legacyOrchestratorContracts();

const dbUrl = process.env.CHIPS_MIGRATIONS_TEST_DB_URL;
if (!dbUrl) {
  process.stdout.write("Skipping disposable PostgreSQL Stage cleanup contracts: CHIPS_MIGRATIONS_TEST_DB_URL not set.\n");
  process.exit(0);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ROLLBACK = new Error("stage-cleanup-orchestration-contract-rollback");

async function disposableBotFixture(tx) {
  await tx.unsafe("select public.chips_set_table_fence_active(true);");
  const systemRows = await tx.unsafe(
    "select id from public.chips_accounts where account_type::text = 'SYSTEM' and system_key = 'GENESIS' limit 1;",
  );
  assert.ok(systemRows[0]?.id, "disposable fixture requires the GENESIS account");
  const tableId = randomUUID();
  const escrowAccountId = randomUUID();
  await tx.unsafe(
    "insert into public.poker_tables (id, status, has_human_participant, bot_only_proof_eligible) values ($1::uuid, 'OPEN', false, true);",
    [tableId],
  );
  await tx.unsafe(
    "insert into public.chips_accounts (id, account_type, system_key, status, balance) values ($1::uuid, 'ESCROW', $2, 'active', 0);",
    [escrowAccountId, `POKER_TABLE:${tableId}`],
  );
  const transactionId = randomUUID();
  const key = `bot-seed-buyin:${tableId}:stage-cleanup-contract`;
  const createdAt = new Date(Date.now() - (10 * DAY_MS)).toISOString();
  const cutoff = new Date().toISOString();
  await tx.unsafe(`
    insert into public.chips_transactions
      (id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id, created_at)
    values ($1::uuid, $2, $3::jsonb, $4, $5, 'TABLE_BUY_IN', null, $6::timestamptz);
  `, [
    transactionId,
    `BOT_SEED_BUY_IN:${tableId}:1`,
    JSON.stringify({ tableId }),
    key,
    "a".repeat(64),
    createdAt,
  ]);
  const entries = await tx.unsafe(`
    insert into public.chips_entries (transaction_id, account_id, amount, metadata)
    values ($1::uuid, $2::uuid, -100, '{}'::jsonb), ($1::uuid, $3::uuid, 100, '{}'::jsonb)
    returning id;
  `, [transactionId, systemRows[0].id, escrowAccountId]);
  await tx.unsafe("update public.poker_tables set status = 'CLOSED' where id = $1::uuid;", [tableId]);
  await tx.unsafe("set constraints all immediate;");
  const hashes = await tx.unsafe(
    "select public.chips_archive_text_ids_sha256($1::text[]) as registry_hash, public.chips_archive_text_ids_sha256(array[]::text[]) as empty_hash;",
    [[key]],
  );
  await tx.unsafe(`
    insert into public.chips_ledger_archive_batches (
      object_path, project_ref, format_version, cutoff, first_created_at, last_created_at,
      cursor_end_created_at, cursor_end_id,
      transaction_count, entry_count, tx_types, raw_bytes, compressed_bytes, raw_sha256,
      compressed_sha256, credits, debits, net_amount, source_policy_id, bot_only_table_id,
      bot_only_table_count, bot_only_newest_created_at, bot_only_registry_keys_sha256,
      bot_only_out_of_scope_keys_sha256, bot_only_identity_count, bot_only_eligible_count,
      status, committed_at
    ) values (
      $1, 'krydukthwdvccggbyjfw', 2, $2::timestamptz, $3::timestamptz, $3::timestamptz,
      $3::timestamptz, $9::uuid,
      1, 2, '{"TABLE_BUY_IN":1}'::jsonb, 10, 10, $4, $5, 100, 100, 0,
      'stage-ledger-bot-only-retention-7d-v1', $6::uuid, 1, $3::timestamptz, $7, $8, 1, 1,
      'committed', now()
    );
  `, [
    "v1/sha256/" + "9".repeat(64) + ".jsonl.gz",
    cutoff,
    createdAt,
    "a".repeat(64),
    "9".repeat(64),
    tableId,
    hashes[0].registry_hash,
    hashes[0].empty_hash,
    transactionId,
  ]);
  return {
    tableId,
    systemAccountId: systemRows[0].id,
    escrowAccountId,
    transactionId,
    entryIds: entries.map((row) => String(row.id)),
    key,
    objectPath: "v1/sha256/" + "9".repeat(64) + ".jsonl.gz",
    compressedSha: "9".repeat(64),
    createdAt,
  };
}

async function accountingSnapshot(tx, fixture) {
  const accounts = await tx.unsafe(`
    select id::text as id, balance::text as balance, next_entry_seq::text as next_entry_seq
      from public.chips_accounts
     where id = any($1::uuid[])
     order by id;
  `, [[fixture.systemAccountId, fixture.escrowAccountId]]);
  const totals = await tx.unsafe("select coalesce(sum(amount), 0)::text as conservation from public.chips_entries;");
  return { accounts, conservation: totals[0].conservation };
}

async function insertCanary(tx) {
  const canaryPath = "v1/sha256/" + "8".repeat(64) + ".jsonl.gz";
  const keysHash = await tx.unsafe(
    "select public.chips_archive_text_ids_sha256(array['canary-key']::text[]) as hash;",
  );
  const emptyHash = await tx.unsafe(
    "select public.chips_archive_text_ids_sha256(array[]::text[]) as hash;",
  );
  const inserted = await tx.unsafe(`
    insert into public.chips_ledger_archive_batches (
      object_path, project_ref, format_version, cutoff, transaction_count, entry_count, tx_types,
      raw_bytes, compressed_bytes, raw_sha256, compressed_sha256, credits, debits, net_amount,
      source_policy_id, bot_only_table_id, bot_only_table_count, bot_only_newest_created_at,
      bot_only_registry_keys_sha256, bot_only_out_of_scope_keys_sha256, bot_only_identity_count,
      bot_only_eligible_count, archived_transaction_ids_sha256, archived_entry_ids_sha256,
      archive_proof_verified_at, pruned_at, pruned_transaction_count, pruned_entry_count,
      pruned_transaction_ids_sha256, pruned_entry_ids_sha256, registry_cleaned_at,
      registry_cleaned_key_count, registry_cleaned_keys_sha256, destructive_go_at,
      destructive_go_batch_id, status, committed_at
    ) values (
      $1, 'krydukthwdvccggbyjfw', 2, now(), 1, 2, '{"TABLE_BUY_IN":1}'::jsonb,
      10, 10, $2, $3, 100, 100, 0,
      'stage-ledger-bot-only-retention-7d-v1', $4::uuid, 1, now(), $5, $6, 1, 1,
      $7, $8, now(), now(), 1, 2, $7, $8, now(), 1, $5, null, null,
      'committed', now()
    ) returning batch_id::text as batch_id;
  `, [
    canaryPath,
    "1".repeat(64),
    "2".repeat(64),
    randomUUID(),
    keysHash[0].hash,
    emptyHash[0].hash,
    "3".repeat(64),
    "4".repeat(64),
  ]);
  const batchId = inserted[0].batch_id;
  await tx.unsafe("select set_config('chips.bot_only_go', '1', true);");
  await tx.unsafe(
    "update public.chips_ledger_archive_batches set destructive_go_at = now(), destructive_go_batch_id = $1::bigint where batch_id = $1::bigint;",
    [batchId],
  );
  const activated = await tx.unsafe(
    "select public.chips_activate_bot_only_retention_policy($1::bigint, $2) as result;",
    [batchId, `ACTIVATE stage-ledger-bot-only-retention-7d-v1 CANARY ${batchId}`],
  );
  assert.equal(activated[0].result.state, "active");
  return batchId;
}

async function disposablePostgresContract() {
  const sql = postgres(dbUrl, { max: 1, prepare: false, idle_timeout: 5 });
  const gateRows = await sql.unsafe(`
    select
      pg_get_functiondef('public.chips_assert_archive_prune_stage()'::regprocedure) as stage_definition,
      pg_get_functiondef('public.chips_assert_archive_prune_target(text,bigint)'::regprocedure) as target_definition;
  `);
  try {
    await sql.unsafe(`
      create or replace function public.chips_assert_archive_prune_stage()
      returns text language sql security definer set search_path = ''
      as $stage_cleanup_test_stage$ select '7656985631720456337'::text $stage_cleanup_test_stage$;
    `);
    await sql.unsafe(`
      create or replace function public.chips_assert_archive_prune_target(p_project_ref text, p_transaction_count bigint)
      returns text language plpgsql security definer set search_path = ''
      as $stage_cleanup_test_target$
      begin
        if p_project_ref = 'krydukthwdvccggbyjfw' and p_transaction_count between 1 and 5000 then
          return '7656985631720456337';
        end if;
        raise exception 'test target gate rejected request';
      end
      $stage_cleanup_test_target$;
    `);

    await sql.begin(async (tx) => {
      await tx.unsafe("set transaction isolation level serializable;");
      const sqlPlan = await tx.unsafe(`
        select public.chips_legacy_stage_allowlist_run_plan_sha256(
          1, $1, $2, $3, $4::timestamptz, $5, $6, $7, 964, 2, 98, 97
        ) as plan_sha256;
      `, [
        "legacy_stage_allowlist_v1",
        "krydukthwdvccggbyjfw",
        "7656985631720456337",
        "2026-08-17T16:51:28.074Z",
        "611ab69ba8ee160a4957f8fe9514c919b9f4129bc1ea7842778b04d28ea6ca05",
        "eb5593bdf5bd7f3c985373e6037a861d999413eae5076b923165c7f8147a79e7",
        "a7bd1aea6bfe0435609cce6ccbe78f9ba55cab062e3cf55fd933fade5f029fc8",
      ]);
      assert.equal(sqlPlan[0].plan_sha256, buildLegacyStageAllowlistRunContract(loadFrozenLegacyAllowlist({ cwd: root }).masterManifest).planSha256);
      const inactive = await tx.unsafe("select public.chips_bot_only_retention_automatic_active() as active;");
      assert.equal(inactive[0].active, false, "automatic policy must be disabled before activation");
      const canaryBatchId = await insertCanary(tx);
      const fixture = await disposableBotFixture(tx);
      const before = await accountingSnapshot(tx, fixture);
      const proof = await tx.unsafe(`
        select public.chips_register_bot_only_archive_proof(
          $1, $2::uuid[], $3::bigint[], $4::uuid, $5::text[]
        ) as result;
      `, [
        fixture.objectPath,
        [fixture.transactionId],
        fixture.entryIds,
        fixture.tableId,
        [fixture.key],
      ]);
      assert.equal(proof[0].result.state, "proof_registered");

      const automatic = await tx.unsafe(`
        select public.chips_auto_prune_and_cleanup_bot_only_archive_batch(
          $1, $2::uuid[], $3::bigint[], $4::text[], $5::uuid
        ) as result;
      `, [fixture.objectPath, [fixture.transactionId], fixture.entryIds, [fixture.key], fixture.tableId]);
      assert.equal(automatic[0].result.state, "cleaned");
      const after = await accountingSnapshot(tx, fixture);
      assert.deepEqual(after.accounts, before.accounts, "automatic cleanup must preserve balances and next_entry_seq");
      assert.equal(after.conservation, before.conservation, "automatic cleanup must preserve conservation");

      const receipt = await tx.unsafe(`
        select
          pruned_at, registry_cleaned_at,
          pruned_transaction_count, pruned_entry_count, registry_cleaned_key_count,
          (select count(*) from public.chips_transactions where id = $1::uuid) as hot_transactions,
          (select count(*) from public.chips_entries where id = any($2::bigint[])) as hot_entries,
          (select count(*) from public.chips_transaction_idempotency where archive_batch_id = batches.batch_id) as remaining_registry_count,
          (select bot_only_retention_complete_at from public.poker_tables where id = $3::uuid) as table_complete
        from public.chips_ledger_archive_batches batches
        where object_path = $4;
      `, [fixture.transactionId, fixture.entryIds, fixture.tableId, fixture.objectPath]);
      assert.ok(receipt[0].pruned_at);
      assert.ok(receipt[0].registry_cleaned_at);
      assert.equal(Number(receipt[0].pruned_transaction_count), 1);
      assert.equal(Number(receipt[0].pruned_entry_count), 2);
      assert.equal(Number(receipt[0].registry_cleaned_key_count), 1);
      assert.equal(Number(receipt[0].hot_transactions), 0);
      assert.equal(Number(receipt[0].hot_entries), 0);
      assert.equal(Number(receipt[0].remaining_registry_count), 0);
      assert.ok(receipt[0].table_complete);

      const retry = await tx.unsafe(`
        select public.chips_auto_prune_and_cleanup_bot_only_archive_batch(
          $1, $2::uuid[], $3::bigint[], $4::text[], $5::uuid
        ) as result;
      `, [fixture.objectPath, [fixture.transactionId], fixture.entryIds, [fixture.key], fixture.tableId]);
      assert.equal(retry[0].result.state, "already_cleaned");

      await tx.unsafe("savepoint replay_old_registry_key;");
      let replayError = null;
      try {
        await tx.unsafe(`
          insert into public.chips_transactions
            (id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id)
          values ($1::uuid, $2, $3::jsonb, $4, $5, 'TABLE_BUY_IN', null);
        `, [
          randomUUID(),
          `BOT_SEED_BUY_IN:${fixture.tableId}:replay`,
          JSON.stringify({ tableId: fixture.tableId }),
          fixture.key,
          "f".repeat(64),
        ]);
      } catch (error) {
        replayError = error;
      }
      await tx.unsafe("rollback to savepoint replay_old_registry_key;");
      await tx.unsafe("release savepoint replay_old_registry_key;");
      assert.equal(replayError?.code, "P8903");
      assert.match(replayError?.message || "", /closed or missing/);

      const policy = await tx.unsafe(
        "select public.chips_bot_only_retention_automatic_active() as active;",
      );
      assert.equal(policy[0].active, true);
      assert.equal(canaryBatchId !== null, true);
      throw ROLLBACK;
    }).catch((error) => {
      if (error !== ROLLBACK) throw error;
    });
  } finally {
    await sql.unsafe(gateRows[0].stage_definition);
    await sql.unsafe(gateRows[0].target_definition);
    await sql.end({ timeout: 5 });
  }
}

await disposablePostgresContract();
process.stdout.write("chips-ledger-stage-cleanup orchestration contracts passed\n");
