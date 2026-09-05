import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import fs from "node:fs";
import postgres from "postgres";

import {
  BOT_ONLY_BLOCKING_ANOMALY_SQL,
  BOT_ONLY_CANDIDATE_SQL,
  buildArchiveBytes,
  buildExportRecord,
  buildManifest,
  evaluateTableEligibility,
  validateBatch,
} from "../../scripts/ops/chips-ledger-archive-export.mjs";
import {
  buildPruneEvidence,
  buildRecoveryManifest,
  createPruneStore,
} from "../../scripts/ops/chips-ledger-archive-prune.mjs";
import { verifyArchiveBytes } from "../../scripts/ops/chips-ledger-archive-store.mjs";
import {
  assertTableBinding,
  parseTableReference,
  parseTableIdempotencyKey,
} from "../../scripts/ops/_shared/chips-table-idempotency.mjs";
import { validateStageEnvironment } from "../../scripts/ops/chips-ledger-stage-automation.mjs";

const migration = fs.readFileSync("supabase/migrations/20260818100000_chips_ledger_bot_only_retention.sql", "utf8");
const lifecycleGateMigration = fs.readFileSync("supabase/migrations/20260826100000_chips_ledger_bot_only_lifecycle_gate_scope.sql", "utf8");
const proofPerformanceMigration = fs.readFileSync("supabase/migrations/20260905160000_chips_ledger_bot_only_proof_perf.sql", "utf8");
const proofPerformanceFixMigration = fs.readFileSync("supabase/migrations/20260905161000_chips_ledger_bot_only_proof_perf_fix.sql", "utf8");
const proofAccessPathMigration = fs.readFileSync("supabase/migrations/20260905170000_chips_ledger_retention_access_paths.sql", "utf8");
const closedTableCleanup = fs.readFileSync("ws-server/poker/persistence/closed-table-cleanup.mjs", "utf8");

const TABLE_ID = "00000000-0000-4000-8000-000000000020";
const TX_ID = "00000000-0000-4000-8000-000000000021";
const SYSTEM_ID = "00000000-0000-4000-8000-000000000022";
const ESCROW_ID = "00000000-0000-4000-8000-000000000023";
const KEY = `bot-seed-buyin:${TABLE_ID}:1`;
const LEGACY_SELECTOR_TABLE_ID = "00000000-0000-4000-8000-000000000100";
const INVALID_MARKER_MISMATCH_TABLE_ID = "00000000-0000-4000-8000-000000000098";
const INVALID_MARKER_MALFORMED_TABLE_ID = "00000000-0000-4000-8000-000000000097";
const UNKNOWN_SCOPE_INDEPENDENT_TABLE_ID = "00000000-0000-4000-8000-000000000099";
const UNKNOWN_SCOPE_TARGET_TABLE_ID = "00000000-0000-4000-8000-000000000102";
const UNKNOWN_SCOPE_ORPHAN_TABLE_ID = "00000000-0000-4000-8000-000000000103";
const PERFORMANCE_REGISTRY_ROW_COUNT = 65000;
const PERFORMANCE_UNKNOWN_TABLE_ROW_COUNT = 2052;

const REFERENCE_CANDIDATE_IDS_SQL = `
with normalized as (
  select transactions.*,
         case
           when transactions.metadata is not null
             and jsonb_typeof(transactions.metadata) = 'object'
             then transactions.metadata
           when transactions.metadata is not null
             and jsonb_typeof(transactions.metadata) = 'string'
             and pg_catalog.pg_input_is_valid(transactions.metadata #>> '{}', 'jsonb'::text)
             then (transactions.metadata #>> '{}')::jsonb
           else null::jsonb
         end as normalized_metadata
    from public.chips_transactions transactions
   where transactions.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
), table_stats as (
  select registry.table_id,
         max(registry.transaction_created_at) as newest_created_at,
         count(*)::bigint as identity_count,
         count(*) filter (
           where registry.user_id is null
             and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
             and registry.transaction_created_at < $1::timestamptz
             and registry.archive_batch_id is null
         )::bigint as eligible_count
    from public.chips_transaction_idempotency registry
   where registry.table_id is not null
   group by registry.table_id
), eligible as (
  select transactions.id,
         transactions.created_at,
         transactions.tx_type,
         registry.table_id,
         stats.newest_created_at,
         stats.identity_count,
         stats.eligible_count,
         tables.status::text as table_status,
         tables.has_human_participant,
         tables.bot_only_proof_eligible,
         escrow.status::text as escrow_status,
         escrow.balance as escrow_balance,
         count(entries.id) as entry_count,
         count(*) filter (where accounts.account_type::text = 'USER') as user_entry_count,
         count(*) filter (where accounts.account_type::text = 'SYSTEM') as system_entry_count,
         count(*) filter (where accounts.account_type::text = 'ESCROW') as escrow_entry_count,
         count(*) filter (
           where accounts.account_type::text = 'ESCROW'
             and accounts.system_key = 'POKER_TABLE:' || registry.table_id::text
         ) as matching_escrow_count,
         bool_and(accounts.status::text = 'active') as all_entries_active,
         sum(entries.amount) as net_amount,
         sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM') as system_amount,
         sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW') as escrow_amount
    from normalized transactions
    join public.chips_transaction_idempotency registry
      on registry.idempotency_key = transactions.idempotency_key
     and registry.transaction_id = transactions.id
     and registry.payload_hash = transactions.payload_hash
     and registry.tx_type = transactions.tx_type
     and registry.user_id is not distinct from transactions.user_id
     and registry.transaction_created_at = transactions.created_at
     and registry.table_id is not null
     and registry.key_format_version = 1
     and registry.key_format = (public.chips_parse_table_idempotency_key(transactions.idempotency_key)->>'format')
     and registry.archive_batch_id is null
    join table_stats stats on stats.table_id = registry.table_id
    join public.poker_tables tables on tables.id = registry.table_id
    join public.chips_accounts escrow
      on escrow.account_type::text = 'ESCROW'
     and escrow.system_key = 'POKER_TABLE:' || registry.table_id::text
    join public.chips_entries entries on entries.transaction_id = transactions.id
    join public.chips_accounts accounts on accounts.id = entries.account_id
   where transactions.created_at < $1::timestamptz
     and transactions.user_id is null
     and transactions.metadata is not null
     and jsonb_typeof(transactions.metadata) in ('object', 'string')
     and jsonb_typeof(transactions.normalized_metadata) = 'object'
     and (
       not (transactions.normalized_metadata ? 'tableId')
       or (
         nullif(btrim(transactions.normalized_metadata->>'tableId'), '') is not null
         and nullif(btrim(transactions.normalized_metadata->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         and lower(btrim(transactions.normalized_metadata->>'tableId')) = registry.table_id::text
       )
     )
     and (
       transactions.reference is null
       or (
         transactions.reference ~* '^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):'
         and nullif(btrim(split_part(transactions.reference, ':', 2)), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         and lower(btrim(split_part(transactions.reference, ':', 2))) = registry.table_id::text
       )
     )
     and tables.status::text = 'CLOSED'
     and tables.has_human_participant is false
     and tables.bot_only_proof_eligible is true
     and escrow.status::text = 'active'
     and escrow.balance = 0
     and stats.newest_created_at < $1::timestamptz
     and stats.eligible_count > 0
     and stats.eligible_count <= $2::int
   group by transactions.id, transactions.created_at, transactions.tx_type,
            registry.table_id, stats.newest_created_at, stats.identity_count,
            stats.eligible_count, tables.status, tables.has_human_participant,
            tables.bot_only_proof_eligible, escrow.status, escrow.balance
  having count(*) = 2
     and count(*) filter (where accounts.account_type::text = 'USER') = 0
     and count(*) filter (where accounts.account_type::text = 'SYSTEM') = 1
     and count(*) filter (where accounts.account_type::text = 'ESCROW') = 1
     and count(*) filter (
       where accounts.account_type::text = 'ESCROW'
         and accounts.system_key = 'POKER_TABLE:' || registry.table_id::text
     ) = 1
     and bool_and(accounts.status::text = 'active')
     and sum(entries.amount) = 0
     and (
       (transactions.tx_type::text = 'TABLE_BUY_IN'
        and sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM') < 0
        and sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW') > 0)
       or
       (transactions.tx_type::text = 'TABLE_CASH_OUT'
        and sum(entries.amount) filter (where accounts.account_type::text = 'ESCROW') < 0
        and sum(entries.amount) filter (where accounts.account_type::text = 'SYSTEM') > 0)
     )
), selected_table as (
  select table_id
    from eligible
   group by table_id
   having count(*) = max(eligible_count)
   order by table_id
   limit 1
)
select eligible.id::text as id,
       eligible.table_id::text as table_id
  from eligible
  join selected_table on selected_table.table_id = eligible.table_id
 order by eligible.created_at asc, eligible.id asc;
`;

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

