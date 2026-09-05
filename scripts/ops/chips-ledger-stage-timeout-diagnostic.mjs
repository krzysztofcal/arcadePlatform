import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { gunzipSync } from "node:zlib";

import {
  BOT_ONLY_BLOCKING_ANOMALY_SQL,
  BOT_ONLY_CANDIDATE_SQL,
  BOT_ONLY_RETENTION_DAYS,
  BOT_ONLY_RETENTION_POLICY_ID,
  BOT_ONLY_EXPORT_SCHEMA_VERSION,
  parseJsonl,
  runExport,
} from "./chips-ledger-archive-export.mjs";
import {
  TABLE_IDENTITY_SUMMARY_ERROR_CODES,
  downloadPrivateArchiveObject,
  diagnoseTableIdentitySummary,
  resolveStorageTarget,
  verifyArchiveBytes,
  verifyLocalArchive,
} from "./chips-ledger-archive-store.mjs";
import {
  buildPruneEvidence,
  exporterManifestFromDatabase,
  parseManifestRow,
} from "./chips-ledger-archive-prune.mjs";
import {
  redactedError,
  STAGE_MAX_BATCH_SIZE,
  STAGE_PROJECT_REF,
  STAGE_SYSTEM_IDENTIFIER,
  STAGE_EXACT_BATCH_SQL,
  STAGE_OWN_BATCHES_SQL,
  validateStageEnvironment,
} from "./chips-ledger-stage-automation.mjs";

const REPLAY_STATEMENT_TIMEOUT_MS = 120000;
const SQLSTATE_RE = /^[0-9A-Z]{5}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const EXACT_BOT_ONLY_DIAGNOSTIC_BATCH_ID = "481";
const BOT_ONLY_PROOF_FUNCTION_DEFINITION_SQL = `
select pg_catalog.pg_get_functiondef(
  'public.chips_assert_bot_only_archive_proof_lifecycle_gate(uuid,bigint,timestamptz,uuid[],text[])'::pg_catalog.regprocedure
) as definition;`;

