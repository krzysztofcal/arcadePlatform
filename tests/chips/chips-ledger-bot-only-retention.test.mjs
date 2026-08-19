import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import postgres from "postgres";

import {
  BOT_ONLY_CANDIDATE_SQL,
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
  parseTableReference,
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
  assertThrowsMessage(() => parseTableReference(`legacy-funding:${TABLE_ID}`), /supported/);
  assertThrowsMessage(() => assertTableBinding({
    idempotencyKey: KEY,
    metadata: { tableId: null },
  }), /metadata\.tableId/);
  assertThrowsMessage(() => assertTableBinding({
    idempotencyKey: KEY,
    reference: `legacy-funding:${TABLE_ID}`,
  }), /reference format/);
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

const POSTGRES_TEST_DB_URL = process.env.CHIPS_MIGRATIONS_TEST_DB_URL || null;
const DAY_MS = 24 * 60 * 60 * 1000;
const DB_ROLLBACK = new Error("bot-only-retention-test-rollback");

async function enableTableFence(db, active) {
  await db.unsafe("select public.chips_set_table_fence_active($1::boolean);", [active]);
}

async function expectDatabaseError(tx, savepoint, operation, code, pattern) {
  await tx.unsafe(`savepoint ${savepoint};`);
  let caught = null;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  await tx.unsafe(`rollback to savepoint ${savepoint};`);
  await tx.unsafe(`release savepoint ${savepoint};`);
  assert.ok(caught, `${savepoint} must fail closed`);
  assert.equal(caught.code, code, `${savepoint} error code`);
  assert.match(caught.message || "", pattern, `${savepoint} error message`);
}

async function createDatabaseTable(tx, status = "OPEN") {
  const tableId = randomUUID();
  const escrowAccountId = randomUUID();
  const systemRows = await tx.unsafe(`
    select id
      from public.chips_accounts
     where account_type::text = 'SYSTEM'
       and system_key = 'GENESIS'
     limit 1;
  `);
  assert.ok(systemRows[0]?.id, "GENESIS fixture is required for PostgreSQL bot-only tests");
  await tx.unsafe(`
    insert into public.poker_tables (id, status, has_human_participant, bot_only_proof_eligible)
    values ($1::uuid, $2, false, true);
  `, [tableId, status]);
  await tx.unsafe(`
    insert into public.chips_accounts (id, account_type, system_key, status, balance)
    values ($1::uuid, 'ESCROW', $2, 'active', 0);
  `, [escrowAccountId, `POKER_TABLE:${tableId}`]);
  return { tableId, systemAccountId: systemRows[0].id, escrowAccountId };
}

async function insertDatabaseTableTransaction(tx, fixture, {
  kind = "buyin",
  createdAt,
  metadata = { tableId: fixture.tableId },
  reference = null,
  escrowAccountId = fixture.escrowAccountId,
  keySuffix = null,
} = {}) {
  const transactionId = randomUUID();
  const amount = 100;
  const isBuyIn = kind === "buyin";
  const transactionType = isBuyIn ? "TABLE_BUY_IN" : "TABLE_CASH_OUT";
  const key = isBuyIn
    ? `bot-seed-buyin:${fixture.tableId}:${keySuffix || transactionId}`
    : `poker:bot-terminal-cashout:v1:${fixture.tableId}:${keySuffix || transactionId}`;
  const transactionReference = reference || (isBuyIn
    ? `BOT_SEED_BUY_IN:${fixture.tableId}:1`
    : `table:${fixture.tableId}`);
  const payloadHash = "a".repeat(64);
  await tx.unsafe(`
    insert into public.chips_transactions
      (id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id, created_at)
    values ($1::uuid, $2, $3::jsonb, $4, $5, $6, null, $7::timestamptz);
  `, [
    transactionId,
    transactionReference,
    JSON.stringify(metadata),
    key,
    payloadHash,
    transactionType,
    createdAt || new Date().toISOString(),
  ]);
  const systemAmount = isBuyIn ? -amount : amount;
  const escrowAmount = -systemAmount;
  const entryRows = await tx.unsafe(`
    insert into public.chips_entries (transaction_id, account_id, amount, metadata)
    values
      ($1::uuid, $2::uuid, $3::bigint, '{}'::jsonb),
      ($1::uuid, $4::uuid, $5::bigint, '{}'::jsonb)
    returning id;
  `, [transactionId, fixture.systemAccountId, systemAmount, escrowAccountId, escrowAmount]);
  return {
    transactionId,
    entryIds: entryRows.map((row) => String(row.id)).sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1),
    key,
    createdAt: createdAt || new Date().toISOString(),
  };
}