function collectExplainPlanNodes(plan, nodes = []) {
  if (!plan || typeof plan !== "object") return nodes;
  if (plan["Node Type"]) nodes.push(plan);
  for (const child of plan.Plans || []) collectExplainPlanNodes(child, nodes);
  return nodes;
}

function explainPlanRoot(rows) {
  const payload = rows[0]?.["QUERY PLAN"] || rows[0]?.["query plan"];
  return payload?.[0]?.Plan || null;
}

function historicalKeyAndEntryBindingContract() {
  assert.match(BOT_ONLY_CANDIDATE_SQL, /pg_catalog\.pg_input_is_valid/);
  assert.match(BOT_ONLY_CANDIDATE_SQL, /unknown_target_identity/);
  assert.doesNotMatch(
    BOT_ONLY_CANDIDATE_SQL,
    /from public\.chips_transaction_idempotency unknown\s+where unknown\.tx_type::text in \('TABLE_BUY_IN', 'TABLE_CASH_OUT'\)\s+and unknown\.table_id is null\s+\)/,
  );
  assert.match(BOT_ONLY_BLOCKING_ANOMALY_SQL, /transactions\.normalized_metadata/);
  assert.match(BOT_ONLY_BLOCKING_ANOMALY_SQL, /entry_shapes\.user_id is null/);

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
  assert.match(migration, /revoke all on function public\.chips_authorize_bot_only_archive_batch\(bigint, text\) from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.chips_authorize_bot_only_archive_batch\(bigint, text\) to postgres/);
  assert.match(migration, /source_policy_id <> 'stage-ledger-bot-only-retention-7d-v1'/);
  assert.match(migration, /Production authorization|canonical Stage schema-v2 batch/);
  assert.match(closedTableCleanup, /has_human_participant is true and t\.human_retention_complete_at is not null/);
  assert.match(closedTableCleanup, /has_human_participant is not true and t\.bot_only_retention_complete_at is not null/);
  assertThrowsMessage(() => validateStageEnvironment({
    SUPABASE_STAGE_DB_URL: "postgresql://postgres.krydukthwdvccggbyjfw@db.krydukthwdvccggbyjfw.supabase.co:5432/postgres",
    SUPABASE_STAGE_URL: "https://krydukthwdvccggbyjfw.supabase.co",
    SUPABASE_STAGE_SERVICE_ROLE_KEY: "stage-test",
    GITHUB_SHA: "f".repeat(40),
    SUPABASE_PROD_DB_URL: "forbidden",
  }), /Production credentials/);
}