// These are read-only EXPLAIN probes of the expensive CTEs in the applied
// proof helper.  The predicates intentionally mirror the helper; parameters
// are populated only from the exact batch archive below.  Keep the target
// probe on the same independent candidate-ID paths as the forward proof
// migration; otherwise the diagnostic would explain the historical OR query.
export const BOT_ONLY_PROOF_TARGET_TRANSACTIONS_EXPLAIN_SQL = `
with candidate_transaction_ids as (
  select transactions.id
    from public.chips_transactions transactions
   where transactions.id = any(coalesce($1::uuid[], array[]::uuid[]))
     and transactions.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')

  union

  select transactions.id
    from public.chips_transactions transactions
   where transactions.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and pg_catalog.lower(transactions.idempotency_key) like any (array[
       'join-buyin:' || $2::uuid::text || ':%',
       'bot-seed-buyin:' || $2::uuid::text || ':%',
       'managed-bot-seed-buyin:' || $2::uuid::text || ':%'
     ])
     and transactions.idempotency_key ~* ('^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):' || $2::uuid || ':[^:]+(:[^:]+)*$')

  union

  select transactions.id
    from public.chips_transactions transactions
   where transactions.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and pg_catalog.lower(transactions.idempotency_key) like any (array[
       'poker:leave:' || $2::uuid::text || ':%',
       'poker:inactive_cleanup:' || $2::uuid::text || ':%'
     ])
     and transactions.idempotency_key ~* ('^poker:(leave|inactive_cleanup):' || $2::uuid || ':[^:]+(:[^:]+)*$')

  union

  select transactions.id
    from public.chips_transactions transactions
   where transactions.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and pg_catalog.lower(transactions.idempotency_key) like any (array[
       'poker:rebuy:v1:' || $2::uuid::text || ':%',
       'poker:deferred-leave:v1:' || $2::uuid::text || ':%',
       'poker:bot-terminal-cashout:v1:' || $2::uuid::text || ':%',
       'poker:human-terminal-cashout:v1:' || $2::uuid::text || ':%',
       'poker:bot-replacement-buyin:v1:' || $2::uuid::text || ':%',
       'poker:managed-bot-top-up:v1:' || $2::uuid::text || ':%'
     ])
     and transactions.idempotency_key ~* ('^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:' || $2::uuid || ':[^:]+(:[^:]+)*$')

  union

  select transactions.id
    from public.chips_transactions transactions
   where transactions.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and pg_catalog.lower(pg_catalog.btrim(
       case
         when pg_catalog.jsonb_typeof(transactions.metadata) = 'object'
           then transactions.metadata->>'tableId'
         when pg_catalog.jsonb_typeof(transactions.metadata) = 'string'
           and pg_catalog.pg_input_is_valid(transactions.metadata #>> '{}', 'jsonb'::text)
           then ((transactions.metadata #>> '{}')::jsonb)->>'tableId'
         else null
       end
     )) = $2::text
     and (
       (
         transactions.metadata is not null
         and pg_catalog.jsonb_typeof(transactions.metadata) = 'object'
         and transactions.metadata ? 'tableId'
         and nullif(pg_catalog.btrim(transactions.metadata->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         and pg_catalog.lower(pg_catalog.btrim(transactions.metadata->>'tableId')) = $2::text
       )
       or (
         transactions.metadata is not null
         and pg_catalog.jsonb_typeof(transactions.metadata) = 'string'
         and pg_catalog.pg_input_is_valid(transactions.metadata #>> '{}', 'jsonb'::text)
         and pg_catalog.jsonb_typeof((transactions.metadata #>> '{}')::jsonb) = 'object'
         and ((transactions.metadata #>> '{}')::jsonb) ? 'tableId'
         and nullif(pg_catalog.btrim(((transactions.metadata #>> '{}')::jsonb)->>'tableId'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         and pg_catalog.lower(pg_catalog.btrim(((transactions.metadata #>> '{}')::jsonb)->>'tableId')) = $2::text
       )
     )

  union

  select transactions.id
    from public.chips_transactions transactions
   where transactions.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and pg_catalog.lower(transactions.reference) like any (array[
       'table:' || $2::uuid::text || '%',
       'poker-rebuy:' || $2::uuid::text || '%',
       'bot_seed_buy_in:' || $2::uuid::text || '%',
       'bot_replacement_buy_in:' || $2::uuid::text || '%',
       'managed_bot_top_up:' || $2::uuid::text || '%'
     ])
     and transactions.reference ~* ('^(table|poker-rebuy|BOT_SEED_BUY_IN|BOT_REPLACEMENT_BUY_IN|MANAGED_BOT_TOP_UP):' || $2::uuid || '(:.*)?$')

  union

  select registry.transaction_id
    from public.chips_transaction_idempotency registry
   where registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.table_id = $2::uuid

  union

  select registry.transaction_id
    from public.chips_transaction_idempotency registry
   where registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.table_id is null
     and pg_catalog.lower(registry.idempotency_key) like any (array[
       'join-buyin:' || $2::uuid::text || ':%',
       'bot-seed-buyin:' || $2::uuid::text || ':%',
       'managed-bot-seed-buyin:' || $2::uuid::text || ':%',
       'poker:leave:' || $2::uuid::text || ':%',
       'poker:inactive_cleanup:' || $2::uuid::text || ':%',
       'poker:rebuy:v1:' || $2::uuid::text || ':%',
       'poker:deferred-leave:v1:' || $2::uuid::text || ':%',
       'poker:bot-terminal-cashout:v1:' || $2::uuid::text || ':%',
       'poker:human-terminal-cashout:v1:' || $2::uuid::text || ':%',
       'poker:bot-replacement-buyin:v1:' || $2::uuid::text || ':%',
       'poker:managed-bot-top-up:v1:' || $2::uuid::text || ':%'
     ])
     and registry.idempotency_key ~* ('^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):' || $2::uuid || ':[^:]+(:[^:]+)*$')

  union

  select registry.transaction_id
    from public.chips_transaction_idempotency registry
   where registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.table_id is null
     and pg_catalog.lower(registry.idempotency_key) like any (array[
       'poker:leave:' || $2::uuid::text || ':%',
       'poker:inactive_cleanup:' || $2::uuid::text || ':%'
     ])
     and registry.idempotency_key ~* ('^poker:(leave|inactive_cleanup):' || $2::uuid || ':[^:]+(:[^:]+)*$')

  union

  select registry.transaction_id
    from public.chips_transaction_idempotency registry
   where registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
     and registry.table_id is null
     and pg_catalog.lower(registry.idempotency_key) like any (array[
       'poker:rebuy:v1:' || $2::uuid::text || ':%',
       'poker:deferred-leave:v1:' || $2::uuid::text || ':%',
       'poker:bot-terminal-cashout:v1:' || $2::uuid::text || ':%',
       'poker:human-terminal-cashout:v1:' || $2::uuid::text || ':%',
       'poker:bot-replacement-buyin:v1:' || $2::uuid::text || ':%',
       'poker:managed-bot-top-up:v1:' || $2::uuid::text || ':%'
     ])
     and registry.idempotency_key ~* ('^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:' || $2::uuid || ':[^:]+(:[^:]+)*$')

  union

  select entries.transaction_id
    from public.chips_entries entries
    join public.chips_accounts accounts on accounts.id = entries.account_id
   where accounts.account_type::text = 'ESCROW'
     and accounts.system_key = 'POKER_TABLE:' || $2::uuid::text
), target_transactions as (
  select transactions.id,
         transactions.idempotency_key,
         transactions.reference,
         normalized.normalized_metadata,
         case
           when transactions.idempotency_key ~* '^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
             then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(transactions.idempotency_key, ':', 2)))
           when transactions.idempotency_key ~* '^poker:(leave|inactive_cleanup):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
             then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(transactions.idempotency_key, ':', 3)))
           when transactions.idempotency_key ~* '^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[^:]+(:[^:]+)*$'
             then pg_catalog.lower(pg_catalog.btrim(pg_catalog.split_part(transactions.idempotency_key, ':', 4)))
           else null
         end as key_table_id
    from candidate_transaction_ids candidates
    join public.chips_transactions transactions on transactions.id = candidates.id
    cross join lateral (
      select case
               when transactions.metadata is not null
                 and pg_catalog.jsonb_typeof(transactions.metadata) = 'object'
                 then transactions.metadata
               when transactions.metadata is not null
                 and pg_catalog.jsonb_typeof(transactions.metadata) = 'string'
                 and pg_catalog.pg_input_is_valid(transactions.metadata #>> '{}', 'jsonb'::text)
                 then (transactions.metadata #>> '{}')::jsonb
               else null::jsonb
             end as normalized_metadata
    ) normalized
   where transactions.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
)
select target.id, target.idempotency_key, target.reference, target.normalized_metadata, target.key_table_id
  from target_transactions target;`;