async function historicalKeyAndEntryBindingPostgresContract(sql) {
  await sql.begin(async (tx) => {
    await enableTableFence(tx, true);
    const fixture = await createDatabaseTable(tx);
    const valid = await insertDatabaseTableTransaction(tx, fixture, { keySuffix: "valid" });
    await tx.unsafe("set constraints all immediate;");
    const registry = await tx.unsafe(`
      select table_id::text, key_format_version, key_format
        from public.chips_transaction_idempotency
       where idempotency_key = $1;
    `, [valid.key]);
    assert.deepEqual(registry[0], {
      table_id: fixture.tableId,
      key_format_version: 1,
      key_format: "bot-seed-buyin",
    });

    await expectDatabaseError(tx, "null_metadata_marker", async () => {
      await tx.unsafe(`
        insert into public.chips_transactions
          (id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id)
        values ($1::uuid, $2, '{"tableId":null}'::jsonb, $3, $4, 'TABLE_BUY_IN', null);
      `, [randomUUID(), `BOT_SEED_BUY_IN:${fixture.tableId}:1`, `bot-seed-buyin:${fixture.tableId}:bad-meta-${randomUUID()}`, "b".repeat(64)]);
    }, "P8902", /metadata\.tableId|metadata/);

    await expectDatabaseError(tx, "unknown_reference_marker", async () => {
      await tx.unsafe(`
        insert into public.chips_transactions
          (id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id)
        values ($1::uuid, $2, $3::jsonb, $4, $5, 'TABLE_BUY_IN', null);
      `, [
        randomUUID(),
        `legacy-funding:${fixture.tableId}`,
        JSON.stringify({ tableId: fixture.tableId }),
        `bot-seed-buyin:${fixture.tableId}:bad-reference-${randomUUID()}`,
        "c".repeat(64),
      ]);
    }, "P8902", /reference/);

    const wrongEscrowId = randomUUID();
    await tx.unsafe(`
      insert into public.chips_accounts (id, account_type, system_key, status, balance)
      values ($1::uuid, 'ESCROW', $2, 'active', 0);
    `, [wrongEscrowId, `POKER_TABLE:${randomUUID()}`]);
    await expectDatabaseError(tx, "deferred_escrow_binding", async () => {
      await tx.unsafe("set constraints all deferred;");
      await insertDatabaseTableTransaction(tx, fixture, {
        kind: "buyin",
        escrowAccountId: wrongEscrowId,
        keySuffix: "wrong-escrow",
      });
      await tx.unsafe("set constraints all immediate;");
    }, "P8904", /ESCROW table|authoritative ESCROW/);

    throw DB_ROLLBACK;
  }).catch((error) => {
    if (error !== DB_ROLLBACK) throw error;
  });
}

async function concurrencyInsertVersusClosePostgresContract(dbUrl) {
  const first = postgres(dbUrl, { max: 1, idle_timeout: 5 });
  const second = postgres(dbUrl, { max: 1, idle_timeout: 5 });
  try {
    await enableTableFence(first, true);
    const fixture = await createDatabaseTable(first);
    let releaseInsert;
    const insertHeld = new Promise((resolve) => { releaseInsert = resolve; });
    let inserted;
    const insertedReady = new Promise((resolve, reject) => {
      inserted = { resolve, reject };
    });
    const insertTransaction = first.begin(async (tx) => {
      try {
        await insertDatabaseTableTransaction(tx, fixture, { keySuffix: "race" });
        await tx.unsafe("set constraints all immediate;");
        inserted.resolve();
        await insertHeld;
      } catch (error) {
        inserted.reject(error);
        throw error;
      }
    });
    await insertedReady;

    const closeWhileInsertHolds = second.begin(async (tx) => {
      await tx.unsafe("set local lock_timeout = '150ms';");
      await tx.unsafe("update public.poker_tables set status = 'CLOSED' where id = $1::uuid;", [fixture.tableId]);
    });
    await assert.rejects(closeWhileInsertHolds, (error) => error?.code === "55P03", "close must not bypass the insert fence lock");
    releaseInsert();
    await insertTransaction;

    await second.unsafe("update public.poker_tables set status = 'CLOSED' where id = $1::uuid;", [fixture.tableId]);
    await assert.rejects(
      () => first.begin(async (tx) => insertDatabaseTableTransaction(tx, fixture, { keySuffix: "after-close" })),
      (error) => error?.code === "P8903",
      "a TABLE insert after the committed close must fail closed",
    );
    await enableTableFence(first, false);
  } finally {
    await first.end({ timeout: 5 });
    await second.end({ timeout: 5 });
  }
}

