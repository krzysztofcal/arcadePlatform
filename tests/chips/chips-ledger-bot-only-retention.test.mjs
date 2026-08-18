import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildArchiveBytes,
  buildExportRecord,
  buildManifest,
  evaluateTableEligibility,
  validateBatch,
} from "../../scripts/ops/chips-ledger-archive-export.mjs";
import { buildPruneEvidence, buildRecoveryManifest } from "../../scripts/ops/chips-ledger-archive-prune.mjs";
import { verifyArchiveBytes } from "../../scripts/ops/chips-ledger-archive-store.mjs";
import {
  assertTableBinding,
  parseTableIdempotencyKey,
} from "../../scripts/ops/_shared/chips-table-idempotency.mjs";
import { validateStageEnvironment } from "../../scripts/ops/chips-ledger-stage-automation.mjs";

const migration = fs.readFileSync("supabase/migrations/20260818100000_chips_ledger_bot_only_retention.sql", "utf8");
const closedTableCleanup = fs.readFileSync("ws-server/poker/persistence/closed-table-cleanup.mjs", "utf8");

const TABLE_ID = "00000000-0000-4000-8000-000000000020";
const TX_ID = "00000000-0000-4000-8000-000000000021";
const SYSTEM_ID = "00000000-0000-4000-8000-000000000022";
const ESCROW_ID = "00000000-0000-4000-8000-000000000023";
const KEY = `bot-seed-buyin:${TABLE_ID}:1`;

function entry(id, amount, accountId, accountType, systemKey = null) {
  return {
    id: String(id),
    transaction_id: TX_ID,
    account_id: accountId,
    entry_seq: String(id),
    amount: String(amount),
    metadata: {},
    created_at: "2026-07-01T00:00:00.000000Z",
    account_row_id: accountId,
    account_type: accountType,
    account_user_id: null,
    account_system_key: systemKey,
    account_status: "active",
    account_label: null,
  };
}

function botCandidate(overrides = {}) {
  return {
    id: TX_ID,
    sequence: "1",
    tx_type: "TABLE_BUY_IN",
    idempotency_key: KEY,
    payload_hash: "a".repeat(64),
    user_id: null,
    reference: `BOT_SEED_BUY_IN:${TABLE_ID}:1`,
    description: null,
    metadata: { tableId: TABLE_ID },
    created_by: "00000000-0000-4000-8000-000000000024",
    created_at: "2026-07-01T00:00:00.000000Z",
    entry_count: "2",
    table_related: true,
    table_id: TABLE_ID,
    table_exists: true,
    table_status: "CLOSED",
    escrow_account_id: ESCROW_ID,
    escrow_status: "active",
    escrow_balance: "0",
    has_human_participant: false,
    bot_only_proof_eligible: true,
    key_table_id: TABLE_ID,
    key_format_version: 1,
    key_format: "bot-seed-buyin",
    table_newest_created_at: "2026-07-01T00:00:00.000000Z",
    table_identity_count: "1",
    table_eligible_count: "1",
    table_out_of_scope_keys_sha256: "b".repeat(64),
    ...overrides,
  };
}

function botRecord(candidate = botCandidate(), entries = [
  entry(2, -100, SYSTEM_ID, "SYSTEM", "TREASURY"),
  entry(1, 100, ESCROW_ID, "ESCROW", `POKER_TABLE:${TABLE_ID}`),
]) {
  return buildExportRecord(candidate, entries, { schemaVersion: 2 });
}

function assertThrowsMessage(fn, pattern) {
  assert.throws(fn, pattern);
}

function historicalKeyAndEntryBindingContract() {
  assert.deepEqual(parseTableIdempotencyKey(KEY), {
    version: 1,
    format: "bot-seed-buyin",
    tableId: TABLE_ID,
    key: KEY,
  });
  assert.equal(parseTableIdempotencyKey(`poker:inactive_cleanup:${TABLE_ID}:user`).format, "poker:inactive_cleanup");
  assert.equal(assertTableBinding({
    idempotencyKey: KEY,
    metadata: { tableId: TABLE_ID },
    reference: `BOT_SEED_BUY_IN:${TABLE_ID}:1`,
  }).tableId, TABLE_ID);
  assertThrowsMessage(() => parseTableIdempotencyKey("deleted-key"), /supported/);
  assertThrowsMessage(() => assertTableBinding({
    idempotencyKey: KEY,
    metadata: { tableId: "00000000-0000-4000-8000-000000000099" },
  }), /binding/);

  const candidate = botCandidate();
  const valid = botRecord(candidate);
  assert.equal(validateBatch({ candidates: [candidate], records: [valid], cutoff: "2026-07-02T00:00:00Z", schemaVersion: 2 }).transactionCount, 1);
  assertThrowsMessage(() => validateBatch({
    candidates: [candidate],
    records: [botRecord(candidate, [
      entry(2, -100, SYSTEM_ID, "SYSTEM", "TREASURY"),
      entry(1, 100, ESCROW_ID, "ESCROW", "POKER_TABLE:00000000-0000-4000-8000-000000000099"),
    ])],
    cutoff: "2026-07-02T00:00:00Z",
    schemaVersion: 2,
  }), /ESCROW binding/);
}