export const BOT_ONLY_PROOF_UNKNOWN_REGISTRY_EXPLAIN_SQL = `
select registry.idempotency_key, registry.transaction_id
  from public.chips_transaction_idempotency registry
 where registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
   and registry.table_id is null
   and (
     registry.transaction_id = any(coalesce($1::uuid[], array[]::uuid[]))
     or registry.idempotency_key ~* ('^(join-buyin|bot-seed-buyin|managed-bot-seed-buyin):' || $2::uuid || ':[^:]+(:[^:]+)*$')
     or registry.idempotency_key ~* ('^poker:(leave|inactive_cleanup):' || $2::uuid || ':[^:]+(:[^:]+)*$')
     or registry.idempotency_key ~* ('^poker:(rebuy|deferred-leave|bot-terminal-cashout|human-terminal-cashout|bot-replacement-buyin|managed-bot-top-up):v1:' || $2::uuid || ':[^:]+(:[^:]+)*$')
     or exists (
       select 1
         from public.chips_entries entries
         join public.chips_accounts accounts on accounts.id = entries.account_id
        where entries.transaction_id = registry.transaction_id
          and accounts.account_type::text = 'ESCROW'
          and accounts.system_key = 'POKER_TABLE:' || $2::uuid::text
     )
   );`;

export const BOT_ONLY_PROOF_REGISTRY_KEY_COMPLETENESS_EXPLAIN_SQL = `
select registry.idempotency_key, registry.transaction_id
  from public.chips_transaction_idempotency registry
 where registry.table_id = $1::uuid
   and registry.tx_type::text in ('TABLE_BUY_IN', 'TABLE_CASH_OUT')
   and registry.transaction_created_at < $2::timestamptz
   and not (
     registry.idempotency_key = any(coalesce($3::text[], array[]::text[]))
     or exists (
       select 1
         from public.chips_ledger_archive_batches batches
        where batches.batch_id = registry.archive_batch_id
          and batches.format_version = 2
          and batches.source_policy_id = 'stage-ledger-bot-only-retention-7d-v1'
          and batches.pruned_at is not null
          and batches.registry_cleaned_at is not null
     )
   );`;

const SETTINGS_SQL = `
with configured as (
  select 'role'::text as scope,
         unnest(coalesce(rolconfig, array[]::text[])) as config
    from pg_catalog.pg_roles
   where rolname = current_user
  union all
  select case
           when setrole = 0 then 'database'
           when setdatabase = 0 then 'role'
           else 'role_in_database'
         end,
         unnest(setconfig)
    from pg_catalog.pg_db_role_setting
   where (setrole = 0 or setrole = (select oid from pg_catalog.pg_roles where rolname = current_user))
     and (setdatabase = 0 or setdatabase = (select oid from pg_catalog.pg_database where datname = current_database()))
)
select current_user::text as current_user,
       current_database()::text as current_database,
       pg_catalog.current_setting('statement_timeout', true) as session_statement_timeout,
       setting,
       unit,
       context,
       source,
       sourcefile,
       sourceline,
       boot_val,
       reset_val,
       coalesce(
         (
           select pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'scope', configured.scope,
               'value', pg_catalog.split_part(configured.config, '=', 2)
             )
           )
             from configured
            where pg_catalog.split_part(configured.config, '=', 1) = 'statement_timeout'
         ),
         '[]'::jsonb
       ) as configured_statement_timeout_sources
  from pg_catalog.pg_settings
 where name = 'statement_timeout';
`;