function lifecycleGateScopeContract() {
  assert.match(lifecycleGateMigration, /create or replace function public\.chips_assert_bot_only_table_lifecycle_gate\(/);
  assert.match(lifecycleGateMigration, /language plpgsql\s+set search_path = ''/);
  assert.match(lifecycleGateMigration, /begin;[\s\S]*grant chips_ledger_archive_pruner to postgres;[\s\S]*set role chips_ledger_archive_pruner;/);
  assert.match(lifecycleGateMigration, /reset role;[\s\S]*revoke create on schema public from chips_ledger_archive_pruner;[\s\S]*revoke chips_ledger_archive_pruner from postgres;[\s\S]*commit;/);
  assert.match(lifecycleGateMigration, /pg_catalog\.pg_input_is_valid/);
  assert.match(lifecycleGateMigration, /unknown_registry_identity_evidence/);
  assert.match(lifecycleGateMigration, /hot_identity_evidence/);
  assert.match(lifecycleGateMigration, /accounts\.system_key ~\* '\^POKER_TABLE:/);
  assert.doesNotMatch(lifecycleGateMigration, /chips_parse_table_idempotency_key/);
  assert.doesNotMatch(lifecycleGateMigration, /\b(?:alter|grant|revoke)\s+(?:function|all)/i);
}

function proofPerformanceContract() {
  assert.match(proofPerformanceMigration, /create index if not exists chips_transaction_idempotency_table_id_idx[\s\S]*where table_id is not null/i);
  assert.match(proofPerformanceMigration, /create or replace function public\.chips_assert_bot_only_archive_proof_lifecycle_gate\(/);
  assert.match(proofPerformanceMigration, /p_transaction_ids uuid\[\][\s\S]*p_registry_keys text\[\]/);
  assert.match(proofPerformanceMigration, /target_transactions/);
  assert.match(proofPerformanceMigration, /target_transaction_evidence/);
  assert.match(proofPerformanceMigration, /unknown_registry_identity_evidence/);
  assert.match(proofPerformanceMigration, /hot_identity_evidence/);
  assert.match(proofPerformanceMigration, /chips_register_bot_only_archive_proof\(text,uuid\[\],bigint\[\],uuid,text\[\]\)/);
  assert.match(proofPerformanceMigration, /p_transaction_ids, sorted_registry_keys/);
  assert.doesNotMatch(proofPerformanceMigration, /set local statement_timeout/i);
  assert.doesNotMatch(proofPerformanceMigration, /registry_rows as materialized/);
  assert.doesNotMatch(proofPerformanceMigration, /table_transactions as materialized/);
  assert.match(proofPerformanceMigration, /raise exception using errcode = 'P8914'/);
  assert.match(proofPerformanceFixMigration, /chips_assert_bot_only_archive_proof_lifecycle_gate\(uuid,bigint,timestamptz,uuid\[\],text\[\]\)/);
  assert.match(proofPerformanceFixMigration, /unknown\.idempotency_key/);
  assert.match(proofPerformanceFixMigration, /unknown\.identity_key/);
  assert.match(proofPerformanceFixMigration, /refusing forward correction/);
  assert.match(proofAccessPathMigration, /CREATE OR REPLACE FUNCTION public\.chips_assert_bot_only_archive_proof_lifecycle_gate/i);
  assert.match(proofAccessPathMigration, /candidate_transaction_ids as \(/);
  assert.match(proofAccessPathMigration, /transactions\.id = any\(coalesce\(p_transaction_ids/);
  assert.match(proofAccessPathMigration, /registry\.table_id = p_table_id/);
  assert.match(proofAccessPathMigration, /registry\.table_id is null/);
  assert.match(proofAccessPathMigration, /entries\.transaction_id/);
  assert.match(proofAccessPathMigration, /from candidate_transaction_ids candidates\s+join public\.chips_transactions transactions on transactions\.id = candidates\.id/s);
  assert.match(proofAccessPathMigration, /chips_transactions_bot_proof_idempotency_prefix_idx/);
  assert.match(proofAccessPathMigration, /chips_transactions_bot_proof_reference_prefix_idx/);
  assert.match(proofAccessPathMigration, /chips_transactions_bot_proof_metadata_table_id_idx/);
  assert.match(proofAccessPathMigration, /chips_bot_proof_metadata_table_id\(p_metadata jsonb\)[\s\S]*?immutable/);
  assert.match(proofAccessPathMigration, /chips_bot_proof_metadata_table_id\(metadata\)/);
  assert.doesNotMatch(proofAccessPathMigration, /set local statement_timeout/i);
  const replacement = proofAccessPathMigration.match(/replacement text := \$replacement\$([\s\S]*?)\$replacement\$/)?.[1] || "";
  assert.ok((replacement.match(/\bunion\b/gi) || []).length >= 8, "candidate evidence must be unioned and deduplicated in PostgreSQL");
  assert.doesNotMatch(replacement, /target_transactions\s+as\s*\([\s\S]*?from public\.chips_transactions transactions[\s\S]*?transactions\.id = any[\s\S]*?\bor\b[\s\S]*?public\.chips_entries/s);
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

async function createDatabaseTable(tx, status = "OPEN", tableIdOverride = null) {
  const tableId = tableIdOverride || randomUUID();
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
  const legacyMetadata = typeof metadata === "string";
  const metadataSql = legacyMetadata ? "to_jsonb($3::text)" : "$3::jsonb";
  const metadataValue = legacyMetadata ? metadata : JSON.stringify(metadata);
  await tx.unsafe(`
    insert into public.chips_transactions
      (id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id, created_at)
    values ($1::uuid, $2, ${metadataSql}, $4, $5, $6, null, $7::timestamptz);
  `, [
    transactionId,
    transactionReference,
    metadataValue,
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

async function insertUnsupportedDatabaseTableTransaction(tx, fixture, {
  kind = "buyin",
  createdAt,
  metadata = {},
  reference = null,
  keySuffix = randomUUID(),
} = {}) {
  const transactionId = randomUUID();
  const amount = 100;
  const isBuyIn = kind === "buyin";
  const transactionType = isBuyIn ? "TABLE_BUY_IN" : "TABLE_CASH_OUT";
  const key = `legacy-unsupported-${kind}:${keySuffix}`;
  const payloadHash = "d".repeat(64);
  await tx.unsafe(`
    insert into public.chips_transactions
      (id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id, created_at)
    values ($1::uuid, $2, $3::jsonb, $4, $5, $6, null, $7::timestamptz);
  `, [
    transactionId,
    reference,
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
  `, [transactionId, fixture.systemAccountId, systemAmount, fixture.escrowAccountId, escrowAmount]);
  return {
    transactionId,
    entryIds: entryRows.map((row) => String(row.id)),
    key,
  };
}

async function insertUnknownDatabaseTableTransaction(tx, {
  key,
  createdAt,
  metadata = {},
  reference = null,
} = {}) {
  const transactionId = randomUUID();
  const legacyMetadata = typeof metadata === "string";
  const metadataSql = legacyMetadata ? "to_jsonb($3::text)" : "$3::jsonb";
  const metadataValue = legacyMetadata ? metadata : JSON.stringify(metadata);
  await tx.unsafe(`
    insert into public.chips_transactions
      (id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id, created_at)
    values ($1::uuid, $2, ${metadataSql}, $4, $5, 'TABLE_BUY_IN', null, $6::timestamptz);
  `, [
    transactionId,
    reference,
    metadataValue,
    key,
    "f".repeat(64),
    createdAt || new Date().toISOString(),
  ]);
  return { transactionId, key };
}

async function insertUnknownDatabaseRegistryRow(tx, {
  key,
  createdAt,
  transactionId = randomUUID(),
} = {}) {
  await tx.unsafe(`
    insert into public.chips_transaction_idempotency
      (idempotency_key, transaction_id, payload_hash, tx_type, user_id, transaction_created_at)
    values ($1, $2::uuid, $3, 'TABLE_BUY_IN', null, $4::timestamptz);
  `, [key, transactionId, "e".repeat(64), createdAt || new Date().toISOString()]);
  return { transactionId, key };
}

async function insertMissingRegistryDatabaseTableTransaction(tx, {
  key,
  createdAt,
  metadata = {},
  reference = null,
} = {}) {
  const transactionId = randomUUID();
  const legacyMetadata = typeof metadata === "string";
  const metadataSql = legacyMetadata ? "to_jsonb($3::text)" : "$3::jsonb";
  const metadataValue = legacyMetadata ? metadata : JSON.stringify(metadata);
  await tx.unsafe("set local session_replication_role = 'replica';");
  await tx.unsafe(`
    insert into public.chips_transactions
      (id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id, created_at)
    values ($1::uuid, $2, ${metadataSql}, $4, $5, 'TABLE_BUY_IN', null, $6::timestamptz);
  `, [
    transactionId,
    reference,
    metadataValue,
    key,
    "d".repeat(64),
    createdAt || new Date().toISOString(),
  ]);
  await tx.unsafe("set local session_replication_role = 'origin';");
  return { transactionId, key };
}

async function insertBotOnlyLifecycleBatch(tx, fixture, transaction, cutoff) {
  const transactionIds = [transaction.transactionId];
  const entryIds = transaction.entryIds;
  const registryKeys = [transaction.key];
  const hashes = await tx.unsafe(`
    select
      public.chips_archive_uuid_ids_sha256($1::uuid[]) as transaction_hash,
      public.chips_archive_bigint_ids_sha256($2::bigint[]) as entry_hash,
      public.chips_archive_text_ids_sha256($3::text[]) as registry_hash,
      public.chips_archive_text_ids_sha256(array[]::text[]) as empty_hash;
  `, [transactionIds, entryIds, registryKeys]);
  const hash = hashes[0];
  const objectPath = `v1/sha256/${"2".repeat(64)}.jsonl.gz`;
  const rows = await tx.unsafe(`
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
    transaction.createdAt,
    transaction.transactionId,
    "1".repeat(64),
    "2".repeat(64),
    fixture.tableId,
    hash.registry_hash,
    hash.empty_hash,
  ]);
  return {
    batchId: rows[0].batch_id,
    objectPath,
    transactionIds,
    entryIds,
    registryKeys,
  };
}

async function overrideArchiveIdentityGates(tx) {
  await tx.unsafe(`
    create or replace function public.chips_assert_archive_prune_stage()
    returns text language sql security definer set search_path = ''
    as $bot_only_scope_test_stage$ select '7656985631720456337'::text $bot_only_scope_test_stage$;
  `);
  await tx.unsafe(`
    create or replace function public.chips_assert_archive_prune_target(p_project_ref text, p_transaction_count bigint)
    returns text language plpgsql security definer set search_path = ''
    as $bot_only_scope_test_target$
    begin
      if p_project_ref = 'krydukthwdvccggbyjfw' and p_transaction_count between 1 and 5000 then
        return '7656985631720456337';
      end if;
      raise exception 'test target gate rejected request';
    end
    $bot_only_scope_test_target$;
  `);
}

async function insertHumanUserEscrowTransaction(tx, fixture, { createdAt } = {}) {
  const userId = randomUUID();
  await tx.unsafe("insert into auth.users (id) values ($1::uuid);", [userId]);
  const userAccountId = randomUUID();
  await tx.unsafe(`
    insert into public.chips_accounts (id, user_id, account_type, status, balance)
    values ($1::uuid, $2::uuid, 'USER', 'active', 0);
  `, [userAccountId, userId]);
  const transactionId = randomUUID();
  const key = `join-buyin:${fixture.tableId}:${randomUUID()}`;
  await tx.unsafe(`
    insert into public.chips_transactions
      (id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id, created_at)
    values ($1::uuid, $2, $3::jsonb, $4, $5, 'TABLE_BUY_IN', $6::uuid, $7::timestamptz);
  `, [
    transactionId,
    `table:${fixture.tableId}`,
    JSON.stringify({ tableId: fixture.tableId }),
    key,
    "e".repeat(64),
    userId,
    createdAt || new Date().toISOString(),
  ]);
  await tx.unsafe(`
    insert into public.chips_entries (transaction_id, account_id, amount, metadata)
    values
      ($1::uuid, $2::uuid, -100, '{}'::jsonb),
      ($1::uuid, $3::uuid, 100, '{}'::jsonb);
  `, [transactionId, userAccountId, fixture.escrowAccountId]);
  return { transactionId, userId, userAccountId };
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
    const baselineAccounting = await readAccountingSnapshot(
      tx,
      [fixture.systemAccountId, fixture.escrowAccountId],
      [valid.transactionId],
    );
    const assertNoBindingEffects = async (label) => {
      const counts = await tx.unsafe(`
        select
          (select count(*) from public.chips_transactions where id = $1::uuid) as transactions,
          (select count(*) from public.chips_entries where transaction_id = $1::uuid) as entries,
          (select count(*) from public.chips_transaction_idempotency where idempotency_key = $2) as registry_rows;
      `, [valid.transactionId, valid.key]);
      assert.equal(Number(counts[0].transactions), 1, `${label}: valid transaction must remain the only committed fixture transaction`);
      assert.equal(Number(counts[0].entries), 2, `${label}: invalid binding must not add entries`);
      assert.equal(Number(counts[0].registry_rows), 1, `${label}: invalid binding must not add registry rows`);
      const accounting = await readAccountingSnapshot(
        tx,
        [fixture.systemAccountId, fixture.escrowAccountId],
        [valid.transactionId],
      );
      assert.deepEqual(accounting.accounts, baselineAccounting.accounts, `${label}: balances and next_entry_seq must be unchanged`);
      assert.equal(accounting.accountBalanceTotal, baselineAccounting.accountBalanceTotal, `${label}: account total must be unchanged`);
      assert.equal(accounting.conservation, baselineAccounting.conservation, `${label}: conservation must be unchanged`);
    };

    await expectDatabaseError(tx, "null_metadata_marker", async () => {
      await tx.unsafe(`
        insert into public.chips_transactions
          (id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id)
        values ($1::uuid, $2, '{"tableId":null}'::jsonb, $3, $4, 'TABLE_BUY_IN', null);
      `, [randomUUID(), `BOT_SEED_BUY_IN:${fixture.tableId}:1`, `bot-seed-buyin:${fixture.tableId}:bad-meta-${randomUUID()}`, "b".repeat(64)]);
    }, "P8902", /metadata\.tableId|metadata/);
    await assertNoBindingEffects("null metadata marker");

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
    await assertNoBindingEffects("unknown reference marker");

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
    await assertNoBindingEffects("deferred ESCROW binding");

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

async function createTimedBotTable(sql, createdAt, secondCreatedAt = createdAt) {
  return sql.begin(async (tx) => {
    const fixture = await createDatabaseTable(tx);
    await insertDatabaseTableTransaction(tx, fixture, { kind: "buyin", createdAt, keySuffix: "buyin" });
    await insertDatabaseTableTransaction(tx, fixture, { kind: "cashout", createdAt: secondCreatedAt, keySuffix: "cashout" });
    await tx.unsafe("set constraints all immediate;");
    await tx.unsafe("update public.poker_tables set status = 'CLOSED' where id = $1::uuid;", [fixture.tableId]);
    return fixture;
  });
}

async function ageBoundaryPostgresContract(sql) {
  await enableTableFence(sql, true);
  const now = Date.now();
  const cutoff = new Date(now - (7 * DAY_MS)).toISOString();
  const mixedTable = await createTimedBotTable(
    sql,
    new Date(now - (10 * DAY_MS)).toISOString(),
    new Date(now - (6 * DAY_MS)).toISOString(),
  );
  const rows = await sql.unsafe(BOT_ONLY_CANDIDATE_SQL, [cutoff, 5000, null, null]);
  assert.equal(rows.length, 0, "a table with 10-day and 6-day identities must remain untouched");
  const mixedIdentitySummary = await sql.unsafe(`
    select
      count(*)::text as identity_count,
      count(*) filter (where transaction_created_at < $2::timestamptz)::text as eligible_count,
      max(transaction_created_at)::text as newest_created_at
      from public.chips_transaction_idempotency
     where table_id = $1::uuid
       and archive_batch_id is null;
  `, [mixedTable.tableId, cutoff]);
  assert.equal(Number(mixedIdentitySummary[0].identity_count), 2, "the mixed table must retain both registry identities");
  assert.equal(Number(mixedIdentitySummary[0].eligible_count), 1, "only the older mixed-table identity is beyond the cutoff");
  assert.ok(
    new Date(mixedIdentitySummary[0].newest_created_at).getTime() >= new Date(cutoff).getTime(),
    "the mixed table newest identity must remain at or after the cutoff",
  );
  const blockers = await sql.unsafe(BOT_ONLY_BLOCKING_ANOMALY_SQL, [cutoff, 5000]);
  const youngerBlocker = blockers.find((row) => row.blocker_code === "younger_table_identity");
  assert.ok(
    youngerBlocker && Number(youngerBlocker.table_count) > 0 && Number(youngerBlocker.transaction_count) >= 2,
    `the mixed-age table must report the younger identity as a blocking anomaly: ${JSON.stringify(blockers)}`,
  );

  const youngerCrossedCutoff = new Date(now - (5 * DAY_MS)).toISOString();
  const eligibleAfterCrossing = await sql.unsafe(BOT_ONLY_CANDIDATE_SQL, [youngerCrossedCutoff, 5000, null, null]);
  assert.equal(eligibleAfterCrossing.length, 2, "the complete table becomes eligible only after the younger identity crosses seven days");
  assert.deepEqual(new Set(eligibleAfterCrossing.map((row) => row.table_id)), new Set([mixedTable.tableId]));
}

async function archiveSelectorHistoricalIdentityAndMetadataPostgresContract(sql) {
  const scopeTableIds = [];
  const scopeTransactions = [];
  const legacyMetadataText = (tableId) => JSON.stringify({ tableId });
  let rolledBack = false;

  await sql.begin(async (tx) => {
    await enableTableFence(tx, true);
    const now = Date.now();
    const cutoff = new Date(now - (7 * DAY_MS)).toISOString();
    const createdAt = new Date(now - (10 * DAY_MS)).toISOString();
    const rememberTable = (fixture) => {
      scopeTableIds.push(fixture.tableId);
      return fixture;
    };
    const rememberTransaction = (transaction) => {
      scopeTransactions.push(transaction);
      return transaction;
    };

    const legacyTable = rememberTable(await createDatabaseTable(tx, "OPEN", LEGACY_SELECTOR_TABLE_ID));
    rememberTransaction(await insertDatabaseTableTransaction(tx, legacyTable, {
      kind: "buyin",
      createdAt,
      metadata: legacyMetadataText(legacyTable.tableId),
      keySuffix: "legacy-buyin",
    }));
    rememberTransaction(await insertDatabaseTableTransaction(tx, legacyTable, {
      kind: "cashout",
      createdAt,
      metadata: legacyMetadataText(legacyTable.tableId),
      keySuffix: "legacy-cashout",
    }));
    await tx.unsafe("set constraints all immediate;");
    await tx.unsafe("set constraints all deferred;");
    await tx.unsafe("update public.poker_tables set status = 'CLOSED' where id = $1::uuid;", [legacyTable.tableId]);

    const legacyKeys = [
      `bot-seed-buyin:${legacyTable.tableId}:legacy-buyin`,
      `poker:bot-terminal-cashout:v1:${legacyTable.tableId}:legacy-cashout`,
    ];
    const legacyMetadataProof = await tx.unsafe(`
      select
        jsonb_typeof(metadata) as metadata_type,
        jsonb_typeof((metadata #>> '{}')::jsonb) as unpacked_type,
        ((metadata #>> '{}')::jsonb ->> 'tableId') as metadata_table_id
        from public.chips_transactions
       where idempotency_key = any($1::text[])
       order by idempotency_key;
    `, [legacyKeys]);
    assert.deepEqual([...legacyMetadataProof], [
      { metadata_type: "string", unpacked_type: "object", metadata_table_id: legacyTable.tableId },
      { metadata_type: "string", unpacked_type: "object", metadata_table_id: legacyTable.tableId },
    ], "legacy fixture must be one JSONB string containing one JSON object");

    const independent = rememberTable(await createDatabaseTable(tx, "OPEN", UNKNOWN_SCOPE_INDEPENDENT_TABLE_ID));
    rememberTransaction(await insertDatabaseTableTransaction(tx, independent, { kind: "buyin", createdAt, keySuffix: "known-buyin" }));
    rememberTransaction(await insertDatabaseTableTransaction(tx, independent, { kind: "cashout", createdAt, keySuffix: "known-cashout" }));

    const target = rememberTable(await createDatabaseTable(tx, "OPEN", UNKNOWN_SCOPE_TARGET_TABLE_ID));
    rememberTransaction(await insertDatabaseTableTransaction(tx, target, { kind: "buyin", createdAt, keySuffix: "known-buyin" }));
    rememberTransaction(await insertDatabaseTableTransaction(tx, target, { kind: "cashout", createdAt, keySuffix: "known-cashout" }));
    await tx.unsafe("set constraints all immediate;");
    await tx.unsafe("set constraints all deferred;");
    await tx.unsafe(`
      update public.poker_tables
         set status = 'CLOSED'
       where id = any($1::uuid[]);
    `, [[independent.tableId, target.tableId]]);

    const mismatch = rememberTable(await createDatabaseTable(tx, "OPEN", INVALID_MARKER_MISMATCH_TABLE_ID));
    const malformed = rememberTable(await createDatabaseTable(tx, "OPEN", INVALID_MARKER_MALFORMED_TABLE_ID));
    const orphan = rememberTable(await createDatabaseTable(tx, "OPEN", UNKNOWN_SCOPE_ORPHAN_TABLE_ID));

    await enableTableFence(tx, false);
    const mismatchMetadata = legacyMetadataText(UNKNOWN_SCOPE_TARGET_TABLE_ID);
    rememberTransaction(await insertDatabaseTableTransaction(tx, mismatch, {
      kind: "buyin",
      createdAt,
      metadata: mismatchMetadata,
      keySuffix: "legacy-mismatch-buyin",
    }));
    rememberTransaction(await insertDatabaseTableTransaction(tx, mismatch, {
      kind: "cashout",
      createdAt,
      metadata: mismatchMetadata,
      keySuffix: "legacy-mismatch-cashout",
    }));
    const malformedMetadata = '{"tableId":';
    rememberTransaction(await insertDatabaseTableTransaction(tx, malformed, {
      kind: "buyin",
      createdAt,
      metadata: malformedMetadata,
      keySuffix: "legacy-malformed-buyin",
    }));
    rememberTransaction(await insertDatabaseTableTransaction(tx, malformed, {
      kind: "cashout",
      createdAt,
      metadata: malformedMetadata,
      keySuffix: "legacy-malformed-cashout",
    }));
    const blockersBeforeUnknownReference = await tx.unsafe(BOT_ONLY_BLOCKING_ANOMALY_SQL, [cutoff, 5000]);
    const invalidMarkerBeforeUnknownReference = Number(
      blockersBeforeUnknownReference.find((row) => row.blocker_code === "invalid_marker")?.transaction_count || 0,
    );
    assert.equal(invalidMarkerBeforeUnknownReference, 4, "mismatch and malformed metadata establish the invalid_marker baseline");
    const linked = rememberTransaction(await insertUnsupportedDatabaseTableTransaction(tx, target, {
      createdAt,
      metadata: {},
      reference: `table:${target.tableId}`,
      keySuffix: "linked-to-target",
    }));
    const unrelated = rememberTransaction(await insertUnsupportedDatabaseTableTransaction(tx, orphan, {
      createdAt,
      metadata: {},
      keySuffix: "unrelated-history",
    }));
    await tx.unsafe("set constraints all immediate;");
    await tx.unsafe("set constraints all deferred;");
    await tx.unsafe(`
      update public.poker_tables
         set status = 'CLOSED'
       where id = any($1::uuid[]);
    `, [[mismatch.tableId, malformed.tableId]]);
    await enableTableFence(tx, true);

    const nullRegistryRows = await tx.unsafe(`
      select idempotency_key, table_id::text
        from public.chips_transaction_idempotency
       where idempotency_key = any($1::text[])
       order by idempotency_key;
    `, [[linked.key, unrelated.key]]);
    assert.deepEqual(nullRegistryRows.map((row) => row.table_id), [null, null], "historical unsupported identities must remain NULL");
    const linkedReferenceProof = await tx.unsafe(`
      select
        registry.table_id::text as registry_table_id,
        transactions.reference,
        jsonb_typeof(transactions.metadata) as metadata_type,
        jsonb_typeof((transactions.metadata #>> '{}')::jsonb) as unpacked_type,
        transactions.metadata #>> '{}' as metadata_text
        from public.chips_transactions transactions
        join public.chips_transaction_idempotency registry
          on registry.transaction_id = transactions.id
       where transactions.idempotency_key = $1;
    `, [linked.key]);
    assert.deepEqual(linkedReferenceProof[0], {
      registry_table_id: null,
      reference: `table:${target.tableId}`,
      metadata_type: "string",
      unpacked_type: "object",
      metadata_text: "{}",
    }, "valid reference evidence must remain an unknown identity, not an invalid marker");

    const mismatchMetadataProof = await tx.unsafe(`
      select
        registry.table_id::text as registry_table_id,
        jsonb_typeof(transactions.metadata) as metadata_type,
        jsonb_typeof((transactions.metadata #>> '{}')::jsonb) as unpacked_type,
        ((transactions.metadata #>> '{}')::jsonb ->> 'tableId') as metadata_table_id
        from public.chips_transactions transactions
        join public.chips_transaction_idempotency registry
          on registry.transaction_id = transactions.id
       where transactions.idempotency_key = any($1::text[])
       order by transactions.idempotency_key;
    `, [[
      `bot-seed-buyin:${mismatch.tableId}:legacy-mismatch-buyin`,
      `poker:bot-terminal-cashout:v1:${mismatch.tableId}:legacy-mismatch-cashout`,
    ]]);
    assert.equal(mismatchMetadataProof.length, 2);
    for (const row of mismatchMetadataProof) {
      assert.deepEqual(row, {
        registry_table_id: mismatch.tableId,
        metadata_type: "string",
        unpacked_type: "object",
        metadata_table_id: target.tableId,
      }, "legacy mismatch must parse as an object before marker comparison");
      assert.notEqual(row.metadata_table_id, row.registry_table_id, "legacy mismatch marker must differ from the registry table key");
    }
    const malformedMetadataProof = await tx.unsafe(`
      select
        jsonb_typeof(metadata) as metadata_type,
        pg_catalog.pg_input_is_valid(metadata #>> '{}', 'jsonb'::text) as unpacked_json_valid
        from public.chips_transactions
       where idempotency_key = any($1::text[])
       order by idempotency_key;
    `, [[
      `bot-seed-buyin:${malformed.tableId}:legacy-malformed-buyin`,
      `poker:bot-terminal-cashout:v1:${malformed.tableId}:legacy-malformed-cashout`,
    ]]);
    assert.deepEqual([...malformedMetadataProof], [
      { metadata_type: "string", unpacked_json_valid: false },
      { metadata_type: "string", unpacked_json_valid: false },
    ], "malformed fixture must be one invalid JSONB string");

    const selected = await tx.unsafe(BOT_ONLY_CANDIDATE_SQL, [cutoff, 5000, null, null]);
    assert.equal(selected.length, 2, "the deterministic selector must choose one complete table per batch");
    assert.deepEqual(
      [...new Set(selected.map((row) => row.table_id))].sort(),
      [independent.tableId],
      "unrelated NULL identities must not block an independent proof-eligible table",
    );
    assert.equal(selected.some((row) => row.table_id === target.tableId), false, "valid target reference evidence must block the target table");
    assert.equal(selected.filter((row) => row.table_id === independent.tableId).length, 2, "independent proof-eligible table must contribute both transactions");

    await tx.unsafe("update public.poker_tables set status = 'OPEN' where id = $1::uuid;", [independent.tableId]);
    const legacySelected = await tx.unsafe(BOT_ONLY_CANDIDATE_SQL, [cutoff, 5000, null, null]);
    assert.equal(legacySelected.length, 2, "the valid legacy table must remain selectable when it is the next complete table");
    assert.deepEqual([...new Set(legacySelected.map((row) => row.table_id))], [legacyTable.tableId], "valid legacy metadata must pass marker validation");
    assert.equal(legacySelected.filter((row) => row.table_id === legacyTable.tableId).length, 2, "valid legacy table must contribute both transactions");

    const blockers = await tx.unsafe(BOT_ONLY_BLOCKING_ANOMALY_SQL, [cutoff, 5000]);
    const incomplete = blockers.find((row) => row.blocker_code === "identity_set_incomplete");
    assert.ok(incomplete && Number(incomplete.table_count) >= 1, `target-linked NULL identity must be reported incomplete: ${JSON.stringify(blockers)}`);
    const unknown = blockers.find((row) => row.blocker_code === "unknown_table_identity");
    assert.ok(unknown && Number(unknown.transaction_count) >= 2, `historical NULL identities must remain observable: ${JSON.stringify(blockers)}`);
    const invalidMarker = blockers.find((row) => row.blocker_code === "invalid_marker");
    assert.equal(Number(invalidMarker?.transaction_count), invalidMarkerBeforeUnknownReference, `valid NULL-registry reference evidence must not increase invalid_marker: ${JSON.stringify(blockers)}`);
    assert.equal(Number(invalidMarker?.table_count), 2, `legacy mismatch/malformed metadata must cover exactly two tables: ${JSON.stringify(blockers)}`);

    throw DB_ROLLBACK;
  }).catch((error) => {
    if (error === DB_ROLLBACK) {
      rolledBack = true;
      return;
    }
    throw error;
  });

  assert.equal(rolledBack, true, "archive selector contract must rollback its entire fixture scope");
  const scopeTransactionIds = scopeTransactions.map((transaction) => transaction.transactionId);
  const scopeRegistryKeys = scopeTransactions.map((transaction) => transaction.key);
  const leaked = await sql.unsafe(`
    select
      (select count(*) from public.poker_tables where id = any($1::uuid[]))::text as tables,
      (select count(*) from public.chips_transactions where id = any($2::uuid[]))::text as transactions,
      (select count(*) from public.chips_entries where transaction_id = any($2::uuid[]))::text as entries,
      (select count(*) from public.chips_transaction_idempotency where idempotency_key = any($3::text[]))::text as registry;
  `, [scopeTableIds, scopeTransactionIds, scopeRegistryKeys]);
  assert.deepEqual(leaked[0], {
    tables: "0",
    transactions: "0",
    entries: "0",
    registry: "0",
  }, "archive selector rollback must not leave qualifying tables or ledger rows for later contracts");
}

async function lifecycleGateForeignNullIdentityPostgresContract(sql) {
  let rolledBack = false;
  let scopeTableIds = [];
  let scopeTransactionIds = [];
  let scopeRegistryKeys = [];
  let scopeObjectPath = null;

  await sql.begin(async (tx) => {
    await enableTableFence(tx, true);
    const now = Date.now();
    const cutoff = new Date(now - (7 * DAY_MS)).toISOString();
    const createdAt = new Date(now - (10 * DAY_MS)).toISOString();
    const target = await createDatabaseTable(tx);
    const foreign = await createDatabaseTable(tx);
    const valid = await insertDatabaseTableTransaction(tx, target, { createdAt, keySuffix: "lifecycle-valid" });
    await tx.unsafe("set constraints all immediate;");
    await tx.unsafe("update public.poker_tables set status = 'CLOSED' where id = any($1::uuid[]);", [[target.tableId, foreign.tableId]]);
    const batch = await insertBotOnlyLifecycleBatch(tx, target, valid, cutoff);

    await enableTableFence(tx, false);
    const foreignUnknown = await insertUnknownDatabaseTableTransaction(tx, {
      key: `bot-seed-buyin:${foreign.tableId}:foreign-history`,
      createdAt,
      metadata: { tableId: foreign.tableId },
      reference: `table:${foreign.tableId}`,
    });
    await tx.unsafe("set constraints all immediate;");
    await enableTableFence(tx, true);

    const gate = await tx.unsafe(`
      select public.chips_assert_bot_only_table_lifecycle_gate($1::uuid, $2::bigint, $3::timestamptz, $4::text[]) as result;
    `, [target.tableId, batch.batchId, cutoff, batch.registryKeys]);
    assert.equal(gate[0].result.state, "table_complete", "a foreign NULL identity must not block the target lifecycle gate");
    assert.equal(gate[0].result.unknown_registry, 0);
    assert.equal(gate[0].result.unknown_hot, 0);

    await overrideArchiveIdentityGates(tx);
    const proof = await tx.unsafe(`
      select public.chips_register_bot_only_archive_proof($1, $2::uuid[], $3::bigint[], $4::uuid, $5::text[]) as result;
    `, [batch.objectPath, batch.transactionIds, batch.entryIds, target.tableId, batch.registryKeys]);
    assert.equal(proof[0].result.state, "proof_registered", "proof must pass with only a foreign NULL identity present");

    scopeTableIds = [target.tableId, foreign.tableId];
    scopeTransactionIds = [valid.transactionId, foreignUnknown.transactionId];
    scopeRegistryKeys = [valid.key, foreignUnknown.key];
    scopeObjectPath = batch.objectPath;
    throw DB_ROLLBACK;
  }).catch((error) => {
    if (error === DB_ROLLBACK) {
      rolledBack = true;
      return;
    }
    throw error;
  });

  assert.equal(rolledBack, true, "foreign NULL identity lifecycle fixture must rollback completely");
  const leaked = await sql.unsafe(`
    select
      (select count(*) from public.poker_tables where id = any($1::uuid[]))::text as tables,
      (select count(*) from public.chips_transactions where id = any($2::uuid[]))::text as transactions,
      (select count(*) from public.chips_entries where transaction_id = any($2::uuid[]))::text as entries,
      (select count(*) from public.chips_transaction_idempotency where idempotency_key = any($3::text[]))::text as registry,
      (select count(*) from public.chips_ledger_archive_batches where object_path = $4) ::text as batches;
  `, [scopeTableIds, scopeTransactionIds, scopeRegistryKeys, scopeObjectPath]);
  assert.deepEqual(leaked[0], {
    tables: "0",
    transactions: "0",
    entries: "0",
    registry: "0",
    batches: "0",
  }, "foreign NULL identity proof fixture must not leak rows");
}

async function lifecycleGateTargetEvidencePostgresContract(sql) {
  let rolledBack = false;
  let scopeTableIds = [];
  let scopeTransactionIds = [];
  let scopeRegistryKeys = [];
  let scopeObjectPath = null;

  await sql.begin(async (tx) => {
    await enableTableFence(tx, true);
    const now = Date.now();
    const cutoff = new Date(now - (7 * DAY_MS)).toISOString();
    const createdAt = new Date(now - (10 * DAY_MS)).toISOString();
    const target = await createDatabaseTable(tx);
    const other = await createDatabaseTable(tx);
    const valid = await insertDatabaseTableTransaction(tx, target, { createdAt, keySuffix: "lifecycle-target" });
    await tx.unsafe("set constraints all immediate;");
    await tx.unsafe("update public.poker_tables set status = 'CLOSED' where id = $1::uuid;", [target.tableId]);
    const batch = await insertBotOnlyLifecycleBatch(tx, target, valid, cutoff);
    const gateArgs = [target.tableId, batch.batchId, cutoff, batch.registryKeys];

    const evidenceCases = [
      {
        name: "key",
        insert: () => insertUnknownDatabaseRegistryRow(tx, {
          key: `bot-seed-buyin:${target.tableId}:target-key-${randomUUID()}`,
          createdAt,
        }),
      },
      {
        name: "missing_registry_key",
        insert: () => insertMissingRegistryDatabaseTableTransaction(tx, {
          key: `bot-seed-buyin:${target.tableId}:missing-registry-${randomUUID()}`,
          createdAt,
          metadata: {},
        }),
      },
      {
        name: "metadata_object",
        insert: () => insertUnknownDatabaseTableTransaction(tx, {
          key: `legacy-unsupported-metadata-${randomUUID()}`,
          createdAt,
          metadata: { tableId: target.tableId },
        }),
      },
      {
        name: "metadata_legacy_json_string",
        insert: () => insertUnknownDatabaseTableTransaction(tx, {
          key: `legacy-unsupported-legacy-json-${randomUUID()}`,
          createdAt,
          metadata: JSON.stringify({ tableId: target.tableId }),
        }),
      },
      {
        name: "reference",
        insert: () => insertUnknownDatabaseTableTransaction(tx, {
          key: `legacy-unsupported-reference-${randomUUID()}`,
          createdAt,
          metadata: {},
          reference: `table:${target.tableId}`,
        }),
      },
      {
        name: "escrow",
        insert: () => insertUnsupportedDatabaseTableTransaction(tx, target, {
          createdAt,
          metadata: {},
          reference: null,
          keySuffix: `target-escrow-${randomUUID()}`,
        }),
      },
      {
        name: "conflicting",
        insert: async () => {
          const transaction = await insertMissingRegistryDatabaseTableTransaction(tx, {
            key: `bot-seed-buyin:${target.tableId}:conflicting-${randomUUID()}`,
            createdAt,
            metadata: { tableId: other.tableId },
          });
          return insertUnknownDatabaseRegistryRow(tx, {
            key: transaction.key,
            transactionId: transaction.transactionId,
            createdAt,
          });
        },
      },
      {
        name: "malformed",
        insert: async () => {
          const transaction = await insertMissingRegistryDatabaseTableTransaction(tx, {
            key: `bot-seed-buyin:${target.tableId}:malformed-${randomUUID()}`,
            createdAt,
            metadata: '{"tableId":',
          });
          return insertUnknownDatabaseRegistryRow(tx, {
            key: transaction.key,
            transactionId: transaction.transactionId,
            createdAt,
          });
        },
      },
    ];

    for (const evidenceCase of evidenceCases) {
      await expectDatabaseError(tx, `target_evidence_${evidenceCase.name}`, async () => {
        await enableTableFence(tx, false);
        await evidenceCase.insert();
        await tx.unsafe("set constraints all immediate;");
        await enableTableFence(tx, true);
        await tx.unsafe(`
          select public.chips_assert_bot_only_table_lifecycle_gate($1::uuid, $2::bigint, $3::timestamptz, $4::text[]) as result;
        `, gateArgs);
      }, "P8914", /Unknown TABLE identity blocks/);
    }

    const accountingBefore = await readAccountingSnapshot(tx, [target.systemAccountId, target.escrowAccountId], [valid.transactionId]);
    await tx.unsafe("savepoint lifecycle_proof_failure;");
    await enableTableFence(tx, false);
    const malformed = await insertMissingRegistryDatabaseTableTransaction(tx, {
      key: `bot-seed-buyin:${target.tableId}:proof-malformed-${randomUUID()}`,
      createdAt,
      metadata: '{"tableId":',
    });
    await insertUnknownDatabaseRegistryRow(tx, {
      key: malformed.key,
      transactionId: malformed.transactionId,
      createdAt,
    });
    await tx.unsafe("set constraints all immediate;");
    await enableTableFence(tx, true);
    await overrideArchiveIdentityGates(tx);
    await tx.unsafe("savepoint lifecycle_proof_call;");
    let proofError = null;
    try {
      await tx.unsafe(`
        select public.chips_register_bot_only_archive_proof($1, $2::uuid[], $3::bigint[], $4::uuid, $5::text[]) as result;
      `, [batch.objectPath, batch.transactionIds, batch.entryIds, target.tableId, batch.registryKeys]);
    } catch (error) {
      proofError = error;
    }
    await tx.unsafe("rollback to savepoint lifecycle_proof_call;");
    await tx.unsafe("release savepoint lifecycle_proof_call;");
    assert.ok(proofError, "proof must fail closed when target evidence is malformed");
    assert.equal(proofError.code, "P8914");

    const batchState = await tx.unsafe(`
      select
        (archive_proof_verified_at is null
          and archived_transaction_ids_sha256 is null
          and archived_entry_ids_sha256 is null) as proof_empty,
        (pruned_at is null
          and pruned_transaction_count is null
          and pruned_entry_count is null
          and pruned_transaction_ids_sha256 is null
          and pruned_entry_ids_sha256 is null) as prune_empty,
        (registry_cleaned_at is null
          and registry_cleaned_key_count is null
          and registry_cleaned_keys_sha256 is null) as cleanup_empty,
        (destructive_go_at is null and destructive_go_batch_id is null) as go_empty
        from public.chips_ledger_archive_batches
       where batch_id = $1::bigint;
    `, [batch.batchId]);
    assert.deepEqual(batchState[0], { proof_empty: true, prune_empty: true, cleanup_empty: true, go_empty: true }, "failed proof must not write proof or receipts");
    const sideEffects = await tx.unsafe(`
      select
        (select count(*) from public.chips_transactions where id = $1::uuid) as valid_transactions,
        (select count(*) from public.chips_entries where transaction_id = $1::uuid) as valid_entries,
        (select count(*) from public.chips_transaction_idempotency where idempotency_key = $2) as valid_registry,
        (select count(*) from public.chips_transactions where id = $3::uuid) as malformed_transactions,
        (select count(*) from public.chips_transaction_idempotency where idempotency_key = $4) as malformed_registry,
        (select bot_only_retention_complete_at is null from public.poker_tables where id = $5::uuid) as table_marker_empty;
    `, [valid.transactionId, valid.key, malformed.transactionId, malformed.key, target.tableId]);
    assert.deepEqual(sideEffects[0], {
      valid_transactions: "1",
      valid_entries: "2",
      valid_registry: "1",
      malformed_transactions: "1",
      malformed_registry: "1",
      table_marker_empty: true,
    }, "failed proof must not create or remove ledger, registry, or lifecycle state");
    const accountingAfter = await readAccountingSnapshot(tx, [target.systemAccountId, target.escrowAccountId], [valid.transactionId]);
    assert.deepEqual(accountingAfter, accountingBefore, "failed proof must preserve balances and conservation");

    await tx.unsafe("rollback to savepoint lifecycle_proof_failure;");
    await tx.unsafe("release savepoint lifecycle_proof_failure;");

    scopeTableIds = [target.tableId, other.tableId];
    scopeTransactionIds = [valid.transactionId];
    scopeRegistryKeys = [valid.key];
    scopeObjectPath = batch.objectPath;
    throw DB_ROLLBACK;
  }).catch((error) => {
    if (error === DB_ROLLBACK) {
      rolledBack = true;
      return;
    }
    throw error;
  });

  assert.equal(rolledBack, true, "target evidence lifecycle fixture must rollback completely");
  const leaked = await sql.unsafe(`
    select
      (select count(*) from public.poker_tables where id = any($1::uuid[]))::text as tables,
      (select count(*) from public.chips_transactions where id = any($2::uuid[]))::text as transactions,
      (select count(*) from public.chips_entries where transaction_id = any($2::uuid[]))::text as entries,
      (select count(*) from public.chips_transaction_idempotency where idempotency_key = any($3::text[]))::text as registry,
      (select count(*) from public.chips_ledger_archive_batches where object_path = $4)::text as batches;
  `, [scopeTableIds, scopeTransactionIds, scopeRegistryKeys, scopeObjectPath]);
  assert.deepEqual(leaked[0], {
    tables: "0",
    transactions: "0",
    entries: "0",
    registry: "0",
    batches: "0",
  }, "target evidence fixture must not leak rows");
}

async function humanEntryShapeDiagnosticPostgresContract(sql) {
  const now = Date.now();
  const cutoff = new Date(now - (7 * DAY_MS)).toISOString();
  const createdAt = new Date(now - (10 * DAY_MS)).toISOString();
  const before = await sql.unsafe(BOT_ONLY_BLOCKING_ANOMALY_SQL, [cutoff, 5000]);
  const beforeDeferred = Number(before.find((row) => row.blocker_code === "deferred_entry_binding")?.transaction_count || 0);
  const fixture = await sql.begin(async (tx) => {
    const value = await createDatabaseTable(tx, "OPEN");
    await insertHumanUserEscrowTransaction(tx, value, { createdAt });
    await tx.unsafe("set constraints all immediate;");
    await tx.unsafe("update public.poker_tables set status = 'CLOSED' where id = $1::uuid;", [value.tableId]);
    return value;
  });
  const after = await sql.unsafe(BOT_ONLY_BLOCKING_ANOMALY_SQL, [cutoff, 5000]);
  const afterDeferred = Number(after.find((row) => row.blocker_code === "deferred_entry_binding")?.transaction_count || 0);
  assert.equal(afterDeferred, beforeDeferred, "valid human USER/ESCROW must not be deferred_entry_binding");
  const identity = await sql.unsafe(`
    select transactions.user_id::text, count(*)::text as entries
      from public.chips_transactions transactions
      join public.chips_entries entries on entries.transaction_id = transactions.id
     where transactions.tx_type::text = 'TABLE_BUY_IN'
       and transactions.user_id is not null
       and transactions.idempotency_key like $1
     group by transactions.user_id;
  `, [`join-buyin:${fixture.tableId}:%`]);
  assert.equal(identity.length, 1);
  assert.equal(Number(identity[0].entries), 2);
}

async function selectorResultEquivalenceAndPerformancePostgresContract(sql) {
  let rolledBack = false;
  let fixture = null;
  await sql.begin(async (tx) => {
    await enableTableFence(tx, true);
    const now = Date.now();
    const cutoff = new Date(now - (7 * DAY_MS)).toISOString();
    const createdAt = new Date(now - (10 * DAY_MS)).toISOString();
    fixture = await createDatabaseTable(tx, "OPEN");
    await insertDatabaseTableTransaction(tx, fixture, { createdAt, keySuffix: "equivalence-buyin" });
    await insertDatabaseTableTransaction(tx, fixture, { kind: "cashout", createdAt, keySuffix: "equivalence-cashout" });
    await tx.unsafe("set constraints all immediate;");
    await tx.unsafe("update public.poker_tables set status = 'CLOSED' where id = $1::uuid;", [fixture.tableId]);

    const parameters = [cutoff, 5000, null, null];
    const baselineBlockers = await tx.unsafe(BOT_ONLY_BLOCKING_ANOMALY_SQL, [cutoff, 5000]);
    const optimized = await tx.unsafe(BOT_ONLY_CANDIDATE_SQL, parameters);
    const reference = await tx.unsafe(REFERENCE_CANDIDATE_IDS_SQL, [cutoff, 5000]);
    assert.deepEqual(
      optimized.map((row) => ({ id: row.id, table_id: row.table_id })),
      reference.map((row) => ({ id: row.id, table_id: row.table_id })),
      "optimized selector must be result-equivalent to the independent semantic reference",
    );
    assert.deepEqual(
      await tx.unsafe(BOT_ONLY_BLOCKING_ANOMALY_SQL, [cutoff, 5000]),
      baselineBlockers,
      "a valid equivalence fixture must not add blockers",
    );

    await tx.unsafe("set local statement_timeout = '30000ms';");
    await tx.unsafe(`
      insert into public.chips_transaction_idempotency
        (idempotency_key, transaction_id, payload_hash, tx_type, user_id, transaction_created_at)
      select 'perf-registry-' || g::text, gen_random_uuid(), repeat(md5(g::text), 2), 'BUY_IN', null,
             timezone('utc', now()) - interval '10 days'
        from generate_series(1, $1::int) g;
    `, [PERFORMANCE_REGISTRY_ROW_COUNT]);
    await tx.unsafe(`
      insert into public.chips_transaction_idempotency
        (idempotency_key, transaction_id, payload_hash, tx_type, user_id, transaction_created_at)
      select 'perf-unknown-table-' || g::text, gen_random_uuid(), repeat(md5(('unknown-' || g)::text), 2), 'TABLE_BUY_IN', null,
             timezone('utc', now()) - interval '10 days'
        from generate_series(1, $1::int) g;
    `, [PERFORMANCE_UNKNOWN_TABLE_ROW_COUNT]);

    const candidateStarted = performance.now();
    const performanceCandidates = await tx.unsafe(BOT_ONLY_CANDIDATE_SQL, parameters);
    const candidateElapsedMs = performance.now() - candidateStarted;
    const blockerStarted = performance.now();
    const performanceBlockers = await tx.unsafe(BOT_ONLY_BLOCKING_ANOMALY_SQL, [cutoff, 5000]);
    const blockerElapsedMs = performance.now() - blockerStarted;
    assert.deepEqual(
      performanceCandidates.map((row) => ({ id: row.id, table_id: row.table_id })),
      reference.map((row) => ({ id: row.id, table_id: row.table_id })),
      "registry volume must not change selector results",
    );
    assert.equal(
      Number(performanceBlockers.find((row) => row.blocker_code === "unknown_table_identity")?.transaction_count),
      Number(baselineBlockers.find((row) => row.blocker_code === "unknown_table_identity")?.transaction_count || 0)
        + PERFORMANCE_UNKNOWN_TABLE_ROW_COUNT,
    );
    assert.ok(candidateElapsedMs < 10000, `candidate selector must remain bounded on the disposable Stage-sized fixture: ${candidateElapsedMs}ms`);
    assert.ok(blockerElapsedMs < 10000, `blocker selector must remain bounded on the disposable Stage-sized fixture: ${blockerElapsedMs}ms`);

    const candidatePlan = explainPlanRoot(await tx.unsafe(
      `explain (format json, verbose true, costs true, settings true) ${BOT_ONLY_CANDIDATE_SQL}`,
      parameters,
    ));
    const blockerPlan = explainPlanRoot(await tx.unsafe(
      `explain (format json, verbose true, costs true, settings true) ${BOT_ONLY_BLOCKING_ANOMALY_SQL}`,
      [cutoff, 5000],
    ));
    for (const [label, plan] of [["candidate", candidatePlan], ["blocker", blockerPlan]]) {
      assert.ok(plan, `${label} EXPLAIN plan must be present`);
      const nodes = collectExplainPlanNodes(plan);
      assert.ok(
        nodes.filter((node) => node["Node Type"] === "Seq Scan" && node["Relation Name"] === "chips_transaction_idempotency").length <= 1,
        `${label} must physically scan chips_transaction_idempotency at most once`,
      );
      assert.ok(
        nodes.filter((node) => node["Node Type"] === "Seq Scan" && node["Relation Name"] === "chips_transactions").length <= 1,
        `${label} must physically scan chips_transactions at most once`,
      );
    }
    throw DB_ROLLBACK;
  }).catch((error) => {
    if (error === DB_ROLLBACK) {
      rolledBack = true;
      return;
    }
    throw error;
  });

  assert.equal(rolledBack, true, "equivalence and performance fixture must rollback completely");
  const leaked = await sql.unsafe(`
    select
      (select count(*) from public.poker_tables where id = $1::uuid)::text as tables,
      (select count(*) from public.chips_transactions where id in (
        select transaction_id from public.chips_transaction_idempotency where idempotency_key like 'perf-%'
      ))::text as performance_transactions,
      (select count(*) from public.chips_transaction_idempotency where idempotency_key like 'perf-%')::text as performance_registry;
  `, [fixture.tableId]);
  assert.deepEqual(leaked[0], {
    tables: "0",
    performance_transactions: "0",
    performance_registry: "0",
  }, "equivalence and performance fixture must not leak rows");
}

async function readAccountingSnapshot(db, accountIds, transactionIds) {
  const accounts = await db.unsafe(`
    select id::text, balance::text, next_entry_seq::text
      from public.chips_accounts
     where id = any($1::uuid[])
     order by id;
  `, [accountIds]);
  const totals = await db.unsafe(`
    select
      coalesce((select sum(balance) from public.chips_accounts), 0)::text as account_balance_total,
      coalesce((select sum(amount) from public.chips_entries), 0)::text as conservation,
      coalesce((select sum(amount) from public.chips_entries where transaction_id = any($1::uuid[])), 0)::text as selected_transaction_net;
  `, [transactionIds]);
  return {
    accounts,
    accountBalanceTotal: totals[0].account_balance_total,
    conservation: totals[0].conservation,
    selectedTransactionNet: totals[0].selected_transaction_net,
  };
}

async function readTransactionIdentity(db, transactionId) {
  const rows = await db.unsafe(`
    select
      transactions.id::text,
      transactions.sequence::text,
      transactions.idempotency_key,
      transactions.payload_hash,
      transactions.tx_type::text,
      transactions.user_id::text,
      transactions.created_at::text,
      registry.table_id::text as table_id,
      registry.key_format_version,
      registry.key_format
    from public.chips_transactions transactions
    left join public.chips_transaction_idempotency registry
      on registry.idempotency_key = transactions.idempotency_key
   where transactions.id = $1::uuid;
  `, [transactionId]);
  return rows[0] || null;
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
  const accountIds = [fixture.systemAccountId, fixture.escrowAccountId];
  const accountingBefore = await readAccountingSnapshot(sql, accountIds, transactionIds);
  const transactionIdentityBefore = await readTransactionIdentity(sql, fixture.transaction.transactionId);
  assert.ok(transactionIdentityBefore, "the hot transaction identity must exist before cleanup");
  assert.equal(accountingBefore.selectedTransactionNet, "0", "the hot transaction must conserve its entries");
  assert.equal(accountingBefore.conservation, "0", "the ledger must conserve entries before cleanup");
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
    const pruneStore = createPruneStore(sql);
    const authorization = await pruneStore.authorizeBotOnlyBatch(batchId, `GO ${batchId}`);
    assert.equal(authorization.state, "authorized");

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
      const accountingInTransaction = await readAccountingSnapshot(tx, accountIds, transactionIds);
      assert.deepEqual(accountingInTransaction.accounts, accountingBefore.accounts, "cleanup must not change balances or next_entry_seq");
      assert.equal(accountingInTransaction.accountBalanceTotal, accountingBefore.accountBalanceTotal);
      assert.equal(accountingInTransaction.conservation, accountingBefore.conservation);
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
    assert.deepEqual(await readTransactionIdentity(sql, fixture.transaction.transactionId), transactionIdentityBefore, "rollback must restore transaction identity");
    const accountingAfterRollback = await readAccountingSnapshot(sql, accountIds, transactionIds);
    assert.deepEqual(accountingAfterRollback.accounts, accountingBefore.accounts, "rollback must restore balances and next_entry_seq");
    assert.equal(accountingAfterRollback.accountBalanceTotal, accountingBefore.accountBalanceTotal);
    assert.equal(accountingAfterRollback.conservation, accountingBefore.conservation);
    assert.equal(accountingAfterRollback.selectedTransactionNet, accountingBefore.selectedTransactionNet);

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

    const accountingAfterCleanup = await readAccountingSnapshot(sql, accountIds, transactionIds);
    assert.deepEqual(accountingAfterCleanup.accounts, accountingBefore.accounts, "destructive cleanup must preserve balances and next_entry_seq");
    assert.equal(accountingAfterCleanup.accountBalanceTotal, accountingBefore.accountBalanceTotal);
    assert.equal(accountingAfterCleanup.conservation, accountingBefore.conservation);
    assert.equal(accountingAfterCleanup.selectedTransactionNet, "0");
    assert.equal(await readTransactionIdentity(sql, fixture.transaction.transactionId), null, "cleanup must remove only the hot transaction identity");

    await sql.begin(async (tx) => {
      const substituted = await createDatabaseTable(tx, "OPEN");
      const beforeReuse = await readAccountingSnapshot(tx, accountIds, transactionIds);
      const assertNoReuseEffects = async (label, transactionId) => {
        const reuseRows = await tx.unsafe(`
          select
            (select count(*) from public.chips_transactions where id = $1::uuid) as transactions,
            (select count(*) from public.chips_transaction_idempotency where idempotency_key = $2) as registry_rows,
            (select count(*) from public.chips_entries where transaction_id = $1::uuid) as entries;
        `, [transactionId, fixture.transaction.key]);
        assert.equal(Number(reuseRows[0].transactions), 0, `${label}: must not create a transaction`);
        assert.equal(Number(reuseRows[0].entries), 0, `${label}: must not create entries`);
        assert.equal(Number(reuseRows[0].registry_rows), 0, `${label}: must not recreate the registry identity`);
        const afterReuse = await readAccountingSnapshot(tx, accountIds, transactionIds);
        assert.deepEqual(afterReuse.accounts, beforeReuse.accounts, `${label}: must not change balances or next_entry_seq`);
        assert.equal(afterReuse.accountBalanceTotal, beforeReuse.accountBalanceTotal, `${label}: account total must be unchanged`);
        assert.equal(afterReuse.conservation, beforeReuse.conservation, `${label}: conservation must be unchanged`);
      };

      const replacementTableReuseId = randomUUID();
      await expectDatabaseError(tx, "deleted_key_reuse_replacement", async () => {
        await tx.unsafe(`
          insert into public.chips_transactions
            (id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id)
          values ($1::uuid, $2, $3::jsonb, $4, $5, 'TABLE_BUY_IN', null);
        `, [
          replacementTableReuseId,
          `BOT_SEED_BUY_IN:${substituted.tableId}:reuse`,
          JSON.stringify({ tableId: substituted.tableId }),
          fixture.transaction.key,
          "e".repeat(64),
        ]);
      }, "P8902", /does not match the idempotency key/);
      await assertNoReuseEffects("replacement table key reuse", replacementTableReuseId);

      const closedTableReuseId = randomUUID();
      await expectDatabaseError(tx, "deleted_key_reuse_closed", async () => {
        await tx.unsafe(`
          insert into public.chips_transactions
            (id, reference, metadata, idempotency_key, payload_hash, tx_type, user_id)
          values ($1::uuid, $2, $3::jsonb, $4, $5, 'TABLE_BUY_IN', null);
        `, [
          closedTableReuseId,
          `BOT_SEED_BUY_IN:${fixture.tableId}:reuse-closed`,
          JSON.stringify({ tableId: fixture.tableId }),
          fixture.transaction.key,
          "f".repeat(64),
        ]);
      }, "P8903", /closed or missing/);
      await assertNoReuseEffects("closed table key reuse", closedTableReuseId);
      throw DB_ROLLBACK;
    }).catch((error) => {
      if (error !== DB_ROLLBACK) throw error;
    });
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
    await selectorResultEquivalenceAndPerformancePostgresContract(sql);
    await historicalKeyAndEntryBindingPostgresContract(sql);
    await concurrencyInsertVersusClosePostgresContract(POSTGRES_TEST_DB_URL);
    await archiveSelectorHistoricalIdentityAndMetadataPostgresContract(sql);
    await lifecycleGateForeignNullIdentityPostgresContract(sql);
    await lifecycleGateTargetEvidencePostgresContract(sql);
    await humanEntryShapeDiagnosticPostgresContract(sql);
    await ageBoundaryPostgresContract(sql);
    await retryDestructiveOperatorPostgresContract(sql);
    process.stdout.write("chips-ledger-bot-only-retention PostgreSQL selector and fundamental contracts passed\n");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

historicalKeyAndEntryBindingContract();
concurrencyAndScopeContract();
failClosedLifecycleContract();
lifecycleGateScopeContract();
proofPerformanceContract();
retryAndAccountingContract();

if (POSTGRES_TEST_DB_URL) {
  await runPostgresFundamentalContracts();
}

process.stdout.write("chips-ledger-bot-only-retention four fundamental contracts passed\n");