function concurrencyAndScopeContract() {
  const immediate = migration.slice(
    migration.indexOf("create or replace function public.chips_table_transaction_before_insert"),
    migration.indexOf("$$;", migration.indexOf("create or replace function public.chips_table_transaction_before_insert")) + 3,
  );
  assert.match(migration, /create trigger chips_table_transaction_fence[\s\S]*?before insert on public\.chips_transactions/i);
  assert.match(immediate, /for update/i);
  assert.doesNotMatch(immediate, /chips_entries/);
  assert.match(migration, /if tg_table_name = 'chips_transactions' then[\s\S]*?transaction_id := new\.id/);
  assert.match(migration, /create constraint trigger chips_table_transaction_binding[\s\S]*?deferrable initially deferred/i);
  assert.match(migration, /create constraint trigger chips_entries_table_transaction_binding[\s\S]*?deferrable initially deferred/i);
  assert.equal(evaluateTableEligibility({ table_related: true, table_id: TABLE_ID, table_exists: true, table_status: "OPEN", escrow_account_id: ESCROW_ID, escrow_balance: "0" }).eligible, false);
  assert.equal(evaluateTableEligibility({ table_related: true, table_id: TABLE_ID, table_exists: true, table_status: "CLOSED", escrow_account_id: ESCROW_ID, escrow_balance: "0" }).eligible, true);
  assertThrowsMessage(() => validateBatch({
    candidates: [botCandidate({ tx_type: "HAND_SETTLEMENT" })],
    records: [botRecord(botCandidate({ tx_type: "HAND_SETTLEMENT" }))],
    cutoff: "2026-07-02T00:00:00Z",
    schemaVersion: 2,
  }), /non-TABLE/);
}

function failClosedLifecycleContract() {
  assert.match(migration, /enforcement_active boolean not null default false/);
  assert.match(migration, /has_human_participant is true and new\.has_human_participant is not true/);
  assert.match(migration, /new\.bot_only_proof_eligible is not true/);
  assert.match(migration, /p_confirmation is distinct from \('GO ' \|\| p_batch_id::text\)/);
  assert.match(migration, /source_policy_id <> 'stage-ledger-bot-only-retention-7d-v1'/);
  assert.match(migration, /Production authorization|canonical Stage schema-v2 batch/);
  assert.match(closedTableCleanup, /has_human_participant is true or t\.bot_only_retention_complete_at is not null/);
  assertThrowsMessage(() => validateStageEnvironment({
    SUPABASE_STAGE_DB_URL: "postgresql://postgres.krydukthwdvccggbyjfw@db.krydukthwdvccggbyjfw.supabase.co:5432/postgres",
    SUPABASE_STAGE_URL: "https://krydukthwdvccggbyjfw.supabase.co",
    SUPABASE_STAGE_SERVICE_ROLE_KEY: "stage-test",
    SUPABASE_PROD_DB_URL: "forbidden",
  }), /Production credentials/);
}

function retryAndAccountingContract() {
  const candidate = botCandidate();
  const record = botRecord(candidate);
  const localArchive = {
    records: [record],
    manifest: {
      schema_version: 2,
      batch: { tx_types: { TABLE_BUY_IN: 1 } },
      bot_only: { out_of_scope_keys_sha256: "b".repeat(64) },
    },
    summary: { credits: "100", debits: "100", netAmount: "0" },
  };
  const first = buildPruneEvidence(localArchive);
  const second = buildPruneEvidence(localArchive);
  assert.deepEqual(second, first);
  assert.equal(first.credits, "100");
  assert.equal(first.debits, "100");
  assert.equal(first.net, "0");
  assert.deepEqual(first.registryKeys, [KEY]);
  const archive = buildArchiveBytes([record]);
  const manifest = buildManifest({
    target: "stage",
    cutoff: "2026-07-08T00:00:00Z",
    batchSize: 5000,
    cursor: null,
    records: [record],
    archive,
    outputPath: "archive.jsonl.gz",
    sourcePolicyId: "stage-ledger-bot-only-retention-7d-v1",
    schemaVersion: 2,
  });
  const verified = verifyArchiveBytes({
    compressedBytes: archive.compressedBytes,
    manifest,
    target: { target: "stage" },
    artifactName: "archive.jsonl.gz",
  });
  assert.equal(verified.summary.transactionCount, 1);
  const recovery = buildRecoveryManifest({
    object_path: "v1/sha256/" + "c".repeat(64) + ".jsonl.gz",
    project_ref: "krydukthwdvccggbyjfw",
    source_policy_id: "stage-ledger-bot-only-retention-7d-v1",
    format_version: 2,
    cutoff: "2026-07-08T00:00:00Z",
    transaction_count: 1,
    entry_count: 2,
    tx_types: { TABLE_BUY_IN: 1 },
    raw_bytes: 1,
    compressed_bytes: 1,
    raw_sha256: "d".repeat(64),
    compressed_sha256: "c".repeat(64),
    credits: "100",
    debits: "100",
    net_amount: "0",
  }, "7656985631720456337", first, { target: "stage" });
  assert.equal(recovery.id_proof.transaction_ids_sha256, first.transactionIdsSha256);
  assert.equal(recovery.bot_only.table_id, TABLE_ID);
  assert.equal(recovery.bot_only.registry_keys_sha256, first.registryKeysSha256);
  assert.equal(recovery.bot_only.registry_key_count, 1);
  const operator = migration.slice(migration.indexOf("create or replace function public.chips_prune_and_cleanup_bot_only_archive_batch"));
  assert.match(operator, /delete from public\.chips_transaction_idempotency/);
  assert.match(operator, /registry_cleaned_keys_sha256/);
  assert.match(operator, /update public\.poker_tables/);
  assert.doesNotMatch(operator.slice(0, operator.indexOf("grant select")), /update public\.chips_accounts/);
}

historicalKeyAndEntryBindingContract();
concurrencyAndScopeContract();
failClosedLifecycleContract();
retryAndAccountingContract();

process.stdout.write("chips-ledger-bot-only-retention four fundamental contracts passed\n");