const IDENTITY_SQL = "select system_identifier::text as system_identifier from pg_catalog.pg_control_system();";
const FENCE_SQL = "select public.chips_table_fence_is_active() as active;";
const FENCE_CONTROL_SQL = "select enforcement_active from public.chips_table_fence_control where control_id is true;";

function sqlState(error) {
  const value = String(error?.code || error?.sqlState || error?.sqlstate || "").toUpperCase();
  return SQLSTATE_RE.test(value) ? value : null;
}

function sqlSha256(query) {
  return crypto.createHash("sha256").update(query).digest("hex");
}

function stringify(value) {
  return JSON.stringify(value, (_key, nested) => (typeof nested === "bigint" ? nested.toString() : nested), 2);
}

function boundedReadOnlySql(sql) {
  return {
    typed: typeof sql.typed === "function" ? (value, type) => sql.typed(value, type) : undefined,
    begin: (callback) => sql.begin(async (tx) => {
      let timeoutConfigured = false;
      const boundedTx = {
        unsafe: async (query, parameters) => {
          const result = parameters === undefined
            ? await tx.unsafe(query)
            : await tx.unsafe(query, parameters);
          if (!timeoutConfigured && /^\s*set transaction\b/i.test(query)) {
            await tx.unsafe(`set local statement_timeout = '${REPLAY_STATEMENT_TIMEOUT_MS}ms';`);
            timeoutConfigured = true;
          }
          return result;
        },
      };
      return callback(boundedTx);
    }),
  };
}

async function readOnlyTransaction(sql, callback) {
  return sql.begin(async (tx) => {
    await tx.unsafe("set transaction isolation level repeatable read, read only;");
    await tx.unsafe(`set local statement_timeout = '${REPLAY_STATEMENT_TIMEOUT_MS}ms';`);
    return callback(tx);
  });
}

async function readSettings(sql) {
  const rows = await readOnlyTransaction(sql, (tx) => tx.unsafe(SETTINGS_SQL));
  return rows[0] || null;
}

async function readIdentityAndFence(sql) {
  return readOnlyTransaction(sql, async (tx) => {
    const identityRows = await tx.unsafe(IDENTITY_SQL);
    const activeRows = await tx.unsafe(FENCE_SQL);
    const controlRows = await tx.unsafe(FENCE_CONTROL_SQL);
    return {
      system_identifier: identityRows[0]?.system_identifier || null,
      fence_active: activeRows[0]?.active === true || activeRows[0]?.active === "t",
      enforcement_active: controlRows.length === 1
        && (controlRows[0]?.enforcement_active === true || controlRows[0]?.enforcement_active === "t"),
    };
  });
}

async function explain(sql, queryName, query, parameters) {
  const startedAt = process.hrtime.bigint();
  try {
    const rows = await readOnlyTransaction(sql, (tx) => tx.unsafe(
      `explain (format json, verbose true, costs true, settings true) ${query}`,
      parameters,
    ));
    const plan = rows[0]?.["QUERY PLAN"] || rows[0]?.["query plan"] || null;
    return {
      query_name: queryName,
      sql_sha256: sqlSha256(query),
      elapsed_ms: Number(process.hrtime.bigint() - startedAt) / 1e6,
      sqlstate: "00000",
      read_only: true,
      explain_analyze: false,
      plan_sha256: sqlSha256(JSON.stringify(plan)),
      access_path: planAccessSummary(plan),
    };
  } catch (error) {
    return {
      query_name: queryName,
      sql_sha256: sqlSha256(query),
      elapsed_ms: Number(process.hrtime.bigint() - startedAt) / 1e6,
      sqlstate: sqlState(error),
      read_only: true,
      explain_analyze: false,
      plan_sha256: null,
      access_path: null,
      error_class: "explain_failed",
    };
  }
}

function planNodes(plan, nodes = []) {
  const root = Array.isArray(plan) ? plan[0]?.Plan : plan?.Plan;
  if (!root || typeof root !== "object") return nodes;
  const node = {
    node_type: root["Node Type"] || null,
    relation: root["Relation Name"] || null,
    index: root["Index Name"] || null,
    join_type: root["Join Type"] || null,
    strategy: root.Strategy || null,
    scan_direction: root["Scan Direction"] || null,
    startup_cost: root["Startup Cost"] ?? null,
    total_cost: root["Total Cost"] ?? null,
    estimated_rows: root["Plan Rows"] ?? null,
  };
  nodes.push(node);
  for (const child of root.Plans || []) planNodes({ Plan: child }, nodes);
  return nodes;
}