async function createTimedBotTable(sql, createdAt) {
  return sql.begin(async (tx) => {
    const fixture = await createDatabaseTable(tx);
    await insertDatabaseTableTransaction(tx, fixture, { kind: "buyin", createdAt, keySuffix: "buyin" });
    await insertDatabaseTableTransaction(tx, fixture, { kind: "cashout", createdAt, keySuffix: "cashout" });
    await tx.unsafe("set constraints all immediate;");
    await tx.unsafe("update public.poker_tables set status = 'CLOSED' where id = $1::uuid;", [fixture.tableId]);
    return fixture;
  });
}

async function ageBoundaryPostgresContract(sql) {
  await enableTableFence(sql, true);
  const now = Date.now();
  const cutoff = new Date(now - (7 * DAY_MS)).toISOString();
  const oldTable = await createTimedBotTable(sql, new Date(now - (10 * DAY_MS)).toISOString());
  const recentTable = await createTimedBotTable(sql, new Date(now - (6 * DAY_MS)).toISOString());
  const rows = await sql.unsafe(BOT_ONLY_CANDIDATE_SQL, [cutoff, 5000, null, null]);
  assert.equal(rows.length, 2, "the 10-day table should contribute its complete two-transaction batch");
  assert.deepEqual(new Set(rows.map((row) => row.table_id)), new Set([oldTable.tableId]));
  assert.equal(rows.some((row) => row.table_id === recentTable.tableId), false, "the 6-day table must remain untouched");
}