function planAccessSummary(plan) {
  const nodes = planNodes(plan);
  return {
    node_count: nodes.length,
    sequential_scans: nodes.filter((node) => node.node_type === "Seq Scan"),
    index_scans: nodes.filter((node) => node.node_type === "Index Scan" || node.node_type === "Index Only Scan"),
    bitmap_scans: nodes.filter((node) => node.node_type === "Bitmap Heap Scan" || node.node_type === "Bitmap Index Scan"),
    nodes,
  };
}

function diagnosticBatchId(value) {
  const batchId = String(value ?? "").trim();
  if (batchId !== EXACT_BOT_ONLY_DIAGNOSTIC_BATCH_ID) {
    throw new Error(`exact bot-only diagnostic is pinned to batch ${EXACT_BOT_ONLY_DIAGNOSTIC_BATCH_ID}`);
  }
  return batchId;
}

async function readExactBotOnlyBatch(sql, batchId) {
  const rows = await readOnlyTransaction(sql, (tx) => tx.unsafe(STAGE_EXACT_BATCH_SQL, [batchId]));
  if (rows.length !== 1) throw new Error(`exact bot-only diagnostic batch ${batchId} must resolve to one row`);
  return parseManifestRow(rows[0]);
}

function assertExactBotOnlyDiagnosticBatch(row, batchId, systemIdentifier) {
  if (!row || String(row.batch_id) !== batchId) throw new Error("exact bot-only diagnostic batch identity mismatch");
  if (systemIdentifier !== STAGE_SYSTEM_IDENTIFIER) throw new Error("exact bot-only diagnostic Stage identity mismatch");
  if (String(row.project_ref) !== STAGE_PROJECT_REF) throw new Error("exact bot-only diagnostic project mismatch");
  if (String(row.source_policy_id) !== BOT_ONLY_RETENTION_POLICY_ID) throw new Error("exact bot-only diagnostic policy mismatch");
  if (Number(row.format_version) !== BOT_ONLY_EXPORT_SCHEMA_VERSION || String(row.status) !== "committed") {
    throw new Error("exact bot-only diagnostic batch is not a committed schema-v2 archive");
  }
  if (!UUID_RE.test(String(row.bot_only_table_id || ""))
    || Number(row.bot_only_table_count) !== 1
    || !SHA256_RE.test(String(row.raw_sha256 || ""))
    || !SHA256_RE.test(String(row.compressed_sha256 || ""))
    || String(row.object_path) !== `v1/sha256/${row.compressed_sha256}.jsonl.gz`
    || Number(row.transaction_count) < 1
    || Number(row.entry_count) < 1) {
    throw new Error("exact bot-only diagnostic archive binding is incomplete");
  }
}

async function readProofFunctionDefinition(sql) {
  const rows = await readOnlyTransaction(sql, (tx) => tx.unsafe(BOT_ONLY_PROOF_FUNCTION_DEFINITION_SQL));
  const definition = rows[0]?.definition;
  if (typeof definition !== "string" || definition.length < 1) {
    throw new Error("bot-only proof helper definition was not found");
  }
  return { length: definition.length, sha256: sqlSha256(definition) };
}

async function runExactBotOnlyProofDiagnostic({ config, sql, batchId, identityAndFence }) {
  const exactBatchId = diagnosticBatchId(batchId);
  if (!identityAndFence?.fence_active || !identityAndFence?.enforcement_active) {
    throw new Error("exact bot-only proof diagnostic requires the active Stage TABLE fence");
  }
  const row = await readExactBotOnlyBatch(sql, exactBatchId);
  assertExactBotOnlyDiagnosticBatch(row, exactBatchId, identityAndFence.system_identifier);

  const storageTarget = resolveStorageTarget("stage", config.moduleEnv, { singleTarget: true });
  const downloaded = await downloadPrivateArchiveObject(storageTarget, row.object_path);
  if (downloaded.sha256 !== row.compressed_sha256) {
    throw new Error("exact bot-only diagnostic archive SHA differs from the committed batch");
  }
  const target = {
    target: "stage",
    projectRef: STAGE_PROJECT_REF,
    systemIdentifier: STAGE_SYSTEM_IDENTIFIER,
    maxBatchSize: STAGE_MAX_BATCH_SIZE,
  };
  const manifest = exporterManifestFromDatabase(row, target);
  const verified = verifyArchiveBytes({
    compressedBytes: downloaded.bytes,
    manifest,
    target,
    artifactName: row.object_path.split("/").at(-1),
  });
  const evidence = buildPruneEvidence(verified, { maxBatchSize: STAGE_MAX_BATCH_SIZE });
  if (evidence.tableId !== String(row.bot_only_table_id).toLowerCase()
    || evidence.registryKeysSha256 !== row.bot_only_registry_keys_sha256
    || evidence.transactionCount !== Number(row.transaction_count)
    || evidence.entryCount !== Number(row.entry_count)) {
    throw new Error("exact bot-only diagnostic archive evidence differs from the immutable batch proof");
  }

  const archiveProofComplete = Boolean(row.archive_proof_verified_at
    && SHA256_RE.test(String(row.archived_transaction_ids_sha256 || ""))
    && SHA256_RE.test(String(row.archived_entry_ids_sha256 || "")));
  if (archiveProofComplete
    && (evidence.transactionIdsSha256 !== row.archived_transaction_ids_sha256
      || evidence.entryIdsSha256 !== row.archived_entry_ids_sha256)) {
    throw new Error("exact bot-only diagnostic archive proof differs from the committed proof");
  }

  const explainInputs = {
    transaction_ids: evidence.transactionIds.length,
    transaction_ids_sha256: evidence.transactionIdsSha256,
    registry_keys: evidence.registryKeys.length,
    registry_keys_sha256: evidence.registryKeysSha256,
    table_id: evidence.tableId,
    batch_id: exactBatchId,
    cutoff: row.cutoff,
  };
  const explains = [
    await explain(
      sql,
      "proof.target_transactions",
      BOT_ONLY_PROOF_TARGET_TRANSACTIONS_EXPLAIN_SQL,
      [evidence.transactionIds, evidence.tableId],
    ),
    await explain(
      sql,
      "proof.unknown_registry_rows",
      BOT_ONLY_PROOF_UNKNOWN_REGISTRY_EXPLAIN_SQL,
      [evidence.transactionIds, evidence.tableId],
    ),
    await explain(
      sql,
      "proof.incomplete_old_registry_rows",
      BOT_ONLY_PROOF_REGISTRY_KEY_COMPLETENESS_EXPLAIN_SQL,
      [evidence.tableId, row.cutoff, evidence.registryKeys],
    ),
  ];

  return {
    batch_id: exactBatchId,
    object_path: row.object_path,
    compressed_sha256: row.compressed_sha256,
    source_policy_id: row.source_policy_id,
    bot_only_table_id: row.bot_only_table_id,
    transaction_count: evidence.transactionCount,
    entry_count: evidence.entryCount,
    transaction_ids_sha256: evidence.transactionIdsSha256,
    registry_key_count: evidence.registryKeys.length,
    registry_keys_sha256: evidence.registryKeysSha256,
    archive_verified: true,
    proof: {
      state: archiveProofComplete ? "complete" : "incomplete_in_database",
      archive_bytes_verified: true,
      transaction_ids_verified: true,
      entry_ids_verified: true,
      database_proof_fields_verified: archiveProofComplete,
      database_transaction_ids_sha256: row.archived_transaction_ids_sha256 || null,
      database_entry_ids_sha256: row.archived_entry_ids_sha256 || null,
      archive_proof_verified_at: row.archive_proof_verified_at || null,
    },
    proof_helper_definition: await readProofFunctionDefinition(sql),
    explain_inputs: explainInputs,
    explains,
    read_only_contract: {
      transaction: "repeatable read, read only",
      statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS,
      explain: "EXPLAIN (FORMAT JSON, VERBOSE, COSTS, SETTINGS), without ANALYZE",
      writes: false,
      storage_access: "private archive GET only",
      output_contains_transaction_ids: false,
      output_contains_registry_keys: false,
    },
  };
}

async function replay(sql, queryName, query, parameters) {
  const startedAt = process.hrtime.bigint();
  try {
    await readOnlyTransaction(sql, async (tx) => {
      await tx.unsafe(`set local statement_timeout = '${REPLAY_STATEMENT_TIMEOUT_MS}ms';`);
      await tx.unsafe(query, parameters);
    });
    return {
      query_name: queryName,
      sql_sha256: sqlSha256(query),
      elapsed_ms: Number(process.hrtime.bigint() - startedAt) / 1e6,
      sqlstate: "00000",
      statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS,
      read_only: true,
      output_rows: false,
    };
  } catch (error) {
    return {
      query_name: queryName,
      sql_sha256: sqlSha256(query),
      elapsed_ms: Number(process.hrtime.bigint() - startedAt) / 1e6,
      sqlstate: sqlState(error),
      statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS,
      read_only: true,
      output_rows: false,
    };
  }
}