async function retryDestructiveOperatorPostgresContract(sql) {
  const now = Date.now();
  const cutoff = new Date(now - (7 * DAY_MS)).toISOString();
  const createdAt = new Date(now - (10 * DAY_MS)).toISOString();
  const fixture = await sql.begin(async (tx) => {
    const value = await createDatabaseTable(tx);
    const transaction = await insertDatabaseTableTransaction(tx, value, { createdAt, keySuffix: "retry" });
    await tx.unsafe("set constraints all immediate;");
    await tx.unsafe("update public.poker_tables set status = 'CLOSED' where id = $1::uuid;", [value.tableId]);
    return { ...value, transaction };
  });
  const transactionIds = [fixture.transaction.transactionId];
  const entryIds = fixture.transaction.entryIds;
  const registryKeys = [fixture.transaction.key];
  const hashes = await sql.unsafe(`
    select
      public.chips_archive_uuid_ids_sha256($1::uuid[]) as transaction_hash,
      public.chips_archive_bigint_ids_sha256($2::bigint[]) as entry_hash,
      public.chips_archive_text_ids_sha256($3::text[]) as registry_hash,
      public.chips_archive_text_ids_sha256(array[]::text[]) as empty_hash;
  `, [transactionIds, entryIds, registryKeys]);
  const hash = hashes[0];
  const compressedSha = "2".repeat(64);
  const objectPath = `v1/sha256/${compressedSha}.jsonl.gz`;
  const batchRows = await sql.unsafe(`
    insert into public.chips_ledger_archive_batches (
      object_path, project_ref, format_version, cutoff, cursor_end_created_at, cursor_end_id,
      first_created_at, last_created_at, transaction_count, entry_count, tx_types,
      raw_bytes, compressed_bytes, raw_sha256, compressed_sha256, credits, debits, net_amount,
      source_policy_id, bot_only_table_id, bot_only_table_count, bot_only_newest_created_at,
      bot_only_registry_keys_sha256, bot_only_out_of_scope_keys_sha256,
      bot_only_identity_count, bot_only_eligible_count, status, committed_at
    ) values (
      $1, 'krydukthwdvccggbyjfw', 2, $2::timestamptz, $3::timestamptz, $4::uuid,
      $3::timestamptz, $3::timestamptz, 1, 2, '{"TABLE_BUY_IN":1}'::jsonb,
      100, 80, $5, $6, 100, 100, 0,
      'stage-ledger-bot-only-retention-7d-v1', $7::uuid, 1, $3::timestamptz,
      $8, $9, 1, 1, 'committed', timezone('utc', now())
    ) returning batch_id::text;
  `, [
    objectPath,
    cutoff,
    createdAt,
    fixture.transaction.transactionId,
    "1".repeat(64),
    compressedSha,
    fixture.tableId,
    hash.registry_hash,
    hash.empty_hash,
  ]);
  const batchId = batchRows[0].batch_id;
  const gateDefinitions = await sql.unsafe(`
    select
      pg_get_functiondef('public.chips_assert_archive_prune_stage()'::regprocedure) as stage_definition,
      pg_get_functiondef('public.chips_assert_archive_prune_target(text,bigint)'::regprocedure) as target_definition;
  `);
  assert.ok(gateDefinitions[0]?.stage_definition && gateDefinitions[0]?.target_definition, "archive identity gates must exist");
  try {
    // The disposable database cannot have canonical Stage's physical identity.
    // Keep the production gates unchanged and replace them only for this test,
    // restoring both definitions in finally after exercising the operator.
    await sql.unsafe(`
      create or replace function public.chips_assert_archive_prune_stage()
      returns text language sql security definer set search_path = ''
      as $bot_only_test_stage$ select '7656985631720456337'::text $bot_only_test_stage$;
    `);
    await sql.unsafe(`
      create or replace function public.chips_assert_archive_prune_target(p_project_ref text, p_transaction_count bigint)
      returns text language plpgsql security definer set search_path = ''
      as $bot_only_test_target$
      begin
        if p_project_ref = 'krydukthwdvccggbyjfw' and p_transaction_count between 1 and 5000 then
          return '7656985631720456337';
        end if;
        raise exception 'test target gate rejected request';
      end
      $bot_only_test_target$;
    `);

    const proof = await sql.begin(async (tx) => {
      await tx.unsafe("set transaction isolation level serializable;");
      return tx.unsafe(`
        select public.chips_register_bot_only_archive_proof($1, $2::uuid[], $3::bigint[], $4::uuid, $5::text[]) as result;
      `, [objectPath, transactionIds, entryIds, fixture.tableId, registryKeys]);
    });
    assert.equal(proof[0].result.state, "proof_registered");
    const go = await sql.begin(async (tx) => {
      await tx.unsafe("set transaction isolation level serializable;");
      return tx.unsafe(
        "select public.chips_authorize_bot_only_archive_batch($1::bigint, $2) as result;",
        [batchId, `GO ${batchId}`],
      );
    });
    assert.equal(go[0].result.state, "authorized");

    const dry = await sql.begin(async (tx) => {
      await tx.unsafe("set transaction isolation level serializable;");
      return tx.unsafe(`
        select public.chips_prune_and_cleanup_bot_only_archive_batch(
          $1, $2::uuid[], $3::bigint[], $4::text[], $5::uuid, false, null
        ) as result;
      `, [objectPath, transactionIds, entryIds, registryKeys, fixture.tableId]);
    });
    assert.equal(dry[0].result.state, "ready", "prepare-only cleanup must validate without deleting");

    await sql.begin(async (tx) => {
      await tx.unsafe("set transaction isolation level serializable;");
      const execute = await tx.unsafe(`
        select public.chips_prune_and_cleanup_bot_only_archive_batch(
          $1, $2::uuid[], $3::bigint[], $4::text[], $5::uuid, true, $6::bigint
        ) as result;
      `, [objectPath, transactionIds, entryIds, registryKeys, fixture.tableId, batchId]);
      assert.equal(execute[0].result.state, "cleaned");
      const inTransaction = await tx.unsafe(`
        select
          (select count(*) from public.chips_transactions where id = $1::uuid) as hot_transactions,
          (select count(*) from public.chips_entries where id = any($2::bigint[])) as hot_entries,
          (select count(*) from public.chips_transaction_idempotency where idempotency_key = $3) as registry_rows,
          (select registry_cleaned_at from public.chips_ledger_archive_batches where batch_id = $4::bigint) as receipt_at;
      `, [transactionIds[0], entryIds, registryKeys[0], batchId]);
      assert.equal(Number(inTransaction[0].hot_transactions), 0);
      assert.equal(Number(inTransaction[0].hot_entries), 0);
      assert.equal(Number(inTransaction[0].registry_rows), 0);
      assert.ok(inTransaction[0].receipt_at);
      throw DB_ROLLBACK;
    }).catch((error) => {
      if (error !== DB_ROLLBACK) throw error;
    });

    const afterRollback = await sql.unsafe(`
      select
        (select count(*) from public.chips_transactions where id = $1::uuid) as hot_transactions,
        (select count(*) from public.chips_entries where id = any($2::bigint[])) as hot_entries,
        (select count(*) from public.chips_transaction_idempotency where idempotency_key = $3) as registry_rows,
        (select pruned_at from public.chips_ledger_archive_batches where batch_id = $4::bigint) as pruned_at,
        (select registry_cleaned_at from public.chips_ledger_archive_batches where batch_id = $4::bigint) as cleaned_at;
    `, [transactionIds[0], entryIds, registryKeys[0], batchId]);
    assert.equal(Number(afterRollback[0].hot_transactions), 1, "rollback must restore the hot transaction");
    assert.equal(Number(afterRollback[0].hot_entries), 2, "rollback must restore both hot entries");
    assert.equal(Number(afterRollback[0].registry_rows), 1, "rollback must restore the registry row");
    assert.equal(afterRollback[0].pruned_at, null, "rollback must restore the prune receipt");
    assert.equal(afterRollback[0].cleaned_at, null, "rollback must restore the cleanup receipt");

    const execute = await sql.begin(async (tx) => {
      await tx.unsafe("set transaction isolation level serializable;");
      return tx.unsafe(`
        select public.chips_prune_and_cleanup_bot_only_archive_batch(
          $1, $2::uuid[], $3::bigint[], $4::text[], $5::uuid, true, $6::bigint
        ) as result;
      `, [objectPath, transactionIds, entryIds, registryKeys, fixture.tableId, batchId]);
    });
    assert.equal(execute[0].result.state, "cleaned");
    const retry = await sql.begin(async (tx) => {
      await tx.unsafe("set transaction isolation level serializable;");
      return tx.unsafe(`
        select public.chips_prune_and_cleanup_bot_only_archive_batch(
          $1, $2::uuid[], $3::bigint[], $4::text[], $5::uuid, true, $6::bigint
        ) as result;
      `, [objectPath, transactionIds, entryIds, registryKeys, fixture.tableId, batchId]);
    });
    assert.equal(retry[0].result.state, "already_cleaned", "a retry must be idempotent after cleanup receipt commit");
  } finally {
    await sql.unsafe(gateDefinitions[0].stage_definition);
    await sql.unsafe(gateDefinitions[0].target_definition);
  }
}

async function runPostgresFundamentalContracts() {
  const sql = postgres(POSTGRES_TEST_DB_URL, { max: 1, idle_timeout: 5 });
  try {
    const databaseRows = await sql`select current_database() as name;`;
    assert.ok(/(?:_test|reset_contract)$/i.test(databaseRows[0]?.name || ""), "bot-only PostgreSQL tests require a disposable database");
    await historicalKeyAndEntryBindingPostgresContract(sql);
    await concurrencyInsertVersusClosePostgresContract(POSTGRES_TEST_DB_URL);
    await ageBoundaryPostgresContract(sql);
    await retryDestructiveOperatorPostgresContract(sql);
    process.stdout.write("chips-ledger-bot-only-retention PostgreSQL four fundamental contracts passed\n");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

historicalKeyAndEntryBindingContract();
concurrencyAndScopeContract();
failClosedLifecycleContract();
retryAndAccountingContract();

if (POSTGRES_TEST_DB_URL) {
  await runPostgresFundamentalContracts();
}

process.stdout.write("chips-ledger-bot-only-retention four fundamental contracts passed\n");