function tableSummaryFailure(diagnosis, recordIndex) {
  if (!diagnosis) return null;
  if (!diagnosis.ok) {
    return {
      code: diagnosis.code,
      field: diagnosis.field,
      record_index: recordIndex,
      strict_timestamp_equal: diagnosis.strict_timestamp_equal ?? null,
      semantic_timestamp_equal: diagnosis.semantic_timestamp_equal ?? null,
    };
  }
  return null;
}

export async function runBotOnlyTableIdentitySummaryDiagnostic({ config, sql, cutoff }) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chips-ledger-stage-table-summary-diagnostic-"));
  fs.chmodSync(tempRoot, 0o700);
  const artifactPath = path.join(tempRoot, "bot-only.archive.jsonl.gz");
  const manifestPath = path.join(tempRoot, "bot-only.archive.manifest.json");
  const boundedSql = boundedReadOnlySql(sql);
  try {
    const exported = await runExport({
      argv: [
        "--target", "stage",
        "--cutoff", cutoff,
        "--batch-size", String(STAGE_MAX_BATCH_SIZE),
        "--output", artifactPath,
        "--manifest", manifestPath,
      ],
      env: config.moduleEnv,
      cwd: tempRoot,
      now: new Date(cutoff),
      deps: {
        sql: boundedSql,
        selector: "bot-only-7d",
        schemaVersion: BOT_ONLY_EXPORT_SCHEMA_VERSION,
        sourcePolicyId: BOT_ONLY_RETENTION_POLICY_ID,
        targetOptions: { singleTarget: true },
        noCandidateIfEmpty: true,
        emit: false,
      },
    });
    if (exported?.noCandidate) {
      return {
        state: "no_candidate",
        records: 0,
        entries: 0,
        first_failure: null,
        local_archive_store_validation: { state: "not_run", error_code: null },
      };
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const rawBytes = gunzipSync(fs.readFileSync(artifactPath));
    const records = parseJsonl(rawBytes.toString("utf8"));
    let representative = null;
    let firstFailure = null;
    let representationOnlyMismatch = null;
    for (const [recordIndex, record] of records.entries()) {
      const diagnosis = diagnoseTableIdentitySummary(record?.table_context?.table_identity_summary, manifest.bot_only);
      if (!representative) representative = diagnosis;
      if (!representationOnlyMismatch
        && diagnosis.code === TABLE_IDENTITY_SUMMARY_ERROR_CODES.NEWEST_CREATED_AT_REPRESENTATION_ONLY_MISMATCH) {
        representationOnlyMismatch = {
          code: diagnosis.code,
          field: diagnosis.field,
          record_index: recordIndex,
          strict_timestamp_equal: diagnosis.strict_timestamp_equal,
          semantic_timestamp_equal: diagnosis.semantic_timestamp_equal,
        };
      }
      const failure = tableSummaryFailure(diagnosis, recordIndex);
      if (failure) {
        firstFailure = failure;
        break;
      }
    }

    let localValidation = { state: "pass", error_code: null };
    try {
      verifyLocalArchive({
        artifactPath,
        manifestPath,
        target: resolveStorageTarget("stage", config.moduleEnv, { singleTarget: true }),
      });
    } catch (error) {
      localValidation = {
        state: "blocked",
        error_code: error?.code || null,
        error_class: "local_archive_store_validation_failed",
      };
    }

    return {
      state: firstFailure || localValidation.state !== "pass" ? "blocked" : "pass",
      records: records.length,
      entries: records.reduce((total, record) => total + (Array.isArray(record?.entries) ? record.entries.length : 0), 0),
      first_failure: firstFailure,
      representation_only_mismatch: representationOnlyMismatch,
      checks: representative?.checks || [],
      strict_timestamp_equal: representative?.strict_timestamp_equal ?? null,
      semantic_timestamp_equal: representative?.semantic_timestamp_equal ?? null,
      local_archive_store_validation: localValidation,
      read_only_contract: {
        transaction: "repeatable read, read only",
        statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS,
        writes: false,
        storage_access: false,
        output_contains_rows: false,
      },
    };
  } catch (error) {
    return {
      state: "error",
      records: null,
      entries: null,
      first_failure: null,
      error_code: error?.code || null,
      error_class: "bounded_table_summary_diagnostic_failed",
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

export async function runStageTimeoutDiagnostic({ env = process.env, now = new Date(), summaryOnly = false, batchId = null } = {}) {
  const config = validateStageEnvironment(env, { requireCommitSha: true });
  const sql = postgres(config.dbUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 0,
  });
  const cutoff = new Date(now.getTime() - BOT_ONLY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const candidateParameters = [cutoff, STAGE_MAX_BATCH_SIZE, null, null];
  const anomalyParameters = [cutoff, STAGE_MAX_BATCH_SIZE];
  const ownBatchParameters = [STAGE_PROJECT_REF, BOT_ONLY_RETENTION_POLICY_ID];

  try {
    const identityAndFence = await readIdentityAndFence(sql);
    if (identityAndFence.system_identifier !== STAGE_SYSTEM_IDENTIFIER) {
      throw new Error("database is not canonical Stage");
    }

    if (batchId != null) {
      if (summaryOnly) throw new Error("exact bot-only batch diagnostic cannot be combined with --summary-only");
      return {
        event: "chips_ledger_stage_exact_bot_only_proof_diagnostic",
        target: "stage",
        mode: "bot-only-7d-exact-proof-diagnostic",
        project_ref: STAGE_PROJECT_REF,
        deployed_commit_sha: config.deployedCommitSha,
        stage_identity_and_fence: identityAndFence,
        statement_timeout: await readSettings(sql),
        exact_batch: await runExactBotOnlyProofDiagnostic({
          config,
          sql,
          batchId,
          identityAndFence,
        }),
        read_only_contract: {
          transaction: "repeatable read, read only",
          statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS,
          writes: false,
          storage_access: "private archive GET only",
          output_contains_sql_parameters: false,
          output_contains_rows: false,
        },
      };
    }

    if (summaryOnly) {
      const tableIdentitySummary = await runBotOnlyTableIdentitySummaryDiagnostic({
        config,
        sql,
        cutoff,
      });
      return {
        event: "chips_ledger_stage_summary_diagnostic",
        target: "stage",
        mode: "bot-only-7d-summary-diagnostic",
        project_ref: STAGE_PROJECT_REF,
        deployed_commit_sha: config.deployedCommitSha,
        stage_identity_and_fence: identityAndFence,
        cutoff,
        bot_only_table_identity_summary: tableIdentitySummary,
        read_only_contract: {
          transaction: "repeatable read, read only",
          statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS,
          writes: false,
          storage_access: false,
          output_contains_sql_parameters: false,
          output_contains_rows: false,
        },
      };
    }

    const settings = await readSettings(sql);
    const explains = [
      await explain(sql, "stage.load_own_batches", STAGE_OWN_BATCHES_SQL, ownBatchParameters),
      await explain(sql, "snapshot.bot_only_candidate_selector", BOT_ONLY_CANDIDATE_SQL, candidateParameters),
      await explain(sql, "snapshot.bot_only_blocking_anomalies", BOT_ONLY_BLOCKING_ANOMALY_SQL, anomalyParameters),
    ];
    const selectorReplay = await replay(
      sql,
      "snapshot.bot_only_candidate_selector",
      BOT_ONLY_CANDIDATE_SQL,
      candidateParameters,
    );
    const tableIdentitySummary = await runBotOnlyTableIdentitySummaryDiagnostic({
      config,
      sql,
      cutoff,
    });

    return {
      event: "chips_ledger_stage_timeout_diagnostic",
      target: "stage",
      project_ref: STAGE_PROJECT_REF,
      deployed_commit_sha: config.deployedCommitSha,
      stage_identity_and_fence: identityAndFence,
      cutoff,
      statement_timeout: settings,
      explains,
      selector_replay: selectorReplay,
      bot_only_table_identity_summary: tableIdentitySummary,
      read_only_contract: {
        transaction: "repeatable read, read only",
        explain: "EXPLAIN (FORMAT JSON, VERBOSE, COSTS, SETTINGS), without ANALYZE",
        writes: false,
        replay_statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS,
        candidate_result_limit: STAGE_MAX_BATCH_SIZE,
        output_contains_sql_parameters: false,
        output_contains_rows: false,
      },
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && process.argv[1].endsWith("chips-ledger-stage-timeout-diagnostic.mjs")) {
  const argv = process.argv.slice(2);
  let summaryOnly = false;
  let batchId = null;
  let invalid = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--summary-only" && !summaryOnly) {
      summaryOnly = true;
      continue;
    }
    if (argv[index] === "--batch-id" && batchId === null && argv[index + 1] && !argv[index + 1].startsWith("--")) {
      batchId = argv[index + 1];
      index += 1;
      continue;
    }
    invalid = true;
    break;
  }
  if (invalid || (summaryOnly && batchId !== null)) {
    process.stderr.write("usage: node scripts/ops/chips-ledger-stage-timeout-diagnostic.mjs [--summary-only | --batch-id 481]\n");
    process.exitCode = 1;
  } else {
    runStageTimeoutDiagnostic({ summaryOnly, batchId })
      .then((report) => process.stdout.write(`${stringify(report)}\n`))
    .catch((error) => {
      process.stderr.write(`chips-ledger-stage-timeout-diagnostic failed: ${redactedError(error)}\n`);
      process.exitCode = 1;
    });
  }
}
